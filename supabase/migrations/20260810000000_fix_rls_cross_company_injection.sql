BEGIN;

-- CRITICAL SECURITY FIX: several tables' insert/update RLS policies verify a row's declared
-- store_id actually belongs to its declared company_id via
--   exists (select 1 from public.stores s where s.id = store_id and s.company_id = company_id)
-- Inside this subquery, the bare `company_id` reference is NOT the outer row's column — Postgres
-- resolves unqualified identifiers from the innermost scope, and `stores s` itself has a
-- company_id column, so this silently becomes `s.company_id = s.company_id`: a tautology that
-- always passes. This exact bug class was already identified and fixed once for
-- tenant_snapshots (20260806030000) and once for daily_sales (20260806040000), but
-- 20260809000000_invite_flow_hardening.sql reintroduced it for daily_sales while rewriting those
-- policies for the staff-today-only rule, and it was never fixed for monthly_targets,
-- fixed_costs, variable_costs, monthly_closing_items, store_profiles, or
-- store_business_holidays (all created after the daily_sales fix, all copying the same broken
-- pattern), plus user_stores has the equivalent bug on both its company_admin and store_manager
-- branches, and monthly_closings never had this check at all.
--
-- Verified live and exploitable before this fix: a store_manager scoped to only their own store
-- could insert daily_sales/monthly_targets/fixed_costs/monthly_closings rows tagged with an
-- arbitrary OTHER company's company_id (fabricating data visible in that company's dashboard),
-- and could insert a user_stores row granting a real staff member of another company legitimate
-- read/write access to their own store's data. Fix: qualify every such check with the owning
-- table's name so it actually compares the row's own company_id, and add the same check where it
-- was missing entirely (monthly_closings, store_business_holidays update).
--
-- This migration only tightens future INSERT/UPDATE checks — it does not touch any existing
-- row, does not change SELECT policies (already correctly scoped), and does not affect any
-- legitimate same-company operation.

-- ---------------------------------------------------------------------------
-- daily_sales
-- ---------------------------------------------------------------------------
drop policy if exists daily_sales_insert_company_scoped on public.daily_sales;
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
        and (
          exists (
            select 1
            from public.profiles p
            where p.auth_user_id = auth.uid()
              and p.is_active = true
              and p.role = 'store_manager'
          )
          or (
            exists (
              select 1
              from public.profiles p
              where p.auth_user_id = auth.uid()
                and p.is_active = true
                and p.role = 'staff'
            )
            and business_date = (now() at time zone 'Asia/Tokyo')::date
          )
        )
      )
    )
  );

drop policy if exists daily_sales_update_company_scoped on public.daily_sales;
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
        and is_day_closed = false
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

-- ---------------------------------------------------------------------------
-- monthly_targets
-- ---------------------------------------------------------------------------
drop policy if exists monthly_targets_insert_company_scoped on public.monthly_targets;
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
      where s.id = monthly_targets.store_id
        and s.company_id = monthly_targets.company_id
    )
  );

drop policy if exists monthly_targets_update_company_scoped on public.monthly_targets;
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
      where s.id = monthly_targets.store_id
        and s.company_id = monthly_targets.company_id
    )
  );

-- ---------------------------------------------------------------------------
-- fixed_costs
-- ---------------------------------------------------------------------------
drop policy if exists fixed_costs_insert_company_scoped on public.fixed_costs;
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
      where s.id = fixed_costs.store_id
        and s.company_id = fixed_costs.company_id
    )
  );

drop policy if exists fixed_costs_update_company_scoped on public.fixed_costs;
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
      where s.id = fixed_costs.store_id
        and s.company_id = fixed_costs.company_id
    )
  );

-- ---------------------------------------------------------------------------
-- variable_costs
-- ---------------------------------------------------------------------------
drop policy if exists variable_costs_insert_company_scoped on public.variable_costs;
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
    and exists (select 1 from public.stores s where s.id = variable_costs.store_id and s.company_id = variable_costs.company_id)
  );

drop policy if exists variable_costs_update_company_scoped on public.variable_costs;
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
    and exists (select 1 from public.stores s where s.id = variable_costs.store_id and s.company_id = variable_costs.company_id)
  );

