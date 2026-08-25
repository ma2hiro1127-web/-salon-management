import { useMemo, useState } from "react";
import { formatMoneyOrDash, formatPercentOrDash } from "../../utils/storage.js";

const RANKING_METRICS = [
  { key: "sales", label: "売上" },
  { key: "operatingProfit", label: "営業利益" },
  { key: "operatingMargin", label: "営業利益率" },
  { key: "productivity", label: "スタッフ生産性" },
  { key: "averageSpend", label: "客単価" },
  { key: "newCustomers", label: "新規客数" },
  { key: "retailRatio", label: "店販率" },
];

// 各指標の値・「データがあるか」・%表示かどうかを1箇所にまとめる(既存のcategoryHasEntry等と
// 同じ「0とデータ無しを区別する」規約を、ランキングでもそのまま踏襲する)。
const getDashboardRankingMetric = (row, metricKey) => {
  switch (metricKey) {
    case "operatingProfit": return { value: row.operatingProfit, hasData: !row.isProvisionalProfit, isPercent: false };
    case "operatingMargin": return { value: row.operatingMargin, hasData: !row.isProvisionalProfit, isPercent: true };
    case "productivity": return { value: row.productivity.current, hasData: row.productivity.hasStaffCount, isPercent: false };
    case "averageSpend": return { value: row.averageSpend, hasData: row.hasCustomerData, isPercent: false };
    case "newCustomers": return { value: row.newCustomers, hasData: row.hasCustomerData, isPercent: false };
    case "retailRatio": return { value: row.retailRatio, hasData: row.hasRetailData, isPercent: true };
    case "sales":
    default: return { value: row.sales, hasData: true, isPercent: false };
  }
};

const RANK_MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };

// 点11: 店舗ランキング。切替可能な7指標で1位〜最下位まで表示する。データが無い店舗(スタッフ数
// 未設定など)は順位付けせず末尾に「－」で表示し、ランキングだけで断定しない旨を注記する。
export default function StoreRankingCard({ storeRows = [] }) {
  const [metricKey, setMetricKey] = useState("sales");

  const sortedRows = useMemo(() => {
    const withMetric = storeRows.map((row) => ({ row, metric: getDashboardRankingMetric(row, metricKey) }));
    const withData = withMetric.filter((item) => item.metric.hasData).sort((a, b) => b.metric.value - a.metric.value);
    const withoutData = withMetric.filter((item) => !item.metric.hasData);
    return [...withData, ...withoutData];
  }, [storeRows, metricKey]);

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">RANKING</p>
          <h2>店舗ランキング</h2>
        </div>
        <select className="dashboard-print-hide" value={metricKey} onChange={(event) => setMetricKey(event.target.value)}>
          {RANKING_METRICS.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
        </select>
      </div>
      {sortedRows.length === 0 ? (
        <div className="empty-card">表示できる店舗がありません。</div>
      ) : (
        <div className="list-card">
          {sortedRows.map((item, index) => {
            const rank = item.metric.hasData ? index + 1 : null;
            const formattedValue = !item.metric.hasData
              ? "－"
              : item.metric.isPercent
                ? formatPercentOrDash(item.metric.value)
                : formatMoneyOrDash(item.metric.value);
            return (
              <div key={item.row.storeId} className="list-row store-ranking-row">
                <strong className="store-ranking-row-name">{rank ? (RANK_MEDAL[rank] || `${rank}位`) : "－"} {item.row.storeName}</strong>
                <strong className="store-ranking-row-value">{formattedValue}</strong>
              </div>
            );
          })}
        </div>
      )}
      <p className="dashboard-hint">※ランキングは一つの目安です。数値の背景(客層・立地・営業日数など)も踏まえてご確認ください。</p>
    </section>
  );
}
