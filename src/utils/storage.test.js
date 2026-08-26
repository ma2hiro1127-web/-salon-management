import test from "node:test";
import assert from "node:assert/strict";

import { buildCompanySettingsFromRow, buildDailyEntryPayload, buildDailyStateFromRows, buildFixedCostsStateFromRows, buildCostMonthlyAmountsStateFromRows, buildMonthClosingStateFromRows, buildMonthlyClosingItemsStateFromRows, buildStoreProfilesByStoreId, buildVariableCostsStateFromRows, calculateMonthSummary, calculateAllStoresMonthSummary, calculateTaxSummary, createInitialAppState, dailySalesRowToEntry, formatMonthLabel, getBusinessDaySummary, getAllStoresBusinessDaySummary, getUnclosedStoresForDate, getStoreStatusAsOfDate, buildCompanyMonthKey, buildMonthKey, getCustomerTargetSummary, getStaffProductivitySummary, getFixedCostsForStoreMonth, getCostMonthlyAmount, getPreviousMonthCostAmount, getVariableCostsForStoreMonth, getAiAnalysis, getSalesStatusComment, mergeRemoteAppState, canonicalStringifyForComparison, buildPersistenceComparableState, normalizeAppState, migrateNameKeyedMapsToStoreId, pruneStaleKeys, pruneDeletedItemsFromItemArrayMap, readAppState, writeAppState, buildStoreHolidaysStateFromRows, buildAllStoresHolidaysStateFromRows, getStoreHolidayDates, getAllStoresHolidayDates, isHolidayDate, sumByCategoryKey, getMonthClosingChecklist, needsMonthReconfirmation, getPreviousMonthAmountByNameAndCategory, getStoreDashboardRows, getCompanyDashboardSummary, diffPercent, formatMoneyOrDash, formatPercentOrDash, formatDiffOrDash, sanitizeNumericInputValue, getMonthlyCashBreakdownRows, summarizeMonthlyCashBreakdown, parseNullableNumber, dailyBatchEntryRowToEntry, buildBatchEntryStateFromRows, getBatchEntriesForStoreMonth, buildDailyBatchEntryPayload, detectBatchEntryFieldOverlap, getBusinessDayDatesInRange, getBatchAllocatedEntries, getBatchAllocatedDatesSet, getMonthlyReviewSummary, buildMonthlyReviewKey, getMonthlyReviewText, buildMonthlyReviewStateFromRows, resolvePreferredStoreSelection, resolveCurrentCompany, normalizeStoreNameForDuplicateCheck, getStoreMonthSalesTotal, resolveHydrateDispatch, resolveDailyEntryEditState, formatDailyDateLabel, runWithSaveGuard, calculateLaborCost, calculatePurchaseCost, calculateActualCostRate, getStoreMonthlyCostOverride, buildStoreMonthlyCostOverridesStateFromRows } from "./storage.js";

if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = {
    store: {},
    getItem(key) {
      return this.store[key] ?? null;
    },
    setItem(key, value) {
      this.store[key] = String(value);
    },
    removeItem(key) {
      delete this.store[key];
    },
    clear() {
      this.store = {};
    },
  };
}

test("calculateMonthSummary returns sales and cost ratios from new monthly structure", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.stores = [store];
  state.selectedStore = store;
  state.selectedMonth = month;
  state.targets[key] = {
    targetSales: 1000000,
  };
  state.dailyResults[key] = [
    { date: "2026-08-01", totalSales: 200000, technicalSales: 140000, retailSales: 60000, customers: 10, newCustomers: 3, repeatCustomers: 7 },
    { date: "2026-08-02", totalSales: 300000, technicalSales: 180000, retailSales: 120000, customers: 12, newCustomers: 4, repeatCustomers: 8 },
  ];
  state.fixedCosts[key] = [
    { id: "fixed-1", name: "家賃", categoryKey: "rent", periodType: "ongoing" },
  ];
  state.costMonthlyAmounts = { "fixed-1__2026-08": { amount: 100000 } };
  state.variableCosts[key] = [
    { id: "var-1", name: "広告費", categoryKey: "advertising", amount: 50000 },
  ];
  state.monthClosing[key] = [
    { id: "close-1", name: "人件費", amount: 150000, category: "人件費", categoryKey: "labor" },
    { id: "close-2", name: "材料費", amount: 40000, category: "材料費", categoryKey: "materials" },
    { id: "close-3", name: "固定費", amount: 20000, category: "固定費", categoryKey: "other" },
    { id: "close-4", name: "販管費", amount: 30000, category: "販管費", categoryKey: "other" },
  ];

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.sales, 500000);
  assert.equal(summary.targetAchievement, 50);
  assert.equal(summary.remainingSalesTarget, 500000);
  assert.equal(summary.operatingProfit, 110000);
  assert.equal(summary.operatingMargin, 22);
  // fixedCost/variableCostはcategory_key基準の内部合計に変わった: 家賃(rent)+「固定費」
  // 「販管費」という旧カテゴリ名が移ったother(その他費用)がfixedCostに合算され、
  // variableCostは未分類のみ(今回は無いので0)。広告費は別枠(adCost)。
  assert.equal(summary.fixedCost, 150000); // rent(100000) + other(20000+30000)
  assert.equal(summary.variableCost, 0);
  assert.equal(summary.adCost, 50000);
  assert.equal(summary.laborCost, 150000);
  assert.equal(summary.purchaseAmount, 40000);
  assert.equal(summary.costOfGoodsSold, 40000);
});

test("getStoreMonthSalesTotal: 店舗売上ランキング用の軽量版はcalculateMonthSummaryのsales/entriesと同じ値を返す(計算式は同一のまま、費用集計だけを省く)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.stores = [store];
  state.selectedStore = store;
  state.selectedMonth = month;
  state.dailyResults[key] = [
    { date: "2026-08-01", totalSales: 200000, technicalSales: 140000, retailSales: 60000, customers: 10 },
    { date: "2026-08-02", totalSales: 300000, technicalSales: 180000, retailSales: 120000, customers: 12 },
  ];

  const full = calculateMonthSummary(state, store, month);
  const lightweight = getStoreMonthSalesTotal(state, store, month);

  assert.equal(lightweight.sales, full.sales);
  assert.equal(lightweight.sales, 500000);
  assert.equal(lightweight.hasEntries, full.entries.length > 0);
  assert.equal(lightweight.hasEntries, true);
});

test("getStoreMonthSalesTotal: まとめて入力(daily_batch_entries)由来の売上もdailyResultsと合算する(calculateMonthSummaryのbatchSales加算と同じロジック)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.stores = [store];
  state.selectedStore = store;
  state.selectedMonth = month;
  state.dailyBatchEntries[key] = [
    { id: "batch-1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: 700000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null },
  ];

  const full = calculateMonthSummary(state, store, month);
  const lightweight = getStoreMonthSalesTotal(state, store, month);

  assert.equal(lightweight.sales, full.sales);
  assert.equal(lightweight.sales, 700000);
});

test("getStoreMonthSalesTotal: 実日次入力もまとめて入力も無い月はsales=0・hasEntries=falseを返す(前月データなし判定に使われる)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-07";

  state.stores = [store];
  state.selectedStore = store;

  const result = getStoreMonthSalesTotal(state, store, month);

  assert.equal(result.sales, 0);
  assert.equal(result.hasEntries, false);
});

// 「データを更新中です…」が消えない不具合(2件連続、いずれも同じ型)の再発防止テスト。
// 詳細はresolveHydrateDispatch(storage.js)自身のコメント参照——打ち切られる呼び出しが
// 共有状態(リクエスト番号・UIのsyncing表示)へ一切触れないことを、実際のReact/App.jsxを
// 介さずに検証する。
test("resolveHydrateDispatch: 同一キーの取得が既に進行中なら打ち切り、リクエスト番号を消費しない(2件連続バグの再発防止)", () => {
  const result = resolveHydrateDispatch({
    currentInFlightKey: "company-1::2026-08",
    candidateKey: "company-1::2026-08",
    currentRequestCounter: 5,
  });
  assert.equal(result.shouldProceed, false);
  assert.equal(result.requestId, null);
  // 打ち切られる呼び出しはinFlightKey・requestCounterのどちらも変更しない(呼び出し元は
  // これらの値をそのまま自分のrefへ書き戻すだけでよい設計) — この値が変わっていたら、
  // 「打ち切られた呼び出しが共有状態を書き換えてしまう」バグが再発したことになる。
  assert.equal(result.nextInFlightKey, "company-1::2026-08");
  assert.equal(result.nextRequestCounter, 5);
});

test("resolveHydrateDispatch: 異なるキー(会社/対象月違い)なら進行し、リクエスト番号を1つ進める", () => {
  const result = resolveHydrateDispatch({
    currentInFlightKey: "company-1::2026-07",
    candidateKey: "company-1::2026-08",
    currentRequestCounter: 5,
  });
  assert.equal(result.shouldProceed, true);
  assert.equal(result.requestId, 6);
  assert.equal(result.nextInFlightKey, "company-1::2026-08");
  assert.equal(result.nextRequestCounter, 6);
});

test("resolveHydrateDispatch: 進行中の取得が無い(null)場合は常に進行する", () => {
  const result = resolveHydrateDispatch({
    currentInFlightKey: null,
    candidateKey: "company-1::2026-08",
    currentRequestCounter: 0,
  });
  assert.equal(result.shouldProceed, true);
  assert.equal(result.requestId, 1);
});

test("resolveHydrateDispatch: 打ち切りが連続しても、その間にリクエスト番号が進まないことを確認(打ち切りは真に何もしないという不変条件)", () => {
  let counter = 0;
  // 1件目: 実際に取得へ進む
  const first = resolveHydrateDispatch({ currentInFlightKey: null, candidateKey: "company-1::2026-08", currentRequestCounter: counter });
  counter = first.nextRequestCounter;
  const inFlightKey = first.nextInFlightKey;
  assert.equal(first.requestId, 1);

  // 2件目・3件目: 同じキーへの重複呼び出し(focus/visibilitychange/pageshowの同時発火を想定)。
  // 何度打ち切られてもcounterは1のまま——打ち切られた呼び出し「だけ」が後から発火しても、
  // 本来のrequestId(1)が「自分より新しい呼び出しが始まった」と誤判定されることは無い。
  const second = resolveHydrateDispatch({ currentInFlightKey: inFlightKey, candidateKey: "company-1::2026-08", currentRequestCounter: counter });
  assert.equal(second.shouldProceed, false);
  counter = second.nextRequestCounter;
  const third = resolveHydrateDispatch({ currentInFlightKey: inFlightKey, candidateKey: "company-1::2026-08", currentRequestCounter: counter });
  assert.equal(third.shouldProceed, false);
  counter = third.nextRequestCounter;

  assert.equal(counter, 1);
  // 1件目のrequestId(1)は、counterが1のままである限り「最新」であり続ける——
  // hydrateFromSupabase側のstale判定(hydrateRequestRef.current !== requestId)が
  // 誤ってfirst.requestIdを古い扱いにしないことを保証する。
  assert.equal(counter, first.requestId);
});

test("calculateMonthSummary: adCost/adRate only count the 広告費 category (and legacy 定額広告費), never the whole cost total", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 1000000 }];
  state.fixedCosts[key] = [
    { id: "fc-ad", name: "ホットペッパー掲載費", category: "広告費", categoryKey: "advertising", periodType: "limited", startMonth: month, endMonth: month },
    { id: "fc-rent", name: "家賃", category: "家賃", categoryKey: "rent", periodType: "limited", startMonth: month, endMonth: month },
    { id: "fc-legacy-ad", name: "旧広告費", category: "定額広告費", categoryKey: "advertising", periodType: "limited", startMonth: month, endMonth: month },
  ];
  state.costMonthlyAmounts = {
    "fc-ad__2026-08": { amount: 60000 },
    "fc-rent__2026-08": { amount: 200000 },
    "fc-legacy-ad__2026-08": { amount: 15000 },
  };

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.adCost, 75000); // 60000 + 15000, rent excluded
  assert.equal(summary.adRate, 7.5); // 75000 / 1000000 * 100
});

test("calculateMonthSummary: 口コミ数の累計は月間目標(targetReviewCount)の有無に関わらず常に集計される(日次入力の口コミ数トグルと目標口コミ数トグルは独立)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyResults[key] = [
    { date: "2026-08-01", totalSales: 100000, reviewCount: 5 },
    { date: "2026-08-02", totalSales: 100000, reviewCount: 3 },
  ];
  // targetsに何も設定しない(目標口コミ数OFF相当)ケース。
  const summaryWithoutTarget = calculateMonthSummary(state, store, month);
  assert.equal(summaryWithoutTarget.reviewCount, 8);
  assert.equal(summaryWithoutTarget.reviewCountTarget, 0);
  assert.equal(summaryWithoutTarget.reviewCountAchievement, 0);

  // 目標口コミ数を設定した場合、累計自体は変わらず、達成率だけが計算されるようになる。
  state.targets[key] = { targetReviewCount: 10 };
  const summaryWithTarget = calculateMonthSummary(state, store, month);
  assert.equal(summaryWithTarget.reviewCount, 8);
  assert.equal(summaryWithTarget.reviewCountTarget, 10);
  assert.equal(summaryWithTarget.reviewCountAchievement, 80);
});

test("calculateMonthSummary: rates are 0 (not NaN/Infinity) when sales is 0", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.fixedCosts[key] = [{ id: "fc-ad", name: "広告", category: "広告費", categoryKey: "advertising", periodType: "limited", startMonth: month, endMonth: month }];
  state.costMonthlyAmounts = { "fc-ad__2026-08": { amount: 10000 } };

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.sales, 0);
  assert.equal(summary.adRate, 0);
  assert.equal(summary.laborRate, 0);
  assert.equal(summary.costOfGoodsSoldRate, 0);
  assert.equal(summary.operatingMargin, 0);
  assert.equal(Number.isFinite(summary.adRate), true);
});

test("ongoing (継続) fixed costs appear in later months without a fresh monthly amount having ever been entered for them", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-09";
  const key = `${store}__2026-08`;

  state.fixedCosts = {
    [key]: [{ id: "fixed-2", name: "システム利用料", periodType: "ongoing", startMonth: "2026-08", endMonth: "" }],
  };

  const costs = calculateMonthSummary(state, store, month).fixedCosts;

  assert.equal(costs.length, 1);
  assert.equal(costs[0].name, "システム利用料");
});

test("tax summary derives net sales and tax from gross sales", () => {
  const summary = calculateTaxSummary({ sales: 110000, totalExpenses: 50000, taxRate: 0.1, roundingMode: "half-up" });

  assert.equal(summary.taxExclusiveSales, 100000);
  assert.equal(summary.taxAmount, 10000);
  assert.equal(summary.taxExclusiveExpenses, 45455);
});

test("month summary separates fixed and variable costs from closing items", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 500000, customers: 20 }];
  state.fixedCosts[key] = [{ id: "fixed-1", name: "家賃", categoryKey: "rent", periodType: "ongoing" }];
  state.costMonthlyAmounts = { "fixed-1__2026-08": { amount: 100000 } };
  state.variableCosts[key] = [{ id: "var-1", name: "広告費", categoryKey: "advertising", amount: 50000 }];
  state.monthClosing[key] = [
    { id: "close-1", name: "人件費", amount: 150000, category: "人件費", categoryKey: "labor" },
    { id: "close-2", name: "材料費", amount: 40000, category: "材料費", categoryKey: "materials" },
    { id: "close-3", name: "固定費", amount: 20000, category: "固定費", categoryKey: "other" },
    { id: "close-4", name: "販管費", amount: 30000, category: "販管費", categoryKey: "other" },
    { id: "close-5", name: "設備投資", amount: 30000, category: "設備投資" },
  ];

  const summary = calculateMonthSummary(state, store, month);

  // fixedCost=家賃(rent)+「固定費」「販管費」という旧カテゴリ名が移ったother(その他費用)、
  // variableCostは未分類のみ(今回は無いので0)、広告費はadCostへ別枠化。
  assert.equal(summary.fixedCost, 150000); // rent(100000) + other(20000+30000)
  assert.equal(summary.variableCost, 0);
  // equipmentInvestmentCost is still computed (backward-compat for closingItems already tagged
  // 設備投資) but is explicitly excluded from category-based bucketing (categorizableItems filter)
  // so it never counts toward fixedCost/variableCost/expenseCost — 設備投資 has no dedicated P&L
  // card or role anymore (see calculateMonthSummary's design notes); a store that wants it
  // reflected now registers it as a plain 費用 item under a real category instead.
  assert.equal(summary.equipmentInvestmentCost, 30000);
  assert.equal(summary.expenseCost, 200000);
  assert.equal(summary.operatingProfit, 110000);
});

test("grossProfit only deducts costOfGoodsSold (not labor or 経費) — 粗利益 = 総売上 - 材料・仕入原価", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 500000 }];
  state.monthClosing[key] = [
    { id: "close-1", name: "人件費", amount: 150000, category: "人件費", categoryKey: "labor" },
    { id: "close-2", name: "仕入・発注額", amount: 40000, category: "仕入・発注額", categoryKey: "materials" },
  ];

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.purchaseAmount, 40000);
  assert.equal(summary.grossProfit, 460000); // 500000 - 40000, labor not deducted here
  assert.equal(summary.operatingProfit, 310000); // grossProfit - laborCost(150000) - expenseCost(0)
});

test("costOfGoodsSold: 在庫管理OFF(既定)では仕入・発注額がそのまま原価になる", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 500000 }];
  state.monthClosing[key] = [{ id: "close-1", name: "仕入・発注額", amount: 80000, category: "仕入・発注額", categoryKey: "materials" }];
  // 在庫金額を登録しても、useInventoryTracking:falseの場合は一切参照されない。
  state.storeInventoryBalances = { [`${store}__2026-07`]: { amount: 999999 }, [`${store}__2026-08`]: { amount: 1 } };

  const summary = calculateMonthSummary(state, store, month, { useInventoryTracking: false });

  assert.equal(summary.costOfGoodsSold, 80000);
});

test("costOfGoodsSold: 在庫管理ONでは前月末在庫+当月仕入・発注額-当月末在庫で計算する", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 500000 }];
  state.monthClosing[key] = [{ id: "close-1", name: "仕入・発注額", amount: 80000, category: "仕入・発注額", categoryKey: "materials" }];
  state.storeInventoryBalances = {
    [`${store}__2026-07`]: { amount: 100000 }, // 前月末在庫
    [`${store}__2026-08`]: { amount: 60000 }, // 当月末在庫
  };

  const summary = calculateMonthSummary(state, store, month, { useInventoryTracking: true });

  assert.equal(summary.costOfGoodsSold, 120000); // 100000 + 80000 - 60000
  assert.equal(summary.costOfGoodsSoldRate, 24); // 120000 / 500000 * 100
});

test("costOfGoodsSold: 在庫管理ONで前月末在庫が未登録(初回利用)の場合は0円として計算する(UI側で期首在庫入力を促す)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 500000 }];
  state.monthClosing[key] = [{ id: "close-1", name: "仕入・発注額", amount: 80000, category: "仕入・発注額", categoryKey: "materials" }];
  state.storeInventoryBalances = { [`${store}__2026-08`]: { amount: 60000 } };

  const summary = calculateMonthSummary(state, store, month, { useInventoryTracking: true });

  assert.equal(summary.costOfGoodsSold, 20000); // 0(前月末在庫未登録) + 80000 - 60000
});

test("sumByCategoryKey: totalsは金額合計、hasEntryは1件でも登録があるかを別々に返す(0円登録済みと未登録0件を区別)", () => {
  const items = [
    { categoryKey: "rent", amount: 100000 },
    { categoryKey: "advertising", amount: 0 }, // 0円で登録済み
    { categoryKey: "not-a-real-key", amount: 5000 }, // 未知のkeyはuncategorizedへ
  ];
  const { totals, hasEntry } = sumByCategoryKey(items);

  assert.equal(totals.rent, 100000);
  assert.equal(hasEntry.rent, true);
  assert.equal(totals.advertising, 0);
  assert.equal(hasEntry.advertising, true); // 0円だが登録はされている
  assert.equal(totals.utilities, 0);
  assert.equal(hasEntry.utilities, false); // 1件も無い
  assert.equal(totals.uncategorized, 5000);
  assert.equal(hasEntry.uncategorized, true);
});

test("calculateMonthSummary: isProvisionalProfitはlabor/materialsのどちらかが未登録ならtrue", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 500000 }];
  state.monthClosing[key] = [{ id: "close-1", name: "仕入・発注額", amount: 80000, category: "仕入・発注額", categoryKey: "materials" }];
  // 人件費(labor)が1件も登録されていない

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.isProvisionalProfit, true);
  assert.deepEqual(summary.missingCriticalCategories, ["labor"]);
});

test("calculateMonthSummary: 人件費が0円で登録済みでもisProvisionalProfitはfalse(未登録0件とは区別)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 500000 }];
  state.monthClosing[key] = [
    { id: "close-1", name: "人件費", amount: 0, category: "人件費", categoryKey: "labor" },
    { id: "close-2", name: "仕入・発注額", amount: 80000, category: "仕入・発注額", categoryKey: "materials" },
  ];

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.isProvisionalProfit, false);
  assert.deepEqual(summary.missingCriticalCategories, []);
});

test("calculateMonthSummary: options.hiddenCategoriesに含めたカテゴリはcategoryHasEntryが解決済み扱いになり、missingCriticalCategoriesから除外される", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 500000 }];
  state.monthClosing[key] = [{ id: "close-1", name: "仕入・発注額", amount: 80000, category: "仕入・発注額", categoryKey: "materials" }];
  // 人件費(labor)は1件も登録していないが、店舗設定で「対象外」にしている想定。

  const summary = calculateMonthSummary(state, store, month, { hiddenCategories: ["labor"] });

  assert.equal(summary.categoryHasEntry.labor, true); // 「未入力」ではなく解決済み扱い
  assert.equal(summary.costsByCategory.labor, 0); // 実額は登録が無いので0円のまま
  assert.deepEqual(summary.missingCriticalCategories, []);
  assert.equal(summary.isProvisionalProfit, false); // 対象外設定のせいで暫定値のまま止まらない
  assert.equal(summary.operatingProfit, 420000); // 500000 - 80000(人件費は0円)
});

test("calculateMonthSummary: hasFixedCostData/hasExpenseCostDataは対象カテゴリに1件でも登録があるかで判定する(未入力を0として計算した値と区別するため)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 500000 }];
  // 固定費・広告費・その他とも一切未登録
  const summaryEmpty = calculateMonthSummary(state, store, month);
  assert.equal(summaryEmpty.hasFixedCostData, false);
  assert.equal(summaryEmpty.hasExpenseCostData, false);

  // 通信費(固定費の内訳の1つ)だけ登録
  state.fixedCosts[key] = [{ id: "fc-1", name: "通信費", categoryKey: "communication", periodType: "ongoing" }];
  state.costMonthlyAmounts = { "fc-1__2026-08": { amount: 5000 } };
  const summaryFixedOnly = calculateMonthSummary(state, store, month);
  assert.equal(summaryFixedOnly.hasFixedCostData, true);
  assert.equal(summaryFixedOnly.hasExpenseCostData, true); // 固定費経由でも経費合計側はtrueになる

  // 固定費の内訳には入らない広告費だけ登録されているケース(固定費自体は空のまま)
  state.fixedCosts[key] = [];
  state.variableCosts[key] = [{ id: "var-1", name: "広告費", categoryKey: "advertising", amount: 30000 }];
  const summaryAdOnly = calculateMonthSummary(state, store, month);
  assert.equal(summaryAdOnly.hasFixedCostData, false); // 固定費の内訳7カテゴリはどれも未登録
  assert.equal(summaryAdOnly.hasExpenseCostData, true); // 広告費は経費合計の対象なのでtrue
});

test("calculateMonthSummary: 「その他費用」(経費その他・本社経費・接待交際費など)は固定費に合算され、名称ではなくcategoryKeyで広告費と区別する", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 1000000 }];
  state.fixedCosts[key] = [
    { id: "fc-rent", name: "家賃", categoryKey: "rent", periodType: "ongoing" },
    { id: "fc-misc1", name: "本社経費", categoryKey: "other", periodType: "ongoing" },
    { id: "fc-misc2", name: "接待交際費・雑費", categoryKey: "other", periodType: "ongoing" },
    // 名称に「広告」を含んでいても、categoryKeyがadvertisingであれば広告費として集計され
    // 固定費には含まれない(名称ではなくcategoryKeyで判定する)。
    { id: "fc-hpb", name: "HPB", categoryKey: "advertising", periodType: "ongoing" },
  ];
  state.costMonthlyAmounts = {
    "fc-rent__2026-08": { amount: 401016 },
    "fc-misc1__2026-08": { amount: 250000 },
    "fc-misc2__2026-08": { amount: 50000 },
    "fc-hpb__2026-08": { amount: 60000 },
  };

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.fixedCost, 701016); // 401016(家賃) + 250000 + 50000(その他費用2件)
  assert.equal(summary.hasFixedCostData, true);
  assert.equal(summary.adCost, 60000); // HPBはcategoryKeyがadvertisingなので固定費に含まれない
  assert.equal(summary.otherCost, 300000); // その他費用カテゴリ自体の値は引き続き個別参照できる
});

test("getMonthClosingChecklist: 未入力のカテゴリと売上をmissingItemsに列挙し、カテゴリ名(文字列)ではなくhasEntryで判定する", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 500000 }];
  state.fixedCosts[key] = [{ id: "fixed-1", name: "HPB", categoryKey: "advertising", periodType: "ongoing" }];
  state.costMonthlyAmounts = { "fixed-1__2026-08": { amount: 30000 } };

  const checklist = getMonthClosingChecklist(state, store, month);

  const salesItem = checklist.items.find((item) => item.key === "sales");
  const adItem = checklist.items.find((item) => item.key === "advertising");
  const laborItem = checklist.items.find((item) => item.key === "labor");
  assert.equal(salesItem.entered, true);
  assert.equal(adItem.entered, true); // 費用名「HPB」でもcategoryKeyがadvertisingなら入力済み判定
  assert.equal(laborItem.entered, false);
  assert.ok(checklist.missingItems.some((item) => item.key === "labor"));
  assert.equal(checklist.isProvisionalProfit, true);
});

test("getMonthClosingChecklist: hiddenCategoriesに含めたカテゴリはitems/missingItemsから除外され、hiddenItemsに入る(売上は対象外にできない)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";

  const checklist = getMonthClosingChecklist(state, store, month, { hiddenCategories: ["labor", "sales"] });

  assert.equal(checklist.items.some((item) => item.key === "labor"), false);
  assert.equal(checklist.missingItems.some((item) => item.key === "labor"), false);
  assert.ok(checklist.hiddenItems.some((item) => item.key === "labor"));
  assert.ok(checklist.items.some((item) => item.key === "sales")); // "sales"はhiddenCategoriesに含めても除外されない
});

test("needsMonthReconfirmation: 未確定の月・確定日時が無い月はfalse", () => {
  const state = createInitialAppState();
  assert.equal(needsMonthReconfirmation(state, "横浜店", "2026-08"), false);

  state.monthClosingStatus = { "横浜店__2026-08": { closed: true, lockedAt: "" } };
  assert.equal(needsMonthReconfirmation(state, "横浜店", "2026-08"), false);
});

test("needsMonthReconfirmation: 確定後にfixedCosts項目のupdatedAtが確定日時より新しければtrue", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.monthClosingStatus = { [buildMonthKey(store, month)]: { closed: true, lockedAt: "2026-08-20T00:00:00.000Z" } };
  state.fixedCosts[key] = [{ id: "fixed-1", name: "家賃", categoryKey: "rent", periodType: "ongoing", updatedAt: "2026-08-25T00:00:00.000Z" }];

  assert.equal(needsMonthReconfirmation(state, store, month), true);
});

test("needsMonthReconfirmation: 確定後にデータが変更されていなければfalse", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.monthClosingStatus = { [buildMonthKey(store, month)]: { closed: true, lockedAt: "2026-08-20T00:00:00.000Z" } };
  state.fixedCosts[key] = [{ id: "fixed-1", name: "家賃", categoryKey: "rent", periodType: "ongoing", updatedAt: "2026-08-10T00:00:00.000Z" }];

  assert.equal(needsMonthReconfirmation(state, store, month), false);
});

test("needsMonthReconfirmation(継続費用の新仕様): 対象月に固有の上書き行が無い継続費用は基本値(fixed_costs.updatedAt)だけを見る——別の月の上書きを変更しても対象月の再確認判定には影響しない", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-09";
  const key = `${store}__2026-08`;
  // 9月を確定済みにする(9月自身には固有の上書き行が無く、基本値をそのまま使っている状態)。
  state.monthClosingStatus = { [buildMonthKey(store, month)]: { closed: true, lockedAt: "2026-09-20T00:00:00.000Z" } };
  state.fixedCosts[key] = [{ id: "fc-rent", name: "家賃", categoryKey: "rent", periodType: "ongoing", startMonth: "2026-08", baseAmount: 300000, updatedAt: "2026-08-01T00:00:00.000Z" }];
  // 8月に固有の上書き行があっても、キャリーフォワードをやめたため9月には一切影響しない。
  state.costMonthlyAmounts = { "fc-rent__2026-08": { amount: 250000, updatedAt: "2026-08-01T00:00:00.000Z" } };

  assert.equal(needsMonthReconfirmation(state, store, month), false);

  // 確定後に8月の上書きだけを変更しても、9月が実際に使っている金額(基本値)は変わっていない
  // ので再確認は不要のまま(要件1-4のキャリーフォワード廃止と整合)。
  state.costMonthlyAmounts["fc-rent__2026-08"] = { amount: 999999, updatedAt: "2026-09-25T00:00:00.000Z" };
  assert.equal(needsMonthReconfirmation(state, store, month), false);

  // 確定後に基本値自体(fixed_costs行)を変更すると、9月の実質的な金額が変わるため再確認が必要。
  state.fixedCosts[key][0] = { ...state.fixedCosts[key][0], baseAmount: 320000, updatedAt: "2026-09-26T00:00:00.000Z" };
  assert.equal(needsMonthReconfirmation(state, store, month), true);
});

