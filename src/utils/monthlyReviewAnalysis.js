// 月次レビュー自動分析(2026-09追加、2026-09再修正)。生成AI APIは一切使わず、既存の月次
// 損益計算(calculateMonthSummary/calculateAllStoresMonthSummary/getCompanyDashboardSummary)
// の戻り値を読むだけで、①今月のまとめ ②良かった点 ③改善ポイント、の3ブロックを
// テンプレート+数値判定で自動生成する。月締め後の確定データにのみ使う(月途中の値を
// この関数へ渡さないことは呼び出し元の責務——isClosed:falseの場合はこの関数自身も
// 即座に空の結果を返す)。
//
// 再修正の経緯: 「営業利益率が前月より60.1pt改善」のように、実際には悪化しているのに
// 「改善」と表示される不具合が報告された。原因の作り込みを二度と起こさないため、
// 「計算」と「文章化」を構造的に分離する——このファイルは必ず以下の順で処理する。
//   1. compareMonthlyMetric()で当月値・前月値・差分(当月-前月)・前月比%・改善/悪化判定を
//      確定させる(この関数だけが計算を行う、他のどこにも同じ計算を重複実装しない)。
//   2. 確定した比較結果(MetricComparison)だけを文章テンプレートへ渡す。テンプレート側は
//      値を読んで日本語に整形するだけで、差分や改善/悪化を再計算・再判定しない。
//   3. 表示直前にvalidateMetricComparison()で「差分 = 当月 - 前月」等の整合性を再検証し、
//      異常があれば「前月比較なし」として扱う(NaN/Infinity/矛盾した符号を画面に出さない)。
import {
  parseNumber,
  calculateMonthSummary,
  calculateAllStoresMonthSummary,
  getCompanyDashboardSummary,
} from "./storage.js";

export const MONTHLY_INSIGHT_THRESHOLDS = {
  maxGoodPoints: 3,
  // 改善ポイントは「売上」「営業利益」のような結果指標と、「営業利益率」「人件費率」
  // 「材料・仕入原価率」のような構造指標が同時に悪化することが多い(利益率悪化の内訳が
  // 人件費率・材料費率の両方の上昇である、等)。件数の上限を良かった点より少し広めに取り、
  // 単位の違う指標(%とpt)を同じ大きさ順で並べても、構造指標が結果指標に押し出されて
  // 消えないようにする。
  maxImprovementPoints: 5,
};

// 指標カタログ。「率」(pt差、金額換算しない)と「金額・件数」(前月比%)で計算方法が違う。
// directionは「高いほど良い」か「低いほど良い」かで改善/悪化の符号を決める、この1箇所だけ。
const METRIC_DEFS = {
  sales: { kind: "amount", direction: "higherIsBetter", label: "総売上", format: "yen" },
  operatingProfit: { kind: "amount", direction: "higherIsBetter", label: "営業利益", format: "yen" },
  technicalSales: { kind: "amount", direction: "higherIsBetter", label: "技術売上", format: "yen" },
  retailSales: { kind: "amount", direction: "higherIsBetter", label: "店販売上", format: "yen" },
  customers: { kind: "amount", direction: "higherIsBetter", label: "客数", format: "people" },
  newCustomers: { kind: "amount", direction: "higherIsBetter", label: "新規客数", format: "people" },
  repeatCustomers: { kind: "amount", direction: "higherIsBetter", label: "再来客数", format: "people" },
  averageSpend: { kind: "amount", direction: "higherIsBetter", label: "客単価", format: "yen", verb: "rise" },
  reviewCount: { kind: "amount", direction: "higherIsBetter", label: "口コミ数", format: "count" },
  operatingMargin: { kind: "rate", direction: "higherIsBetter", label: "営業利益率", format: "percent" },
  laborRate: { kind: "rate", direction: "lowerIsBetter", label: "人件費率", format: "percent" },
  materialRate: { kind: "rate", direction: "lowerIsBetter", label: "材料・仕入原価率", format: "percent" },
};

