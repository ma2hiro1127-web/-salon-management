// 日次「要確認ポイント」の自動検知ロジック(2026-09追加)。生成AI APIは一切使わず、既存の
// 日次入力データ(getDailyResultsForStoreMonthが返す形)に対する数値比較だけで、営業中に
// 今すぐ確認した方がいい変化を検知する。
//
// 設計方針:
//   - 判定・閾値・優先順位は全てこのファイル1箇所(DAILY_INSIGHT_THRESHOLDS/RULES)に
//     集約し、後から数値だけ調整できるようにする。
//   - 「今の営業進捗を見ればすぐ分かる内容」(達成率・残り目標額等)は一切扱わない
//     — このファイルはあくまで「見落としやすい変化」だけを担当する。
//   - 人件費・材料費・固定費・営業利益等、月締め後にしか確定しない費用系の値は
//     一切参照しない(要件: 月途中の誤警告防止)。
//   - データが少ない・比較対象が無い・入力設定でOFFの項目は、判定そのものをスキップする
//     (0件やnullを「悪化」と誤検知しない)。
import { parseNumber, pickVariant } from "./storage.js";

export const DAILY_INSIGHT_THRESHOLDS = {
  recentPaceWindowDays: 7, // A: 「直近」とみなす営業日数
  recentPaceDropPercent: 10, // A: 直近平均が、それ以前の平均よりこの%以上低ければ検知
  minBusinessDaysForPace: 10, // A: 判定に必要な最低営業日数(直近7日+比較対象3日以上を確保)
  averageSpendDropPercent: 8, // B
  customerCountDropPercent: 10, // C
  repeatDropPercent: 10, // D: 再来客数が前月同時点よりこの%以上減れば検知
  retailSalesDropPercent: 15, // E
  customerCountStableBand: 5, // E: 客数「維持」とみなす許容幅(±%)
  minRetailSalesForCheck: 3000, // E: 店販売上がほぼ0円の店舗を除外する下限(円)
  minElapsedDaysForComparison: 5, // B/C/D/E/F: 前月同時点比較に必要な最低日数(今月・前月とも)
  compositionSalesStableBand: 3, // F: 総売上「横ばい」とみなす許容幅(±%)
  compositionRatioPointThreshold: 5, // F: 店販比率がこのpt以上動けば検知
  maxInsights: 3,
};

// 重要度順。この配列の並び自体が優先順位そのもの — 後から並び替えるだけで優先度を
// 変更できる(要件: 優先順位・閾値をコード上で一元管理する)。
const RULE_ORDER = ["repeatDrop", "recentPace", "customerDrop", "spendDrop", "retailDrop", "compositionShift"];

const sum = (list, picker) => list.reduce((total, item) => total + parseNumber(picker(item)), 0);

const sortByDate = (list) => [...list].sort((a, b) => String(a.date).localeCompare(String(b.date)));

// 前月の日次配列の先頭からN件(=今月の経過日数と同じ件数)だけを取り出す。「前月同時点」の
// 定義を、休日設定等の別データソースに依存させず、実際に入力されている日次レコード数
// ベースにすることで、この関数だけで完結させる。
const sliceToElapsedDays = (previousMonthDaily, elapsedCount) => sortByDate(previousMonthDaily).slice(0, elapsedCount);

// 誤警告防止(要件で最重要視されている部分)の判定を1箇所にまとめる。
// 個々のルールはこのヘルパーを呼ぶだけにし、ガード条件を重複実装しない。
const hasEnoughDataForComparison = (currentDaily, previousElapsed, minDays) =>
  currentDaily.length >= minDays && previousElapsed.length >= minDays;

const percentDrop = (current, previous) => {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  return ((previous - current) / previous) * 100; // 正の値 = 低下
};

function ruleRecentPace(ctx) {
  const { currentDaily, thresholds } = ctx;
  if (currentDaily.length < thresholds.minBusinessDaysForPace) return null;
  const sorted = sortByDate(currentDaily);
  const window = Math.min(thresholds.recentPaceWindowDays, sorted.length - 1);
  if (window <= 0) return null;
  const recent = sorted.slice(sorted.length - window);
  const prior = sorted.slice(0, sorted.length - window);
  if (prior.length === 0) return null;
  const recentAvg = sum(recent, (e) => e.totalSales) / recent.length;
  const priorAvg = sum(prior, (e) => e.totalSales) / prior.length;
  const drop = percentDrop(recentAvg, priorAvg);
  if (drop === null || drop < thresholds.recentPaceDropPercent) return null;
  return {
    id: "recentPace",
    tone: "warning",
    title: pickVariant(["直近の売上ペースが低下しています", "直近7日の売上ペースが低下しています"], ctx.seed),
    detail: `直近${window}営業日の1日平均売上が、それ以前より${drop.toFixed(1)}%低下しています。`,
  };
}

