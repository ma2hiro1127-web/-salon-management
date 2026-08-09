BEGIN;

-- 20260809020000's store_manager branch on profiles_select_company_scoped queried
-- public.user_stores directly. That's fine on its own, but user_stores_insert_company_scoped
-- (and its update/delete siblings) already query public.profiles directly for their own
-- company_admin/store_manager branches — together those form a cross-table cycle: inserting
-- into user_stores needs profiles' policy, which now needs user_stores' policy, which Postgres's
-- RLS planner flags before execution regardless of whether it would actually terminate,
-- surfacing as a request failure (seen live as a 500 while a store_manager's staff invite tried
-- to insert the new staff's store assignment — the profile itself was created fine, only the
-- store link failed). Same class of bug as 20260809010000, one join hop further out. Fixed the
-- same way: route the profiles-side check through a SECURITY DEFINER function so it bypasses
-- RLS entirely for its internal user_stores lookup instead of re-entering it.

create or replace function public.current_user_managed_staff_ids()
returns uuid[] language sql security definer set search_path = pg_catalog, public stable as $$
  select coalesce(
    array(
      select distinct us.user_id
      from public.user_stores us
      where us.store_id = any(public.current_user_store_ids())
    ),
    array[]::uuid[]
  );
$$;
alter function public.current_user_managed_staff_ids() owner to postgres;
revoke all on function public.current_user_managed_staff_ids() from public;
grant execute on function public.current_user_managed_staff_ids() to authenticated;

drop policy if exists profiles_select_company_scoped on public.profiles;
create policy profiles_select_company_scoped
  on public.profiles
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or auth_user_id = auth.uid()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or (
        public.current_user_is_store_manager()
        and role = 'staff'
        and id = any(public.current_user_managed_staff_ids())
      )
    )
  );

COMMIT;
