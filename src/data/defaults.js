export const initialStores = [];

export const expenseCategories = ["人件費", "材料費", "固定費", "販管費", "設備投資", "その他"];
export const fixedCostCategories = ["家賃", "リース代", "システム利用料", "通信費", "顧問料", "保険料", "定額広告費", "その他"];
export const variableCostCategories = ["広告費", "求人費", "交通費", "消耗品費", "会議費", "研修費", "外注費", "修繕費", "設備投資", "その他経費", "その他"];

export const defaultTarget = {
  targetSales: "",
  targetTechnicalSales: "",
  targetRetailSales: "",
  targetCustomers: "",
  targetAverageSpend: "",
  targetNewCustomers: "",
  targetRepeatCustomers: "",
  targetRepeatRate: "",
  targetAverageCustomersPerDay: "",
};

export const defaultDailyEntry = {
  date: "",
  totalSales: "",
  technicalSales: "",
  retailSales: "",
  otherSales: "",
  customers: "",
  newCustomers: "",
  repeatCustomers: "",
  salesInputMode: "inclusive",
};

export const defaultFixedCostItem = {
  id: "",
  name: "",
  amount: "",
  category: "家賃",
  memo: "",
  startMonth: "",
  endMonth: "",
  applyMode: "this-month",
};

export const defaultVariableCostItem = {
  id: "",
  name: "",
  amount: "",
  category: "広告費",
  memo: "",
  incurredDate: "",
  type: "regular",
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
    monthClosingStatus: {},
    dailyDrafts: {},
    preferences: {
      showOtherSales: false,
    },
    taxSettings: {
      rate: 0.1,
      roundingMode: "half-up",
      salesInputMode: "inclusive",
      expenseInputMode: "inclusive",
    },
    businessDaySettings: {},
    dayClosingStates: {},
    saveStatus: {
      status: "saved",
      message: "自動保存済み",
      timestamp: "",
      error: false,
    },
  };
};

export const defaultAppState = createInitialAppState();
