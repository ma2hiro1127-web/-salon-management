-- Root-cause fix for company/store-scoped RLS having been silently ineffective since it was
-- first introduced.
--
-- 20260804041926_init_schema.sql created wide-open policies named e.g. "daily_sales_select" /
-- "daily_sales_manage" (for select / for all, using only `auth.uid() is not null`).
-- 20260804130000_allow_authenticated_access.sql recreated the SAME names with the SAME
-- wide-open check. Every later migration that tightened RLS (20260805100000_tighten_rls.sql,
-- 20260805120000_role_based_rls_policies.sql, 20260805130000_company_scoped_rls.sql) only ever
-- dropped policies named "*_authenticated", "*_strict", or "*_company_scope(d)" — none of them
-- matched these original un-suffixed names, so they were never dropped and are still live today.
--
-- Postgres combines multiple PERMISSIVE policies for the same command with OR. That means every
-- company/store-scoped policy added since has been checked, but its result never mattered: the
-- wide-open "*_select"/"*_manage" policy alongside it already granted access to any authenticated
-- user for any row, in any company, in any store. Confirmed live: a store_manager assigned to
-- only one store could insert daily_sales rows for a completely different store in a different
-- company. This is the actual mechanism behind data that looked like it "belonged to the wrong
-- store" — RLS was never actually restricting access by company_id/store_id for these tables.
drop policy if exists companies_select on public.companies;
drop policy if exists companies_manage on public.companies;
drop policy if exists stores_select on public.stores;
drop policy if exists stores_manage on public.stores;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_manage on public.profiles;
drop policy if exists user_stores_select on public.user_stores;
drop policy if exists user_stores_manage on public.user_stores;
drop policy if exists daily_sales_select on public.daily_sales;
drop policy if exists daily_sales_manage on public.daily_sales;
drop policy if exists monthly_closings_select on public.monthly_closings;
drop policy if exists monthly_closings_manage on public.monthly_closings;
drop policy if exists tenant_snapshots_select on public.tenant_snapshots;
drop policy if exists tenant_snapshots_manage on public.tenant_snapshots;

-- Second bug, found while verifying the fix above: daily_sales_insert_company_scoped and
-- daily_sales_update_company_scoped's store-membership branch checks
-- `exists (select 1 from stores s where s.id = store_id and s.company_id = company_id)` —
-- but written as bare "company_id" inside a subquery that itself selects from `stores s`,
-- Postgres resolves the unqualified reference from the innermost scope, so it actually reads
-- as `s.company_id = s.company_id`: a tautology that always passes. It was meant to verify the
-- target store actually belongs to the row's own company_id (public.daily_sales.company_id).
-- Same class of bug as the tenant_snapshots fix in 20260806030000, just never applied here.
drop policy if exists daily_sales_insert_company_scoped on public.daily_sales;
drop policy if exists daily_sales_update_company_scoped on public.daily_sales;

create policy daily_sales_insert_company_scoped
  on public.daily_sales
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
        and created_by is not null
        and created_by = public.current_user_profile_id()
        and exists (
          select 1
          from public.stores s
          where s.id = daily_sales.store_id
            and s.company_id = daily_sales.company_id
        )
      )
    )
  );

create policy daily_sales_update_company_scoped
  on public.daily_sales
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
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (
          select 1
          from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role = 'staff'
        )
        and created_by is not null
        and created_by = public.current_user_profile_id()
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
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (
          select 1
          from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role = 'staff'
        )
        and created_by is not null
        and created_by = public.current_user_profile_id()
      )
    )
    and exists (
      select 1
      from public.stores s
      where s.id = daily_sales.store_id
        and s.company_id = daily_sales.company_id
    )
  );

-- Third, unrelated finding from the same audit: stores.code had a database-wide unique
-- constraint instead of being unique per company, so a second company could never create a
-- store with a code any other company already used (e.g. "main"). Scope it to (company_id, code).
alter table public.stores drop constraint if exists stores_code_key;
alter table public.stores add constraint stores_company_id_code_key unique (company_id, code);
