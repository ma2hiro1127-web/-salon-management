drop policy if exists tenant_snapshots_select_authenticated on public.tenant_snapshots;
drop policy if exists tenant_snapshots_manage_authenticated on public.tenant_snapshots;

create policy tenant_snapshots_select_authenticated
  on public.tenant_snapshots
  for select
  using (auth.uid() is not null);

create policy tenant_snapshots_manage_authenticated
  on public.tenant_snapshots
  for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
