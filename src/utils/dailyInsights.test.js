import test from "node:test";
import assert from "node:assert/strict";

import { analyzeDailyInsights, aggregateDailyEntriesAcrossStores, DAILY_INSIGHT_THRESHOLDS } from "./dailyInsights.js";

const ALL_FIELDS_ENABLED = { customers: true, newCustomers: true, repeatCustomers: true, retailSales: true };

const buildDays = (count, values) =>
  Array.from({ length: count }, (_, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    totalSales: values.totalSales,
    customers: values.customers,
    newCustomers: values.newCustomers ?? 0,
    repeatCustomers: values.repeatCustomers ?? 0,
    retailSales: values.retailSales ?? 0,
  }));

test("月初でデータが少ない場合は誤警告を出さずスキップする", () => {
  const currentMonthDaily = buildDays(2, { totalSales: 50000, customers: 10, newCustomers: 3, repeatCustomers: 7, retailSales: 2000 });
  const previousMonthDaily = buildDays(14, { totalSales: 100000, customers: 20, newCustomers: 6, repeatCustomers: 14, retailSales: 4000 });
  const result = analyzeDailyInsights({ currentMonthDaily, previousMonthDaily, fieldsEnabled: ALL_FIELDS_ENABLED });
  assert.deepEqual(result.insights, []);
  assert.equal(result.hasAnomaly, false);
});

test("前月データが無い場合は前月比較の判定をすべてスキップする", () => {
  // 8日分(直近7日ペース判定に必要な最低10日にも満たない)、かつ月内で横ばいのため
  // 前月比較に依存しない判定(A)も発火しない。
  const currentMonthDaily = buildDays(8, { totalSales: 50000, customers: 10, newCustomers: 3, repeatCustomers: 7, retailSales: 2000 });
  const result = analyzeDailyInsights({ currentMonthDaily, previousMonthDaily: [], fieldsEnabled: ALL_FIELDS_ENABLED });
  assert.deepEqual(result.insights, []);
});

test("直近7営業日の売上ペース低下を検知する", () => {
  const priorHalf = buildDays(7, { totalSales: 39000, customers: 9, newCustomers: 4, repeatCustomers: 5, retailSales: 1800 });
  const recentHalf = buildDays(7, { totalSales: 32000, customers: 8, newCustomers: 4, repeatCustomers: 4, retailSales: 1500 }).map((entry, index) => ({
    ...entry,
    date: `2026-08-${String(index + 8).padStart(2, "0")}`,
  }));
  const currentMonthDaily = [...priorHalf, ...recentHalf];
  const previousMonthDaily = buildDays(14, { totalSales: 50000, customers: 10, newCustomers: 3, repeatCustomers: 7, retailSales: 2000 });
  const result = analyzeDailyInsights({ currentMonthDaily, previousMonthDaily, fieldsEnabled: ALL_FIELDS_ENABLED });
  const ids = result.insights.map((insight) => insight.id);
  assert.ok(ids.includes("recentPace"));
  const paceInsight = result.insights.find((insight) => insight.id === "recentPace");
  assert.match(paceInsight.detail, /低下/);
});

test("優先度上位の判定が最大3件に絞り込まれ、優先順位どおりの並びになる(4件以上ヒットする状況)", () => {
  const priorHalf = buildDays(7, { totalSales: 39000, customers: 9, newCustomers: 4, repeatCustomers: 5, retailSales: 1800 });
  const recentHalf = buildDays(7, { totalSales: 32000, customers: 8, newCustomers: 4, repeatCustomers: 4, retailSales: 1500 }).map((entry, index) => ({
    ...entry,
    date: `2026-08-${String(index + 8).padStart(2, "0")}`,
  }));
  const currentMonthDaily = [...priorHalf, ...recentHalf];
  const previousMonthDaily = buildDays(14, { totalSales: 50000, customers: 10, newCustomers: 3, repeatCustomers: 7, retailSales: 2000 });
  const result = analyzeDailyInsights({ currentMonthDaily, previousMonthDaily, fieldsEnabled: ALL_FIELDS_ENABLED });
  assert.equal(result.insights.length, 3);
  assert.deepEqual(result.insights.map((insight) => insight.id), ["repeatDrop", "recentPace", "customerDrop"]);
});

