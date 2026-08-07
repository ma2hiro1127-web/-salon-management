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
  targetLaborRate: "",
  targetMaterialRate: "",
  targetAdRate: "",
  targetOperatingMargin: "",
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
  memo: "",
  salesInputMode: "inclusive",
};

// 日次入力画面に表示する項目。日付・総売上・日締めは仕様上常に必須のため、ここには含めない
// (非表示にできる6項目のみを管理する)。既存店舗にはこの設定がまだ無いので、デフォルトは
// 全項目表示(詳細入力相当)にして、これまでの見え方を変えないようにする。
export const dailyFieldKeys = ["technicalSales", "retailSales", "customers", "newCustomers", "repeatCustomers", "memo"];

export const dailyFieldPresets = {
  simple: { technicalSales: false, retailSales: false, customers: false, newCustomers: false, repeatCustomers: false, memo: false },
  detailed: { technicalSales: true, retailSales: true, customers: true, newCustomers: true, repeatCustomers: true, memo: true },
};

export const defaultDailyFieldSettings = () => ({
  mode: "detailed",
  fields: { ...dailyFieldPresets.detailed },
});

// Monthly target's toggleable fields. targetSales/targetTechnicalSales/... map 1:1 to
// defaultTarget's own keys above; holidayCount is the separate 休業日 input alongside them.
// company_id/store_id/target_month aren't here at all — those identify *which* target row is
// being edited, not a value on it, so there's nothing to toggle.
export const monthlyTargetFieldKeys = [
  "targetSales", "targetTechnicalSales", "targetRetailSales", "targetCustomers",
  "targetAverageSpend", "targetNewCustomers", "targetRepeatCustomers",
  "targetLaborRate", "targetMaterialRate", "targetAdRate", "targetOperatingMargin", "holidayCount",
];

export const defaultMonthlyTargetFieldSettings = () => ({
  fields: Object.fromEntries(monthlyTargetFieldKeys.map((key) => [key, true])),
});

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
    dailyResultBackups: {},
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
    dayClosingUpdatedAt: {},
    saveStatus: {
      status: "saved",
      message: "自動保存済み",
      timestamp: "",
      error: false,
    },
  };
};

export const defaultAppState = createInitialAppState();
