BEGIN;

-- 加盟店連携(フランチャイズ)機能: 会社同士の閲覧専用の関係を管理する新テーブル。
-- 加盟店のcompany_idは一切変更しない(既存のcompany_id分離をそのまま維持する) — 単に
-- 「本部会社の管理者が加盟店会社のデータをSELECTだけ許可される」という関係を別テーブルで
-- 管理し、既存のcurrent_user_company_ids()等のヘルパー関数(company_admin/store_managerの
-- 書き込み系RLSに使われる)には一切手を触れない。加盟店データへのINSERT/UPDATE/DELETEは
-- このマイグレーションのどこにも許可を追加しない — 構造的に書き込み不可能にすることが
-- 最終的なセキュリティ境界になる。

create table if not exists public.company_partnerships (
  id uuid primary key default gen_random_uuid(),
  parent_company_id uuid not null references public.companies(id) on delete cascade,
  partner_company_id uuid not null references public.companies(id) on delete cascade,
  relationship_type text not null default 'franchise' check (relationship_type in ('franchise')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','disconnected')),
  joined_at date,
  can_view_sales boolean not null default true,
  can_view_daily boolean not null default true,
  can_view_dashboard boolean not null default true,
  can_view_pl boolean not null default true,
  can_view_costs boolean not null default true,
  requested_by uuid references public.profiles(id) on delete set null,
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_company_id, partner_company_id),
  check (parent_company_id <> partner_company_id)
);

create index if not exists company_partnerships_partner_status_idx on public.company_partnerships (partner_company_id, status);
create index if not exists company_partnerships_parent_status_idx on public.company_partnerships (parent_company_id, status);

alter table public.company_partnerships enable row level security;

-- SELECT: system_admin、または自社がparent/partnerどちらか(承認待ちリクエストを受信した側
-- からも、送信した側からも見える必要があるため)。current_user_company_ids()をそのまま
-- 使うのは自社分の閲覧なので問題ない(この関数自体は変更しない)。
create policy company_partnerships_select
  on public.company_partnerships
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or parent_company_id in (select unnest(public.current_user_company_ids()))
      or partner_company_id in (select unnest(public.current_user_company_ids()))
    )
  );

-- INSERT/UPDATE/DELETE: system_adminのみ(直接のRLS経由では)。company_adminによる承認/拒否/
-- 解除操作は、呼び出し元の権限をサーバー側で再検証するEdge Function(service role)経由でのみ
-- 行う(update-company-status等の既存の会社ライフサイクル操作と同じ規約)。
create policy company_partnerships_insert_system_admin_only
  on public.company_partnerships
  for insert to authenticated
  with check (auth.uid() is not null and public.current_user_is_system_admin());

create policy company_partnerships_update_system_admin_only
  on public.company_partnerships
  for update to authenticated
  using (auth.uid() is not null and public.current_user_is_system_admin())
  with check (auth.uid() is not null and public.current_user_is_system_admin());

create policy company_partnerships_delete_system_admin_only
  on public.company_partnerships
  for delete to authenticated
  using (auth.uid() is not null and public.current_user_is_system_admin());

create or replace function public.set_company_partnerships_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists company_partnerships_set_updated_at on public.company_partnerships;
create trigger company_partnerships_set_updated_at
  before update on public.company_partnerships
  for each row execute function public.set_company_partnerships_updated_at();

-- 加盟店閲覧の可否判定。company_adminのみに絞る — store_manager/staffもprofiles.company_id
-- を持つためcurrent_user_company_ids()自体は非nullになり得るが、そのままだとstore_manager/
-- staffにも加盟店データが見えてしまう(要件10で明確に禁止)。system_adminはこの関数を経由
-- しない(各テーブルの既存のcurrent_user_is_system_admin()分岐がそのまま無条件アクセスを
-- 許可しているため、ここに含める必要が無い)。
create or replace function public.current_user_can_view_franchise_company(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
  select public.current_user_is_company_admin() and exists (
    select 1
    from public.company_partnerships cp
    where cp.partner_company_id = target_company_id
      and cp.status = 'approved'
      and cp.parent_company_id in (select unnest(public.current_user_company_ids()))
  );
$$;

grant execute on function public.current_user_can_view_franchise_company(uuid) to authenticated;

-- 以下、17テーブルのSELECTポリシーにだけ、加盟店閲覧のOR分岐を追加する。INSERT/UPDATE/
-- DELETEポリシーは一切変更しない。既存のqual文言はsupabase db query --linkedで直前に
-- 取得した本番の現行ポリシーそのまま(トートロジー系の過去バグを再発させないよう、
-- 一字一句そのまま踏襲したうえでOR分岐だけ追記する)。

drop policy if exists companies_select_company_scoped on public.companies;
create policy companies_select_company_scoped
  on public.companies
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or id in (select p.company_id from public.profiles p where p.auth_user_id = auth.uid() and p.company_id is not null and p.is_active = true)
      or public.current_user_can_view_franchise_company(id)
    )
  );

drop policy if exists stores_select_company_scoped on public.stores;
create policy stores_select_company_scoped
  on public.stores
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or id in (select unnest(public.current_user_store_ids()))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists company_all_stores_holidays_select on public.company_all_stores_holidays;
create policy company_all_stores_holidays_select
  on public.company_all_stores_holidays
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists company_all_stores_targets_select on public.company_all_stores_targets;
create policy company_all_stores_targets_select
  on public.company_all_stores_targets
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists company_settings_select_company_scoped on public.company_settings;
create policy company_settings_select_company_scoped
  on public.company_settings
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or exists (select 1 from public.stores s where s.company_id = company_settings.company_id and s.id in (select unnest(public.current_user_store_ids())))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists cost_monthly_amounts_select_company_scoped on public.cost_monthly_amounts;
create policy cost_monthly_amounts_select_company_scoped
  on public.cost_monthly_amounts
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists daily_cash_breakdown_select_company_scoped on public.daily_cash_breakdown;
create policy daily_cash_breakdown_select_company_scoped
  on public.daily_cash_breakdown
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists daily_sales_select_company_scoped on public.daily_sales;
create policy daily_sales_select_company_scoped
  on public.daily_sales
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists fixed_costs_select_company_scoped on public.fixed_costs;
create policy fixed_costs_select_company_scoped
  on public.fixed_costs
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists monthly_closing_items_select_company_scoped on public.monthly_closing_items;
create policy monthly_closing_items_select_company_scoped
  on public.monthly_closing_items
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists monthly_closings_select_company_scoped on public.monthly_closings;
create policy monthly_closings_select_company_scoped
  on public.monthly_closings
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists monthly_targets_select_company_scoped on public.monthly_targets;
create policy monthly_targets_select_company_scoped
  on public.monthly_targets
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists store_business_holidays_select on public.store_business_holidays;
create policy store_business_holidays_select
  on public.store_business_holidays
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists store_input_settings_select_company_scoped on public.store_input_settings;
create policy store_input_settings_select_company_scoped
  on public.store_input_settings
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists store_inventory_balances_select_company_scoped on public.store_inventory_balances;
create policy store_inventory_balances_select_company_scoped
  on public.store_inventory_balances
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists store_profiles_select_company_scoped on public.store_profiles;
create policy store_profiles_select_company_scoped
  on public.store_profiles
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

drop policy if exists variable_costs_select_company_scoped on public.variable_costs;
create policy variable_costs_select_company_scoped
  on public.variable_costs
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

COMMIT;
