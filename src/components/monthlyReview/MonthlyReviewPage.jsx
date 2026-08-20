import { useEffect, useRef, useState } from "react";
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

const TEXT_FIELD_DEFS = [
  { key: "reflection", label: "今月の振り返り", placeholder: "例: 新規のご紹介が増え、技術売上が前月より伸びた。スタッフの接客研修の成果が出てきている。" },
  { key: "challenges", label: "今月の課題", placeholder: "例: 再来率が下がった。店販の提案がまだ弱い。" },
  { key: "improvements", label: "改善したこと", placeholder: "例: カウンセリングシートを見直した。店販の陳列を変更した。" },
  { key: "next_actions", label: "来月の改善アクション", placeholder: "例: 再来案内のタイミングを見直す。店販の声かけを全スタッフで徹底する。" },
];

// 自動保存のstatusチップ(要件7: 保存中/保存済み/保存失敗を安全に管理・表示する)。
function SaveStatusChip({ saveStatus }) {
  if (saveStatus.status === "idle") return null;
  const tone = saveStatus.status === "error" ? "error" : saveStatus.status === "saving" ? "saving" : "saved";
  return <span className={`monthly-review-save-chip ${tone}`}>{saveStatus.message}</span>;
}

export default function MonthlyReviewPage({ summary, text, monthValue, isAllStoresView, storeName, canEdit, saveStatus, onSaveFields, onFlushFields, reviewContextKey }) {
  // 対象月・店舗(=このレビューの「宛先」)が変わった時だけ、下書きをtext(保存済みの内容)で
  // 作り直す。text自体は自分の保存が反映されるたびにも変わるため、textを直接依存配列に
  // 入れると「入力中に自動保存が走ってtextが更新される→下書きが上書きされて入力が消える」
  // 不具合になる——reviewContextKey(company_id::store_id::month、呼び出し元がid基準で
  // 組み立てたもの)という「宛先」だけの変化を見ることでこれを避ける。表示名(storeName)は
  // 同名店舗が別会社に存在する場合に区別できないため、キーには使わない。
  const contextKey = reviewContextKey;
  const [draft, setDraft] = useState(() => ({
    reflection: text.reflection, challenges: text.challenges, improvements: text.improvements, next_actions: text.next_actions,
  }));
  const lastContextKeyRef = useRef(contextKey);
  useEffect(() => {
    if (lastContextKeyRef.current === contextKey) return;
    lastContextKeyRef.current = contextKey;
    setDraft({ reflection: text.reflection, challenges: text.challenges, improvements: text.improvements, next_actions: text.next_actions });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);

  const handleFieldChange = (key, value) => {
    const nextDraft = { ...draft, [key]: value };
    setDraft(nextDraft);
    onSaveFields(nextDraft);
  };

  const hasSalesTarget = summary.hasSalesTarget;

  return (
    <div className="stack monthly-review-page">
      <section className="panel monthly-review-header-card">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">MONTHLY REVIEW</p>
            <h2>月次レビュー</h2>
          </div>
          <SaveStatusChip saveStatus={saveStatus} />
        </div>
        <div className="monthly-review-context-strip">
          <span className="value-pill">対象月: {formatMonthLabel(monthValue)}</span>
          <span className="value-pill">{isAllStoresView ? "全店舗" : `店舗: ${storeName}`}</span>
        </div>
        <p className="helper-text">
          幹部MT・店舗MT・全体共有でそのまま画面を見せられる、シンプルな月次の振り返りページです。対象月・店舗はヘッダーの選択と連動します。
          {!canEdit ? "（現在は閲覧のみです）" : ""}
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

      {TEXT_FIELD_DEFS.map((field) => (
        <section className="panel" key={field.key}>
          <div className="panel-heading compact"><h3>{field.label}</h3></div>
          {canEdit ? (
            <textarea
              className="monthly-review-textarea"
              value={draft[field.key]}
              onChange={(event) => handleFieldChange(field.key, event.target.value)}
              // フォーカスが外れる=画面遷移・タブ切替の直前に必ず起こるタイミングなので、
              // debounceを待たず即座に保存する(要件7: 保存漏れ防止)。
              onBlur={() => onFlushFields(draft)}
              placeholder={field.placeholder}
              rows={4}
            />
          ) : (
            <div className="monthly-review-readonly-text">{draft[field.key] || "（未記入）"}</div>
          )}
        </section>
      ))}
    </div>
  );
}
