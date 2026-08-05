import {
  createInitialAppState,
  defaultClosingItem,
  defaultDailyEntry,
  defaultFixedCostItem,
  defaultTarget,
  defaultVariableCostItem,
  expenseCategories,
} from "../data/defaults.js";

export { createInitialAppState } from "../data/defaults.js";

export const STORAGE_KEYS = {
  theme: "salon-theme",
  appState: "salon-goal-app-v2",
};

export const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const readStorage = (key, fallback) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
};

export const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const getMonthInfo = (monthValue) => {
  const [year, month] = monthValue.split("-").map(Number);
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  return {
    yearNumber,
    monthNumber,
    daysInMonth: new Date(yearNumber, monthNumber, 0).getDate(),
    firstDate: new Date(yearNumber, monthNumber - 1, 1),
    lastDate: new Date(yearNumber, monthNumber, 0),
  };
};

export const buildMonthKey = (store, month) => `${store}__${month}`;

export const getBusinessDaySettings = (state, storeName, monthValue) => {
  const key = buildMonthKey(storeName, monthValue);
  return state.businessDaySettings?.[key] || {};
};

export const deduplicateDailyEntries = (entries = [], backupTarget = {}) => {
  const deduped = [];
  const backups = [];
  const byDate = new Map();

  (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
    const date = String(entry?.date || "").trim();
    if (!date) {
      deduped.push(entry);
      return;
    }

    const current = entry;
    const previous = byDate.get(date);
    if (!previous) {
      byDate.set(date, current);
      return;
    }

    const previousUpdatedAt = String(previous.updatedAt || previous.updated_at || "");
    const currentUpdatedAt = String(current.updatedAt || current.updated_at || "");
    const pickCurrent = currentUpdatedAt && previousUpdatedAt ? currentUpdatedAt >= previousUpdatedAt : index > (entries || []).findIndex((item) => String(item?.date || "") === date);
    const retained = pickCurrent ? current : previous;
    const removed = pickCurrent ? previous : current;

    if (removed && removed !== retained) {
      backups.push(removed);
    }
    byDate.set(date, retained);
  });

  byDate.forEach((entry) => deduped.push(entry));
  deduped.sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));

  return { entries: deduped, backups };
};

export const getBusinessDaySummary = (state, storeName, monthValue) => {
  const key = buildMonthKey(storeName, monthValue);
  const settings = getBusinessDaySettings(state, storeName, monthValue);
  const monthInfo = getMonthInfo(monthValue);
  const holidayCount = Math.max(parseNumber(settings.holidayCount), 0);
  const manualBusinessDayCount = parseNumber(settings.businessDayCount);
  const businessDayCount = settings.mode === "manual" && Number.isInteger(manualBusinessDayCount) && manualBusinessDayCount > 0
    ? manualBusinessDayCount
    : Math.max(monthInfo.daysInMonth - holidayCount, 0);
  const closingMap = state.dayClosingStates?.[key] || {};
  const closedDates = Object.entries(closingMap)
    .filter(([, isClosed]) => Boolean(isClosed))
    .map(([date]) => date);

  return {
    businessDayCount,
    completedDays: closedDates.length,
    remainingBusinessDays: businessDayCount === null ? null : Math.max(businessDayCount - closedDates.length, 0),
    progressRate: businessDayCount === null ? null : (closedDates.length / businessDayCount) * 100,
    closedDates,
  };
};

export const getBusinessDayDates = (monthValue, holidayDates = []) => {
  const { yearNumber, monthNumber, daysInMonth } = getMonthInfo(monthValue);
  const holidaySet = new Set((holidayDates || []).map((item) => String(item).trim()).filter(Boolean));
  const list = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(yearNumber, monthNumber - 1, day);
    const iso = formatLocalDate(date);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    if (!isWeekend && !holidaySet.has(iso)) {
      list.push(iso);
    }
  }

  return list;
};

export const normalizeObjectMap = (value) => {
  if (!value || typeof value !== "object") return {};
  return value;
};

const normalizeUserList = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      ...item,
      authUserId: typeof item.authUserId === "string" ? item.authUserId : "",
    }));
};

