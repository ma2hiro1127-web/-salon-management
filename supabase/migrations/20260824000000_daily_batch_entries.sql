BEGIN;

-- まとめて入力(要件): 毎日入力しない店舗(週1・旬ごと・月1・月途中契約など)向けに、
-- 「開始日〜終了日」の期間合計を1件のレコードとして記録する機能。daily_sales/
-- daily_cash_breakdownは全カラムがNOT NULL DEFAULT 0で、「未入力」と「0」を区別する
-- 仕組みが無い(1日1行、常に全項目を数値で送る設計のため)。まとめ入力は項目単位で
-- 「入力した項目だけを反映し、未入力項目は集計に一切影響させない」ことが必須要件のため、
-- 既存テーブルへ無理に同じ形式で押し込まず、全ての実績カラムをnull許容にした別テーブルへ
-- 分離する。売上・日計は日次と同じ考え方(daily_cash_breakdownがdaily_salesと別テーブルな
-- のと同じ)で1テーブルにまとめる — まとめ入力は「期間合計」という単一の性質のデータで、
-- 日計だけを別に分離する理由が無いため。
--
-- 月またぎは禁止する(CHECK制約) — 「8/1〜8/31」のような単一暦月内の期間だけを対象にし、
-- 月次集計の帰属先が曖昧にならないようにする。開始日を「店舗作成日より前は禁止」等には
-- しない(要件: 月途中契約でも契約日より前の過去実績を後から入力できる必要がある)。

create table public.daily_batch_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  sales_amount numeric,
  technical_sales_amount numeric,
  retail_sales_amount numeric,
  other_sales_amount numeric,
  customer_count integer,
  new_customer_count integer,
  repeat_customer_count integer,
  review_count integer,
  cash_amount numeric,
  cashless_amount numeric,
  point_amount numeric,
  memo text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_batch_entries_date_order check (end_date >= start_date),
  constraint daily_batch_entries_single_month check (date_trunc('month', start_date) = date_trunc('month', end_date)),
  constraint daily_batch_entries_has_value check (
    sales_amount is not null or technical_sales_amount is not null or retail_sales_amount is not null
    or other_sales_amount is not null or customer_count is not null or new_customer_count is not null
    or repeat_customer_count is not null or review_count is not null or cash_amount is not null
    or cashless_amount is not null or point_amount is not null
  )
);

create index daily_batch_entries_company_id_idx on public.daily_batch_entries(company_id);
create index daily_batch_entries_store_id_idx on public.daily_batch_entries(store_id);
create index daily_batch_entries_store_start_idx on public.daily_batch_entries(store_id, start_date);

alter table public.daily_batch_entries enable row level security;

-- RLSはdaily_cash_breakdownの現行形状(本番で直接確認済み)を踏襲するが、staffブランチは
-- 意図的に持たない — まとめ入力はstore_manager以上限定の機能とする(staffの日次入力
-- 「今日のみ」制限は本質的に過去期間を扱うまとめ入力とは馴染まないため)。SELECT側には
-- 加盟店閲覧(current_user_can_view_franchise_company)のOR分岐を必ず含める — 加盟店の
-- まとめ入力データも通常店舗と同じ「閲覧のみ」の扱いにする。

create policy daily_batch_entries_select_company_scoped
  on public.daily_batch_entries
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
      or public.current_user_can_view_franchise_company(company_id)
    )
  );

create policy daily_batch_entries_insert_company_scoped
  on public.daily_batch_entries
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and created_by is not null
        and created_by = public.current_user_profile_id()
        and exists (
          select 1 from public.stores s
          where s.id = daily_batch_entries.store_id and s.company_id = daily_batch_entries.company_id and s.status = 'active'
        )
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  );

create policy daily_batch_entries_update_company_scoped
  on public.daily_batch_entries
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
    and exists (
      select 1 from public.stores s
      where s.id = daily_batch_entries.store_id and s.company_id = daily_batch_entries.company_id
    )
  );

create policy daily_batch_entries_delete_company_scoped
  on public.daily_batch_entries
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
    )
  );

create or replace function public.set_daily_batch_entries_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger daily_batch_entries_set_updated_at
  before update on public.daily_batch_entries
  for each row execute function public.set_daily_batch_entries_updated_at();

COMMIT;
