-- 月次レビュー(利益管理ではなく、店舗・会社全体で「今月どうだったか」を共有するための
-- 自由記述4項目: 今月の振り返り/今月の課題/改善したこと/来月の改善アクション)。
-- 数字自体はこのテーブルには一切保存しない — daily_sales/monthly_targets等の既存テーブルから
-- calculateMonthSummary/calculateAllStoresMonthSummary(src/utils/storage.js)がその都度算出する
-- ものをそのまま表示するだけで、二重に保存・二重に集計しない(要件16: 重複した計算ロジックを
-- 作らない)。

create table if not exists public.monthly_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- nullは「全店舗(会社全体)」のレビューを表す(company_adminが全店舗ビューで記入するもの)。
  -- 店舗ごとのレビューとは完全に別行として保存され、店舗Aのレビューと店舗Bのレビュー・
  -- 会社全体のレビューが混ざらない(要件6)。
  store_id uuid references public.stores(id) on delete cascade,
  target_month text not null check (target_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  reflection text not null default '',
  challenges text not null default '',
  improvements text not null default '',
  next_actions text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- store_idがNULL許容のため、通常のunique(company_id, store_id, target_month)制約では
-- 「NULLはそれぞれ別の値として扱われる」というSQLの仕様上、同じ会社の全店舗レビューが
-- 複数行作られてしまう(重複防止にならない)。店舗ごと/全店舗ごとで別々の部分ユニーク
-- インデックスにすることで、どちらも正しく1会社1店舗1か月につき1行に強制する。
create unique index if not exists monthly_reviews_store_month_unique
  on public.monthly_reviews(company_id, store_id, target_month)
  where store_id is not null;

create unique index if not exists monthly_reviews_company_month_unique
  on public.monthly_reviews(company_id, target_month)
  where store_id is null;

create index if not exists monthly_reviews_company_id_idx on public.monthly_reviews(company_id);
create index if not exists monthly_reviews_store_id_idx on public.monthly_reviews(store_id);

alter table public.monthly_reviews enable row level security;

-- SELECT: monthly_targets_select_company_scopedと同じ規約(店舗に所属していれば閲覧可、
-- staffも含む——要件8「staffは原則として閲覧のみ」の「閲覧」部分)。store_idがNULLの
-- 全店舗レビューは、自社店舗いずれかに所属しているだけでは見えず、company_admin/
-- system_adminだけが見える(company_id in own companiesの分岐にしか一致しないため)。
drop policy if exists monthly_reviews_select_company_scoped on public.monthly_reviews;
create policy monthly_reviews_select_company_scoped
  on public.monthly_reviews
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or (
        store_id is not null
        and store_id in (select unnest(public.current_user_store_ids()))
      )
    )
  );

-- INSERT/UPDATE: company_admin/system_adminは自社内(全店舗レビュー含む)を自由に編集できる。
-- store_managerは自分が所属する店舗のレビューだけ編集できる(全店舗レビューのstore_id is null
-- はこの分岐に一致しないため、store_managerが会社全体のレビューを書き換えることはできない)。
-- staffはどちらの分岐にも一致しないため、INSERT/UPDATEは常に拒否される(要件8: 閲覧のみ)。
drop policy if exists monthly_reviews_insert_company_scoped on public.monthly_reviews;
create policy monthly_reviews_insert_company_scoped
  on public.monthly_reviews
  for insert to authenticated
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or (
        store_id is not null
        and store_id in (select unnest(public.current_user_store_ids()))
        and exists (
          select 1 from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role = 'store_manager'
        )
      )
    )
    and (
      store_id is null
      or exists (select 1 from public.stores s where s.id = store_id and s.company_id = company_id)
    )
  );

drop policy if exists monthly_reviews_update_company_scoped on public.monthly_reviews;
create policy monthly_reviews_update_company_scoped
  on public.monthly_reviews
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or (
        store_id is not null
        and store_id in (select unnest(public.current_user_store_ids()))
        and exists (
          select 1 from public.profiles p
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
        store_id is not null
        and store_id in (select unnest(public.current_user_store_ids()))
        and exists (
          select 1 from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role = 'store_manager'
        )
      )
    )
    and (
      store_id is null
      or exists (select 1 from public.stores s where s.id = store_id and s.company_id = company_id)
    )
  );

-- 削除: 会社削除(cascade)以外での明示的な削除UIは今回設けない(空文字で上書き保存すれば
-- 実質的に消せるため)が、誤って作成した行を管理側で片付けられるよう、書き込み権限と同じ
-- 範囲でDELETEも許可しておく。
drop policy if exists monthly_reviews_delete_company_scoped on public.monthly_reviews;
create policy monthly_reviews_delete_company_scoped
  on public.monthly_reviews
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
      )
      or (
        store_id is not null
        and store_id in (select unnest(public.current_user_store_ids()))
        and exists (
          select 1 from public.profiles p
          where p.auth_user_id = auth.uid()
            and p.is_active = true
            and p.role = 'store_manager'
        )
      )
    )
  );

create or replace function public.set_monthly_reviews_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists monthly_reviews_set_updated_at on public.monthly_reviews;
create trigger monthly_reviews_set_updated_at
  before update on public.monthly_reviews
  for each row execute function public.set_monthly_reviews_updated_at();
