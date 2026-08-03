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

export const normalizeAppState = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const seeded = createInitialAppState();
  const stores = Array.isArray(source.stores)
    ? source.stores.filter(Boolean).map(String)
    : [];
  const selectedStore = stores.includes(source.selectedStore) ? source.selectedStore : stores[0] || "";
  const selectedMonth = source.selectedMonth || seeded.selectedMonth;

  return {
    ...seeded,
    ...source,
    stores,
    selectedStore,
    selectedMonth,
    targets: normalizeObjectMap(source.targets),
    dailyResults: normalizeObjectMap(source.dailyResults),
    fixedCosts: normalizeObjectMap(source.fixedCosts),
    variableCosts: normalizeObjectMap(source.variableCosts),
    monthClosing: normalizeObjectMap(source.monthClosing),
  };
};

export const readAppState = () => {
  const saved = readStorage(STORAGE_KEYS.appState, null);
  if (saved) {
    return normalizeAppState(saved);
  }
  return createInitialAppState();
};

export const writeAppState = (state) => {
  const nextState = normalizeAppState(state);
  localStorage.setItem(STORAGE_KEYS.appState, JSON.stringify(nextState));
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

export const getTargetForStoreMonth = (state, storeName, monthValue) => ({
  ...defaultTarget,
  ...(state.targets?.[buildMonthKey(storeName, monthValue)] || {}),
});

export const getDailyResultsForStoreMonth = (state, storeName, monthValue) => {
  const items = state.dailyResults?.[buildMonthKey(storeName, monthValue)] || [];
  return [...items].sort((a, b) => String(a.date).localeCompare(String(b.date)));
};

export const getFixedCostsForStoreMonth = (state, storeName, monthValue) => {
  const items = state.fixedCosts?.[buildMonthKey(storeName, monthValue)] || [];
  return [...items];
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
  const now = new Date();
  const todayIso = formatLocalDate(now);
  const selectedCurrentMonth = monthValue === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const effectiveEntries = entries.filter((entry) => !selectedCurrentMonth || entry.date <= todayIso);

  const sales = effectiveEntries.reduce((total, item) => total + parseNumber(item.totalSales || item.technicalSales || 0), 0);
  const technicalSales = effectiveEntries.reduce((total, item) => total + parseNumber(item.technicalSales || 0), 0);
  const retailSales = effectiveEntries.reduce((total, item) => total + parseNumber(item.retailSales || 0), 0);
  const customers = effectiveEntries.reduce((total, item) => total + parseNumber(item.customers || 0), 0);
  const newCustomers = effectiveEntries.reduce((total, item) => total + parseNumber(item.newCustomers || 0), 0);
  const repeatCustomers = effectiveEntries.reduce((total, item) => total + parseNumber(item.repeatCustomers || 0), 0);

  const laborCost = closingItems.filter((item) => item.category === "人件費").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const materialCost = closingItems.filter((item) => item.category === "材料費").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const fixedCost = fixedCosts.reduce((sum, item) => sum + parseNumber(item.amount), 0) + closingItems.filter((item) => item.category === "固定費").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const variableCost = variableCosts.reduce((sum, item) => sum + parseNumber(item.amount), 0) + closingItems.filter((item) => item.category === "販管費").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const otherCost = closingItems.filter((item) => item.category === "その他").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const operatingProfit = sales - laborCost - materialCost - fixedCost - variableCost - otherCost;

  const targetSales = parseNumber(target.targetSales);
  const targetAchievement = targetSales ? (sales / targetSales) * 100 : 0;
  const remainingSalesTarget = Math.max(targetSales - sales, 0);
  const completedDays = businessDates.filter((date) => date <= todayIso).length;
  const remainingBusinessDays = Math.max(businessDates.length - completedDays, 0);
  const targetPerDay = businessDates.length ? targetSales / businessDates.length : 0;
  const dailyNeededSales = remainingBusinessDays ? remainingSalesTarget / remainingBusinessDays : 0;
  const pace = completedDays ? sales / completedDays : 0;
  const forecast = pace * businessDates.length;
  const todayActual = effectiveEntries.filter((entry) => entry.date === todayIso).reduce((sum, item) => sum + parseNumber(item.totalSales || item.technicalSales || 0), 0);
  const todayTarget = targetPerDay;
  const todayAchievement = todayTarget ? (todayActual / todayTarget) * 100 : 0;
  const averageSpend = customers ? sales / customers : 0;
  const retailRatio = sales ? (retailSales / sales) * 100 : 0;
  const laborRate = sales ? (laborCost / sales) * 100 : 0;
  const materialRate = sales ? (materialCost / sales) * 100 : 0;
  const fixedRate = sales ? (fixedCost / sales) * 100 : 0;
  const variableRate = sales ? (variableCost / sales) * 100 : 0;
  const operatingMargin = sales ? (operatingProfit / sales) * 100 : 0;

  return {
    sales,
    technicalSales,
    retailSales,
    customers,
    newCustomers,
    repeatCustomers,
    averageSpend,
    retailRatio,
    laborCost,
    materialCost,
    fixedCost,
    variableCost,
    otherCost,
    operatingProfit,
    operatingMargin,
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
    businessDays: businessDates.length,
    remainingBusinessDays,
    target,
    entries,
    fixedCosts,
    variableCosts,
    closingItems,
    expenseCategories,
  };
};

export { defaultClosingItem, defaultDailyEntry, defaultFixedCostItem, defaultTarget, defaultVariableCostItem, expenseCategories };
