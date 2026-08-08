-- 店休日を「日数」ではなく「具体的な日付」で管理するための新テーブル。既存の
-- monthly_targets.holiday_count / business_day_count(数値ベース)は残したまま、
-- カレンダーで選択した日付が存在する場合はそちらを優先する(storage.jsのgetBusinessDaySummary
-- 参照)。既存の数値だけを保存しているデータを勝手に日付へ変換することはしない。
--
-- 実店舗用(store_business_holidays)と「全店舗」仮想ビュー用(company_all_stores_holidays)を
-- monthly_targets/company_all_stores_targetsと同じ考え方で別テーブルに分離する
-- (NULL許容の1テーブルにまとめるとunique制約がNULL同士を区別しない問題があるため)。

create table if not exists public.store_business_holidays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  holiday_date date not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(store_id, holiday_date)
);

create table if not exists public.company_all_stores_holidays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  holiday_date date not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(company_id, holiday_date)
);

alter table public.store_business_holidays enable row level security;
alter table public.company_all_stores_holidays enable row level security;

drop policy if exists store_business_holidays_select on public.store_business_holidays;
drop policy if exists store_business_holidays_insert on public.store_business_holidays;
drop policy if exists store_business_holidays_update on public.store_business_holidays;
drop policy if exists store_business_holidays_delete on public.store_business_holidays;

-- monthly_targetsと同じ権限形状: 読み取りは割当店舗または会社/システム管理者、
-- 書き込みは店舗管理者(自店舗)または会社/システム管理者。
create policy store_business_holidays_select
  on public.store_business_holidays
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

create policy store_business_holidays_insert
  on public.store_business_holidays
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

create policy store_business_holidays_update
  on public.store_business_holidays
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
  );

create policy store_business_holidays_delete
  on public.store_business_holidays
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
          select 1 from public.profiles p
          where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager'
        )
      )
    )
  );

drop policy if exists company_all_stores_holidays_select on public.company_all_stores_holidays;
drop policy if exists company_all_stores_holidays_insert on public.company_all_stores_holidays;
drop policy if exists company_all_stores_holidays_update on public.company_all_stores_holidays;
drop policy if exists company_all_stores_holidays_delete on public.company_all_stores_holidays;

-- company_all_stores_targetsと同じ権限形状: company_admin専用機能なので、system_adminと
-- そのcompanyのcompany_adminのみ読み書き可能。
create policy company_all_stores_holidays_select
  on public.company_all_stores_holidays
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
    )
  );

create policy company_all_stores_holidays_insert
  on public.company_all_stores_holidays
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

create policy company_all_stores_holidays_update
  on public.company_all_stores_holidays
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

create policy company_all_stores_holidays_delete
  on public.company_all_stores_holidays
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

create index if not exists store_business_holidays_company_month_idx
  on public.store_business_holidays (company_id, holiday_date);
create index if not exists company_all_stores_holidays_month_idx
  on public.company_all_stores_holidays (company_id, holiday_date);