function ruleCustomerDrop(ctx) {
  const { currentDaily, previousElapsed, fieldsEnabled, thresholds } = ctx;
  if (!fieldsEnabled.customers) return null;
  if (!hasEnoughDataForComparison(currentDaily, previousElapsed, thresholds.minElapsedDaysForComparison)) return null;
  const currentCustomers = sum(currentDaily, (e) => e.customers);
  const previousCustomers = sum(previousElapsed, (e) => e.customers);
  const drop = percentDrop(currentCustomers, previousCustomers);
  if (drop === null || drop < thresholds.customerCountDropPercent) return null;
  return {
    id: "customerDrop",
    tone: "neutral",
    title: "客数が減少しています",
    detail: `前月同時点と比べて客数が${drop.toFixed(1)}%減少しています。`,
  };
}

function ruleSpendDrop(ctx) {
  const { currentDaily, previousElapsed, fieldsEnabled, thresholds } = ctx;
  if (!fieldsEnabled.customers) return null;
  if (!hasEnoughDataForComparison(currentDaily, previousElapsed, thresholds.minElapsedDaysForComparison)) return null;
  const currentSales = sum(currentDaily, (e) => e.totalSales);
  const currentCustomers = sum(currentDaily, (e) => e.customers);
  const previousSales = sum(previousElapsed, (e) => e.totalSales);
  const previousCustomers = sum(previousElapsed, (e) => e.customers);
  if (currentCustomers <= 0 || previousCustomers <= 0) return null;
  const currentSpend = currentSales / currentCustomers;
  const previousSpend = previousSales / previousCustomers;
  const drop = percentDrop(currentSpend, previousSpend);
  if (drop === null || drop < thresholds.averageSpendDropPercent) return null;
  return {
    id: "spendDrop",
    tone: "neutral",
    title: "客単価が低下しています",
    detail: `前月同時点と比べて客単価が${drop.toFixed(1)}%低下しています。`,
  };
}

function ruleRepeatDrop(ctx) {
  const { currentDaily, previousElapsed, fieldsEnabled, thresholds } = ctx;
  if (!fieldsEnabled.customers || !fieldsEnabled.newCustomers || !fieldsEnabled.repeatCustomers) return null;
  if (!hasEnoughDataForComparison(currentDaily, previousElapsed, thresholds.minElapsedDaysForComparison)) return null;
  const currentNew = sum(currentDaily, (e) => e.newCustomers);
  const previousNew = sum(previousElapsed, (e) => e.newCustomers);
  const currentRepeat = sum(currentDaily, (e) => e.repeatCustomers);
  const previousRepeat = sum(previousElapsed, (e) => e.repeatCustomers);
  if (currentNew < previousNew) return null; // 新規客数は前月同時点以上、が条件
  const drop = percentDrop(currentRepeat, previousRepeat);
  if (drop === null || drop < thresholds.repeatDropPercent) return null;
  return {
    id: "repeatDrop",
    tone: "danger",
    title: "再来客数が低下しています",
    detail: `前月同時点と比べて再来客数が${drop.toFixed(1)}%減少しています。`,
  };
}

function ruleRetailDrop(ctx) {
  const { currentDaily, previousElapsed, fieldsEnabled, thresholds } = ctx;
  if (!fieldsEnabled.retailSales || !fieldsEnabled.customers) return null;
  if (!hasEnoughDataForComparison(currentDaily, previousElapsed, thresholds.minElapsedDaysForComparison)) return null;
  const previousRetail = sum(previousElapsed, (e) => e.retailSales);
  if (previousRetail < thresholds.minRetailSalesForCheck) return null; // ほぼ0円の店舗は除外
  const currentCustomers = sum(currentDaily, (e) => e.customers);
  const previousCustomers = sum(previousElapsed, (e) => e.customers);
  if (previousCustomers <= 0) return null;
  const customerDiffPercent = ((currentCustomers - previousCustomers) / previousCustomers) * 100;
  if (Math.abs(customerDiffPercent) > thresholds.customerCountStableBand) return null; // 客数維持が条件
  const currentRetail = sum(currentDaily, (e) => e.retailSales);
  const drop = percentDrop(currentRetail, previousRetail);
  if (drop === null || drop < thresholds.retailSalesDropPercent) return null;
  return {
    id: "retailDrop",
    tone: "neutral",
    title: "店販売上が低下しています",
    detail: `客数は前月同時点とほぼ同じですが、店販売上が${drop.toFixed(1)}%低下しています。`,
  };
}

