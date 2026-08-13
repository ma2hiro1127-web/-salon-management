import { formatMoneyOrDash, formatPercentOrDash } from "../../utils/storage.js";

// 点4-10: 店舗別 主要指標比較表。列は指示された基本項目(店舗名/売上/目標達成率/人件費/
// 人件費率/発注費/発注費率/固定費/固定費率/広告費/営業利益/営業利益率/スタッフ生産性)に
// 絞り、色はマイナスの営業利益・営業利益率だけを赤字にする(それ以外は黒で統一、色の使い
// すぎを避ける)。店舗名列は.comparison-table td:first-child(App.css)でスマホでも左固定、
// 表全体は.table-wrapで横スクロールする。
export default function ComparisonTable({ storeRows = [], totals = null }) {
  if (!storeRows.length) {
    return <div className="empty-card">表示できる店舗がありません。</div>;
  }

  return (
    <div className="table-wrap">
      <table className="comparison-table">
        <thead>
          <tr>
            <th>店舗名</th>
            <th>売上</th>
            <th>目標達成率</th>
            <th>人件費</th>
            <th>人件費率</th>
            <th>発注費</th>
            <th>発注費率</th>
            <th>固定費</th>
            <th>固定費率</th>
            <th>広告費</th>
            <th>営業利益</th>
            <th>営業利益率</th>
            <th>スタッフ生産性</th>
          </tr>
        </thead>
        <tbody>
          {storeRows.map((row) => {
            const hasProfit = !row.isProvisionalProfit;
            return (
              <tr key={row.storeId}>
                <td>{row.storeName}</td>
                <td>{formatMoneyOrDash(row.sales)}</td>
                <td>{formatPercentOrDash(row.targetAchievement, row.hasSalesTarget)}</td>
                <td>{formatMoneyOrDash(row.laborCost, row.hasLaborData)}</td>
                <td>{formatPercentOrDash(row.laborRate, row.hasLaborData)}</td>
                <td>{formatMoneyOrDash(row.purchaseCost, row.hasPurchaseData)}</td>
                <td>{formatPercentOrDash(row.purchaseCostRate, row.hasPurchaseData)}</td>
                <td>{formatMoneyOrDash(row.fixedCost, row.hasFixedCostData)}</td>
                <td>{formatPercentOrDash(row.fixedCostRate, row.hasFixedCostData)}</td>
                <td>{formatMoneyOrDash(row.adCost, row.hasAdData)}</td>
                <td className={hasProfit && row.operatingProfit < 0 ? "text-danger" : ""}>{formatMoneyOrDash(row.operatingProfit, hasProfit)}</td>
                <td className={hasProfit && row.operatingMargin < 0 ? "text-danger" : ""}>{formatPercentOrDash(row.operatingMargin, hasProfit)}</td>
                <td>{formatMoneyOrDash(row.productivity.current, row.productivity.hasStaffCount)}</td>
              </tr>
            );
          })}
        </tbody>
        {totals ? (
          <tfoot>
            <tr className="comparison-table-total">
              <td>全店舗合計</td>
              <td>{formatMoneyOrDash(totals.totalSales)}</td>
              <td>{formatPercentOrDash(totals.targetAchievement, totals.hasSalesTarget)}</td>
              <td>{formatMoneyOrDash(totals.totalLaborCost, totals.hasLaborData)}</td>
              <td>{formatPercentOrDash(totals.laborRate, totals.hasLaborData)}</td>
              <td>{formatMoneyOrDash(totals.totalPurchaseCost, totals.hasPurchaseData)}</td>
              <td>{formatPercentOrDash(totals.purchaseCostRate, totals.hasPurchaseData)}</td>
              <td>{formatMoneyOrDash(totals.totalFixedCost, totals.hasFixedCostData)}</td>
              <td>{formatPercentOrDash(totals.fixedCostRate, totals.hasFixedCostData)}</td>
              <td>{formatMoneyOrDash(totals.totalAdCost, totals.hasAdData)}</td>
              <td className={!totals.isProvisionalProfit && totals.totalOperatingProfit < 0 ? "text-danger" : ""}>{formatMoneyOrDash(totals.totalOperatingProfit, !totals.isProvisionalProfit)}</td>
              <td className={!totals.isProvisionalProfit && totals.operatingMargin < 0 ? "text-danger" : ""}>{formatPercentOrDash(totals.operatingMargin, !totals.isProvisionalProfit)}</td>
              <td>{formatMoneyOrDash(totals.staffProductivity.current, totals.staffProductivity.hasStaffCount)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
