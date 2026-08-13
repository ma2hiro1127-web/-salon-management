import test from "node:test";
import assert from "node:assert/strict";

import { buildAiContext } from "./aiContext.js";

// 個別店舗選択時: ユーザーが要求した全項目(現在売上/月間目標売上/技術売上/店販売上/客数/
// 客単価/新規客数/再来客数/口コミ数/営業日数/営業完了日数/残り営業日/登録済み費用/営業利益)
// が、正しい店舗・年月に紐づいたsummary/target/businessDaySummaryから漏れなく整形されること。
test("buildAiContext: single-store view includes all required sales/target/customer/cost fields", () => {
  const context = buildAiContext({
    role: "store_manager",
    storeName: "原宿店",
    storeId: "store-harajuku-uuid",
    monthValue: "2026-08",
    isAllStoresView: false,
    summary: {
      sales: 4102985,
      technicalSales: 3200000,
      retailSales: 902985,
      otherSales: 0,
      customers: 320,
      newCustomers: 60,
      repeatCustomers: 260,
      averageSpend: 12822,
      reviewCount: 18,
      reviewCountAchievement: 90,
      completedDays: 15,
      remainingBusinessDays: 11,
      averageDailySales: 273532,
      targetAchievement: 82,
      remainingSalesTarget: 897015,
      targetPerDay: 5000000 / 26,
      forecast: 5100000,
      customerAchievement: 88,
      laborCost: 900000,
      fixedCost: 300000,
      variableCost: 150000,
      adCost: 80000,
      costOfGoodsSold: 200000,
      otherCost: 10000,
      expenseTotal: 1640000,
      grossProfit: 3900000,
      operatingProfit: 2462985,
      operatingMargin: 60.0,
      laborRate: 21.9,
      costOfGoodsSoldRate: 4.9,
    },
    target: {
      targetSales: 5000000,
      targetTechnicalSales: 3800000,
      targetRetailSales: 1200000,
      targetCustomers: 360,
      targetAverageSpend: 13000,
      targetNewCustomers: 70,
      targetRepeatCustomers: 290,
      targetReviewCount: 20,
    },
    businessDaySummary: {
      businessDayCount: 26,
      completedDays: 15,
      remainingBusinessDays: 11,
    },
  });

  assert.equal(context.scope.storeId, "store-harajuku-uuid");
  assert.equal(context.scope.storeName, "原宿店");
  assert.equal(context.scope.monthValue, "2026-08");
  assert.equal(context.scope.isAllStoresView, false);

  // 営業日数系はカレンダー由来の事実であり、目標登録の有無と無関係に常に届く
  assert.deepEqual(context.businessDays, { businessDayCount: 26, completedBusinessDays: 15, remainingBusinessDays: 11 });

  assert.equal(context.sales.totalSales, 4102985); // 現在売上
  assert.equal(context.target.targetSales, 5000000); // 月間目標売上
  assert.equal(context.sales.technicalSales, 3200000); // 技術売上
  assert.equal(context.sales.retailSales, 902985); // 店販売上
  assert.equal(context.sales.targetDailyPace, 5000000 / 26); // 目標ペース(1日あたり)
  assert.ok(Math.abs(context.sales.paceDifference - (273532 - 5000000 / 26)) < 1); // 目標ペースとの差額
  assert.equal(context.customers.totalCustomers, 320); // 客数
  assert.equal(context.customers.averageSpend, 12822); // 客単価
  assert.equal(context.customers.newCustomers, 60); // 新規客数
  assert.equal(context.customers.repeatCustomers, 260); // 再来客数
  assert.equal(context.reviews.totalReviewCount, 18); // 口コミ数

  assert.equal(context.costs.operatingProfit, 2462985); // 営業利益
  assert.equal(context.costs.laborCost, 900000);
  assert.equal(context.costs.fixedCost, 300000);
  assert.equal(context.costs.variableCost, 150000);
  assert.equal(context.costs.adCost, 80000);
  assert.equal(context.dataAvailability.hasCostData, true);
  assert.equal(context.dataAvailability.hasTarget, true);
});

