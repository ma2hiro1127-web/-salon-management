create table if not exists public.monthly_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  target_month text not null,
  target_sales numeric not null default 0,
  target_technical_sales numeric not null default 0,
  target_retail_sales numeric not null default 0,
  target_customers integer not null default 0,
  target_average_spend numeric not null default 0,
  target_new_customers integer not null default 0,
  target_repeat_customers integer not null default 0,
  target_repeat_rate numeric not null default 0,
  target_average_customers_per_day numeric not null default 0,
  target_labor_rate numeric not null default 0,
  target_material_rate numeric not null default 0,
  target_ad_rate numeric not null default 0,
  target_operating_margin numeric not null default 0,
  business_day_mode text not null default '',
  business_day_count numeric not null default 0,
  holiday_count numeric not null default 0,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, store_id, target_month)
);

alter table public.monthly_targets enable row level security;

drop policy if exists monthly_targets_select_company_scoped on public.monthly_targets;
drop policy if exists monthly_targets_insert_company_scoped on public.monthly_targets;
drop policy if exists monthly_targets_update_company_scoped on public.monthly_targets;
drop policy if exists monthly_targets_delete_company_scoped on public.monthly_targets;

-- Mirrors monthly_closings' RLS shape: any assigned store (or company/system admin) can
-- read, but only store managers (or company/system admins) can write, since target-setting
-- is a management action, not a day-to-day staff one.
create policy monthly_targets_select_company_scoped
  on public.monthly_targets
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

create policy monthly_targets_insert_company_scoped
  on public.monthly_targets
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

create policy monthly_targets_update_company_scoped
  on public.monthly_targets
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

create policy monthly_targets_delete_company_scoped
  on public.monthly_targets
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

create or replace function public.set_monthly_targets_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists monthly_targets_set_updated_at on public.monthly_targets;
create trigger monthly_targets_set_updated_at
  before update on public.monthly_targets
  for each row execute function public.set_monthly_targets_updated_at();
