BEGIN;

-- 新規オーナー・セルフサインアップ機能(招待制とは別の、非公開のfeature flag付き新導線)。
-- 会社・店舗の実際の作成は新設のself-signup Edge Function(service-role)が行う——
-- companies/storesへのINSERT用RLS(companies_insert_system_only等、20260805130000)は
-- 一切変更しない。既存の招待フロー・既存company/store/userには無関係。

-- ============================================================
-- app_feature_flags: 今回はself_signup_enabledの1行のみを想定した最小限のフラグ管理テーブル。
-- 将来他のflagが必要になった場合もこのテーブルに行を追加するだけで済む汎用形にしておく。
-- ============================================================
create table public.app_feature_flags (
  flag_key text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into public.app_feature_flags (flag_key, enabled) values ('self_signup_enabled', false);

alter table public.app_feature_flags enable row level security;

-- 閲覧・変更ともsystem_admin限定(公開状態のON/OFFは運営側だけが判断する — 要件9)。
-- 一般利用者からの読み取りはこのテーブルへ直接ではなく、下のis_self_signup_enabled()経由に限る。
create policy app_feature_flags_select_system_admin
on public.app_feature_flags for select to authenticated
using (public.current_user_is_system_admin());

create policy app_feature_flags_update_system_admin
on public.app_feature_flags for update to authenticated
using (public.current_user_is_system_admin())
with check (public.current_user_is_system_admin());

-- 未ログインのログイン画面でも「新規オーナー登録」導線の表示可否を判定できるよう、
-- get_invite_info(20260809000000)と同じ形の匿名呼び出し可能なSECURITY DEFINER関数として
-- 公開する。この関数はenabledのbooleanだけを返し、テーブルの他の行や列は一切露出しない。
create or replace function public.is_self_signup_enabled()
returns boolean language sql security definer set search_path = pg_catalog, public stable as $$
  select coalesce(
    (select enabled from public.app_feature_flags where flag_key = 'self_signup_enabled'),
    false
  );
$$;
alter function public.is_self_signup_enabled() owner to postgres;
revoke all on function public.is_self_signup_enabled() from public;
grant execute on function public.is_self_signup_enabled() to anon, authenticated;

-- ============================================================
-- 将来のStripe連携に備えた列(要件13)。今回は列を追加するだけで、課金判定・トライアル期限
-- 切れの制御等のロジックは一切実装しない(ダミー課金処理を作らないという要件のため)。
-- ============================================================
alter table public.companies
  add column plan text,
  add column trial_started_at timestamptz,
  add column trial_ends_at timestamptz,
  add column subscription_status text,
  add column stripe_customer_id text,
  add column stripe_subscription_id text;

-- self-signup経由で作られたユーザーかどうかの診断用マーカー(権限判定には一切使わない —
-- 権限は既存のprofiles.roleのみで決まる)。
alter table public.profiles
  add column signup_source text;

COMMIT;