// 全店舗ビュー: calculateAllStoresMonthSummary は費用・損益を意図的に含まない設計のため、
// たとえ渡された summary に費用らしき値が混ざっていても costs は絶対に送らない
// (=特定店舗のデータが全店舗ビューに混在しない)。storeId/storeName も個別店舗値を残さない。
test("buildAiContext: all-stores view never leaks a single store's cost data and clears storeId", () => {
  const context = buildAiContext({
    role: "company_admin",
    storeName: "原宿店", // 呼び出し側が誤って個別店舗名を渡しても scope 側では上書きされる
    storeId: "store-harajuku-uuid",
    monthValue: "2026-08",
    isAllStoresView: true,
    summary: {
      sales: 9800000,
      technicalSales: 7000000,
      retailSales: 2800000,
      customers: 700,
      newCustomers: 150,
      repeatCustomers: 550,
      averageSpend: 14000,
      reviewCount: 40,
      // 万一 summary にコスト系フィールドが混入していても isAllStoresView では無視される
      laborCost: 999999,
      fixedCost: 999999,
      completedDays: 15,
      remainingBusinessDays: 11,
      targetAchievement: 95,
      customerAchievement: 90,
    },
    target: { targetSales: 10000000, targetCustomers: 780 },
    businessDaySummary: { businessDayCount: 26, completedDays: 15, remainingBusinessDays: 11 },
  });

  assert.equal(context.scope.isAllStoresView, true);
  assert.equal(context.scope.storeName, "全店舗");
  assert.equal(context.scope.storeId, null);
  assert.equal(context.costs, null);
  assert.equal(context.dataAvailability.hasCostData, false);
  assert.equal(context.dataAvailability.isAllStoresView, true);
  // 全店舗の売上・客数は正しく合算値が渡る
  assert.equal(context.sales.totalSales, 9800000);
  assert.equal(context.customers.totalCustomers, 700);
});

// 月間目標が未登録の店舗: targetは丸ごとnullになるが、営業日数(カレンダー由来)はnullにしない。
test("buildAiContext: no target registered nulls the target section but keeps business-day facts", () => {
  const context = buildAiContext({
    role: "staff",
    storeName: "横浜店",
    storeId: "store-yokohama-uuid",
    monthValue: "2026-08",
    isAllStoresView: false,
    summary: { sales: 1200000, customers: 90, completedDays: 15, remainingBusinessDays: 11 },
    target: { targetSales: 0, targetCustomers: 0, targetReviewCount: 0 },
    businessDaySummary: { businessDayCount: 26, completedDays: 15, remainingBusinessDays: 11 },
  });

  assert.equal(context.target, null);
  assert.equal(context.dataAvailability.hasTarget, false);
  assert.deepEqual(context.businessDays, { businessDayCount: 26, completedBusinessDays: 15, remainingBusinessDays: 11 });
  assert.equal(context.sales.targetAchievementRate, null);
});

// 費用が一切未入力の店舗: 0円ではなく「未入力」として costs を丸ごとnullにする
// (0円と未入力をAIが混同しないようにするための挙動)。
test("buildAiContext: a store with no cost entries sends costs as null, not zeros", () => {
  const context = buildAiContext({
    role: "store_manager",
    storeName: "渋谷店",
    storeId: "store-shibuya-uuid",
    monthValue: "2026-08",
    isAllStoresView: false,
    summary: { sales: 800000, customers: 50, laborCost: 0, fixedCost: 0, variableCost: 0, adCost: 0, costOfGoodsSold: 0 },
    target: {},
    businessDaySummary: { businessDayCount: 24, completedDays: 10, remainingBusinessDays: 14 },
  });

  assert.equal(context.costs, null);
  assert.equal(context.dataAvailability.hasCostData, false);
});

