BEGIN;

-- 20260817010000でsystem_adminの業務データアクセスを撤廃したが、これは要件の誤解に基づく
-- 過剰な制限だった。正しい仕様: system_admin = 「通常機能すべて(売上・日次入力・月次
-- ダッシュボード・管理画面・店舗管理・ユーザー管理等)＋会社管理(全社横断)」であり、
-- 業務データを隠す専用画面に切り替えるものではない。20260817010000で行った2つの変更を
-- どちらも元に戻す:
--
-- 1) current_user_company_ids() / current_user_store_ids() から role <> 'system_admin' の
--    除外条件を削除し、20260805130000時点の定義に戻す。
-- 2) 15の業務テーブルのSELECT/INSERT/UPDATE/DELETEポリシーに current_user_is_system_admin()
--    分岐を復元する。company_admin/store_manager/staff分岐は一切変更しない。
--
-- 20260817000000(cost_monthly_amounts/store_inventory_balancesのEXISTS句トートロジー修正)
-- はこの取り消しの対象外 — company_id/store_idの整合性チェックとして独立に正しい修正であり、
-- system_adminの可否とは無関係(system_admin分岐はEXISTS句の外側でANDされているため、
-- 復元後もsystem_adminの書き込みには変わらずこの整合性チェックが適用される)。

create or replace function public.current_user_company_ids()
returns uuid[] language sql security definer set search_path = pg_catalog, public stable as $$
  select coalesce(
    array(
      select company_id
      from public.profiles
      where auth_user_id = auth.uid()
        and company_id is not null
        and is_active = true
    ),
    array[]::uuid[]
  );
$$;

create or replace function public.current_user_store_ids()
returns uuid[] language sql security definer set search_path = pg_catalog, public stable as $$
  select coalesce(
    array(
      select us.store_id
      from public.user_stores us
      join public.profiles p on p.id = us.user_id
      where p.auth_user_id = auth.uid()
        and p.is_active = true
    ),
    array[]::uuid[]
  );
$$;

-- ---------------------------------------------------------------------------
-- daily_sales
-- ---------------------------------------------------------------------------
drop policy if exists daily_sales_select_company_scoped on public.daily_sales;
create policy daily_sales_select_company_scoped
  on public.daily_sales
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

drop policy if exists daily_sales_insert_company_scoped on public.daily_sales;
create policy daily_sales_insert_company_scoped
  on public.daily_sales
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and created_by is not null
        and created_by = public.current_user_profile_id()
        and exists (
          select 1 from public.stores s
          where s.id = daily_sales.store_id and s.company_id = daily_sales.company_id and s.status = 'active'
        )
        and (
          exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
          or (
            exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'staff')
            and business_date = ((now() at time zone 'Asia/Tokyo'))::date
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
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'staff')
        and created_by is not null
        and created_by = public.current_user_profile_id()
        and is_day_closed = false
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'staff')
        and created_by is not null
        and created_by = public.current_user_profile_id()
      )
    )
    and exists (select 1 from public.stores s where s.id = daily_sales.store_id and s.company_id = daily_sales.company_id)
  );

drop policy if exists daily_sales_delete_company_scoped on public.daily_sales;
create policy daily_sales_delete_company_scoped
  on public.daily_sales
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'staff')
        and created_by is not null
        and created_by = public.current_user_profile_id()
        and is_day_closed = false
      )
    )
  );

-- ---------------------------------------------------------------------------
-- monthly_targets
-- ---------------------------------------------------------------------------
drop policy if exists monthly_targets_select_company_scoped on public.monthly_targets;
create policy monthly_targets_select_company_scoped
  on public.monthly_targets
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

drop policy if exists monthly_targets_insert_company_scoped on public.monthly_targets;
create policy monthly_targets_insert_company_scoped
  on public.monthly_targets
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = monthly_targets.store_id and s.company_id = monthly_targets.company_id and s.status = 'active')
  );

drop policy if exists monthly_targets_update_company_scoped on public.monthly_targets;
create policy monthly_targets_update_company_scoped
  on public.monthly_targets
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = monthly_targets.store_id and s.company_id = monthly_targets.company_id)
  );

drop policy if exists monthly_targets_delete_company_scoped on public.monthly_targets;
create policy monthly_targets_delete_company_scoped
  on public.monthly_targets
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- monthly_closings
-- ---------------------------------------------------------------------------
drop policy if exists monthly_closings_select_company_scoped on public.monthly_closings;
create policy monthly_closings_select_company_scoped
  on public.monthly_closings
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

