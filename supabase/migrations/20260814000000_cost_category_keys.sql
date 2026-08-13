-- 費用に固定の英語category_key(会計処理目的ではなく経営分析・AI分析目的の10分類)を追加する。
-- 費用名(自由入力、例:「HPB」)とは別にこのカテゴリを持たせることで、日本語の表示名を
-- 将来変更しても過去データの集計・AI分析には影響しない構造にする。既存カラム(category含む)・
-- 既存行は一切削除・変更しない。
--
-- バックフィルは、依頼で明示された対応例および新カテゴリ名と自由入力categoryが確実に一致する
-- ものだけに限定する(推測で誤分類しない)。判断できない行はすべて'uncategorized'(未分類)の
-- まま残し、後からユーザーが費用入力画面で設定し直せるようにする。

alter table public.fixed_costs
  add column if not exists category_key text not null default 'uncategorized'
    check (category_key in ('rent','labor','advertising','utilities','communication','materials','cleaning','system','tax_insurance','other','uncategorized'));

alter table public.monthly_closing_items
  add column if not exists category_key text not null default 'uncategorized'
    check (category_key in ('rent','labor','advertising','utilities','communication','materials','cleaning','system','tax_insurance','other','uncategorized'));

-- variable_costsには現在書き込みUIが無い(読み取り専用の過去データ)が、calculateMonthSummaryの
-- カテゴリ別集計に古い行も正しく参加できるよう、同じcategory_keyを持たせておく。
alter table public.variable_costs
  add column if not exists category_key text not null default 'uncategorized'
    check (category_key in ('rent','labor','advertising','utilities','communication','materials','cleaning','system','tax_insurance','other','uncategorized'));

-- fixed_costs: costCategories(費用入力の選択肢)のうち、新カテゴリ名と一致が明確なものだけ変換
update public.fixed_costs set category_key = 'rent' where category_key = 'uncategorized' and category = '家賃';
update public.fixed_costs set category_key = 'advertising' where category_key = 'uncategorized' and category in ('広告費', '定額広告費');
update public.fixed_costs set category_key = 'utilities' where category_key = 'uncategorized' and category = '光熱費';
update public.fixed_costs set category_key = 'communication' where category_key = 'uncategorized' and category = '通信費';
update public.fixed_costs set category_key = 'system' where category_key = 'uncategorized' and category = 'システム利用料';
-- 費用名にHPB/ホットペッパー/社会保険が含まれる場合(依頼の明示例)
update public.fixed_costs set category_key = 'advertising' where category_key = 'uncategorized' and (name ilike '%HPB%' or name ilike '%ホットペッパー%');
update public.fixed_costs set category_key = 'labor' where category_key = 'uncategorized' and name ilike '%社会保険%';

-- monthly_closing_items: 既存の3カテゴリ(closingCategories)は新カテゴリへの対応が明確
update public.monthly_closing_items set category_key = 'labor' where category_key = 'uncategorized' and category = '人件費';
update public.monthly_closing_items set category_key = 'materials' where category_key = 'uncategorized' and category in ('仕入・発注額', '材料費', '発注費');
update public.monthly_closing_items set category_key = 'advertising' where category_key = 'uncategorized' and (name ilike '%HPB%' or name ilike '%ホットペッパー%');
update public.monthly_closing_items set category_key = 'labor' where category_key = 'uncategorized' and name ilike '%社会保険%';

-- variable_costs: 同様に明確な一致のみ
update public.variable_costs set category_key = 'advertising' where category_key = 'uncategorized' and category = '広告費';
update public.variable_costs set category_key = 'advertising' where category_key = 'uncategorized' and (name ilike '%HPB%' or name ilike '%ホットペッパー%');
