-- 損益表の再設計: 在庫管理(店舗単位・任意)と消費税引当(会社単位・任意)の設定を追加し、
-- 月末在庫金額を対象月ごとに保存するテーブルを新設する。既存カラムの削除・変更、既存行の
-- DELETE/TRUNCATEは一切行わない(company_settings/store_input_settingsへの列追加のみ)。

alter table public.company_settings
  add column if not exists consider_consumption_tax boolean not null default false,
  add column if not exists consumption_tax_reserve_rate numeric not null default 0;

alter table public.store_input_settings
  add column if not exists use_inventory_tracking boolean not null default false;

-- 在庫管理ONの店舗が「対象月末時点の在庫金額」を月1回入力するためのテーブル。原価計算は
-- 「前月末在庫 + 当月仕入・発注額 - 当月末在庫」(storage.jsのcalculateMonthSummary参照)。
-- 前月分のレコードが無い(初回利用)場合にユーザーが入力する「期首在庫」も、実体としては
-- 「前月(target_month = 当月の1つ前)の在庫金額」としてこの同じテーブルに保存する
-- (別概念のカラムを増やさず、getPreviousMonthCostAmountと同型の月次金額として扱う)。
create table if not exists public.store_inventory_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  target_month text not null,
  closing_amount numeric not null default 0,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, target_month)
);

create index if not exists store_inventory_balances_company_id_idx on public.store_inventory_balances(company_id);
create index if not exists store_inventory_balances_store_id_idx on public.store_inventory_balances(store_id);
create index if not exists store_inventory_balances_target_month_idx on public.store_inventory_balances(target_month);

alter table public.store_inventory_balances enable row level security;

drop policy if exists store_inventory_balances_select_company_scoped on public.store_inventory_balances;
drop policy if exists store_inventory_balances_insert_company_scoped on public.store_inventory_balances;
drop policy if exists store_inventory_balances_update_company_scoped on public.store_inventory_balances;
drop policy if exists store_inventory_balances_delete_company_scoped on public.store_inventory_balances;

-- cost_monthly_amounts(20260810010000)のRLS形状をそのまま踏襲する。
create policy store_inventory_balances_select_company_scoped
  on public.store_inventory_balances
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

create policy store_inventory_balances_insert_company_scoped
  on public.store_inventory_balances
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (
          select 1
          from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role = 'store_manager'
        )
      )
    )
    and exists (
      select 1
      from public.stores s
      where s.id = store_id
        and s.company_id = company_id
    )
  );

create policy store_inventory_balances_update_company_scoped
  on public.store_inventory_balances
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (
          select 1
          from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role = 'store_manager'
        )
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (
          select 1
          from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role = 'store_manager'
        )
      )
    )
    and exists (
      select 1
      from public.stores s
      where s.id = store_id
        and s.company_id = company_id
    )
  );

create policy store_inventory_balances_delete_company_scoped
  on public.store_inventory_balances
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (
          select 1
          from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role = 'store_manager'
        )
      )
    )
  );

create or replace function public.set_store_inventory_balances_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists store_inventory_balances_set_updated_at on public.store_inventory_balances;
create trigger store_inventory_balances_set_updated_at
  before update on public.store_inventory_balances
  for each row execute function public.set_store_inventory_balances_updated_at();
