import { useMemo } from "react";
import { emptyMonth } from "../data/defaults";

export function SalesTrendChart({ storeName, monthlyData }) {
  const trendData = useMemo(() => {
    const now = new Date();
    const selectedDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const points = [];

    for (let index = 5; index >= 0; index -= 1) {
      const date = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - index, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const data = monthlyData[`${storeName}__${key}`] || emptyMonth;
      const sales = Number(data.technicalSales || 0) + Number(data.retailSales || 0);
      const profit =
        sales -
        Number(data.materialCost || 0) -
        Number(data.retailCost || 0) -
        Number(data.laborCost || 0) -
        Number(data.rent || 0) -
        Number(data.advertising || 0);
      points.push({ key, label: `${date.getMonth() + 1}月`, sales, profit });
    }

    return points;
  }, [storeName, monthlyData]);

  const chartHeight = 220;
  const chartWidth = 760;
  const padding = { top: 18, right: 24, bottom: 28, left: 24 };
  const maxValue = Math.max(...trendData.map((point) => Math.max(point.sales, point.profit, 1)), 1);

  const buildLine = (key) =>
    trendData
      .map((point, index) => {
        const x = padding.left + (index * (chartWidth - padding.left - padding.right)) / Math.max(trendData.length - 1, 1);
        const y = chartHeight - padding.bottom - (point[key] / maxValue) * (chartHeight - padding.top - padding.bottom);
        return `${x},${y}`;
      })
      .join(" ");

  return (
    <div className="chart-block">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="chart-svg" aria-label="月別売上推移">
        <polyline points={buildLine("sales")} className="sales-line" />
        <polyline points={buildLine("profit")} className="profit-line" />
      </svg>
      <div className="chart-labels">
        {trendData.map((point) => (
          <span key={point.key}>{point.label}</span>
        ))}
      </div>
    </div>
  );
}
