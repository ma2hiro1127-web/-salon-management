import test from "node:test";
import assert from "node:assert/strict";

import { createInitialAppState } from "./storage.js";
import {
  analyzeMonthlyReview,
  getMonthlyReviewMetrics,
  compareMonthlyMetric,
  validateMetricComparison,
  buildMetricComparisons,
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
  laborRate: 38, materialRate: 15, operatingMargin: 10, operatingProfit: 100000,
  isProvisionalProfit: false, hasLaborData: true, hasMaterialData: true,
  targetSales: 900000, hasSalesTarget: true, targetAchievement: 111,
  targetOperatingMargin: null,
  hasData: true,
  ...overrides,
});

// ============================================================
// compareMonthlyMetric: 計算の一元管理(要件1)の直接検証
// ============================================================

test("compareMonthlyMetric(rate, higherIsBetter): 当月率が前月率を下回れば必ず'worsened'になる(改善/悪化が逆転しない)", () => {
  const result = compareMonthlyMetric({ current: 16.0, previous: 28.0, hasPreviousData: true, kind: "rate", direction: "higherIsBetter" });
  assert.equal(result.diff, 16.0 - 28.0);
  assert.ok(Math.abs(result.diff - -12.0) < 1e-9);
  assert.equal(result.judgment, "worsened");
});

test("compareMonthlyMetric(rate, lowerIsBetter): 当月率が前月率を上回れば必ず'worsened'になる(人件費率上昇は悪化)", () => {
  const result = compareMonthlyMetric({ current: 37.0, previous: 30.2, hasPreviousData: true, kind: "rate", direction: "lowerIsBetter" });
  assert.ok(Math.abs(result.diff - 6.8) < 1e-9);
  assert.equal(result.judgment, "worsened");
});

test("compareMonthlyMetric(rate, lowerIsBetter): 当月率が前月率を下回れば必ず'improved'になる", () => {
  const result = compareMonthlyMetric({ current: 30.2, previous: 37.0, hasPreviousData: true, kind: "rate", direction: "lowerIsBetter" });
  assert.ok(result.diff < 0);
  assert.equal(result.judgment, "improved");
});

test("compareMonthlyMetric(rate, higherIsBetter): 当月率が前月率を上回れば必ず'improved'になる", () => {
  const result = compareMonthlyMetric({ current: 28.0, previous: 16.0, hasPreviousData: true, kind: "rate", direction: "higherIsBetter" });
  assert.ok(result.diff > 0);
  assert.equal(result.judgment, "improved");
});

test("compareMonthlyMetric: 前月と同率(同値)の場合はunchangedになる(高いほど良い/低いほど良いのどちらでも)", () => {
  const higher = compareMonthlyMetric({ current: 20, previous: 20, hasPreviousData: true, kind: "rate", direction: "higherIsBetter" });
  const lower = compareMonthlyMetric({ current: 20, previous: 20, hasPreviousData: true, kind: "rate", direction: "lowerIsBetter" });
  assert.equal(higher.diff, 0);
  assert.equal(higher.judgment, "unchanged");
  assert.equal(lower.diff, 0);
  assert.equal(lower.judgment, "unchanged");
});

test("compareMonthlyMetric: 前月データが無い場合はno_comparisonになり、改善/悪化を絶対に表示しない", () => {
  const result = compareMonthlyMetric({ current: 100, previous: 50, hasPreviousData: false, kind: "amount", direction: "higherIsBetter" });
  assert.equal(result.judgment, "no_comparison");
  assert.equal(result.diff, null);
  assert.equal(result.percentChange, null);
});

test("compareMonthlyMetric(amount): 前月値が0の場合は前月比%がNaN/Infinityにならず、no_comparisonとして扱う", () => {
  const result = compareMonthlyMetric({ current: 100000, previous: 0, hasPreviousData: true, kind: "amount", direction: "higherIsBetter" });
  assert.equal(result.judgment, "no_comparison");
  assert.equal(result.percentChange, null);
});

test("compareMonthlyMetric(amount): 当月値が0でも前月値が0でなければ正しく計算できる(-100%の減少として扱う)", () => {
  const result = compareMonthlyMetric({ current: 0, previous: 100000, hasPreviousData: true, kind: "amount", direction: "higherIsBetter" });
  assert.equal(result.diff, -100000);
  assert.equal(result.percentChange, -100);
  assert.equal(result.judgment, "worsened");
  assert.ok(Number.isFinite(result.percentChange));
});

