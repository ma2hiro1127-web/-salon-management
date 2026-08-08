-- company_admin専用の「全店舗」集計ビュー用: 実績は各店舗のdaily_salesを都度集計して出す
-- (このテーブルには実績データは一切保存しない)。ここに保存するのは、店舗に紐づかない
-- 会社全体としての目標値と、全店舗共通の営業日設定(休業日/手動営業日数)のみ。
-- monthly_targets と同じ列構成だが、store_idを持たず company_id + target_month で一意
-- (店舗を追加・削除しても既存の全店舗目標行はそのまま残る = 過去月の実績集計には影響しない)。
create table if not exists public.company_all_stores_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  target_month text not null,
  target_sales numeric not null default 0,
  target_technical_sales numeric not null default 0,
  target_retail_sales numeric not null default 0,
  target_customers integer not null default 0,
  target_average_spend numeric not null default 0,
  target_new_customers integer not null default 0,
  target_repeat_customers integer not null default 0,
  target_review_count integer not null default 0,
  business_day_mode text not null default '',
  business_day_count numeric not null default 0,
  holiday_count numeric not null default 0,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, target_month)
);

alter table public.company_all_stores_targets enable row level security;

drop policy if exists company_all_stores_targets_select on public.company_all_stores_targets;
drop policy if exists company_all_stores_targets_insert on public.company_all_stores_targets;
drop policy if exists company_all_stores_targets_update on public.company_all_stores_targets;
drop policy if exists company_all_stores_targets_delete on public.company_all_stores_targets;

-- 「全店舗」はcompany_admin専用機能なので、system_admin(全社管理)とそのcompanyのcompany_admin
-- だけが読み書きできる。store_manager/staffには一般スタッフ・店舗管理者向けの権限を一切与えない
-- (UI側で非表示にするだけでなく、データ取得層でも他ロール・他社データを遮断する)。
create policy company_all_stores_targets_select
  on public.company_all_stores_targets
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

create policy company_all_stores_targets_insert
  on public.company_all_stores_targets
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

create policy company_all_stores_targets_update
  on public.company_all_stores_targets
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

create policy company_all_stores_targets_delete
  on public.company_all_stores_targets
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

create or replace function public.set_company_all_stores_targets_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists company_all_stores_targets_set_updated_at on public.company_all_stores_targets;
create trigger company_all_stores_targets_set_updated_at
  before update on public.company_all_stores_targets
  for each row execute function public.set_company_all_stores_targets_updated_at();
