BEGIN;

-- Inspect helper: policies and functions are dropped first so the migration is atomic.

-- Drop legacy wide policies explicitly.
drop policy if exists companies_select_authenticated on public.companies;
drop policy if exists companies_manage_authenticated on public.companies;
drop policy if exists stores_select_authenticated on public.stores;
drop policy if exists stores_manage_authenticated on public.stores;
drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_manage_authenticated on public.profiles;
drop policy if exists user_stores_select_authenticated on public.user_stores;
drop policy if exists user_stores_manage_authenticated on public.user_stores;
drop policy if exists daily_sales_select_authenticated on public.daily_sales;
drop policy if exists daily_sales_manage_authenticated on public.daily_sales;
drop policy if exists monthly_closings_select_authenticated on public.monthly_closings;
drop policy if exists monthly_closings_manage_authenticated on public.monthly_closings;
drop policy if exists tenant_snapshots_select_authenticated on public.tenant_snapshots;
drop policy if exists tenant_snapshots_manage_authenticated on public.tenant_snapshots;

-- Drop previously created company-scoped policies as well.
drop policy if exists companies_select_company_scoped on public.companies;
drop policy if exists companies_insert_system_only on public.companies;
drop policy if exists companies_update_system_only on public.companies;
drop policy if exists companies_delete_system_only on public.companies;
drop policy if exists stores_select_company_scoped on public.stores;
drop policy if exists stores_insert_company_scoped on public.stores;
drop policy if exists stores_update_company_scoped on public.stores;
drop policy if exists stores_delete_company_scoped on public.stores;
drop policy if exists profiles_select_company_scoped on public.profiles;
drop policy if exists profiles_insert_company_scoped on public.profiles;
drop policy if exists profiles_update_company_scoped on public.profiles;
drop policy if exists profiles_delete_company_scoped on public.profiles;
drop policy if exists user_stores_select_company_scoped on public.user_stores;
drop policy if exists user_stores_insert_company_scoped on public.user_stores;
drop policy if exists user_stores_update_company_scoped on public.user_stores;
drop policy if exists user_stores_delete_company_scoped on public.user_stores;
drop policy if exists daily_sales_select_company_scoped on public.daily_sales;
drop policy if exists daily_sales_insert_company_scoped on public.daily_sales;
drop policy if exists daily_sales_update_company_scoped on public.daily_sales;
drop policy if exists daily_sales_delete_company_scoped on public.daily_sales;
drop policy if exists monthly_closings_select_company_scoped on public.monthly_closings;
drop policy if exists monthly_closings_insert_company_scoped on public.monthly_closings;
drop policy if exists monthly_closings_update_company_scoped on public.monthly_closings;
drop policy if exists monthly_closings_delete_company_scoped on public.monthly_closings;
drop policy if exists tenant_snapshots_select_company_scoped on public.tenant_snapshots;
drop policy if exists tenant_snapshots_insert_company_scoped on public.tenant_snapshots;
drop policy if exists tenant_snapshots_update_company_scoped on public.tenant_snapshots;
drop policy if exists tenant_snapshots_delete_company_scoped on public.tenant_snapshots;
drop policy if exists tenant_snapshots_select_company_scope on public.tenant_snapshots;
drop policy if exists tenant_snapshots_manage_company_scope on public.tenant_snapshots;
drop policy if exists tenant_snapshots_update_company_scope on public.tenant_snapshots;
drop policy if exists tenant_snapshots_delete_company_scope on public.tenant_snapshots;

-- Drop helper functions before recreating them.
drop function if exists public.current_user_company_ids();
drop function if exists public.current_user_store_ids();
drop function if exists public.current_user_profile_id();
drop function if exists public.current_user_is_system_admin();
drop function if exists public.current_user_is_company_admin();

create extension if not exists pgcrypto;

alter table public.companies enable row level security;
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.user_stores enable row level security;
alter table public.daily_sales enable row level security;
alter table public.monthly_closings enable row level security;
alter table public.tenant_snapshots enable row level security;

create or replace function public.current_user_company_ids()
returns uuid[] language sql security definer set search_path = pg_catalog, public stable as $$
  select coalesce(
    array(
      select company_id
      from public.profiles
      where auth_user_id = auth.uid()
        and company_id is not null
        and is_active = true
    ),
    array[]::uuid[]
  );
$$;
alter function public.current_user_company_ids() owner to postgres;
revoke all on function public.current_user_company_ids() from public;
grant execute on function public.current_user_company_ids() to authenticated;

create or replace function public.current_user_store_ids()
returns uuid[] language sql security definer set search_path = pg_catalog, public stable as $$
  select coalesce(
    array(
      select us.store_id
      from public.user_stores us
      join public.profiles p on p.id = us.user_id
      where p.auth_user_id = auth.uid()
        and p.is_active = true
    ),
    array[]::uuid[]
  );
$$;
alter function public.current_user_store_ids() owner to postgres;
revoke all on function public.current_user_store_ids() from public;
grant execute on function public.current_user_store_ids() to authenticated;

create or replace function public.current_user_profile_id()
returns uuid language sql security definer set search_path = pg_catalog, public stable as $$
  select id
  from public.profiles
  where auth_user_id = auth.uid()
    and is_active = true
  order by created_at asc
  limit 1;
$$;
alter function public.current_user_profile_id() owner to postgres;
revoke all on function public.current_user_profile_id() from public;
grant execute on function public.current_user_profile_id() to authenticated;

create or replace function public.current_user_is_system_admin()
returns boolean language sql security definer set search_path = pg_catalog, public stable as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and p.is_active = true
      and p.role = 'system_admin'
  );
