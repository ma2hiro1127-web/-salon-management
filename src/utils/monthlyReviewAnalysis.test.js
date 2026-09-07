import test from "node:test";
import assert from "node:assert/strict";

import { createInitialAppState } from "./storage.js";
import { analyzeMonthlyReview, getMonthlyReviewMetrics, MONTHLY_INSIGHT_THRESHOLDS } from "./monthlyReviewAnalysis.js";

if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = {
    store: {},
    getItem(key) { return this.store[key] ?? null; },
    setItem(key, value) { this.store[key] = String(value); },
    removeItem(key) { delete this.store[key]; },
    clear() { this.store = {}; },
  };
}

const FIELDS_ENABLED = { customers: true, newCustomers: true, repeatCustomers: true, retailSales: true };

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

test("月締め前(isClosed:false)は分析を行わず、未確定である旨だけを返す", () => {
  const result = analyzeMonthlyReview({ current: metric(), previous: metric(), twoMonthsAgo: metric(), isClosed: false, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.isClosed, false);
  assert.deepEqual(result.goodPoints, []);
  assert.deepEqual(result.checkPoints, []);
});

test("前月データが無い場合は前月比較を伴う判定を一切行わない", () => {
  const current = metric();
  const previous = metric({ hasData: false });
  const result = analyzeMonthlyReview({ current, previous, twoMonthsAgo: metric({ hasData: false }), isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.goodPoints, []);
  assert.deepEqual(result.checkPoints, []);
  assert.match(result.summaryText, /比較できる前月データが無い/);
});

test("例1: 売上増加+客単価低下(客数増で補っている)を検知する", () => {
  const current = metric({ sales: 1050000, averageSpend: 4750, customers: 221 });
  const previous = metric({ sales: 1000000, averageSpend: 5000, customers: 200 });
  const result = analyzeMonthlyReview({ current, previous, twoMonthsAgo: metric(), isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.checkPoints.some((point) => point.id === "salesUpSpendDown"));
});

test("例2: 売上前月並み+人件費率上昇を検知する", () => {
  const current = metric({ sales: 1000000, laborRate: 42 });
  const previous = metric({ sales: 1000000, laborRate: 38 });
  const result = analyzeMonthlyReview({ current, previous, twoMonthsAgo: metric(), isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.checkPoints.some((point) => point.id === "salesFlatLaborRateUp"));
});

test("例3: 新規増加+再来低下を検知する", () => {
  const current = metric({ newCustomers: 75, repeatCustomers: 120 });
  const previous = metric({ newCustomers: 60, repeatCustomers: 140 });
  const result = analyzeMonthlyReview({ current, previous, twoMonthsAgo: metric(), isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.checkPoints.some((point) => point.id === "newUpRepeatDown"));
});

test("例4: 売上増加+材料費率上昇を検知する", () => {
  const current = metric({ sales: 1080000, materialRate: 19 });
  const previous = metric({ sales: 1000000, materialRate: 15 });
  const result = analyzeMonthlyReview({ current, previous, twoMonthsAgo: metric(), isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.checkPoints.some((point) => point.id === "salesUpMaterialRateUp"));
});

test("例5: 売上目標達成+営業利益率目標未達を検知する(目標が設定されている場合のみ)", () => {
  const current = metric({ targetAchievement: 105, targetOperatingMargin: 15, operatingMargin: 10 });
  const previous = metric();
  const result = analyzeMonthlyReview({ current, previous, twoMonthsAgo: metric(), isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.checkPoints.some((point) => point.id === "salesAchievedMarginMissed"));
});

test("例5: 営業利益率の目標が設定されていない会社では判定自体が発火しない", () => {
  const current = metric({ targetAchievement: 105, targetOperatingMargin: null, operatingMargin: 10 });
  const previous = metric();
  const result = analyzeMonthlyReview({ current, previous, twoMonthsAgo: metric(), isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.checkPoints.some((point) => point.id === "salesAchievedMarginMissed"), false);
});

test("客単価が3か月連続で低下している場合を検知する(単月の変化より優先度を高くする)", () => {
  const current = metric({ averageSpend: 4500 });
  const previous = metric({ averageSpend: 4800 });
  const twoMonthsAgo = metric({ averageSpend: 5000 });
  const result = analyzeMonthlyReview({ current, previous, twoMonthsAgo, isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.checkPoints[0].id, "threeMonthSpendDecline");
});

test("人件費率が3か月連続で上昇している場合を検知する", () => {
  const current = metric({ laborRate: 42 });
  const previous = metric({ laborRate: 40 });
  const twoMonthsAgo = metric({ laborRate: 38 });
  const result = analyzeMonthlyReview({ current, previous, twoMonthsAgo, isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.checkPoints.some((point) => point.id === "threeMonthLaborRateRise"));
});

test("良かった点: 売上・新規客数の伸びを検知し、最大3件までに絞り込む", () => {
  const current = metric({ sales: 1200000, newCustomers: 80, retailSales: 400000, repeatCustomers: 170, averageSpend: 5500 });
  const previous = metric({ sales: 1000000, newCustomers: 60, retailSales: 300000, repeatCustomers: 140, averageSpend: 5000 });
  const result = analyzeMonthlyReview({ current, previous, twoMonthsAgo: metric(), isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.goodPoints.length <= MONTHLY_INSIGHT_THRESHOLDS.maxGoodPoints);
  assert.ok(result.goodPoints.length > 0);
});

test("良かった点が無い場合は空配列を返す(無理に褒めない)", () => {
  const current = metric();
  const previous = metric();
  const result = analyzeMonthlyReview({ current, previous, twoMonthsAgo: metric(), isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.goodPoints, []);
});

test("入力設定で新規客数・再来客数がOFFの場合、新規増・再来減の判定をスキップする", () => {
  const current = metric({ newCustomers: 75, repeatCustomers: 120 });
  const previous = metric({ newCustomers: 60, repeatCustomers: 140 });
  const result = analyzeMonthlyReview({
    current, previous, twoMonthsAgo: metric(), isClosed: true,
    fieldsEnabled: { ...FIELDS_ENABLED, newCustomers: false, repeatCustomers: false },
  });
  assert.equal(result.checkPoints.some((point) => point.id === "newUpRepeatDown"), false);
});

test("来月の注目項目: 要確認ポイントでヒットした指標名を反映する", () => {
  const current = metric({ newCustomers: 75, repeatCustomers: 120 });
  const previous = metric({ newCustomers: 60, repeatCustomers: 140 });
  const result = analyzeMonthlyReview({ current, previous, twoMonthsAgo: metric(), isClosed: true, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.nextFocus[0].includes("再来客数"));
});

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
  // A店: 売上100,000円・人件費50,000円(率50%)。B店: 売上900,000円・人件費90,000円(率10%)。
  // 単純平均(50%+10%)/2=30%だが、合算した場合は (50,000+90,000)/(100,000+900,000)=14%になる。
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
