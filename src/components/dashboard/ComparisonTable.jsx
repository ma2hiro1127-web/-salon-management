import { diffPercent, formatMoneyOrDash, formatPercentOrDash, formatDiffOrDash } from "../../utils/storage.js";

// 点5: 店舗別主要指標一覧。PCでは表、スマホでは既存の.table-wrap(overflow-x:auto、App.css)を
// 使って横スクロールにする — 1実装でPC/スマホ両方の要件を満たす(専用のカードUIは別途作らない)。
export default function ComparisonTable({ storeRows = [] }) {
  if (!storeRows.length) {
    return <div className="empty-card">表示できる店舗がありません。</div>;
  }

  return (
    <div className="table-wrap">
      <table className="comparison-table">
        <thead>
          <tr>
            <th>店舗名</th>
            <th>総売上</th>
            <th>前月比</th>
            <th>客数</th>
            <th>客単価</th>
            <th>新規客数</th>
            <th>新規率</th>
            <th>店販売上</th>
            <th>店販率</th>
            <th>人件費</th>
            <th>人件費率</th>
            <th>発注費</th>
            <th>発注費率</th>
            <th>固定費</th>
            <th>固定費率</th>
            <th>営業利益</th>
            <th>営業利益率</th>
            <th>スタッフ数(FTE)</th>
            <th>スタッフ生産性</th>
          </tr>
        </thead>
        <tbody>
          {storeRows.map((row) => {
            const salesDiff = diffPercent(row.sales, row.previous.sales, row.previous.hasPrevious);
            return (
              <tr key={row.storeId}>
                <td>{row.storeName}</td>
                <td>{formatMoneyOrDash(row.sales)}</td>
                <td>{formatDiffOrDash(salesDiff)}</td>
                <td>{row.hasCustomerData ? row.customers : "－"}</td>
                <td>{formatMoneyOrDash(row.averageSpend, row.hasCustomerData)}</td>
                <td>{row.hasCustomerData ? row.newCustomers : "－"}</td>
                <td>{formatPercentOrDash(row.newCustomerRate, row.hasCustomerData)}</td>
                <td>{formatMoneyOrDash(row.retailSales)}</td>
                <td>{formatPercentOrDash(row.retailRatio, row.hasRetailData)}</td>
                <td>{formatMoneyOrDash(row.laborCost, row.hasLaborData)}</td>
                <td>{formatPercentOrDash(row.laborRate, row.hasLaborData)}</td>
                <td>{formatMoneyOrDash(row.purchaseCost, row.hasPurchaseData)}</td>
                <td>{formatPercentOrDash(row.purchaseCostRate, row.hasPurchaseData)}</td>
                <td>{formatMoneyOrDash(row.fixedCost, row.hasFixedCostData)}</td>
                <td>{formatPercentOrDash(row.fixedCostRate, row.hasFixedCostData)}</td>
                <td>{formatMoneyOrDash(row.operatingProfit, !row.isProvisionalProfit)}</td>
                <td>{formatPercentOrDash(row.operatingMargin, !row.isProvisionalProfit)}</td>
                <td>{row.productivity.hasStaffCount ? row.effectiveStaffCount : "－"}</td>
                <td>{formatMoneyOrDash(row.productivity.current, row.productivity.hasStaffCount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