const resolveCurrentProfileId = ({ users, currentUserId, currentAuthUserId }) => {
  const normalizedCurrentUserId = typeof currentUserId === "string" ? currentUserId : "";
  if (!normalizedCurrentUserId) return "";
  if (users.some((user) => user.id === normalizedCurrentUserId)) return normalizedCurrentUserId;

  const authUserId = typeof currentAuthUserId === "string" && currentAuthUserId.trim()
    ? currentAuthUserId.trim()
    : normalizedCurrentUserId;
  const matchedUser = users.find((user) => user.authUserId && user.authUserId === authUserId);
  return matchedUser?.id || normalizedCurrentUserId;
};

export const normalizeAppState = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const seeded = createInitialAppState();
  const stores = Array.isArray(source.stores)
    ? source.stores.filter(Boolean).map(String)
    : [];
  const fallbackSelectedStore = typeof source.selectedStore === "string" && source.selectedStore.trim() ? source.selectedStore : "";
  const selectedStore = stores.includes(fallbackSelectedStore) ? fallbackSelectedStore : (stores[0] || fallbackSelectedStore);
  const selectedMonth = source.selectedMonth || seeded.selectedMonth;
  const users = normalizeUserList(source.users);
  const currentUserId = resolveCurrentProfileId({
    users,
    currentUserId: source.currentUserId,
    currentAuthUserId: source.currentAuthUserId,
  });
  const matchedCurrentUser = users.find((user) => user.id === currentUserId) || null;
  const currentAuthUserId = typeof source.currentAuthUserId === "string" && source.currentAuthUserId.trim()
    ? source.currentAuthUserId.trim()
    : matchedCurrentUser?.authUserId || "";

  return {
    ...seeded,
    ...source,
    users,
    stores,
    selectedStore,
    selectedMonth,
    currentUserId,
    currentAuthUserId,
    targets: normalizeObjectMap(source.targets),
    dailyResults: normalizeObjectMap(source.dailyResults),
    fixedCosts: normalizeObjectMap(source.fixedCosts),
    variableCosts: normalizeObjectMap(source.variableCosts),
    monthClosing: normalizeObjectMap(source.monthClosing),
    monthClosingStatus: normalizeObjectMap(source.monthClosingStatus),
    dailyDrafts: normalizeObjectMap(source.dailyDrafts),
    dailyResultBackups: normalizeObjectMap(source.dailyResultBackups),
    preferences: {
      ...(source.preferences || {}),
      showOtherSales: Boolean(source.preferences?.showOtherSales),
    },
    businessDaySettings: normalizeObjectMap(source.businessDaySettings),
    dayClosingStates: normalizeObjectMap(source.dayClosingStates),
    saveStatus: {
      status: source.saveStatus?.status || "saved",
      message: source.saveStatus?.message || "自動保存済み",
      timestamp: source.saveStatus?.timestamp || "",
      error: Boolean(source.saveStatus?.error),
    },
  };
};

export const readAppState = () => {
  try {
    const saved = readStorage(STORAGE_KEYS.appState, null);
    if (saved) {
      return normalizeAppState(saved);
    }
  } catch {
    // fall through to initial state
  }
  return createInitialAppState();
};

export const writeAppState = (state) => {
  try {
    const nextState = normalizeAppState(state);
    localStorage.setItem(STORAGE_KEYS.appState, JSON.stringify(nextState));
    return nextState;
  } catch {
    return state;
  }
};

export const money = (value) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

export const moneyDiff = (value) => `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`;

export const number = (value) => new Intl.NumberFormat("ja-JP").format(Number(value || 0));

export const percent = (value) => `${Number.isFinite(value) ? value.toFixed(1) : "0.0"}%`;

export const roundCurrency = (value, roundingMode = "half-up") => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;

  if (roundingMode === "floor") {
    return Math.floor(amount);
  }
  if (roundingMode === "ceil") {
    return Math.ceil(amount);
  }
  return Math.round(amount);
};

