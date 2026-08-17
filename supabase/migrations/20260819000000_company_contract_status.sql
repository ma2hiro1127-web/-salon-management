BEGIN;

-- 会社ごとの契約状態(トライアル/契約中/停止中)。companyForm側のUIは以前から
-- トライアル/契約中/停止中の3択セレクトを持っていたが、companiesテーブルに対応する列が
-- 存在せず、loadTenantStateFromSupabaseがcontractStatusを常に"active"へハードコードして
-- いたため、実際には一切保存されていなかった(「トライアルを選んでも会社作成後に契約中へ
-- 戻ってしまう」不具合の直接の原因)。既存のcompanies.is_active(単純なboolean)は他のどの
-- RLSポリシー・アプリロジックからも参照されていない未使用フラグだったため変更せず残す
-- (契約状態の実体はこの新しいcontract_statusへ一本化する)。
alter table public.companies
  add column if not exists contract_status text not null default 'trial'
    check (contract_status in ('trial', 'active', 'suspended'));

-- 既存のFi-Ne(サロン本社)は実運用中の本番会社であり、新規追加のトライアル会社ではないため、
-- デフォルト値の'trial'のままにせず明示的に'active'へ設定する。他の会社(将来追加分)には
-- 影響しない一意なUPDATE。
update public.companies set contract_status = 'active' where name = 'サロン本社';

COMMIT;
