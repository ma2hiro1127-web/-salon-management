BEGIN;

-- 契約状態を trial/active/suspended の3種類から、知人・テスト協力サロン向けの「無料利用」
-- (free)を加えた4種類へ拡張する。既存行のcontract_statusはそのまま(このマイグレーションは
-- 制約の許容値を広げるだけで、どの行の値も書き換えない)。将来「30日間トライアル」等の
-- 期限設定やセルフ登録・自動課金を追加する場合も、この列自体は単純なenumのまま拡張できる
-- 設計にしてある(期限はtrial_expires_at等の別列を後から追加すればよく、今回は追加しない)。
alter table public.companies
  drop constraint if exists companies_contract_status_check;

alter table public.companies
  add constraint companies_contract_status_check
  check (contract_status in ('free', 'trial', 'active', 'suspended'));

COMMIT;
