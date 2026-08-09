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
  // 口コミ数目標: 日次入力項目設定で口コミ数がONの店舗だけが月間目標設定に表示・入力する
  // (monthlyTargetFieldKeysの一般トグルとは別の、口コミ数フィールドONに完全連動した表示条件)。
  targetReviewCount: "",
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
  reviewCount: "",
  memo: "",
  salesInputMode: "inclusive",
};

// 日次入力画面に表示する項目。日付・総売上・日締めは仕様上常に必須のため、ここには含めない
// (非表示にできる6項目のみを管理する)。既存店舗にはこの設定がまだ無いので、デフォルトは
// 全項目表示(詳細入力相当)にして、これまでの見え方を変えないようにする。
// 口コミ数・その他売上はどちらもデフォルトOFF: simple/detailedどちらのプリセットにも
// 含めず、店舗ごとに個別でONにした場合だけ日次入力(・口コミ数は月間目標設定/売上画面KPIにも)
// 登場する(既存店舗は未設定=falseにフォールバックするため、既存データ・既存の見え方には
// 一切影響しない)。その他売上は以前は会社単位のpreferences.showOtherSalesという別の仕組みで
// 制御していたが、他の日次入力項目と同じ「店舗ごとにON/OFF」に統一した(表示設定からは削除)。
export const dailyFieldKeys = ["technicalSales", "retailSales", "customers", "newCustomers", "repeatCustomers", "memo", "reviewCount", "otherSales"];

export const dailyFieldPresets = {
  simple: { technicalSales: false, retailSales: false, customers: false, newCustomers: false, repeatCustomers: false, memo: false, reviewCount: false, otherSales: false },
  detailed: { technicalSales: true, retailSales: true, customers: true, newCustomers: true, repeatCustomers: true, memo: true, reviewCount: false, otherSales: false },
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
// targetReviewCount was previously shown/hidden automatically based on the store's daily-input
// 口コミ数 field toggle (日次入力項目設定) rather than this per-field monthly-target toggle list.
// Moved here so it's controlled the same way as every other monthly target field, positioned
// right after targetRepeatCustomers. Unlike the others (which all default visible), it defaults
// OFF — same reasoning as dailyFieldPresets' reviewCount/otherSales: most stores don't track it,
// so it shouldn't suddenly appear on every existing store's target-setting screen.
export const monthlyTargetFieldKeys = [
  "targetSales", "targetTechnicalSales", "targetRetailSales", "targetCustomers",
  "targetAverageSpend", "targetNewCustomers", "targetRepeatCustomers", "targetReviewCount", "holidayCount",
];

export const defaultMonthlyTargetFieldSettings = () => ({
  fields: {
    ...Object.fromEntries(monthlyTargetFieldKeys.map((key) => [key, true])),
    targetReviewCount: false,
  },
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

// company_admin専用の「全店舗」仮想ビューをselectedStoreとして表す予約値。実店舗のnameとは
// 絶対に衝突しない(実店舗名として保存できない形式)。実店舗のstoreレコードは一切作らない。
export const ALL_STORES_VALUE = "__all_stores__";

export const createInitialAppState = () => {
  const selectedMonth = new Date().toISOString().slice(0, 7);

  return {
    stores: [],
    selectedStore: "",
    selectedStoreId: "",
    selectedMonth,
    targets: {},
    // 「全店舗」専用の目標値・営業日設定(company_id__target_monthでキー化、店舗には紐づかない)。
    // 各店舗のtargets/businessDaySettingsとは完全に別管理で、実店舗の目標を書き換えない。
    allStoresTargets: {},
    allStoresBusinessDaySettings: {},
    // 店休日をカレンダーの具体的な日付で管理する新形式(storeName__month / companyId__month
    // でキー化した、その月の店休日ISO日付の配列)。既存のholidayCount(日数のみ)とは別管理で、
    // カレンダーで日付が設定されている場合にそちらを優先する(getBusinessDaySummary参照)。
    storeHolidays: {},
    allStoresHolidays: {},
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