test("客単価低下を検知する(売上好調でも客単価だけ下がっているケース)", () => {
  const currentMonthDaily = buildDays(6, { totalSales: 50000, customers: 10, newCustomers: 5, repeatCustomers: 5, retailSales: 0 });
  const previousMonthDaily = buildDays(6, { totalSales: 60000, customers: 10, newCustomers: 5, repeatCustomers: 5, retailSales: 0 });
  const result = analyzeDailyInsights({ currentMonthDaily, previousMonthDaily, fieldsEnabled: ALL_FIELDS_ENABLED });
  assert.deepEqual(result.insights.map((insight) => insight.id), ["spendDrop"]);
});

test("客数が前月同時点より大きく減少している場合を検知する", () => {
  const currentMonthDaily = buildDays(6, { totalSales: 45000, customers: 8, newCustomers: 2, repeatCustomers: 6, retailSales: 900 });
  const previousMonthDaily = buildDays(6, { totalSales: 50000, customers: 10, newCustomers: 3, repeatCustomers: 7, retailSales: 1000 });
  const result = analyzeDailyInsights({ currentMonthDaily, previousMonthDaily, fieldsEnabled: ALL_FIELDS_ENABLED });
  assert.deepEqual(result.insights.map((insight) => insight.id), ["customerDrop"]);
});

test("新規客数は維持しつつ再来客数が低下している場合を最優先で検知する", () => {
  const currentMonthDaily = buildDays(6, { totalSales: 60000, customers: 13, newCustomers: 6, repeatCustomers: 7, retailSales: 1000 });
  const previousMonthDaily = buildDays(6, { totalSales: 60000, customers: 13, newCustomers: 3, repeatCustomers: 10, retailSales: 1000 });
  const result = analyzeDailyInsights({ currentMonthDaily, previousMonthDaily, fieldsEnabled: ALL_FIELDS_ENABLED });
  assert.deepEqual(result.insights.map((insight) => insight.id), ["repeatDrop"]);
});

test("入力設定で再来客数がOFFの場合は再来客数の判定をスキップする", () => {
  const currentMonthDaily = buildDays(6, { totalSales: 60000, customers: 13, newCustomers: 6, repeatCustomers: 7, retailSales: 1000 });
  const previousMonthDaily = buildDays(6, { totalSales: 60000, customers: 13, newCustomers: 3, repeatCustomers: 10, retailSales: 1000 });
  const result = analyzeDailyInsights({
    currentMonthDaily, previousMonthDaily,
    fieldsEnabled: { ...ALL_FIELDS_ENABLED, repeatCustomers: false },
  });
  assert.deepEqual(result.insights, []);
});

test("客数はほぼ横ばいで店販売上だけが大きく低下している場合を検知する", () => {
  const currentMonthDaily = buildDays(6, { totalSales: 50000, customers: 10, newCustomers: 3, repeatCustomers: 7, retailSales: 1600 });
  const previousMonthDaily = buildDays(6, { totalSales: 50000, customers: 10, newCustomers: 3, repeatCustomers: 7, retailSales: 2000 });
  const result = analyzeDailyInsights({ currentMonthDaily, previousMonthDaily, fieldsEnabled: ALL_FIELDS_ENABLED });
  assert.deepEqual(result.insights.map((insight) => insight.id), ["retailDrop"]);
});

test("店販売上がほぼ0円の店舗では店販売上低下の判定をスキップする", () => {
  const currentMonthDaily = buildDays(6, { totalSales: 50000, customers: 10, newCustomers: 3, repeatCustomers: 7, retailSales: 100 });
  const previousMonthDaily = buildDays(6, { totalSales: 50000, customers: 10, newCustomers: 3, repeatCustomers: 7, retailSales: 400 });
  const result = analyzeDailyInsights({ currentMonthDaily, previousMonthDaily, fieldsEnabled: ALL_FIELDS_ENABLED });
  assert.deepEqual(result.insights, []);
});

