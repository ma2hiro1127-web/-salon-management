BEGIN;

-- 20260809000000_invite_flow_hardening.sql's store_manager branch on
-- profiles_insert_company_scoped queried `public.profiles` directly (a plain `exists (select 1
-- from public.profiles p where ...)`) from *inside a policy attached to profiles itself* —
-- unlike every other role check in this schema, which goes through a SECURITY DEFINER helper
-- (current_user_is_system_admin(), current_user_is_company_admin(), ...) specifically so the
-- internal lookup runs as the table owner and bypasses RLS instead of re-entering it. That raw
-- subquery made Postgres re-evaluate profiles' own RLS policies while already evaluating one of
-- profiles' own RLS policies, which Postgres reports as "infinite recursion detected in policy
-- for relation profiles" — confirmed live: it broke every invite created by a company_admin or
-- system_admin (any INSERT into profiles at all), not just store_manager's new staff-invite
-- path. Fixed by adding current_user_is_store_manager(), matching the existing safe pattern.

create or replace function public.current_user_is_store_manager()
returns boolean language sql security definer set search_path = pg_catalog, public stable as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and p.is_active = true
      and p.role = 'store_manager'
  );
$$;
alter function public.current_user_is_store_manager() owner to postgres;
revoke all on function public.current_user_is_store_manager() from public;
grant execute on function public.current_user_is_store_manager() to authenticated;

drop policy if exists profiles_insert_company_scoped on public.profiles;
create policy profiles_insert_company_scoped
  on public.profiles
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        auth_user_id = auth.uid()
        and role = 'staff'
        and company_id is null
      )
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
        and role in ('staff', 'store_manager', 'company_admin')
      )
      or (
        role = 'staff'
        and company_id in (select unnest(public.current_user_company_ids()))
        and public.current_user_is_store_manager()
      )
    )
  );

COMMIT;
