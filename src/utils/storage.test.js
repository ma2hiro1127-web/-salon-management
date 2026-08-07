import test from "node:test";
import assert from "node:assert/strict";

import { buildDailyEntryPayload, buildDailyStateFromRows, buildMonthClosingStateFromRows, calculateMonthSummary, calculateTaxSummary, createInitialAppState, dailySalesRowToEntry, formatMonthLabel, getBusinessDaySummary, getCustomerTargetSummary, getAiAnalysis, getSalesStatusComment, mergeRemoteAppState, normalizeAppState, readAppState, writeAppState } from "./storage.js";

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
    { id: "fixed-1", name: "家賃", amount: 100000 },
  ];
  state.variableCosts[key] = [
    { id: "var-1", name: "広告費", amount: 50000 },
  ];
  state.monthClosing[key] = [
    { id: "close-1", name: "人件費", amount: 150000, category: "人件費" },
    { id: "close-2", name: "材料費", amount: 40000, category: "材料費" },
    { id: "close-3", name: "固定費", amount: 20000, category: "固定費" },
    { id: "close-4", name: "販管費", amount: 30000, category: "販管費" },
  ];

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.sales, 500000);
  assert.equal(summary.targetAchievement, 50);
  assert.equal(summary.remainingSalesTarget, 500000);
  assert.equal(summary.operatingProfit, 110000);
  assert.equal(summary.operatingMargin, 22);
  assert.equal(summary.fixedCost, 120000);
  assert.equal(summary.variableCost, 80000);
  assert.equal(summary.laborCost, 150000);
  assert.equal(summary.materialCost, 40000);
});