test("compareMonthlyMetric(amount): 前月比%は(当月-前月)/前月*100で計算する", () => {
  const result = compareMonthlyMetric({ current: 11869547, previous: 14893161, hasPreviousData: true, kind: "amount", direction: "higherIsBetter" });
  const expectedPercent = ((11869547 - 14893161) / 14893161) * 100;
  assert.ok(Math.abs(result.percentChange - expectedPercent) < 1e-6);
  assert.equal(result.judgment, "worsened");
});

test("validateMetricComparison: 差分が当月-前月と一致しない(改ざん/計算ミス)場合は不整合としてfalseを返す", () => {
  const broken = { current: 16.0, previous: 28.0, diff: 60.1, percentChange: null, judgment: "improved" };
  assert.equal(validateMetricComparison(broken), false);
});

test("validateMetricComparison: NaN/Infinityを含む比較結果は不整合としてfalseを返す", () => {
  assert.equal(validateMetricComparison({ current: NaN, previous: 10, diff: 0, percentChange: null, judgment: "worsened" }), false);
  assert.equal(validateMetricComparison({ current: 10, previous: 10, diff: 0, percentChange: Infinity, judgment: "unchanged" }), false);
});

test("validateMetricComparison: 正しく計算された比較結果はtrueを返す", () => {
  const ok = { current: 16.0, previous: 28.0, diff: -12.0, percentChange: null, judgment: "worsened" };
  assert.equal(validateMetricComparison(ok), true);
});

// ============================================================
// Fi-Ne横浜 7月→8月の回帰テスト(要件5、実際に報告された不具合の再発防止)
// ============================================================

const fiNeYokohamaJuly = metric({
  sales: 14893161,
  operatingProfit: 4163299,
  operatingMargin: 28.0,
  laborRate: 30.2,
  materialRate: 32.3,
});
const fiNeYokohamaAugust = metric({
  sales: 11869547,
  operatingProfit: 1903458,
  operatingMargin: 16.0,
  laborRate: 37.0,
  materialRate: 35.0,
});

test("Fi-Ne横浜 回帰テスト: 売上は前月比20.3%減として計算される", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  const sales = result.comparisons.sales;
  assert.equal(sales.judgment, "worsened");
  assert.ok(Math.abs(sales.percentChange - -20.3) < 0.1, `expected ~-20.3%, got ${sales.percentChange}`);
});

test("Fi-Ne横浜 回帰テスト: 営業利益は前月比約54.3%減として計算される", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  const profit = result.comparisons.operatingProfit;
  assert.equal(profit.judgment, "worsened");
  assert.ok(Math.abs(profit.percentChange - -54.3) < 0.2, `expected ~-54.3%, got ${profit.percentChange}`);
});

test("Fi-Ne横浜 回帰テスト: 営業利益率は12.0pt悪化として計算される(60.1pt改善という過去の誤表示を再発させない)", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  const margin = result.comparisons.operatingMargin;
  assert.equal(margin.judgment, "worsened");
  assert.ok(Math.abs(margin.diff - -12.0) < 1e-9, `expected diff -12.0, got ${margin.diff}`);
  assert.ok(result.improvementPoints.some((p) => p.id === "operatingMargin"));
  assert.equal(result.goodPoints.some((p) => p.id === "operatingMargin"), false);
});

test("Fi-Ne横浜 回帰テスト: 人件費率は6.8pt悪化として計算される(30.2pt改善という過去の誤表示を再発させない)", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  const labor = result.comparisons.laborRate;
  assert.equal(labor.judgment, "worsened");
  assert.ok(Math.abs(labor.diff - 6.8) < 1e-9, `expected diff 6.8, got ${labor.diff}`);
  assert.equal(result.goodPoints.some((p) => p.id === "laborRate"), false);
  const point = result.improvementPoints.find((p) => p.id === "laborRate");
  assert.ok(point, "人件費率が改善ポイントに含まれるべき");
  assert.match(point.detail, /30\.2%から37\.0%へ6\.8pt上昇/);
});

test("Fi-Ne横浜 回帰テスト: 材料・仕入原価率は2.7pt悪化として計算される", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  const material = result.comparisons.materialRate;
  assert.equal(material.judgment, "worsened");
  assert.ok(Math.abs(material.diff - 2.7) < 1e-9, `expected diff 2.7, got ${material.diff}`);
});

test("Fi-Ne横浜 回帰テスト: 良かった点は1件も無い(全指標が悪化しているため無理に褒めない)", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.goodPoints, []);
});

