-- Variable costs (販管費) had the exact same gap fixed_costs did before
-- 20260808000000_create_fixed_costs.sql: no dedicated table at all, only ever mutated local
-- React state and relied on tenant_snapshots. Unlike fixed_costs there's no carry-forward here
-- (getVariableCostsForStoreMonth does a direct month lookup, no backward scan), so target_month
-- is simply "which month this item belongs to" — no separate entry-month concept needed.
create table if not exists public.variable_costs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  target_month text not null,
  name text not null default '',
  amount numeric not null default 0,
  category text not null default '',
  memo text not null default '',
  incurred_date text not null default '',
  type text not null default 'regular',
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists variable_costs_company_id_idx on public.variable_costs(company_id);
create index if not exists variable_costs_store_id_idx on public.variable_costs(store_id);
create index if not exists variable_costs_target_month_idx on public.variable_costs(target_month);

alter table public.variable_costs enable row level security;

drop policy if exists variable_costs_select_company_scoped on public.variable_costs;
drop policy if exists variable_costs_insert_company_scoped on public.variable_costs;
drop policy if exists variable_costs_update_company_scoped on public.variable_costs;
drop policy if exists variable_costs_delete_company_scoped on public.variable_costs;

create policy variable_costs_select_company_scoped
  on public.variable_costs
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

create policy variable_costs_insert_company_scoped
  on public.variable_costs
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
          select 1 from public.profiles p
          where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager'
        )
      )
    )
    and exists (select 1 from public.stores s where s.id = store_id and s.company_id = company_id)
  );

create policy variable_costs_update_company_scoped
  on public.variable_costs
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
          select 1 from public.profiles p
          where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager'
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
          select 1 from public.profiles p
          where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager'
        )
      )
    )
    and exists (select 1 from public.stores s where s.id = store_id and s.company_id = company_id)
  );

create policy variable_costs_delete_company_scoped
  on public.variable_costs
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
          select 1 from public.profiles p
          where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager'
        )
      )
    )
  );

create or replace function public.set_variable_costs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists variable_costs_set_updated_at on public.variable_costs;
create trigger variable_costs_set_updated_at
  before update on public.variable_costs
  for each row execute function public.set_variable_costs_updated_at();