test("getPreviousMonthAmountByNameAndCategory: 前月に同名・同カテゴリの単月項目があればその金額を返す", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  state.fixedCosts[`${store}__2026-07`] = [
    { id: "labor-jul", name: "人件費", categoryKey: "labor", periodType: "limited", startMonth: "2026-07", endMonth: "2026-07" },
  ];
  state.costMonthlyAmounts = { "labor-jul__2026-07": { amount: 320000 } };

  assert.equal(getPreviousMonthAmountByNameAndCategory(state, store, "人件費", "labor", "2026-08"), 320000);
  assert.equal(getPreviousMonthAmountByNameAndCategory(state, store, "人件費", "materials", "2026-08"), undefined);
  assert.equal(getPreviousMonthAmountByNameAndCategory(state, store, "存在しない費用", "labor", "2026-08"), undefined);
});

test("consumptionTaxReserveAmount/profitAfterConsumptionTaxReserve: 常に計算されるが、OFFなら引当率未設定=0円のまま", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 1000000 }];

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.consumptionTaxReserveAmount, 0);
  assert.equal(summary.profitAfterConsumptionTaxReserve, summary.operatingProfit);
});

test("consumptionTaxReserveAmount: ONの場合、税込対象売上×税率÷(100+税率)で税込売上に含まれる消費税相当額を概算する(不具合修正: 旧実装は誤って売上×税率÷100=税抜換算の税額を計算していた)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 1000000 }];
  state.taxSettings = { ...state.taxSettings, considerConsumptionTax: true, consumptionTaxReserveRate: 5 };

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.consumptionTaxReserveAmount, 47619); // round(1000000 * 5 / 105)
  assert.equal(summary.profitAfterConsumptionTaxReserve, summary.operatingProfit - 47619);
});

test("consumptionTaxReserveAmount: ユーザー指定の具体例(税込対象売上2,200,000円・税率10%→引当額200,000円)を再現する", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 2200000 }];
  state.taxSettings = { ...state.taxSettings, considerConsumptionTax: true, consumptionTaxReserveRate: 10 };

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.consumptionTaxReserveAmount, 200000);
});

test("consumptionTaxReserveAmount: 営業利益が赤字でも引当額を0円にせず、消費税考慮後利益はそのままマイナスで計算する(営業利益・粗利益を基準にした条件分岐は行わない)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  // 経費を売上より大きくして営業利益を赤字にする。
  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 2200000 }];
  state.fixedCosts[key] = [{ id: "rent-1", name: "家賃", categoryKey: "rent", periodType: "ongoing" }];
  state.costMonthlyAmounts = { [`rent-1__${month}`]: { amount: 2719604 } };
  state.taxSettings = { ...state.taxSettings, considerConsumptionTax: true, consumptionTaxReserveRate: 10 };

  const summary = calculateMonthSummary(state, store, month);

  assert.ok(summary.operatingProfit < 0, "operatingProfit should be negative for this test setup");
  assert.equal(summary.consumptionTaxReserveAmount, 200000);
  assert.equal(summary.profitAfterConsumptionTaxReserve, summary.operatingProfit - 200000);
});

test("consumptionTaxReserveAmount: ONだが税率が未保存(0)の場合は日本の標準税率10%をフォールバックにする(入力欄のプレースホルダーと計算を一致させ、「ONにしても¥0のまま」という不具合の再発を防ぐ)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.dailyResults[key] = [{ date: "2026-08-01", totalSales: 1100000 }];
  state.taxSettings = { ...state.taxSettings, considerConsumptionTax: true, consumptionTaxReserveRate: 0 };

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.consumptionTaxReserveAmount, 100000); // round(1100000 * 10 / 110)
});

test("customer target summary returns a safe zero value when no business days remain", () => {
  const summary = getCustomerTargetSummary({ customers: 80, targetCustomers: 100, businessDayCount: 10, completedDays: 10, remainingBusinessDays: 0, targetAverageCustomersPerDay: 10, selectedMonth: "2026-08" });

  assert.equal(summary.remainingCustomers, 20);
  assert.equal(summary.remainingCustomersPerDay, 0);
  assert.equal(summary.statusLabel, "営業日終了");
});

test("business day summary auto-calculates from month length and holiday count", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.businessDaySettings[key] = { holidayCount: 2, mode: "auto" };
  state.dailyResults[key] = [{ id: "e1", date: "2026-08-01", totalSales: 10000 }];
  state.dayClosingStates[key] = { "2026-08-01": true };

  const summary = getBusinessDaySummary(state, store, month);

  assert.equal(summary.businessDayCount, 29);
  assert.equal(summary.completedDays, 1);
  assert.equal(summary.remainingBusinessDays, 28);
});

test("retail ratio stays at zero when there is no sales data", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.dailyResults[key] = [];

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.retailRatio, 0);
});

test("app state round-trips through local storage for recovery after logout", () => {
  const state = createInitialAppState();
  state.currentCompanyId = "company-1";
  state.selectedStore = "本店";
  state.selectedMonth = "2026-08";
  state.dailyResults["本店__2026-08"] = [{ date: "2026-08-01", technicalSales: 100000, retailSales: 20000 }];

  writeAppState(state);
  const restored = readAppState();

  assert.equal(restored.currentCompanyId, "company-1");
  assert.equal(restored.selectedStore, "本店");
  assert.equal(restored.dailyResults["本店__2026-08"][0].technicalSales, 100000);
});

test("normalizeAppState converts auth-based currentUserId back to the matching profile id", () => {
  const normalized = normalizeAppState({
    currentUserId: "auth-user-1",
    users: [
      { id: "profile-1", email: "owner@example.com", authUserId: "auth-user-1" },
    ],
  });

  assert.equal(normalized.currentUserId, "profile-1");
  assert.equal(normalized.currentAuthUserId, "auth-user-1");
});

test("monthly summary deduplicates entries by store and date using the latest value", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  state.dailyResults[key] = [
    { id: "dup-1", date: "2026-08-01", totalSales: 680454, technicalSales: 500000, retailSales: 180454, customers: 10, newCustomers: 3, repeatCustomers: 7, updatedAt: "2026-08-01T00:00:00.000Z" },
    { id: "dup-2", date: "2026-08-01", totalSales: 700000, technicalSales: 520000, retailSales: 180000, customers: 11, newCustomers: 4, repeatCustomers: 7, updatedAt: "2026-08-01T01:00:00.000Z" },
    { id: "dup-3", date: "2026-08-02", totalSales: 100000, technicalSales: 60000, retailSales: 40000, customers: 5, newCustomers: 2, repeatCustomers: 3, updatedAt: "2026-08-02T00:00:00.000Z" },
  ];

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.sales, 800000);
  assert.equal(summary.customers, 16);
  assert.equal(summary.retailRatio, 27.5);
  assert.equal(summary.averageSales, 800000 / 2);
});

test("mergeRemoteAppState keeps another store's local data when the fetched snapshot doesn't include it", () => {
  const month = "2026-08";
  const honten = "本店";
  const yokohama = "フィーネ横浜";

  const local = createInitialAppState();
  local.dailyResults[`${honten}__${month}`] = [
    { id: "honten-1", date: "2026-08-01", totalSales: 50000, updatedAt: "2026-08-01T10:00:00.000Z" },
    { id: "honten-2", date: "2026-08-02", totalSales: 60000, updatedAt: "2026-08-02T10:00:00.000Z" },
  ];
  local.dayClosingStates[`${honten}__${month}`] = { "2026-08-01": true, "2026-08-02": true };
  local.dailyResults[`${yokohama}__${month}`] = [
    { id: "yoko-1", date: "2026-08-01", totalSales: 20100, updatedAt: "2026-08-01T09:00:00.000Z" },
  ];
  local.dayClosingStates[`${yokohama}__${month}`] = { "2026-08-01": true };

  // Simulates fetching フィーネ横浜's own snapshot row, saved *before* the 本店 edits above
  // happened, so its embedded payload has no knowledge of them yet.
  const remote = createInitialAppState();
  remote.dailyResults[`${yokohama}__${month}`] = [
    { id: "yoko-1", date: "2026-08-01", totalSales: 20100, updatedAt: "2026-08-01T09:00:00.000Z" },
  ];
  remote.dayClosingStates[`${yokohama}__${month}`] = { "2026-08-01": true };

  const merged = mergeRemoteAppState(local, remote);

  assert.equal(merged.dailyResults[`${honten}__${month}`].length, 2);
  assert.equal(merged.dayClosingStates[`${honten}__${month}`]["2026-08-01"], true);
  assert.equal(merged.dayClosingStates[`${honten}__${month}`]["2026-08-02"], true);
  assert.equal(merged.dailyResults[`${yokohama}__${month}`][0].totalSales, 20100);

  const summary = getBusinessDaySummary(merged, honten, month);
  assert.equal(summary.completedDays, 2);
});

test("mergeRemoteAppState lets a newer remote entry for the same date win over a stale local one", () => {
  const month = "2026-08";
  const store = "本店";
  const local = createInitialAppState();
  local.dailyResults[`${store}__${month}`] = [
    { id: "v1", date: "2026-08-01", totalSales: 10000, updatedAt: "2026-08-01T09:00:00.000Z" },
  ];

  const remote = createInitialAppState();
  remote.dailyResults[`${store}__${month}`] = [
    { id: "v2", date: "2026-08-01", totalSales: 55000, updatedAt: "2026-08-01T12:00:00.000Z" },
  ];

  const merged = mergeRemoteAppState(local, remote);
  assert.equal(merged.dailyResults[`${store}__${month}`].length, 1);
  assert.equal(merged.dailyResults[`${store}__${month}`][0].totalSales, 55000);
});

test("ai analysis explains underperformance without overclaiming", () => {
  const analysis = getAiAnalysis({
    targetAchievement: 80,
    customerAchievement: 70,
    customerTarget: 100,
    customers: 70,
    targetAverageSpend: 100000,
    averageSpend: 110000,
    operatingMargin: 20,
    targetOperatingMargin: 15,
    fixedCost: 100000,
    variableCost: 50000,
    equipmentInvestmentCost: 30000,
    taxExclusiveSales: 90000,
    taxAmount: 10000,
    adjustedOperatingProfit: 40000,
    remainingBusinessDays: 5,
    remainingSalesTarget: 200000,
    remainingCustomersTarget: 30,
  });

  assert.equal(analysis.summary.includes("客数目標"), true);
  assert.equal(analysis.priorities.some((item) => item.includes("客数")), true);
  assert.equal(analysis.notes.some((item) => item.includes("客数データ不足")), false);
});

test("business day progress: matches the full 本店 spec walkthrough end to end", () => {
  const store = "本店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  let state = createInitialAppState();

  // 1. 8/1を入力して保存のみ → 0/29日 (dayClosingStates untouched by a plain save)
  state.dailyResults[key] = [
    { id: "e1", date: "2026-08-01", totalSales: 30000, updatedAt: "2026-08-01T09:00:00.000Z" },
  ];
  let summary = getBusinessDaySummary(state, store, month);
  assert.equal(summary.completedDays, 0);

  // 2. 8/1を日締め → 1/29日
  state = {
    ...state,
    dayClosingStates: { [key]: { "2026-08-01": true } },
    dayClosingUpdatedAt: { [key]: { "2026-08-01": "2026-08-01T09:05:00.000Z" } },
  };
  summary = getBusinessDaySummary(state, store, month);
  assert.equal(summary.completedDays, 1);

  // 3. 8/5を入力して日締め(0円でも良い) → 2/29日 (日付が連続していなくてもよい)
  state = {
    ...state,
    dailyResults: { [key]: [...state.dailyResults[key], { id: "e2", date: "2026-08-05", totalSales: 0, updatedAt: "2026-08-05T09:00:00.000Z" }] },
    dayClosingStates: { [key]: { ...state.dayClosingStates[key], "2026-08-05": true } },
    dayClosingUpdatedAt: { [key]: { ...state.dayClosingUpdatedAt[key], "2026-08-05": "2026-08-05T09:05:00.000Z" } },
  };
  summary = getBusinessDaySummary(state, store, month);
  assert.equal(summary.completedDays, 2);

  // 4. 8/5を編集して再保存・再度日締め(トグルON→OFF→ONの往復)しても2/29日のまま
  state = {
    ...state,
    dailyResults: { [key]: state.dailyResults[key].map((entry) => (entry.date === "2026-08-05" ? { ...entry, totalSales: 15000, updatedAt: "2026-08-05T10:00:00.000Z" } : entry)) },
  };
  // re-close (idempotent: still true)
  state = {
    ...state,
    dayClosingStates: { [key]: { ...state.dayClosingStates[key], "2026-08-05": true } },
    dayClosingUpdatedAt: { [key]: { ...state.dayClosingUpdatedAt[key], "2026-08-05": "2026-08-05T10:05:00.000Z" } },
  };
  summary = getBusinessDaySummary(state, store, month);
  assert.equal(summary.completedDays, 2);

  // 5. ログアウトして再ログイン (Supabaseから同じ内容を再取得してマージ) → 2/29日のまま
  const remoteSnapshotPayload = JSON.parse(JSON.stringify(state));
  const freshDeviceState = createInitialAppState();
  const afterRelogin = mergeRemoteAppState(freshDeviceState, remoteSnapshotPayload);
  summary = getBusinessDaySummary(afterRelogin, store, month);
  assert.equal(summary.completedDays, 2);

  // 6. 別店舗に切り替えても本店の進捗と混ざらない
  const otherStore = "フィーネ横浜";
  const otherKey = `${otherStore}__${month}`;
  const withOtherStore = {
    ...afterRelogin,
    dailyResults: { ...afterRelogin.dailyResults, [otherKey]: [{ id: "y1", date: "2026-08-01", totalSales: 20100, updatedAt: "2026-08-01T09:00:00.000Z" }] },
    dayClosingStates: { ...afterRelogin.dayClosingStates, [otherKey]: { "2026-08-01": true } },
  };
  const hontenSummary = getBusinessDaySummary(withOtherStore, store, month);
  const otherSummary = getBusinessDaySummary(withOtherStore, otherStore, month);
  assert.equal(hontenSummary.completedDays, 2);
  assert.equal(otherSummary.completedDays, 1);
});

test("business day progress: un-closing a day removes it, and that removal survives a merge against a stale snapshot", () => {
  const store = "本店";
  const month = "2026-08";
  const key = `${store}__${month}`;

  // Local device just un-closed 8/5 a moment ago (has a fresh timestamp for it).
  const local = createInitialAppState();
  local.dailyResults[key] = [
    { id: "e1", date: "2026-08-01", totalSales: 30000, updatedAt: "2026-08-01T09:00:00.000Z" },
    { id: "e2", date: "2026-08-05", totalSales: 15000, updatedAt: "2026-08-05T09:00:00.000Z" },
  ];
  local.dayClosingStates[key] = { "2026-08-01": true, "2026-08-05": false };
  local.dayClosingUpdatedAt[key] = { "2026-08-01": "2026-08-01T09:05:00.000Z", "2026-08-05": "2026-08-05T12:00:00.000Z" };

  // A stale snapshot fetched from Supabase, saved *before* the un-close, still says 8/5 is closed.
  const remote = createInitialAppState();
  remote.dailyResults[key] = [
    { id: "e1", date: "2026-08-01", totalSales: 30000, updatedAt: "2026-08-01T09:00:00.000Z" },
    { id: "e2", date: "2026-08-05", totalSales: 15000, updatedAt: "2026-08-05T09:00:00.000Z" },
  ];
  remote.dayClosingStates[key] = { "2026-08-01": true, "2026-08-05": true };
  remote.dayClosingUpdatedAt[key] = { "2026-08-01": "2026-08-01T09:05:00.000Z", "2026-08-05": "2026-08-05T09:10:00.000Z" };

  const merged = mergeRemoteAppState(local, remote);
  const summary = getBusinessDaySummary(merged, store, month);

  assert.equal(merged.dayClosingStates[key]["2026-08-05"], false, "新しいタイムスタンプを持つローカルの解除が優先されること");
  assert.equal(summary.completedDays, 1, "解除した8/5はカウントされないこと");
});

test("business day progress: a closed day with no matching daily entry is not counted", () => {
  const store = "本店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  const state = createInitialAppState();
  state.dayClosingStates[key] = { "2026-08-09": true };

  const summary = getBusinessDaySummary(state, store, month);
  assert.equal(summary.completedDays, 0);
});

test("getSalesStatusComment: 売上は順調・客数はやや遅れ → 注意、①達成②未達③前向きな一言の順", () => {
  const comment = getSalesStatusComment({
    targetSales: 9000000,
    closedSales: 3400000, // pace目標(3,000,000)を許容幅(30万)超えて上回る = 売上は順調
    businessDayCount: 30,
    completedDays: 10,
    remainingBusinessDays: 20,
    targetCustomers: 100,
    customers: 88, // 88% = やや未達
  });

  assert.equal(comment.tier, "注意");
  assert.equal(comment.salesState, "ahead");
  assert.equal(comment.customerState, "slight");
  assert.equal(comment.lines.length, 2); // ①②を1文にまとめた行 + ③前向きな一言
  assert.match(comment.lines[0], /売上/);
  assert.match(comment.lines[0], /客数/);
  assert.match(comment.lines[0], /が、/); // 「Aが、B」の構文で達成→未達の順に言及
});

test("getSalesStatusComment: 客数は達成・売上はやや遅れ、客単価未達 → 客単価アップの一言で締める", () => {
  const comment = getSalesStatusComment({
    targetSales: 9000000,
    closedSales: 2600000, // pace目標(3,000,000)を許容幅超えてやや下回る
    businessDayCount: 30,
    completedDays: 10,
    remainingBusinessDays: 20,
    targetCustomers: 100,
    customers: 105,
    targetAverageSpend: 8000,
    averageSpend: 7500,
  });

  assert.equal(comment.tier, "注意");
  assert.equal(comment.salesState, "slight");
  assert.equal(comment.customerState, "achieving");
  assert.equal(comment.spendState, "behind");
  const closing = comment.lines[comment.lines.length - 1];
  assert.match(closing, /客単価/);
  assert.match(closing, /十分巻き返せます/);
});

test("getSalesStatusComment: 売上・客数ともに達成 → 順調、ひとまとめの好調コメント", () => {
  const comment = getSalesStatusComment({
    targetSales: 9000000,
    closedSales: 3400000,
    businessDayCount: 30,
    completedDays: 10,
    remainingBusinessDays: 20,
    targetCustomers: 100,
    customers: 110,
  });

  assert.equal(comment.tier, "順調");
  assert.equal(comment.salesState, "ahead");
  assert.equal(comment.customerState, "achieving");
  assert.match(comment.lines[0], /(順調|好調|上回る)/);
});

test("getSalesStatusComment: 売上・客数ともに大きく未達 → 要改善", () => {
  const comment = getSalesStatusComment({
    targetSales: 9000000,
    closedSales: 500000, // pace目標(3,000,000)を大きく下回る
    businessDayCount: 30,
    completedDays: 10,
    remainingBusinessDays: 20,
    targetCustomers: 100,
    customers: 40,
  });

  assert.equal(comment.tier, "要改善");
  assert.equal(comment.salesState, "large");
  assert.equal(comment.customerState, "large");
});

test("getSalesStatusComment: 客単価が目標を維持できている場合はその理由を締めの一言に織り込む", () => {
  const comment = getSalesStatusComment({
    targetSales: 9000000,
    closedSales: 3200000,
    businessDayCount: 30,
    completedDays: 10,
    remainingBusinessDays: 20,
    targetCustomers: 100,
    customers: 110,
    targetAverageSpend: 8000,
    averageSpend: 8500,
  });

  assert.equal(comment.spendState, "achieving");
  const closing = comment.lines[comment.lines.length - 1];
  assert.match(closing, /客単価/);
  assert.match(closing, /ため、/);
});

test("getSalesStatusComment: 売上・客数どちらの目標も未登録なら順調扱いで案内文を返す", () => {
  const comment = getSalesStatusComment({
    targetSales: 0,
    closedSales: 0,
    businessDayCount: 30,
    completedDays: 0,
    remainingBusinessDays: 30,
  });

  assert.equal(comment.salesState, null);
  assert.equal(comment.customerState, null);
  assert.match(comment.lines[0], /月間目標/);
  // 何のペースもわかっていない状態で「素晴らしいペースです」のような的外れな一言を
  // 続けないよう、案内文だけの1行になっているべき。
  assert.equal(comment.lines.length, 1);
});

test("getSalesStatusComment: 客数目標のみ登録されている場合は客数だけで判断する", () => {
  const comment = getSalesStatusComment({
    targetSales: 0,
    closedSales: 0,
    businessDayCount: 30,
    completedDays: 10,
    remainingBusinessDays: 20,
    targetCustomers: 100,
    customers: 40,
  });

  assert.equal(comment.salesState, null);
  assert.equal(comment.customerState, "large");
  assert.equal(comment.tier, "要改善");
  assert.match(comment.lines[0], /客数/);
});

test("getSalesStatusComment: 未締めの日次売上は計算に含めない(closedSalesのみ使用)", () => {
  // 未締めの日にどれだけ売上が入っていても comment の入力(closedSales)には反映されない
  // という前提を、AI側の集計関数が守っていることを確認する回帰テスト。
  const comment = getSalesStatusComment({
    targetSales: 1000000,
    closedSales: 400000, // 日締め済みの合計だけ
    businessDayCount: 20,
    completedDays: 8,
    remainingBusinessDays: 12,
  });

  assert.equal(comment.targetGap, 600000);
});

test("getSalesStatusComment: seedを変えると同じ状況でも言い回しが変わる(バリエーション確認)", () => {
  const baseInput = {
    targetSales: 9000000,
    closedSales: 2800000,
    businessDayCount: 30,
    completedDays: 10,
    remainingBusinessDays: 20,
    targetCustomers: 100,
    customers: 105,
  };
  const seeds = Array.from({ length: 12 }, (_, index) => `store-2026-08-0${index}`);
  const distinctMessages = new Set(seeds.map((seed) => getSalesStatusComment({ ...baseInput, seed }).message));
  assert.ok(distinctMessages.size > 1, "12種類のシードから2種類以上の異なる文面が生成されるはず");
});

test("formatMonthLabel formats YYYY-MM as YYYY年M月 for display, storage stays YYYY-MM", () => {
  assert.equal(formatMonthLabel("2026-08"), "2026年8月");
  assert.equal(formatMonthLabel("2026-01"), "2026年1月");
  assert.equal(formatMonthLabel(""), "");
  assert.equal(formatMonthLabel(undefined), "");
});

test("formatDailyDateLabel: 「M月D日（曜）」形式で対象日を明確に表示する", () => {
  assert.equal(formatDailyDateLabel("2026-08-24"), "8月24日（月）");
  assert.equal(formatDailyDateLabel("2026-01-01"), "1月1日（木）");
  assert.equal(formatDailyDateLabel(""), "");
  assert.equal(formatDailyDateLabel(undefined), "");
  assert.equal(formatDailyDateLabel("invalid-date"), "");
});

const detailedFieldSettings = { mode: "detailed", fields: { technicalSales: true, retailSales: true, customers: true, newCustomers: true, repeatCustomers: true, memo: true } };
const simpleFieldSettings = { mode: "simple", fields: { technicalSales: false, retailSales: false, customers: false, newCustomers: false, repeatCustomers: false, memo: false } };

test("buildDailyEntryPayload: 詳細入力では画面側(updateDailyField)が同期させたtotalSales/customersをそのまま保存する", () => {
  // totalSales/customers の技術売上+店販売上・新規+再来からの自動計算は画面側(updateDailyField)
  // の責務で、buildDailyEntryPayload はその結果である form.totalSales/form.customers を
  // そのまま信頼する。ここでは updateDailyField が同期済みのform を渡して確認する。
  const entry = buildDailyEntryPayload({
    form: { date: "2026-08-01", technicalSales: "10000", retailSales: "100", totalSales: "10100", customers: "5", newCustomers: "2", repeatCustomers: "3", memo: "混雑" },
    existingEntry: null,
    fieldSettings: detailedFieldSettings,
    entryId: "e1",
  });

  assert.equal(entry.totalSales, 10100);
  assert.equal(entry.customers, 5);
  assert.equal(entry.memo, "混雑");
});

test("buildDailyEntryPayload: かんたん入力では総売上を直接入力値として保存する", () => {
  const entry = buildDailyEntryPayload({
    form: { date: "2026-08-01", totalSales: "50000" },
    existingEntry: null,
    fieldSettings: simpleFieldSettings,
    entryId: "e1",
  });

  assert.equal(entry.totalSales, 50000);
  assert.equal(entry.technicalSales, 0);
  assert.equal(entry.retailSales, 0);
  assert.equal(entry.customers, 0);
});

test("buildDailyEntryPayload: 非表示項目は既存データを保持し、0や空欄で上書きしない", () => {
  const existingEntry = { technicalSales: 30000, retailSales: 5000, customers: 12, newCustomers: 4, repeatCustomers: 8, memo: "常連多め" };
  const entry = buildDailyEntryPayload({
    // form の技術売上等は空欄(=非表示フィールドをユーザーが触っていない状態を再現)
    form: { date: "2026-08-01", totalSales: "35000", technicalSales: "", retailSales: "", customers: "", memo: "" },
    existingEntry,
    fieldSettings: simpleFieldSettings,
    entryId: "e1",
  });

  assert.equal(entry.totalSales, 35000, "総売上は直接入力値を使う");
  assert.equal(entry.technicalSales, 30000, "非表示の技術売上は既存値を保持");
  assert.equal(entry.retailSales, 5000, "非表示の店販売上は既存値を保持");
  assert.equal(entry.customers, 12, "非表示の客数は既存値を保持");
  assert.equal(entry.newCustomers, 4);
  assert.equal(entry.repeatCustomers, 8);
  assert.equal(entry.memo, "常連多め", "非表示のメモは既存値を保持");
});

test("buildDailyEntryPayload: 技術売上・店販売上を再表示しても過去の総売上を勝手に分割しない", () => {
  // 過去に「かんたん入力」で総売上だけ保存していた実績。技術売上・店販売上を再表示した直後、
  // 画面はエントリを読み込んだ時点の値(totalSales=42000, technicalSales=0, retailSales=0)を
  // そのまま表示する(updateDailyFieldはtechnicalSales/retailSalesを実際に編集した時だけ
  // totalSalesを再計算するため、まだ何も編集していない状態ではtotalSalesは42000のまま)。
  const existingEntry = { totalSales: 42000, technicalSales: 0, retailSales: 0 };
  const entry = buildDailyEntryPayload({
    form: { date: "2026-08-01", technicalSales: "", retailSales: "", totalSales: "42000" },
    existingEntry,
    fieldSettings: detailedFieldSettings,
    entryId: "e1",
  });

  assert.equal(entry.technicalSales, 0);
  assert.equal(entry.retailSales, 0);
  assert.equal(entry.totalSales, 42000, "画面側で技術売上・店販売上を編集していない限り、過去の総売上は保たれる");
});

test("buildDailyEntryPayload: 新規客数・再来客数を表示する場合は画面側が同期させたcustomersをそのまま保存する", () => {
  const entry = buildDailyEntryPayload({
    // updateDailyField が新規客数・再来客数の入力から customers=10 に同期済みという想定
    form: { date: "2026-08-01", newCustomers: "3", repeatCustomers: "7", customers: "10" },
    existingEntry: null,
    fieldSettings: detailedFieldSettings,
    entryId: "e1",
  });

  assert.equal(entry.customers, 10);
});

// その他売上は以前は会社単位のpreferences.showOtherSalesという別の仕組みで、総売上にも
// 一切加算されない「表示専用」の値だった。今回、他の日次入力項目と同じ店舗ごとのON/OFFに
// 統一し、ONの場合は正式に総売上へ加算されるようにした。
test("buildDailyEntryPayload: その他売上がONの場合、画面側(updateDailyField)が技術売上+店販売上+その他売上に同期させたtotalSalesをそのまま保存する", () => {
  const otherSalesFieldSettings = { mode: "detailed", fields: { technicalSales: true, retailSales: true, otherSales: true } };
  const entry = buildDailyEntryPayload({
    // updateDailyFieldが 800000+100000+100000=1000000 に同期済みという想定
    form: { date: "2026-08-01", technicalSales: "800000", retailSales: "100000", otherSales: "100000", totalSales: "1000000" },
    existingEntry: null,
    fieldSettings: otherSalesFieldSettings,
    entryId: "e1",
  });

  assert.equal(entry.otherSales, 100000);
  assert.equal(entry.totalSales, 1000000);
});

test("buildDailyEntryPayload: その他売上がOFF(非表示)の場合は既存のその他売上データを保持し、0で上書きしない", () => {
  const existingEntry = { technicalSales: 800000, retailSales: 100000, otherSales: 50000, totalSales: 950000 };
  const withoutOtherSalesFieldSettings = { mode: "detailed", fields: { technicalSales: true, retailSales: true, otherSales: false } };
  const entry = buildDailyEntryPayload({
    form: { date: "2026-08-01", technicalSales: "800000", retailSales: "100000", otherSales: "", totalSales: "900000" },
    existingEntry,
    fieldSettings: withoutOtherSalesFieldSettings,
    entryId: "e1",
  });

  assert.equal(entry.otherSales, 50000, "その他売上が非表示の間は既存値を保持する");
});

test("buildDailyEntryPayload: 来店客数のみ表示(新規・再来は非表示)の設定でも保存できる", () => {
  const fieldSettings = { mode: "custom", fields: { ...detailedFieldSettings.fields, newCustomers: false, repeatCustomers: false } };
  const entry = buildDailyEntryPayload({
    form: { date: "2026-08-01", customers: "8" },
    existingEntry: { newCustomers: 2, repeatCustomers: 6 },
    fieldSettings,
    entryId: "e1",
  });

  assert.equal(entry.customers, 8, "来店客数は直接入力値を使う");
  assert.equal(entry.newCustomers, 2, "非表示の新規客数は既存値を保持");
  assert.equal(entry.repeatCustomers, 6, "非表示の再来客数は既存値を保持");
});