const formatValue = (value, format) => {
  if (format === "yen") return `${Math.round(parseNumber(value)).toLocaleString("ja-JP")}円`;
  if (format === "people") return `${Math.round(parseNumber(value)).toLocaleString("ja-JP")}人`;
  if (format === "count") return `${Math.round(parseNumber(value)).toLocaleString("ja-JP")}件`;
  if (format === "percent") return `${parseNumber(value).toFixed(1)}%`;
  return String(value);
};
const pct1 = (value) => `${Math.abs(parseNumber(value)).toFixed(1)}%`;
const pt1 = (value) => `${Math.abs(parseNumber(value)).toFixed(1)}pt`;

// ここが唯一の「計算」箇所(要件: AIに計算自体をさせない/共通関数に集約する)。
// kind:"rate" → 差分は必ず「当月率 - 前月率」(pt)。前月値が0でも計算できる(除算しない)ため
// 判定可能。kind:"amount" → 前月比%は (当月-前月)/前月*100。前月値が0だと0除算になり
// 前月比%の意味自体が壊れるため、その場合は判定自体を「前月比較なし」にする(要件4)。
export function compareMonthlyMetric({ current, previous, hasPreviousData, kind, direction }) {
  const currentValue = Number.isFinite(current) ? current : null;
  const previousValue = Number.isFinite(previous) ? previous : null;
  const base = { current: currentValue, previous: null, diff: null, percentChange: null, judgment: "no_comparison" };
  if (!hasPreviousData || currentValue === null || previousValue === null) return base;
  if (kind === "amount" && previousValue === 0) return { ...base, current: currentValue };

  const diff = currentValue - previousValue; // 常に「当月 - 前月」。これ以外の式を使わない。
  if (!Number.isFinite(diff)) return { ...base, current: currentValue };

  let percentChange = null;
  if (kind === "amount") {
    percentChange = (diff / previousValue) * 100;
    if (!Number.isFinite(percentChange)) percentChange = null;
  }

  let judgment = "unchanged";
  if (diff !== 0) {
    const increased = diff > 0;
    const isGood = direction === "higherIsBetter" ? increased : !increased;
    judgment = isGood ? "improved" : "worsened";
  }
  return { current: currentValue, previous: previousValue, diff, percentChange, judgment };
}

// 表示直前の整合性チェック(要件4)。ここを通らない比較結果は画面に一切出さない
// (呼び出し側はこの関数の戻り値がfalseなら「前月比較なし」として扱う)。
export function validateMetricComparison(comparison) {
  if (!comparison) return false;
  if (comparison.judgment === "no_comparison") return true; // 「比較なし」自体は正常な状態
  const { current, previous, diff } = comparison;
  if (!Number.isFinite(current) || !Number.isFinite(previous) || !Number.isFinite(diff)) return false;
  // 差分 = 当月 - 前月、になっているかを直接再検証する(要件4の核心)。
  if (Math.abs(diff - (current - previous)) > 1e-6) return false;
  if (comparison.percentChange !== null && !Number.isFinite(comparison.percentChange)) return false;
  return true;
}

