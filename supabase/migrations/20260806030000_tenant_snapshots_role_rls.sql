-- Restores store_manager/staff row-level granularity for tenant_snapshots that
-- 20260805130000_company_scoped_rls.sql had to ship without (temporarily simplified to
-- company-scope-only there — see its comment).
--
-- Root cause of the original failure: `where s.id::text = store_id and s.company_id::text =
-- company_id` inside `exists (select 1 from public.stores s where ...)` — the bare
-- `company_id` on the right-hand side is NOT the outer tenant_snapshots.company_id; Postgres
-- resolves unqualified columns from the innermost scope outward, and `stores s` itself
-- exposes a `company_id` column, so it silently shadowed the intended outer reference. The
-- comparison became `s.company_id::text = s.company_id` (text = uuid) — exactly the
-- "operator does not exist: text = uuid" error. Fully qualifying the outer reference as
-- `public.tenant_snapshots.company_id` fixes it.
drop policy if exists tenant_snapshots_select_company_scoped on public.tenant_snapshots;
drop policy if exists tenant_snapshots_insert_company_scoped on public.tenant_snapshots;
drop policy if exists tenant_snapshots_update_company_scoped on public.tenant_snapshots;
drop policy if exists tenant_snapshots_delete_company_scoped on public.tenant_snapshots;

create policy tenant_snapshots_select_company_scoped
  on public.tenant_snapshots
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and public.tenant_snapshots.company_id in (select id::text from unnest(public.current_user_company_ids()) as id)
      )
      or (
        public.tenant_snapshots.store_id is not null
        and public.tenant_snapshots.store_id in (select id::text from unnest(public.current_user_store_ids()) as id)
      )
    )
  );

create policy tenant_snapshots_insert_company_scoped
  on public.tenant_snapshots
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and public.tenant_snapshots.company_id in (select id::text from unnest(public.current_user_company_ids()) as id)
        and (
          public.tenant_snapshots.store_id is null
          or exists (
            select 1
            from public.stores s
            where s.id::text = public.tenant_snapshots.store_id
              and s.company_id::text = public.tenant_snapshots.company_id
          )
        )
      )
      or (
        public.tenant_snapshots.store_id is not null
        and public.tenant_snapshots.store_id in (select id::text from unnest(public.current_user_store_ids()) as id)
        and exists (
          select 1
          from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role in ('store_manager', 'staff')
        )
        and exists (
          select 1
          from public.stores s
          where s.id::text = public.tenant_snapshots.store_id
            and s.company_id::text = public.tenant_snapshots.company_id
        )
      )
    )
  );

create policy tenant_snapshots_update_company_scoped
  on public.tenant_snapshots
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and public.tenant_snapshots.company_id in (select id::text from unnest(public.current_user_company_ids()) as id)
      )
      or (
        public.tenant_snapshots.store_id is not null
        and public.tenant_snapshots.store_id in (select id::text from unnest(public.current_user_store_ids()) as id)
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and public.tenant_snapshots.company_id in (select id::text from unnest(public.current_user_company_ids()) as id)
        and (
          public.tenant_snapshots.store_id is null
          or exists (
            select 1
            from public.stores s
            where s.id::text = public.tenant_snapshots.store_id
              and s.company_id::text = public.tenant_snapshots.company_id
          )
        )
      )
      or (
        public.tenant_snapshots.store_id is not null
        and public.tenant_snapshots.store_id in (select id::text from unnest(public.current_user_store_ids()) as id)
        and exists (
          select 1
          from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role in ('store_manager', 'staff')
        )
        and exists (
          select 1
          from public.stores s
          where s.id::text = public.tenant_snapshots.store_id
            and s.company_id::text = public.tenant_snapshots.company_id
        )
      )
    )
  );

create policy tenant_snapshots_delete_company_scoped
  on public.tenant_snapshots
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and public.tenant_snapshots.company_id in (select id::text from unnest(public.current_user_company_ids()) as id)
      )
      or (
        public.tenant_snapshots.store_id is not null
        and public.tenant_snapshots.store_id in (select id::text from unnest(public.current_user_store_ids()) as id)
      )
    )
  );
