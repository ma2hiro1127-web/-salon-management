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

// hasSalesTarget:falseを既定にし(達成率の総評3文目は専用テストでだけ有効化する)、
// 他の大半のテストが達成率の副作用を気にせず書けるようにする。
const metric = (overrides = {}) => ({
  sales: 1000000, technicalSales: 700000, retailSales: 300000,
  customers: 200, newCustomers: 60, repeatCustomers: 140, reviewCount: 10,
  averageSpend: 5000,
  laborRate: 38, laborCost: 380000, materialRate: 15, materialCost: 150000,
  operatingMargin: 10, operatingProfit: 100000,
  isProvisionalProfit: false, hasLaborData: true, hasMaterialData: true,
  targetSales: 0, hasSalesTarget: false, targetAchievement: null,
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

test("validateMetricComparison: 差分が当月-前月と一致しない場合は不整合としてfalseを返す", () => {
  assert.equal(validateMetricComparison({ current: 16.0, previous: 28.0, diff: 60.1, percentChange: null, judgment: "improved" }), false);
});

test("formatRateChange: 22.8%→29.4% の差分(+6.6)は「6.6%」になる(pt表記にしない)", () => {
  assert.equal(formatRateChange(29.4 - 22.8), "6.6%");
});

test("率の変化: 営業利益率19.0%→-0.4%は「営業利益率は 19.0% → -0.4% に低下しました。」になる", () => {
  const comparisons = buildMetricComparisons(metric({ operatingMargin: -0.4 }), metric({ operatingMargin: 19.0 }), FIELDS_ENABLED);
  assert.equal(describeComparisonForTest("operatingMargin", comparisons.operatingMargin), "営業利益率は 19.0% → -0.4% に低下しました。");
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

test("前月データが無いケースは無理な比較コメントを出さない", () => {
  const result = analyzeMonthlyReview({ current: metric(), previous: metric({ hasData: false }), fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.concernPoints, []);
  assert.match(result.summaryText, /比較できる前月データが無い/);
});

test("特に問題のない月(前月と全く同じ)は変化が大きかった項目・利益要因を無理に作らず、空/nullを返す", () => {
  const result = analyzeMonthlyReview({ current: metric(), previous: metric(), fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.concernPoints, []);
  assert.deepEqual(result.nextFocusPoints, []);
  assert.equal(result.profitDrivers, null);
});

test("結果オブジェクトの構成は、総評+変化が大きかった項目+利益に影響した主な要因+来月確認するポイント、の4つ", () => {
  const result = analyzeMonthlyReview({ current: metric({ averageSpend: 6000 }), previous: metric({ averageSpend: 5000 }), fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(Object.keys(result).sort(), ["comparisons", "concernPoints", "hasData", "nextFocusPoints", "profitDrivers", "summaryText"]);
});

// ============================================================
// 「変化が大きかった項目」の優先順位(2026-09最終改訂):
// ①総売上 ②営業利益・営業利益率 ③材料・仕入原価の実額(真の原因のみ)
// ④人件費の実額(真の原因のみ) ⑤主要KPI ⑥その他費用率(真の原因のみ)
// カードの内容は「数字の変化を示すだけ」(実額+率)で、原因の説明は含めない。
// ============================================================

test("①総売上: 大きく減少した月は動的な事実タイトルで候補に入り、詳細は数字のみ(原因説明を含まない)", () => {
  const result = analyzeMonthlyReview({ current: metric({ sales: 773800 }), previous: metric({ sales: 1000000 }), fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "sales");
  assert.ok(point);
  assert.equal(point.title, "総売上が減少しています");
  assert.equal(point.detail, "総売上は前月より22.6%減少しました。");
});

test("②営業利益・営業利益率: 1枚のカードにまとめ、原因説明を含めない(要件9・19: 何が起きたかと、なぜ起きたかを分ける)", () => {
  const current = metric({ sales: 3870000, operatingMargin: -0.4, operatingProfit: -17168 });
  const previous = metric({ sales: 5000000, operatingMargin: 19.0, operatingProfit: 956552 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "operatingProfit");
  assert.ok(point);
  assert.equal(point.title, "営業利益が減少しています");
  assert.equal(point.detail, "営業利益は 956,552円 → -17,168円 に減少しました。営業利益率は 19.0% → -0.4% に低下しました。");
  assert.equal(point.detail.includes("影響しています"), false, "原因の説明はこのカードに含めない");
});

test("③材料・仕入原価の実額: 実額自体が増加している場合のみ候補になり、詳細は実額と率の両方(要件5ケースA・要件8)", () => {
  const current = metric({ sales: 800000, materialRate: 20, materialCost: 200000 });
  const previous = metric({ sales: 1000000, materialRate: 15, materialCost: 150000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "materialRate");
  assert.ok(point);
  assert.equal(point.title, "材料・仕入原価が増加しています");
  assert.equal(point.detail, "材料・仕入原価は前月より33.3%増加しました。材料・仕入原価率は 15.0% → 20.0% に上昇しました。");
});

test("③材料・仕入原価の実額: 実額は減少しているが率だけ上昇している(相対的上昇、要件5ケースB)場合は候補にならない", () => {
  const current = metric({ sales: 800000, materialRate: 20, materialCost: 160000 });
  const previous = metric({ sales: 1000000, materialRate: 15, materialCost: 180000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.concernPoints.some((p) => p.id === "materialRate"), false);
});

test("④人件費の実額: 実額自体が増加している場合のみ候補になり、材料より優先度は低い(③材料 > ④人件費)", () => {
  const current = metric({
    sales: 800000,
    materialRate: 20, materialCost: 200000,
    laborRate: 45, laborCost: 360000,
  });
  const previous = metric({
    sales: 1000000,
    materialRate: 15, materialCost: 150000,
    laborRate: 38, laborCost: 300000,
  });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const ids = result.concernPoints.map((p) => p.id);
  const materialIndex = ids.indexOf("materialRate");
  const laborIndex = ids.indexOf("laborRate");
  assert.ok(materialIndex !== -1 && laborIndex !== -1);
  assert.ok(materialIndex < laborIndex, "材料・仕入原価は人件費より優先順位が高い");
});

test("⑤主要KPI: 費用・利益に大きな変化が無い月は、客数のような主要KPIの変化が候補に入る", () => {
  const current = metric({ customers: 100, newCustomers: 30, repeatCustomers: 70 });
  const previous = metric({ customers: 200, newCustomers: 60, repeatCustomers: 140 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const ids = result.concernPoints.map((p) => p.id);
  assert.ok(ids.includes("customers"));
  assert.equal(ids.includes("newCustomers"), false, "客数の内訳(新規・再来)は客数カードが挙がれば別枠にしない");
});

test("⑥その他費用率: 固定費実額が増加している場合は候補になる(優先度は主要KPIより低い)", () => {
  const current = metric({ sales: 1000000, fixedCost: 250000, hasFixedCostData: true, fixedCostRate: 25 });
  const previous = metric({ sales: 1000000, fixedCost: 182400, hasFixedCostData: true, fixedCostRate: 18.24 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "fixedCostRate");
  assert.ok(point);
  assert.equal(point.title, "固定費が増加しています");
});

test("変化が大きかった項目は最大3件に絞られ、優先順位(売上→利益→材料実額→人件費実額→KPI→他費用率)の順で並ぶ", () => {
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
  assert.deepEqual(result.concernPoints.map((p) => p.id), ["sales", "operatingProfit", "materialRate"]);
});

test("大きな変化が2件しかない月は2件のみ表示し、無理に3件埋めない(要件21)", () => {
  const current = metric({ sales: 773800, operatingProfit: 50000, operatingMargin: 6.5 });
  const previous = metric({ sales: 1000000, operatingProfit: 100000, operatingMargin: 10 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.concernPoints.length, 2);
});

test("変化が大きかった項目のタイトルは中立な事実表現であり、「悪化」「問題」「危険」という評価語を含まない", () => {
  const current = metric({
    sales: 800000, technicalSales: 500000, retailSales: 100000, customers: 150, newCustomers: 40, repeatCustomers: 90,
    averageSpend: 4000, reviewCount: 5, materialRate: 20, materialCost: 160000, operatingMargin: 5, operatingProfit: 40000,
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

test("relatedMetricsという古いフィールドはもう存在しない(内訳の重複表示は廃止)", () => {
  const current = metric({ sales: 564000, customers: 120, averageSpend: 4700 });
  const previous = metric({ sales: 1000000, customers: 200, averageSpend: 5000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const salesPoint = result.concernPoints.find((p) => p.id === "sales");
  assert.ok(salesPoint);
  assert.deepEqual(Object.keys(salesPoint).sort(), ["detail", "id", "title"]);
});

// ============================================================
// 利益に影響した主な要因(2026-09最終改訂): タイトルは営業利益の方向で自動的に変わり、
// 「率が上がった」ではなく「なぜそうなったか」を最大4件の箇条書きで述べる。
// ============================================================

test("利益低下の主な要因: 完成イメージの箇条書きが指定どおりの順序・文言になる", () => {
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

test("利益低下の主な要因は最大4件に絞られる", () => {
  const current = metric({
    sales: 800000, operatingMargin: -2, operatingProfit: -16000,
    laborRate: 45, laborCost: 360000, materialRate: 22, materialCost: 176000,
    fixedCostRate: 27, fixedCost: 216000, hasFixedCostData: true,
    adRate: 8, adCost: 64000, hasAdData: true,
  });
  const previous = metric({
    sales: 1000000, operatingMargin: 10, operatingProfit: 100000,
    laborRate: 38, laborCost: 380000, materialRate: 15, materialCost: 150000,
    fixedCostRate: 18, fixedCost: 180000, hasFixedCostData: true,
    adRate: 5, adCost: 50000, hasAdData: true,
  });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.profitDrivers);
  assert.ok(result.profitDrivers.bullets.length <= 4);
});

test("利益改善の主な要因: 営業利益率が改善した月は「利益改善の主な要因」というタイトルになる", () => {
  const current = metric({ sales: 1200000, operatingMargin: 16.7, operatingProfit: 200400, laborRate: 30, laborCost: 360000 });
  const previous = metric({ sales: 1000000, operatingMargin: 10, operatingProfit: 100000, laborRate: 38, laborCost: 380000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.profitDrivers);
  assert.equal(result.profitDrivers.title, "利益改善の主な要因");
});

test("営業利益に影響した主な要因: 営業利益率がほぼ横ばい(unchanged)でも売上が大きく動いていれば中立タイトルで表示する(要件10)", () => {
  // 材料・人件費・固定費すべてが売上と完全に比例して動き、営業利益率だけは前月と同じ
  // (=典型的な「ほぼ横ばい」)というケース。
  const current = metric({
    sales: 800000, operatingMargin: 10, operatingProfit: 80000,
    laborRate: 38, laborCost: 304000, materialRate: 15, materialCost: 120000,
  });
  const previous = metric({
    sales: 1000000, operatingMargin: 10, operatingProfit: 100000,
    laborRate: 38, laborCost: 380000, materialRate: 15, materialCost: 150000,
  });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.profitDrivers);
  assert.equal(result.profitDrivers.title, "営業利益に影響した主な要因");
  assert.deepEqual(result.profitDrivers.bullets, ["売上が前月比20.0%減少"]);
});

test("利益に影響した主な要因: 「率が上がった」という表現そのものは使わない", () => {
  const current = metric({ sales: 3870000, operatingMargin: -0.4, laborRate: 30.0, laborCost: 1161000 });
  const previous = metric({ sales: 5000000, operatingMargin: 19.0, laborRate: 28.4, laborCost: 1420000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.profitDrivers);
  for (const bullet of result.profitDrivers.bullets) {
    assert.equal(bullet.includes("率が上"), false, bullet);
    assert.equal(bullet.includes("pt"), false, bullet);
  }
});

test("利益低下の主な要因: 材料費のことは書かない(主要因が人件費のみの場合、根拠のない断定を避ける)", () => {
  const current = metric({ sales: 1000000, operatingMargin: 8, operatingProfit: 80000, laborRate: 45, laborCost: 450000, materialRate: 15 });
  const previous = metric({ sales: 1000000, operatingMargin: 12, operatingProfit: 120000, laborRate: 38, laborCost: 380000, materialRate: 15 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.profitDrivers);
  assert.ok(result.profitDrivers.bullets.some((b) => b.includes("人件費")));
  assert.ok(!result.profitDrivers.bullets.some((b) => b.includes("材料")));
});

// ============================================================
// 売上変化の要因分析(要件11・12): 客数・客単価・新規/再来客のどれが主な要因かを補足する。
// データが無い/方向がはっきりしない指標については推測しない(要件20)。
// ============================================================

test("売上低下: 客数が減少し客単価はほぼ変わらない場合、「客数減少が売上低下に影響しています」を利益要因に含める", () => {
  const current = metric({ sales: 700000, customers: 140, averageSpend: 5000, operatingMargin: 5, operatingProfit: 35000 });
  const previous = metric({ sales: 1000000, customers: 200, averageSpend: 5000, operatingMargin: 10, operatingProfit: 100000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.profitDrivers.bullets.includes("客数減少が売上低下に影響しています。"));
});

test("売上低下: 客数がほぼ同じで客単価が低下している場合、「客単価低下が売上減少に影響しています」を利益要因に含める", () => {
  const current = metric({ sales: 800000, customers: 200, averageSpend: 4000, operatingMargin: 5, operatingProfit: 40000 });
  const previous = metric({ sales: 1000000, customers: 200, averageSpend: 5000, operatingMargin: 10, operatingProfit: 100000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.profitDrivers.bullets.includes("客単価低下が売上減少に影響しています。"));
});

test("売上低下: 新規客は増加しているが再来客が減少している場合、対比を1文で述べる", () => {
  const current = metric({ sales: 900000, customers: 180, newCustomers: 70, repeatCustomers: 110, operatingMargin: 8, operatingProfit: 72000 });
  const previous = metric({ sales: 1000000, customers: 200, newCustomers: 60, repeatCustomers: 140, operatingMargin: 10, operatingProfit: 100000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.profitDrivers.bullets.includes("新規客は増加していますが、再来客減少が売上低下に影響しています。"));
});

test("売上改善: 客数増加が売上成長に貢献した場合も、悪化月と同じロジックで良かった要因として拾う(要件12・22)", () => {
  const current = metric({ sales: 1300000, customers: 260, averageSpend: 5000, operatingMargin: 12, operatingProfit: 156000 });
  const previous = metric({ sales: 1000000, customers: 200, averageSpend: 5000, operatingMargin: 10, operatingProfit: 100000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.profitDrivers.bullets.includes("客数増加が売上成長に貢献しています。"));
});

test("データ不足時: 新規・再来客数の入力設定がOFFの場合、その内訳を要因として推測しない(要件20)", () => {
  const fieldsEnabled = { ...FIELDS_ENABLED, newCustomers: false, repeatCustomers: false };
  const current = metric({ sales: 700000, customers: 140, averageSpend: 5000, operatingMargin: 5, operatingProfit: 35000 });
  const previous = metric({ sales: 1000000, customers: 200, averageSpend: 5000, operatingMargin: 10, operatingProfit: 100000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled });
  assert.ok(!result.profitDrivers.bullets.some((b) => b.includes("新規") || b.includes("再来")));
  assert.ok(result.profitDrivers.bullets.includes("客数減少が売上低下に影響しています。"));
});

// ============================================================
// 総評: 2〜3文以内。①結果②主な原因③(必要な場合のみ)売上目標達成率の補足。
// 「率が上がったから利益が下がった」という短絡表現は使わない。
// ============================================================

test("総評: 完成イメージどおりの2文になる(①売上・営業利益の結果 ②要因)", () => {
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

test("総評: 売上目標を達成した月は「売上目標を達成しました。」を3文目に加える(要件13)", () => {
  const current = metric({ sales: 1100000, operatingMargin: 11, operatingProfit: 121000, targetSales: 1000000, hasSalesTarget: true, targetAchievement: 110 });
  const previous = metric({ sales: 1000000, operatingMargin: 10, operatingProfit: 100000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.summaryText.endsWith("売上目標を達成しました。"));
});

test("総評: 売上目標は達成しているが営業利益が前月を下回っている場合は、その旨を明示する(要件13)", () => {
  const current = metric({
    sales: 1100000, operatingMargin: 5, operatingProfit: 55000,
    laborRate: 45, laborCost: 495000,
    targetSales: 1000000, hasSalesTarget: true, targetAchievement: 110,
  });
  const previous = metric({ sales: 1000000, operatingMargin: 10, operatingProfit: 100000, laborRate: 38, laborCost: 380000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.summaryText.endsWith("売上目標は達成していますが、営業利益は前月を下回っています。"));
});

test("総評: 達成率90〜99.9%は「売上目標に近い水準でした。」を加える(要件13)", () => {
  const current = metric({ sales: 950000, operatingMargin: 10, operatingProfit: 95000, targetSales: 1000000, hasSalesTarget: true, targetAchievement: 95 });
  const previous = metric({ sales: 1000000, operatingMargin: 10, operatingProfit: 100000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.summaryText.endsWith("売上目標に近い水準でした。"));
});

test("総評: 大幅未達の場合は達成率について無理に触れない(総評を2〜3文以内に保つ、完成イメージと同じ挙動)", () => {
  const current = metric({
    sales: 3870000, operatingMargin: -0.4, operatingProfit: -17168,
    laborRate: 30.0, laborCost: 1161000, materialRate: 41.0, materialCost: 317340,
    targetSales: 5500000, hasSalesTarget: true, targetAchievement: 70.4,
  });
  const previous = metric({ sales: 5000000, operatingMargin: 19.0, operatingProfit: 956552, laborRate: 28.4, laborCost: 1420000, materialRate: 29.8, materialCost: 298000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(!result.summaryText.includes("目標"));
});

// ============================================================
// 22〜24: 良かった月・売上と利益が逆方向に動いた月も正しく評価する
// ============================================================

test("要件22: 売上↑・営業利益↑の月は改善要因を自然にレビューする", () => {
  const current = metric({ sales: 1200000, operatingMargin: 14, operatingProfit: 168000, materialRate: 12, materialCost: 144000 });
  const previous = metric({ sales: 1000000, operatingMargin: 10, operatingProfit: 100000, materialRate: 15, materialCost: 150000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.match(result.summaryText, /^総売上は前月比20\.0%増加し、営業利益は100,000円から168,000円へ増加しました。/);
  assert.ok(result.summaryText.includes("利益改善に影響しています"));
});

test("要件23: 売上↑・営業利益↓の月は売上と利益を別々に評価する", () => {
  const current = metric({
    sales: 1200000, operatingMargin: 5, operatingProfit: 60000,
    laborRate: 42, laborCost: 504000, materialRate: 18, materialCost: 216000,
  });
  const previous = metric({
    sales: 1000000, operatingMargin: 10, operatingProfit: 100000,
    laborRate: 38, laborCost: 380000, materialRate: 15, materialCost: 150000,
  });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.match(result.summaryText, /^総売上は前月比20\.0%増加し、営業利益は100,000円から60,000円へ減少しました。/);
  assert.ok(result.profitDrivers);
  assert.equal(result.profitDrivers.title, "利益低下の主な要因");
});

test("要件24: 売上↓・営業利益↑の月は費用削減による改善として評価する", () => {
  const current = metric({
    sales: 800000, operatingMargin: 15, operatingProfit: 120000,
    laborRate: 30, laborCost: 240000, materialRate: 10, materialCost: 80000,
  });
  const previous = metric({
    sales: 1000000, operatingMargin: 10, operatingProfit: 100000,
    laborRate: 38, laborCost: 380000, materialRate: 15, materialCost: 150000,
  });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.match(result.summaryText, /^総売上は前月比20\.0%減少し、営業利益は100,000円から120,000円へ増加しました。/);
  assert.ok(result.profitDrivers);
  assert.equal(result.profitDrivers.title, "利益改善の主な要因");
});

// ============================================================
// 来月確認するポイント(2026-09最終改訂、要件14・15): 今月の数値の再掲示ではなく、
// 状況に応じて自動で変わる「視点」を最大3件示す。
// ============================================================

test("来月確認するポイント: 完成イメージどおりの3件になる(材料は実額と原価率の両方を見る視点)", () => {
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
    { id: "operatingProfit", label: "営業利益", viewpoint: "赤字から改善しているか" },
    { id: "materialRate", label: "材料・仕入原価", viewpoint: "実額と原価率の両方が適正化しているか" },
  ]);
});

test("来月確認するポイント: 新規客減少月は「新規客数が回復しているか」になる(要件14)", () => {
  const current = metric({ newCustomers: 30, customers: 170, repeatCustomers: 140 });
  const previous = metric({ newCustomers: 60, customers: 200, repeatCustomers: 140 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.nextFocusPoints.find((p) => p.id === "newCustomers");
  assert.ok(point);
  assert.equal(point.viewpoint, "新規客数が回復しているか");
});

test("来月確認するポイント: 再来客減少月は「再来客数が改善しているか」になる(要件14)", () => {
  const current = metric({ repeatCustomers: 90, customers: 150, newCustomers: 60 });
  const previous = metric({ repeatCustomers: 140, customers: 200, newCustomers: 60 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.nextFocusPoints.find((p) => p.id === "repeatCustomers");
  assert.ok(point);
  assert.equal(point.viewpoint, "再来客数が改善しているか");
});

test("来月確認するポイント: 客単価低下月は「客単価が回復しているか」になる(要件14)", () => {
  const current = metric({ averageSpend: 4000, customers: 200 });
  const previous = metric({ averageSpend: 5000, customers: 200 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.nextFocusPoints.find((p) => p.id === "averageSpend");
  assert.ok(point);
  assert.equal(point.viewpoint, "客単価が回復しているか");
});

test("来月確認するポイント: 人件費実額増加月は「売上に対して人件費が適正化しているか」になる(要件14・15)", () => {
  const current = metric({ sales: 1000000, laborRate: 45, laborCost: 450000 });
  const previous = metric({ sales: 1000000, laborRate: 38, laborCost: 380000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.nextFocusPoints.find((p) => p.id === "laborRate");
  assert.ok(point);
  assert.equal(point.viewpoint, "売上に対して人件費が適正化しているか");
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

test("Fi-Ne横浜 回帰テスト: 人件費・材料費とも実額は減少しているため(結果としての率上昇)、変化が大きかった項目は営業利益(1枚)のみに絞られる", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.concernPoints.map((p) => p.id), ["sales", "operatingProfit"]);
});

test("Fi-Ne横浜 回帰テスト: 総評は実データに基づく文章になり、抽象的な励まし文を含まない", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, fieldsEnabled: FIELDS_ENABLED });
  assert.match(result.summaryText, /20\.3%/);
  assert.equal(result.summaryText.includes("pt"), false, "summaryTextに'pt'表記が残っていないこと");
  for (const banned of ["この調子", "引き続き確認", "好調な月", "バランスを意識"]) {
    assert.equal(result.summaryText.includes(banned), false, `summaryText contains banned phrase: ${banned}`);
  }
});

// ============================================================
// 最終検証: ユーザー指定の7パターンで、原因と結果を混同した文章が出ないことを確認する
// ============================================================

test("パターン1 売上↓/利益↓: 「率が上がったから」という短絡表現を含まない", () => {
  const current = metric({ sales: 700000, operatingMargin: -2, operatingProfit: -14000, materialRate: 22, materialCost: 154000 });
  const previous = metric({ sales: 1000000, operatingMargin: 10, operatingProfit: 100000, materialRate: 15, materialCost: 150000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(!result.summaryText.includes("率が上がったから"));
  assert.equal(result.profitDrivers.title, "利益低下の主な要因");
});

test("パターン2 売上↑/利益↑: 改善要因が自然に述べられる", () => {
  const current = metric({ sales: 1300000, operatingMargin: 13, operatingProfit: 169000 });
  const previous = metric({ sales: 1000000, operatingMargin: 10, operatingProfit: 100000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(!result.summaryText.includes("悪化"));
  assert.ok(result.profitDrivers === null || result.profitDrivers.title === "利益改善の主な要因");
});

test("パターン3 売上↑/利益↓: 費用増加が利益を圧迫している旨を、率ではなく実額から説明する", () => {
  const current = metric({
    sales: 1200000, operatingMargin: 4, operatingProfit: 48000,
    laborRate: 42, laborCost: 504000, materialRate: 18, materialCost: 216000,
  });
  const previous = metric({
    sales: 1000000, operatingMargin: 10, operatingProfit: 100000,
    laborRate: 38, laborCost: 380000, materialRate: 15, materialCost: 150000,
  });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(!result.summaryText.includes("率が上がったから"));
  const ids = result.concernPoints.map((p) => p.id);
  assert.ok(ids.includes("materialRate") || ids.includes("laborRate"));
});

test("パターン4 売上↓/利益↑: 「費用削減により営業利益は改善」の旨が読み取れる", () => {
  const current = metric({
    sales: 800000, operatingMargin: 15, operatingProfit: 120000,
    laborRate: 25, laborCost: 200000, materialRate: 10, materialCost: 80000,
  });
  const previous = metric({
    sales: 1000000, operatingMargin: 10, operatingProfit: 100000,
    laborRate: 38, laborCost: 380000, materialRate: 15, materialCost: 150000,
  });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.profitDrivers.title, "利益改善の主な要因");
  assert.ok(result.profitDrivers.bullets.some((b) => b.includes("人件費") || b.includes("材料")));
});

test("パターン5 売上横ばい/利益↓: 売上の変化を原因として誤って述べない", () => {
  const current = metric({ sales: 1000000, operatingMargin: 6, operatingProfit: 60000, laborRate: 44, laborCost: 440000 });
  const previous = metric({ sales: 1000000, operatingMargin: 10, operatingProfit: 100000, laborRate: 38, laborCost: 380000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.comparisons.sales.judgment, "unchanged");
  assert.ok(!result.summaryText.includes("売上が減少"));
  assert.ok(!result.summaryText.includes("売上が増加"));
  const point = result.concernPoints.find((p) => p.id === "laborRate");
  assert.ok(point, "人件費の実額増加が候補になる");
});

test("パターン6 材料費実額↓/材料費率↑: 「材料費が増加している」とは書かず、相対的な結果として扱う", () => {
  const current = metric({ sales: 700000, materialRate: 20, materialCost: 126000 });
  const previous = metric({ sales: 1000000, materialRate: 15, materialCost: 150000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.concernPoints.some((p) => p.id === "materialRate"), false);
  const allText = result.summaryText + JSON.stringify(result.profitDrivers?.bullets || []);
  assert.ok(!allText.includes("材料・仕入原価が増加"));
});

test("パターン7 人件費実額↓/人件費率↑: 「人件費が増加している」とは書かず、相対的な結果として扱う", () => {
  const current = metric({ sales: 700000, laborRate: 45, laborCost: 315000 });
  const previous = metric({ sales: 1000000, laborRate: 38, laborCost: 380000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.concernPoints.some((p) => p.id === "laborRate"), false);
  const allText = result.summaryText + JSON.stringify(result.profitDrivers?.bullets || []);
  assert.ok(!allText.includes("人件費が増加"));
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
