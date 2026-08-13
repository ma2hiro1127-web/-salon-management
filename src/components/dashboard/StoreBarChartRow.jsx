// 月次経営ダッシュボードの店舗比較棒グラフ、1行分。既存の.progress-track/.progress-fill
// (App.css)を土台にした横棒で、円グラフを使わず店舗間の大小を比較できるようにする。
// 赤字(danger)の場合は色を変えるだけで、バー幅はMath.max(0, value)を使い負の値でも
// CSSのwidthが不正な値にならないようにする。
export default function StoreBarChartRow({ label, value, maxValue, formattedValue, danger = false }) {
  const width = maxValue > 0 ? Math.min(100, (Math.max(0, value) / maxValue) * 100) : 0;
  return (
    <div className="dashboard-bar-row">
      <span className="dashboard-bar-label" title={label}>{label}</span>
      <div className="progress-track">
        <div className={`progress-fill${danger ? " danger" : ""}`} style={{ width: `${width}%` }} />
      </div>
      <strong className={`dashboard-bar-value${danger ? " danger" : ""}`}>{formattedValue}</strong>
    </div>
  );
}
