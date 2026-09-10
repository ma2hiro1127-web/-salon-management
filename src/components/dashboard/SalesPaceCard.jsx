// 売上ページ「現在の売上ペース」カード(2026-09、旧「要確認ポイント」から全面変更)。
// 表示ロジックは持たず、calculateSalesPaceGap(storage.js)の結果を1文に変換して
// 表示するだけの純粋な表示コンポーネント——判定・計算はここに書かない。
// 「今日まで」ではなく「入力済みの日まで」という表現に統一する(要件)——今日までの
// 入力が完了しているとは限らない(最後に入力した営業日を基準に判定している)ため。
const STATUS_META = {
  behind: {
    tone: "warning",
    text: (roundedManYen) => `入力済みの日までの売上目安より、約${roundedManYen}万円遅れています。`,
  },
  ahead: {
    tone: "good",
    text: (roundedManYen) => `入力済みの日までの売上目安を、約${roundedManYen}万円上回っています。`,
  },
  onPace: {
    tone: "neutral",
    text: () => "入力済みの日まで、目標ペースで順調に進んでいます。",
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
