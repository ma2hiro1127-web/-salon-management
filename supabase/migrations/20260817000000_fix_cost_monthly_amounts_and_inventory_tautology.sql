BEGIN;

-- CRITICAL SECURITY FIX: the same tautology bug already fixed once in
-- 20260810000000_fix_rls_cross_company_injection.sql for 8 other tables has reappeared in
-- cost_monthly_amounts (20260810010000) and store_inventory_balances (20260810020000) — both
-- created AFTER that fix, both copying the exact broken pattern:
--   exists (select 1 from public.stores s where s.id = store_id and s.company_id = company_id)
-- Inside this subquery, the bare `company_id`/`store_id` references resolve to the innermost
-- scope (`stores s`, which itself has a company_id column), not the outer row — silently
-- becoming `s.company_id = s.company_id`: always true. cost_monthly_amounts' second exists()
-- against fixed_costs has the identical problem on all three of its comparisons
-- (fc.company_id = fc.company_id, fc.store_id = fc.store_id).
--
-- Verified live and exploitable before this fix: both tables' store_manager insert/update
-- branches place no independent constraint on company_id, relying entirely on these now-
-- tautological exists() checks to verify company_id actually matches store_id's real owning
-- company. A store_manager scoped to only their own store could insert/update a
-- cost_monthly_amounts or store_inventory_balances row tagged with an arbitrary OTHER
-- company's company_id, fabricating cost/inventory data that then surfaces under that other
-- company's company_id-scoped SELECT policy.
--
-- Fix: qualify every reference with the owning table's name, matching the pattern already used
-- correctly by fixed_costs/variable_costs/monthly_closing_items/store_input_settings/
-- store_profiles/store_business_holidays. Only INSERT/UPDATE with_check change; SELECT/DELETE
-- never had this cross-table check and are unaffected. This migration does not touch any
-- existing row, only tightens future writes.

-- ---------------------------------------------------------------------------
-- cost_monthly_amounts
-- ---------------------------------------------------------------------------
drop policy if exists cost_monthly_amounts_insert_company_scoped on public.cost_monthly_amounts;
create policy cost_monthly_amounts_insert_company_scoped
  on public.cost_monthly_amounts
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
      where s.id = cost_monthly_amounts.store_id
        and s.company_id = cost_monthly_amounts.company_id
    )
    and exists (
      select 1
      from public.fixed_costs fc
      where fc.id = cost_monthly_amounts.cost_item_id
        and fc.company_id = cost_monthly_amounts.company_id
        and fc.store_id = cost_monthly_amounts.store_id
    )
  );

drop policy if exists cost_monthly_amounts_update_company_scoped on public.cost_monthly_amounts;
create policy cost_monthly_amounts_update_company_scoped
  on public.cost_monthly_amounts
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
      where s.id = cost_monthly_amounts.store_id
        and s.company_id = cost_monthly_amounts.company_id
    )
  );

-- ---------------------------------------------------------------------------
-- store_inventory_balances
-- ---------------------------------------------------------------------------
drop policy if exists store_inventory_balances_insert_company_scoped on public.store_inventory_balances;
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
      where s.id = store_inventory_balances.store_id
        and s.company_id = store_inventory_balances.company_id
    )
  );

drop policy if exists store_inventory_balances_update_company_scoped on public.store_inventory_balances;
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
      where s.id = store_inventory_balances.store_id
        and s.company_id = store_inventory_balances.company_id
    )
  );

COMMIT;
