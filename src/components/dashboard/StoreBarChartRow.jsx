// 月次経営ダッシュボードの店舗比較棒グラフ、1行分。既存の.progress-track/.progress-fill
// (App.css)を土台にした横棒で、円グラフを使わず店舗間の大小を比較できるようにする。
// 赤字(danger)の場合は色を変えるだけで、バー幅はMath.max(0, value)を使い負の値でも
// CSSのwidthが不正な値にならないようにする。hasData:falseの場合(例: 人件費・材料/発注費が
// 未入力で営業利益が算出できない店舗)はバーを描かず「－」だけを表示する — 未入力を0円の
// バーとして見せないため。
export default function StoreBarChartRow({ label, value, maxValue, formattedValue, danger = false, hasData = true }) {
  const width = hasData && maxValue > 0 ? Math.min(100, (Math.max(0, value) / maxValue) * 100) : 0;
  return (
    <div className="dashboard-bar-row">
      <span className="dashboard-bar-label" title={label}>{label}</span>
      <div className="progress-track">
        {hasData ? <div className={`progress-fill${danger ? " danger" : ""}`} style={{ width: `${width}%` }} /> : null}
      </div>
      <strong className={`dashboard-bar-value${danger ? " danger" : ""}`}>{hasData ? formattedValue : "－"}</strong>
    </div>
  );
}
