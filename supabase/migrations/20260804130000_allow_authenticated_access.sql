-- Allow authenticated Supabase users to read/write the salon management tables.

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

create policy companies_select on public.companies for select using (auth.uid() is not null);
create policy companies_manage on public.companies for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy stores_select on public.stores for select using (auth.uid() is not null);
create policy stores_manage on public.stores for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy profiles_select on public.profiles for select using (auth.uid() is not null);
create policy profiles_manage on public.profiles for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy user_stores_select on public.user_stores for select using (auth.uid() is not null);
create policy user_stores_manage on public.user_stores for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy daily_sales_select on public.daily_sales for select using (auth.uid() is not null);
create policy daily_sales_manage on public.daily_sales for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy monthly_closings_select on public.monthly_closings for select using (auth.uid() is not null);
create policy monthly_closings_manage on public.monthly_closings for all using (auth.uid() is not null) with check (auth.uid() is not null);