// 全指標の比較結果を一括で作る。fieldsEnabledでOFFの指標(新規/再来/店販/口コミ)は
// 比較対象から除外する(入力設定でOFFの項目を勝手に分析しないという既存要件を踏襲)。
// 検証に落ちた比較は"no_comparison"へフォールバックし、絶対に画面へ異常値を出さない。
export function buildMetricComparisons(current, previous, fieldsEnabled = {}) {
  const hasPreviousData = Boolean(previous?.hasData);
  const comparisons = {};
  for (const [key, def] of Object.entries(METRIC_DEFS)) {
    if (key === "newCustomers" && fieldsEnabled.newCustomers === false) continue;
    if (key === "repeatCustomers" && fieldsEnabled.repeatCustomers === false) continue;
    if (key === "retailSales" && fieldsEnabled.retailSales === false) continue;
    if (key === "reviewCount" && fieldsEnabled.reviewCount === false) continue;
    if ((key === "laborRate") && !(current?.hasLaborData && previous?.hasLaborData)) continue;
    if ((key === "materialRate") && !(current?.hasMaterialData && previous?.hasMaterialData)) continue;
    if (key === "operatingMargin" && (current?.isProvisionalProfit || previous?.isProvisionalProfit)) continue;
    if (key === "operatingProfit" && (current?.isProvisionalProfit || previous?.isProvisionalProfit)) continue;
    const comparison = compareMonthlyMetric({
      current: current?.[key],
      previous: previous?.[key],
      hasPreviousData,
      kind: def.kind,
      direction: def.direction,
    });
    comparisons[key] = validateMetricComparison(comparison) ? comparison : { ...comparison, judgment: "no_comparison" };
  }
  return comparisons;
}

// ②良かった点・③改善ポイント共通のテンプレート(要件3: 数値→差→意味の順、抽象論は書かない)。
function describeComparison(key, comparison) {
  const def = METRIC_DEFS[key];
  const currentText = formatValue(comparison.current, def.format);
  const previousText = formatValue(comparison.previous, def.format);
  if (def.kind === "rate") {
    const verb = comparison.diff > 0 ? "上昇" : "低下";
    return `${def.label}が${previousText}から${currentText}へ${pt1(comparison.diff)}${verb}しました。`;
  }
  const verb = def.verb === "rise" ? (comparison.diff > 0 ? "上昇" : "低下") : (comparison.diff > 0 ? "増加" : "減少");
  const percentText = comparison.percentChange !== null ? `${pct1(comparison.percentChange)}` : null;
  return percentText
    ? `${def.label}が${previousText}から${currentText}へ${percentText}${verb}しました。`
    : `${def.label}が${previousText}から${currentText}へ${verb}しました。`;
}

// 良かった点: 実際に改善した指標だけ。無ければ空配列を返す(要件: 無理に褒めない)。
function buildGoodPoints(comparisons, thresholds) {
  const improved = Object.entries(comparisons).filter(([, c]) => c.judgment === "improved");
  const magnitude = ([, c]) => (c.percentChange !== null ? Math.abs(c.percentChange) : Math.abs(c.diff));
  return improved
    .sort((a, b) => magnitude(b) - magnitude(a))
    .slice(0, thresholds.maxGoodPoints)
    .map(([key, c]) => ({ id: key, title: `${METRIC_DEFS[key].label}が改善しました`, detail: describeComparison(key, c) }));
}

// 改善ポイント: 実際に悪化した指標だけ。数字から直接言える範囲でのみ、他の確定済み比較
// (売上・営業利益率)を根拠にした補足文を1文だけ足す(要件3: 根拠のない文章を書かない)。
function buildImprovementPoints(comparisons, thresholds) {
  const worsened = Object.entries(comparisons).filter(([, c]) => c.judgment === "worsened");
  const magnitude = ([, c]) => (c.percentChange !== null ? Math.abs(c.percentChange) : Math.abs(c.diff));
  const salesWorsened = comparisons.sales?.judgment === "worsened";
  const marginWorsened = comparisons.operatingMargin?.judgment === "worsened";
  return worsened
    .sort((a, b) => magnitude(b) - magnitude(a))
    .slice(0, thresholds.maxImprovementPoints)
    .map(([key, c]) => {
      let detail = describeComparison(key, c);
      if (key === "laborRate" && salesWorsened) {
        detail += "売上減少に対して人件費負担が大きくなっています。";
      } else if (key === "materialRate" && marginWorsened) {
        detail += "原価負担の上昇も営業利益率低下の一因です。";
      }
      return { id: key, title: `${METRIC_DEFS[key].label}が悪化しました`, detail };
    });
}

