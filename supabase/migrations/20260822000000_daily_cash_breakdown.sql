BEGIN;

-- 日計管理(要件): 「技術売上/店販売上/総売上」とは別に、その日の売上が実際にどの支払方法
-- (現金/キャッシュレス/ポイント利用)で決済されたかを確認するための独立した機能。あくまで
-- 総売上の内訳の確認補助であり、新しい売上ではない — daily_salesの列は一切増やさず、
-- 完全に別テーブルにする。これにより:
--   (1) 総売上・損益・月次集計へ二重加算される経路が構造的に存在しない
--       (どの既存の合計計算もこの新テーブルを参照しないため)
--   (2) このテーブルへの保存が daily_sales.is_day_closed を書き換える経路が存在しない
--       (日締め状態を巻き戻す既知のバグ class を再発させない — 完全に別の保存経路にする)
--
-- 店舗ごとの任意機能にするため、store_input_settingsに使用可否のフラグを1列追加する
-- (use_inventory_trackingと同じ、単純なboolean列のパターンを踏襲)。初期値はfalse
-- (要件: 初期値は必ずOFF)。

alter table public.store_input_settings
  add column if not exists use_cash_breakdown boolean not null default false;

create table if not exists public.daily_cash_breakdown (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  business_date date not null,
  cash_amount numeric not null default 0,
  cashless_amount numeric not null default 0,
  point_amount numeric not null default 0,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, store_id, business_date)
);

create index if not exists daily_cash_breakdown_company_id_idx on public.daily_cash_breakdown(company_id);
create index if not exists daily_cash_breakdown_store_id_idx on public.daily_cash_breakdown(store_id);
create index if not exists daily_cash_breakdown_business_date_idx on public.daily_cash_breakdown(business_date);

alter table public.daily_cash_breakdown enable row level security;

-- daily_salesの現行RLS形状(20260818000000時点、本番で直接確認済み)をそのまま踏襲する。
-- ただし is_day_closed は daily_cash_breakdown には存在しない列であり、意図的に参照しない
-- (要件13: 日計は日締めデータとは別の入力情報として扱う — 日締め後もこのテーブル自体は
-- 独立して編集可能。日締めの保存自体を書き換えることは無い、という分離は保存経路が
-- 完全に別になっていることで既に保証されている)。

create policy daily_cash_breakdown_select_company_scoped
  on public.daily_cash_breakdown
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or store_id in (select unnest(public.current_user_store_ids()))
    )
  );

create policy daily_cash_breakdown_insert_company_scoped
  on public.daily_cash_breakdown
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
          where s.id = daily_cash_breakdown.store_id and s.company_id = daily_cash_breakdown.company_id and s.status = 'active'
        )
        and (
          exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
          or (
            exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'staff')
            and business_date = ((now() at time zone 'Asia/Tokyo'))::date
          )
        )
      )
    )
  );

create policy daily_cash_breakdown_update_company_scoped
  on public.daily_cash_breakdown
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'staff')
        and created_by is not null
        and created_by = public.current_user_profile_id()
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
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'staff')
        and created_by is not null
        and created_by = public.current_user_profile_id()
      )
    )
    and exists (
      select 1 from public.stores s
      where s.id = daily_cash_breakdown.store_id and s.company_id = daily_cash_breakdown.company_id
    )
  );

create policy daily_cash_breakdown_delete_company_scoped
  on public.daily_cash_breakdown
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (public.current_user_is_company_admin() and company_id in (select unnest(public.current_user_company_ids())))
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'store_manager')
      )
      or (
        store_id in (select unnest(public.current_user_store_ids()))
        and exists (select 1 from public.profiles p where p.auth_user_id = auth.uid() and p.is_active = true and p.role = 'staff')
        and created_by is not null
        and created_by = public.current_user_profile_id()
      )
    )
  );

create or replace function public.set_daily_cash_breakdown_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists daily_cash_breakdown_set_updated_at on public.daily_cash_breakdown;
create trigger daily_cash_breakdown_set_updated_at
  before update on public.daily_cash_breakdown
  for each row execute function public.set_daily_cash_breakdown_updated_at();

COMMIT;