drop policy if exists monthly_closings_insert_company_scoped on public.monthly_closings;
create policy monthly_closings_insert_company_scoped
  on public.monthly_closings
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = monthly_closings.store_id and s.company_id = monthly_closings.company_id)
  );

drop policy if exists monthly_closings_update_company_scoped on public.monthly_closings;
create policy monthly_closings_update_company_scoped
  on public.monthly_closings
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = monthly_closings.store_id and s.company_id = monthly_closings.company_id)
  );

drop policy if exists monthly_closings_delete_company_scoped on public.monthly_closings;
create policy monthly_closings_delete_company_scoped
  on public.monthly_closings
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- fixed_costs
-- ---------------------------------------------------------------------------
drop policy if exists fixed_costs_select_company_scoped on public.fixed_costs;
create policy fixed_costs_select_company_scoped
  on public.fixed_costs
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

drop policy if exists fixed_costs_insert_company_scoped on public.fixed_costs;
create policy fixed_costs_insert_company_scoped
  on public.fixed_costs
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = fixed_costs.store_id and s.company_id = fixed_costs.company_id and s.status = 'active')
  );

drop policy if exists fixed_costs_update_company_scoped on public.fixed_costs;
create policy fixed_costs_update_company_scoped
  on public.fixed_costs
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = fixed_costs.store_id and s.company_id = fixed_costs.company_id)
  );

drop policy if exists fixed_costs_delete_company_scoped on public.fixed_costs;
create policy fixed_costs_delete_company_scoped
  on public.fixed_costs
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- variable_costs
-- ---------------------------------------------------------------------------
drop policy if exists variable_costs_select_company_scoped on public.variable_costs;
create policy variable_costs_select_company_scoped
  on public.variable_costs
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

drop policy if exists variable_costs_insert_company_scoped on public.variable_costs;
create policy variable_costs_insert_company_scoped
  on public.variable_costs
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = variable_costs.store_id and s.company_id = variable_costs.company_id and s.status = 'active')
  );

drop policy if exists variable_costs_update_company_scoped on public.variable_costs;
create policy variable_costs_update_company_scoped
  on public.variable_costs
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = variable_costs.store_id and s.company_id = variable_costs.company_id)
  );

drop policy if exists variable_costs_delete_company_scoped on public.variable_costs;
create policy variable_costs_delete_company_scoped
  on public.variable_costs
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- cost_monthly_amounts (keep the qualified exists() checks from 20260817000000 — only restore
-- the system_admin branch)
-- ---------------------------------------------------------------------------
drop policy if exists cost_monthly_amounts_select_company_scoped on public.cost_monthly_amounts;
create policy cost_monthly_amounts_select_company_scoped
  on public.cost_monthly_amounts
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

drop policy if exists cost_monthly_amounts_insert_company_scoped on public.cost_monthly_amounts;
create policy cost_monthly_amounts_insert_company_scoped
  on public.cost_monthly_amounts
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = cost_monthly_amounts.store_id and s.company_id = cost_monthly_amounts.company_id)
    and exists (
      select 1 from public.fixed_costs fc
      where fc.id = cost_monthly_amounts.cost_item_id and fc.company_id = cost_monthly_amounts.company_id and fc.store_id = cost_monthly_amounts.store_id
    )
  );

drop policy if exists cost_monthly_amounts_update_company_scoped on public.cost_monthly_amounts;
create policy cost_monthly_amounts_update_company_scoped
  on public.cost_monthly_amounts
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = cost_monthly_amounts.store_id and s.company_id = cost_monthly_amounts.company_id)
  );

drop policy if exists cost_monthly_amounts_delete_company_scoped on public.cost_monthly_amounts;
create policy cost_monthly_amounts_delete_company_scoped
  on public.cost_monthly_amounts
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- monthly_closing_items
-- ---------------------------------------------------------------------------
drop policy if exists monthly_closing_items_select_company_scoped on public.monthly_closing_items;
create policy monthly_closing_items_select_company_scoped
  on public.monthly_closing_items
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

drop policy if exists monthly_closing_items_insert_company_scoped on public.monthly_closing_items;
create policy monthly_closing_items_insert_company_scoped
  on public.monthly_closing_items
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
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
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = monthly_closing_items.store_id and s.company_id = monthly_closing_items.company_id)
  );

