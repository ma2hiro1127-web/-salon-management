// 日次「要確認ポイント」カード(2026-09追加)。analyzeDailyInsights()の結果をそのまま
// 表示するだけの純粋な表示コンポーネント — 判定ロジックはここに書かない。
export default function DailyInsightsCard({ insights }) {
  return (
    <div className="daily-insights-card">
      <div className="daily-insights-header">
        <p className="eyebrow">CHECK</p>
        <h3>要確認ポイント</h3>
      </div>
      {insights.length === 0 ? (
        <p className="daily-insights-empty">現在、特に確認が必要な項目はありません。</p>
      ) : (
        <div className="daily-insights-list">
          {insights.map((insight) => (
            <div key={insight.id} className={`daily-insight-item ${insight.tone}`}>
              <strong className="daily-insight-title">{insight.title}</strong>
              <p className="daily-insight-detail">{insight.detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