test("buildDailyEntryPayload: 来店客数そのものを非表示にした場合は客数関連を一切上書きしない", () => {
  const fieldSettings = { mode: "custom", fields: { ...detailedFieldSettings.fields, customers: false, newCustomers: false, repeatCustomers: false } };
  const entry = buildDailyEntryPayload({
    form: { date: "2026-08-01", customers: "999", newCustomers: "999", repeatCustomers: "999" },
    existingEntry: { customers: 15, newCustomers: 6, repeatCustomers: 9 },
    fieldSettings,
    entryId: "e1",
  });

  assert.equal(entry.customers, 15);
  assert.equal(entry.newCustomers, 6);
  assert.equal(entry.repeatCustomers, 9);
});

test("dailySalesRowToEntry maps daily_sales columns to the app's entry shape", () => {
  const entry = dailySalesRowToEntry({
    id: "row-1",
    business_date: "2026-08-05",
    sales_amount: "10100",
    technical_sales_amount: "10000",
    retail_sales_amount: "100",
    other_sales_amount: "0",
    customer_count: "5",
    new_customer_count: "2",
    repeat_customer_count: "3",
    memo: "混雑",
    is_day_closed: true,
    updated_at: "2026-08-05T10:00:00.000Z",
  });

  assert.equal(entry.date, "2026-08-05");
  assert.equal(entry.totalSales, 10100);
  assert.equal(entry.customers, 5);
  assert.equal(entry.isDayClosed, true);
  assert.equal(entry.memo, "混雑");
});

test("buildDailyStateFromRows rebuilds dailyResults/dayClosingStates for multiple stores from daily_sales rows, keyed by store_id", () => {
  const rows = [
    { store_id: "store-honten", business_date: "2026-08-01", sales_amount: 50000, is_day_closed: true, closed_at: "2026-08-01T10:00:00.000Z" },
    { store_id: "store-honten", business_date: "2026-08-05", sales_amount: 42000, is_day_closed: false },
    { store_id: "store-yoko", business_date: "2026-08-01", sales_amount: 20100, is_day_closed: true, closed_at: "2026-08-01T09:00:00.000Z" },
  ];

  const { dailyResults, dayClosingStates, dayClosingUpdatedAt } = buildDailyStateFromRows(rows);

  assert.equal(dailyResults["store-honten__2026-08"].length, 2);
  assert.equal(dailyResults["store-yoko__2026-08"].length, 1);
  assert.equal(dayClosingStates["store-honten__2026-08"]["2026-08-01"], true);
  assert.equal(dayClosingStates["store-honten__2026-08"]["2026-08-05"], false, "未締めの日は明示的にfalseになる(重複カウント防止)");
  assert.equal(dayClosingStates["store-yoko__2026-08"]["2026-08-01"], true);
  assert.equal(dayClosingUpdatedAt["store-honten__2026-08"]["2026-08-01"], "2026-08-01T10:00:00.000Z");

  const summary = getBusinessDaySummary({ dailyResults, dayClosingStates, businessDaySettings: {} }, "store-honten", "2026-08");
  assert.equal(summary.completedDays, 1, "daily_salesから再構築した状態でも日締め済み日数は1件のみ");
});

test("buildDailyStateFromRows skips rows with no store_id (no crash, no orphaned key)", () => {
  const { dailyResults } = buildDailyStateFromRows([{ business_date: "2026-08-01", sales_amount: 1000 }]);
  assert.deepEqual(dailyResults, {});
});

test("buildMonthClosingStateFromRows rebuilds monthClosingStatus per store from monthly_closings rows, keyed by store_id", () => {
  const rows = [
    { store_id: "store-honten", year_month: "2026-08", is_closed: true, closed_at: "2026-09-01T00:00:00.000Z" },
    { store_id: "store-yoko", year_month: "2026-08", is_closed: false, closed_at: null },
  ];

  const status = buildMonthClosingStateFromRows(rows);

  assert.equal(status["store-honten__2026-08"].closed, true);
  assert.equal(status["store-honten__2026-08"].lockedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(status["store-yoko__2026-08"].closed, false);
});

test("buildFixedCostsStateFromRows rebuilds fixedCosts per store from fixed_costs rows, keyed by store_id and the item's original entry month", () => {
  const rows = [
    { id: "fc-1", store_id: "store-honten", entry_month: "2026-06", name: "家賃", category: "家賃", memo: "", period_type: "ongoing", start_month: "", end_month: "" },
    // fc-2 has no period_type (a row saved before that column existed) — buildFixedCostsStateFromRows
    // must fall back to the old implicit rule (non-empty end_month = 限定) to stay compatible.
    { id: "fc-2", store_id: "store-honten", entry_month: "2026-08", name: "臨時費用", category: "その他", memo: "", start_month: "2026-08", end_month: "2026-08" },
  ];

  const { fixedCosts } = buildFixedCostsStateFromRows(rows);

  assert.deepEqual(fixedCosts["store-honten__2026-06"], [{ id: "fc-1", name: "家賃", category: "家賃", categoryKey: "uncategorized", memo: "", periodType: "ongoing", startMonth: "", endMonth: "", baseAmount: 0, sortOrder: 0, updatedAt: "" }]);
  assert.deepEqual(fixedCosts["store-honten__2026-08"], [{ id: "fc-2", name: "臨時費用", category: "その他", categoryKey: "uncategorized", memo: "", periodType: "limited", startMonth: "2026-08", endMonth: "2026-08", baseAmount: 0, sortOrder: 0, updatedAt: "" }]);
});

test("buildFixedCostsStateFromRows: a continuing (ongoing) item entered in an earlier month is still visible via getFixedCostsForStoreMonth in a later month it was never directly saved under, AND when looking further back before it was registered (対象月統一修正: 継続費用は登録月より過去の対象月でも項目自体を表示する)", () => {
  const rows = [
    { id: "fc-rent", store_id: "store-honten", entry_month: "2026-06", name: "家賃", category: "家賃", memo: "", period_type: "ongoing", start_month: "", end_month: "" },
  ];
  const { fixedCosts } = buildFixedCostsStateFromRows(rows);
  const state = { ...createInitialAppState(), fixedCosts };

  // A fresh session that only ever fetched this rebuilt state (as hydrateFromSupabase does)
  // must still see the June-filed rent cost when looking at August — this is exactly the
  // cross-device/cross-session scenario a snapshot-only fetch (windowed to one month) would miss.
  const augustItems = getFixedCostsForStoreMonth(state, "store-honten", "2026-08");
  assert.equal(augustItems.length, 1);
  assert.equal(augustItems[0].id, "fc-rent");

  // 登録月(2026-06)より前の対象月(2026-05)へ遡っても、継続費用は項目自体が消えない
  // (不具合修正前はここが0件だった — 過去月へ遡ると継続費用が表示されなくなる不具合)。
  // 金額は基本値(baseAmount)から来る——この行にはbase_amountが無い(未設定=0)ので0円。
  const mayItems = getFixedCostsForStoreMonth(state, "store-honten", "2026-05");
  assert.equal(mayItems.length, 1);
  assert.equal(mayItems[0].id, "fc-rent");
  assert.equal(getCostMonthlyAmount(state, "fc-rent", "2026-05"), 0);
});

test("getFixedCostsForStoreMonth: a single-month limited item (start_month === end_month) never carries into later months", () => {
  const rows = [
    { id: "fc-onetime", store_id: "store-honten", entry_month: "2026-06", name: "修繕費", category: "その他", memo: "", period_type: "limited", start_month: "2026-06", end_month: "2026-06" },
  ];
  const { fixedCosts } = buildFixedCostsStateFromRows(rows);
  const state = { ...createInitialAppState(), fixedCosts };

  assert.equal(getFixedCostsForStoreMonth(state, "store-honten", "2026-06").length, 1);
  assert.equal(getFixedCostsForStoreMonth(state, "store-honten", "2026-07").length, 0);
});

test("getFixedCostsForStoreMonth: a limited period item (start_month < end_month) reflects every month in range, inclusive, and stops the month after", () => {
  const rows = [
    { id: "fc-period", store_id: "store-honten", entry_month: "2026-08", name: "求人広告", category: "求人費", memo: "", period_type: "limited", start_month: "2026-08", end_month: "2026-10" },
  ];
  const { fixedCosts } = buildFixedCostsStateFromRows(rows);
  const state = { ...createInitialAppState(), fixedCosts };

  assert.equal(getFixedCostsForStoreMonth(state, "store-honten", "2026-07").length, 0);
  assert.equal(getFixedCostsForStoreMonth(state, "store-honten", "2026-08").length, 1);
  assert.equal(getFixedCostsForStoreMonth(state, "store-honten", "2026-09").length, 1);
  assert.equal(getFixedCostsForStoreMonth(state, "store-honten", "2026-10").length, 1);
  assert.equal(getFixedCostsForStoreMonth(state, "store-honten", "2026-11").length, 0);
});

test("getFixedCostsForStoreMonth: a row with no explicit start_month falls back to entry_month as its start (entry_month is NOT NULL, so this is always available) and, with no end_month or period_type either, is treated as ongoing (visible in every month, before and after)", () => {
  const rows = [
    { id: "fc-legacy", store_id: "store-honten", entry_month: "2026-06", name: "旧データ", category: "その他", memo: "", start_month: "", end_month: "" },
  ];
  const { fixedCosts } = buildFixedCostsStateFromRows(rows);
  const state = { ...createInitialAppState(), fixedCosts };

  assert.equal(getFixedCostsForStoreMonth(state, "store-honten", "2026-06").length, 1);
  assert.equal(getFixedCostsForStoreMonth(state, "store-honten", "2026-07").length, 1);
  assert.equal(getFixedCostsForStoreMonth(state, "store-honten", "2026-05").length, 1);
});

test("固定費・継続費用の再設計(要件1-4): 基本値は全月に自動反映され、対象月だけの上書きは他の月に一切影響しない(キャリーフォワード廃止)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const key = `${store}__2026-08`;
  // 家賃 基本値400,000円・継続設定ON(ユーザー指定の完了条件の例そのもの)。
  state.fixedCosts = {
    [key]: [{ id: "fc-rent", name: "家賃", categoryKey: "rent", periodType: "ongoing", startMonth: "2026-08", endMonth: "", baseAmount: 400000 }],
  };
  state.costMonthlyAmounts = {};

  // 上書きが無い月はすべて基本値(登録月より過去・未来を問わず)。
  ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].forEach((month) => {
    const items = getFixedCostsForStoreMonth(state, store, month);
    assert.equal(items.length, 1, `${month} should still show the item`);
    assert.equal(getCostMonthlyAmount(state, "fc-rent", month), 400000, `${month} should use the base amount`);
    assert.equal(calculateMonthSummary(state, store, month).fixedCost, 400000);
  });

  // 9月だけ300,000円へ変更して保存(cost_monthly_amountsへの対象月だけの上書き、
  // submitFixedCostInner/persistCostMonthlyAmountが行うのと同じ形)。
  state.costMonthlyAmounts["fc-rent__2026-09"] = { amount: 300000 };

  // 9月は上書き値。
  assert.equal(getCostMonthlyAmount(state, "fc-rent", "2026-09"), 300000);
  assert.equal(calculateMonthSummary(state, store, "2026-09").fixedCost, 300000);
  // 8月(9月より前)・10月(9月より後)とも、9月の上書きの影響を一切受けず基本値のまま
  // (要件1-4の核心: キャリーフォワードしない、翌月以降は自動的に基本値へ戻る)。
  assert.equal(getCostMonthlyAmount(state, "fc-rent", "2026-08"), 400000);
  assert.equal(getCostMonthlyAmount(state, "fc-rent", "2026-10"), 400000);
  assert.equal(calculateMonthSummary(state, store, "2026-08").fixedCost, 400000);
  assert.equal(calculateMonthSummary(state, store, "2026-10").fixedCost, 400000);
  // 基本値そのもの(fixed_costs行)は一切変更されていない(要件1)。
  assert.equal(state.fixedCosts[key][0].baseAmount, 400000);

  // 二重計上されない — この項目はfixedCosts配列に1件しか含まれず、月ごとの金額もこの1件から
  // しか解決されない(要件5・13)。
  const septSummary = calculateMonthSummary(state, store, "2026-09");
  assert.equal(septSummary.fixedCosts.length, 1);
});

test("固定費・継続費用の再設計: 単月・期間限定費用(periodType:'limited')は既存のキャリーフォワード仕様のまま維持する(要件10)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const key = `${store}__2026-08`;
  state.fixedCosts = {
    [key]: [{ id: "fc-campaign", name: "求人広告", categoryKey: "advertising", periodType: "limited", startMonth: "2026-08", endMonth: "2026-10" }],
  };
  state.costMonthlyAmounts = { "fc-campaign__2026-08": { amount: 50000 } };

  // 期間限定は従来通り、対象月に固有の行が無ければ以前の最新の行を引き継ぐ。
  assert.equal(getCostMonthlyAmount(state, "fc-campaign", "2026-09"), 50000);
  assert.equal(getCostMonthlyAmount(state, "fc-campaign", "2026-10"), 50000);

  state.costMonthlyAmounts["fc-campaign__2026-09"] = { amount: 60000 };
  assert.equal(getCostMonthlyAmount(state, "fc-campaign", "2026-09"), 60000);
  assert.equal(getCostMonthlyAmount(state, "fc-campaign", "2026-10"), 60000); // 引き継ぎ継続
  assert.equal(getCostMonthlyAmount(state, "fc-campaign", "2026-08"), 50000); // 過去へは遡らない
});

test("固定費・継続費用の再設計(要件5・9): getFixedCostsForStoreMonthはsort_order昇順で返し、金額(costMonthlyAmounts)だけを変更しても並び順は変わらない", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const key = `${store}__2026-08`;
  // わざと逆順(sort_orderが大きい順)でfixedCostsに積んでも、返り値はsort_order昇順になる
  // ことを確認する(取得順=物理行順に依存しない)。
  state.fixedCosts = {
    [key]: [
      { id: "fc-c", name: "広告費", categoryKey: "advertising", periodType: "ongoing", baseAmount: 30000, sortOrder: 2 },
      { id: "fc-a", name: "家賃", categoryKey: "rent", periodType: "ongoing", baseAmount: 400000, sortOrder: 0 },
      { id: "fc-b", name: "水道光熱費", categoryKey: "utilities", periodType: "ongoing", baseAmount: 50000, sortOrder: 1 },
    ],
  };
  state.costMonthlyAmounts = {};

  assert.deepEqual(getFixedCostsForStoreMonth(state, store, "2026-08").map((item) => item.id), ["fc-a", "fc-b", "fc-c"]);

  // 家賃(先頭)の金額だけを対象月で上書きしても、並び順(sortOrder)にもfixedCosts配列内の
  // 他の項目にも一切影響しない——金額変更・並び替え・項目編集は完全に独立した処理であるべき
  // (要件9、「金額を変更した項目が一覧の一番下へ移動する」不具合の再発防止)。
  state.costMonthlyAmounts["fc-a__2026-08"] = { amount: 350000 };
  assert.deepEqual(getFixedCostsForStoreMonth(state, store, "2026-08").map((item) => item.id), ["fc-a", "fc-b", "fc-c"]);
  assert.equal(getCostMonthlyAmount(state, "fc-a", "2026-08"), 350000);
  // 基本値(fixed_costs行)自体も変わっていない。
  assert.equal(state.fixedCosts[key].find((item) => item.id === "fc-a").baseAmount, 400000);
});

test("費用入力「継続」の金額引き継ぎ: 期間限定費用も範囲内では金額を引き継ぐが、範囲外(開始月より前・終了月より後)には一切表示・反映しない", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const key = `${store}__2026-09`;
  // 2026年9月〜11月の期間限定「広告キャンペーン」、9月に¥50,000で登録。
  state.fixedCosts = {
    [key]: [{ id: "fc-ad", name: "広告キャンペーン", categoryKey: "advertising", periodType: "limited", startMonth: "2026-09", endMonth: "2026-11" }],
  };
  state.costMonthlyAmounts = { "fc-ad__2026-09": { amount: 50000 } };

  // 範囲内(9〜11月)は明示保存が無い月(10月・11月)でも同じ金額を引き継いで表示・反映する。
  ["2026-09", "2026-10", "2026-11"].forEach((month) => {
    const items = getFixedCostsForStoreMonth(state, store, month);
    assert.equal(items.length, 1, `${month} should show the item`);
    assert.equal(getCostMonthlyAmount(state, "fc-ad", month), 50000);
    assert.equal(calculateMonthSummary(state, store, month).adCost, 50000);
  });

  // 範囲外(8月・12月)は項目自体が表示されず、損益表にも一切反映しない(要件7)。
  assert.equal(getFixedCostsForStoreMonth(state, store, "2026-08").length, 0);
  assert.equal(getFixedCostsForStoreMonth(state, store, "2026-12").length, 0);
  assert.equal(calculateMonthSummary(state, store, "2026-08").adCost, 0);
  assert.equal(calculateMonthSummary(state, store, "2026-12").adCost, 0);
});

test("費用入力「継続」の金額引き継ぎ: 単月費用はその月にしか表示・反映されない(引き継ぎの影響を受けない)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const key = `${store}__2026-08`;
  state.fixedCosts = {
    [key]: [{ id: "fc-repair", name: "設備修理", categoryKey: "other", periodType: "limited", startMonth: "2026-08", endMonth: "2026-08" }],
  };
  state.costMonthlyAmounts = { "fc-repair__2026-08": { amount: 100000 } };

  assert.equal(getFixedCostsForStoreMonth(state, store, "2026-08").length, 1);
  assert.equal(calculateMonthSummary(state, store, "2026-08").fixedCost, 100000);
  // 7月・9月には表示・反映されない(要件6)。
  assert.equal(getFixedCostsForStoreMonth(state, store, "2026-07").length, 0);
  assert.equal(getFixedCostsForStoreMonth(state, store, "2026-09").length, 0);
  assert.equal(calculateMonthSummary(state, store, "2026-07").fixedCost, 0);
  assert.equal(calculateMonthSummary(state, store, "2026-09").fixedCost, 0);
});

test("固定費・継続費用の再設計: 店舗が異なれば同名の継続費用でも基本値は混ざらない(company_id/store_id分離の維持・要件9)", () => {
  const state = createInitialAppState();
  state.fixedCosts = {
    "store-a__2026-08": [{ id: "fc-rent-a", name: "家賃", categoryKey: "rent", periodType: "ongoing", startMonth: "2026-08", endMonth: "", baseAmount: 300000 }],
    "store-b__2026-08": [{ id: "fc-rent-b", name: "家賃", categoryKey: "rent", periodType: "ongoing", startMonth: "2026-08", endMonth: "", baseAmount: 500000 }],
  };
  state.costMonthlyAmounts = {};

  // 9月(明示的な上書きなし)でも、店舗ごとに別々のcostItemIdの基本値が使われるため混ざらない。
  assert.equal(calculateMonthSummary(state, "store-a", "2026-09").fixedCost, 300000);
  assert.equal(calculateMonthSummary(state, "store-b", "2026-09").fixedCost, 500000);

  // 店舗Aの9月だけ上書きしても、店舗Bには一切影響しない。
  state.costMonthlyAmounts["fc-rent-a__2026-09"] = { amount: 350000 };
  assert.equal(calculateMonthSummary(state, "store-a", "2026-09").fixedCost, 350000);
  assert.equal(calculateMonthSummary(state, "store-b", "2026-09").fixedCost, 500000);
});

test("buildCostMonthlyAmountsStateFromRows builds a costItemId__targetMonth -> amount lookup from cost_monthly_amounts rows", () => {
  const rows = [
    { id: "cma-1", cost_item_id: "fc-rent", target_month: "2026-08", amount: 150000, updated_at: "2026-08-01T00:00:00.000Z" },
    { id: "cma-2", cost_item_id: "fc-rent", target_month: "2026-09", amount: 160000, updated_at: "2026-09-01T00:00:00.000Z" },
  ];

  const { costMonthlyAmounts } = buildCostMonthlyAmountsStateFromRows(rows);

  assert.equal(getCostMonthlyAmount({ costMonthlyAmounts }, "fc-rent", "2026-08"), 150000);
  assert.equal(getCostMonthlyAmount({ costMonthlyAmounts }, "fc-rent", "2026-09"), 160000);
  // A month with no row of its own carries forward the most recent saved amount at or before it
  // (費用入力「継続」の金額引き継ぎ仕様) — 2026-10's own row doesn't exist, so it inherits
  // 2026-09's 160000, not 2026-08's 150000 (the *latest* applicable row wins).
  assert.equal(getCostMonthlyAmount({ costMonthlyAmounts }, "fc-rent", "2026-10"), 160000);
  // A month before any row exists at all falls back to the earliest recorded amount (2026-08's
  // 150000) rather than showing 未入力 — a continuing cost is assumed to already have existed
  // before the month it happened to first get entered into the app (不具合修正).
  assert.equal(getCostMonthlyAmount({ costMonthlyAmounts }, "fc-rent", "2026-07"), 150000);
  // A cost item with no rows saved at all (different id) is still genuinely undefined.
  assert.equal(getCostMonthlyAmount({ costMonthlyAmounts }, "fc-nonexistent", "2026-07"), undefined);
});

test("getPreviousMonthCostAmount reads the prior month's effective amount for the copy button, falling back to the earliest recorded amount if the item didn't exist yet that far back, and is undefined only when nothing was ever saved for it at all", () => {
  const rows = [{ id: "cma-1", cost_item_id: "fc-rent", target_month: "2026-08", amount: 150000 }];
  const { costMonthlyAmounts } = buildCostMonthlyAmountsStateFromRows(rows);
  const state = { costMonthlyAmounts };

  assert.equal(getPreviousMonthCostAmount(state, "fc-rent", "2026-09"), 150000);
  // 2026-08の1つ前(2026-07)は2026-08より前で行が無いが、2026-08の金額を暫定的に引き継ぐ
  // (不具合修正 — 継続費用は登録月より前でも「未入力」にしない)。
  assert.equal(getPreviousMonthCostAmount(state, "fc-rent", "2026-08"), 150000);
  // その項目自体が1件も保存されたことが無ければ、依然としてundefined。
  assert.equal(getPreviousMonthCostAmount(state, "fc-nonexistent", "2026-08"), undefined);
});

test("calculateMonthSummary: an ongoing cost item with no cost_monthly_amounts row for the selected month automatically uses its base amount (固定費・継続費用の再設計・要件1・5)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-09";
  const key = `${store}__2026-08`;

  // Registered in August as ongoing (継続) with a base amount — still eligible in September (see
  // getFixedCostsForStoreMonth), and nobody has entered/overridden a September amount, so the
  // base amount is used automatically without needing a "保存" click in September.
  state.fixedCosts = {
    [key]: [{ id: "fc-rent", name: "家賃", categoryKey: "rent", periodType: "ongoing", startMonth: "2026-08", endMonth: "", baseAmount: 150000 }],
  };
  state.costMonthlyAmounts = {};

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.fixedCost, 150000);
  assert.equal(summary.fixedCosts[0].amount, 150000);
});

test("buildVariableCostsStateFromRows: direct month lookup, no carry-forward to a later month", () => {
  const rows = [
    { id: "vc-1", store_id: "store-honten", target_month: "2026-08", name: "広告費", amount: 40000, category: "広告費", memo: "", incurred_date: "", type: "regular" },
  ];
  const { variableCosts } = buildVariableCostsStateFromRows(rows);
  const state = { ...createInitialAppState(), variableCosts };

  assert.equal(getVariableCostsForStoreMonth(state, "store-honten", "2026-08").length, 1);
  assert.equal(getVariableCostsForStoreMonth(state, "store-honten", "2026-09").length, 0);
});

test("buildMonthlyClosingItemsStateFromRows rebuilds monthClosing per store/month from monthly_closing_items rows, keyed by store_id", () => {
  const rows = [
    { id: "mci-1", store_id: "store-honten", target_month: "2026-08", name: "人件費", amount: 300000, category: "人件費" },
  ];
  const { monthClosing } = buildMonthlyClosingItemsStateFromRows(rows);
  assert.deepEqual(monthClosing["store-honten__2026-08"], [{ id: "mci-1", name: "人件費", amount: 300000, category: "人件費", categoryKey: "uncategorized", updatedAt: "" }]);
});

test("buildCompanySettingsFromRow returns null when no row exists yet (not-registered, not a default object)", () => {
  assert.equal(buildCompanySettingsFromRow(null), null);
});

test("buildCompanySettingsFromRow maps a company_settings row to settings/taxSettings/showOtherSales", () => {
  const row = {
    business_type: "nail", currency: "USD", fiscal_year_start_month: "4", sales_display_mode: "exclusive",
    retail_sales_label: "物販売上", closing_day: "25日", edit_deadline_days: 3, allow_staff_past_edit: true,
    visible_sales_fields: ["technicalSales"], active_kpis: ["sales"], show_other_sales: true,
    tax_rate: 0.08, tax_rounding_mode: "round-down", tax_sales_input_mode: "exclusive", tax_expense_input_mode: "exclusive",
  };
  const result = buildCompanySettingsFromRow(row);
  assert.equal(result.settings.businessType, "nail");
  assert.equal(result.settings.currency, "USD");
  assert.equal(result.showOtherSales, true);
  assert.equal(result.taxSettings.rate, 0.08);
  assert.equal(result.taxSettings.roundingMode, "round-down");
});

test("buildStoreProfilesByStoreId keys profile fields by store_id, joins service_types back into a comma-separated string", () => {
  const rows = [
    { store_id: "store-honten", address: "東京都渋谷区1-2-3", phone: "03-1234-5678", representative_name: "山田太郎", service_types: ["カット", "カラー"], staff_count: 6, productivity_staff_count: 5 },
  ];
  const result = buildStoreProfilesByStoreId(rows);
  assert.equal(result["store-honten"].address, "東京都渋谷区1-2-3");
  assert.equal(result["store-honten"].representativeName, "山田太郎");
  assert.equal(result["store-honten"].serviceTypes, "カット, カラー");
  assert.equal(result["store-honten"].staffCount, 6);
  assert.equal(result["store-honten"].productivityStaffCount, 5);
});

test("buildStoreProfilesByStoreId defaults staffCount/productivityStaffCount to 0 when the columns are absent (existing stores before this feature)", () => {
  const result = buildStoreProfilesByStoreId([{ store_id: "store-old" }]);
  assert.equal(result["store-old"].staffCount, 0);
  assert.equal(result["store-old"].productivityStaffCount, 0);
});

test("getStaffProductivitySummary divides current sales and month-end forecast by the productivity staff count when it's entered", () => {
  const result = getStaffProductivitySummary({ sales: 3100000, forecast: 4700000, staffCount: 6, productivityStaffCount: 5 });
  assert.equal(result.hasStaffCount, true);
  assert.equal(result.current, 620000);
  assert.equal(result.monthEndForecast, 940000);
  assert.equal(result.effectiveStaffCount, 5);
});

test("getStaffProductivitySummary supports fractional (FTE) productivity staff counts", () => {
  const result = getStaffProductivitySummary({ sales: 1000000, forecast: 1500000, productivityStaffCount: 2.5 });
  assert.equal(result.current, 400000);
  assert.equal(result.monthEndForecast, 600000);
  assert.equal(result.effectiveStaffCount, 2.5);
});

// 正社員のみ(パート・アルバイト無し)の店舗は、生産性計算人数を未入力のまま在籍スタッフ数を
// 自動的に使う — 追加設定なしで動く仕様。
test("getStaffProductivitySummary falls back to staffCount when productivityStaffCount is not entered", () => {
  const result = getStaffProductivitySummary({ sales: 3600000, forecast: 3600000, staffCount: 6 });
  assert.equal(result.hasStaffCount, true);
  assert.equal(result.current, 600000);
  assert.equal(result.monthEndForecast, 600000);
  assert.equal(result.effectiveStaffCount, 6);
});

test("getStaffProductivitySummary prefers productivityStaffCount over staffCount when both are entered", () => {
  const result = getStaffProductivitySummary({ sales: 5600000, forecast: 5600000, staffCount: 6, productivityStaffCount: 5.6 });
  assert.ok(Math.abs(result.current - 1000000) < 1);
  assert.equal(result.effectiveStaffCount, 5.6);
});

test("getStaffProductivitySummary reports hasStaffCount:false and never divides by zero when neither is set", () => {
  assert.deepEqual(getStaffProductivitySummary({ sales: 1000000, forecast: 1500000, staffCount: 0, productivityStaffCount: 0 }), { hasStaffCount: false, current: 0, monthEndForecast: 0, effectiveStaffCount: 0 });
  assert.deepEqual(getStaffProductivitySummary({ sales: 1000000, forecast: 1500000 }), { hasStaffCount: false, current: 0, monthEndForecast: 0, effectiveStaffCount: 0 });
});

// 「1人あたり月間売上」ダッシュボードカードの表示条件(要件: スタッフ数2人以上のみ表示)は
// effectiveStaffCountを閾値判定するだけで実装する——ここでその値が常に正しい優先順位
// (生産性計算人数→在籍スタッフ数)で解決されることを回帰テストとして固定する。
test("getStaffProductivitySummary: effectiveStaffCountは「1人あたり月間売上」カードの表示判定にそのまま使える(1人なら非表示、2人以上なら表示、小数にも対応)", () => {
  // 1人(在籍スタッフ数のみ) → 非表示になるべき(effectiveStaffCount < 2)。
  assert.equal(getStaffProductivitySummary({ sales: 1000000, forecast: 1000000, staffCount: 1 }).effectiveStaffCount, 1);
  // 1人(生産性計算人数のみ) → 非表示になるべき。
  assert.equal(getStaffProductivitySummary({ sales: 1000000, forecast: 1000000, productivityStaffCount: 1 }).effectiveStaffCount, 1);
  // 3.5人(小数) → 表示されるべき(effectiveStaffCount >= 2)。
  assert.equal(getStaffProductivitySummary({ sales: 1000000, forecast: 1000000, productivityStaffCount: 3.5 }).effectiveStaffCount, 3.5);
  // ちょうど2人 → 表示されるべき(境界値、2人以上に含む)。
  assert.equal(getStaffProductivitySummary({ sales: 1000000, forecast: 1000000, staffCount: 2 }).effectiveStaffCount, 2);
});

