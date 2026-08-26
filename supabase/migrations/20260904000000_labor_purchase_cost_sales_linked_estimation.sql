BEGIN;

-- 人件費・仕入(材料・発注費)の「月途中は売上連動で自動推定、月末は実額へ手動確定」統一仕様。
--
-- (1) 率・計算方法(固定額/売上連動)は店舗の「現在設定」として store_input_settings に持たせる
--     (use_inventory_tracking と同じ形、1店舗1行・月キー無し=翌月へ継続する)。
-- (2) 「その月だけの確定額」は月キー付きの新規テーブル store_monthly_cost_overrides に持たせる。
--     既存の cost_monthly_amounts は cost_item_id(fixed_costsの特定行)に紐づく設計のため、
--     複数のfixed_costs行の合計をまとめて上書きする今回の用途には使えない。
--     行の該当列が null = 未確定(自動推定/固定額側にフォールバック)、値があれば手動確定額。
--     「自動計算に戻す」はこの列をnullへ戻すUPDATEであり、行の削除ではない。
--
-- 既定値(mode='fixed')により、既存店舗は全て「固定額」= 現行の費用入力(fixed_costs +
-- cost_monthly_amounts、category=labor/materials)の合計をそのまま使う挙動のままとなり、
-- 既存の損益計算は1円も変わらない(既存データを壊さない要件)。

alter table public.store_input_settings
  add column if not exists labor_cost_mode text not null default 'fixed',
  add column if not exists labor_cost_rate numeric not null default 0,
  add column if not exists purchase_cost_mode text not null default 'fixed',
  add column if not exists purchase_cost_rate numeric not null default 0;

alter table public.store_input_settings
  drop constraint if exists store_input_settings_labor_cost_mode_check,
  drop constraint if exists store_input_settings_purchase_cost_mode_check;

alter table public.store_input_settings
  add constraint store_input_settings_labor_cost_mode_check check (labor_cost_mode in ('fixed', 'sales_linked')),
  add constraint store_input_settings_purchase_cost_mode_check check (purchase_cost_mode in ('fixed', 'sales_linked'));

-- ============================================================
-- store_monthly_cost_overrides: 店舗×対象月で1行。RLSはfixed_costsの4ポリシーと同一パターン
-- (閲覧: 所属店舗/管理者、書き込み: store_manager以上、company_id/store_id整合チェック込み)。
-- ============================================================
create table public.store_monthly_cost_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  target_month text not null,
  labor_cost_override numeric,
  purchase_cost_override numeric,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, target_month)
);

create index store_monthly_cost_overrides_company_id_idx on public.store_monthly_cost_overrides(company_id);
create index store_monthly_cost_overrides_store_month_idx on public.store_monthly_cost_overrides(store_id, target_month);

alter table public.store_monthly_cost_overrides enable row level security;

create policy store_monthly_cost_overrides_select_company_scoped
  on public.store_monthly_cost_overrides
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

create policy store_monthly_cost_overrides_insert_company_scoped
  on public.store_monthly_cost_overrides
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

create policy store_monthly_cost_overrides_update_company_scoped
  on public.store_monthly_cost_overrides
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

create policy store_monthly_cost_overrides_delete_company_scoped
  on public.store_monthly_cost_overrides
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

create or replace function public.set_store_monthly_cost_overrides_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists store_monthly_cost_overrides_set_updated_at on public.store_monthly_cost_overrides;
create trigger store_monthly_cost_overrides_set_updated_at
  before update on public.store_monthly_cost_overrides
  for each row execute function public.set_store_monthly_cost_overrides_updated_at();

COMMIT;
