BEGIN;

-- Fixes the end-to-end invite pipeline:
--  1. profiles gains invite_token/invite_expires_at so an invited user's row (created by the
--     inviting admin, auth_user_id still null) can be looked up *before* the invitee has an
--     authenticated session — the previous design relied on a purely client-local appState.users
--     lookup, which is always empty on a brand-new device/browser (RLS blocks anonymous profile
--     reads), so the invite link could never actually resolve for a genuine new invitee.
--  2. get_invite_info() lets the (anonymous) signup page validate a token — expired/invalid/
--     wrong-email — without needing a session.
--  3. profiles/user_stores insert policies gain a store_manager branch (invite staff only, only
--     into stores the store_manager themselves is assigned to) and company_admin gains the
--     ability to invite fellow company_admins (previously only staff/store_manager).
--  4. daily_sales gains: staff can no longer insert/update/delete a business_date other than
--     "today" (Asia/Tokyo), and can no longer update/delete a row once is_day_closed = true.
--     store_manager/company_admin/system_admin are unaffected (they can still fix past/closed
--     data, per spec).
-- All changes are additive (new columns nullable, new policy branches only widen who can act
-- within their own existing scope) — no existing row is touched or deleted.

alter table public.profiles
  add column if not exists invite_token text,
  add column if not exists invite_expires_at timestamptz;

drop index if exists profiles_invite_token_idx;
create unique index profiles_invite_token_idx on public.profiles (invite_token) where invite_token is not null;

-- Anonymous-callable: returns just enough to validate a link and prefill the signup form.
-- No company/role/store details — those are applied server-side by accept-invite once the
-- invitee actually claims the profile, so nothing sensitive is exposed pre-auth.
create or replace function public.get_invite_info(p_token text)
returns table(email text, name text, role text, invitation_status text, invite_expires_at timestamptz, is_active boolean)
language sql security definer set search_path = pg_catalog, public stable as $$
  select email, name, role, invitation_status, invite_expires_at, is_active
  from public.profiles
  where invite_token = p_token
  limit 1;
$$;
alter function public.get_invite_info(text) owner to postgres;
revoke all on function public.get_invite_info(text) from public;
grant execute on function public.get_invite_info(text) to anon, authenticated;

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
        and exists (
          select 1
          from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role = 'store_manager'
        )
      )
    )
  );

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
        -- store_manager may only hand out access to a store they themselves already have,
        -- and only to a profile being set up as staff — never to another manager/admin.
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (
          select 1
          from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role = 'store_manager'
        )
        and exists (
          select 1
          from public.profiles p
          where p.id = user_id
            and p.company_id = company_id
            and p.role = 'staff'
        )
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
        and exists (
          select 1
          from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role = 'store_manager'
        )
        and exists (
          select 1
          from public.profiles p
          where p.id = user_id
            and p.company_id = company_id
            and p.role = 'staff'
        )
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
        and exists (
          select 1
          from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role = 'store_manager'
        )
        and exists (
          select 1
          from public.profiles p
          where p.id = user_id
            and p.company_id = company_id
            and p.role = 'staff'
        )
      )
    )
  );

-- daily_sales: staff may only ever touch "today" (Asia/Tokyo) rows, and lose insert/update/
-- delete on a row entirely once it's day-closed. store_manager/company_admin/system_admin
-- keep unrestricted date range so they can fix past mistakes, per spec.
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
          where s.id = store_id
            and s.company_id = company_id
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
      where s.id = store_id
        and s.company_id = company_id
    )
  );

drop policy if exists daily_sales_delete_company_scoped on public.daily_sales;
create policy daily_sales_delete_company_scoped
  on public.daily_sales
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
  );

COMMIT;
