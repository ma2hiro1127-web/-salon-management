BEGIN;

-- 販売前総合チェックで発覚した重複インデックスの是正(daily_salesで見つかったものと同じ
-- パターン)。company_all_stores_holidays_company_id_holiday_date_key(UNIQUE制約)と
-- company_all_stores_holidays_month_idxが全く同じ列構成(company_id, holiday_date)で
-- 重複していた。UNIQUE制約側のインデックスがあれば非UNIQUE側は完全に不要
-- (後者が使えるクエリは前者でも必ず使える)——INSERT/UPDATEのたびに2つのインデックスを
-- 維持するコストだけがかかっていたため削除する。クエリ結果には一切影響しない。
DROP INDEX IF EXISTS public.company_all_stores_holidays_month_idx;

COMMIT;
