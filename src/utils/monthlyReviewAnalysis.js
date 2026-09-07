// 月次レビュー自動分析(2026-09追加)。生成AI APIは一切使わず、既存の月次損益計算
// (calculateMonthSummary/calculateAllStoresMonthSummary/getCompanyDashboardSummary)の
// 戻り値を読むだけで、①今月のまとめ ②良かった点 ③要確認ポイント ④来月の注目項目、の
// 4ブロックをテンプレート+数値判定で自動生成する。月締め後の確定データにのみ使う
// (月途中の値をこの関数へ渡さないことは呼び出し元の責務——isClosed:falseの場合は
// この関数自身も即座に空の結果を返す)。
//
// 設計方針: 判定・閾値・優先順位はこのファイル1箇所(MONTHLY_INSIGHT_THRESHOLDS/
// CHECK_POINT_RULES)に集約し、後から数値だけ調整できるようにする。既存の集計ロジック
// (calculateMonthSummary等)は一切変更せず、戻り値を読むだけ。
import {
  parseNumber,
  pickVariant,
  diffPercent,
  calculateMonthSummary,
  calculateAllStoresMonthSummary,
  getCompanyDashboardSummary,
} from "./storage.js";

export const MONTHLY_INSIGHT_THRESHOLDS = {
  goodPercentThreshold: 7, // 良かった点: 売上・客数等 前月比+7%以上
  goodMarginPointThreshold: 1.0, // 良かった点: 人件費率改善・営業利益率改善 の最低pt差
  costRateWarnPoint: 3.0, // 要確認: 人件費率/材料費率 +3.0pt以上で警告
  combinationMinPercent: 3, // 要確認: 組み合わせルールで「増加/減少している」とみなす最低%
  monthlyRepeatDropPercent: 5, // 要確認: 新規増+再来減の組み合わせで使う再来客数の最低低下%
  salesFlatBandPercent: 3, // 要確認: 「売上は前月並み」とみなす許容幅(±%)
  maxGoodPoints: 3,
  maxCheckPoints: 4,
  threeMonthPercentStep: 3, // 3か月連続判定: 各月ごとの最低変化%(客単価・再来客数)
  threeMonthPointStep: 0.5, // 3か月連続判定: 各月ごとの最低変化pt(人件費率)
};

const money = (value) => `${Math.round(parseNumber(value)).toLocaleString("ja-JP")}円`;
const pct = (value, digits = 1) => `${Math.abs(parseNumber(value)).toFixed(digits)}%`;
const pt = (value, digits = 1) => `${Math.abs(parseNumber(value)).toFixed(digits)}pt`;

// calculateMonthSummary(単一店舗)/calculateAllStoresMonthSummary+getCompanyDashboardSummary
// (全店舗)のどちらから来たかを問わず、この分析関数が必要とする値だけをまとめた共通の形へ
// 正規化する。全店舗ビューの人件費率・材料費率・営業利益率は、既存の「各店舗ごとに
// calculateMonthSummaryを呼んでから合算し、率は合算後に再計算する」規約
// (getCompanyDashboardSummary)をそのまま使う——店舗ごとの率を平均しない。
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

const safeDiffPercent = (currentValue, previousValue, hasPrevious) => diffPercent(currentValue, previousValue, hasPrevious);
const pointDiff = (currentValue, previousValue) =>
  Number.isFinite(currentValue) && Number.isFinite(previousValue) ? currentValue - previousValue : null;

function isThreeMonthTrendPercent(v2, v1, v0, direction, minStepPercent) {
  if (![v2, v1, v0].every((value) => Number.isFinite(value) && value !== 0)) return false;
  const step1 = ((v1 - v2) / Math.abs(v2)) * 100;
  const step2 = ((v0 - v1) / Math.abs(v1)) * 100;
  return direction === "decline" ? step1 <= -minStepPercent && step2 <= -minStepPercent : step1 >= minStepPercent && step2 >= minStepPercent;
}

