// 月次レビュー自動分析(2026-09追加、2026-09に2度再修正)。生成AI APIは一切使わず、既存の
// 月次損益計算(calculateMonthSummary/calculateAllStoresMonthSummary/getCompanyDashboardSummary)
// の戻り値を読むだけで、①総評 ②要確認ポイント ③来月の注目項目、の3ブロックをテンプレート+
// 数値判定で自動生成する。
//
// 2026-09再修正(3回目)の経緯・要件:
//   1. 月締め(monthClosingStatus)には一切依存しない。今まさに損益表へ反映されている
//      当月の入力データをそのまま参照し、月途中でも表示する(要件1・2)。月締めボタン自体は
//      別の重要な役割(売上連動費用の金額スナップショット、過去月の変更確認)を持つため
//      残すが、この分析関数の実行条件には一切使わない——呼び出し元(App.jsx)からisClosedを
//      渡さなくなったこと自体が構造的な保証になっている。
//   2. 人件費は「金額が増えたら悪化」と判定しない(要件5)。美容室特有の売上連動歩合により、
//      売上が伸びれば人件費額が増えるのは正常なため、判定は常にlaborRate(人件費率、
//      pt差)だけで行う——金額(laborCost)は判定に使わず、文章の根拠説明にのみ使う。
//   3. 営業利益/営業利益率の悪化・改善は、数字から直接言える範囲で主要因(人件費率・
//      材料費率のどちらが動いたか)まで触れる(要件6)。生産性等、データの無い原因は
//      絶対に推測して書かない。
//
// 設計方針(変わらない部分):
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
  maxConcernPoints: 5,
  maxNextFocus: 3,
  // 人件費率がこの値を超えている場合、今月の増減に関わらず「来月も引き続き確認すべき
  // 項目」として扱う(要件8の例: 「人件費率45%超→来月の人件費率」)。
  highLaborRateThreshold: 45,
};

// 指標カタログ。「率」(pt差、金額換算しない)と「金額・件数」(前月比%)で計算方法が違う。
// directionは「高いほど良い」か「低いほど良い」かで改善/悪化の符号を決める、この1箇所だけ。
// excludeFromConcernList: trueの指標(人件費額・材料費額)は、この値の増減だけで改善/悪化
// 一覧には出さない(要件5: 金額増加=悪化、と誤判定させないための構造的なガード)。
// 文章の根拠説明(成長率の比較)にだけ使う。
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
  laborCost: { kind: "amount", direction: "higherIsBetter", label: "人件費", format: "yen", excludeFromConcernList: true },
  materialCost: { kind: "amount", direction: "higherIsBetter", label: "材料・仕入原価", format: "yen", excludeFromConcernList: true },
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
// 前月比%の意味自体が壊れるため、その場合は判定自体を「前月比較なし」にする。
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