// ①今月のまとめ。実データ→差分→経営上の意味、の順で2〜4文にまとめる。抽象論・励まし文は
// 一切含めない(要件3)。前月データが無い場合は当月の実績だけを事実として述べる。
function buildSummaryText(comparisons, current) {
  const sales = comparisons.sales;
  const sentences = [];
  if (sales.judgment === "no_comparison") {
    sentences.push(`今月の総売上は${formatValue(current.sales, "yen")}でした。比較できる前月データが無いため、今月の実績のみを表示しています。`);
    return sentences.join("");
  }
  const salesVerb = sales.diff >= 0 ? "増加" : "減少";
  sentences.push(`売上は前月比${pct1(sales.percentChange)}${salesVerb}しました。`);

  const profit = comparisons.operatingProfit;
  const margin = comparisons.operatingMargin;
  if (profit.judgment !== "no_comparison" && margin.judgment !== "no_comparison") {
    const profitVerb = profit.diff >= 0 ? "増加" : "減少";
    const marginVerb = margin.diff >= 0 ? "上昇" : "低下";
    sentences.push(
      `営業利益は${formatValue(profit.previous, "yen")}から${formatValue(profit.current, "yen")}へ${profitVerb}し、営業利益率も${margin.previous.toFixed(1)}%から${margin.current.toFixed(1)}%へ${pt1(margin.diff)}${marginVerb}しました。`
    );
  }

  const laborWorsened = comparisons.laborRate?.judgment === "worsened";
  const laborImproved = comparisons.laborRate?.judgment === "improved";
  const materialWorsened = comparisons.materialRate?.judgment === "worsened";
  const materialImproved = comparisons.materialRate?.judgment === "improved";
  if (laborWorsened && materialWorsened) {
    sentences.push(`人件費率・材料仕入原価率もともに上昇しており、${sales.diff < 0 ? "売上減少に対して費用負担が大きくなった" : "費用負担が重くなった"}月です。`);
  } else if (laborImproved && materialImproved) {
    sentences.push("人件費率・材料仕入原価率はともに改善しました。");
  } else if (laborWorsened) {
    sentences.push(`人件費率が${comparisons.laborRate.previous.toFixed(1)}%から${comparisons.laborRate.current.toFixed(1)}%へ${pt1(comparisons.laborRate.diff)}上昇しています。`);
  } else if (materialWorsened) {
    sentences.push(`材料・仕入原価率が${comparisons.materialRate.previous.toFixed(1)}%から${comparisons.materialRate.current.toFixed(1)}%へ${pt1(comparisons.materialRate.diff)}上昇しています。`);
  }

  return sentences.join("");
}

// isClosed:false の場合は他の計算を一切行わず即座に返す(要件: 月途中の誤解を招く表示防止)。
export function analyzeMonthlyReview({
  current,
  previous,
  isClosed,
  fieldsEnabled = { customers: true, newCustomers: true, repeatCustomers: true, retailSales: true, reviewCount: true },
  thresholds = MONTHLY_INSIGHT_THRESHOLDS,
} = {}) {
  if (!isClosed) {
    return { isClosed: false, summaryText: "", goodPoints: [], improvementPoints: [], comparisons: {} };
  }
  const comparisons = buildMetricComparisons(current, previous, fieldsEnabled);
  return {
    isClosed: true,
    summaryText: buildSummaryText(comparisons, current),
    goodPoints: buildGoodPoints(comparisons, thresholds),
    improvementPoints: buildImprovementPoints(comparisons, thresholds),
    comparisons,
  };
}

