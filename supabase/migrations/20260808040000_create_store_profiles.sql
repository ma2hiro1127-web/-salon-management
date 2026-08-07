-- 店舗プロフィール (address/phone/manager/representative/hours/description/URLs/etc) had NO
-- dedicated columns — stores only ever had id/company_id/name/code/is_active. Every save from
-- the 店舗プロフィール form only mutated local React state; hydrateFromSupabase's store-rebuild
-- always re-seeds these fields from blank/hardcoded defaults on every fetch, so profile edits
-- were silently discarded on the next refresh/login/device/store-switch. One row per store,
-- keyed by store_id (never store name) so a rename can never orphan a profile.
create table if not exists public.store_profiles (
  store_id uuid primary key references public.stores(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  postal_code text not null default '',
  address text not null default '',
  phone text not null default '',
  manager_name text not null default '',
  representative_name text not null default '',
  opening_date text not null default '',
  opening_hour text not null default '09:00',
  closing_hour text not null default '20:00',
  closed_days text not null default '',
  business_hours text not null default '',
  description text not null default '',
  website text not null default '',
  instagram text not null default '',
  google_map_url text not null default '',
  service_types jsonb not null default '[]'::jsonb,
  urls jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_profiles_company_id_idx on public.store_profiles(company_id);

alter table public.store_profiles enable row level security;

drop policy if exists store_profiles_select_company_scoped on public.store_profiles;
drop policy if exists store_profiles_insert_company_scoped on public.store_profiles;
drop policy if exists store_profiles_update_company_scoped on public.store_profiles;

create policy store_profiles_select_company_scoped
  on public.store_profiles
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

-- Store name editing is broader than full store management (see canEditStoreName in
-- permissions.js) — a store_manager can edit their own store's profile, same as its name.
create policy store_profiles_insert_company_scoped
  on public.store_profiles
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
        and exists (
          select 1 from public.profiles p
          where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager'
        )
      )
    )
    and exists (select 1 from public.stores s where s.id = store_id and s.company_id = company_id)
  );

create policy store_profiles_update_company_scoped
  on public.store_profiles
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
          select 1 from public.profiles p
          where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager'
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
      )
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (
          select 1 from public.profiles p
          where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager'
        )
      )
    )
    and exists (select 1 from public.stores s where s.id = store_id and s.company_id = company_id)
  );

create or replace function public.set_store_profiles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists store_profiles_set_updated_at on public.store_profiles;
create trigger store_profiles_set_updated_at
  before update on public.store_profiles
  for each row execute function public.set_store_profiles_updated_at();