function isThreeMonthTrendPoint(v2, v1, v0, direction, minStepPoint) {
  if (![v2, v1, v0].every(Number.isFinite)) return false;
  const step1 = v1 - v2;
  const step2 = v0 - v1;
  return direction === "decline" ? step1 <= -minStepPoint && step2 <= -minStepPoint : step1 >= minStepPoint && step2 >= minStepPoint;
}

// ③要確認ポイントの各ルール。優先順位はこの配列の並び順そのもの
// (3か月連続トレンドは呼び出し元で別途先頭に挿入するため、ここには含めない)。
function buildCheckPointRules(thresholds) {
  return [
    // 例3: 新規増+再来減(日次側のDルールの月次版)。
    {
      id: "newUpRepeatDown",
      focusLabel: "再来客数",
      evaluate: (ctx) => {
        if (!ctx.fieldsEnabled.newCustomers || !ctx.fieldsEnabled.repeatCustomers) return null;
        const newDiff = safeDiffPercent(ctx.current.newCustomers, ctx.previous.newCustomers, ctx.previous.hasData);
        const repeatDiff = safeDiffPercent(ctx.current.repeatCustomers, ctx.previous.repeatCustomers, ctx.previous.hasData);
        if (newDiff === null || repeatDiff === null) return null;
        if (newDiff < thresholds.combinationMinPercent || repeatDiff > -thresholds.monthlyRepeatDropPercent) return null;
        return {
          id: "newUpRepeatDown",
          tone: "warning",
          title: "新規は増加、再来が低下しています",
          detail: `新規客数が前月比${pct(newDiff)}増加していますが、再来客数が前月比${pct(repeatDiff)}減少しています。`,
        };
      },
    },
    // 例1: 売上増+客単価減(客数増で補っている)。
    {
      id: "salesUpSpendDown",
      focusLabel: "客単価",
      evaluate: (ctx) => {
        const salesDiff = safeDiffPercent(ctx.current.sales, ctx.previous.sales, ctx.previous.hasData);
        const spendDiff = safeDiffPercent(ctx.current.averageSpend, ctx.previous.averageSpend, ctx.previous.hasData);
        if (salesDiff === null || spendDiff === null) return null;
        if (salesDiff < thresholds.combinationMinPercent || spendDiff > -thresholds.combinationMinPercent) return null;
        return {
          id: "salesUpSpendDown",
          tone: "neutral",
          title: "客単価が低下しています",
          detail: `売上は前月比${pct(salesDiff)}増加していますが、客単価は前月比${pct(spendDiff)}低下しています。客数増によって売上を補っています。`,
        };
      },
    },
    // 例4: 売上増+材料費率上昇。
    {
      id: "salesUpMaterialRateUp",
      focusLabel: "材料費率",
      evaluate: (ctx) => {
        if (!ctx.current.hasMaterialData || !ctx.previous.hasMaterialData) return null;
        const salesDiff = safeDiffPercent(ctx.current.sales, ctx.previous.sales, ctx.previous.hasData);
        const materialPointDiff = pointDiff(ctx.current.materialRate, ctx.previous.materialRate);
        if (salesDiff === null || materialPointDiff === null) return null;
        if (salesDiff < thresholds.combinationMinPercent || materialPointDiff < thresholds.costRateWarnPoint) return null;
        return {
          id: "salesUpMaterialRateUp",
          tone: "warning",
          title: "材料費率が上昇しています",
          detail: `売上は前月比${pct(salesDiff)}伸びていますが、材料費率も${pt(materialPointDiff)}上昇しています。`,
        };
      },
    },
    // 例2: 売上横ばい+人件費率上昇。
    {
      id: "salesFlatLaborRateUp",
      focusLabel: "人件費率",
      evaluate: (ctx) => {
        if (!ctx.current.hasLaborData || !ctx.previous.hasLaborData) return null;
        const salesDiff = safeDiffPercent(ctx.current.sales, ctx.previous.sales, ctx.previous.hasData);
        const laborPointDiff = pointDiff(ctx.current.laborRate, ctx.previous.laborRate);
        if (salesDiff === null || laborPointDiff === null) return null;
        if (Math.abs(salesDiff) > thresholds.salesFlatBandPercent || laborPointDiff < thresholds.costRateWarnPoint) return null;
        return {
          id: "salesFlatLaborRateUp",
          tone: "warning",
          title: "人件費率が上昇しています",
          detail: `売上は前月並みですが、人件費率が${pt(laborPointDiff)}上昇し、利益が残りにくい構造になっています。`,
        };
      },
    },
    // 例5: 売上目標達成+営業利益率目標未達(targetOperatingMarginが設定されている会社のみ)。
    {
      id: "salesAchievedMarginMissed",
      focusLabel: "営業利益率",
      evaluate: (ctx) => {
        if (ctx.current.isProvisionalProfit) return null;
        if (!ctx.current.hasSalesTarget || ctx.current.targetAchievement === null || ctx.current.targetAchievement < 100) return null;
        if (!ctx.current.targetOperatingMargin || ctx.current.targetOperatingMargin <= 0) return null;
        if (ctx.current.operatingMargin >= ctx.current.targetOperatingMargin) return null;
        return {
          id: "salesAchievedMarginMissed",
          tone: "warning",
          title: "営業利益率が目標を下回っています",
          detail: `売上目標は達成しましたが、営業利益率が目標(${ctx.current.targetOperatingMargin.toFixed(1)}%)を下回りました(実績${ctx.current.operatingMargin.toFixed(1)}%)。`,
        };
      },
    },
  ];
}

