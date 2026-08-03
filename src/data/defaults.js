export const initialStores = [];

export const expenseCategories = ["人件費", "材料費", "固定費", "販管費", "その他"];

export const defaultTarget = {
  targetSales: "",
  targetTechnicalSales: "",
  targetRetailSales: "",
  targetCustomers: "",
  targetAverageSpend: "",
  targetNewCustomers: "",
  targetRepeatCustomers: "",
};

export const defaultDailyEntry = {
  date: "",
  totalSales: "",
  technicalSales: "",
  retailSales: "",
  customers: "",
  newCustomers: "",
  repeatCustomers: "",
};

export const defaultFixedCostItem = {
  id: "",
  name: "",
  amount: "",
};

export const defaultVariableCostItem = {
  id: "",
  name: "",
  amount: "",
};

export const defaultClosingItem = {
  id: "",
  name: "",
  amount: "",
  category: "人件費",
};

export const createInitialAppState = () => {
  const selectedMonth = new Date().toISOString().slice(0, 7);

  return {
    stores: [],
    selectedStore: "",
    selectedMonth,
    targets: {},
    dailyResults: {},
    fixedCosts: {},
    variableCosts: {},
    monthClosing: {},
  };
};

export const defaultAppState = createInitialAppState();
