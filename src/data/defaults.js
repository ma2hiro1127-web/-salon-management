export const initialStores = [];

export const expenseCategories = ["人件費", "材料費", "固定費", "販管費", "設備投資", "その他"];
// 月締めは人件費・仕入(材料+発注をまとめた「仕入・発注額」)・その他の実績確定に役割を絞る
// (費用入力と役割が被る固定費/販管費カテゴリは選ばせない) — 損益表の経費合計は費用入力
// (fixedCosts)から計算される。「材料費」は「仕入・発注額」に改称し、ディーラー請求書の
// 月間合計(業務材料+店販商品仕入+送料等)をそのまま1つの金額として入力できるようにする。
export const closingCategories = ["人件費", "仕入・発注額", "その他"];
// 旧「固定費」「販管費」の区分をユーザーに選ばせず一本化した「費用入力」用カテゴリ。
// 「広告費」は経営指標の広告費率計算で使う識別子なので、必ずこの文字列そのものを含める。
export const costCategories = ["家賃", "リース代", "システム利用料", "通信費", "顧問料", "保険料", "広告費", "求人費", "交通費", "消耗品費", "会議費", "研修費", "外注費", "修繕費", "設備投資", "その他"];
// 後方互換のためexportは残すが、費用入力フォームはcostCategoriesを使う(fixedCostCategories/
// variableCostCategoriesの旧カテゴリ名は既存データの表示のみに使われ、新規入力では選ばせない)。
export const fixedCostCategories = ["家賃", "リース代", "システム利用料", "通信費", "顧問料", "保険料", "定額広告費", "その他"];
export const variableCostCategories = ["広告費", "求人費", "交通費", "消耗品費", "会議費", "研修費", "外注費", "修繕費", "設備投資", "その他経費", "その他"];

// 費用の内部管理用カテゴリ(固定のcategory_key)。表示名(label)は将来変更してもよいが、
// keyは絶対に変えない — 過去データの集計・AI分析(category_key基準)に影響が出るため。
// AIが費用名(例:「HPB」)だけから性質を推測しなくて済むよう、費用名とは別にこのカテゴリを
// 選ばせる。既存のcostCategories/closingCategories等(自由入力文字列)は、過去データの表示
// 互換のためだけに残し、新規入力フォームでは使わない。
export const costCategoryKeys = [
  { key: "rent", label: "家賃" },
  { key: "labor", label: "人件費・社会保険" },
  { key: "advertising", label: "広告費" },
  { key: "utilities", label: "光熱費" },
  { key: "communication", label: "通信費" },
  { key: "materials", label: "材料・発注費" },
  { key: "cleaning", label: "清掃・環境費" },
  { key: "system", label: "システム・サービス利用料" },
  { key: "tax_insurance", label: "税金・保険" },
  { key: "other", label: "その他費用" },
];
// 移行時に既存データから確実に判断できなかった項目のフォールバックkey。選択式UIの通常の
// 10択には出さない(ユーザーが後から手動で正しいカテゴリを選び直すための「未分類」専用)。
export const UNCATEGORIZED_KEY = "uncategorized";
export const getCostCategoryLabel = (key) =>
  costCategoryKeys.find((item) => item.key === key)?.label || "未分類";

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

// 「費用入力」の1件(項目の定義のみ。金額は対象月ごとにcostMonthlyAmountsへ別保存する)。
// periodTypeは「継続」「期間限定」の2択をユーザーに直接選ばせる明示フィールド。継続の場合、
// startMonthは登録した月を内部的に自動セットするだけで画面には出さず、endMonthは常に空。
// 期間限定の場合のみstartMonth/endMonthを年月ピッカーで入力させる。
export const defaultFixedCostItem = {
  id: "",
  name: "",
  amount: "",
  category: "",
  categoryKey: "",
  memo: "",
  periodType: "ongoing",
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
    // 月次レビュー(利益管理ではない自由記述4項目)。`${storeId}__${month}`(店舗ごと)または
    // `${companyId}__${month}`(store_id=null、全店舗ビューの会社全体レビュー)でキー化する
    // ——他の店舗別/全社別データ(storeHolidays/allStoresHolidays等)と同じ2系統のキー形式を
    // そのまま流用している(buildMonthlyReviewKey参照)。
    monthlyReviews: {},
    // store_status_audit_log由来。停止/再開/アーカイブ/復元/削除の履歴を{storeId, action,
    // createdAt}の配列で保持する(company_id単位で丸ごと取得、month等でのキー化はしない —
    // 件数が少なく、店舗の生涯で数件程度しか増えないため)。全店舗カレンダーの完了判定が
    // 「今のstatusだけ」ではなく「その日付時点で本当に営業対象だったか」を判定できるように
    // するためのもの(getStoreStatusAsOfDate参照、要件3)。
    storeStatusAuditLog: [],
    selectedStore: "",
    selectedStoreId: "",
    selectedMonth,
    // 加盟店連携(閲覧専用)。isViewingFranchiseがtrueの間、currentCompanyIdは加盟店の会社を
    // 指し、homeCompanyIdBeforeFranchiseViewが「本社に戻る」で復元する自社company_id。
    // ページを再読み込みすると常にfalse/空へリセットされる(常に自社から始まる、意図的な
    // 単純化)。
    isViewingFranchise: false,
    homeCompanyIdBeforeFranchiseView: "",
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
    // まとめて入力(daily_batch_entries)。`${storeId}__${month}` -> [{startDate, endDate,
    // totalSales, ...}] という配列。dailyResults(daily_sales由来、1日1件)には絶対に混ぜない
    // — 日別データへ分割しないという要件そのものであり、この2つを分けて持つことがその保証。
    dailyBatchEntries: {},
    // 日計(現金/キャッシュレス/ポイント利用の内訳)。daily_sales(dailyResults)とは完全に
    // 別のマップ — `${storeId}__${month}` -> { [date]: {cashAmount, cashlessAmount, pointAmount} }。
    // 総売上・損益・月次集計のどの計算もこのフィールドを参照しないため、二重計上は構造的に
    // 起こらない。
    cashBreakdownResults: {},
    fixedCosts: {},
    // cost_monthly_amounts — 対象月ごとの費用金額。fixedCosts(項目定義)とは別に
    // `${costItemId}__${targetMonth}`でキー化する(storeId__monthではないためSTORE_KEYED_MAPS
    // の対象外、variableCostsと同じ3か月ウィンドウでフェッチする)。
    costMonthlyAmounts: {},
    // store_inventory_balances — 在庫管理ONの店舗の対象月末在庫金額。`${storeId}__${targetMonth}`
    // でキー化する(costMonthlyAmountsと同じ3か月ウィンドウでフェッチする)。
    storeInventoryBalances: {},
    // store_monthly_cost_overrides — 人件費・仕入(材料・発注費)の「その月だけの手動確定額」。
    // `${storeId}__${targetMonth}`でキー化する(costMonthlyAmountsと同じ会社全体・無制限取得)。
    storeMonthlyCostOverrides: {},
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
      // 「消費税を考慮する」(任意機能、初期値OFF)。ONの場合のみconsumptionTaxReserveRate
      // (%)を使って、総売上に対する資金確保用の概算引当額を損益表に追加表示する。正式な
      // 納税額の自動計算ではない(calculateMonthSummaryのconsumptionTaxReserveAmount参照)。
      considerConsumptionTax: false,
      consumptionTaxReserveRate: 0,
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
