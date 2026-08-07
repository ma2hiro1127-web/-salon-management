-- Fixed costs (固定費) previously had no dedicated table at all — every add/edit/delete only
-- ever mutated local React state and relied on the generic tenant_snapshots blob (fetched
-- per-store+month, only the freshest few rows) to eventually carry it to Supabase. A "翌月以降
-- 継続" (this-month-onward) item is computed by looking *backwards* across every earlier month's
-- entries for the store (see getFixedCostsForStoreMonth in storage.js) — a fresh device/session
-- opening a later month would never even fetch the snapshot row the recurring item was
-- originally entered under, so the carry-forward could silently fail to show up. This table
-- makes fixed costs authoritative and company-wide-fetchable the same way daily_sales/
-- monthly_targets/monthly_closings already are.
create table if not exists public.fixed_costs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  -- The month this item was originally filed under (equivalent to the local
  -- `storeName__YYYY-MM` key's month half) — NOT the month currently being viewed. This is
  -- what getFixedCostsForStoreMonth's carry-forward logic keys its "does this apply to a
  -- later month" check on.
  entry_month text not null,
  name text not null default '',
  amount numeric not null default 0,
  category text not null default '',
  memo text not null default '',
  start_month text not null default '',
  end_month text not null default '',
  apply_mode text not null default 'this-month',
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fixed_costs_company_id_idx on public.fixed_costs(company_id);
create index if not exists fixed_costs_store_id_idx on public.fixed_costs(store_id);

alter table public.fixed_costs enable row level security;

drop policy if exists fixed_costs_select_company_scoped on public.fixed_costs;
drop policy if exists fixed_costs_insert_company_scoped on public.fixed_costs;
drop policy if exists fixed_costs_update_company_scoped on public.fixed_costs;
drop policy if exists fixed_costs_delete_company_scoped on public.fixed_costs;

-- Mirrors monthly_targets' RLS shape exactly: any assigned store (or company/system admin) can
-- read, but only store managers (or company/system admins) can write — fixed-cost entry lives
-- alongside monthly target-setting in the 管理画面, not the day-to-day daily-entry flow.
create policy fixed_costs_select_company_scoped
  on public.fixed_costs
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

create policy fixed_costs_insert_company_scoped
  on public.fixed_costs
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

create policy fixed_costs_update_company_scoped
  on public.fixed_costs
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

create policy fixed_costs_delete_company_scoped
  on public.fixed_costs
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

create or replace function public.set_fixed_costs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists fixed_costs_set_updated_at on public.fixed_costs;
create trigger fixed_costs_set_updated_at
  before update on public.fixed_costs
  for each row execute function public.set_fixed_costs_updated_at();
