BEGIN;

-- 権限体系の正式仕様の是正: staffの日次入力は「今日の分のみ入力可能」という要件が、
-- daily_sales/daily_cash_breakdownのINSERTポリシーには既に反映されていた
-- (business_date = 今日 の条件あり)一方、UPDATE/DELETEポリシーには同じ条件が
-- 付いていなかった。そのため、staffが今日作成した行は、翌日以降(その日が「過去日」に
-- なった後)でも日締め前であれば編集・削除できてしまう抜け道が残っていた
-- (created_by=本人 かつ is_day_closed=false のみで、日付の制約が無かったため)。
-- INSERTと全く同じ条件(business_date = 今日、Asia/Tokyo基準)をUPDATE/DELETEにも追加し、
-- 「今日以外は編集・削除できない」を実際に強制する。store_manager以上のブランチは
-- 元々日付制限が無く、意図通りなので変更しない。

drop policy if exists daily_sales_update_company_scoped on public.daily_sales;
create policy daily_sales_update_company_scoped
  on public.daily_sales
  for update to authenticated
  using (
    auth.uid() is not null and (
      current_user_is_system_admin()
      or (current_user_is_company_admin() and (company_id in (select unnest(current_user_company_ids()))))
      or (
        (store_id in (select unnest(current_user_store_ids())))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
      or (
        (store_id in (select unnest(current_user_store_ids())))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'staff')
        and created_by is not null
        and created_by = current_user_profile_id()
        and is_day_closed = false
        and business_date = ((now() at time zone 'Asia/Tokyo'))::date
      )
    )
  )
  with check (
    auth.uid() is not null and (
      current_user_is_system_admin()
      or (current_user_is_company_admin() and (company_id in (select unnest(current_user_company_ids()))))
      or (
        (store_id in (select unnest(current_user_store_ids())))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
      or (
        (store_id in (select unnest(current_user_store_ids())))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'staff')
        and created_by is not null
        and created_by = current_user_profile_id()
        and business_date = ((now() at time zone 'Asia/Tokyo'))::date
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
      current_user_is_system_admin()
      or (current_user_is_company_admin() and (company_id in (select unnest(current_user_company_ids()))))
      or (
        (store_id in (select unnest(current_user_store_ids())))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
      or (
        (store_id in (select unnest(current_user_store_ids())))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'staff')
        and created_by is not null
        and created_by = current_user_profile_id()
        and is_day_closed = false
        and business_date = ((now() at time zone 'Asia/Tokyo'))::date
      )
    )
  );

drop policy if exists daily_cash_breakdown_update_company_scoped on public.daily_cash_breakdown;
create policy daily_cash_breakdown_update_company_scoped
  on public.daily_cash_breakdown
  for update to authenticated
  using (
    auth.uid() is not null and (
      current_user_is_system_admin()
      or (current_user_is_company_admin() and (company_id in (select unnest(current_user_company_ids()))))
      or (
        (store_id in (select unnest(current_user_store_ids())))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
      or (
        (store_id in (select unnest(current_user_store_ids())))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'staff')
        and created_by is not null
        and created_by = current_user_profile_id()
        and business_date = ((now() at time zone 'Asia/Tokyo'))::date
      )
    )
  )
  with check (
    auth.uid() is not null and (
      current_user_is_system_admin()
      or (current_user_is_company_admin() and (company_id in (select unnest(current_user_company_ids()))))
      or (
        (store_id in (select unnest(current_user_store_ids())))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
      or (
        (store_id in (select unnest(current_user_store_ids())))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'staff')
        and created_by is not null
        and created_by = current_user_profile_id()
        and business_date = ((now() at time zone 'Asia/Tokyo'))::date
      )
    )
    and exists (select 1 from public.stores s where s.id = daily_cash_breakdown.store_id and s.company_id = daily_cash_breakdown.company_id)
  );

drop policy if exists daily_cash_breakdown_delete_company_scoped on public.daily_cash_breakdown;
create policy daily_cash_breakdown_delete_company_scoped
  on public.daily_cash_breakdown
  for delete to authenticated
  using (
    auth.uid() is not null and (
      current_user_is_system_admin()
      or (current_user_is_company_admin() and (company_id in (select unnest(current_user_company_ids()))))
      or (
        (store_id in (select unnest(current_user_store_ids())))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
      or (
        (store_id in (select unnest(current_user_store_ids())))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'staff')
        and created_by is not null
        and created_by = current_user_profile_id()
        and business_date = ((now() at time zone 'Asia/Tokyo'))::date
      )
    )
  );

COMMIT;