test("pruneStaleKeys drops any expected key Supabase no longer has a row for, leaves everything else untouched", () => {
  const merged = { "本店__2026-08": { targetSales: 100000 }, "本店__2026-07": { targetSales: 90000 }, "フィーネ横浜__2026-08": { targetSales: 50000 } };
  // Only 本店__2026-08 and 本店__2026-07 were inside the just-fetched window; フィーネ横浜__2026-08
  // wasn't fetched this time and must be left alone regardless of what freshMap contains.
  const expectedKeys = new Set(["本店__2026-08", "本店__2026-07"]);
  const freshMap = { "本店__2026-08": { targetSales: 100000 } }; // 本店__2026-07's target was deleted from Supabase
  const pruned = pruneStaleKeys(merged, expectedKeys, freshMap);
  assert.deepEqual(Object.keys(pruned).sort(), ["フィーネ横浜__2026-08", "本店__2026-08"]);
});

test("pruneDeletedItemsFromItemArrayMap: 削除した費用項目(fixed_costs)は、同じキーに他の項目が残っていても正しく取り除かれる(費用削除不具合の修正 — pruneStaleKeysはキー単位でしか判定できず、これができなかった)", () => {
  const merged = {
    "store-a__2026-08": [
      { id: "fc-rent", name: "家賃" },
      { id: "fc-shahan", name: "社販" }, // 誤って登録し、削除したはずの項目
    ],
    "store-b__2026-08": [{ id: "fc-other", name: "他店舗の費用" }],
  };
  // Supabase側は既に「社販」が削除済み(fresh側に存在しない) — 家賃だけが残っている。
  const fresh = {
    "store-a__2026-08": [{ id: "fc-rent", name: "家賃" }],
    "store-b__2026-08": [{ id: "fc-other", name: "他店舗の費用" }],
  };
  const pruned = pruneDeletedItemsFromItemArrayMap(merged, fresh, ["store-a__", "store-b__"]);

  assert.deepEqual(pruned["store-a__2026-08"].map((item) => item.id), ["fc-rent"]);
  // 削除していない他店舗のデータには一切影響しない(company_id/store_id分離の維持)。
  assert.deepEqual(pruned["store-b__2026-08"].map((item) => item.id), ["fc-other"]);
});

test("pruneDeletedItemsFromItemArrayMap: keyPrefixesに一致しないキー(取得対象外の会社・店舗)は一切変更しない", () => {
  const merged = { "other-company-store__2026-08": [{ id: "fc-x" }] };
  const fresh = {}; // このキーはそもそも今回の取得範囲外(会社が違う等)
  const pruned = pruneDeletedItemsFromItemArrayMap(merged, fresh, ["store-a__"]);
  assert.deepEqual(pruned["other-company-store__2026-08"].map((item) => item.id), ["fc-x"]);
});

test("pruneDeletedItemsFromItemArrayMap: 継続費用・単月/期間限定費用のどちらでも同様に削除が反映される(periodTypeに関わらずidだけで判定するため)", () => {
  const merged = {
    "store-a__2026-08": [
      { id: "fc-ongoing", name: "継続費用", periodType: "ongoing" },
      { id: "fc-limited", name: "単月費用", periodType: "limited" },
    ],
  };
  // 両方とも削除済み(freshに1件も無い)。
  const fresh = { "store-a__2026-08": [] };
  const pruned = pruneDeletedItemsFromItemArrayMap(merged, fresh, ["store-a__"]);
  assert.deepEqual(pruned["store-a__2026-08"], []);
});

// 「全店舗」(company_admin専用の仮想集計ビュー)関連のテスト。実店舗を新規作成せず、
// company_id単位で各店舗のdaily_sales由来データを集計するロジックが正しいことを確認する。
const buildAllStoresTestState = () => ({
  ...createInitialAppState(),
  dailyResults: {
    [buildMonthKey("A店", "2026-08")]: [
      { date: "2026-08-01", totalSales: 100000, customers: 10, reviewCount: 3 },
      // A店の8/2は未締め: 全店舗合算には一切含まれてはいけない
      { date: "2026-08-02", totalSales: 500000, customers: 50, reviewCount: 4 },
    ],
    [buildMonthKey("B店", "2026-08")]: [
      { date: "2026-08-01", totalSales: 200000, customers: 5, reviewCount: 2 },
      // B店は8/2は日締めしたが、A店が8/2未締めなので「全店舗として営業完了」にはならない
      { date: "2026-08-02", totalSales: 300000, customers: 30, reviewCount: 1 },
    ],
  },
  dayClosingStates: {
    [buildMonthKey("A店", "2026-08")]: { "2026-08-01": true, "2026-08-02": false },
    [buildMonthKey("B店", "2026-08")]: { "2026-08-01": true, "2026-08-02": true },
  },
  allStoresTargets: {
    [buildCompanyMonthKey("company-1", "2026-08")]: { targetSales: 200000, targetCustomers: 10 },
  },
  allStoresBusinessDaySettings: {
    [buildCompanyMonthKey("company-1", "2026-08")]: { holidayCount: 4 },
  },
});
const allStoresTestCompany = { id: "company-1", stores: [{ id: "A店", name: "A店" }, { id: "B店", name: "B店" }] };

test("getAllStoresBusinessDaySummary: a date counts as 全店舗営業完了 only once every registered store has closed it that day (not a per-store sum)", () => {
  const state = buildAllStoresTestState();
  const result = getAllStoresBusinessDaySummary(state, "company-1", ["A店", "B店"], "2026-08");
  // 31日 - 休業日4日 = 27営業日。3店舗あっても27×店舗数にはならない。
  assert.equal(result.businessDayCount, 27);
  // 8/1は両店とも締め済み→カウント。8/2はA店が未締めなので、B店が締めていてもカウントしない。
  assert.deepEqual(result.closedDates, ["2026-08-01"]);
  assert.equal(result.completedDays, 1);
  assert.equal(result.remainingBusinessDays, 26);
});

test("getAllStoresBusinessDaySummary: with no registered stores, completedDays is 0 (not NaN/crash)", () => {
  const state = buildAllStoresTestState();
  const result = getAllStoresBusinessDaySummary(state, "company-1", [], "2026-08");
  assert.equal(result.completedDays, 0);
  assert.equal(result.businessDayCount, 27);
});

// ============================================================
// 全店舗カレンダー「緑」判定の不具合修正: その日の営業対象店舗(店休日の店舗を除く)だけで
// 完了判定する。5〜6店舗の実データに近い構成で、報告の確認ケース1〜10をすべて検証する。
// ============================================================
const SIX_STORE_NAMES = ["原宿", "横浜", "柏", "八戸", "吉祥寺", "池袋"];
const FIVE_STORE_NAMES = ["店A", "店B", "店C", "店D", "店E"];

// storeCloseMap: { 店舗名: true|false } — trueなら日締め済み(=完了)の実日次データを1件用意する。
const buildStoresWithClosingState = (storeNames, month, dateIso, storeCloseMap) => {
  const state = createInitialAppState();
  storeNames.forEach((name) => {
    const key = buildMonthKey(name, month);
    if (storeCloseMap[name]) {
      state.dailyResults[key] = [{ date: dateIso, totalSales: 100000, customers: 5 }];
      state.dayClosingStates[key] = { [dateIso]: true };
    }
  });
  return state;
};

test("ケース1: 5店舗すべて営業・5店舗すべて入力完了 → 緑(closedDatesに含まれる)", () => {
  const month = "2026-08";
  const dateIso = "2026-08-11";
  const state = buildStoresWithClosingState(FIVE_STORE_NAMES, month, dateIso, {
    店A: true, 店B: true, 店C: true, 店D: true, 店E: true,
  });
  const result = getAllStoresBusinessDaySummary(state, "company-1", FIVE_STORE_NAMES, month);
  assert.ok(result.closedDates.includes(dateIso));
});

test("ケース2: 5店舗すべて営業・4店舗完了/1店舗未入力 → 通常色(closedDatesに含まれない)", () => {
  const month = "2026-08";
  const dateIso = "2026-08-11";
  const state = buildStoresWithClosingState(FIVE_STORE_NAMES, month, dateIso, {
    店A: true, 店B: true, 店C: true, 店D: true, 店E: false,
  });
  const result = getAllStoresBusinessDaySummary(state, "company-1", FIVE_STORE_NAMES, month);
  assert.ok(!result.closedDates.includes(dateIso));
});

test("ケース3(報告の再現例そのもの): 5店舗中1店舗店休日・残り4店舗すべて完了 → 緑(不具合修正の中心ケース)", () => {
  const month = "2026-08";
  const dateIso = "2026-08-11";
  const state = buildStoresWithClosingState(FIVE_STORE_NAMES, month, dateIso, {
    // 店Aは店休日にするので実データは用意しない(=完了データが無い状態)。
    店A: false, 店B: true, 店C: true, 店D: true, 店E: true,
  });
  state.storeHolidays[buildMonthKey("店A", month)] = [dateIso];
  const result = getAllStoresBusinessDaySummary(state, "company-1", FIVE_STORE_NAMES, month);
  // 修正前は店Aの未完了(店休日で当然データが無い)につられてclosedDatesに入らなかった。
  assert.ok(result.closedDates.includes(dateIso), "店休日の店舗を除いた営業店舗が全完了なら緑になるべき");
});

test("ケース4: 5店舗中2店舗店休日・残り3店舗中1店舗未入力 → 通常色", () => {
  const month = "2026-08";
  const dateIso = "2026-08-11";
  const state = buildStoresWithClosingState(FIVE_STORE_NAMES, month, dateIso, {
    店A: false, 店B: false, 店C: true, 店D: true, 店E: false, // 店Eが営業日なのに未入力
  });
  state.storeHolidays[buildMonthKey("店A", month)] = [dateIso];
  state.storeHolidays[buildMonthKey("店B", month)] = [dateIso];
  const result = getAllStoresBusinessDaySummary(state, "company-1", FIVE_STORE_NAMES, month);
  assert.ok(!result.closedDates.includes(dateIso), "営業対象の店Eが未入力なので緑にしてはいけない");
});

test("ケース5-a: 会社共通で宣言された全店舗店休日(company_all_stores_holidays)は、従来どおり赤(closedDatesにもbusinessDayCountにも含めない)", () => {
  const month = "2026-08";
  const dateIso = "2026-08-11";
  const state = buildStoresWithClosingState(FIVE_STORE_NAMES, month, dateIso, {
    店A: true, 店B: true, 店C: true, 店D: true, 店E: true,
  });
  state.allStoresHolidays[buildCompanyMonthKey("company-1", month)] = [dateIso];
  const result = getAllStoresBusinessDaySummary(state, "company-1", FIVE_STORE_NAMES, month);
  assert.ok(!result.closedDates.includes(dateIso));
  assert.ok(result.holidayDates.includes(dateIso));
});

test("ケース5-b: 会社共通の宣言が無くても、5店舗全店が個別に店休日なら、その日は営業対象店舗が1つも無いため緑にならない(赤相当の除外)", () => {
  const month = "2026-08";
  const dateIso = "2026-08-11";
  const state = buildStoresWithClosingState(FIVE_STORE_NAMES, month, dateIso, {
    店A: false, 店B: false, 店C: false, 店D: false, 店E: false,
  });
  FIVE_STORE_NAMES.forEach((name) => {
    state.storeHolidays[buildMonthKey(name, month)] = [dateIso];
  });
  const result = getAllStoresBusinessDaySummary(state, "company-1", FIVE_STORE_NAMES, month);
  assert.ok(!result.closedDates.includes(dateIso), "営業対象店舗が0件の日を緑にしてはいけない");
});

test("ケース6(報告の実データ相当): 全店舗まとめ入力1日〜18日、途中に店舗ごとの店休日が混在していても、営業している店舗がすべてまとめ入力済みなら該当営業日はすべて緑になる", () => {
  const month = "2026-08";
  const state = createInitialAppState();
  SIX_STORE_NAMES.forEach((name) => {
    state.dailyBatchEntries[buildMonthKey(name, month)] = [
      { id: `batch-${name}`, startDate: "2026-08-01", endDate: "2026-08-18", totalSales: 900000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
    ];
  });
  // 報告の例そのもの: 8/11は原宿だけ店休日。
  state.storeHolidays[buildMonthKey("原宿", month)] = ["2026-08-11"];

  const result = getAllStoresBusinessDaySummary(state, "company-1", SIX_STORE_NAMES, month);
  for (let day = 1; day <= 18; day += 1) {
    const dateIso = `2026-08-${String(day).padStart(2, "0")}`;
    assert.ok(result.closedDates.includes(dateIso), `${dateIso} should be green (all operating stores covered by batch entries)`);
  }
});

test("ケース6の対比(報告の8/17の例): まとめ入力ではなく通常の日次入力を使う店舗のうち1店舗でも未入力なら、その日は緑にならない(店休日の店舗は除外したうえで判定)", () => {
  const month = "2026-08";
  const dateIso = "2026-08-17";
  const state = createInitialAppState();
  // 原宿・横浜: 入力完了。柏: 未入力。八戸: 店休日(判定対象外)。吉祥寺・池袋も完了。
  const closed = { 原宿: true, 横浜: true, 柏: false, 吉祥寺: true, 池袋: true };
  Object.entries(closed).forEach(([name, isClosed]) => {
    const key = buildMonthKey(name, month);
    if (isClosed) {
      state.dailyResults[key] = [{ date: dateIso, totalSales: 100000 }];
      state.dayClosingStates[key] = { [dateIso]: true };
    }
  });
  state.storeHolidays[buildMonthKey("八戸", month)] = [dateIso];

  const result = getAllStoresBusinessDaySummary(state, "company-1", SIX_STORE_NAMES, month);
  assert.ok(!result.closedDates.includes(dateIso), "柏が営業日かつ未入力なので8/17は通常色のまま");
});

test("ケース7: まとめ入力済みで緑だった日を、後からその日だけ店休日に変更 → 残りの営業店舗が全完了なら緑を維持する(状態変更に自動追従、追加のキャッシュ更新処理は不要)", () => {
  const month = "2026-08";
  const dateIso = "2026-08-05";
  const state = buildStoresWithClosingState(FIVE_STORE_NAMES, month, dateIso, {
    店A: true, 店B: true, 店C: true, 店D: true, 店E: false, // 店Eだけ未入力 → 通常色のはず
  });
  const before = getAllStoresBusinessDaySummary(state, "company-1", FIVE_STORE_NAMES, month);
  assert.ok(!before.closedDates.includes(dateIso));

  // 未入力だった店Eをこの日だけ店休日に変更(店舗設定変更を模す)。
  state.storeHolidays[buildMonthKey("店E", month)] = [dateIso];
  const after = getAllStoresBusinessDaySummary(state, "company-1", FIVE_STORE_NAMES, month);
  assert.ok(after.closedDates.includes(dateIso), "未入力店舗を店休日に変更した後は、残りの営業店舗が全完了のため緑になるべき");
});

test("ケース8: 緑だった日の店休日を解除して営業日に戻す → その店舗に入力が無ければ緑から通常色へ戻る", () => {
  const month = "2026-08";
  const dateIso = "2026-08-11";
  const state = buildStoresWithClosingState(FIVE_STORE_NAMES, month, dateIso, {
    店A: false, 店B: true, 店C: true, 店D: true, 店E: true,
  });
  state.storeHolidays[buildMonthKey("店A", month)] = [dateIso];
  const before = getAllStoresBusinessDaySummary(state, "company-1", FIVE_STORE_NAMES, month);
  assert.ok(before.closedDates.includes(dateIso));

  // 店休日を解除(配列から取り除く)。店Aには相変わらず入力が無い。
  state.storeHolidays[buildMonthKey("店A", month)] = [];
  const after = getAllStoresBusinessDaySummary(state, "company-1", FIVE_STORE_NAMES, month);
  assert.ok(!after.closedDates.includes(dateIso), "店休日を解除して営業日に戻したのに入力が無いままなら緑を維持してはいけない");
});

test("ケース9: まとめ入力を削除して営業店舗に未入力が発生 → 緑が解除される(画面表示だけ緑のまま残らない)", () => {
  const month = "2026-08";
  const dateIso = "2026-08-05";
  const state = createInitialAppState();
  FIVE_STORE_NAMES.forEach((name) => {
    state.dailyBatchEntries[buildMonthKey(name, month)] = [
      { id: `batch-${name}`, startDate: "2026-08-01", endDate: "2026-08-10", totalSales: 500000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
    ];
  });
  const before = getAllStoresBusinessDaySummary(state, "company-1", FIVE_STORE_NAMES, month);
  assert.ok(before.closedDates.includes(dateIso));

  // 店Eのまとめ入力だけ削除(配列から取り除く、submitFixedCost系ハンドラの削除と同じ操作)。
  state.dailyBatchEntries[buildMonthKey("店E", month)] = [];
  const after = getAllStoresBusinessDaySummary(state, "company-1", FIVE_STORE_NAMES, month);
  assert.ok(!after.closedDates.includes(dateIso), "まとめ入力削除で店Eが未入力に戻ったのだから緑を解除するべき");
});

test("ケース10: 売上0円を正式に日締め済みで保存している場合、未入力扱いにせず完了として数える(金額の大小では判定しない)", () => {
  const month = "2026-08";
  const dateIso = "2026-08-11";
  const state = createInitialAppState();
  FIVE_STORE_NAMES.forEach((name) => {
    const key = buildMonthKey(name, month);
    // 全店舗とも意図的に0円で日締め済み(閑散日などを正しく記録したケースを想定)。
    state.dailyResults[key] = [{ date: dateIso, totalSales: 0, customers: 0 }];
    state.dayClosingStates[key] = { [dateIso]: true };
  });
  const result = getAllStoresBusinessDaySummary(state, "company-1", FIVE_STORE_NAMES, month);
  assert.ok(result.closedDates.includes(dateIso), "0円でも日締め済みなら完了として扱うべき(売上金額の有無で判定しない)");
});

test("店舗数が増減しても店舗名・店舗数をハードコードせず、渡されたstoresInputだけを基準に動的判定する(店舗追加への対応)", () => {
  const month = "2026-08";
  const dateIso = "2026-08-11";
  // 8店舗(SIX_STORE_NAMESに新規2店舗を追加した想定)全店が完了。
  const eightStores = [...SIX_STORE_NAMES, "新宿", "渋谷"];
  const state = buildStoresWithClosingState(eightStores, month, dateIso, Object.fromEntries(eightStores.map((name) => [name, true])));
  const result = getAllStoresBusinessDaySummary(state, "company-1", eightStores, month);
  assert.ok(result.closedDates.includes(dateIso));
});

test("実データ再現ケース: 5店舗がまとめて入力で8/1〜8/18を完了、1店舗(横浜)だけ通常日次入力へ切り替えて8/16までしか締めていない場合、1〜16日(店休日の11日含む)は緑、17・18日は緑にならない(判定ロジックの誤りではなく、横浜のデータが実際に無いことを正しく反映している)", () => {
  const month = "2026-08";
  const state = createInitialAppState();

  // 原宿・吉祥寺・柏・八戸・池袋: まとめて入力で8/1〜8/18を1件で登録済み(実データと同じ形)。
  ["原宿", "吉祥寺", "柏", "八戸", "池袋"].forEach((name) => {
    state.dailyBatchEntries[buildMonthKey(name, month)] = [
      { id: `batch-${name}`, startDate: "2026-08-01", endDate: "2026-08-18", totalSales: 1000000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
    ];
  });

  // 横浜: 通常の日次入力で1〜10・12〜16日を日締め済み、11日は店休日、17・18日はまだ未入力
  // (実際のDBの状態そのまま — daily_batch_entriesは7月分のみで8月分は無い)。
  const yokohamaClosedDates = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "12", "13", "14", "15", "16"].map((d) => `2026-08-${d}`);
  state.dailyResults[buildMonthKey("横浜", month)] = yokohamaClosedDates.map((date) => ({ date, totalSales: 100000 }));
  state.dayClosingStates[buildMonthKey("横浜", month)] = Object.fromEntries(yokohamaClosedDates.map((date) => [date, true]));
  state.storeHolidays[buildMonthKey("横浜", month)] = ["2026-08-11"];

  const stores = ["原宿", "横浜", "柏", "八戸", "吉祥寺", "池袋"];
  const result = getAllStoresBusinessDaySummary(state, "company-1", stores, month);

  // 1〜10日・12〜16日(横浜が日締め済み)と11日(横浜の店休日で判定対象外)は緑になる。
  ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16"].forEach((d) => {
    const iso = `2026-08-${d}`;
    assert.ok(result.closedDates.includes(iso), `${iso} should be green`);
  });
  // 17・18日は横浜がまとめ入力・日次入力のどちらでも未完了(実データが無い)ため、緑にならない
  // — これは判定ロジックの不具合ではなく、横浜のデータが実際に未入力であることの正しい反映。
  assert.ok(!result.closedDates.includes("2026-08-17"), "2026-08-17 should NOT be green (横浜 has no data at all for this date)");
  assert.ok(!result.closedDates.includes("2026-08-18"), "2026-08-18 should NOT be green (横浜 has no data at all for this date)");
});

test("calculateAllStoresMonthSummary: sales reflects every entered day immediately (not just closed days), while closedSales/averageDailySales and 営業完了日数 stay confirmed-only", () => {
  const state = buildAllStoresTestState();
  const summary = calculateAllStoresMonthSummary(state, allStoresTestCompany, "2026-08");
  // sales(ダッシュボード/ランキングが表示する値)は日締め状態に関係なく入力済み全件を含む:
  // A店8/1(100000)+A店8/2(500000,未締め)+B店8/1(200000)+B店8/2(300000) = 1,100,000。
  // 未締めのA店8/2をここで除外すると、入力した直後にランキング側だけ反映されない不具合が
  // 再発するため、意図的にフィルタしない。
  assert.equal(summary.sales, 1100000);
  assert.equal(summary.customers, 95);
  // closedSalesは従来通り日締め済みの日だけ(pace/forecast/averageDailySales専用)。
  assert.equal(summary.closedSales, 600000);
  // 「営業完了1日」とカウントされるのは全店舗の日締めが揃った8/1だけ(8/2はA店が
  // 未締めなので、たとえB店が締めていても全店舗としてはまだ営業完了日にならない)。
  assert.equal(summary.completedDays, 1);
  // targetSales=200000 (全店舗目標) に対して実績1,100,000 → 550%。個々の店舗のtargetは無関係。
  assert.equal(summary.targetAchievement, 550);
  assert.equal(summary.customerAchievement, 950);
  // 1日平均売上 = 全店舗確定済み総売上(closedSales=600000) ÷ 全店舗として営業完了した日数(1)
  assert.equal(summary.averageDailySales, 600000);
});

test("calculateAllStoresMonthSummary: a newly added store with no data yet doesn't zero out the other stores' sales, but does block 営業完了日数 from ever counting a day (since it never closes)", () => {
  const state = buildAllStoresTestState();
  const companyWithNewStore = { id: "company-1", stores: [{ id: "A店", name: "A店" }, { id: "B店", name: "B店" }, { id: "C店（新規）", name: "C店（新規）" }] };
  const summary = calculateAllStoresMonthSummary(state, companyWithNewStore, "2026-08");
  // C店が一度も日締めしていないため、全店舗の積集合は常に空 → 営業完了日数は0日。
  assert.equal(summary.completedDays, 0);
  // それでもA店・B店それぞれの実績(入力済み全件)はそのまま反映される —
  // 新規店舗の追加が既存店舗の実績集計を壊してはいけない。
  assert.equal(summary.sales, 1100000);
});

test("calculateAllStoresMonthSummary: 口コミ数は目標(targetReviewCount)が未設定でも会社内の全店舗分を合算する(日次口コミON/目標口コミOFFでも累計は使える、という独立要件)", () => {
  const state = buildAllStoresTestState();
  const summary = calculateAllStoresMonthSummary(state, allStoresTestCompany, "2026-08");
  // A店(3+4)+B店(2+1) = 10。closedSalesと違い、未締めのA店8/2分も含めて合算する(salesと
  // 同じ扱い — 日締めの有無で口コミ実績を除外する理由がないため)。
  assert.equal(summary.reviewCount, 10);
  // 目標未設定(allStoresTargetsにtargetReviewCountが無い)なので達成率・残数は0のまま
  // クラッシュしない(未設定を「0件と比較して即0%」扱いにするのは正しいが、任意項目な
  // ので警告やエラーにはならない、という点をロックする)。
  assert.equal(summary.reviewCountTarget, 0);
  assert.equal(summary.reviewCountAchievement, 0);
});

// 月次経営ダッシュボード関連のテスト。店舗横断の集計・前月比・「－」表示ルールが、既存の
// calculateMonthSummary/getStaffProductivitySummaryの結果だけから正しく組み立てられることを
// 確認する(ダッシュボード専用の手入力データは一切使わない)。
const buildDashboardTestState = () => {
  const state = createInitialAppState();
  const currentKeyA = buildMonthKey("store-a", "2026-08");
  const previousKeyA = buildMonthKey("store-a", "2026-07");
  const currentKeyB = buildMonthKey("store-b", "2026-08");

  state.dailyResults[currentKeyA] = [
    { date: "2026-08-01", totalSales: 200000, technicalSales: 140000, retailSales: 60000, customers: 10, newCustomers: 3, repeatCustomers: 7 },
    { date: "2026-08-02", totalSales: 300000, technicalSales: 180000, retailSales: 120000, customers: 12, newCustomers: 4, repeatCustomers: 8 },
  ];
  state.dailyResults[previousKeyA] = [
    { date: "2026-07-01", totalSales: 400000, technicalSales: 300000, retailSales: 100000, customers: 20, newCustomers: 5, repeatCustomers: 15 },
  ];
  state.dailyResults[currentKeyB] = [
    { date: "2026-08-01", totalSales: 100000, technicalSales: 80000, retailSales: 20000, customers: 5, newCustomers: 1, repeatCustomers: 4 },
  ];
  // store-bの前月(2026-07)は一件もdailyResultsが無い → hasPrevious:false になるはず。

  // 継続費用は基本値(baseAmount)を持つ(要件1-4)。対象月ちょうどの上書き行が無い月は
  // この基本値を使う——8月に固有の上書きが無いので、8月もこの100,000円がそのまま使われる。
  state.fixedCosts[currentKeyA] = [{ id: "fc-a-rent", name: "家賃", categoryKey: "rent", periodType: "ongoing", baseAmount: 100000 }];
  state.costMonthlyAmounts = {};
  state.monthClosing[currentKeyA] = [
    { id: "close-a-1", name: "人件費", amount: 150000, category: "人件費", categoryKey: "labor" },
    { id: "close-a-2", name: "仕入・発注額", amount: 40000, category: "仕入・発注額", categoryKey: "materials" },
  ];
  // store-bは人件費・材料/発注費とも未登録(hasLaborData/hasPurchaseData:falseになるはず)。

  state.monthClosingStatus[currentKeyA] = { closed: true, lockedAt: "2026-09-01T00:00:00.000Z", note: "月締め済み" };
  // store-bは未締め(monthClosingStatusにキー自体が無い = デフォルトfalse)。

  return state;
};

const dashboardTestCompany = {
  id: "company-1",
  stores: [
    { id: "store-a", name: "店A", staffCount: 5, productivityStaffCount: 0, settings: { useInventoryTracking: false } },
    { id: "store-b", name: "店B", staffCount: 0, productivityStaffCount: 0, settings: { useInventoryTracking: false } },
  ],
};

test("getStoreDashboardRows: 1店舗1行で当月・前月・カテゴリ別入力有無・スタッフ生産性をまとめて返す", () => {
  const state = buildDashboardTestState();
  const rows = getStoreDashboardRows(state, dashboardTestCompany, "2026-08");

  assert.equal(rows.length, 2);
  const storeA = rows.find((row) => row.storeId === "store-a");
  const storeB = rows.find((row) => row.storeId === "store-b");

  assert.equal(storeA.sales, 500000);
  assert.equal(storeA.isClosed, true);
  assert.equal(storeA.laborCost, 150000);
  assert.equal(storeA.hasLaborData, true);
  assert.equal(storeA.purchaseCost, 40000);
  assert.equal(storeA.hasPurchaseData, true);
  assert.equal(storeA.fixedCost, 100000);
  assert.equal(storeA.hasFixedCostData, true); // 家賃(rent)が登録済み
  assert.equal(storeA.operatingProfit, 210000);
  assert.equal(storeA.operatingMargin, 42);
  assert.equal(storeA.isProvisionalProfit, false); // 人件費・材料/発注費とも登録済み
  assert.equal(storeA.effectiveStaffCount, 5); // productivityStaffCount未入力→staffCountへフォールバック
  assert.equal(storeA.productivity.hasStaffCount, true);
  assert.equal(storeA.productivity.current, 100000); // 500000 / 5
  // 前月(2026-07)は1件データがあるのでhasPrevious:true
  assert.equal(storeA.previous.hasPrevious, true);
  assert.equal(storeA.previous.sales, 400000);
  // 家賃(rent)は継続費用として登録されているため、登録月(2026-08)より前の前月(2026-07)
  // でも項目自体は存在する扱いになる(要件8)。金額もその月に固有の保存が無い場合、保存されて
  // いる中で最も古い(=このケースでは唯一の)金額100,000円を暫定的に引き継ぐ(費用継続金額の
  // 引き継ぎ不具合修正 — 登録月より過去でも「未入力」にしない)。
  assert.equal(storeA.previous.operatingProfit, 300000); // 400000 - 100000(引き継いだ家賃)
  // 前月は人件費・材料/発注費とも未登録(hasPrevious:trueでも費用面は別軸で判定する)
  assert.equal(storeA.previous.hasLaborData, false);
  assert.equal(storeA.previous.hasPurchaseData, false);
  assert.equal(storeA.previous.hasFixedCostData, true);
  assert.equal(storeA.previous.isProvisionalProfit, true);

  assert.equal(storeB.sales, 100000);
  assert.equal(storeB.isClosed, false); // monthClosingStatusにキーが無い→未締め扱い
  assert.equal(storeB.hasLaborData, false); // 人件費が1件も登録されていない
  assert.equal(storeB.hasPurchaseData, false); // 材料/発注費が1件も登録されていない
  assert.equal(storeB.hasFixedCostData, false); // 家賃等も未登録
  assert.equal(storeB.isProvisionalProfit, true); // 人件費・材料/発注費が両方未登録
  assert.equal(storeB.effectiveStaffCount, 0);
  assert.equal(storeB.productivity.hasStaffCount, false); // スタッフ数未設定
  // store-bの前月(2026-07)はdailyResults自体が無い → hasPrevious:false(0円と区別)
  assert.equal(storeB.previous.hasPrevious, false);
});

