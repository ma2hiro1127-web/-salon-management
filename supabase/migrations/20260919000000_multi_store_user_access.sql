-- 複数店舗ユーザー権限(2026-09、ユーザー管理「所属店舗」の複数選択対応)。
--
-- 背景: public.user_stores(user_id, company_id, store_id, is_primary)は既に存在し、
-- current_user_store_ids()を筆頭にRLS側は既に配列(複数店舗)を前提に設計済みだった
-- (daily_sales/monthly_closings/user_stores自身のINSERT/UPDATE/DELETEポリシー等、
-- 監査の結果いずれもcurrent_user_store_ids()を使った複数店舗対応済みで、変更不要と確認済み)。
-- 今回追加が必要だったのは以下の2点だけ:
--   1. user_stores.created_by(要件の必須情報例に明記されているが未実装だった)
--   2. user_id×store_idの重複防止制約を要件どおりの2列構成に統一
--      (既存はunique(user_id, company_id, store_id) — store_idがcompany_idを一意に
--      決定するため実質的に等価だが、要件が明示するuser_id×store_idへ揃える)
-- あわせて、ユーザー編集の保存(基本情報・権限・主要所属店舗・複数所属店舗)を1つの
-- トランザクションとして実行するsave_user_profile_and_stores関数を追加する
-- (要件: 保存処理を1つの整合した処理にする)。

alter table public.user_stores
  add column if not exists created_by uuid references public.profiles(id) on delete set null;
comment on column public.user_stores.created_by is 'この所属店舗の割り当てを実行した操作者(profiles.id)。既存データはnull(移行前のため特定できない)。';

-- 重複防止制約をuser_id×store_idへ統一する。store_idはcompany_idを一意に決定する
-- (stores.company_idが1つだけ)ため、実質的にunique(user_id, company_id, store_id)と
-- 同じ集合を防ぐが、要件が明示する2列構成に合わせる。既存データは1ユーザー1行のみ
-- (2026-09-19時点で重複なしを確認済み)のため、この制約変更で既存行が失敗することはない。
alter table public.user_stores drop constraint if exists user_stores_user_id_company_id_store_id_key;
alter table public.user_stores add constraint user_stores_user_id_store_id_key unique (user_id, store_id);

-- ユーザー編集画面の保存(基本情報・権限・主要所属店舗・複数所属店舗)をまとめて実行する。
-- security invoker(既定値、明示しておく)——呼び出し元のRLS権限がそのまま適用されるため、
-- 直接クライアントからprofiles.update/user_stores.delete/insertを呼ぶ場合と全く同じ認可判定
-- になる(新たな権限バイパスは一切発生しない)。関数本体全体が1つのトランザクションとして
-- 実行される(Postgresの関数呼び出しは呼び出し元のトランザクション内で実行されるため、
-- 途中で例外が起きれば全体がロールバックされ、名前だけ更新されて店舗が0件になる、といった
-- 中途半端な状態が発生しない)。
--
-- 対象外(このRPCでは扱わない、既存の専用Edge Function経由のまま):
--   - メールアドレス変更(auth.usersの更新が必要 — update-user-email Edge Function)
--   - 有効/停止の切り替え(Supabase AuthのBAN処理が必要 — set-user-active-state Edge Function)
-- これら2つはSupabase Auth(Postgresの外側のサービス)への書き込みを伴うため、単一の
-- Postgresトランザクションに含めることが構造的にできない。呼び出し側(App.jsx)は、
-- 必要な場合にこれらを先に実行してから、このRPCで残り(氏名・権限・所属店舗)をまとめて
-- 実行する。
create or replace function public.save_user_profile_and_stores(
  p_profile_id uuid,
  p_name text,
  p_role text,
  p_company_id uuid,
  p_store_ids uuid[],
  p_primary_store_id uuid
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor_profile_id uuid;
  v_store_count int;
begin
  if p_profile_id is null then
    raise exception 'p_profile_id is required';
  end if;

  -- 主要所属店舗は所属店舗一覧に必ず含める(要件)。呼び出し側でも保証しているが、
  -- サーバー側でも独立して検証する(要件: サーバー側でも操作者の権限と整合性を検証する)。
  if p_primary_store_id is not null and not (p_primary_store_id = any(p_store_ids)) then
    raise exception '主要所属店舗は所属店舗一覧に含まれている必要があります';
  end if;

  -- 店舗管理者・一般スタッフは最低1店舗が必須(要件)。system_admin/company_adminは
  -- 所属店舗の概念そのものを持たない(全社・自社全店舗を見るため)ので対象外。
  if p_role in ('store_manager', 'staff') and coalesce(array_length(p_store_ids, 1), 0) = 0 then
    raise exception '店舗管理者・一般スタッフには最低1店舗の所属店舗が必要です';
  end if;

  update public.profiles
  set name = p_name,
      role = p_role,
      updated_at = now()
  where id = p_profile_id;

  if not found then
    raise exception '対象のユーザーが見つかりません';
  end if;

  v_actor_profile_id := public.current_user_profile_id();

  -- 既存の所属店舗をすべて削除してから、指定された一覧を入れ直す(既存のupdateProfile
  -- StoreAssignments、client/utils/supabase.jsと同じdelete→insert方式)。RLSの
  -- user_stores_delete_company_scoped/user_stores_insert_company_scopedが、削除・追加
  -- しようとしている個々の行に対して呼び出し元の権限を通常どおり検証する——このRPCは
  -- あくまで「複数の操作を1トランザクションにまとめる」ためのものであり、認可判定自体は
  -- 一切肩代わりしない。
  delete from public.user_stores where user_id = p_profile_id;

  select count(*) into v_store_count from unnest(p_store_ids);
  if v_store_count > 0 then
    insert into public.user_stores (user_id, company_id, store_id, is_primary, created_by)
    select p_profile_id, p_company_id, s, (s = p_primary_store_id), v_actor_profile_id
    from unnest(p_store_ids) as s;
  end if;
end;
$$;
alter function public.save_user_profile_and_stores(uuid, text, text, uuid, uuid[], uuid) owner to postgres;
revoke all on function public.save_user_profile_and_stores(uuid, text, text, uuid, uuid[], uuid) from public;
grant execute on function public.save_user_profile_and_stores(uuid, text, text, uuid, uuid[], uuid) to authenticated;