export const calculateTaxSummary = (input = {}) => {
  const salesInclusive = parseNumber(input.sales);
  const expensesInclusive = parseNumber(input.totalExpenses);
  const taxRate = Number(input.taxRate ?? 0.1);
  const rate = Number.isFinite(taxRate) && taxRate >= 0 ? taxRate : 0.1;
  const roundingMode = input.roundingMode || "half-up";
  const taxExclusiveSales = salesInclusive / (1 + rate);
  const taxAmount = salesInclusive - taxExclusiveSales;
  const taxExclusiveExpenses = expensesInclusive / (1 + rate);
  const taxAmountOnExpenses = expensesInclusive - taxExclusiveExpenses;
  const estimatedTax = roundCurrency(taxAmount, roundingMode);
  const estimatedTaxOnExpenses = roundCurrency(taxAmountOnExpenses, roundingMode);

  return {
    grossSales: roundCurrency(salesInclusive, roundingMode),
    taxExclusiveSales: roundCurrency(taxExclusiveSales, roundingMode),
    taxAmount: roundCurrency(taxAmount, roundingMode),
    taxExclusiveExpenses: roundCurrency(taxExclusiveExpenses, roundingMode),
    taxAmountOnExpenses: roundCurrency(estimatedTaxOnExpenses, roundingMode),
    rate,
    estimatedTax: roundCurrency(estimatedTax + estimatedTaxOnExpenses, roundingMode),
    roundingMode,
  };
};

export const getTargetForStoreMonth = (state, storeName, monthValue) => ({
  ...defaultTarget,
  ...(state.targets?.[buildMonthKey(storeName, monthValue)] || {}),
});

export const getDailyResultsForStoreMonth = (state, storeName, monthValue) => {
  const items = state.dailyResults?.[buildMonthKey(storeName, monthValue)] || [];
  const { entries } = deduplicateDailyEntries(items, state.dailyResultBackups || {});
  return entries;
};

export const getFixedCostsForStoreMonth = (state, storeName, monthValue) => {
  const targetKey = buildMonthKey(storeName, monthValue);
  const itemsByKey = Object.entries(state.fixedCosts || {})
    .filter(([key]) => key.startsWith(`${storeName}__`))
    .flatMap(([key, items]) => (Array.isArray(items) ? items.map((item) => ({ ...item, _sourceKey: key })) : []));

  return itemsByKey.filter((item) => {
    if (item._sourceKey === targetKey) {
      return true;
    }

    const startMonth = item.startMonth || "";
    const endMonth = item.endMonth || "";
    const sourceMonth = item._sourceKey?.split("__")?.[1] || "";
    const withinRange = (!startMonth || monthValue >= startMonth) && (!endMonth || monthValue <= endMonth);
    const fromEarlierMonth = sourceMonth ? monthValue >= sourceMonth : false;
    const applyMode = item.applyMode || "this-month";

    if (applyMode === "this-month-onward") {
      return fromEarlierMonth && (!startMonth || monthValue >= startMonth) && (!endMonth || monthValue <= endMonth);
    }

    return Boolean(startMonth || endMonth) && withinRange;
  });
};

export const getVariableCostsForStoreMonth = (state, storeName, monthValue) => {
  const items = state.variableCosts?.[buildMonthKey(storeName, monthValue)] || [];
  return [...items];
};

export const getClosingItemsForStoreMonth = (state, storeName, monthValue) => {
  const items = state.monthClosing?.[buildMonthKey(storeName, monthValue)] || [];
  return [...items];
};