drop policy if exists monthly_closing_items_delete_company_scoped on public.monthly_closing_items;
create policy monthly_closing_items_delete_company_scoped
  on public.monthly_closing_items
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- company_settings (no DELETE policy exists — intentional, unchanged)
-- ---------------------------------------------------------------------------
drop policy if exists company_settings_select_company_scoped on public.company_settings;
create policy company_settings_select_company_scoped
  on public.company_settings
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or exists (
        select 1 from public.stores s
        where s.company_id = company_settings.company_id and s.id in (select unnest(public.current_user_store_ids()))
      )
    )
  );

drop policy if exists company_settings_insert_company_scoped on public.company_settings;
create policy company_settings_insert_company_scoped
  on public.company_settings
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        exists (
          select 1 from public.stores s
          where s.company_id = company_settings.company_id and s.id in (select unnest(public.current_user_store_ids()))
        )
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  );

drop policy if exists company_settings_update_company_scoped on public.company_settings;
create policy company_settings_update_company_scoped
  on public.company_settings
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        exists (
          select 1 from public.stores s
          where s.company_id = company_settings.company_id and s.id in (select unnest(public.current_user_store_ids()))
        )
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        exists (
          select 1 from public.stores s
          where s.company_id = company_settings.company_id and s.id in (select unnest(public.current_user_store_ids()))
        )
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- store_profiles (no DELETE policy exists — intentional, unchanged)
-- ---------------------------------------------------------------------------
drop policy if exists store_profiles_select_company_scoped on public.store_profiles;
create policy store_profiles_select_company_scoped
  on public.store_profiles
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

drop policy if exists store_profiles_insert_company_scoped on public.store_profiles;
create policy store_profiles_insert_company_scoped
  on public.store_profiles
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
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
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = store_profiles.store_id and s.company_id = store_profiles.company_id)
  );

-- ---------------------------------------------------------------------------
-- store_input_settings
-- ---------------------------------------------------------------------------
drop policy if exists store_input_settings_select_company_scoped on public.store_input_settings;
create policy store_input_settings_select_company_scoped
  on public.store_input_settings
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

drop policy if exists store_input_settings_insert_company_scoped on public.store_input_settings;
create policy store_input_settings_insert_company_scoped
  on public.store_input_settings
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = store_input_settings.store_id and s.company_id = store_input_settings.company_id)
  );

drop policy if exists store_input_settings_update_company_scoped on public.store_input_settings;
create policy store_input_settings_update_company_scoped
  on public.store_input_settings
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = store_input_settings.store_id and s.company_id = store_input_settings.company_id)
  );

drop policy if exists store_input_settings_delete_company_scoped on public.store_input_settings;
create policy store_input_settings_delete_company_scoped
  on public.store_input_settings
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
    )
  );

-- ---------------------------------------------------------------------------
-- company_all_stores_targets (company-wide, no store-scope branch)
-- ---------------------------------------------------------------------------
drop policy if exists company_all_stores_targets_select on public.company_all_stores_targets;
create policy company_all_stores_targets_select
  on public.company_all_stores_targets
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
    )
  );

drop policy if exists company_all_stores_targets_insert on public.company_all_stores_targets;
create policy company_all_stores_targets_insert
  on public.company_all_stores_targets
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
    )
  );

drop policy if exists company_all_stores_targets_update on public.company_all_stores_targets;
create policy company_all_stores_targets_update
  on public.company_all_stores_targets
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
    )
  );

drop policy if exists company_all_stores_targets_delete on public.company_all_stores_targets;
create policy company_all_stores_targets_delete
  on public.company_all_stores_targets
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
    )
  );

-- ---------------------------------------------------------------------------
-- company_all_stores_holidays (company-wide, no store-scope branch)
-- ---------------------------------------------------------------------------
drop policy if exists company_all_stores_holidays_select on public.company_all_stores_holidays;
create policy company_all_stores_holidays_select
  on public.company_all_stores_holidays
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
    )
  );

drop policy if exists company_all_stores_holidays_insert on public.company_all_stores_holidays;
create policy company_all_stores_holidays_insert
  on public.company_all_stores_holidays
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
    )
  );

drop policy if exists company_all_stores_holidays_update on public.company_all_stores_holidays;
create policy company_all_stores_holidays_update
  on public.company_all_stores_holidays
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
    )
  );

drop policy if exists company_all_stores_holidays_delete on public.company_all_stores_holidays;
create policy company_all_stores_holidays_delete
  on public.company_all_stores_holidays
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
    )
  );

