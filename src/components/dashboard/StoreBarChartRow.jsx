// 月次経営ダッシュボードの店舗比較棒グラフ、1行分。既存の.progress-track/.progress-fill
// (App.css)を土台にした横棒で、円グラフを使わず店舗間の大小を比較できるようにする。
// 赤字(danger)の場合は色を変えるだけでなく、バー幅もMath.abs(value)で描画する(0円基準
// (左端)からのマイナス幅の大きさが視覚的に比較できるようにするため — 以前はマイナス値を
// 0幅にしていたため赤字の数値だけが見え、赤字の「大きさ」が比較できなかった)。
// hasData:falseの場合(例: 人件費・材料/発注費が未入力で営業利益が算出できない店舗)は
// バーを描かず「－」だけを表示する — 未入力を0円のバーとして見せないため。
export default function StoreBarChartRow({ label, value, maxValue, formattedValue, danger = false, hasData = true }) {
  const width = hasData && maxValue > 0 ? Math.min(100, (Math.abs(value) / maxValue) * 100) : 0;
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
