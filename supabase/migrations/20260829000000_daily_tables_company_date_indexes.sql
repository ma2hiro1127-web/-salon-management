BEGIN;

-- パフォーマンス調査(ログイン〜売上画面表示が遅い問題)で判明したインデックス不足・重複を
-- 是正する。hydrateFromSupabase(App.jsx)は毎回のログイン/store切替/対象月変更のたびに
-- daily_sales / daily_cash_breakdown / daily_batch_entries を「company_id一致 + 日付レンジ」
-- (store_idでは絞らない、会社内の全店舗を一度に取得する)で検索している。

-- 1. daily_sales: 既存は (company_id, store_id, business_date) の3列複合インデックスが
--    UNIQUE制約用に1つと、それと全く同じ列構成の非UNIQUEインデックスがもう1つ、計2つ
--    存在していた(daily_sales_company_id_store_id_business_date_key と
--    daily_sales_company_store_date_idx)。UNIQUE制約側のインデックスがあれば非UNIQUE側は
--    完全に不要(後者が使えるクエリは前者でも必ず使える) — INSERT/UPDATEのたびに2つの
--    インデックスを維持するコストだけがかかっていたため削除する。
--    代わりに、実際にhydrateFromSupabaseが使っている「company_id一致+business_dateの
--    範囲」というクエリ形(store_idでは絞らない)に直接対応する2列インデックスを追加する
--    — store_business_holidaysには既にこの形(company_id, holiday_date)のインデックスが
--    存在しており、daily_salesだけ抜けていた。3列複合インデックスはcompany_id単体の
--    絞り込みには使えるが、business_dateの範囲条件をインデックス条件として使うには
--    間のstore_idが確定している必要があるため、今回のクエリ形には最適ではない。
DROP INDEX IF EXISTS public.daily_sales_company_store_date_idx;

CREATE INDEX IF NOT EXISTS daily_sales_company_id_business_date_idx
  ON public.daily_sales (company_id, business_date);

-- 2. daily_cash_breakdown: 同じ「company_id一致+business_dateの範囲」検索
--    (loadDailyCashBreakdownForCompanyRange)を使うが、対応する複合インデックスが無く
--    company_id単体のインデックスしか無かった。
CREATE INDEX IF NOT EXISTS daily_cash_breakdown_company_id_business_date_idx
  ON public.daily_cash_breakdown (company_id, business_date);

-- 3. daily_batch_entries: 同じ形の検索(loadDailyBatchEntriesForCompanyRange、
--    start_date基準)を使うが、company_id単体のインデックスしか無かった。
CREATE INDEX IF NOT EXISTS daily_batch_entries_company_id_start_date_idx
  ON public.daily_batch_entries (company_id, start_date);

COMMIT;