// 表示直前の整合性チェック。ここを通らない比較結果は画面に一切出さない
// (呼び出し側はこの関数の戻り値がfalseなら「前月比較なし」として扱う)。
export function validateMetricComparison(comparison) {
  if (!comparison) return false;
  if (comparison.judgment === "no_comparison") return true; // 「比較なし」自体は正常な状態
  const { current, previous, diff } = comparison;
  if (!Number.isFinite(current) || !Number.isFinite(previous) || !Number.isFinite(diff)) return false;
  // 差分 = 当月 - 前月、になっているかを直接再検証する。
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
    if ((key === "laborRate" || key === "laborCost") && !(current?.hasLaborData && previous?.hasLaborData)) continue;
    if ((key === "materialRate" || key === "materialCost") && !(current?.hasMaterialData && previous?.hasMaterialData)) continue;
    if ((key === "operatingMargin" || key === "operatingProfit") && (current?.isProvisionalProfit || previous?.isProvisionalProfit)) continue;
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

// 人件費率が動いた時の根拠説明(要件5)。laborRateの改善/悪化は「人件費率(pt)」だけで
// 判定済み(金額の増減は一切判定に使っていない)。ここでは、その判定が正しいことを
// 「人件費の伸び率 vs 売上の伸び率」という、数字から直接言える比較で裏付ける——
// 人件費率 = 人件費 ÷ 売上 なので、人件費率が悪化した時は必ず人件費の伸び率 > 売上の
// 伸び率になっている(逆に改善した時は必ずその逆になっている)。これは推測ではなく
// 算数的に確定した関係であり、根拠のない文章にはならない。
function laborRateBasisClause(comparisons) {
  const rate = comparisons.laborRate;
  const sales = comparisons.sales;
  const laborAmount = comparisons.laborCost;
  if (!rate || rate.judgment === "no_comparison") return "";
  if (!sales || sales.judgment === "no_comparison" || sales.percentChange === null) return "";
  if (!laborAmount || laborAmount.judgment === "no_comparison" || laborAmount.percentChange === null) return "";
  if (rate.judgment === "worsened") {
    return sales.diff >= 0
      ? "売上増加率より人件費増加率が大きくなっています。"
      : "人件費は減少していますが、売上の減少ほど下がっていません。";
  }
  if (rate.judgment === "improved" && laborAmount.diff > 0) {
    // 要件5の例1: 人件費額は増えているが、売上増加に対して人件費率は改善しているケース。
    return `人件費額は${formatValue(laborAmount.previous, "yen")}から${formatValue(laborAmount.current, "yen")}へ増加していますが、売上増加に対して人件費率は${pt1(rate.diff)}改善しており、問題ありません。`;
  }
  return "";
}

// 営業利益率が動いた主要因(要件6)。人件費率・材料費率という、実際に確定済みの比較結果
// からだけ言えることを述べる——生産性等、データの無い原因は書かない。
function profitDriverClause(comparisons) {
  const margin = comparisons.operatingMargin;
  if (!margin || margin.judgment === "no_comparison" || margin.judgment === "unchanged") return "";
  const laborState = comparisons.laborRate?.judgment;
  const materialState = comparisons.materialRate?.judgment;
  if (margin.judgment === "worsened") {
    if (laborState === "worsened" && materialState === "worsened") return "人件費率・材料費率がともに上昇しており、利益を圧迫しています。";
    if (laborState === "worsened") return "人件費率の上昇が主な要因です。";
    if (materialState === "worsened") return "材料・仕入原価率の上昇が主な要因です。";
    return "";
  }
  if (laborState === "improved" && materialState === "improved") return "人件費率・材料費率がともに改善したことが主な要因です。";
  if (laborState === "improved") return "人件費率の改善が主な要因です。";
  if (materialState === "improved") return "材料・仕入原価率の改善が主な要因です。";
  return "";
}

// ①総評。実データ→差分→経営上の意味、の順で2〜4文にまとめる。抽象論・励まし文は
// 一切含めない。前月データが無い場合は当月の実績だけを事実として述べる。
function buildSummaryText(comparisons, current) {
  const sales = comparisons.sales;
  const sentences = [];
  if (!sales || sales.judgment === "no_comparison") {
    sentences.push(`今月の総売上は${formatValue(current.sales, "yen")}でした。比較できる前月データが無いため、今月の実績のみを表示しています。`);
    return sentences.join("");
  }
  const salesVerb = sales.diff >= 0 ? "増加" : "減少";
  sentences.push(`売上は前月比${pct1(sales.percentChange)}${salesVerb}しました。`);

  const profit = comparisons.operatingProfit;
  const margin = comparisons.operatingMargin;
  if (profit && margin && profit.judgment !== "no_comparison" && margin.judgment !== "no_comparison") {
    if (profit.diff === 0 && margin.diff === 0) {
      sentences.push(`営業利益は${formatValue(profit.current, "yen")}、営業利益率は${margin.current.toFixed(1)}%で、前月から変化ありませんでした。`);
    } else {
      const profitVerb = profit.diff > 0 ? "増加" : "減少";
      const marginVerb = margin.diff > 0 ? "上昇" : "低下";
      const driver = profitDriverClause(comparisons);
      sentences.push(
        `営業利益は${formatValue(profit.previous, "yen")}から${formatValue(profit.current, "yen")}へ${profitVerb}し、営業利益率も${margin.previous.toFixed(1)}%から${margin.current.toFixed(1)}%へ${pt1(margin.diff)}${marginVerb}しました。${driver}`
      );
    }
  }

  const laborClause = laborRateBasisClause(comparisons);
  // laborRateBasisClauseの"worsened"文言(要因説明)はプロフィットドライバー文と重複する
  // ため、総評では「改善しているのに金額は増えている」ケース(要件5の例1)だけを載せる。
  // 悪化時の詳細な根拠説明は③要確認ポイント側で個別に述べる。
  if (comparisons.laborRate?.judgment === "improved") {
    if (laborClause) sentences.push(laborClause);
  }

  return sentences.join("");
}

// ②要確認ポイント。実際に悪化した指標だけを、数字から直接言える根拠付きで表示する。
// 人件費(laborCost)・材料費(materialCost)の金額そのものは対象外(要件5、excludeFromConcernList)
// ——人件費率・材料費率(pt差)だけで判定する。
function buildConcernPoints(comparisons, thresholds) {
  const candidates = Object.entries(comparisons).filter(([key, c]) => c.judgment === "worsened" && !METRIC_DEFS[key]?.excludeFromConcernList);
  const magnitude = ([, c]) => (c.percentChange !== null ? Math.abs(c.percentChange) : Math.abs(c.diff));
  return candidates
    .sort((a, b) => magnitude(b) - magnitude(a))
    .slice(0, thresholds.maxConcernPoints)
    .map(([key, c]) => {
      let detail = describeComparison(key, c);
      if (key === "laborRate") {
        const basis = laborRateBasisClause(comparisons);
        if (basis) detail += basis;
      } else if (key === "materialRate" && comparisons.operatingMargin?.judgment === "worsened") {
        detail += "原価負担の上昇も営業利益率低下の一因です。";
      }
      return { id: key, title: `${METRIC_DEFS[key].label}が悪化しています`, detail };
    });
}

// ③来月の注目項目。今月の要確認ポイントに挙がった指標名をそのまま拾う(具体的な指標名の
// みで、行動提案やコンサル的な文章は書かない)。加えて、人件費率が絶対的に高い水準
// (highLaborRateThreshold超)の場合は、今月悪化していなくても来月も見るべき項目として拾う
// (要件8の例)。特に確認すべき項目が無ければ、ユーザー指定の定型文だけを返す。
// 来月の注目項目は「結果指標(売上・営業利益)」より「構造指標(人件費率・材料費率・
// 営業利益率)」を優先して選ぶ——来月実際に追う価値があるのは、要因になっている率の方
// だという判断(要件8の例が人件費率/材料費率/営業利益率/売上回復のみを挙げているのに
// 合わせる)。営業利益そのものは営業利益率で代替できるため候補から外す。
const NEXT_FOCUS_PRIORITY = ["laborRate", "materialRate", "operatingMargin", "sales", "customers", "averageSpend", "newCustomers", "repeatCustomers", "retailSales", "technicalSales", "reviewCount"];

function buildNextFocus(comparisons, concernPoints, thresholds) {
  const labelFor = (key) => {
    if (key === "sales") return "売上の回復";
    return METRIC_DEFS[key]?.label || key;
  };
  const keys = concernPoints.map((point) => point.id).filter((key) => key !== "operatingProfit");
  if (
    Number.isFinite(comparisons.laborRate?.current) &&
    comparisons.laborRate.current > thresholds.highLaborRateThreshold &&
    !keys.includes("laborRate")
  ) {
    keys.push("laborRate");
  }
  const priorityRank = (key) => {
    const index = NEXT_FOCUS_PRIORITY.indexOf(key);
    return index === -1 ? NEXT_FOCUS_PRIORITY.length : index;
  };
  const uniqueKeys = [...new Set(keys)].sort((a, b) => priorityRank(a) - priorityRank(b)).slice(0, thresholds.maxNextFocus);
  if (uniqueKeys.length === 0) {
    return ["現在の利益率を維持できるか確認してください。"];
  }
  return uniqueKeys.map((key) => `来月は${labelFor(key)}を確認してください。`);
}

// hasData:false(当月にまだ何も入力が無い)の場合だけ、他の計算を一切行わず即座に返す。
// 月締め状態は一切参照しない(要件1・2・3の核心)——呼び出し元(App.jsx)もisClosedを
// もう渡さない。
export function analyzeMonthlyReview({
  current,
  previous,
  fieldsEnabled = { customers: true, newCustomers: true, repeatCustomers: true, retailSales: true, reviewCount: true },
  thresholds = MONTHLY_INSIGHT_THRESHOLDS,
} = {}) {
  if (!current?.hasData) {
    return { hasData: false, summaryText: "", concernPoints: [], nextFocus: [], comparisons: {} };
  }
  const comparisons = buildMetricComparisons(current, previous, fieldsEnabled);
  const concernPoints = buildConcernPoints(comparisons, thresholds);
  return {
    hasData: true,
    summaryText: buildSummaryText(comparisons, current),
    concernPoints,
    nextFocus: buildNextFocus(comparisons, concernPoints, thresholds),
    comparisons,
  };
}

// getMonthlyReviewMetrics: calculateMonthSummary(単一店舗)/calculateAllStoresMonthSummary+
// getCompanyDashboardSummary(全店舗)のどちらから来たかを問わず、この分析関数が必要とする
// 値だけをまとめた共通の形へ正規化する(要件11: 画面表示値と同じ計算結果を共通参照する、
// AIレビュー専用の別計算を作らない)。全店舗ビューの人件費率・材料費率・営業利益率は、
// 既存の「各店舗ごとにcalculateMonthSummaryを呼んでから合算し、率は合算後に再計算する」
// 規約(getCompanyDashboardSummary)をそのまま使う——店舗ごとの率を平均しない。
//
// 月締め状態(monthClosingStatus)はここでは一切参照しない——「今、損益表に表示されている
// 数字」をそのまま返すだけで、月締め済みかどうかで値も呼び出し可否も変えない。
export function getMonthlyReviewMetrics(state, { storeId, isAllStoresView, company, storeEntity, companyStores } = {}, monthValue) {
  if (isAllStoresView) {
    const salesSummary = calculateAllStoresMonthSummary(state, company, monthValue);
    const dashboardSummary = getCompanyDashboardSummary(state, company, monthValue);
    const stores = (Array.isArray(companyStores) ? companyStores : company?.stores || []).filter((store) => store?.id && store.status !== "archived");
    // 「入力データがあるか」の判定基準は既存のgetMonthlyReviewSummary(全店舗版)と同一。
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
      laborCost: dashboardSummary.totalLaborCost,
      materialRate: dashboardSummary.purchaseCostRate,
      materialCost: dashboardSummary.totalPurchaseCost,
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
    laborCost: summary.laborCost,
    materialRate: summary.costOfGoodsSoldRate,
    materialCost: summary.costOfGoodsSold,
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