-- ---------------------------------------------------------------------------
-- store_business_holidays
-- ---------------------------------------------------------------------------
drop policy if exists store_business_holidays_select on public.store_business_holidays;
create policy store_business_holidays_select
  on public.store_business_holidays
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

drop policy if exists store_business_holidays_insert on public.store_business_holidays;
create policy store_business_holidays_insert
  on public.store_business_holidays
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
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
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = store_business_holidays.store_id and s.company_id = store_business_holidays.company_id)
  );

drop policy if exists store_business_holidays_delete on public.store_business_holidays;
create policy store_business_holidays_delete
  on public.store_business_holidays
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- store_inventory_balances (keep the qualified exists() checks from 20260817000000 — only
-- restore the system_admin branch)
-- ---------------------------------------------------------------------------
drop policy if exists store_inventory_balances_select_company_scoped on public.store_inventory_balances;
create policy store_inventory_balances_select_company_scoped
  on public.store_inventory_balances
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

drop policy if exists store_inventory_balances_insert_company_scoped on public.store_inventory_balances;
create policy store_inventory_balances_insert_company_scoped
  on public.store_inventory_balances
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = store_inventory_balances.store_id and s.company_id = store_inventory_balances.company_id)
  );

drop policy if exists store_inventory_balances_update_company_scoped on public.store_inventory_balances;
create policy store_inventory_balances_update_company_scoped
  on public.store_inventory_balances
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (select 1 from public.stores s where s.id = store_inventory_balances.store_id and s.company_id = store_inventory_balances.company_id)
  );

drop policy if exists store_inventory_balances_delete_company_scoped on public.store_inventory_balances;
create policy store_inventory_balances_delete_company_scoped
  on public.store_inventory_balances
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- tenant_snapshots (text-typed company_id/store_id — ::text cast pattern preserved)
-- ---------------------------------------------------------------------------
drop policy if exists tenant_snapshots_select_company_scoped on public.tenant_snapshots;
create policy tenant_snapshots_select_company_scoped
  on public.tenant_snapshots
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select id.id::text from unnest(public.current_user_company_ids()) id(id)))
      or (store_id is not null and store_id in (select id.id::text from unnest(public.current_user_store_ids()) id(id)))
    )
  );

drop policy if exists tenant_snapshots_insert_company_scoped on public.tenant_snapshots;
create policy tenant_snapshots_insert_company_scoped
  on public.tenant_snapshots
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select id.id::text from unnest(public.current_user_company_ids()) id(id))
        and (
          store_id is null
          or exists (select 1 from public.stores s where s.id::text = tenant_snapshots.store_id and s.company_id::text = tenant_snapshots.company_id)
        )
      )
      or (
        store_id is not null
        and store_id in (select id.id::text from unnest(public.current_user_store_ids()) id(id))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = any (array['store_manager', 'staff']))
        and exists (select 1 from public.stores s where s.id::text = tenant_snapshots.store_id and s.company_id::text = tenant_snapshots.company_id)
      )
    )
  );

drop policy if exists tenant_snapshots_update_company_scoped on public.tenant_snapshots;
create policy tenant_snapshots_update_company_scoped
  on public.tenant_snapshots
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select id.id::text from unnest(public.current_user_company_ids()) id(id)))
      or (store_id is not null and store_id in (select id.id::text from unnest(public.current_user_store_ids()) id(id)))
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select id.id::text from unnest(public.current_user_company_ids()) id(id))
        and (
          store_id is null
          or exists (select 1 from public.stores s where s.id::text = tenant_snapshots.store_id and s.company_id::text = tenant_snapshots.company_id)
        )
      )
      or (
        store_id is not null
        and store_id in (select id.id::text from unnest(public.current_user_store_ids()) id(id))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = any (array['store_manager', 'staff']))
        and exists (select 1 from public.stores s where s.id::text = tenant_snapshots.store_id and s.company_id::text = tenant_snapshots.company_id)
      )
    )
  );

drop policy if exists tenant_snapshots_delete_company_scoped on public.tenant_snapshots;
create policy tenant_snapshots_delete_company_scoped
  on public.tenant_snapshots
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select id.id::text from unnest(public.current_user_company_ids()) id(id)))
      or (store_id is not null and store_id in (select id.id::text from unnest(public.current_user_store_ids()) id(id)))
    )
  );

COMMIT;
