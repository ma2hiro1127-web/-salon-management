-- 店舗の状態管理を「運営中/停止中/アーカイブ」の3段階へ変更する。従来はstores.is_active
-- (boolean)1個しかなく、店舗管理画面の「削除」「アーカイブ」「停止」は全て同じ
-- is_active=falseを書くだけの見分けのつかない操作だった(誤クリックで実質「削除」相当の
-- 操作をしてしまうリスクがあった)。
--
-- stores.statusを新設し、is_activeはstatusから自動的に同期するtriggerに変更する
-- (is_active = (status <> 'archived'))。これにより、ダッシュボード・ランキング・全店舗集計・
-- 店舗切替・日次入力対象店舗一覧など、既存のis_active参照箇所は一切変更せずに「アーカイブは
-- 非表示」という既存の挙動を保ったまま、新しい3状態モデルへ移行できる。
alter table public.stores
  add column if not exists status text not null default 'active' check (status in ('active', 'suspended', 'archived'));

-- 既存データの移行: 従来の「削除」「アーカイブ」ボタンはどちらも is_active=false を書くだけ
-- で、「停止」という概念自体が存在しなかった。したがって現在is_active=falseになっている
-- 店舗は、当時のユーザー操作が「削除」だったか「アーカイブ」だったかに関わらず、実体は
-- 常にarchived相当(過去データ保持・一覧除外)だった — suspendedへ移行すべき対象は無い。
update public.stores set status = 'archived' where is_active = false and status = 'active';

create or replace function public.sync_store_is_active_from_status()
returns trigger
language plpgsql
as $$
begin
  new.is_active := (new.status <> 'archived');
  return new;
end;
$$;

drop trigger if exists stores_sync_is_active_trigger on public.stores;
create trigger stores_sync_is_active_trigger
  before insert or update of status on public.stores
  for each row execute function public.sync_store_is_active_from_status();

-- 停止/再開/アーカイブ/復元/完全削除の操作ログ。store_idへは意図的に外部キー制約を
-- 付けない(完全削除された店舗のログ行までNULL化・カスケード削除されて消えてしまうと、
-- 「誰が・いつ・どの店舗を完全削除したか」という最も重要な記録が真っ先に失われてしまう
-- ため)。store_nameを操作時点のスナップショットとして保持し、店舗が既に存在しなくても
-- 人間が読める記録として残す。書き込みはservice-role(Edge Function)経由のみに限定し、
-- 会社管理者・システム管理者本人であってもクライアントから直接INSERT/UPDATE/DELETEは
-- できない(自分の操作ログを改ざん・削除できないようにするため、authenticated向けの
-- 書き込みポリシーを一切作らない)。
create table if not exists public.store_status_audit_log (
  id uuid primary key default gen_random_uuid(),
  store_id uuid,
  store_name text not null default '',
  company_id uuid not null references public.companies(id) on delete cascade,
  action text not null check (action in ('suspended', 'resumed', 'archived', 'restored', 'deleted')),
  performed_by uuid references public.profiles(id) on delete set null,
  performed_by_name text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists store_status_audit_log_company_id_idx on public.store_status_audit_log(company_id);
create index if not exists store_status_audit_log_store_id_idx on public.store_status_audit_log(store_id);

alter table public.store_status_audit_log enable row level security;

drop policy if exists store_status_audit_log_select_company_scoped on public.store_status_audit_log;
create policy store_status_audit_log_select_company_scoped
  on public.store_status_audit_log
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

-- 完全削除はsystem_admin限定にする(従来はcompany_adminも自社の店舗をDELETEできた)。
-- 停止/再開/アーカイブ/復元はUPDATE(stores_update_company_scoped、変更なし)のままで
-- company_admin/system_adminとも引き続き可能 — Edge Function側で store_manager/staff を
-- 弾く(このポリシー自体はstore_managerに元々UPDATE権限が無いため、これだけでも安全)。
--
-- 関連データが1件でも存在する店舗のDELETEをRLS自体でも拒否する(delete-store Edge
-- Functionの事前チェックと同じ規約)。service-roleで動くEdge Function自体はRLSの影響を
-- 受けないため、このポリシーの主な意味は「system_adminがEdge Functionを経由せず、自分の
-- JWTでクライアントから直接DELETE文を発行した場合」の最終防御 — 要件「誤クリックで店舗
-- および過去データを失わない」を、UIやEdge Functionのロジックだけでなくデータベース自体の
-- 制約としても保証する。
drop policy if exists stores_delete_company_scoped on public.stores;
create policy stores_delete_system_admin_only
  on public.stores
  for delete to authenticated
  using (
    auth.uid() is not null
    and public.current_user_is_system_admin()
    and not exists (select 1 from public.daily_sales d where d.store_id = stores.id)
    and not exists (select 1 from public.monthly_targets m where m.store_id = stores.id)
    and not exists (select 1 from public.fixed_costs f where f.store_id = stores.id)
    and not exists (select 1 from public.variable_costs v where v.store_id = stores.id)
    and not exists (select 1 from public.monthly_closings mc where mc.store_id = stores.id)
    and not exists (select 1 from public.monthly_closing_items mci where mci.store_id = stores.id)
    and not exists (select 1 from public.cost_monthly_amounts cma where cma.store_id = stores.id)
    and not exists (select 1 from public.store_inventory_balances sib where sib.store_id = stores.id)
    and not exists (select 1 from public.store_business_holidays sbh where sbh.store_id = stores.id)
    and not exists (select 1 from public.user_stores us where us.store_id = stores.id)
  );

-- 停止中・アーカイブ済みの店舗への新規入力をRLS側でも遮断する(要件: UIを隠すだけでなく
-- サーバー側でも防止する)。s.status = 'active' の店舗以外はINSERTを拒否する。既存の
-- UPDATE/DELETE/SELECTポリシーは変更しない(過去データの閲覧・修正は引き続き可能)。
drop policy if exists daily_sales_insert_company_scoped on public.daily_sales;
create policy daily_sales_insert_company_scoped
  on public.daily_sales
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
        and created_by is not null
        and created_by = public.current_user_profile_id()
        and exists (
          select 1
          from public.stores s
          where s.id = daily_sales.store_id
            and s.company_id = daily_sales.company_id
            and s.status = 'active'
        )
        and (
          exists (
            select 1
            from public.profiles p
            where p.auth_user_id = auth.uid()
              and p.is_active = true
              and p.role = 'store_manager'
          )
          or (
            exists (
              select 1
              from public.profiles p
              where p.auth_user_id = auth.uid()
                and p.is_active = true
                and p.role = 'staff'
            )
            and business_date = (now() at time zone 'Asia/Tokyo')::date
          )
        )
      )
    )
  );

drop policy if exists monthly_targets_insert_company_scoped on public.monthly_targets;
create policy monthly_targets_insert_company_scoped
  on public.monthly_targets
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
      where s.id = monthly_targets.store_id
        and s.company_id = monthly_targets.company_id
        and s.status = 'active'
    )
  );

drop policy if exists fixed_costs_insert_company_scoped on public.fixed_costs;
create policy fixed_costs_insert_company_scoped
  on public.fixed_costs
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
      where s.id = fixed_costs.store_id
        and s.company_id = fixed_costs.company_id
        and s.status = 'active'
    )
  );

drop policy if exists variable_costs_insert_company_scoped on public.variable_costs;
create policy variable_costs_insert_company_scoped
  on public.variable_costs
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
    and exists (
      select 1 from public.stores s
      where s.id = variable_costs.store_id
        and s.company_id = variable_costs.company_id
        and s.status = 'active'
    )
  );