-- ---------------------------------------------------------------------------
-- monthly_closing_items
-- ---------------------------------------------------------------------------
drop policy if exists monthly_closing_items_insert_company_scoped on public.monthly_closing_items;
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
    and exists (select 1 from public.stores s where s.id = monthly_closing_items.store_id and s.company_id = monthly_closing_items.company_id)
  );

drop policy if exists monthly_closing_items_update_company_scoped on public.monthly_closing_items;
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
    and exists (select 1 from public.stores s where s.id = monthly_closing_items.store_id and s.company_id = monthly_closing_items.company_id)
  );

-- ---------------------------------------------------------------------------
-- store_profiles
-- ---------------------------------------------------------------------------
drop policy if exists store_profiles_insert_company_scoped on public.store_profiles;
create policy store_profiles_insert_company_scoped
  on public.store_profiles
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
    and exists (select 1 from public.stores s where s.id = store_profiles.store_id and s.company_id = store_profiles.company_id)
  );

drop policy if exists store_profiles_update_company_scoped on public.store_profiles;
create policy store_profiles_update_company_scoped
  on public.store_profiles
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
    and exists (select 1 from public.stores s where s.id = store_profiles.store_id and s.company_id = store_profiles.company_id)
  );

-- ---------------------------------------------------------------------------
-- store_business_holidays (insert already had the check, just unqualified; update never had
-- one at all)
-- ---------------------------------------------------------------------------
drop policy if exists store_business_holidays_insert on public.store_business_holidays;
create policy store_business_holidays_insert
  on public.store_business_holidays
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
    and exists (select 1 from public.stores s where s.id = store_business_holidays.store_id and s.company_id = store_business_holidays.company_id)
  );

drop policy if exists store_business_holidays_update on public.store_business_holidays;
create policy store_business_holidays_update
  on public.store_business_holidays
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
    and exists (select 1 from public.stores s where s.id = store_business_holidays.store_id and s.company_id = store_business_holidays.company_id)
  );

-- ---------------------------------------------------------------------------
-- monthly_closings — never had a store↔company binding check at all; adding one now,
-- matching the shape used by every sibling table above.
-- ---------------------------------------------------------------------------
drop policy if exists monthly_closings_insert_company_scoped on public.monthly_closings;
create policy monthly_closings_insert_company_scoped
  on public.monthly_closings
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
      where s.id = monthly_closings.store_id
        and s.company_id = monthly_closings.company_id
    )
  );

drop policy if exists monthly_closings_update_company_scoped on public.monthly_closings;
create policy monthly_closings_update_company_scoped
  on public.monthly_closings
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
      where s.id = monthly_closings.store_id
        and s.company_id = monthly_closings.company_id
    )
  );

-- ---------------------------------------------------------------------------
-- user_stores — both the company_admin branch (p.company_id = company_id /
-- s.company_id = company_id) and the store_manager branch (s.company_id = company_id) share
-- the same shadowing bug. This is the most severe instance: an unqualified check here lets a
-- store_manager grant a real staff member of a DIFFERENT company legitimate access to their own
-- store's data (verified live).
-- ---------------------------------------------------------------------------
drop policy if exists user_stores_insert_company_scoped on public.user_stores;
create policy user_stores_insert_company_scoped
  on public.user_stores
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
        and exists (
          select 1
          from public.profiles p
          where p.id = user_id
            and p.company_id = user_stores.company_id
        )
        and exists (
          select 1
          from public.stores s
          where s.id = store_id
            and s.company_id = user_stores.company_id
        )
      )
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and public.current_user_is_store_manager()
        and public.profile_is_staff_in_company(user_id, company_id)
        and exists (
          select 1
          from public.stores s
          where s.id = store_id
            and s.company_id = user_stores.company_id
        )
      )
    )
  );

drop policy if exists user_stores_update_company_scoped on public.user_stores;
create policy user_stores_update_company_scoped
  on public.user_stores
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
        and public.current_user_is_store_manager()
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
        and exists (
          select 1
          from public.profiles p
          where p.id = user_id
            and p.company_id = user_stores.company_id
        )
        and exists (
          select 1
          from public.stores s
          where s.id = store_id
            and s.company_id = user_stores.company_id
        )
      )
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and public.current_user_is_store_manager()
        and public.profile_is_staff_in_company(user_id, company_id)
        and exists (
          select 1
          from public.stores s
          where s.id = store_id
            and s.company_id = user_stores.company_id
        )
      )
    )
  );

COMMIT;
