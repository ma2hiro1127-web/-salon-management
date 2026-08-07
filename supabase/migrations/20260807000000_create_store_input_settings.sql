-- Dedicated table for per-store field visibility settings (which daily-entry and monthly-
-- target fields a store shows), keyed by company_id/store_id (real uuids from companies/
-- stores — never a store name or slug), matching the same company/store-scoped RLS shape as
-- daily_sales/monthly_targets.
--
-- daily_field_settings already lived as a jsonb column directly on stores (see
-- 20260806010000_add_daily_field_settings.sql). That data is preserved, not replaced: this
-- migration backfills it into the new table so every store keeps its existing configuration,
-- and the app falls back to reading the old column for any store that doesn't have a
-- store_input_settings row yet (e.g. a row inserted concurrently with this migration).
create table if not exists public.store_input_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  daily_fields jsonb not null default '{
    "mode": "detailed",
    "fields": {
      "technicalSales": true,
      "retailSales": true,
      "customers": true,
      "newCustomers": true,
      "repeatCustomers": true,
      "memo": true
    }
  }'::jsonb,
  monthly_target_fields jsonb not null default '{
    "fields": {
      "targetSales": true,
      "targetTechnicalSales": true,
      "targetRetailSales": true,
      "targetCustomers": true,
      "targetAverageSpend": true,
      "targetNewCustomers": true,
      "targetRepeatCustomers": true,
      "targetLaborRate": true,
      "targetMaterialRate": true,
      "targetAdRate": true,
      "targetOperatingMargin": true,
      "holidayCount": true
    }
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, store_id)
);

alter table public.store_input_settings enable row level security;

drop policy if exists store_input_settings_select_company_scoped on public.store_input_settings;
drop policy if exists store_input_settings_insert_company_scoped on public.store_input_settings;
drop policy if exists store_input_settings_update_company_scoped on public.store_input_settings;
drop policy if exists store_input_settings_delete_company_scoped on public.store_input_settings;

-- Read: system/company admins (whole company) or anyone assigned to the specific store.
create policy store_input_settings_select_company_scoped
  on public.store_input_settings
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

-- Write: company/system admins (any store in their company) or a store_manager for their own
-- assigned store only — matches "会社管理者、店舗管理者のみ更新可能" from the spec. Staff never
-- gets a write policy here at all, matching "一般スタッフは設定された項目だけを入力できる".
create policy store_input_settings_insert_company_scoped
  on public.store_input_settings
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
      where s.id = store_input_settings.store_id
        and s.company_id = store_input_settings.company_id
    )
  );

create policy store_input_settings_update_company_scoped
  on public.store_input_settings
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
      where s.id = store_input_settings.store_id
        and s.company_id = store_input_settings.company_id
    )
  );

create policy store_input_settings_delete_company_scoped
  on public.store_input_settings
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

create or replace function public.set_store_input_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists store_input_settings_set_updated_at on public.store_input_settings;
create trigger store_input_settings_set_updated_at
  before update on public.store_input_settings
  for each row execute function public.set_store_input_settings_updated_at();

-- Backfill: one row per existing store, carrying over its current daily_field_settings (the
-- monthly_target_fields column keeps the table default of "everything visible", since that
-- setting never existed before this migration — there is nothing to preserve for it).
insert into public.store_input_settings (company_id, store_id, daily_fields)
select s.company_id, s.id, coalesce(s.daily_field_settings, '{
  "mode": "detailed",
  "fields": {
    "technicalSales": true,
    "retailSales": true,
    "customers": true,
    "newCustomers": true,
    "repeatCustomers": true,
    "memo": true
  }
}'::jsonb)
from public.stores s
on conflict (company_id, store_id) do nothing;
