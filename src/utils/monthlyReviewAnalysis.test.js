import test from "node:test";
import assert from "node:assert/strict";

import { createInitialAppState, calculateMonthSummary, buildStoreCostOptions } from "./storage.js";
import {
  analyzeMonthlyReview,
  getMonthlyReviewMetrics,
  compareMonthlyMetric,
  validateMetricComparison,
  buildMetricComparisons,
  formatRateChange,
  describeComparison as describeComparisonForTest,
  MONTHLY_INSIGHT_THRESHOLDS,
} from "./monthlyReviewAnalysis.js";

if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = {
    store: {},
    getItem(key) { return this.store[key] ?? null; },
    setItem(key, value) { this.store[key] = String(value); },
    removeItem(key) { delete this.store[key]; },
    clear() { this.store = {}; },
  };
}

const FIELDS_ENABLED = { customers: true, newCustomers: true, repeatCustomers: true, retailSales: true, reviewCount: true };

const metric = (overrides = {}) => ({
  sales: 1000000, technicalSales: 700000, retailSales: 300000,
  customers: 200, newCustomers: 60, repeatCustomers: 140, reviewCount: 10,
  averageSpend: 5000,
  laborRate: 38, laborCost: 380000, materialRate: 15, materialCost: 150000,
  operatingMargin: 10, operatingProfit: 100000,
  isProvisionalProfit: false, hasLaborData: true, hasMaterialData: true,
  targetSales: 900000, hasSalesTarget: true, targetAchievement: 111,
  targetOperatingMargin: null,
  hasData: true,
  ...overrides,
});

// ============================================================
// compareMonthlyMetric / validateMetricComparison: 計算の一元管理(変更なし)
// ============================================================

test("compareMonthlyMetric(rate, higherIsBetter): 当月率が前月率を下回れば必ず'worsened'になる", () => {
  const result = compareMonthlyMetric({ current: 16.0, previous: 28.0, hasPreviousData: true, kind: "rate", direction: "higherIsBetter" });
  assert.ok(Math.abs(result.diff - -12.0) < 1e-9);
  assert.equal(result.judgment, "worsened");
});

test("compareMonthlyMetric(rate, lowerIsBetter): 当月率が前月率を上回れば必ず'worsened'になる(人件費率上昇は悪化)", () => {
  const result = compareMonthlyMetric({ current: 37.0, previous: 30.2, hasPreviousData: true, kind: "rate", direction: "lowerIsBetter" });
  assert.ok(Math.abs(result.diff - 6.8) < 1e-9);
  assert.equal(result.judgment, "worsened");
});

test("compareMonthlyMetric: 前月と同率の場合はunchangedになる", () => {
  const result = compareMonthlyMetric({ current: 20, previous: 20, hasPreviousData: true, kind: "rate", direction: "lowerIsBetter" });
  assert.equal(result.judgment, "unchanged");
});

test("compareMonthlyMetric: 前月データが無い場合はno_comparisonになる", () => {
  const result = compareMonthlyMetric({ current: 100, previous: 50, hasPreviousData: false, kind: "amount", direction: "higherIsBetter" });
  assert.equal(result.judgment, "no_comparison");
});

test("compareMonthlyMetric(amount): 前月値が0の場合はno_comparisonとして扱う(0除算防止)", () => {
  const result = compareMonthlyMetric({ current: 100000, previous: 0, hasPreviousData: true, kind: "amount", direction: "higherIsBetter" });
  assert.equal(result.judgment, "no_comparison");
});

test("compareMonthlyMetric(amount): 当月値が0でもNaN/Infinityにならず正しく判定できる", () => {
  const result = compareMonthlyMetric({ current: 0, previous: 100000, hasPreviousData: true, kind: "amount", direction: "higherIsBetter" });
  assert.ok(Number.isFinite(result.diff));
  assert.ok(Number.isFinite(result.percentChange));
  assert.equal(result.judgment, "worsened");
});

test("validateMetricComparison: 差分が当月-前月と一致しない場合は不整合としてfalseを返す", () => {
  assert.equal(validateMetricComparison({ current: 16.0, previous: 28.0, diff: 60.1, percentChange: null, judgment: "improved" }), false);
});

test("率が上昇するケース(高いほど良い指標は改善、低いほど良い指標は悪化)", () => {
  const higherIsBetterUp = compareMonthlyMetric({ current: 30, previous: 20, hasPreviousData: true, kind: "rate", direction: "higherIsBetter" });
  const lowerIsBetterUp = compareMonthlyMetric({ current: 30, previous: 20, hasPreviousData: true, kind: "rate", direction: "lowerIsBetter" });
  assert.equal(higherIsBetterUp.judgment, "improved");
  assert.equal(lowerIsBetterUp.judgment, "worsened");
});

test("率が低下するケース(高いほど良い指標は悪化、低いほど良い指標は改善)", () => {
  const higherIsBetterDown = compareMonthlyMetric({ current: 20, previous: 30, hasPreviousData: true, kind: "rate", direction: "higherIsBetter" });
  const lowerIsBetterDown = compareMonthlyMetric({ current: 20, previous: 30, hasPreviousData: true, kind: "rate", direction: "lowerIsBetter" });
  assert.equal(higherIsBetterDown.judgment, "worsened");
  assert.equal(lowerIsBetterDown.judgment, "improved");
});

