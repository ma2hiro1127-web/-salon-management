import { formatMoneyOrDash, formatPercentOrDash, formatDiffOrDash, formatMonthLabel } from "../../utils/storage.js";

const money = (value) => formatMoneyOrDash(value, true);
const people = (value) => `${Math.round(Number(value) || 0).toLocaleString("ja-JP")}人`;
const count = (value) => `${Math.round(Number(value) || 0).toLocaleString("ja-JP")}件`;
const percent1 = (value) => `${(Number(value) || 0).toFixed(1)}%`;

// monthlyReviewAnalysis.js側のformat文字列("yen"/"people"/"count"/"percent")を、この画面の
// 既存フォーマッタへそのままマッピングする(新しい表示ロジックは作らない)。
const formatByFormat = (value, format) => {
  if (format === "yen") return money(value);
  if (format === "people") return people(value);
  if (format === "count") return count(value);
  if (format === "percent") return percent1(value);
  return String(value);
};

// 要因分析の「関連KPI」1行(今月・前月・差分)。①今月の結果とは別に、変化が大きかった項目
// カードの中でだけ使う軽量な行——既存のMetricRow/monthly-review-metric-rowと同じ見た目を
// 再利用し、新しいCSSクラスは追加しない。
function RelatedMetricRow({ metric }) {
  // 色は生のdiff符号ではなくjudgment(改善/悪化、direction=lowerIsBetterな指標も正しく
  // 判定済み)で決める——人件費率等の上昇は診断上「悪化」であり、+表示でも赤にする。
  const diffTone = metric.judgment === "improved" ? "positive" : metric.judgment === "worsened" ? "negative" : "";
  const diffText = metric.percentChange !== null
    ? `${metric.percentChange > 0 ? "+" : ""}${metric.percentChange.toFixed(1)}%`
    : formatDiffOrDash(metric.diff);
  return (
    <div className="monthly-review-metric-row compact">
      <span className="monthly-review-metric-label">{metric.label}</span>
      <div className="monthly-review-metric-values">
        <div className="monthly-review-metric-value-block">
          <span className="monthly-review-metric-value-tag">今月</span>
          <strong>{formatByFormat(metric.current, metric.format)}</strong>
        </div>
        <div className="monthly-review-metric-value-block">
          <span className="monthly-review-metric-value-tag">前月</span>
          <strong>{formatByFormat(metric.previous, metric.format)}</strong>
        </div>
        <div className={`monthly-review-metric-diff ${diffTone}`}>{diffText}</div>
      </div>
    </div>
  );
}

// 変化が大きかった項目1件分(要件2・5)。タイトル(中立表現)→数字の根拠(detail、既存の
// describeComparison由来)→関連KPIの内訳(relatedMetrics、2026-09追加の要因分析)の順。
// 警告色は使わずtoneは常にneutral(要件9)。
function AnalysisPoint({ point }) {
  return (
    <div className="monthly-review-analysis-point neutral">
      <strong className="monthly-review-analysis-title">{point.title}</strong>
      <p className="monthly-review-analysis-detail">{point.detail}</p>
      {point.relatedMetrics.length > 0 ? (
        <div className="monthly-review-analysis-related">
          <p className="monthly-review-analysis-related-label">主な変化</p>
          {point.relatedMetrics.map((metric) => (
            <RelatedMetricRow key={metric.key} metric={metric} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// 来月確認するポイント1件分(要件7)。施策は書かず、現状値・前月値だけを添える。
function NextFocusItem({ point }) {
  return (
    <div className="monthly-review-next-focus-item">
      <strong className="monthly-review-next-focus-label">{point.label}</strong>
      <span className="monthly-review-next-focus-current">{point.current}</span>
      {point.previous !== null ? <span className="monthly-review-next-focus-previous">前月{point.previous}</span> : null}
    </div>
  );
}

// 月次レビュー(振り返りページ、2026-09全面改訂)。役割は「結果はどうだったか/何が変わったか/
// なぜ変わったか/来月何を見るか」に一本化し、日々の売上ページと同じ客数・客単価・口コミ等の
// 生の数字一覧はここでは主役にしない(重複表示の解消)。構成: ①今月の結果(主要5指標のみ)→
// 総評→変化が大きかった項目(要因分析付き)→来月確認するポイント。数字はanalysis
// (analyzeMonthlyReview、既存の損益計算をそのまま参照)とsummary(getMonthlyReviewSummary、
// 今月の結果の総売上・目標のみ使用)の2つの既存propsをそのまま使う——新しい集計は行わない。
export default function MonthlyReviewPage({ summary, analysis, monthValue, isAllStoresView, storeName }) {
  const hasSalesTarget = summary.hasSalesTarget;
  const operatingProfitComparison = analysis?.comparisons?.operatingProfit;
  const operatingMarginComparison = analysis?.comparisons?.operatingMargin;

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
          幹部MT・店舗MT・全体共有でそのまま画面を見せられる、月次の振り返りページです。対象月・店舗はヘッダーの選択と連動します。
        </p>
      </section>

      {!analysis?.hasData ? (
        <section className="panel">
          <div className="panel-heading compact"><h3>今月の結果</h3></div>
          <p className="helper-text">この月はまだ入力データがありません。売上・費用を入力すると自動でレビューが表示されます。</p>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="panel-heading compact"><h3>今月の結果</h3></div>
            <div className="summary-grid">
              <div className="summary-card emphasize">
                <span>総売上</span>
                <strong>{money(summary.sales?.current)}</strong>
              </div>
              {hasSalesTarget ? (
                <div className="summary-card">
                  <span>売上目標</span>
                  <strong>{money(summary.targetSales)}</strong>
                </div>
              ) : null}
              {hasSalesTarget ? (
                <div className="summary-card">
                  <span>達成率</span>
                  <strong>{formatPercentOrDash(summary.targetAchievement, summary.targetAchievement !== null)}</strong>
                </div>
              ) : null}
              <div className="summary-card emphasize">
                <span>営業利益</span>
                <strong>{formatMoneyOrDash(operatingProfitComparison?.current, Boolean(operatingProfitComparison))}</strong>
              </div>
              <div className="summary-card">
                <span>営業利益率</span>
                <strong>{formatPercentOrDash(operatingMarginComparison?.current, Boolean(operatingMarginComparison))}</strong>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading compact"><h3>総評</h3></div>
            <p className="monthly-review-summary-text">{analysis.summaryText}</p>
            <p className="helper-text">現時点で入力されている数字に基づくレビューです。入力内容を修正すると自動的に更新されます。</p>
          </section>

          <section className="panel">
            <div className="panel-heading compact"><h3>変化が大きかった項目</h3></div>
            {analysis.concernPoints.length === 0 ? (
              <p className="helper-text">前月から大きく変化した項目はありません。</p>
            ) : (
              <div className="monthly-review-analysis-list">
                {analysis.concernPoints.map((point) => (
                  <AnalysisPoint key={point.id} point={point} />
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading compact"><h3>来月確認するポイント</h3></div>
            {analysis.nextFocusPoints.length === 0 ? (
              <p className="helper-text">来月は現状の運用を維持し、大きな変化があれば改めてここに表示されます。</p>
            ) : (
              <div className="monthly-review-next-focus-list">
                {analysis.nextFocusPoints.map((point) => (
                  <NextFocusItem key={point.id} point={point} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
