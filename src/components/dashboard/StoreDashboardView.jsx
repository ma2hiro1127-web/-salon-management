import { diffPercent, formatMoneyOrDash, formatPercentOrDash, formatDiffOrDash } from "../../utils/storage.js";

function SummaryCard({ label, value, hint, emphasize = false }) {
  return (
    <div className={`summary-card${emphasize ? " emphasize" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function MomCard({ label, formattedValue, diff }) {
  return (
    <div className="summary-card compact">
      <span>{label}</span>
      <strong>{formattedValue}</strong>
      <small>前月比 {formatDiffOrDash(diff)}</small>
    </div>
  );
}

// KPIの「実績 / 目標」表示。目標が未設定(0/未入力)の場合は目標側を表示しない
// (0を「目標0」と誤解させないため — targetの真偽で判定する)。
function KpiCard({ label, actualText, targetValue, formatTarget }) {
  const hasTarget = Boolean(targetValue);
  return (
    <div className="summary-card compact">
      <span>{label}</span>
      <strong>{actualText}</strong>
      {hasTarget ? <small>目標 {formatTarget(targetValue)}</small> : null}
    </div>
  );
}

// 点6,7,8: 店舗単体ダッシュボード。calculateMonthSummary(当月・前月)+getStaffProductivitySummary
// の組み合わせだけで全項目が揃うため、専用の集計関数は作らずここで組み立てる。
export default function StoreDashboardView({ storeName, summary, previousSummary, productivity, previousProductivity }) {
  const hasPrevious = previousSummary.entries.length > 0;
  const target = summary.target || {};

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">SUMMARY</p><h2>{storeName} サマリー</h2></div>
        </div>
        <div className="summary-grid">
          <SummaryCard label="総売上" value={formatMoneyOrDash(summary.sales)} emphasize />
          <SummaryCard label="月間目標売上" value={formatMoneyOrDash(target.targetSales, Boolean(target.targetSales))} />
          <SummaryCard label="目標達成率" value={formatPercentOrDash(summary.targetAchievement, Boolean(target.targetSales))} />
          <SummaryCard label="営業利益" value={formatMoneyOrDash(summary.operatingProfit, !summary.isProvisionalProfit)} emphasize />
          <SummaryCard label="営業利益率" value={formatPercentOrDash(summary.operatingMargin, !summary.isProvisionalProfit)} />
          <SummaryCard label="人件費率" value={formatPercentOrDash(summary.laborRate, Boolean(summary.categoryHasEntry?.labor))} />
          <SummaryCard label="発注費率" value={formatPercentOrDash(summary.costOfGoodsSoldRate, Boolean(summary.categoryHasEntry?.materials))} />
          <SummaryCard label="スタッフ生産性" value={formatMoneyOrDash(productivity.current, productivity.hasStaffCount)} />
        </div>
        {summary.isProvisionalProfit ? (
          <p className="dashboard-hint">※人件費または発注費(材料原価)が未入力のため、営業利益は算出できません。</p>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">MOM</p><h2>前月比較</h2></div>
        </div>
        <div className="summary-grid">
          <MomCard label="売上" formattedValue={formatMoneyOrDash(summary.sales)} diff={diffPercent(summary.sales, previousSummary.sales, hasPrevious)} />
          <MomCard label="客数" formattedValue={summary.customers} diff={diffPercent(summary.customers, previousSummary.customers, hasPrevious)} />
          <MomCard label="客単価" formattedValue={formatMoneyOrDash(summary.averageSpend, summary.customers > 0)} diff={diffPercent(summary.averageSpend, previousSummary.averageSpend, hasPrevious && previousSummary.customers > 0)} />
          <MomCard label="新規客数" formattedValue={summary.newCustomers} diff={diffPercent(summary.newCustomers, previousSummary.newCustomers, hasPrevious)} />
          <MomCard label="店販売上" formattedValue={formatMoneyOrDash(summary.retailSales)} diff={diffPercent(summary.retailSales, previousSummary.retailSales, hasPrevious)} />
          <MomCard
            label="営業利益"
            formattedValue={formatMoneyOrDash(summary.operatingProfit, !summary.isProvisionalProfit)}
            diff={diffPercent(summary.operatingProfit, previousSummary.operatingProfit, hasPrevious && !summary.isProvisionalProfit && !previousSummary.isProvisionalProfit)}
          />
          <MomCard
            label="営業利益率"
            formattedValue={formatPercentOrDash(summary.operatingMargin, !summary.isProvisionalProfit)}
            diff={diffPercent(summary.operatingMargin, previousSummary.operatingMargin, hasPrevious && !summary.isProvisionalProfit && !previousSummary.isProvisionalProfit)}
          />
          <MomCard
            label="スタッフ生産性"
            formattedValue={formatMoneyOrDash(productivity.current, productivity.hasStaffCount)}
            diff={diffPercent(productivity.current, previousProductivity.current, hasPrevious && previousProductivity.hasStaffCount)}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">SALES KPI</p><h2>売上KPI</h2></div>
        </div>
        <div className="summary-grid">
          <KpiCard label="技術売上" actualText={formatMoneyOrDash(summary.technicalSales)} targetValue={target.targetTechnicalSales} formatTarget={(v) => formatMoneyOrDash(v)} />
          <KpiCard label="店販売上" actualText={formatMoneyOrDash(summary.retailSales)} targetValue={target.targetRetailSales} formatTarget={(v) => formatMoneyOrDash(v)} />
          <KpiCard label="総客数" actualText={summary.customers} targetValue={target.targetCustomers} formatTarget={(v) => `${v}人`} />
          <KpiCard label="客単価" actualText={formatMoneyOrDash(summary.averageSpend, summary.customers > 0)} targetValue={target.targetAverageSpend} formatTarget={(v) => formatMoneyOrDash(v)} />
          <KpiCard label="新規客数" actualText={summary.newCustomers} targetValue={target.targetNewCustomers} formatTarget={(v) => `${v}人`} />
          <KpiCard label="再来客数" actualText={summary.repeatCustomers} targetValue={target.targetRepeatCustomers} formatTarget={(v) => `${v}人`} />
          <SummaryCard label="新規率" value={formatPercentOrDash(summary.customers > 0 ? (summary.newCustomers / summary.customers) * 100 : 0, summary.customers > 0)} />
          <KpiCard label="再来率" actualText={formatPercentOrDash(summary.repeatRate, summary.customers > 0)} targetValue={target.targetRepeatRate} formatTarget={(v) => `${v}%`} />
          <KpiCard label="口コミ数" actualText={summary.reviewCount} targetValue={target.targetReviewCount} formatTarget={(v) => `${v}件`} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">COST</p><h2>コスト構成</h2></div>
        </div>
        <div className="table-wrap">
          <table className="dashboard-cost-table">
            <thead><tr><th>費用カテゴリ</th><th>金額</th><th>売上比率</th></tr></thead>
            <tbody>
              <tr>
                <td>人件費</td>
                <td>{formatMoneyOrDash(summary.laborCost, Boolean(summary.categoryHasEntry?.labor))}</td>
                <td>{formatPercentOrDash(summary.laborRate, Boolean(summary.categoryHasEntry?.labor))}</td>
              </tr>
              <tr>
                <td>発注費(材料原価)</td>
                <td>{formatMoneyOrDash(summary.costOfGoodsSold, Boolean(summary.categoryHasEntry?.materials))}</td>
                <td>{formatPercentOrDash(summary.costOfGoodsSoldRate, Boolean(summary.categoryHasEntry?.materials))}</td>
              </tr>
              <tr>
                <td>固定費(家賃・光熱費・通信費・清掃環境費・システム利用料・税金保険・その他費用)</td>
                <td>{formatMoneyOrDash(summary.fixedCost, summary.hasFixedCostData)}</td>
                <td>{formatPercentOrDash(summary.sales > 0 ? (summary.fixedCost / summary.sales) * 100 : 0, summary.hasFixedCostData && summary.sales > 0)}</td>
              </tr>
              <tr>
                <td>広告費</td>
                <td>{formatMoneyOrDash(summary.adCost, Boolean(summary.categoryHasEntry?.advertising))}</td>
                <td>{formatPercentOrDash(summary.adRate, Boolean(summary.categoryHasEntry?.advertising))}</td>
              </tr>
              {summary.categoryHasEntry?.uncategorized ? (
                <tr>
                  <td>未分類</td>
                  <td>{formatMoneyOrDash(summary.costsByCategory?.uncategorized ?? 0)}</td>
                  <td>{formatPercentOrDash(summary.sales > 0 ? ((summary.costsByCategory?.uncategorized ?? 0) / summary.sales) * 100 : 0, summary.sales > 0)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
