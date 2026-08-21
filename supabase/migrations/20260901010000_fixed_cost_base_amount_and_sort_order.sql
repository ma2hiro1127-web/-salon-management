-- 固定費・継続費用の再設計:
-- (1) 継続費用(period_type='ongoing')の「基本値」をfixed_costs自体に持たせ、
--     cost_monthly_amountsは「その月だけの上書き値」専用にする(キャリーフォワードをやめる)。
--     これにより、対象月だけ金額を変更しても翌月以降は自動的に基本値へ戻るようになる
--     (旧仕様は対象月以前で最も新しい行を引き継ぐ設計だったため、一度変更すると未来の月にも
--     ずっと引き継がれてしまっていた)。単月・期間限定費用(period_type='limited')は
--     引き続きcost_monthly_amountsのキャリーフォワード仕様のまま(アプリ側のロジックで分岐)。
-- (2) 表示順序をsort_orderで明示管理する。ORDER BYの無いSELECTはPostgreSQLの物理行順序に
--     依存し、UPDATE後に順序が変わり得る(「金額を変更した項目が一覧の一番下へ移動する」
--     不具合の原因)。
alter table public.fixed_costs
  add column if not exists base_amount numeric not null default 0;

alter table public.fixed_costs
  add column if not exists sort_order integer;

-- 既存行の並び順を維持したまま(店舗ごとに作成日時の古い順)sort_orderを割り当てる。
with ranked as (
  select id, row_number() over (partition by store_id order by created_at, id) as rn
  from public.fixed_costs
)
update public.fixed_costs fc
set sort_order = ranked.rn
from ranked
where fc.id = ranked.id and fc.sort_order is null;

alter table public.fixed_costs alter column sort_order set default 0;
alter table public.fixed_costs alter column sort_order set not null;

create index if not exists fixed_costs_store_sort_order_idx on public.fixed_costs(store_id, sort_order);

-- 継続費用の基本値を、その項目のcost_monthly_amountsのうち最も新しい対象月の金額から
-- バックフィルする(=現在ユーザーの目に見えている「今の金額」をそのまま基本値として引き継ぐ)。
-- 1件もcost_monthly_amountsが無い場合は旧fixed_costs.amount(最後の手段)を使う。
update public.fixed_costs fc
set base_amount = coalesce(
  (
    select cma.amount
    from public.cost_monthly_amounts cma
    where cma.cost_item_id = fc.id
    order by cma.target_month desc
    limit 1
  ),
  fc.amount,
  0
)
where fc.period_type = 'ongoing';
