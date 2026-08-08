export const initialStores = [];

export const expenseCategories = ["人件費", "材料費", "固定費", "販管費", "設備投資", "その他"];
// 月締めは人件費・材料費の実績確定に役割を絞る(費用入力と役割が被る固定費/販管費カテゴリは
// 選ばせない) — 損益表の固定費/販管費合計は費用入力(fixedCosts)から計算される。
export const closingCategories = ["人件費", "材料費", "その他"];
// 旧「固定費」「販管費」の区分をユーザーに選ばせず一本化した「費用入力」用カテゴリ。
// 「広告費」は経営指標の広告費率計算で使う識別子なので、必ずこの文字列そのものを含める。
export const costCategories = ["家賃", "リース代", "システム利用料", "通信費", "顧問料", "保険料", "広告費", "求人費", "交通費", "消耗品費", "会議費", "研修費", "外注費", "修繕費", "設備投資", "その他"];
// 後方互換のためexportは残すが、費用入力フォームはcostCategoriesを使う(fixedCostCategories/
// variableCostCategoriesの旧カテゴリ名は既存データの表示のみに使われ、新規入力では選ばせない)。
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
//
// targetLaborRate/targetMaterialRate/targetAdRate/targetOperatingMargin deliberately removed:
// these are cost *ratios*, not something you set a goal for ahead of time — they're now shown
// as actual, computed-from-real-data 経営指標 (management KPIs) on the P&L page instead (see
// calculateMonthSummary's laborRate/materialRate/adRate/operatingMargin). The monthly_targets
// columns and any already-saved values are untouched; this only stops the target-setting form
// and its per-store field-visibility toggle from offering them.
export const monthlyTargetFieldKeys = [
  "targetSales", "targetTechnicalSales", "targetRetailSales", "targetCustomers",
  "targetAverageSpend", "targetNewCustomers", "targetRepeatCustomers", "holidayCount",
];

export const defaultMonthlyTargetFieldSettings = () => ({
  fields: Object.fromEntries(monthlyTargetFieldKeys.map((key) => [key, true])),
});

// 「費用入力」の1件。applyModeはユーザーが選ぶ項目ではなくなり、startMonth/endMonthから
// 自動的に決まる(終了月なし=毎月継続、終了月あり=単月/期間指定)。保存時に自動計算して
// Supabaseへは引き続き書き込む(既存カラムはそのまま使う。表示・入力から外すだけ)。
export const defaultFixedCostItem = {
  id: "",
  name: "",
  amount: "",
  category: "家賃",
  memo: "",
  startMonth: "",
  endMonth: "",
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
    selectedStoreId: "",
    selectedMonth,
    targets: {},
    dailyResults: {},
    fixedCosts: {},
    variableCosts: {},
    monthClosing: {},
    monthClosingStatus: {},
    // Local-only historical log of daily entries dropped during dedup (see
    // deduplicateDailyEntries in storage.js) — deliberately NOT a Supabase table. It's write-only
    // bookkeeping, never read back to influence which entry wins a future merge, so it can never
    // resurrect a duplicate or a Supabase-deleted daily_sales row. Safe to lose on a fresh
    // device/browser; not production data.
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
