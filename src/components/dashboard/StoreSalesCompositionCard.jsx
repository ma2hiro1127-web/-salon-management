import { money, percent } from "../../utils/storage.js";

// 単店舗ダッシュボードの技術売上/店販売上内訳(App.jsx側のSalesCompositionCard)と同じ
// 100%積み上げ横棒グラフ+凡例のパターンを、全店舗ビュー用に「店舗別の売上構成比」として
// 転用したもの。専用の色配列を持つ(App.jsx側のSALES_COMPOSITION_COLORSは非export、
// 各ダッシュボードコンポーネントは自己完結させる方針のため複製)。
// 総合品質チェックで発見した問題D: 以前はconic-gradient円グラフ(.sales-composition-pie)
// を使っていたが、そのCSSクラスがApp.cssに一度も定義されておらず円グラフ自体が常に
// 不可視だった(width/heightが無いdivは何も描画されない)。原因はApp.jsx側のSalesCompositionCard
// が「差が大きいと円グラフでは小さい項目が見えづらい」という理由で横棒グラフへ既に移行済み
// だったのに、このコンポーネントだけ旧デザインのまま取り残されていたこと。新規CSSを追加する
// のではなく、既存の(スタイル定義済み・動作確認済みの).sales-composition-bar系クラスへ
// 統一する。
const COMPOSITION_COLORS = ["#2f7df6", "#38b28f", "#f5a524", "#e35757", "#8b5cf6", "#14b8a6", "#ec4899", "#84cc16"];
// 店舗数が多いと円グラフが読みにくくなるため、売上上位5店舗のみ個別表示し、残りは
// 「その他(n店舗)」に集約する。
const MAX_INDIVIDUAL_SLICES = 5;

export default function StoreSalesCompositionCard({ storeRows = [] }) {
  const totalSales = storeRows.reduce((sum, row) => sum + Math.max(0, row.sales), 0);

  return (
    <section className="panel sales-composition-card">
      <div className="panel-heading">
        <div><p className="eyebrow">COMPOSITION</p><h2>店舗別売上構成比</h2></div>
      </div>
      {totalSales <= 0 ? (
        <div className="empty-card">売上データが入力されると内訳を表示します。</div>
      ) : (
        <StoreCompositionBody storeRows={storeRows} totalSales={totalSales} />
      )}
    </section>
  );
}

function StoreCompositionBody({ storeRows, totalSales }) {
  const sortedRows = [...storeRows].filter((row) => row.sales > 0).sort((a, b) => b.sales - a.sales);
  const topRows = sortedRows.slice(0, MAX_INDIVIDUAL_SLICES);
  const restRows = sortedRows.slice(MAX_INDIVIDUAL_SLICES);
  const restTotal = restRows.reduce((sum, row) => sum + row.sales, 0);

  const items = topRows.map((row) => ({ key: row.storeId, label: row.storeName, amount: row.sales, ratio: row.sales / totalSales }));
  if (restTotal > 0) {
    items.push({ key: "__others", label: `その他(${restRows.length}店舗)`, amount: restTotal, ratio: restTotal / totalSales });
  }

  return (
    <div className="sales-composition-body">
      <div className="sales-composition-bar" role="img" aria-label="店舗別売上構成の内訳">
        {items.map((item, index) => (
          <div
            key={item.key}
            className="sales-composition-bar-segment"
            style={{ width: `${Math.max(item.ratio * 100, item.ratio > 0 ? 2 : 0)}%`, background: COMPOSITION_COLORS[index % COMPOSITION_COLORS.length] }}
            title={`${item.label} ${percent(item.ratio * 100)}`}
          />
        ))}
      </div>
      <ul className="sales-composition-legend">
        {items.map((item, index) => (
          <li key={item.key}>
            <span className="sales-composition-swatch" style={{ background: COMPOSITION_COLORS[index % COMPOSITION_COLORS.length] }} />
            <span className="sales-composition-label">{item.label}</span>
            <strong className="sales-composition-amount">{money(item.amount)}</strong>
            <span className="sales-composition-percent">{percent(item.ratio * 100)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