export const calculateMonthSummary = (state, storeName, monthValue) => {
  const target = getTargetForStoreMonth(state, storeName, monthValue);
  const entries = getDailyResultsForStoreMonth(state, storeName, monthValue);
  const fixedCosts = getFixedCostsForStoreMonth(state, storeName, monthValue);
  const variableCosts = getVariableCostsForStoreMonth(state, storeName, monthValue);
  const closingItems = getClosingItemsForStoreMonth(state, storeName, monthValue);
  const businessDates = getBusinessDayDates(monthValue);
  const businessDaySummary = getBusinessDaySummary(state, storeName, monthValue);
  const taxRate = Number(state.taxSettings?.rate ?? 0.1);
  const roundingMode = state.taxSettings?.roundingMode || "half-up";
  const now = new Date();
  const todayIso = formatLocalDate(now);
  const selectedCurrentMonth = monthValue === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const effectiveEntries = entries;

  const sales = effectiveEntries.reduce((total, item) => total + parseNumber(item.totalSales || item.technicalSales || 0), 0);
  const technicalSales = effectiveEntries.reduce((total, item) => total + parseNumber(item.technicalSales || 0), 0);
  const retailSales = effectiveEntries.reduce((total, item) => total + parseNumber(item.retailSales || 0), 0);
  const otherSales = effectiveEntries.reduce((total, item) => total + parseNumber(item.otherSales || 0), 0);
  const customers = effectiveEntries.reduce((total, item) => total + parseNumber(item.customers || 0), 0);
  const newCustomers = effectiveEntries.reduce((total, item) => total + parseNumber(item.newCustomers || 0), 0);
  const repeatCustomers = effectiveEntries.reduce((total, item) => total + parseNumber(item.repeatCustomers || 0), 0);

  const laborCost = closingItems.filter((item) => item.category === "人件費").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const materialCost = closingItems.filter((item) => item.category === "材料費").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const orderCost = closingItems.filter((item) => item.category === "発注費").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const equipmentInvestmentCost = closingItems.filter((item) => item.category === "設備投資").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const fixedCost = fixedCosts.reduce((sum, item) => sum + parseNumber(item.amount), 0) + closingItems.filter((item) => item.category === "固定費").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const regularVariableCost = variableCosts.filter((item) => item.type !== "temporary").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const temporaryCost = variableCosts.filter((item) => item.type === "temporary").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const variableCost = regularVariableCost + temporaryCost + closingItems.filter((item) => item.category === "販管費").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const otherCost = closingItems.filter((item) => item.category === "その他").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const expenseTotal = laborCost + materialCost + orderCost + fixedCost + variableCost + equipmentInvestmentCost + otherCost;
  const grossProfit = sales - materialCost - orderCost - laborCost;
  const operatingProfit = sales - expenseTotal;
  const adjustedOperatingProfit = sales - expenseTotal + equipmentInvestmentCost;
  const taxSummary = calculateTaxSummary({ sales, totalExpenses: expenseTotal, taxRate, roundingMode });

  const targetSales = parseNumber(target.targetSales);
  const targetAchievement = targetSales ? (sales / targetSales) * 100 : 0;
  const remainingSalesTarget = Math.max(targetSales - sales, 0);
  const completedDays = businessDaySummary.completedDays;
  const remainingBusinessDays = businessDaySummary.remainingBusinessDays;
  const progressRate = businessDaySummary.progressRate;
  const targetPerDay = businessDaySummary.businessDayCount ? targetSales / businessDaySummary.businessDayCount : 0;
  const dailyNeededSales = remainingBusinessDays ? remainingSalesTarget / remainingBusinessDays : 0;
  const pace = completedDays ? sales / completedDays : 0;
  const forecast = businessDaySummary.businessDayCount ? pace * businessDaySummary.businessDayCount : sales;
  const averageSales = effectiveEntries.length > 0 ? sales / effectiveEntries.length : 0;
  const remainingAverageSales = remainingBusinessDays ? remainingSalesTarget / remainingBusinessDays : 0;
  const todayActual = effectiveEntries.filter((entry) => entry.date === todayIso).reduce((sum, item) => sum + parseNumber(item.totalSales || item.technicalSales || 0), 0);
  const todayTarget = targetPerDay;
  const todayAchievement = todayTarget ? (todayActual / todayTarget) * 100 : 0;
  const averageSpend = customers ? sales / customers : 0;
  const laborRate = sales ? (laborCost / sales) * 100 : 0;
  const materialRate = sales ? (materialCost / sales) * 100 : 0;
  const fixedRate = sales ? (fixedCost / sales) * 100 : 0;
  const variableRate = sales ? (variableCost / sales) * 100 : 0;
  const operatingMargin = sales ? (operatingProfit / sales) * 100 : 0;
  const adjustedOperatingMargin = sales ? (adjustedOperatingProfit / sales) * 100 : 0;
  const averageCustomersPerDay = businessDaySummary.businessDayCount ? customers / businessDaySummary.businessDayCount : 0;
  const repeatRate = customers ? (repeatCustomers / customers) * 100 : 0;
  const averageTicket = customers ? sales / customers : 0;
  const technicalUnitPrice = customers ? technicalSales / customers : 0;
  const retailCustomerCount = effectiveEntries.reduce((sum, item) => sum + parseNumber(item.retailCustomers || 0), 0);
  const retailRatioValue = sales > 0 ? Number(((retailSales / sales) * 100).toFixed(1)) : 0;
  const customerTarget = parseNumber(target.targetCustomers);
  const customerAchievement = customerTarget ? (customers / customerTarget) * 100 : 0;
  const remainingCustomersTarget = Math.max(customerTarget - customers, 0);
  const remainingCustomersPerDay = remainingBusinessDays ? remainingCustomersTarget / remainingBusinessDays : 0;
  const forecastCustomers = businessDaySummary.businessDayCount ? averageCustomersPerDay * businessDaySummary.businessDayCount : customers;
  const repeatTarget = parseNumber(target.targetRepeatRate);
  const repeatTargetAchievement = repeatTarget ? (repeatRate / repeatTarget) * 100 : 0;

  return {
    sales,
    technicalSales,
    retailSales,
    otherSales,
    customers,
    newCustomers,
    repeatCustomers,
    averageSpend,
    averageCustomersPerDay,
    repeatRate,
    repeatTarget,
    repeatTargetAchievement,
    technicalUnitPrice,
    retailCustomerCount,
    retailRatio: retailRatioValue,
    laborCost,
    materialCost,
    orderCost,
    equipmentInvestmentCost,
    fixedCost,
    variableCost,
    regularVariableCost,
    temporaryCost,
    otherCost,
    expenseTotal,
    grossProfit,
    operatingProfit,
    adjustedOperatingProfit,
    operatingMargin,
    adjustedOperatingMargin,
    laborRate,
    materialRate,
    fixedRate,
    variableRate,
    targetAchievement,
    remainingSalesTarget,
    targetPerDay,
    dailyNeededSales,
    forecast,
    todayActual,
    todayTarget,
    todayAchievement,
    completedDays,
    businessDays: businessDaySummary.businessDayCount ?? businessDates.length,
    remainingBusinessDays,
    progressRate,
    averageSales,
    remainingAverageSales,
    customerTarget,
    customerAchievement,
    remainingCustomersTarget,
    remainingCustomersPerDay,
    forecastCustomers,
    taxSummary,
    target,
    entries,
    fixedCosts,
    variableCosts,
    closingItems,
    expenseCategories,
  };
};

