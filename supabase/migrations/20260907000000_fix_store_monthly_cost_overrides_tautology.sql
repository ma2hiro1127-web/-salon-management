BEGIN;

-- CRITICAL SECURITY FIX: the same tautology bug already fixed twice before
-- (20260810000000_fix_rls_cross_company_injection.sql for 8 tables,
-- 20260817000000_fix_cost_monthly_amounts_and_inventory_tautology.sql for 2 more) has
-- reappeared in store_monthly_cost_overrides (created later, 20260904000000), copying the
-- exact broken pattern:
--   exists (select 1 from public.stores s where s.id = store_id and s.company_id = company_id)
-- Inside this subquery, the bare `store_id`/`company_id` references resolve to the innermost
-- scope (`stores s`, which itself has both columns), not the row being written — silently
-- becoming `s.company_id = s.company_id`: always true.
--
-- Verified live and exploitable before this fix (2026-09-02 pre-launch audit): a store_manager
-- scoped to only their own store has no independent constraint on company_id in the
-- insert/update branches, relying entirely on this now-tautological exists() check. Confirmed
-- by actually inserting a store_monthly_cost_overrides row for company A's own store while
-- tagging it with company B's company_id, from a company-A store_manager account — the row was
-- accepted and immediately visible under company B's company_id-scoped SELECT policy. Test row
-- deleted immediately after confirming; no other data was touched.
--
-- Fix: qualify every reference with the owning table's name, matching the pattern already used
-- correctly by fixed_costs/variable_costs/monthly_closing_items/cost_monthly_amounts/
-- store_inventory_balances/store_input_settings/store_profiles/store_business_holidays. Only
-- INSERT/UPDATE with_check change; SELECT/DELETE never had this cross-table check (DELETE only
-- constrains store_id on the existing row, which cannot reference another company's real data
-- since a store_manager's current_user_store_ids() only ever contains their own company's
-- stores) and are unaffected. This migration does not touch any existing row, only tightens
-- future writes — strictly more restrictive, so no legitimate existing write pattern is broken.

drop policy if exists store_monthly_cost_overrides_insert_company_scoped on public.store_monthly_cost_overrides;
create policy store_monthly_cost_overrides_insert_company_scoped
  on public.store_monthly_cost_overrides
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
      where s.id = store_monthly_cost_overrides.store_id
        and s.company_id = store_monthly_cost_overrides.company_id
    )
  );

drop policy if exists store_monthly_cost_overrides_update_company_scoped on public.store_monthly_cost_overrides;
create policy store_monthly_cost_overrides_update_company_scoped
  on public.store_monthly_cost_overrides
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
      where s.id = store_monthly_cost_overrides.store_id
        and s.company_id = store_monthly_cost_overrides.company_id
    )
  );

COMMIT;