function buildThreeMonthTrendPoint(ctx, thresholds) {
  const candidates = [];
  if (ctx.fieldsEnabled.customers && ctx.twoMonthsAgo.hasData && ctx.previous.hasData && ctx.current.hasData) {
    if (isThreeMonthTrendPercent(ctx.twoMonthsAgo.averageSpend, ctx.previous.averageSpend, ctx.current.averageSpend, "decline", thresholds.threeMonthPercentStep)) {
      candidates.push({ id: "threeMonthSpendDecline", tone: "danger", title: "客単価が3か月連続で低下しています", detail: "客単価が3か月連続で低下しています。継続的な要因が無いか確認してください。", focusLabel: "客単価" });
    }
  }
  if (ctx.fieldsEnabled.repeatCustomers && ctx.twoMonthsAgo.hasData && ctx.previous.hasData && ctx.current.hasData) {
    if (isThreeMonthTrendPercent(ctx.twoMonthsAgo.repeatCustomers, ctx.previous.repeatCustomers, ctx.current.repeatCustomers, "decline", thresholds.threeMonthPercentStep)) {
      candidates.push({ id: "threeMonthRepeatDecline", tone: "danger", title: "再来客数が3か月連続で低下しています", detail: "再来客数が3か月連続で低下しています。継続的な要因が無いか確認してください。", focusLabel: "再来客数" });
    }
  }
  if (ctx.twoMonthsAgo.hasLaborData && ctx.previous.hasLaborData && ctx.current.hasLaborData) {
    if (isThreeMonthTrendPoint(ctx.twoMonthsAgo.laborRate, ctx.previous.laborRate, ctx.current.laborRate, "rise", thresholds.threeMonthPointStep)) {
      candidates.push({ id: "threeMonthLaborRateRise", tone: "danger", title: "人件費率が3か月連続で上昇しています", detail: "人件費率が3か月連続で上昇しています。継続的な要因が無いか確認してください。", focusLabel: "人件費率" });
    }
  }
  return candidates;
}

