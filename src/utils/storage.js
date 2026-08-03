import { createDefaultAppState, defaultActual, defaultAppState, defaultTarget, initialStores } from "../data/defaults";

export const STORAGE_KEYS = {
  theme: "salon-theme",
  appState: "salon-goal-app",
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

export const buildMonthKey = (store, month) => `${store}__${month}`;

export const getMonthInfo = (monthValue) => {
  const [year, month] = monthValue.split("-").map(Number);
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const daysInMonth = new Date(yearNumber, monthNumber, 0).getDate();
  const firstDate = new Date(yearNumber, monthNumber - 1, 1);
  const lastDate = new Date(yearNumber, monthNumber, 0);
  return { yearNumber, monthNumber, daysInMonth, firstDate, lastDate };
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

const normalizeStoreList = (value) => {
  if (!Array.isArray(value) || value.length === 0) return [...initialStores];
  return [...new Set(value.filter(Boolean).map(String))];
};

const normalizeHolidayDates = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);
};

const hasMeaningfulAppData = (value) => {
  if (!value || typeof value !== "object") return false;

  const recordValues = [
    ...Object.values(value.targets || {}),
    ...Object.values(value.actuals || {}),
    ...Object.values(value.dailyResults || {}),
  ];

  for (const record of recordValues) {
    if (Array.isArray(record)) {
      if (record.length > 0) return true;
      continue;
    }

    if (!record || typeof record !== "object") continue;

    for (const item of Object.values(record)) {
      if (Array.isArray(item)) {
        if (item.length > 0) return true;
        continue;
      }
      if (typeof item === "number" && item !== 0) return true;
      if (typeof item === "string" && item.trim() !== "") return true;
      if (typeof item === "boolean") return true;
    }
  }

  return false;
};

export const normalizeAppState = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const seeded = createDefaultAppState();
  const useSeeded = !hasMeaningfulAppData(source);
  const base = useSeeded ? seeded : { ...seeded, ...source };
  const stores = normalizeStoreList(base.stores || source.stores);
  const selectedStore = stores.includes(base.selectedStore) ? base.selectedStore : stores[0] || initialStores[0];

  return {
    ...seeded,
    ...base,
    stores,
    selectedStore,
    selectedMonth: base.selectedMonth || seeded.selectedMonth,
    targets: base.targets && typeof base.targets === "object" ? base.targets : {},
    actuals: base.actuals && typeof base.actuals === "object" ? base.actuals : {},
    dailyResults: base.dailyResults && typeof base.dailyResults === "object" ? base.dailyResults : {},
  };
};

