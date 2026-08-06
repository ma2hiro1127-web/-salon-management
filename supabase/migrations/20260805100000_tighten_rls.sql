create or replace function public.current_user_company_ids()
returns uuid[] language sql stable as $$
  select coalesce(
    array(
      select company_id
      from public.profiles
      where auth_user_id = auth.uid()
        and company_id is not null
    ),
    array[]::uuid[]
  );
$$;

create or replace function public.current_user_store_ids()
returns uuid[] language sql stable as $$
  select coalesce(
    array(
      select store_id
      from public.user_stores
      where user_id in (
        select id from public.profiles where auth_user_id = auth.uid()
      )
    ),
    array[]::uuid[]
  );
$$;

create policy companies_select_strict on public.companies
  for select using (
    auth.uid() is not null and id in (select unnest(public.current_user_company_ids()))
  );

create policy companies_manage_strict on public.companies
  for all using (
    auth.uid() is not null and id in (select unnest(public.current_user_company_ids()))
  ) with check (
    auth.uid() is not null and id in (select unnest(public.current_user_company_ids()))
  );

create policy stores_select_strict on public.stores
  for select using (
    auth.uid() is not null and company_id in (select unnest(public.current_user_company_ids()))
  );

create policy stores_manage_strict on public.stores
  for all using (
    auth.uid() is not null and company_id in (select unnest(public.current_user_company_ids()))
  ) with check (
    auth.uid() is not null and company_id in (select unnest(public.current_user_company_ids()))
  );

create policy profiles_select_strict on public.profiles
  for select using (
    auth.uid() is not null and (
      auth_user_id = auth.uid() or company_id in (select unnest(public.current_user_company_ids()))
    )
  );

create policy profiles_manage_strict on public.profiles
  for all using (
    auth.uid() is not null and (
      auth_user_id = auth.uid() or company_id in (select unnest(public.current_user_company_ids()))
    )
  ) with check (
    auth.uid() is not null and (
      auth_user_id = auth.uid() or company_id in (select unnest(public.current_user_company_ids()))
    )
  );

create policy user_stores_select_strict on public.user_stores
  for select using (
    auth.uid() is not null and company_id in (select unnest(public.current_user_company_ids()))
  );

create policy user_stores_manage_strict on public.user_stores
  for all using (
    auth.uid() is not null and company_id in (select unnest(public.current_user_company_ids()))
  ) with check (
    auth.uid() is not null and company_id in (select unnest(public.current_user_company_ids()))
  );

create policy daily_sales_select_strict on public.daily_sales
  for select using (
    auth.uid() is not null and company_id in (select unnest(public.current_user_company_ids()))
  );

create policy daily_sales_manage_strict on public.daily_sales
  for all using (
    auth.uid() is not null and company_id in (select unnest(public.current_user_company_ids()))
  ) with check (
    auth.uid() is not null and company_id in (select unnest(public.current_user_company_ids()))
  );

create policy monthly_closings_select_strict on public.monthly_closings
  for select using (
    auth.uid() is not null and company_id in (select unnest(public.current_user_company_ids()))
  );

create policy monthly_closings_manage_strict on public.monthly_closings
  for all using (
    auth.uid() is not null and company_id in (select unnest(public.current_user_company_ids()))
  ) with check (
    auth.uid() is not null and company_id in (select unnest(public.current_user_company_ids()))
  );

-- tenant_snapshots.company_id is text (not uuid, unlike every other table here) so it can
-- hold the "company"/"store" placeholder ids buildSnapshotId() falls back to locally; cast
-- current_user_company_ids()'s uuid[] to text[] before unnesting so the comparison type-checks.
create policy tenant_snapshots_select_strict on public.tenant_snapshots
  for select using (
    auth.uid() is not null and (
      company_id in (select unnest(public.current_user_company_ids()::text[]))
    )
  );

create policy tenant_snapshots_manage_strict on public.tenant_snapshots
  for all using (
    auth.uid() is not null and (
      company_id in (select unnest(public.current_user_company_ids()::text[]))
    )
  ) with check (
    auth.uid() is not null and (
      company_id in (select unnest(public.current_user_company_ids()::text[]))
    )
  );
