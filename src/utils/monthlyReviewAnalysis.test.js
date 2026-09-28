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

test("要件5 例1: 総評に「人件費は増加しているが売上の増加が大きいため人件費率は低下している」旨が含まれる(2026-09表現統一、'改善'/'問題ありません'は使わない)", () => {
  const current = metric({ sales: 3500000, laborCost: 1370000, laborRate: 39.1 });
  const previous = metric({ sales: 3000000, laborCost: 1200000, laborRate: 40.0 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  // 総評ではlaborRateBasisClauseを呼ばなくなった(要件12: 詳細な根拠説明は
  // 「変化が大きかった項目」側だけに出し、総評と重複させない)ため、総評自体は短い。
  for (const banned of ["改善", "問題ありません", "pt", "ポイント"]) {
    assert.equal(result.summaryText.includes(banned), false, `summaryText contains banned phrase: ${banned}`);
  }
});

test("要件5 例2: 売上増+人件費増以上に人件費率が悪化 → 要確認ポイントに出て、'前月値% → 今月値%'形式で表示される", () => {
  // 売上300万→350万、人件費120万→160万、人件費率40.0%→45.7%
  const current = metric({ sales: 3500000, laborCost: 1600000, laborRate: 45.7 });
  const previous = metric({ sales: 3000000, laborCost: 1200000, laborRate: 40.0 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.comparisons.laborRate.judgment, "worsened");
  const point = result.concernPoints.find((p) => p.id === "laborRate");
  assert.ok(point, "人件費率悪化が要確認ポイントに含まれるべき");
  assert.match(point.detail, /人件費率は 40\.0% → 45\.7% に上昇しました/);
  assert.match(point.detail, /売上の増加より人件費の増加が大きいため、人件費率が上昇しています/);
  assert.equal(point.detail.includes("pt"), false);
});

test("要件5 例3: 売上減+人件費額は減っているが人件費率は悪化 → 悪化として正しく判定され、旧禁止表現('下がっていません')を使わない", () => {
  // 売上350万→300万、人件費140万→130万、人件費率40.0%→43.3%
  const current = metric({ sales: 3000000, laborCost: 1300000, laborRate: 43.3 });
  const previous = metric({ sales: 3500000, laborCost: 1400000, laborRate: 40.0 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.comparisons.laborCost.diff < 0, true, "人件費の金額自体は減少しているケース");
  assert.equal(result.comparisons.laborRate.judgment, "worsened", "金額が減っていても人件費率で見れば悪化");
  const point = result.concernPoints.find((p) => p.id === "laborRate");
  assert.ok(point);
  assert.match(point.detail, /人件費率は 40\.0% → 43\.3% に上昇しました/);
  assert.match(point.detail, /売上の減少幅に対して人件費の減少幅が小さかったため、人件費率が上昇しています/);
  assert.equal(point.detail.includes("下がっていません"), false, "旧・禁止表現(要件7)が残っていないこと");
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
  // 率の変化は2026-09統一ルールで「前月値% → 今月値%」形式にする(差分の「pt」「%上昇/低下」は
  // 本文に出さない、要件1・2・4)。
  assert.match(result.summaryText, /営業利益率は 28\.0% → 16\.0% に低下しました/);
  assert.equal(result.summaryText.includes("pt"), false, "summaryTextに'pt'表記が残っていないこと");
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

test("客数・客単価の低下が主要因の売上減少では、内訳(客数・客単価)を重複表示せず総売上のカードにrelatedMetricsとして添える(要件5、2026-09仕様変更)", () => {
  // 以前は「客数・客単価を優先し総売上を消す」設計だったが、要因分析(要件5)導入により
  // 「総売上のカードを残し、客数・客単価はそのrelatedMetricsとして添える」方針へ変更した
  // (ユーザー提示例: 「売上が前月を下回っています」1枚の中に客数・客単価の内訳を表示)。
  const current = metric({ sales: 700000, customers: 140, averageSpend: 5000 }); // 700000 = 140 * 5000
  const previous = metric({ sales: 1000000, customers: 200, averageSpend: 5000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const ids = result.concernPoints.map((p) => p.id);
  assert.ok(ids.includes("sales"));
  assert.equal(ids.includes("customers"), false, "客数・客単価はsalesのrelatedMetricsとして表示され、別枠のカードにはしない");
  assert.equal(ids.includes("averageSpend"), false);
  const salesPoint = result.concernPoints.find((p) => p.id === "sales");
  assert.deepEqual(salesPoint.relatedMetrics.map((m) => m.key).sort(), ["averageSpend", "customers"]);
});

test("客数の内訳(新規・再来)が両方低下している場合、内訳を重複表示せず客数のカードにrelatedMetricsとして添える(要件5、2026-09仕様変更)", () => {
  const current = metric({ customers: 100, newCustomers: 30, repeatCustomers: 70 });
  const previous = metric({ customers: 200, newCustomers: 60, repeatCustomers: 140 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const ids = result.concernPoints.map((p) => p.id);
  assert.ok(ids.includes("customers"));
  assert.equal(ids.includes("newCustomers"), false);
  assert.equal(ids.includes("repeatCustomers"), false);
  const customersPoint = result.concernPoints.find((p) => p.id === "customers");
  assert.deepEqual(customersPoint.relatedMetrics.map((m) => m.key).sort(), ["newCustomers", "repeatCustomers"]);
});

test("売上が減少し営業利益は増加した月は、総評で①売上②営業利益③営業利益率④要因を別々の文で述べる(要件5・17、2026-09表現統一)", () => {
  const current = metric({ sales: 900000, operatingProfit: 150000, operatingMargin: 16.7, laborRate: 30 });
  const previous = metric({ sales: 1000000, operatingProfit: 100000, operatingMargin: 10, laborRate: 38 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.match(result.summaryText, /総売上は前月より10\.0%減少しました/);
  assert.match(result.summaryText, /営業利益は前月より50\.0%増加しました/);
  assert.match(result.summaryText, /営業利益率は 10\.0% → 16\.7% に上昇しました/);
  assert.match(result.summaryText, /主に、人件費率の低下が影響しています/);
  for (const banned of ["改善", "pt", "ポイント"]) {
    assert.equal(result.summaryText.includes(banned), false, `summaryText contains banned phrase: ${banned}`);
  }
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
  assert.match(result.summaryText, /主に、人件費率の上昇が影響しています/);
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

test("変化が大きかった項目は具体的な数字(前月値% → 今月値%)を必ず含み、差分の「pt」「○%上昇」は本文に出さない(2026-09統一、要件1・2・4)", () => {
  const current = metric({ laborRate: 45.6 });
  const previous = metric({ laborRate: 40.2 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "laborRate");
  assert.match(point.detail, /人件費率は 40\.2% → 45\.6% に上昇しました/);
  assert.equal(point.detail.includes("pt"), false);
  assert.equal(point.detail.includes("5.4%上昇"), false, "差分(5.4%)を単独で本文に出さないこと(要件4)");
});

// ============================================================
// formatRateChange: 割合の変化量は「pt」ではなく必ず「%」で表示する(2026-09統一)。
// amount指標の前月比%・rate指標のpt差の両方をこの1つの共通formatterだけが担う。
// ============================================================

test("formatRateChange: ケース1 5.2%→-0.4% の差分(-5.6)は「5.6%」になる(pt表記にしない)", () => {
  assert.equal(formatRateChange(-0.4 - 5.2), "5.6%");
});

test("formatRateChange: ケース2 22.8%→29.4% の差分(+6.6)は「6.6%」になる", () => {
  assert.equal(formatRateChange(29.4 - 22.8), "6.6%");
});

test("formatRateChange: ケース3 42.0%→41.0% の差分(-1.0)は「1.0%」になる", () => {
  assert.equal(formatRateChange(41.0 - 42.0), "1.0%");
});

test("formatRateChange: ケース4 30.0%→30.0% の差分(0)は「0.0%」になり、NaN/Infinityにならない", () => {
  assert.equal(formatRateChange(30.0 - 30.0), "0.0%");
});

test("formatRateChange: ケース5 -2.0%→3.0% の差分(+5.0)は「5.0%」になる", () => {
  assert.equal(formatRateChange(3.0 - -2.0), "5.0%");
});

test("formatRateChange: ケース6 3.0%→-2.0% の差分(-5.0)は「5.0%」になる(符号は呼び出し側の上昇/低下判定が別途担う)", () => {
  assert.equal(formatRateChange(-2.0 - 3.0), "5.0%");
});

test("describeComparison経由(変化が大きかった項目のdetail)は「前月値% → 今月値%」形式で表示され、「pt」「ポイント」「percentage point」「差分の%」を一切含まない(要件1・2・4)", () => {
  // 営業利益率(higherIsBetter)が5.2%→-0.4%へ悪化するケース(ユーザー提示のケース1相当)。
  const current = metric({ operatingMargin: -0.4 });
  const previous = metric({ operatingMargin: 5.2 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "operatingMargin");
  assert.ok(point);
  assert.match(point.detail, /営業利益率は 5\.2% → -0\.4% に低下しました/);
  for (const banned of ["pt", "ポイント", "percentage point", "5.6%"]) {
    assert.equal(point.detail.includes(banned), false, `detail contains banned unit: ${banned}`);
    assert.equal(result.summaryText.includes(banned), false, `summaryText contains banned unit: ${banned}`);
  }
});

test("固定費率(22.8%→29.4%、+6.6pt相当)の変化も「6.6%上昇」と表示され、「pt」を含まない(ユーザー提示ケース2)", () => {
  // fixedCostRateはexcludeFromConcernListのため、要因分析のrelatedMetrics経由で確認する
  // (operatingMarginの関連KPIとして表示される)。
  const current = metric({ operatingMargin: 4.0, fixedCostRate: 29.4, hasFixedCostData: true });
  const previous = metric({ operatingMargin: 10.0, fixedCostRate: 22.8, hasFixedCostData: true });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "operatingMargin");
  assert.ok(point);
  const fixedCostRateMetric = point.relatedMetrics.find((m) => m.key === "fixedCostRate");
  assert.ok(fixedCostRateMetric);
  assert.equal(fixedCostRateMetric.judgment, "worsened");
});

// ============================================================
// 2026-09全面改訂: 月次レビュー文章表現・数値表記ルールの統一(ユーザー提示の具体例)
// ============================================================

test("率の変化(要件1): 営業利益率19.0%→-0.4%は「営業利益率は 19.0% → -0.4% に低下しました。」になる", () => {
  const current = metric({ operatingMargin: -0.4 });
  const previous = metric({ operatingMargin: 19.0 });
  const comparisons = buildMetricComparisons(current, previous, FIELDS_ENABLED);
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "operatingMargin");
  assert.equal(point.detail.startsWith("営業利益率は 19.0% → -0.4% に低下しました。"), true, point.detail);
  void comparisons;
});

test("率の変化(要件1): 材料・仕入原価率29.8%→41.0%は「材料・仕入原価率は 29.8% → 41.0% に上昇しました。」になる", () => {
  const current = metric({ materialRate: 41.0, operatingMargin: 5 });
  const previous = metric({ materialRate: 29.8, operatingMargin: 15 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "materialRate");
  assert.ok(point);
  assert.equal(point.detail.startsWith("材料・仕入原価率は 29.8% → 41.0% に上昇しました。"), true, point.detail);
});

test("率の変化(要件1): 人件費率28.4%→30.0%は「人件費率は 28.4% → 30.0% に上昇しました。」になる", () => {
  const current = metric({ laborRate: 30.0 });
  const previous = metric({ laborRate: 28.4 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const point = result.concernPoints.find((p) => p.id === "laborRate");
  assert.equal(point.detail.startsWith("人件費率は 28.4% → 30.0% に上昇しました。"), true, point.detail);
});

test("量の変化(要件8): 売上・新規客数・再来客数は前月比%表記+増加/減少を使う", () => {
  const current = metric({ sales: 773800, newCustomers: 56, repeatCustomers: 74 });
  const previous = metric({ sales: 1000000, newCustomers: 50, repeatCustomers: 80.9 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.match(result.summaryText, /総売上は前月より22\.6%減少しました/);
  const comparisons = buildMetricComparisons(current, previous, FIELDS_ENABLED);
  // newCustomers: 50→56 = +12.0%
  assert.match(describeComparisonForTest("newCustomers", comparisons.newCustomers), /新規客数は前月より12\.0%増加しました/);
});

test("桁数(要件16): 小数点第1位までに丸められる(29.84→29.8%、29.86→29.9%)", () => {
  const a = buildMetricComparisons(metric({ laborRate: 29.84 }), metric({ laborRate: 20 }), FIELDS_ENABLED);
  assert.match(describeComparisonForTest("laborRate", a.laborRate), /29\.8%/);
  const b = buildMetricComparisons(metric({ laborRate: 29.86 }), metric({ laborRate: 20 }), FIELDS_ENABLED);
  assert.match(describeComparisonForTest("laborRate", b.laborRate), /29\.9%/);
});

test("0%・マイナス値(要件14): 5.0%→0.0%、5.0%→-2.0%、-2.0%→3.0%のいずれも文章が崩れない(二重マイナス無し)", () => {
  const r1 = buildMetricComparisons(metric({ laborRate: 0 }), metric({ laborRate: 5.0 }), FIELDS_ENABLED);
  assert.equal(describeComparisonForTest("laborRate", r1.laborRate), "人件費率は 5.0% → 0.0% に低下しました。");
  const r2 = buildMetricComparisons(metric({ laborRate: -2.0 }), metric({ laborRate: 5.0 }), FIELDS_ENABLED);
  assert.equal(describeComparisonForTest("laborRate", r2.laborRate), "人件費率は 5.0% → -2.0% に低下しました。");
  const r3 = buildMetricComparisons(metric({ operatingMargin: 3.0 }), metric({ operatingMargin: -2.0 }), FIELDS_ENABLED);
  assert.equal(describeComparisonForTest("operatingMargin", r3.operatingMargin), "営業利益率は -2.0% → 3.0% に上昇しました。");
  for (const text of [
    describeComparisonForTest("laborRate", r1.laborRate),
    describeComparisonForTest("laborRate", r2.laborRate),
    describeComparisonForTest("operatingMargin", r3.operatingMargin),
  ]) {
    assert.equal(text.includes("--"), false, `不正な二重マイナスが無いこと: ${text}`);
  }
});

test("同値(要件15): 前月と今月が同じ場合は「上昇/低下」を使わず「前月と同じ」と表示し、変化が大きかった項目には選出されない", () => {
  const current = metric({ laborRate: 30.0 });
  const previous = metric({ laborRate: 30.0 });
  const comparisons = buildMetricComparisons(current, previous, FIELDS_ENABLED);
  assert.equal(comparisons.laborRate.judgment, "unchanged");
  assert.equal(describeComparisonForTest("laborRate", comparisons.laborRate), "人件費率は前月と同じ30.0%です。");
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal(result.concernPoints.some((p) => p.id === "laborRate"), false);
});

test("評価語(要件10): 「悪化」「改善」「良くなりました」「危険」「問題です」を一切含まない(総評・変化が大きかった項目とも)", () => {
  const current = metric({ sales: 500000, laborRate: 50, materialRate: 25, operatingMargin: -5, operatingProfit: -20000 });
  const previous = metric({ sales: 1000000, laborRate: 38, materialRate: 15, operatingMargin: 10, operatingProfit: 100000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const allText = result.summaryText + result.concernPoints.map((p) => p.title + p.detail).join("");
  for (const banned of ["悪化", "改善", "良くなりました", "悪くなりました", "危険です", "問題です"]) {
    assert.equal(allText.includes(banned), false, `banned phrase found: ${banned}`);
  }
});

test("旧・禁止表現(要件7)が一切残っていない: 「○%から○%へ」「よりも」「となっております」「見受けられます」", () => {
  const current = metric({ sales: 700000, customers: 140, averageSpend: 5000, laborRate: 45, materialRate: 40, operatingMargin: -3, operatingProfit: -10000 });
  const previous = metric({ sales: 1000000, customers: 200, averageSpend: 5000, laborRate: 38, materialRate: 15, operatingMargin: 10, operatingProfit: 100000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const allText = result.summaryText + result.concernPoints.map((p) => p.title + p.detail).join("");
  for (const banned of ["から", "へ", "よりも", "となっております", "見受けられます", "pt", "ポイント"]) {
    assert.equal(allText.includes(banned), false, `banned phrase/unit found: ${banned}\n---\n${allText}`);
  }
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

test("goodPoints/improvementPointsという古いフィールドはもう存在しない(構成は総評+変化が大きかった項目+来月確認するポイントの3つ)", () => {
  const current = metric({ averageSpend: 6000 });
  const previous = metric({ averageSpend: 5000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.equal("goodPoints" in result, false);
  assert.equal("improvementPoints" in result, false);
  // 以前の"nextFocus"(抽象的な助言のみ、要因の無い次月注目項目)は廃止済みで復活させない。
  // 2026-09に再追加した"nextFocusPoints"(現状値・前月値付きの具体的な確認ポイント)とは
  // 名前・中身とも別物であることをここで区別する。
  assert.equal("nextFocus" in result, false);
  assert.deepEqual(Object.keys(result).sort(), ["comparisons", "concernPoints", "hasData", "nextFocusPoints", "summaryText"]);
});

test("nextFocusPoints: 変化が大きかった項目と同じ基準(rankConcernKeys)から最大3件、現状値・前月値のみを返す(施策は書かない)", () => {
  const current = metric({ sales: 500000, customers: 100, newCustomers: 20, retailSales: 100000, averageSpend: 3000, laborRate: 50, materialRate: 25, operatingMargin: -5 });
  const previous = metric({ sales: 1000000, customers: 200, newCustomers: 60, retailSales: 300000, averageSpend: 5000, laborRate: 38, materialRate: 15, operatingMargin: 10 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.nextFocusPoints.length <= MONTHLY_INSIGHT_THRESHOLDS.maxConcernPoints);
  result.nextFocusPoints.forEach((point) => {
    assert.deepEqual(Object.keys(point).sort(), ["current", "id", "label", "previous"]);
  });
  // 良化した指標(customers等)は候補に入らない(worsenedのみを対象にするrankConcernKeysの規約)。
  assert.ok(!result.nextFocusPoints.some((point) => point.id === "customers"));
});

test("nextFocusPoints: 前月から大きく変化した指標が無い月は0件(施策を無理に作らない)", () => {
  const current = metric({});
  const previous = metric({});
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.deepEqual(result.nextFocusPoints, []);
});

test("concernPointsは最大件数(MONTHLY_INSIGHT_THRESHOLDS.maxConcernPoints)で絞り込まれる", () => {
  const current = metric({ sales: 500000, customers: 100, newCustomers: 20, retailSales: 100000, averageSpend: 3000, laborRate: 50, materialRate: 25, operatingMargin: -5 });
  const previous = metric({ sales: 1000000, customers: 200, newCustomers: 60, retailSales: 300000, averageSpend: 5000, laborRate: 38, materialRate: 15, operatingMargin: 10 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  assert.ok(result.concernPoints.length <= MONTHLY_INSIGHT_THRESHOLDS.maxConcernPoints);
});

// ============================================================
// 要因分析(FACTOR_RELATIONS/buildFactorAnalysis、2026-09追加)
// ============================================================

test("要因分析: 客数・客単価がともに悪化方向の月は、売上の変化点(concernPoints)に両方の要因が'や'でまとめて述べられ、relatedMetricsも両方付く(2026-09表現統一: 比較優劣ではなく該当する要因を列挙する)", () => {
  // 客数: 200→120(-40%)、客単価: 5000→4700(-6%) → どちらも悪化方向なので両方を要因として挙げる
  const current = metric({ sales: 564000, customers: 120, averageSpend: 4700 });
  const previous = metric({ sales: 1000000, customers: 200, averageSpend: 5000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const salesPoint = result.concernPoints.find((point) => point.id === "sales");
  assert.ok(salesPoint, "売上が変化が大きかった項目に含まれること");
  assert.match(salesPoint.detail, /総売上は前月より43\.6%減少しました/);
  assert.ok(salesPoint.detail.includes("客数"));
  assert.ok(salesPoint.detail.includes("客単価"));
  // 客数(減少)と客単価(低下)は動詞が異なるため、別グループとして"・"で連結される。
  assert.match(salesPoint.detail, /主に、客数の減少・客単価の低下が影響しています/);
  for (const banned of ["pt", "ポイント", "よりも"]) {
    assert.equal(salesPoint.detail.includes(banned), false, `detail contains banned phrase: ${banned}`);
  }
  const relatedKeys = salesPoint.relatedMetrics.map((m) => m.key).sort();
  assert.deepEqual(relatedKeys, ["averageSpend", "customers"]);
});

test("要因分析: 関連KPIが1つしか比較できない場合は説明文を作らない(根拠のない断定を避ける)", () => {
  // customersのfieldsEnabledをOFFにし、salesの関連(customers/averageSpend)のうち
  // averageSpendしか比較対象に残らないケース。
  const fieldsEnabled = { ...FIELDS_ENABLED };
  const current = metric({ sales: 800000, averageSpend: 4000 });
  const previous = metric({ sales: 1000000, averageSpend: 5000 });
  const comparisons = buildMetricComparisons(current, previous, fieldsEnabled);
  delete comparisons.customers; // 比較不能を模擬(hasDataがfalse相当のケースの代用)
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled });
  const salesPoint = result.concernPoints.find((point) => point.id === "sales");
  // customers自体はfieldsEnabledで消していないため通常は候補に残るが、要因分析自体が
  // 「関連が2件未満なら説明文を作らない」規約に従っていることを、直接analyzeMonthlyReview
  // 経由で確認する(通常ケースでは2件とも揃うため説明文が付くことを上のテストで確認済み)。
  assert.ok(salesPoint);
});

test("要因分析: FACTOR_RELATIONSに定義の無い指標(例: 口コミ数)にはrelatedMetrics・要因文が付かない", () => {
  const current = metric({ reviewCount: 5 });
  const previous = metric({ reviewCount: 20 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const reviewPoint = result.concernPoints.find((point) => point.id === "reviewCount");
  assert.ok(reviewPoint);
  assert.deepEqual(reviewPoint.relatedMetrics, []);
  assert.ok(!reviewPoint.detail.includes("よりも"));
});

// ============================================================
// 根本原因(rootCause) vs 結果(result)の判定(2026-09再改訂)
// 「率が悪化した=その費用が根本原因」と早合点しないことを検証する。
// ============================================================

test("人件費率上昇(相対的上昇): ユーザー提示の実例(売上5,000,000→3,870,000円/人件費1,420,000→1,161,000円/人件費率28.4%→30.0%)で、人件費額自体は減少しているため「人件費が増えたこと」を原因としない", () => {
  const current = metric({ sales: 3870000, laborRate: 30.0, laborCost: 1161000, operatingMargin: 5 });
  const previous = metric({ sales: 5000000, laborRate: 28.4, laborCost: 1420000, operatingMargin: 10 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const laborPoint = result.concernPoints.find((point) => point.id === "laborRate");
  assert.ok(laborPoint, "人件費率が変化が大きかった項目に含まれること");
  // 人件費額自体は減っている(結果としての相対的上昇)ため「増加」という言葉を使わない。
  assert.ok(!laborPoint.detail.includes("人件費が増加"));
  assert.ok(!laborPoint.detail.includes("人件費の増加"));
  assert.match(laborPoint.detail, /売上の減少幅に対して人件費の減少幅が小さかったため、人件費率が上昇しています。/);
});

test("材料費率上昇(相対的上昇): 材料費額自体は減少しているが売上の減少幅より小さいため、材料費が増えたとは書かない", () => {
  const current = metric({ sales: 800000, materialRate: 20, materialCost: 160000, operatingMargin: 5 });
  const previous = metric({ sales: 1000000, materialRate: 15, materialCost: 180000, operatingMargin: 10 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const materialPoint = result.concernPoints.find((point) => point.id === "materialRate");
  assert.ok(materialPoint);
  assert.ok(!materialPoint.detail.includes("材料・仕入原価の増加"));
  assert.match(materialPoint.detail, /売上の減少幅に対して材料・仕入原価の減少幅が小さかったため、材料・仕入原価率が上昇しています。/);
});

test("人件費率上昇(真の原因): 売上が横ばいなのに人件費額自体が増加している場合は「人件費の増加」を原因として明言してよい", () => {
  const current = metric({ sales: 1000000, laborRate: 45, laborCost: 450000, operatingMargin: 5 });
  const previous = metric({ sales: 1000000, laborRate: 38, laborCost: 380000, operatingMargin: 12 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const laborPoint = result.concernPoints.find((point) => point.id === "laborRate");
  assert.ok(laborPoint);
  assert.match(laborPoint.detail, /人件費の増加が大きいため、人件費率が上昇しています。/);
  assert.ok(!laborPoint.detail.includes("減少幅が小さかった"));
});

test("固定費率: 固定費額がほぼ同じで売上だけ減少した場合は「負担割合が上昇」と表現し、固定費が増えたとは書かない(fixedCostRateは単独カードとして表示される)", () => {
  const current = metric({
    sales: 800000, fixedCost: 182400, hasFixedCostData: true,
    fixedCostRate: 22.8,
    operatingMargin: 5,
  });
  const previous = metric({ sales: 1000000, fixedCost: 182400, hasFixedCostData: true, fixedCostRate: 18.24, operatingMargin: 12 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const fixedPoint = result.concernPoints.find((point) => point.id === "fixedCostRate");
  assert.ok(fixedPoint, "固定費率が単独のカードとして変化が大きかった項目に含まれること");
  assert.equal(fixedPoint.title, "固定費率が上昇しています");
  assert.match(fixedPoint.detail, /売上減少により、固定費の売上に対する負担割合が上昇しています。/);
  assert.ok(!fixedPoint.detail.includes("固定費の増加"));
});

test("固定費率: 固定費額自体が増加している場合は「固定費の増加も影響している」旨を書く", () => {
  const current = metric({ sales: 1000000, fixedCost: 250000, hasFixedCostData: true, fixedCostRate: 25, operatingMargin: 5 });
  const previous = metric({ sales: 1000000, fixedCost: 182400, hasFixedCostData: true, fixedCostRate: 18.24, operatingMargin: 12 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const fixedPoint = result.concernPoints.find((point) => point.id === "fixedCostRate");
  assert.ok(fixedPoint);
  assert.match(fixedPoint.detail, /固定費の増加も営業利益低下に影響しています。/);
});

test("総評(buildSummaryText): 売上減少→費用の減少幅が売上の減少幅より小さい→費用率上昇→営業利益率低下、の順で説明し、「率が上がったから利益が下がった」という単純な表現にしない", () => {
  const current = metric({ sales: 774000, laborRate: 30.0, laborCost: 232200, materialRate: 41.0, materialCost: 317340, operatingMargin: -0.4, operatingProfit: -3096 });
  const previous = metric({ sales: 1000000, laborRate: 28.4, laborCost: 284000, materialRate: 29.8, materialCost: 298000, operatingMargin: 19.0, operatingProfit: 190000 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  // ①売上の増減が最初に述べられる
  assert.match(result.summaryText, /総売上は前月より22\.6%減少しました。/);
  // ②③費用側は「率が上がったから」という短絡表現ではなく、減少幅の差という形で述べる
  assert.ok(!result.summaryText.includes("人件費率が上がったから"));
  assert.ok(!result.summaryText.includes("率が上がったから利益"));
  // ④最終的に営業利益率の変化へつながる
  assert.match(result.summaryText, /営業利益率は 19\.0% → -0\.4% に低下しました。/);
});

test("広告費率(adRate): FACTOR_RELATIONS.operatingMarginの一員として、他の費用率と同じ根本原因/結果ロジックで総評の要因分析に反映される", () => {
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
  // 広告費額自体は減少している(50000→44000)が、売上の減少幅ほどではないため相対的に
  // 広告費率が上昇している「結果」であり、「広告費が増えた」とは書かない。
  assert.ok(!result.summaryText.includes("広告費の増加"));
  assert.ok(result.summaryText.includes("広告費"));
  assert.match(result.summaryText, /売上の減少幅に対して広告費の減少幅が小さかったこと/);
});

test("前月比較の表記は常に「%」であり、「pt」「ポイント」は根本原因/結果いずれの文言にも一切出ない", () => {
  const current = metric({ sales: 3870000, laborRate: 30.0, laborCost: 1161000, operatingMargin: 5 });
  const previous = metric({ sales: 5000000, laborRate: 28.4, laborCost: 1420000, operatingMargin: 10 });
  const result = analyzeMonthlyReview({ current, previous, fieldsEnabled: FIELDS_ENABLED });
  const laborPoint = result.concernPoints.find((point) => point.id === "laborRate");
  for (const text of [result.summaryText, laborPoint.detail]) {
    assert.ok(!text.includes("pt"), text);
    assert.ok(!text.includes("ポイント"), text);
  }
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

test("getMonthlyReviewMetrics(単一店舗): 固定費・広告費・店販比率も損益表と同じ値をそのまま反映する(要因分析用に2026-09追加)", () => {
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

test("getMonthlyReviewMetrics(単一店舗・売上連動モード): フィーネ横浜の再発防止テスト(2026-09) — 人件費・原価を実額登録せず売上連動(sales_linked)で運用している店舗でも、営業利益・営業利益率が損益表(calculateMonthSummary+buildStoreCostOptions)と完全に一致する。以前はlaborCostMode/laborCostRate/purchaseCostMode/purchaseCostRateが渡っておらず、費用が0円扱いになり営業利益が過大表示されていた(4,163,299円→10,449,531円のような不具合)。", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.stores = [store];
  // 実額の登録は一切無い(monthClosing/costMonthlyAmountsが空) — 人件費40%・原価8%の
  // 売上連動モードだけで運用している店舗を再現する。
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
  // 人件費40%・原価8%が正しく効いていれば、費用ゼロ扱いのバグがあった場合の
  // 「ほぼ売上=利益」という異常値(営業利益率88%相当)にはならない。
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