test("getStoreDashboardRows: 対象外(hiddenClosingCategories)にしたカテゴリは未入力として扱わず、isProvisionalProfitをブロックしない", () => {
  const state = buildDashboardTestState();
  const companyWithHiddenLabor = {
    id: "company-1",
    stores: [
      { id: "store-a", name: "店A", staffCount: 5, productivityStaffCount: 0, settings: { useInventoryTracking: false } },
      // 店Bはスタッフのいないフリーランス想定で人件費・材料/発注費を「対象外」にしている。
      { id: "store-b", name: "店B", staffCount: 0, productivityStaffCount: 0, settings: { useInventoryTracking: false, hiddenClosingCategories: ["labor", "materials"] } },
    ],
  };
  const rows = getStoreDashboardRows(state, companyWithHiddenLabor, "2026-08");
  const storeB = rows.find((row) => row.storeId === "store-b");

  assert.equal(storeB.hasLaborData, true); // 対象外は「未入力」ではなく解決済み扱い
  assert.equal(storeB.laborCost, 0); // 実際の登録額は無いので0円(対象外=0円、－ではない)
  assert.equal(storeB.hasPurchaseData, true);
  assert.equal(storeB.purchaseCost, 0);
  assert.equal(storeB.isProvisionalProfit, false); // 対象外設定のせいで暫定値のまま止まらない
  assert.equal(storeB.operatingProfit, 100000); // 売上100000 - 費用0
});

test("getStoreDashboardRows: 目標達成率・広告費を含む(店舗比較表の新規列)", () => {
  const state = buildDashboardTestState();
  state.targets = { [buildMonthKey("store-a", "2026-08")]: { targetSales: 400000 } };
  state.monthClosing[buildMonthKey("store-a", "2026-08")].push({ id: "close-a-3", name: "広告費", amount: 20000, category: "広告費", categoryKey: "advertising" });
  const rows = getStoreDashboardRows(state, dashboardTestCompany, "2026-08");
  const storeA = rows.find((row) => row.storeId === "store-a");
  const storeB = rows.find((row) => row.storeId === "store-b");

  assert.equal(storeA.hasSalesTarget, true);
  assert.equal(storeA.targetSales, 400000);
  assert.equal(storeA.targetAchievement, 125); // 500000 / 400000 * 100
  assert.equal(storeA.adCost, 20000);
  assert.equal(storeA.hasAdData, true);
  assert.equal(storeB.hasSalesTarget, false); // 目標未設定
  assert.equal(storeB.hasAdData, false);
});

test("getCompanyDashboardSummary: 固定費・広告費・目標達成率の合計は実額の合算から算出する", () => {
  const state = buildDashboardTestState();
  state.targets = { [buildMonthKey("store-a", "2026-08")]: { targetSales: 400000 } };
  const summary = getCompanyDashboardSummary(state, dashboardTestCompany, "2026-08");

  assert.equal(summary.totalFixedCost, 100000); // 店Aの家賃のみ
  assert.equal(summary.hasFixedCostData, true);
  assert.equal(summary.totalAdCost, 0);
  assert.equal(summary.hasAdData, false);
  assert.equal(summary.totalTargetSales, 400000); // 店Bは目標未設定なので0円扱いで合算
  assert.equal(summary.hasSalesTarget, true);
  assert.equal(summary.targetAchievement, 150); // 600000 / 400000 * 100(単純平均ではなく実額の合算)
});

test("getStoreDashboardRows / getCompanyDashboardSummary: 粗利(売上-発注費)は損益表と同じgrossProfitをそのまま使い、店舗数・全店舗粗利率は実額合算で算出する", () => {
  const state = buildDashboardTestState();
  const rows = getStoreDashboardRows(state, dashboardTestCompany, "2026-08");
  const storeA = rows.find((row) => row.storeId === "store-a");
  const storeB = rows.find((row) => row.storeId === "store-b");

  assert.equal(storeA.grossProfit, 460000); // 500000 - 40000(発注費)
  assert.equal(storeA.hasGrossProfitData, true); // 発注費(materials)登録済み
  assert.equal(storeB.hasGrossProfitData, false); // 発注費未登録 → 「－」表示になるべき

  const summary = getCompanyDashboardSummary(state, dashboardTestCompany, "2026-08");
  assert.equal(summary.storeCount, 2);
  assert.equal(summary.totalGrossProfit, 560000); // 460000 + 100000(店Bは原価0円扱いの生値)
  assert.equal(summary.hasGrossProfitData, true); // 店Aが登録済みなので会社全体としてはtrue
  assert.ok(Math.abs(summary.grossMargin - (560000 / 600000) * 100) < 0.001); // 実額合算(単純平均ではない)
});

test("getCompanyDashboardSummary: 会社全体の合計・比率は店舗ごとの比率の平均ではなく実額の合算から算出する", () => {
  const state = buildDashboardTestState();
  const summary = getCompanyDashboardSummary(state, dashboardTestCompany, "2026-08");

  assert.equal(summary.totalSales, 600000); // 500000 + 100000
  assert.equal(summary.totalOperatingProfit, 310000); // 210000 + 100000
  // 51.666...% (店Aの42%と店Bの100%の平均(71%)ではない)
  assert.ok(Math.abs(summary.operatingMargin - (310000 / 600000) * 100) < 0.001);
  assert.equal(summary.totalLaborCost, 150000);
  assert.equal(summary.laborRate, 25); // 150000 / 600000
  assert.equal(summary.totalPurchaseCost, 40000);
  // スタッフ生産性: 店Bはスタッフ数未設定なので分母から除外(店Aの5人のみ) → 600000 / 5
  assert.equal(summary.staffProductivity.hasStaffCount, true);
  assert.equal(summary.staffProductivity.current, 120000);
  // 店Aは月締め済み・店Bは未締め → 1店舗でも未締めなら会社全体は「暫定値」扱い
  assert.equal(summary.isFullyClosed, false);
  // 前月データ: 店Aにはあり(hasPrevious:true)・店Bには無い → 会社全体としては「一部前月データあり」
  assert.equal(summary.previous.hasPrevious, true);
  assert.equal(summary.previous.totalSales, 400000); // 店Aの前月400000 + 店Bの前月0(データ無し)
  // 費用データ有無: 店Aは人件費・材料/発注費を登録済みなので会社全体としてはtrue
  // (店Bが未登録でも「1店舗でも登録があれば」で判定し、合計値を「－」にしない)
  assert.equal(summary.hasLaborData, true);
  assert.equal(summary.hasPurchaseData, true);
  // 店Bが人件費・材料/発注費とも未登録のため、会社全体の営業利益も暫定扱い
  assert.equal(summary.isProvisionalProfit, true);
  // 前月は店A・店Bともに費用未登録 → 前月側の費用データも無し
  assert.equal(summary.previous.hasLaborData, false);
  assert.equal(summary.previous.hasPurchaseData, false);
  assert.equal(summary.previous.isProvisionalProfit, true);
  // storeRowsがそのまま返り、子コンポーネント側で再計算しなくて済む
  assert.equal(summary.storeRows.length, 2);
});

test("getCompanyDashboardSummary: 全店舗が人件費・材料/発注費を登録済みならisProvisionalProfit:false", () => {
  const state = buildDashboardTestState();
  state.monthClosing[buildMonthKey("store-b", "2026-08")] = [
    { id: "close-b-1", name: "人件費", amount: 30000, category: "人件費", categoryKey: "labor" },
    { id: "close-b-2", name: "仕入・発注額", amount: 10000, category: "仕入・発注額", categoryKey: "materials" },
  ];
  const summary = getCompanyDashboardSummary(state, dashboardTestCompany, "2026-08");
  assert.equal(summary.isProvisionalProfit, false);
  assert.equal(summary.hasLaborData, true);
  assert.equal(summary.hasPurchaseData, true);
});

test("getCompanyDashboardSummary: 全店舗が月締め済みならisFullyClosed:true", () => {
  const state = buildDashboardTestState();
  state.monthClosingStatus[buildMonthKey("store-b", "2026-08")] = { closed: true, lockedAt: "2026-09-01T00:00:00.000Z", note: "月締め済み" };
  const summary = getCompanyDashboardSummary(state, dashboardTestCompany, "2026-08");
  assert.equal(summary.isFullyClosed, true);
});

test("getCompanyDashboardSummary: 登録店舗が無い会社ではクラッシュせず、0円・isFullyClosed:falseを返す", () => {
  const state = buildDashboardTestState();
  const emptyCompany = { id: "company-empty", stores: [] };
  const summary = getCompanyDashboardSummary(state, emptyCompany, "2026-08");
  assert.equal(summary.totalSales, 0);
  assert.equal(summary.isFullyClosed, false);
  assert.deepEqual(summary.storeRows, []);
});

// 販売前総合チェックで発見: archived(休止・削除済み)店舗がgetStoreDashboardRows/
// getCompanyDashboardSummary(月次ダッシュボードの全店舗サマリー・比較表・ランキング・CSV出力が
// 共通で参照する集計関数)の集計対象から漏れて含まれていた——sales/KPIページ側の
// calculateAllStoresMonthSummaryや月次レビュー側のgetMonthlyReviewSummaryは既にarchived除外
// 済みだったのに、この関数だけ抜けていた不具合の回帰テスト。
test("getStoreDashboardRows: archived(休止・削除済み)店舗は集計から除外する(販売前総合チェックで発見した漏れの回帰テスト)", () => {
  const state = buildDashboardTestState();
  const currentKeyArchived = buildMonthKey("store-archived", "2026-08");
  // 休止店舗にも実際に売上データが残っている状態(過去に営業していた実績データ)を用意し、
  // 「データが無いから含まれない」のではなく「archivedだから除外される」ことを検証する。
  state.dailyResults[currentKeyArchived] = [
    { date: "2026-08-01", totalSales: 999999, technicalSales: 999999, retailSales: 0, customers: 1, newCustomers: 1, repeatCustomers: 0 },
  ];
  const companyWithArchivedStore = {
    id: "company-1",
    stores: [
      ...dashboardTestCompany.stores,
      { id: "store-archived", name: "休止店", status: "archived", staffCount: 2, productivityStaffCount: 0, settings: { useInventoryTracking: false } },
    ],
  };

  const rows = getStoreDashboardRows(state, companyWithArchivedStore, "2026-08");
  assert.equal(rows.length, 2); // store-a/store-bのみ、store-archivedは含まれない
  assert.ok(!rows.some((row) => row.storeId === "store-archived"));

  const summary = getCompanyDashboardSummary(state, companyWithArchivedStore, "2026-08");
  assert.equal(summary.storeCount, 2);
  // archived店舗の999999円が合算されていれば600000+999999になってしまうが、そうならないこと
  // (店A 500000 + 店B 100000 = 600000のまま)を確認する——月次ダッシュボードの全店舗サマリー・
  // ランキング・CSVがすべてこのstoreRowsを再利用するため、ここで防げば全経路が正しくなる。
  assert.equal(summary.totalSales, 600000);
});

test("getStoreDashboardRows: 停止中(suspended)の店舗はarchivedとは別扱いで集計に含める(除外対象を広げすぎない、既存のcalculateAllStoresMonthSummary等と同じ基準)", () => {
  const state = buildDashboardTestState();
  const companyWithSuspendedStore = {
    id: "company-1",
    stores: dashboardTestCompany.stores.map((store) => (
      store.id === "store-b" ? { ...store, status: "suspended" } : store
    )),
  };

  const rows = getStoreDashboardRows(state, companyWithSuspendedStore, "2026-08");
  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => row.storeId === "store-b")); // suspendedはarchivedと違い除外しない
});

test("diffPercent: 前月データが無い場合・前月が0円の場合はnull(0%と区別する)", () => {
  assert.equal(diffPercent(120, 100, true), 20);
  assert.equal(diffPercent(80, 100, true), -20);
  assert.equal(diffPercent(120, 100, false), null); // hasPrevious:falseなら常にnull
  assert.equal(diffPercent(120, 0, true), null); // 前月0円は0除算になるためnull
});

test("formatMoneyOrDash / formatPercentOrDash: hasDataがfalseの時だけ「－」、実際の0はそのまま表示する", () => {
  assert.equal(formatMoneyOrDash(12345, true), "¥12,345");
  assert.equal(formatMoneyOrDash(0, true), "¥0"); // 登録済みの0円を「－」にしない
  assert.equal(formatMoneyOrDash(12345, false), "－");
  assert.equal(formatPercentOrDash(12.34, true), "12.3%");
  assert.equal(formatPercentOrDash(0, true), "0.0%");
  assert.equal(formatPercentOrDash(12.34, false), "－");
});

test("formatDiffOrDash: 符号付き%表示、nullは「－」", () => {
  assert.equal(formatDiffOrDash(20), "+20.0%");
  assert.equal(formatDiffOrDash(-15), "−15.0%");
  assert.equal(formatDiffOrDash(0), "0.0%");
  assert.equal(formatDiffOrDash(null), "－");
});

// 店休日をカレンダーの具体的な日付で管理する新機能のテスト。既存の「休業日数(数値)」だけを
// 保存しているデータを勝手に日付へ変換しないこと、優先順位(カレンダー日付 > 手動営業日数 >
// 従来の休業日数)、店休日は営業完了数に含めないこと、を確認する。

test("buildStoreHolidaysStateFromRows / buildAllStoresHolidaysStateFromRows rebuild the date-list maps from raw rows", () => {
  const storeRows = [
    { store_id: "store-a", holiday_date: "2026-08-08" },
    { store_id: "store-a", holiday_date: "2026-08-15" },
  ];
  const { storeHolidays } = buildStoreHolidaysStateFromRows(storeRows);
  assert.deepEqual(storeHolidays["store-a__2026-08"].sort(), ["2026-08-08", "2026-08-15"]);

  const allStoresRows = [{ company_id: "company-1", holiday_date: "2026-08-08" }];
  const { allStoresHolidays } = buildAllStoresHolidaysStateFromRows(allStoresRows);
  assert.deepEqual(allStoresHolidays["company-1__2026-08"], ["2026-08-08"]);
});

test("getBusinessDaySummary: カレンダーで具体的な店休日が設定されている場合、従来の休業日「数」より優先して営業日数を計算する", () => {
  const state = {
    ...createInitialAppState(),
    businessDaySettings: { "A店__2026-08": { holidayCount: 5 } }, // 従来の数値(古いデータ、勝手に変換されない)
    storeHolidays: { "A店__2026-08": ["2026-08-01", "2026-08-08"] }, // カレンダーで2日だけ設定
  };
  const result = getBusinessDaySummary(state, "A店", "2026-08");
  // 31日 - カレンダー店休日2日 = 29日(従来のholidayCount=5は無視される)
  assert.equal(result.businessDayCount, 29);
});

test("getBusinessDaySummary: カレンダー日付が未設定の店舗は、既存の休業日「数」にそのままフォールバックする(後方互換・自動変換なし)", () => {
  const state = {
    ...createInitialAppState(),
    businessDaySettings: { "A店__2026-08": { holidayCount: 5 } },
    storeHolidays: {}, // カレンダー未設定
  };
  const result = getBusinessDaySummary(state, "A店", "2026-08");
  assert.equal(result.businessDayCount, 26); // 31 - 5(従来どおり)
});

test("getBusinessDaySummary: 店休日は日締め済みであっても営業完了数に含めない", () => {
  const state = {
    ...createInitialAppState(),
    dailyResults: { "A店__2026-08": [{ date: "2026-08-08", totalSales: 10000 }, { date: "2026-08-09", totalSales: 20000 }] },
    dayClosingStates: { "A店__2026-08": { "2026-08-08": true, "2026-08-09": true } },
    storeHolidays: { "A店__2026-08": ["2026-08-08"] }, // 8/8は締めているが店休日に設定されている
  };
  const result = getBusinessDaySummary(state, "A店", "2026-08");
  assert.deepEqual(result.closedDates, ["2026-08-09"]);
  assert.equal(result.completedDays, 1);
});

test("getAllStoresBusinessDaySummary: 全店舗の店休日は、その日の全店舗の日締めが揃っていても営業完了数に含めない", () => {
  const state = {
    ...createInitialAppState(),
    dayClosingStates: {
      "A店__2026-08": { "2026-08-08": true },
      "B店__2026-08": { "2026-08-08": true },
    },
    dailyResults: {
      "A店__2026-08": [{ date: "2026-08-08", totalSales: 1000 }],
      "B店__2026-08": [{ date: "2026-08-08", totalSales: 1000 }],
    },
    allStoresHolidays: { "company-1__2026-08": ["2026-08-08"] },
  };
  const result = getAllStoresBusinessDaySummary(state, "company-1", ["A店", "B店"], "2026-08");
  assert.deepEqual(result.closedDates, []);
  assert.equal(result.completedDays, 0);
});

test("getAllStoresBusinessDaySummary: 開店日(openingDate)より前の日は、その店舗を「未締め」として扱わない(新規店舗追加で過去の営業完了数が壊れない)", () => {
  const state = {
    ...createInitialAppState(),
    dayClosingStates: {
      "A店__2026-08": { "2026-08-01": true, "2026-08-02": true },
      "B店__2026-08": { "2026-08-01": true, "2026-08-02": true },
      // C店は8/2に開店したので8/1のデータは存在しない(未締め)
      "C店__2026-08": { "2026-08-02": true },
    },
    dailyResults: {
      "A店__2026-08": [{ date: "2026-08-01", totalSales: 1000 }, { date: "2026-08-02", totalSales: 1000 }],
      "B店__2026-08": [{ date: "2026-08-01", totalSales: 1000 }, { date: "2026-08-02", totalSales: 1000 }],
      "C店__2026-08": [{ date: "2026-08-02", totalSales: 1000 }],
    },
  };
  const stores = [
    { id: "A店", name: "A店", openingDate: "" },
    { id: "B店", name: "B店", openingDate: "" },
    { id: "C店", name: "C店", openingDate: "2026-08-02" },
  ];
  const result = getAllStoresBusinessDaySummary(state, "company-1", stores, "2026-08");
  // 8/1はC店がまだ開店していないのでA店・B店だけが対象 → 両方締めているので完了扱い。
  // 8/2はC店も開店済みで全店舗締めているので完了扱い。
  assert.deepEqual(result.closedDates, ["2026-08-01", "2026-08-02"]);
  assert.equal(result.completedDays, 2);
});

// 以下、「全店舗月カレンダー 周辺仕様・再発防止まとめ確認指示」対応分の回帰テスト
// (要件2・3・5・7・9・13)。

test("getStoreStatusAsOfDate: 履歴が無ければnull(判定不能)、履歴があればその日付時点で有効だった直近のactionを返す", () => {
  const state = {
    ...createInitialAppState(),
    storeStatusAuditLog: [
      { storeId: "横浜", action: "suspended", createdAt: "2026-08-16T00:00:00.000Z" },
      { storeId: "横浜", action: "resumed", createdAt: "2026-08-20T00:00:00.000Z" },
    ],
  };
  assert.equal(getStoreStatusAsOfDate(state, "存在しない店", "2026-08-10"), null);
  assert.equal(getStoreStatusAsOfDate(state, "横浜", "2026-08-10"), "active"); // 停止より前
  assert.equal(getStoreStatusAsOfDate(state, "横浜", "2026-08-16"), "inactive"); // 停止した当日から
  assert.equal(getStoreStatusAsOfDate(state, "横浜", "2026-08-19"), "inactive"); // 停止中
  assert.equal(getStoreStatusAsOfDate(state, "横浜", "2026-08-20"), "active"); // 再開した当日から
});

test("getAllStoresBusinessDaySummary: 店舗を月の途中で停止しても、停止前の過去日の完了状態は壊れず、停止後の日はその店舗を対象外にする(要件3)", () => {
  const month = "2026-08";
  const state = {
    ...createInitialAppState(),
    dayClosingStates: {
      "A店__2026-08": { "2026-08-14": true, "2026-08-15": true },
      "B店__2026-08": { "2026-08-14": true, "2026-08-15": true },
    },
    dailyResults: {
      "A店__2026-08": [{ date: "2026-08-14", totalSales: 1000 }, { date: "2026-08-15", totalSales: 1000 }],
      "B店__2026-08": [{ date: "2026-08-14", totalSales: 1000 }, { date: "2026-08-15", totalSales: 1000 }],
    },
    // B店は8/16に停止(監査ログに記録済み)。8/16以降はB店が新たに日締めすることはない。
    storeStatusAuditLog: [{ storeId: "B店", action: "suspended", createdAt: "2026-08-16T00:00:00.000Z" }],
  };
  const stores = [
    { id: "A店", name: "A店", openingDate: "", status: "active" },
    { id: "B店", name: "B店", openingDate: "", status: "suspended" },
  ];
  const result = getAllStoresBusinessDaySummary(state, "company-1", stores, month);
  // 8/14・8/15はB店の停止より前 → B店も対象に含めて両店とも締めているので完了扱い(過去データは壊れない)。
  assert.ok(result.closedDates.includes("2026-08-14"));
  assert.ok(result.closedDates.includes("2026-08-15"));
  // 8/16以降はB店が停止済み → B店は判定対象から除外され、A店だけが対象になる。A店は8/16以降
  // 締めていないので緑にはならないが、B店の未締めのせいで永久にブロックされることもない
  // (=8/16をA店が締めれば緑になり得る、という状態を確認する)。
  assert.ok(!result.closedDates.includes("2026-08-16"));
  const stateWithAClosed = {
    ...state,
    dayClosingStates: { ...state.dayClosingStates, "A店__2026-08": { ...state.dayClosingStates["A店__2026-08"], "2026-08-16": true } },
    dailyResults: { ...state.dailyResults, "A店__2026-08": [...state.dailyResults["A店__2026-08"], { date: "2026-08-16", totalSales: 1000 }] },
  };
  const resultAfterAClosed = getAllStoresBusinessDaySummary(stateWithAClosed, "company-1", stores, month);
  assert.ok(resultAfterAClosed.closedDates.includes("2026-08-16"), "B店の停止後は、残りの営業対象店舗(A店)だけが締めれば緑になるべき(B店に永久ブロックされない)");
});

test("getAllStoresBusinessDaySummary: 状態変更履歴が無い店舗は、現在stores.statusが停止/アーカイブ中なら安全側として判定対象から除外する(フォールバック)", () => {
  const month = "2026-08";
  const state = {
    ...createInitialAppState(),
    dayClosingStates: { "A店__2026-08": { "2026-08-01": true } },
    dailyResults: { "A店__2026-08": [{ date: "2026-08-01", totalSales: 1000 }] },
    storeStatusAuditLog: [], // 履歴機能導入前に停止した等、記録が無いケース
  };
  const stores = [
    { id: "A店", name: "A店", openingDate: "", status: "active" },
    { id: "B店", name: "B店", openingDate: "", status: "suspended" },
  ];
  const result = getAllStoresBusinessDaySummary(state, "company-1", stores, month);
  // B店の履歴が無くても、現在停止中なら判定対象から外れ、A店だけで完了判定できる。
  assert.ok(result.closedDates.includes("2026-08-01"));
});

test("getAllStoresBusinessDaySummary: 全店舗が個別の店休日(会社共通の休業日設定とは別)で重なった日は、赤(holidayDates)として扱う(要件5)", () => {
  const month = "2026-08";
  const state = {
    ...createInitialAppState(),
    storeHolidays: {
      "A店__2026-08": ["2026-08-11"],
      "B店__2026-08": ["2026-08-11"],
    },
    // 会社共通の全店舗休業日(allStoresHolidays)は明示的に設定していない — それでも
    // 「たまたま全店舗が個別に休みだった日」は赤扱いになるべき。
  };
  const stores = [
    { id: "A店", name: "A店", openingDate: "" },
    { id: "B店", name: "B店", openingDate: "" },
  ];
  const result = getAllStoresBusinessDaySummary(state, "company-1", stores, month);
  assert.ok(result.holidayDates.includes("2026-08-11"));
  assert.ok(!result.closedDates.includes("2026-08-11"));
});

test("getAllStoresBusinessDaySummary / getBusinessDaySummary: 未来日はデータ(まとめ入力含む)があっても緑にしない(要件9)", () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const month = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}`;
  const dateIso = `${month}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  const state = {
    ...createInitialAppState(),
    // まとめて入力は終了日に未来日制限が無いため、翌日を含む期間で登録されてしまうケースを再現。
    dailyBatchEntries: {
      [`A店__${month}`]: [{ id: "batch-1", startDate: `${month}-01`, endDate: dateIso, totalSales: 300000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null }],
    },
  };
  const single = getBusinessDaySummary(state, "A店", month);
  assert.ok(!single.closedDates.includes(dateIso), "単一店舗版: 未来日はまとめ入力があっても緑にしない");
  const all = getAllStoresBusinessDaySummary(state, "company-1", [{ id: "A店", name: "A店", openingDate: "" }], month);
  assert.ok(!all.closedDates.includes(dateIso), "全店舗版: 未来日はまとめ入力があっても緑にしない");
});

test("calculateAllStoresMonthSummary: アーカイブ済み店舗を除外する基準がgetAllStoresBusinessDaySummary呼び出し側(currentCompanyStores相当)と一致し、営業完了日数が食い違わない(要件7)", () => {
  const month = "2026-08";
  const state = {
    ...createInitialAppState(),
    dayClosingStates: { "A店__2026-08": { "2026-08-01": true } },
    dailyResults: { "A店__2026-08": [{ date: "2026-08-01", totalSales: 1000 }] },
  };
  const company = {
    id: "company-1",
    stores: [
      { id: "A店", name: "A店", openingDate: "" },
      // B店はアーカイブ済み・データ無し。App.jsx側のcurrentCompanyStores
      // (currentCompany.stores.filter(s => s.status !== "archived"))と同じ基準で除外されるべき。
      { id: "B店", name: "B店", openingDate: "", status: "archived" },
    ],
  };
  const summary = calculateAllStoresMonthSummary(state, company, month);
  // App.jsx側が実際にgetAllStoresBusinessDaySummaryへ渡すのと同じ「archived除外後」の店舗リスト。
  const currentCompanyStoresEquivalent = company.stores.filter((store) => store.status !== "archived");
  const calendarSummary = getAllStoresBusinessDaySummary(state, "company-1", currentCompanyStoresEquivalent, month);
  assert.equal(summary.completedDays, calendarSummary.completedDays, "営業進捗(summary)とカレンダー(businessDaySummary)の完了日数が一致しなければならない");
  assert.equal(summary.completedDays, 1);
});

test("getUnclosedStoresForDate: 営業対象なのに未締めの店舗名だけを返す(要件13)。店休日店舗・開店前店舗・停止済み店舗は対象外", () => {
  const month = "2026-08";
  const state = {
    ...createInitialAppState(),
    dayClosingStates: { "A店__2026-08": { "2026-08-10": true } },
    dailyResults: { "A店__2026-08": [{ date: "2026-08-10", totalSales: 1000 }] },
    storeHolidays: { "C店__2026-08": ["2026-08-10"] },
    storeStatusAuditLog: [{ storeId: "D店", action: "suspended", createdAt: "2026-08-05T00:00:00.000Z" }],
  };
  const stores = [
    { id: "A店", name: "A店", openingDate: "" }, // 締め済み
    { id: "B店", name: "B店", openingDate: "" }, // 未締め(営業対象)
    { id: "C店", name: "C店", openingDate: "" }, // その日は店休日 → 対象外
    { id: "D店", name: "D店", openingDate: "", status: "suspended" }, // 8/5に停止済み → 対象外
    { id: "E店", name: "E店", openingDate: "2026-08-20" }, // まだ開店前 → 対象外
  ];
  const result = getUnclosedStoresForDate(state, "company-1", stores, month, "2026-08-10");
  assert.deepEqual(result.applicableStoreNames.sort(), ["A店", "B店"]);
  assert.deepEqual(result.unclosedStoreNames, ["B店"]);
  assert.equal(result.isAllStoresHoliday, false);
});

test("getStoreHolidayDates / getAllStoresHolidayDates / isHolidayDate basic behavior", () => {
  const state = {
    ...createInitialAppState(),
    storeHolidays: { "A店__2026-08": ["2026-08-08"] },
    allStoresHolidays: { "company-1__2026-08": ["2026-08-09"] },
  };
  assert.deepEqual(getStoreHolidayDates(state, "A店", "2026-08"), ["2026-08-08"]);
  assert.deepEqual(getAllStoresHolidayDates(state, "company-1", "2026-08"), ["2026-08-09"]);
  assert.equal(isHolidayDate(getStoreHolidayDates(state, "A店", "2026-08"), "2026-08-08"), true);
  assert.equal(isHolidayDate(getStoreHolidayDates(state, "A店", "2026-08"), "2026-08-09"), false);
});

// migrateNameKeyedMapsToStoreId is the safety net that lets existing localStorage/tenant_
// snapshots data (saved before the store_id-keyed migration, so still keyed "storeName__month")
// keep working after the migration ships — normalizeAppState runs it unconditionally on every
// read. These tests are the actual "existing data isn't lost" guarantee, not just the new
// storeId-based lookups working going forward.