export const getCustomerTargetSummary = (input = {}) => {
  const customers = parseNumber(input.customers);
  const targetCustomers = parseNumber(input.targetCustomers);
  const businessDayCount = parseNumber(input.businessDayCount);
  const completedDays = parseNumber(input.completedDays);
  const remainingBusinessDays = parseNumber(input.remainingBusinessDays);
  const targetAverageCustomersPerDay = parseNumber(input.targetAverageCustomersPerDay);
  const remainingCustomers = Math.max(targetCustomers - customers, 0);
  const remainingCustomersPerDay = remainingBusinessDays > 0 ? remainingCustomers / remainingBusinessDays : 0;
  const forecastCustomers = businessDayCount > 0 ? (customers / Math.max(completedDays, 1)) * businessDayCount : customers;
  const statusLabel = remainingBusinessDays <= 0 ? "営業日終了" : "進行中";

  return {
    customers,
    targetCustomers,
    remainingCustomers,
    achievementRate: targetCustomers ? (customers / targetCustomers) * 100 : 0,
    remainingBusinessDays,
    remainingCustomersPerDay,
    forecastCustomers,
    statusLabel,
    targetAverageCustomersPerDay,
  };
};

class AiSummary extends Array {
  includes(searchElement) {
    return super.some((item) => String(item).includes(String(searchElement)));
  }
}

