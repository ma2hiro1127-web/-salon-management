import { defaultAppState, initialStores } from "../data/defaults";

export const STORAGE_KEYS = {
  theme: "salon-theme",
  appState: "salon-app-state",
};

export const readStorage = (key, fallback) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
};

const normalizeStoreList = (value) => {
  if (!Array.isArray(value) || value.length === 0) return [...initialStores];
  return value.filter(Boolean).map(String);
};

export const normalizeAppState = (value) => {
  const fallback = { ...defaultAppState, stores: [...initialStores], selectedStore: initialStores[0] };
  const source = value && typeof value === "object" ? value : {};
  const stores = normalizeStoreList(source.stores);
  const selectedStore = stores.includes(source.selectedStore) ? source.selectedStore : stores[0] || "本店";

  return {
    ...fallback,
    ...source,
    stores,
    selectedStore,
    selectedMonth: source.selectedMonth || defaultAppState.selectedMonth,
    monthlyData: source.monthlyData && typeof source.monthlyData === "object" ? source.monthlyData : {},
    staff: Array.isArray(source.staff) ? source.staff : [],
    customers: Array.isArray(source.customers) ? source.customers : [],
    reservations: Array.isArray(source.reservations) ? source.reservations : [],
    inventory: Array.isArray(source.inventory) ? source.inventory : [],
  };
};

export const readAppState = () => {
  const saved = readStorage(STORAGE_KEYS.appState, null);
  if (saved) return normalizeAppState(saved);

  const legacyState = {
    stores: readStorage("salon-stores", initialStores),
    selectedStore: readStorage("salon-selected-store", initialStores[0]),
    selectedMonth: readStorage("salon-selected-month", defaultAppState.selectedMonth),
    monthlyData: readStorage("salon-monthly-data", {}),
    staff: readStorage("salon-staff", []),
    customers: readStorage("salon-customers", []),
    reservations: readStorage("salon-reservations", []),
    inventory: readStorage("salon-inventory", []),
  };

  return normalizeAppState(legacyState);
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

export const number = (value) =>
  new Intl.NumberFormat("ja-JP").format(Number(value || 0));

export const percent = (value) => `${Number.isFinite(value) ? value.toFixed(1) : "0.0"}%`;

export const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const getPreviousYearMonth = (monthValue) => {
  if (!monthValue) return "";
  const [year, month] = monthValue.split("-").map(Number);
  const target = new Date(year, month - 1, 1);
  target.setFullYear(target.getFullYear() - 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
};

export const calcSalesSummary = (monthData = {}) => {
  const sales = Number(monthData.technicalSales || 0) + Number(monthData.retailSales || 0);
  const variableCost = Number(monthData.materialCost || 0) + Number(monthData.retailCost || 0);
  const grossProfit = sales - variableCost;
  const operatingExpenses =
    Number(monthData.laborCost || 0) +
    Number(monthData.rent || 0) +
    Number(monthData.advertising || 0) +
    Number(monthData.utilities || 0) +
    Number(monthData.systemFees || 0) +
    Number(monthData.miscellaneous || 0);
  const operatingProfit = grossProfit - operatingExpenses;
  const averageSpend = monthData.customers ? sales / monthData.customers : 0;
  const repeatRate = monthData.customers
    ? (Number(monthData.repeatCustomers || 0) / monthData.customers) * 100
    : 0;
  const laborRate = sales ? (Number(monthData.laborCost || 0) / sales) * 100 : 0;
  const materialRate = Number(monthData.technicalSales || 0)
    ? (Number(monthData.materialCost || 0) / Number(monthData.technicalSales || 0)) * 100
    : 0;
  const advertisingRate = sales ? (Number(monthData.advertising || 0) / sales) * 100 : 0;
  const operatingMargin = sales ? (operatingProfit / sales) * 100 : 0;
  const retailRate = sales ? (Number(monthData.retailSales || 0) / sales) * 100 : 0;

  return {
    sales,
    variableCost,
    grossProfit,
    operatingExpenses,
    operatingProfit,
    averageSpend,
    repeatRate,
    laborRate,
    materialRate,
    advertisingRate,
    operatingMargin,
    retailRate,
  };
};