function ruleCompositionShift(ctx) {
  const { currentDaily, previousElapsed, fieldsEnabled, thresholds } = ctx;
  if (!fieldsEnabled.retailSales) return null;
  if (!hasEnoughDataForComparison(currentDaily, previousElapsed, thresholds.minElapsedDaysForComparison)) return null;
  const currentSales = sum(currentDaily, (e) => e.totalSales);
  const previousSales = sum(previousElapsed, (e) => e.totalSales);
  if (currentSales <= 0 || previousSales <= 0) return null;
  const salesDiffPercent = ((currentSales - previousSales) / previousSales) * 100;
  if (Math.abs(salesDiffPercent) > thresholds.compositionSalesStableBand) return null; // 総売上「横ばい」が条件
  const currentRetail = sum(currentDaily, (e) => e.retailSales);
  const previousRetail = sum(previousElapsed, (e) => e.retailSales);
  const currentRatio = (currentRetail / currentSales) * 100;
  const previousRatio = (previousRetail / previousSales) * 100;
  const ratioDiffPoint = currentRatio - previousRatio;
  if (Math.abs(ratioDiffPoint) < thresholds.compositionRatioPointThreshold) return null;
  const direction = ratioDiffPoint > 0 ? "上昇" : "低下";
  return {
    id: "compositionShift",
    tone: "neutral",
    title: "売上構成が変化しています",
    detail: `総売上はほぼ横ばいですが、店販売上の割合が前月同時点より${Math.abs(ratioDiffPoint).toFixed(1)}pt${direction}しています。`,
  };
}

const RULES = {
  recentPace: ruleRecentPace,
  customerDrop: ruleCustomerDrop,
  spendDrop: ruleSpendDrop,
  repeatDrop: ruleRepeatDrop,
  retailDrop: ruleRetailDrop,
  compositionShift: ruleCompositionShift,
};

// 全店舗ビュー用: 日付をキーに、店舗横断で数値だけを単純合算する(率系の値はここで
// 扱わないため、既存の「合算してから率を再計算する」原則に反しない)。
export function aggregateDailyEntriesAcrossStores(perStoreEntries) {
  const byDate = new Map();
  (perStoreEntries || []).forEach((entries) => {
    (entries || []).forEach((entry) => {
      const date = entry.date;
      if (!date) return;
      const existing = byDate.get(date) || { date, totalSales: 0, technicalSales: 0, retailSales: 0, customers: 0, newCustomers: 0, repeatCustomers: 0, reviewCount: 0 };
      existing.totalSales += parseNumber(entry.totalSales);
      existing.technicalSales += parseNumber(entry.technicalSales);
      existing.retailSales += parseNumber(entry.retailSales);
      existing.customers += parseNumber(entry.customers);
      existing.newCustomers += parseNumber(entry.newCustomers);
      existing.repeatCustomers += parseNumber(entry.repeatCustomers);
      existing.reviewCount += parseNumber(entry.reviewCount);
      byDate.set(date, existing);
    });
  });
  return Array.from(byDate.values());
}

// currentMonthDaily/previousMonthDaily: getDailyResultsForStoreMonthの戻り値そのもの
// (単一店舗)、または aggregateDailyEntriesAcrossStores の戻り値(全店舗)。
// fieldsEnabled: { customers, newCustomers, repeatCustomers, retailSales } の bool。
// seed: pickVariantに渡す文言ゆらぎ用の種(例: 今日の日付文字列)。
export function analyzeDailyInsights({
  currentMonthDaily = [],
  previousMonthDaily = [],
  fieldsEnabled = {},
  thresholds = DAILY_INSIGHT_THRESHOLDS,
  seed = "",
} = {}) {
  const currentDaily = sortByDate(currentMonthDaily);
  const previousElapsed = sliceToElapsedDays(previousMonthDaily, currentDaily.length);
  const ctx = { currentDaily, previousElapsed, fieldsEnabled, thresholds, seed };

  const hits = [];
  for (const ruleId of RULE_ORDER) {
    const result = RULES[ruleId](ctx);
    if (result) hits.push({ ...result, priority: hits.length });
    if (hits.length >= thresholds.maxInsights) break;
  }

  return { insights: hits.slice(0, thresholds.maxInsights), hasAnomaly: hits.length > 0 };
}