test("migrateNameKeyedMapsToStoreId rewrites storeName__month keys to storeId__month using the state's own companies list, across every affected map", () => {
  const state = {
    companies: [{ id: "company-1", stores: [{ id: "store-abc", name: "本店" }] }],
    dailyResults: { "本店__2026-08": [{ date: "2026-08-01", totalSales: 1000 }] },
    targets: { "本店__2026-08": { targetSales: 500000 } },
    fixedCosts: { "本店__2026-06": [{ id: "fc-1", amount: 1000 }] },
    variableCosts: { "本店__2026-08": [{ id: "vc-1", amount: 200 }] },
    monthClosing: { "本店__2026-08": [{ id: "mc-1", amount: 300 }] },
    monthClosingStatus: { "本店__2026-08": { closed: true } },
    businessDaySettings: { "本店__2026-08": { holidayCount: 4 } },
    dayClosingStates: { "本店__2026-08": { "2026-08-01": true } },
    dayClosingUpdatedAt: { "本店__2026-08": { "2026-08-01": "2026-08-01T00:00:00.000Z" } },
    storeHolidays: { "本店__2026-08": ["2026-08-15"] },
    dailyResultBackups: { "本店__2026-08": [{ date: "2026-08-01" }] },
  };

  const migrated = migrateNameKeyedMapsToStoreId(state);

  assert.deepEqual(migrated.dailyResults["store-abc__2026-08"], state.dailyResults["本店__2026-08"]);
  assert.deepEqual(migrated.targets["store-abc__2026-08"], state.targets["本店__2026-08"]);
  assert.deepEqual(migrated.fixedCosts["store-abc__2026-06"], state.fixedCosts["本店__2026-06"]);
  assert.deepEqual(migrated.variableCosts["store-abc__2026-08"], state.variableCosts["本店__2026-08"]);
  assert.deepEqual(migrated.monthClosing["store-abc__2026-08"], state.monthClosing["本店__2026-08"]);
  assert.deepEqual(migrated.monthClosingStatus["store-abc__2026-08"], state.monthClosingStatus["本店__2026-08"]);
  assert.deepEqual(migrated.businessDaySettings["store-abc__2026-08"], state.businessDaySettings["本店__2026-08"]);
  assert.deepEqual(migrated.dayClosingStates["store-abc__2026-08"], state.dayClosingStates["本店__2026-08"]);
  assert.deepEqual(migrated.dayClosingUpdatedAt["store-abc__2026-08"], state.dayClosingUpdatedAt["本店__2026-08"]);
  assert.deepEqual(migrated.storeHolidays["store-abc__2026-08"], state.storeHolidays["本店__2026-08"]);
  assert.deepEqual(migrated.dailyResultBackups["store-abc__2026-08"], state.dailyResultBackups["本店__2026-08"]);

  // The old name-keyed entry must not survive alongside the new one (no duplication/ambiguity).
  assert.equal(migrated.dailyResults["本店__2026-08"], undefined);
});

test("migrateNameKeyedMapsToStoreId is a no-op on data that's already storeId-keyed (idempotent)", () => {
  const state = {
    companies: [{ id: "company-1", stores: [{ id: "store-abc", name: "本店" }] }],
    dailyResults: { "store-abc__2026-08": [{ date: "2026-08-01", totalSales: 1000 }] },
  };
  const migrated = migrateNameKeyedMapsToStoreId(state);
  assert.deepEqual(migrated.dailyResults, state.dailyResults);
});

test("migrateNameKeyedMapsToStoreId returns state unchanged when there's no companies list to resolve names against (e.g. a fresh/unauthenticated blob)", () => {
  const state = { dailyResults: { "本店__2026-08": [{ date: "2026-08-01", totalSales: 1000 }] } };
  const migrated = migrateNameKeyedMapsToStoreId(state);
  assert.equal(migrated, state);
});

test("migrateNameKeyedMapsToStoreId: two different companies each having a store literally named 本店 no longer collide once migrated — each keeps its own id-keyed data", () => {
  const state = {
    companies: [
      { id: "company-1", stores: [{ id: "store-co1-honten", name: "本店" }] },
      { id: "company-2", stores: [{ id: "store-co2-honten", name: "本店" }] },
    ],
    // Simulates the pre-migration bug: both companies' "本店" wrote into the SAME name-keyed
    // slot, so only one ever survived. Post-migration each company's store gets its own key,
    // so this scenario can no longer happen going forward — this test locks in the id
    // resolution picking the FIRST store it encounters for a given name only as a safety
    // fallback, and documents that per-company disambiguation requires the id-keyed scheme
    // (not achievable by this repair pass alone for already-collided old data).
    dailyResults: { "本店__2026-08": [{ date: "2026-08-01", totalSales: 1000 }] },
  };
  const migrated = migrateNameKeyedMapsToStoreId(state);
  // Whichever company's store the resolver saw first wins the rewrite target — the key point is
  // it resolves to A real store's id, not to "本店" verbatim, and the entry isn't dropped.
  assert.equal(Object.keys(migrated.dailyResults).length, 1);
  const [resultKey] = Object.keys(migrated.dailyResults);
  assert.ok(resultKey === "store-co1-honten__2026-08" || resultKey === "store-co2-honten__2026-08");
});

test("normalizeAppState applies migrateNameKeyedMapsToStoreId automatically (this is what makes reading old localStorage/tenant_snapshots data safe)", () => {
  const normalized = normalizeAppState({
    companies: [{ id: "company-1", stores: [{ id: "store-abc", name: "本店" }] }],
    dailyResults: { "本店__2026-08": [{ date: "2026-08-01", totalSales: 1000 }] },
  });
  assert.deepEqual(normalized.dailyResults["store-abc__2026-08"], [{ date: "2026-08-01", totalSales: 1000 }]);
});

test("sanitizeNumericInputValue converts full-width Japanese digits/period to half-width (IME input on 在籍スタッフ数/生産性計算人数)", () => {
  assert.equal(sanitizeNumericInputValue("４"), "4");
  assert.equal(sanitizeNumericInputValue("１２"), "12");
  assert.equal(sanitizeNumericInputValue("５．５", { allowDecimal: true }), "5.5");
});

test("sanitizeNumericInputValue strips any other non-numeric characters instead of the browser's native <input type=number> badInput behavior (which reports an empty string and silently drops the typed value)", () => {
  assert.equal(sanitizeNumericInputValue("4人"), "4");
  assert.equal(sanitizeNumericInputValue("abc"), "");
  assert.equal(sanitizeNumericInputValue(""), "");
});

test("sanitizeNumericInputValue keeps at most one decimal point when allowDecimal is set, and strips decimals entirely otherwise", () => {
  assert.equal(sanitizeNumericInputValue("5.5.5", { allowDecimal: true }), "5.55");
  assert.equal(sanitizeNumericInputValue("5.5"), "55");
});

test("getMonthlyCashBreakdownRows builds one row per calendar day, correctly distinguishing 一致/差額/未入力/店休/総売上未入力 (not misreading any of them as ¥0)", () => {
  const state = {
    companies: [{ id: "company-1", stores: [{ id: "store-abc", name: "本店" }] }],
    storeHolidays: { "store-abc__2026-08": ["2026-08-10"] },
    dailyResults: {
      "store-abc__2026-08": [
        { date: "2026-08-01", totalSales: 100000 },
        { date: "2026-08-02", totalSales: 50000 },
        // 2026-08-04: no daily_sales entry at all (日計だけ入力されているケース)
      ],
    },
    cashBreakdownResults: {
      "store-abc__2026-08": {
        "2026-08-01": { cashAmount: 60000, cashlessAmount: 40000, pointAmount: 0 }, // 一致
        "2026-08-02": { cashAmount: 20000, cashlessAmount: 20000, pointAmount: 0 }, // 差額あり
        "2026-08-04": { cashAmount: 1000, cashlessAmount: 0, pointAmount: 0 }, // 総売上未入力
        // 2026-08-03: 日計未入力(dailyResultsにはあるが日計にはない)
        // 2026-08-10: 店休日、日計も未入力
      },
    },
  };

  const rows = getMonthlyCashBreakdownRows(state, "store-abc", "2026-08");
  assert.equal(rows.length, 31);

  const byDate = Object.fromEntries(rows.map((row) => [row.date, row]));

  assert.equal(byDate["2026-08-01"].status, "matched");
  assert.equal(byDate["2026-08-01"].isMatched, true);
  assert.equal(byDate["2026-08-01"].cashBreakdownTotal, 100000);
  assert.equal(byDate["2026-08-01"].weekday, "土");

  assert.equal(byDate["2026-08-02"].status, "mismatch");
  assert.equal(byDate["2026-08-02"].diff, 10000);

  assert.equal(byDate["2026-08-03"].status, "unfilled");
  assert.equal(byDate["2026-08-03"].hasCashBreakdown, false);
  // 未入力日はhasTotalSalesがtrueでも金額0として扱わない(hasComparisonがfalseになる)
  assert.equal(byDate["2026-08-03"].hasComparison, false);

  assert.equal(byDate["2026-08-04"].status, "no_sales_data");
  assert.equal(byDate["2026-08-04"].hasTotalSales, false);
  assert.equal(byDate["2026-08-04"].hasComparison, false);

  assert.equal(byDate["2026-08-10"].status, "holiday");
  assert.equal(byDate["2026-08-10"].isHoliday, true);
  assert.equal(byDate["2026-08-10"].hasCashBreakdown, false);
});

test("getMonthlyCashBreakdownRows never leaks another store's or another month's data into the current one", () => {
  const state = {
    companies: [{ id: "company-1", stores: [{ id: "store-a", name: "A店" }, { id: "store-b", name: "B店" }] }],
    dailyResults: {
      "store-b__2026-08": [{ date: "2026-08-01", totalSales: 999999 }],
      "store-a__2026-07": [{ date: "2026-07-01", totalSales: 888888 }],
    },
    cashBreakdownResults: {
      "store-b__2026-08": { "2026-08-01": { cashAmount: 999999, cashlessAmount: 0, pointAmount: 0 } },
    },
  };
  const rows = getMonthlyCashBreakdownRows(state, "store-a", "2026-08");
  rows.forEach((row) => {
    assert.equal(row.hasCashBreakdown, false);
    assert.equal(row.hasTotalSales, false);
  });
});

test("summarizeMonthlyCashBreakdown: 月間差額は日別差額の絶対値合計ではなく、月間総売上－月間日計合計で計算する", () => {
  const rows = [
    { cashAmount: 60000, cashlessAmount: 40000, pointAmount: 0, cashBreakdownTotal: 100000, totalSales: 100000 },
    { cashAmount: 20000, cashlessAmount: 20000, pointAmount: 0, cashBreakdownTotal: 40000, totalSales: 50000 }, // +10000差額
    { cashAmount: 30000, cashlessAmount: 30000, pointAmount: 0, cashBreakdownTotal: 60000, totalSales: 50000 }, // -10000差額
  ];
  const summary = summarizeMonthlyCashBreakdown(rows);
  assert.equal(summary.cashTotal, 110000);
  assert.equal(summary.cashlessTotal, 90000);
  assert.equal(summary.pointTotal, 0);
  assert.equal(summary.cashBreakdownGrandTotal, 200000);
  assert.equal(summary.salesTotal, 200000);
  // 日別の絶対値合計なら20000になるはずだが、正しくは相殺されて0
  assert.equal(summary.diffTotal, 0);
});

// ============================================================
// まとめて入力(daily_batch_entries)
// ============================================================

test("parseNullableNumber: 空文字/undefined/nullはnull、それ以外は数値(未入力と0を区別する)", () => {
  assert.equal(parseNullableNumber(""), null);
  assert.equal(parseNullableNumber(undefined), null);
  assert.equal(parseNullableNumber(null), null);
  assert.equal(parseNullableNumber("0"), 0);
  assert.equal(parseNullableNumber(0), 0);
  assert.equal(parseNullableNumber("1500"), 1500);
  assert.equal(parseNullableNumber("abc"), null);
});

test("dailyBatchEntryRowToEntry / buildBatchEntryStateFromRows: DB行のnullをそのままnullとして保持し、storeId__monthでキー化する", () => {
  const rows = [
    {
      id: "batch-1", store_id: "store-a", start_date: "2026-08-01", end_date: "2026-08-10",
      sales_amount: 1000000, technical_sales_amount: null, retail_sales_amount: null, other_sales_amount: null,
      customer_count: null, new_customer_count: null, repeat_customer_count: null, review_count: null,
      cash_amount: null, cashless_amount: null, point_amount: null, memo: "", updated_at: "2026-08-10T00:00:00Z",
    },
  ];
  const { dailyBatchEntries } = buildBatchEntryStateFromRows(rows);
  const key = buildMonthKey("store-a", "2026-08");
  assert.equal(dailyBatchEntries[key].length, 1);
  assert.equal(dailyBatchEntries[key][0].totalSales, 1000000);
  assert.equal(dailyBatchEntries[key][0].customers, null);
  assert.equal(dailyBatchEntries[key][0].cashAmount, null);

  const directEntry = dailyBatchEntryRowToEntry(rows[0]);
  assert.equal(directEntry.id, "batch-1");
  assert.equal(directEntry.startDate, "2026-08-01");
  assert.equal(directEntry.endDate, "2026-08-10");
  assert.equal(directEntry.totalSales, 1000000);
  assert.equal(directEntry.reviewCount, null);

  const state = { dailyBatchEntries };
  assert.deepEqual(getBatchEntriesForStoreMonth(state, "store-a", "2026-08"), dailyBatchEntries[key]);
  assert.deepEqual(getBatchEntriesForStoreMonth(state, "store-a", "2026-09"), []);
});

test("buildDailyBatchEntryPayload: 未入力項目はnullのまま保存する(0にしない)", () => {
  const fieldSettings = { fields: { technicalSales: true, retailSales: true, otherSales: false, customers: true, newCustomers: true, repeatCustomers: true, reviewCount: true } };
  const payload = buildDailyBatchEntryPayload({
    form: { startDate: "2026-08-01", endDate: "2026-08-10", totalSales: "500000", technicalSales: "500000", retailSales: "", customers: "", newCustomers: "", repeatCustomers: "", reviewCount: "" },
    fieldSettings,
  });
  assert.equal(payload.totalSales, 500000);
  assert.equal(payload.technicalSales, 500000);
  assert.equal(payload.retailSales, null); // 空欄は0ではなくnull
  assert.equal(payload.customers, null);
  assert.equal(payload.newCustomers, null);
});

test("ケースA: 売上のみまとめ入力 → 売上だけ月間集計へ反映され、客数・口コミ・日計には影響しない", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: 1000000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  const summary = calculateMonthSummary(state, store, month);
  assert.equal(summary.sales, 1000000);
  assert.equal(summary.customers, 0); // 客数はまとめ入力にも日次にも無いので0のまま(=未入力)
  assert.equal(summary.reviewCount, 0);
  // dailyResults(日別データ)には一切追加されていないことを確認(要件3: 日別データへ分割しない)。
  assert.deepEqual(state.dailyResults[key] || [], []);
});

test("ケースB: 8/1〜8/10まとめ入力(売上+客数) + 8/11以降の通常日次入力 → 月間累計が正しく合算される", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: 500000, technicalSales: null, retailSales: null, otherSales: null, customers: 50, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  state.dailyResults[key] = [
    { date: "2026-08-11", totalSales: 100000, customers: 10 },
    { date: "2026-08-12", totalSales: 120000, customers: 12 },
  ];
  const summary = calculateMonthSummary(state, store, month);
  assert.equal(summary.sales, 720000); // 500000 + 100000 + 120000
  assert.equal(summary.customers, 72); // 50 + 10 + 12
});

test("ケースC: 月途中利用開始(8/18〜) — 8/1〜8/17をまとめ入力、8/18以降を通常日次入力しても8月全体が正しく集計される", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-17", totalSales: 1700000, technicalSales: null, retailSales: null, otherSales: null, customers: 170, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  state.dailyResults[key] = [
    { date: "2026-08-18", totalSales: 90000, customers: 9 },
    { date: "2026-08-19", totalSales: 95000, customers: 10 },
  ];
  const summary = calculateMonthSummary(state, store, month);
  assert.equal(summary.sales, 1885000); // 1700000 + 90000 + 95000
  assert.equal(summary.customers, 189); // 170 + 9 + 10
  // 契約開始日より前だから入力できない、という制限は無い(dailyBatchEntriesへの直接代入が
  // 成功していること自体が「startDateに制約が無い」ことの確認)。
});

test("ケースD: 月1回(8/1〜8/31まとめ入力) → 月次売上は正常、日別売上を捏造しない", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-31", totalSales: 3100000, technicalSales: null, retailSales: null, otherSales: null, customers: 310, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  const summary = calculateMonthSummary(state, store, month);
  assert.equal(summary.sales, 3100000);
  assert.equal(summary.customers, 310);
  // dailyResultsは空のまま — 3100000を31日に均等配分するような日別レコードは一切作られない。
  assert.deepEqual(state.dailyResults[key] || [], []);
  assert.equal(summary.entries.length, 0);
});

test("ケースE: まとめ入力期間内に同じ項目(売上)の日次データを追加しようとすると重複警告", () => {
  const batchEntries = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: 1000000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  const dailyEntries = [];
  const conflicts = detectBatchEntryFieldOverlap({ dailyEntries, batchEntries, startDate: "2026-08-05", endDate: "2026-08-05", fieldKeys: ["sales"] });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].fieldKey, "sales");
  assert.equal(conflicts[0].batchConflict, true);
});

test("ケースF: まとめ売上のみ存在する期間に口コミの日次入力をしても重複警告は出ない(項目単位で判定)", () => {
  const batchEntries = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: 1000000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  const conflicts = detectBatchEntryFieldOverlap({ dailyEntries: [], batchEntries, startDate: "2026-08-05", endDate: "2026-08-05", fieldKeys: ["reviewCount"] });
  assert.equal(conflicts.length, 0);
});

test("逆ケース(要件8): 既存の日次売上がある期間に、まとめ売上を追加しようとすると重複警告", () => {
  const dailyEntries = [{ date: "2026-08-03", totalSales: 50000, technicalSales: 50000 }];
  const conflicts = detectBatchEntryFieldOverlap({ dailyEntries, batchEntries: [], startDate: "2026-08-01", endDate: "2026-08-10", fieldKeys: ["sales"] });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].dailyConflict, true);
});

test("ケースG: まとめ入力を削除すると、その数字だけ月間集計から消える(他のデータは無事)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: 1000000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
    { id: "b2", startDate: "2026-08-11", endDate: "2026-08-20", totalSales: 800000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  const beforeDelete = calculateMonthSummary(state, store, month);
  assert.equal(beforeDelete.sales, 1800000);

  // b1を削除した状態(削除操作自体はUI/DB層の責務なので、ここでは削除後のstateを模擬する)。
  state.dailyBatchEntries[key] = state.dailyBatchEntries[key].filter((entry) => entry.id !== "b1");
  const afterDelete = calculateMonthSummary(state, store, month);
  assert.equal(afterDelete.sales, 800000);
});

test("ケースH: 目標設定済み店舗でまとめ入力しても目標値は一切変わらず、達成率だけが更新される", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.targets[key] = { targetSales: 2000000 };

  const before = calculateMonthSummary(state, store, month);
  assert.equal(before.target.targetSales, 2000000);
  assert.equal(before.targetAchievement, 0);

  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-31", totalSales: 1000000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  const after = calculateMonthSummary(state, store, month);
  assert.equal(after.target.targetSales, 2000000); // 目標値は不変
  assert.equal(after.targetAchievement, 50); // 達成率だけ更新される(1000000/2000000)
});

test("ケースI: 日計だけまとめ入力 → 売上・客数には一切影響しない", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: null, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: 500000, cashlessAmount: null, pointAmount: null },
  ];
  const summary = calculateMonthSummary(state, store, month);
  assert.equal(summary.sales, 0);
  assert.equal(summary.customers, 0);
  // 日計(cashBreakdownResults)には一切書き込まれていない(daily_cash_breakdownと同じく
  // 完全に独立したデータ経路のまま)。
  assert.deepEqual(state.cashBreakdownResults?.[key] || {}, {});
});

test("ケースJ: 客数はまとめ入力+日次入力の合算、新規/再来のどちらか片方だけまとめ入力しても他方を0にしない", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: null, technicalSales: null, retailSales: null, otherSales: null, customers: 100, newCustomers: 30, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  const summary = calculateMonthSummary(state, store, month);
  assert.equal(summary.customers, 100);
  assert.equal(summary.newCustomers, 30);
  assert.equal(summary.repeatCustomers, 0); // 未入力のまま、0で確定してよい(repeatCustomers自体を勝手に埋めない)
});

test("getBusinessDayDatesInRange: 明示的な店休日カレンダーが設定されている場合、その日付だけを除外する", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  state.storeHolidays[buildMonthKey(store, month)] = ["2026-08-03", "2026-08-04"];
  const dates = getBusinessDayDatesInRange(state, store, "2026-08-01", "2026-08-05");
  assert.deepEqual(dates, ["2026-08-01", "2026-08-02", "2026-08-05"]);
});

test("要件17: まとめて入力の日は日締めが無くてもcompletedDays(営業進捗)に含まれ、forecast/averageDailySalesが0(異常値)にならない", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: 1000000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  const summary = calculateMonthSummary(state, store, month);
  // まとめ入力の10日分がcompletedDaysに直接含まれる(要件17: 営業進捗に「完了」として反映)。
  assert.equal(summary.completedDays, 10);
  // pace/forecast/averageDailySalesは既存の計算式のまま(completedDaysが増えたことで自動的に
  // 正しい値になる — 別のフォールバック値を経由しない)。
  assert.equal(summary.averageDailySales, 100000); // 1000000 / 10
  assert.ok(summary.forecast > 0);
  assert.equal(summary.displayForecast, summary.forecast);
  assert.equal(summary.displayAverageDailySales, summary.averageDailySales);
});

test("フォールバック(要件12・13・18の周辺ケース): まとめ入力の対象期間が全て既存の実日次データと重なり1日も配分できなかった場合でも、月間合計(sales)は既存データ+まとめ入力分で維持されつつdisplayForecastが0円にならない", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  // 8/1〜8/3は全て既存の実日次データ(未日締め)で埋まっている → まとめ入力はこの3日を
  // 配分対象から除外する(要件12・13: 既存データを保護)。
  state.dailyResults[key] = [
    { date: "2026-08-01", totalSales: 10000 },
    { date: "2026-08-02", totalSales: 10000 },
    { date: "2026-08-03", totalSales: 10000 },
  ];
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-03", totalSales: 300000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  const summary = calculateMonthSummary(state, store, month);
  assert.equal(summary.sales, 330000); // 30000(既存) + 300000(まとめ入力の期間合計、配分の成否に関わらず維持) — 要件18
  assert.equal(summary.completedDays, 0); // 配分できる日が無いのでcompletedDaysは増えない(既存の3日も未日締めのため)
  assert.equal(summary.forecast, 0); // 既存のforecastは変更しない
  assert.ok(summary.resultsCoverageBusinessDays > 0); // まとめ入力自体の対象日数(3日)は数えている
  assert.ok(summary.displayForecast > 0); // フォールバックにより異常値(0円)にはならない
});

test("calculateAllStoresMonthSummary: 各店舗のまとめ入力を正しく合算し、resultsCoverageBusinessDaysも店舗横断で合算する", () => {
  const state = createInitialAppState();
  const company = {
    id: "company-1",
    stores: [{ id: "store-a", name: "A店" }, { id: "store-b", name: "B店" }],
  };
  const month = "2026-08";
  state.dailyBatchEntries[buildMonthKey("store-a", month)] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-05", totalSales: 500000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  state.dailyResults[buildMonthKey("store-b", month)] = [
    { date: "2026-08-01", totalSales: 100000, customers: 10 },
  ];
  const summary = calculateAllStoresMonthSummary(state, company, month);
  assert.equal(summary.sales, 600000);
});

test("全店舗ビューでのpace/forecast不具合の修正: まとめ入力の日はcompletedDays(分母)に含まれるのに、その売上がclosedSales(分子)に足されておらず、個別店舗版より不当にpace/forecastが低く出ていた", () => {
  const state = createInitialAppState();
  const company = {
    id: "company-1",
    stores: [{ id: "store-a", name: "A店" }],
  };
  const month = "2026-08";
  // まとめ入力のみ(実日次データは無い) — 単一店舗版のcalculateMonthSummaryと同じ入力で、
  // 全店舗版でも同じ考え方(closedSales += batchSales)になっているかを比較する。
  state.dailyBatchEntries[buildMonthKey("store-a", month)] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: 1000000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];

  const singleStoreSummary = calculateMonthSummary(state, "store-a", month);
  const allStoresSummary = calculateAllStoresMonthSummary(state, company, month);

  assert.equal(allStoresSummary.sales, 1000000);
  // 修正前はここが0のままで、forecast/averageDailySales(内部のpaceに依存)が異常に低い
  // 値になっていた(closedSalesが0なのにcompletedDaysだけ10になっていたため)。
  assert.equal(allStoresSummary.closedSales, 1000000);
  assert.equal(allStoresSummary.completedDays, singleStoreSummary.completedDays); // どちらも10
  assert.equal(allStoresSummary.averageDailySales, 100000); // 1000000 / 10
  // 1店舗だけの会社なので、全店舗版のaverageDailySales/forecastは個別店舗版と一致するはず。
  assert.equal(allStoresSummary.averageDailySales, singleStoreSummary.averageDailySales);
  assert.equal(allStoresSummary.forecast, singleStoreSummary.forecast);
  assert.ok(allStoresSummary.forecast > 0);
});

// ============================================================
// まとめて入力: 日別配分(getBatchAllocatedEntries) — カレンダー連動・店休日再配分
// ============================================================

test("ケース1: 10日間まとめ入力 → 10件の配分エントリが返り、それぞれbatchEntryIdでこのまとめ入力を追跡できる(要件1・2)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = buildMonthKey(store, month);
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: 1000000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  const allocated = getBatchAllocatedEntries(state, store, month);
  assert.equal(allocated.length, 10);
  assert.ok(allocated.every((entry) => entry.batchEntryId === "b1" && entry.isBatchDerived === true));
  assert.equal(allocated.reduce((sum, entry) => sum + entry.totalSales, 0), 1000000); // 合計は期間合計と一致
  // カレンダー用の日付集合にも同じ10日が入る(要件1)。
  assert.equal(getBatchAllocatedDatesSet(state, store, month).size, 10);
});

test("ケース3: まとめ入力後に2日を店休日へ変更 → 残り8営業日へ自動再配分され、1日平均が再計算される。期間合計は変わらない(要件5・6・7・9)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = buildMonthKey(store, month);
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: 1000000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  const before = getBatchAllocatedEntries(state, store, month);
  assert.equal(before.length, 10);
  assert.equal(before.reduce((sum, entry) => sum + entry.totalSales, 0), 1000000);

  // 3日・7日を店休日に変更。
  state.storeHolidays[key] = ["2026-08-03", "2026-08-07"];
  const after = getBatchAllocatedEntries(state, store, month);
  assert.equal(after.length, 8); // 対象営業日8日
  assert.ok(!after.some((entry) => entry.date === "2026-08-03" || entry.date === "2026-08-07")); // 店休日には割り当てない(0円でもない、要件7)
  assert.equal(after.reduce((sum, entry) => sum + entry.totalSales, 0), 1000000); // 期間合計は不変(要件18)
  // 1,000,000 / 8 = 125,000円/日(プランの例と一致)。
  assert.ok(after.every((entry) => entry.totalSales === 125000));
});

test("ケース4: 店休日を1日解除 → 再び対象営業日に含まれ、最新の営業日設定を基準に再配分される(要件8)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = buildMonthKey(store, month);
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: 900000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  state.storeHolidays[key] = ["2026-08-03", "2026-08-07"];
  assert.equal(getBatchAllocatedEntries(state, store, month).length, 8);

  // 8/3の店休日を解除。
  state.storeHolidays[key] = ["2026-08-07"];
  const after = getBatchAllocatedEntries(state, store, month);
  assert.equal(after.length, 9); // 対象営業日9日に戻る
  assert.ok(after.some((entry) => entry.date === "2026-08-03")); // 解除した日が対象に戻っている
  assert.equal(after.reduce((sum, entry) => sum + entry.totalSales, 0), 900000); // 合計は不変
});

test("ケース6・要件12・13: 期間内に既存の実日次入力がある日は配分対象から除外され、残りの日数で再配分される(既存データは上書きしない)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = buildMonthKey(store, month);
  // 5日は既に実日次入力済み。
  state.dailyResults[key] = [{ date: "2026-08-05", totalSales: 50000, customers: 5 }];
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: 900000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  const allocated = getBatchAllocatedEntries(state, store, month);
  assert.equal(allocated.length, 9); // 10日中、既存データがある5日を除いた9日
  assert.ok(!allocated.some((entry) => entry.date === "2026-08-05")); // 5日はまとめ入力の対象外
  assert.equal(allocated.reduce((sum, entry) => sum + entry.totalSales, 0), 900000); // まとめ入力の期間合計自体は変わらない
});

test("ケース7・要件14: まとめ入力対象期間が既存の別のまとめ入力と重複しても、同じ日が二重に配分されない", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = buildMonthKey(store, month);
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-05", totalSales: 500000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
    { id: "b2", startDate: "2026-08-03", endDate: "2026-08-08", totalSales: 600000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  const allocated = getBatchAllocatedEntries(state, store, month);
  const dates = allocated.map((entry) => entry.date);
  // 同じ日付が2回配分されていないこと(気付かないまま二重計上されない、要件14)。
  assert.equal(new Set(dates).size, dates.length);
  // 開始日が早いb1(8/1〜8/5)が8/3〜8/5を先に確保し、b2(8/3〜8/8)は残りの8/6〜8/8だけを得る。
  const b1Dates = allocated.filter((e) => e.batchEntryId === "b1").map((e) => e.date).sort();
  const b2Dates = allocated.filter((e) => e.batchEntryId === "b2").map((e) => e.date).sort();
  assert.deepEqual(b1Dates, ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]);
  assert.deepEqual(b2Dates, ["2026-08-06", "2026-08-07", "2026-08-08"]);
});

