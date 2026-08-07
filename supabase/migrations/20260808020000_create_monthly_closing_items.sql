-- 月締め項目 (the itemized costs entered during month-end closing, feeding the 損益表 P&L
-- calculation — distinct from monthly_closings, which only tracks the closed/locked *state*).
-- Same gap as fixed_costs/variable_costs before their fixes: local React state + tenant_snapshots
-- only, no dedicated table, direct month lookup (no carry-forward).
create table if not exists public.monthly_closing_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  target_month text not null,
  name text not null default '',
  amount numeric not null default 0,
  category text not null default '',
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists monthly_closing_items_company_id_idx on public.monthly_closing_items(company_id);
create index if not exists monthly_closing_items_store_id_idx on public.monthly_closing_items(store_id);
create index if not exists monthly_closing_items_target_month_idx on public.monthly_closing_items(target_month);

alter table public.monthly_closing_items enable row level security;

drop policy if exists monthly_closing_items_select_company_scoped on public.monthly_closing_items;
drop policy if exists monthly_closing_items_insert_company_scoped on public.monthly_closing_items;
drop policy if exists monthly_closing_items_update_company_scoped on public.monthly_closing_items;
drop policy if exists monthly_closing_items_delete_company_scoped on public.monthly_closing_items;

create policy monthly_closing_items_select_company_scoped
  on public.monthly_closing_items
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

create policy monthly_closing_items_insert_company_scoped
  on public.monthly_closing_items
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

create policy monthly_closing_items_update_company_scoped
  on public.monthly_closing_items
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

create policy monthly_closing_items_delete_company_scoped
  on public.monthly_closing_items
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

create or replace function public.set_monthly_closing_items_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists monthly_closing_items_set_updated_at on public.monthly_closing_items;
create trigger monthly_closing_items_set_updated_at
  before update on public.monthly_closing_items
  for each row execute function public.set_monthly_closing_items_updated_at();