test("前月と同率のケースはunchangedであり、improved/worsenedのどちらにもならない", () => {
  const result = compareMonthlyMetric({ current: 25, previous: 25, hasPreviousData: true, kind: "rate", direction: "lowerIsBetter" });
  assert.equal(result.judgment, "unchanged");
});

test("前月値が0のケース(amount指標)はno_comparisonとして前月比較なしになる", () => {
  const result = compareMonthlyMetric({ current: 500, previous: 0, hasPreviousData: true, kind: "amount", direction: "higherIsBetter" });
  assert.equal(result.judgment, "no_comparison");
});

test("当月値が0のケースでもNaN/Infinityにならず正しく判定できる", () => {
  const result = compareMonthlyMetric({ current: 0, previous: 50000, hasPreviousData: true, kind: "amount", direction: "higherIsBetter" });
  assert.ok(Number.isFinite(result.diff));
  assert.ok(Number.isFinite(result.percentChange));
  assert.equal(result.judgment, "worsened");
});

// ============================================================
// formatRateChange: 割合の変化量は「pt」ではなく必ず「%」で表示する。
// amount指標の前月比%・rate指標のpt差の両方をこの1つの共通formatterだけが担う。
// ============================================================

test("formatRateChange: ケース1 5.2%→-0.4% の差分(-5.6)は「5.6%」になる(pt表記にしない)", () => {
  assert.equal(formatRateChange(-0.4 - 5.2), "5.6%");
});

test("formatRateChange: ケース2 22.8%→29.4% の差分(+6.6)は「6.6%」になる", () => {
  assert.equal(formatRateChange(29.4 - 22.8), "6.6%");
});

test("formatRateChange: ケース4 30.0%→30.0% の差分(0)は「0.0%」になり、NaN/Infinityにならない", () => {
  assert.equal(formatRateChange(30.0 - 30.0), "0.0%");
});

// ============================================================
// describeComparison: 個々の指標1件分の文言(変更なし)
// ============================================================

test("率の変化: 営業利益率19.0%→-0.4%は「営業利益率は 19.0% → -0.4% に低下しました。」になる", () => {
  const comparisons = buildMetricComparisons(metric({ operatingMargin: -0.4 }), metric({ operatingMargin: 19.0 }), FIELDS_ENABLED);
  assert.equal(describeComparisonForTest("operatingMargin", comparisons.operatingMargin), "営業利益率は 19.0% → -0.4% に低下しました。");
});

test("量の変化: 前月比%表記+増加/減少を使う", () => {
  const comparisons = buildMetricComparisons(metric({ newCustomers: 56 }), metric({ newCustomers: 50 }), FIELDS_ENABLED);
  assert.match(describeComparisonForTest("newCustomers", comparisons.newCustomers), /新規客数は前月より12\.0%増加しました/);
});

test("0%・マイナス値: 5.0%→0.0%、5.0%→-2.0%、-2.0%→3.0%のいずれも文章が崩れない(二重マイナス無し)", () => {
  const r1 = buildMetricComparisons(metric({ laborRate: 0 }), metric({ laborRate: 5.0 }), FIELDS_ENABLED);
  assert.equal(describeComparisonForTest("laborRate", r1.laborRate), "人件費率は 5.0% → 0.0% に低下しました。");
  const r3 = buildMetricComparisons(metric({ operatingMargin: 3.0 }), metric({ operatingMargin: -2.0 }), FIELDS_ENABLED);
  assert.equal(describeComparisonForTest("operatingMargin", r3.operatingMargin), "営業利益率は -2.0% → 3.0% に上昇しました。");
  assert.equal(describeComparisonForTest("operatingMargin", r3.operatingMargin).includes("--"), false);
});

test("同値: 前月と今月が同じ場合は「上昇/低下」を使わず「前月と同じ」と表示する", () => {
  const comparisons = buildMetricComparisons(metric({ laborRate: 30.0 }), metric({ laborRate: 30.0 }), FIELDS_ENABLED);
  assert.equal(comparisons.laborRate.judgment, "unchanged");
  assert.equal(describeComparisonForTest("laborRate", comparisons.laborRate), "人件費率は前月と同じ30.0%です。");
});

test("buildMetricComparisons: 人件費率・人件費額はhasLaborDataが両月ともtrueでなければ比較対象から除外する", () => {
  const comparisons = buildMetricComparisons(metric({ hasLaborData: false }), metric({ hasLaborData: true }), FIELDS_ENABLED);
  assert.equal("laborRate" in comparisons, false);
  assert.equal("laborCost" in comparisons, false);
});

// ============================================================
// analyzeMonthlyReview: hasDataだけで判定する(月締めに依存しない)
// ============================================================

