-- 費用入力の再設計: 継続/期間限定を明示カラム化し、金額を「対象月ごと」の別テーブルへ分離する。
-- fixed_costs.amount は引き続き残す(過去の1件マスター方式の名残として、削除も上書きもしない)。
-- 新しい月次金額(cost_monthly_amounts)が優先され、既存の amount はこの下のバックフィルで
-- 過去〜当月分の cost_monthly_amounts に複製することで、既に締めた月の損益計算結果を保つ。
alter table public.fixed_costs
  add column if not exists period_type text not null default 'ongoing'
    check (period_type in ('ongoing', 'limited'));

-- 既存行の period_type を end_month の有無から復元する(旧仕様は end_month が空=継続という
-- 暗黙ルールだった)。今後の新規行は毎回明示的に period_type を書き込むので、この一括更新は
-- 移行時の1回きりで十分。
update public.fixed_costs
  set period_type = case when end_month is null or end_month = '' then 'ongoing' else 'limited' end;

create table if not exists public.cost_monthly_amounts (
  id uuid primary key default gen_random_uuid(),
  cost_item_id uuid not null references public.fixed_costs(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  target_month text not null,
  amount numeric not null default 0,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cost_item_id, target_month)
);

create index if not exists cost_monthly_amounts_company_id_idx on public.cost_monthly_amounts(company_id);
create index if not exists cost_monthly_amounts_store_id_idx on public.cost_monthly_amounts(store_id);
create index if not exists cost_monthly_amounts_target_month_idx on public.cost_monthly_amounts(target_month);
create index if not exists cost_monthly_amounts_cost_item_id_idx on public.cost_monthly_amounts(cost_item_id);

alter table public.cost_monthly_amounts enable row level security;

drop policy if exists cost_monthly_amounts_select_company_scoped on public.cost_monthly_amounts;
drop policy if exists cost_monthly_amounts_insert_company_scoped on public.cost_monthly_amounts;
drop policy if exists cost_monthly_amounts_update_company_scoped on public.cost_monthly_amounts;
drop policy if exists cost_monthly_amounts_delete_company_scoped on public.cost_monthly_amounts;

-- fixed_costs のRLS形状をそのまま踏襲する(company_id/store_idスコープ、書込はstore_manager
-- または company/system admin のみ)。
create policy cost_monthly_amounts_select_company_scoped
  on public.cost_monthly_amounts
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

create policy cost_monthly_amounts_insert_company_scoped
  on public.cost_monthly_amounts
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
    and exists (
      select 1
      from public.fixed_costs fc
      where fc.id = cost_item_id
        and fc.company_id = company_id
        and fc.store_id = store_id
    )
  );

create policy cost_monthly_amounts_update_company_scoped
  on public.cost_monthly_amounts
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

create policy cost_monthly_amounts_delete_company_scoped
  on public.cost_monthly_amounts
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

create or replace function public.set_cost_monthly_amounts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cost_monthly_amounts_set_updated_at on public.cost_monthly_amounts;
create trigger cost_monthly_amounts_set_updated_at
  before update on public.cost_monthly_amounts
  for each row execute function public.set_cost_monthly_amounts_updated_at();

-- 既存 fixed_costs の単一 amount を、過去〜当月分の cost_monthly_amounts へバックフィルする。
-- これにより、既に確定・締めている月の損益計算結果はこの移行の前後で変わらない。未来月は
-- 生成しない(このマイグレーション以降は月次画面で都度入力/コピーする運用に切り替わるため)。
insert into public.cost_monthly_amounts (cost_item_id, company_id, store_id, target_month, amount, created_by, updated_by)
select
  fc.id,
  fc.company_id,
  fc.store_id,
  to_char(month_series, 'YYYY-MM'),
  fc.amount,
  fc.created_by,
  fc.updated_by
from public.fixed_costs fc
cross join lateral generate_series(
  to_date(nullif(coalesce(nullif(fc.start_month, ''), fc.entry_month), ''), 'YYYY-MM'),
  least(
    case when fc.period_type = 'limited' and fc.end_month <> ''
      then to_date(fc.end_month, 'YYYY-MM')
      else to_date(to_char(now(), 'YYYY-MM'), 'YYYY-MM')
    end,
    to_date(to_char(now(), 'YYYY-MM'), 'YYYY-MM')
  ),
  interval '1 month'
) as month_series
where coalesce(nullif(fc.start_month, ''), fc.entry_month) is not null
on conflict (cost_item_id, target_month) do nothing;
