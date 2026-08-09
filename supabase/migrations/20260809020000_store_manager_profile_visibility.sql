BEGIN;

-- store_manager could insert a staff invite (profiles_insert_company_scoped already allowed it),
-- but createUserProfileRecord's .insert(...).select().single() failed every time with "new row
-- violates row-level security policy for table profiles" — confirmed live. The real cause isn't
-- the INSERT check (it passes) but the mandatory post-insert SELECT PostgREST performs to return
-- the created row: profiles_select_company_scoped only lets a store_manager see their OWN row
-- (auth_user_id = auth.uid()), never a staff member they just invited, so the follow-up SELECT
-- returns zero rows and Postgres/PostgREST surfaces it as an RLS violation. Same gap would also
-- have hidden invited staff from a store_manager's ユーザー管理 list entirely (the profiles
-- query there is subject to this same policy). Fixed by letting a store_manager see profiles of
-- staff assigned to a store they themselves manage — routed through user_stores (not a
-- self-referential profiles subquery) to avoid the infinite-recursion issue from
-- 20260809010000.

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
        and id in (
          select us.user_id
          from public.user_stores us
          where us.store_id in (select unnest(public.current_user_store_ids()))
        )
      )
    )
  );

COMMIT;
