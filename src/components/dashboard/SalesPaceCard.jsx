// 売上ページ「現在の売上ペース」カード(2026-09、旧「要確認ポイント」から全面変更)。
// 表示ロジックは持たず、calculateSalesPaceGap(storage.js)の結果を1文に変換して
// 表示するだけの純粋な表示コンポーネント——判定・計算はここに書かない。
// 文言は「見ただけで意味が伝わる短さ」を優先する(2026-09、再修正)。「入力済みの日
// までの売上目安」という長い表現や「営業日進捗比」「pt」等の専門的な表現は使わない
// ——上部の「営業日 ○/○日」で入力状況自体は既に確認できるため、コメント内で入力済み
// 日数を繰り返さない。計算基準(最後に入力した営業日までの実績と目標ペースを比較する)
// 自体はcalculateSalesPaceGap(storage.js)側のまま変更していない——ここは文言のみの変更。
const STATUS_META = {
  behind: {
    tone: "warning",
    text: (roundedManYen) => `目標ペースより、約${roundedManYen}万円遅れています。`,
  },
  ahead: {
    tone: "good",
    text: (roundedManYen) => `目標ペースを、約${roundedManYen}万円上回っています。`,
  },
  onPace: {
    tone: "neutral",
    text: () => "目標ペースどおり、順調に進んでいます。",
  },
};

export default function SalesPaceCard({ paceGap }) {
  // データ不足(目標未設定・営業日数0・未来月表示中・対象月の売上入力が1件も無い等)は
  // calculateSalesPaceGapがnullを返す設計になっており、その場合はカード自体を
  // 非表示にする(要件)。
  if (!paceGap) return null;
  const meta = STATUS_META[paceGap.status];
  if (!meta) return null;

  return (
    <div className={`sales-pace-card sales-pace-card--${meta.tone}`}>
      <div className="sales-pace-header">
        <p className="eyebrow">PACE</p>
        <h3>現在の売上ペース</h3>
      </div>
      <p className="sales-pace-sentence">{meta.text(paceGap.roundedManYen)}</p>
    </div>
  );
}
