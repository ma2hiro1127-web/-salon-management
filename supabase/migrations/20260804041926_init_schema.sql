create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  code text unique not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  company_id uuid references public.companies(id) on delete set null,
  name text not null,
  email text not null unique,
  role text not null check (role in ('system_admin','company_admin','store_manager','staff')),
  is_active boolean not null default true,
  invitation_status text not null default 'active' check (invitation_status in ('active','invited','pending','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_stores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id, company_id, store_id)
);

create table if not exists public.daily_sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  business_date date not null,
  sales_amount numeric not null default 0,
  retail_sales_amount numeric not null default 0,
  customer_count integer not null default 0,
  new_customer_count integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, store_id, business_date)
);

create table if not exists public.monthly_closings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  year_month text not null,
  is_closed boolean not null default false,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, store_id, year_month)
);

alter table public.companies enable row level security;
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.user_stores enable row level security;
alter table public.daily_sales enable row level security;
alter table public.monthly_closings enable row level security;

drop policy if exists companies_select on public.companies;
drop policy if exists companies_manage on public.companies;
drop policy if exists stores_select on public.stores;
drop policy if exists stores_manage on public.stores;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_manage on public.profiles;
drop policy if exists user_stores_select on public.user_stores;
drop policy if exists user_stores_manage on public.user_stores;
drop policy if exists daily_sales_select on public.daily_sales;
drop policy if exists daily_sales_manage on public.daily_sales;
drop policy if exists monthly_closings_select on public.monthly_closings;
drop policy if exists monthly_closings_manage on public.monthly_closings;

drop function if exists public.current_user_can_access_company(uuid);
drop function if exists public.current_user_has_role_in_company(uuid, text[]);

create policy companies_select on public.companies
  for select using (auth.uid() is not null);

create policy companies_manage on public.companies
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy stores_select on public.stores
  for select using (auth.uid() is not null);

create policy stores_manage on public.stores
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy profiles_select on public.profiles
  for select using (auth.uid() is not null);

create policy profiles_manage on public.profiles
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy user_stores_select on public.user_stores
  for select using (auth.uid() is not null);

create policy user_stores_manage on public.user_stores
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy daily_sales_select on public.daily_sales
  for select using (auth.uid() is not null);

create policy daily_sales_manage on public.daily_sales
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy monthly_closings_select on public.monthly_closings
  for select using (auth.uid() is not null);

create policy monthly_closings_manage on public.monthly_closings
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
