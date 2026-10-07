BEGIN;

-- スタッフ人数変更時の過去データ保持。
--
-- これまで「在籍スタッフ数」「生産性計算人数」は store_profiles に店舗ごと1行だけで持つ
-- 「現在値」で、1人あたり月間売上の計算は月に関係なくこの現在値を使っていた(=人数を
-- 変更すると過去月の実績まで現在の人数で再計算されてしまう不具合)。
--
-- store_monthly_cost_overrides・cost_monthly_amountsと同じ「対象月ごとの履歴」パターンで
-- 新しいテーブルを追加し、ある対象月の値は「その月以降、より新しい履歴行が無い限りずっと
-- 有効」という持ち越し方式にする(費用の継続項目(cost_monthly_amounts+
-- getMostRecentReflectedCostAmount)と同じ考え方)。店舗設定画面の入力欄は増やさず、
-- 既存の「対象月」(画面右上)をそのまま適用開始月として使う。
create table public.store_staff_count_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  effective_month text not null,
  staff_count integer not null default 0,
  productivity_staff_count numeric not null default 0,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, effective_month)
);

create index store_staff_count_history_company_id_idx on public.store_staff_count_history(company_id);
create index store_staff_count_history_store_month_idx on public.store_staff_count_history(store_id, effective_month);

alter table public.store_staff_count_history enable row level security;

create policy store_staff_count_history_select_company_scoped
  on public.store_staff_count_history
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

create policy store_staff_count_history_insert_company_scoped
  on public.store_staff_count_history
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

create policy store_staff_count_history_update_company_scoped
  on public.store_staff_count_history
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

create policy store_staff_count_history_delete_company_scoped
  on public.store_staff_count_history
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

-- updated_atの自動更新に加え、upsert経由の更新(同じeffective_monthへの再保存)でも
-- created_at/created_by(最初に保存した記録)が上書きされないようにする
-- (daily_batch_entriesの3重登録不具合対策で導入した方式と同じ、要件: 履歴を破壊しない)。
create or replace function public.set_store_staff_count_history_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  if tg_op = 'UPDATE' then
    new.created_at = old.created_at;
    new.created_by = old.created_by;
  end if;
  return new;
end;
$$;

create trigger store_staff_count_history_set_updated_at
  before update on public.store_staff_count_history
  for each row execute function public.set_store_staff_count_history_updated_at();

-- 既存データの引き継ぎ: 現在store_profilesに登録されているスタッフ人数を、
-- 「ずっと前から有効だった値」として各店舗1行だけ履歴に登録する。effective_monthは
-- この時点より前の実績月が存在し得ないくらい十分古い固定値(2000-01)にしておけば、
-- どの過去月を見ても「この履歴行が最も新しい(=唯一の)適用対象」として正しく解決される
-- ——既存の損益・ダッシュボード表示を1件も変えないための後方互換の初期値。
insert into public.store_staff_count_history (company_id, store_id, effective_month, staff_count, productivity_staff_count)
select sp.company_id, sp.store_id, '2000-01', sp.staff_count, sp.productivity_staff_count
from public.store_profiles sp
on conflict (store_id, effective_month) do nothing;

COMMIT;