test("Fi-Ne横浜 回帰テスト: 改善ポイントに営業利益率・人件費率・材料原価率の3件が含まれる", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  const ids = result.improvementPoints.map((p) => p.id);
  assert.ok(ids.includes("operatingMargin"));
  assert.ok(ids.includes("laborRate"));
  assert.ok(ids.includes("materialRate"));
});

test("Fi-Ne横浜 回帰テスト: 今月のまとめは実データに基づく文章になり、抽象的な励まし文を含まない", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.match(result.summaryText, /20\.3%/);
  assert.match(result.summaryText, /28\.0%から16\.0%へ12\.0pt/);
  for (const banned of ["この調子", "引き続き確認", "好調な月", "バランスを意識"]) {
    assert.equal(result.summaryText.includes(banned), false, `summaryText contains banned phrase: ${banned}`);
  }
});

// ============================================================
// 修正要件5で明示された追加ケース
// ============================================================

test("ケース: 率が上昇するケース(高いほど良い指標は改善、低いほど良い指標は悪化)", () => {
  const higherIsBetterUp = compareMonthlyMetric({ current: 30, previous: 20, hasPreviousData: true, kind: "rate", direction: "higherIsBetter" });
  const lowerIsBetterUp = compareMonthlyMetric({ current: 30, previous: 20, hasPreviousData: true, kind: "rate", direction: "lowerIsBetter" });
  assert.equal(higherIsBetterUp.judgment, "improved");
  assert.equal(lowerIsBetterUp.judgment, "worsened");
});

test("ケース: 率が低下するケース(高いほど良い指標は悪化、低いほど良い指標は改善)", () => {
  const higherIsBetterDown = compareMonthlyMetric({ current: 20, previous: 30, hasPreviousData: true, kind: "rate", direction: "higherIsBetter" });
  const lowerIsBetterDown = compareMonthlyMetric({ current: 20, previous: 30, hasPreviousData: true, kind: "rate", direction: "lowerIsBetter" });
  assert.equal(higherIsBetterDown.judgment, "worsened");
  assert.equal(lowerIsBetterDown.judgment, "improved");
});

test("ケース: 前月と同率のケースはunchangedであり、improved/worsenedのどちらにもならない", () => {
  const result = compareMonthlyMetric({ current: 25, previous: 25, hasPreviousData: true, kind: "rate", direction: "lowerIsBetter" });
  assert.equal(result.judgment, "unchanged");
});

test("ケース: 前月データが無いケースはno_comparisonであり、improved/worsenedのどちらにもならない", () => {
  const result = compareMonthlyMetric({ current: 25, previous: 25, hasPreviousData: false, kind: "rate", direction: "lowerIsBetter" });
  assert.equal(result.judgment, "no_comparison");
});

test("ケース: 前月値が0のケース(amount指標)はno_comparisonとして前月比較なしになる", () => {
  const result = compareMonthlyMetric({ current: 500, previous: 0, hasPreviousData: true, kind: "amount", direction: "higherIsBetter" });
  assert.equal(result.judgment, "no_comparison");
});

test("ケース: 前月値が0のケース(rate指標)は除算が発生しないため正しく判定できる", () => {
  const result = compareMonthlyMetric({ current: 5, previous: 0, hasPreviousData: true, kind: "rate", direction: "lowerIsBetter" });
  assert.equal(result.diff, 5);
  assert.equal(result.judgment, "worsened");
});

test("ケース: 当月値が0のケースでもNaN/Infinityにならず正しく判定できる", () => {
  const result = compareMonthlyMetric({ current: 0, previous: 50000, hasPreviousData: true, kind: "amount", direction: "higherIsBetter" });
  assert.ok(Number.isFinite(result.diff));
  assert.ok(Number.isFinite(result.percentChange));
  assert.equal(result.judgment, "worsened");
});

// ============================================================
// analyzeMonthlyReview 全体の構成・入力設定OFF・月締め前のテスト
// ============================================================