// getMonthlyReviewMetrics: calculateMonthSummary(単一店舗)/calculateAllStoresMonthSummary+
// getCompanyDashboardSummary(全店舗)のどちらから来たかを問わず、この分析関数が必要とする
// 値だけをまとめた共通の形へ正規化する。全店舗ビューの人件費率・材料費率・営業利益率は、
// 既存の「各店舗ごとにcalculateMonthSummaryを呼んでから合算し、率は合算後に再計算する」
// 規約(getCompanyDashboardSummary)をそのまま使う——店舗ごとの率を平均しない。
export function getMonthlyReviewMetrics(state, { storeId, isAllStoresView, company, storeEntity, companyStores } = {}, monthValue) {
  if (isAllStoresView) {
    const salesSummary = calculateAllStoresMonthSummary(state, company, monthValue);
    const dashboardSummary = getCompanyDashboardSummary(state, company, monthValue);
    const stores = (Array.isArray(companyStores) ? companyStores : company?.stores || []).filter((store) => store?.id && store.status !== "archived");
    // 前月比較のhasPrevious判定と全く同じ基準(getMonthlyReviewSummaryの全店舗版と同一)。
    const hasData = stores.some((store) => {
      const storeSummary = calculateMonthSummary(state, store.id, monthValue);
      return storeSummary.entries.length > 0 || storeSummary.batchEntries.length > 0;
    });
    const targetSales = parseNumber(salesSummary.target?.targetSales);
    return {
      sales: salesSummary.sales,
      technicalSales: salesSummary.technicalSales,
      retailSales: salesSummary.retailSales,
      customers: salesSummary.customers,
      newCustomers: salesSummary.newCustomers,
      repeatCustomers: salesSummary.repeatCustomers,
      reviewCount: salesSummary.reviewCount,
      averageSpend: salesSummary.averageSpend,
      laborRate: dashboardSummary.laborRate,
      materialRate: dashboardSummary.purchaseCostRate,
      operatingMargin: dashboardSummary.operatingMargin,
      operatingProfit: dashboardSummary.totalOperatingProfit,
      isProvisionalProfit: dashboardSummary.isProvisionalProfit,
      hasLaborData: dashboardSummary.hasLaborData,
      hasMaterialData: dashboardSummary.hasPurchaseData,
      targetSales,
      hasSalesTarget: targetSales > 0,
      targetAchievement: targetSales > 0 ? salesSummary.targetAchievement : null,
      // 全店舗ビュー専用の目標(company_all_stores_targets)には営業利益率目標という概念が
      // 無い(店舗ごとのmonthly_targetsにしか無い項目のため)。
      targetOperatingMargin: null,
      hasData,
    };
  }

  const hiddenCategories = storeEntity?.settings?.hiddenClosingCategories || [];
  const useInventoryTracking = Boolean(storeEntity?.settings?.useInventoryTracking);
  const summary = calculateMonthSummary(state, storeId, monthValue, { useInventoryTracking, hiddenCategories });
  const targetSales = parseNumber(summary.target?.targetSales);
  const targetOperatingMargin = parseNumber(summary.target?.targetOperatingMargin);
  return {
    sales: summary.sales,
    technicalSales: summary.technicalSales,
    retailSales: summary.retailSales,
    customers: summary.customers,
    newCustomers: summary.newCustomers,
    repeatCustomers: summary.repeatCustomers,
    reviewCount: summary.reviewCount,
    averageSpend: summary.averageSpend,
    laborRate: summary.laborRate,
    materialRate: summary.costOfGoodsSoldRate,
    operatingMargin: summary.operatingMargin,
    operatingProfit: summary.operatingProfit,
    isProvisionalProfit: summary.isProvisionalProfit,
    hasLaborData: Boolean(summary.categoryHasEntry?.labor),
    hasMaterialData: Boolean(summary.categoryHasEntry?.materials),
    targetSales,
    hasSalesTarget: targetSales > 0,
    targetAchievement: targetSales > 0 ? summary.targetAchievement : null,
    targetOperatingMargin: targetOperatingMargin > 0 ? targetOperatingMargin : null,
    hasData: summary.entries.length > 0 || summary.batchEntries.length > 0,
  };
}
