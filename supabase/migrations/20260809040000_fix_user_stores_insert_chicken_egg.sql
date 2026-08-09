BEGIN;

-- user_stores_insert_company_scoped's store_manager branch (and its update sibling) verify the
-- target profile is a same-company staff member via a raw `exists (select 1 from public.profiles
-- p where p.id = user_id and ...)` subquery. That subquery is itself subject to
-- profiles_select_company_scoped, whose store_manager branch (20260809020000/030000) only grants
-- visibility into a staff profile that ALREADY has a user_stores row pointing at one of the
-- store_manager's stores — but that's exactly the row this INSERT is trying to create. A
-- brand-new invited staff member has no user_stores row yet, so the exists-check can never see
-- them, so the very first store assignment for a newly invited staff member was always rejected
-- (confirmed live: the profile was created fine, only the store link failed). Fixed by moving
-- the staff/company check into a SECURITY DEFINER function, which bypasses RLS for its internal
-- lookup instead of depending on the caller's own SELECT visibility — same fix shape as
-- 20260809010000/030000, applied one level deeper.

create or replace function public.profile_is_staff_in_company(p_profile_id uuid, p_company_id uuid)
returns boolean language sql security definer set search_path = pg_catalog, public stable as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and p.company_id = p_company_id
      and p.role = 'staff'
  );
$$;
alter function public.profile_is_staff_in_company(uuid, uuid) owner to postgres;
revoke all on function public.profile_is_staff_in_company(uuid, uuid) from public;
grant execute on function public.profile_is_staff_in_company(uuid, uuid) to authenticated;

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
            and p.company_id = company_id
        )
        and exists (
          select 1
          from public.stores s
          where s.id = store_id
            and s.company_id = company_id
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
            and s.company_id = company_id
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
            and p.company_id = company_id
        )
        and exists (
          select 1
          from public.stores s
          where s.id = store_id
            and s.company_id = company_id
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
            and s.company_id = company_id
        )
      )
    )
  );

drop policy if exists user_stores_delete_company_scoped on public.user_stores;
create policy user_stores_delete_company_scoped
  on public.user_stores
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
        and public.current_user_is_store_manager()
        and public.profile_is_staff_in_company(user_id, company_id)
      )
    )
  );

COMMIT;
