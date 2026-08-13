-- 月締めチェックリストの「対象外(非表示)」機能用。店舗ごとに、その店舗では基本的に使わない
-- 費用カテゴリ(costCategoryKeys、例: labor/materials等)のkeyを保持する。データ自体
-- (fixed_costs/cost_monthly_amounts)は一切削除・変更しない — あくまで月締め画面の一覧に
-- 出す/出さないだけを切り替えるフラグ。store_input_settingsは既存のdaily_fields等と
-- 同じ「company_id/store_id単位の店舗設定」テーブルなので、新しいテーブルは作らずカラムを
-- 追加する(RLSポリシーは既存のものがそのまま全カラムに適用される)。
alter table public.store_input_settings
  add column if not exists hidden_closing_categories jsonb not null default '[]'::jsonb;