// ①今月のまとめ。売上前月比を軸に、客数/客単価のどちらが売上変化の主要因かを機械的に
// 選び(絶対値が大きい方)、人件費率が大きく上昇していれば追加で1文触れる——すべて
// テンプレートへの数値差し込みで、自由生成はしない。
function buildSummaryText(current, previous, thresholds, seed) {
  if (!previous.hasData) {
    return `今月の総売上は${money(current.sales)}でした。比較できる前月データが無いため、今月の実績のみを表示しています。`;
  }
  const salesDiff = safeDiffPercent(current.sales, previous.sales, previous.hasData);
  const sentences = [];
  if (salesDiff !== null) {
    sentences.push(`総売上は前月比${salesDiff >= 0 ? "+" : "-"}${pct(salesDiff)}${salesDiff >= 0 ? "増加" : "減少"}しました。`);
  } else {
    sentences.push(`今月の総売上は${money(current.sales)}でした。`);
  }

  const customersDiff = safeDiffPercent(current.customers, previous.customers, previous.hasData);
  const spendDiff = safeDiffPercent(current.averageSpend, previous.averageSpend, previous.hasData);
  if (customersDiff !== null && spendDiff !== null && salesDiff !== null) {
    const dominant = Math.abs(customersDiff) >= Math.abs(spendDiff) ? "customers" : "spend";
    const driverLabel = dominant === "customers" ? "客数増" : "客単価上昇";
    const driverLabelNeg = dominant === "customers" ? "客数減" : "客単価低下";
    const resultLabel = salesDiff >= 0 ? "伸ばした" : "落とした";
    const usedDriver = (dominant === "customers" ? customersDiff : spendDiff) >= 0 ? driverLabel : driverLabelNeg;
    sentences.push(
      `客数は前月比${pct(customersDiff)}${customersDiff >= 0 ? "増加" : "減少"}した一方、客単価は前月比${pct(spendDiff)}${spendDiff >= 0 ? "上昇" : "低下"}しており、${usedDriver}によって売上を${resultLabel}月となりました。`
    );
  }

  if (current.hasLaborData && previous.hasLaborData) {
    const laborPointDiff = pointDiff(current.laborRate, previous.laborRate);
    if (laborPointDiff !== null && Math.abs(laborPointDiff) >= thresholds.costRateWarnPoint && !current.isProvisionalProfit && !previous.isProvisionalProfit) {
      const marginDirectionWord = current.operatingMargin < previous.operatingMargin ? "低下" : "上昇";
      sentences.push(`人件費率は前月より${pt(laborPointDiff)}${laborPointDiff >= 0 ? "上昇" : "低下"}したため、営業利益率は${marginDirectionWord}しています。`);
    }
  }

  return pickVariant([sentences.join("")], seed);
}

