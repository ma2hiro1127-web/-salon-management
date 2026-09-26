import { diffPercent, formatMoneyOrDash, formatPercentOrDash, formatDiffOrDash } from "../../utils/storage.js";

// 前月比は「小さな補助表示」として数値カードに添えるだけにする(2026-09全面改訂・要件3:
// 前月比較専用の大きなセクションは持たない)。値そのものが無い(比較不能)場合はhintごと
// 出さない——formatDiffOrDashが返す「－」を積極的に見せる必要は無いため。
function SummaryCard({ label, value, diff, emphasize = false }) {
  return (
    <div className={`summary-card${emphasize ? " emphasize" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {diff !== null && diff !== undefined ? <small>前月比 {formatDiffOrDash(diff)}</small> : null}
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

// 店舗単体の経営ダッシュボード(2026-09全面改訂: 役割を「利益・コストを見るページ」に
// 一本化)。客数・客単価・口コミ数等の営業KPIは日次の売上ページで既に確認できるため、
// ここでは主役にしない(重複表示の解消)——calculateMonthSummary(当月・前月)+
// getStaffProductivitySummaryの組み合わせだけで全項目が揃うため、専用の集計関数は
// 作らずここで組み立てる(既存ロジックの再利用のみ、新しい計算式は追加していない)。
export default function StoreDashboardView({ storeName, summary, previousSummary, productivity, previousProductivity }) {
  // 不具合修正: 前月の実績が「まとめて入力」(daily_batch_entries)だけで構成されている場合、
  // 通常の日次入力(entries)はゼロ件になるため、entries.lengthだけを見ると前月比較が
  // 「比較データなし」に誤判定されていた(storage.jsのgetStoreDashboardRows等と同じ基準に
  // 統一する)。
  const hasPrevious = previousSummary.entries.length > 0 || previousSummary.batchEntries.length > 0;
  const target = summary.target || {};
  const hasProfitData = !summary.isProvisionalProfit && !previousSummary.isProvisionalProfit;
  const hasLaborData = Boolean(summary.categoryHasEntry?.labor) && Boolean(previousSummary.categoryHasEntry?.labor);
  const hasMaterialData = Boolean(summary.categoryHasEntry?.materials) && Boolean(previousSummary.categoryHasEntry?.materials);
  const hasFixedData = Boolean(summary.hasFixedCostData) && Boolean(previousSummary.hasFixedCostData);
  const fixedCostRate = summary.sales > 0 ? (summary.fixedCost / summary.sales) * 100 : 0;
  const previousFixedCostRate = previousSummary.sales > 0 ? (previousSummary.fixedCost / previousSummary.sales) * 100 : 0;

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">SUMMARY</p><h2>{storeName} 経営サマリー</h2></div>
        </div>
        <div className="summary-grid">
          <SummaryCard
            label="総売上"
            value={formatMoneyOrDash(summary.sales)}
            diff={diffPercent(summary.sales, previousSummary.sales, hasPrevious)}
            emphasize
          />
          <SummaryCard
            label="営業利益"
            value={formatMoneyOrDash(summary.operatingProfit, !summary.isProvisionalProfit)}
            diff={diffPercent(summary.operatingProfit, previousSummary.operatingProfit, hasPrevious && hasProfitData)}
            emphasize
          />
          <SummaryCard
            label="営業利益率"
            value={formatPercentOrDash(summary.operatingMargin, !summary.isProvisionalProfit)}
            diff={diffPercent(summary.operatingMargin, previousSummary.operatingMargin, hasPrevious && hasProfitData)}
          />
          <SummaryCard
            label="人件費率"
            value={formatPercentOrDash(summary.laborRate, Boolean(summary.categoryHasEntry?.labor))}
            diff={diffPercent(summary.laborRate, previousSummary.laborRate, hasPrevious && hasLaborData)}
          />
          <SummaryCard
            label="発注費率(材料費率)"
            value={formatPercentOrDash(summary.costOfGoodsSoldRate, Boolean(summary.categoryHasEntry?.materials))}
            diff={diffPercent(summary.costOfGoodsSoldRate, previousSummary.costOfGoodsSoldRate, hasPrevious && hasMaterialData)}
          />
          <SummaryCard
            label="固定費率"
            value={formatPercentOrDash(fixedCostRate, summary.hasFixedCostData && summary.sales > 0)}
            diff={diffPercent(fixedCostRate, previousFixedCostRate, hasPrevious && hasFixedData)}
          />
          <SummaryCard
            label="スタッフ生産性"
            value={formatMoneyOrDash(productivity.current, productivity.hasStaffCount)}
            diff={diffPercent(productivity.current, previousProductivity.current, hasPrevious && previousProductivity.hasStaffCount)}
          />
          <SummaryCard label="月間目標売上" value={formatMoneyOrDash(target.targetSales, Boolean(target.targetSales))} />
          <SummaryCard label="目標達成率" value={formatPercentOrDash(summary.targetAchievement, Boolean(target.targetSales))} />
        </div>
        {summary.isProvisionalProfit ? (
          <p className="dashboard-hint">※人件費または発注費(材料原価)が未入力のため、営業利益は算出できません。</p>
        ) : null}
      </section>

      {(target.targetOperatingMargin || target.targetLaborRate || target.targetMaterialRate) ? (
        <section className="panel">
          <div className="panel-heading">
            <div><p className="eyebrow">TARGET</p><h2>目標・基準との比較</h2></div>
          </div>
          <div className="summary-grid">
            {target.targetOperatingMargin ? (
              <KpiCard label="営業利益率" actualText={formatPercentOrDash(summary.operatingMargin, !summary.isProvisionalProfit)} targetValue={target.targetOperatingMargin} formatTarget={(v) => `${v}%`} />
            ) : null}
            {target.targetLaborRate ? (
              <KpiCard label="人件費率" actualText={formatPercentOrDash(summary.laborRate, Boolean(summary.categoryHasEntry?.labor))} targetValue={target.targetLaborRate} formatTarget={(v) => `${v}%`} />
            ) : null}
            {target.targetMaterialRate ? (
              <KpiCard label="発注費率(材料費率)" actualText={formatPercentOrDash(summary.costOfGoodsSoldRate, Boolean(summary.categoryHasEntry?.materials))} targetValue={target.targetMaterialRate} formatTarget={(v) => `${v}%`} />
            ) : null}
          </div>
        </section>
      ) : null}

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
                <td>{formatPercentOrDash(fixedCostRate, summary.hasFixedCostData && summary.sales > 0)}</td>
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
