-- 契約終了後の閲覧専用モード(2026-09-16)。
--
-- 目的: 契約終了(companies.contract_status = 'suspended')または論理削除済み(deleted_at
-- 設定済み)の会社について、業務データの SELECT (閲覧) は引き続き許可しつつ、
-- INSERT/UPDATE/DELETE (書き込み) だけを DB (RLS) レベルで一律禁止する。
--
-- 「フロントで入力ボタンを隠すだけでは不十分」という要件のため、ブラウザ開発者ツール・
-- 直接API・古い画面キャッシュ経由の書き込みも構造的に拒否できるよう、RLSの
-- RESTRICTIVE POLICY として実装する。RESTRICTIVE POLICYは既存の PERMISSIVE POLICY群と
-- AND条件で合成される(Postgresの仕様)ため、各テーブルの既存のcompany_scoped系ポリシーの
-- 定義を一切書き換えずに、その上から「契約が有効な会社のみ許可する」という追加条件を
-- かぶせられる — 既存の権限モデル(会社/店舗/ロール分離)を壊すリスクを最小化する設計。
--
-- system_adminはこの制限の対象外(既存のApp.jsx側の利用停止ゲートも同様にsystem_admin
-- だけは常に操作できる設計になっており、それと一致させる——契約終了会社のデータ復旧・
-- サポート対応に必要なため)。

-- ------------------------------------------------------------------
-- 1. 判定関数: 会社が「書き込み可能」かどうかを1箇所で判定する
-- ------------------------------------------------------------------
create or replace function public.is_company_writable(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- 呼び出し元がアクティブなsystem_adminなら常に書き込み可(復旧・サポート対応のため)。
    coalesce(
      (select role from public.profiles
       where auth_user_id = auth.uid() and is_active = true
       limit 1) = 'system_admin',
      false
    )
    or
    -- それ以外は、対象会社の契約が有効(suspendedでない・論理削除されていない)かどうかで判定する。
    coalesce(
      (select contract_status is distinct from 'suspended' and deleted_at is null
       from public.companies
       where id = target_company_id),
      false
    );
$$;

comment on function public.is_company_writable(uuid) is
  '契約終了(suspended)・論理削除済みの会社への書き込みをRLSで一律拒否するための判定関数。system_adminは対象外。SELECTには使わない(閲覧は常に許可する)。';

revoke all on function public.is_company_writable(uuid) from public;
grant execute on function public.is_company_writable(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 2. 対象テーブルへ RESTRICTIVE POLICY を追加する
--    (tenant_snapshotsは「真実のソースではないレガシーな高速表示用キャッシュ」であり
--     業務データではないため対象外。companies自体・system_admin専用テーブル・
--     support/beta_feedback等の非業務データテーブルも対象外。)
-- ------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'company_settings',
    'cost_monthly_amounts',
    'daily_batch_entries',
    'daily_cash_breakdown',
    'daily_sales',
    'fixed_costs',
    'monthly_closing_items',
    'monthly_closings',
    'monthly_targets',
    'profiles',
    'store_business_holidays',
    'store_input_settings',
    'store_inventory_balances',
    'store_monthly_cost_overrides',
    'store_profiles',
    'stores',
    'user_stores',
    'variable_costs',
    'company_all_stores_holidays',
    'company_all_stores_targets'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t || '_insert_restrict_suspended', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to public with check (public.is_company_writable(company_id))',
      t || '_insert_restrict_suspended', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_update_restrict_suspended', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to public using (public.is_company_writable(company_id)) with check (public.is_company_writable(company_id))',
      t || '_update_restrict_suspended', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_delete_restrict_suspended', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to public using (public.is_company_writable(company_id))',
      t || '_delete_restrict_suspended', t
    );
  end loop;
end $$;