test("異常が無い場合はinsightsが空配列になる(異常を無理に作らない)", () => {
  const currentMonthDaily = buildDays(10, { totalSales: 50000, customers: 10, newCustomers: 3, repeatCustomers: 7, retailSales: 2000 });
  const previousMonthDaily = buildDays(10, { totalSales: 50000, customers: 10, newCustomers: 3, repeatCustomers: 7, retailSales: 2000 });
  const result = analyzeDailyInsights({ currentMonthDaily, previousMonthDaily, fieldsEnabled: ALL_FIELDS_ENABLED });
  assert.deepEqual(result.insights, []);
  assert.equal(result.hasAnomaly, false);
});

test("aggregateDailyEntriesAcrossStores: 全店舗ビューは店舗ごとの日次データを日付単位で合算する(平均ではない)", () => {
  const storeA = [{ date: "2026-08-01", totalSales: 30000, customers: 6, newCustomers: 2, repeatCustomers: 4, retailSales: 500 }];
  const storeB = [{ date: "2026-08-01", totalSales: 20000, customers: 4, newCustomers: 1, repeatCustomers: 3, retailSales: 300 }];
  const aggregated = aggregateDailyEntriesAcrossStores([storeA, storeB]);
  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0].totalSales, 50000);
  assert.equal(aggregated[0].customers, 10);
  assert.equal(aggregated[0].retailSales, 800);
});

test("全店舗ビュー(複数店舗合算)でも1店舗と同じ判定結果が得られる", () => {
  const currentStoreA = buildDays(6, { totalSales: 25000, customers: 4, newCustomers: 1, repeatCustomers: 3, retailSales: 450 });
  const currentStoreB = buildDays(6, { totalSales: 20000, customers: 4, newCustomers: 1, repeatCustomers: 3, retailSales: 450 });
  const previousStoreA = buildDays(6, { totalSales: 25000, customers: 5, newCustomers: 1, repeatCustomers: 4, retailSales: 500 });
  const previousStoreB = buildDays(6, { totalSales: 25000, customers: 5, newCustomers: 2, repeatCustomers: 3, retailSales: 500 });
  const currentMonthDaily = aggregateDailyEntriesAcrossStores([currentStoreA, currentStoreB]);
  const previousMonthDaily = aggregateDailyEntriesAcrossStores([previousStoreA, previousStoreB]);
  const result = analyzeDailyInsights({ currentMonthDaily, previousMonthDaily, fieldsEnabled: ALL_FIELDS_ENABLED });
  assert.ok(result.insights.some((insight) => insight.id === "customerDrop"));
});

test("DAILY_INSIGHT_THRESHOLDSを直接書き換えれば閾値が反映される(一元管理されている)", () => {
  const currentMonthDaily = buildDays(6, { totalSales: 47500, customers: 10, newCustomers: 3, repeatCustomers: 7, retailSales: 0 });
  const previousMonthDaily = buildDays(6, { totalSales: 50000, customers: 10, newCustomers: 3, repeatCustomers: 7, retailSales: 0 });
  // 既定閾値(8%)ではヒットしない(5%の低下のため)。
  const defaultResult = analyzeDailyInsights({ currentMonthDaily, previousMonthDaily, fieldsEnabled: ALL_FIELDS_ENABLED });
  assert.deepEqual(defaultResult.insights, []);
  // 閾値を緩めればヒットするようになる。
  const loosened = { ...DAILY_INSIGHT_THRESHOLDS, averageSpendDropPercent: 3 };
  const loosenedResult = analyzeDailyInsights({ currentMonthDaily, previousMonthDaily, fieldsEnabled: ALL_FIELDS_ENABLED, thresholds: loosened });
  assert.deepEqual(loosenedResult.insights.map((insight) => insight.id), ["spendDrop"]);
});
