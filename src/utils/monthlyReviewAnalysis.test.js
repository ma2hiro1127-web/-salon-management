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
  laborRate: 38, laborCost: 380000, materialRate: 15, materialCost: 150000,
  operatingMargin: 10, operatingProfit: 100000,
  isProvisionalProfit: false, hasLaborData: true, hasMaterialData: true,
  targetSales: 900000, hasSalesTarget: true, targetAchievement: 111,
  targetOperatingMargin: null,
  hasData: true,
  ...overrides,
});

// ============================================================
// compareMonthlyMetric / validateMetricComparison: 計算の一元管理
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

// ============================================================
// 要件5: 売上連動歩合の人件費 — 金額ではなく人件費率(pt)で判定する
// ============================================================

test("要件5 例1: 売上増+人件費額増+人件費率改善 → 悪化として判定されず、要確認ポイントにも出ない", () => {
  // 売上300万→350万、人件費120万→137万、人件費率40.0%→39.1%
  const current = metric({ sales: 3500000, laborCost: 1370000, laborRate: 39.1 });
  const previous = metric({ sales: 3000000, laborCost: 1200000, laborRate: 40.0 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.comparisons.laborRate.judgment, "improved");
  assert.equal(result.concernPoints.some((p) => p.id === "laborRate"), false);
  assert.equal(result.concernPoints.some((p) => p.id === "laborCost"), false, "人件費の金額そのものは要確認ポイントに出してはいけない");
});

test("要件5 例1: 総評に「人件費額は増加しているが人件費率は改善しており問題ない」旨が含まれる", () => {
  const current = metric({ sales: 3500000, laborCost: 1370000, laborRate: 39.1 });
  const previous = metric({ sales: 3000000, laborCost: 1200000, laborRate: 40.0 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.match(result.summaryText, /人件費額は1,200,000円から1,370,000円へ増加していますが/);
  assert.match(result.summaryText, /問題ありません/);
});

test("要件5 例2: 売上増+人件費増以上に人件費率が悪化 → 要確認ポイントに出る", () => {
  // 売上300万→350万、人件費120万→160万、人件費率40.0%→45.7%
  const current = metric({ sales: 3500000, laborCost: 1600000, laborRate: 45.7 });
  const previous = metric({ sales: 3000000, laborCost: 1200000, laborRate: 40.0 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.comparisons.laborRate.judgment, "worsened");
  const point = result.concernPoints.find((p) => p.id === "laborRate");
  assert.ok(point, "人件費率悪化が要確認ポイントに含まれるべき");
  assert.match(point.detail, /売上増加率より人件費増加率が大きくなっています/);
});

test("要件5 例3: 売上減+人件費額は減っているが人件費率は悪化 → 悪化として正しく判定される", () => {
  // 売上350万→300万、人件費140万→130万、人件費率40.0%→43.3%
  const current = metric({ sales: 3000000, laborCost: 1300000, laborRate: 43.3 });
  const previous = metric({ sales: 3500000, laborCost: 1400000, laborRate: 40.0 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.comparisons.laborCost.diff < 0, true, "人件費の金額自体は減少しているケース");
  assert.equal(result.comparisons.laborRate.judgment, "worsened", "金額が減っていても人件費率で見れば悪化");
  const point = result.concernPoints.find((p) => p.id === "laborRate");
  assert.ok(point);
  assert.match(point.detail, /人件費は減少していますが、売上の減少ほど下がっていません/);
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

test("Fi-Ne横浜 回帰テスト: 変化が大きかった項目は営業利益率・人件費率・材料原価率の3件に絞られる(構造指標を優先、最大3件)", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.concernPoints.map((p) => p.id), ["operatingMargin", "laborRate", "materialRate"]);
});

test("Fi-Ne横浜 回帰テスト: 総評は実データに基づく文章になり、抽象的な励まし文を含まない", () => {
  const result = analyzeMonthlyReview({ current: fiNeYokohamaAugust, previous: fiNeYokohamaJuly, fieldsEnabled: FIELDS_ENABLED });
  assert.match(result.summaryText, /20\.3%/);
  assert.match(result.summaryText, /28\.0%から16\.0%へ12\.0pt/);
  for (const banned of ["この調子", "引き続き確認", "好調な月", "バランスを意識"]) {
    assert.equal(result.summaryText.includes(banned), false, `summaryText contains banned phrase: ${banned}`);
  }
});

test("変化が大きかった項目のタイトルは中立な事実表現であり、「悪化」「問題」「危険」という評価語を含まない", () => {
  const current = metric({
    sales: 800000, technicalSales: 500000, retailSales: 100000, customers: 150, newCustomers: 40, repeatCustomers: 90,
    averageSpend: 4000, reviewCount: 5, laborRate: 45, materialRate: 20, operatingMargin: 5, operatingProfit: 40000,
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

test("客数・客単価の低下が主要因の売上減少では、総売上を重複表示せず客数・客単価を優先する(要件2)", () => {
  const current = metric({ sales: 700000, customers: 140, averageSpend: 5000 }); // 700000 = 140 * 5000
  const previous = metric({ sales: 1000000, customers: 200, averageSpend: 5000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const ids = result.concernPoints.map((p) => p.id);
  assert.ok(ids.includes("customers"));
  assert.equal(ids.includes("sales"), false, "客数の低下で説明できる売上減少は、総売上を別枠で重複表示しない");
});

test("客数の内訳(新規・再来)が両方低下している場合、客数を重複表示せず内訳を優先する(要件2)", () => {
  const current = metric({ customers: 100, newCustomers: 30, repeatCustomers: 70 });
  const previous = metric({ customers: 200, newCustomers: 60, repeatCustomers: 140 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const ids = result.concernPoints.map((p) => p.id);
  assert.ok(ids.includes("newCustomers"));
  assert.ok(ids.includes("repeatCustomers"));
  assert.equal(ids.includes("customers"), false);
});

test("売上が減少し営業利益は増加した月は、総評で両方を対比して述べ、売上だけを強調しない(要件4)", () => {
  const current = metric({ sales: 900000, operatingProfit: 150000, operatingMargin: 16.7, laborRate: 30 });
  const previous = metric({ sales: 1000000, operatingProfit: 100000, operatingMargin: 10, laborRate: 38 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.match(result.summaryText, /売上は前月比10\.0%減少しましたが/);
  assert.match(result.summaryText, /人件費率の改善により/);
  assert.match(result.summaryText, /営業利益は100,000円から150,000円へ増加/);
});

// ============================================================
// 要件1・2・3: 月締めに依存しない(hasDataだけで判定する)
// ============================================================

test("当月にデータが無い(hasData:false)場合のみレビューを表示しない", () => {
  const current = metric({ hasData: false });
  const result = analyzeMonthlyReview({ current, previous: metric(), fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.hasData, false);
  assert.deepEqual(result.concernPoints, []);
});

test("月締めしていない当月でも、データさえあればレビューを生成する(isClosedという概念自体を渡さない)", () => {
  // analyzeMonthlyReviewはisClosedという引数を受け取らない設計になっている——
  // hasData:trueのcurrentさえ渡せば、月締め状態に一切関係なく結果を返すことを確認する。
  const current = metric({ sales: 500000 });
  const previous = metric({ sales: 400000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.hasData, true);
  assert.ok(result.summaryText.length > 0);
});

test("getMonthlyReviewMetrics: monthClosingStatus(確定状態)の有無に関わらず、同じ入力データなら全く同じ値を返す", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.stores = [store];
  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 400000, technicalSales: 400000, customers: 20 }];
  state.monthClosing[key] = [{ id: "close-1", name: "人件費", amount: 150000, category: "人件費", categoryKey: "labor" }];

  const unconfirmed = getMonthlyReviewMetrics(state, { storeId: store, isAllStoresView: false, storeEntity: { settings: {} } }, month);
  state.monthClosingStatus = { [key]: { closed: true, lockedAt: "2026-08-31T00:00:00Z", note: "" } };
  const confirmed = getMonthlyReviewMetrics(state, { storeId: store, isAllStoresView: false, storeEntity: { settings: {} } }, month);

  assert.deepEqual(unconfirmed, confirmed);
});

// ============================================================
// 要件4: 前月比較(pt/%の混同防止)・エッジケース
// ============================================================

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

test("前月データが無いケースは無理な比較コメントを出さない", () => {
  const current = metric();
  const previous = metric({ hasData: false });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.concernPoints, []);
  assert.match(result.summaryText, /比較できる前月データが無い/);
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
// 要件6: 営業利益/営業利益率の主要因の特定(推測しない)
// ============================================================

test("営業利益率悪化の主要因が人件費率のみの場合、その旨だけを述べる(材料費率のことは書かない)", () => {
  const current = metric({ operatingMargin: 8, laborRate: 45, materialRate: 15 });
  const previous = metric({ operatingMargin: 12, laborRate: 38, materialRate: 15 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.match(result.summaryText, /人件費率の上昇により/);
  assert.equal(result.summaryText.includes("材料"), false);
});

test("営業利益率悪化の要因が特定できない場合(人件費率・材料費率とも悪化していない)は原因を推測して書かない", () => {
  const current = metric({ operatingMargin: 8, laborRate: 38, materialRate: 15 });
  const previous = metric({ operatingMargin: 12, laborRate: 38, materialRate: 15 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.summaryText.includes("により"), false, "根拠のない要因断定をしてはいけない");
});

// ============================================================
// 要件2: 「変化が大きかった項目」の具体性
// ============================================================

test("特に問題のない月は変化が大きかった項目を無理に作らず、空配列を返す", () => {
  const current = metric();
  const previous = metric();
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.concernPoints, []);
});

test("変化が大きかった項目は具体的な数字(前月→今月、pt差)を必ず含む", () => {
  const current = metric({ laborRate: 45.6 });
  const previous = metric({ laborRate: 40.2 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "laborRate");
  assert.match(point.detail, /40\.2%から45\.6%へ5\.4pt上昇/);
});

// ============================================================
// 要件11: 画面表示値との一致(既存関数をそのまま参照しているかの確認)
// ============================================================

test("buildMetricComparisons: 人件費率・人件費額はhasLaborDataが両月ともtrueでなければ比較対象から除外する", () => {
  const current = metric({ hasLaborData: false });
  const previous = metric({ hasLaborData: true });
  const comparisons = buildMetricComparisons(current, previous, FIELDS_ENABLED);
  assert.equal("laborRate" in comparisons, false);
  assert.equal("laborCost" in comparisons, false);
});

test("goodPoints/improvementPoints/nextFocusという古いフィールドはもう存在しない(構成は総評+変化が大きかった項目の2つに簡素化)", () => {
  const current = metric({ averageSpend: 6000 });
  const previous = metric({ averageSpend: 5000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal("goodPoints" in result, false);
  assert.equal("improvementPoints" in result, false);
  assert.equal("nextFocus" in result, false);
  assert.deepEqual(Object.keys(result).sort(), ["comparisons", "concernPoints", "hasData", "summaryText"]);
});

test("concernPointsは最大件数(MONTHLY_INSIGHT_THRESHOLDS.maxConcernPoints)で絞り込まれる", () => {
  const current = metric({ sales: 500000, customers: 100, newCustomers: 20, retailSales: 100000, averageSpend: 3000, laborRate: 50, materialRate: 25, operatingMargin: -5 });
  const previous = metric({ sales: 1000000, customers: 200, newCustomers: 60, retailSales: 300000, averageSpend: 5000, laborRate: 38, materialRate: 15, operatingMargin: 10 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.concernPoints.length <= MONTHLY_INSIGHT_THRESHOLDS.maxConcernPoints);
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