// 売上目標だけ設定していて、新規客・再来客の目標を個別には設定していない店舗:
// 目標セクション自体は(売上目標があるので)存在するが、設定していないサブ項目は
// 0ではなくnullで送る(目標0=未設定、という前提のため。実績側は0のまま送る)。
test("buildAiContext: unset target sub-fields are null (not 0), while actuals keep real zeros", () => {
  const context = buildAiContext({
    role: "store_manager",
    storeName: "渋谷店",
    storeId: "store-shibuya-uuid",
    monthValue: "2026-08",
    isAllStoresView: false,
    summary: { sales: 1000000, customers: 60, newCustomers: 0, otherSales: 0 },
    target: { targetSales: 3000000, targetCustomers: 0, targetNewCustomers: 0, targetRepeatCustomers: 0 },
    businessDaySummary: { businessDayCount: 25, completedDays: 12, remainingBusinessDays: 13 },
  });

  assert.equal(context.dataAvailability.hasTarget, true);
  assert.equal(context.target.targetSales, 3000000);
  assert.equal(context.target.targetCustomers, null); // 未設定(0)はnull
  assert.equal(context.target.targetNewCustomers, null);
  assert.equal(context.target.targetRepeatCustomers, null);
  // 実績側は本当に0件/0円ならそのまま0を送る(未入力かどうかはcostsと同様セクション単位で判断)
  assert.equal(context.customers.newCustomers, 0);
  assert.equal(context.sales.otherSales, 0);
});

// カテゴリ別費用: 未登録カテゴリはnull、登録済みだが0円のカテゴリは0として区別して送る。
// AIは費用名からの推測ではなく、この category_key 基準のオブジェクトを根拠に分析する。
test("buildAiContext: costsByCategory distinguishes unregistered (null) from registered-zero (0)", () => {
  const context = buildAiContext({
    role: "store_manager",
    storeName: "渋谷店",
    storeId: "store-shibuya-uuid",
    monthValue: "2026-08",
    isAllStoresView: false,
    summary: {
      sales: 1000000,
      laborCost: 0,
      fixedCost: 50000,
      variableCost: 0,
      adCost: 30000,
      costOfGoodsSold: 0,
      costsByCategory: { rent: 30000, labor: 0, advertising: 30000, materials: 0, other: 0, uncategorized: 0 },
      categoryHasEntry: { rent: true, labor: true, advertising: true, materials: false, other: false, uncategorized: false },
      missingCriticalCategories: ["materials"],
      isProvisionalProfit: true,
    },
    target: {},
    businessDaySummary: { businessDayCount: 24, completedDays: 10, remainingBusinessDays: 14 },
  });

  assert.ok(context.costs, "categoryHasEntry has entries, so costs section must be sent even though legacy totals are mostly 0");
  assert.equal(context.costs.costsByCategory.rent, 30000);
  assert.equal(context.costs.costsByCategory.labor, 0); // 登録済みだが0円
  assert.equal(context.costs.costsByCategory.materials, null); // 未登録
  assert.equal(context.costs.costsByCategory.other, null); // 未登録
  assert.equal(context.costs.isProvisionalProfit, true);
  assert.deepEqual(context.costs.missingCriticalCategories, ["materials"]);
});

// 人件費・材料/発注費が両方登録済みの場合はisProvisionalProfitがfalseで届く。
test("buildAiContext: isProvisionalProfit is false once labor and materials are both entered", () => {
  const context = buildAiContext({
    role: "store_manager",
    storeName: "渋谷店",
    storeId: "store-shibuya-uuid",
    monthValue: "2026-08",
    isAllStoresView: false,
    summary: {
      sales: 1000000,
      laborCost: 300000,
      costsByCategory: { labor: 300000, materials: 100000 },
      categoryHasEntry: { labor: true, materials: true },
      missingCriticalCategories: [],
      isProvisionalProfit: false,
    },
    target: {},
    businessDaySummary: { businessDayCount: 24, completedDays: 10, remainingBusinessDays: 14 },
  });

  assert.equal(context.costs.isProvisionalProfit, false);
  assert.deepEqual(context.costs.missingCriticalCategories, []);
});