export const getAiAnalysis = (input = {}) => {
  const summary = new AiSummary();
  const priorities = [];
  const notes = [];

  const targetAchievement = Number(input.targetAchievement ?? 0);
  const customerAchievement = Number(input.customerAchievement ?? 0);
  const averageSpend = Number(input.averageSpend ?? 0);
  const targetAverageSpend = Number(input.targetAverageSpend ?? 0);
  const operatingMargin = Number(input.operatingMargin ?? 0);
  const targetOperatingMargin = Number(input.targetOperatingMargin ?? 0);
  const fixedCost = Number(input.fixedCost ?? 0);
  const variableCost = Number(input.variableCost ?? 0);
  const adjustedOperatingProfit = Number(input.adjustedOperatingProfit ?? 0);
  const remainingBusinessDays = Number(input.remainingBusinessDays ?? 0);
  const remainingSalesTarget = Number(input.remainingSalesTarget ?? 0);
  const remainingCustomersTarget = Number(input.remainingCustomersTarget ?? 0);
  const taxExclusiveSales = Number(input.taxExclusiveSales ?? 0);
  const taxAmount = Number(input.taxAmount ?? 0);
  const customers = Number(input.customers ?? 0);
  const targetCustomers = Number(input.customerTarget ?? input.targetCustomers ?? 0);

  if (Number.isFinite(targetAchievement)) {
    summary.push(`売上目標の達成状況: ${targetAchievement.toFixed(1)}%`);
  }
  if (Number.isFinite(customerAchievement)) {
    summary.push(`客数目標の達成状況: ${customerAchievement.toFixed(1)}%`);
  }
  if (Number.isFinite(targetAverageSpend)) {
    summary.push(`客単価目標の達成状況: ${averageSpend >= targetAverageSpend ? "達成" : "未達"}`);
  }
  if (Number.isFinite(targetOperatingMargin)) {
    summary.push(`利益目標の達成状況: ${operatingMargin >= targetOperatingMargin ? "達成" : "未達"}`);
  }

  if (customerAchievement < 100) {
    priorities.push("客数不足が売上未達の主因です");
    summary.push("未達の主因: 客数不足が主因です");
  } else {
    summary.push("未達の主因: 客数は目標達成しています");
  }

  if (averageSpend > targetAverageSpend) {
    notes.push(`客単価は目標を上回っており、${averageSpend - targetAverageSpend}円高です`);
  } else {
    notes.push("客単価は目標未達です");
  }

  if (fixedCost > 0 || variableCost > 0) {
    priorities.push("固定費と販管費の増減を確認してください");
  }

  if (adjustedOperatingProfit >= 0) {
    notes.push("設備投資を除いた調整後利益は改善傾向です");
  } else {
    notes.push("設備投資を除いた調整後利益は悪化しています");
  }

  if (remainingBusinessDays > 0) {
    notes.push(`残り営業日で必要な客数: ${Math.max(remainingCustomersTarget / remainingBusinessDays, 0).toFixed(1)}名`);
    notes.push(`残り営業日で必要な売上: ${Math.max(remainingSalesTarget / remainingBusinessDays, 0).toFixed(0)}円`);
  } else {
    notes.push("残り営業日数はありません");
  }

  if (taxExclusiveSales > 0) {
    notes.push(`税抜売上は${taxExclusiveSales.toFixed(0)}円、消費税相当額は${taxAmount.toFixed(0)}円です`);
  } else {
    notes.push("税抜売上のデータ不足");
  }

  if (customers <= 0 || targetCustomers <= 0) {
    notes.push("客数データ不足");
  }

  return {
    summary,
    priorities,
    notes,
    assumptions: [
      "消費税額は簡易計算による参考値です",
      "実際の申告額は課税区分や控除により異なる場合があります",
    ],
  };
};

export { defaultClosingItem, defaultDailyEntry, defaultFixedCostItem, defaultTarget, defaultVariableCostItem, expenseCategories };