test("fixed costs with this-month-onward apply mode appear in later months", () => {
  const state = createInitialAppState();
  const store = "横浜店";
  const month = "2026-09";
  const key = `${store}__2026-08`;

  state.fixedCosts = {
    [key]: [{ id: "fixed-2", name: "システム利用料", amount: 80000, applyMode: "this-month-onward", startMonth: "2026-08", endMonth: "" }],
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
  state.fixedCosts[key] = [{ id: "fixed-1", name: "家賃", amount: 100000 }];
  state.variableCosts[key] = [{ id: "var-1", name: "広告費", amount: 50000 }];
  state.monthClosing[key] = [
    { id: "close-1", name: "人件費", amount: 150000, category: "人件費" },
    { id: "close-2", name: "材料費", amount: 40000, category: "材料費" },
    { id: "close-3", name: "固定費", amount: 20000, category: "固定費" },
    { id: "close-4", name: "販管費", amount: 30000, category: "販管費" },
    { id: "close-5", name: "設備投資", amount: 30000, category: "設備投資" },
  ];

  const summary = calculateMonthSummary(state, store, month);

  assert.equal(summary.fixedCost, 120000);
  assert.equal(summary.variableCost, 80000);
  assert.equal(summary.equipmentInvestmentCost, 30000);
  assert.equal(summary.adjustedOperatingProfit, 110000);
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

test("getSalesStatusComment: 未達 + ペース遅れだが挽回可能 → やや遅れ", () => {
  const comment = getSalesStatusComment({
    targetSales: 9000000,
    closedSales: 2950000,
    businessDayCount: 30,
    completedDays: 10,
    remainingBusinessDays: 20,
  });

  assert.equal(comment.tier, "やや遅れ");
  assert.equal(comment.targetGap, 6050000);
  assert.equal(comment.paceDiff, -50000);
  assert.equal(comment.dailyAverageNeeded, 302500);
  assert.deepEqual(comment.lines, [
    "現在は目標ペースより50,000円不足しています。",
    "まだ十分巻き返せます。",
    "残り営業日は20日ありますので、1日302,500円を目標に積み上げていきましょう。",
  ]);
});

test("getSalesStatusComment: 目標達成済み + ペース上回り → 順調", () => {
  const comment = getSalesStatusComment({
    targetSales: 9000000,
    closedSales: 9300000,
    businessDayCount: 30,
    completedDays: 15,
    remainingBusinessDays: 15,
  });

  assert.equal(comment.tier, "順調");
  assert.equal(comment.lines[0], "月間目標売上を300,000円上回っています。");
  assert.equal(comment.lines[2], "この調子で月間目標の達成を維持しましょう！");
});

test("getSalesStatusComment: 目標売上ペースどおり(差額0)は順調扱い", () => {
  const comment = getSalesStatusComment({
    targetSales: 9000000,
    closedSales: 4500000,
    businessDayCount: 30,
    completedDays: 15,
    remainingBusinessDays: 15,
  });

  assert.equal(comment.tier, "順調");
  assert.equal(comment.paceDiff, 0);
  assert.equal(comment.lines[1], "現在は目標ペースどおりに進んでいます。");
});

test("getSalesStatusComment: 営業完了日数が0日ならペース差の行を表示しない", () => {
  const comment = getSalesStatusComment({
    targetSales: 9000000,
    closedSales: 0,
    businessDayCount: 30,
    completedDays: 0,
    remainingBusinessDays: 30,
  });

  assert.equal(comment.paceDiff, null);
  assert.equal(comment.lines.some((line) => line.includes("ペース")), false);
});

test("getSalesStatusComment: 残り営業日数が0日なら1日必要売上の行を表示しない", () => {
  const comment = getSalesStatusComment({
    targetSales: 9000000,
    closedSales: 5000000,
    businessDayCount: 30,
    completedDays: 30,
    remainingBusinessDays: 0,
  });

  assert.equal(comment.dailyAverageNeeded, 0);
  assert.equal(comment.lines.some((line) => line.includes("1日")), false);
});

test("getSalesStatusComment: 大きく遅れているケースは要改善", () => {
  const comment = getSalesStatusComment({
    targetSales: 9000000,
    closedSales: 1000000,
    businessDayCount: 30,
    completedDays: 10,
    remainingBusinessDays: 20,
  });

  assert.equal(comment.tier, "要改善");
  assert.equal(comment.lines[0], "目標売上まであと8,000,000円です。");
  assert.equal(comment.lines[2], "ここからでも十分挽回できます。");
  assert.equal(comment.lines[3], "まずは今日の目標売上を達成することを目指しましょう！");
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

test("formatMonthLabel formats YYYY-MM as YYYY年M月 for display, storage stays YYYY-MM", () => {
  assert.equal(formatMonthLabel("2026-08"), "2026年8月");
  assert.equal(formatMonthLabel("2026-01"), "2026年1月");
  assert.equal(formatMonthLabel(""), "");
  assert.equal(formatMonthLabel(undefined), "");
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

test("buildDailyStateFromRows rebuilds dailyResults/dayClosingStates for multiple stores from daily_sales rows", () => {
  const storeIdToName = { "store-honten": "本店", "store-yoko": "フィーネ横浜" };
  const rows = [
    { store_id: "store-honten", business_date: "2026-08-01", sales_amount: 50000, is_day_closed: true, closed_at: "2026-08-01T10:00:00.000Z" },
    { store_id: "store-honten", business_date: "2026-08-05", sales_amount: 42000, is_day_closed: false },
    { store_id: "store-yoko", business_date: "2026-08-01", sales_amount: 20100, is_day_closed: true, closed_at: "2026-08-01T09:00:00.000Z" },
  ];

  const { dailyResults, dayClosingStates, dayClosingUpdatedAt } = buildDailyStateFromRows(rows, storeIdToName);

  assert.equal(dailyResults["本店__2026-08"].length, 2);
  assert.equal(dailyResults["フィーネ横浜__2026-08"].length, 1);
  assert.equal(dayClosingStates["本店__2026-08"]["2026-08-01"], true);
  assert.equal(dayClosingStates["本店__2026-08"]["2026-08-05"], false, "未締めの日は明示的にfalseになる(重複カウント防止)");
  assert.equal(dayClosingStates["フィーネ横浜__2026-08"]["2026-08-01"], true);
  assert.equal(dayClosingUpdatedAt["本店__2026-08"]["2026-08-01"], "2026-08-01T10:00:00.000Z");

  const summary = getBusinessDaySummary({ dailyResults, dayClosingStates, businessDaySettings: {} }, "本店", "2026-08");
  assert.equal(summary.completedDays, 1, "daily_salesから再構築した状態でも日締め済み日数は1件のみ");
});

test("buildDailyStateFromRows skips rows for stores not in the id-to-name map (no crash, no orphaned key)", () => {
  const { dailyResults } = buildDailyStateFromRows([{ store_id: "unknown-store", business_date: "2026-08-01", sales_amount: 1000 }], { "store-honten": "本店" });
  assert.deepEqual(dailyResults, {});
});

test("buildMonthClosingStateFromRows rebuilds monthClosingStatus per store from monthly_closings rows", () => {
  const storeIdToName = { "store-honten": "本店", "store-yoko": "フィーネ横浜" };
  const rows = [
    { store_id: "store-honten", year_month: "2026-08", is_closed: true, closed_at: "2026-09-01T00:00:00.000Z" },
    { store_id: "store-yoko", year_month: "2026-08", is_closed: false, closed_at: null },
  ];

  const status = buildMonthClosingStateFromRows(rows, storeIdToName);

  assert.equal(status["本店__2026-08"].closed, true);
  assert.equal(status["本店__2026-08"].lockedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(status["フィーネ横浜__2026-08"].closed, false);
});