// ②良かった点。閾値を超えた候補を集め、変化の大きさ(単位はpercent/pointが混在するが、
// 数値の絶対値で単純比較する簡易的な優先順位付けにとどめる)で上位3件だけ返す。
function buildGoodPoints(current, previous, fieldsEnabled, thresholds) {
  if (!previous.hasData) return [];
  const candidates = [];
  const push = (id, title, detailFn, diffValue) => {
    if (diffValue === null || !Number.isFinite(diffValue)) return;
    candidates.push({ id, title, detail: detailFn(diffValue), magnitude: Math.abs(diffValue) });
  };

  const salesDiff = safeDiffPercent(current.sales, previous.sales, true);
  if (salesDiff !== null && salesDiff >= thresholds.goodPercentThreshold) {
    push("sales", "総売上が増加しました", (d) => `総売上が前月比${pct(d)}増加しました。`, salesDiff);
  }
  if (fieldsEnabled.newCustomers) {
    const newDiff = safeDiffPercent(current.newCustomers, previous.newCustomers, true);
    if (newDiff !== null && newDiff >= thresholds.goodPercentThreshold) {
      push("newCustomers", "新規客数が増加しました", (d) => `新規客数が前月比${pct(d)}増加しました。`, newDiff);
    }
  }
  if (fieldsEnabled.retailSales) {
    const retailDiff = safeDiffPercent(current.retailSales, previous.retailSales, true);
    if (retailDiff !== null && retailDiff >= thresholds.goodPercentThreshold) {
      push("retailSales", "店販売上が増加しました", (d) => `店販売上が前月比${pct(d)}増加しました。`, retailDiff);
    }
  }
  if (fieldsEnabled.repeatCustomers) {
    const repeatDiff = safeDiffPercent(current.repeatCustomers, previous.repeatCustomers, true);
    if (repeatDiff !== null && repeatDiff >= thresholds.goodPercentThreshold) {
      push("repeatCustomers", "再来客数が増加しました", (d) => `再来客数が前月比${pct(d)}増加しました。`, repeatDiff);
    }
  }
  const spendDiff = safeDiffPercent(current.averageSpend, previous.averageSpend, true);
  if (spendDiff !== null && spendDiff >= thresholds.goodPercentThreshold) {
    push("averageSpend", "客単価が上昇しました", (d) => `客単価が前月比${pct(d)}上昇しました。`, spendDiff);
  }
  if (current.hasLaborData && previous.hasLaborData) {
    const laborPointDiff = pointDiff(current.laborRate, previous.laborRate);
    if (laborPointDiff !== null && laborPointDiff <= -thresholds.goodMarginPointThreshold) {
      push("laborRate", "人件費率が改善しました", (d) => `人件費率が前月より${pt(d)}改善しました。`, laborPointDiff);
    }
  }
  if (!current.isProvisionalProfit && !previous.isProvisionalProfit) {
    const marginPointDiff = pointDiff(current.operatingMargin, previous.operatingMargin);
    if (marginPointDiff !== null && marginPointDiff >= thresholds.goodMarginPointThreshold) {
      push("operatingMargin", "営業利益率が改善しました", (d) => `営業利益率が前月より${pt(d)}改善しました。`, marginPointDiff);
    }
  }

  return candidates
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, thresholds.maxGoodPoints)
    .map(({ id, title, detail }) => ({ id, title, detail }));
}

function buildNextFocus(checkPoints, goodPoints, seed) {
  if (checkPoints.length > 0) {
    const labels = [...new Set(checkPoints.map((point) => point.focusLabel).filter(Boolean))].slice(0, 2);
    if (labels.length === 2) return [`来月は${labels[0]}と${labels[1]}を重点的に確認してください。`];
    if (labels.length === 1) return [`来月は${labels[0]}を重点的に確認してください。`];
  }
  if (goodPoints.length > 0) {
    return [pickVariant(["好調な項目が多い月でした。この調子を維持しつつ、来月も引き続き数字を確認していきましょう。"], seed)];
  }
  return [pickVariant(["来月も引き続き、売上・客数・客単価の推移を確認していきましょう。"], seed)];
}

// isClosed:false の場合は他の計算を一切行わず即座に返す(要件: 月途中の誤解を招く表示防止)。
export function analyzeMonthlyReview({
  current,
  previous,
  twoMonthsAgo,
  isClosed,
  fieldsEnabled = { customers: true, newCustomers: true, repeatCustomers: true, retailSales: true },
  thresholds = MONTHLY_INSIGHT_THRESHOLDS,
  seed = "",
} = {}) {
  if (!isClosed) {
    return { isClosed: false, summaryText: "", goodPoints: [], checkPoints: [], nextFocus: [] };
  }

  const ctx = { current, previous, twoMonthsAgo, fieldsEnabled };
  const checkPointHits = [];
  buildThreeMonthTrendPoint(ctx, thresholds).forEach((hit) => checkPointHits.push(hit));
  buildCheckPointRules(thresholds).forEach((rule) => {
    const hit = rule.evaluate(ctx);
    if (hit) checkPointHits.push({ ...hit, focusLabel: rule.focusLabel });
  });
  const checkPoints = checkPointHits.slice(0, thresholds.maxCheckPoints);

  const goodPoints = buildGoodPoints(current, previous, fieldsEnabled, thresholds);
  const summaryText = buildSummaryText(current, previous, thresholds, seed);
  const nextFocus = buildNextFocus(checkPoints, goodPoints, seed);

  return { isClosed: true, summaryText, goodPoints, checkPoints, nextFocus };
}
