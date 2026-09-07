import { formatMoneyOrDash, formatPercentOrDash, formatDiffOrDash, formatMonthLabel } from "../../utils/storage.js";

// 数字・前月比の1行(要件2・4): 「今月」「前月」「前月比」が一目で並ぶ。前月データが無い/
// 比較不能な場合はformatDiffOrDash自身がダッシュ("－")を返す(0/NaN/Infinityを表示しない
// ことは呼び出し元のgetMonthlyReviewSummary/diffPercotが既に保証しているので、ここでは
// 受け取った値をそのまま出すだけでよい)。
function MetricRow({ label, metric, formatValue }) {
  if (!metric) return null;
  const hasPrevious = metric.previous !== null && metric.previous !== undefined;
  const diffTone = metric.diff === null || metric.diff === undefined ? "" : metric.diff > 0 ? "positive" : metric.diff < 0 ? "negative" : "";
  return (
    <div className="monthly-review-metric-row">
      <span className="monthly-review-metric-label">{label}</span>
      <div className="monthly-review-metric-values">
        <div className="monthly-review-metric-value-block">
          <span className="monthly-review-metric-value-tag">今月</span>
          <strong>{formatValue(metric.current)}</strong>
        </div>
        <div className="monthly-review-metric-value-block">
          <span className="monthly-review-metric-value-tag">前月</span>
          <strong>{hasPrevious ? formatValue(metric.previous) : "比較データなし"}</strong>
        </div>
        <div className={`monthly-review-metric-diff ${diffTone}`}>{formatDiffOrDash(metric.diff)}</div>
      </div>
    </div>
  );
}

const money = (value) => formatMoneyOrDash(value, true);
const yen = (value) => `${Math.round(Number(value) || 0).toLocaleString("ja-JP")}円`;
const people = (value) => `${Math.round(Number(value) || 0).toLocaleString("ja-JP")}人`;
const count = (value) => `${Math.round(Number(value) || 0).toLocaleString("ja-JP")}件`;

// 自動生成された要確認ポイント・3か月連続トレンドの重要度表示(要件: 赤・黄などの警告色は
// 使いすぎず重要項目だけに限定する)。toneが"danger"のものだけ強めの色を付け、それ以外は
// 中立の見た目にする(日次の要確認ポイントカードと同じトーン方針)。
function AnalysisPoint({ point }) {
  return (
    <div className={`monthly-review-analysis-point ${point.tone || "neutral"}`}>
      <strong className="monthly-review-analysis-title">{point.title}</strong>
      <p className="monthly-review-analysis-detail">{point.detail}</p>
    </div>
  );
}

export default function MonthlyReviewPage({ summary, analysis, monthValue, isAllStoresView, storeName }) {
  const hasSalesTarget = summary.hasSalesTarget;

  return (
    <div className="stack monthly-review-page">
      <section className="panel monthly-review-header-card">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">MONTHLY REVIEW</p>
            <h2>月次レビュー</h2>
          </div>
        </div>
        <div className="monthly-review-context-strip">
          <span className="value-pill">対象月: {formatMonthLabel(monthValue)}</span>
          <span className="value-pill">{isAllStoresView ? "全店舗" : `店舗: ${storeName}`}</span>
        </div>
        <p className="helper-text">
          幹部MT・店舗MT・全体共有でそのまま画面を見せられる、シンプルな月次の振り返りページです。対象月・店舗はヘッダーの選択と連動します。
        </p>
      </section>

      <section className="panel">
        <div className="panel-heading compact"><h3>売上</h3></div>
        <div className="monthly-review-metric-list">
          <MetricRow label="総売上" metric={summary.sales} formatValue={money} />
          {hasSalesTarget ? (
            <div className="monthly-review-metric-row">
              <span className="monthly-review-metric-label">目標売上・達成率</span>
              <div className="monthly-review-metric-values">
                <div className="monthly-review-metric-value-block">
                  <span className="monthly-review-metric-value-tag">目標</span>
                  <strong>{money(summary.targetSales)}</strong>
                </div>
                <div className="monthly-review-metric-value-block">
                  <span className="monthly-review-metric-value-tag">達成率</span>
                  <strong>{formatPercentOrDash(summary.targetAchievement, summary.targetAchievement !== null)}</strong>
                </div>
              </div>
            </div>
          ) : null}
          <MetricRow label="技術売上" metric={summary.technicalSales} formatValue={money} />
          <MetricRow label="店販売上" metric={summary.retailSales} formatValue={money} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading compact"><h3>顧客</h3></div>
        <div className="monthly-review-metric-list">
          <MetricRow label="客数" metric={summary.customers} formatValue={people} />
          <MetricRow label="客単価" metric={summary.averageSpend} formatValue={money} />
          <MetricRow label="新規客数" metric={summary.newCustomers} formatValue={people} />
          <MetricRow label="再来客数" metric={summary.repeatCustomers} formatValue={people} />
        </div>
      </section>

      {summary.showReviewCountTarget ? (
        <section className="panel">
          <div className="panel-heading compact"><h3>口コミ</h3></div>
          <div className="monthly-review-metric-list">
            <MetricRow label="口コミ数" metric={summary.reviewCount} formatValue={count} />
            <div className="monthly-review-metric-row">
              <span className="monthly-review-metric-label">目標口コミ数・達成率</span>
              <div className="monthly-review-metric-values">
                <div className="monthly-review-metric-value-block">
                  <span className="monthly-review-metric-value-tag">目標</span>
                  <strong>{count(summary.targetReviewCount)}</strong>
                </div>
                <div className="monthly-review-metric-value-block">
                  <span className="monthly-review-metric-value-tag">達成率</span>
                  <strong>{formatPercentOrDash(summary.reviewCountAchievement, summary.reviewCountAchievement !== null)}</strong>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {summary.hasStaffProductivity ? (
        <section className="panel">
          <div className="panel-heading compact"><h3>スタッフ生産性</h3></div>
          <div className="monthly-review-metric-list">
            <MetricRow label="1人あたり売上" metric={summary.productivity} formatValue={yen} />
          </div>
        </section>
      ) : null}

      {!analysis?.isClosed ? (
        <section className="panel">
          <div className="panel-heading compact"><h3>月次分析</h3></div>
          <p className="helper-text">この月はまだ月締めされていません。確定後に月次分析が表示されます。</p>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="panel-heading compact"><h3>今月のまとめ</h3></div>
            <p className="monthly-review-summary-text">{analysis.summaryText}</p>
          </section>

          <section className="panel">
            <div className="panel-heading compact"><h3>良かった点</h3></div>
            {analysis.goodPoints.length === 0 ? (
              <p className="helper-text">今月は大きく改善した項目はありません。</p>
            ) : (
              <div className="monthly-review-analysis-list">
                {analysis.goodPoints.map((point) => (
                  <AnalysisPoint key={point.id} point={{ ...point, tone: "good" }} />
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading compact"><h3>要確認ポイント</h3></div>
            {analysis.checkPoints.length === 0 ? (
              <p className="helper-text">現在、特に確認が必要な項目はありません。</p>
            ) : (
              <div className="monthly-review-analysis-list">
                {analysis.checkPoints.map((point) => (
                  <AnalysisPoint key={point.id} point={point} />
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading compact"><h3>来月の注目項目</h3></div>
            <div className="monthly-review-analysis-list">
              {analysis.nextFocus.map((line, index) => (
                <p key={index} className="monthly-review-summary-text">{line}</p>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
