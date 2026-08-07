-- 会社基本設定 (businessType/currency/salesDisplayMode/etc, plus taxSettings and the global
-- showOtherSales preference) had NO dedicated columns anywhere — companies only ever had
-- id/name/code/is_active. Every save from the 会社基本設定 form only ever mutated local React
-- state; hydrateFromSupabase's company-rebuild always re-seeds company.settings from a hardcoded
-- default on every fetch, so these edits were silently discarded on the very next refresh/login/
-- device. One row per company (company_id is both PK and FK, matching a strict 1:1).
create table if not exists public.company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  business_type text not null default 'salon',
  currency text not null default 'JPY',
  fiscal_year_start_month text not null default '1',
  sales_display_mode text not null default 'inclusive',
  retail_sales_label text not null default '店販売上',
  closing_day text not null default '月末',
  edit_deadline_days integer not null default 7,
  allow_staff_past_edit boolean not null default false,
  visible_sales_fields jsonb not null default '["technicalSales","retailSales","otherSales"]'::jsonb,
  active_kpis jsonb not null default '["sales","customers","retailRatio"]'::jsonb,
  show_other_sales boolean not null default false,
  tax_rate numeric not null default 0.1,
  tax_rounding_mode text not null default 'half-up',
  tax_sales_input_mode text not null default 'inclusive',
  tax_expense_input_mode text not null default 'inclusive',
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.company_settings enable row level security;

drop policy if exists company_settings_select_company_scoped on public.company_settings;
drop policy if exists company_settings_insert_company_scoped on public.company_settings;
drop policy if exists company_settings_update_company_scoped on public.company_settings;

create policy company_settings_select_company_scoped
  on public.company_settings
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or exists (
        select 1 from public.stores s
        where s.company_id = company_settings.company_id
          and s.id in (select unnest(public.current_user_store_ids()))
      )
    )
  );

-- Mirrors the existing UI's own access model (the 設定 page — and therefore this form — is
-- reachable by system_admin/company_admin/store_manager, not just company_admin) rather than
-- inventing a stricter rule than what's already exposed.
create policy company_settings_insert_company_scoped
  on public.company_settings
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or (
        exists (
          select 1 from public.stores s
          where s.company_id = company_settings.company_id
            and s.id in (select unnest(public.current_user_store_ids()))
        )
        and exists (
          select 1 from public.profiles p
          where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager'
        )
      )
    )
  );

create policy company_settings_update_company_scoped
  on public.company_settings
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or (
        exists (
          select 1 from public.stores s
          where s.company_id = company_settings.company_id
            and s.id in (select unnest(public.current_user_store_ids()))
        )
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
        exists (
          select 1 from public.stores s
          where s.company_id = company_settings.company_id
            and s.id in (select unnest(public.current_user_store_ids()))
        )
        and exists (
          select 1 from public.profiles p
          where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager'
        )
      )
    )
  );

create or replace function public.set_company_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists company_settings_set_updated_at on public.company_settings;
create trigger company_settings_set_updated_at
  before update on public.company_settings
  for each row execute function public.set_company_settings_updated_at();
