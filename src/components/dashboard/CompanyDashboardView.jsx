import { useMemo } from "react";
import { diffPercent, formatMoneyOrDash, formatPercentOrDash, formatDiffOrDash } from "../../utils/storage.js";
import StoreBarChartRow from "./StoreBarChartRow.jsx";
import ComparisonTable from "./ComparisonTable.jsx";
import StoreRankingCard from "./StoreRankingCard.jsx";

// 会社全体サマリーカード1枚分。可能な限り前月比を添える(前月データが無い店舗があっても、
// 会社全体としてどこか1店舗でも前月データがあればdiffPercentが計算値を返す)。
function SummaryCard({ label, value, diff, emphasize = false }) {
  return (
    <div className={`summary-card${emphasize ? " emphasize" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>前月比 {formatDiffOrDash(diff)}</small>
    </div>
  );
}

const sortDescByValue = (rows, pick) => [...rows].sort((a, b) => pick(b) - pick(a));

// 点3,4,5,11: 全店舗ダッシュボード。company全体の合計サマリー・店舗比較棒グラフ・比較表・
// ランキングを表示する。全店舗という新しい店舗レコードは作らず、companySummary(既にstorage.js
// 側でcompany.stores横断集計済み)を描画するだけ。
export default function CompanyDashboardView({ companySummary }) {
  const p = companySummary.previous;

  const salesRows = useMemo(() => sortDescByValue(companySummary.storeRows, (row) => row.sales), [companySummary.storeRows]);
  const profitRows = useMemo(() => sortDescByValue(companySummary.storeRows, (row) => row.operatingProfit), [companySummary.storeRows]);
  const marginRows = useMemo(() => sortDescByValue(companySummary.storeRows, (row) => row.operatingMargin), [companySummary.storeRows]);
  const productivityRows = useMemo(
    () => sortDescByValue(companySummary.storeRows.filter((row) => row.productivity.hasStaffCount), (row) => row.productivity.current),
    [companySummary.storeRows]
  );

  const maxSales = Math.max(1, ...salesRows.map((row) => row.sales));
  // 営業利益・営業利益率は人件費/材料費が未登録(isProvisionalProfit)の店舗を軸のスケール計算
  // からは除外する(算出できない値でスケールが歪まないようにする) — バー自体は「－」として
  // 全店舗分描画する。
  const maxAbsProfit = Math.max(1, ...profitRows.filter((row) => !row.isProvisionalProfit).map((row) => Math.abs(row.operatingProfit)));
  const maxMargin = Math.max(1, ...marginRows.filter((row) => !row.isProvisionalProfit).map((row) => Math.abs(row.operatingMargin)));
  const maxProductivity = Math.max(1, ...productivityRows.map((row) => row.productivity.current));

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">SUMMARY</p><h2>会社全体サマリー</h2></div>
        </div>
        <div className="summary-grid">
          <SummaryCard label="総売上" value={formatMoneyOrDash(companySummary.totalSales)} diff={diffPercent(companySummary.totalSales, p.totalSales, p.hasPrevious)} emphasize />
          <SummaryCard
            label="営業利益"
            value={formatMoneyOrDash(companySummary.totalOperatingProfit, !companySummary.isProvisionalProfit)}
            diff={diffPercent(companySummary.totalOperatingProfit, p.totalOperatingProfit, p.hasPrevious && !companySummary.isProvisionalProfit && !p.isProvisionalProfit)}
            emphasize
          />
          <SummaryCard
            label="営業利益率"
            value={formatPercentOrDash(companySummary.operatingMargin, !companySummary.isProvisionalProfit)}
            diff={diffPercent(companySummary.operatingMargin, p.operatingMargin, p.hasPrevious && !companySummary.isProvisionalProfit && !p.isProvisionalProfit)}
          />
          <SummaryCard
            label="総人件費"
            value={formatMoneyOrDash(companySummary.totalLaborCost, companySummary.hasLaborData)}
            diff={diffPercent(companySummary.totalLaborCost, p.totalLaborCost, p.hasPrevious && companySummary.hasLaborData && p.hasLaborData)}
          />
          <SummaryCard
            label="人件費率"
            value={formatPercentOrDash(companySummary.laborRate, companySummary.hasLaborData)}
            diff={diffPercent(companySummary.laborRate, p.laborRate, p.hasPrevious && companySummary.hasLaborData && p.hasLaborData)}
          />
          <SummaryCard
            label="発注費"
            value={formatMoneyOrDash(companySummary.totalPurchaseCost, companySummary.hasPurchaseData)}
            diff={diffPercent(companySummary.totalPurchaseCost, p.totalPurchaseCost, p.hasPrevious && companySummary.hasPurchaseData && p.hasPurchaseData)}
          />
          <SummaryCard
            label="発注費率"
            value={formatPercentOrDash(companySummary.purchaseCostRate, companySummary.hasPurchaseData)}
            diff={diffPercent(companySummary.purchaseCostRate, p.purchaseCostRate, p.hasPrevious && companySummary.hasPurchaseData && p.hasPurchaseData)}
          />
          <SummaryCard
            label="スタッフ1人あたり生産性"
            value={formatMoneyOrDash(companySummary.staffProductivity.current, companySummary.staffProductivity.hasStaffCount)}
            diff={diffPercent(companySummary.staffProductivity.current, p.staffProductivity.current, p.hasPrevious && p.staffProductivity.hasStaffCount)}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">COMPARISON</p><h2>店舗比較</h2></div>
        </div>
        <h3 className="panel-subheading">店舗別売上</h3>
        <div className="dashboard-bar-group">
          {salesRows.map((row) => (
            <StoreBarChartRow key={row.storeId} label={row.storeName} value={row.sales} maxValue={maxSales} formattedValue={formatMoneyOrDash(row.sales)} />
          ))}
        </div>
        <h3 className="panel-subheading">店舗別営業利益</h3>
        <div className="dashboard-bar-group">
          {profitRows.map((row) => (
            <StoreBarChartRow
              key={row.storeId} label={row.storeName} value={row.operatingProfit} maxValue={maxAbsProfit}
              formattedValue={formatMoneyOrDash(row.operatingProfit)} danger={row.operatingProfit < 0}
              hasData={!row.isProvisionalProfit}
            />
          ))}
        </div>
        <h3 className="panel-subheading">店舗別営業利益率</h3>
        <div className="dashboard-bar-group">
          {marginRows.map((row) => (
            <StoreBarChartRow
              key={row.storeId} label={row.storeName} value={row.operatingMargin} maxValue={maxMargin}
              formattedValue={formatPercentOrDash(row.operatingMargin)} danger={row.operatingMargin < 0}
              hasData={!row.isProvisionalProfit}
            />
          ))}
        </div>
        <h3 className="panel-subheading">スタッフ生産性(総売上÷スタッフ換算人数)</h3>
        {productivityRows.length === 0 ? (
          <p className="dashboard-hint">スタッフ数が設定されている店舗がありません。</p>
        ) : (
          <div className="dashboard-bar-group">
            {productivityRows.map((row) => (
              <StoreBarChartRow key={row.storeId} label={row.storeName} value={row.productivity.current} maxValue={maxProductivity} formattedValue={formatMoneyOrDash(row.productivity.current)} />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">DETAIL</p><h2>店舗別主要指標一覧</h2></div>
        </div>
        <ComparisonTable storeRows={companySummary.storeRows} />
      </section>

      <StoreRankingCard storeRows={companySummary.storeRows} />
    </div>
  );
}
