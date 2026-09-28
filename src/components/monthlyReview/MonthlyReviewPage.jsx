import { formatMoneyOrDash, formatPercentOrDash } from "../../utils/storage.js";

const money = (value) => formatMoneyOrDash(value, true);

// 変化が大きかった項目1件分。タイトル(実際の変化の向きから動的に生成、中立表現)→数字の
// 根拠(既存のdescribeComparison由来)の順。関連KPIの内訳は表示しない(要件5: 「主な変化」
// の中に同じ内容を重複表示しない——内訳は下の「利益低下・改善の主な要因」で述べる)。
function AnalysisPoint({ point }) {
  return (
    <div className="monthly-review-analysis-point neutral">
      <strong className="monthly-review-analysis-title">{point.title}</strong>
      <p className="monthly-review-analysis-detail">{point.detail}</p>
    </div>
  );
}

// 来月確認するポイント1件分(2026-09改訂)。今月の数値を再掲示するのではなく、「来月何を
// 確認すべきか」という視点(viewpoint)だけを短く述べる。
function NextFocusItem({ point }) {
  return (
    <div className="monthly-review-next-focus-item">
      <strong className="monthly-review-next-focus-label">{point.label}</strong>
      <span className="monthly-review-next-focus-viewpoint">{point.viewpoint}</span>
    </div>
  );
}

// 月次レビュー(振り返りページ、2026-09全面改訂)。月次ダッシュボード(数字を見るページ)とは
// 役割を分け、このページは「1ヶ月を振り返って、何が起きたか・なぜそうなったか・来月何を
// 見るかを確認するページ」に一本化する。店舗・対象月の選択、ページタイトルは既にヘッダー側
// (App.jsx共通ヘッダー)にあるため、このコンポーネント内では重複表示しない(要件1)。
// 構成: 今月の結果(主要5指標)→総評(結果を2〜3文で短くまとめる)→変化が大きかった項目
// (①売上②実額で動いた費用③営業利益/利益率④主要KPI、最大3件)→利益低下・改善の主な要因
// (「なぜ」を箇条書きで整理)→来月確認するポイント(数字ではなく視点)。数字はanalysis
// (analyzeMonthlyReview、既存の損益計算をそのまま参照)とsummary(getMonthlyReviewSummary、
// 今月の結果の総売上・目標のみ使用)の2つの既存propsをそのまま使う——新しい集計は行わない。
export default function MonthlyReviewPage({ summary, analysis }) {
  const hasSalesTarget = summary.hasSalesTarget;
  const operatingProfitComparison = analysis?.comparisons?.operatingProfit;
  const operatingMarginComparison = analysis?.comparisons?.operatingMargin;

  return (
    <div className="stack monthly-review-page">
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

          {analysis.profitDrivers ? (
            <section className="panel">
              <div className="panel-heading compact"><h3>{analysis.profitDrivers.title}</h3></div>
              <ul className="monthly-review-driver-list">
                {analysis.profitDrivers.bullets.map((bullet, index) => (
                  <li key={index} className="monthly-review-driver-item">{bullet}</li>
                ))}
              </ul>
            </section>
          ) : null}

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
