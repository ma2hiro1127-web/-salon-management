create table if not exists public.tenant_snapshots (
  id text primary key,
  company_id text,
  store_id text,
  target_month text,
  created_by text,
  updated_at timestamptz not null default now(),
  payload jsonb not null
);

alter table public.tenant_snapshots enable row level security;

drop policy if exists tenant_snapshots_select on public.tenant_snapshots;
drop policy if exists tenant_snapshots_manage on public.tenant_snapshots;

create policy tenant_snapshots_select on public.tenant_snapshots
  for select using (auth.uid() is not null);

create policy tenant_snapshots_manage on public.tenant_snapshots
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