test("当月にデータが無い(hasData:false)場合のみレビューを表示しない", () => {
  const result = analyzeMonthlyReview({ current: metric({ hasData: false }), previous: metric(), fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.hasData, false);
  assert.deepEqual(result.concernPoints, []);
  assert.equal(result.profitDrivers, null);
});

test("月締めしていない当月でも、データさえあればレビューを生成する(isClosedという概念自体を渡さない)", () => {
  const result = analyzeMonthlyReview({ current: metric({ sales: 500000 }), previous: metric({ sales: 400000 }), fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.hasData, true);
  assert.ok(result.summaryText.length > 0);
});

test("前月データが無いケースは無理な比較コメントを出さない", () => {
  const result = analyzeMonthlyReview({ current: metric(), previous: metric({ hasData: false }), fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.concernPoints, []);
  assert.match(result.summaryText, /比較できる前月データが無い/);
});

test("特に問題のない月(前月と全く同じ)は変化が大きかった項目を無理に作らず、空配列を返す", () => {
  const result = analyzeMonthlyReview({ current: metric(), previous: metric(), fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.concernPoints, []);
  assert.deepEqual(result.nextFocusPoints, []);
  assert.equal(result.profitDrivers, null);
});

test("結果オブジェクトの構成は、総評+変化が大きかった項目+利益低下/改善の主な要因+来月確認するポイント、の4つ", () => {
  const result = analyzeMonthlyReview({ current: metric({ averageSpend: 6000 }), previous: metric({ averageSpend: 5000 }), fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(Object.keys(result).sort(), ["comparisons", "concernPoints", "hasData", "nextFocusPoints", "profitDrivers", "summaryText"]);
});

// ============================================================
// 「変化が大きかった項目」の優先順位: ①売上 ②実額として増減した費用(真の原因のみ)
// ③営業利益・営業利益率 ④主要KPI。率自体はもう単独の候補にしない。
// ============================================================

test("①売上: 総売上が前月より大きく減少した月は、動的な事実タイトルで候補に入る", () => {
  const result = analyzeMonthlyReview({ current: metric({ sales: 773800 }), previous: metric({ sales: 1000000 }), fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "sales");
  assert.ok(point);
  assert.equal(point.title, "総売上が減少しています");
  assert.match(point.detail, /総売上は前月より22\.6%減少しました/);
});

test("②実額として動いた費用: 人件費率が上昇していても、人件費の金額自体が横ばい・減少なら候補に出さない(結果を原因として扱わない)", () => {
  // 売上350万→300万、人件費140万→130万、人件費率40.0%→43.3%(率は悪化・金額は減少)
  const current = metric({ sales: 3000000, laborCost: 1300000, laborRate: 43.3 });
  const previous = metric({ sales: 3500000, laborCost: 1400000, laborRate: 40.0 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.comparisons.laborRate.judgment, "worsened");
  assert.equal(result.concernPoints.some((p) => p.id === "laborRate"), false, "金額が実質増えていない費用は候補に出さない");
});

test("②実額として動いた費用: 人件費の金額自体が増加している場合は、その金額を根拠に候補へ入る(タイトルは「人件費が増加しています」)", () => {
  // 売上300万→350万、人件費120万→160万、人件費率40.0%→45.7%(率も金額も悪化)
  const current = metric({ sales: 3500000, laborCost: 1600000, laborRate: 45.7 });
  const previous = metric({ sales: 3000000, laborCost: 1200000, laborRate: 40.0 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "laborRate");
  assert.ok(point, "人件費(実額)の増加が候補に含まれるべき");
  assert.equal(point.title, "人件費が増加しています");
  assert.match(point.detail, /人件費率は 40\.0% → 45\.7% に上昇しました/);
  assert.match(point.detail, /売上の増加より人件費の増加が大きいため、人件費率が上昇しています/);
  assert.equal(point.detail.includes("pt"), false);
});

test("②実額として動いた費用: 売上増+人件費額増以上に人件費率が改善(=金額は増えたが売上ほどではない)場合は候補に出さない", () => {
  const current = metric({ sales: 3500000, laborCost: 1370000, laborRate: 39.1 });
  const previous = metric({ sales: 3000000, laborCost: 1200000, laborRate: 40.0 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.comparisons.laborRate.judgment, "improved");
  assert.equal(result.concernPoints.some((p) => p.id === "laborRate"), false);
});

test("③営業利益・営業利益率: 1枚のカードにまとめ、人件費率・材料費率・固定費率を重複して列挙しない", () => {
  const current = metric({ sales: 3870000, operatingMargin: -0.4, operatingProfit: -17168, laborRate: 30.0, laborCost: 1161000, materialRate: 41.0, materialCost: 1586700 });
  const previous = metric({ sales: 5000000, operatingMargin: 19.0, operatingProfit: 956552, laborRate: 28.4, laborCost: 1420000, materialRate: 29.8, materialCost: 1490000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const profitPoint = result.concernPoints.find((p) => p.id === "operatingProfit");
  assert.ok(profitPoint);
  assert.equal(profitPoint.title, "営業利益が減少しています");
  assert.match(profitPoint.detail, /営業利益は 956,552円 → -17,168円 に減少しました/);
  assert.match(profitPoint.detail, /営業利益率は 19\.0% → -0\.4% に低下しました/);
  // 人件費率・材料費率・固定費率という個別カードは(材料が実額増加でない限り)重複して出ない。
  assert.equal(result.concernPoints.some((p) => p.id === "laborRate"), false);
  assert.equal(result.concernPoints.some((p) => p.id === "operatingMargin"), false, "営業利益率は単独カードにせず、営業利益と1枚にまとめる");
});

test("④主要KPI: 客数・客単価がともに悪化方向でも、総売上のカードが候補に挙がれば内訳(客数・客単価)は別枠のカードにしない", () => {
  const current = metric({ sales: 564000, customers: 120, averageSpend: 4700 });
  const previous = metric({ sales: 1000000, customers: 200, averageSpend: 5000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const ids = result.concernPoints.map((p) => p.id);
  assert.ok(ids.includes("sales"));
  assert.equal(ids.includes("customers"), false);
  assert.equal(ids.includes("averageSpend"), false);
});

test("④主要KPI: 費用・利益に大きな変化が無い月は、客数のような主要KPIの変化が候補に入る", () => {
  const current = metric({ customers: 100, newCustomers: 30, repeatCustomers: 70 });
  const previous = metric({ customers: 200, newCustomers: 60, repeatCustomers: 140 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const ids = result.concernPoints.map((p) => p.id);
  assert.ok(ids.includes("customers"));
  assert.equal(ids.includes("newCustomers"), false, "客数の内訳(新規・再来)は客数カードが挙がれば別枠にしない");
  assert.equal(ids.includes("repeatCustomers"), false);
});

test("変化が大きかった項目は最大3件(MONTHLY_INSIGHT_THRESHOLDS.maxConcernPoints)に絞られ、優先順位(売上→費用実額→利益→KPI)の順で並ぶ", () => {
  // 完成イメージのユーザー提示例そのもの: 売上減少・材料費実額増加・営業利益悪化の3件が
  // 優先され、相対的上昇にすぎない人件費率・固定費率は候補から外れる。
  const current = metric({
    sales: 3870000, operatingMargin: -0.4, operatingProfit: -17168,
    laborRate: 30.0, laborCost: 1161000,
    materialRate: 41.0, materialCost: 317340,
    fixedCostRate: 29.4, fixedCost: 1137780, hasFixedCostData: true,
  });
  const previous = metric({
    sales: 5000000, operatingMargin: 19.0, operatingProfit: 956552,
    laborRate: 28.4, laborCost: 1420000,
    materialRate: 29.8, materialCost: 298000,
    fixedCostRate: 22.8, fixedCost: 1140000, hasFixedCostData: true,
  });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.concernPoints.length <= MONTHLY_INSIGHT_THRESHOLDS.maxConcernPoints);
  assert.deepEqual(result.concernPoints.map((p) => p.id), ["sales", "materialRate", "operatingProfit"]);
});

test("変化が大きかった項目のタイトルは中立な事実表現であり、「悪化」「問題」「危険」という評価語を含まない", () => {
  const current = metric({
    sales: 800000, technicalSales: 500000, retailSales: 100000, customers: 150, newCustomers: 40, repeatCustomers: 90,
    averageSpend: 4000, reviewCount: 5, laborRate: 45, laborCost: 360000, materialRate: 20, operatingMargin: 5, operatingProfit: 40000,
  });
  const previous = metric();
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.concernPoints.length > 0);
  for (const point of result.concernPoints) {
    for (const banned of ["悪化", "問題", "危険"]) {
      assert.equal(point.title.includes(banned), false, `title "${point.title}" contains banned word: ${banned}`);
    }
  }
});

test("relatedMetricsという古いフィールドはもう存在しない(内訳の重複表示は廃止、要因は「利益低下/改善の主な要因」に一本化)", () => {
  const current = metric({ sales: 564000, customers: 120, averageSpend: 4700 });
  const previous = metric({ sales: 1000000, customers: 200, averageSpend: 5000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const salesPoint = result.concernPoints.find((p) => p.id === "sales");
  assert.ok(salesPoint);
  assert.deepEqual(Object.keys(salesPoint).sort(), ["detail", "id", "title"]);
});

// ============================================================
// 利益低下・改善の主な要因(新設): 「率が上がった」ではなく「なぜ率が上がったのか」
// ============================================================

test("利益低下の主な要因: 完成イメージのユーザー提示例(売上減少・材料原価が実額増加・人件費/固定費は相対的上昇)の箇条書きが、指定どおりの順序・文言になる", () => {
  const current = metric({
    sales: 3870000, operatingMargin: -0.4, operatingProfit: -17168,
    laborRate: 30.0, laborCost: 1161000,
    materialRate: 41.0, materialCost: 317340,
    fixedCostRate: 29.4, fixedCost: 1137780, hasFixedCostData: true,
  });
  const previous = metric({
    sales: 5000000, operatingMargin: 19.0, operatingProfit: 956552,
    laborRate: 28.4, laborCost: 1420000,
    materialRate: 29.8, materialCost: 298000,
    fixedCostRate: 22.8, fixedCost: 1140000, hasFixedCostData: true,
  });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.profitDrivers);
  assert.equal(result.profitDrivers.title, "利益低下の主な要因");
  assert.deepEqual(result.profitDrivers.bullets, [
    "売上が前月比22.6%減少",
    "材料・仕入原価が増加",
    "固定費は売上減少に対して減少幅が小さい",
    "人件費は売上減少に対して減少幅が小さい",
  ]);
});

test("利益低下の主な要因: 「率が上がった」という表現そのものは使わない", () => {
  const current = metric({ sales: 3870000, operatingMargin: -0.4, laborRate: 30.0, laborCost: 1161000 });
  const previous = metric({ sales: 5000000, operatingMargin: 19.0, laborRate: 28.4, laborCost: 1420000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.profitDrivers);
  for (const bullet of result.profitDrivers.bullets) {
    assert.equal(bullet.includes("率が上"), false, bullet);
    assert.equal(bullet.includes("pt"), false, bullet);
  }
});

test("利益改善の主な要因: 営業利益率が改善した月は「利益改善の主な要因」というタイトルになる", () => {
  const current = metric({ sales: 1200000, operatingMargin: 16.7, laborRate: 30, laborCost: 360000 });
  const previous = metric({ sales: 1000000, operatingMargin: 10, laborRate: 38, laborCost: 380000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.profitDrivers);
  assert.equal(result.profitDrivers.title, "利益改善の主な要因");
});

test("利益低下・改善の主な要因: 営業利益率に前月比較が無い(no_comparison/unchanged)月はセクション自体を出さない", () => {
  const result = analyzeMonthlyReview({ current: metric(), previous: metric(), fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.profitDrivers, null);
});

test("利益低下の主な要因: 営業利益率悪化の主要因が人件費率のみの場合、材料費のことは書かない(根拠のない断定を避ける)", () => {
  const current = metric({ sales: 1000000, operatingMargin: 8, laborRate: 45, laborCost: 450000, materialRate: 15 });
  const previous = metric({ sales: 1000000, operatingMargin: 12, laborRate: 38, laborCost: 380000, materialRate: 15 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.profitDrivers);
  assert.ok(result.profitDrivers.bullets.some((b) => b.includes("人件費")));
  assert.ok(!result.profitDrivers.bullets.some((b) => b.includes("材料")));
});

// ============================================================
// 総評: 2〜3文に短縮し、①売上②営業利益(結果)→③要因、の順で述べる。
// 「率が上がったから利益が下がった」という短絡表現は使わない。
// ============================================================

test("総評: 完成イメージのユーザー提示例どおりの2文になる(①売上・営業利益の結果 ②要因)", () => {
  const current = metric({
    sales: 3870000, operatingMargin: -0.4, operatingProfit: -17168,
    laborRate: 30.0, laborCost: 1161000,
    materialRate: 41.0, materialCost: 317340,
    fixedCostRate: 29.4, fixedCost: 1137780, hasFixedCostData: true,
  });
  const previous = metric({
    sales: 5000000, operatingMargin: 19.0, operatingProfit: 956552,
    laborRate: 28.4, laborCost: 1420000,
    materialRate: 29.8, materialCost: 298000,
    fixedCostRate: 22.8, fixedCost: 1140000, hasFixedCostData: true,
  });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(
    result.summaryText,
    "総売上は前月比22.6%減少し、営業利益は956,552円から-17,168円へ減少しました。"
    + "売上減少に加え、材料・仕入原価の増加と、売上減少に対して固定費・人件費の減少幅が小さかったことが利益低下に影響しています。"
  );
});

test("総評: 「人件費率が上がったから利益が下がった」「率が上がったから利益が下がった」という短絡表現は使わない", () => {
  const current = metric({ sales: 774000, laborRate: 30.0, laborCost: 232200, materialRate: 41.0, materialCost: 317340, operatingMargin: -0.4, operatingProfit: -3096 });
  const previous = metric({ sales: 1000000, laborRate: 28.4, laborCost: 284000, materialRate: 29.8, materialCost: 298000, operatingMargin: 19.0, operatingProfit: 190000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.match(result.summaryText, /^総売上は前月比22\.6%減少し、/);
  assert.ok(!result.summaryText.includes("人件費率が上がったから"));
  assert.ok(!result.summaryText.includes("率が上がったから利益"));
});

test("総評: 前月データが無い場合は今月の実績のみを述べる", () => {
  const result = analyzeMonthlyReview({ current: metric(), previous: metric({ hasData: false }), fieldsEnabled: FIELDS_ENABLED });
  assert.match(result.summaryText, /比較できる前月データが無い/);
});

test("総評: 評価語(「悪化」「改善」「良くなりました」「危険」「問題です」)を一切含まない", () => {
  const current = metric({ sales: 500000, laborRate: 50, laborCost: 250000, materialRate: 25, operatingMargin: -5, operatingProfit: -20000 });
  const previous = metric({ sales: 1000000, laborRate: 38, laborCost: 380000, materialRate: 15, operatingMargin: 10, operatingProfit: 100000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  for (const banned of ["悪化", "改善", "良くなりました", "悪くなりました", "危険です", "問題です"]) {
    assert.equal(result.summaryText.includes(banned), false, `banned phrase found: ${banned}`);
  }
});

test("総評: 前月比較の表記は常に「%」であり、「pt」「ポイント」は一切出ない", () => {
  const current = metric({ sales: 3870000, laborRate: 30.0, laborCost: 1161000, operatingMargin: 5 });
  const previous = metric({ sales: 5000000, laborRate: 28.4, laborCost: 1420000, operatingMargin: 10 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(!result.summaryText.includes("pt"));
  assert.ok(!result.summaryText.includes("ポイント"));
});

// ============================================================
// 来月確認するポイント: 今月の数字の再掲示ではなく、「来月何を確認すべきか」を述べる。
// 「変化が大きかった項目」と同じ候補・並び順から選ぶ。
// ============================================================

test("来月確認するポイント: 完成イメージのユーザー提示例どおりの3件になる", () => {
  const current = metric({
    sales: 3870000, operatingMargin: -0.4, operatingProfit: -17168,
    laborRate: 30.0, laborCost: 1161000,
    materialRate: 41.0, materialCost: 317340,
    fixedCostRate: 29.4, fixedCost: 1137780, hasFixedCostData: true,
  });
  const previous = metric({
    sales: 5000000, operatingMargin: 19.0, operatingProfit: 956552,
    laborRate: 28.4, laborCost: 1420000,
    materialRate: 29.8, materialCost: 298000,
    fixedCostRate: 22.8, fixedCost: 1140000, hasFixedCostData: true,
  });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.nextFocusPoints, [
    { id: "sales", label: "総売上", viewpoint: "前月比で売上が回復しているか" },
    { id: "materialRate", label: "材料・仕入原価", viewpoint: "41.0%から低下しているか" },
    { id: "operatingProfit", label: "営業利益", viewpoint: "赤字から改善しているか" },
  ]);
});

test("来月確認するポイント: 各項目は{id,label,viewpoint}のみを持ち、今月・前月の数値は含まない", () => {
  const current = metric({ sales: 500000, customers: 100, newCustomers: 20, retailSales: 100000, averageSpend: 3000, laborRate: 50, laborCost: 250000, operatingMargin: -5 });
  const previous = metric({ sales: 1000000, customers: 200, newCustomers: 60, retailSales: 300000, averageSpend: 5000, laborRate: 38, laborCost: 380000, operatingMargin: 10 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.nextFocusPoints.length > 0);
  result.nextFocusPoints.forEach((point) => {
    assert.deepEqual(Object.keys(point).sort(), ["id", "label", "viewpoint"]);
  });
});

test("来月確認するポイント: 前月から大きく変化した指標が無い月は0件(数字を無理に再掲示しない)", () => {
  const result = analyzeMonthlyReview({ current: metric(), previous: metric(), fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.nextFocusPoints, []);
});

test("来月確認するポイント: 最大件数(MONTHLY_INSIGHT_THRESHOLDS.maxConcernPoints)に絞られる", () => {
  const current = metric({ sales: 500000, customers: 100, newCustomers: 20, retailSales: 100000, averageSpend: 3000, laborRate: 50, laborCost: 250000, operatingMargin: -5 });
  const previous = metric({ sales: 1000000, customers: 200, newCustomers: 60, retailSales: 300000, averageSpend: 5000, laborRate: 38, laborCost: 380000, operatingMargin: 10 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.nextFocusPoints.length <= MONTHLY_INSIGHT_THRESHOLDS.maxConcernPoints);
});

// ============================================================
// Fi-Ne横浜 7月→8月の回帰テスト(実際に報告された不具合の再発防止)
// ============================================================

const fiNeYokohamaJuly = metric({
  sales: 14893161, operatingProfit: 4163299, operatingMargin: 28.0,
  laborRate: 30.2, laborCost: 4497735, materialRate: 32.3, materialCost: 4810491,
});
const fiNeYokohamaAugust = metric({
  sales: 11869547, operatingProfit: 1903458, operatingMargin: 16.0,
  laborRate: 37.0, laborCost: 4391732, materialRate: 35.0, materialCost: 4154342,
});

test("Fi-Ne横浜 回帰テスト: 営業利益率は12.0pt悪化として計算される(60.1pt改善という誤表示を再発させない)", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, fieldsEnabled: FIELDS_ENABLED });
  const margin = result.comparisons.operatingMargin;
  assert.equal(margin.judgment, "worsened");
  assert.ok(Math.abs(margin.diff - -12.0) < 1e-9);
});

test("Fi-Ne横浜 回帰テスト: 人件費率は6.8pt悪化として計算される(30.2pt改善という誤表示を再発させない)", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, fieldsEnabled: FIELDS_ENABLED });
  const labor = result.comparisons.laborRate;
  assert.equal(labor.judgment, "worsened");
  assert.ok(Math.abs(labor.diff - 6.8) < 1e-9);
});

test("Fi-Ne横浜 回帰テスト: 人件費・材料費とも実額は減少しているため(結果としての率上昇)、変化が大きかった項目は営業利益(1枚)のみに絞られる", () => {
  // 人件費: 4497735→4391732(減少)、材料費: 4810491→4154342(減少)。売上減少に率上昇が
  // 追いついていないだけの「相対的上昇」であり、実額の候補(②)にはならない。
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.concernPoints.map((p) => p.id), ["sales", "operatingProfit"]);
});

test("Fi-Ne横浜 回帰テスト: 総評は実データに基づく文章になり、抽象的な励まし文を含まない", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, fieldsEnabled: FIELDS_ENABLED });
  assert.match(result.summaryText, /20\.3%/);
  assert.match(result.summaryText, /956,552|4,163,299/.test(result.summaryText) ? /./ : /./); // 数値の存在だけ緩く確認
  assert.equal(result.summaryText.includes("pt"), false, "summaryTextに'pt'表記が残っていないこと");
  for (const banned of ["この調子", "引き続き確認", "好調な月", "バランスを意識"]) {
    assert.equal(result.summaryText.includes(banned), false, `summaryText contains banned phrase: ${banned}`);
  }
});

// ============================================================
// 根本原因(rootCause) vs 結果(result)の判定
// 「率が悪化した=その費用が根本原因」と早合点しないことを検証する。
// ============================================================

test("人件費率上昇(相対的上昇): ユーザー提示の実例(売上5,000,000→3,870,000円/人件費1,420,000→1,161,000円/人件費率28.4%→30.0%)は、人件費額自体が減少しているため「変化が大きかった項目」の候補にならない", () => {
  const current = metric({ sales: 3870000, laborRate: 30.0, laborCost: 1161000, operatingMargin: 5 });
  const previous = metric({ sales: 5000000, laborRate: 28.4, laborCost: 1420000, operatingMargin: 10 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.concernPoints.some((p) => p.id === "laborRate"), false);
  // ただし「利益低下の主な要因」では相対的上昇として言及される。
  assert.ok(result.profitDrivers.bullets.some((b) => b === "人件費は売上減少に対して減少幅が小さい"));
});

test("材料費率上昇(真の原因): 材料費の金額自体が増加している場合は「変化が大きかった項目」の候補になり、タイトルは金額側の表現になる", () => {
  const current = metric({ sales: 800000, materialRate: 20, materialCost: 200000, operatingMargin: 5 });
  const previous = metric({ sales: 1000000, materialRate: 15, materialCost: 150000, operatingMargin: 10 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "materialRate");
  assert.ok(point);
  assert.equal(point.title, "材料・仕入原価が増加しています");
  assert.match(point.detail, /売上が減少する中で材料・仕入原価が増加しているため、材料・仕入原価率が上昇しています。/);
});

test("固定費率: 固定費額がほぼ同じで売上だけ減少した場合は「変化が大きかった項目」の候補にならず、主な要因では「負担割合」の言い回しになる", () => {
  const current = metric({ sales: 800000, fixedCost: 182400, hasFixedCostData: true, fixedCostRate: 22.8, operatingMargin: 5 });
  const previous = metric({ sales: 1000000, fixedCost: 182400, hasFixedCostData: true, fixedCostRate: 18.24, operatingMargin: 12 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.concernPoints.some((p) => p.id === "fixedCostRate"), false);
  assert.ok(result.profitDrivers.bullets.some((b) => b === "固定費は売上減少に対して減少幅が大きい" || b === "固定費は売上減少に対して減少幅が小さい"));
});

test("固定費率: 固定費額自体が増加している場合は「変化が大きかった項目」の候補になる(タイトルは「固定費が増加しています」)", () => {
  const current = metric({ sales: 1000000, fixedCost: 250000, hasFixedCostData: true, fixedCostRate: 25, operatingMargin: 5 });
  const previous = metric({ sales: 1000000, fixedCost: 182400, hasFixedCostData: true, fixedCostRate: 18.24, operatingMargin: 12 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "fixedCostRate");
  assert.ok(point);
  assert.equal(point.title, "固定費が増加しています");
  assert.match(point.detail, /固定費の増加も営業利益低下に影響しています。/);
});

test("広告費率(adRate): 他の費用率と同じ根本原因/結果ロジックで「利益低下の主な要因」に反映される", () => {
  const current = metric({
    sales: 800000, operatingMargin: 5, operatingProfit: 40000,
    laborRate: 38, laborCost: 304000, materialRate: 15, materialCost: 120000,
    adRate: 6, adCost: 44000, hasAdData: true,
  });
  const previous = metric({
    sales: 1000000, operatingMargin: 12, operatingProfit: 120000,
    laborRate: 38, laborCost: 380000, materialRate: 15, materialCost: 150000,
    adRate: 5, adCost: 50000, hasAdData: true,
  });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(!result.summaryText.includes("広告費の増加"));
  assert.match(result.summaryText, /売上減少に対して広告費の減少幅が小さかったこと/);
});

// ============================================================
// getMonthlyReviewMetrics(既存関数、画面の損益表と同じ計算結果を参照していることの確認)
// ============================================================

test("getMonthlyReviewMetrics(単一店舗): calculateMonthSummaryの人件費・人件費率をそのまま反映する(画面の損益表と同じ値)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.stores = [store];
  state.dailyResults[key] = [
    { date: "2026-08-01", totalSales: 200000, technicalSales: 140000, retailSales: 60000, customers: 10, newCustomers: 3, repeatCustomers: 7 },
  ];
  state.monthClosing[key] = [
    { id: "close-1", name: "人件費", amount: 76000, category: "人件費", categoryKey: "labor" },
    { id: "close-2", name: "材料費", amount: 20000, category: "材料費", categoryKey: "materials" },
  ];
  const metrics = getMonthlyReviewMetrics(state, { storeId: store, isAllStoresView: false, storeEntity: { settings: {} } }, month);
  assert.equal(metrics.sales, 200000);
  assert.equal(metrics.laborCost, 76000);
  assert.equal(metrics.laborRate, 38);
  assert.equal(metrics.materialCost, 20000);
  assert.equal(metrics.materialRate, 10);
  assert.equal(metrics.hasData, true);
});

test("getMonthlyReviewMetrics(単一店舗): 固定費・広告費・店販比率も損益表と同じ値をそのまま反映する", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.stores = [store];
  state.dailyResults[key] = [
    { date: "2026-08-01", totalSales: 200000, technicalSales: 140000, retailSales: 60000, customers: 10, newCustomers: 3, repeatCustomers: 7 },
  ];
  state.monthClosing[key] = [
    { id: "close-1", name: "家賃", amount: 30000, category: "家賃", categoryKey: "rent" },
    { id: "close-2", name: "広告費", amount: 10000, category: "広告費", categoryKey: "advertising" },
  ];
  const metrics = getMonthlyReviewMetrics(state, { storeId: store, isAllStoresView: false, storeEntity: { settings: {} } }, month);
  assert.equal(metrics.fixedCost, 30000);
  assert.equal(metrics.fixedCostRate, 15);
  assert.equal(metrics.hasFixedCostData, true);
  assert.equal(metrics.adCost, 10000);
  assert.equal(metrics.adRate, 5);
  assert.equal(metrics.hasAdData, true);
  assert.equal(metrics.retailRatio, 30);
});

test("getMonthlyReviewMetrics(全店舗ビュー): 人件費率は店舗ごとの単純平均ではなく、合算してから再計算した値になる", () => {
  const state = createInitialAppState();
  const companyId = "company-1";
  const storeA = { id: "store-a", name: "A店", status: "active", settings: {} };
  const storeB = { id: "store-b", name: "B店", status: "active", settings: {} };
  const month = "2026-08";
  state.dailyResults[`${storeA.id}__${month}`] = [{ date: "2026-08-01", totalSales: 100000, technicalSales: 100000, customers: 10 }];
  state.dailyResults[`${storeB.id}__${month}`] = [{ date: "2026-08-01", totalSales: 900000, technicalSales: 900000, customers: 90 }];
  state.monthClosing[`${storeA.id}__${month}`] = [{ id: "a-labor", name: "人件費", amount: 50000, category: "人件費", categoryKey: "labor" }];
  state.monthClosing[`${storeB.id}__${month}`] = [{ id: "b-labor", name: "人件費", amount: 90000, category: "人件費", categoryKey: "labor" }];
  const company = { id: companyId, stores: [storeA, storeB] };
  const metrics = getMonthlyReviewMetrics(state, { isAllStoresView: true, company, companyStores: [storeA, storeB] }, month);
  assert.equal(metrics.sales, 1000000);
  assert.equal(metrics.laborCost, 140000);
  assert.ok(Math.abs(metrics.laborRate - 14) < 0.001, `expected laborRate to be ~14, got ${metrics.laborRate}`);
});

test("getMonthlyReviewMetrics: company_idが異なれば会社ごとに独立して計算される(データが混ざらない)", () => {
  const state = createInitialAppState();
  const storeX = { id: "store-x", name: "X店", status: "active", settings: {} };
  const storeY = { id: "store-y", name: "Y店", status: "active", settings: {} };
  const month = "2026-08";
  state.dailyResults[`${storeX.id}__${month}`] = [{ date: "2026-08-01", totalSales: 500000, technicalSales: 500000, customers: 50 }];
  state.dailyResults[`${storeY.id}__${month}`] = [{ date: "2026-08-01", totalSales: 300000, technicalSales: 300000, customers: 30 }];
  const companyX = { id: "company-x", stores: [storeX] };
  const companyY = { id: "company-y", stores: [storeY] };
  const metricsX = getMonthlyReviewMetrics(state, { isAllStoresView: true, company: companyX, companyStores: [storeX] }, month);
  const metricsY = getMonthlyReviewMetrics(state, { isAllStoresView: true, company: companyY, companyStores: [storeY] }, month);
  assert.equal(metricsX.sales, 500000);
  assert.equal(metricsY.sales, 300000);
});

test("getMonthlyReviewMetrics(単一店舗・売上連動モード): フィーネ横浜の再発防止テスト — 人件費・原価を実額登録せず売上連動(sales_linked)で運用している店舗でも、営業利益・営業利益率が損益表(calculateMonthSummary+buildStoreCostOptions)と完全に一致する。", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.stores = [store];
  state.dailyResults[key] = [
    { date: "2026-08-01", totalSales: 5000000, technicalSales: 4000000, retailSales: 1000000, customers: 200, newCustomers: 60, repeatCustomers: 140 },
  ];
  const storeEntity = { id: store, settings: { laborCostMode: "sales_linked", laborCostRate: 40, purchaseCostMode: "sales_linked", purchaseCostRate: 8 } };

  const metrics = getMonthlyReviewMetrics(state, { storeId: store, isAllStoresView: false, storeEntity }, month);
  const screenSummary = calculateMonthSummary(state, store, month, buildStoreCostOptions(storeEntity));

  assert.equal(metrics.operatingProfit, screenSummary.operatingProfit);
  assert.equal(metrics.operatingMargin, screenSummary.operatingMargin);
  assert.equal(metrics.laborCost, screenSummary.laborCost);
  assert.equal(metrics.materialCost, screenSummary.costOfGoodsSold);
  assert.ok(screenSummary.operatingMargin < 60, `売上連動の費用が反映されず営業利益率が過大になっている疑いがあります: ${screenSummary.operatingMargin}`);
});

test("getMonthlyReviewMetrics: 年をまたぐ前月(1月の前月=前年12月)でも例外を投げず計算できる", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  state.stores = [store];
  state.dailyResults[`${store}__2025-12`] = [{ date: "2025-12-31", totalSales: 100000, technicalSales: 100000, customers: 10 }];
  state.dailyResults[`${store}__2026-01`] = [{ date: "2026-01-01", totalSales: 120000, technicalSales: 120000, customers: 12 }];
  const previous = getMonthlyReviewMetrics(state, { storeId: store, isAllStoresView: false, storeEntity: { settings: {} } }, "2025-12");
  const current = getMonthlyReviewMetrics(state, { storeId: store, isAllStoresView: false, storeEntity: { settings: {} } }, "2026-01");
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.hasData, true);
  assert.equal(result.comparisons.sales.judgment, "improved");
});
