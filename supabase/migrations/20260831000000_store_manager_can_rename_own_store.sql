BEGIN;

-- 販売前総合チェックで発見: canEditStoreName(permissions.js)はstore_managerに自店舗の
-- 店舗名変更を許可しており、App.jsxのhandleSaveStoreも実際にstore_manager(自分の
-- allowedStoreIdsに含まれる店舗に限り)からこの操作を呼べる作りになっていた。しかし
-- stores_update_company_scoped(唯一のUPDATEポリシー)はsystem_admin/company_adminにしか
-- UPDATEを許可しておらず、store_manager自身の店舗であってもRLSに拒否され「店舗名の更新に
-- 失敗しました」という結果になる——アプリ側が使える前提で作った機能がDB側で常に失敗する
-- 状態だった(20260815010000_store_lifecycle_status.sqlのコメントに「store_managerに元々
-- UPDATE権限が無いため」と明記されており、他のUPDATE系ロジック追加時に一緒に見送られた
-- まま今回まで残っていたもの)。
--
-- 対応方針: store_managerには「自分の店舗(current_user_store_ids())の店舗名変更」だけを
-- 許可し、他の列(status/is_active/company_id/code/daily_field_settings/
-- ai_analysis_enabled)は変更できないようにする。RLSのUSING/WITH CHECKだけでは列単位の
-- 制限を宣言的に表現できない(NEWとOLDを比較する組み込み構文が無い)ため、BEFORE UPDATE
-- トリガーで「呼び出し元がsystem_admin/company_adminでない場合、name/updated_at以外の
-- 列が変化していたら拒否する」ことを保証する——これにより、アプリのUI/クライアントコード
-- (updateStoreRecordはname+updated_atしか送らない)を信頼しなくても、DB側だけで安全性が
-- 完結する(要件20: 権限チェックの省略・緩和は行わない/むしろ既存の緩すぎない設計を維持
-- したまま、意図した権限だけを追加する)。

create or replace function public.stores_restrict_store_manager_update_columns()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  -- auth.uid()がnullの接続はSupabase Auth JWTを伴わないservice-role呼び出し
  -- (update-store-status/delete-store等のEdge Function、SUPABASE_SERVICE_ROLE_KEY使用)。
  -- これらは既にRLS自体を完全にバイパスする権限を持ち、各Edge Function側で個別に
  -- 呼び出し元の権限(system_admin/company_admin等)を検証済みのため、このトリガーでも
  -- 同じ信頼境界に揃えて素通りさせる——ここでauth.uid() is nullを許可しないと、
  -- update-store-status(store.statusをservice role経由で変更する、唯一の正規の変更経路)が
  -- このトリガーに阻まれて店舗の停止/再開/アーカイブが機能しなくなってしまう。
  if auth.uid() is null or public.current_user_is_system_admin() or public.current_user_is_company_admin() then
    return new;
  end if;
  if new.status is distinct from old.status
    or new.is_active is distinct from old.is_active
    or new.company_id is distinct from old.company_id
    or new.code is distinct from old.code
    or new.daily_field_settings is distinct from old.daily_field_settings
    or new.ai_analysis_enabled is distinct from old.ai_analysis_enabled
  then
    raise exception 'store_manager can only update the store name' using errcode = '42501';
  end if;
  return new;
end;
$$;
alter function public.stores_restrict_store_manager_update_columns() owner to postgres;
revoke all on function public.stores_restrict_store_manager_update_columns() from public;

drop trigger if exists stores_restrict_store_manager_update_columns_trigger on public.stores;
create trigger stores_restrict_store_manager_update_columns_trigger
  before update on public.stores
  for each row
  execute function public.stores_restrict_store_manager_update_columns();

drop policy if exists stores_update_company_scoped on public.stores;
create policy stores_update_company_scoped on public.stores
  for update
  using (
    auth.uid() is not null
    and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (id in (select unnest(public.current_user_store_ids())) and public.current_user_is_store_manager())
    )
  )
  with check (
    auth.uid() is not null
    and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (id in (select unnest(public.current_user_store_ids())) and public.current_user_is_store_manager())
    )
  );

COMMIT;