test("ケース8・要件6・11: 客数31人/10日のような割り切れない整数項目は、最大剰余法で合計が31人になるよう配分される(単純に3.1人を保存しない)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = buildMonthKey(store, month);
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-10", totalSales: null, technicalSales: null, retailSales: null, otherSales: null, customers: 31, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  const allocated = getBatchAllocatedEntries(state, store, month);
  assert.equal(allocated.length, 10);
  const customerCounts = allocated.map((entry) => entry.customers);
  assert.ok(customerCounts.every((count) => Number.isInteger(count))); // 全て整数(3.1人のような小数は無い)
  assert.equal(customerCounts.reduce((sum, count) => sum + count, 0), 31); // 合計は必ず31人
  assert.equal(customerCounts.filter((count) => count === 4).length, 1); // 4人の日が1日
  assert.equal(customerCounts.filter((count) => count === 3).length, 9); // 3人の日が9日
});

test("要件4: まとめ入力を削除する(=配列から取り除く)と、その回のまとめ入力分だけが配分対象から消え、対象日は通常の日次入力ができる状態に戻る", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = buildMonthKey(store, month);
  state.dailyBatchEntries[key] = [
    { id: "b1", startDate: "2026-08-01", endDate: "2026-08-05", totalSales: 500000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
    { id: "b2", startDate: "2026-08-11", endDate: "2026-08-15", totalSales: 400000, technicalSales: null, retailSales: null, otherSales: null, customers: null, newCustomers: null, repeatCustomers: null, reviewCount: null, cashAmount: null, cashlessAmount: null, pointAmount: null },
  ];
  assert.equal(getBatchAllocatedEntries(state, store, month).length, 10); // 5日+5日

  // b1だけ削除。
  state.dailyBatchEntries[key] = state.dailyBatchEntries[key].filter((entry) => entry.id !== "b1");
  const afterDelete = getBatchAllocatedEntries(state, store, month);
  assert.equal(afterDelete.length, 5); // b2の5日だけ残る
  assert.ok(afterDelete.every((entry) => entry.batchEntryId === "b2"));
  // b1が占有していた8/1〜8/5は、getBatchAllocatedDatesSetからも消えている(=通常の日次入力ができる状態に戻る)。
  const dateSet = getBatchAllocatedDatesSet(state, store, month);
  assert.ok(!dateSet.has("2026-08-01"));
  assert.ok(!dateSet.has("2026-08-05"));
});

test("getBusinessDaySummary: まとめ入力を使わない店舗の既存挙動は完全に無変更(まとめ入力データが無ければcompletedDaysは従来通り)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.businessDaySettings[key] = { holidayCount: 2, mode: "auto" };
  state.dailyResults[key] = [{ id: "e1", date: "2026-08-01", totalSales: 10000 }];
  state.dayClosingStates[key] = { "2026-08-01": true };
  const summary = getBusinessDaySummary(state, store, month);
  assert.equal(summary.businessDayCount, 29);
  assert.equal(summary.completedDays, 1);
  assert.equal(summary.remainingBusinessDays, 28);
});

// 「全店舗共通『更新中・画面点滅』不具合 根本修正」対応分の回帰テスト。
//
// 根本原因は、appStateの自動保存(persist)effectが「前回persistした内容と今のappStateが
// 同じか」をJSON.stringifyの文字列比較だけで判定していたが、比較していた2つの値の「形」
// そのものが最初から一致し得ない設計だったこと: hydrate完了時にセットする比較用シグネチャは
// overlay(日次売上・目標・固定費等の専用テーブル取得結果)適用前のnextRemoteStateから作って
// いたのに対し、persist effect側は実際のappState(overlay適用後、常により多くのデータを含む)
// から作っていたため、hydrateのたびに必ず「変化あり」と誤検知していた。加えて、各テーブルの
// SELECTにORDER BYが無く、内容が同一でも配列の並び順だけで別内容と誤判定される要因も
// 重なっていた。結果、書き込み→Supabase Realtimeが自分自身の書き込みを検知して再hydrate→
// また誤検知→書き込み……という自己増殖ループになり、「更新中」バナーが点滅し続けていた。
test("canonicalStringifyForComparison: 配列要素の並び順が違うだけの内容は同じ文字列になる(更新中無限点滅バグの直接の原因だった誤検知を防ぐ)", () => {
  const a = { dailyResults: { "A店__2026-08": [{ id: "1", date: "2026-08-01" }, { id: "2", date: "2026-08-02" }] } };
  const b = { dailyResults: { "A店__2026-08": [{ id: "2", date: "2026-08-02" }, { id: "1", date: "2026-08-01" }] } };
  assert.equal(canonicalStringifyForComparison(a), canonicalStringifyForComparison(b));
});

test("canonicalStringifyForComparison: オブジェクトのキー順が違うだけの内容は同じ文字列になる", () => {
  const a = { currentCompanyId: "c1", selectedStore: "A店", selectedMonth: "2026-08" };
  const b = { selectedMonth: "2026-08", currentCompanyId: "c1", selectedStore: "A店" };
  assert.equal(canonicalStringifyForComparison(a), canonicalStringifyForComparison(b));
});

test("canonicalStringifyForComparison: 実際に内容が違う場合は違う文字列になる(誤って『変化なし』と握りつぶさない)", () => {
  const a = { selectedStore: "A店" };
  const b = { selectedStore: "B店" };
  assert.notEqual(canonicalStringifyForComparison(a), canonicalStringifyForComparison(b));
  const c = { dailyResults: { "A店__2026-08": [{ id: "1", date: "2026-08-01" }] } };
  const d = { dailyResults: { "A店__2026-08": [{ id: "1", date: "2026-08-01" }, { id: "2", date: "2026-08-02" }] } };
  assert.notEqual(canonicalStringifyForComparison(c), canonicalStringifyForComparison(d));
});

test("buildPersistenceComparableState: companySnapshots内の入れ子companySnapshotsだけを取り除き、それ以外はそのまま保持する", () => {
  const state = {
    selectedStore: "A店",
    companySnapshots: {
      "company-1": { selectedStore: "A店", companySnapshots: { "company-1": { selectedStore: "古い値" } } },
    },
  };
  const result = buildPersistenceComparableState(state);
  assert.equal(result.selectedStore, "A店");
  assert.equal(result.companySnapshots["company-1"].selectedStore, "A店");
  assert.equal(result.companySnapshots["company-1"].companySnapshots, undefined);
});

test("回帰再現: overlay適用前(nextRemoteState相当、店舗選択等のフィールドを含まない)と適用後(merged相当、含む)を同じ変換で比較すると『違う』と正しく判定され、hydrate直後は必ず1回だけ再同期が必要と判定できる一方、2回目以降(mergedどうしの比較)は内容が同じなら『同じ』と判定され、無限ループへ発展しない", () => {
  // 比較対象のフィールドはbuildPersistenceComparableStateが除外しない(=tenant_snapshotsの
  // payloadに実際含まれる)ものを使う——dailyResults等の除外対象フィールドでは、この
  // シナリオ自体が起こり得なくなった(下の専用テスト参照)。
  const nextRemoteStateShaped = { selectedStore: "", currentCompanyId: "c1" }; // overlay適用前
  const mergedShaped = { selectedStore: "A店", currentCompanyId: "c1" }; // overlay適用後(店舗名が確定した状態)
  // 修正前の実装が比較していた2つの値: 形が違うため必ず「違う」と判定され続けていた。
  const oldSignature = canonicalStringifyForComparison(buildPersistenceComparableState(nextRemoteStateShaped));
  const persistSignature = canonicalStringifyForComparison(buildPersistenceComparableState(mergedShaped));
  assert.notEqual(oldSignature, persistSignature, "修正前の形の食い違いを再現(このズレ自体が誤検知の原因だった)");

  // 修正後: 両方ともmerged相当(実際にappStateへ入る形)から作るため、内容が同じなら2回目以降は
  // 一致し、書き込み→Realtime再取得→書き込み……のループが発生しない。
  const hydrateSignature = canonicalStringifyForComparison(buildPersistenceComparableState(mergedShaped));
  const persistEffectSignatureNextTick = canonicalStringifyForComparison(buildPersistenceComparableState(mergedShaped));
  assert.equal(hydrateSignature, persistEffectSignatureNextTick, "修正後は同じ形どうしを比較するため、内容が同じなら一致し、無限ループへ発展しない");
});

// 文字入力時の画面ガクつき調査(月次レビュー)で発見した問題の回帰テスト: buildTenantSnapshotRow
// (supabaseRemote.js)が独自テーブルを持つ(=tenant_snapshotsのpayloadに含めない)フィールドと
// 完全に同じ一覧を、この比較関数でも除外できているかを直接検証する。除外できていないと、
// これらのフィールドだけが変わった場合でも「差分あり」と誤判定され、実際には中身が1バイトも
// 変わらない無駄なtenant_snapshots書き込み→Realtime自己通知→自分自身の再取得、という連鎖が
// 発生する(月次レビューの保存後、数秒遅れて画面全体がガクつく不具合の真因だった)。
test("buildPersistenceComparableState: monthlyReviews/dailyResults等、独自のSupabaseテーブルを持ちtenant_snapshotsのpayloadに含まれないフィールドは比較対象から除外され、その変更だけでは「差分あり」と判定されない(無駄な書き込み・Realtime自己通知・再取得連鎖の防止)", () => {
  const baseState = { selectedStore: "A店", currentCompanyId: "c1" };
  const excludedFieldChanges = {
    dailyResults: { "A店__2026-08": [{ id: "1", date: "2026-08-01" }] },
    targets: { "A店__2026-08": { targetSales: 1000000 } },
    fixedCosts: { "A店__2026-08": [{ id: "f1", name: "家賃" }] },
    costMonthlyAmounts: { "cost-1__2026-08": 50000 },
    storeInventoryBalances: { "A店__2026-08": 10000 },
    storeMonthlyCostOverrides: { "A店__2026-08": { laborCostOverride: 2150000 } },
    variableCosts: { "A店__2026-08": [{ id: "v1" }] },
    monthClosing: { "A店__2026-08": [] },
    monthClosingStatus: { "A店__2026-08": { closed: true } },
    storeHolidays: { "A店__2026-08": ["2026-08-01"] },
    allStoresTargets: { "c1__2026-08": { targetSales: 5000000 } },
    allStoresBusinessDaySettings: { "c1__2026-08": {} },
    allStoresHolidays: { "c1__2026-08": [] },
    monthlyReviews: { "c1::A店::2026-08": { reflection: "今月は好調でした" } },
    storeStatusAuditLog: [{ storeId: "s1", status: "suspended" }],
    cashBreakdownResults: { "A店__2026-08": { "2026-08-01": { cashAmount: 1000 } } },
    dailyBatchEntries: { "A店__2026-08": [{ id: "b1" }] },
    businessDaySettings: { "A店__2026-08": { mode: "auto" } },
    dayClosingStates: { "A店__2026-08": { "2026-08-01": true } },
    dayClosingUpdatedAt: { "A店__2026-08": { "2026-08-01": "2026-08-01T00:00:00Z" } },
    dailyResultBackups: { "A店__2026-08": [{ id: "bk1" }] },
  };
  const baseSignature = canonicalStringifyForComparison(buildPersistenceComparableState(baseState));
  for (const [field, value] of Object.entries(excludedFieldChanges)) {
    const changedSignature = canonicalStringifyForComparison(buildPersistenceComparableState({ ...baseState, [field]: value }));
    assert.equal(changedSignature, baseSignature, `${field}だけの変更は比較シグネチャに影響してはいけない(tenant_snapshotsのpayloadに含まれないため)`);
  }
  // 対照: tenant_snapshotsのpayloadに実際に含まれるフィールド(例: selectedStore)の変更は、
  // これまで通り正しく「差分あり」と判定される(除外し過ぎていないことの確認)。
  const realChangeSignature = canonicalStringifyForComparison(buildPersistenceComparableState({ ...baseState, selectedStore: "B店" }));
  assert.notEqual(realChangeSignature, baseSignature, "tenant_snapshotsのpayloadに含まれるフィールドの変更は引き続き検知されるべき");
});

// 「月次レビュー機能」対応分のテスト。

test("getMonthlyReviewSummary(単一店舗): 前月データが無い場合はhasPrevious:falseになり、全ての比較項目のdiffがnull(『比較データなし』)になる(0/NaN/Infinityを絶対に出さない)", () => {
  const state = createInitialAppState();
  const store = "A店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyResults[key] = [{ id: "e1", date: "2026-08-01", totalSales: 100000, technicalSales: 80000, retailSales: 20000, customers: 10, newCustomers: 4, repeatCustomers: 6 }];
  state.dayClosingStates[key] = { "2026-08-01": true };
  // 前月(2026-07)は日次入力が1件も無い。

  const summary = getMonthlyReviewSummary(state, { storeId: store, isAllStoresView: false, storeEntity: { id: store, name: store } }, month);
  assert.equal(summary.hasPrevious, false);
  assert.equal(summary.sales.current, 100000);
  assert.equal(summary.sales.previous, null);
  assert.equal(summary.sales.diff, null);
  assert.equal(summary.customers.diff, null);
  assert.equal(summary.averageSpend.diff, null);
  assert.equal(summary.newCustomers.diff, null);
  assert.equal(summary.repeatCustomers.diff, null);
  // Number.isFinite(null)はfalseなので、diffがnullである以上NaN/Infinityが紛れ込む余地は無い。
  assert.ok(!Number.isFinite(summary.sales.diff));
});

test("getMonthlyReviewSummary(単一店舗): 前月に実データ(0円の日を含む)があれば、0は『未入力』ではなく実際の値として比較に使われる(要件12)", () => {
  const state = createInitialAppState();
  const store = "A店";
  const month = "2026-08";
  const currentKey = `${store}__${month}`;
  const previousKey = `${store}__2026-07`;
  state.dailyResults[currentKey] = [{ id: "e1", date: "2026-08-01", totalSales: 110000, customers: 11 }];
  state.dayClosingStates[currentKey] = { "2026-08-01": true };
  // 前月: 実際に日次入力はあるが売上0円で確定登録された日(臨時休業等で0円を正式入力したケース)。
  state.dailyResults[previousKey] = [{ id: "e0", date: "2026-07-01", totalSales: 0, customers: 0 }];
  state.dayClosingStates[previousKey] = { "2026-07-01": true };

  const summary = getMonthlyReviewSummary(state, { storeId: store, isAllStoresView: false, storeEntity: { id: store, name: store } }, month);
  assert.equal(summary.hasPrevious, true, "前月に実データ(0円でも)が1件あるので比較対象になる");
  assert.equal(summary.sales.previous, 0);
  // diffPercent自体はprevious===0の場合nullを返す仕様(0除算を避けるため) — これは意図的な
  // 「0からの伸び率は定義できない」という既存仕様(diffPercentのコメント参照)であり、
  // 「未入力を0として集計した」こととは別の話。
  assert.equal(summary.sales.diff, null);
});

// 不具合修正(フィーネ横浜の実例): 前月の売上が「まとめて入力」1件だけで構成されている
// 場合(通常の日次入力=daily_sales由来のentriesはゼロ件)でも、月次レビューの前月比較が
// 「比較データなし」にならないことを保証する回帰テスト。
test("getMonthlyReviewSummary(単一店舗): 前月の実績がまとめて入力(daily_batch_entries)だけで構成されていても、hasPrevious:trueになり前月比較が機能する(まとめ入力オンリーの月が『比較データなし』になっていた不具合の再発防止)", () => {
  const state = createInitialAppState();
  const store = "フィーネ横浜";
  const month = "2026-08";
  const previousKey = `${store}__2026-07`;
  state.dailyResults[`${store}__${month}`] = [{ id: "e1", date: "2026-08-01", totalSales: 300000, technicalSales: 280000, retailSales: 20000, customers: 20 }];
  // 前月(2026-07)は通常の日次入力を一切使わず、月初〜月末をまとめて入力した1件だけで
  // 構成されている(daily_sales側のentriesは存在しない)。
  state.dailyBatchEntries[previousKey] = [{
    id: "batch-1", startDate: "2026-07-01", endDate: "2026-07-31",
    totalSales: 14893161, technicalSales: 14528550, retailSales: 364611, otherSales: null,
    customers: 610, newCustomers: null, repeatCustomers: null, reviewCount: null,
  }];

  const summary = getMonthlyReviewSummary(state, { storeId: store, isAllStoresView: false, storeEntity: { id: store, name: store } }, month);

  assert.equal(summary.hasPrevious, true);
  assert.equal(summary.sales.previous, 14893161);
  assert.equal(summary.technicalSales.previous, 14528550);
  assert.equal(summary.retailSales.previous, 364611);
  assert.equal(summary.customers.previous, 610);
});

test("getStoreMonthSalesTotal: まとめて入力だけの月もhasEntries:trueになる(店舗ランキングの『先月』表示が消えていた不具合の再発防止)", () => {
  const state = createInitialAppState();
  const store = "フィーネ横浜";
  const month = "2026-07";
  state.dailyBatchEntries[`${store}__${month}`] = [{
    id: "batch-1", startDate: "2026-07-01", endDate: "2026-07-31",
    totalSales: 14893161, technicalSales: 14528550, retailSales: 364611, otherSales: null,
    customers: 610, newCustomers: null, repeatCustomers: null, reviewCount: null,
  }];

  const result = getStoreMonthSalesTotal(state, store, month);

  assert.equal(result.hasEntries, true);
  assert.equal(result.sales, 14893161);
});

test("getStoreDashboardRows: 前月の実績がまとめて入力だけで構成されていてもhasPrevious:trueになる(月次ダッシュボード・CSVの前月比が消えていた不具合の再発防止)", () => {
  const state = createInitialAppState();
  const store = { id: "store-1", name: "フィーネ横浜", settings: {} };
  const company = { id: "company-1", stores: [store] };
  const month = "2026-08";
  const previousKey = `${store.id}__2026-07`;
  state.dailyResults[`${store.id}__${month}`] = [{ id: "e1", date: "2026-08-01", totalSales: 300000, customers: 20 }];
  state.dailyBatchEntries[previousKey] = [{
    id: "batch-1", startDate: "2026-07-01", endDate: "2026-07-31",
    totalSales: 14893161, technicalSales: 14528550, retailSales: 364611, otherSales: null,
    customers: 610, newCustomers: null, repeatCustomers: null, reviewCount: null,
  }];

  const rows = getStoreDashboardRows(state, company, month);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].previous.hasPrevious, true);
  assert.equal(rows[0].previous.sales, 14893161);
});

test("getMonthlyReviewSummary(単一店舗): 目標売上・達成率(要件1)。目標が未設定の場合はtargetAchievementもnullにする", () => {
  const state = createInitialAppState();
  const store = "A店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyResults[key] = [{ id: "e1", date: "2026-08-01", totalSales: 500000, customers: 20 }];
  state.dayClosingStates[key] = { "2026-08-01": true };
  state.targets[key] = { targetSales: 1000000 };

  const withTarget = getMonthlyReviewSummary(state, { storeId: store, isAllStoresView: false, storeEntity: { id: store, name: store } }, month);
  assert.equal(withTarget.hasSalesTarget, true);
  assert.equal(withTarget.targetSales, 1000000);
  assert.equal(withTarget.targetAchievement, 50);

  delete state.targets[key];
  const withoutTarget = getMonthlyReviewSummary(state, { storeId: store, isAllStoresView: false, storeEntity: { id: store, name: store } }, month);
  assert.equal(withoutTarget.hasSalesTarget, false);
  assert.equal(withoutTarget.targetAchievement, null);
});

test("getMonthlyReviewSummary(単一店舗): 目標口コミ数がONの店舗だけreviewCountを表示し、OFFの店舗はnullにする", () => {
  const state = createInitialAppState();
  const store = "A店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyResults[key] = [{ id: "e1", date: "2026-08-01", totalSales: 100000, customers: 10, reviewCount: 3 }];
  state.dayClosingStates[key] = { "2026-08-01": true };
  state.targets[key] = { targetReviewCount: 5 };

  const storeWithReviewOn = { id: store, name: store, settings: { monthlyTargetFields: { fields: { targetReviewCount: true } } } };
  const onResult = getMonthlyReviewSummary(state, { storeId: store, isAllStoresView: false, storeEntity: storeWithReviewOn }, month);
  assert.equal(onResult.showReviewCountTarget, true);
  assert.equal(onResult.reviewCount.current, 3);
  assert.equal(onResult.targetReviewCount, 5);
  assert.equal(onResult.reviewCountAchievement, 60);

  const storeWithReviewOff = { id: store, name: store, settings: { monthlyTargetFields: { fields: { targetReviewCount: false } } } };
  const offResult = getMonthlyReviewSummary(state, { storeId: store, isAllStoresView: false, storeEntity: storeWithReviewOff }, month);
  assert.equal(offResult.showReviewCountTarget, false);
  assert.equal(offResult.reviewCount, null);
  assert.equal(offResult.targetReviewCount, null);
});

test("getMonthlyReviewSummary(単一店舗): スタッフ数・生産性計算人数のどちらも未設定の店舗はproductivity:null(要件: 利用している店舗だけ表示)", () => {
  const state = createInitialAppState();
  const store = "A店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyResults[key] = [{ id: "e1", date: "2026-08-01", totalSales: 300000, customers: 10 }];
  state.dayClosingStates[key] = { "2026-08-01": true };

  const noStaff = getMonthlyReviewSummary(state, { storeId: store, isAllStoresView: false, storeEntity: { id: store, name: store } }, month);
  assert.equal(noStaff.hasStaffProductivity, false);
  assert.equal(noStaff.productivity, null);

  const withStaff = getMonthlyReviewSummary(state, { storeId: store, isAllStoresView: false, storeEntity: { id: store, name: store, staffCount: 5 } }, month);
  assert.equal(withStaff.hasStaffProductivity, true);
  assert.equal(withStaff.productivity.current, 60000);
});

test("getMonthlyReviewSummary(全店舗ビュー): 加盟店を混ぜず自社店舗だけを集計する(company.storesは呼び出し元が自社分だけを渡す既存の仕様に従う)", () => {
  const state = createInitialAppState();
  const month = "2026-08";
  ["原宿", "吉祥寺"].forEach((store) => {
    const key = `${store}__${month}`;
    state.dailyResults[key] = [{ id: `e-${store}`, date: "2026-08-01", totalSales: 100000, customers: 10 }];
    state.dayClosingStates[key] = { "2026-08-01": true };
  });
  const company = { id: "company-1", stores: [{ id: "原宿", name: "原宿" }, { id: "吉祥寺", name: "吉祥寺" }] };

  const summary = getMonthlyReviewSummary(state, { isAllStoresView: true, company, companyStores: company.stores }, month);
  // 2店舗分(10万円×2)だけが合算され、加盟店等の外部データは一切混ざらない。
  assert.equal(summary.sales.current, 200000);
  assert.equal(summary.customers.current, 20);
  assert.equal(summary.hasStaffProductivity, false, "全店舗ビューではスタッフ生産性セクションは表示しない");
});

test("getMonthlyReviewSummary: 利益・営業利益・利益率にあたるフィールドは戻り値に一切含まれない(要件13)", () => {
  const state = createInitialAppState();
  const store = "A店";
  const month = "2026-08";
  const key = `${store}__${month}`;
  state.dailyResults[key] = [{ id: "e1", date: "2026-08-01", totalSales: 100000, customers: 10 }];
  state.dayClosingStates[key] = { "2026-08-01": true };
  const summary = getMonthlyReviewSummary(state, { storeId: store, isAllStoresView: false, storeEntity: { id: store, name: store } }, month);
  const forbiddenKeys = ["operatingProfit", "operatingMargin", "grossProfit", "profit", "laborCost", "expenseCost", "costOfGoodsSold"];
  forbiddenKeys.forEach((forbiddenKey) => {
    assert.ok(!(forbiddenKey in summary), `${forbiddenKey} は月次レビューのサマリーに含めてはいけない`);
  });
});

test("buildMonthlyReviewKey: storeId指定時は店舗別キー、未指定時は会社全体キーになる(要件6: 店舗Aと店舗Bと全社のレビューが混ざらない)", () => {
  assert.equal(buildMonthlyReviewKey("company-1", "store-a", "2026-08"), "store-a__2026-08");
  assert.equal(buildMonthlyReviewKey("company-1", "store-b", "2026-08"), "store-b__2026-08");
  assert.equal(buildMonthlyReviewKey("company-1", "", "2026-08"), "company-1__2026-08");
  assert.notEqual(buildMonthlyReviewKey("company-1", "store-a", "2026-08"), buildMonthlyReviewKey("company-1", "store-b", "2026-08"));
});

test("buildMonthlyReviewStateFromRows / getMonthlyReviewText: DB行から店舗別・全社別のマップを正しく再構築し、対象月を変更して戻ってもレビュー文章が復元される", () => {
  const rows = [
    { company_id: "company-1", store_id: "store-a", target_month: "2026-08", reflection: "店舗Aの8月振り返り", challenges: "", improvements: "", next_actions: "", updated_at: "2026-08-20T00:00:00Z" },
    { company_id: "company-1", store_id: "store-a", target_month: "2026-07", reflection: "店舗Aの7月振り返り", challenges: "", improvements: "", next_actions: "", updated_at: "2026-07-20T00:00:00Z" },
    { company_id: "company-1", store_id: null, target_month: "2026-08", reflection: "全社の8月振り返り", challenges: "", improvements: "", next_actions: "", updated_at: "2026-08-20T00:00:00Z" },
  ];
  const { monthlyReviews } = buildMonthlyReviewStateFromRows(rows);
  const state = { monthlyReviews };

  assert.equal(getMonthlyReviewText(state, { companyId: "company-1", storeId: "store-a" }, "2026-08").reflection, "店舗Aの8月振り返り");
  // 2026-08 → 2026-07 → 2026-08 と対象月を切り替えても、それぞれ正しい文章が復元される。
  assert.equal(getMonthlyReviewText(state, { companyId: "company-1", storeId: "store-a" }, "2026-07").reflection, "店舗Aの7月振り返り");
  assert.equal(getMonthlyReviewText(state, { companyId: "company-1", storeId: "store-a" }, "2026-08").reflection, "店舗Aの8月振り返り");
  // 全社レビューは店舗Aのレビューと混ざらない。
  assert.equal(getMonthlyReviewText(state, { companyId: "company-1", storeId: "" }, "2026-08").reflection, "全社の8月振り返り");
});

test("getMonthlyReviewText: 未保存の月は空文字のフォームを返す(存在しないキーでも例外を投げない)", () => {
  const state = createInitialAppState();
  const result = getMonthlyReviewText(state, { companyId: "company-1", storeId: "store-a" }, "2026-08");
  assert.deepEqual(result, { reflection: "", challenges: "", improvements: "", next_actions: "", updatedAt: "" });
});

// 「複数アカウントでログイン後にアプリが開けない障害」の再発防止テスト群。
// resolvePreferredStoreSelectionは元々App.jsxコンポーネント内の生のconstで単体テストできな
// かった(この障害調査を機にstorage.jsへexport化した)——ログイン直後にどの会社・店舗を開くか
// を決める、認証後の共通初期化フローの中核ロジック。

test("再招待シナリオ: staffとして招待→削除→同じメールで再招待→管理者権限へ変更→ログイン、で新しい所属先(店舗の無い会社全体)が正しく開く", () => {
  // 招待フロー整理ラウンドで確認済みの通り、削除は行(profiles/user_stores)ごと消えるため、
  // 「再招待→権限変更」後のログインでtenantStateに残るのは新しいcompany_admin行だけ——
  // 古いstaff行由来のselectedStoreId等が残っていないことを確認する。
  const tenantState = {
    companies: [{ id: "company-1", stores: [{ id: "store-a", name: "A店" }, { id: "store-b", name: "B店" }] }],
    selectedStore: "A店", // loadTenantStateFromSupabaseの既定(先頭店舗)
    selectedStoreId: "store-a",
  };
  // localStorageには古いstaff時代の所属店舗(B店)が残っている、というケース。
  const localRecoveredState = { selectedStore: "B店", selectedStoreId: "store-b" };
  const result = resolvePreferredStoreSelection({ tenantState, localRecoveredState, currentCompanyId: "company-1", role: "company_admin" });
  // company_adminはどの店舗でも編集可能なので、古いキャッシュのB店がそのまま(id一致で)
  // 復元されて問題ない——「クラッシュしない」「有効な店舗が返る」ことが本質。
  assert.equal(result.selectedStoreId, "store-b");
  assert.equal(result.selectedStore, "B店");
});

test("重複membership相当のケース: localStorageに別会社の古いselectedStoreIdが残っていても、現在の会社(currentCompanyId)の店舗一覧だけを基準に解決する(古い所属で決め打ちしない)", () => {
  const tenantState = {
    companies: [
      { id: "company-intro", stores: [{ id: "intro-store", name: "INTRO" }] },
      { id: "company-fine", stores: [{ id: "fine-a", name: "フィーネ原宿" }, { id: "fine-b", name: "フィーネ横浜" }] },
    ],
    selectedStore: "フィーネ原宿",
    selectedStoreId: "fine-a",
  };
  // 古いINTRO時代のselectedStoreIdがlocalStorageに残っている(=INTRO所属だった頃のキャッシュ)。
  const localRecoveredState = { selectedStore: "INTRO", selectedStoreId: "intro-store" };
  const result = resolvePreferredStoreSelection({ tenantState, localRecoveredState, currentCompanyId: "company-fine", role: "company_admin" });
  // currentCompanyId(フィーネ)のtargetStoresの中にintro-storeは存在しないため、id一致は
  // 失敗し、名前一致(INTROという名前の店舗もフィーネには無い)も失敗——tenantState自身の
  // 既定値(フィーネ原宿)へ正しくフォールバックする。古い会社の店舗IDをそのまま使ってしまう
  // (=会社をまたいだデータ混在)ことは無い。
  assert.equal(result.selectedStoreId, "fine-a");
  assert.equal(result.selectedStore, "フィーネ原宿");
});