$$;
alter function public.current_user_is_system_admin() owner to postgres;
revoke all on function public.current_user_is_system_admin() from public;
grant execute on function public.current_user_is_system_admin() to authenticated;

create or replace function public.current_user_is_company_admin()
returns boolean language sql security definer set search_path = pg_catalog, public stable as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and p.is_active = true
      and p.role = 'company_admin'
  );
$$;
alter function public.current_user_is_company_admin() owner to postgres;
revoke all on function public.current_user_is_company_admin() from public;
grant execute on function public.current_user_is_company_admin() to authenticated;

create or replace function public.enforce_profile_company_admin_update_rules()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  is_system_admin boolean;
  is_company_admin boolean;
begin
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and p.is_active = true
      and p.role = 'system_admin'
  ) into is_system_admin;

  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and p.is_active = true
      and p.role = 'company_admin'
  ) into is_company_admin;

  if not is_system_admin and is_company_admin then
    if coalesce(new.role, '') not in ('staff', 'store_manager') then
      raise exception 'company_admin can only assign staff or store_manager roles';
    end if;

    if new.auth_user_id is distinct from old.auth_user_id then
      raise exception 'company_admin cannot change auth_user_id';
    end if;

    if new.company_id is distinct from old.company_id then
      raise exception 'company_admin cannot change company_id';
    end if;
  end if;

  return new;
end;
$$;
alter function public.enforce_profile_company_admin_update_rules() owner to postgres;
revoke all on function public.enforce_profile_company_admin_update_rules() from public;
grant execute on function public.enforce_profile_company_admin_update_rules() to authenticated;

drop trigger if exists profiles_company_admin_update_guard on public.profiles;
create trigger profiles_company_admin_update_guard
  before update on public.profiles
  for each row
  execute function public.enforce_profile_company_admin_update_rules();

-- companies
create policy companies_select_company_scoped
  on public.companies
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or id in (
        select company_id
        from public.profiles p
        where p.auth_user_id = auth.uid()
          and p.company_id is not null
          and p.is_active = true
      )
    )
  );

create policy companies_insert_system_only
  on public.companies
  for insert to authenticated
  with check (
    auth.uid() is not null and public.current_user_is_system_admin()
  );

create policy companies_update_system_only
  on public.companies
  for update to authenticated
  using (
    auth.uid() is not null and public.current_user_is_system_admin()
  )
  with check (
    auth.uid() is not null and public.current_user_is_system_admin()
  );

create policy companies_delete_system_only
  on public.companies
  for delete to authenticated
  using (
    auth.uid() is not null and public.current_user_is_system_admin()
  );

-- stores
create policy stores_select_company_scoped
  on public.stores
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or id in (select unnest(public.current_user_store_ids()))
    )
  );

create policy stores_insert_company_scoped
  on public.stores
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
    )
  );

create policy stores_update_company_scoped
  on public.stores
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
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
    )
  );

create policy stores_delete_company_scoped
  on public.stores
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
    )
  );

-- profiles
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
    )
  );

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
        and role in ('staff', 'store_manager')
      )
    )
  );

create policy profiles_update_company_scoped
  on public.profiles
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
        and role <> 'system_admin'
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
        and role <> 'system_admin'
      )
    )
  );

create policy profiles_delete_company_scoped
  on public.profiles
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
        and role <> 'system_admin'
      )
    )
  );

-- user_stores
create policy user_stores_select_company_scoped
  on public.user_stores
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or user_id = public.current_user_profile_id()
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

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
    )
  );

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
    )
  );

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
    )
  );

-- daily_sales
create policy daily_sales_select_company_scoped
  on public.daily_sales
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
      )
    )
  );

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
      )
    )
  );

-- monthly_closings
create policy monthly_closings_select_company_scoped
  on public.monthly_closings
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

create policy monthly_closings_insert_company_scoped
  on public.monthly_closings
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
          select 1
          from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role = 'store_manager'
        )
      )
    )
    and exists (
      select 1
      from public.stores s
      where s.id = store_id
        and s.company_id = company_id
    )
  );

create policy monthly_closings_update_company_scoped
  on public.monthly_closings
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
    and exists (
      select 1
      from public.stores s
      where s.id = store_id
        and s.company_id = company_id
    )
  );

create policy monthly_closings_delete_company_scoped
  on public.monthly_closings
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
    )
  );

-- tenant_snapshots
create policy tenant_snapshots_select_company_scoped
  on public.tenant_snapshots
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or (
        store_id is not null
        and store_id in (select unnest(public.current_user_store_ids()))
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
        and company_id in (select unnest(public.current_user_company_ids()))
        and (
          store_id is null
          or (
            store_id is not null
            and exists (
              select 1
              from public.stores s
              where s.id = store_id
                and s.company_id = company_id
            )
          )
        )
      )
      or (
        store_id is not null
        and store_id in (select unnest(public.current_user_store_ids()))
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
          where s.id = store_id
            and s.company_id = company_id
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
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or (
        store_id is not null
        and store_id in (select unnest(public.current_user_store_ids()))
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
        and (
          store_id is null
          or (
            store_id is not null
            and exists (
              select 1
              from public.stores s
              where s.id = store_id
                and s.company_id = company_id
            )
          )
        )
      )
      or (
        store_id is not null
        and store_id in (select unnest(public.current_user_store_ids()))
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
          where s.id = store_id
            and s.company_id = company_id
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
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or (
        store_id is not null
        and store_id in (select unnest(public.current_user_store_ids()))
      )
    )
  );

select schemaname, tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('companies', 'stores', 'profiles', 'user_stores', 'daily_sales', 'monthly_closings', 'tenant_snapshots')
order by tablename, policyname;

COMMIT;