export const readAppState = () => {
  const saved = readStorage(STORAGE_KEYS.appState, null);
  if (saved) {
    const normalized = normalizeAppState(saved);
    if (Object.keys(normalized.targets || {}).length > 0 || Object.keys(normalized.dailyResults || {}).length > 0) {
      return normalized;
    }
    return createDefaultAppState();
  }

  const seeded = createDefaultAppState();
  const legacyStores = readStorage("salon-stores", seeded.stores);
  const legacyMonthData = readStorage("salon-monthly-data", {});
  const stores = normalizeStoreList(legacyStores);
  const monthState = {};
  const actuals = {};

  Object.entries(legacyMonthData || {}).forEach(([key, monthData]) => {
    if (!monthData || typeof monthData !== "object") return;
    const [storeName, monthValue] = key.split("__");
    if (!storeName || !monthValue) return;
    monthState[storeName] = monthState[storeName] || {};
    monthState[storeName][monthValue] = monthData;
  });

  stores.forEach((storeName) => {
    Object.keys(monthState[storeName] || {}).forEach((monthValue) => {
      const monthData = monthState[storeName][monthValue] || {};
      actuals[buildMonthKey(storeName, monthValue)] = {
        materialCost: parseNumber(monthData.materialCost),
        laborCost: parseNumber(monthData.laborCost),
        advertising: parseNumber(monthData.advertising),
        rent: parseNumber(monthData.rent),
        utilities: parseNumber(monthData.utilities),
        systemFees: parseNumber(monthData.systemFees),
        miscellaneous: parseNumber(monthData.miscellaneous),
        retailCost: parseNumber(monthData.retailCost),
      };
    });
  });

  const legacyTargetData = {
    stores,
    selectedStore: stores[0] || initialStores[0],
    selectedMonth: readStorage("salon-selected-month", defaultAppState.selectedMonth),
    targets: {},
    actuals,
    dailyResults: {},
  };

  return normalizeAppState(legacyTargetData);
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

export const number = (value) =>
  new Intl.NumberFormat("ja-JP").format(Number(value || 0));

export const percent = (value) => `${Number.isFinite(value) ? value.toFixed(1) : "0.0"}%`;

export const percentValue = (value) => (Number.isFinite(value) ? value : 0);

export const getTargetForStoreMonth = (state, storeName, monthValue) => {
  const key = buildMonthKey(storeName, monthValue);
  return {
    ...defaultTarget,
    ...(state.targets?.[key] || {}),
    holidayDates: normalizeHolidayDates((state.targets?.[key]?.holidayDates) || []),
  };
};

export const getActualForStoreMonth = (state, storeName, monthValue) => ({
  ...defaultActual,
  ...(state.actuals?.[buildMonthKey(storeName, monthValue)] || {}),
});

export const getDailyResultsForStoreMonth = (state, storeName, monthValue) => {
  const items = state.dailyResults?.[buildMonthKey(storeName, monthValue)] || [];
  return [...items].sort((a, b) => String(a.date).localeCompare(String(b.date)));
};

export const calculateMonthSummary = (state, storeName, monthValue) => {
  const target = getTargetForStoreMonth(state, storeName, monthValue);
  const actual = getActualForStoreMonth(state, storeName, monthValue);
  const entries = getDailyResultsForStoreMonth(state, storeName, monthValue);
  const businessDates = getBusinessDayDates(monthValue, target.holidayDates || []);
  const monthInfo = getMonthInfo(monthValue);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const todayIso = formatLocalDate(now);
  const isSelectedCurrentMonth = monthValue === currentMonth;
  const effectiveEntries = entries.filter((entry) => {
    if (!entry.date) return false;
    return isSelectedCurrentMonth ? entry.date <= todayIso : true;
  });

  const sales = effectiveEntries.reduce((total, item) => total + Number(item.technicalSales || 0) + Number(item.retailSales || 0), 0);
  const technicalSales = effectiveEntries.reduce((total, item) => total + Number(item.technicalSales || 0), 0);
  const retailSales = effectiveEntries.reduce((total, item) => total + Number(item.retailSales || 0), 0);
  const customers = effectiveEntries.reduce((total, item) => total + Number(item.customers || 0), 0);
  const newCustomers = effectiveEntries.reduce((total, item) => total + Number(item.newCustomers || 0), 0);
  const repeatCustomers = effectiveEntries.reduce((total, item) => total + Number(item.repeatCustomers || 0), 0);
  const totalStaffCount = effectiveEntries.reduce((total, item) => total + Number(item.staffCount || 0), 0);

  const grossProfit = sales - (Number(actual.materialCost || 0) + Number(actual.retailCost || 0));
  const operatingExpenses =
    Number(actual.laborCost || 0) +
    Number(actual.advertising || 0) +
    Number(actual.rent || 0) +
    Number(actual.utilities || 0) +
    Number(actual.systemFees || 0) +
    Number(actual.miscellaneous || 0);
  const operatingProfit = grossProfit - operatingExpenses;
  const averageSpend = customers ? sales / customers : 0;
  const newRate = customers ? (newCustomers / customers) * 100 : 0;
  const repeatRate = customers ? (repeatCustomers / customers) * 100 : 0;
  const retailRatio = sales ? (retailSales / sales) * 100 : 0;
  const laborRate = sales ? (Number(actual.laborCost || 0) / sales) * 100 : 0;
  const materialRate = sales ? (Number(actual.materialCost || 0) / sales) * 100 : 0;
  const adRate = sales ? (Number(actual.advertising || 0) / sales) * 100 : 0;
  const operatingMargin = sales ? (operatingProfit / sales) * 100 : 0;
  const productivity = totalStaffCount ? sales / totalStaffCount : 0;

  const targetGap = sales - Number(target.targetSales || 0);
  const targetAchievement = Number(target.targetSales || 0) ? (sales / target.targetSales) * 100 : 0;
  const dayProgress = businessDates.length ? (businessDates.filter((item) => item <= todayIso).length / businessDates.length) * 100 : 0;
  const targetPerDay = businessDates.length ? Number(target.targetSales || 0) / businessDates.length : 0;
  const completedDays = businessDates.filter((item) => item <= todayIso).length;
  const currentCumulativeTarget = targetPerDay * completedDays;
  const targetVariance = sales - currentCumulativeTarget;
  const remainingBusinessDays = Math.max(businessDates.length - completedDays, 0);
  const remainingSalesTarget = Math.max(Number(target.targetSales || 0) - sales, 0);
  const neededPerDay = remainingBusinessDays ? remainingSalesTarget / remainingBusinessDays : 0;
  const pace = completedDays ? sales / completedDays : 0;
  const forecast = pace * businessDates.length;
  const forecastGap = forecast - Number(target.targetSales || 0);
  const todayTarget = targetPerDay;
  const todayActual = entries.filter((entry) => entry.date === todayIso).reduce((sum, item) => sum + Number(item.technicalSales || 0) + Number(item.retailSales || 0), 0);
  const todayGap = todayActual - todayTarget;

  return {
    sales,
    technicalSales,
    retailSales,
    customers,
    newCustomers,
    repeatCustomers,
    grossProfit,
    operatingExpenses,
    operatingProfit,
    averageSpend,
    newRate,
    repeatRate,
    retailRatio,
    laborRate,
    materialRate,
    adRate,
    operatingMargin,
    productivity,
    targetGap,
    targetAchievement,
    targetPerDay,
    completedDays,
    totalBusinessDays: businessDates.length || monthInfo.daysInMonth,
    dayProgress,
    currentCumulativeTarget,
    targetVariance,
    remainingBusinessDays,
    remainingSalesTarget,
    neededPerDay,
    forecast,
    forecastGap,
    todayTarget,
    todayActual,
    todayGap,
    target,
    actual,
    entries,
  };
};