test("不正store_idテスト: localStorageに存在しない/削除済みのstore_idが残っていてもクラッシュせず、現在の所属店舗(先頭店舗)へフォールバックする", () => {
  const tenantState = {
    companies: [{ id: "company-1", stores: [{ id: "store-a", name: "A店" }] }],
    selectedStore: "A店",
    selectedStoreId: "store-a",
  };
  const staleLocal = { selectedStore: "削除済み店舗", selectedStoreId: "deleted-store-id-xyz" };
  const result = resolvePreferredStoreSelection({ tenantState, localRecoveredState: staleLocal, currentCompanyId: "company-1", role: "staff" });
  assert.equal(result.selectedStoreId, "store-a");
  assert.equal(result.selectedStore, "A店");
});

test("companiesが空(hydrate未完了・会社データ0件)でもクラッシュせず、空の選択状態を返す", () => {
  const tenantState = { companies: [], selectedStore: "", selectedStoreId: "" };
  const result = resolvePreferredStoreSelection({ tenantState, localRecoveredState: {}, currentCompanyId: "company-1", role: "staff" });
  assert.equal(result.selectedStoreId, "");
  assert.equal(result.selectedStore, "");
});

test("全店舗ビューからの降格: 会社管理者から降格された(role=staffに変更された)後は、キャッシュされた全店舗ビュー選択を維持せず実店舗へフォールバックする", () => {
  const tenantState = {
    companies: [{ id: "company-1", stores: [{ id: "store-a", name: "A店" }] }],
    selectedStore: "A店",
    selectedStoreId: "store-a",
  };
  const localRecoveredState = { selectedStore: "__all_stores__", selectedStoreId: "" };
  const asAdmin = resolvePreferredStoreSelection({ tenantState, localRecoveredState, currentCompanyId: "company-1", role: "company_admin" });
  assert.equal(asAdmin.selectedStore, "__all_stores__", "権限がある間は全店舗ビューを維持する");

  const asStaff = resolvePreferredStoreSelection({ tenantState, localRecoveredState, currentCompanyId: "company-1", role: "staff" });
  assert.notEqual(asStaff.selectedStore, "__all_stores__", "権限を失った後は全店舗ビューのキャッシュに固定されない");
  assert.equal(asStaff.selectedStoreId, "store-a");
});

test("company_admin/store_manager/staff全ロール、単一店舗/複数店舗、いずれの組み合わせでも例外を投げず有効な選択を返す(役割・店舗数を変えた総当たり)", () => {
  const roles = ["company_admin", "store_manager", "staff"];
  const storeCounts = [1, 3];
  for (const role of roles) {
    for (const count of storeCounts) {
      const stores = Array.from({ length: count }, (_, index) => ({ id: `store-${index}`, name: `店舗${index}` }));
      const tenantState = { companies: [{ id: "company-1", stores }], selectedStore: stores[0].name, selectedStoreId: stores[0].id };
      assert.doesNotThrow(() => {
        const result = resolvePreferredStoreSelection({ tenantState, localRecoveredState: {}, currentCompanyId: "company-1", role });
        assert.ok(result.selectedStoreId, `role=${role} count=${count}で有効な店舗idが返らなかった`);
      }, `role=${role} count=${count}`);
    }
  }
});

test("加盟店情報がnull/undefinedでも(tenantState.companiesに加盟店が含まれていなくても)自社店舗の解決には影響しない", () => {
  const tenantState = {
    companies: [{ id: "company-1", stores: [{ id: "store-a", name: "A店" }] }],
    selectedStore: "A店",
    selectedStoreId: "store-a",
    // 加盟店閲覧関連のフィールドが一切無い(undefined)、フィールド自体が存在しない古い
    // tenantState形状でも構わない。
  };
  assert.doesNotThrow(() => {
    const result = resolvePreferredStoreSelection({ tenantState, localRecoveredState: undefined, currentCompanyId: "company-1", role: "company_admin" });
    assert.equal(result.selectedStoreId, "store-a");
  });
});

// 「店舗追加時の重複作成防止」の回帰テスト。DB側のユニークインデックス
// (company_id, lower(btrim(name)))が吸収する範囲(空白・大文字小文字)と、クライアント側の
// normalizeStoreNameForDuplicateCheckが同じ基準で判定できることを確認する。
test("normalizeStoreNameForDuplicateCheck: 前後・全角半角スペース、大文字小文字の違いを同一の店舗名とみなす(報告の具体例そのもの)", () => {
  const variants = ["INTRO", "INTRO ", "INTRO　", " INTRO", "intro", "Intro", "ＩＮＴＲＯ"];
  const normalized = variants.map((name) => normalizeStoreNameForDuplicateCheck(name));
  normalized.forEach((value) => assert.equal(value, normalized[0], `"${variants[normalized.indexOf(value)]}" が先頭の正規化結果と一致しなかった`));
});

// 総合品質チェックで発見した問題F(company/store解決のフォールバック不一致)の回帰テスト。
// 以前はApp.jsx内のcurrentCompanyがcurrentCompanyIdに一致する会社が無い場合、
// companies[0](任意の別の会社)へ静かにフォールバックしていた。これはresolveTargetCompanyAndStore
// 等の書き込み経路が同じ状況でnull(=保存ブロック)を返すのと矛盾しており、system_adminが
// 複数会社を切り替える際にUIが違う会社のデータを表示し続けるリスクがあった。
// resolveCurrentCompanyへ統一後は、一致する会社が無ければ常にnullを返す(フォールバックしない)。
test("resolveCurrentCompany: currentCompanyIdに一致する会社をそのまま返す", () => {
  const companies = [{ id: "company-1", name: "A社" }, { id: "company-2", name: "B社" }];
  assert.equal(resolveCurrentCompany(companies, "company-2"), companies[1]);
});

test("resolveCurrentCompany: 一致する会社が無い場合はcompanies[0]へフォールバックせずnullを返す(会社境界を跨いだ誤表示防止)", () => {
  const companies = [{ id: "company-1", name: "A社" }, { id: "company-2", name: "B社" }];
  assert.equal(resolveCurrentCompany(companies, "company-does-not-exist"), null);
  assert.equal(resolveCurrentCompany(companies, ""), null);
  assert.equal(resolveCurrentCompany(companies, undefined), null);
});

test("resolveCurrentCompany: companiesがundefined/null/配列以外でも例外を投げずnullを返す", () => {
  assert.doesNotThrow(() => {
    assert.equal(resolveCurrentCompany(undefined, "company-1"), null);
    assert.equal(resolveCurrentCompany(null, "company-1"), null);
  });
});

test("normalizeStoreNameForDuplicateCheck: 意味の異なる店舗名(接尾辞違い含む)は別物として区別する(normalizeStoreNameForSimilarityのような『本店』剥がしはしない)", () => {
  assert.notEqual(normalizeStoreNameForDuplicateCheck("フィーネ本店"), normalizeStoreNameForDuplicateCheck("フィーネ支店"));
  assert.notEqual(normalizeStoreNameForDuplicateCheck("フィーネ原宿"), normalizeStoreNameForDuplicateCheck("フィーネ横浜"));
  assert.notEqual(normalizeStoreNameForDuplicateCheck("A店"), normalizeStoreNameForDuplicateCheck("AB店"));
});

test("normalizeStoreNameForDuplicateCheck: 内部の連続空白は1つに畳むが、単語区切りとしての空白自体は残す(空文字化しない)", () => {
  assert.equal(normalizeStoreNameForDuplicateCheck("フィーネ  原宿"), normalizeStoreNameForDuplicateCheck("フィーネ 原宿"));
  assert.notEqual(normalizeStoreNameForDuplicateCheck("フィーネ原宿"), normalizeStoreNameForDuplicateCheck("フィーネ 原宿"));
});

test("normalizeStoreNameForDuplicateCheck: 空文字・未定義でも例外を投げない", () => {
  assert.doesNotThrow(() => normalizeStoreNameForDuplicateCheck(""));
  assert.doesNotThrow(() => normalizeStoreNameForDuplicateCheck(undefined));
  assert.doesNotThrow(() => normalizeStoreNameForDuplicateCheck(null));
  assert.equal(normalizeStoreNameForDuplicateCheck(undefined), normalizeStoreNameForDuplicateCheck(null));
});

// 日次入力「過去日の日締め解除→編集」不具合の回帰テスト群。「編集ボタンは表示されるのに
// 入力欄は編集可能にならない」という不具合が、canShowEditButtonとcanEditDailyEntryが別々の
// 式だったことに起因して再発しないよう、resolveDailyEntryEditStateが返す両方の値を必ず
// セットで検証する(片方だけ確認して「直った」と誤判定しないようにするため)。
test("resolveDailyEntryEditState: 過去日・日締め済み→解除→編集ボタン押下、の一連の状態遷移(store_manager/company_admin視点)", () => {
  // 1. 過去日を開く・日締め済み(dailyMode="view"でロード直後、staffではないのでisDailyEntry
  //    LockedForStaff/isStaffPastOrFutureDateLockedはどちらも常にfalse)。
  const closedViewing = resolveDailyEntryEditState({
    dailyMode: "view",
    hasEntryId: true,
    isDailyFormDateHoliday: false,
    isDailyDateBatchLocked: false,
    isDailyEntryLockedForStaff: false, // store_manager/company_adminはこの制限を受けない
    isStaffPastOrFutureDateLocked: false,
  });
  // 日締め済みでも権限上編集可能なロールには「編集」ボタン自体は既に表示されている。
  assert.equal(closedViewing.canShowEditButton, true);
  assert.equal(closedViewing.canEditDailyEntry, false); // まだview中なので入力欄はロックのまま

  // 2. 日締め解除(dayClosingStatesがfalseへ) → 3. 「編集」ボタン表示(既に表示されていた
  //    状態が維持される、ロック理由はどれも変化していない)。
  const afterUnlockStillViewing = resolveDailyEntryEditState({
    dailyMode: "view",
    hasEntryId: true,
    isDailyFormDateHoliday: false,
    isDailyDateBatchLocked: false,
    isDailyEntryLockedForStaff: false,
    isStaffPastOrFutureDateLocked: false,
  });
  assert.equal(afterUnlockStillViewing.canShowEditButton, true);
  assert.equal(afterUnlockStillViewing.canEditDailyEntry, false);

  // 4. 「編集」を押す(editDailyEntryがsetDailyMode("edit")する) → 入力欄が編集可能になる。
  //    これがボタン表示条件(canShowEditButton)と入力欄の編集可否(canEditDailyEntry)が同じ
  //    ロック理由セットを共有していることの核心的な検証——ボタンが出ていた条件のうち
  //    dailyModeだけがedit化されれば、他の条件を一切変えずにcanEditDailyEntryがtrueになる。
  const editing = resolveDailyEntryEditState({
    dailyMode: "edit",
    hasEntryId: true,
    isDailyFormDateHoliday: false,
    isDailyDateBatchLocked: false,
    isDailyEntryLockedForStaff: false,
    isStaffPastOrFutureDateLocked: false,
  });
  assert.equal(editing.canEditDailyEntry, true); // ← 技術売上・店販売上等のinputがdisabled={false}になる
  assert.equal(editing.canShowEditButton, false); // 編集中は「編集」ボタン自体は出さない(保存/キャンセルに切り替わる)
});

test("resolveDailyEntryEditState: staffは日締め済みの過去日を解除しても編集できない(既存権限を維持、要件12)", () => {
  const closedForStaff = resolveDailyEntryEditState({
    dailyMode: "view",
    hasEntryId: true,
    isDailyFormDateHoliday: false,
    isDailyDateBatchLocked: false,
    isDailyEntryLockedForStaff: true, // staff + 締め済み
    isStaffPastOrFutureDateLocked: true, // staff + 過去日
  });
  assert.equal(closedForStaff.canShowEditButton, false); // 「編集」ボタン自体を出さない

  // 過去日である以上、日締めを解除してisDailyEntryLockedForStaffがfalseになっても、
  // isStaffPastOrFutureDateLockedは変わらずtrueのまま(staffは今日以外編集不可)。
  const unlockedButStillPastDateForStaff = resolveDailyEntryEditState({
    dailyMode: "view",
    hasEntryId: true,
    isDailyFormDateHoliday: false,
    isDailyDateBatchLocked: false,
    isDailyEntryLockedForStaff: false,
    isStaffPastOrFutureDateLocked: true,
  });
  assert.equal(unlockedButStillPastDateForStaff.canShowEditButton, false);
  // 万一何らかの経路でdailyModeが"edit"になったとしても、入力欄側も独立してロックされたまま
  // (ボタンを経由しない直接呼び出しなどに対する多重防御)。
  const forcedEditModeForStaff = resolveDailyEntryEditState({
    dailyMode: "edit",
    hasEntryId: true,
    isDailyFormDateHoliday: false,
    isDailyDateBatchLocked: false,
    isDailyEntryLockedForStaff: false,
    isStaffPastOrFutureDateLocked: true,
  });
  assert.equal(forcedEditModeForStaff.canEditDailyEntry, false);
});

test("resolveDailyEntryEditState: まとめて入力ロック中は「編集」ボタンを表示せず、入力欄も編集不可にする(要件13、ボタン表示と実際の編集可否を一致させる)", () => {
  const batchLocked = resolveDailyEntryEditState({
    dailyMode: "view",
    hasEntryId: false, // まとめ入力の配分表示はdailyForm.idを持たない
    isDailyFormDateHoliday: false,
    isDailyDateBatchLocked: true,
    isDailyEntryLockedForStaff: false,
    isStaffPastOrFutureDateLocked: false,
  });
  assert.equal(batchLocked.canShowEditButton, false);
  assert.equal(batchLocked.canEditDailyEntry, false);
});

test("resolveDailyEntryEditState: 店休日は入力欄を編集不可にする(通常営業日の過去日ロックとは別の判定、要件14)", () => {
  const holiday = resolveDailyEntryEditState({
    dailyMode: "create",
    hasEntryId: false,
    isDailyFormDateHoliday: true,
    isDailyDateBatchLocked: false,
    isDailyEntryLockedForStaff: false,
    isStaffPastOrFutureDateLocked: false,
  });
  assert.equal(holiday.canEditDailyEntry, false);

  // 通常営業日(店休日ではない)の同じ状態なら編集可能——店休日判定が他のロック理由と混同
  // されていないことを確認する。
  const regularDay = resolveDailyEntryEditState({
    dailyMode: "create",
    hasEntryId: false,
    isDailyFormDateHoliday: false,
    isDailyDateBatchLocked: false,
    isDailyEntryLockedForStaff: false,
    isStaffPastOrFutureDateLocked: false,
  });
  assert.equal(regularDay.canEditDailyEntry, true);
});

test("resolveDailyEntryEditState: 新規作成モード(create)でも入力欄は編集可能(既存データが無い日でも新規入力できる)", () => {
  const creating = resolveDailyEntryEditState({
    dailyMode: "create",
    hasEntryId: false,
    isDailyFormDateHoliday: false,
    isDailyDateBatchLocked: false,
    isDailyEntryLockedForStaff: false,
    isStaffPastOrFutureDateLocked: false,
  });
  assert.equal(creating.canEditDailyEntry, true);
  // まだ保存されていない(hasEntryId:false)ので「編集」ボタンの出番ではない(保存/日締め
  // ボタンの組み合わせがApp.jsx側で別途出る)。
  assert.equal(creating.canShowEditButton, false);
});

test("runWithSaveGuard: 連打(同期的な2回目の呼び出し)は1回目が完了するまでtaskを実行しない(販売前総合チェックで発見した二重送信バグの回帰テスト)", async () => {
  const guardRef = { current: false };
  let runCount = 0;
  let resolveFirstTask;
  const firstTaskPromise = new Promise((resolve) => { resolveFirstTask = resolve; });

  // 1回目: taskの中で待たせておく(まだ完了させない)。
  const firstCall = runWithSaveGuard(guardRef, async () => {
    runCount += 1;
    await firstTaskPromise;
    return { ok: true };
  });

  // 1回目がまだ完了していない間に、連打を模して同期的に2回目を呼ぶ(Reactのstate更新を
  // 待たずに同じイベント処理内で二重に呼ばれるケースと同じタイミング)。
  const secondResult = await runWithSaveGuard(guardRef, async () => {
    runCount += 1;
    return { ok: true };
  });

  // 2回目はtask自体を一度も実行せず、即座にskippedで返る——二重POST/二重upsertにならない。
  assert.deepEqual(secondResult, { ok: false, skipped: true });
  assert.equal(runCount, 1);

  // 1回目を完了させる。
  resolveFirstTask();
  const firstResult = await firstCall;
  assert.deepEqual(firstResult, { ok: true });

  // 1回目の完了後(finallyでguardRef.currentがfalseに戻った後)は、3回目の呼び出しが
  // 正常にtaskを実行できる——「一度ブロックしたら二度と保存できなくなる」不具合を防ぐ。
  const thirdResult = await runWithSaveGuard(guardRef, async () => {
    runCount += 1;
    return { ok: true };
  });
  assert.deepEqual(thirdResult, { ok: true });
  assert.equal(runCount, 2);
  assert.equal(guardRef.current, false);
});

test("runWithSaveGuard: taskが失敗(reject)してもguardRef.currentは必ずfalseへ戻り、エラーは呼び出し元へそのまま伝播する(通信エラー後の再試行が永久にブロックされないことの確認)", async () => {
  const guardRef = { current: false };
  await assert.rejects(
    () => runWithSaveGuard(guardRef, async () => { throw new Error("通信エラー"); }),
    /通信エラー/
  );
  assert.equal(guardRef.current, false);

  // エラー後の再試行(要件: エラー後の再試行まで確認)。ガードが解放されているので、
  // 次の呼び出しは正常にtaskを実行できる。
  const retryResult = await runWithSaveGuard(guardRef, async () => ({ ok: true }));
  assert.deepEqual(retryResult, { ok: true });
});

// ============================================================
// 人件費・仕入の「月途中は売上連動で自動推定、実額確定後はそれを優先」仕様。
// 回帰テストケースA-J(要件24・25)をそのままcalculateLaborCost/calculatePurchaseCostの
// 単体テストとして実装する。労働費・仕入で計算式は完全に同一のため、同じケース番号で
// 両方を検証する。
// ============================================================

test("calculateLaborCost ケースA: 売上500万円・人件費率40%(自動計算) → 200万円", () => {
  const result = calculateLaborCost({ mode: "sales_linked", rate: 40, override: undefined, fixedAmount: 0, sales: 5000000 });
  assert.equal(result.amount, 2000000);
  assert.equal(result.source, "auto");
});

test("calculateLaborCost ケースB: 売上600万円へ変更(率は40%のまま) → 240万円", () => {
  const result = calculateLaborCost({ mode: "sales_linked", rate: 40, override: undefined, fixedAmount: 0, sales: 6000000 });
  assert.equal(result.amount, 2400000);
  assert.equal(result.source, "auto");
});

test("calculateLaborCost ケースC: 250万円へ手動確定 → 損益では250万円を使用する(売上・率に関わらずoverrideが最優先)", () => {
  const result = calculateLaborCost({ mode: "sales_linked", rate: 40, override: 2500000, fixedAmount: 0, sales: 6000000 });
  assert.equal(result.amount, 2500000);
  assert.equal(result.source, "manual");
});

test("calculateLaborCost: 手動確定額を使用中でも自動計算額(autoEstimate)は常に併記できるよう返す(600万円×40%=240万円、実額250万円とは別に確認できる)", () => {
  const result = calculateLaborCost({ mode: "sales_linked", rate: 40, override: 2500000, fixedAmount: 0, sales: 6000000 });
  assert.equal(result.amount, 2500000);
  assert.equal(result.autoEstimate, 2400000);
});

test("calculateLaborCost ケースD: 手動確定後に売上が700万円へ変わっても、確定額250万円を保持する(自動計算で上書きしない)", () => {
  const result = calculateLaborCost({ mode: "sales_linked", rate: 40, override: 2500000, fixedAmount: 0, sales: 7000000 });
  assert.equal(result.amount, 2500000);
  assert.equal(result.source, "manual");
});

test("calculateLaborCost ケースE: 「自動計算に戻す」(override=null) → 最新の実売上700万円×40%=280万円", () => {
  const result = calculateLaborCost({ mode: "sales_linked", rate: 40, override: null, fixedAmount: 0, sales: 7000000 });
  assert.equal(result.amount, 2800000);
  assert.equal(result.source, "auto");
});

test("calculatePurchaseCost ケースF: 売上500万円・仕入率8%(自動計算) → 40万円", () => {
  const result = calculatePurchaseCost({ mode: "sales_linked", rate: 8, override: undefined, fixedAmount: 0, sales: 5000000 });
  assert.equal(result.amount, 400000);
  assert.equal(result.source, "auto");
});

test("calculatePurchaseCost ケースG: 売上600万円へ変更 → 48万円", () => {
  const result = calculatePurchaseCost({ mode: "sales_linked", rate: 8, override: undefined, fixedAmount: 0, sales: 6000000 });
  assert.equal(result.amount, 480000);
  assert.equal(result.source, "auto");
});

test("calculatePurchaseCost ケースH: 50万円へ手動変更 → 損益では50万円を使用する", () => {
  const result = calculatePurchaseCost({ mode: "sales_linked", rate: 8, override: 500000, fixedAmount: 0, sales: 6000000 });
  assert.equal(result.amount, 500000);
  assert.equal(result.source, "manual");
});

test("calculatePurchaseCost ケースI: 売上700万円になっても手動確定額50万円を保持する", () => {
  const result = calculatePurchaseCost({ mode: "sales_linked", rate: 8, override: 500000, fixedAmount: 0, sales: 7000000 });
  assert.equal(result.amount, 500000);
  assert.equal(result.source, "manual");
});

test("calculatePurchaseCost ケースJ: 自動計算へ戻す → 700万円×8%=56万円", () => {
  const result = calculatePurchaseCost({ mode: "sales_linked", rate: 8, override: null, fixedAmount: 0, sales: 7000000 });
  assert.equal(result.amount, 560000);
  assert.equal(result.source, "auto");
});

test("calculateLaborCost/calculatePurchaseCost: 固定額モード(既定)では既存の費用入力合計(fixedAmount)をそのまま使う(要件2・5-3、既存データを壊さない)", () => {
  const labor = calculateLaborCost({ mode: "fixed", rate: 40, override: undefined, fixedAmount: 2150000, sales: 5000000 });
  assert.equal(labor.amount, 2150000);
  assert.equal(labor.source, "fixed");
  const purchase = calculatePurchaseCost({ mode: "fixed", rate: 8, override: undefined, fixedAmount: 430000, sales: 5000000 });
  assert.equal(purchase.amount, 430000);
  assert.equal(purchase.source, "fixed");
});

test("calculateLaborCost: 固定額モードでも手動確定額(override)があれば優先する(優先順位1が常に最優先、要件5)", () => {
  const result = calculateLaborCost({ mode: "fixed", rate: 40, override: 999999, fixedAmount: 2150000, sales: 5000000 });
  assert.equal(result.amount, 999999);
  assert.equal(result.source, "manual");
});

test("calculateActualCostRate: 確定額÷実売上×100(要件15の実績率)。人件費率設定40%・実売上500万円・実人件費215万円 → 実績43%", () => {
  assert.equal(calculateActualCostRate(2150000, 5000000), 43);
});

test("calculateActualCostRate: 売上0円ならゼロ除算せず0を返す", () => {
  assert.equal(calculateActualCostRate(100000, 0), 0);
});

test("getStoreMonthlyCostOverride: 行が無い月はundefined(未確定=自動推定・固定額側へフォールバック)、行があればその値を返す", () => {
  const state = { storeMonthlyCostOverrides: { "store-1__2026-08": { laborCostOverride: 2150000, purchaseCostOverride: undefined } } };
  assert.deepEqual(getStoreMonthlyCostOverride(state, "store-1", "2026-08"), { laborCostOverride: 2150000, purchaseCostOverride: undefined });
  assert.deepEqual(getStoreMonthlyCostOverride(state, "store-1", "2026-09"), {});
  assert.deepEqual(getStoreMonthlyCostOverride(state, "store-2", "2026-08"), {});
});

test("buildStoreMonthlyCostOverridesStateFromRows: DB行のnullをundefined(未確定)として正しく区別する(0円と未確定を混同しない)", () => {
  const rows = [
    { store_id: "store-1", target_month: "2026-08", labor_cost_override: 2150000, purchase_cost_override: null, updated_at: "2026-08-31T00:00:00Z" },
    { store_id: "store-1", target_month: "2026-09", labor_cost_override: 0, purchase_cost_override: null, updated_at: "2026-09-01T00:00:00Z" },
  ];
  const { storeMonthlyCostOverrides } = buildStoreMonthlyCostOverridesStateFromRows(rows);
  assert.equal(storeMonthlyCostOverrides["store-1__2026-08"].laborCostOverride, 2150000);
  assert.equal(storeMonthlyCostOverrides["store-1__2026-08"].purchaseCostOverride, undefined);
  // 0円は「未確定」ではなく実際に0円で確定した値として区別する。
  assert.equal(storeMonthlyCostOverrides["store-1__2026-09"].laborCostOverride, 0);
});

test("calculateMonthSummary(要件26の月またぎ): 8月に人件費率40%・仕入率8%・確定額を設定→9月は率のみ継続し確定額は引き継がれず自動計算から再開する", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  state.stores = [store];
  state.dailyResults[`${store}__2026-08`] = [{ date: "2026-08-01", totalSales: 5000000 }];
  state.dailyResults[`${store}__2026-09`] = [{ date: "2026-09-01", totalSales: 6000000 }];
  // 8月だけ確定額を保存(9月には保存しない=月キーで分離されている実装そのものの確認)。
  state.storeMonthlyCostOverrides = {
    "横浜店__2026-08": { laborCostOverride: 2500000, purchaseCostOverride: 500000 },
  };
  const options = { laborCostMode: "sales_linked", laborCostRate: 40, purchaseCostMode: "sales_linked", purchaseCostRate: 8 };

  const augustSummary = calculateMonthSummary(state, store, "2026-08", options);
  assert.equal(augustSummary.laborCost, 2500000);
  assert.equal(augustSummary.laborCostSource, "manual");
  assert.equal(augustSummary.purchaseAmount, 500000);
  assert.equal(augustSummary.purchaseCostSource, "manual");
  // 手動確定後も自動計算額自体は消えず、実額と比較できる状態を維持する(要件3)。
  // 8月の実売上500万円×40%=200万円/×8%=40万円が、実額(215万/50万)とは別に確認できる。
  assert.equal(augustSummary.laborCostAutoEstimate, 2000000);
  assert.equal(augustSummary.purchaseCostAutoEstimate, 400000);

  // 9月は率(40%・8%)だけが引き継がれ、確定額は引き継がれず自動計算(売上×率)から再開する。
  const septemberSummary = calculateMonthSummary(state, store, "2026-09", options);
  assert.equal(septemberSummary.laborCost, 2400000); // 600万円×40%
  assert.equal(septemberSummary.laborCostSource, "auto");
  assert.equal(septemberSummary.laborCostAutoEstimate, 2400000);
  assert.equal(septemberSummary.purchaseAmount, 480000); // 600万円×8%
  assert.equal(septemberSummary.purchaseCostSource, "auto");
  assert.equal(septemberSummary.purchaseCostAutoEstimate, 480000);
});

test("calculateMonthSummary: 売上連動モードでは、費用項目を1件も登録していなくてもisProvisionalProfitがfalseになる(要件1の目的: 月途中でも自動推定額で概算損益を確認できる)", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-08";
  state.stores = [store];
  state.dailyResults[`${store}__${month}`] = [{ date: "2026-08-01", totalSales: 5000000 }];
  // fixedCosts/costMonthlyAmountsは一切登録しない(labor/materialsどちらも実入力ゼロ)。

  const fixedModeSummary = calculateMonthSummary(state, store, month, { laborCostMode: "fixed", purchaseCostMode: "fixed" });
  assert.equal(fixedModeSummary.isProvisionalProfit, true, "固定額モードで未入力なら従来通り暫定利益のまま(既存挙動を変えない)");

  const salesLinkedSummary = calculateMonthSummary(state, store, month, { laborCostMode: "sales_linked", laborCostRate: 40, purchaseCostMode: "sales_linked", purchaseCostRate: 8 });
  assert.equal(salesLinkedSummary.isProvisionalProfit, false, "売上連動モードでは自動推定額があるため暫定利益にならない");
  assert.equal(salesLinkedSummary.laborCost, 2000000);
  assert.equal(salesLinkedSummary.purchaseAmount, 400000);
});

test("getStoreDashboardRows(要件17): 全店舗ビューは各店舗ごとにmode/rateで計算してから合算する(全店舗売上×平均率のような近似計算はしない)", () => {
  const state = createInitialAppState();
  state.stores = ["横浜店", "吉祥寺店"];
  state.dailyResults["横浜店__2026-08"] = [{ date: "2026-08-01", totalSales: 5000000 }];
  state.dailyResults["吉祥寺店__2026-08"] = [{ date: "2026-08-01", totalSales: 3000000 }];
  const company = {
    id: "c1",
    stores: [
      { id: "横浜店", name: "横浜店", status: "active", settings: { laborCostMode: "sales_linked", laborCostRate: 40 } },
      { id: "吉祥寺店", name: "吉祥寺店", status: "active", settings: { laborCostMode: "sales_linked", laborCostRate: 35 } },
    ],
  };
  const rows = getStoreDashboardRows(state, company, "2026-08");
  const yokohama = rows.find((row) => row.storeId === "横浜店");
  const kichijoji = rows.find((row) => row.storeId === "吉祥寺店");
  // 横浜: 500万円×40%=200万円、吉祥寺: 300万円×35%=105万円(要件17の例と同じ数字)。
  assert.equal(yokohama.laborCost, 2000000);
  assert.equal(kichijoji.laborCost, 1050000);
  // 「全店舗売上(800万円)×平均率」のような近似計算だと数字が一致しないことの確認
  // (店舗ごとに個別計算してから合算する設計であることの裏付け)。
  const naiveApproximation = (5000000 + 3000000) * ((40 + 35) / 2 / 100);
  assert.notEqual(yokohama.laborCost + kichijoji.laborCost, naiveApproximation);
  assert.equal(yokohama.laborCost + kichijoji.laborCost, 3050000);
});
