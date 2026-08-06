-- Paste this entire script into Supabase Dashboard -> SQL Editor and run it.
-- Purpose: enable RLS and grant authenticated users access to the salon-management tables.
-- This is the full migration script for the app's Supabase persistence flow.

create extension if not exists pgcrypto;

alter table public.tenant_snapshots enable row level security;
alter table public.companies enable row level security;
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.user_stores enable row level security;
alter table public.daily_sales enable row level security;
alter table public.monthly_closings enable row level security;

-- tenant_snapshots policies
 drop policy if exists tenant_snapshots_select_authenticated on public.tenant_snapshots;
 drop policy if exists tenant_snapshots_manage_authenticated on public.tenant_snapshots;
 drop policy if exists tenant_snapshots_select_company_scope on public.tenant_snapshots;
 drop policy if exists tenant_snapshots_manage_company_scope on public.tenant_snapshots;
 drop policy if exists tenant_snapshots_update_company_scope on public.tenant_snapshots;
 drop policy if exists tenant_snapshots_delete_company_scope on public.tenant_snapshots;

create policy tenant_snapshots_select_company_scope
  on public.tenant_snapshots
  for select
  using (
    auth.uid() is not null
    and (
      company_id is null
      or company_id in (
        select company_id
        from public.profiles
        where auth_user_id = auth.uid()
          and is_active = true
      )
    )
  );

create policy tenant_snapshots_manage_company_scope
  on public.tenant_snapshots
  for insert
  with check (
    auth.uid() is not null
    and (
      company_id is null
      or company_id in (
        select company_id
        from public.profiles
        where auth_user_id = auth.uid()
          and is_active = true
      )
    )
  );

create policy tenant_snapshots_update_company_scope
  on public.tenant_snapshots
  for update
  using (
    auth.uid() is not null
    and (
      company_id is null
      or company_id in (
        select company_id
        from public.profiles
        where auth_user_id = auth.uid()
          and is_active = true
      )
    )
  )
  with check (
    auth.uid() is not null
    and (
      company_id is null
      or company_id in (
        select company_id
        from public.profiles
        where auth_user_id = auth.uid()
          and is_active = true
      )
    )
  );

create policy tenant_snapshots_delete_company_scope
  on public.tenant_snapshots
  for delete
  using (
    auth.uid() is not null
    and (
      company_id is null
      or company_id in (
        select company_id
        from public.profiles
        where auth_user_id = auth.uid()
          and is_active = true
      )
    )
  );

-- companies / stores / profiles / user_stores / daily_sales / monthly_closings policies
 drop policy if exists companies_select_authenticated on public.companies;
 drop policy if exists companies_manage_authenticated on public.companies;
 create policy companies_select_authenticated on public.companies
   for select using (auth.uid() is not null);
 create policy companies_manage_authenticated on public.companies
   for all using (auth.uid() is not null) with check (auth.uid() is not null);

 drop policy if exists stores_select_authenticated on public.stores;
 drop policy if exists stores_manage_authenticated on public.stores;
 create policy stores_select_authenticated on public.stores
   for select using (auth.uid() is not null);
 create policy stores_manage_authenticated on public.stores
   for all using (auth.uid() is not null) with check (auth.uid() is not null);

 drop policy if exists profiles_select_authenticated on public.profiles;
 drop policy if exists profiles_manage_authenticated on public.profiles;
 create policy profiles_select_authenticated on public.profiles
   for select using (auth.uid() is not null);
 create policy profiles_manage_authenticated on public.profiles
   for all using (auth.uid() is not null) with check (auth.uid() is not null);

 drop policy if exists user_stores_select_authenticated on public.user_stores;
 drop policy if exists user_stores_manage_authenticated on public.user_stores;
 create policy user_stores_select_authenticated on public.user_stores
   for select using (auth.uid() is not null);
 create policy user_stores_manage_authenticated on public.user_stores
   for all using (auth.uid() is not null) with check (auth.uid() is not null);

 drop policy if exists daily_sales_select_authenticated on public.daily_sales;
 drop policy if exists daily_sales_manage_authenticated on public.daily_sales;
 create policy daily_sales_select_authenticated on public.daily_sales
   for select using (auth.uid() is not null);
 create policy daily_sales_manage_authenticated on public.daily_sales
   for all using (auth.uid() is not null) with check (auth.uid() is not null);

 drop policy if exists monthly_closings_select_authenticated on public.monthly_closings;
 drop policy if exists monthly_closings_manage_authenticated on public.monthly_closings;
 create policy monthly_closings_select_authenticated on public.monthly_closings
   for select using (auth.uid() is not null);
 create policy monthly_closings_manage_authenticated on public.monthly_closings
   for all using (auth.uid() is not null) with check (auth.uid() is not null);