test("月締め前(isClosed:false)は分析を行わず、3項目とも空で返す", () => {
  const result = analyzeMonthlyReview({ current: metric(), previous: metric(), isClosed: false, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.isClosed, false);
  assert.deepEqual(result.goodPoints, []);
  assert.deepEqual(result.improvementPoints, []);
  assert.deepEqual(result.comparisons, {});
});

test("前月データが無い場合は今月の実績のみを述べ、良かった点・改善ポイントは空になる", () => {
  const current = metric();
  const previous = metric({ hasData: false });
  const result = analyzeMonthlyReview({ current, previous, isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.goodPoints, []);
  assert.deepEqual(result.improvementPoints, []);
  assert.match(result.summaryText, /比較できる前月データが無い/);
});

test("良かった点: 実際に改善した指標(客単価上昇)だけを、具体的な数字付きで表示する", () => {
  const current = metric({ averageSpend: 10200 });
  const previous = metric({ averageSpend: 9500 });
  const result = analyzeMonthlyReview({ current, previous, isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  const point = result.improvementPoints.find((p) => p.id === "averageSpend");
  assert.equal(point, undefined);
  const good = result.goodPoints.find((p) => p.id === "averageSpend");
  assert.ok(good);
  assert.match(good.detail, /9,500円から10,200円へ7\.4%上昇/);
});

test("入力設定で新規客数・再来客数・店販売上がOFFの場合、それらは比較対象から除外される", () => {
  const current = metric({ newCustomers: 100, repeatCustomers: 50, retailSales: 500000 });
  const previous = metric({ newCustomers: 60, repeatCustomers: 140, retailSales: 300000 });
  const result = analyzeMonthlyReview({
    current, previous, isClosed: true,
    fieldsEnabled: { customers: true, newCustomers: false, repeatCustomers: false, retailSales: false, reviewCount: true },
  });
  assert.equal("newCustomers" in result.comparisons, false);
  assert.equal("repeatCustomers" in result.comparisons, false);
  assert.equal("retailSales" in result.comparisons, false);
});

test("buildMetricComparisons: 人件費率・材料費率はhasLaborData/hasMaterialDataが両月ともtrueでなければ比較対象から除外する", () => {
  const current = metric({ hasLaborData: false });
  const previous = metric({ hasLaborData: true });
  const comparisons = buildMetricComparisons(current, previous, FIELDS_ENABLED);
  assert.equal("laborRate" in comparisons, false);
});

test("buildMetricComparisons: 営業利益率・営業利益はisProvisionalProfitが立っている月では比較対象から除外する(月途中の未確定値を前月比較に使わない)", () => {
  const current = metric({ isProvisionalProfit: true });
  const previous = metric();
  const comparisons = buildMetricComparisons(current, previous, FIELDS_ENABLED);
  assert.equal("operatingMargin" in comparisons, false);
  assert.equal("operatingProfit" in comparisons, false);
});

test("goodPoints/improvementPointsは最大件数(MONTHLY_INSIGHT_THRESHOLDS)で絞り込まれる", () => {
  const current = metric({ sales: 2000000, customers: 400, newCustomers: 150, retailSales: 700000, averageSpend: 8000, reviewCount: 30 });
  const previous = metric({ sales: 1000000, customers: 200, newCustomers: 60, retailSales: 300000, averageSpend: 5000, reviewCount: 10 });
  const result = analyzeMonthlyReview({ current, previous, isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.goodPoints.length <= MONTHLY_INSIGHT_THRESHOLDS.maxGoodPoints);
});

// ============================================================
// getMonthlyReviewMetrics(既存関数、計算ロジックは今回変更していないことの確認)
// ============================================================

test("getMonthlyReviewMetrics(単一店舗): calculateMonthSummaryの人件費率・材料費率をそのまま反映する", () => {
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
  assert.equal(metrics.laborRate, 38);
  assert.equal(metrics.materialRate, 10);
  assert.equal(metrics.hasData, true);
});

test("getMonthlyReviewMetrics(全店舗ビュー): 人件費率は店舗ごとの単純平均ではなく、合算してから再計算した値になる", () => {
  const state = createInitialAppState();
  const companyId = "company-1";
  const storeA = { id: "store-a", name: "A店", status: "active", settings: {} };
  const storeB = { id: "store-b", name: "B店", status: "active", settings: {} };
  const month = "2026-08";
  state.dailyResults[`${storeA.id}__${month}`] = [
    { date: "2026-08-01", totalSales: 100000, technicalSales: 100000, customers: 10 },
  ];
  state.dailyResults[`${storeB.id}__${month}`] = [
    { date: "2026-08-01", totalSales: 900000, technicalSales: 900000, customers: 90 },
  ];
  state.monthClosing[`${storeA.id}__${month}`] = [
    { id: "a-labor", name: "人件費", amount: 50000, category: "人件費", categoryKey: "labor" },
  ];
  state.monthClosing[`${storeB.id}__${month}`] = [
    { id: "b-labor", name: "人件費", amount: 90000, category: "人件費", categoryKey: "labor" },
  ];
  const company = { id: companyId, stores: [storeA, storeB] };
  const metrics = getMonthlyReviewMetrics(state, { isAllStoresView: true, company, companyStores: [storeA, storeB] }, month);
  assert.equal(metrics.sales, 1000000);
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
