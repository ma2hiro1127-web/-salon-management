import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./App.css";
import NumericInput from "./components/common/NumericInput.jsx";
import FieldToggleList from "./components/common/FieldToggleList.jsx";
import SaveStatusInline from "./components/common/SaveStatusInline.jsx";
import StoreManagementPage from "./components/stores/StoreManagementPage.jsx";
import {
  dailyFieldKeys,
  dailyFieldLabels,
  monthlyTargetFieldKeys,
  monthlyTargetFieldLabels,
  defaultDailyEntry,
  defaultDailyFieldSettings,
  defaultFixedCostItem,
  defaultMonthlyTargetFieldSettings,
  defaultTarget,
  costCategoryKeys,
  getCostCategoryLabel,
  ALL_STORES_VALUE,
} from "./data/defaults.js";
import {
  STORAGE_KEYS,
  buildDailyEntryPayload,
  buildDailyStateFromRows,
  buildCashBreakdownStateFromRows,
  buildBatchEntryStateFromRows,
  buildDailyBatchEntryPayload,
  dailyBatchEntryRowToEntry,
  getBatchEntriesForStoreMonth,
  getBatchAllocatedEntries,
  detectBatchEntryFieldOverlap,
  dailySalesRowToEntry,
  buildMonthClosingStateFromRows,
  buildTargetStateFromRows,
  buildFixedCostsStateFromRows,
  buildVariableCostsStateFromRows,
  buildMonthlyClosingItemsStateFromRows,
  buildCompanySettingsFromRow,
  buildStoreProfilesByStoreId,
  pruneStaleKeys,
  pruneDeletedItemsFromItemArrayMap,
  buildMonthKey,
  calculateMonthSummary,
  getStoreMonthSalesTotal,
  deduplicateDailyEntries,
  getBusinessDaySettings,
  formatMonthLabel,
  formatDailyDateLabel,
  getBusinessDaySummary,
  getMonthClosingChecklist,
  needsMonthReconfirmation,
  formatMoneyOrDash,
  formatPercentOrDash,
  getPreviousMonthAmountByNameAndCategory,
  getCustomerTargetSummary,
  getStaffProductivitySummary,
  getDailyResultsForStoreMonth,
  getFixedCostsForStoreMonth,
  resolveDailyEntryEditState,
  runWithSaveGuard,
  getCostMonthlyAmount,
  getPreviousMonthCostAmount,
  buildCostMonthlyAmountsStateFromRows,
  getInventoryBalance,
  getPreviousMonthInventoryBalance,
  buildStoreInventoryBalancesStateFromRows,
  buildStoreMonthlyCostOverridesStateFromRows,
  formatLocalDate,
  getMonthInfo,
  getMonthOffset,
  getTargetForStoreMonth,
  getAllStoresTargetForCompanyMonth,
  getAllStoresBusinessDaySettings,
  getAllStoresBusinessDaySummary,
  getUnclosedStoresForDate,
  getMonthlyReviewSummary,
  getMonthlyReviewText,
  buildMonthlyReviewStateFromRows,
  buildMonthlyReviewKey,
  monthlyReviewRowToEntry,
  resolvePreferredStoreSelection,
  resolveCurrentCompany,
  resolveHydrateDispatch,
  normalizeStoreNameForDuplicateCheck,
  calculateAllStoresMonthSummary,
  buildAllStoresTargetStateFromRows,
  buildCompanyMonthKey,
  getStoreHolidayDates,
  getAllStoresHolidayDates,
  isHolidayDate,
  buildStoreHolidaysStateFromRows,
  buildAllStoresHolidaysStateFromRows,
  mergeRemoteAppState,
  buildPersistenceComparableState,
  canonicalStringifyForComparison,
  money,
  moneyDiff,
  number,
  parseNumber,
  percent,
  readAppState,
  readStorage,
  normalizeAppState,
  writeAppState,
} from "./utils/storage.js";
import { getAllowedStoreIdsForRole, getVisibleNavItems, resolveDefaultPage, canAccessPage, canManageCompanies, canManageStores, canEditStoreName, canEditMonthlyData, canManageUsers as canManageUsersByRole, canViewUserManagement, canViewAllStores, getInvitableRoles, getRoleLabel, normalizeRole, isAdminRole, canManageFranchisePartnerships, canCreateFranchiseRequest, isFranchiseReadOnly, getUserRowPermissions, canManageAdOps } from "./utils/permissions.js";
import { createInitialAppState } from "./data/defaults.js";
import { computeAnchoredPopoverPosition } from "./utils/popoverPosition.js";
import LoginScreen from "./components/LoginScreen.jsx";
import AccessDenied from "./components/AccessDenied.jsx";
import AppHeader from "./components/AppHeader.jsx";
import {
  supabase,
  isSupabaseConfigured,
  getSupabaseConfigurationIssue,
  getSupabaseErrorMessage,
  signInWithEmail,
  signOutFromSupabase,
  getSupabaseSession,
  loadTenantStateFromSupabase,
  ensureProfileForAuthUser,
  createCompanyRecord,
  updateCompanyAiAnalysisSetting,
  getCompanyAiAnalysisSettings,
  updateCompanyContractStatus,
  softDeleteCompany,
  deleteCompanyCompletely,
  createStoreRecord,
  updateStoreRecord,
  updateStoreStatus,
  deleteStoreCompletely,
  normalizeDailyFieldSettings,
  normalizeMonthlyTargetFieldSettings,
  normalizeHiddenClosingCategories,
  loadStoreInputSettingsForCompany,
  upsertStoreInputSettings,
  loadStoreMonthlyCostOverridesForCompany,
  upsertStoreMonthlyCostOverride,
  createUserProfileRecord,
  checkExistingProfilesByEmail,
  upsertDailySalesEntry,
  updateDailySalesClosingState,
  loadDailySalesForCompanyRange,
  upsertDailyCashBreakdown,
  loadDailyCashBreakdownForCompanyRange,
  loadDailyBatchEntriesForCompanyRange,
  createDailyBatchEntry,
  updateDailyBatchEntry,
  deleteDailyBatchEntry,
  upsertMonthlyClosingState,
  loadMonthlyClosingsForCompany,
  loadMonthlyTargetsForCompany,
  upsertMonthlyTargetToSupabase,
  loadMonthlyTargetFromSupabase,
  loadAllStoresTargetsForCompany,
  loadAllStoresTargetFromSupabase,
  upsertAllStoresTargetToSupabase,
  loadStoreHolidaysForCompanyRange,
  upsertStoreHolidayToSupabase,
  deleteStoreHolidayFromSupabase,
  loadAllStoresHolidaysForCompanyRange,
  upsertAllStoresHolidayToSupabase,
  deleteAllStoresHolidayFromSupabase,
  loadFixedCostsForCompany,
  loadStoreStatusAuditLogForCompany,
  loadMonthlyReviewsForCompany,
  upsertMonthlyReview,
  upsertFixedCostToSupabase,
  deleteFixedCostFromSupabase,
  reorderFixedCostsInSupabase,
  loadCostMonthlyAmountsForCompany,
  upsertCostMonthlyAmountToSupabase,
  loadStoreInventoryBalancesForCompany,
  upsertStoreInventoryBalanceToSupabase,
  loadVariableCostsForCompany,
  loadMonthlyClosingItemsForCompany,
  loadCompanySettings,
  upsertCompanySettings,
  loadStoreProfilesForCompany,
  upsertStoreProfile,
  markStoreInitialSetupCompleted,
  logSupabaseError,
  signUpWithEmail,
  resolveRoleForEmail,
  updateProfileRole,
  updateProfileStoreAssignments,
  getInviteInfo,
  acceptInvite,
  isSelfSignupEnabled,
  selfSignup,
  sendInviteEmail,
  generateInviteLink,
  deleteUserAccount,
  updateProfileDetails,
  updateUserEmail,
  setUserActiveState,
  refreshInviteState,
  loadFranchiseCompanyMetadata,
  createFranchiseRequest,
  updateFranchiseRelationship,
  loadCompanyPartnerships,
} from "./utils/supabase.js";
import { logAdConversionEvent } from "./utils/adOpsSupabase.js";
import AdOpsPage from "./components/adOps/AdOpsPage.jsx";
import { loadLatestTenantSnapshot, upsertTenantSnapshot, buildTenantSnapshotRow } from "./utils/supabaseRemote.js";
import { getBusinessTypeDefaultStoreName, getBusinessTypeLabel } from "./utils/businessProfile.js";
import { getLocalizedSupabaseErrorMessage } from "./utils/authMessages.js";
import { buildInviteLink, createInviteToken, isInviteExpired, getUserStatusMeta, classifyEmailDuplicateForInvite } from "./utils/invitations.js";
import { sortStoresForManagement } from "./utils/storeManagement.js";
import AiAssistantCard from "./components/ai/AiAssistantCard.jsx";
import AiFloatingButton from "./components/ai/AiFloatingButton.jsx";
import AiChatScreen from "./components/ai/AiChatScreen.jsx";
import MonthlyDashboardPage from "./components/dashboard/MonthlyDashboardPage.jsx";
import MonthlyCashBreakdownModal from "./components/cashBreakdown/MonthlyCashBreakdownModal.jsx";
import FaqPage from "./components/faq/FaqPage.jsx";
import MonthlyReviewPage from "./components/monthlyReview/MonthlyReviewPage.jsx";

// "fixed" の内部idはSupabase保存先(fixed_costsテーブル)に合わせて維持しつつ、旧「固定費」
// 「販管費」の2画面をユーザーからは区別させない単一の「費用入力」タブへ統合。
const monthlyTabs = [
  { id: "basic", label: "基本設定" },
  { id: "input", label: "入力設定" },
  { id: "target", label: "目標設定" },
  { id: "fixed", label: "費用入力" },
  { id: "closing", label: "月締め" },
  { id: "pnl", label: "損益表" },
];

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
// error.messageをそのまま画面表示に使ってよいかを判定する薄いヘルパー。以前はgetSupabase
// ErrorMessageと同じ判定(JWT/セッションのタイミング起因エラーの差し替え)を別々に実装して
// おり、片方だけ修正が及ばない状態になっていた——実際に、店舗切替時のstatement timeout調査で
// 生のPostgresエラー文("canceling statement due to statement timeout"等、日本語を含まない
// もの)がこの経路を通って画面へそのまま表示され得ることが判明した。二重実装をやめ、
// getSupabaseErrorMessage(日本語を含まない生のエラー文は一般的な文言へ差し替える判定を
// 含む、唯一の実装)へ委譲する——messageが空の場合だけ、呼び出し元ごとの独自フォールバック
// 文言を使う。
const resolveErrorReason = (error, fallback) => {
  const message = error instanceof Error ? error.message : "";
  if (!message) return fallback;
  return getSupabaseErrorMessage({ message });
};
// 招待メール送信(send-invite-email Edge Function)専用のエラーメッセージ解決。Supabase標準の
// メール送信環境はレート制限が厳しいため、レート制限由来のエラーだけは専用の日本語文言に
// 差し替える(招待フロー整理の要件5)。それ以外はgetSupabaseErrorMessageの通常の規約に従う。
const resolveInviteEmailErrorMessage = (error) => {
  if (error?.code === "rate_limited") {
    return "短時間に複数回送信されたため、少し時間を空けて再送してください。";
  }
  return getSupabaseErrorMessage(error);
};

// 認証・セッション不具合の追跡用ログ(開発環境限定)。import.meta.env.DEVは本番ビルドでは
// 常にfalse(`vite build`の出力自体にこの呼び出しが到達しないコードとして扱われる)ため、
// 本番環境に一切出力されない。トークン・メールアドレス等の機密情報は引数に含めないこと
// ——ここで渡すのは「何が起きたか」を表す短い文字列と、真偽値・件数程度の非機密情報のみ。
const authLog = (...args) => {
  if (import.meta.env.DEV) console.info("[auth-flow]", ...args);
};

const coerceId = (...values) => values.find((value) => typeof value === "string" && value.trim()) || "";

const buildAuthenticatedUser = ({ profile = null, authUser = null, fallback = null, role = "staff", companyId = "", storeId = "" } = {}) => {
  const profileId = coerceId(profile?.id, fallback?.profileId, fallback?.id);
  const authUserId = coerceId(authUser?.id, profile?.auth_user_id, fallback?.authUserId);
  return {
    id: profileId,
    email: authUser?.email || profile?.email || fallback?.email || "",
    name: profile?.name || fallback?.name || authUser?.email || fallback?.email || "",
    role: normalizeRole(profile?.role || role || fallback?.role || "staff"),
    company_id: profile?.company_id || companyId || fallback?.company_id || fallback?.companyId || "",
    store_id: storeId || fallback?.store_id || fallback?.storeId || "",
    profileId,
    authUserId,
  };
};

const getMetricTone = (value, warningThreshold = 80, successThreshold = 100) => {
  if (!Number.isFinite(value)) return "neutral";
  if (value >= successThreshold) return "good";
  if (value >= warningThreshold) return "warning";
  return "danger";
};

// Covers the current month plus the two prior months the dashboard/ranking view compares
// against (see rankingRows' previousMonth/previousPreviousMonth), so one daily_sales query
// per hydrate is enough for both the selected-store daily entries and the cross-store ranking.
const getDailySalesQueryRange = (targetMonth) => {
  const startMonth = getMonthOffset(targetMonth, -2);
  const { firstDate } = getMonthInfo(startMonth);
  const { lastDate } = getMonthInfo(targetMonth);
  return { startDate: formatLocalDate(firstDate), endDate: formatLocalDate(lastDate) };
};

// 初期表示速度の調査(要件1: どのSQL/APIがボトルネックかを計測する)用の軽量ラッパー。
// hydrateFromSupabaseはPromise.allで18件のクエリを並列発行しているため、単純に「開始〜
// 全体完了」の1つの時間だけでは、どの1件が実際に遅いのか切り分けられない——このラッパーで
// 個々のクエリの所要時間を独立して記録し、devtools consoleから直接「どのテーブル/条件が
// 遅いか」を確認できるようにする。解決値はそのまま(ok/data/error)透過するだけで、
// 呼び出し元の分岐ロジックには一切影響しない。
const timeHydrateQuery = (label, promise) => {
  const startedAt = (typeof performance !== "undefined" ? performance.now() : Date.now());
  return promise.then((result) => {
    const durationMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
    console.info("[hydrate-query]", { label, durationMs, ok: result?.ok !== false, rows: Array.isArray(result?.data) ? result.data.length : undefined });
    return result;
  });
};

const createCompanySettingsDefaults = () => ({
  currency: "JPY",
  fiscalYearStartMonth: "1",
  salesDisplayMode: "inclusive",
  retailSalesLabel: "店販売上",
  closingDay: "月末",
  editDeadlineDays: 7,
  allowStaffPastEdit: false,
  visibleSalesFields: ["technicalSales", "retailSales", "otherSales"],
  activeKpis: ["sales", "customers", "retailRatio"],
  businessType: "salon",
});

const createStoreSettingsDefaults = () => ({
  monthlyTargetSales: "",
  retailTargetSales: "",
  customerTarget: "",
  newCustomerTarget: "",
  businessDays: "",
  holidayDays: "",
  openingHour: "09:00",
  closingHour: "20:00",
  closedDays: "月",
  dailyFieldSettings: defaultDailyFieldSettings(),
  monthlyTargetFields: defaultMonthlyTargetFieldSettings(),
  managerName: "",
  staffIds: [],
  // 在庫管理(任意、初期値OFF)。ONの店舗だけ月締め画面で期首在庫/当月末在庫を入力でき、
  // 材料・仕入原価が「前月末在庫+当月仕入・発注額-当月末在庫」で計算される(store_input_settings
  // .use_inventory_trackingが実体、hydrateFromSupabaseのapplyStoreInputSettingsToCompaniesで
  // 上書きされる)。
  useInventoryTracking: false,
  // 日計管理(任意、初期値OFF)。ONの店舗だけ日次入力画面に現金/キャッシュレス/ポイント利用の
  // 内訳カードが表示される(store_input_settings.use_cash_breakdownが実体、hydrateFromSupabase
  // のapplyStoreInputSettingsToCompaniesで上書きされる)。総売上・損益・月次集計には一切
  // 加算されない、支払方法の内訳確認のみの補助機能。
  useCashBreakdown: false,
  // 月締めチェックリストで「対象外」にした費用カテゴリkeyの一覧(store_input_settings
  // .hidden_closing_categoriesが実体)。その店舗では基本的に使わない項目を一覧から非表示に
  // するためのもので、データは消さない・いつでも解除できる(要件に基づく)。
  hiddenClosingCategories: [],
  // 人件費・仕入(材料・発注費)の計算方法("fixed"=固定額、既存の費用入力の合計をそのまま
  // 使う／"sales_linked"=売上連動、当月実売上×率で自動推定し実額へ手動確定できる)。
  // 既定は"fixed"——既存店舗の損益計算を1円も変えない(store_input_settings.labor_cost_mode/
  // purchase_cost_modeが実体、hydrateFromSupabaseのapplyStoreInputSettingsToCompaniesで
  // 上書きされる)。
  laborCostMode: "fixed",
  laborCostRate: 0,
  purchaseCostMode: "fixed",
  purchaseCostRate: 0,
  // store_input_settings行が実際に存在するか(初期設定チェックリストの「入力項目設定」の
  // 完了判定に使う——dailyFieldSettings等は行が無くてもデフォルト値にフォールバックする
  // ため、この専用フラグでのみ「一度でも保存されたか」を区別できる)。DBの列ではなく、
  // hydrate時にstore_input_settingsの行の有無から導出するクライアント側のみの値。
  hasInputSettingsRow: false,
});

const createStoreFormDefaults = () => ({
  name: "",
  postalCode: "",
  address: "",
  phone: "",
  managerName: "",
  representativeName: "",
  openingDate: "",
  openingHour: "09:00",
  closingHour: "20:00",
  closedDays: "月",
  businessHours: "09:00-20:00",
  description: "",
  website: "",
  instagram: "",
  googleMapUrl: "",
  serviceTypes: "",
  urls: [],
  isActive: true,
  status: "active",
  staffCount: "",
  productivityStaffCount: "",
});

// A single, plain-language status per user instead of the old raw mix of "active"/"未ログイン"/
// "ログイン回数0"/"有効期限なし" shown all at once. isActive (stopped) always wins regardless
// of registration state; then it's simply "haven't registered yet" (invited / expired) vs
// "registered" (never logged in yet / actively using it).
// Display order for role subgroups within a store group in ユーザー管理 (higher authority
// first, matching the hierarchy example: 店舗管理者 above 一般スタッフ).
const ROLE_GROUP_ORDER = ["system_admin", "company_admin", "store_manager", "staff"];

const getCompanySetupProgress = (company) => {
  const setup = company?.setup || {};
  const steps = [
    { id: "company", label: "会社情報", done: Boolean(setup.company || company?.name) },
    { id: "store", label: "店舗登録", done: Boolean(setup.store || (company?.stores || []).length > 0) },
    { id: "admin", label: "管理者登録", done: Boolean(setup.admin) },
    { id: "settings", label: "基本設定", done: Boolean(setup.settings) },
  ];
  return {
    steps,
    completed: Boolean(setup.complete),
    currentStep: steps.find((step) => !step.done)?.id || "complete",
  };
};

const formatSignedYen = (value) => `${value >= 0 ? "" : "−"}¥${Math.abs(Math.round(value)).toLocaleString("ja-JP")}`;

// 会社コードはstores.codeと同じく「実質的には使われないが列としてはunique not null」な
// 内部識別用の値 — 人間が考えて入力するものではないので、店舗コード(crypto.randomUUID()を
// そのまま使う既存パターン)と同様、自動生成する。会社コードだけは "salon-xxxxxxxx" という
// 読める形式が要件で指定されているため、UUIDから先頭8文字を切り出して整形する。
const generateCompanyCode = () => `salon-${(typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/-/g, "").slice(0, 8)}`;

// 新規店舗名が既存店舗名と「同一店舗のつもりで別レコードを作ってしまっている」可能性が
// 高いかどうかの簡易判定(要件: 完全一致/大文字小文字違い/全角半角違い/スペース違い/
// 「本店」「店」などの接尾辞違いは同一とみなす)。NFKCで全角英数・記号を半角に正規化し、
// 空白を除去・小文字化したうえで、末尾の「本店」「支店」「店」を1回だけ取り除いて比較する
// — INTRO本店とINTROのように、片方だけ屋号の接尾辞を持つケースを検出するため。誤検出で
// 正当な別店舗の作成automaticallyを止めることはせず、あくまで警告文言を強めるためだけに使う。
const normalizeStoreNameForSimilarity = (name) =>
  String(name || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/(本店|支店|店)$/u, "");

// normalizeStoreNameForDuplicateCheckはstorage.js側で定義・export済み(単体テスト可能に
// するため——店舗追加の重複防止を機に、資金・所属関連の同種の判定と同じくApp.jsxコンポーネント
// 内の生のconstではなく独立した純粋関数へ切り出した)。

// 日次入力画面の「今日のAI分析」を組み立てる。ここは詳しい原因分析・改善提案の場ではなく、
// (1)当日の売上・目標に対する状況 (2)入力KPIの中から特徴的な1〜2項目 (3)前向きな一言、を
// 1〜3文で短く総括するだけの役割 — 詳細な分析・改善策は別画面の「AI経営アシスタント」に
// 任せる。抽象的な「頑張りましょう」だけで終わらせず、必ず実際の入力値・設定済み目標値を
// 根拠に文章を組み立てる。
const buildDailyInsight = ({ form, target = {}, businessDayCount }) => {
  const totalSales = parseNumber(form.totalSales);
  const retailSales = parseNumber(form.retailSales);
  const customers = parseNumber(form.customers);
  const newCustomers = parseNumber(form.newCustomers);
  const repeatCustomers = parseNumber(form.repeatCustomers);

  if (!totalSales && !customers) {
    return "分析に必要なデータが不足しています";
  }

  const targetSales = parseNumber(target.targetSales);
  const targetDailySales = businessDayCount > 0 ? targetSales / businessDayCount : 0;

  // (1) 当日売上と目標(月間目標を営業日数で割った1日あたり目標)との比較。
  let salesSentence = "";
  let salesGood = null;
  if (targetDailySales > 0 && totalSales > 0) {
    const diff = totalSales - targetDailySales;
    const rate = (diff / targetDailySales) * 100;
    salesGood = diff >= 0;
    salesSentence = diff >= 0
      ? `本日は目標を${formatSignedYen(diff)}上回りました。`
      : `本日は目標比${rate.toFixed(0)}%(${formatSignedYen(diff)})でした。`;
  } else if (totalSales > 0) {
    salesSentence = `本日の売上は¥${totalSales.toLocaleString("ja-JP")}でした。`;
  }

  // (2) 特徴的なKPIの候補を集め、設定済みの目標値があればそれを基準に、無ければ一般的な
  // 目安を基準に良し悪しを判定する(いずれも実測値そのものを根拠に文章化する)。
  const candidates = [];
  if (customers > 0) {
    const newRate = (newCustomers / customers) * 100;
    const repeatRate = (repeatCustomers / customers) * 100;
    const averageSpend = totalSales / customers;
    const targetRepeatRate = parseNumber(target.targetRepeatRate);
    const targetAverageSpend = parseNumber(target.targetAverageSpend);
    const targetCustomers = parseNumber(target.targetCustomers);
    const targetNewCustomers = parseNumber(target.targetNewCustomers);
    const impliedNewRate = targetCustomers > 0 ? (targetNewCustomers / targetCustomers) * 100 : null;

    candidates.push({
      label: "新規率",
      text: `新規率${newRate.toFixed(1)}%`,
      good: impliedNewRate !== null ? newRate >= impliedNewRate : newRate >= 25,
      score: (impliedNewRate !== null ? newRate - impliedNewRate : newRate - 25) / 100,
    });
    candidates.push({
      label: "再来率",
      text: `再来率${repeatRate.toFixed(1)}%`,
      good: targetRepeatRate > 0 ? repeatRate >= targetRepeatRate : repeatRate >= 50,
      score: (targetRepeatRate > 0 ? repeatRate - targetRepeatRate : repeatRate - 50) / 100,
    });
    if (targetAverageSpend > 0) {
      candidates.push({
        label: "客単価",
        text: `客単価¥${Math.round(averageSpend).toLocaleString("ja-JP")}`,
        good: averageSpend >= targetAverageSpend,
        score: (averageSpend - targetAverageSpend) / targetAverageSpend,
      });
    }
  }
  if (totalSales > 0) {
    const retailRate = (retailSales / totalSales) * 100;
    const targetRetailSales = parseNumber(target.targetRetailSales);
    const impliedRetailRate = targetSales > 0 && targetRetailSales > 0 ? (targetRetailSales / targetSales) * 100 : null;
    candidates.push({
      label: "店販率",
      text: `店販率${retailRate.toFixed(1)}%`,
      good: impliedRetailRate !== null ? retailRate >= impliedRetailRate : retailRate >= 10,
      score: (impliedRetailRate !== null ? retailRate - impliedRetailRate : retailRate - 10) / 100,
    });
  }

  // 目標(または目安)からの乖離が大きい項目ほど「特徴的」として優先的に取り上げる。
  candidates.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const good = candidates.find((c) => c.good);
  const bad = candidates.find((c) => !c.good);

  let kpiSentence = "";
  if (good && bad) {
    kpiSentence = `${good.text}は良好ですが、${bad.text}はやや低めです。`;
  } else if (good) {
    const secondaryGood = candidates.find((c) => c.good && c !== good);
    kpiSentence = secondaryGood ? `${good.text}・${secondaryGood.label}ともに良好です。` : `${good.text}は良好です。`;
  } else if (bad) {
    const secondaryBad = candidates.find((c) => !c.good && c !== bad);
    kpiSentence = secondaryBad ? `${bad.text}・${secondaryBad.label}がやや低めです。` : `${bad.text}がやや低めです。`;
  }

  // (3) 前向きな一言(必ず1文のみ、新しい数字は出さない)。売上・KPIの状況に応じて短く締める。
  // 合計で最大3文(売上1文+KPI1文+総括1文)に収まるよう、ここは複文にしない。
  let closingSentence;
  if (salesGood === true) {
    closingSentence = "このペースを維持しましょう。";
  } else if (good) {
    closingSentence = salesGood === false
      ? `${good.label}は好調なので、この流れを維持していきましょう。`
      : "この調子で営業を続けましょう。";
  } else if (salesGood === false) {
    closingSentence = "まだ十分取り戻せるペースです。";
  } else {
    closingSentence = "この調子で営業を続けましょう。";
  }

  return [salesSentence, kpiSentence, closingSentence].filter(Boolean).join("");
};

const buildTenantState = (legacyState = {}) => {
  const seeded = typeof legacyState === "object" && legacyState ? legacyState : readAppState();

  // When Supabase is configured, never seed appState.companies with placeholder data that
  // carries non-UUID ids like "company-fine"/"store-main" below. Real company/store data
  // always arrives from loadTenantStateFromSupabase after login — but every hook in this
  // component runs on every render regardless of which screen is actually shown (conditional
  // JSX doesn't skip hooks), so any Supabase-touching effect that reads appState.companies
  // before that login/hydrate finishes would find this placeholder company sitting there,
  // looking real enough (non-empty id) to pass truthiness checks, and send "company-fine"
  // straight into a uuid column — exactly the "invalid input syntax for type uuid" error this
  // was causing. Preserve genuinely saved data from a previous real login (seeded.companies),
  // just never fabricate fake replacement data when there's nothing saved yet.
  if (isSupabaseConfigured) {
    return {
      ...createInitialAppState(),
      ...seeded,
      companies: Array.isArray(seeded.companies) ? seeded.companies : [],
      users: Array.isArray(seeded.users) ? seeded.users : [],
      currentCompanyId: seeded.currentCompanyId || "",
      currentUserId: seeded.currentUserId || "",
      companySnapshots: seeded.companySnapshots && typeof seeded.companySnapshots === "object" ? seeded.companySnapshots : {},
    };
  }

  const defaultCompanyId = "company-fine";
  const defaultCompany = {
    id: defaultCompanyId,
    name: "Fi-Ne",
    code: "fine",
    isActive: true,
    contractStatus: "active",
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    setup: { company: true, store: true, admin: true, settings: true, complete: true },
    settings: createCompanySettingsDefaults(),
    stores: Array.isArray(seeded.stores) && seeded.stores.length
      ? seeded.stores.map((storeName, index) => ({ id: `store-${index + 1}`, name: storeName, code: `${defaultCompanyId}-${index + 1}`, isActive: true, settings: createStoreSettingsDefaults() }))
      : [{ id: "store-main", name: "本店", code: "main", isActive: true, settings: createStoreSettingsDefaults() }],
  };
  const companies = Array.isArray(seeded.companies) && seeded.companies.length ? seeded.companies : [defaultCompany];
  const users = Array.isArray(seeded.users) && seeded.users.length ? seeded.users : [
    { id: "user-system", name: "システム管理者", email: "system@salon.test", role: "system_admin", companyId: defaultCompanyId, storeIds: [], primaryStoreId: "", isActive: true, invitationStatus: "active", lastLoginAt: "" },
    { id: "user-company", name: "会社管理者", email: "company@salon.test", role: "company_admin", companyId: defaultCompanyId, storeIds: [], primaryStoreId: "", isActive: true, invitationStatus: "active", lastLoginAt: "" },
    { id: "user-manager", name: "店舗管理者", email: "manager@salon.test", role: "store_manager", companyId: defaultCompanyId, storeIds: [defaultCompany.stores[0]?.id || "store-main"], primaryStoreId: defaultCompany.stores[0]?.id || "store-main", isActive: true, invitationStatus: "active", lastLoginAt: "" },
    { id: "user-staff", name: "一般スタッフ", email: "staff@salon.test", role: "staff", companyId: defaultCompanyId, storeIds: [defaultCompany.stores[0]?.id || "store-main"], primaryStoreId: defaultCompany.stores[0]?.id || "store-main", isActive: true, invitationStatus: "active", lastLoginAt: "" },
  ];
  const companySnapshots = seeded.companySnapshots && typeof seeded.companySnapshots === "object" ? seeded.companySnapshots : {};
  if (!companySnapshots[defaultCompanyId]) {
    companySnapshots[defaultCompanyId] = { ...createInitialAppState(), ...seeded, stores: defaultCompany.stores.map((store) => store.name), selectedStore: defaultCompany.stores[0]?.name || "", selectedStoreId: defaultCompany.stores[0]?.id || "", selectedMonth: seeded.selectedMonth || createInitialAppState().selectedMonth };
  }
  return {
    ...companySnapshots[defaultCompanyId],
    companies,
    users,
    currentCompanyId: seeded.currentCompanyId || defaultCompanyId,
    companySnapshots,
    currentUserId: seeded.currentUserId || "",
  };
};

const initialAppStateValue = buildTenantState(readAppState());

const canManageCompany = (role) => canManageCompanies(role);
const canManageStore = (role) => canManageStores(role);
const canManageUsers = (role) => canManageUsersByRole(role);

// hydrateFromSupabaseが連続して失敗した場合の自動リトライ上限(要件2: 無限更新防止)。これを
// 超えたら自動リトライを止め、setSyncStatusのエラー表示のまま留める——再読み込みや店舗切替等、
// ユーザーの明示的な操作(新しいhydrateFromSupabase呼び出し)がきっかけで再開する。
const HYDRATE_MAX_AUTO_RETRY_ATTEMPTS = 5;

function App() {
  // 設定ページ削除(要件)に伴い、ダークモードの切替UI(トグルボタン)は削除した。テーマ処理
  // 自体(theme値の読み込み・.theme-dark適用・localStorageへの保存effect)は他画面へ影響
  // する可能性があるため削除せず維持する——切替手段が無くなっただけで、以前にダークモードへ
  // 切り替えていた利用者の見た目は変わらない。setTheme(変更する手段)は今回使われなくなった
  // ため、useStateから受け取らない(themeの読み取り専用化)。
  const [theme] = useState(() => (readStorage(STORAGE_KEYS.theme, "light") === "dark" ? "dark" : "light"));
  const [activePage, setActivePage] = useState("dashboard");
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  // 一部ユーザーでブラウザ更新のたびにログイン画面へ戻される不具合の修正: 有効なSupabase
  // セッションが確認できた後、プロフィール/テナント情報の取得(ensureProfileForAuthUser/
  // loadTenantStateFromSupabase、複数回のSupabase往復を伴う)が一時的なネットワーク不調等で
  // 失敗しても、認証セッション自体は失われていない——にもかかわらず以前はこの失敗を
  // initializeAuthの外側のcatchで一律「未ログイン」扱いにし、authMode("login")へ落として
  // いた。この状態(セッションは有効だがプロフィール取得だけ失敗)を専用に表す状態を持たせ、
  // ログイン画面へは絶対に戻さず、再試行可能なエラー画面を出す(下のloadProfileAndEnterApp
  // 参照)。
  const [authProfileLoadError, setAuthProfileLoadError] = useState("");
  const [authSuccess, setAuthSuccess] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("invite") ? "招待登録用のリンクです。メールアドレスとパスワードを設定してください。" : "";
  });
  const [authMode, setAuthMode] = useState(() => {
    if (typeof window === "undefined") return "login";
    const params = new URLSearchParams(window.location.search);
    if (params.get("invite")) return "signup";
    // ?owner-signup=1 はfeature flagが非公開の間もテスト専用に新規オーナー登録フォームへ
    // 直接到達できるようにするための導線(要件12)。testKeyの正誤自体はself-signup Edge
    // Function側のflag判定が最終的な権威(送信時に検証、フロントは正誤を検証しない=秘密を
    // クライアントへ持たせない)だが、testKeyパラメータ自体が無い状態ではフォームすら
    // 出さない——owner-signup=1だけを知っている一般利用者にフォームの存在自体を晒さないため
    // (「testKeyなしには非公開」)。
    if (params.get("owner-signup") === "1" && params.get("testKey")) return "ownerSignup";
    return "login";
  });
  const [currentRole, setCurrentRole] = useState("staff");
  const [inviteToken, setInviteToken] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("invite") || "";
  });
  // 新規オーナー・セルフサインアップのfeature flag(招待制とは別導線、要件11)。DBから
  // is_self_signup_enabled() RPC(匿名でも呼べる)経由で取得するまではfalse=非表示扱いにする
  // (フェイルクローズ)。テスト専用バイパス用キー(要件12)はURLからそのまま読み取り、
  // self-signup Edge Functionへ渡すだけ——このキー自体をフロント側の許可判定には使わない。
  const [selfSignupEnabled, setSelfSignupEnabled] = useState(false);
  const [ownerSignupTestKey] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("testKey") || "";
  });
  // AI広告自動運用システム(V1、要件6・7)。広告リンク経由でオーナー登録画面へ着地した場合の
  // UTM。本リポジトリには外部マーケティングLPが無いため、このオーナー登録画面自体が実質の
  // 計測起点になる——lp_view相当のイベントもここで記録する(下のuseEffect)。
  const [ownerSignupUtm] = useState(() => {
    if (typeof window === "undefined") return { utmSource: "", utmCampaign: "", utmContent: "", adId: "" };
    const params = new URLSearchParams(window.location.search);
    return {
      utmSource: params.get("utm_source") || "",
      utmCampaign: params.get("utm_campaign") || "",
      utmContent: params.get("utm_content") || "",
      adId: params.get("ad_id") || "",
    };
  });
  // 匿名(会員化前)の行動を後から同一人物として紐付けるための、ブラウザ生成の識別子。
  // localStorageで永続化する(セッションをまたいでも同じ訪問者として扱えるようにするため、
  // sessionStorageではなくlocalStorageを使う)。
  const [adSessionId] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const existing = window.localStorage.getItem("salon-ad-session-id");
      if (existing) return existing;
      const generated = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem("salon-ad-session-id", generated);
      return generated;
    } catch {
      return "";
    }
  });
  // 招待リンクの宛先メールアドレス(get_invite_infoから取得)。新規登録フォームのメール欄を
  // これで事前入力・固定することで、招待されたメールアドレスと違うメールアドレスを手入力して
  // しまい「招待メールアドレスと一致するメールアドレスで登録してください」で詰まる事故を防ぐ。
  const [inviteEmail, setInviteEmail] = useState("");
  const [activeMonthlyTab, setActiveMonthlyTab] = useState("closing");
  const [companyForm, setCompanyForm] = useState({ name: "", code: "", contractStatus: "trial", businessType: "salon" });
  const [storeForm, setStoreForm] = useState(createStoreFormDefaults());
  // dailyFieldChangeHandlers等と同じ理由・同じパターン(memo化されたNumericInputへ安定した
  // onChangeを渡す。setStoreFormは元々useStateのsetter自体は安定しているが、この
  // ラッパー関数の形は他の入力画面と揃えて一貫性を持たせる)。
  const [storeFieldChangeHandlers] = useState(() => {
    const makeHandler = (field) => (value) => setStoreForm((prev) => ({ ...prev, [field]: value }));
    return ["staffCount", "productivityStaffCount"].reduce((acc, field) => {
      acc[field] = makeHandler(field);
      return acc;
    }, {});
  });
  // 検索・並び替えUIは撤去したが、filteredStoresの絞り込み/並び替えロジック自体は変更せず
  // 維持している(空検索=絞り込みなし、achievement=既存のデフォルト順)。setterは今は使わ
  // ないため取得しない。
  const [storeSearch] = useState("");
  const [storeSort] = useState("achievement");
  // アーカイブ済み店舗は店舗管理画面のデフォルト表示から除外し(要件5)、このトグルで専用の
  // 一覧として切り替え表示する。
  const [showArchivedStores, setShowArchivedStores] = useState(false);
  // 完全削除の確認モーダル(要件2): 対象店舗名を完全一致で入力するまでボタンは無効のまま。
  const [hardDeleteTargetId, setHardDeleteTargetId] = useState("");
  const [hardDeleteConfirmText, setHardDeleteConfirmText] = useState("");
  const [hardDeleteSaving, setHardDeleteSaving] = useState(false);
  const [hardDeleteError, setHardDeleteError] = useState("");
  // 会社の完全削除(3段階の最終段階)用の確認モーダル。店舗の完全削除(上のhardDelete*)とは
  // 別画面から起動されるため衝突しないよう別のstateにする — 会社名の完全一致に加えて
  // 「完全削除」という固定フレーズの入力も必須(要件8、通常削除より1段厳重にする)。
  const [companyHardDeleteTargetId, setCompanyHardDeleteTargetId] = useState("");
  const [companyHardDeleteConfirmText, setCompanyHardDeleteConfirmText] = useState("");
  const [companyHardDeleteConfirmPhrase, setCompanyHardDeleteConfirmPhrase] = useState("");
  const [companyHardDeleteSaving, setCompanyHardDeleteSaving] = useState(false);
  const [companyHardDeleteError, setCompanyHardDeleteError] = useState("");
  // 会社の論理削除(3段階の2段目、「会社データを削除」ボタン)用の確認モーダル。物理削除
  // (companyHardDelete*)とは完全に別の操作 — こちらはcompanies.deleted_at等を立てるだけで
  // company_idに紐づくデータには一切触れない。会社名の完全一致が必須。
  const [companySoftDeleteTargetId, setCompanySoftDeleteTargetId] = useState("");
  const [companySoftDeleteConfirmText, setCompanySoftDeleteConfirmText] = useState("");
  const [companySoftDeleteSaving, setCompanySoftDeleteSaving] = useState(false);
  const [companySoftDeleteError, setCompanySoftDeleteError] = useState("");
  // 削除済み会社(ゴミ箱)一覧の表示切替。通常の会社一覧からは常に除外し、system_adminが
  // 明示的に開いた時だけ表示する。
  const [showDeletedCompanies, setShowDeletedCompanies] = useState(false);
  const [companyRestoreSavingId, setCompanyRestoreSavingId] = useState("");
  // 無料利用理由変更(実行専用メニュー)の多重クリック防止。
  const [freeReasonSavingId, setFreeReasonSavingId] = useState("");
  // 契約状態(トライアル/契約中/停止中)ボタンの多重クリック防止。
  const [companyStatusSavingId, setCompanyStatusSavingId] = useState("");
  // Inline feedback rendered right next to the 店舗基本設定 save button (StoreManagementPage) —
  // the shared top-of-page `notice` could be scrolled out of view, making a real success/failure
  // result look like nothing happened. This always renders in the same spot the user is looking at.
  const [storeFormStatus, setStoreFormStatus] = useState({ status: "idle", message: "" });
  // storeFormStatusのstate更新は次のレンダーまでボタンのdisabledに反映されないため、
  // ほぼ同時に2回押された場合はstateだけのガードでは両方すり抜けてしまう(その場合、店舗名の
  // 一意制約が無いため2件の店舗が作られたり、在籍スタッフ数の保存が2回目の呼び出しの値で
  // 上書きされたりする)。refはレンダーを待たずに同期的に読み書きできるため、こちらを一次防御
  // として使う。
  const savingStoreRef = useRef(false);
  // 費用入力フォームの二重送信防止(販売前総合チェックで発見: 他の保存系フォーム
  // (店舗/招待/月間目標/まとめて入力)は既にref/busy stateでガードされていたが、費用入力だけ
  // 何のガードも無かった——新規登録時はsubmitFixedCost内でcrypto.randomUUID()を呼ぶたびに
  // 別のidが生成されるため、連打すると同じ費用が複数件登録され得た。store保存と同じ理由で
  // stateではなくrefを使う(レンダーを待たず同期的に読み書きできるため)。
  const savingFixedCostRef = useRef(false);
  // 初期設定チェックリスト完了フラグの二重送信防止。setupChecklist(useMemo)はappStateが
  // 何か変わるたびに新しい配列参照になるため、それをそのままdependencyに使っている
  // 完了検知effectは、恒久フラグがローカルへ反映されるまでの短い間に複数回再実行され得る
  // ——ref一つで「既に送信中」を弾く、他の保存系ガードと同じパターン。
  const markingInitialSetupCompletedRef = useRef(false);
  // まとめて入力の二重送信防止(販売前総合チェックで発見: batchFormBusyというReact stateだけで
  // ガードされていたが、state更新は次のレンダーまで反映されないため、連打・スマホでの二重
  // タップで同じ期間のまとめ入力が複数件作られ得た——期間(store_id・開始日・終了日)は
  // ユーザーが任意に選ぶ値でありDB側に自然な一意キーを設定できない(同じ期間へ複数回、
  // 別の入力項目を分けて登録する運用も許容している——detectBatchEntryFieldOverlap参照)ため、
  // こちらもrefによる同期ガードを一次防御にする。
  const savingBatchEntryRef = useRef(false);
  // 会社作成・更新の二重送信防止(販売前総合チェックで発見: 従来ガードが一切無く、保存ボタンに
  // disabledすら付いていなかった)。会社コードはgenerateCompanyCode()が呼び出しごとに新しい
  // ランダム値を生成するため、DB側のUNIQUE制約(あってもcode自体はどのみち毎回別の値)では
  // 二重作成を防げない——店舗作成(savingStoreRef)と全く同じ理由で、refによる同期ガードのみが
  // 実効的な防御になる。
  const savingCompanyRef = useRef(false);
  const [companyFormBusy, setCompanyFormBusy] = useState(false);
  const [userForm, setUserForm] = useState({ name: "", email: "", role: "store_manager", storeIds: [], primaryStoreId: "", invitationStatus: "invited", loginCount: 0, lastLoginAt: "", isActive: true });
  // 「招待する」ボタンの二重送信防止(要件8: ボタン連打・二重実行によるAuthユーザー重複作成を
  // 防ぐ)。招待フォーム全体を対象にした単一のフラグで十分(フォームは一度に1件しか送信しない)。
  const [userFormBusy, setUserFormBusy] = useState(false);
  // ↑のuserFormBusyはUI表示(ボタンのdisabled/ラベル)用に残し、実際の二重送信ガードは
  // 販売前総合チェックで発見した通りstateだけでは不十分(次のレンダーまで反映されないため
  // 連打・スマホの二重タップをすり抜け得る)なので、同期的なrefを一次防御として追加する。
  // DB側はprofiles.emailの既存UNIQUE制約(profiles_email_key、createUserProfileRecord参照)が
  // 最終防御として既に機能している——同じメールアドレスへの重複INSERTは実際に来ても
  // 23505エラーとして翻訳済みメッセージで拒否される。
  const savingUserInviteRef = useRef(false);
  // 「再招待」ボタンの二重送信防止。行ごとに独立して無効化するため、対象user.idを保持する
  // (他のユーザー行の再招待ボタンまで巻き込んで無効化しないため)。
  const [resendingUserId, setResendingUserId] = useState("");
  // 「招待リンクをコピー」ボタンの二重送信防止(generate-invite-link呼び出し中は行ごとに無効化)。
  const [copyingInviteLinkUserId, setCopyingInviteLinkUserId] = useState("");
  // 「停止/再開」ボタンの処理中表示。保存が終わるまでの間ボタンを無効化し「処理中…」を出す
  // ことで、押した直後に何も変わっていないように見える(要件3)ことを防ぐ。
  const [togglingStatusUserId, setTogglingStatusUserId] = useState("");
  const [appState, setAppState] = useState(initialAppStateValue);
  const [companyEditId, setCompanyEditId] = useState("");
  const [storeEditId, setStoreEditId] = useState("");
  // 「店舗追加」= 新しい店舗を作る、専用の最小限の状態(店舗名のみ)。「店舗基本設定」
  // (storeForm/storeEditId、既存店舗の設定)とは完全に別の状態を持つ——同じ入力フォームを
  // 新規作成・既存編集の両方に共有しない(初期設定「店舗情報」の重複整理、要件7)。
  const [newStoreName, setNewStoreName] = useState("");
  const [newStoreFormStatus, setNewStoreFormStatus] = useState({ status: "idle", message: "" });
  // 店舗設定ビュー(StoreManagementPage)の「基本設定」タブを開いた際に店舗名欄へ自動
  // フォーカスするためのref(店舗管理ページ90点改修で2段階UIへ再構成——スクロール誘導は
  // 「一覧→設定」の画面遷移自体が代わりを果たすため、フォーカスのみ残す)。
  const storeFormNameInputRef = useRef(null);
  // ユーザー編集モーダル用。招待フォーム(userForm)とは完全に独立させている — 編集は
  // 名前・メール・権限・所属店舗・有効状態をSupabaseへ直接保存する専用フローで、招待フォーム
  // を流用していた旧実装は実際にはSupabaseへ何も保存していなかった(ローカル状態のみ)。
  const [editUserTargetId, setEditUserTargetId] = useState("");
  const [editUserDraft, setEditUserDraft] = useState({ name: "", email: "", role: "staff", storeIds: [], primaryStoreId: "", isActive: true });
  const [editUserSaving, setEditUserSaving] = useState(false);
  const [editUserError, setEditUserError] = useState("");
  // ユーザー削除の2段階確認用。deleteUserTargetIdがセットされるとまず確認ダイアログを表示し、
  // その中の「削除する」を押した時点でさらにwindow.confirmの最終確認を挟んでから実行する。
  const [deleteUserTargetId, setDeleteUserTargetId] = useState("");
  const [deleteUserSaving, setDeleteUserSaving] = useState(false);
  const [deleteUserError, setDeleteUserError] = useState("");
  // ユーザー管理画面の絞り込み・階層表示用。
  const [userFilterStoreId, setUserFilterStoreId] = useState("");
  const [userFilterRole, setUserFilterRole] = useState("");
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [collapsedUserStoreGroups, setCollapsedUserStoreGroups] = useState(() => new Set());
  const [companySettingsForm, setCompanySettingsForm] = useState(createCompanySettingsDefaults());
  // 「消費税を考慮する」+ 引当率(会社単位、company_settings.taxSettings)。companySettingsForm
  // (company_settings.settings列専用)とは別のcompany_settings.taxSettings列を保存するため、
  // 専用のフォーム状態・保存ハンドラを持つ(下のuseEffect/handleSaveTaxSettings参照)。
  const [taxSettingsForm, setTaxSettingsForm] = useState({ considerConsumptionTax: false, consumptionTaxReserveRate: "" });
  const [storeSettingsForm, setStoreSettingsForm] = useState(createStoreSettingsDefaults());
  const [dailyForm, setDailyForm] = useState({ ...defaultDailyEntry });
  const updateDailyField = (field, value) => {
    setDailyForm((prev) => {
      const next = { ...prev, [field]: value };
      // 総売上の自動計算(技術売上+店販売上が両方表示されている「詳細入力」の時だけ)。
      // その他売上がONの場合はここに加算する — OFF/未入力の場合は0円として扱われ、
      // 総売上=技術売上+店販売上のまま(要件4)。「かんたん入力」(技術/店販いずれか非表示)
      // では総売上は引き続き手入力のままで、この自動計算の対象外(既存仕様と矛盾させない)。
      if (totalSalesIsAutoCalculated && (field === "technicalSales" || field === "retailSales" || field === "otherSales")) {
        const technical = parseNumber(field === "technicalSales" ? value : prev.technicalSales);
        const retail = parseNumber(field === "retailSales" ? value : prev.retailSales);
        const other = showOtherSalesField ? parseNumber(field === "otherSales" ? value : prev.otherSales) : 0;
        next.totalSales = technical + retail + other;
      }
      if (customersIsAutoCalculated && (field === "newCustomers" || field === "repeatCustomers")) {
        next.customers = parseNumber(field === "newCustomers" ? value : prev.newCustomers) + parseNumber(field === "repeatCustomers" ? value : prev.repeatCustomers);
      }
      return next;
    });
  };
  // 文字入力時の画面ガクつき対策(総合品質チェック): updateDailyField自体は
  // totalSalesIsAutoCalculated等(このApp()内でこの後定義される値)を参照するため、
  // レンダーのたびに新しい関数として作られる——そのままFieldのonChangeへ渡すと、
  // Fieldをmemo化していても「propsが毎回変わる」ことになり再レンダリングをスキップ
  // できない。refで常に最新のupdateDailyFieldを指すようにした上で、フィールドごとの
  // ラッパー関数は初回だけ生成して以後ずっと同じ参照を使い回す(updateDailyField本体の
  // 計算ロジック・呼び出しタイミングは一切変更していない)。
  const updateDailyFieldRef = useRef(updateDailyField);
  updateDailyFieldRef.current = updateDailyField;
  const [dailyFieldChangeHandlers] = useState(() => {
    const makeHandler = (field) => (value) => updateDailyFieldRef.current(field, value);
    return ["technicalSales", "retailSales", "otherSales", "totalSales", "newCustomers", "repeatCustomers", "customers", "reviewCount"].reduce((acc, field) => {
      acc[field] = makeHandler(field);
      return acc;
    }, {});
  });
  const [dailyMode, setDailyMode] = useState("create");
  const [dailyOriginalEntry, setDailyOriginalEntry] = useState(null);
  const [dailyInsight, setDailyInsight] = useState("");
  // 日計(現金/キャッシュレス/ポイント利用の内訳)。dailyFormとは完全に別のstateにする —
  // 保存経路(saveCashBreakdown)・自動保存タイマー・読み込みタイミングをすべて独立させ、
  // 既存のdailyForm/saveDailyEntry(売上・日締めの保存)の挙動には一切影響しない設計にする
  // (要件13・17: 日計の追加によって日締め・既存の売上入力を壊さない)。
  const [cashBreakdownForm, setCashBreakdownForm] = useState({ cashAmount: "", cashlessAmount: "", pointAmount: "" });
  const updateCashBreakdownField = (field, value) => {
    setCashBreakdownForm((prev) => ({ ...prev, [field]: value }));
  };
  // 上のdailyFieldChangeHandlersと同じ理由・同じパターン(参照が安定したonChangeを
  // Fieldへ渡し、memo化の効果を実際に効かせる)。
  const updateCashBreakdownFieldRef = useRef(updateCashBreakdownField);
  updateCashBreakdownFieldRef.current = updateCashBreakdownField;
  const [cashBreakdownFieldChangeHandlers] = useState(() => {
    const makeHandler = (field) => (value) => updateCashBreakdownFieldRef.current(field, value);
    return ["cashAmount", "cashlessAmount", "pointAmount"].reduce((acc, field) => {
      acc[field] = makeHandler(field);
      return acc;
    }, {});
  });
  // 月別日計一覧モーダルの開閉のみを持つ(月・店舗はモーダル側のローカルstateで完結させ、
  // 日次入力側のselectedMonth/dailyFormには一切影響しない)。
  const [showCashBreakdownMonthly, setShowCashBreakdownMonthly] = useState(false);

  // まとめて入力。既存の日次入力(dailyForm/dailyMode/saveDailyEntry)は一切変更せず、
  // 完全に独立したstate・保存経路として追加する — 「毎日入力」を選んでいる限り、これらの
  // stateは一切参照されない。dailyInputModeが唯一の分岐点。
  const [dailyInputMode, setDailyInputMode] = useState("daily");
  const createBatchFormDefaults = () => ({
    startDate: "", endDate: "",
    totalSales: "", technicalSales: "", retailSales: "", otherSales: "",
    customers: "", newCustomers: "", repeatCustomers: "", reviewCount: "",
    cashAmount: "", cashlessAmount: "", pointAmount: "", memo: "",
  });
  const [batchForm, setBatchForm] = useState(createBatchFormDefaults());
  const updateBatchField = (field, value) => {
    setBatchForm((prev) => {
      const next = { ...prev, [field]: value };
      // 日次入力と同じ「総売上の自動計算」規約(要件2: 未入力項目は0として扱わない)。
      // 技術・店販・その他のうち1つでも入力があれば合算し、全て空欄ならtotalSalesも
      // 空欄のまま(nullとして保存され、0円確定にしない)。
      if (totalSalesIsAutoCalculated && (field === "technicalSales" || field === "retailSales" || field === "otherSales")) {
        const technicalRaw = field === "technicalSales" ? value : prev.technicalSales;
        const retailRaw = field === "retailSales" ? value : prev.retailSales;
        const otherRaw = showOtherSalesField ? (field === "otherSales" ? value : prev.otherSales) : "";
        const hasAny = [technicalRaw, retailRaw, otherRaw].some((v) => String(v || "").trim() !== "");
        next.totalSales = hasAny ? String(parseNumber(technicalRaw) + parseNumber(retailRaw) + parseNumber(otherRaw)) : "";
      }
      if (customersIsAutoCalculated && (field === "newCustomers" || field === "repeatCustomers")) {
        const newRaw = field === "newCustomers" ? value : prev.newCustomers;
        const repeatRaw = field === "repeatCustomers" ? value : prev.repeatCustomers;
        const hasAny = [newRaw, repeatRaw].some((v) => String(v || "").trim() !== "");
        next.customers = hasAny ? String(parseNumber(newRaw) + parseNumber(repeatRaw)) : "";
      }
      return next;
    });
  };
  // dailyFieldChangeHandlers(上記)と同じ理由・同じパターン: updateBatchField自体は
  // totalSalesIsAutoCalculated等を参照するため毎レンダー再生成されるが、refで常に最新版を
  // 指すようにした上で、フィールドごとのラッパー関数は初回だけ生成して以後ずっと同じ参照を
  // 使い回す(memo化されたFieldへ安定したonChangeを渡すため。updateBatchField本体の
  // 計算ロジックは無変更)。
  const updateBatchFieldRef = useRef(updateBatchField);
  updateBatchFieldRef.current = updateBatchField;
  const [batchFieldChangeHandlers] = useState(() => {
    const makeHandler = (field) => (value) => updateBatchFieldRef.current(field, value);
    return ["technicalSales", "retailSales", "otherSales", "totalSales", "newCustomers", "repeatCustomers", "customers", "reviewCount", "cashAmount", "cashlessAmount", "pointAmount"].reduce((acc, field) => {
      acc[field] = makeHandler(field);
      return acc;
    }, {});
  });
  const [batchEditId, setBatchEditId] = useState("");
  const [batchFormStatus, setBatchFormStatus] = useState({ status: "idle", message: "" });
  const [batchFormBusy, setBatchFormBusy] = useState(false);
  // 加盟店連携(閲覧専用)関連のローカルstate。company_partnerships一覧はhydrate対象外
  // (companies等とは別の独立したテーブルのため)なので、ログイン後・会社切替後に個別に
  // 読み込む。franchiseViewBusyは会社切り替え中の二重クリック防止、franchiseRequestModal*
  // は「加盟店追加」モーダル、franchiseDetailRelationshipIdは通知バナー/詳細確認用。
  const [companyPartnerships, setCompanyPartnerships] = useState([]);
  const [franchiseViewBusy, setFranchiseViewBusy] = useState(false);
  const [showFranchiseRequestModal, setShowFranchiseRequestModal] = useState(false);
  const [franchiseRequestSearch, setFranchiseRequestSearch] = useState("");
  const [franchiseRequestTargetId, setFranchiseRequestTargetId] = useState("");
  const [franchiseRequestStatus, setFranchiseRequestStatus] = useState({ status: "idle", message: "" });
  const [franchiseDetailRelationshipId, setFranchiseDetailRelationshipId] = useState("");
  const [franchiseActionBusyId, setFranchiseActionBusyId] = useState("");
  const [fixedForm, setFixedForm] = useState(() => ({ ...defaultFixedCostItem, startMonth: new Date().toISOString().slice(0, 7) }));
  // savingFixedCostRef(同期的なガード)と対になる、ボタンの見た目(disabled)を更新するための
  // state。refだけだと再レンダーが起きないためボタンが押せる見た目のままになる——他の保存系
  // フォーム(店舗設定のstoreFormStatus等)と同じ二段構え。
  const [fixedCostFormBusy, setFixedCostFormBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [businessDayInput, setBusinessDayInput] = useState("");
  const [manualBusinessDayInput, setManualBusinessDayInput] = useState("");
  const [isBusinessDayEditing, setIsBusinessDayEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState({ status: "saved", message: "自動保存済み", timestamp: "", error: false });
  const [syncStatus, setSyncStatus] = useState({ status: "idle", message: "同期待機中", timestamp: "", error: false });
  // PWAアップデート対策(要件6): main.jsxが新しいService Worker(待機中)を検知すると
  // window発火する"salon-manager:sw-update-available"を受け取り、そのapplyUpdateコールバック
  // (SKIP_WAITINGメッセージを送るだけの関数)を保持する。null以外の間、下の更新バナーを表示
  // する。ユーザーが「更新する」を押すまでは何もリロードしない(main.jsx参照)。
  const [swUpdateApply, setSwUpdateApply] = useState(null);
  useEffect(() => {
    const handleUpdateAvailable = (event) => {
      setSwUpdateApply(() => event.detail?.applyUpdate || null);
    };
    window.addEventListener("salon-manager:sw-update-available", handleUpdateAvailable);
    return () => window.removeEventListener("salon-manager:sw-update-available", handleUpdateAvailable);
  }, []);
  const [syncInitialized, setSyncInitialized] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  // 月間目標設定パネル専用の対象月。ヘッダーのグローバルな対象月とは独立して切り替えられる。
  const [targetSelectedMonth, setTargetSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [targetDraft, setTargetDraft] = useState(() => ({ ...defaultTarget }));
  const [targetHolidayDraft, setTargetHolidayDraft] = useState("");
  const [targetSaveStatus, setTargetSaveStatus] = useState({ status: "idle", message: "" });
  const [targetLoadStatus, setTargetLoadStatus] = useState({ status: "idle", loadedMonth: "", loadedStore: "" });
  const [targetDirty, setTargetDirty] = useState(false);
  const targetLoadRequestRef = useRef(0);
  const targetSaveInFlightRef = useRef(false);
  const targetAutoSaveTimerRef = useRef(null);
  const lastTargetAutoSaveSignatureRef = useRef("");
  // 日次入力項目の設定(店舗ごと、月の概念はない)。stores.daily_field_settings は他の店舗情報と
  // 同じタイミングでロードされるため、対象月選択のような専用フェッチは不要。
  const [dailyFieldDraft, setDailyFieldDraft] = useState(() => defaultDailyFieldSettings());
  const [dailyFieldDirty, setDailyFieldDirty] = useState(false);
  // Same idea as dailyFieldDraft above, for 月間目標設定's own toggleable fields.
  const [monthlyTargetFieldDraft, setMonthlyTargetFieldDraft] = useState(() => defaultMonthlyTargetFieldSettings());
  const [monthlyTargetFieldSaveStatus, setMonthlyTargetFieldSaveStatus] = useState({ status: "idle", message: "" });
  const [monthlyTargetFieldDirty, setMonthlyTargetFieldDirty] = useState(false);
  // 日計管理・在庫管理は元々クリック即保存だったが、「入力設定」タブへの統合により
  // dailyFieldDraftと同じドラフト+dirty+手動保存方式へ統一(要件: トグルを変更しただけでは
  // 確定せず「変更を保存」でDBへ保存する)。
  const [cashBreakdownDraft, setCashBreakdownDraft] = useState(false);
  const [cashBreakdownDirty, setCashBreakdownDirty] = useState(false);
  const [inventoryTrackingDraft, setInventoryTrackingDraft] = useState(false);
  const [inventoryTrackingDirty, setInventoryTrackingDirty] = useState(false);
  const [inputSettingsSaveStatus, setInputSettingsSaveStatus] = useState({ status: "idle", message: "" });
  const inputSettingsDirty = dailyFieldDirty || cashBreakdownDirty || inventoryTrackingDirty;
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiChatInitialQuestion, setAiChatInitialQuestion] = useState("");
  // モバイル(≤900px)のハンバーガーメニュー開閉。PC(>900px)ではCSS側で常時表示のため
  // この状態は一切参照されない。
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const lastPersistedRef = useRef("");
  // persistToSupabase(tenant_snapshotsへの丸ごと自動保存)は、下の useEffect が appState の
  // 変更のたびに(デバウンス無しで)即座に発火する。appStateが短時間に連続して変わると
  // (例: 会社のAI分析トグルをONにした直後の再レンダリング)、1回目の書き込み(古いデータ)が
  // 2回目の書き込み(新しいデータ)より後にSupabase側で完了することがあり、その場合
  // 「後に完了した方」が勝って新しい値を古い値で上書きしてしまう — 実際に本番の
  // tenant_snapshotsで、companiesテーブル側は正しくtrueなのに、直後に保存されたスナップ
  // ショットにはfalseが埋め込まれている状態を確認した(トグルが保存直後に元へ戻って見える
  // 不具合の実データ上の証拠)。persistInFlightRef/pendingPersistStateRefで「常に1件だけ
  // 実行中、割り込みは待たせて最新の状態だけを次に送る」ようにし、複数の書き込みが並行して
  // 走って完了順序が入れ替わる余地そのものを無くす。
  const persistInFlightRef = useRef(false);
  const pendingPersistStateRef = useRef(null);
  const autoSaveTimerRef = useRef(null);
  const lastAutoSaveSignatureRef = useRef("");
  // 日計専用の自動保存タイマー・直近保存済みシグネチャ。dailyForm側のautoSaveTimerRef/
  // lastAutoSaveSignatureRefとは完全に別物 — 日計の保存が売上側の自動保存ロジック
  // (400msデバウンス・stale closure対策)と競合したり干渉したりしない。
  const cashBreakdownAutoSaveTimerRef = useRef(null);
  const lastCashBreakdownAutoSaveSignatureRef = useRef("");
  const remoteSyncChannelRef = useRef(null);
  // realtimeサブスクリプション(triggerRehydrate)・ウィンドウフォーカス復帰(handleFocus)の
  // どちらも、effect本体の外で長生きするコールバック内で `tenantState: appState` を渡している。
  // これらのeffectのdependency配列にはappState全体が含まれていない(currentCompanyId/
  // selectedMonth等の一部フィールドのみ)ため、それ以外のフィールドを更新しても、これらの
  // effectは再実行されず、コールバックは古い(更新前の)appStateをクロージャで持ったままに
  // なる。appStateRefは常に最新のappStateを指す — 各コールバックはクロージャの代わりに
  // このrefを読むことで、effectの再実行を待たずに常に最新の状態を使えるようにする。
  const appStateRef = useRef(appState);
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);
  // hydrateFromSupabaseは複数の経路(ログイン時・realtime購読・タブ復帰・リトライ)から
  // 重複して呼ばれうるが、互いに完了順を保証しない — 先に発火した呼び出しが後から発火した
  // 呼び出しより後に完了(resolve)した場合、その「古い結果」がsetAppStateで最後に上書きして
  // しまう(appStateRefで各呼び出しの入力を最新化しても、この完了順の逆転自体は防げない)。
  // 呼び出しごとに増分するIDを持たせ、自分より新しい呼び出しが既に開始されていたら、
  // 自分の結果は適用せずに破棄する。
  //
  // 注: AI分析ON/OFF(companies.ai_analysis_enabled)はこのhydrateFromSupabase/
  // tenant_snapshotの経路を一切経由しない、完全に独立した状態として管理している
  // (下のaiAnalysisSettings/getCompanyAiAnalysisSettings/updateCompanyAiAnalysisSetting
  // 参照)。hydrateRequestRefはAI分析設定には無関係で、それ以外のcompanies/stores/
  // 日次売上等のフィールドの新旧判定にのみ使う。
  const hydrateRequestRef = useRef(0);
  const hydrateRetryTimerRef = useRef(null);
  const hydrateRetryCountRef = useRef(0);
  // パフォーマンス改善(多重リクエスト対策、要件8): hydrateFromSupabaseは複数の経路
  // (ログイン/store切替・対象月変更/focus・visibilitychange・pageshow/Supabase Realtime/
  // 手動再試行)から短時間に重複して呼ばれ得る。この関数が実際にSupabaseへ投げる18件の
  // クエリは、選択中の店舗ではなく company_id と対象月(targetMonth)だけで内容が決まる
  // (常に会社内の全店舗分をまとめて取得する設計のため)——つまり同じcompany_id×対象月の
  // 呼び出しが重なった場合、後から来た方は先に飛んでいるリクエストと完全に同じ結果を
  // 取りに行くだけで、追加の情報価値が無い。先行するhydrateがまだ完了していない間に同じ
  // company_id×対象月の呼び出しが来たら、新たなSupabaseリクエストは発行せず先行呼び出しの
  // 完了に任せる(React StrictModeの開発時二重実行によるeffectの二重発火もこれで自然に
  // 吸収される)。company_id・対象月のどちらかが異なる呼び出しは別キー扱いになるため、
  // 店舗切替・対象月変更で本当に必要な再取得を妨げることはない。
  const hydrateInFlightRef = useRef(null);
  // AI分析ON/OFFの唯一のsource of truthは companies.ai_analysis_enabled。tenant_snapshot・
  // hydrateFromSupabase・localStorage・appState.companiesのどれも経由しない、完全に独立した
  // company単位のstate(companyId -> boolean)として持つ — ログイン時/会社一覧が変わった時に
  // だけ取得し直し、それ以外(hydrate・focus・visibilitychange・pageshow・realtime・他の
  // 画面の保存操作)からは一切書き換えない。値を変えられるのはhandleToggleCompanyAiAnalysis
  // だけ。
  const [aiAnalysisSettings, setAiAnalysisSettings] = useState({});
  // トグル操作中のcompanyId集合。更新中のcompanyについては、並行して走る一覧再取得の結果で
  // 上書きしない(更新中に古い取得結果が割り込んで一瞬OFFに戻る、のような表示のちらつきを
  // 防ぐ)。setTimeout等の時間ベースの回避策ではなく、「今まさに更新中かどうか」という
  // 状態そのもので判定する。
  const aiAnalysisUpdatingRef = useRef(new Set());
  const { stores, selectedStore, selectedStoreId, selectedMonth } = appState;
  // 「全店舗」はcompany_admin専用の仮想ビュー(storesテーブルに実店舗として存在しない)。
  // selectedStoreがこの予約値のときは、以降のすべての店舗依存ロジックを分岐させる。
  const isAllStoresView = selectedStore === ALL_STORES_VALUE;
  // 権限判定・company/store解決の重複整理(総合品質チェックで発見した問題F): 以前は
  // currentCompanyIdがどのcompanyとも一致しない場合、appState.companies[0](=先頭の会社、
  // 誰の会社かは配列の並び順次第)へ静かにフォールバックしていた。一方、書き込み系の
  // resolveTargetCompanyAndStore(下方で定義)は同じ状況でnull(=保存不可、明示的なエラー)を
  // 返す設計になっており、両者の挙動が食い違っていた——UI(このcurrentCompany)は「別の会社の
  // データ」を表示し続けるのに、保存だけは静かに失敗する、というcompany_idの境界が実質的に
  // 崩れかねない状態を招いていた(特にsystem_adminのように複数社を扱うロールで、
  // currentCompanyIdが指す会社が削除された直後などに顕在化し得る)。currentCompanyIdが
  // companiesと一致しない状態は「読み込み中」または「壊れた状態」のいずれかであり、
  // どちらの場合も任意の別の会社のデータへ静かに切り替えるのではなくnullを返すのが正しい
  // (companies?.[0]と同じ「読み込み中はnull」という既存の挙動へ揃えるだけで、currentCompanyを
  // 参照している全箇所は元々null許容の書き方(currentCompany?.や早期returnガード)に
  // なっているため、新たな崩れ方は生まない)。
  const currentCompany = useMemo(() => resolveCurrentCompany(appState.companies, appState.currentCompanyId), [appState.companies, appState.currentCompanyId]);
  // ログイン時、および会社一覧の中身(id構成)が変わった時にだけ、companiesテーブルから
  // AI分析設定を直接取得し直す。tenant_snapshotのhydrate/persistとは完全に別経路 — display-
  // modeやPWA判定による分岐も持たない(Chrome/PWAで常に同じ処理を使う)。
  const companyIdsKey = useMemo(() => (appState.companies || []).map((company) => company.id).filter(Boolean).sort().join(","), [appState.companies]);
  useEffect(() => {
    if (!isSupabaseConfigured || authMode !== "app" || !currentUser?.authUserId || !companyIdsKey) return;
    const companyIds = companyIdsKey.split(",");
    let cancelled = false;
    void getCompanyAiAnalysisSettings({ companyIds }).then((result) => {
      if (cancelled || !result.ok) return;
      setAiAnalysisSettings((prev) => {
        const next = { ...prev };
        result.data.forEach((row) => {
          // トグル操作中のcompanyはこの一覧取得の結果で上書きしない — handleToggleCompany
          // AiAnalysis自身が更新完了後に確定値を反映する(下記参照)。
          if (aiAnalysisUpdatingRef.current.has(row.id)) return;
          next[row.id] = row.aiAnalysisEnabled;
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [authMode, currentUser?.authUserId, companyIdsKey]);
  // アーカイブ済み店舗を、店舗切替・ランキング・全店舗集計・日次入力対象など「通常運用」の
  // あらゆる場面から除外する単一の定義点(要件5)。停止中の店舗はここでは除外しない — 停止中
  // でも過去データの閲覧・店舗切替自体は引き続き可能で、新規入力のみを個別にブロックする
  // 仕様のため。店舗管理画面(filteredStores)だけは、アーカイブ済み店舗の復元操作が必要な
  // ため意図的にこの変数を経由せず currentCompany.stores を直接参照している。
  const currentCompanyStores = useMemo(() => (currentCompany?.stores || []).filter((store) => store.status !== "archived"), [currentCompany]);
  // Resolve by selectedStoreId first — see the self-healing effect below for why a name-only
  // match can briefly be stale (e.g. right after another device renames the current store).
  // 全店舗ビューでは実店舗にフォールバックせず、意図的にnullのままにする(そうしないと
  // resolveTargetCompanyAndStore等が誤って最初の実店舗を対象にしてしまう)。
  const selectedStoreEntity = useMemo(
    () => (isAllStoresView ? null : (
      (selectedStoreId && currentCompanyStores.find((store) => store.id === selectedStoreId))
      || currentCompanyStores.find((store) => store.name === selectedStore)
      || currentCompanyStores[0]
      || null
    )),
    [currentCompanyStores, selectedStore, selectedStoreId, isAllStoresView]
  );
  const activeDailyFieldSettings = useMemo(() => normalizeDailyFieldSettings(selectedStoreEntity?.settings?.dailyFieldSettings), [selectedStoreEntity]);
  const activeMonthlyTargetFieldSettings = useMemo(() => normalizeMonthlyTargetFieldSettings(selectedStoreEntity?.settings?.monthlyTargetFields), [selectedStoreEntity]);
  // 目標口コミ数の表示/非表示は「月間目標設定の項目設定」(店舗ごとのmonthlyTargetFields)
  // だけで決める — 日次入力側の口コミ数トグル(showReviewCountField、日次入力画面用)とは独立。
  // 全店舗ビューでは、会社内のどれか1店舗でもONにしていれば表示する(他の全店舗向け
  // effectiveShow*と同じ考え方)。
  const showReviewCountTargetField = isAllStoresView
    ? currentCompanyStores.some((store) => Boolean(store.settings?.monthlyTargetFields?.fields?.targetReviewCount))
    : Boolean(activeMonthlyTargetFieldSettings.fields.targetReviewCount);
  const showTechnicalSalesField = Boolean(activeDailyFieldSettings.fields.technicalSales);
  const showRetailSalesField = Boolean(activeDailyFieldSettings.fields.retailSales);
  const showCustomersField = Boolean(activeDailyFieldSettings.fields.customers);
  const showNewCustomersField = showCustomersField && Boolean(activeDailyFieldSettings.fields.newCustomers);
  const showRepeatCustomersField = showCustomersField && Boolean(activeDailyFieldSettings.fields.repeatCustomers);
  const showMemoField = Boolean(activeDailyFieldSettings.fields.memo);
  const showReviewCountField = Boolean(activeDailyFieldSettings.fields.reviewCount);
  // その他売上は以前は会社単位のpreferences.showOtherSalesで制御していたが、他の日次入力
  // 項目と同じ「日次入力項目の設定」内で店舗ごとにON/OFFする方式に統一した。
  const showOtherSalesField = Boolean(activeDailyFieldSettings.fields.otherSales);
  // 全店舗ビュー専用: 個々の店舗のON/OFFではなく「会社内のどれか1店舗でもONにしていれば
  // 表示する」という考え方(項目自体を会社として使っているかどうかの判定)。
  const companyHasDailyFieldEnabled = (fieldKey) => currentCompanyStores.some((store) => Boolean(store.settings?.dailyFieldSettings?.fields?.[fieldKey]));
  const effectiveShowTechnicalSalesField = isAllStoresView ? companyHasDailyFieldEnabled("technicalSales") : showTechnicalSalesField;
  const effectiveShowRetailSalesField = isAllStoresView ? companyHasDailyFieldEnabled("retailSales") : showRetailSalesField;
  const effectiveShowOtherSalesField = isAllStoresView ? companyHasDailyFieldEnabled("otherSales") : showOtherSalesField;
  // 売上ダッシュボードの口コミカード表示可否。日次入力の口コミ数トグル(実績を入力する機能)
  // だけで決める — 目標口コミ数(showReviewCountTargetField、任意の目標設定)には依存させない
  // (要件3: 「目標口コミ数をONにしないと口コミ実績が使えない」という仕様にはしない)。
  const effectiveShowReviewCountField = isAllStoresView ? companyHasDailyFieldEnabled("reviewCount") : showReviewCountField;
  const totalSalesIsAutoCalculated = showTechnicalSalesField && showRetailSalesField;
  const customersIsAutoCalculated = showNewCustomersField && showRepeatCustomersField;
  // updateDailyField keeps dailyForm.totalSales/dailyForm.customers correctly synced whether
  // they're auto-calculated (technicalSales+retailSales / newCustomers+repeatCustomers) or
  // typed directly, so both are always safe to read as-is here.
  const dailyEffectiveTotalSales = parseNumber(dailyForm.totalSales);
  const dailyEffectiveCustomers = parseNumber(dailyForm.customers);
  // 日計(要件4-7): 3項目すべて未入力の場合は一致・差額の判定自体を表示しない
  // (「未入力です」等の警告も出さない、という要件7を満たすため hasAnyValue で判定を丸ごと
  // 出し分ける)。差額があっても保存・日締めを妨げない(要件6) — ここでは表示用の値を
  // 計算するだけで、保存経路には一切関与しない。
  const cashBreakdownHasAnyValue = [cashBreakdownForm.cashAmount, cashBreakdownForm.cashlessAmount, cashBreakdownForm.pointAmount].some((value) => parseNumber(value) > 0);
  const cashBreakdownTotal = parseNumber(cashBreakdownForm.cashAmount) + parseNumber(cashBreakdownForm.cashlessAmount) + parseNumber(cashBreakdownForm.pointAmount);
  const cashBreakdownDiff = dailyEffectiveTotalSales - cashBreakdownTotal;
  const cashBreakdownIsMatched = cashBreakdownDiff === 0;
  // 対象日が店休日かどうか(要件18)。dailyForm.dateの月から店休日一覧を取るので、月をまたいで
  // 選択しても正しく判定できる。
  const isDailyFormDateHoliday = Boolean(dailyForm.date) && isHolidayDate(getStoreHolidayDates(appState, selectedStoreId, dailyForm.date.slice(0, 7)), dailyForm.date);
  // staffは日締め済みのデータを自分では編集・削除できない(店長以上のみ修正可能) — バックエンド
  // はdaily_sales_update/delete_company_scoped RLS(is_day_closed=falseを要求)で強制しているが、
  // ここでも操作前にUIで気づけるようにする。店長以上はこの制限を受けない。
  const isDailyEntryLockedForStaff = normalizeRole(currentRole) === "staff" && Boolean(dailyForm.date) && Boolean(appState.dayClosingStates?.[buildMonthKey(selectedStoreId, selectedMonth)]?.[dailyForm.date]);
  // 権限体系の正式仕様: staffの日次入力は「今日の分のみ」。日締め状態(上のisDailyEntry
  // LockedForStaff)とは別の制約 — 今日作成した自分のデータでも、日付をまたいだ翌日以降
  // (=過去日になった後)は編集・削除できない(RLS側のbusiness_date=今日の条件と揃える、
  // 20260825000000_staff_today_only_update_delete.sql参照)。未来日も同様に対象外にする
  // (INSERTのRLSも今日限定のため)。
  const isStaffPastOrFutureDateLocked = normalizeRole(currentRole) === "staff" && Boolean(dailyForm.date) && dailyForm.date !== formatLocalDate(new Date());
  // 対象日の現在の日締め状態。toggleDayClosingのボタン表示・確認ダイアログの文言をこれで
  // 出し分ける(常に「日締め」という同じラベルのボタンだと、既に締め済みの日をもう一度押した
  // ときに実際は「解除」される、と気づかず誤って締めを解除してしまう不具合があったため)。
  const isSelectedDailyEntryClosed = Boolean(dailyForm.date) && Boolean(appState.dayClosingStates?.[buildMonthKey(selectedStoreId, selectedMonth)]?.[dailyForm.date]);
  const currentUserProfile = useMemo(() => (appState.users || []).find((user) => user.id === appState.currentUserId) || null, [appState.currentUserId, appState.users]);
  const allowedStoreIds = useMemo(() => getAllowedStoreIdsForRole({ role: currentRole, companyStoreIds: currentCompanyStores.map((store) => store.id), currentUserStoreIds: currentUserProfile?.storeIds || [] }), [currentRole, currentCompanyStores, currentUserProfile]);
  const visibleStores = useMemo(() => {
    if (!currentCompanyStores.length) return [];
    return currentCompanyStores.filter((store) => allowedStoreIds.includes(store.id));
  }, [allowedStoreIds, currentCompanyStores]);

  // ユーザー管理: どのロールを招待できるか(店長ならstaffのみ等)、招待フォームで選べる店舗
  // 範囲、そして実際に管理画面に一覧できるユーザーの集合。RLS(profiles_insert/update/
  // delete_company_scoped)が実際の強制であり、これらはUI側の対応するスコープ制限。
  const invitableRoles = useMemo(() => getInvitableRoles(currentRole), [currentRole]);
  const inviteScopedStores = useMemo(
    () => (normalizeRole(currentRole) === "store_manager" ? currentCompanyStores.filter((store) => allowedStoreIds.includes(store.id)) : currentCompanyStores),
    [currentRole, currentCompanyStores, allowedStoreIds]
  );
  // 会社分離の修正(誤った店舗への招待削除後に再招待できない不具合の周辺調査で発見):
  // 以前はsystem_adminの場合だけcompany_idでの絞り込みを一切せず、appState.users
  // (system_adminはRLS上全社分のプロフィールを取得するため、実質「全社のユーザーが1つの
  // 配列に混在した状態」)をそのままユーザー管理画面へ出していた——他社(例: INTRO)の
  // ユーザーが、会社名のラベルも無いまま今見ている会社(例: フィーネ)のユーザー一覧に
  // 紛れ込んで表示されてしまう状態だった。この画面はヘッダーの会社切替と連動する
  // 「今選択している会社」のユーザー管理という設計(会社をまたいだ一覧は別画面の会社管理
  // 側の役割)なので、system_adminも他ロールと同じくcurrentCompanyでの絞り込みを行う。
  const manageableUsers = useMemo(() => (appState.users || []).filter((user) => {
    if (user.companyId !== currentCompany?.id) return false;
    const normalizedCurrentRole = normalizeRole(currentRole);
    if (normalizedCurrentRole === "store_manager") {
      return user.role === "staff" && (user.storeIds || []).some((storeId) => allowedStoreIds.includes(storeId));
    }
    return true;
  }), [appState.users, currentRole, currentCompany?.id, allowedStoreIds]);

  // 店舗 > 権限/役職 > スタッフ の階層で表示するためのグループ化。プライマリ店舗(なければ
  // 所属店舗の先頭)を基準に1人1グループへ所属させる(複数店舗兼務でも表示が重複しない
  // シンプルな一覧を優先)。「所属店舗なし」はsystem_admin等、店舗に紐づかない管理者向け。
  const groupedManageableUsers = useMemo(() => {
    const searchValue = userSearchQuery.trim().toLowerCase();
    const filtered = manageableUsers.filter((user) => {
      if (userFilterRole && user.role !== userFilterRole) return false;
      const userStoreId = user.primaryStoreId || (user.storeIds || [])[0] || "";
      if (userFilterStoreId === "__none__" && userStoreId) return false;
      if (userFilterStoreId && userFilterStoreId !== "__none__" && userStoreId !== userFilterStoreId) return false;
      if (searchValue && !`${user.name} ${user.email}`.toLowerCase().includes(searchValue)) return false;
      return true;
    });
    const storeGroups = new Map();
    filtered.forEach((user) => {
      const storeId = user.primaryStoreId || (user.storeIds || [])[0] || "";
      const key = storeId || "__none__";
      if (!storeGroups.has(key)) {
        storeGroups.set(key, {
          key,
          storeId,
          storeName: storeId ? (currentCompanyStores.find((store) => store.id === storeId)?.name || "不明な店舗") : "所属店舗なし",
          roleGroups: new Map(),
        });
      }
      const group = storeGroups.get(key);
      if (!group.roleGroups.has(user.role)) group.roleGroups.set(user.role, []);
      group.roleGroups.get(user.role).push(user);
    });
    const storeOrder = currentCompanyStores.map((store) => store.id);
    return Array.from(storeGroups.values())
      .sort((a, b) => {
        if (!a.storeId) return 1;
        if (!b.storeId) return -1;
        return storeOrder.indexOf(a.storeId) - storeOrder.indexOf(b.storeId);
      })
      .map((group) => ({
        ...group,
        roleGroups: Array.from(group.roleGroups.entries())
          .sort(([roleA], [roleB]) => ROLE_GROUP_ORDER.indexOf(roleA) - ROLE_GROUP_ORDER.indexOf(roleB))
          .map(([role, users]) => ({ role, users: users.sort((a, b) => a.name.localeCompare(b.name, "ja")) })),
      }));
  }, [manageableUsers, userFilterRole, userFilterStoreId, userSearchQuery, currentCompanyStores]);

  const toggleUserStoreGroupCollapsed = (key) => {
    setCollapsedUserStoreGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const filteredStores = useMemo(() => {
    const searchValue = storeSearch.trim().toLowerCase();
    // company_admin/system_admin manage every store in the company; store_manager/staff only
    // ever see the stores they're actually assigned to (allowedStoreIds), matching the same
    // scoping used for the store switcher (visibleStores) and enforced server-side by RLS.
    const roleScoped = canManageStores(currentRole)
      ? (currentCompany?.stores || [])
      : (currentCompany?.stores || []).filter((store) => allowedStoreIds.includes(store.id));
    // アーカイブ済み店舗は「アーカイブ店舗を表示」トグルがオンの時だけ表示する専用一覧とし、
    // 通常時は運営中/停止中のみを表示する(要件5)。
    const statusScoped = roleScoped.filter((store) => (showArchivedStores ? store.status === "archived" : store.status !== "archived"));
    const source = statusScoped.filter((store) => {
      if (!searchValue) return true;
      return (store.name || "").toLowerCase().includes(searchValue);
    });
    return sortStoresForManagement(source, storeSort);
  }, [currentCompany?.stores, storeSearch, storeSort, currentRole, allowedStoreIds, showArchivedStores]);
  const activeBusinessType = companyForm.businessType || currentCompany?.businessType || "salon";
  const storeNamePlaceholder = getBusinessTypeDefaultStoreName(activeBusinessType);

  // 一部ユーザーでブラウザ更新のたびにログイン画面へ戻される不具合の修正(本体)。
  // ensureProfileForAuthUser/loadTenantStateFromSupabaseは複数回のSupabase往復を伴うため、
  // 遅い回線・一時的なネットワーク不調・瞬間的なRLS/タイミングの問題で失敗し得る——だが
  // これはあくまで「アプリ側のプロフィール/テナント情報が今取れなかった」だけであり、
  // Supabase Auth自体のセッション(呼び出し元がsession.userの存在を既に確認済み)には
  // 何の問題も無い。ここで例外を外側へ投げず、この関数内で数回自動リトライし、それでも
  // 失敗した場合はauthMode(login/signup/app等)を一切変更せずauthProfileLoadErrorだけを
  // 設定する——ログイン画面表示の判定(!currentUser && !authLoading)より前で
  // authProfileLoadErrorをチェックする分岐を設けており(下のJSX参照)、有効なセッションを
  // 持つユーザーが誤ってログイン画面へ戻されることは無い。
  const PROFILE_LOAD_MAX_ATTEMPTS = 3;
  const PROFILE_LOAD_RETRY_DELAY_MS = 1500;
  const loadProfileAndEnterApp = async (session, attempt = 1) => {
    authLog(`profile取得開始 attempt=${attempt}/${PROFILE_LOAD_MAX_ATTEMPTS}`);
    try {
      const profile = await ensureProfileForAuthUser({ authUserId: session.user.id, email: session.user.email, role: resolveRoleForEmail(session.user.email) });
      if (!profile) {
        throw new Error("プロフィール情報を取得できませんでした");
      }
      authLog("profile取得成功", { role: normalizeRole(profile?.role || "staff"), hasCompanyId: Boolean(profile?.company_id) });
      const tenantState = await loadTenantStateFromSupabase({ authUserId: session.user.id, email: session.user.email, currentProfile: profile });
      authLog("company/store取得成功", { companyCount: tenantState.companies?.length || 0 });
      const localRecoveredState = normalizeAppState(readAppState());
      const nextUser = buildAuthenticatedUser({ profile, authUser: session.user });
      setCurrentUser(nextUser);
      setCurrentRole(normalizeRole(profile?.role || "staff"));
      const reconciledCompanies = tenantState.companies?.length ? tenantState.companies : localRecoveredState.companies || [];
      const reconciledCurrentCompanyId = profile?.company_id || tenantState.currentCompanyId || localRecoveredState.currentCompanyId || "";
      const { selectedStore: preferredSelectedStore, selectedStoreId: preferredSelectedStoreId } = resolvePreferredStoreSelection({
        tenantState: { ...tenantState, companies: reconciledCompanies },
        localRecoveredState,
        currentCompanyId: reconciledCurrentCompanyId,
        role: profile?.role || "staff",
      });
      const reconciledState = {
        ...tenantState,
        ...localRecoveredState,
        currentCompanyId: reconciledCurrentCompanyId,
        currentUserId: nextUser.profileId,
        currentAuthUserId: nextUser.authUserId,
        companies: reconciledCompanies,
        users: tenantState.users?.length ? tenantState.users : localRecoveredState.users || [],
        companySnapshots: tenantState.companySnapshots || localRecoveredState.companySnapshots || {},
        stores: tenantState.stores?.length ? tenantState.stores : localRecoveredState.stores || [],
        selectedStore: preferredSelectedStore,
        selectedStoreId: preferredSelectedStoreId,
        selectedMonth: localRecoveredState.selectedMonth || tenantState.selectedMonth || new Date().toISOString().slice(0, 7),
        isViewingFranchise: false,
        homeCompanyIdBeforeFranchiseView: "",
      };
      writeAppState(reconciledState);
      setAppState(reconciledState);
      setSyncStatus({ status: "syncing", message: "同期中です…", timestamp: new Date().toISOString(), error: false });
      void hydrateFromSupabase({ authUser: session.user, profile, tenantState: reconciledState });
      setAuthProfileLoadError("");
      setAuthMode("app");
      setActivePage(resolveDefaultPage(profile?.role || "staff"));
      authLog("認証完了、appへ遷移");
    } catch (error) {
      if (attempt < PROFILE_LOAD_MAX_ATTEMPTS) {
        authLog(`profile/company/store取得失敗、${PROFILE_LOAD_RETRY_DELAY_MS * attempt}ms後にリトライ(セッションは維持したまま)`, error?.message);
        await new Promise((resolve) => window.setTimeout(resolve, PROFILE_LOAD_RETRY_DELAY_MS * attempt));
        await loadProfileAndEnterApp(session, attempt + 1);
        return;
      }
      console.error("[auth-init] profile/tenant load failed after retries — keeping session, not logging out", error);
      authLog("redirect理由: profile/company/store取得が全リトライ失敗(ログイン画面へは戻さず専用エラー画面を表示)");
      setAuthProfileLoadError(getLocalizedSupabaseErrorMessage(error));
    }
  };

  useEffect(() => {
    // A brand-new invitee opening /signup?invite=TOKEN has no Supabase session yet — this whole
    // effect's job on that first load is exactly to notice that and fall through to the
    // "no session" branches below. Those branches used to hardcode setAuthMode("login"),
    // silently overwriting the "signup" mode the ?invite= param had already set at initial
    // useState — so every invite link bounced straight to the login screen instead of
    // registration. Preserving "signup" here (and only here) whenever the URL still carries an
    // invite token is the fix; an authenticated session always still wins and goes to "app".
    const hasInviteIntent = typeof window !== "undefined" && Boolean(new URLSearchParams(window.location.search).get("invite"));
    // 新規オーナー・セルフサインアップのテスト専用導線(?owner-signup=1)も、招待と全く同じ
    // 理由で保護する必要がある——このeffectはセッション未確立時に必ず一度authModeを
    // 上書きするため、ここで拾っておかないと初期useStateで設定した"ownerSignup"がこの直後に
    // "login"へ巻き戻され、ownerSignupVisible(flag)がfalseの間はテストURLで開いても
    // 常にログイン画面へ戻ってしまう(要件12の直接の不具合)。
    const hasOwnerSignupIntent = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("owner-signup") === "1" && Boolean(new URLSearchParams(window.location.search).get("testKey"));
    const fallbackAuthMode = () => (hasInviteIntent ? "signup" : hasOwnerSignupIntent ? "ownerSignup" : "login");
    const initializeAuth = async () => {
      authLog("auth初期化開始");
      try {
        if (!isSupabaseConfigured) {
          setCurrentUser(null);
          setCurrentRole("staff");
          setAuthMode(fallbackAuthMode());
          setActivePage("dashboard");
          setAppState(initialAppStateValue);
          return;
        }

        // PKCEフロー(?code=...)でのリダイレクトに対する保険。管理者招待(admin.inviteUserByEmail)
        // は招待先のブラウザに事前のcode_verifierを持たせる手段が無いため、実装上は常にハッシュ
        // 形式(#access_token=...)でリダイレクトされる(supabase-jsのflowType既定値'implicit'と
        // 一致)。それでも将来的なSupabase側の仕様変化等で万一?code=が付与された場合に備え、
        // ここでセッション確立を試みておく(失敗してもベストエフォートで後続の通常フローに
        // 委ねるため、他の認証方法を妨げない)。
        if (typeof window !== "undefined") {
          const codeParam = new URLSearchParams(window.location.search).get("code");
          if (codeParam) {
            await supabase.auth.exchangeCodeForSession(codeParam).catch(() => {});
          }
        }

        // ハッシュを消す(下記)前に、パスワード再設定リンク(type=recovery)かどうかを控えて
        // おく。招待(type=invite)は?invite=トークンで判定できるが、再設定はこのtypeでしか
        // 判定できない。
        const hashParamsBeforeCleanup = typeof window !== "undefined" ? new URLSearchParams(window.location.hash.replace(/^#/, "")) : new URLSearchParams();
        const isRecoveryCallback = hashParamsBeforeCleanup.get("type") === "recovery";

        const { data: { session }, error } = await getSupabaseSession();
        if (error) throw error;
        authLog("session取得成功", { hasSession: Boolean(session?.user) });
        // supabase-jsのdetectSessionInUrlは、access_token等をURLのハッシュ(#…)から読み取った
        // 時点でセッションを確立するが、ハッシュ自体はブラウザのアドレスバーに残り続ける。
        // getSupabaseSession()が完了した今、ハッシュに含まれていた情報は既に処理済みなので、
        // 古いトークンが残ったまま再読み込み・戻る操作をしても再処理されないよう、ここで
        // 一度だけ取り除く(要件: 古いhash形式のトークンが残留しないようにする)。
        if (typeof window !== "undefined" && window.location.hash) {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }
        if (isRecoveryCallback && session?.user) {
          // パスワード再設定メールのリンクを開くと、招待と同様にSupabaseが一時的なセッションを
          // 自動確立する。ここではまだ「ログイン完了」扱いにせず(currentUserは設定しない)、
          // 新しいパスワードを入力する専用画面(authMode="recover")を表示する — セッション
          // 自体はそのまま維持し、そのセッションでsupabase.auth.updateUser({password})を
          // 呼べるようにする(handleSetNewPassword参照)。
          setCurrentUser(null);
          setCurrentRole("staff");
          setAuthMode("recover");
          setAppState(initialAppStateValue);
          setAuthLoading(false);
          return;
        }
        if (hasInviteIntent && session?.user) {
          // Clicking a real invitation email link auto-establishes a Supabase session (Supabase
          // verifies the invite token at its own /auth/v1/verify endpoint before redirecting
          // here, and the JS client's detectSessionInUrl picks that session up automatically on
          // load) — before this invitee has set a password. Same thing can happen if someone
          // already logged in as a different account opens someone else's invite link. Either
          // way, signing out here forces the "no session" branch below, so the invitee always
          // goes through the normal signup/password-set screen (handleSignUp -> accept-invite)
          // instead of being silently dropped into a password-less session or someone else's.
          await signOutFromSupabase();
          setCurrentUser(null);
          setCurrentRole("staff");
          setAuthMode("signup");
          setActivePage("dashboard");
          setAppState(initialAppStateValue);
          setSyncStatus({ status: "idle", message: "同期待機中", timestamp: "", error: false });
          setAuthLoading(false);
          return;
        }
        if (session?.user) {
          // プロフィール/テナント情報の取得(複数回のSupabase往復)はloadProfileAndEnterApp
          // 側で内部的にリトライし、それでも失敗した場合もこのtry/catchの外側(=ここより下の
          // 「セッション無し」判定やauthMode("login")falling back)へは絶対に落とさない
          // ——有効なセッションが確認できている以上、ログイン画面へ戻す理由が無いため。
          await loadProfileAndEnterApp(session);
          return;
        }

        authLog("redirect理由: 有効なセッションが確認できなかった(未ログイン)");
        setCurrentUser(null);
        setCurrentRole("staff");
        setAuthMode(fallbackAuthMode());
        setActivePage("dashboard");
        setAppState(initialAppStateValue);
      } catch (error) {
        authLog("redirect理由: session取得自体が失敗(getSupabaseSession/exchangeCodeForSession等)", error?.message);
        setCurrentUser(null);
        setCurrentRole("staff");
        setAuthMode(fallbackAuthMode());
        setActivePage("dashboard");
        setAuthError(getLocalizedSupabaseErrorMessage(error));
      } finally {
        setAuthLoading(false);
      }
    };

    void initializeAuth();
  }, []);

  // 招待リンクを開いた直後に、フォーム送信を待たずget_invite_infoで先に検証しておく。
  // 1) メールアドレスをフォームへ事前入力・固定できる(招待メールアドレスと違うメール
  //    アドレスを打ち込んでしまう事故を防ぐ)。
  // 2) 無効・期限切れの招待リンクを、白画面や「何も起きない」状態にせず、開いた瞬間に
  //    分かりやすいエラーとして表示できる(要件14)。
  // handleSignUp側でも同じ検証を(実際の登録直前の最終防御として)重ねて行っており、ここでの
  // 事前チェックはあくまでUX向上のためのもので、実際の認可はサーバー側(get_invite_info /
  // accept-invite)がそのつど行う。
  useEffect(() => {
    if (!inviteToken || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const inviteInfo = await getInviteInfo(inviteToken);
        if (cancelled) return;
        if (!inviteInfo) {
          setAuthError("招待リンクが無効です。管理者に再招待を依頼してください。");
          return;
        }
        if (!inviteInfo.is_active || inviteInfo.invitation_status === "suspended" || inviteInfo.invitation_status === "disabled") {
          setAuthError("この招待は無効です。管理者にお問い合わせください。");
          return;
        }
        if (isInviteExpired(inviteInfo.invite_expires_at)) {
          setAuthError("この招待リンクは期限切れです。管理者に再招待を依頼してください。");
          return;
        }
        setInviteEmail(String(inviteInfo.email || "").trim().toLowerCase());
      } catch (error) {
        if (!cancelled) setAuthError(getLocalizedSupabaseErrorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  // 新規オーナー・セルフサインアップの一般公開状態を、未ログインの段階で一度だけ取得する
  // (要件11: フロントの表示制御にも使うが、実際の許可判定はself-signup Edge Function側)。
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      const enabled = await isSelfSignupEnabled();
      if (!cancelled) setSelfSignupEnabled(enabled);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // AI広告自動運用システム(V1、要件6・7)。広告リンク(utm_source付き)経由でオーナー登録
  // 画面へ到達した最初の瞬間だけ、1回だけsignup_startedを記録する(要件11の二重イベント
  // 防止: authModeがownerSignupのまま再レンダリングされても再送しないようrefで一度きりに
  // する)。ベストエフォート——失敗してもサインアップ画面自体には一切影響させない。
  const ownerSignupStartedLoggedRef = useRef(false);
  useEffect(() => {
    if (authMode !== "ownerSignup" || !ownerSignupUtm.utmSource) return;
    if (ownerSignupStartedLoggedRef.current) return;
    ownerSignupStartedLoggedRef.current = true;
    logAdConversionEvent({
      eventType: "signup_started",
      sessionId: adSessionId,
      utmSource: ownerSignupUtm.utmSource,
      utmCampaign: ownerSignupUtm.utmCampaign,
      utmContent: ownerSignupUtm.utmContent,
    });
  }, [authMode, ownerSignupUtm, adSessionId]);

  useEffect(() => {
    if (currentCompany) {
      setCompanySettingsForm(currentCompany.settings || createCompanySettingsDefaults());
    }
  }, [currentCompany?.id, currentCompany?.settings]);

  useEffect(() => {
    setTaxSettingsForm({
      considerConsumptionTax: Boolean(appState.taxSettings?.considerConsumptionTax),
      // 引当率が未設定(未保存=0/空)の間は、日本の標準消費税率に合わせた10%を初期値として
      // 表示する(保存済みの値があればそちらを優先し、上書きしない)。
      consumptionTaxReserveRate: appState.taxSettings?.consumptionTaxReserveRate || 10,
    });
  }, [appState.taxSettings?.considerConsumptionTax, appState.taxSettings?.consumptionTaxReserveRate]);

  useEffect(() => {
    if (selectedStoreEntity) {
      setStoreSettingsForm(selectedStoreEntity.settings || createStoreSettingsDefaults());
    }
  }, [selectedStoreEntity]);

  // 「店舗基本設定」(初期設定「店舗情報」の重複整理、要件2)は常に「現在選択中の店舗」を
  // 対象にする——店舗一覧から個別に「編集」を押さなくても、店舗管理画面を開くだけで
  // ヘッダーで選択中の店舗の設定がそのまま表示される(「現在の店舗：〇〇店」)。店舗を
  // 切り替えた時「だけ」下書きを作り直す——selectedStoreEntity自体は他の保存操作のたびに
  // 新しいオブジェクト参照になる(appStateが少しでも変わるたびcurrentCompanyStoresが
  // 再生成されるため)ため、依存配列にオブジェクトそのものを使うと、無関係な自動保存の
  // たびに入力中のスタッフ数等が上書きされてしまう(MonthlyReviewPageのcontextKeyと同じ
  // 理由の対策)。selectedStoreEntity?.id という値だけを見ることでこれを避ける。
  const selectedStoreIdForBasicSettings = selectedStoreEntity?.id || "";
  useEffect(() => {
    if (!selectedStoreEntity) {
      setStoreEditId("");
      return;
    }
    setStoreEditId(selectedStoreEntity.id);
    setStoreForm({
      ...createStoreFormDefaults(),
      name: selectedStoreEntity.name || "",
      staffCount: selectedStoreEntity.staffCount ? String(selectedStoreEntity.staffCount) : "",
      productivityStaffCount: selectedStoreEntity.productivityStaffCount ? String(selectedStoreEntity.productivityStaffCount) : "",
    });
    setStoreFormStatus({ status: "idle", message: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreIdForBasicSettings]);

  // 費用入力フォームが新規追加(未編集)状態のとき、開始月を対象月に追従させる。編集中
  // (fixedForm.idがある)場合はその項目自体の開始月を上書きしないよう手を出さない。
  useEffect(() => {
    setFixedForm((prev) => (prev.id ? prev : { ...prev, startMonth: selectedMonth }));
  }, [selectedMonth]);

  // 加盟店連携リクエスト一覧の読み込み。company_partnershipsはhydrateFromSupabaseの対象外
  // (companies等とは別の独立したテーブル)なので、ログイン確立後に個別に取得する。
  // RLS(company_partnerships_select)により、system_adminは全件、それ以外は自社がparent/
  // partnerどちらかの行だけが返るため、クライアント側での追加フィルタは不要。
  const refreshCompanyPartnerships = async () => {
    const result = await loadCompanyPartnerships();
    if (result.ok) {
      setCompanyPartnerships(result.data || []);
    }
  };

  useEffect(() => {
    if (authMode !== "app" || !isSupabaseConfigured || !currentUser?.authUserId) return;
    void refreshCompanyPartnerships();
  }, [authMode, currentUser?.authUserId, appState.currentCompanyId]);

  // 加盟店閲覧中でも常に「自社の本当のcompany_id」を指す(閲覧中はcurrentCompanyIdが
  // 加盟店側を指しているため、そのままでは通知バナー・受信リクエスト一覧の対象を
  // 見失う)。
  const myCompanyId = appState.isViewingFranchise ? appState.homeCompanyIdBeforeFranchiseView : appState.currentCompanyId;
  const normalizedCurrentRoleForFranchise = normalizeRole(currentRole);
  const incomingPendingFranchiseRequests = useMemo(
    () => companyPartnerships.filter((row) => row.status === "pending" && (normalizedCurrentRoleForFranchise === "system_admin" || row.partner_company_id === myCompanyId)),
    [companyPartnerships, myCompanyId, normalizedCurrentRoleForFranchise]
  );
  const approvedFranchisePartnerships = useMemo(
    () => companyPartnerships.filter((row) => row.status === "approved" && (normalizedCurrentRoleForFranchise === "system_admin" || row.parent_company_id === myCompanyId)),
    [companyPartnerships, myCompanyId, normalizedCurrentRoleForFranchise]
  );
  // 送信済み・承認待ち(自社がparent側)の一覧。相手が未対応なだけで、こちらからは
  // まだ何も操作できない(承認/拒否は相手側のみ)ため、情報表示のみ。
  const outgoingPendingFranchiseRequests = useMemo(
    () => companyPartnerships.filter((row) => row.status === "pending" && row.parent_company_id === myCompanyId),
    [companyPartnerships, myCompanyId]
  );
  // 店舗切替一覧の「加盟店」欄用: 自社(本社)がparentの承認済み連携だけ。会社単位で1行だけ
  // 表示する(個別店舗までは列挙しない)ため、companyPartnerships+appState.companiesの
  // 会社名だけで組み立てられる — 個別店舗を取得する追加フェッチは不要。
  // 権限: この一覧・加盟店への切り替え自体をcanManageFranchisePartnerships(system_admin/
  // company_adminのみ)でゲートする — store_manager/staffは自社に承認済み連携があっても
  // 加盟店セクションが一切見えない(要件10)。
  const canSeeFranchiseSection = canManageFranchisePartnerships(currentRole);
  const viewableFranchisePartnerCompanies = useMemo(() => {
    if (!canSeeFranchiseSection) return [];
    const baseCompanyId = appState.isViewingFranchise ? appState.homeCompanyIdBeforeFranchiseView : appState.currentCompanyId;
    return companyPartnerships
      .filter((row) => row.status === "approved" && row.parent_company_id === baseCompanyId)
      .map((row) => {
        const company = (appState.companies || []).find((item) => item.id === row.partner_company_id);
        return { relationshipId: row.id, companyId: row.partner_company_id, companyName: company?.name || "（読み込み中）" };
      });
  }, [canSeeFranchiseSection, companyPartnerships, appState.companies, appState.isViewingFranchise, appState.homeCompanyIdBeforeFranchiseView, appState.currentCompanyId]);

  // 店舗プルダウンに「INTRO」のような会社名を最初から表示するための先読み。company_adminの
  // appState.companiesはログイン時点では自社1件しか入っておらず、加盟店の会社名は
  // handleFranchiseViewで実際に開くまで取得されない — 何もしないと、一度も開いていない
  // 加盟店は選ぶまで「（読み込み中）」のまま表示されてしまう。承認済み連携のcompanyIdで
  // まだappState.companiesに無いものだけを軽量に取得してマージする(currentCompanyId/
  // isViewingFranchiseには一切触れない — 表示名を補うだけの読み取り専用の先読み)。
  useEffect(() => {
    const missingCompanyIds = viewableFranchisePartnerCompanies
      .map((item) => item.companyId)
      .filter((companyId) => !(appState.companies || []).some((company) => company.id === companyId));
    if (!missingCompanyIds.length) return;
    let cancelled = false;
    void Promise.all(missingCompanyIds.map((companyId) => loadFranchiseCompanyMetadata({ companyId }))).then((results) => {
      if (cancelled) return;
      const fetchedCompanies = results.filter((result) => result.ok).map((result) => result.company);
      if (!fetchedCompanies.length) return;
      setAppState((prev) => ({
        ...prev,
        companies: [
          ...(prev.companies || []),
          ...fetchedCompanies.filter((company) => !(prev.companies || []).some((existing) => existing.id === company.id)),
        ],
      }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewableFranchisePartnerCompanies]);

  // 店舗プルダウンで加盟店を「店舗単位」で選べるようにする展開版(加盟店選択時の全店舗
  // ビュー誤判定の修正)。以前は会社単位で1行だけ表示し、選ぶと必ずその加盟店の
  // 「全店舗」ビュー(ALL_STORES_VALUE)を開いていたが、損益表・月締め・費用入力・
  // 日次入力など単一店舗を前提にしたページが軒並み「全店舗ビューでは利用できません」で
  // 弾いてしまっていた。isAllStoresViewはselectedStore === ALL_STORES_VALUEという単一の
  // 判定式(このファイル内で1箇所)から導かれるため、加盟店を開いた時点でselectedStoreに
  // 必ず実際の店舗名を入れてしまえば、ページ側を個別に直さなくても全ページが自動的に
  // 「通常の店舗ビュー」として扱われる(要件: 画面ごとの個別修正ではなく共通判定の修正)。
  // 各加盟店のstores(loadFranchiseCompanyMetadataで先読み済み、上のuseEffect参照)を
  // 展開して1店舗1行にする。
  const viewableFranchisePartnerStores = useMemo(() => {
    return viewableFranchisePartnerCompanies.flatMap((item) => {
      const company = (appState.companies || []).find((c) => c.id === item.companyId);
      const stores = (company?.stores || []).filter((store) => store.status !== "archived");
      return stores.map((store) => ({ ...item, storeId: store.id, storeName: store.name }));
    });
  }, [viewableFranchisePartnerCompanies, appState.companies]);

  // ログインユーザー本来の所属会社(本社)の店舗一覧。isViewingFranchise中でもcurrentCompanyId
  // ではなくmyCompanyIdを常に参照する — currentCompanyStores/visibleStoresは「今表示中の
  // 会社」の店舗一覧なので、加盟店を閲覧中はそちらが加盟店の店舗にすり替わってしまい、
  // 店舗プルダウンの「自社」欄まで加盟店の店舗一覧に置き換わってしまう(=本社へ戻る手段が
  // 無くなる)。店舗プルダウンの「自社」欄だけは、常にこのhomeCompanyStoresを参照する。
  const homeCompanyEntity = useMemo(() => (appState.companies || []).find((company) => company.id === myCompanyId) || null, [appState.companies, myCompanyId]);
  const homeCompanyStores = useMemo(() => (homeCompanyEntity?.stores || []).filter((store) => store.status !== "archived"), [homeCompanyEntity]);
  // 通常時(加盟店を閲覧していない間)はvisibleStores(権限フィルタ込み、既存の挙動)を
  // そのまま使う — store_manager/staffの「自分の担当店舗だけ表示」という既存の絞り込みを
  // 崩さないため。加盟店を閲覧中(=会社管理者/システム管理者のみ到達しうる状態)だけ、
  // 上のhomeCompanyStoresに切り替える。
  const homeStoresForDropdown = appState.isViewingFranchise ? homeCompanyStores : visibleStores;

  // 店舗切替一覧の統合ハンドラ。value形式: 自社店舗は既存通り店舗名そのまま、加盟店は
  // "__franchise__:companyId:storeId"というマーカー付き値にする(店舗単位 — 自社店舗選択
  // と同じ「1店舗を選んでいる状態」として扱い、全店舗ビューにはしない)。
  const handleUnifiedStoreSwitch = async (value) => {
    if (value.startsWith("__franchise__:")) {
      const [franchiseCompanyId, franchiseStoreId] = value.slice("__franchise__:".length).split(":");
      await handleFranchiseView(franchiseCompanyId, franchiseStoreId);
      return;
    }
    if (appState.isViewingFranchise) {
      // 加盟店閲覧中に自社(全店舗/自社の各店舗)を選んだ場合。handleStoreSwitchは
      // currentCompanyStores(=今は加盟店の店舗一覧)を見て店舗名からidを解決するため、
      // そのまま呼ぶと「戻った直後の店舗切替」が加盟店側の古い店舗一覧を参照してしまう
      // 競合が起きる。homeCompanyStores(閲覧状態に左右されない参照)から先にidを解決し、
      // handleReturnToHomeCompanyへ渡すことでこれを避ける。
      const targetStore = value === ALL_STORES_VALUE ? null : homeCompanyStores.find((store) => store.name === value);
      await handleReturnToHomeCompany(targetStore?.id);
      return;
    }
    handleStoreSwitch(value);
  };

  // 「加盟店追加」モーダルの候補一覧。system_adminはappState.companiesに全社が既に
  // ロード済み(loadTenantStateFromSupabaseのcompanyFilter=null)なので追加フェッチ不要。
  // 自社自身と、既にpending/approvedの相手は候補から除外する(要件8の重複防止)。
  const franchiseCandidateCompanies = useMemo(() => {
    const query = franchiseRequestSearch.trim().toLowerCase();
    if (!query) return [];
    const excludedIds = new Set([
      appState.currentCompanyId,
      ...companyPartnerships.filter((row) => row.parent_company_id === appState.currentCompanyId && (row.status === "pending" || row.status === "approved")).map((row) => row.partner_company_id),
    ]);
    return (appState.companies || [])
      .filter((company) => !company.deletedAt && !excludedIds.has(company.id))
      .filter((company) => company.name?.toLowerCase().includes(query) || company.code?.toLowerCase().includes(query))
      .slice(0, 20);
  }, [franchiseRequestSearch, appState.companies, appState.currentCompanyId, companyPartnerships]);

  const handleSubmitFranchiseRequest = async () => {
    if (!franchiseRequestTargetId) return;
    setFranchiseRequestStatus({ status: "saving", message: "" });
    const result = await createFranchiseRequest({ parentCompanyId: appState.currentCompanyId, partnerCompanyId: franchiseRequestTargetId });
    if (!result.ok) {
      setFranchiseRequestStatus({ status: "error", message: getSupabaseErrorMessage(result.error) });
      return;
    }
    setFranchiseRequestStatus({ status: "idle", message: "" });
    setShowFranchiseRequestModal(false);
    setFranchiseRequestSearch("");
    setFranchiseRequestTargetId("");
    await refreshCompanyPartnerships();
    setNotice("加盟店連携リクエストを送信しました");
  };

  const handleRespondFranchiseRelationship = async (relationshipId, action) => {
    setFranchiseActionBusyId(relationshipId);
    try {
      const relationship = companyPartnerships.find((row) => row.id === relationshipId);
      const result = await updateFranchiseRelationship({ relationshipId, action });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return;
      }
      await refreshCompanyPartnerships();
      if (franchiseDetailRelationshipId === relationshipId) setFranchiseDetailRelationshipId("");
      // 解除した加盟店を今まさに表示中だった場合、店舗切替一覧から消えるのを待たず即座に
      // 自社へ戻す(「解除後はそれ以降親会社から加盟店データを閲覧できない」を、表示中の
      // セッションにも即時反映するため)。
      if (action === "disconnect" && appState.isViewingFranchise && relationship?.partner_company_id === appState.currentCompanyId) {
        await handleReturnToHomeCompany();
      }
    } finally {
      setFranchiseActionBusyId("");
    }
  };

  useEffect(() => {
    // 別の店舗に切り替えるたびに読み込み直す。保存していない変更は切り替え時に破棄される
    // (この設定は数個のスイッチのみなので、対象月切り替えのような確認ダイアログは設けていない)。
    setDailyFieldDraft(normalizeDailyFieldSettings(selectedStoreEntity?.settings?.dailyFieldSettings));
    setDailyFieldDirty(false);
    setMonthlyTargetFieldDraft(normalizeMonthlyTargetFieldSettings(selectedStoreEntity?.settings?.monthlyTargetFields));
    setMonthlyTargetFieldDirty(false);
    setMonthlyTargetFieldSaveStatus({ status: "idle", message: "" });
    setCashBreakdownDraft(Boolean(selectedStoreEntity?.settings?.useCashBreakdown));
    setCashBreakdownDirty(false);
    setInventoryTrackingDraft(Boolean(selectedStoreEntity?.settings?.useInventoryTracking));
    setInventoryTrackingDirty(false);
    setInputSettingsSaveStatus({ status: "idle", message: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore]);

  // 管理画面の「基本設定」タブを開いたら店舗名欄へフォーカスする(旧・店舗設定画面の
  // openStore内フォーカス処理を、統合後のタブ切替に合わせて移設)。
  useEffect(() => {
    if (activePage === "monthly" && activeMonthlyTab === "basic") {
      storeFormNameInputRef?.current?.focus();
    }
  }, [activePage, activeMonthlyTab]);
  const setupProgress = useMemo(() => getCompanySetupProgress(currentCompany), [currentCompany]);
  // Only ever reachable in local/demo mode (isSupabaseConfigured === false): every company
  // fetched from Supabase (see normalizedCompanies in supabase.js) has setup.complete hardcoded
  // to true, since there's no per-step "is this company fully onboarded" concept once companies/
  // stores/store_input_settings/company_settings are all real tables — a company either exists
  // or it doesn't. Not dead code — it's the non-Supabase demo mode's own onboarding flow — just
  // never triggered once Supabase is configured.
  const showInitialSetup = Boolean(currentCompany && !currentCompany.setup?.complete && isAdminUser);
  // 会社作成→招待→company_adminの初回ログイン、という正式フローの「最初の店舗登録」
  // ゲート。上のshowInitialSetupは(コメントの通り)setup.completeがSupabase接続時は常に
  // trueに固定されるため本番では実質デッドコードで、店舗0件のまま通常画面へ入れてしまう
  // 抜け道になっていた(INTRO社の実例)。判定はフラグではなく「対象company_idに現に
  // 有効な店舗が存在するか」の一点にする — company_adminが誰であっても(後から追加された
  // 2人目以降でも)、店舗が1件も無い間は必ずこの画面になり、1件でも作られれば以後二度と
  // 出ない。加盟店閲覧中(isViewingFranchise)は対象外 — 加盟店側の店舗0件は別ロジック
  // (handleFranchiseView)で既に安全に処理済みで、こことは無関係。system_adminは対象外の
  // ままにする — 会社を作った直後にユーザー招待画面へ自由に移動できる必要があるため
  // (要件の正式フローの4番: 招待はsystem_adminが行う)。
  const needsFirstStoreSetup = Boolean(currentCompany) && !appState.isViewingFranchise && normalizeRole(currentRole) === "company_admin" && currentCompanyStores.length === 0;
  // 全店舗ビューではtarget/summary/businessDaySummaryを会社全体の集計版に差し替える。
  // ここを分岐させるだけで、これらを参照しているダッシュボードのKPI・営業進捗・AI相談等
  // (customerTargetSummary/dashboardSupportMetrics/AiChatScreen含む)は追加の変更なしに
  // 全店舗の数値を正しく表示する。日次入力・費用入力・月締め・損益表は店舗ごとの機能のまま
  // (全店舗では別途non-store案内を表示、後述)なので、dailyEntries/fixedCostsは
  // 分岐させない(全店舗選択時はどのみち空/未使用になる)。
  const target = isAllStoresView
    ? getAllStoresTargetForCompanyMonth(appState, appState.currentCompanyId, selectedMonth)
    : getTargetForStoreMonth(appState, selectedStoreId, selectedMonth);
  const dailyEntries = useMemo(() => getDailyResultsForStoreMonth(appState, selectedStoreId, selectedMonth), [appState, selectedStoreId, selectedMonth]);
  // まとめて入力の一覧(この店舗・この対象月分)。dailyEntriesとは別配列 — 日別データへは
  // 一切混ぜない(要件3)。
  const batchEntries = useMemo(() => getBatchEntriesForStoreMonth(appState, selectedStoreId, selectedMonth), [appState, selectedStoreId, selectedMonth]);
  // まとめて入力の期間合計を、店休日・既存の実日次入力を踏まえて日別に動的配分した結果
  // (DBには保存しない、その都度の計算 — storage.jsのgetBatchAllocatedEntries参照)。
  // カレンダーの緑表示・営業進捗・日次入力画面の閲覧専用表示、この3箇所で共通して使う。
  const batchAllocatedEntries = useMemo(() => getBatchAllocatedEntries(appState, selectedStoreId, selectedMonth), [appState, selectedStoreId, selectedMonth]);
  // 現在選択中の日付がまとめて入力で埋まっているかどうか(要件3: 日次入力からは編集不可・
  // 閲覧のみにする対象日の判定)。
  const dailyDateBatchAllocation = useMemo(
    () => (dailyForm.date ? batchAllocatedEntries.find((entry) => entry.date === dailyForm.date) || null : null),
    [batchAllocatedEntries, dailyForm.date]
  );
  const isDailyDateBatchLocked = Boolean(dailyDateBatchAllocation);
  // 【緊急障害の直接原因(修正済み)】以前この付近の派生値がisDailyDateBatchLockedより前の行に
  // 置かれ、constの初期化前参照(TDZ)でReferenceErrorになっていた。isDailyDateBatchLocked
  // の初期化後であるこの位置に置く(判定式自体の変更ではない)。
  //
  // 過去日編集の状態管理整理(根本修正): 「編集」ボタンを表示するかどうか(canShowEditButton)
  // と、入力欄を実際に編集可能にするかどうか(canEditDailyEntry)を、別々の式ではなく
  // resolveDailyEntryEditState という1つの純粋関数(storage.js、単体テスト済み)から同時に
  // 導出する。両者が同じロック理由(まとめて入力ロック・staffの日締め済みロック・staffの
  // 過去/未来日ロック)を共有するため、原理的に「ボタンは押せるのに入力欄はロックされたまま」
  // という状態を作れない構造にする——これが「編集ボタン表示条件とinputの編集条件を完全に
  // 共通化する」という要求そのものへの対応。
  const { canShowEditButton: canEditSelectedDailyEntry, canEditDailyEntry, isLocked: isDailyEntryLocked, canToggleClosing } = resolveDailyEntryEditState({
    dailyMode,
    hasEntryId: Boolean(dailyForm.id),
    isDailyFormDateHoliday,
    isDailyDateBatchLocked,
    isDailyEntryLockedForStaff,
    isStaffPastOrFutureDateLocked,
  });
  const fixedCosts = useMemo(() => getFixedCostsForStoreMonth(appState, selectedStoreId, selectedMonth), [appState, selectedStoreId, selectedMonth]);
  const useInventoryTracking = Boolean(selectedStoreEntity?.settings?.useInventoryTracking);
  // 日計管理(要件2: 任意機能、初期値OFF)。OFFの店舗では日次入力画面に日計カード自体を
  // 一切描画しない(余白も残さない)。
  const useCashBreakdown = Boolean(selectedStoreEntity?.settings?.useCashBreakdown);
  const summary = useMemo(
    () => (isAllStoresView
      ? calculateAllStoresMonthSummary(appState, currentCompany, selectedMonth)
      : calculateMonthSummary(appState, selectedStoreId, selectedMonth, {
          useInventoryTracking,
          hiddenCategories: selectedStoreEntity?.settings?.hiddenClosingCategories || [],
          laborCostMode: selectedStoreEntity?.settings?.laborCostMode,
          laborCostRate: selectedStoreEntity?.settings?.laborCostRate,
          purchaseCostMode: selectedStoreEntity?.settings?.purchaseCostMode,
          purchaseCostRate: selectedStoreEntity?.settings?.purchaseCostRate,
        })),
    [appState, currentCompany, isAllStoresView, selectedStoreId, selectedMonth, useInventoryTracking, selectedStoreEntity]
  );
  const businessDaySummary = useMemo(
    () => (isAllStoresView
      ? getAllStoresBusinessDaySummary(appState, appState.currentCompanyId, currentCompanyStores, selectedMonth)
      : getBusinessDaySummary(appState, selectedStoreId, selectedMonth)),
    [appState, currentCompanyStores, isAllStoresView, selectedStoreId, selectedMonth]
  );
  // 月次レビュー(利益管理ではない、店舗・会社全体で共有するための数字サマリー+自由記述)。
  // 数字はgetMonthlyReviewSummary(既存のcalculateMonthSummary/calculateAllStoresMonthSummaryを
  // そのまま再利用、重複計算ロジックを作らない)、対象は「今表示中の店舗/全店舗ビュー」——
  // このページ専用の別の店舗選択UIは持たず、ヘッダーの既存の店舗切替とそのまま連動する
  // (要件16: 同じコンポーネント・取得処理を使う)。
  // パフォーマンス改善(要件8: 表示していないページのために重い計算をしない): 月次レビュー
  // ページ(activePage==="monthlyReview")を開いている時だけ実際に計算する。以前はappStateが
  // 変わるたびに(=売上ページを見ているだけの間も含め、ほぼ毎レンダー)calculateMonthSummary/
  // calculateAllStoresMonthSummaryをcurrent・previous分(全店舗ビューでは店舗数×2)呼んで
  // おり、月次レビューを一度も開いていないセッションでも無駄にCPUを消費していた。
  const monthlyReviewSummary = useMemo(
    () => (activePage !== "monthlyReview" ? null : getMonthlyReviewSummary(appState, {
      storeId: selectedStoreId,
      isAllStoresView,
      company: currentCompany,
      storeEntity: selectedStoreEntity,
      companyStores: currentCompanyStores,
    }, selectedMonth)),
    [activePage, appState, selectedStoreId, isAllStoresView, currentCompany, selectedStoreEntity, currentCompanyStores, selectedMonth]
  );
  const monthlyReviewKeyStoreId = isAllStoresView ? "" : selectedStoreId;
  const monthlyReviewText = useMemo(
    () => getMonthlyReviewText(appState, { companyId: appState.currentCompanyId, storeId: monthlyReviewKeyStoreId }, selectedMonth),
    [appState, monthlyReviewKeyStoreId, selectedMonth]
  );
  const [monthlyReviewSaveStatus, setMonthlyReviewSaveStatus] = useState({ status: "idle", message: "" });
  const monthlyReviewSaveTimerRef = useRef(null);
  // 権限判定の二重実装を解消(総合品質チェックで発見した問題E): 以前はコンポーネント内で
  // もっと後ろに定義されるisFranchiseReadOnlyForCurrentUser(const、TDZの対象)を呼べず、
  // 判定式そのものをここへ手書きで複製していた(【緊急障害の直接原因】として過去に修正した
  // TDZクラッシュの再発防止コメントが残っていた箇所)。isFranchiseReadOnly(isViewingFranchise,
  // role)をpermissions.js側の純粋関数として切り出し、モジュールレベルでimportする形に
  // したことで、コンポーネント内のconst宣言順序(TDZ)に一切依存しなくなった——
  // isFranchiseReadOnlyForCurrentUser(下記)もこの同じ関数を呼ぶだけになり、判定が
  // 将来ズレる余地が構造的に無くなっている。
  const canEditMonthlyReview = canEditMonthlyData(currentRole) && !isFranchiseReadOnly(appState.isViewingFranchise, currentRole);
  // 保存直後にDBが実際に保存した値でappStateを更新する(「送ったつもりの値」で信じない、
  // 直近の保存/削除/停止/招待の各修正と同じ方針)。company_id・store_id・target_monthの
  // 3つで一意に定まるため、店舗Aと店舗B、全店舗ビューのレビューが混ざることは無い(要件6)。
  const performMonthlyReviewSave = async (companyId, storeId, targetMonth, fields) => {
    setMonthlyReviewSaveStatus({ status: "saving", message: "保存中…" });
    try {
      if (isSupabaseConfigured) {
        const result = await upsertMonthlyReview({ companyId, storeId, targetMonth, userId: appState.currentUserId, fields });
        if (!result.ok) throw result.error || new Error("保存に失敗しました");
        const confirmedRow = result.data;
        const key = buildMonthlyReviewKey(companyId, storeId, targetMonth);
        setAppState((prev) => ({
          ...prev,
          monthlyReviews: {
            ...prev.monthlyReviews,
            [key]: confirmedRow
              ? monthlyReviewRowToEntry(confirmedRow)
              : { reflection: fields.reflection, challenges: fields.challenges, improvements: fields.improvements, next_actions: fields.next_actions, updatedAt: new Date().toISOString() },
          },
        }));
      } else {
        const key = buildMonthlyReviewKey(companyId, storeId, targetMonth);
        setAppState((prev) => ({
          ...prev,
          monthlyReviews: { ...prev.monthlyReviews, [key]: { reflection: fields.reflection, challenges: fields.challenges, improvements: fields.improvements, next_actions: fields.next_actions, updatedAt: new Date().toISOString() } },
        }));
      }
      setMonthlyReviewSaveStatus({ status: "saved", message: "保存済み" });
    } catch (error) {
      setMonthlyReviewSaveStatus({ status: "error", message: `保存に失敗しました: ${getSupabaseErrorMessage(error)}` });
    }
  };
  // debounce付き自動保存(要件7) — 入力のたびにDBへ大量リクエストしないよう400ms(既存の
  // 日次入力自動保存と同じ間隔)待ってから送信する。
  const saveMonthlyReviewFields = (fields) => {
    if (guardFranchiseReadOnly()) return;
    if (!canEditMonthlyReview) return;
    if (monthlyReviewSaveTimerRef.current) window.clearTimeout(monthlyReviewSaveTimerRef.current);
    const companyId = appState.currentCompanyId;
    const storeId = monthlyReviewKeyStoreId;
    const targetMonth = selectedMonth;
    monthlyReviewSaveTimerRef.current = window.setTimeout(() => {
      monthlyReviewSaveTimerRef.current = null;
      void performMonthlyReviewSave(companyId, storeId, targetMonth, fields);
    }, 400);
  };
  // 入力欄からフォーカスが外れた瞬間(=画面遷移・タブ切替・他要素クリック等の直前に必ず
  // 起こる)に、debounceを待たず即座に保存する(要件7: 「画面遷移や再読み込みで文章が
  // 消えないように」の直接の対応)。保留中のdebounceタイマーがあれば止めて、代わりにこちらを
  // 即実行することで、同じ内容を二重送信しない。
  const flushMonthlyReviewSave = (fields) => {
    if (guardFranchiseReadOnly()) return;
    if (!canEditMonthlyReview) return;
    if (monthlyReviewSaveTimerRef.current) {
      window.clearTimeout(monthlyReviewSaveTimerRef.current);
      monthlyReviewSaveTimerRef.current = null;
    }
    void performMonthlyReviewSave(appState.currentCompanyId, monthlyReviewKeyStoreId, selectedMonth, fields);
  };

  // スマホUI改善(要件7): 店舗売上ランキングをスマホ幅だけTOP3に折りたたむ表示状態。
  // ランキング自体の計算・順位・同額判定・先月売上は一切変更せず(rankingRowsをそのまま
  // 描画する)、4位以降をCSSで隠すかどうかだけを切り替える。CSS側は≤900pxのメディアクエリ
  // 内でだけ4位以降を隠すため、PCでは常に全店舗表示のまま(このstateの値に関係なく)。
  // 店舗・対象月を切り替えたら毎回TOP3表示へ戻す(前の店舗で展開していた状態を持ち越さない)。
  const [rankingExpanded, setRankingExpanded] = useState(false);
  useEffect(() => {
    setRankingExpanded(false);
  }, [selectedStoreId, selectedMonth]);
  // 全店舗 月カレンダーで「まだ緑になっていない営業日」をクリックすると、どの店舗が未締めか
  // 表示するポップオーバー(要件13)。{dateIso, anchorEl}か、閉じている間はnull。
  const [unclosedStoresPopover, setUnclosedStoresPopover] = useState(null);
  const unclosedStoresPopoverInfo = useMemo(
    () => (unclosedStoresPopover
      ? getUnclosedStoresForDate(appState, appState.currentCompanyId, currentCompanyStores, selectedMonth, unclosedStoresPopover.dateIso)
      : null),
    [appState, currentCompanyStores, selectedMonth, unclosedStoresPopover]
  );
  const handleAllStoresCalendarDayClick = (dateIso, event) => {
    const isHoliday = (businessDaySummary.holidayDates || []).includes(dateIso);
    const isClosed = (businessDaySummary.closedDates || []).includes(dateIso);
    // 緑(締め済み)・赤(全店舗店休日)の日は「未締め店舗」という概念自体が無いため開かない
    // (要件13は「営業日なのにまだ緑になっていない日」が対象)。
    if (isHoliday || isClosed) {
      setUnclosedStoresPopover(null);
      return;
    }
    const anchorEl = event?.currentTarget || null;
    setUnclosedStoresPopover((prev) => (prev && prev.dateIso === dateIso ? null : { dateIso, anchorEl }));
  };
  // 対象月切替・全店舗ビューからの離脱時は開いたままにしない(要件10: 別の月/画面の情報が
  // 前の月のdateIso・anchorElのまま表示され続ける食い違いを防ぐ)。
  useEffect(() => {
    setUnclosedStoresPopover(null);
  }, [selectedMonth, isAllStoresView]);
  const customerTargetSummary = useMemo(() => getCustomerTargetSummary({ customers: summary.customers, targetCustomers: summary.customerTarget, businessDayCount: summary.businessDays, completedDays: summary.completedDays, remainingBusinessDays: summary.remainingBusinessDays, targetAverageCustomersPerDay: parseNumber(target.targetAverageCustomersPerDay) }), [summary.businessDays, summary.completedDays, summary.customerTarget, summary.customers, summary.remainingBusinessDays, target.targetAverageCustomersPerDay]);
  // 損益表・費用入力を使っていない店舗でも使える独立指標。店舗単位の設定値(生産性計算人数)
  // を使うだけで、月間目標や費用データの有無とは無関係に成立する。
  const staffProductivitySummary = useMemo(() => getStaffProductivitySummary({
    sales: summary.sales,
    forecast: summary.displayForecast,
    staffCount: selectedStoreEntity?.staffCount,
    productivityStaffCount: selectedStoreEntity?.productivityStaffCount,
  }), [summary.sales, summary.displayForecast, selectedStoreEntity]);
  const businessDaySettings = useMemo(() => getBusinessDaySettings(appState, selectedStoreId, selectedMonth), [appState, selectedStoreId, selectedMonth]);
  const monthClosingStatus = useMemo(() => {
    const key = buildMonthKey(selectedStoreId, selectedMonth);
    return appState.monthClosingStatus?.[key] || { closed: false, lockedAt: "", note: "" };
  }, [appState.monthClosingStatus, selectedStoreId, selectedMonth]);
  const monthClosingChecklist = useMemo(
    () => getMonthClosingChecklist(appState, selectedStoreId, selectedMonth, {
      useInventoryTracking,
      hiddenCategories: selectedStoreEntity?.settings?.hiddenClosingCategories || [],
      laborCostMode: selectedStoreEntity?.settings?.laborCostMode,
      laborCostRate: selectedStoreEntity?.settings?.laborCostRate,
      purchaseCostMode: selectedStoreEntity?.settings?.purchaseCostMode,
      purchaseCostRate: selectedStoreEntity?.settings?.purchaseCostRate,
    }),
    [appState, selectedStoreId, selectedMonth, useInventoryTracking, selectedStoreEntity]
  );
  const monthNeedsReconfirmation = useMemo(
    () => needsMonthReconfirmation(appState, selectedStoreId, selectedMonth),
    [appState, selectedStoreId, selectedMonth]
  );
  const todayEntry = useMemo(() => {
    // 販売前総合チェックで発見: new Date().toISOString()はUTC基準の日付文字列を返すため、
    // 日本時間の午前0:00〜8:59の間はUTC側がまだ前日のまま——「本日の実績」カードが実際には
    // 前日のデータを見てしまっていた。formatLocalDate(JST基準)に統一する。
    const todayIso = formatLocalDate(new Date());
    return dailyEntries.find((entry) => entry.date === todayIso) || null;
  }, [dailyEntries]);
  const todayActual = todayEntry ? Number(todayEntry.totalSales || todayEntry.technicalSales || 0) : 0;
  const todayAchievement = summary.todayTarget ? (todayActual / summary.todayTarget) * 100 : 0;

  const visibleNavItems = useMemo(() => getVisibleNavItems(currentRole), [currentRole]);
  const applyCompanySnapshot = (state, companyId) => {
    const targetCompany = (state.companies || []).find((company) => company.id === companyId) || null;
    const snapshot = (state.companySnapshots || {})[companyId] || {
      ...createInitialAppState(),
      stores: targetCompany?.stores?.map((store) => store.name) || [],
      selectedStore: targetCompany?.stores?.[0]?.name || "",
      selectedStoreId: targetCompany?.stores?.[0]?.id || "",
    };
    return {
      ...state,
      ...snapshot,
      currentCompanyId: companyId,
      currentUserId: state.currentUserId || "",
      currentAuthUserId: state.currentAuthUserId || "",
      companies: state.companies || [],
      users: state.users || [],
      companySnapshots: { ...(state.companySnapshots || {}), [companyId]: snapshot },
    };
  };
  // 店舗売上ランキング: 順位・店舗名・現在売上・先月売上だけのシンプルな一覧。並び順は常に
  // 当月の現在売上が高い順(先月売上はランキング順位の判定には使わない、比較用の表示のみ)。
  // パフォーマンス改善: 以前はcalculateMonthSummary(費用集計・在庫評価・消費税引当まで
  // すべて計算する重い関数)を店舗数×2か月分(当月+前月)そのまま呼んでおり、ランキングが
  // ダッシュボードの他の数値より数秒遅れて表示される主因になっていた——ランキングは売上合計と
  // 前月データの有無しか使わないため、その2値だけを返す軽量版(getStoreMonthSalesTotal)に
  // 差し替える。ネットワーク取得はこのuseMemoの外(hydrateFromSupabase)で完了済みのappState
  // だけを使っており、ランキング用に別クエリを発行してはいない(N+1構造ではない)。
  const rankingRows = useMemo(() => {
    const previousMonth = getMonthOffset(selectedMonth, -1);

    // ランキングの売上はダッシュボードの総売上(summary.sales、入力済み全件)と同じ基準にする —
    // 以前はsummary.closedSales(日締め済みの日だけ)を使っており、当日分を入力しただけでは
    // ランキングに反映されず「ダッシュボードは最新なのにランキングだけ古い」という不具合の
    // 原因になっていた。日締めを待たず、入力した時点でランキングにも反映される。
    const rows = currentCompanyStores.map((store) => {
      const storeSummary = getStoreMonthSalesTotal(appState, store.id, selectedMonth);
      // previousSummary.hasEntries(前月の日次入力が1件でもあるか)で「先月データが
      // 存在しない」を判定する — 前月の売上が本当に0円だった場合と区別するため。
      const previousSummary = getStoreMonthSalesTotal(appState, store.id, previousMonth);

      return {
        storeId: store.id,
        storeName: store.name,
        sales: storeSummary.sales,
        previousSales: previousSummary.sales,
        hasPreviousSales: previousSummary.hasEntries,
      };
    });

    return [...rows]
      .sort((left, right) => right.sales - left.sales)
      .map((row, index) => ({ ...row, currentRank: index + 1 }));
  }, [appState, selectedMonth, currentCompanyStores]);
  // 1店舗会社ではランキング(順位比較)自体に意味が無いため、セクションごと非表示にする。
  // 判定基準は「今画面に描画されているランキング件数」ではなく、現在閲覧中の会社の有効
  // 店舗数(currentCompanyStores、archived以外)——rankingRowsも同じcurrentCompanyStoresから
  // 作られているため実質同じ値だが、意図を明確にするため専用の判定にする。currentCompanyは
  // 加盟店閲覧中(isViewingFranchise)なら閲覧先の加盟店自身を指す(currentCompany/
  // myCompanyIdの定義参照)ため、自社1店舗+加盟店複数、のようなケースで自社店舗数と加盟店数を
  // 混同することはない——閲覧中の会社(自社 or 開いている加盟店)自身の店舗数だけで判定される。
  const showStoreRanking = currentCompanyStores.length >= 2;
  // 「データを更新中です…」の間、未取得の売上・ランキングが¥0/0%として表示され、利用者が
  // 「データが消えたのでは」と不安になる不具合の修正(要件7-9)。syncInitializedは今セッション
  // で一度でも本物のhydrateが成功したことを示す既存のフラグ(自動保存のガードに使っている
  // ものを再利用——新しい仕組みは増やさない)。まだ一度も成功していない、かつローカルに
  // 前回分のキャッシュ(日次入力・ランキング対象店舗の売上)も無い場合だけ「本当に何も
  // 表示できるものが無い」と判定し、それ以外(前回セッションのキャッシュがある/既に
  // hydrate成功済み)は実際の値(0円を含む)をそのまま表示する——「前回データを消さない」
  // 要件を、フラグを増やさずsyncInitialized+既存データの有無だけで満たす。
  const isInitialDataReady = syncInitialized || dailyEntries.length > 0 || rankingRows.some((row) => row.sales > 0 || row.hasPreviousSales);
  const goToMonthlyTargetSetting = () => {
    // 月間目標設定パネルは selectedMonth (ヘッダーの対象月) とは独立した専用の月選択
    // (targetSelectedMonth) を持つため、ここで同期させないとダッシュボードで見ていた
    // 月とは違う月の目標画面に着地してしまう。店舗 (selectedStore) はグローバルな状態
    // なので自動的に引き継がれる。
    setTargetSelectedMonth(selectedMonth);
    setActivePage("monthly");
    setActiveMonthlyTab("target");
  };
  // 初期設定チェックリストの各項目から、管理画面の該当タブ(または営業日設定の場合はカレンダー
  // 編集UI)へ直接遷移する(要件6: トップへ飛ばして探させない)。「戻る」バナー表示フラグは
  // ここでのみ立てる。
  const goToSetupChecklistItem = (item) => {
    setSetupChecklistReturnPending(true);
    if (item.key === "target") {
      goToMonthlyTargetSetting();
      return;
    }
    if (item.monthlyTab) {
      setActivePage("monthly");
      setActiveMonthlyTab(item.monthlyTab);
      return;
    }
    setActivePage(item.page);
    if (item.openBusinessDayEditor) setIsBusinessDayEditing(true);
  };
  const openAiChat = (question = "") => {
    setAiChatInitialQuestion(question);
    setAiChatOpen(true);
  };
  const closeAiChat = () => {
    setAiChatOpen(false);
    setAiChatInitialQuestion("");
  };
  // Whether a monthly target actually exists in Supabase for the store+month currently on
  // screen — not just "is the target panel showing something", since that panel has its own
  // independent month selector (see targetSelectedMonth) and could be looking at a different
  // month entirely. appState.targets is kept fresh for this exact store+month by
  // hydrateFromSupabase's monthly_targets overlay (see loadMonthlyTargetsForCompany).
  const hasSalesTarget = parseNumber(target.targetSales) > 0;
  const hasCustomerTarget = parseNumber(target.targetCustomers) > 0;
  const hasReviewCountTarget = parseNumber(target.targetReviewCount) > 0;
  // 月間目標を1つも登録していない店舗かどうか。falseの間はダッシュボードの目標系カードを
  // 個別に「未登録」表示するのではなく、まとめて1箇所の案内(TargetSetupHint)だけを出す
  // (未入力=警告、を避けるための整理。任意項目のご指示に基づく)。
  const hasAnyTarget = hasSalesTarget || hasCustomerTarget || hasReviewCountTarget;
  // 初回利用時の分かりやすさ改善(要件9): 「何から入力すればいいか分からない」状態を防ぐための
  // 5段階チェックリスト。既存のTargetSetupHint(目標だけの単発の案内)とは別に、店舗情報・
  // 営業日設定・固定費・日次入力まで含めた全体の進み具合を1つのカードにまとめる——ここでも
  // 「未入力=常に赤警告」にはせず、5項目すべて完了したら自動的にカード自体を非表示にする
  // (要件: 常に大きな案内を表示して邪魔にならないように/設定完了後は通常画面を優先)。
  // 全店舗ビューは特定の1店舗の設定状況を表すものが無いため対象外。
  // 管理画面(basic/input/target/fixed/closing/pnlタブ構成)と同じ実データを参照し、初期設定
  // 専用の完了フラグは持たない。「店舗基本設定」「入力項目設定」「月間目標」「営業日設定」を
  // 必須、「固定費設定」を任意(あとから設定可能)とする(要件3・9)。各項目のクリック先は
  // 管理画面の該当タブへ直接遷移する(goToSetupChecklistItem参照)。
  const setupChecklist = useMemo(() => {
    if (isAllStoresView || !selectedStoreEntity) return [];
    // 店舗名は店舗作成時の必須項目(handleSaveStore/handleCreateNewStoreで検証済み)なので、
    // 実際に保存されている店舗名の有無がそのまま「店舗基本設定が完了しているか」の実データ
    // 判定になる。
    const hasStoreBasicSetting = Boolean(selectedStoreEntity?.name?.trim());
    // store_input_settings行が実際に保存されているか(dailyFieldSettings自体は行が無くても
    // デフォルト値にフォールバックするため、hasInputSettingsRowでのみ区別できる)。
    const hasInputSettingsRow = Boolean(selectedStoreEntity?.settings?.hasInputSettingsRow);
    const hasHolidaySetting = businessDaySettings.mode === "manual"
      ? parseNumber(businessDaySettings.businessDayCount) > 0
      : (getStoreHolidayDates(appState, selectedStoreId, selectedMonth).length > 0 || parseNumber(businessDaySettings.holidayCount) > 0);
    const hasFixedCostSetting = fixedCosts.length > 0;
    return [
      { key: "store", label: "店舗基本設定", description: "店舗名など、店舗の基本情報を設定", done: hasStoreBasicSetting, page: "monthly", monthlyTab: "basic" },
      { key: "inputSettings", label: "入力項目設定", description: "毎日の売上入力で使用する項目を選択", done: hasInputSettingsRow, page: "monthly", monthlyTab: "input" },
      { key: "target", label: "月間目標", description: "売上・客数など今月の目標を設定", done: hasAnyTarget, page: "monthly", monthlyTab: "target" },
      { key: "holidays", label: "営業日設定", description: "営業日と休業日を設定", done: hasHolidaySetting, page: "daily", openBusinessDayEditor: true },
      { key: "fixedCosts", label: "固定費設定", description: "家賃など毎月発生する費用を設定（あとから設定できます）", done: hasFixedCostSetting, optional: true, page: "monthly", monthlyTab: "fixed" },
    ];
  }, [isAllStoresView, selectedStoreEntity, businessDaySettings, appState, selectedStoreId, selectedMonth, fixedCosts, hasAnyTarget]);
  const [setupChecklistDismissed, setSetupChecklistDismissed] = useState(false);
  // 初期設定チェックリスト経由で管理画面/日次入力へ移動した間だけtrueにし、「初期設定に
  // 戻る」バナーを表示する(要件7)。通常のサイドバーnav遷移やgoToMonthlyTargetSetting単体
  // (TargetSetupHint等、チェックリスト以外からの既存呼び出し元)ではセットしない——通常の
  // 管理画面利用時にバナーが出ないようにするため。
  const [setupChecklistReturnPending, setSetupChecklistReturnPending] = useState(false);
  // 初期設定は「対象月ごとの状態」ではなく「店舗単位で一度完了すれば恒久的に完了」として
  // 扱う(不具合修正: 過去月・翌月など対象月を切り替えるたびに、その月にデータが無いことを
  // 理由に初期設定案内が再表示されていた)。store_profiles.initial_setup_completed(店舗単位の
  // 永続フラグ)が既にtrueなら、setupChecklistの各項目がその月にたまたま無くても表示しない。
  const isStoreInitialSetupCompleted = Boolean(selectedStoreEntity?.initialSetupCompleted);
  // 必須項目(固定費設定を除く4項目)が揃っていれば十分に使用開始できるとみなす(要件9:
  // 「5/5にしないと使えない」仕様を避ける)——表示・自動完了判定ともに必須項目のみで判断する。
  // useMemoで安定した参照にする(下のuseEffectの依存配列に使うため——.filter()を直接使うと
  // 毎レンダーで新しい配列参照になり、effectが不要に再実行され続けてしまう)。
  const requiredSetupChecklist = useMemo(() => setupChecklist.filter((item) => !item.optional), [setupChecklist]);
  const showSetupChecklist = !isStoreInitialSetupCompleted && requiredSetupChecklist.length > 0 && requiredSetupChecklist.some((item) => !item.done) && !setupChecklistDismissed;
  // 店舗を切り替えたら、別の店舗の設定状況に対する「閉じる」操作を引き継がない(要件: 店舗
  // 切替でデータが混ざらない、の一種——ここでのdismiss状態も一種の店舗ごとの表示状態)。
  useEffect(() => {
    setSetupChecklistDismissed(false);
  }, [selectedStoreId]);
  // 現在表示中の対象月で5項目すべてが完了と判定された最初のタイミングで、店舗単位の恒久
  // フラグ(initialSetupCompleted)を1回だけ立てる——以後はどの対象月を表示しても
  // チェックリストが再表示されなくなる。まだstore_profiles行が存在しない極めて初期の店舗や、
  // 権限(staff等)によりRLSでUPDATEが通らない場合はmarkStoreInitialSetupCompleted側が
  // 静かにskip扱いにする(要件: エラー表示にしない、他の操作をブロックしない)。
  useEffect(() => {
    if (isStoreInitialSetupCompleted) return;
    if (!requiredSetupChecklist.length || requiredSetupChecklist.some((item) => !item.done)) return;
    if (!isSupabaseConfigured || !appState.currentCompanyId || !selectedStoreId || !appState.currentUserId) return;
    if (markingInitialSetupCompletedRef.current) return;
    markingInitialSetupCompletedRef.current = true;
    let cancelled = false;
    void markStoreInitialSetupCompleted({ companyId: appState.currentCompanyId, storeId: selectedStoreId, userId: appState.currentUserId }).then((result) => {
      if (cancelled || !result.ok || result.skipped) return;
      // DB確認済みの値で反映する(送ったつもりの値を信じない、既存の他の保存修正と同じ方針)。
      setAppState((prev) => ({
        ...prev,
        companies: (prev.companies || []).map((company) => (company.id !== prev.currentCompanyId ? company : {
          ...company,
          stores: (company.stores || []).map((store) => (store.id !== selectedStoreId ? store : { ...store, initialSetupCompleted: true })),
        })),
      }));
    }).finally(() => {
      markingInitialSetupCompletedRef.current = false;
    });
    return () => { cancelled = true; };
  }, [isStoreInitialSetupCompleted, requiredSetupChecklist, appState.currentCompanyId, appState.currentUserId, selectedStoreId]);
  // ⑤ 月末着地予測 vs 目標: forecast itself doesn't need a target to compute (it's pace-based),
  // only this comparison line does.
  const forecastVsTarget = summary.displayForecast - parseNumber(target.targetSales);
  // 売上画面UI/UX改善(色分けは「単純な目標未達」で判定しない、要件2・20): 月間達成率が
  // 100%未満なだけで赤にすると、月途中は常に赤だらけになる。月末着地予測(このペースで
  // 進んだ場合の着地見込み、既存のsummary.displayForecast)を基準に判定する——今回追加した
  // 新しい計算ロジックは無く、既存のgetMetricTone(hero-gridの他のKPIと同じ判定関数)を
  // 月末着地予測÷目標のratioに適用するだけ。目標未設定の場合は判定しない(neutral)。
  const forecastAchievementRatio = hasSalesTarget ? (summary.displayForecast / parseNumber(target.targetSales)) * 100 : null;
  const forecastStatusTone = forecastAchievementRatio === null ? "" : getMetricTone(forecastAchievementRatio, 90, 100);
  // 追加UI/UX微修正(要件4): 「要注意」は日常的に見る画面では強すぎるとの指摘のため、
  // 意味(判定ロジック)は変えずに文言だけやわらげる。dangerの文言を「要注意」→
  // 「ペース確認」に変更(good/warningの文言は据え置き)。
  const forecastStatusLabel = forecastStatusTone === "good" ? "順調" : forecastStatusTone === "warning" ? "やや遅れ" : forecastStatusTone === "danger" ? "ペース確認" : "";
  // ③ 月間達成率は「営業進捗との差」を表示する(要件3)。営業進捗(businessDaySummary.
  // progressRate)は既に営業日ベース(休業日を除外した営業日数を分母にする、既存の
  // getBusinessDaySummary)で計算済みの値をそのまま使う——ここで暦日ベースの新しい計算は
  // 行わない。達成率(実績÷目標)と進捗率(経過営業日÷全営業日)の差分(pt)を出すだけ。
  const scheduleAdjustedGapPt = (hasSalesTarget && isInitialDataReady && businessDaySummary.progressRate !== null)
    ? summary.targetAchievement - businessDaySummary.progressRate
    : null;
  // 追加UI/UX微修正(要件6): 客数達成率も、売上と同じ「営業進捗との比較」で判定する
  // (月途中に実績÷目標の単純な達成率だけで強い注意色にしない)。新しい客数計算は追加せず、
  // 既存のcustomerTargetSummary.achievementRateとbusinessDaySummary.progressRateという
  // 2つの既存計算値の差分(pt)だけを使う——差0pt=ちょうど進捗通りを100点とみなし、
  // forecastStatusToneと同じ90/100の閾値をそのまま再利用する(新しい判定基準を増やさない)。
  const customerScheduleAdjustedGapPt = (hasCustomerTarget && isInitialDataReady && businessDaySummary.progressRate !== null)
    ? customerTargetSummary.achievementRate - businessDaySummary.progressRate
    : null;
  const customerPaceTone = customerScheduleAdjustedGapPt === null ? "" : getMetricTone(customerScheduleAdjustedGapPt + 100, 90, 100);
  // ㉑ 過去月は現在月と同じ見せ方にしない(要件21)。「対象月が既に終了しているか」は表示
  // モードの切替だけに使う判定で、どのデータがどの月に属するかというデータ分類には一切
  // 関与しない(データ側の対象月判定は既存通りbusiness_date/target_month基準のまま)。
  const isViewingPastMonth = selectedMonth < formatLocalDate(new Date()).slice(0, 7);
  // 「1人あたり月間売上」の表示条件(要件): スタッフ数(生産性計算人数優先、無ければ在籍
  // スタッフ数、getStaffProductivitySummaryと同じ優先順位)が2人以上の場合だけ表示する。
  // 1人の場合は総売上と同じ金額になり情報が重複するため非表示、0人・未入力の場合も非表示
  // (hasStaffCountがfalseになる)。この判定はstaffProductivitySummary.effectiveStaffCountを
  // 参照するだけで、優先順位ロジック自体はgetStaffProductivitySummary側の1箇所に閉じている
  // (App.jsx側で重複実装しない)。スタッフ数は現状、店舗の現在設定(store_profiles)を
  // そのまま使う仕様のまま(月次履歴は持たない)——過去月を開いても同じ現在値を参照する。
  const showPerStaffSalesCard = !isAllStoresView && Boolean(selectedStoreEntity) && staffProductivitySummary.hasStaffCount && staffProductivitySummary.effectiveStaffCount >= 2;
  // 「1人あたり月間売上」は要件どおり単独カードのまま(スマホの2列ペアには入れない)。
  // ここは「1人あたり月間売上」1項目(表示可否に応じて実カード or プレースホルダー)だけを
  // 持つ配列にする——平均客単価は客数達成率と隣接させて描画する必要があるため、この配列
  // からは切り離し、kpi-hero-gridのJSXで直接レンダリングする(下記参照)。
  const perStaffSalesMetrics = useMemo(() => {
    // 全店舗ビューでは店舗ごとの生産性計算人数という単一の値が存在しないため出さない
    // (このブロック自体を出さない、既存仕様のまま)。
    if (isAllStoresView || !selectedStoreEntity) return [];
    if (showPerStaffSalesCard) {
      return [{
        label: "1人あたり月間売上",
        // データ取得前(isInitialDataReady=false)は他のKPIカードと同じ「—」表示にし、
        // 実績反映前の¥0がちらつくのを防ぐ(要件: ちらつきを出さない)。
        value: isInitialDataReady ? `${money(staffProductivitySummary.current)} / 人` : "—",
        hint: isInitialDataReady ? `月末予測 ${money(staffProductivitySummary.monthEndForecast)} / 人` : "",
      }];
    }
    // スタッフ数が1人以下(または未設定)の月は、カードを取り除くのではなく「見た目の無い
    // プレースホルダー」を同じ位置へ積む(要件: 非表示でも周辺のKPIカードの横幅・高さ・
    // 並び順を変えない)。
    return [{ label: "__per_staff_sales_placeholder__", placeholder: true }];
  }, [isAllStoresView, selectedStoreEntity, showPerStaffSalesCard, staffProductivitySummary, isInitialDataReady]);
  // Driven by which sales fields are actually enabled for this store (activeDailyFieldSettings/
  // preferences.showOtherSales) rather than a hardcoded 技術/店販 pair — a future field added to
  // that same toggle system (エクステ、スパ、着付け etc.) only needs an entry pushed onto this
  // array to automatically show up here too, no dashboard changes required. Percentages are of
  // the sum of whatever's shown here (not summary.sales), so they always add up to 100% even if
  // some untracked/legacy amount exists outside these categories.
  const salesComposition = useMemo(() => {
    const items = [];
    if (effectiveShowTechnicalSalesField) items.push({ key: "technicalSales", label: "技術売上", amount: summary.technicalSales });
    if (effectiveShowRetailSalesField) items.push({ key: "retailSales", label: "店販売上", amount: summary.retailSales });
    if (effectiveShowOtherSalesField) items.push({ key: "otherSales", label: "その他", amount: summary.otherSales });
    const total = items.reduce((sum, item) => sum + Math.max(item.amount, 0), 0);
    return items
      .filter((item) => item.amount > 0)
      .map((item) => ({ ...item, ratio: total > 0 ? item.amount / total : 0 }));
  }, [effectiveShowTechnicalSalesField, effectiveShowRetailSalesField, effectiveShowOtherSalesField, summary.technicalSales, summary.retailSales, summary.otherSales]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__salonAppDebug = {
        appState,
        currentUser,
        currentRole,
        syncStatus,
        activePage,
        authMode,
      };
    }
  }, [appState, currentUser, currentRole, syncStatus, activePage, authMode]);

  const handleModeChange = (nextMode) => {
    setAuthMode(nextMode);
    setAuthError("");
    setAuthSuccess("");
  };

  const handleLogin = async ({ email, password }) => {
    setAuthLoading(true);
    setAuthError("");
    setAuthSuccess("");
    const normalizedEmail = normalizeEmail(email);

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await signInWithEmail(normalizedEmail, password);
        console.info("[supabase-login] signInWithPassword result", { email: normalizedEmail, data, error });
        if (normalizedEmail === "hirotomatsumoto+salonadmin@gmail.com") {
          console.info("[supabase-login] admin email login attempt", { email: normalizedEmail, passwordLength: String(password || "").length });
        }
        if (error) {
          throw error;
        }
        const authUser = data?.user;
        if (!authUser) {
          throw new Error("認証ユーザーを取得できませんでした");
        }
        const { data: sessionData, error: sessionError } = await getSupabaseSession();
        console.info("[supabase-login] getSession result", { sessionData, sessionError });
        const { data: userData, error: userError } = await supabase.auth.getUser();
        console.info("[supabase-login] getUser result", { userData, userError });
        const profile = await ensureProfileForAuthUser({ authUserId: authUser.id, email: authUser.email, role: resolveRoleForEmail(authUser.email) });
        if (!profile) {
          throw new Error("プロフィール情報を取得できませんでした");
        }
        const tenantState = await loadTenantStateFromSupabase({ authUserId: authUser.id, email: authUser.email, currentProfile: profile });
        const nextUser = buildAuthenticatedUser({ profile, authUser, role: resolveRoleForEmail(authUser.email) });
        setCurrentUser(nextUser);
        setCurrentRole(normalizeRole(profile?.role || resolveRoleForEmail(authUser.email)));
        const loginCompanyId = profile?.company_id || tenantState.currentCompanyId || "";
        const loginLocalRecoveredState = normalizeAppState(readAppState());
        const { selectedStore: loginPreferredSelectedStore, selectedStoreId: loginPreferredSelectedStoreId } = resolvePreferredStoreSelection({
          tenantState,
          localRecoveredState: loginLocalRecoveredState,
          currentCompanyId: loginCompanyId,
          role: normalizeRole(profile?.role || resolveRoleForEmail(authUser.email)),
        });
        setAppState({
          ...tenantState,
          currentCompanyId: loginCompanyId,
          currentUserId: nextUser.profileId,
          currentAuthUserId: nextUser.authUserId,
          selectedStore: loginPreferredSelectedStore,
          selectedStoreId: loginPreferredSelectedStoreId,
          selectedMonth: loginLocalRecoveredState.selectedMonth || tenantState.selectedMonth || new Date().toISOString().slice(0, 7),
          // ログインは常に自社から始める(加盟店の閲覧状態は引き継がない)。
          isViewingFranchise: false,
          homeCompanyIdBeforeFranchiseView: "",
        });
        window.localStorage.setItem("salon-user", JSON.stringify(nextUser));
        window.localStorage.setItem("salon-role", normalizeRole(profile?.role || resolveRoleForEmail(authUser.email)));
        setAuthLoading(false);
        setAuthMode("app");
        setActivePage(resolveDefaultPage(normalizeRole(profile?.role || resolveRoleForEmail(authUser.email))));
        return;
      } catch (error) {
        console.error("[supabase-login] auth failed", error);
        setAuthError(getLocalizedSupabaseErrorMessage(error));
        setAuthLoading(false);
        return;
      }
    }

    const configurationIssue = getSupabaseConfigurationIssue();
    if (configurationIssue) {
      setAuthError(`Supabase Authが利用できません。設定状態: ${configurationIssue}`);
    } else {
      setAuthError("Supabase Authに接続できませんでした。Supabaseの接続状態を確認してください。");
    }
    setAuthLoading(false);
  };

  const handleSignUp = async ({ email, password }) => {
    setAuthLoading(true);
    setAuthError("");
    setAuthSuccess("");

    const normalizedEmail = normalizeEmail(email);

    // The invite lookup used to be a purely local `appState.users.find(...)` check — which is
    // always empty on a brand-new device/browser (a fresh visitor has no hydrated state, and
    // RLS blocks anonymous profile reads outright), so a genuine invitee's link could never
    // actually resolve. get_invite_info is a SECURITY DEFINER RPC that works before any session
    // exists, so this now works from a truly fresh browser — see
    // 20260809000000_invite_flow_hardening.sql.
    if (inviteToken) {
      let inviteInfo;
      try {
        inviteInfo = await getInviteInfo(inviteToken);
      } catch (error) {
        setAuthError(getLocalizedSupabaseErrorMessage(error));
        setAuthLoading(false);
        return;
      }

      if (!inviteInfo) {
        setAuthError("招待リンクが無効です。管理者に再招待を依頼してください。");
        setAuthLoading(false);
        return;
      }
      if (!inviteInfo.is_active || inviteInfo.invitation_status === "suspended" || inviteInfo.invitation_status === "disabled") {
        setAuthError("この招待は無効です。管理者にお問い合わせください。");
        setAuthLoading(false);
        return;
      }
      if (isInviteExpired(inviteInfo.invite_expires_at)) {
        setAuthError("この招待リンクは期限切れです。管理者にお問い合わせください。");
        setAuthLoading(false);
        return;
      }
      if (String(inviteInfo.email || "").trim().toLowerCase() && normalizedEmail !== String(inviteInfo.email || "").trim().toLowerCase()) {
        setAuthError("招待メールアドレスと一致するメールアドレスで登録してください。");
        setAuthLoading(false);
        return;
      }

      // Delegates account creation to the accept-invite Edge Function (service-role, never
      // exposed to the browser): this project requires email confirmation, so a plain
      // signUpWithEmail() here would never return a session and the invitee would be stuck.
      // The function creates their account pre-confirmed with the password they just chose and
      // links it to the profile row the inviting admin already created (role/company/store all
      // already set there — nothing to re-apply client-side).
      const acceptResult = await acceptInvite({ token: inviteToken, email: normalizedEmail, password });
      if (!acceptResult.ok) {
        setAuthError(getSupabaseErrorMessage(acceptResult.error));
        setAuthLoading(false);
        return;
      }

      try {
        const { data, error } = await signInWithEmail(normalizedEmail, password);
        if (error) throw error;
        const authUser = data?.user;
        if (!authUser) throw new Error("認証ユーザーを取得できませんでした");

        const profile = await ensureProfileForAuthUser({ authUserId: authUser.id, email: authUser.email, role: resolveRoleForEmail(authUser.email) });
        const tenantState = await loadTenantStateFromSupabase({ authUserId: authUser.id, email: authUser.email, currentProfile: profile });
        const nextUser = buildAuthenticatedUser({ profile, authUser, role: normalizeRole(profile?.role) });
        const nextRole = normalizeRole(profile?.role || "staff");
        setCurrentUser(nextUser);
        setCurrentRole(nextRole);
        const inviteCompanyId = profile?.company_id || tenantState.currentCompanyId || "";
        const inviteLocalRecoveredState = normalizeAppState(readAppState());
        const { selectedStore: invitePreferredSelectedStore, selectedStoreId: invitePreferredSelectedStoreId } = resolvePreferredStoreSelection({
          tenantState,
          localRecoveredState: inviteLocalRecoveredState,
          currentCompanyId: inviteCompanyId,
          role: nextRole,
        });
        setAppState({
          ...tenantState,
          currentCompanyId: inviteCompanyId,
          currentUserId: nextUser.profileId,
          currentAuthUserId: nextUser.authUserId,
          selectedStore: invitePreferredSelectedStore,
          selectedStoreId: invitePreferredSelectedStoreId,
          selectedMonth: inviteLocalRecoveredState.selectedMonth || tenantState.selectedMonth || new Date().toISOString().slice(0, 7),
          isViewingFranchise: false,
          homeCompanyIdBeforeFranchiseView: "",
        });
        window.localStorage.setItem("salon-user", JSON.stringify(nextUser));
        window.localStorage.setItem("salon-role", nextRole);
        setAuthMode("app");
        setActivePage(resolveDefaultPage(nextRole));
        setInviteToken("");
      } catch (error) {
        // acceptInvite自体は既に成功している(アカウントは作成済み)— ここで失敗するのは
        // その直後のsignInWithEmail/プロフィール取得の段階なので、「登録に失敗した」と
        // 誤解させる汎用メッセージではなく、アカウントは作れていることが伝わる文言にする
        // (要件14: 段階ごとに分かるエラー表示)。ログイン画面から普通にログインすれば
        // 復帰できる。
        setAuthMode("login");
        setInviteToken("");
        setAuthError(`アカウントの作成は完了しましたが、自動ログインに失敗しました(${getLocalizedSupabaseErrorMessage(error)})。お手数ですが、上のログイン画面から設定したメールアドレスとパスワードでログインしてください。`);
      } finally {
        setAuthLoading(false);
      }
      return;
    }

    try {
      let authUser = null;
      try {
        const { data, error } = await signUpWithEmail(normalizedEmail, password);
        if (error) throw error;
        authUser = data?.user || null;
      } catch (error) {
        console.warn("Supabase sign-up skipped for invite flow", error);
      }

      const signInResult = await signInWithEmail(normalizedEmail, password);
      if (!signInResult.error && signInResult.data?.user) {
        const authUser = signInResult.data.user;
        const profile = await ensureProfileForAuthUser({ authUserId: authUser.id, email: authUser.email, role: resolveRoleForEmail(authUser.email) });
        const tenantState = await loadTenantStateFromSupabase({ authUserId: authUser.id, email: authUser.email, currentProfile: profile });
        const nextUser = buildAuthenticatedUser({ profile, authUser, role: resolveRoleForEmail(authUser.email) });
        setCurrentUser(nextUser);
        setCurrentRole(normalizeRole(profile?.role || resolveRoleForEmail(authUser.email)));
        const signupCompanyId = profile?.company_id || tenantState.currentCompanyId || "";
        const signupLocalRecoveredState = normalizeAppState(readAppState());
        const { selectedStore: signupPreferredSelectedStore, selectedStoreId: signupPreferredSelectedStoreId } = resolvePreferredStoreSelection({
          tenantState,
          localRecoveredState: signupLocalRecoveredState,
          currentCompanyId: signupCompanyId,
          role: normalizeRole(profile?.role || resolveRoleForEmail(authUser.email)),
        });
        setAppState({
          ...tenantState,
          currentCompanyId: signupCompanyId,
          currentUserId: nextUser.profileId,
          currentAuthUserId: nextUser.authUserId,
          selectedStore: signupPreferredSelectedStore,
          selectedStoreId: signupPreferredSelectedStoreId,
          selectedMonth: signupLocalRecoveredState.selectedMonth || tenantState.selectedMonth || new Date().toISOString().slice(0, 7),
          isViewingFranchise: false,
          homeCompanyIdBeforeFranchiseView: "",
        });
        window.localStorage.setItem("salon-user", JSON.stringify(nextUser));
        window.localStorage.setItem("salon-role", normalizeRole(profile?.role || resolveRoleForEmail(authUser.email)));
        setAuthMode("app");
        setActivePage(resolveDefaultPage(normalizeRole(profile?.role || resolveRoleForEmail(authUser.email))));
        return;
      }

      if (authUser) {
        setAuthSuccess("アカウントを作成しました。ログインしてください。" );
      } else {
        setAuthSuccess("登録リクエストを受け付けました。" );
      }
    } catch (error) {
      setAuthError(getLocalizedSupabaseErrorMessage(error));
    } finally {
      setAuthLoading(false);
    }
  };

  // 新規オーナー・セルフサインアップ(要件2)。招待受諾(handleSignUp)とは完全に別の関数・
  // 別のEdge Function(self-signup)を使う——処理を混同しない(要件7)。company/store作成・
  // company_admin付与・二重生成防止・途中離脱復旧はすべてself-signup Edge Function側の責務
  // (supabase/functions/self-signup/index.ts参照)。ここでは、その成功後にhandleLoginと
  // 同じ「サインイン→プロフィール取得→テナント状態取得→アプリへ入る」処理を1回だけ追加で
  // 行う(3箇所目のコピー、既存のhandleLogin/handleSignUpと同じ並び)。
  const handleOwnerSignUp = async ({ ownerName, companyName, email, password }) => {
    setAuthLoading(true);
    setAuthError("");
    setAuthSuccess("");
    const normalizedEmail = normalizeEmail(email);

    if (!isSupabaseConfigured) {
      setAuthError("Supabase Authに接続できませんでした。Supabaseの接続状態を確認してください。");
      setAuthLoading(false);
      return;
    }

    try {
      const signUpResult = await selfSignup({
        email: normalizedEmail, password, ownerName, companyName, testKey: ownerSignupTestKey,
        utmSource: ownerSignupUtm.utmSource, utmCampaign: ownerSignupUtm.utmCampaign, utmContent: ownerSignupUtm.utmContent,
      });
      if (!signUpResult.ok) {
        // 生のSupabase/Postgresエラーではなく、self-signup Edge Functionが返す日本語文言を
        // そのまま表示する(要件15)。
        setAuthError(getSupabaseErrorMessage(signUpResult.error));
        setAuthLoading(false);
        return;
      }

      const { data, error } = await signInWithEmail(normalizedEmail, password);
      if (error) throw error;
      const authUser = data?.user;
      if (!authUser) throw new Error("認証ユーザーを取得できませんでした");

      const profile = await ensureProfileForAuthUser({ authUserId: authUser.id, email: authUser.email, role: resolveRoleForEmail(authUser.email) });
      if (!profile) throw new Error("プロフィール情報を取得できませんでした");
      const tenantState = await loadTenantStateFromSupabase({ authUserId: authUser.id, email: authUser.email, currentProfile: profile });
      const nextUser = buildAuthenticatedUser({ profile, authUser, role: normalizeRole(profile?.role) });
      const nextRole = normalizeRole(profile?.role || "company_admin");
      setCurrentUser(nextUser);
      setCurrentRole(nextRole);
      const ownerCompanyId = profile?.company_id || tenantState.currentCompanyId || "";
      const ownerLocalRecoveredState = normalizeAppState(readAppState());
      const { selectedStore: ownerPreferredSelectedStore, selectedStoreId: ownerPreferredSelectedStoreId } = resolvePreferredStoreSelection({
        tenantState,
        localRecoveredState: ownerLocalRecoveredState,
        currentCompanyId: ownerCompanyId,
        role: nextRole,
      });
      setAppState({
        ...tenantState,
        currentCompanyId: ownerCompanyId,
        currentUserId: nextUser.profileId,
        currentAuthUserId: nextUser.authUserId,
        selectedStore: ownerPreferredSelectedStore,
        selectedStoreId: ownerPreferredSelectedStoreId,
        selectedMonth: ownerLocalRecoveredState.selectedMonth || tenantState.selectedMonth || new Date().toISOString().slice(0, 7),
        isViewingFranchise: false,
        homeCompanyIdBeforeFranchiseView: "",
      });
      window.localStorage.setItem("salon-user", JSON.stringify(nextUser));
      window.localStorage.setItem("salon-role", nextRole);
      setAuthMode("app");
      // 新規に作られたばかりの1店舗はstore_profiles未作成=初期設定チェックリスト
      // (setupChecklist、ダッシュボードで自動表示)がそのまま未完了として表示される——新しい
      // 専用オンボーディングUIを作らず、既存のダッシュボード起点の案内へ自然につなげる
      // (要件10)。resolveDefaultPage(company_admin)は元々dashboardを返すため、他の
      // ログイン経路と同じ既定ページのままでよい。
      setActivePage(resolveDefaultPage(nextRole));
    } catch (error) {
      // selfSignup自体は既に成功している(アカウントは作成済み)可能性が高いので、
      // handleSignUpの招待受諾フォールバックと同じく、登録失敗と誤解させない文言にする。
      setAuthMode("login");
      setAuthError(`アカウントの作成は完了しましたが、自動ログインに失敗しました(${getLocalizedSupabaseErrorMessage(error)})。お手数ですが、上のログイン画面から設定したメールアドレスとパスワードでログインしてください。`);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResetPassword = async ({ email }) => {
    setAuthLoading(true);
    setAuthError("");
    setAuthSuccess("");
    try {
      const redirectTo = typeof window !== "undefined" && window.location?.origin ? window.location.origin : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), redirectTo ? { redirectTo } : undefined);
      if (error) throw error;
      setAuthSuccess("パスワード再設定用のメールを送信しました。" );
    } catch (error) {
      setAuthError(getLocalizedSupabaseErrorMessage(error));
    } finally {
      setAuthLoading(false);
    }
  };

  // パスワード再設定リンク(type=recovery)を開いた直後に確立される一時的なセッションを使って、
  // 新しいパスワードを設定する。initializeAuthのisRecoveryCallback分岐からのみ遷移してくる
  // (authMode="recover")ので、その時点でSupabaseセッション自体は既に有効。
  const handleSetNewPassword = async ({ password }) => {
    setAuthLoading(true);
    setAuthError("");
    setAuthSuccess("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      const { data: { session }, error: sessionError } = await getSupabaseSession();
      if (sessionError) throw sessionError;
      const authUser = session?.user;
      if (!authUser) throw new Error("セッションを確認できませんでした。お手数ですが再度ログインしてください。");

      const profile = await ensureProfileForAuthUser({ authUserId: authUser.id, email: authUser.email, role: resolveRoleForEmail(authUser.email) });
      if (!profile) throw new Error("プロフィール情報を取得できませんでした");
      const tenantState = await loadTenantStateFromSupabase({ authUserId: authUser.id, email: authUser.email, currentProfile: profile });
      const localRecoveredState = normalizeAppState(readAppState());
      const nextUser = buildAuthenticatedUser({ profile, authUser });
      const nextRole = normalizeRole(profile?.role || "staff");
      setCurrentUser(nextUser);
      setCurrentRole(nextRole);
      const recoverCompanyId = profile?.company_id || tenantState.currentCompanyId || localRecoveredState.currentCompanyId || "";
      const { selectedStore: recoverSelectedStore, selectedStoreId: recoverSelectedStoreId } = resolvePreferredStoreSelection({
        tenantState,
        localRecoveredState,
        currentCompanyId: recoverCompanyId,
        role: nextRole,
      });
      setAppState({
        ...tenantState,
        currentCompanyId: recoverCompanyId,
        currentUserId: nextUser.profileId,
        currentAuthUserId: nextUser.authUserId,
        selectedStore: recoverSelectedStore,
        selectedStoreId: recoverSelectedStoreId,
        selectedMonth: localRecoveredState.selectedMonth || tenantState.selectedMonth || new Date().toISOString().slice(0, 7),
        isViewingFranchise: false,
        homeCompanyIdBeforeFranchiseView: "",
      });
      window.localStorage.setItem("salon-user", JSON.stringify(nextUser));
      window.localStorage.setItem("salon-role", nextRole);
      setAuthMode("app");
      setActivePage(resolveDefaultPage(nextRole));
    } catch (error) {
      setAuthError(getLocalizedSupabaseErrorMessage(error));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    authLog("logout理由: ユーザーが明示的にログアウトを実行");
    try {
      if (isSupabaseConfigured) {
        await signOutFromSupabase();
      }
    } catch (error) {
      setAuthError(getLocalizedSupabaseErrorMessage(error));
    } finally {
      window.localStorage.removeItem("salon-user");
      window.localStorage.removeItem("salon-role");
      // salon-goal-app-v2 is a single global (non-user-scoped) key — on a shared browser, a
      // subsequent different user's hydrate could otherwise read this account's cached appState
      // via readAppState()'s same-company fallback before their own fresh Supabase fetch lands.
      window.localStorage.removeItem(STORAGE_KEYS.appState);
      setCurrentUser(null);
      setCurrentRole("staff");
      setAuthMode("login");
      setActivePage("dashboard");
      setAppState(initialAppStateValue);
      setSyncStatus({ status: "idle", message: "同期待機中", timestamp: "", error: false });
      setAuthError("");
      setAuthSuccess("");
      // プロフィール取得エラー画面(authProfileLoadError)からの「ログアウトしてやり直す」
      // 経由でもここを通るため、必ずクリアする——さもないと明示的にログアウトした後も
      // そのエラー画面がcurrentUser===nullより先に表示され続けてしまう。
      setAuthProfileLoadError("");
    }
  };

  const canAccessCurrentPage = canAccessPage(currentRole, activePage);
  // 設定ページ削除(要件): activePageが今のロールで開けなくなった場合(例: 廃止したページ
  // "settings"が既に開かれた状態でアプリが更新された、権限が変更された等)に、行き止まりの
  // 「アクセス権限がありません」画面(AccessDenied、サイドメニューへ戻る導線が無い)へ
  // 誰も取り残されないようにする安全網。同じロールの初回ログイン時の遷移先
  // (resolveDefaultPage、NAV_ITEMS_BY_ROLEの先頭)へ自動的に切り替える——特定のページ名を
  // ハードコードしないため、将来別のページが同様の理由で廃止された場合にも同じ仕組みで
  // 安全に動作する。
  useEffect(() => {
    if (authLoading || !currentUser || canAccessCurrentPage) return;
    setActivePage(resolveDefaultPage(currentRole));
  }, [canAccessCurrentPage, authLoading, currentUser, currentRole]);
  const isAdminUser = isAdminRole(currentRole);

  // companyIdOverride: 加盟店連携(閲覧専用)で、自社のprofile.company_idではなく明示的に
  // 指定した別会社のデータを取得するための差し替え。company_adminのprofile.company_idは
  // 常に自社IDでtruthyなため、この引数が無いと絶対に自社データしか取得できない
  // (system_adminだけprofile.company_idがnullなので、たまたま既存の会社切替が機能していた)。
  // 未指定時は既存の全呼び出し箇所と完全に同じ挙動(profile.company_id優先)のまま。
  const hydrateFromSupabase = async ({ authUser, profile, tenantState, companyIdOverride }) => {
    if (!isSupabaseConfigured || !profile?.company_id || !authUser?.id) return;
    // このシグネチャの時点で「自分が最新の呼び出しである」ことを確定させる — 以降、
    // setAppStateで結果を適用する直前に hydrateRequestRef.current === requestId を確認し、
    // 自分より新しい呼び出しが既に始まっていれば、非同期処理が先に終わっても結果を捨てる。
    // 実際の判定・採番はresolveHydrateDispatch(storage.js、テスト済みの純粋関数)へ委譲する
    // ——「打ち切られる呼び出しは共有状態に一切触れない」という不変条件を、この関数の中に
    // 素朴なref比較として埋め込むのではなく、テストで直接検証できる形にするため。
    // finally節でのみ参照するためtry外で宣言する(=companyId/targetMonthが確定するまでは
    // nullのまま。ガードで早期returnした場合や、それより前で例外が出た場合はfinallyで
    // 何もクリアしない、という判定に使う)。
    let inFlightKey = null;
    try {
      // 診断ログ(要件4): role・authenticated company(profile.company_id)・viewing
      // company(companyIdOverride、加盟店閲覧中のみ本来と異なる値になる)・選択中店舗・
      // アクセス可能な店舗数を毎回記録する。パスワード・JWT・メールアドレス等は一切含めない
      // (含めているのはUUID・件数・店舗名のみ)。他ユーザーからの不具合報告時に、本人の
      // ブラウザのdevtools consoleからこのログを共有してもらうだけで、role・所属会社・
      // 表示中の会社・店舗数のズレを特定できるようにするためのもの。
      console.info("[sync-hydrate] start", {
        appVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev",
        authUserId: authUser?.id,
        profileId: profile?.id,
        role: profile?.role || currentRole,
        authenticatedCompanyId: profile?.company_id,
        viewingCompanyId: companyIdOverride || profile?.company_id,
        isViewingFranchise: Boolean(tenantState?.isViewingFranchise),
        selectedStore: tenantState?.selectedStore,
        selectedStoreId: tenantState?.selectedStoreId,
        selectedMonth: tenantState?.selectedMonth,
        availableStoreCount: (tenantState?.companies || []).find((item) => item.id === (companyIdOverride || profile?.company_id))?.stores?.length ?? null,
        attempt: hydrateRetryCountRef.current,
      });
      const companyId = companyIdOverride || profile.company_id || tenantState?.currentCompanyId || "";
      const company = (tenantState?.companies || []).find((item) => item.id === companyId) || (tenantState?.companies || [])[0] || null;

      // AI分析ON/OFF(companies.ai_analysis_enabled)はこの関数の対象外 — 独立した
      // aiAnalysisSettings state(getCompanyAiAnalysisSettings/updateCompanyAiAnalysisSetting
      // 経由)だけが扱う。tenant_snapshotにも、以降のcompanies配列にも含まれない。
      // Single source of truth for "which store is actually selected right now" — see
      // resolvePreferredStoreSelection's own comments. tenantState here IS the current appState
      // at every call site, so it doubles as both the fresh tenant data and the "local" selection
      // to preserve. Previously this block had its own inline copy of the same resolution logic
      // that never checked for ALL_STORES_VALUE, so it silently fell back to company.stores[0]
      // any time a company/system admin had "全店舗" selected — this ran on every hydrate
      // (store switch, tab/PWA focus regain, realtime change), which is what made "全店舗"
      // appear to work for a moment and then snap back to whichever store was first in the list.
      const { selectedStore: selectedStoreName, selectedStoreId: storeId } = resolvePreferredStoreSelection({
        tenantState,
        localRecoveredState: tenantState,
        currentCompanyId: companyId,
        role: profile?.role || currentRole,
      });
      const targetMonth = tenantState?.selectedMonth || new Date().toISOString().slice(0, 7);

      // company_id×対象月が完全一致する取得が既に進行中なら、ここで打ち切って先行呼び出しに
      // 任せる(店舗切替はキーに影響しない — 店舗を問わず常に会社全体を取得する設計のため、
      // 店舗だけが違う呼び出しは重複とみなす)。判定・採番はresolveHydrateDispatch(storage.js)
      // に委譲——打ち切られる場合はinFlightKey/requestCounterのどちらも変更しない値が返る
      // ため、この関数の共有状態(hydrateInFlightRef/hydrateRequestRef/syncStatus)には
      // 一切触れずに早期returnできる(過去2件の不具合の再発防止、詳細は同関数のコメント参照)。
      const candidateKey = `${companyId}::${targetMonth}`;
      const dispatch = resolveHydrateDispatch({
        currentInFlightKey: hydrateInFlightRef.current,
        candidateKey,
        currentRequestCounter: hydrateRequestRef.current,
      });
      if (!dispatch.shouldProceed) {
        return;
      }
      inFlightKey = dispatch.nextInFlightKey;
      hydrateInFlightRef.current = dispatch.nextInFlightKey;
      hydrateRequestRef.current = dispatch.nextRequestCounter;
      const requestId = dispatch.requestId;
      setSyncStatus({ status: "syncing", message: "同期中です…", timestamp: new Date().toISOString(), error: false });

      // daily_sales is the authoritative source for daily sales figures + day-closing state
      // (see upsertDailySalesEntry/updateDailySalesClosingState) — not the tenant_snapshots
      // blob below, which may still hold older copies for dates saved before this table was
      // wired up. Fetch a window wide enough for the dashboard/ranking view (current month +
      // the two prior months it compares against) across every store in the company at once;
      // RLS scopes the result to whichever stores this user can actually see. A failed fetch
      // here fails the whole hydrate (see catch block) rather than silently showing stale or
      // empty progress/ranking numbers.
      const dailySalesRange = getDailySalesQueryRange(targetMonth);
      const closingMonths = [targetMonth, getMonthOffset(targetMonth, -1), getMonthOffset(targetMonth, -2)];

      // パフォーマンス改善(ログイン〜売上画面表示の速度調査): 以下18件の取得は、この時点で
      // 既に確定しているcompanyId/dailySalesRange/closingMonthsだけを条件にしており、互いの
      // 取得結果に依存するものは1つも無い(=どれか1つの結果を条件に別の1つを取得している、
      // という依存関係が無い)。以前は1件ずつawaitする直列(ウォーターフォール)構造になって
      // おり、Supabaseとの往復レイテンシがそのまま18回分積み上がっていた——これがログイン後
      // 表示が遅い主因だったため、Promise.allで同時に発行し、合計待ち時間を「18回分の往復」
      // から「最も遅い1回分の往復」に近づける。エラー処理の意味は変えていない——
      // loadXForCompany系はSupabaseエラーをthrowせず{ok:false, error}で返す設計のため、
      // Promise.all自体はどの取得が失敗しても最後まで待って解決する(1つの失敗で残り17件が
      // 打ち切られることは無い)。取得後にこれまでと全く同じように個別へ`.ok`をチェックして
      // throwする(store_status_audit_log/company_settings/store_profiles/
      // store_input_settingsは元々ベストエフォート扱いで.okをチェックしていなかった——その
      // 扱いも変更していない)。
      const hydrateBatchStartedAt = (typeof performance !== "undefined" ? performance.now() : Date.now());
      const [
        dailySalesResult,
        cashBreakdownResult,
        batchEntriesResult,
        monthlyClosingsResult,
        monthlyTargetsResult,
        allStoresTargetsResult,
        storeHolidaysResult,
        allStoresHolidaysResult,
        fixedCostsResult,
        monthlyReviewsResult,
        storeStatusAuditLogResult,
        costMonthlyAmountsResult,
        storeInventoryBalancesResult,
        variableCostsResult,
        monthlyClosingItemsResult,
        companySettingsResult,
        storeProfilesResult,
        storeInputSettingsResult,
        storeMonthlyCostOverridesResult,
      ] = await Promise.all([
        // daily_sales is the authoritative source for daily sales figures + day-closing state
        // (see upsertDailySalesEntry/updateDailySalesClosingState) — not the tenant_snapshots
        // blob below, which may still hold older copies for dates saved before this table was
        // wired up. Fetch a window wide enough for the dashboard/ranking view (current month +
        // the two prior months it compares against) across every store in the company at once;
        // RLS scopes the result to whichever stores this user can actually see. A failed fetch
        // here fails the whole hydrate (see catch block) rather than silently showing stale or
        // empty progress/ranking numbers.
        timeHydrateQuery("dailySales", loadDailySalesForCompanyRange({ companyId, startDate: dailySalesRange.startDate, endDate: dailySalesRange.endDate })),
        // 日計(現金/キャッシュレス/ポイント利用の内訳)。daily_salesと同じ日付レンジで、
        // 完全に別テーブル・別のstateとして取得する — 総売上等の計算には一切混ざらない。
        timeHydrateQuery("cashBreakdown", loadDailyCashBreakdownForCompanyRange({ companyId, startDate: dailySalesRange.startDate, endDate: dailySalesRange.endDate })),
        // まとめて入力(daily_batch_entries)。daily_salesと同じ日付レンジで取得する
        // (start_date基準、end_dateは常に同一月内)。dailyResultsには絶対に混ぜない — 集計時に
        // calculateMonthSummary側で別途参照するだけの、完全に独立したstate。
        timeHydrateQuery("batchEntries", loadDailyBatchEntriesForCompanyRange({ companyId, startDate: dailySalesRange.startDate, endDate: dailySalesRange.endDate })),
        // Same reasoning for monthly_closings: it's the authoritative table now (see
        // upsertMonthlyClosingState), so a fresh device/session needs this fetched directly
        // instead of only ever reflecting whatever was last embedded in a tenant_snapshots row.
        timeHydrateQuery("monthlyClosings", loadMonthlyClosingsForCompany({ companyId, yearMonths: closingMonths })),
        // Same reasoning again for monthly_targets: without this, appState.targets was only ever
        // populated by the 月間目標設定 panel's own per-visit fetch for whichever store+month
        // *that panel* happens to be showing (a separate, independent month selector from this
        // one) — so the dashboard's target-based metrics could see a store/month as "no target
        // registered" simply because nobody had opened the target panel for it this session, not
        // because no target was actually ever saved. Reuses the same 3-month window as
        // monthly_closings above.
        timeHydrateQuery("monthlyTargets", loadMonthlyTargetsForCompany({ companyId, yearMonths: closingMonths })),
        // company_all_stores_targets (「全店舗」company_admin専用ビューの目標+営業日設定)。
        // store_idを持たず company_id 単位なので storeIdToName は不要。同じ3か月ウィンドウを
        // 使い、pruneStaleKeysで会社切り替え時に前の会社のキャッシュが残らないようにする。
        timeHydrateQuery("allStoresTargets", loadAllStoresTargetsForCompany({ companyId, yearMonths: closingMonths })),
        // 店休日(カレンダーの具体的な日付)。daily_salesと同じ日付レンジ(過去2か月+対象月)で
        // 取得する — 営業進捗/KPIが参照する期間と一致させるため。
        timeHydrateQuery("storeHolidays", loadStoreHolidaysForCompanyRange({ companyId, startDate: dailySalesRange.startDate, endDate: dailySalesRange.endDate })),
        timeHydrateQuery("allStoresHolidays", loadAllStoresHolidaysForCompanyRange({ companyId, startDate: dailySalesRange.startDate, endDate: dailySalesRange.endDate })),
        // fixed_costs (see 20260808000000_create_fixed_costs.sql): a "翌月以降も継続" item is
        // computed by looking backwards across every earlier month's entries for the store (see
        // getFixedCostsForStoreMonth), so — unlike monthly_targets/monthly_closings above — this
        // can't be windowed to a few recent months; fetch every fixed_costs row for the company.
        timeHydrateQuery("fixedCosts", loadFixedCostsForCompany({ companyId })),
        // monthly_reviews(月次レビューの自由記述4項目)。fixed_costsと同じ理由で月ウィンドウを
        // 設けず会社全体を丸ごと取得する — 対象月を過去へ切り替えても保存済みの文章が正しく
        // 復元される必要があるため(要件6)。
        timeHydrateQuery("monthlyReviews", loadMonthlyReviewsForCompany({ companyId })),
        // store_status_audit_log(店舗の停止/再開/アーカイブ/復元/削除の履歴)。RLSでcompany_admin/
        // system_admin以外には空配列が返る(store_manager/staffには非公開) — その場合
        // getStoreStatusAsOfDateは常にnullを返し、呼び出し側は現在のstores.statusだけで代替
        // 判定するため、失敗としては扱わない(結果を無視してよいベストエフォート情報)。
        timeHydrateQuery("storeStatusAuditLog", loadStoreStatusAuditLogForCompany({ companyId })),
        // cost_monthly_amounts (費用の対象月ごとの金額)。継続費用は「その月から有効になる金額」を
        // 履歴として引き継ぐ(getCostMonthlyAmount参照)ため、fixed_costsと同じ理由で3か月窓には
        // 絞れない(遡って参照する可能性のある行が窓の外にあり得る) — 会社の全件を取得する。
        timeHydrateQuery("costMonthlyAmounts", loadCostMonthlyAmountsForCompany({ companyId })),
        // store_inventory_balances (在庫管理ONの店舗の月末在庫/期首在庫) — direct month lookup,
        // no carry-forward, windowed the same as cost_monthly_amounts above.
        timeHydrateQuery("storeInventoryBalances", loadStoreInventoryBalancesForCompany({ companyId, yearMonths: closingMonths })),
        // variable_costs (販管費) and monthly_closing_items (月締め項目) — direct month lookup,
        // no carry-forward, so windowed the same as monthly_targets/monthly_closings above.
        timeHydrateQuery("variableCosts", loadVariableCostsForCompany({ companyId, yearMonths: closingMonths })),
        timeHydrateQuery("monthlyClosingItems", loadMonthlyClosingItemsForCompany({ companyId, yearMonths: closingMonths })),
        // company_settings (business type/currency/display prefs/tax settings/showOtherSales) —
        // a single row for the whole company. null when no row exists yet (brand-new company);
        // applyCompanySettingsToCompanies below falls back to the hardcoded defaults in that case,
        // same as before this table existed.
        timeHydrateQuery("companySettings", loadCompanySettings({ companyId })),
        // store_profiles (address/phone/manager/representative/hours/description/URLs/etc) —
        // keyed by store_id, one row per store, fetched company-wide alongside store_input_settings.
        timeHydrateQuery("storeProfiles", loadStoreProfilesForCompany({ companyId })),
        // store_input_settings (daily/monthly field visibility) is the authoritative source now
        // — see 20260807000000_create_store_input_settings.sql. Fetched company-wide alongside
        // daily_sales/monthly_closings above, then merged onto each store's settings object
        // below wherever appState.companies gets (re)built, the same way those other two tables
        // overlay onto dailyResults/dayClosingStates/monthClosingStatus.
        timeHydrateQuery("storeInputSettings", loadStoreInputSettingsForCompany({ companyId })),
        // store_monthly_cost_overrides(人件費・仕入の「その月だけの手動確定額」)。
        // cost_monthly_amountsと同じ理由(過去月の確定状態を正しく復元する必要がある)で
        // 3か月窓には絞らず会社の全件を取得する。
        timeHydrateQuery("storeMonthlyCostOverrides", loadStoreMonthlyCostOverridesForCompany({ companyId })),
      ]);
      console.info("[hydrate-query] total (Promise.all batch)", { durationMs: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - hydrateBatchStartedAt) });

      if (!dailySalesResult.ok) throw dailySalesResult.error || new Error("日次売上データの取得に失敗しました");
      const dailySalesState = buildDailyStateFromRows(dailySalesResult.data);

      if (!cashBreakdownResult.ok) throw cashBreakdownResult.error || new Error("日計データの取得に失敗しました");
      const cashBreakdownState = buildCashBreakdownStateFromRows(cashBreakdownResult.data);

      if (!batchEntriesResult.ok) throw batchEntriesResult.error || new Error("まとめて入力データの取得に失敗しました");
      const batchEntryState = buildBatchEntryStateFromRows(batchEntriesResult.data);

      if (!monthlyClosingsResult.ok) throw monthlyClosingsResult.error || new Error("月締めデータの取得に失敗しました");
      const monthClosingStatusOverlay = buildMonthClosingStateFromRows(monthlyClosingsResult.data);

      if (!monthlyTargetsResult.ok) throw monthlyTargetsResult.error || new Error("月間目標データの取得に失敗しました");
      const targetStateOverlay = buildTargetStateFromRows(monthlyTargetsResult.data);

      if (!allStoresTargetsResult.ok) throw allStoresTargetsResult.error || new Error("全店舗目標データの取得に失敗しました");
      const allStoresTargetStateOverlay = buildAllStoresTargetStateFromRows(allStoresTargetsResult.data);

      if (!storeHolidaysResult.ok) throw storeHolidaysResult.error || new Error("店休日データの取得に失敗しました");
      const storeHolidaysOverlay = buildStoreHolidaysStateFromRows(storeHolidaysResult.data);

      if (!allStoresHolidaysResult.ok) throw allStoresHolidaysResult.error || new Error("全店舗店休日データの取得に失敗しました");
      const allStoresHolidaysOverlay = buildAllStoresHolidaysStateFromRows(allStoresHolidaysResult.data);

      if (!fixedCostsResult.ok) throw fixedCostsResult.error || new Error("固定費データの取得に失敗しました");
      const fixedCostsOverlay = buildFixedCostsStateFromRows(fixedCostsResult.data);

      if (!monthlyReviewsResult.ok) throw monthlyReviewsResult.error || new Error("月次レビューデータの取得に失敗しました");
      const monthlyReviewsOverlay = buildMonthlyReviewStateFromRows(monthlyReviewsResult.data);

      const storeStatusAuditLogRows = (storeStatusAuditLogResult.data || []).map((row) => ({
        storeId: row.store_id,
        action: row.action,
        createdAt: row.created_at,
      }));

      if (!costMonthlyAmountsResult.ok) throw costMonthlyAmountsResult.error || new Error("費用の月次金額データの取得に失敗しました");
      const costMonthlyAmountsOverlay = buildCostMonthlyAmountsStateFromRows(costMonthlyAmountsResult.data);

      if (!storeInventoryBalancesResult.ok) throw storeInventoryBalancesResult.error || new Error("在庫データの取得に失敗しました");
      const storeInventoryBalancesOverlay = buildStoreInventoryBalancesStateFromRows(storeInventoryBalancesResult.data);

      if (!variableCostsResult.ok) throw variableCostsResult.error || new Error("販管費データの取得に失敗しました");
      const variableCostsOverlay = buildVariableCostsStateFromRows(variableCostsResult.data);

      if (!monthlyClosingItemsResult.ok) throw monthlyClosingItemsResult.error || new Error("月締め項目データの取得に失敗しました");
      const monthlyClosingItemsOverlay = buildMonthlyClosingItemsStateFromRows(monthlyClosingItemsResult.data);

      if (!storeMonthlyCostOverridesResult.ok) throw storeMonthlyCostOverridesResult.error || new Error("人件費・仕入の確定額データの取得に失敗しました");
      const storeMonthlyCostOverridesOverlay = buildStoreMonthlyCostOverridesStateFromRows(storeMonthlyCostOverridesResult.data);

      const companySettingsOverlay = buildCompanySettingsFromRow(companySettingsResult.data);
      const storeProfilesByStoreId = buildStoreProfilesByStoreId(storeProfilesResult.data);
      const storeInputSettingsByStoreId = Object.fromEntries(
        (storeInputSettingsResult.data || []).map((row) => [row.store_id, row])
      );
      // Applies every per-store/per-company Supabase-backed settings overlay in one pass: field
      // visibility (store_input_settings), profile fields (store_profiles), and company-wide
      // settings/tax/showOtherSales (company_settings) — all keyed by id, never by name.
      const applyStoreInputSettingsToCompanies = (companies) => (companies || []).map((company) => ({
        ...company,
        settings: company.id === companyId && companySettingsOverlay ? { ...company.settings, ...companySettingsOverlay.settings } : company.settings,
        stores: (company.stores || []).map((store) => {
          const inputRow = storeInputSettingsByStoreId[store.id];
          const profile = storeProfilesByStoreId[store.id];
          return {
            ...store,
            ...(profile || {}),
            settings: {
              ...(store.settings || createStoreSettingsDefaults()),
              hasInputSettingsRow: Boolean(inputRow),
              ...(inputRow ? {
                dailyFieldSettings: normalizeDailyFieldSettings(inputRow.daily_fields),
                monthlyTargetFields: normalizeMonthlyTargetFieldSettings(inputRow.monthly_target_fields),
                useInventoryTracking: Boolean(inputRow.use_inventory_tracking),
                useCashBreakdown: Boolean(inputRow.use_cash_breakdown),
                hiddenClosingCategories: normalizeHiddenClosingCategories(inputRow.hidden_closing_categories),
                laborCostMode: inputRow.labor_cost_mode === "sales_linked" ? "sales_linked" : "fixed",
                laborCostRate: Number(inputRow.labor_cost_rate) || 0,
                purchaseCostMode: inputRow.purchase_cost_mode === "sales_linked" ? "sales_linked" : "fixed",
                purchaseCostRate: Number(inputRow.purchase_cost_rate) || 0,
              } : {}),
            },
          };
        }),
      }));

      // mergeShallowMap/mergeItemArrayMap (used by mergeRemoteAppState below) only ever union
      // keys in — they never remove a key that exists in local/cached state but has no row in
      // this fresh Supabase fetch. Left alone, a value that was only ever a local/stale artifact
      // (old localStorage, a row since deleted from Supabase, a leftover from before a table
      // existed) would survive forever and get shown as if it were really registered. We just
      // authoritatively fetched every store × the last 3 months (or, for fixed_costs, every
      // month unbounded — see above), so for every key in that window we now know for certain
      // whether Supabase has a row. Build each domain's exact expected-key set once so
      // pruneStaleKeys (storage.js) can drop any impostor after the merge below — this is the
      // single mechanism every Supabase-backed map field in appState goes through, so a future
      // domain added the same way automatically gets the same protection.
      const windowedExpectedKeys = new Set();
      (company?.stores || []).forEach((store) => {
        closingMonths.forEach((month) => windowedExpectedKeys.add(buildMonthKey(store.id, month)));
      });
      // 「全店舗」目標/営業日設定は店舗ではなくcompany_id単位のキー。system_adminが会社を
      // 切り替えても前の会社の全店舗目標がローカルに残留しない(≒他社データ混在)よう、
      // ここで期待キーを明示してpruneStaleKeysの対象に含める。
      const companyMonthExpectedKeys = new Set(closingMonths.map((month) => buildCompanyMonthKey(companyId, month)));
      // fixed_costs has no month window (see above) — every key belonging to one of this
      // company's stores is inside the just-fetched, fully authoritative set. Used below for
      // fixedCosts' own per-item reconciliation (prunedFixedCosts) and by
      // costMonthlyAmountsExpectedKeysFor.
      const companyStoreIdPrefixes = (company?.stores || []).map((store) => `${store.id}__`);
      // cost_monthly_amounts is now fetched unbounded per company, like fixed_costs (see
      // loadCostMonthlyAmountsForCompany) — a continuing cost item's amount can carry forward
      // from any earlier month (getCostMonthlyAmount), so pruning to only the closingMonths
      // window would silently delete exactly the history that carry-forward depends on the next
      // time this device hydrates. Since the fetch is now fully authoritative for the company,
      // every key already present in the merged map (for a still-valid cost item id) is
      // "expected" — pruneStaleKeys then only drops a key if the fresh fetch confirms it no
      // longer exists in Supabase.
      const costMonthlyAmountsExpectedKeysFor = (mergedFixedCosts, mergedCostMonthlyAmounts) => {
        const costItemIds = new Set();
        Object.entries(mergedFixedCosts || {}).forEach(([key, items]) => {
          if (!companyStoreIdPrefixes.some((prefix) => key.startsWith(prefix))) return;
          (Array.isArray(items) ? items : []).forEach((item) => {
            if (item.id) costItemIds.add(item.id);
          });
        });
        return new Set(
          Object.keys(mergedCostMonthlyAmounts || {}).filter((key) => costItemIds.has(key.split("__")[0]))
        );
      };
      // monthly_reviewsも同じ理由(fixed_costsと同じく無制限取得)でwindowedExpectedKeysを
      // 使えない——ただしcostMonthlyAmountsと違い費用項目のような親子関係を経由する必要は無く、
      // 単純に「この会社の店舗キー、またはこの会社自身の全店舗キーに一致するローカルの既存
      // キー」がそのまま期待キーになる(companyStoreIdPrefixesは上のfixedCosts処理で既に
      // 定義済みのものを再利用する)。
      const monthlyReviewsExpectedKeysFor = (mergedMonthlyReviews) => new Set(
        Object.keys(mergedMonthlyReviews || {}).filter((key) => companyStoreIdPrefixes.some((prefix) => key.startsWith(prefix)) || key.startsWith(`${companyId}__`))
      );
      // store_monthly_cost_overridesもcost_monthly_amounts/monthly_reviewsと同じく会社全体を
      // 無制限取得している(過去月の確定額を月ウィンドウの外でも正しく復元する必要があるため)。
      // キー形状は`${storeId}__${targetMonth}`(storeInventoryBalancesと同じ)だが、windowed
      // ExpectedKeysは対象月ウィンドウ限定のため使えない — monthlyReviewsExpectedKeysForと
      // 同じ考え方で、この会社の店舗プレフィックスに一致する既存キーを丸ごと期待キーとする。
      const storeMonthlyCostOverridesExpectedKeysFor = (mergedStoreMonthlyCostOverrides) => new Set(
        Object.keys(mergedStoreMonthlyCostOverrides || {}).filter((key) => companyStoreIdPrefixes.some((prefix) => key.startsWith(prefix)))
      );
      const applyDailySalesOverlay = (state) => {
        const merged = mergeRemoteAppState(state, {
          dailyResults: dailySalesState.dailyResults,
          dayClosingStates: dailySalesState.dayClosingStates,
          dayClosingUpdatedAt: dailySalesState.dayClosingUpdatedAt,
          dailyBatchEntries: batchEntryState.dailyBatchEntries,
          monthClosingStatus: monthClosingStatusOverlay,
          // saveHolidayCount/saveManualBusinessDayCount/resetBusinessDaySetting (the 営業日設定
          // quick-edit on the daily entry page) now persist to monthly_targets via
          // persistBusinessDaySetting, the same columns buildTargetStateFromRows already parses
          // into businessDaySettings here — so this overlay must include it too, or a fresh
          // hydrate (login/reload) would silently revert to the auto-calculated default even
          // though the quick-edit value was genuinely saved.
          targets: targetStateOverlay.targets,
          businessDaySettings: targetStateOverlay.businessDaySettings,
          allStoresTargets: allStoresTargetStateOverlay.allStoresTargets,
          allStoresBusinessDaySettings: allStoresTargetStateOverlay.allStoresBusinessDaySettings,
          storeHolidays: storeHolidaysOverlay.storeHolidays,
          allStoresHolidays: allStoresHolidaysOverlay.allStoresHolidays,
          // company_id単位の単純な配列で、月ウィンドウ・pruneStaleKeysの対象外(fixedCostsの
          // ような店舗+月キー構造ではないため) — 毎回の取得結果でそのまま置き換える
          // (mergeRemoteAppStateの `...remoteState` 展開により自動的に「remote優先」になる)。
          storeStatusAuditLog: storeStatusAuditLogRows,
          fixedCosts: fixedCostsOverlay.fixedCosts,
          monthlyReviews: monthlyReviewsOverlay.monthlyReviews,
          costMonthlyAmounts: costMonthlyAmountsOverlay.costMonthlyAmounts,
          storeInventoryBalances: storeInventoryBalancesOverlay.storeInventoryBalances,
          storeMonthlyCostOverrides: storeMonthlyCostOverridesOverlay.storeMonthlyCostOverrides,
          cashBreakdownResults: cashBreakdownState.cashBreakdownResults,
          variableCosts: variableCostsOverlay.variableCosts,
          monthClosing: monthlyClosingItemsOverlay.monthClosing,
          // company_settings also carries the global showOtherSales toggle and taxSettings —
          // both top-level appState fields, not nested under companies. Only overlay them when
          // a row actually exists (companySettingsOverlay is null for a brand-new company that
          // has never saved settings yet), so a not-yet-registered company still falls through
          // to createInitialAppState's defaults instead of being forced to false/0.1 here too.
          ...(companySettingsOverlay ? {
            preferences: { ...state.preferences, showOtherSales: companySettingsOverlay.showOtherSales },
            taxSettings: companySettingsOverlay.taxSettings,
          } : {}),
        });
        // daily_sales itself: prune any date within the just-fetched range that Supabase no
        // longer has a row for (entries outside the fetched date range are left untouched —
        // we simply don't know their status).
        const prunedDailyResults = { ...merged.dailyResults };
        const prunedDayClosingStates = { ...merged.dayClosingStates };
        const prunedDayClosingUpdatedAt = { ...merged.dayClosingUpdatedAt };
        Object.keys(prunedDailyResults).forEach((key) => {
          if (!companyStoreIdPrefixes.some((prefix) => key.startsWith(prefix))) return;
          const freshDates = new Set((dailySalesState.dailyResults[key] || []).map((entry) => entry.date));
          prunedDailyResults[key] = (prunedDailyResults[key] || []).filter((entry) => {
            const withinFetchedWindow = entry.date >= dailySalesRange.startDate && entry.date <= dailySalesRange.endDate;
            return !withinFetchedWindow || freshDates.has(entry.date);
          });
          if (prunedDayClosingStates[key]) {
            const nextClosingDates = { ...prunedDayClosingStates[key] };
            Object.keys(nextClosingDates).forEach((date) => {
              const withinFetchedWindow = date >= dailySalesRange.startDate && date <= dailySalesRange.endDate;
              if (withinFetchedWindow && !freshDates.has(date)) delete nextClosingDates[date];
            });
            prunedDayClosingStates[key] = nextClosingDates;
          }
          if (prunedDayClosingUpdatedAt[key]) {
            const nextTimestamps = { ...prunedDayClosingUpdatedAt[key] };
            Object.keys(nextTimestamps).forEach((date) => {
              const withinFetchedWindow = date >= dailySalesRange.startDate && date <= dailySalesRange.endDate;
              if (withinFetchedWindow && !freshDates.has(date)) delete nextTimestamps[date];
            });
            prunedDayClosingUpdatedAt[key] = nextTimestamps;
          }
        });
        // 日計も同じ日付レンジ・同じキー形式(storeId__month -> {[date]: {...}})なので、
        // dailyResultsと全く同じ「取得済みレンジ内でSupabaseに存在しない日付だけ削る」
        // ロジックをそのまま適用する。dailyResults側とは完全に別のオブジェクトなので、
        // 万一片方の削除処理にバグがあってももう片方には影響しない。
        const prunedCashBreakdownResults = { ...merged.cashBreakdownResults };
        Object.keys(prunedCashBreakdownResults).forEach((key) => {
          if (!companyStoreIdPrefixes.some((prefix) => key.startsWith(prefix))) return;
          const freshCashBreakdownDates = new Set(Object.keys(cashBreakdownState.cashBreakdownResults[key] || {}));
          const nextDates = { ...(prunedCashBreakdownResults[key] || {}) };
          Object.keys(nextDates).forEach((date) => {
            const withinFetchedWindow = date >= dailySalesRange.startDate && date <= dailySalesRange.endDate;
            if (withinFetchedWindow && !freshCashBreakdownDates.has(date)) delete nextDates[date];
          });
          prunedCashBreakdownResults[key] = nextDates;
        });
        // まとめて入力(daily_batch_entries)。dailyResultsと同じ「取得済みレンジ内で
        // Supabaseに存在しないものだけ削る」ロジックだが、1日単位ではなくid単位で判定する
        // (まとめ入力は1レコード=1期間なので、日付ではなくidの有無で「今も存在するか」を
        // 判定するのが自然)。
        const prunedDailyBatchEntries = { ...merged.dailyBatchEntries };
        Object.keys(prunedDailyBatchEntries).forEach((key) => {
          if (!companyStoreIdPrefixes.some((prefix) => key.startsWith(prefix))) return;
          const freshBatchIds = new Set((batchEntryState.dailyBatchEntries[key] || []).map((entry) => entry.id));
          prunedDailyBatchEntries[key] = (prunedDailyBatchEntries[key] || []).filter((entry) => {
            const withinFetchedWindow = entry.startDate >= dailySalesRange.startDate && entry.startDate <= dailySalesRange.endDate;
            return !withinFetchedWindow || freshBatchIds.has(entry.id);
          });
        });
        // fixed_costs(費用項目、継続/単月・期間限定とも)。会社全体を無制限取得しているため
        // (loadFixedCostsForCompany参照)、このキー(店舗)に属するものは常にidベースで「今も
        // Supabaseに存在するか」を判定できる。これが無いと、削除した費用項目がローカル/
        // localStorageに残っている限り、次回以降のhydrate(月変更・再読み込み・再ログイン等)の
        // たびにmergeItemArrayMapのunionマージで復活し続けてしまう不具合になっていた
        // (pruneStaleKeysはキー(店舗+月)全体の要不要しか判定できず、同じキーの配列内に他の
        // 項目が1件でも残っていると、削除済みの項目ごと配列全体をそのまま素通りさせてしまう
        // ため — 不具合修正、詳細はpruneDeletedItemsFromItemArrayMap参照)。
        const prunedFixedCosts = pruneDeletedItemsFromItemArrayMap(merged.fixedCosts, fixedCostsOverlay.fixedCosts, companyStoreIdPrefixes);
        return {
          ...merged,
          dailyResults: prunedDailyResults,
          dayClosingStates: prunedDayClosingStates,
          dayClosingUpdatedAt: prunedDayClosingUpdatedAt,
          cashBreakdownResults: prunedCashBreakdownResults,
          dailyBatchEntries: prunedDailyBatchEntries,
          targets: pruneStaleKeys(merged.targets, windowedExpectedKeys, targetStateOverlay.targets),
          allStoresTargets: pruneStaleKeys(merged.allStoresTargets, companyMonthExpectedKeys, allStoresTargetStateOverlay.allStoresTargets),
          allStoresBusinessDaySettings: pruneStaleKeys(merged.allStoresBusinessDaySettings, companyMonthExpectedKeys, allStoresTargetStateOverlay.allStoresBusinessDaySettings),
          storeHolidays: pruneStaleKeys(merged.storeHolidays, windowedExpectedKeys, storeHolidaysOverlay.storeHolidays),
          allStoresHolidays: pruneStaleKeys(merged.allStoresHolidays, companyMonthExpectedKeys, allStoresHolidaysOverlay.allStoresHolidays),
          fixedCosts: prunedFixedCosts,
          // costMonthlyAmounts keys are `${costItemId}__${targetMonth}`, not `${storeId}__${month}`,
          // so windowedExpectedKeys (built from store ids) can't be reused here — build the
          // expected set from this company's own cost item ids (just resolved via the fixedCosts
          // merge above), unbounded across every month (see costMonthlyAmountsExpectedKeysFor).
          costMonthlyAmounts: pruneStaleKeys(merged.costMonthlyAmounts, costMonthlyAmountsExpectedKeysFor(merged.fixedCosts, merged.costMonthlyAmounts), costMonthlyAmountsOverlay.costMonthlyAmounts),
          monthlyReviews: pruneStaleKeys(merged.monthlyReviews, monthlyReviewsExpectedKeysFor(merged.monthlyReviews), monthlyReviewsOverlay.monthlyReviews),
          // storeInventoryBalances keys are `${storeId}__${targetMonth}` — the same shape
          // windowedExpectedKeys already uses, so it can be reused directly (unlike costMonthlyAmounts).
          storeInventoryBalances: pruneStaleKeys(merged.storeInventoryBalances, windowedExpectedKeys, storeInventoryBalancesOverlay.storeInventoryBalances),
          storeMonthlyCostOverrides: pruneStaleKeys(merged.storeMonthlyCostOverrides, storeMonthlyCostOverridesExpectedKeysFor(merged.storeMonthlyCostOverrides), storeMonthlyCostOverridesOverlay.storeMonthlyCostOverrides),
          variableCosts: pruneStaleKeys(merged.variableCosts, windowedExpectedKeys, variableCostsOverlay.variableCosts),
          monthClosing: pruneStaleKeys(merged.monthClosing, windowedExpectedKeys, monthlyClosingItemsOverlay.monthClosing),
        };
      };

      const snapshotResult = await loadLatestTenantSnapshot({ companyId, storeId, targetMonth, createdBy: authUser.id });
      if (!snapshotResult.ok) {
        // A failed fetch must never be treated as "no data exists" — throw so the outer
        // catch block runs (leaves syncInitialized false, schedules a retry) instead of
        // falling through to the empty-state branch below.
        throw snapshotResult.error || new Error("同期データの取得に失敗しました");
      }
      const snapshot = snapshotResult.data;
      console.info("[sync-hydrate] snapshot", {
        authUserId: authUser?.id,
        companyId,
        storeId,
        targetMonth,
        found: Boolean(snapshot),
        snapshotId: snapshot?.id || null,
        snapshotCreatedBy: snapshot?.created_by || null,
        snapshotUpdatedAt: snapshot?.updated_at || null,
      });
      if (!snapshot?.payload) {
        const fallbackState = normalizeAppState(readAppState());
        // Only the broad "...fallbackState" spread (dailyResults/etc from localStorage) is
        // conditional on there actually being cached data worth folding in — companies/users/
        // currentCompanyId below must NEVER be gated behind this same check. A brand-new
        // session with no local dailyResults cache and no tenant_snapshot row (a freshly
        // restored-from-backup company, or simply a brand-new onboarding with no daily entry
        // yet) previously took the "prev unchanged" branch entirely, which skipped
        // applyStoreInputSettingsToCompanies — so store_input_settings/company_settings/
        // store_profiles never made it into appState.companies on that very first hydrate, even
        // though the row existed correctly in Supabase all along. Confirmed via a live
        // fresh-session-after-restore test.
        const hasLocalFallbackCache = Boolean(fallbackState && Object.keys(fallbackState.dailyResults || {}).length);
        const noSnapshotCompanies = applyStoreInputSettingsToCompanies(tenantState?.companies?.length ? tenantState.companies : (fallbackState.companies || []));
        if (hydrateRequestRef.current !== requestId) return;
        setAppState((prev) => {
          let merged = mergeRemoteAppState(prev, {
            ...(hasLocalFallbackCache ? fallbackState : {}),
            // companies/users must always reflect the just-fetched stores/profiles tables,
            // never a possibly-stale localStorage cache — see the identical fix below for
            // why letting a cached list win here silently breaks store_id resolution.
            companies: noSnapshotCompanies,
            users: tenantState?.users?.length ? tenantState.users : (fallbackState.users || []),
            currentCompanyId: companyIdOverride || profile?.company_id || prev.currentCompanyId || companyId,
            currentUserId: profile?.id || prev.currentUserId || "",
            currentAuthUserId: profile?.auth_user_id || authUser.id || prev.currentAuthUserId || "",
            // 同じ理由(下のhas-snapshot分岐と同じコメント参照)でisViewingFranchise/
            // homeCompanyIdBeforeFranchiseViewも明示的にtenantState由来を優先させる —
            // ...fallbackStateのローカルキャッシュ由来の値に依存しない。
            isViewingFranchise: Boolean(tenantState?.isViewingFranchise),
            homeCompanyIdBeforeFranchiseView: tenantState?.isViewingFranchise ? (tenantState?.homeCompanyIdBeforeFranchiseView || "") : "",
          });
          merged = applyDailySalesOverlay(merged);
          writeAppState(merged);
          return merged;
        });
        setSyncStatus({ status: "idle", message: "同期データはまだありません", timestamp: new Date().toISOString(), error: false });
        hydrateRetryCountRef.current = 0;
        setSyncInitialized(true);
        return;
      }
      const remoteState = normalizeAppState(snapshot.payload);
      // Prefer whatever store/month the user is actually looking at right now; the fetched
      // snapshot may be the freshest one in the company but tagged for a different store
      // (its payload still carries every store's data), and we don't want a background
      // sync to yank the UI over to a store the user didn't select.
      // id-first, reusing storeId/selectedStoreName (resolved id-first above, same reasoning as
      // their own comment there) rather than re-deriving from the raw tenantState/remoteState
      // *name* here — two stores sharing a display name would otherwise let this fall through
      // to a name lookup and silently resolve to the wrong store's id.
      const resolvedSelectedStoreId = storeId
        || company?.stores?.find((item) => item.name === (tenantState?.selectedStore || remoteState.selectedStore || ""))?.id
        || "";
      const resolvedSelectedStore = company?.stores?.find((item) => item.id === resolvedSelectedStoreId)?.name
        || selectedStoreName
        || remoteState.selectedStore
        || "";
      const resolvedSelectedMonth = tenantState?.selectedMonth || targetMonth || remoteState.selectedMonth || new Date().toISOString().slice(0, 7);
      const nextRemoteState = {
        ...remoteState,
        // companies/users must always come from tenantState (the fresh companies/stores/
        // profiles/user_stores fetch this same hydrate just ran), never from this snapshot's
        // embedded copy. loadLatestTenantSnapshot picks whichever row is freshest for the
        // company+month *across every store* (it has no per-store scoping at all), so the
        // snapshot on hand here can easily be one that was last saved while looking at a
        // different store — its embedded companies/stores list is then stale by however long
        // it's been since THAT store was last touched, not this one. Store_id resolution
        // (resolveTargetCompanyAndStore, the ranking view's currentCompanyStores, etc.) reads
        // straight from appState.companies, so a stale entry here silently redirects every
        // write for a store to whatever id happened to be embedded in someone else's save —
        // this was reproducible for whichever store hadn't been the most recently saved one.
        companies: applyStoreInputSettingsToCompanies(tenantState?.companies?.length ? tenantState.companies : (remoteState.companies || [])),
        users: tenantState?.users?.length ? tenantState.users : (remoteState.users || []),
        companySnapshots: remoteState.companySnapshots || (tenantState?.companySnapshots || {}),
        currentCompanyId: companyIdOverride || remoteState.currentCompanyId || tenantState?.currentCompanyId || companyId || "",
        // currentUserId/currentAuthUserId must ALWAYS be this session's own identity — never the
        // snapshot's. tenant_snapshots is a company-wide blob that whichever user last saved
        // wrote, embedding *their* currentUserId; preferring remoteState.currentUserId here (as
        // this used to) silently hijacked every other user's session onto the last-saver's
        // identity on the next hydrate (which runs on focus/visibility/realtime-change — i.e.
        // constantly), corrupting created_by/updated_by attribution and, for staff, causing
        // every subsequent daily_sales write to be rejected by RLS since created_by no longer
        // matched their own auth session. Confirmed live via a store_manager session whose
        // currentUserId flipped to a different admin's profile id after one hydrate cycle.
        currentUserId: profile.id || tenantState?.currentUserId || remoteState.currentUserId || "",
        currentAuthUserId: profile.auth_user_id || authUser.id || tenantState?.currentAuthUserId || remoteState.currentAuthUserId || "",
        selectedStore: resolvedSelectedStore,
        selectedStoreId: resolvedSelectedStoreId,
        selectedMonth: resolvedSelectedMonth,
        // 同じクラスのバグ: isViewingFranchise/homeCompanyIdBeforeFranchiseViewもtenant_snapshots
        // の生ペイロード由来のremoteStateへ含めていなかったため、上の"...remoteState"展開経由で
        // 加盟店(閲覧対象)自身の過去のスナップショット(その会社のユーザーが普段使っている
        // 状態なので、当然isViewingFranchise: falseが埋め込まれている)にこの2フィールドが
        // 上書きされてしまい、「加盟店を開いた直後にisViewingFranchiseがfalseへ戻り、
        // 店舗プルダウンが自社ではなくcurrentCompanyId(=加盟店)の店舗一覧を表示してしまう」
        // 不具合の直接の原因になっていた。呼び出し元が明示的に渡したtenantStateの値を
        // 必ず優先させる。
        isViewingFranchise: Boolean(tenantState?.isViewingFranchise),
        homeCompanyIdBeforeFranchiseView: tenantState?.isViewingFranchise ? (tenantState?.homeCompanyIdBeforeFranchiseView || "") : "",
      };
      if (hydrateRequestRef.current !== requestId) return;
      // 「更新中」無限点滅バグの根本原因(修正済み、詳細はstorage.jsのbuildPersistenceComparable
      // State/canonicalStringifyForComparisonのコメント参照): ここは以前、比較用シグネチャを
      // overlay適用前のnextRemoteStateから作っていたため、実際にappStateへ入るmerged(overlay
      // 適用後、常により多くのデータを含む)とは構造的に一致し得ず、hydrateのたびに自動保存
      // effectが「変化あり」と誤検知→tenant_snapshotsへ書き込み→Realtimeが自分の書き込みを
      // 検知して再hydrate→また誤検知……という自己増殖ループになっていた。
      //
      // setAppStateへ関数(updater)ではなく値を直接渡す形に変更した——updater関数の中身は
      // Reactが次のレンダー時に呼ぶため呼び出し時点では実行されず、直後にmergedを参照する
      // ことができない(このeffect自身、focus/pageshow再取得、Realtime再取得の各所が既に
      // 採用している「appStateRef.current(常に最新)をprev代わりに使う」パターンと合わせる)。
      const merged = applyDailySalesOverlay(mergeRemoteAppState(appStateRef.current, nextRemoteState));
      writeAppState(merged);
      setAppState(merged);
      lastPersistedRef.current = canonicalStringifyForComparison(buildPersistenceComparableState(merged));
      setSyncStatus({ status: "loaded", message: "同期データを読み込みました", timestamp: new Date().toISOString(), error: false });
      console.info("[sync-hydrate] success", {
        authenticatedCompanyId: profile?.company_id,
        viewingCompanyId: companyIdOverride || profile?.company_id,
        selectedStoreId: merged.selectedStoreId,
        availableStoreCount: (merged.companies || []).find((item) => item.id === merged.currentCompanyId)?.stores?.length ?? null,
      });
      hydrateRetryCountRef.current = 0;
      setSyncInitialized(true);
    } catch (error) {
      // Deliberately do NOT set syncInitialized(true) here. That flag is what gates the
      // autosave effect (see its `!syncInitialized` guard) — flipping it on a failed fetch
      // was the exact "open screen → state is empty → autosave fires → overwrites real
      // Supabase data → THEN the real fetch finally lands" race this app was vulnerable to.
      // Leaving it false blocks all outgoing writes until a hydrate genuinely succeeds.
      logSupabaseError({ operation: "hydrateFromSupabase", table: "tenant_snapshots", userId: authUser?.id, companyId: companyIdOverride || profile?.company_id, storeId: tenantState?.selectedStore, error });
      console.info("[sync-hydrate] failure", {
        authenticatedCompanyId: profile?.company_id,
        viewingCompanyId: companyIdOverride || profile?.company_id,
        attempt: hydrateRetryCountRef.current + 1,
      });
      const reason = getSupabaseErrorMessage(error);
      // 「更新中です…」が数分間解除されない不具合の緊急修正: 以前はここで「同期エラー:
      // ${reason}」を出していたが、この文言を実際に画面へ表示するUIが無かったため
      // (syncStatus.status==="syncing"の時だけnotice-boxを出す作りで、"error"用の表示が
      // 存在しなかった)、失敗してもユーザーには何も伝わらず、数秒後に始まる自動リトライの
      // 「更新中です…」が繰り返し出ては消える(=実質「更新中のまま止まっている」ように
      // 見える)状態になっていた。1回目の失敗の時点で「自動的に再試行しています」という
      // 安定した(リトライのたびにチラつかない)文言を出し、かつ下のJSXでこのstatus="error"
      // を実際に表示するようにする——上のfetchWithTimeout(15秒)により、この時点までの
      // 経過時間は最大でも約15秒に収まる。
      setSyncStatus({ status: "error", message: "データの取得に時間がかかっています。自動的に再試行しています…", timestamp: new Date().toISOString(), error: true });
      if (hydrateRetryTimerRef.current) {
        window.clearTimeout(hydrateRetryTimerRef.current);
      }
      const attempt = hydrateRetryCountRef.current + 1;
      hydrateRetryCountRef.current = attempt;
      // 無限更新防止(要件2): RLS拒否・権限不整合・ネットワーク断など、再試行しても解消しない
      // 種類の失敗だと、この上限が無い場合はsetTimeoutの再帰呼び出しが15秒間隔で永久に続き、
      // 「更新中」→エラー→「更新中」→エラー……を無限に繰り返す(今回のバナー無限点滅バグとは
      // 別経路だが、同じ「無限リトライ」という不具合の型)。一定回数で自動リトライを止め、
      // 手動での復旧(再読み込み・store切替等の明示的な操作による再hydrate)に委ねる。
      if (attempt > HYDRATE_MAX_AUTO_RETRY_ATTEMPTS) {
        console.error("[sync-hydrate] giving up after max retries", { attempt, reason });
        setSyncStatus({
          status: "error",
          message: "データの取得に時間がかかっています。ページを再読み込みしてください。",
          timestamp: new Date().toISOString(),
          error: true,
        });
        return;
      }
      const delayMs = Math.min(3000 * attempt, 15000);
      hydrateRetryTimerRef.current = window.setTimeout(() => {
        void hydrateFromSupabase({ authUser, profile, tenantState, companyIdOverride });
      }, delayMs);
    } finally {
      // 自分がhydrateInFlightRefへ書き込んだ本人である場合だけクリアする — resolveHydrate
      // Dispatchがshould Proceed:falseを返して早期returnした場合、inFlightKeyは初期値の
      // nullのまま(実際に取得へ進むと確定した呼び出しだけがdispatch.nextInFlightKeyを代入
      // する)ため、ここでは何もしない。万一、自分の完了までの間に別のキーで新しい呼び出しが
      // 既にrefを上書きしていた場合も、そのキーを誤って消さない(===で厳密に一致した時だけ
      // クリア)。
      if (inFlightKey && hydrateInFlightRef.current === inFlightKey) {
        hydrateInFlightRef.current = null;
      }
    }
  };

  const persistTenantState = (nextState) => {
    const normalizedCompanies = (nextState.companies || []).map((company) => ({
      ...company,
      settings: company.settings || createCompanySettingsDefaults(),
      setup: company.setup || { company: false, store: false, admin: false, settings: false, complete: false },
      stores: (company.stores || []).map((store) => ({ ...store, settings: store.settings || createStoreSettingsDefaults() })),
    }));
    const persisted = {
      ...nextState,
      currentCompanyId: nextState.currentCompanyId || currentUser?.company_id || "",
      currentUserId: nextState.currentUserId || currentUser?.profileId || "",
      currentAuthUserId: nextState.currentAuthUserId || currentUser?.authUserId || "",
      companies: normalizedCompanies,
      users: (nextState.users || []).map((user) => ({
        ...user,
        invitationStatus: user.invitationStatus || "active",
        primaryStoreId: user.primaryStoreId || user.storeIds?.[0] || "",
        loginCount: Number(user.loginCount || 0),
        inviteExpiresAt: user.inviteExpiresAt || "",
      })),
      // Keyed off the same resolved companyId as currentCompanyId above (never a fabricated
      // placeholder id) — companySnapshots keys can end up feeding back into
      // appState.currentCompanyId via applyCompanySnapshot, so a fake id here could
      // reintroduce exactly the "invalid input syntax for type uuid" bug this was other half of.
      companySnapshots: { ...(nextState.companySnapshots || {}), [nextState.currentCompanyId || currentUser?.company_id || ""]: nextState },
    };
    writeAppState(persisted);
    setAppState(persisted);
  };

  const persistToSupabase = async (nextState) => {
    if (!isSupabaseConfigured) {
      setSyncStatus({ status: "idle", message: "同期未対応", timestamp: new Date().toISOString(), error: false });
      return { ok: false, skipped: true };
    }
    if (!nextState?.currentCompanyId || !nextState?.currentUserId) {
      setSyncStatus({ status: "idle", message: "ログイン後に同期を開始します", timestamp: new Date().toISOString(), error: false });
      return { ok: true, skipped: true };
    }
    // resolveCurrentCompanyと同じ「id一致のみ、フォールバックなし」ロジック
    // (見つからなければnextStateはスキップ対象——下のif (!company...)で正しく弾かれる)。
    const company = resolveCurrentCompany(nextState.companies, nextState.currentCompanyId);
    // Id-first, same reasoning as everywhere else this pattern appears: a stale selectedStore
    // name must never make this tag a snapshot with the wrong store's id.
    const store = (nextState.selectedStoreId && company?.stores?.find((item) => item.id === nextState.selectedStoreId))
      || company?.stores?.find((item) => item.name === nextState.selectedStore)
      || company?.stores?.[0]
      || null;
    const user = (nextState.users || []).find((item) => item.id === nextState.currentUserId);
    if (!company || !store || !user) {
      setSyncStatus({ status: "idle", message: "同期対象データが未準備です", timestamp: new Date().toISOString(), error: false });
      return { ok: true, skipped: true };
    }
    setSyncStatus({ status: "syncing", message: "同期中です…", timestamp: new Date().toISOString(), error: false });
    // statement timeout不具合の調査で判明: 保存(tenant_snapshotsへのUPSERT)が一時的な
    // 通信断・DB側の瞬間的な混雑等で失敗した場合、自動保存の呼び出し元
    // (runPersistToSupabase)はlastPersistedRefを既に「保存試行済み」として更新済みのため、
    // 利用者が別の変更をしない限り再試行が二度と起きなかった(=一時的な失敗がそのまま
    // 恒久的な未保存状態になっていた)。ここで最大2回まで短い間隔(2秒→4秒)で自動再試行
    // する——無限リトライは行わず、それでも失敗した場合だけ最終的なエラーとして扱う。
    // 実際に取得すべきデータ(売上・費用等)はどれも個別テーブル経由の別の保存処理で
    // 完結しており、この再試行はtenant_snapshots(高速初期表示・劣化フォールバック専用の
    // 二次キャッシュ)だけに閉じた話——再試行中に他の操作をブロックすることはない
    // (呼び出し元は結果をawaitするだけで、画面は既に通常操作可能な状態のまま)。
    const PERSIST_MAX_ATTEMPTS = 3;
    const PERSIST_RETRY_DELAYS_MS = [2000, 4000];
    const persistTargetMonth = nextState.selectedMonth || new Date().toISOString().slice(0, 7);
    let result = null;
    for (let attempt = 1; attempt <= PERSIST_MAX_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now();
      result = await upsertTenantSnapshot({ company, store, user, appState: nextState, targetMonth: persistTargetMonth });
      // 診断ログ(statement timeout調査の再発防止): どの保存呼び出しがどれだけ処理時間を
      // 要したか・成功したかを、開発者コンソールから直接追えるようにする——今回の不具合は
      // 「店舗切替のたびに数MBのJSONをUPDATEしていた」ことが原因だったが、その症状(処理
      // 時間の異常な長さ)がconsoleから見えていなかった。company_id/store_id/対象月に加え、
      // 実際に送信したJSONペイロードのおおよそのサイズ(バイト数)も記録する——次に同種の
      // 問題が起きた場合、このログだけで「肥大化したデータのUPDATEが原因かどうか」を
      // 即座に切り分けられるようにするため。
      console.info("[persist-tenant-snapshot]", {
        companyId: company.id,
        storeId: store.id,
        targetMonth: persistTargetMonth,
        attempt,
        durationMs: Date.now() - startedAt,
        ok: result.ok,
        skipped: Boolean(result.skipped),
        // 実際にSupabaseへ送信するJSON payload(buildTenantSnapshotRowが組み立てた後の、
        // 軽量フィールドだけを含む形)のおおよそのバイト数。appState全体のサイズではない
        // ——statement timeout不具合の原因(肥大化したpayload)を今後も直接監視できるように、
        // 実際に送る値そのものを測る。
        payloadBytes: (() => {
          try { return JSON.stringify(buildTenantSnapshotRow({ company, store, user, appState: nextState, targetMonth: persistTargetMonth }).payload).length; } catch { return null; }
        })(),
      });
      if (result.ok || result.skipped) break;
      if (attempt < PERSIST_MAX_ATTEMPTS) {
        console.warn("[persist-retry] upsertTenantSnapshot failed, retrying", { attempt, reason: result?.error?.message });
        await new Promise((resolve) => window.setTimeout(resolve, PERSIST_RETRY_DELAYS_MS[attempt - 1]));
      }
    }
    if (!result.ok || result.skipped) {
      // 実機で発生した"canceling statement due to statement timeout"のような生のPostgres
      // エラー文が画面上部へそのまま表示されていた不具合の修正。getSupabaseErrorMessage
      // (日本語を含まない生のエラー文は一般的な文言へ差し替える)を経由させる——詳細は
      // console.warnに残るため、原因調査は引き続き可能。
      const reason = result?.error ? getSupabaseErrorMessage(result.error) : "不明な理由";
      console.warn("Supabase sync skipped", { reason, result });
      // 自動再試行後もなお失敗した場合だけ、ここへ到達する(上のループで最大2回再試行済み)。
      setSyncStatus({ status: "error", message: `同期に失敗しました(自動で再試行しましたが解決しませんでした): ${reason}`, timestamp: new Date().toISOString(), error: true });
      return result;
    }
    setSyncStatus({ status: "synced", message: "同期済み", timestamp: new Date().toISOString(), error: false });
    return result;
  };

  // 状態上書き防止の共通ヘルパー(販売前総合チェックで発見): 会社/店舗/ユーザー管理系の保存
  // 処理の多くが、Supabaseへの書き込みをawaitした後、await前に閉じ込めた(その時点で既に
  // 古い可能性がある)appState/currentCompanyを基にnextStateを組み立てていた。その待ち時間
  // 中に他タブ・他ユーザーの操作(Realtime再取得、フォーカス復帰時の再取得等)が割り込むと、
  // その更新がここで静かに巻き戻される——cross-month date bugと同じ種類のバグが、会社/店舗/
  // ユーザー管理という別の画面群に残っていたもの。修正方針は、await後にnextStateを組み立てる
  // 直前で必ずappStateRef.current(常に最新、hydrateFromSupabaseの各呼び出し元(フォーカス
  // 復帰・Realtime購読・selectedMonth変化時)が既に使っているのと同じref)から会社を
  // 再解決すること。個別に書き直すのではなく、この1つのヘルパーを全箇所から呼ぶ形に統一する。
  const getLatestCompanyById = (companyId) => (appStateRef.current.companies || []).find((company) => company.id === companyId) || null;

  // 二重送信防止(販売前総合チェックで発見): 本処理はhandleSaveCompanyInnerへそのまま残し、
  // このラッパーがrunWithSaveGuard(savingCompanyRef)による同期ガード+companyFormBusy
  // (ボタンのdisabled/ラベル表示用)の付与だけを担う——他の新規追加分(まとめて入力・
  // ユーザー招待)と同じ形にする。
  const handleSaveCompany = () => runWithSaveGuard(savingCompanyRef, async () => {
    setCompanyFormBusy(true);
    try {
      await handleSaveCompanyInner();
    } finally {
      setCompanyFormBusy(false);
    }
  });

  const handleSaveCompanyInner = async () => {
    if (!canManageCompany(currentRole)) {
      setNotice("会社作成はシステム管理者または会社管理者が実行できます");
      return;
    }

    const normalizedName = companyForm.name.trim();
    if (!normalizedName) return;
    const existingCompany = (appState.companies || []).find((company) => company.id === companyEditId) || null;
    // 会社コードは人が入力するものではなく自動生成(要件) — 既存会社を編集する場合は既存の
    // コードを絶対に変更しない。新規作成時だけ生成する。
    const normalizedCode = existingCompany?.code || generateCompanyCode();

    try {
      let createdCompany = null;
      if (!existingCompany) {
        // createdByProfileId(会社作成者を自動的にそのcompany_adminへ昇格させる仕組み)は
        // 意図的に渡さない — 会社を作ったsystem_admin自身がその会社のcompany_adminに
        // なってしまう(=最上位権限者が入れ替わってしまう)不具合になっていた。会社作成後は
        // 下でcurrentCompanyIdが自動的に新会社へ切り替わるため、最初のcompany_adminは
        // そのままユーザー管理画面の「ユーザー招待」から招待すればよい(会社管理画面に
        // 重複した招待導線は置かない — 要件2)。
        createdCompany = await createCompanyRecord({
          name: normalizedName,
          code: normalizedCode,
          contractStatus: companyForm.contractStatus || "trial",
        });
      }

      const companyId = existingCompany?.id || createdCompany?.id || `company-${normalizedCode.replace(/\s+/g, "-")}`;
      const nextCompany = {
        id: companyId,
        name: normalizedName,
        code: normalizedCode,
        isActive: existingCompany?.isActive ?? true,
        contractStatus: companyForm.contractStatus || existingCompany?.contractStatus || "trial",
        businessType: companyForm.businessType || existingCompany?.businessType || "salon",
        startedAt: existingCompany?.startedAt || new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        setup: existingCompany?.setup || { company: true, store: false, admin: false, settings: false, complete: false },
        settings: { ...createCompanySettingsDefaults(), ...(existingCompany?.settings || {}), ...(companySettingsForm || {}), businessType: companyForm.businessType || existingCompany?.businessType || "salon" },
        stores: existingCompany?.stores || [],
      };
      // 状態上書き防止(会社作成時はここまでにawait createCompanyRecordを挟んでいるため、
      // appStateRef.currentから最新状態を読み直す——getLatestCompanyById参照)。
      const latestAppState = appStateRef.current;
      const nextState = {
        ...latestAppState,
        companies: existingCompany ? (latestAppState.companies || []).map((company) => (company.id === companyId ? nextCompany : company)) : [...(latestAppState.companies || []), nextCompany],
        currentCompanyId: companyId,
        companySnapshots: {
          ...(latestAppState.companySnapshots || {}),
          [companyId]: {
            ...(latestAppState.companySnapshots?.[companyId] || createInitialAppState()),
            stores: nextCompany.stores.map((store) => store.name),
            selectedStore: nextCompany.stores[0]?.name || "",
            selectedStoreId: nextCompany.stores[0]?.id || "",
            selectedMonth: new Date().toISOString().slice(0, 7),
          },
        },
      };
      persistTenantState(nextState);
      setCompanyForm({ name: "", code: "", contractStatus: "trial", businessType: "salon" });
      setCompanyEditId("");
    } catch (error) {
      setNotice(getSupabaseErrorMessage(error));
    }
  };

  const handleSaveStore = async () => {
    if (guardFranchiseReadOnly()) return;
    const companyId = appState.currentCompanyId;
    const existingStore = currentCompany?.stores?.find((store) => store.id === storeEditId) || null;
    // Creating/deleting/archiving stores stays company_admin/system_admin-only
    // (canManageStore). Editing an existing store's own name is additionally allowed for a
    // store_manager, but only for a store they're actually assigned to (allowedStoreIds) —
    // never for an arbitrary other store in the company.
    const canEditThisStore = existingStore
      ? canEditStoreName(currentRole) && (canManageStore(currentRole) || allowedStoreIds.includes(existingStore.id))
      : canManageStore(currentRole);
    if (!canEditThisStore) {
      const message = existingStore ? "この店舗の編集権限がありません" : "店舗作成はシステム管理者または会社管理者が実行できます";
      setNotice(message);
      setStoreFormStatus({ status: "error", message });
      return;
    }
    if (!storeForm.name.trim()) {
      setStoreFormStatus({ status: "error", message: "店舗名を入力してください" });
      return;
    }
    // 誤操作による意図しない2店舗目・3店舗目の作成を防ぐ確認(要件1)。新規作成時のみが
    // 対象 — 既存店舗の編集(名称変更等)は別処理なので対象外。既存の運用中店舗が1件でも
    // あれば必ず確認を挟み、既存店舗名・追加しようとしている店舗名の両方を見せることで、
    // 「切り替えたつもりが実は新規作成だった」という取り違えに気づけるようにする。名称が
    // 似ている場合(要件: 完全一致・大文字小文字・全角半角・スペース違い・「本店」等の
    // 接尾辞違い)は、既存店舗の編集で対応すべきでは、という文言を追加してさらに強く
    // 警告する — ただし本当に別店舗の可能性もあるため、作成自体は禁止しない。
    if (!existingStore) {
      const existingActiveStores = (currentCompany?.stores || []).filter((store) => store.status !== "archived");
      // 同一会社内での重複作成防止(店舗追加時の重複防止、要件1)。会社初回セットアップ画面
      // (needsFirstStoreSetup/showInitialSetup)もこの関数を共有しているため、新規作成経路が
      // どこであってもここで一律にブロックする。完全一致(表記ゆれレベル)の場合は確認
      // ダイアログすら出さず明確に拒否する——「店舗を追加」ボタンの新設カードと同じ判定
      // (normalizeStoreNameForDuplicateCheck)。
      const exactDuplicateStore = existingActiveStores.find((store) => normalizeStoreNameForDuplicateCheck(store.name) === normalizeStoreNameForDuplicateCheck(storeForm.name));
      if (exactDuplicateStore) {
        const message = `「${exactDuplicateStore.name}」という店舗が既に登録されています。同じ店舗を重複して作成することはできません。この店舗の設定を変更したい場合は「店舗基本設定」から編集してください。`;
        setStoreFormStatus({ status: "error", message });
        setNotice(message);
        return;
      }
      if (existingActiveStores.length > 0) {
        const newNameNormalized = normalizeStoreNameForSimilarity(storeForm.name);
        const similarStore = existingActiveStores.find((store) => normalizeStoreNameForSimilarity(store.name) === newNameNormalized);
        const existingNamesText = existingActiveStores.map((store) => store.name).join("\n");
        const message = similarStore
          ? `既存の「${similarStore.name}」と名称が似ています。\n\n既存店舗の設定(スタッフ数・生産性計算人数・営業日など)を変更したい場合は、新規店舗を作成せず「店舗設定」から編集してください。\n\n現在登録されている店舗：\n${existingNamesText}\n\n新しく追加する店舗：\n${storeForm.name.trim()}\n\n本当に別店舗として追加しますか？\nOKで別店舗として追加します。キャンセルすると追加は行われません。`
          : `この会社にはすでに店舗が登録されています。新しい店舗を追加しますか？\n\n既存店舗：\n${existingNamesText}\n\n追加する店舗：\n${storeForm.name.trim()}\n\nOKで新しい別店舗として追加します。キャンセルすると追加は行われません。`;
        if (!window.confirm(message)) return;
      }
    }
    if (savingStoreRef.current) return;
    savingStoreRef.current = true;

    setStoreFormStatus({ status: "saving", message: "" });
    try {
      let createdStore = null;
      if (!existingStore) {
        // code is a legacy NOT NULL UNIQUE column with no functional role anymore — every
        // actual lookup/data-linking goes through the store's id (see buildMonthKey and the
        // rest of this file). Auto-generating it here means the user never has to see or type
        // it, and — critically — two stores sharing the same display name (even across
        // companies) can never collide on it the way deriving it from the name used to risk.
        createdStore = await createStoreRecord({ companyId, name: storeForm.name.trim(), code: crypto.randomUUID() });
      } else {
        const nextName = storeForm.name.trim();
        if (nextName !== existingStore.name) {
          const renameResult = await updateStoreRecord({ storeId: existingStore.id, name: nextName });
          if (!renameResult?.ok && !renameResult?.skipped) {
            throw renameResult.error || new Error("店舗名の更新に失敗しました");
          }
        }
      }
      // No locally-fabricated fallback id here on purpose: createStoreRecord throws on any
      // failure (caught below), so existingStore/createdStore are the only legitimate sources
      // for a store's id. A store id that never actually exists in the stores table would
      // silently fail every subsequent daily_sales/monthly_targets write for it via FK/RLS —
      // exactly the class of bug this whole store_id audit is trying to eliminate.
      const storeId = existingStore?.id || createdStore?.id;
      if (!storeId) {
        throw new Error("店舗IDを取得できませんでした");
      }
      // The store management screen only ever collects 店舗名 now (see the STORE PROFILE →
      // simple STORE section above) — storeForm no longer has real values for any of these
      // other fields. Sourcing them from existingStore instead of storeForm means renaming a
      // store never clobbers whatever profile data it already had in Supabase; a brand-new
      // store simply has no existingStore to read from, so these stay blank defaults, which is
      // correct (nothing was ever entered for it).
      const nextStore = {
        id: storeId,
        name: storeForm.name.trim(),
        code: existingStore?.code || createdStore?.code || "",
        companyId,
        postalCode: existingStore?.postalCode || "",
        address: existingStore?.address || "",
        phone: existingStore?.phone || "",
        managerName: existingStore?.managerName || "",
        representativeName: existingStore?.representativeName || "",
        openingDate: existingStore?.openingDate || "",
        openingHour: existingStore?.openingHour || "09:00",
        closingHour: existingStore?.closingHour || "20:00",
        closedDays: existingStore?.closedDays || "月",
        businessHours: existingStore?.businessHours || "09:00-20:00",
        description: existingStore?.description || "",
        website: existingStore?.website || "",
        instagram: existingStore?.instagram || "",
        googleMapUrl: existingStore?.googleMapUrl || "",
        serviceTypes: existingStore?.serviceTypes || [],
        urls: existingStore?.urls || [],
        status: existingStore?.status || "active",
        isActive: existingStore?.isActive !== false,
        // 店舗名と同じく、このフォームで実際に編集できる項目なので existingStore ではなく
        // storeForm から取るのが基本(他のプロフィール項目のように「画面に無いので既存値を
        // 維持」ではない)。ただし新規作成では未入力=0が正しい一方、既存店舗の編集時に
        // フォームが空欄(何らかの理由でstoreForm.staffCountが未設定)だと、意図せず既存の
        // 在籍スタッフ数が0へ上書きされてしまう — 編集時は空欄を「変更なし」として扱い、
        // existingStoreの現在値を保持する(新規作成時はexistingStoreが無いので従来通り0)。
        staffCount: storeForm.staffCount.trim() !== "" ? parseNumber(storeForm.staffCount) : (existingStore?.staffCount || 0),
        productivityStaffCount: storeForm.productivityStaffCount.trim() !== "" ? parseNumber(storeForm.productivityStaffCount) : (existingStore?.productivityStaffCount || 0),
        settings: { ...createStoreSettingsDefaults(), ...(existingStore?.settings || {}), ...(storeSettingsForm || {}) },
      };
      if (isSupabaseConfigured) {
        // store_profiles is keyed by store_id, never by name — this is the fix for the profile
        // fields (address/phone/manager/etc) that previously only ever lived in local React
        // state and got silently reset to blank on every hydrate, since stores/companies have
        // no columns for them at all.
        const profileResult = await upsertStoreProfile({ companyId, storeId, userId: appState.currentUserId, profile: nextStore });
        if (!profileResult.ok) {
          throw profileResult.error || new Error("店舗プロフィールの保存に失敗しました");
        }
      }
      // 状態上書き防止(ここまでにupsertStoreProfile等をawaitしているため、appStateRef.current
      // から最新状態を読み直す——getLatestCompanyById参照)。
      const latestAppState = appStateRef.current;
      const latestCompany = getLatestCompanyById(companyId);
      const nextCompany = {
        ...latestCompany,
        stores: existingStore
          ? (latestCompany?.stores || []).map((store) => (store.id === existingStore.id ? nextStore : store))
          : [...(latestCompany?.stores || []), nextStore],
        setup: { ...(latestCompany?.setup || {}), store: true },
      };
      // Renaming a store no longer needs to rekey anything: every per-store/month map is keyed
      // by the store's stable id (buildMonthKey), which a rename never changes. Only the display
      // name embedded in companySnapshots needs updating, alongside its paired selectedStoreId
      // (which was already correct and doesn't change either, but must stay explicitly set here
      // — see applyCompanySnapshot, which restores this pair verbatim on the next company switch).
      const nextState = {
        ...latestAppState,
        companies: (latestAppState.companies || []).map((company) => (company.id === companyId ? nextCompany : company)),
        companySnapshots: {
          ...(latestAppState.companySnapshots || {}),
          [companyId]: {
            ...(latestAppState.companySnapshots?.[companyId] || createInitialAppState()),
            stores: nextCompany.stores.map((store) => store.name),
            selectedStore: nextStore.name,
            selectedStoreId: nextStore.id,
          },
        },
      };
      persistTenantState(nextState);
      // 「店舗を切り替えただけ」なのか「新しい店舗を作成した」のかが紛らわしくならない
      // よう、新規作成時は文言を明確に分ける(要件3)。フォーム近くのstoreFormStatusに加え、
      // 見落としにくい画面上部のsetNoticeバナーでも同じ内容を出す。
      if (existingStore) {
        // 「店舗基本設定」(現在選択中の店舗を編集するカード)の保存はここに来る——保存後も
        // フォームを空にしない。空にすると「現在の店舗：〇〇店」の表示が一瞬消えて
        // 「また店舗を追加する画面」に見えてしまう(初期設定「店舗情報」重複整理の要件2)。
        setStoreFormStatus({ status: "saved", message: `${nextStore.name} を更新しました` });
      } else {
        // 新規作成は現在では専用のhandleCreateNewStore経由になったため通常この分岐には
        // 来ないが、念のため既存の後方互換の挙動(フォームを空に戻す)を残しておく。
        setStoreForm(createStoreFormDefaults());
        setStoreEditId("");
        setStoreFormStatus({ status: "saved", message: `${nextStore.name} を新しい店舗として追加しました` });
        setNotice(`${nextStore.name} を新しい店舗として追加しました`);
      }
    } catch (error) {
      // console.error here (not just the UI notice) so the real cause is visible in devtools
      // even if a future UI change makes the notice easy to miss — this exact failure mode
      // (an error that fired but gave no visible sign anything went wrong) is what prompted
      // adding storeFormStatus in the first place.
      console.error("handleSaveStore failed", error);
      // DB側の最終防御(stores_company_id_normalized_name_unique、handleCreateNewStoreの
      // catchと同じ理由)。
      const message = (error?.code === "23505" && /stores_company_id_normalized_name_unique/.test(error?.message || ""))
        ? "同じ名前の店舗が既に登録されています。同じ店舗を重複して作成することはできません。この店舗の設定を変更したい場合は「店舗基本設定」から編集してください。"
        : getSupabaseErrorMessage(error);
      setNotice(message);
      setStoreFormStatus({ status: "error", message });
    } finally {
      savingStoreRef.current = false;
    }
  };

  // 「店舗追加」専用、最小限の新規作成フロー(初期設定「店舗情報」の重複整理、要件1・7)。
  // 独立したnewStoreName状態だけを使い、「店舗基本設定」(storeForm/storeEditId、常に現在
  // 選択中の既存店舗を指す)とは一切状態を共有しない——同じ入力フォームを新規作成・既存編集
  // 両方に流用しない。ここで登録するのは店舗名のみ(要件: 最低限、店舗名を登録)。在籍
  // スタッフ数等は店舗作成後に「店舗基本設定」から設定する。
  const handleCreateNewStore = async () => {
    if (guardFranchiseReadOnly()) return;
    if (!canManageStore(currentRole)) {
      setNotice("店舗作成はシステム管理者または会社管理者が実行できます");
      return;
    }
    const trimmedName = newStoreName.trim();
    if (!trimmedName) {
      setNewStoreFormStatus({ status: "error", message: "店舗名を入力してください" });
      return;
    }
    // 同一会社内での重複作成防止(要件1)。前後空白・全角半角・大文字小文字の表記ゆれを
    // 吸収した上で完全に同じ店舗名が既に存在する場合は、確認ダイアログではなく明確に
    // ブロックする——「INTRO」「INTRO 」「intro」等を意図せず別店舗として重複作成させない。
    // これはクライアント側の一次防御で、ボタン連打・複数端末からの同時作成に対しては
    // DB側のユニークインデックス(stores_company_id_normalized_name_unique)が最終防御となる
    // (下のcatchで23505を捕捉して同じ文言に翻訳する)。
    const existingActiveStores = (currentCompany?.stores || []).filter((store) => store.status !== "archived");
    const exactDuplicateNormalized = normalizeStoreNameForDuplicateCheck(trimmedName);
    const exactDuplicateStore = existingActiveStores.find((store) => normalizeStoreNameForDuplicateCheck(store.name) === exactDuplicateNormalized);
    if (exactDuplicateStore) {
      const message = `「${exactDuplicateStore.name}」という店舗が既に登録されています。同じ店舗を重複して作成することはできません。この店舗の設定を変更したい場合は「店舗基本設定」から編集してください。`;
      setNewStoreFormStatus({ status: "error", message });
      setNotice(message);
      return;
    }
    // 誤操作による意図しない2店舗目・3店舗目の作成を防ぐ確認(handleSaveStoreの既存の
    // 確認ロジックと同じ意図・同じ文言パターン)。完全一致(上で既にブロック済み)ではないが、
    // 「本店」等の接尾辞違いなど紛らわしい名前は、作成自体は止めずに一度確認する。
    if (existingActiveStores.length > 0) {
      const newNameNormalized = normalizeStoreNameForSimilarity(trimmedName);
      const similarStore = existingActiveStores.find((store) => normalizeStoreNameForSimilarity(store.name) === newNameNormalized);
      const existingNamesText = existingActiveStores.map((store) => store.name).join("\n");
      const message = similarStore
        ? `既存の「${similarStore.name}」と名称が似ています。\n\n既存店舗の設定(スタッフ数・生産性計算人数・営業日など)を変更したい場合は、新規店舗を作成せず「店舗基本設定」から編集してください。\n\n現在登録されている店舗：\n${existingNamesText}\n\n新しく追加する店舗：\n${trimmedName}\n\n本当に別店舗として追加しますか？\nOKで別店舗として追加します。キャンセルすると追加は行われません。`
        : `この会社にはすでに店舗が登録されています。新しい店舗を追加しますか？\n\n既存店舗：\n${existingNamesText}\n\n追加する店舗：\n${trimmedName}\n\nOKで新しい別店舗として追加します。キャンセルすると追加は行われません。`;
      if (!window.confirm(message)) return;
    }
    if (savingStoreRef.current) return;
    savingStoreRef.current = true;
    setNewStoreFormStatus({ status: "saving", message: "" });
    try {
      const companyId = appState.currentCompanyId;
      const createdStore = await createStoreRecord({ companyId, name: trimmedName, code: crypto.randomUUID() });
      const storeId = createdStore?.id;
      if (!storeId) throw new Error("店舗IDを取得できませんでした");
      // 新規店舗の入力設定の初期値(要件: 技術売上/店販売上/来店客数/新規客数/再来客数=ON、
      // メモ/口コミ数/その他売上=OFF、在庫管理=OFF)。既存店舗のグローバルフォールバック
      // (defaultDailyFieldSettings, memo=trueのまま)とは意図的に別の値——新規作成時のみ
      // 明示的に指定する。
      const newStoreDailyFieldSettings = {
        mode: "custom",
        fields: { technicalSales: true, retailSales: true, customers: true, newCustomers: true, repeatCustomers: true, memo: false, reviewCount: false, otherSales: false },
      };
      const nextStore = {
        id: storeId,
        name: trimmedName,
        code: createdStore?.code || "",
        companyId,
        postalCode: "", address: "", phone: "", managerName: "", representativeName: "",
        openingDate: "", openingHour: "09:00", closingHour: "20:00", closedDays: "月", businessHours: "09:00-20:00",
        description: "", website: "", instagram: "", googleMapUrl: "", serviceTypes: [], urls: [],
        status: "active", isActive: true, staffCount: 0, productivityStaffCount: 0,
        settings: { ...createStoreSettingsDefaults(), dailyFieldSettings: newStoreDailyFieldSettings, useInventoryTracking: false, hasInputSettingsRow: true },
      };
      if (isSupabaseConfigured) {
        const profileResult = await upsertStoreProfile({ companyId, storeId, userId: appState.currentUserId, profile: nextStore });
        if (!profileResult.ok) throw profileResult.error || new Error("店舗プロフィールの保存に失敗しました");
        const inputSettingsResult = await upsertStoreInputSettings({ companyId, storeId, dailyFields: newStoreDailyFieldSettings, useInventoryTracking: false });
        if (!inputSettingsResult.ok) throw inputSettingsResult.error || new Error("入力設定の初期化に失敗しました");
      }
      // 状態上書き防止(ここまでにcreateStoreRecord/upsertStoreProfileをawaitしているため、
      // appStateRef.currentから最新状態を読み直す)。
      const latestAppState = appStateRef.current;
      const latestCompany = getLatestCompanyById(companyId);
      const nextCompany = {
        ...latestCompany,
        stores: [...(latestCompany?.stores || []), nextStore],
        setup: { ...(latestCompany?.setup || {}), store: true },
      };
      const nextState = {
        ...latestAppState,
        companies: (latestAppState.companies || []).map((company) => (company.id === companyId ? nextCompany : company)),
        // 作成直後にその新しい店舗へ切り替える——「追加した店舗がどこにあるか分からない」を
        // 避け、続けて「店舗基本設定」でスタッフ数等を設定したい場合にもそのまま繋がる。
        selectedStore: nextStore.name,
        selectedStoreId: nextStore.id,
        companySnapshots: {
          ...(latestAppState.companySnapshots || {}),
          [companyId]: {
            ...(latestAppState.companySnapshots?.[companyId] || createInitialAppState()),
            stores: nextCompany.stores.map((store) => store.name),
            selectedStore: nextStore.name,
            selectedStoreId: nextStore.id,
          },
        },
      };
      persistTenantState(nextState);
      setNewStoreName("");
      setNewStoreFormStatus({ status: "saved", message: `${nextStore.name} を新しい店舗として追加しました` });
      setNotice(`${nextStore.name} を新しい店舗として追加しました`);
    } catch (error) {
      console.error("handleCreateNewStore failed", error);
      // DB側の最終防御(stores_company_id_normalized_name_unique)に引っかかった場合——
      // クライアント側の事前チェックはローカルのappState.companiesを見ているだけなので、
      // ボタン連打や複数端末からの同時作成でこの一意制約違反(23505)へ実際に到達し得る。
      // 生のPostgresエラーではなく、上のクライアント側チェックと同じ文言へ翻訳する。
      const message = (error?.code === "23505" && /stores_company_id_normalized_name_unique/.test(error?.message || ""))
        ? "同じ名前の店舗が既に登録されています。同じ店舗を重複して作成することはできません。この店舗の設定を変更したい場合は「店舗基本設定」から編集してください。"
        : getSupabaseErrorMessage(error);
      setNotice(message);
      setNewStoreFormStatus({ status: "error", message });
    } finally {
      savingStoreRef.current = false;
    }
  };

  // 二重送信防止(販売前総合チェックで発見: 従来は下のuserFormBusyというReact stateだけの
  // 早期returnガードで、連打・スマホの二重タップ時に2回目の呼び出しがまだ更新前(false)の
  // stateを見て素通りし得た)。本処理はhandleSaveUserInnerへそのまま残し、このラッパーが
  // runWithSaveGuard(savingUserInviteRef)による同期ガードを追加する——userFormBusy自体
  // (ボタンのdisabled/ラベル表示用)はhandleSaveUserInner側で既存どおり管理する。
  const handleSaveUser = () => runWithSaveGuard(savingUserInviteRef, handleSaveUserInner);

  const handleSaveUserInner = async () => {
    if (!canManageUsers(currentRole)) {
      setNotice("ユーザー招待はシステム管理者・会社管理者・店長が実行できます");
      return;
    }
    if (!userForm.name.trim() || !userForm.email.trim()) return;
    const normalizedEmail = userForm.email.trim().toLowerCase();
    setUserFormBusy(true);
    try {
      // 重複判定不具合の修正(誤った店舗への招待削除後に再招待できない不具合):
      // 以前はappState.users(ログイン時にしか再取得しないローカルキャッシュ——system_admin
      // の場合は全社分のユーザーが1つの配列に混在する)を対象に、company_idを見ずに単純な
      // email一致だけで判定していた。そのため (a) 他デバイス/他タブでの削除がこのセッションに
      // 反映されていない場合や、(b) 削除済みだが古いキャッシュが残っている場合、(c) そもそも
      // 別会社の招待でしかない場合まで「招待済み」として誤ってブロックしていた。
      // 送信直前にSupabaseへ直接問い合わせて判定する(RLSがそのまま適用されるため、
      // company_admin/store_managerは自社の行しか見えず、他社の行との衝突はそもそも
      // 検知できない——その場合はcreateUserProfileRecord側のDB一意制約違反の翻訳
      // メッセージが最終防御になる)。
      const existingResult = await checkExistingProfilesByEmail({ email: normalizedEmail });
      const duplicateClassification = classifyEmailDuplicateForInvite({ existingRows: existingResult.data || [], currentCompanyId: appState.currentCompanyId });
      if (duplicateClassification) {
        setNotice(duplicateClassification.message);
        return;
      }
      await handleSaveUserCreate({ normalizedEmail });
    } finally {
      setUserFormBusy(false);
    }
  };

  const handleSaveUserCreate = async ({ normalizedEmail }) => {
    const normalizedCurrentRole = normalizeRole(currentRole);
    // Both the assignable role set and the assignable store set are clamped here to exactly
    // what this inviter is allowed to hand out — system_admin/company_admin/store_manager each
    // get progressively narrower — mirroring (and defense-in-depth alongside) the
    // profiles_insert_company_scoped / user_stores_insert_company_scoped RLS policies, which are
    // the actual enforcement (see 20260809000000_invite_flow_hardening.sql). A store_manager can
    // only ever invite staff into a store they themselves are assigned to; company_admin can
    // invite within their own company but never system_admin.
    const invitableRoles = getInvitableRoles(normalizedCurrentRole);
    const role = invitableRoles.includes(userForm.role) ? userForm.role : (invitableRoles[invitableRoles.length - 1] || "staff");
    const companyId = appState.currentCompanyId;
    const inviterStoreIds = normalizedCurrentRole === "store_manager" ? allowedStoreIds : currentCompanyStores.map((store) => store.id);
    const inviteTokenValue = createInviteToken();
    const inviteLink = buildInviteLink(typeof window !== "undefined" && window.location?.origin ? window.location.origin : "", inviteTokenValue);
    const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const requestedStoreIds = role === "company_admin"
      ? []
      : (userForm.storeIds.length ? userForm.storeIds : (inviterStoreIds[0] ? [inviterStoreIds[0]] : [])).filter((storeId) => inviterStoreIds.includes(storeId));
    const requestedPrimaryStoreId = role === "company_admin" ? "" : (inviterStoreIds.includes(userForm.primaryStoreId) ? userForm.primaryStoreId : (requestedStoreIds[0] || ""));

    // userFormBusyのon/offは呼び出し元のhandleSaveUser側で一括管理する(重複判定の
    // Supabase問い合わせ中もボタンを無効化し続けるため)。ここでは二重にtrue/falseしない。
    try {
      // Account creation is deliberately NOT done here: this used to call signUpWithEmail with a
      // hardcoded "password123" the moment an admin clicked 招待する, which (a) left every
      // not-yet-registered invite reachable by anyone who guessed that password, and (b) meant
      // the invitee's *real* signup later silently failed ("already registered") and they ended
      // up "logged in" only in local React state with no actual Supabase session, so nothing
      // they entered ever saved. The profile row (role/company/store already fully set here) is
      // all that's created now; the real auth account is created only when the invitee
      // themselves completes registration via accept-invite (see handleSignUp).
      const createdProfile = await createUserProfileRecord({
        name: userForm.name.trim(),
        email: normalizedEmail,
        role,
        companyId,
        storeIds: requestedStoreIds,
        primaryStoreId: requestedPrimaryStoreId,
        authUserId: null,
        invitationStatus: "invited",
        inviteToken: inviteTokenValue,
        inviteExpiresAt,
      });

      const nextUser = {
        id: createdProfile?.id || `user-${Date.now()}`,
        name: userForm.name.trim(),
        email: normalizedEmail,
        role,
        companyId,
        storeIds: requestedStoreIds,
        primaryStoreId: requestedPrimaryStoreId,
        isActive: true,
        invitationStatus: "invited",
        lastLoginAt: "",
        loginCount: 0,
        inviteExpiresAt,
        inviteToken: inviteTokenValue,
        inviteLink,
        authUserId: createdProfile?.auth_user_id || "",
      };
      // 状態上書き防止(ここまでにcreateUserProfileRecordをawaitしているため、
      // appStateRef.currentから最新状態を読み直す)。
      const nextState = {
        ...appStateRef.current,
        users: [...(appStateRef.current.users || []), nextUser],
      };
      persistTenantState(nextState);
      setUserForm({ name: "", email: "", role: invitableRoles[invitableRoles.length - 1] || "staff", storeIds: [], primaryStoreId: "", invitationStatus: "invited", loginCount: 0, lastLoginAt: "", isActive: true });

      // The profile row (role/company/store) is already fully set up at this point — sending
      // the actual email is a separate step that can genuinely fail (Supabase mail service
      // error, rate limit, etc), so its result must not be silently folded into the "招待しま
      // した" success message above. The invite itself (and the copy-able link, for sharing
      // through another channel if email delivery is ever unavailable) still exists either way.
      if (isSupabaseConfigured) {
        const emailResult = await sendInviteEmail({
          token: inviteTokenValue,
          redirectOrigin: typeof window !== "undefined" && window.location?.origin ? window.location.origin : "",
        });
        if (!emailResult.ok) {
          // send-invite-emailはメール送信に失敗した場合、profiles.invitation_statusを
          // サーバー側で"pending"(メール未送信)に更新済み(要件6: 作成成功/送信失敗を
          // 明確に分離する) — ローカル状態もそれに合わせておく(次回ハイドレートを待たず
          // 一覧の表示が即座に正しくなるように)。
          // 状態上書き防止+潜在的な重複バグの修正: 直前のpersistTenantState(nextState)で
          // 既にnextUserがusers配列へ追加済みのため、ここでクロージャの古いappStateを基に
          // [...appState.users, nextUser]を再度スプレッドすると、appStateRef.currentが
          // 既に更新されている場合には重複追加になり得る(このawaitの間に他の更新が挟まれば
          // 尚更)。appStateRef.current(常に最新)から該当ユーザーをmapで更新する形にする。
          const latestAppState = appStateRef.current;
          const pendingState = {
            ...latestAppState,
            users: (latestAppState.users || []).map((user) => (user.id === nextUser.id ? { ...user, invitationStatus: "pending" } : user)),
          };
          persistTenantState(pendingState);
          setNotice(`${nextUser.name} を招待しましたが、招待メールの送信に失敗しました: ${resolveInviteEmailErrorMessage(emailResult.error)}(「再招待」で送信し直すか、「URLコピー」から招待URLを直接共有できます)`);
          return;
        }
        return;
      }
    } catch (error) {
      setNotice(getSupabaseErrorMessage(error));
    }
  };

  const handleCompanySwitch = (companyId) => {
    const targetCompany = (appState.companies || []).find((company) => company.id === companyId);
    if (!targetCompany) return;
    const nextState = applyCompanySnapshot({ ...appState, currentCompanyId: companyId }, companyId);
    persistTenantState(nextState);
  };

  // 加盟店連携(閲覧専用)への切り替え。system_adminのhandleCompanySwitchとは意図的に別関数
  // にする — こちらはcompanyIdOverride付きでhydrateFromSupabaseを明示的に呼び、加盟店の
  // 実データ取得を即座に(待ち時間・エラーをこの関数内でハンドリングできる形で)行う。
  // companySnapshots(applyCompanySnapshot)は使わない — 加盟店側のUI選択状態を自社の
  // companySnapshotsへ混ぜたくないため。
  // 加盟店は自社店舗と同じ「1店舗を選んでいる状態」として扱う(全店舗ビューでは損益表・
  // 月締め・費用入力・日次入力などの単一店舗前提ページが軒並み利用できなくなっていた
  // 不具合の修正)。targetStoreIdが渡されればその店舗、渡されなければ(会社単位の
  // 「表示する」ボタン等からの呼び出し)先頭のアクティブ店舗をデフォルトにする —
  // ALL_STORES_VALUEには決してしない。加盟店固有の処理ではなく、承認済みのどの会社にも
  // 同じロジックが適用される(要件: INTRO固有の特別扱いを作らない)。
  const handleFranchiseView = async (partnerCompanyId, targetStoreId) => {
    if (!partnerCompanyId) return;
    if (appState.currentCompanyId === partnerCompanyId && appState.selectedStoreId === targetStoreId) return;
    setFranchiseViewBusy(true);
    try {
      const result = await loadFranchiseCompanyMetadata({ companyId: partnerCompanyId });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return;
      }
      const activeFranchiseStores = (result.company.stores || []).filter((store) => store.status !== "archived");
      // 加盟店にまだ1店舗も登録されていない場合、ALL_STORES_VALUEへフォールバックしたり
      // currentCompanyId/isViewingFranchise/selectedStoreを中途半端に切り替えたりしない —
      // 「加盟店を選んだのに全店舗ビューが開く」という誤解を招く上、店舗が無い会社に対して
      // 全店舗集計・自社データ・別加盟店データを取得しに行く必要も無い。現在の表示状態は
      // 一切変更せず、通知だけ出して終了する(要件1・2)。
      if (!activeFranchiseStores.length) {
        setNotice("この加盟店にはまだ店舗が登録されていません。");
        return;
      }
      // 状態上書き防止(ここまでにloadFranchiseCompanyMetadataをawaitしているため、
      // appStateRef.currentから最新状態を読み直す)。
      const latestAppState = appStateRef.current;
      const homeCompanyId = latestAppState.isViewingFranchise ? latestAppState.homeCompanyIdBeforeFranchiseView : latestAppState.currentCompanyId;
      const alreadyPresent = (latestAppState.companies || []).some((company) => company.id === partnerCompanyId);
      const nextCompanies = alreadyPresent
        ? (latestAppState.companies || []).map((company) => (company.id === partnerCompanyId ? { ...company, ...result.company } : company))
        : [...(latestAppState.companies || []), result.company];
      const targetStore = (targetStoreId && activeFranchiseStores.find((store) => store.id === targetStoreId)) || activeFranchiseStores[0];
      const nextState = {
        ...latestAppState,
        companies: nextCompanies,
        currentCompanyId: partnerCompanyId,
        isViewingFranchise: true,
        homeCompanyIdBeforeFranchiseView: homeCompanyId,
        selectedStore: targetStore.name,
        selectedStoreId: targetStore.id,
      };
      setAppState(nextState);
      writeAppState(nextState);
      if (currentUser?.authUserId && currentUser?.profileId) {
        await hydrateFromSupabase({
          authUser: { id: currentUser.authUserId, email: currentUser.email },
          profile: { id: currentUser.profileId, company_id: partnerCompanyId, role: currentRole },
          tenantState: nextState,
          companyIdOverride: partnerCompanyId,
        });
      }
    } finally {
      setFranchiseViewBusy(false);
    }
  };

  // targetStoreIdを省略すると本社の「全店舗」、指定すると本社の特定店舗を選んだ状態で戻る
  // (店舗プルダウンで加盟店閲覧中に自社の特定店舗を選んだ場合)。ログインユーザー本来の
  // company_id(homeCompanyIdBeforeFranchiseView)へ戻すだけで、加盟店側のデータ・
  // company_idには一切触れない。
  const handleReturnToHomeCompany = async (targetStoreId) => {
    if (!appState.isViewingFranchise) return;
    const homeCompanyId = appState.homeCompanyIdBeforeFranchiseView || appState.currentCompanyId;
    setFranchiseViewBusy(true);
    try {
      const homeCompany = (appState.companies || []).find((company) => company.id === homeCompanyId);
      const targetStore = targetStoreId ? homeCompany?.stores?.find((item) => item.id === targetStoreId) : null;
      const nextState = {
        ...appState,
        currentCompanyId: homeCompanyId,
        isViewingFranchise: false,
        homeCompanyIdBeforeFranchiseView: "",
        selectedStore: targetStore ? targetStore.name : ALL_STORES_VALUE,
        selectedStoreId: targetStore ? targetStore.id : "",
      };
      setAppState(nextState);
      writeAppState(nextState);
      if (currentUser?.authUserId && currentUser?.profileId) {
        await hydrateFromSupabase({
          authUser: { id: currentUser.authUserId, email: currentUser.email },
          profile: { id: currentUser.profileId, company_id: homeCompanyId, role: currentRole },
          tenantState: nextState,
        });
      }
    } finally {
      setFranchiseViewBusy(false);
    }
  };

  // 加盟店連携(閲覧専用)中の書き込みガード。system_adminは元々全社に対して正規の読み書き
  // 権限を持つため対象外(既存挙動そのまま)。実際のセキュリティ境界はRLS(加盟店データへの
  // INSERT/UPDATE/DELETEポリシーは一切追加していない)であり、これはUX目的の早期returnに
  // すぎない — 保存ハンドラの先頭で呼び、trueが返れば以降の処理を中断する。判定式自体は
  // permissions.jsのisFranchiseReadOnlyへ集約済み(canEditMonthlyReviewと同じ実装を共有)。
  const isFranchiseReadOnlyForCurrentUser = () => isFranchiseReadOnly(appState.isViewingFranchise, currentRole);
  const guardFranchiseReadOnly = () => {
    if (!isFranchiseReadOnlyForCurrentUser()) return false;
    setNotice("加盟店データは閲覧のみです（編集・保存はできません）");
    return true;
  };

  const handleStoreSwitch = (storeName) => {
    // selectedStoreId is the durable identity — selectedStore (the display name) is kept in
    // sync with it everywhere below specifically so a rename can never silently strand a
    // session on a stale name. See the self-healing effect further down for why this matters.
    const matchedStoreId = currentCompanyStores.find((store) => store.name === storeName)?.id || "";
    const nextState = {
      ...appState,
      selectedStore: storeName,
      selectedStoreId: matchedStoreId,
      companySnapshots: { ...(appState.companySnapshots || {}), [appState.currentCompanyId]: { ...(appState.companySnapshots?.[appState.currentCompanyId] || createInitialAppState()), selectedStore: storeName, selectedStoreId: matchedStoreId } },
    };
    persistTenantState(nextState);
  };

  // 店舗管理ページのカードから「この店舗を管理」を押した時の遷移。店舗設定は独立画面ではなく
  // 「管理画面」に統合したため、対象店舗へ切り替えた上で管理画面(基本設定タブ)を開く。
  const openStoreManagement = (store) => {
    handleStoreSwitch(store.name);
    setActivePage("monthly");
    setActiveMonthlyTab(canEditStoreName(currentRole) && !isFranchiseReadOnlyForCurrentUser() ? "basic" : "input");
  };

  // 「入力設定」タブに未保存の変更がある状態でタブ/ページを離れようとした時の確認ガード。
  // 既存の対象月切替ガード(targetDirtyチェック)と同じ考え方(window.confirm)。
  const confirmLeaveInputSettings = () => {
    if (!inputSettingsDirty) return true;
    return window.confirm("変更が保存されていません。移動しますか？");
  };

  // 管理画面の「基本設定」タブは、店舗名編集ができる権限(system_admin/company_admin/
  // store_manager)かつ加盟店閲覧専用でない場合のみ表示する(旧・店舗設定画面のshowBasicTab
  // ロジックを踏襲)。
  const showBasicMonthlyTab = canEditStoreName(currentRole) && !isFranchiseReadOnlyForCurrentUser();
  const visibleMonthlyTabs = monthlyTabs.filter((tab) => tab.id !== "basic" || showBasicMonthlyTab);
  // 基本設定・入力設定タブの編集可否(旧・店舗設定画面のdailyEditable/toggleEditableと同じ
  // 条件)。全店舗ビュー中は店舗固有設定を変更できない。
  const inputSettingsEditable = Boolean(selectedStoreEntity) && canEditStoreName(currentRole) && !isFranchiseReadOnlyForCurrentUser() && !isAllStoresView;

  // Mirrors handleStoreSwitch: a bare setAppState here left the month selection living only in
  // React state until whichever debounced background effect (hydrate, autosave) happened to
  // catch up and write it to localStorage next — a refresh in that gap silently reverted the
  // view back to the real current month, discarding the switch. persistTenantState writes it to
  // localStorage synchronously instead.
  const handleMonthSwitch = (monthValue) => {
    persistTenantState({ ...appState, selectedMonth: monthValue });
  };

  const handleEditCompany = (company) => {
    setCompanyEditId(company.id);
    setCompanyForm({ name: company.name, code: company.code, contractStatus: company.contractStatus || "trial", businessType: company.businessType || "salon" });
    setCompanySettingsForm({ ...createCompanySettingsDefaults(), ...(company.settings || {}), businessType: company.businessType || "salon" });
  };

  const handleEditUser = (user) => {
    setEditUserTargetId(user.id);
    setEditUserDraft({ name: user.name || "", email: user.email || "", role: user.role || "staff", storeIds: user.storeIds || [], primaryStoreId: user.primaryStoreId || "", isActive: user.isActive !== false });
    setEditUserError("");
  };

  const closeEditUserModal = () => {
    setEditUserTargetId("");
    setEditUserError("");
    setEditUserSaving(false);
  };

  const toggleEditUserStoreSelection = (storeId) => {
    setEditUserDraft((prev) => {
      const nextStoreIds = prev.storeIds.includes(storeId) ? prev.storeIds.filter((id) => id !== storeId) : [...prev.storeIds, storeId];
      return {
        ...prev,
        storeIds: nextStoreIds,
        primaryStoreId: prev.primaryStoreId === storeId && !nextStoreIds.includes(prev.primaryStoreId) ? (nextStoreIds[0] || "") : prev.primaryStoreId,
      };
    });
  };

  // The dedicated edit modal — separate from handleSaveUser's invite-only form above, and
  // separate from the individual 権限変更/所属店舗変更 row-actions — because those never
  // actually persisted name/email/isActive changes to Supabase at all (only role and store
  // assignments had their own working save paths); editing here always writes straight to the
  // profiles row so a reload always reflects what was actually saved, not a local-only copy.
  const handleSaveUserEdit = async () => {
    const targetUser = (appState.users || []).find((user) => user.id === editUserTargetId);
    if (!targetUser) return;
    const normalizedEmail = editUserDraft.email.trim().toLowerCase();
    if (!editUserDraft.name.trim() || !normalizedEmail) {
      setEditUserError("氏名とメールアドレスは必須です");
      return;
    }
    const duplicateUser = (appState.users || []).find((user) => user.email === normalizedEmail && user.id !== targetUser.id);
    if (duplicateUser) {
      setEditUserError("同じメールアドレスの別のユーザーが既に存在します");
      return;
    }
    const normalizedCurrentRole = normalizeRole(currentRole);
    const invitableRoles = getInvitableRoles(normalizedCurrentRole);
    const canChangeRole = invitableRoles.includes(targetUser.role) && invitableRoles.includes(editUserDraft.role);
    const nextRole = canChangeRole ? editUserDraft.role : targetUser.role;
    const inviterStoreIds = normalizedCurrentRole === "store_manager" ? allowedStoreIds : currentCompanyStores.map((store) => store.id);
    const nextStoreIds = editUserDraft.storeIds.filter((storeId) => inviterStoreIds.includes(storeId));
    const nextPrimaryStoreId = nextStoreIds.includes(editUserDraft.primaryStoreId) ? editUserDraft.primaryStoreId : (nextStoreIds[0] || "");

    setEditUserSaving(true);
    setEditUserError("");
    // 送ったつもりの値(editUserDraft.isActive)ではなく、set-user-active-state Edge Functionが
    // 実際にDBへ書き込んだ値(下で埋める)でローカルstateを更新する。
    let confirmedIsActive = editUserDraft.isActive;
    try {
      if (isSupabaseConfigured) {
        // メールアドレスが実際に変わる場合は、専用のupdate-user-email Edge Function(service-
        // role)を先に呼ぶ。登録済みユーザーはSupabase Auth側(auth.users.email)も同時に
        // 書き換える必要があり、profilesへの直接更新(updateProfileDetails)だけではAuth側に
        // 古いメールアドレスが残ってしまう(要件1: UI上だけの変更でAuth側に不整合を残さない)。
        // 未登録(招待中)ユーザーの場合は、サーバー側で招待トークンも新しく発行し直され、
        // 古いメールアドレス宛のリンクは無効化される。
        if (normalizedEmail !== targetUser.email) {
          const emailResult = await updateUserEmail({ profileId: targetUser.id, email: normalizedEmail });
          if (!emailResult?.ok) throw emailResult.error || new Error("メールアドレスの変更に失敗しました");
        }
        // 有効/停止が変わる場合もset-user-active-state経由にする(要件3と同じ理由 —
        // 登録済みユーザーを停止する場合はSupabase Auth側もBANし、既存セッションを無効化する)。
        if (editUserDraft.isActive !== targetUser.isActive) {
          const activeStateResult = await setUserActiveState({ profileId: targetUser.id, isActive: editUserDraft.isActive });
          if (!activeStateResult?.ok) throw activeStateResult.error || new Error("状態の変更に失敗しました");
          confirmedIsActive = typeof activeStateResult?.data?.isActive === "boolean" ? activeStateResult.data.isActive : editUserDraft.isActive;
        }
        const detailsResult = await updateProfileDetails({ profileId: targetUser.id, name: editUserDraft.name.trim(), email: normalizedEmail, isActive: confirmedIsActive });
        if (!detailsResult?.ok && !detailsResult?.skipped) throw detailsResult.error || new Error("保存に失敗しました");
        if (nextRole !== targetUser.role) {
          const roleResult = await updateProfileRole({ profileId: targetUser.id, role: nextRole });
          if (!roleResult?.ok && !roleResult?.skipped) throw roleResult.error || new Error("権限の更新に失敗しました");
        }
        const storesChanged = JSON.stringify([...nextStoreIds].sort()) !== JSON.stringify([...(targetUser.storeIds || [])].sort()) || nextPrimaryStoreId !== (targetUser.primaryStoreId || "");
        if (storesChanged) {
          const storesResult = await updateProfileStoreAssignments({ profileId: targetUser.id, companyId: targetUser.companyId, storeIds: nextStoreIds, primaryStoreId: nextPrimaryStoreId });
          if (!storesResult?.ok && !storesResult?.skipped) throw storesResult.error || new Error("所属店舗の更新に失敗しました");
        }
      }
      // 状態上書き防止(ここまでに最大4件のSupabase呼び出しをawaitしているため、
      // appStateRef.currentから最新状態を読み直す)。
      const nextState = {
        ...appStateRef.current,
        users: (appStateRef.current.users || []).map((user) => (user.id === targetUser.id
          ? { ...user, name: editUserDraft.name.trim(), email: normalizedEmail, role: nextRole, storeIds: nextStoreIds, primaryStoreId: nextPrimaryStoreId, isActive: confirmedIsActive }
          : user)),
      };
      persistTenantState(nextState);
      closeEditUserModal();
    } catch (error) {
      setEditUserError(getSupabaseErrorMessage(error));
    } finally {
      setEditUserSaving(false);
    }
  };

  const requestDeleteUser = (user) => {
    setDeleteUserTargetId(user.id);
    setDeleteUserError("");
  };

  const closeDeleteUserModal = () => {
    setDeleteUserTargetId("");
    setDeleteUserError("");
    setDeleteUserSaving(false);
  };

  // 誤操作防止の2段階確認: このハンドラ自体が確認ダイアログの「削除する」ボタンから呼ばれ、
  // ここでさらにwindow.confirmの最終確認を挟んでから実際に削除を実行する。削除対象は
  // Supabase Auth・profiles・user_stores・招待情報のみで、そのユーザーが過去に入力した
  // 売上・費用・月締め等の業務データは20260809050000のマイグレーションによりON DELETE
  // SET NULLで保持される(created_by等が null になるだけでレコード自体は消えない)。
  const handleConfirmDeleteUser = async () => {
    const targetUser = (appState.users || []).find((user) => user.id === deleteUserTargetId);
    if (!targetUser) return;
    if (targetUser.id === currentUser?.profileId) {
      setDeleteUserError("自分自身のアカウントは削除できません");
      return;
    }
    const isPendingInvite = !targetUser.authUserId;
    const confirmMessage = isPendingInvite
      ? `${targetUser.name}（${targetUser.email}）への招待を取り消します。よろしいですか？`
      : `${targetUser.name}（${targetUser.email}）を削除します。この操作は取り消せません。本当によろしいですか？`;
    if (!window.confirm(confirmMessage)) {
      return;
    }
    setDeleteUserSaving(true);
    setDeleteUserError("");
    try {
      if (isSupabaseConfigured) {
        const result = await deleteUserAccount({ profileId: targetUser.id });
        if (!result.ok) {
          throw result.error || new Error(isPendingInvite ? "招待の取り消しに失敗しました" : "削除に失敗しました");
        }
      }
      // 状態上書き防止(ここまでにdeleteUserAccountをawaitしているため、appStateRef.current
      // から最新状態を読み直す)。
      const nextState = {
        ...appStateRef.current,
        users: (appStateRef.current.users || []).filter((user) => user.id !== targetUser.id),
      };
      persistTenantState(nextState);
      closeDeleteUserModal();
    } catch (error) {
      setDeleteUserError(getSupabaseErrorMessage(error));
    } finally {
      setDeleteUserSaving(false);
    }
  };

  // 契約状態(無料利用/トライアル/契約中/停止中)の遷移。company.isActiveを使った以前の
  // トグルはローカルのappStateしか書き換えておらず、次のhydrateで即座に元へ戻ってしまう
  // (=実際には何も保存されていなかった)不具合だったため、update-company-status Edge
  // Function(service-role)を経由して実際にcompanies.contract_statusを更新する。
  // company_id・店舗・ユーザー・売上等の既存データには一切触れない — ステータスの列を1つ
  // 更新するだけ。許可される遷移(どの状態からどの状態へ変更できるか)はサーバー側の
  // ALLOWED_TRANSITIONSと同じ内容をここにも持たせ、UIの選択肢自体を許可された遷移だけに
  // 絞る(実際の強制力はサーバー側、これはUI上の道しるべ)。
  const CONTRACT_STATUS_LABELS = { free: "無料利用", trial: "トライアル", active: "契約中", suspended: "停止中" };
  const CONTRACT_STATUS_ALLOWED_NEXT = {
    free: ["active", "suspended"],
    trial: ["active", "free", "suspended"],
    active: ["suspended", "free"],
    suspended: ["active", "free", "trial"],
  };

  const handleCompanyContractAction = async (company, targetStatus) => {
    const targetLabel = CONTRACT_STATUS_LABELS[targetStatus] || targetStatus;
    const confirmMessage = targetStatus === "suspended"
      ? `${company.name} を停止しますか？\n会社・店舗・ユーザー・売上等のデータは削除されず、そのまま保持されます。停止中は system_admin 以外は利用できなくなります。`
      : `${company.name} の契約状態を「${targetLabel}」に変更しますか？`;
    if (!window.confirm(confirmMessage)) return;
    if (companyStatusSavingId) return;
    setCompanyStatusSavingId(company.id);
    try {
      let nextStatus = targetStatus;
      if (isSupabaseConfigured) {
        const result = await updateCompanyContractStatus({ companyId: company.id, targetStatus });
        if (!result.ok) {
          setNotice(`契約状態の変更に失敗しました: ${getSupabaseErrorMessage(result.error)}`);
          return;
        }
        nextStatus = result.status || nextStatus;
      }
      // 状態上書き防止(ここまでにupdateCompanyContractStatusをawaitしているため、
      // appStateRef.currentから最新状態を読み直す)。
      const nextState = {
        ...appStateRef.current,
        companies: (appStateRef.current.companies || []).map((item) => (item.id === company.id ? { ...item, contractStatus: nextStatus, lastUpdatedAt: new Date().toISOString() } : item)),
      };
      persistTenantState(nextState);
    } finally {
      setCompanyStatusSavingId("");
    }
  };

  // 会社の削除は3段階(要件6): ①停止(既存の契約状態遷移、データは一切触れない) →
  // ②削除(論理削除、company_idに紐づくデータには一切触れずcompanies.deleted_at等を
  // 立てるだけ、30日間は復元可能) → ③完全削除(物理削除、②を経ていない会社には
  // サーバー側で拒否される)。「会社データを削除」ボタンは②(論理削除)を起動する —
  // 以前は直接物理削除していたが、誤操作対策として変更した(要件5の調査結果参照)。
  const requestSoftDeleteCompany = (company) => {
    if (!company) return;
    setCompanySoftDeleteTargetId(company.id);
    setCompanySoftDeleteConfirmText("");
    setCompanySoftDeleteError("");
  };

  const closeSoftDeleteCompanyModal = () => {
    setCompanySoftDeleteTargetId("");
    setCompanySoftDeleteConfirmText("");
    setCompanySoftDeleteError("");
  };

  const handleConfirmSoftDeleteCompany = async () => {
    const target = (appState.companies || []).find((company) => company.id === companySoftDeleteTargetId);
    if (!target || companySoftDeleteConfirmText !== target.name) return;
    setCompanySoftDeleteSaving(true);
    setCompanySoftDeleteError("");
    try {
      let deletedAt = new Date().toISOString();
      let deletionScheduledAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      if (isSupabaseConfigured) {
        const result = await softDeleteCompany({ companyId: target.id, action: "delete", confirmName: companySoftDeleteConfirmText });
        if (!result.ok) {
          setCompanySoftDeleteError(getSupabaseErrorMessage(result.error));
          return;
        }
        deletedAt = result.data?.deletedAt || deletedAt;
        deletionScheduledAt = result.data?.deletionScheduledAt || deletionScheduledAt;
      }
      // company_id・関連データには一切触れない — companies行の3列を更新するだけ。
      // 状態上書き防止(ここまでにsoftDeleteCompanyをawaitしているため、appStateRef.current
      // から最新状態を読み直す)。
      const latestAppState = appStateRef.current;
      const nextState = {
        ...latestAppState,
        companies: (latestAppState.companies || []).map((company) => (company.id === target.id ? { ...company, deletedAt, deletedBy: currentUser?.profileId || "", deletionScheduledAt } : company)),
        currentCompanyId: latestAppState.currentCompanyId === target.id ? "" : latestAppState.currentCompanyId,
      };
      persistTenantState(nextState);
      setCompanyEditId("");
      setCompanyForm({ name: "", code: "", contractStatus: "trial", businessType: "salon" });
      closeSoftDeleteCompanyModal();
    } finally {
      setCompanySoftDeleteSaving(false);
    }
  };

  // 復元(要件6②): companies.deleted_at等をnullへ戻すだけ。店舗・ユーザー・売上等は
  // 削除時から一切触れていないため、復元すれば即座に以前の状態のまま利用を再開できる。
  const handleRestoreCompany = async (company) => {
    if (!company) return;
    if (!window.confirm(`${company.name} を復元しますか？`)) return;
    setCompanyRestoreSavingId(company.id);
    try {
      if (isSupabaseConfigured) {
        const result = await softDeleteCompany({ companyId: company.id, action: "restore" });
        if (!result.ok) {
          setNotice(`会社の復元に失敗しました: ${getSupabaseErrorMessage(result.error)}`);
          return;
        }
      }
      // 状態上書き防止(ここまでにsoftDeleteCompanyをawaitしているため、appStateRef.current
      // から最新状態を読み直す)。
      const nextState = {
        ...appStateRef.current,
        companies: (appStateRef.current.companies || []).map((item) => (item.id === company.id ? { ...item, deletedAt: "", deletedBy: "", deletionScheduledAt: "" } : item)),
      };
      persistTenantState(nextState);
    } finally {
      setCompanyRestoreSavingId("");
    }
  };

  // 完全削除(要件6③・8): ②(論理削除)を経ていない会社はサーバー側で拒否される。
  // 会社名の完全一致に加えて「完全削除」という固定フレーズの入力も必須にし、通常削除
  // (②)より確認を1段厳重にする。ゴミ箱(削除済み会社一覧)からのみ起動できる。
  const requestHardDeleteCompany = (company) => {
    if (!company) return;
    setCompanyHardDeleteTargetId(company.id);
    setCompanyHardDeleteConfirmText("");
    setCompanyHardDeleteConfirmPhrase("");
    setCompanyHardDeleteError("");
  };

  const closeCompanyHardDeleteModal = () => {
    setCompanyHardDeleteTargetId("");
    setCompanyHardDeleteConfirmText("");
    setCompanyHardDeleteConfirmPhrase("");
    setCompanyHardDeleteError("");
  };

  const handleConfirmHardDeleteCompany = async () => {
    const target = (appState.companies || []).find((company) => company.id === companyHardDeleteTargetId);
    if (!target || companyHardDeleteConfirmText !== target.name || companyHardDeleteConfirmPhrase !== "完全削除") return;
    setCompanyHardDeleteSaving(true);
    setCompanyHardDeleteError("");
    try {
      if (isSupabaseConfigured) {
        const result = await deleteCompanyCompletely({ companyId: target.id, confirmName: companyHardDeleteConfirmText, confirmPhrase: companyHardDeleteConfirmPhrase });
        if (!result.ok) {
          setCompanyHardDeleteError(getSupabaseErrorMessage(result.error));
          return;
        }
      }
      // 状態上書き防止(ここまでにdeleteCompanyCompletelyをawaitしているため、
      // appStateRef.currentから最新状態を読み直す)。
      const latestAppState = appStateRef.current;
      const nextState = {
        ...latestAppState,
        companies: (latestAppState.companies || []).filter((company) => company.id !== target.id),
        currentCompanyId: latestAppState.currentCompanyId === target.id ? "" : latestAppState.currentCompanyId,
      };
      persistTenantState(nextState);
      closeCompanyHardDeleteModal();
    } finally {
      setCompanyHardDeleteSaving(false);
    }
  };

  // 無料利用理由(要件2): 無料利用中の会社にのみ設定できる。状態遷移は起こさず理由だけを
  // 更新する — update-company-status Edge FunctionにtargetStatusを渡さずfreeReasonだけ渡す。
  const FREE_REASON_LABELS = { self: "自社", monitor: "モニター", friend: "知人特典", campaign: "キャンペーン", other: "その他" };
  const handleUpdateCompanyFreeReason = async (company, freeReason) => {
    setFreeReasonSavingId(company.id);
    try {
      if (isSupabaseConfigured) {
        const result = await updateCompanyContractStatus({ companyId: company.id, freeReason });
        if (!result.ok) {
          setNotice(`無料利用理由の変更に失敗しました: ${getSupabaseErrorMessage(result.error)}`);
          return;
        }
      }
      // 状態上書き防止(ここまでにupdateCompanyContractStatusをawaitしているため、
      // appStateRef.currentから最新状態を読み直す)。
      const nextState = {
        ...appStateRef.current,
        companies: (appStateRef.current.companies || []).map((item) => (item.id === company.id ? { ...item, freeReason: freeReason || "" } : item)),
      };
      persistTenantState(nextState);
      // 保存の成否がラベルの見た目の変化だけでは分かりにくい(要件1: 保存後、その場で
      // 表示内容を更新したことが利用者に伝わるようにする)ため、成功を明示する通知を出す。
      setNotice(`無料利用理由を「${FREE_REASON_LABELS[freeReason] || freeReason || "未設定"}」に変更しました`);
    } finally {
      setFreeReasonSavingId("");
    }
  };

  // AI分析(AI経営アシスタント)の会社単位ON/OFF。system_admin限定(canManageCompanies)
  // — company_adminが自分の会社のAI契約を勝手に有効化できないようにする(要件: 通常
  // ユーザーが自由に変更するのではなくsystem_admin側で管理する)。実際の強制力は
  // companies_update_system_only RLS(system_admin以外はUPDATE自体が通らない)と、
  // ai-assistant Edge Function側のcompany_id判定にある — このボタンはあくまでその操作口。
  // OFFにしても過去のAI分析結果(チャット履歴等)は削除しない、新規のAPI呼び出しだけが
  // 止まる(要件)。
  // AI分析ON/OFFはappState/tenant_snapshotを一切経由しない、companiesテーブル直結の
  // 独立した処理。Chrome/PWAで分岐は無く、常に同じ6ステップだけを行う。
  // 1. 現在値を確認 → 2. 反対の値をUPDATE → 3. 成功を確認 → 4. 対象companyを再取得
  // → 5. aiAnalysisSettingsへ反映 → 6. UIは再レンダリングで自動更新。
  const handleToggleCompanyAiAnalysis = async (company) => {
    if (!isSupabaseConfigured) return;
    // 1. 現在のcompanies.ai_analysis_enabledを確認
    const currentValue = Boolean(aiAnalysisSettings[company.id]);
    const nextEnabled = !currentValue;
    if (!window.confirm(`${company.name} のAI分析機能を${nextEnabled ? "有効化" : "無効化"}しますか？${nextEnabled ? "" : "\n無効化すると、この会社では新規のAI分析・AI APIの呼び出しができなくなります(過去の分析結果は削除されません)。"}`)) return;
    // 更新中は、並行して走りうる一覧再取得(useEffect)がこのcompanyIdを上書きしないようにする。
    aiAnalysisUpdatingRef.current.add(company.id);
    try {
      // 2. 反対の値をSupabaseへUPDATE
      const updateResult = await updateCompanyAiAnalysisSetting({ companyId: company.id, enabled: nextEnabled });
      // 3. UPDATE成功を確認
      if (!updateResult.ok) {
        setNotice(`AI分析設定の変更に失敗しました: ${getSupabaseErrorMessage(updateResult.error)}`);
        return;
      }
      // 4. 対象companyをSupabaseから再取得
      const confirmResult = await getCompanyAiAnalysisSettings({ companyIds: [company.id] });
      const confirmedValue = confirmResult.ok && confirmResult.data.length ? confirmResult.data[0].aiAnalysisEnabled : nextEnabled;
      // 5. 最新値を反映(6. UIはこのstateの変化で自動的に再描画される)
      setAiAnalysisSettings((prev) => ({ ...prev, [company.id]: confirmedValue }));
    } finally {
      aiAnalysisUpdatingRef.current.delete(company.id);
    }
  };

  // 店舗の状態は運営中/停止中/アーカイブの3段階(要件1) — 停止/再開/アーカイブ/復元の4操作は
  // すべて update-store-status Edge Function(service-role)経由にする。以前はこの4操作が全て
  // 同じ stores.is_active フラグを書くだけで見分けがつかず、「削除」ボタンも実質同じ処理
  // だった。誤クリックで店舗と過去データを失わないことを最優先に、通常の「削除」ボタンは
  // 廃止し(要件1)、完全削除は別途 system_admin 限定の確認モーダル経由のみに限定する(要件2)。
  const STORE_LIFECYCLE_ACTIONS = {
    suspend: {
      confirmMessage: (name) => `${name} を停止しますか？\n新規の売上・日次入力・費用入力ができなくなります。過去のデータは削除されません。`,
      successMessage: (name) => `${name} を停止しました`,
      failureMessage: "店舗の停止に失敗しました",
      nextStatus: "suspended",
    },
    resume: {
      confirmMessage: (name) => `${name} の運営を再開しますか？`,
      successMessage: (name) => `${name} の運営を再開しました`,
      failureMessage: "店舗の再開に失敗しました",
      nextStatus: "active",
    },
    archive: {
      confirmMessage: (name) => `${name} をアーカイブしますか？\n通常の店舗一覧・店舗切替・ランキング・全店舗集計・日次入力対象から除外されます。過去のデータは削除されず、アーカイブ一覧からいつでも確認・復元できます。`,
      successMessage: (name) => `${name} をアーカイブしました`,
      failureMessage: "店舗のアーカイブに失敗しました",
      nextStatus: "archived",
    },
    restore: {
      confirmMessage: (name) => `${name} を通常の店舗一覧へ復元しますか？`,
      successMessage: (name) => `${name} を復元しました`,
      failureMessage: "店舗の復元に失敗しました",
      nextStatus: "active",
    },
  };

  // 状態上書き防止: 唯一の呼び出し元(handleStoreLifecycleAction)がupdateStoreStatusを
  // awaitした後に呼ぶため、appStateRef.currentから最新状態を読み直す。
  const applyStoreStatusLocally = (storeId, status) => {
    const latestAppState = appStateRef.current;
    const latestCompany = latestAppState.companies?.find((company) => company.id === currentCompany?.id) || null;
    const nextCompany = {
      ...latestCompany,
      stores: (latestCompany?.stores || []).map((item) => (item.id === storeId ? { ...item, status, isActive: status !== "archived" } : item)),
    };
    const nextState = {
      ...latestAppState,
      companies: (latestAppState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)),
    };
    persistTenantState(nextState);
  };

  const handleStoreLifecycleAction = async (store, action) => {
    const meta = STORE_LIFECYCLE_ACTIONS[action];
    if (!meta) return;
    if (!window.confirm(meta.confirmMessage(store.name))) return;
    // meta.nextStatus(このアプリが「送ったつもり」の値)をそのまま画面へ反映するのではなく、
    // update-store-status Edge Functionが.select()で読み戻した実際のDB値(result.status)を
    // 使う——保存操作後は「送った値」ではなく「実際に保存された値」でstateを更新し、両者が
    // 食い違うケース(トリガー・競合更新等)でも画面が誤った状態のまま進まないようにする。
    let confirmedStatus = meta.nextStatus;
    if (isSupabaseConfigured) {
      const result = await updateStoreStatus({ storeId: store.id, action });
      if (!result.ok) {
        setNotice(`${meta.failureMessage}: ${getSupabaseErrorMessage(result.error)}`);
        return;
      }
      confirmedStatus = result.status || meta.nextStatus;
    }
    applyStoreStatusLocally(store.id, confirmedStatus);
  };

  // handleSaveStore keeps companySnapshots[companyId].stores (the legacy display-name array —
  // still the empty-state guard / option source / normalizeAppState fallback in a few places)
  // in sync whenever it adds a store; this mirrors that same sync for a newly duplicated store,
  // which previously only updated the real id-keyed company.stores list and left the legacy
  // name array to silently drift.
  const syncLegacyStoreNamesSnapshot = (nextState, companyId, nextCompanyStores) => ({
    ...nextState,
    companySnapshots: {
      ...(nextState.companySnapshots || {}),
      [companyId]: {
        ...(nextState.companySnapshots?.[companyId] || createInitialAppState()),
        stores: nextCompanyStores.map((store) => store.name),
      },
    },
  });

  const handleDuplicateStore = async (store) => {
    // 加盟店閲覧中の複製操作を明示的に拒否する(要件6: 加盟店を閲覧したことを理由にstore
    // 作成を実行しない)。RLS(stores_insert_company_scoped)側でも閲覧者の会社idでは
    // 通らないため実データは絶対に作られないが、それに任せると分かりにくい汎用エラーに
    // なるだけなので、他の書き込みハンドラと同じ明示的な通知に揃える。
    if (guardFranchiseReadOnly()) return;
    // 販売前総合チェックで発見: 他の店舗作成系ハンドラ(handleSaveStore/handleCreateNewStore)は
    // savingStoreRefで連打を防いでいたが、この複製ボタンだけガードが無く、連打すると
    // 「{店舗名} コピー」という同名の店舗が複数作られ得た(DB側のユニーク制約が2件目以降を
    // 拒否はするが、その23505エラーが下のcatchで翻訳されずraw表示されてしまう問題もあった)。
    if (savingStoreRef.current) return;
    savingStoreRef.current = true;
    const duplicateName = `${store.name} コピー`;
    try {
      if (!isSupabaseConfigured) {
        const nextCompany = {
          ...currentCompany,
          stores: [...(currentCompany?.stores || []), { ...store, id: `${store.id}-copy-${Date.now()}`, name: duplicateName, code: crypto.randomUUID(), isActive: true, status: "active" }],
        };
        persistTenantState(syncLegacyStoreNamesSnapshot({ ...appState, companies: (appState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)) }, currentCompany?.id, nextCompany.stores));
        return;
      }
      // A locally-fabricated id here would never exist in the real stores table — every
      // subsequent daily_sales/monthly_targets write for it would fail FK/RLS. Create a real row.
      const createdStore = await createStoreRecord({ companyId: currentCompany?.id, name: duplicateName, code: crypto.randomUUID() });
      // 状態上書き防止(ここまでにcreateStoreRecordをawaitしているため、appStateRef.current
      // から最新状態を読み直す)。
      const latestAppState = appStateRef.current;
      const latestCompany = getLatestCompanyById(currentCompany?.id);
      const nextStore = { ...store, id: createdStore.id, name: duplicateName, code: createdStore.code, isActive: true, status: "active" };
      const nextCompany = { ...latestCompany, stores: [...(latestCompany?.stores || []), nextStore] };
      persistTenantState(syncLegacyStoreNamesSnapshot({ ...latestAppState, companies: (latestAppState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)) }, currentCompany?.id, nextCompany.stores));
    } catch (error) {
      // DB側の最終防御(stores_company_id_normalized_name_unique、handleSaveStore/
      // handleCreateNewStoreのcatchと同じ理由・同じ翻訳)。
      const message = (error?.code === "23505" && /stores_company_id_normalized_name_unique/.test(error?.message || ""))
        ? "同じ名前の店舗が既に登録されています。同じ店舗を重複して作成することはできません。"
        : `店舗の複製に失敗しました: ${getSupabaseErrorMessage(error)}`;
      setNotice(message);
    } finally {
      savingStoreRef.current = false;
    }
  };

  // 完全削除(要件2): system_admin限定、対象店舗名を完全一致で入力させて初めて削除ボタンが
  // 有効になる確認モーダル経由のみ。ワンクリック削除は一切ない。関連データが1件でもあれば
  // delete-store Edge Function側で拒否される(要件3) — このモーダルはその拒否結果を
  // そのままエラー表示するだけで、クライアント側では「削除できる/できない」を判定しない
  // (判定はサーバー側が唯一の正)。
  const requestHardDeleteStore = (store) => {
    setHardDeleteTargetId(store.id);
    setHardDeleteConfirmText("");
    setHardDeleteError("");
  };

  const closeHardDeleteModal = () => {
    setHardDeleteTargetId("");
    setHardDeleteConfirmText("");
    setHardDeleteError("");
  };

  const handleConfirmHardDeleteStore = async () => {
    const target = (currentCompany?.stores || []).find((store) => store.id === hardDeleteTargetId);
    if (!target || hardDeleteConfirmText !== target.name) return;
    setHardDeleteSaving(true);
    setHardDeleteError("");
    try {
      if (isSupabaseConfigured) {
        const result = await deleteStoreCompletely({ storeId: target.id, confirmName: hardDeleteConfirmText });
        if (!result.ok) {
          setHardDeleteError(getSupabaseErrorMessage(result.error));
          return;
        }
      }
      // 状態上書き防止(ここまでにdeleteStoreCompletelyをawaitしているため、
      // appStateRef.currentから最新状態を読み直す)。
      const latestAppState = appStateRef.current;
      const latestCompany = getLatestCompanyById(currentCompany?.id);
      const nextCompany = { ...latestCompany, stores: (latestCompany?.stores || []).filter((store) => store.id !== target.id) };
      persistTenantState(syncLegacyStoreNamesSnapshot({ ...latestAppState, companies: (latestAppState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)) }, currentCompany?.id, nextCompany.stores));
      closeHardDeleteModal();
    } finally {
      setHardDeleteSaving(false);
    }
  };

  const handleToggleUserStatus = async (user) => {
    if (!window.confirm(`${user.name} を${user.isActive ? "利用停止" : "再開"}しますか？`)) return;
    if (togglingStatusUserId === user.id) return;
    const nextActive = !user.isActive;
    // 送ったつもりの値(nextActive)をそのまま反映するのではなく、set-user-active-state
    // Edge Functionが.select()で読み戻した実際のDB値(result.data.isActive)で更新する。
    let confirmedActive = nextActive;
    setTogglingStatusUserId(user.id);
    try {
      if (isSupabaseConfigured) {
        // set-user-active-stateはprofiles.is_activeの更新に加え、既に登録済みのユーザーを
        // 停止する場合はSupabase Auth側もBANする(要件3: 既にログイン中の場合もセッションを
        // 無効化する)。
        const result = await setUserActiveState({ profileId: user.id, isActive: nextActive });
        if (!result?.ok) {
          setNotice(`状態の変更に失敗しました: ${getSupabaseErrorMessage(result?.error)}`);
          return;
        }
        confirmedActive = typeof result?.data?.isActive === "boolean" ? result.data.isActive : nextActive;
      }
      // 状態上書き防止(ここまでにsetUserActiveStateをawaitしているため、appStateRef.current
      // から最新状態を読み直す)。
      const nextState = {
        ...appStateRef.current,
        users: (appStateRef.current.users || []).map((item) => item.id === user.id ? { ...item, isActive: confirmedActive } : item),
      };
      persistTenantState(nextState);
    } finally {
      setTogglingStatusUserId("");
    }
  };

  const toggleUserStoreSelection = (storeId) => {
    setUserForm((prev) => {
      const nextStoreIds = prev.storeIds.includes(storeId) ? prev.storeIds.filter((currentId) => currentId !== storeId) : [...prev.storeIds, storeId];
      return {
        ...prev,
        storeIds: nextStoreIds,
        primaryStoreId: prev.primaryStoreId === storeId ? "" : nextStoreIds[0] || "",
      };
    });
  };

  const handleToggleCompanySetup = () => {
    const nextCompany = {
      ...currentCompany,
      setup: { ...(currentCompany?.setup || {}), complete: true, company: true, store: true, admin: true, settings: true },
      lastUpdatedAt: new Date().toISOString(),
    };
    const nextState = {
      ...appState,
      companies: (appState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)),
    };
    persistTenantState(nextState);
  };

  const handleSaveCompanySettings = async () => {
    if (!currentCompany?.id) {
      setNotice("会社情報を確認できませんでした");
      return;
    }
    const nextSettings = { ...createCompanySettingsDefaults(), ...(currentCompany.settings || {}), ...(companySettingsForm || {}), businessType: companySettingsForm.businessType || currentCompany.businessType || "salon" };
    if (isSupabaseConfigured) {
      const result = await upsertCompanySettings({
        companyId: currentCompany.id,
        userId: appState.currentUserId,
        settings: nextSettings,
        taxSettings: appState.taxSettings,
        showOtherSales: appState.preferences?.showOtherSales,
      });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return;
      }
    }
    // 状態上書き防止(ここまでにupsertCompanySettingsをawaitしているため、appStateRef.current
    // から最新状態を読み直す)。
    const latestAppState = appStateRef.current;
    const nextState = {
      ...latestAppState,
      companies: (latestAppState.companies || []).map((company) => company.id === currentCompany?.id ? {
        ...company,
        businessType: nextSettings.businessType,
        settings: nextSettings,
        setup: { ...(company.setup || {}), settings: true, complete: Boolean(company.setup?.company && company.setup?.store && company.setup?.admin && company.setup?.settings) },
        lastUpdatedAt: new Date().toISOString(),
      } : company),
    };
    persistTenantState(nextState);
  };

  // 「消費税を考慮する」+ 引当率専用の保存(company_settings.taxSettings列)。companySettingsForm
  // /handleSaveCompanySettingsとは独立して保存できるよう分けている(settings列を巻き込まない)。
  // 会社設定画面・損益表内のどちらからでも呼べる共通保存(company_settings.taxSettings列)。
  const persistTaxSettings = async (nextTaxSettings) => {
    if (!currentCompany?.id) {
      setNotice("会社情報を確認できませんでした");
      return false;
    }
    if (isSupabaseConfigured) {
      const result = await upsertCompanySettings({
        companyId: currentCompany.id,
        userId: appState.currentUserId,
        settings: currentCompany.settings || createCompanySettingsDefaults(),
        taxSettings: nextTaxSettings,
        showOtherSales: appState.preferences?.showOtherSales,
      });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return false;
      }
    }
    setAppState((prev) => ({ ...prev, taxSettings: nextTaxSettings }));
    return true;
  };

  const handleSaveTaxSettings = async () => {
    await persistTaxSettings({
      ...appState.taxSettings,
      considerConsumptionTax: Boolean(taxSettingsForm.considerConsumptionTax),
      consumptionTaxReserveRate: parseNumber(taxSettingsForm.consumptionTaxReserveRate),
    });
  };

  // 損益表の「消費税考慮」セクションのON/OFFトグル用。在庫管理トグルと同様、単一のON/OFFなので
  // 切り替え次第すぐ保存する(引当率は別途、既存のtaxSettingsForm+保存ボタンで確定させる)。
  const handleToggleConsiderConsumptionTax = async (checked) => {
    const ok = await persistTaxSettings({ ...appState.taxSettings, considerConsumptionTax: checked });
    if (ok) {
      setTaxSettingsForm((prev) => ({ ...prev, considerConsumptionTax: checked }));
    }
  };

  const updateDailyFieldToggle = (fieldKey, value) => {
    setDailyFieldDraft((prev) => ({ mode: "custom", fields: { ...prev.fields, [fieldKey]: value } }));
    setDailyFieldDirty(true);
  };

  const updateMonthlyTargetFieldToggle = (fieldKey, value) => {
    setMonthlyTargetFieldDraft((prev) => ({ fields: { ...prev.fields, [fieldKey]: value } }));
    setMonthlyTargetFieldDirty(true);
  };

  const mirrorMonthlyTargetFieldSettingsIntoAppState = (storeId, settings) => {
    setAppState((prev) => ({
      ...prev,
      companies: (prev.companies || []).map((company) => ({
        ...company,
        stores: (company.stores || []).map((store) => (
          (storeId ? store.id === storeId : store.name === selectedStore)
            ? { ...store, settings: { ...(store.settings || createStoreSettingsDefaults()), monthlyTargetFields: settings } }
            : store
        )),
      })),
    }));
  };

  const handleSaveMonthlyTargetFieldSettings = async () => {
    if (guardFranchiseReadOnly()) return;
    if (!selectedStore) {
      setNotice("店舗を先に追加してください");
      return;
    }
    if (!isSupabaseConfigured) {
      mirrorMonthlyTargetFieldSettingsIntoAppState(null, monthlyTargetFieldDraft);
      setMonthlyTargetFieldDirty(false);
      setMonthlyTargetFieldSaveStatus({ status: "saved", message: "保存しました（ローカル）" });
      return;
    }
    const { store } = resolveTargetCompanyAndStore();
    if (!store?.id) {
      setMonthlyTargetFieldSaveStatus({ status: "error", message: "店舗情報を確認できませんでした" });
      setNotice("店舗情報を確認できませんでした");
      return;
    }

    setMonthlyTargetFieldSaveStatus({ status: "saving", message: "保存中…" });
    try {
      const result = await upsertStoreInputSettings({ companyId: appState.currentCompanyId, storeId: store.id, monthlyTargetFields: monthlyTargetFieldDraft });
      if (!result?.ok) {
        throw new Error(result?.error?.message || "保存に失敗しました");
      }
      mirrorMonthlyTargetFieldSettingsIntoAppState(store.id, monthlyTargetFieldDraft);
      setMonthlyTargetFieldDirty(false);
      setMonthlyTargetFieldSaveStatus({ status: "saved", message: "保存しました" });
    } catch (error) {
      const reason = resolveErrorReason(error, "保存に失敗しました");
      setMonthlyTargetFieldSaveStatus({ status: "error", message: reason });
      setNotice(`月間目標項目設定の保存に失敗しました: ${reason}`);
    }
  };

  // 「入力設定」タブの日計管理・在庫管理トグル。元は切り替え次第すぐ保存していたが、
  // 「入力項目」(dailyFieldDraft)と同じドラフト+dirty+手動保存方式へ統一したため、ここでは
  // ローカルのドラフト値を更新するだけ(DB書き込みはhandleSaveInputSettingsでまとめて行う)。
  const updateCashBreakdownDraft = (value) => {
    setCashBreakdownDraft(value);
    setCashBreakdownDirty(true);
  };

  const updateInventoryTrackingDraft = (value) => {
    setInventoryTrackingDraft(value);
    setInventoryTrackingDirty(true);
  };

  // 「入力設定」タブの統合保存: 日次入力項目(dailyFieldDraft)・日計管理・在庫管理を1回の
  // upsertStoreInputSettings呼び出しでまとめて保存する(この関数は渡された項目だけを部分更新
  // するため、他の列(材料費率等)には影響しない)。保存に失敗した場合は成功したように見せず、
  // dirtyフラグも維持して再試行できるようにする。
  const handleSaveInputSettings = async () => {
    if (guardFranchiseReadOnly()) return;
    if (!selectedStore) {
      setNotice("店舗を先に追加してください");
      return;
    }
    if (!isSupabaseConfigured) {
      setAppState((prev) => ({
        ...prev,
        companies: (prev.companies || []).map((company) => ({
          ...company,
          stores: (company.stores || []).map((store) => (
            store.name === selectedStore
              ? { ...store, settings: { ...(store.settings || createStoreSettingsDefaults()), dailyFieldSettings: dailyFieldDraft, useCashBreakdown: cashBreakdownDraft, useInventoryTracking: inventoryTrackingDraft, hasInputSettingsRow: true } }
              : store
          )),
        })),
      }));
      setDailyFieldDirty(false);
      setCashBreakdownDirty(false);
      setInventoryTrackingDirty(false);
      setInputSettingsSaveStatus({ status: "saved", message: "入力設定を保存しました（ローカル）" });
      return;
    }
    const { store } = resolveTargetCompanyAndStore();
    if (!store?.id) {
      setInputSettingsSaveStatus({ status: "error", message: "保存に失敗しました。もう一度お試しください。" });
      setNotice("店舗情報を確認できませんでした");
      return;
    }

    setInputSettingsSaveStatus({ status: "saving", message: "保存中…" });
    try {
      const result = await upsertStoreInputSettings({
        companyId: appState.currentCompanyId,
        storeId: store.id,
        dailyFields: dailyFieldDraft,
        useCashBreakdown: cashBreakdownDraft,
        useInventoryTracking: inventoryTrackingDraft,
      });
      if (!result?.ok) {
        throw new Error(result?.error?.message || "保存に失敗しました");
      }
      setAppState((prev) => ({
        ...prev,
        companies: (prev.companies || []).map((company) => ({
          ...company,
          stores: (company.stores || []).map((s) => (
            s.id === store.id
              ? { ...s, settings: { ...(s.settings || createStoreSettingsDefaults()), dailyFieldSettings: dailyFieldDraft, useCashBreakdown: cashBreakdownDraft, useInventoryTracking: inventoryTrackingDraft, hasInputSettingsRow: true } }
              : s
          )),
        })),
      }));
      setDailyFieldDirty(false);
      setCashBreakdownDirty(false);
      setInventoryTrackingDirty(false);
      setInputSettingsSaveStatus({ status: "saved", message: "入力設定を保存しました" });
    } catch (error) {
      const reason = resolveErrorReason(error, "保存に失敗しました");
      setInputSettingsSaveStatus({ status: "error", message: "保存に失敗しました。もう一度お試しください。" });
      setNotice(`入力設定の保存に失敗しました: ${reason}`);
    }
  };

  // 月締めチェックリストの費用項目を「対象外(非表示)」にする/表示に戻す(店舗単位、
  // store_input_settings.hidden_closing_categories)。fixedCosts/costMonthlyAmounts等の
  // データ自体は一切変更しない — あくまで月締め一覧への表示/非表示を切り替えるだけなので、
  // useInventoryTrackingトグルと同じくdraft/dirty管理は持たず切り替え次第すぐ保存する。
  // 完了時の一時的な通知(setNotice)は出さない — チェックリスト上でボタンの表示自体が
  // 即座に切り替わるため不要、というご指示に基づく(失敗時のエラー通知のみ残す)。
  const handleToggleHiddenClosingCategory = async (categoryKey, hidden) => {
    const { store } = resolveTargetCompanyAndStore();
    if (!store?.id) {
      setNotice("店舗情報を確認できませんでした");
      return;
    }
    const currentHidden = selectedStoreEntity?.settings?.hiddenClosingCategories || [];
    const nextHidden = hidden
      ? [...new Set([...currentHidden, categoryKey])]
      : currentHidden.filter((key) => key !== categoryKey);
    if (isSupabaseConfigured) {
      const result = await upsertStoreInputSettings({ companyId: appState.currentCompanyId, storeId: store.id, hiddenClosingCategories: nextHidden });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return;
      }
    }
    setAppState((prev) => ({
      ...prev,
      companies: (prev.companies || []).map((company) => ({
        ...company,
        stores: (company.stores || []).map((s) => (
          s.id === store.id
            ? { ...s, settings: { ...(s.settings || createStoreSettingsDefaults()), hiddenClosingCategories: nextHidden } }
            : s
        )),
      })),
    }));
  };

  // 人件費・仕入の計算方法(固定額/売上連動)・率の保存(店舗単位、store_input_settings.
  // labor_cost_mode/labor_cost_rate/purchase_cost_mode/purchase_cost_rate)。他の店舗設定
  // トグルと同じくdraft/dirty管理は持たず切り替え次第すぐ保存する。costTypeは"labor"|"purchase"。
  const handleSaveCostRateSettings = async (costType, mode, rate) => {
    if (!canEditMonthlyData(currentRole)) {
      setNotice("人件費・仕入の設定を変更できるのは会社管理者・店舗管理者以上です。");
      return false;
    }
    if (guardFranchiseReadOnly()) return false;
    const { store } = resolveTargetCompanyAndStore();
    if (!store?.id) {
      setNotice("店舗情報を確認できませんでした");
      return false;
    }
    const normalizedRate = Math.max(0, Number(rate) || 0);
    const payload = costType === "labor"
      ? { laborCostMode: mode, laborCostRate: normalizedRate }
      : { purchaseCostMode: mode, purchaseCostRate: normalizedRate };
    if (isSupabaseConfigured) {
      const result = await upsertStoreInputSettings({ companyId: appState.currentCompanyId, storeId: store.id, ...payload });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return false;
      }
    }
    setAppState((prev) => ({
      ...prev,
      companies: (prev.companies || []).map((company) => ({
        ...company,
        stores: (company.stores || []).map((s) => (
          s.id === store.id
            ? { ...s, settings: { ...(s.settings || createStoreSettingsDefaults()), ...payload } }
            : s
        )),
      })),
    }));
    return true;
  };

  // 人件費・仕入の「その月だけの手動確定額」の保存/自動計算への解除(店舗×対象月、
  // store_monthly_cost_overrides)。overrideValueにnullを渡すと自動計算に戻す(要件11)。
  const handleSaveCostOverride = async (costType, overrideValue) => {
    if (!canEditMonthlyData(currentRole)) {
      setNotice("人件費・仕入の確定額を変更できるのは会社管理者・店舗管理者以上です。");
      return false;
    }
    if (guardFranchiseReadOnly()) return false;
    const { store } = resolveTargetCompanyAndStore();
    if (!store?.id) {
      setNotice("店舗情報を確認できませんでした");
      return false;
    }
    const payload = costType === "labor" ? { laborCostOverride: overrideValue } : { purchaseCostOverride: overrideValue };
    if (isSupabaseConfigured) {
      const result = await upsertStoreMonthlyCostOverride({ companyId: appState.currentCompanyId, storeId: store.id, targetMonth: selectedMonth, ...payload });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return false;
      }
    }
    const key = `${store.id}__${selectedMonth}`;
    setAppState((prev) => ({
      ...prev,
      storeMonthlyCostOverrides: {
        ...prev.storeMonthlyCostOverrides,
        [key]: { ...(prev.storeMonthlyCostOverrides?.[key] || {}), ...payload },
      },
    }));
    return true;
  };

  // 人件費・仕入が「固定額」モードの時の「月額」入力(要件7)。既存の費用入力(fixed_costs+
  // cost_monthly_amounts)の仕組みをそのまま使う——新しい保存先は作らない。対象カテゴリの
  // 項目が0件なら単月項目(labor/materialsは既存仕様通り常にperiodType:"limited")として
  // 新規作成、1件ならその項目の対象月金額を更新する。2件以上ある場合はこの関数を呼ばない
  // (呼び出し元のUIが「月額」入力自体を出さず、既存の費用入力欄への案内に切り替える) ——
  // 複数の給与明細等を1つに勝手にまとめてしまうと、INTRO社の実データ(スタッフ別給与を
  // 複数項目で管理)のような既存データを壊しかねないため、安全側に倒す。
  const handleSaveCostFixedAmount = async (costType, amount) => {
    if (!canEditMonthlyData(currentRole)) {
      setNotice("人件費・仕入の金額を変更できるのは会社管理者・店舗管理者以上です。");
      return false;
    }
    if (guardFranchiseReadOnly()) return false;
    const categoryKey = costType === "labor" ? "labor" : "materials";
    const items = getFixedCostsForStoreMonth(appState, selectedStoreId, selectedMonth).filter((item) => item.categoryKey === categoryKey);
    if (items.length > 1) return false;
    const { company, store } = resolveTargetCompanyAndStore();
    if (!store?.id) {
      setNotice("店舗情報を確認できませんでした");
      return false;
    }
    if (items.length === 1) {
      return persistCostMonthlyAmount({ costItemId: items[0].id, targetMonth: selectedMonth, amount });
    }
    // 0件: 単月の新規項目として作成する(既存のsubmitFixedCostInnerの新規作成経路と同じ形)。
    if (isSupabaseConfigured && !company?.id) {
      setNotice("店舗情報を確認できませんでした");
      return false;
    }
    const itemId = crypto.randomUUID();
    const nextItem = {
      id: itemId,
      name: costType === "labor" ? "人件費" : "仕入・発注費",
      category: "",
      categoryKey,
      memo: "",
      periodType: "limited",
      startMonth: selectedMonth,
      endMonth: selectedMonth,
      baseAmount: 0,
      sortOrder: fixedCosts.reduce((max, item) => Math.max(max, item.sortOrder ?? 0), 0) + 1,
    };
    if (isSupabaseConfigured) {
      const result = await upsertFixedCostToSupabase({ id: itemId, companyId: company.id, storeId: store.id, entryMonth: selectedMonth, userId: appState.currentUserId, item: nextItem });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return false;
      }
    }
    setAppState((prev) => {
      const key = buildMonthKey(selectedStoreId, selectedMonth);
      return { ...prev, fixedCosts: { ...prev.fixedCosts, [key]: [...(prev.fixedCosts[key] || []), nextItem] } };
    });
    return persistCostMonthlyAmount({ costItemId: itemId, targetMonth: selectedMonth, amount });
  };

  const handleInviteEmail = async (user) => {
    if (user.authUserId) {
      setNotice(`${user.name} はすでに登録済みです`);
      return;
    }
    // ボタン連打・二重実行防止(要件8)。この行の再招待が既に進行中なら何もしない。
    if (resendingUserId === user.id) return;
    setResendingUserId(user.id);
    try {
      // 既存のuser_id/emailはそのまま(Authユーザーを重複作成しない)、トークンだけは
      // 毎回新しく発行する(要件3: 「新しい有効な招待リンクを発行してください」— 古いリンクを
      // 再度有効化するのではなく、常に新しいトークンに切り替える)。
      const inviteTokenValue = createInviteToken();
      const inviteLink = buildInviteLink(typeof window !== "undefined" && window.location?.origin ? window.location.origin : "", inviteTokenValue);
      const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      if (isSupabaseConfigured) {
        const result = await refreshInviteState({ profileId: user.id, inviteToken: inviteTokenValue, inviteExpiresAt });
        if (!result?.ok && !result?.skipped) {
          setNotice(`招待リンクの更新に失敗しました: ${getSupabaseErrorMessage(result?.error)}`);
          return;
        }
      }
      // 状態上書き防止(ここまでにrefreshInviteStateをawaitしているため、appStateRef.current
      // から最新状態を読み直す)。
      const nextState = {
        ...appStateRef.current,
        users: (appStateRef.current.users || []).map((item) => item.id === user.id ? { ...item, invitationStatus: "invited", inviteToken: inviteTokenValue, inviteLink, inviteExpiresAt } : item),
      };
      persistTenantState(nextState);

      if (!isSupabaseConfigured) {
        return;
      }

      // This used to stop here and report success even though no email was ever sent — the
      // token/expiry refresh above only updates the database row. Actually dispatching the email
      // is a separate, genuinely-fallible step (Supabase mail service error, permission denied,
      // rate limit) that must be reported honestly rather than assumed to have worked.
      const emailResult = await sendInviteEmail({
        token: inviteTokenValue,
        redirectOrigin: typeof window !== "undefined" && window.location?.origin ? window.location.origin : "",
      });
      if (!emailResult.ok) {
        // send-invite-emailはメール送信に失敗した場合、サーバー側でinvitation_statusを
        // "pending"(メール未送信)に更新済み — ローカル状態もそれに合わせる。状態上書き防止:
        // 直前のnextStateを再スプレッドすると、このawaitの間に挟まった別の更新を失うため、
        // ここでもappStateRef.currentから読み直す。
        const latestAppStateAfterEmail = appStateRef.current;
        persistTenantState({
          ...latestAppStateAfterEmail,
          users: (latestAppStateAfterEmail.users || []).map((item) => item.id === user.id ? { ...item, invitationStatus: "pending" } : item),
        });
        setNotice(`招待リンクは更新しましたが、招待メールの送信に失敗しました: ${resolveInviteEmailErrorMessage(emailResult.error)}(「URLコピー」から招待URLを直接共有することもできます)`);
        return;
      }
    } finally {
      setResendingUserId("");
    }
  };

  // 招待メールがResend側でBounced/Suppressed等になっていて届かない場合の代替経路(要件5)。
  // ローカルに保存された古いリンクをコピーするのではなく、Supabase Authの正式な招待リンクを
  // generate-invite-link Edge Function経由でその都度生成する(要件1)。メール送信は一切
  // 行わない。生成したリンクはクリップボードへコピーするだけで、DBへの追加保存はしない
  // (要件4: 招待URLの安全性 — 平文で永続保存しない)。
  const handleCopyInviteLink = async (user) => {
    if (user.authUserId) {
      setNotice(`${user.name} はすでに登録済みです`);
      return;
    }
    if (copyingInviteLinkUserId === user.id) return;
    if (!isSupabaseConfigured) {
      const fallbackLink = user.inviteLink || buildInviteLink(typeof window !== "undefined" && window.location?.origin ? window.location.origin : "", user.inviteToken || createInviteToken());
      window.prompt("招待リンク", fallbackLink);
      return;
    }
    setCopyingInviteLinkUserId(user.id);
    try {
      const result = await generateInviteLink({
        token: user.inviteToken,
        redirectOrigin: typeof window !== "undefined" && window.location?.origin ? window.location.origin : "",
      });
      if (!result.ok || !result.actionLink) {
        setNotice(`招待リンクの生成に失敗しました: ${resolveInviteEmailErrorMessage(result.error)}`);
        return;
      }
      // generate-invite-linkは呼び出しのたびにDB側のinvite_tokenを新しく発行し直すため、
      // ローカルのuser.inviteTokenをここで同期しておかないと、次回このユーザーへ再度
      // 「招待リンクをコピー」を押した際に古いトークンを送ってしまい「招待情報が見つかりません」
      // で失敗する(2回目以降のコピーが必ず失敗していたバグの修正)。
      if (result.inviteToken) {
        // 状態上書き防止(ここまでにgenerateInviteLinkをawaitしているため、
        // appStateRef.currentから最新状態を読み直す)。
        const latestAppState = appStateRef.current;
        persistTenantState({
          ...latestAppState,
          users: (latestAppState.users || []).map((item) => item.id === user.id
            ? { ...item, invitationStatus: "invited", inviteToken: result.inviteToken, inviteExpiresAt: result.inviteExpiresAt || item.inviteExpiresAt }
            : item),
        });
      }
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(result.actionLink);
        } else {
          window.prompt("招待リンク", result.actionLink);
        }
      } catch (clipboardError) {
        console.warn("Clipboard write failed", clipboardError);
        window.prompt("招待リンク", result.actionLink);
      }
    } finally {
      setCopyingInviteLinkUserId("");
    }
  };

  // 1件だけ実行中を許し、その間に来た変更は「次に送る最新」として控えておくだけにする
  // (persistInFlightRef/pendingPersistStateRefの説明参照) — 実行中の書き込みが終わった
  // 瞬間に、控えていた最新のstateだけを1回だけ送り直す。こうすることで、途中の古い状態を
  // 表す書き込みが後から完了してtenant_snapshotsを巻き戻すことが構造的に起こらなくなる。
  const runPersistToSupabase = (stateToPersist) => {
    if (persistInFlightRef.current) {
      pendingPersistStateRef.current = stateToPersist;
      return;
    }
    persistInFlightRef.current = true;
    const timestamp = new Date().toISOString();
    setSaveStatus({ status: "saving", message: "保存中…", timestamp, error: false });
    void persistToSupabase(stateToPersist).then((result) => {
      if (result?.ok && !result?.skipped) {
        setSaveStatus({ status: "saved", message: "保存済み ✓", timestamp, error: false });
        return;
      }
      setSaveStatus({ status: "saved", message: "同期待機中", timestamp, error: false });
    }).catch((error) => {
      setSaveStatus({ status: "error", message: resolveErrorReason(error, "保存に失敗しました"), timestamp, error: true });
    }).finally(() => {
      persistInFlightRef.current = false;
      if (pendingPersistStateRef.current) {
        const nextPending = pendingPersistStateRef.current;
        pendingPersistStateRef.current = null;
        runPersistToSupabase(nextPending);
      }
    });
  };

  useEffect(() => {
    if (authMode !== "app" || !currentUser?.authUserId || !syncInitialized) return;
    // 加盟店連携(閲覧専用)を表示中は、自動保存(tenant_snapshots書き込み)を完全にスキップ
    // する。RLSは既にこの書き込みを拒否する(company_adminのcurrent_user_company_ids()には
    // 加盟店のcompany_idが含まれないため)が、RLS拒否に任せると「同期に失敗しました」という
    // ユーザー向けエラーが閲覧中ずっと表示され続けてしまう — ここで明示的にスキップして
    // そもそもその失敗リクエスト自体を発生させない。
    if (appState.isViewingFranchise) return;

    // buildPersistenceComparableState + canonicalStringifyForComparison を、hydrateFromSupabase
    // 完了時(lastPersistedRef.currentへの代入箇所)と必ず同じ組み合わせで使う——「更新中」
    // 無限点滅バグの根本原因(比較対象の形が食い違っていたこと)の再発防止そのものなので、
    // この2箇所以外で直接JSON.stringify(appState)のような比較を新たに作らないこと。
    const snapshot = canonicalStringifyForComparison(buildPersistenceComparableState(appState));
    if (lastPersistedRef.current === snapshot) {
      return;
    }

    lastPersistedRef.current = snapshot;
    runPersistToSupabase(appState);
  }, [appState, authMode, currentUser?.authUserId]);

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || authMode !== "app" || !currentUser?.authUserId || !currentUser?.profileId) return;
    void hydrateFromSupabase({
      authUser: { id: currentUser.authUserId, email: currentUser.email },
      profile: { id: currentUser.profileId, company_id: appState.currentCompanyId, role: currentRole },
      // appStateRef.current(常に最新)を使う——focus/visibilitychange/Realtime再取得の各所と
      // 同じ理由(cross-month date bug調査で確認: このeffectはselectedMonthの変化で発火する
      // ため通常はクロージャのappStateも十分新しいはずだが、他の依存値(currentCompanyId等)の
      // 変化で発火した場合にselectedMonthだけが1テンポ古いクロージャを参照する余地を
      // 完全に無くすため、他の2箇所と同じappStateRef.currentへ統一する)。
      tenantState: appStateRef.current,
    });
  // パフォーマンス改善(要件1・8: 店舗切替での重複fetch防止): appState.selectedStoreは
  // 意図的に依存配列から外している——hydrateFromSupabaseの実際のSupabaseクエリは
  // company_id×対象月だけで内容が決まり(常に会社内の全店舗分をまとめて取得する設計、
  // 上のPromise.all参照)、選択中の店舗が変わっても取得すべきデータは1件も変わらない。
  // 以前はselectedStoreも依存配列に含めていたため、店舗を切り替えるたびに(直前の取得と
  // 全く同じ内容の)18クエリを丸ごと再取得していた。company_id/対象月/role/ログイン状態が
  // 変わった時だけ再取得すれば、店舗切替はローカルの選択状態(resolvePreferredStoreSelection、
  // 既に取得済みのappStateから同期的に解決)だけで即座に反映される。
  }, [authMode, currentUser?.authUserId, currentUser?.profileId, appState.currentCompanyId, appState.selectedMonth, currentRole]);

  useEffect(() => {
    if (dailyMode === "view") {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = null;
      return;
    }

    const hasAnyValue = [dailyForm.totalSales, dailyForm.technicalSales, dailyForm.retailSales, dailyForm.otherSales, dailyForm.customers, dailyForm.newCustomers, dailyForm.repeatCustomers, dailyForm.reviewCount].some((value) => parseNumber(value) > 0) || Boolean(dailyForm.memo);
    const signature = getDailyAutoSaveSignature(dailyForm);
    if (!dailyForm.date || (!hasAnyValue && !dailyForm.id)) {
      return;
    }
    if (signature === lastAutoSaveSignatureRef.current) {
      return;
    }

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      void saveDailyEntry({ silent: true, force: false, autoSave: true });
    }, 400);

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [dailyForm.date, dailyForm.totalSales, dailyForm.technicalSales, dailyForm.retailSales, dailyForm.otherSales, dailyForm.customers, dailyForm.newCustomers, dailyForm.repeatCustomers, dailyForm.reviewCount, dailyForm.memo, dailyMode, selectedStore, selectedMonth, dailyForm.id, dailyEntries]);

  // 日計の読み込み(要件14): 表示中の日付・店舗・月が変わるたびに、appState.cashBreakdownResults
  // (daily_cash_breakdownをhydrateFromSupabaseが取得したもの)から該当日の値を読み直す。
  // dailyForm側のhandleDailyDateChange等とは別経路 — dailyForm.dateの変化を検知して追従する
  // だけなので、既存の日付切替ロジックを一切変更せずに済む。読み込み直後にlastCashBreakdown
  // AutoSaveSignatureRefも同期しておくことで、「読み込んだだけなのに即座に自動保存が走る」
  // ことを防ぐ(下の自動保存effect参照)。
  useEffect(() => {
    // cross-month date bugの修正: selectedMonthではなく対象日(dailyForm.date)自身の月から
    // キーを導出する——対象日欄への直接入力で月をまたいだ直後の再レンダーでも、常に対象日
    // 本来の月の日計を読み直せるようにする(selectedMonthとの一致状態に依存しない)。
    // dailyForm.dateが空(月・店舗切替直後の一時的な状態)の場合は、従来通り空フォームへ戻す。
    const existing = dailyForm.date
      ? appState.cashBreakdownResults?.[buildMonthKey(selectedStoreId, dailyForm.date.slice(0, 7))]?.[dailyForm.date]
      : null;
    const nextForm = existing
      ? { cashAmount: existing.cashAmount, cashlessAmount: existing.cashlessAmount, pointAmount: existing.pointAmount }
      : { cashAmount: "", cashlessAmount: "", pointAmount: "" };
    setCashBreakdownForm(nextForm);
    lastCashBreakdownAutoSaveSignatureRef.current = getCashBreakdownAutoSaveSignature(nextForm);
  }, [dailyForm.date, selectedStoreId, appState.cashBreakdownResults]);

  // 日計専用の自動保存(要件6・7・19: 差額があっても・未入力でも保存自体は妨げない、
  // dailyForm側の自動保存とは完全に別のタイマー・別のシグネチャで動く)。useCashBreakdownが
  // OFFの店舗ではそもそも発火しない(カード自体が表示されないため入力もされ得ない)。
  useEffect(() => {
    if (!useCashBreakdown || dailyMode === "view") {
      if (cashBreakdownAutoSaveTimerRef.current) {
        window.clearTimeout(cashBreakdownAutoSaveTimerRef.current);
      }
      cashBreakdownAutoSaveTimerRef.current = null;
      return;
    }

    const hasAnyValue = [cashBreakdownForm.cashAmount, cashBreakdownForm.cashlessAmount, cashBreakdownForm.pointAmount].some((value) => parseNumber(value) > 0);
    const signature = getCashBreakdownAutoSaveSignature(cashBreakdownForm);
    if (!dailyForm.date || !hasAnyValue) {
      return;
    }
    if (signature === lastCashBreakdownAutoSaveSignatureRef.current) {
      return;
    }

    if (cashBreakdownAutoSaveTimerRef.current) {
      window.clearTimeout(cashBreakdownAutoSaveTimerRef.current);
    }

    cashBreakdownAutoSaveTimerRef.current = window.setTimeout(() => {
      void saveCashBreakdown();
    }, 400);

    return () => {
      if (cashBreakdownAutoSaveTimerRef.current) {
        window.clearTimeout(cashBreakdownAutoSaveTimerRef.current);
      }
    };
  }, [cashBreakdownForm.cashAmount, cashBreakdownForm.cashlessAmount, cashBreakdownForm.pointAmount, dailyMode, dailyForm.date, useCashBreakdown, selectedStoreId, selectedMonth]);

  useEffect(() => {
    // Dock版PWAはウィンドウが背景化/復帰する際、Chromeの通常タブとは異なる組み合わせで
    // focus/visibilitychange/pageshowが発火する(pageshowはbfcache復帰時に単独で発火する
    // ことがある)。どの経路でもhydrateFromSupabase(日次売上・目標・費用等、companies
    // テーブル以外の同期データ)を最新化する。AI分析設定はこの経路を経由しない(独立した
    // aiAnalysisSettings/getCompanyAiAnalysisSettingsのみで管理する)。
    const handleRehydrateTrigger = () => {
      if (!isSupabaseConfigured || authMode !== "app" || !currentUser?.authUserId || !currentUser?.profileId) return;
      void hydrateFromSupabase({
        authUser: { id: currentUser.authUserId, email: currentUser.email },
        profile: { id: currentUser.profileId, company_id: appState.currentCompanyId, role: currentRole },
        // appStateRef.current(常に最新)を使う — このイベントリスナーはeffectの再実行を
        // またいで生き続けるため、クロージャのappStateはこのeffectが最後に走った時点の
        // ものに固定されてしまう(古い値でのタブ復帰時rehydrateが、直前の変更を巻き戻す
        // 原因になっていた)。
        tenantState: appStateRef.current,
      });
    };
    const handleFocus = () => handleRehydrateTrigger();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleRehydrateTrigger();
      }
    };
    // pageshowはbfcache(ブラウザ内メモリ上のページ復帰)からの復帰時にfocus/
    // visibilitychangeより先に、あるいはそれらが発火しないまま単独で発火することがある
    // (特にPWAのウィンドウ切り替え)。
    const handlePageShow = () => handleRehydrateTrigger();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  // パフォーマンス改善(要件1・8: 店舗切替での重複fetch防止): appState.selectedStoreは
  // 意図的に依存配列から外している——hydrateFromSupabaseの実際のSupabaseクエリは
  // company_id×対象月だけで内容が決まり(常に会社内の全店舗分をまとめて取得する設計、
  // 上のPromise.all参照)、選択中の店舗が変わっても取得すべきデータは1件も変わらない。
  // 以前はselectedStoreも依存配列に含めていたため、店舗を切り替えるたびに(直前の取得と
  // 全く同じ内容の)18クエリを丸ごと再取得していた。company_id/対象月/role/ログイン状態が
  // 変わった時だけ再取得すれば、店舗切替はローカルの選択状態(resolvePreferredStoreSelection、
  // 既に取得済みのappStateから同期的に解決)だけで即座に反映される。
  }, [authMode, currentUser?.authUserId, currentUser?.profileId, appState.currentCompanyId, appState.selectedMonth, currentRole]);

  useEffect(() => {
    // 「全店舗」は実店舗ではないのでvisibleStoresには絶対に含まれない — 何もせず放置すると
    // 以降のロジックが「一致する店舗がない」と判断してvisibleStores[0](実店舗)へ勝手に
    // 戻してしまう。表示権限がある間はそのまま維持し、権限を失った(降格された等)場合だけ
    // 通常の店舗へフォールバックさせる。
    if (selectedStore === ALL_STORES_VALUE && canViewAllStores(currentRole)) return;

    // Resolve by the durable selectedStoreId FIRST: a rename changes a store's name but never
    // its id, so a session whose cached name went stale (e.g. another device renamed 本店 to
    // フィーネ原宿) self-heals back to the SAME store under its new name. Only when there's no
    // id match at all (first login, store actually deleted/unassigned) do we fall back to
    // visibleStores[0] — previously this arbitrary alphabetical fallback silently redirected
    // renamed-store sessions to a different, unrelated, often-empty store.
    const storeMatchedById = selectedStoreId ? visibleStores.find((store) => store.id === selectedStoreId) : null;
    if (storeMatchedById) {
      if (storeMatchedById.name !== selectedStore) {
        setAppState((prev) => ({ ...prev, selectedStore: storeMatchedById.name, selectedStoreId: storeMatchedById.id }));
      }
      return;
    }
    if (!selectedStore) {
      const fallbackStore = visibleStores[0];
      if (fallbackStore) {
        setAppState((prev) => ({ ...prev, selectedStore: fallbackStore.name, selectedStoreId: fallbackStore.id }));
      }
      return;
    }
    const matchedByName = visibleStores.find((store) => store.name === selectedStore);
    if (matchedByName) {
      if (matchedByName.id !== selectedStoreId) {
        setAppState((prev) => ({ ...prev, selectedStoreId: matchedByName.id }));
      }
      return;
    }
    const fallbackStore = visibleStores[0];
    if (fallbackStore) {
      setAppState((prev) => ({ ...prev, selectedStore: fallbackStore.name, selectedStoreId: fallbackStore.id }));
    }
  }, [selectedStore, selectedStoreId, visibleStores, currentRole]);

  // 無効な保存状態の自動修復(要件1): 上のselectedStore/selectedStoreId自己修復と同じ理由・
  // 同じ収束のさせ方(id一致→無ければ現在アクセス可能な先頭の会社へフォールバック)で、
  // appState.currentCompanyIdがappState.companiesのどれとも一致しない状態(古い加盟店ID・
  // 権限を失った会社・存在しない会社IDがlocalStorage/tenant_snapshotsのキャッシュに残って
  // いた場合)を1回のsetAppStateで確実に収束させる。
  // 収束条件: 修正後は必ずcurrentCompanyIdがcompanies内のどれかのidと一致する状態になるため、
  // 次回このeffectが走った時にはcompanies.some(...)がtrueとなり、setAppStateを一切呼ばずに
  // 早期returnする——「無効値↔正常値を行き来する」ループにはなり得ない(高々1回の修正で安定)。
  // appState.companiesが空(=まだ会社データを一度も取得できていない、hydrate未完了)の間は、
  // 「一致する会社が無い」を「無効」と誤判定して意味の無い書き換えをしないよう、何もしない。
  useEffect(() => {
    const companies = appState.companies || [];
    if (!companies.length) return;
    if (!appState.currentCompanyId) return;
    const isValid = companies.some((company) => company.id === appState.currentCompanyId);
    if (isValid) return;
    const fallbackCompany = companies[0];
    if (!fallbackCompany) return;
    setAppState((prev) => {
      // effectの実行順で他の変更と競合しないよう、判定時点のprevへ改めて同じ条件を確認する
      // (React 18のバッチ処理・StrictModeの二重実行下でも安全な、標準的な防御パターン)。
      const prevCompanies = prev.companies || [];
      if (!prevCompanies.length || prevCompanies.some((company) => company.id === prev.currentCompanyId)) {
        return prev;
      }
      const nextFallback = prevCompanies[0];
      return {
        ...prev,
        currentCompanyId: nextFallback.id,
        // 無効だった会社に紐づく加盟店閲覧状態も一緒に破棄する(古い加盟店IDが残るケースの対応)。
        isViewingFranchise: false,
        homeCompanyIdBeforeFranchiseView: "",
      };
    });
  }, [appState.companies, appState.currentCompanyId]);

  useEffect(() => {
    if (!isSupabaseConfigured || authMode !== "app" || !currentUser?.authUserId || !appState.currentCompanyId) {
      if (remoteSyncChannelRef.current) {
        supabase.removeChannel(remoteSyncChannelRef.current);
        remoteSyncChannelRef.current = null;
      }
      return;
    }

    const companyId = appState.currentCompanyId;
    const targetMonth = appState.selectedMonth || new Date().toISOString().slice(0, 7);
    const channelName = `tenant-snapshots-${companyId}-${targetMonth}`;
    if (remoteSyncChannelRef.current) {
      supabase.removeChannel(remoteSyncChannelRef.current);
    }

    const channel = supabase.channel(channelName);
    const triggerRehydrate = () => {
      void hydrateFromSupabase({
        authUser: { id: currentUser.authUserId, email: currentUser.email },
        profile: { id: currentUser.profileId, company_id: appState.currentCompanyId, role: currentRole },
        // appStateRef.current(常に最新)を使う — このコールバックはSupabase Realtimeの
        // 購読イベントとして、このeffectが再実行されない限りメモリ上に残り続ける。
        // クロージャのappStateを使うと、このeffectのdependency配列に含まれないフィールドを
        // 変更した直後に自動保存(tenant_snapshots更新)がrealtimeイベントを発火させ、その
        // 古いappStateでhydrateFromSupabaseを呼んでしまい、直前の変更を巻き戻す。
        tenantState: appStateRef.current,
      });
    };
    // Listen across every table a device's edit can land in, so a change made on one
    // device (PC) shows up on another (iPhone) without waiting for a manual refresh —
    // daily_sales/monthly_closings are now the authoritative tables for their data, not
    // just the legacy tenant_snapshots blob.
    channel.on("postgres_changes", { event: "*", schema: "public", table: "tenant_snapshots", filter: `company_id=eq.${companyId}` }, triggerRehydrate);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "daily_sales", filter: `company_id=eq.${companyId}` }, triggerRehydrate);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "monthly_closings", filter: `company_id=eq.${companyId}` }, triggerRehydrate);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "monthly_targets", filter: `company_id=eq.${companyId}` }, triggerRehydrate);
    channel.subscribe();
    remoteSyncChannelRef.current = channel;

    return () => {
      if (remoteSyncChannelRef.current) {
        supabase.removeChannel(remoteSyncChannelRef.current);
        remoteSyncChannelRef.current = null;
      }
    };
  }, [authMode, currentUser?.authUserId, currentUser?.profileId, appState.currentCompanyId, appState.selectedMonth, currentRole]);

  useEffect(() => {
    setBusinessDayInput(businessDaySettings.holidayCount ? String(businessDaySettings.holidayCount) : "");
  }, [businessDaySettings.holidayCount, selectedStore, selectedMonth]);

  useEffect(() => {
    setManualBusinessDayInput(businessDaySettings.mode === "manual" && businessDaySettings.businessDayCount ? String(businessDaySettings.businessDayCount) : "");
  }, [businessDaySettings.mode, businessDaySettings.businessDayCount, selectedStore, selectedMonth]);

  useEffect(() => {
    // cross-month date bugの修正(refベースの同期フラグから、より堅牢なstate比較へ変更):
    // 対象日欄への直接入力で月をまたぐ日付を選んだ場合、handleDailyDateChangeがselectedMonthを
    // その日付の月へ同期させると同時に、dailyForm.dateも同じ月内の日付へ設定済み(両方とも
    // 同じ関数呼び出し内でのsetState、Reactが1回のレンダーへバッチする)。dailyForm.dateの月が
    // 既に(新しい)selectedMonthと一致しているなら、それはhandleDailyDateChangeによる同期
    // 直後だと判定できるため、このeffect本来の「フォームを空にリセットする」動作をスキップし
    // 対象日を保持する——ref・タイミングに依存せず、effect実行時点のstateだけを見て判定する
    // ため、バッチ処理の順序に関する前提を一切必要としない。対象月セレクタ・店舗切替による
    // 通常の月変更では、dailyForm.dateは古い月のままなので一致せず、従来通りリセットされる。
    if (dailyForm.date && dailyForm.date.slice(0, 7) === selectedMonth) {
      return;
    }
    if (!selectedStore) {
      setDailyForm({ ...defaultDailyEntry });
      setDailyMode("create");
      setDailyOriginalEntry(null);
      setDailyInsight("");
      return;
    }
    setDailyForm({ ...defaultDailyEntry });
    setDailyMode("create");
    setDailyOriginalEntry(null);
    setDailyInsight("");
  // dailyForm.dateを依存配列に加える(要件: このeffectの中で読んでいる値は必ず依存配列に
  // 含める、react-hooks/exhaustive-depsに準拠)。月をまたいだ直後のリセット処理自体が
  // dailyForm.dateを""へ変えるため一度だけ再実行されるが、2回目の実行では既に""同士の
  // 比較になり値が変化しないため、無限ループにはならない(defaultDailyEntryを2回setするだけの
  // 無害な冗長レンダー1回にとどまる)。
  }, [selectedMonth, selectedStore, dailyForm.date]);

  const persistSaveStatus = (status, message, error = false) => {
    setSaveStatus({ status, message, timestamp: new Date().toISOString(), error });
  };

  const getDailyEntryPayload = (form, existingEntry = null) => {
    const entryId = form.id || existingEntry?.id || crypto.randomUUID();
    return buildDailyEntryPayload({ form, existingEntry, fieldSettings: activeDailyFieldSettings, entryId });
  };

  const getDailyAutoSaveSignature = (form) => JSON.stringify({
    date: form.date || "",
    totalSales: form.totalSales ?? "",
    technicalSales: form.technicalSales ?? "",
    retailSales: form.retailSales ?? "",
    otherSales: form.otherSales ?? "",
    customers: form.customers ?? "",
    newCustomers: form.newCustomers ?? "",
    repeatCustomers: form.repeatCustomers ?? "",
    reviewCount: form.reviewCount ?? "",
    memo: form.memo ?? "",
  });

  const saveDailyEntry = async ({ silent = false, force = false, autoSave = false, switchToView = false } = {}) => {
    if (isFranchiseReadOnlyForCurrentUser()) {
      if (!silent) setNotice("加盟店データは閲覧のみです（編集・保存はできません）");
      return { ok: false, skipped: true };
    }
    // まとめて入力で埋まっている日は日次入力から保存できない(要件3)。UI側(ボタンの
    // disabled・フォームの閲覧専用表示)に加え、オートセーブ等どの経路から呼ばれても
    // 確実にブロックする最終防御(店休日チェックと同じパターン)。
    if (isDailyDateBatchLocked) {
      if (!silent) setNotice("この日はまとめて入力で反映されています。編集は「まとめて入力」から行ってください。");
      return { ok: false, skipped: true };
    }
    // 権限体系の正式仕様: staffは今日以外の日付を保存できない。RLS側(daily_sales_update/
    // insert_company_scopedのbusiness_date=今日の条件)と同じ制約をここでも明示的に
    // かける — どの経路(オートセーブ含む)から呼ばれても確実にブロックする最終防御。
    if (isStaffPastOrFutureDateLocked) {
      if (!silent) setNotice("スタッフは今日の日次入力のみ保存できます。過去日・未来日は編集できません。");
      return { ok: false, skipped: true };
    }
    if (!selectedStore) {
      if (!silent) {
        setNotice("店舗を先に追加してください");
        persistSaveStatus("error", "店舗を先に追加してください", true);
      }
      return { ok: false, skipped: true };
    }

    if (!dailyForm.date) {
      if (!silent) {
        setNotice("日付は必須です");
        persistSaveStatus("error", "日付は必須です", true);
      }
      return { ok: false, skipped: true };
    }

    // 店休日は日次入力・保存不可(要件18)。UI側でも入力欄自体を隠すが、こちらは
    // オートセーブ等どの経路から呼ばれても確実にブロックするための最終防御。
    if (isHolidayDate(getStoreHolidayDates(appState, selectedStoreId, dailyForm.date.slice(0, 7)), dailyForm.date)) {
      if (!silent) {
        setNotice("この日は店休日のため保存できません");
        persistSaveStatus("error", "この日は店休日のため保存できません", true);
      }
      return { ok: false, skipped: true };
    }

    // 停止中の店舗は新規入力不可(要件1)。UI側の最終防御 — 実際の拒否はRLS
    // (daily_sales_insert_company_scoped、s.status = 'active' 条件)側でも行われる。
    if (selectedStoreEntity?.status === "suspended") {
      if (!silent) {
        setNotice("この店舗は現在停止中のため、新規の売上・日次入力はできません");
        persistSaveStatus("error", "店舗が停止中のため保存できません", true);
      }
      return { ok: false, skipped: true };
    }

    if (dailyMode === "view") {
      return { ok: true, skipped: true };
    }

    const hasAnyValue = [dailyForm.totalSales, dailyForm.technicalSales, dailyForm.retailSales, dailyForm.otherSales, dailyForm.customers, dailyForm.newCustomers, dailyForm.repeatCustomers, dailyForm.reviewCount].some((value) => parseNumber(value) > 0) || Boolean(dailyForm.memo);
    if (!force && !hasAnyValue) {
      return { ok: true, skipped: true };
    }

    // cross-month date bugの修正: dailyEntriesはselectedMonthでメモ化されているため、
    // dailyForm.dateが(対象日欄への直接入力等で)selectedMonthと異なる月を指している間は
    // 古い月のデータを参照してしまい、実際は既に登録済みの日付を「未登録」と誤判定し得る。
    // dailyForm.date自身の月に対して直接取得し直すことで、selectedMonthとの一致状態に
    // 依存しない構造にする(通常時はselectedMonthと一致するため、getDailyResultsForStoreMonth
    // の結果はdailyEntriesと同一)。
    const existingEntry = getDailyResultsForStoreMonth(appState, selectedStoreId, dailyForm.date.slice(0, 7)).find((entry) => entry.date === dailyForm.date) || null;
    if (existingEntry && existingEntry.id !== dailyForm.id && !force) {
      if (!silent) {
        setNotice("この日付は既に登録済みです。編集ボタンで更新してください。");
        persistSaveStatus("error", "この日付は既に登録済みです。編集ボタンで更新してください。", true);
      }
      return { ok: false, skipped: true };
    }

    const { company, store } = resolveTargetCompanyAndStore();
    if (isSupabaseConfigured && (!company?.id || !store?.id || !appState.currentUserId)) {
      const message = "会社・店舗・ユーザー情報を確認できませんでした";
      logSupabaseError({ operation: "saveDailyEntry", table: "daily_sales", userId: appState.currentUserId, companyId: appState.currentCompanyId, storeId: store?.id, businessDate: dailyForm.date, error: new Error(message) });
      persistSaveStatus("error", message, true);
      if (!silent) setNotice(message);
      return { ok: false, error: new Error(message) };
    }

    try {
      persistSaveStatus("saving", "保存中…", false);
      const entry = getDailyEntryPayload(dailyForm, existingEntry);

      // daily_sales (company_id + store_id + business_date, upserted) is the source of truth
      // for this entry now — not the tenant_snapshots blob. Local state is only committed
      // once this write is confirmed, so a failed save can never look like a successful one.
      const remoteResult = await upsertDailySalesEntry({
        companyId: appState.currentCompanyId,
        storeId: store?.id,
        userId: appState.currentUserId,
        entry,
      });
      if (!remoteResult?.ok && !remoteResult?.skipped) {
        throw remoteResult.error || new Error("Supabase への保存に失敗しました");
      }

      // cross-month date bugの根本修正: 保存先のローカルキャッシュは表示中のselectedMonthでは
      // なく、実際に保存したentry自身の日付の月から導出する。selectedMonthとdailyForm.dateの
      // 月がどんな理由であれ食い違っても、この店舗のこの月の集計(月次ダッシュボード・
      // 月次レビュー・損益・CSV等、いずれもdailyResults[key]を参照する)へ別月の実績が
      // 紛れ込むことが構造的に無くなる。
      const key = buildMonthKey(selectedStoreId, entry.date.slice(0, 7));
      setAppState((prev) => {
        const currentList = prev.dailyResults?.[key] || [];
        const currentMergedEntries = [...currentList.filter((item) => item.id !== entry.id && String(item.date) !== String(entry.date)), entry];
        const currentDeduped = deduplicateDailyEntries(currentMergedEntries);
        return {
          ...prev,
          dailyResults: {
            ...prev.dailyResults,
            [key]: currentDeduped.entries,
          },
          dailyResultBackups: {
            ...prev.dailyResultBackups,
            [key]: [...(prev.dailyResultBackups?.[key] || []), ...currentDeduped.backups],
          },
        };
      });

      // saveDailyEntryは400msデバウンスのサイレント自動保存からも呼ばれる(要件1・8)。
      // ここまでのawait(Supabaseへのネットワーク往復)の間にユーザーが入力を続けていた
      // 場合、このentryは保存を開始した時点でclosureに捕まった「古い」値であり、無条件に
      // setDailyForm(entry)すると、保存中に追加で入力された文字が丸ごと消えてしまう
      // (「入力途中の数字や文字が突然消える」不具合の根本原因だった)。関数更新にして、
      // 現在表示中の日付が保存対象の日付と一致する場合だけ id を補完し(次回以降の自動保存が
      // 同じ行を正しくUPDATEできるように)、それ以外のフィールドは「今まさに入力中の値」を
      // 優先してそのまま残す。switchToView(明示的な保存確定操作)の時だけ、正規化済みの
      // 最終値をそのまま表示する。
      setDailyForm((prev) => {
        if (prev.date !== entry.date) return prev;
        if (switchToView) return entry;
        return prev.id === entry.id ? prev : { ...prev, id: entry.id };
      });
      if (dailyForm.id || dailyMode === "edit") {
        setDailyOriginalEntry({ ...entry });
      }
      if (switchToView) {
        setDailyMode("view");
        setDailyOriginalEntry({ ...entry });
      }
      // 文字入力時の画面ガクつき再調査で発見した実際の原因の1つ: buildDailyInsightは
      // 入力中の金額・客数から文章を都度生成するため、文字数が入力内容によって変わる
      // (例:「本日は目標を+¥5,000上回りました。」→「+¥52,000」で文字数が変化)。
      // このinsight-cardは入力欄より下(カレンダーの上)にあるが、以前はサイレント自動保存
      // (400msデバウンス、入力を続けている間も繰り返し発火する)のたびに再生成・再描画して
      // おり、スマホの狭い画面では入力欄と同時に視界に入ることもあるため、高さが変わる
      // たびに画面が上下に動く一因になっていた。入力継続中(サイレント自動保存)は更新せず、
      // 明示的な保存確定(switchToView)・非サイレント保存の時だけ更新する——表示される
      // 分析内容自体(計算ロジック)は無変更、更新タイミングだけを「入力が一区切りついた時」
      // に限定する。
      if (!autoSave) {
        setDailyInsight(buildDailyInsight({ form: entry, target, businessDayCount: businessDaySummary.businessDayCount || 0 }));
      }
      lastAutoSaveSignatureRef.current = getDailyAutoSaveSignature(entry);
      persistSaveStatus("saved", "保存済み ✓", false);
      return { ok: true, data: entry, autoSave };
    } catch (error) {
      logSupabaseError({ operation: "saveDailyEntry", table: "daily_sales", userId: appState.currentUserId, companyId: appState.currentCompanyId, storeId: store?.id, businessDate: dailyForm.date, error });
      // スケーラビリティ点検(2026-08)で発見: 同じ店舗・同じ日付へ複数スタッフがほぼ同時に
      // 初回入力すると、PostgRESTのupsert(on_conflict)はぶつかった側をUPDATEポリシーで
      // 評価するため、staffのUPDATEポリシー(created_by=自分の行のみ)に阻まれてRLS違反
      // (Postgresエラーコード42501)になる——データ消失や二重登録は起きない(実際に登録
      // できるのは常に1件のみ)が、原因不明の汎用エラー文言のままだと「なぜ失敗したか」が
      // 利用者に伝わらないため、この保存経路に限定してこのケースだけ具体的な文言に差し替える。
      const isConcurrentEntryConflict = error?.code === "42501" && !existingEntry;
      const reason = isConcurrentEntryConflict
        ? "保存できませんでした。この日の実績は既に他のスタッフが登録した可能性があります。画面を更新してからご確認ください。"
        : getSupabaseErrorMessage(error);
      persistSaveStatus("error", reason, true);
      if (!silent) {
        setNotice(`保存に失敗しました: ${reason}`);
      }
      return { ok: false, error };
    }
  };

  const resolveTargetCompanyAndStore = () => {
    const company = (appState.companies || []).find((item) => item.id === appState.currentCompanyId) || null;
    // selectedStoreEntity already resolves id-first (see its definition above) so every write
    // path that goes through here (targets, daily entry, day-closing) stays locked to the same
    // store as the rest of the dashboard even if selectedStore's cached name is momentarily stale.
    const store = (selectedStoreEntity && selectedStoreEntity.id && company?.stores?.some((item) => item.id === selectedStoreEntity.id))
      ? selectedStoreEntity
      : company?.stores?.find((item) => item.name === selectedStore) || null;
    return { company, store };
  };

  const BATCH_OVERLAP_FIELD_LABELS = {
    sales: "売上",
    customers: "客数",
    newCustomers: "新規客数",
    repeatCustomers: "再来客数",
    reviewCount: "口コミ数",
    cash: "現金",
    cashless: "キャッシュレス",
    point: "ポイント利用",
  };

  const resetBatchForm = () => {
    setBatchForm(createBatchFormDefaults());
    setBatchEditId("");
  };

  const handleEditBatchEntry = (entry) => {
    setBatchEditId(entry.id);
    setBatchForm({
      startDate: entry.startDate || "",
      endDate: entry.endDate || "",
      totalSales: entry.totalSales === null ? "" : String(entry.totalSales),
      technicalSales: entry.technicalSales === null ? "" : String(entry.technicalSales),
      retailSales: entry.retailSales === null ? "" : String(entry.retailSales),
      otherSales: entry.otherSales === null ? "" : String(entry.otherSales),
      customers: entry.customers === null ? "" : String(entry.customers),
      newCustomers: entry.newCustomers === null ? "" : String(entry.newCustomers),
      repeatCustomers: entry.repeatCustomers === null ? "" : String(entry.repeatCustomers),
      reviewCount: entry.reviewCount === null ? "" : String(entry.reviewCount),
      cashAmount: entry.cashAmount === null ? "" : String(entry.cashAmount),
      cashlessAmount: entry.cashlessAmount === null ? "" : String(entry.cashlessAmount),
      pointAmount: entry.pointAmount === null ? "" : String(entry.pointAmount),
      memo: entry.memo || "",
    });
  };

  // まとめて入力の保存(要件1-9)。既存のsaveDailyEntry(日次入力)とは完全に独立した処理 —
  // dailyForm/dailyResults/日締めのいずれにも触れない。未入力項目はbuildDailyBatchEntryPayload
  // (parseNullableNumber経由)でnullのまま保存し、0として確定させない(要件2)。保存前に
  // 項目単位の重複検知(要件7・8)で警告を挟むが、ブロックはしない — 承知の上での重複入力も
  // 許可する。
  // 二重送信防止(販売前総合チェックで発見: 従来はbatchFormBusyというReact stateだけの
  // ガードで、連打・スマホの二重タップをすり抜け得た)。本処理はhandleSaveBatchEntryInnerへ
  // そのまま残し、このラッパーがrunWithSaveGuard(savingBatchEntryRef)による同期ガードだけを
  // 追加する——batchFormBusy自体(ボタンのdisabled/ラベル表示用)はhandleSaveBatchEntryInner
  // 側で既存どおりtrue/falseする(バリデーションで早期returnする場合はbusyを立てないという
  // 既存の挙動もそのまま維持するため)。
  const handleSaveBatchEntry = () => runWithSaveGuard(savingBatchEntryRef, handleSaveBatchEntryInner);

  const handleSaveBatchEntryInner = async () => {
    // 権限体系の正式仕様(要件6): まとめて入力の権限はUI(ボタン非表示)だけに頼らず、
    // 保存処理側でも明示的にチェックする — staffが万一URL直接アクセス・ブラウザ改変等で
    // この関数を呼び出しても、ここで確実に拒否する(RLS側のdaily_batch_entries_insert/
    // update_company_scopedもstore_manager以上限定のため最終的にも拒否されるが、
    // 分かりやすいエラーメッセージのためここでも明示的にチェックする)。
    if (!canEditMonthlyData(currentRole)) {
      setNotice("まとめて入力を利用できるのは会社管理者・店舗管理者以上です。");
      return;
    }
    if (guardFranchiseReadOnly()) return;
    if (!selectedStore) {
      setNotice("店舗を先に追加してください");
      return;
    }
    if (!batchForm.startDate || !batchForm.endDate) {
      setBatchFormStatus({ status: "error", message: "開始日・終了日は必須です" });
      return;
    }
    if (batchForm.startDate > batchForm.endDate) {
      setBatchFormStatus({ status: "error", message: "終了日は開始日以降にしてください" });
      return;
    }
    if (batchForm.startDate.slice(0, 7) !== batchForm.endDate.slice(0, 7)) {
      setBatchFormStatus({ status: "error", message: "まとめて入力は同じ月内の期間だけ指定できます(月をまたぐ期間は指定できません)" });
      return;
    }

    const payload = buildDailyBatchEntryPayload({ form: batchForm, fieldSettings: activeDailyFieldSettings });
    const hasAnyValue = [payload.totalSales, payload.technicalSales, payload.retailSales, payload.otherSales, payload.customers, payload.newCustomers, payload.repeatCustomers, payload.reviewCount, payload.cashAmount, payload.cashlessAmount, payload.pointAmount].some((value) => value !== null) || Boolean(payload.memo);
    if (!hasAnyValue) {
      setBatchFormStatus({ status: "error", message: "少なくとも1項目を入力してください" });
      return;
    }

    // 実際に値が入っている項目だけを重複検知の対象にする(未入力項目は他の入力と競合しない)。
    const filledFieldKeys = [];
    if (payload.totalSales !== null || payload.technicalSales !== null || payload.retailSales !== null || payload.otherSales !== null) filledFieldKeys.push("sales");
    if (payload.customers !== null) filledFieldKeys.push("customers");
    if (payload.newCustomers !== null) filledFieldKeys.push("newCustomers");
    if (payload.repeatCustomers !== null) filledFieldKeys.push("repeatCustomers");
    if (payload.reviewCount !== null) filledFieldKeys.push("reviewCount");
    if (payload.cashAmount !== null) filledFieldKeys.push("cash");
    if (payload.cashlessAmount !== null) filledFieldKeys.push("cashless");
    if (payload.pointAmount !== null) filledFieldKeys.push("point");

    const conflicts = detectBatchEntryFieldOverlap({
      dailyEntries,
      batchEntries,
      startDate: batchForm.startDate,
      endDate: batchForm.endDate,
      fieldKeys: filledFieldKeys,
      excludeBatchEntryId: batchEditId,
    });
    if (conflicts.length > 0) {
      const labels = conflicts.map((item) => BATCH_OVERLAP_FIELD_LABELS[item.fieldKey] || item.fieldKey).join("・");
      const confirmed = window.confirm(`この期間には既に「${labels}」のデータがあります。重複計上になる可能性があります。\n\nこのまま保存しますか？`);
      if (!confirmed) return;
    }

    const { company, store } = resolveTargetCompanyAndStore();
    if (isSupabaseConfigured && (!company?.id || !store?.id || !appState.currentUserId)) {
      const message = "会社・店舗・ユーザー情報を確認できませんでした";
      setBatchFormStatus({ status: "error", message });
      setNotice(message);
      return;
    }

    setBatchFormBusy(true);
    setBatchFormStatus({ status: "saving", message: "保存中…" });
    try {
      const result = batchEditId
        ? await updateDailyBatchEntry({ id: batchEditId, companyId: appState.currentCompanyId, storeId: store?.id, userId: appState.currentUserId, entry: payload })
        : await createDailyBatchEntry({ companyId: appState.currentCompanyId, storeId: store?.id, userId: appState.currentUserId, entry: payload });
      if (!result?.ok && !result?.skipped) {
        throw result.error || new Error("保存に失敗しました");
      }
      const savedEntry = result.data
        ? dailyBatchEntryRowToEntry(result.data)
        : { id: batchEditId || `local-${Date.now()}`, ...payload };
      const key = buildMonthKey(store?.id || selectedStoreId, batchForm.startDate.slice(0, 7));
      setAppState((prev) => {
        const currentList = (prev.dailyBatchEntries?.[key] || []).filter((item) => item.id !== savedEntry.id);
        return {
          ...prev,
          dailyBatchEntries: { ...prev.dailyBatchEntries, [key]: [...currentList, savedEntry] },
        };
      });
      // 保存成功時のバナー通知は出さない(要件19-22: 通常の保存成功は画面上部の常設通知
      // ではなく、一覧に反映される・フォームが閉じる、といった自然な変化で分かるようにする
      // というUIルール)。失敗時のエラー通知だけは維持する(下のcatch節)。
      setBatchFormStatus({ status: "idle", message: "" });
      resetBatchForm();
    } catch (error) {
      const reason = getSupabaseErrorMessage(error);
      setBatchFormStatus({ status: "error", message: reason });
      setNotice(`まとめて入力の保存に失敗しました: ${reason}`);
    } finally {
      setBatchFormBusy(false);
    }
  };

  // まとめて入力の削除(要件22)。この1件だけをdailyBatchEntriesから取り除く — 日次入力・
  // 目標データ・他のまとめ入力レコードには一切触れない。
  const handleDeleteBatchEntry = async (entry) => {
    // 保存処理と同じ理由で削除処理側にも明示的な権限チェックを持たせる(要件6)。
    if (!canEditMonthlyData(currentRole)) {
      setNotice("まとめて入力を利用できるのは会社管理者・店舗管理者以上です。");
      return;
    }
    if (guardFranchiseReadOnly()) return;
    if (!window.confirm(`${entry.startDate}〜${entry.endDate}のまとめて入力を削除しますか？この操作は取り消せません。`)) return;
    try {
      const result = await deleteDailyBatchEntry({ id: entry.id });
      if (!result?.ok && !result?.skipped) {
        throw result.error || new Error("削除に失敗しました");
      }
      const key = buildMonthKey(selectedStoreId, String(entry.startDate).slice(0, 7));
      setAppState((prev) => ({
        ...prev,
        dailyBatchEntries: { ...prev.dailyBatchEntries, [key]: (prev.dailyBatchEntries?.[key] || []).filter((item) => item.id !== entry.id) },
      }));
      // 削除確認(上のwindow.confirm)は維持しつつ、削除成功のバナー通知は出さない(要件19-22)。
      // 一覧からその行が消えることで削除できたことが自然に分かる。
      if (batchEditId === entry.id) resetBatchForm();
    } catch (error) {
      setNotice(`削除に失敗しました: ${getSupabaseErrorMessage(error)}`);
    }
  };

  const getCashBreakdownAutoSaveSignature = (form) => JSON.stringify({
    cashAmount: form.cashAmount ?? "",
    cashlessAmount: form.cashlessAmount ?? "",
    pointAmount: form.pointAmount ?? "",
  });

  // 日計の保存。daily_cash_breakdown(要件14: company_id・store_id・対象日・現金・
  // キャッシュレス・ポイント利用を紐付けて保存)への独立した保存経路 — daily_sales/
  // is_day_closedには一切触れないため、日締め状態を巻き戻すことは構造的に起こらない
  // (要件13)。差額があっても・未入力でも保存自体は妨げない(要件6・7) — 3項目とも
  // 未入力の場合は何もしない(空のdaily_cash_breakdown行を作らない)。
  const saveCashBreakdown = async () => {
    if (isFranchiseReadOnlyForCurrentUser()) return { ok: false, skipped: true };
    if (dailyMode === "view") return { ok: true, skipped: true };
    if (!dailyForm.date) return { ok: true, skipped: true };
    const hasAnyValue = [cashBreakdownForm.cashAmount, cashBreakdownForm.cashlessAmount, cashBreakdownForm.pointAmount].some((value) => parseNumber(value) > 0);
    if (!hasAnyValue) return { ok: true, skipped: true };

    const { store } = resolveTargetCompanyAndStore();
    if (isSupabaseConfigured && (!store?.id || !appState.currentUserId)) {
      return { ok: false, skipped: true };
    }

    try {
      const payload = {
        cashAmount: parseNumber(cashBreakdownForm.cashAmount),
        cashlessAmount: parseNumber(cashBreakdownForm.cashlessAmount),
        pointAmount: parseNumber(cashBreakdownForm.pointAmount),
      };
      const remoteResult = await upsertDailyCashBreakdown({
        companyId: appState.currentCompanyId,
        storeId: store?.id,
        userId: appState.currentUserId,
        businessDate: dailyForm.date,
        ...payload,
      });
      if (!remoteResult?.ok && !remoteResult?.skipped) {
        throw remoteResult.error || new Error("日計の保存に失敗しました");
      }

      // cross-month date bugの根本修正: saveDailyEntryと同じ理由で、selectedMonthではなく
      // 保存対象のdailyForm.date自身の月からキーを導出する。
      const key = buildMonthKey(selectedStoreId, dailyForm.date.slice(0, 7));
      setAppState((prev) => ({
        ...prev,
        cashBreakdownResults: {
          ...prev.cashBreakdownResults,
          [key]: { ...(prev.cashBreakdownResults?.[key] || {}), [dailyForm.date]: payload },
        },
      }));
      lastCashBreakdownAutoSaveSignatureRef.current = getCashBreakdownAutoSaveSignature(cashBreakdownForm);
      return { ok: true, data: payload };
    } catch (error) {
      logSupabaseError({ operation: "saveCashBreakdown", table: "daily_cash_breakdown", userId: appState.currentUserId, companyId: appState.currentCompanyId, storeId: store?.id, businessDate: dailyForm.date, error });
      return { ok: false, error };
    }
  };

  useEffect(() => {
    if (!selectedStore || !targetSelectedMonth) return;
    const requestId = targetLoadRequestRef.current + 1;
    targetLoadRequestRef.current = requestId;
    // Clear immediately so a month/store switch never shows the previous selection's
    // numbers, even briefly, while the new ones are being fetched.
    setTargetLoadStatus({ status: "loading", loadedMonth: "", loadedStore: "" });
    setTargetDraft({ ...defaultTarget });
    setTargetHolidayDraft("");

    const load = async () => {
      let loadedTarget = null;
      let loadedHolidayCount = null;

      if (isAllStoresView) {
        // 全店舗ビュー: company_all_stores_targets(store_idを持たない、会社単位の目標+
        // 営業日設定)から読み込む。各店舗のmonthly_targetsには一切触れない。
        const companyId = appState.currentCompanyId;
        try {
          if (isSupabaseConfigured && companyId) {
            const result = await loadAllStoresTargetFromSupabase({ companyId, targetMonth: targetSelectedMonth });
            if (!result?.ok) throw result?.error || new Error("全店舗目標の取得に失敗しました");
            if (result?.data) {
              loadedTarget = {
                targetSales: result.data.target_sales,
                targetTechnicalSales: result.data.target_technical_sales,
                targetRetailSales: result.data.target_retail_sales,
                targetCustomers: result.data.target_customers,
                targetAverageSpend: result.data.target_average_spend,
                targetNewCustomers: result.data.target_new_customers,
                targetRepeatCustomers: result.data.target_repeat_customers,
                targetReviewCount: result.data.target_review_count,
              };
              loadedHolidayCount = result.data.holiday_count;
            }
          }
        } catch (error) {
          if (targetLoadRequestRef.current !== requestId) return;
          setTargetLoadStatus({ status: "error", loadedMonth: "", loadedStore: "" });
          setNotice(getSupabaseErrorMessage(error));
          return;
        }
        if (targetLoadRequestRef.current !== requestId) return;
        if (!loadedTarget) {
          loadedTarget = getAllStoresTargetForCompanyMonth(appState, companyId, targetSelectedMonth);
          loadedHolidayCount = getAllStoresBusinessDaySettings(appState, companyId, targetSelectedMonth).holidayCount;
        }
      } else {
      const { company, store } = resolveTargetCompanyAndStore();
      try {
        if (isSupabaseConfigured && company?.id && store?.id) {
          const result = await loadMonthlyTargetFromSupabase({ companyId: company.id, storeId: store.id, targetMonth: targetSelectedMonth });
          if (!result?.ok) {
            // A failed fetch must not be treated the same as "no target saved yet" — that
            // would silently fall through to showing local/default values as if they were
            // authoritative, exactly the kind of masked error this rewrite is meant to end.
            throw result?.error || new Error("月間目標の取得に失敗しました");
          }
          if (result?.data) {
            loadedTarget = {
              targetSales: result.data.target_sales,
              targetTechnicalSales: result.data.target_technical_sales,
              targetRetailSales: result.data.target_retail_sales,
              targetCustomers: result.data.target_customers,
              targetAverageSpend: result.data.target_average_spend,
              targetNewCustomers: result.data.target_new_customers,
              targetRepeatCustomers: result.data.target_repeat_customers,
              targetRepeatRate: result.data.target_repeat_rate,
              targetAverageCustomersPerDay: result.data.target_average_customers_per_day,
              targetLaborRate: result.data.target_labor_rate,
              targetMaterialRate: result.data.target_material_rate,
              targetAdRate: result.data.target_ad_rate,
              targetOperatingMargin: result.data.target_operating_margin,
              targetReviewCount: result.data.target_review_count,
            };
            loadedHolidayCount = result.data.holiday_count;
          }
        }
      } catch (error) {
        if (targetLoadRequestRef.current !== requestId) return;
        setTargetLoadStatus({ status: "error", loadedMonth: "", loadedStore: "" });
        setNotice(getSupabaseErrorMessage(error));
        return;
      }

      if (targetLoadRequestRef.current !== requestId) return; // a newer month/store switch superseded this fetch

      if (!loadedTarget) {
        // No Supabase row yet for this store+month (or Supabase unavailable): fall back to
        // whatever is cached locally so the form isn't blank for no reason.
        loadedTarget = getTargetForStoreMonth(appState, selectedStoreId, targetSelectedMonth);
        loadedHolidayCount = getBusinessDaySettings(appState, selectedStoreId, targetSelectedMonth).holidayCount;
      }
      }

      const resolvedTarget = { ...defaultTarget, ...loadedTarget };
      const resolvedHolidayDraft = loadedHolidayCount ? String(loadedHolidayCount) : "";
      setTargetDraft(resolvedTarget);
      setTargetHolidayDraft(resolvedHolidayDraft);
      setTargetLoadStatus({ status: "loaded", loadedMonth: targetSelectedMonth, loadedStore: selectedStore });
      setTargetDirty(false);
      setTargetSaveStatus({ status: "idle", message: "" });
      // Seeded to what was just loaded, not cleared to "" — otherwise the autosave effect
      // below would see freshly-loaded data as "different from last saved" on the very next
      // tick and immediately re-save data that was already saved, for every month switch.
      lastTargetAutoSaveSignatureRef.current = JSON.stringify({ targetDraft: resolvedTarget, targetHolidayDraft: resolvedHolidayDraft });
    };

    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSelectedMonth, selectedStore, appState.currentCompanyId]);

  const updateTargetDraftField = (field, value) => {
    setTargetDraft((prev) => ({ ...prev, [field]: value }));
    setTargetDirty(true);
  };
  // dailyFieldChangeHandlers等と同じ理由・同じパターン(memo化されたFieldへ安定した
  // onChangeを渡す)。
  const updateTargetDraftFieldRef = useRef(updateTargetDraftField);
  updateTargetDraftFieldRef.current = updateTargetDraftField;
  const [targetFieldChangeHandlers] = useState(() => {
    const makeHandler = (field) => (value) => updateTargetDraftFieldRef.current(field, value);
    return ["targetSales", "targetTechnicalSales", "targetRetailSales", "targetCustomers", "targetAverageSpend", "targetNewCustomers", "targetRepeatCustomers", "targetReviewCount"].reduce((acc, field) => {
      acc[field] = makeHandler(field);
      return acc;
    }, {});
  });

  const handleTargetMonthChange = (nextMonth) => {
    if (!nextMonth || nextMonth === targetSelectedMonth) return;
    if (targetDirty && !window.confirm("変更内容が保存されていません。対象月を変更しますか？")) {
      return;
    }
    setTargetSelectedMonth(nextMonth);
  };

  const persistMonthlyTarget = async ({ silent = false } = {}) => {
    if (isFranchiseReadOnlyForCurrentUser()) {
      if (!silent) setNotice("加盟店データは閲覧のみです（編集・保存はできません）");
      return { ok: false, skipped: true };
    }
    if (!selectedStore) {
      if (!silent) setNotice("店舗を先に追加してください");
      return { ok: false, skipped: true };
    }
    if (targetSaveInFlightRef.current) return { ok: false, skipped: true };
    const savedMonthLabel = formatMonthLabel(targetSelectedMonth);

    if (isAllStoresView) {
      // company_all_stores_targets へ保存する。各店舗のmonthly_targetsには一切書き込まない
      // (全店舗目標は各店舗の目標とは別管理、按分もしない)。
      const companyId = appState.currentCompanyId;
      if (!isSupabaseConfigured) {
        const key = buildCompanyMonthKey(companyId, targetSelectedMonth);
        setAppState((prev) => ({
          ...prev,
          allStoresTargets: { ...prev.allStoresTargets, [key]: { ...targetDraft } },
          allStoresBusinessDaySettings: { ...prev.allStoresBusinessDaySettings, [key]: { ...(prev.allStoresBusinessDaySettings?.[key] || {}), holidayCount: parseNumber(targetHolidayDraft) } },
        }));
        setTargetDirty(false);
        setTargetSaveStatus({ status: "saved", message: `${savedMonthLabel}の全店舗目標を保存しました（ローカル）` });
        lastTargetAutoSaveSignatureRef.current = JSON.stringify({ targetDraft, targetHolidayDraft });
        return { ok: true };
      }
      if (!companyId) {
        setTargetSaveStatus({ status: "error", message: "会社情報を確認できませんでした" });
        if (!silent) setNotice("会社情報を確認できませんでした");
        return { ok: false };
      }
      targetSaveInFlightRef.current = true;
      setTargetSaveStatus({ status: "saving", message: "保存中…" });
      try {
        const result = await upsertAllStoresTargetToSupabase({
          companyId,
          targetMonth: targetSelectedMonth,
          userId: appState.currentUserId,
          target: { ...targetDraft, holidayCount: parseNumber(targetHolidayDraft) },
        });
        if (!result?.ok || result?.skipped) {
          throw new Error(result?.error?.message || (result?.skipped ? "ユーザー情報を確認できませんでした" : "保存に失敗しました"));
        }
        const key = buildCompanyMonthKey(companyId, targetSelectedMonth);
        setAppState((prev) => ({
          ...prev,
          allStoresTargets: { ...prev.allStoresTargets, [key]: { ...targetDraft } },
          allStoresBusinessDaySettings: { ...prev.allStoresBusinessDaySettings, [key]: { ...(prev.allStoresBusinessDaySettings?.[key] || {}), holidayCount: parseNumber(targetHolidayDraft) } },
        }));
        setTargetDirty(false);
        setTargetSaveStatus({ status: "saved", message: `${savedMonthLabel}の全店舗目標を保存しました` });
        lastTargetAutoSaveSignatureRef.current = JSON.stringify({ targetDraft, targetHolidayDraft });
        return { ok: true };
      } catch (error) {
        setTargetSaveStatus({ status: "error", message: "保存に失敗しました。もう一度お試しください" });
        if (!silent) setNotice(`全店舗目標の保存に失敗しました: ${getSupabaseErrorMessage(error)}`);
        return { ok: false, error };
      } finally {
        targetSaveInFlightRef.current = false;
      }
    }

    const { company, store } = resolveTargetCompanyAndStore();
    // 停止中の店舗は新規入力不可(要件1)。全店舗目標(上のisAllStoresView分岐)は個別店舗の
    // 状態とは無関係のため対象外 — ここは個別店舗の目標保存のみをガードする。
    if (store?.status === "suspended") {
      setTargetSaveStatus({ status: "error", message: "この店舗は現在停止中のため保存できません" });
      if (!silent) setNotice("この店舗は現在停止中のため、月間目標を保存できません");
      return { ok: false, skipped: true };
    }
    if (!isSupabaseConfigured) {
      // Local-only/dev mode: mirror straight into appState (still explicit-save, not
      // per-keystroke) so the rest of the app reflects it.
      const key = buildMonthKey(selectedStoreId, targetSelectedMonth);
      setAppState((prev) => ({
        ...prev,
        targets: { ...prev.targets, [key]: { ...targetDraft } },
        businessDaySettings: { ...prev.businessDaySettings, [key]: { ...(prev.businessDaySettings?.[key] || {}), holidayCount: parseNumber(targetHolidayDraft) } },
      }));
      setTargetDirty(false);
      setTargetSaveStatus({ status: "saved", message: `${savedMonthLabel}の目標を保存しました（ローカル）` });
      lastTargetAutoSaveSignatureRef.current = JSON.stringify({ targetDraft, targetHolidayDraft });
      return { ok: true };
    }
    if (!company?.id || !store?.id) {
      setTargetSaveStatus({ status: "error", message: "会社・店舗情報を確認できませんでした" });
      if (!silent) setNotice("会社・店舗情報を確認できませんでした");
      return { ok: false };
    }

    targetSaveInFlightRef.current = true;
    setTargetSaveStatus({ status: "saving", message: "保存中…" });
    try {
      const result = await upsertMonthlyTargetToSupabase({
        companyId: company.id,
        storeId: store.id,
        targetMonth: targetSelectedMonth,
        userId: appState.currentUserId,
        target: { ...targetDraft, holidayCount: parseNumber(targetHolidayDraft) },
      });
      if (!result?.ok || result?.skipped) {
        throw new Error(result?.error?.message || (result?.skipped ? "ユーザー情報を確認できませんでした" : "保存に失敗しました"));
      }

      const key = buildMonthKey(selectedStoreId, targetSelectedMonth);
      setAppState((prev) => ({
        ...prev,
        targets: { ...prev.targets, [key]: { ...targetDraft } },
        businessDaySettings: { ...prev.businessDaySettings, [key]: { ...(prev.businessDaySettings?.[key] || {}), holidayCount: parseNumber(targetHolidayDraft) } },
      }));
      setTargetDirty(false);
      setTargetSaveStatus({ status: "saved", message: `${savedMonthLabel}の目標を保存しました` });
      lastTargetAutoSaveSignatureRef.current = JSON.stringify({ targetDraft, targetHolidayDraft });
      return { ok: true };
    } catch (error) {
      setTargetSaveStatus({ status: "error", message: "保存に失敗しました。もう一度お試しください" });
      if (!silent) setNotice(`月間目標の保存に失敗しました: ${getSupabaseErrorMessage(error)}`);
      return { ok: false, error };
    } finally {
      targetSaveInFlightRef.current = false;
    }
  };

  const handleSaveMonthlyTarget = () => {
    void persistMonthlyTarget({ silent: false });
  };

  // Debounced autosave: fires ~0.9s after the draft actually diverges from what's already
  // saved (tracked via lastTargetAutoSaveSignatureRef, seeded on load), so switching months or
  // first loading a store's saved target never triggers a spurious re-save. Only runs once a
  // load has actually completed, and reuses persistMonthlyTarget so autosave and the manual
  // button can never create two different rows or leave one out of sync with the other.
  useEffect(() => {
    if (targetLoadStatus.status !== "loaded") return undefined;
    const signature = JSON.stringify({ targetDraft, targetHolidayDraft });
    if (signature === lastTargetAutoSaveSignatureRef.current) return undefined;
    if (targetAutoSaveTimerRef.current) window.clearTimeout(targetAutoSaveTimerRef.current);
    targetAutoSaveTimerRef.current = window.setTimeout(() => {
      void persistMonthlyTarget({ silent: true });
    }, 900);
    return () => {
      if (targetAutoSaveTimerRef.current) window.clearTimeout(targetAutoSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetDraft, targetHolidayDraft, targetLoadStatus.status]);

  const handleDailyDateChange = (value) => {
    const nextDate = value;
    // cross-month date bugの根本対応: 対象日欄はネイティブ<input type="date">でmin/max制限が
    // 無く、表示中の対象月と異なる月の日付を直接入力できてしまう。従来はselectedMonthを
    // 変更しないままdailyFormの日付だけをその月をまたいだ日付へ差し替えていたため、
    // (a) dailyEntries/batchAllocatedEntries(いずれもselectedMonthでメモ化)が古い月のまま
    // 参照され、実際は存在する対象日のデータを「無い」と誤判定する、(b) 保存時にselectedMonth
    // 基準のbuildMonthKeyへ書き込まれ、表示中の月の集計に別月の実績が紛れ込む、という2つの
    // 不具合が起きていた。ここで対象日の月が表示中の対象月と異なる場合はselectedMonthも
    // その月へ同期させ、対象月・対象日・日次入力・月カレンダー・営業進捗・日締め状態・
    // 月次ダッシュボード・月次レビュー・損益・CSVがすべて同じ月を参照するようにする
    // (「今日の日付」や現在月への強制補正は行わない——あくまで選んだ日付の月へ追従するだけ)。
    const nextMonthValue = nextDate ? nextDate.slice(0, 7) : "";
    const isCrossMonth = Boolean(nextMonthValue) && nextMonthValue !== selectedMonth;
    if (isCrossMonth) {
      handleMonthSwitch(nextMonthValue);
    }
    // 月をまたぐ場合、selectedMonthでメモ化されたdailyEntries/batchAllocatedEntriesは
    // このレンダーではまだ古い月のまま(Reactの再レンダーはこの関数の後で起きる)なので、
    // 対象日の月に対して直接純粋関数を呼び、最新のappStateから正しい月のデータを取得する。
    const targetMonthEntries = isCrossMonth
      ? getDailyResultsForStoreMonth(appState, selectedStoreId, nextMonthValue)
      : dailyEntries;
    const targetMonthBatchAllocations = isCrossMonth
      ? getBatchAllocatedEntries(appState, selectedStoreId, nextMonthValue)
      : batchAllocatedEntries;
    const existingEntry = targetMonthEntries.find((entry) => entry.date === nextDate) || null;

    if (existingEntry) {
      // Load totalSales exactly as stored — recomputing it from technicalSales+retailSales
      // here would zero out a legacy total-sales-only entry the instant it's opened, before
      // the user has touched anything (updateDailyField is what re-derives it live once the
      // user actually edits technicalSales/retailSales).
      setDailyForm({ ...existingEntry });
      setDailyMode("view");
      setDailyOriginalEntry({ ...existingEntry });
      // 月をまたぐ場合、target/businessDaySummaryはまだ古い月のまま(上と同じ理由)なので、
      // 古い月の営業日数を基準にした誤ったAI分析コメントを一瞬でも見せないよう空にする——
      // 次のレンダーで新しい月のtarget/businessDaySummaryが揃った時点までは表示しない。
      setDailyInsight(isCrossMonth ? "" : buildDailyInsight({ form: existingEntry, target, businessDayCount: businessDaySummary.businessDayCount || 0 }));
      return;
    }

    // まとめて入力で埋まっている日はdailyResultsに実データが無い(要件3: 日別データへ分割
    // しないため)。ここで日付が一致する配分結果を探し、あればその値を表示専用として
    // dailyFormへ読み込む(dailyModeは常にview固定 — isDailyDateBatchLockedが編集系の
    // 各ハンドラをガードする)。
    const batchAllocation = targetMonthBatchAllocations.find((entry) => entry.date === nextDate) || null;
    if (batchAllocation) {
      setDailyForm({ ...defaultDailyEntry, ...batchAllocation, date: nextDate });
      setDailyMode("view");
      setDailyOriginalEntry(null);
      setDailyInsight("");
      return;
    }

    // staffは今日以外の日付には新規入力できない(要件: 過去日・未来日の編集不可)。
    // データが存在しない日でも、編集可能な空フォームを開かせずview固定にする。
    const isStaffNonTodayDate = normalizeRole(currentRole) === "staff" && nextDate !== formatLocalDate(new Date());
    setDailyForm({ ...defaultDailyEntry, date: nextDate });
    setDailyMode(isStaffNonTodayDate ? "view" : "create");
    setDailyOriginalEntry(null);
    setDailyInsight("");
  };

  const submitDailyEntry = (event) => {
    event?.preventDefault();
    void saveDailyEntry({ silent: false, force: true, switchToView: true });
    // 保存ボタンは日計の400msデバウンスを待たずに即座に確定させる(入力直後に保存を
    // 押した場合でも取りこぼさないため)。daily_salesとは別の保存経路なので、
    // どちらかが失敗しても他方には影響しない。
    if (useCashBreakdown) void saveCashBreakdown();
  };

  const editDailyEntry = () => {
    if (isDailyDateBatchLocked) {
      setNotice("この日はまとめて入力で反映されています。編集は「まとめて入力」から行ってください。");
      return;
    }
    if (isStaffPastOrFutureDateLocked) {
      setNotice("スタッフは今日の日次入力のみ保存できます。過去日・未来日は編集できません。");
      return;
    }
    if (!dailyForm.id) {
      setNotice("編集対象のデータがありません");
      return;
    }
    setDailyMode("edit");
  };

  const cancelDailyEntryEdit = () => {
    if (dailyOriginalEntry) {
      setDailyForm({ ...dailyOriginalEntry });
      setDailyMode("view");
      setDailyInsight(buildDailyInsight({ form: dailyOriginalEntry, target, businessDayCount: businessDaySummary.businessDayCount || 0 }));
      return;
    }
    setDailyForm({ ...defaultDailyEntry, date: dailyForm.date || "" });
    setDailyMode("create");
    setDailyInsight("");
  };

  // 「費用入力」の項目定義(名前・カテゴリ・備考・継続/期間限定)。金額はここでは扱わず、
  // persistCostMonthlyAmount経由でcostMonthlyAmountsに対象月ごと別保存する(下記参照)。
  // 継続の場合、開始月は画面には出さず対象月(selectedMonth追従、942行目のeffect参照)を
  // そのまま使い、終了月は常に空にする。期間限定の場合だけ開始月・終了月を必須にする。
  const submitFixedCost = async (event) => {
    event.preventDefault();
    if (guardFranchiseReadOnly()) return;
    if (savingFixedCostRef.current) return;
    savingFixedCostRef.current = true;
    setFixedCostFormBusy(true);
    try {
      await submitFixedCostInner();
    } finally {
      savingFixedCostRef.current = false;
      setFixedCostFormBusy(false);
    }
  };

  const submitFixedCostInner = async () => {
    const isEditing = Boolean(fixedForm.id);
    if (!fixedForm.name) {
      setNotice("費用名は必須です");
      return;
    }
    if (!fixedForm.categoryKey) {
      setNotice("費用カテゴリは必須です");
      return;
    }
    // 人件費・材料/発注費は月途中は未確定なことが多く、対象月ごとに単月入力する運用のため、
    // 「継続」を選ばせず常に単月(開始月=終了月=対象年月)として登録する。
    const isSingleMonthCategory = fixedForm.categoryKey === "labor" || fixedForm.categoryKey === "materials";
    const periodType = isSingleMonthCategory || fixedForm.periodType === "limited" ? "limited" : "ongoing";
    // 継続費用の基本値(要件1-4): 新規登録時は必須、既存項目の編集時も(このフォームに基本値
    // 欄を出しているため)必須にする。単月・期間限定は既存仕様通り新規登録時だけ必須。
    if (periodType === "ongoing" ? !fixedForm.amount : !isEditing && !fixedForm.amount) {
      setNotice("金額は必須です");
      return;
    }
    let startMonth = fixedForm.startMonth || selectedMonth;
    let endMonth = "";
    if (isSingleMonthCategory) {
      startMonth = fixedForm.startMonth || selectedMonth;
      endMonth = startMonth;
    } else if (periodType === "limited") {
      if (!fixedForm.startMonth || !fixedForm.endMonth) {
        setNotice("期間限定の場合は開始月・終了月が必須です");
        return;
      }
      startMonth = fixedForm.startMonth;
      endMonth = fixedForm.endMonth;
      if (endMonth < startMonth) {
        setNotice("終了月は開始月以降にしてください");
        return;
      }
    }

    const key = buildMonthKey(selectedStoreId, startMonth);
    const itemId = fixedForm.id || crypto.randomUUID();
    // 継続費用だけ基本値(baseAmount)を持つ。単月・期間限定には概念が無いため0のまま
    // (金額は既存仕様通りcostMonthlyAmounts側の月別入力のみで管理する)。
    const baseAmount = periodType === "ongoing" ? parseNumber(fixedForm.amount) : 0;
    // 表示順序(要件7・8・9): 編集時は既存のsort_orderをそのまま引き継ぐ(名前やカテゴリを
    // 変更しただけで並びが変わらないようにする)。新規登録時だけ、今の最大値+1を割り当てて
    // 一覧の末尾に追加する(並び替えは別のドラッグ操作でのみ行う)。
    const sortOrder = isEditing
      ? (fixedForm.sortOrder ?? 0)
      : fixedCosts.reduce((max, item) => Math.max(max, item.sortOrder ?? 0), 0) + 1;
    const nextItem = { id: itemId, name: fixedForm.name, category: fixedForm.category || "", categoryKey: fixedForm.categoryKey, memo: fixedForm.memo || "", periodType, startMonth, endMonth, baseAmount, sortOrder };

    const { company, store } = resolveTargetCompanyAndStore();
    // 停止中の店舗は新規の費用登録不可(要件1)。既存項目の編集(isEditing)はRLS側でも
    // ブロックしていない(INSERTのみ制限)ため、ここも新規登録のみをガードする。
    if (!isEditing && store?.status === "suspended") {
      setNotice("この店舗は現在停止中のため、新しい費用を登録できません");
      return;
    }
    if (isSupabaseConfigured) {
      if (!company?.id || !store?.id) {
        setNotice("店舗情報を確認できませんでした");
        return;
      }
      const result = await upsertFixedCostToSupabase({
        id: itemId,
        companyId: company.id,
        storeId: store.id,
        entryMonth: startMonth,
        userId: appState.currentUserId,
        item: nextItem,
      });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return;
      }
    }

    setAppState((prev) => {
      // Editing an existing item can change its startMonth, which is also the local map key it
      // lives under — search every one of this store's keys and drop the old copy so it doesn't
      // end up duplicated under both the old and new month.
      const nextFixedCosts = { ...prev.fixedCosts };
      if (fixedForm.id) {
        Object.keys(nextFixedCosts).forEach((existingKey) => {
          if (existingKey.startsWith(`${prev.selectedStoreId}__`)) {
            nextFixedCosts[existingKey] = (nextFixedCosts[existingKey] || []).filter((item) => item.id !== itemId);
          }
        });
      }
      nextFixedCosts[key] = [...(nextFixedCosts[key] || []), nextItem];
      return { ...prev, fixedCosts: nextFixedCosts };
    });

    // 単月・期間限定費用のみ、新規登録時に入力された金額をこの項目の対象月(selectedMonth)の
    // 初回金額として保存する(既存仕様のまま)。継続費用は基本値(baseAmountとして上で既に
    // fixed_costsへ保存済み)が全ての月へ自動反映されるため、cost_monthly_amountsへの初回書き
    // 込みは不要——要件2-4通り、対象月だけの上書きはあくまで月次一覧からの個別保存でのみ行う。
    if (!isEditing && periodType === "limited" && fixedForm.amount) {
      await persistCostMonthlyAmount({ costItemId: itemId, targetMonth: selectedMonth, amount: fixedForm.amount });
    }

    setFixedForm({ ...defaultFixedCostItem, startMonth: selectedMonth });
  };

  const editFixedCost = (item) => {
    // 継続費用は基本値(baseAmount)を編集フォームに出す(要件1-4)ため、既存値をそのまま
    // プレフィルする。単月・期間限定は既存仕様通り金額欄自体を出さない(月次一覧側でのみ
    // 金額を編集する)ため空のままにする。
    setFixedForm({ ...defaultFixedCostItem, ...item, amount: item.periodType === "limited" ? "" : String(item.baseAmount ?? "") });
  };

  const cancelEditFixedCost = () => {
    setFixedForm({ ...defaultFixedCostItem, startMonth: selectedMonth });
  };

  const removeFixedCost = async (itemId) => {
    if (guardFranchiseReadOnly()) return;
    if (!window.confirm("この費用を削除しますか？")) {
      return;
    }
    if (isSupabaseConfigured) {
      const result = await deleteFixedCostFromSupabase({ id: itemId });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return;
      }
    }
    // Same reasoning as submitFixedCost above: the item being removed may live under a
    // different month-key than whichever month is currently on screen (it could be a
    // continuing cost carried forward from an earlier startMonth).
    // 状態上書き防止(ここまでにdeleteFixedCostFromSupabaseをawaitしているため、
    // appStateRef.currentから最新状態を読み直す)。
    const latestAppState = appStateRef.current;
    const nextFixedCosts = { ...latestAppState.fixedCosts };
    Object.keys(nextFixedCosts).forEach((existingKey) => {
      if (existingKey.startsWith(`${latestAppState.selectedStoreId}__`)) {
        nextFixedCosts[existingKey] = (nextFixedCosts[existingKey] || []).filter((item) => item.id !== itemId);
      }
    });
    // Its cost_monthly_amounts rows cascade-delete in Supabase (FK on delete cascade); drop the
    // matching local entries too so a deleted item's old amounts don't linger in memory.
    const nextCostMonthlyAmounts = { ...latestAppState.costMonthlyAmounts };
    Object.keys(nextCostMonthlyAmounts).forEach((existingKey) => {
      if (existingKey.startsWith(`${itemId}__`)) delete nextCostMonthlyAmounts[existingKey];
    });
    const nextState = { ...latestAppState, fixedCosts: nextFixedCosts, costMonthlyAmounts: nextCostMonthlyAmounts };
    // 不具合修正: setAppStateだけだとlocalStorageへ同期反映されず、この後Supabaseへの再取得
    // (hydrateFromSupabase)が一度も走らないまま再読み込みされた場合、readAppState()が削除前の
    // 古いlocalStorageスナップショットを復元してしまう。そのスナップショットが次回の
    // hydrateでmergeItemArrayMap(idベースのunionマージ)の「local」側として使われると、
    // 削除済みの項目がまた復活してしまっていた(要件: 再読み込み後も削除状態を維持)。
    // handleStoreSwitch/handleMonthSwitchと同じくwriteAppStateで同期的に書き込む。
    writeAppState(nextState);
    setAppState(nextState);
  };

  // 対象月ごとの費用金額(cost_monthly_amounts)を1件upsertする。新規登録時の初回金額保存と、
  // 月次一覧のインライン保存(saveCostAmountFor)の両方から共通で呼ぶ。
  const persistCostMonthlyAmount = async ({ costItemId, targetMonth, amount }) => {
    if (guardFranchiseReadOnly()) return false;
    const { company, store } = resolveTargetCompanyAndStore();
    if (isSupabaseConfigured) {
      if (!company?.id || !store?.id) {
        setNotice("店舗情報を確認できませんでした");
        return false;
      }
      const result = await upsertCostMonthlyAmountToSupabase({
        costItemId,
        companyId: company.id,
        storeId: store.id,
        targetMonth,
        amount: parseNumber(amount),
        userId: appState.currentUserId,
      });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return false;
      }
    }
    setAppState((prev) => ({
      ...prev,
      costMonthlyAmounts: {
        ...prev.costMonthlyAmounts,
        [`${costItemId}__${targetMonth}`]: { id: prev.costMonthlyAmounts?.[`${costItemId}__${targetMonth}`]?.id || "", amount: parseNumber(amount), updatedAt: new Date().toISOString() },
      },
    }));
    return true;
  };

  // 月次一覧の金額欄はappStateのcostMonthlyAmountsをそのまま表示するのではなく、保存前の
  // 未確定な入力をローカルのdraftとして持つ(選択中の月を切り替えたらリセットする、下のeffect
  // 参照)。前月コピーはこのdraftに値を入れるだけで、保存ボタンを押すまで確定しない
  // (「勝手に前月金額を確定させない」という要件のため)。
  const [costAmountDrafts, setCostAmountDrafts] = useState({});
  useEffect(() => {
    setCostAmountDrafts({});
  }, [selectedMonth, selectedStoreId]);

  const getCostAmountDraft = (item) => {
    if (Object.prototype.hasOwnProperty.call(costAmountDrafts, item.id)) return costAmountDrafts[item.id];
    const saved = getCostMonthlyAmount(appState, item.id, selectedMonth);
    return saved === undefined ? "" : String(saved);
  };

  const setCostAmountDraft = (itemId, value) => {
    setCostAmountDrafts((prev) => ({ ...prev, [itemId]: value }));
  };
  // dailyFieldChangeHandlers等と同じ理由: 固定費・変動費の一覧は費用項目(item.id)の数だけ
  // NumericInputが並ぶため、1行だけ入力してもmemo化されたNumericInputが安定した参照の
  // onChangeを受け取れなければ、他の全行が毎回再レンダリングされてしまう。item.idは
  // フィールド名のように事前に固定できない(項目の追加・削除で増減する)ため、ref経由の
  // Mapへ初回アクセス時だけ生成してキャッシュする方式にする(setCostAmountDraft本体の
  // ロジックは無変更)。
  const setCostAmountDraftRef = useRef(setCostAmountDraft);
  setCostAmountDraftRef.current = setCostAmountDraft;
  const costAmountDraftHandlersRef = useRef(new Map());
  const getCostAmountDraftHandler = (itemId) => {
    if (!costAmountDraftHandlersRef.current.has(itemId)) {
      costAmountDraftHandlersRef.current.set(itemId, (value) => setCostAmountDraftRef.current(itemId, value));
    }
    return costAmountDraftHandlersRef.current.get(itemId);
  };

  const copyPreviousMonthAmountFor = (item) => {
    const previous = getPreviousMonthCostAmount(appState, item.id, selectedMonth);
    if (previous === undefined) return;
    setCostAmountDraft(item.id, String(previous));
  };

  const saveCostAmountFor = async (item) => {
    const draft = getCostAmountDraft(item);
    if (draft === "") {
      setNotice("金額を入力してください");
      return;
    }
    const ok = await persistCostMonthlyAmount({ costItemId: item.id, targetMonth: selectedMonth, amount: draft });
    if (ok) {
      setCostAmountDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  // 固定費一覧の並び替え(要件7・8・9)。金額編集・項目編集とは完全に別経路 — sort_orderだけを
  // 更新し、他のフィールド(金額・名前・カテゴリ等)には一切触れない。PC(ドラッグハンドルを
  // 押したまま上下移動)・iPhone(ハンドルを長押しして上下移動)の両方をPointer Events(マウス・
  // タッチを同じAPIで扱える)で統一的に処理する — HTML5ネイティブのdraggable属性はiOS Safari
  // のタッチでは実用的に動かないため使わない。
  const [fixedCostDragId, setFixedCostDragId] = useState(null);
  const [fixedCostDragOverId, setFixedCostDragOverId] = useState(null);
  const fixedCostDragActiveRef = useRef(false);

  const reorderFixedCostItem = async (draggedId, overId) => {
    if (guardFranchiseReadOnly()) return;
    const currentOrder = fixedCosts.map((item) => item.id);
    const fromIndex = currentOrder.indexOf(draggedId);
    const toIndex = currentOrder.indexOf(overId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
    const nextOrder = [...currentOrder];
    nextOrder.splice(fromIndex, 1);
    nextOrder.splice(toIndex, 0, draggedId);
    const updates = nextOrder.map((id, index) => ({ id, sortOrder: index }));

    const previousFixedCosts = appState.fixedCosts;
    setAppState((prev) => {
      const nextFixedCosts = { ...prev.fixedCosts };
      Object.keys(nextFixedCosts).forEach((existingKey) => {
        if (!existingKey.startsWith(`${prev.selectedStoreId}__`)) return;
        nextFixedCosts[existingKey] = (nextFixedCosts[existingKey] || []).map((item) => {
          const match = updates.find((update) => update.id === item.id);
          return match ? { ...item, sortOrder: match.sortOrder } : item;
        });
      });
      return { ...prev, fixedCosts: nextFixedCosts };
    });

    if (isSupabaseConfigured) {
      const result = await reorderFixedCostsInSupabase({ updates });
      if (!result.ok) {
        // 保存に失敗した場合は表示だけが変わった状態を残さない(要件2と同じ「画面上だけの
        // 変更にしない」方針)。次回の再取得を待たず、その場でDB確定前の並びへ戻す。
        setAppState((prev) => ({ ...prev, fixedCosts: previousFixedCosts }));
        setNotice(getSupabaseErrorMessage(result.error));
      }
    }
  };

  const handleFixedCostDragPointerDown = (event, itemId) => {
    event.preventDefault();
    fixedCostDragActiveRef.current = true;
    setFixedCostDragId(itemId);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleFixedCostDragPointerMove = (event) => {
    if (!fixedCostDragActiveRef.current) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const rowEl = target?.closest?.("[data-cost-item-id]");
    const overId = rowEl?.getAttribute("data-cost-item-id") || null;
    setFixedCostDragOverId((prev) => (prev === overId ? prev : overId));
  };

  const handleFixedCostDragPointerUp = async () => {
    if (!fixedCostDragActiveRef.current) return;
    fixedCostDragActiveRef.current = false;
    const draggedId = fixedCostDragId;
    const overId = fixedCostDragOverId;
    setFixedCostDragId(null);
    setFixedCostDragOverId(null);
    if (draggedId && overId && draggedId !== overId) {
      await reorderFixedCostItem(draggedId, overId);
    }
  };

  // 在庫管理ONの店舗の月次在庫入力(月締め画面)。store_inventory_balancesへ対象月ごとに
  // upsertする共通ヘルパー — 「期首在庫」は選択月の前月分として、「当月末在庫」は選択月
  // そのものとして同じテーブルに保存する(getPreviousMonthInventoryBalanceが前者を読む)。
  const persistInventoryBalance = async (targetMonth, amount) => {
    if (guardFranchiseReadOnly()) return false;
    const { company, store } = resolveTargetCompanyAndStore();
    if (!company?.id || !store?.id) {
      setNotice("店舗情報を確認できませんでした");
      return false;
    }
    if (isSupabaseConfigured) {
      const result = await upsertStoreInventoryBalanceToSupabase({ companyId: company.id, storeId: store.id, targetMonth, amount, userId: appState.currentUserId });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return false;
      }
    }
    setAppState((prev) => ({
      ...prev,
      storeInventoryBalances: {
        ...prev.storeInventoryBalances,
        [`${store.id}__${targetMonth}`]: { amount: parseNumber(amount), updatedAt: new Date().toISOString() },
      },
    }));
    return true;
  };

  const [openingInventoryDraft, setOpeningInventoryDraft] = useState("");
  const [closingInventoryDraft, setClosingInventoryDraft] = useState("");
  const previousInventoryBalance = useMemo(
    () => getPreviousMonthInventoryBalance(appState, selectedStoreId, selectedMonth),
    [appState, selectedStoreId, selectedMonth]
  );
  const currentInventoryBalance = useMemo(
    () => getInventoryBalance(appState, selectedStoreId, selectedMonth),
    [appState, selectedStoreId, selectedMonth]
  );
  useEffect(() => {
    setOpeningInventoryDraft("");
    setClosingInventoryDraft(currentInventoryBalance === undefined ? "" : String(currentInventoryBalance));
  }, [selectedStoreId, selectedMonth, currentInventoryBalance]);

  const saveOpeningInventoryBalance = async () => {
    if (openingInventoryDraft === "") {
      setNotice("月初在庫の金額を入力してください");
      return;
    }
    await persistInventoryBalance(getMonthOffset(selectedMonth, -1), openingInventoryDraft);
  };

  const saveClosingInventoryBalance = async () => {
    if (closingInventoryDraft === "") {
      setNotice("当月末在庫の金額を入力してください");
      return;
    }
    await persistInventoryBalance(selectedMonth, closingInventoryDraft);
  };

  // saveHolidayCount/saveManualBusinessDayCount/resetBusinessDaySetting used to only call
  // setAppState — they showed "保存しました" but never wrote to Supabase, so the value only
  // survived via the legacy tenant_snapshots autosave (if its race happened to win) or
  // localStorage. A fresh device/browser, a true logout+relogin, or a lost autosave race would
  // silently revert the store's 営業進捗 day-count to the auto-calculated default even though
  // the user was told it was saved. Fixed to persist through the same
  // upsertMonthlyTargetToSupabase call (monthly_targets.holiday_count/business_day_count/
  // business_day_mode) the 月間目標設定 panel already uses for these exact columns, merged with
  // this store+month's current target values so we never blow away unrelated target numbers.
  const persistBusinessDaySetting = async (nextSetting) => {
    const { company, store } = resolveTargetCompanyAndStore();
    if (!isSupabaseConfigured || !company?.id || !store?.id) return { ok: true, skipped: true };
    const baseTarget = getTargetForStoreMonth(appState, selectedStoreId, selectedMonth);
    const result = await upsertMonthlyTargetToSupabase({
      companyId: company.id,
      storeId: store.id,
      targetMonth: selectedMonth,
      userId: appState.currentUserId,
      target: {
        ...baseTarget,
        businessDayMode: nextSetting.mode,
        businessDayCount: nextSetting.businessDayCount || 0,
        holidayCount: nextSetting.holidayCount || 0,
      },
    });
    return result;
  };

  const saveHolidayCount = async (event) => {
    event?.preventDefault();
    const parsed = parseNumber(businessDayInput);
    if (!selectedStore) {
      setNotice("店舗を選択してください");
      return;
    }
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 31) {
      setNotice("店休日数は0〜31の整数で入力してください");
      return;
    }
    if (monthClosingStatus.closed && !window.confirm("月締め済みの月の営業日数設定を変更しますか？")) {
      return;
    }
    const key = buildMonthKey(selectedStoreId, selectedMonth);
    const nextSetting = {
      ...appState.businessDaySettings?.[key],
      holidayCount: parsed,
      mode: appState.businessDaySettings?.[key]?.mode === "manual" ? "manual" : "auto",
    };
    persistSaveStatus("saving", "店休日数を保存中…");
    const result = await persistBusinessDaySetting(nextSetting);
    if (!result?.ok) {
      const message = `店休日数の保存に失敗しました: ${getSupabaseErrorMessage(result?.error)}`;
      persistSaveStatus("error", message, true);
      setNotice(message);
      return;
    }
    setAppState((prev) => ({
      ...prev,
      businessDaySettings: { ...prev.businessDaySettings, [key]: nextSetting },
    }));
    persistSaveStatus("saved", "店休日数を保存しました");
  };

  const startManualBusinessDayEdit = () => {
    if (!selectedStore) {
      setNotice("店舗を選択してください");
      return;
    }
    setManualBusinessDayInput(String(businessDaySummary.businessDayCount || ""));
    setIsBusinessDayEditing((prev) => !prev);
  };

  const saveManualBusinessDayCount = async () => {
    if (!selectedStore) {
      setNotice("店舗を選択してください");
      return;
    }
    const parsed = parseNumber(manualBusinessDayInput);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
      setNotice("営業日数は1〜31の整数で入力してください");
      return;
    }
    if (monthClosingStatus.closed && !window.confirm("月締め済みの月の営業日数を変更しますか？")) {
      return;
    }
    const key = buildMonthKey(selectedStoreId, selectedMonth);
    const nextSetting = {
      ...appState.businessDaySettings?.[key],
      mode: "manual",
      businessDayCount: parsed,
    };
    persistSaveStatus("saving", "営業日数を保存中…");
    const result = await persistBusinessDaySetting(nextSetting);
    if (!result?.ok) {
      const message = `営業日数の保存に失敗しました: ${getSupabaseErrorMessage(result?.error)}`;
      persistSaveStatus("error", message, true);
      setNotice(message);
      return;
    }
    setAppState((prev) => ({
      ...prev,
      businessDaySettings: { ...prev.businessDaySettings, [key]: nextSetting },
    }));
    setIsBusinessDayEditing(false);
    persistSaveStatus("saved", "営業日数を手動設定しました");
  };

  const resetBusinessDaySetting = async () => {
    if (!selectedStore) {
      setNotice("店舗を選択してください");
      return;
    }
    if (monthClosingStatus.closed && !window.confirm("月締め済みの月の営業日数を自動計算に戻しますか？")) {
      return;
    }
    const key = buildMonthKey(selectedStoreId, selectedMonth);
    const nextSetting = {
      ...appState.businessDaySettings?.[key],
      mode: "auto",
      businessDayCount: 0,
    };
    persistSaveStatus("saving", "営業日数を保存中…");
    const result = await persistBusinessDaySetting(nextSetting);
    if (!result?.ok) {
      const message = `営業日数のリセットに失敗しました: ${getSupabaseErrorMessage(result?.error)}`;
      persistSaveStatus("error", message, true);
      setNotice(message);
      return;
    }
    setAppState((prev) => ({
      ...prev,
      businessDaySettings: { ...prev.businessDaySettings, [key]: { ...nextSetting, businessDayCount: undefined } },
    }));
    setIsBusinessDayEditing(false);
    persistSaveStatus("saved", "営業日数を自動計算に戻しました");
  };

  // カレンダーで店休日をトグルする(要件17)。数値ベースの店休日数(saveHolidayCount)とは
  // 別の、日付ベースの新しい管理方式 — store_business_holidaysへ永続保存し、営業日数は
  // getBusinessDaySummaryが自動的に日付数から再計算する。
  const toggleStoreHolidayDate = async (dateIso) => {
    if (!selectedStore) {
      setNotice("店舗を選択してください");
      return;
    }
    const targetMonth = dateIso.slice(0, 7);
    const currentHolidays = getStoreHolidayDates(appState, selectedStoreId, targetMonth);
    const isCurrentlyHoliday = currentHolidays.includes(dateIso);
    if (!isCurrentlyHoliday) {
      const hasExistingEntry = getDailyResultsForStoreMonth(appState, selectedStoreId, targetMonth).some((entry) => entry.date === dateIso);
      if (hasExistingEntry && !window.confirm(`${dateIso}には既存の日次データがあります。店休日に設定しますか？（データは削除されません）`)) {
        return;
      }
    }
    const { company, store } = resolveTargetCompanyAndStore();
    if (isSupabaseConfigured) {
      if (!store?.id || !company?.id) {
        setNotice("店舗情報を確認できませんでした");
        return;
      }
      const result = isCurrentlyHoliday
        ? await deleteStoreHolidayFromSupabase({ storeId: store.id, holidayDate: dateIso })
        : await upsertStoreHolidayToSupabase({ companyId: company.id, storeId: store.id, holidayDate: dateIso, userId: appState.currentUserId });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return;
      }
    }
    const key = buildMonthKey(selectedStoreId, targetMonth);
    setAppState((prev) => {
      const list = prev.storeHolidays?.[key] || [];
      const nextList = isCurrentlyHoliday ? list.filter((date) => date !== dateIso) : [...list, dateIso];
      return { ...prev, storeHolidays: { ...prev.storeHolidays, [key]: nextList } };
    });
  };

  // 「全店舗」専用の店休日カレンダー(要件7・9)。各実店舗の店休日設定とは完全に別管理で、
  // company_all_stores_holidaysへ保存する。トグルしても各店舗の店休日設定は一切変更しない。
  const toggleAllStoresHolidayDate = async (dateIso) => {
    const companyId = appState.currentCompanyId;
    const targetMonth = dateIso.slice(0, 7);
    const currentHolidays = getAllStoresHolidayDates(appState, companyId, targetMonth);
    const isCurrentlyHoliday = currentHolidays.includes(dateIso);
    if (isSupabaseConfigured) {
      if (!companyId) {
        setNotice("会社情報を確認できませんでした");
        return;
      }
      const result = isCurrentlyHoliday
        ? await deleteAllStoresHolidayFromSupabase({ companyId, holidayDate: dateIso })
        : await upsertAllStoresHolidayToSupabase({ companyId, holidayDate: dateIso, userId: appState.currentUserId });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return;
      }
    }
    const key = buildCompanyMonthKey(companyId, targetMonth);
    setAppState((prev) => {
      const list = prev.allStoresHolidays?.[key] || [];
      const nextList = isCurrentlyHoliday ? list.filter((date) => date !== dateIso) : [...list, dateIso];
      return { ...prev, allStoresHolidays: { ...prev.allStoresHolidays, [key]: nextList } };
    });
  };

  const toggleMonthClosing = async () => {
    if (guardFranchiseReadOnly()) return;
    if (!selectedStore) {
      setNotice("店舗を選択してください");
      return;
    }

    const key = buildMonthKey(selectedStoreId, selectedMonth);
    const nextClosed = !Boolean(monthClosingStatus.closed);

    // 未入力項目があっても確定は可能だが、確定前に必ず警告する(要件18)。締めを解除する
    // 操作にはこの確認は不要(確認済み・締め直したい場合のみ)。
    if (nextClosed && monthClosingChecklist.missingItems.length > 0) {
      const missingLabels = monthClosingChecklist.missingItems.map((item) => item.label).join("、");
      if (!window.confirm(`${missingLabels}が未入力です。この状態で${selectedMonth}を確定しますか？`)) {
        return;
      }
    }
    const { store } = resolveTargetCompanyAndStore();
    if (isSupabaseConfigured && !store?.id) {
      const message = "店舗情報を確認できませんでした";
      logSupabaseError({ operation: "toggleMonthClosing", table: "monthly_closings", userId: appState.currentUserId, companyId: appState.currentCompanyId, targetMonth: selectedMonth, error: new Error(message) });
      persistSaveStatus("error", message, true);
      setNotice(message);
      return;
    }

    persistSaveStatus("saving", "保存中…", false);
    const remoteResult = await upsertMonthlyClosingState({
      companyId: appState.currentCompanyId,
      storeId: store?.id,
      yearMonth: selectedMonth,
      userId: appState.currentUserId,
      isClosed: nextClosed,
    });

    if (!remoteResult?.ok && !remoteResult?.skipped) {
      logSupabaseError({ operation: "toggleMonthClosing", table: "monthly_closings", userId: appState.currentUserId, companyId: appState.currentCompanyId, storeId: store?.id, targetMonth: selectedMonth, error: remoteResult?.error });
      const reason = getSupabaseErrorMessage(remoteResult?.error);
      persistSaveStatus("error", `月締めの保存に失敗しました: ${reason}`, true);
      setNotice(`月締めの保存に失敗しました: ${reason}`);
      return;
    }

    const lockedAt = remoteResult?.data?.closed_at || (nextClosed ? new Date().toISOString() : "");
    setAppState((prev) => ({
      ...prev,
      monthClosingStatus: {
        ...prev.monthClosingStatus,
        [key]: {
          closed: nextClosed,
          lockedAt,
          note: nextClosed ? "月締め済み" : "未確定",
        },
      },
    }));
    persistSaveStatus("saved", nextClosed ? "月締めを確定しました" : "月締めを解除しました");
  };

  const toggleDayClosing = async () => {
    if (guardFranchiseReadOnly()) return;
    if (isDailyDateBatchLocked) {
      setNotice("この日はまとめて入力で反映されています。日締めは通常の日次入力のみが対象です。");
      return;
    }
    if (isStaffPastOrFutureDateLocked) {
      setNotice("スタッフは今日の日次入力のみ操作できます。過去日・未来日の日締めはできません。");
      return;
    }
    if (!selectedStore || !dailyForm.date) {
      setNotice("締め対象の日付を入力してください");
      return;
    }
    if (isHolidayDate(getStoreHolidayDates(appState, selectedStoreId, dailyForm.date.slice(0, 7)), dailyForm.date)) {
      setNotice("この日は店休日のため日締めできません");
      return;
    }
    // todayEntryと同じ理由でformatLocalDate(JST基準)を使う——toISOString()のUTC基準だと
    // 日本時間の午前0:00〜8:59の間、今日の日付が「未来日」と誤判定され日締めできなくなる。
    const todayIso = formatLocalDate(new Date());
    if (dailyForm.date > todayIso) {
      setNotice("未来日は締めできません");
      return;
    }
    // Computed up front (before the confirm dialog) purely so the dialog can say plainly which
    // direction this click goes — this button's label already reflects isSelectedDailyEntryClosed
    // (see its own JSX), but a manager editing an already-closed day and clicking it again,
    // expecting to "re-confirm" the close, was the exact scenario that silently un-closed the day
    // instead: the vague old confirm text ("切り替えますか？") didn't say which way it would go.
    const nextClosed = !isSelectedDailyEntryClosed;
    if (!window.confirm(nextClosed ? `${dailyForm.date}を日締めしますか？` : `${dailyForm.date}の日締めを解除しますか？`)) {
      return;
    }
    // Best-effort: keeps the normal save path (validation, local dailyForm/insight updates)
    // working the same as always for the common case. Its result is deliberately NOT treated
    // as a precondition below anymore — see updateDailySalesClosingState, which now upserts
    // the row itself using dailyForm, so day-closing can no longer be silently blocked by
    // saveDailyEntry's dailyMode==="view" no-op (the normal state right after opening an
    // already-saved entry, which is exactly when a user goes to close it).
    await saveDailyEntry({ silent: true, force: true });

    // cross-month date bugの修正: 日締め対象は「表示中の対象月」ではなく「実際に締めている
    // dailyForm.dateそのものの月」に書き込む(selectedMonthとdailyForm.dateの月は通常
    // 一致するが、根本対応として日付側から導出することでズレの起きようが無い構造にする)。
    const key = buildMonthKey(selectedStoreId, dailyForm.date.slice(0, 7));

    const { store } = resolveTargetCompanyAndStore();
    if (isSupabaseConfigured && !store?.id) {
      const message = "店舗情報を確認できませんでした";
      logSupabaseError({ operation: "toggleDayClosing", table: "daily_sales", userId: appState.currentUserId, companyId: appState.currentCompanyId, businessDate: dailyForm.date, error: new Error(message) });
      persistSaveStatus("error", message, true);
      setNotice(message);
      return;
    }

    persistSaveStatus("saving", "保存中…", false);
    // 同時利用時のデータ上書き事故防止: dailyForm.idが既にある(=このレンジは既に保存済みの
    // 行を開いてview中)場合、entryにdailyFormを渡すとupdateDailySalesClosingStateが
    // sales_amount等をこのdailyForm(その日を開いた時点のスナップショットで、以後同期し
    // 直さない)の値で丸ごと上書きしてしまい、開いてから閉じるまでの間に別端末が保存した
    // 最新の売上を静かに古い値へ戻してしまう(dailyMode==="view"の間、saveDailyEntryは
    // 手前で何もしないため、ここが実質的な唯一の書き込み経路になっていた)。dailyForm.idが
    // 既にある場合はentry:nullを渡し、is_day_closed等の締め関連カラムだけを更新する
    // UPDATE専用分岐を使う(売上カラムには一切触れない)。dailyForm.idが無い(=まだ一度も
    // 保存されていない新規行)場合だけ、従来通りentry付きでupsertし、締めと同時に行を作る。
    const remoteResult = await updateDailySalesClosingState({
      companyId: appState.currentCompanyId,
      storeId: store?.id,
      businessDate: dailyForm.date,
      userId: appState.currentUserId,
      entry: dailyForm.id ? null : dailyForm,
      isClosed: nextClosed,
    });

    if (!remoteResult?.ok && !remoteResult?.skipped) {
      logSupabaseError({ operation: "toggleDayClosing", table: "daily_sales", userId: appState.currentUserId, companyId: appState.currentCompanyId, storeId: store?.id, businessDate: dailyForm.date, error: remoteResult?.error });
      const reason = getSupabaseErrorMessage(remoteResult?.error);
      persistSaveStatus("error", `日締めの保存に失敗しました: ${reason}`, true);
      setNotice(`日締めの保存に失敗しました: ${reason}`);
      return;
    }

    // Apply locally only after Supabase confirms the write (or Supabase isn't configured at
    // all, i.e. local-only/dev mode). daily_sales is authoritative for this now, so we trust
    // its returned row rather than re-deriving anything.
    // Mirrors the closed_at-then-updated_at fallback that buildDailyStateFromRows uses when
    // rebuilding dayClosingUpdatedAt from a fresh fetch, so the optimistic local timestamp set
    // here can never drift from what a subsequent hydrate/re-fetch will derive for the same row.
    const toggledAt = remoteResult?.data?.closed_at || remoteResult?.data?.updated_at || new Date().toISOString();
    setAppState((prev) => {
      const currentMap = prev.dayClosingStates?.[key] || {};
      const currentTimestamps = prev.dayClosingUpdatedAt?.[key] || {};
      const currentList = prev.dailyResults?.[key] || [];
      // updateDailySalesClosingState now upserts (see its own comment) so remoteResult.data is
      // always the row's full current contents, not just the closing flags — mirror it into
      // dailyResults too, the same way saveDailyEntry does, so a close that had to create the
      // row (saveDailyEntry having no-op'd in view mode) doesn't leave dailyResults out of
      // sync with what Supabase actually has.
      const updatedEntries = remoteResult?.data
        ? deduplicateDailyEntries([...currentList.filter((item) => String(item.date) !== String(dailyForm.date)), dailySalesRowToEntry(remoteResult.data)]).entries
        : currentList;
      return {
        ...prev,
        dailyResults: { ...prev.dailyResults, [key]: updatedEntries },
        dayClosingStates: { ...prev.dayClosingStates, [key]: { ...currentMap, [dailyForm.date]: nextClosed } },
        dayClosingUpdatedAt: { ...prev.dayClosingUpdatedAt, [key]: { ...currentTimestamps, [dailyForm.date]: toggledAt } },
      };
    });

    persistSaveStatus("saved", "保存済み ✓");
  };

  // 月締め専用(固定費/販管費だった「費用入力」は開始月/終了月で自動反映されるため、前月
  // コピーという概念自体が不要になった — item 8)。月締めの人件費・材料費等は毎月確定した
  // 実績を入力する性質上、前月の内訳をコピーして書き換える運用が引き続き便利なため残す。

  if (authLoading) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-title-block">
            <p className="eyebrow">AUTH</p>
            <h2>権限を確認しています</h2>
            <p>ログイン情報とプロフィールを読み込んでいます。しばらくお待ちください。</p>
          </div>
        </div>
      </div>
    );
  }

  // 一部ユーザーでブラウザ更新のたびにログイン画面へ戻される不具合の修正: この判定は
  // 「セッションは確認できたが、プロフィール/テナント情報の取得だけがリトライ後も失敗した」
  // 状態専用で、!currentUser && !authLoadingの判定(下)より必ず先に置く——currentUserは
  // まだnullのままなので、ここで先に拾わないとログイン画面が誤って表示されてしまう。
  // ログイン画面には絶対に落とさず、再試行(ページ再読み込みで最初からやり直す)・
  // またはこのセッション自体を明示的に破棄してログイン画面へ戻る、の2つの選択肢を出す。
  if (authProfileLoadError) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-title-block">
            <p className="eyebrow">AUTH</p>
            <h2>プロフィールを読み込めませんでした</h2>
            <p>ログイン状態は保持されています。通信環境をご確認のうえ、再試行してください。</p>
            <p className="auth-error-detail">{authProfileLoadError}</p>
          </div>
          <div className="button-row">
            <button type="button" className="primary-button" onClick={() => window.location.reload()}>再試行</button>
            <button type="button" className="secondary-button" onClick={handleLogout}>ログアウトしてやり直す</button>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser && !authLoading) {
    return <LoginScreen mode={authMode} onModeChange={handleModeChange} onSubmit={handleLogin} onSignUp={handleSignUp} onOwnerSignUp={handleOwnerSignUp} onResetPassword={handleResetPassword} onSetNewPassword={handleSetNewPassword} loading={authLoading} error={authError} success={authSuccess} inviteEmail={inviteToken ? inviteEmail : ""} hasInviteToken={Boolean(inviteToken)} ownerSignupVisible={selfSignupEnabled} />;
  }

  // 停止中、または削除(論理削除)済みの会社は、データを保持したまま通常ユーザー
  // (system_admin以外)の利用だけを止める(要件4・6)。system_adminはどちらの状態でも
  // 会社管理画面から会社情報・データを引き続き確認できる必要があるため、この画面は
  // system_admin以外にのみ表示する。
  if ((currentCompany?.contractStatus === "suspended" || currentCompany?.deletedAt) && normalizeRole(currentRole) !== "system_admin") {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-title-block">
            <p className="eyebrow">SUSPENDED</p>
            <h2>ご利用を停止しています</h2>
            <p>現在この会社の利用は停止されています。管理者へお問い合わせください。</p>
          </div>
        </div>
      </div>
    );
  }

  if (needsFirstStoreSetup) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-title-block">
            <p className="eyebrow">SETUP</p>
            <h2>最初の店舗を登録してください</h2>
            <p>{currentCompany?.name || "この会社"}にはまだ店舗が登録されていません。店舗名を入力して、最初の店舗を作成してください。以後、この画面は表示されません。</p>
          </div>
          <label className="field">
            <span>店舗名</span>
            <input value={storeForm.name} onChange={(event) => setStoreForm((prev) => ({ ...prev, name: event.target.value }))} placeholder={storeNamePlaceholder} />
          </label>
          {storeFormStatus.message ? <div className="notice-box">{storeFormStatus.message}</div> : null}
          <div className="button-row">
            <button className="primary-button" type="button" onClick={handleSaveStore} disabled={storeFormStatus.status === "saving"}>
              {storeFormStatus.status === "saving" ? "作成中…" : "最初の店舗を作成する"}
            </button>
            <button className="secondary-button" type="button" onClick={handleLogout}>ログアウト</button>
          </div>
        </div>
      </div>
    );
  }

  if (!canAccessCurrentPage) {
    return <AccessDenied />;
  }

  if (showInitialSetup) {
    return (
      <div className="app-shell">
        <main className="main-content">
          <section className="panel setup-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">SETUP</p>
                <h2>初期設定</h2>
              </div>
            </div>
            <div className="setup-steps">
              {setupProgress.steps.map((step) => (
                <div key={step.id} className={`setup-step ${step.done ? "done" : ""}`}>
                  <span>{step.label}</span>
                </div>
              ))}
            </div>
            <div className="setup-body">
              <div className="setup-card">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">STEP 1</p>
                    <h3>会社情報</h3>
                  </div>
                </div>
                <div className="inline-form">
                  <input value={companyForm.name} onChange={(event) => setCompanyForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="会社名" />
                  <select value={companyForm.businessType || "salon"} onChange={(event) => setCompanyForm((prev) => ({ ...prev, businessType: event.target.value }))}>
                    <option value="salon">サロン</option>
                    <option value="nail">ネイルサロン</option>
                    <option value="eyelash">まつげサロン</option>
                    <option value="esthetic">エステサロン</option>
                  </select>
                  <button className="primary-button" type="button" onClick={handleSaveCompany} disabled={companyFormBusy}>{companyFormBusy ? "保存中…" : "会社情報を保存"}</button>
                </div>
                <p className="helper-text">業種: {getBusinessTypeLabel(companyForm.businessType || "salon")}</p>
              </div>
              <div className="setup-card">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">STEP 2</p>
                    <h3>店舗登録</h3>
                  </div>
                </div>
                <div className="inline-form">
                  <input value={storeForm.name} onChange={(event) => setStoreForm((prev) => ({ ...prev, name: event.target.value }))} placeholder={storeNamePlaceholder} />
                  <button className="primary-button" type="button" onClick={handleSaveStore} disabled={storeFormStatus.status === "saving"}>{storeFormStatus.status === "saving" ? "追加中…" : "店舗を追加"}</button>
                </div>
              </div>
              <div className="setup-card">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">STEP 3</p>
                    <h3>管理者登録</h3>
                  </div>
                </div>
                <div className="inline-form">
                  <input value={userForm.name} onChange={(event) => setUserForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="氏名" />
                  <input value={userForm.email} onChange={(event) => setUserForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="メールアドレス" />
                  <select value={userForm.role} onChange={(event) => setUserForm((prev) => ({ ...prev, role: event.target.value }))}>
                    <option value="company_admin">company_admin</option>
                    <option value="store_manager">store_manager</option>
                    <option value="staff">staff</option>
                  </select>
                  <button className="primary-button" type="button" onClick={handleSaveUser} disabled={userFormBusy}>{userFormBusy ? "送信中…" : "管理者を登録"}</button>
                </div>
              </div>
              <div className="setup-card">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">STEP 4</p>
                    <h3>基本設定</h3>
                  </div>
                </div>
                <div className="input-grid">
                  <label className="field">
                    <span>通貨</span>
                    <input value={companySettingsForm.currency || "JPY"} onChange={(event) => setCompanySettingsForm((prev) => ({ ...prev, currency: event.target.value }))} />
                  </label>
                  <label className="field">
                    <span>会計年度開始月</span>
                    <input value={companySettingsForm.fiscalYearStartMonth || "1"} onChange={(event) => setCompanySettingsForm((prev) => ({ ...prev, fiscalYearStartMonth: event.target.value }))} />
                  </label>
                  <label className="field">
                    <span>売上表示</span>
                    <select value={companySettingsForm.salesDisplayMode || "inclusive"} onChange={(event) => setCompanySettingsForm((prev) => ({ ...prev, salesDisplayMode: event.target.value }))}>
                      <option value="inclusive">税込</option>
                      <option value="exclusive">税抜</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>店販売上の名称</span>
                    <input value={companySettingsForm.retailSalesLabel || "店販売上"} onChange={(event) => setCompanySettingsForm((prev) => ({ ...prev, retailSalesLabel: event.target.value }))} />
                  </label>
                </div>
                <div className="button-row">
                  <button className="secondary-button" type="button" onClick={handleSaveCompanySettings}>基本設定を保存</button>
                </div>
              </div>
            </div>
            <div className="button-row">
              <button className="primary-button" type="button" onClick={handleToggleCompanySetup}>初期設定を完了する</button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  // 日次入力UI改善(要件8・15): 保存・日締め・編集・キャンセルのボタン群をこの1箇所だけで
  // 定義し、通常の位置(フォーム内)とスマホ固定アクションバー(下記.daily-fixed-action-bar)
  // の両方でそのまま再利用する——2箇所に同じ分岐ロジックを重複して書かない。保存ボタンは
  // どちらの場所に描画してもform="daily-form"で同じ<form id="daily-form" onSubmit=
  // {submitDailyEntry}>のsubmitイベントを発火させるだけで、別の保存関数・保存経路は一切
  // 作らない(二重POST/二重upsertのリスクを増やさない)。各ボタンのonClick/disabled式・
  // 表示条件自体は既存のまま変更していない。
  const dailyActionButtons = !isDailyFormDateHoliday ? (
    dailyMode === "create" ? (
      <>
        <button className="primary-button" type="submit" form="daily-form">保存</button>
        <button className="secondary-button" type="button" onClick={toggleDayClosing} disabled={!canToggleClosing}>{isSelectedDailyEntryClosed ? "日締めを解除" : "日締め"}</button>
      </>
    ) : dailyMode === "edit" ? (
      <>
        <button className="primary-button" type="submit" form="daily-form">保存</button>
        <button className="secondary-button" type="button" onClick={cancelDailyEntryEdit}>キャンセル</button>
      </>
    ) : canEditSelectedDailyEntry ? (
      <>
        {/* 不具合修正(要件3・4): 「編集」は従来どおりisDailyEntryLocked(締め済みロック含む)で
            disabled——締め済みの間はグレーアウトし、まず下の「日締め解除」を押す必要がある
            (要件5)。「日締め/日締め解除」はcanToggleClosing(ハードロックのみ)でdisabled——
            締め済みロック中でもこのボタン自体は常に押せる、押すことがロックを解除する唯一の
            手段のため。解除後は再レンダーでisDailyEntryLockedが即falseになり、ページ再読み込み
            無しで「編集」がその場で有効になる(dayClosingStatesの更新はtoggleDayClosing内で
            setAppStateにより同期的に反映されるため、追加の再取得は不要)。 */}
        <button className="secondary-button" type="button" onClick={editDailyEntry} disabled={!dailyForm.id || isDailyEntryLocked}>編集</button>
        <button className="secondary-button" type="button" onClick={toggleDayClosing} disabled={!canToggleClosing}>{isSelectedDailyEntryClosed ? "日締めを解除" : "日締め"}</button>
      </>
    ) : null
  ) : null;
  // スマホ固定アクションバー(要件8)を実際に描画するか。毎日入力モードでボタンが1つでも
  // ある時だけ表示する——店休日・まとめて入力モード等では空のバーや無駄な下部余白を残さない
  // (下のCSS側もこのフラグに対応するクラスが付いた時だけ.stackへ予約余白を追加する)。
  const showDailyFixedActionBar = activePage === "daily" && dailyInputMode === "daily" && Boolean(dailyActionButtons);

  return (
    <div className={`app-shell ${theme === "dark" ? "theme-dark" : ""}`}>
      <aside className="sidebar">
        <div>
          <div className="brand">
            <span className="brand-mark">S</span>
            <div>
              <strong>Salon Manager</strong>
              <small>サロン経営管理</small>
            </div>
          </div>
          <nav id="primary-nav" className={`nav${mobileNavOpen ? " open" : ""}`}>
            {visibleNavItems.map((item, index) => {
              // カテゴリ見出し文字は出さず(ページ名「売上」と見出し「売上」が連続して見える
              // 問題を避けるため)、グループの切れ目だけ余白で区切る。
              const previousCategory = index > 0 ? visibleNavItems[index - 1].category : null;
              const isNewGroup = index > 0 && item.category !== previousCategory;
              return (
                <button
                  key={item.id}
                  className={`nav-button${activePage === item.id ? " active" : ""}${isNewGroup ? " nav-group-start" : ""}`}
                  onClick={() => {
                    if (activePage === "monthly" && activeMonthlyTab === "input" && item.id !== "monthly" && !confirmLeaveInputSettings()) return;
                    setSetupChecklistReturnPending(false);
                    setActivePage(item.id);
                    setMobileNavOpen(false);
                  }}
                >
                  {item.label}
                </button>
              );
            })}
            {/* スマホUI改善(要件1): ログアウトは常時大きなボタンとして画面上部に置かず、
                左上のメニュー(ハンバーガー)内へ移動する。PC/タブレットでは既存通り
                .filters側のログアウトボタンだけを表示し、こちらはCSSで隠す
                (.nav-mobile-logoutクラス、≤900pxのみ表示)——JSX構造・ログアウト処理
                (handleLogout)自体は変更しない、表示位置の複製のみ。 */}
            <button
              type="button"
              className="nav-button nav-mobile-logout"
              onClick={() => { setMobileNavOpen(false); handleLogout(); }}
            >
              ログアウト
            </button>
          </nav>
        </div>
        <div className="sidebar-footer" />
      </aside>

      <main className="main-content">
        {/* スマホ版全画面共通ヘッダー(要件7: 共通コンポーネント化)。以前は売上・日次入力の
            2画面だけこの位置にJSXを個別に書いていたが、ヘッダー自体はもともとこの1箇所だけで
            全ページ共通描画されていた(ページごとの複製は無かった)ため、AppHeaderへJSXを
            そのまま切り出し、店舗/対象月の2段表示(topbar-compact-mobile、App.css)を全ページ
            無条件で適用するようにした(要件2: 対象画面を全画面へ拡大)。渡しているprops
            (selectedStore/appState.isViewingFranchise/handleUnifiedStoreSwitch/selectedMonth/
            handleMonthSwitch等)は全て既存のstate・ハンドラをそのまま渡しているだけで、
            新しい状態やロジックは増やしていない——店舗切替・対象月切替・状態保持・ログアウトは
            全て既存の関数がそのまま担う。 */}
        <AppHeader
          activePage={activePage}
          mobileNavOpen={mobileNavOpen}
          onToggleMobileNav={() => setMobileNavOpen((prev) => !prev)}
          currentUser={currentUser}
          currentRole={currentRole}
          isViewingFranchise={appState.isViewingFranchise}
          currentCompanyId={appState.currentCompanyId}
          franchiseSelectedStoreId={appState.selectedStoreId}
          selectedStore={selectedStore}
          onStoreChange={handleUnifiedStoreSwitch}
          franchiseViewBusy={franchiseViewBusy}
          homeStoresForDropdown={homeStoresForDropdown}
          viewableFranchisePartnerStores={viewableFranchisePartnerStores}
          selectedMonth={selectedMonth}
          onMonthChange={handleMonthSwitch}
          onLogout={handleLogout}
        />

        {!appState.isViewingFranchise && normalizedCurrentRoleForFranchise === "company_admin" && incomingPendingFranchiseRequests.length > 0 ? (
          <div className="franchise-request-banner">
            <span>
              {incomingPendingFranchiseRequests[0]?.parent_company?.name || "会社"}から加盟店連携リクエストが届いています
              {incomingPendingFranchiseRequests.length > 1 ? `（他${incomingPendingFranchiseRequests.length - 1}件）` : ""}
            </span>
            <button
              type="button"
              className="primary-button"
              onClick={() => { setActivePage("franchise"); setFranchiseDetailRelationshipId(incomingPendingFranchiseRequests[0].id); }}
            >
              内容を確認
            </button>
          </div>
        ) : null}

        {!isOnline ? <div className="notice-box">オフラインです。入力内容は端末に保存されています。</div> : null}
        {/* PWAアップデート対策(要件6): 新しいバージョンが既に用意できている(Service Worker
            は待機中)ことをユーザー自身の判断で適用してもらうバナー。押すまでは何も起きない
            — 入力途中のデータを失うような強制リロードはしない。 */}
        {swUpdateApply ? (
          <div className="notice-box sw-update-banner">
            {/* 通知文言の調整: 「新しいバージョンが利用可能です。」/「更新する」から、より
                シンプルな表現へ変更。更新処理自体(swUpdateApply呼び出し・リロードのタイミング)
                は無変更、文言のみの変更。 */}
            <span>新しいバージョンがあります</span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                swUpdateApply();
                setSwUpdateApply(null);
              }}
            >
              アップデート
            </button>
          </div>
        ) : null}
        {/* 対象月・店舗の切替直後、hydrateFromSupabaseがまだ進行中の間は「その月のデータ」が
            appStateへ反映しきっていない可能性がある。従来はsyncStatusをどこにも表示していな
            かったため、この間に古い月の数字が一瞬残ったり¥0が見えたりしても利用者には何も
            伝わらなかった(要件7)。データ取得中であることだけを軽く知らせる — 表示自体を
            隠す/ブロックする作りにはしない(既存の各パネルの表示条件・計算ロジックは無変更)。 */}
        {syncStatus.status === "syncing" ? <div className="notice-box">データを更新中です…</div> : null}
        {/* 「更新中です…」が数分間解除されない不具合の緊急修正: 以前はsyncStatus.status
            ==="error"を表示するUIが存在せず、hydrateFromSupabaseが失敗してもユーザーには
            何も伝わらなかった(数秒後に始まる自動リトライで再び「更新中です…」だけが
            現れては消える=実質、進捗が見えないまま止まっているように見えていた)。
            エラー時は必ずこのメッセージを表示する——内容は常にgetSupabaseErrorMessage経由の
            日本語文言(生のSupabase/Postgresエラーは表示しない)。 */}
        {syncStatus.status === "error" && syncStatus.message ? <div className="notice-box error">{syncStatus.message}</div> : null}
        {/* このnoticeは「成功しました」等の完了通知には使わない — 画面上部にはエラーのみ
            表示する(誤操作でデータを失わないための警告や、対応が必要な保存失敗など)。
            成功・完了の確認は、各操作の近く(保存ステータスチップ・ボタンラベル等)に留める。 */}
        {notice ? <div className="notice-box error">{notice}</div> : null}
        {activePage === "dashboard" && (
          <div className="dashboard-layout">
            {showSetupChecklist ? (
              <SetupChecklistCard
                items={setupChecklist}
                onNavigate={goToSetupChecklistItem}
                onDismiss={() => setSetupChecklistDismissed(true)}
              />
            ) : null}
            <section className="panel">
              <div className="business-progress-card">
                <div className="business-progress-header">
                  <div>
                    <p className="eyebrow">PROGRESS</p>
                    <h3>営業進捗</h3>
                  </div>
                  <span className={`status-chip ${businessDaySummary.progressRate === null ? "neutral" : businessDaySummary.progressRate >= 100 ? "good" : businessDaySummary.progressRate >= 50 ? "warning" : "danger"}`}>
                    {businessDaySummary.progressRate === null ? "未設定" : `${Math.round(businessDaySummary.progressRate)}%`}
                  </span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.min(100, businessDaySummary.progressRate || 0)}%` }} />
                </div>
                {/* 追加UI調整: ラベルをより自然で短い表現に変更する(「営業完了」→「営業日」、
                    「残り」→「残り営業日」)。「営業日数完了」のような不自然な言い回しは避け、
                    値のフォーマット(X/Y日など)・計算ロジックは変更していない。 */}
                <div className="business-progress-grid">
                  <div><span>営業日</span><strong>{businessDaySummary.businessDayCount ? `${businessDaySummary.completedDays} / ${businessDaySummary.businessDayCount}日` : `${businessDaySummary.completedDays}日 / 未設定`}</strong></div>
                  <div><span>残り営業日</span><strong>{businessDaySummary.remainingBusinessDays === null ? "未設定" : `${businessDaySummary.remainingBusinessDays}日`}</strong></div>
                  <div><span>総売上</span><strong>{isInitialDataReady ? money(summary.sales) : "—"}</strong></div>
                  <div><span>平均売上</span><strong>{isInitialDataReady ? money(summary.displayAverageDailySales) : "—"}</strong></div>
                  {/* スマホ版UI最終調整: 「現在の顧客数」はPC/スマホ共通で営業進捗カード内に
                      表示する(役割分担: 現在の顧客数→営業進捗、顧客数の目標進捗→客数達成率
                      カード、という配置をPC・スマホで揃える)。前回追加したKPI側の複製カード
                      (metric-card-customer-count-mobile)は削除し、ここが唯一の表示場所に
                      一本化した。 */}
                  <div><span>顧客数</span><strong>{isInitialDataReady ? `${number(summary.customers)}名` : "—"}</strong></div>
                </div>
              </div>
              <div className="kpi-sales-section">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">KPI</p>
                  <h2>売上</h2>
                </div>
              </div>
              {/* 進捗系・予測系・効率系を1つのグリッドにまとめ、非表示カードの分の空枠を
                  残さず、表示対象だけを左上から順に自動で詰めて配置する(kpi-hero-grid/
                  kpi-gridに分かれていたのを統合)。カードの増減があってもこの1グリッドの
                  auto-flowでそのまま整う。売上画面UI/UX改善(要件1・9・23): 月間達成率・
                  月末着地予測・1日平均必要売上の3項目をprimary(少し強調)にし、視線が
                  この3つ→他のKPI→ランキング/売上構成→AIの順に流れるよう並べる。それ以外の
                  KPIはsecondary(少し弱める)。 */}
              <div className="kpi-hero-grid">
                {!hasAnyTarget ? <TargetSetupHint onGoToTarget={goToMonthlyTargetSetting} /> : null}
                {hasSalesTarget ? (
                  <MetricCard
                    label="月間達成率"
                    value={isInitialDataReady ? percent(summary.targetAchievement) : "—"}
                    secondaryValue={isInitialDataReady ? `目標売上まで ${money(summary.remainingSalesTarget)}` : ""}
                    // 追加UI/UX微修正(要件5): 状態評価(色・バッジ)は月末着地予測カード側に
                    // 一本化し、このカードは「今どこまで来ているか(達成率)」と「営業進捗比の
                    // 差」の2つだけを見せる役割にする(同じ意味の注意表示を重複させない)。
                    hint={isInitialDataReady && scheduleAdjustedGapPt !== null
                      ? <span className={scheduleAdjustedGapPt >= 0 ? "text-success" : "text-danger"}>{`営業進捗比 ${scheduleAdjustedGapPt >= 0 ? "+" : ""}${scheduleAdjustedGapPt.toFixed(1)}pt`}</span>
                      : null}
                    emphasize
                    hero
                    primary
                    onClick={goToMonthlyTargetSetting}
                  />
                ) : null}
                <MetricCard
                  label={isViewingPastMonth ? "最終着地（確定）" : "月末着地予測"}
                  value={isInitialDataReady ? money(summary.displayForecast) : "—"}
                  hint={isInitialDataReady && hasSalesTarget
                    ? <span className={forecastVsTarget >= 0 ? "text-success" : "text-danger"}>{`目標より${forecastVsTarget >= 0 ? "＋" : "▲"}${money(Math.abs(forecastVsTarget))}`}</span>
                    : null}
                  statusLabel={isInitialDataReady && hasSalesTarget ? forecastStatusLabel : ""}
                  tone={!isInitialDataReady ? "" : (hasSalesTarget ? forecastStatusTone : "")}
                  hero
                  primary
                />
                {/* 過去月は「残り営業日」を前提とした表示が不自然になるため出さない(要件21)
                    ——計算ロジック(summary.dailyNeededSales)自体は変更しない、表示条件だけ
                    追加する。 */}
                {hasSalesTarget && !isViewingPastMonth ? (
                  <MetricCard
                    label="1日平均必要売上"
                    value={isInitialDataReady ? money(summary.dailyNeededSales) : "—"}
                    hint={isInitialDataReady
                      ? <span className="metric-hint-strong">{`残り${summary.remainingBusinessDays ?? 0}営業日で必要`}</span>
                      : ""}
                    hero
                    primary
                  />
                ) : null}
                {/* スマホUI改善(要件4): 客数達成率・平均客単価はスマホ幅だけ横並び2列にする。
                    DOM順・親要素は一切変更せず(=既存のPCレイアウトを1pxも変えない)、
                    ≤900pxの時だけこの2枚にmetric-card-customer-rate/metric-card-average-spend
                    というクラスでgrid-column:span 1を与え、間に挟まる口コミ数にはCSSの
                    order(表示順)だけを与えて視覚的に後ろへ回す(DOM順自体は変えないので
                    PCの並び・タブ移動順には一切影響しない)。 */}
                {hasCustomerTarget ? (
                  <MetricCard
                    label="客数達成率"
                    value={isInitialDataReady ? percent(customerTargetSummary.achievementRate) : "—"}
                    secondaryValue={isInitialDataReady ? `目標まで ${customerTargetSummary.remainingCustomers}名` : ""}
                    hint={isInitialDataReady ? `必要客数 ${customerTargetSummary.remainingCustomersPerDay.toFixed(1)}名/日` : ""}
                    // 追加UI/UX微修正(要件6): 売上と同じ考え方で、単純な達成率(実績÷目標)
                    // ではなく営業進捗との比較で判定する(customerPaceTone、新しい客数計算は
                    // 追加していない)。
                    tone={isInitialDataReady ? customerPaceTone : ""}
                    secondary
                    className="metric-card-customer-rate"
                  />
                ) : null}
                {effectiveShowReviewCountField ? (
                  <MetricCard
                    label="口コミ数"
                    value={!isInitialDataReady ? "—" : (showReviewCountTargetField && hasReviewCountTarget
                      ? `${number(summary.reviewCount)}件 / ${number(summary.reviewCountTarget)}件`
                      : `${number(summary.reviewCount)}件`)}
                    hint={isInitialDataReady && showReviewCountTargetField && hasReviewCountTarget ? `達成率 ${percent(summary.reviewCountAchievement)}` : null}
                    tone={!isInitialDataReady ? "" : (showReviewCountTargetField && hasReviewCountTarget ? getMetricTone(summary.reviewCountAchievement, 85, 100) : "")}
                    secondary
                    className="metric-card-review-count"
                  />
                ) : null}
                {/* 客数達成率が非表示(hasCustomerTarget=false または全店舗ビュー)の月は
                    ペア相手が居ないため、スマホ幅でも2列の片方(半分の幅)のまま残さず
                    1/-1(全幅)にするクラスを追加する。 */}
                <MetricCard
                  label="平均客単価"
                  value={isInitialDataReady ? money(summary.averageSpend) : "—"}
                  secondary
                  className={`metric-card-average-spend${hasCustomerTarget ? "" : " metric-card-average-spend-solo"}`}
                />
                {perStaffSalesMetrics.map((item) => (
                  item.placeholder
                    // 「1人あたり月間売上」が非表示の月でも、他のKPIカードの位置がズレない
                    // よう同じグリッドの1マスを占有する空の枠(visibility:hidden、カードの
                    // 罫線・背景は一切描画しない)。
                    ? <div key={item.label} className="metric-card-placeholder" aria-hidden="true" />
                    : <MetricCard key={item.label} label={item.label} value={item.value} hint={item.hint} secondary />
                ))}
              </div>
              </div>
              {currentCompany && aiAnalysisSettings[currentCompany.id] ? <AiAssistantCard onOpen={() => openAiChat()} /> : null}
              {todayEntry ? (
                <div className="today-result-card">
                  <div className="panel-heading compact">
                    <div>
                      <p className="eyebrow">TODAY</p>
                      <h3>本日の実績</h3>
                    </div>
                  </div>
                  <div className="kpi-grid compact-grid">
                    <MetricCard label="本日の実績売上" value={money(todayActual)} />
                    <MetricCard label="本日の目標との差額" value={moneyDiff(todayActual - summary.todayTarget)} />
                    <MetricCard label="本日の達成率" value={percent(todayAchievement)} />
                  </div>
                </div>
              ) : null}
              {isAllStoresView ? (
                <div className="calendar-card">
                  <div className="panel-heading compact">
                    <div>
                      <p className="eyebrow">CALENDAR</p>
                      <h3>全店舗 月カレンダー</h3>
                    </div>
                  </div>
                  <p className="helper-text">緑=その日の営業対象店舗すべての日締めが完了した日／赤=その日の営業対象店舗がすべて店休日／通常色=まだ営業対象店舗すべての日締めが揃っていない営業日(クリックで未締め店舗を確認できます)。</p>
                  <BusinessCalendarGrid
                    monthValue={selectedMonth}
                    closedDates={businessDaySummary.closedDates}
                    holidayDates={businessDaySummary.holidayDates}
                    todayIso={formatLocalDate(new Date())}
                    onDayClick={handleAllStoresCalendarDayClick}
                  />
                  <UnclosedStoresPopover
                    dateIso={unclosedStoresPopover?.dateIso || ""}
                    anchorEl={unclosedStoresPopover?.anchorEl || null}
                    info={unclosedStoresPopoverInfo}
                    onClose={() => setUnclosedStoresPopover(null)}
                  />
                </div>
              ) : null}
            </section>

            <div className="dashboard-right-column">
            {/* 1店舗会社では順位比較の意味が無いため、見出し・外枠・余白ごとセクション自体を
                描画しない(CSSでdisplay:noneにするだけだと外枠の余白・DOM自体は残ってしまう
                ため、条件付きレンダリングにする)。非表示時は下のSalesCompositionCardが
                dashboard-right-column(flexカラム)の中で自動的に詰まる——ranking側の余白を
                打ち消す特別なCSSは不要。 */}
            {showStoreRanking ? (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">RANKING</p>
                  <h2>店舗売上ランキング</h2>
                </div>
              </div>
              {stores.length === 0 ? (
                <div className="empty-card">店舗を追加してください。</div>
              ) : !isInitialDataReady ? (
                // 初回ログイン直後、まだ一度もhydrateが成功しておらず前回分のキャッシュも
                // 無い間は、店舗が0件であるかのような「¥0」を全店舗分並べて不安にさせない
                // ——取得中であることが分かるプレースホルダーにする(要件9)。
                <div className="ranking-list">
                  {currentCompanyStores.map((store) => (
                    <div key={store.id} className="ranking-row ranking-row-skeleton">
                      <div className="ranking-row-rank">—</div>
                      <div className="ranking-row-main">
                        <span className="ranking-row-name">{store.name}</span>
                        <div className="ranking-row-figures">
                          <strong className="ranking-row-sales">取得中…</strong>
                          <small className="ranking-row-previous">&nbsp;</small>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {/* 売上画面UI/UX改善(要件5・23): ランキングのロジック・順位・集計は無変更
                      (rankingRowsをそのまま描画するだけ)。表示は上位3位をメダルで強調するのみ
                      ——4位以下も店舗名・現在売上は同じ濃さで表示し、非活性に見えないようにする
                      (順位差はメダル/順位番号だけで表現する、追加UI最終調整)。
                      追加UI最終調整: 現在売上と先月売上の左端を揃えるため、両方を1つの
                      縦積みブロック(ranking-row-figures)にまとめ、先月売上は現在売上の
                      真下・同じ左端に配置する。
                      スマホUI改善(要件7): 4位以降はDOM上には常に描画したまま、CSS側で
                      ≤900pxの時だけ.collapsed中は非表示にする(4位以降をJSで間引かない
                      ため、PCでは常に全店舗表示のまま——rankingExpandedの値はCSSの適用範囲
                      が異なるだけで、ランキングの計算・順位判定には一切関与しない)。 */}
                  <div className={`ranking-list ${rankingExpanded ? "" : "collapsed"}`}>
                    {rankingRows.map((row) => (
                      <div key={row.storeId} className="ranking-row">
                        <div className="ranking-row-rank">{row.currentRank === 1 ? "🥇" : row.currentRank === 2 ? "🥈" : row.currentRank === 3 ? "🥉" : row.currentRank}</div>
                        <div className="ranking-row-main">
                          <span className="ranking-row-name">{row.storeName}</span>
                          <div className="ranking-row-figures">
                            <strong className="ranking-row-sales">{money(row.sales)}</strong>
                            {/* スマホUI改善(要件4): 先月データの有無で表現がブレていた
                                (「先月 —」)のを統一する。データが無い場合は「先月データなし」
                                と明示する方式(A案)を採用——行自体を消すB案だと、店舗ごとに
                                ranking-row-figuresの高さが変わりランキング全体の縦位置が
                                ガタつくため、常に2行分の高さを確保できるA案の方が一覧として
                                自然。集計ロジック(hasPreviousSales/previousSales)自体は
                                無変更。 */}
                            <small className="ranking-row-previous">{row.hasPreviousSales ? `先月 ${money(row.previousSales)}` : "先月データなし"}</small>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* 3店舗以下では折りたたむ意味が無いため表示しない。ボタン自体もCSSで
                      PCでは常に非表示にする(≤900pxのみ表示)。 */}
                  {rankingRows.length > 3 ? (
                    <button
                      type="button"
                      className="text-button ranking-toggle-button"
                      onClick={() => setRankingExpanded((prev) => !prev)}
                    >
                      {rankingExpanded ? "閉じる" : "全店舗を見る"}
                    </button>
                  ) : null}
                </>
              )}
            </section>
            ) : null}
            <SalesCompositionCard items={salesComposition} />
            </div>
          </div>
        )}

        {activePage === "monthlyDashboard" && (
          !currentCompany ? (
            <div className="empty-card">会社情報を確認できませんでした。</div>
          ) : (
            <MonthlyDashboardPage
              appState={appState}
              currentCompany={currentCompany}
              isAllStoresView={isAllStoresView}
              selectedStoreId={selectedStoreId}
              selectedStoreEntity={selectedStoreEntity}
              selectedMonth={selectedMonth}
              onMonthChange={handleMonthSwitch}
            />
          )
        )}

        {activePage === "daily" && (
          <div className={`stack${showDailyFixedActionBar ? " has-daily-fixed-action-bar" : ""}`}>
            {!selectedStore ? (
              <div className="empty-card">店舗を追加してから日次入力を始めてください。</div>
            ) : isAllStoresView ? (
              <div className="empty-card">全店舗ビューでは日次入力はできません。実績は登録店舗ごとの日締め済みデータから自動集計されます。入力する場合は店舗を選択してください。</div>
            ) : (
              <>
                {setupChecklistReturnPending && (
                  <div className="notice-box setup-return-banner">
                    <span>初期設定から移動しました</span>
                    <button className="text-button" type="button" onClick={() => { setActivePage("dashboard"); setSetupChecklistReturnPending(false); }}>← 初期設定に戻る</button>
                  </div>
                )}
                {selectedStoreEntity?.status === "suspended" && (
                  <div className="notice-box warning">この店舗は現在停止中です。新規の売上・日次入力はできません(過去のデータは引き続き確認できます)。「店舗管理」から運営を再開できます。</div>
                )}
                {/* 毎日入力しない店舗(週1・旬ごと・月1等)向けの「まとめて入力」への切替。
                    canEditMonthlyData(system_admin/company_admin/store_manager)以外には
                    このトグル自体を出さない — staffには従来通り毎日入力の画面だけを見せる
                    (要件: 既存の日次入力は一切変更しない)。 */}
                {canEditMonthlyData(currentRole) ? (
                  <div className="button-row daily-input-mode-toggle">
                    <button
                      type="button"
                      className={dailyInputMode === "daily" ? "primary-button" : "secondary-button"}
                      onClick={() => setDailyInputMode("daily")}
                    >
                      毎日入力
                    </button>
                    <button
                      type="button"
                      className={dailyInputMode === "batch" ? "primary-button" : "secondary-button"}
                      onClick={() => setDailyInputMode("batch")}
                    >
                      まとめて入力
                    </button>
                  </div>
                ) : null}
                {dailyInputMode === "batch" && canEditMonthlyData(currentRole) ? (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">BATCH</p>
                        <h2>まとめて入力</h2>
                      </div>
                    </div>
                    <p className="helper-text">
                      毎日入力しない店舗向けに、期間(開始日〜終了日)の合計をまとめて記録できます。8/1〜8/31を指定すれば月1入力として、8/1〜8/10のように区切って使うこともできます。
                      入力した項目だけが月間集計に反映され、入力しなかった項目は0円・0人として扱われません。日別の実績データには一切変換されません。
                    </p>
                    <div className="daily-section-card">
                      <h3>期間</h3>
                      <div className="input-grid">
                        <label className="field">
                          <span>開始日</span>
                          <input type="date" value={batchForm.startDate} onChange={(event) => updateBatchField("startDate", event.target.value)} />
                        </label>
                        <label className="field">
                          <span>終了日</span>
                          <input type="date" value={batchForm.endDate} onChange={(event) => updateBatchField("endDate", event.target.value)} />
                        </label>
                      </div>
                      <p className="helper-text">開始日・終了日は同じ月内で指定してください(月をまたぐ期間は指定できません)。</p>
                    </div>

                    <div className="daily-section-card">
                      <h3>売上</h3>
                      {showTechnicalSalesField ? <Field label="技術売上（税込）" value={batchForm.technicalSales} onChange={batchFieldChangeHandlers.technicalSales} suffix="円" placeholder="未入力" numeric /> : null}
                      {showRetailSalesField ? <Field label="店販売上（税込）" value={batchForm.retailSales} onChange={batchFieldChangeHandlers.retailSales} suffix="円" placeholder="未入力" numeric /> : null}
                      {showOtherSalesField ? <Field label="その他売上（税込）" value={batchForm.otherSales} onChange={batchFieldChangeHandlers.otherSales} suffix="円" placeholder="未入力" numeric /> : null}
                      {totalSalesIsAutoCalculated ? (
                        <div className="summary-card compact">
                          <span>総売上（税込・自動計算）</span>
                          <strong>{batchForm.totalSales === "" ? "未入力" : money(parseNumber(batchForm.totalSales))}</strong>
                        </div>
                      ) : (
                        <Field label="総売上（税込）" value={batchForm.totalSales} onChange={batchFieldChangeHandlers.totalSales} suffix="円" placeholder="未入力" numeric />
                      )}
                    </div>

                    {showCustomersField ? (
                      <div className="daily-section-card">
                        <h3>客数</h3>
                        {showNewCustomersField ? <Field label="新規客数" value={batchForm.newCustomers} onChange={batchFieldChangeHandlers.newCustomers} suffix="名" placeholder="未入力" numeric /> : null}
                        {showRepeatCustomersField ? <Field label="再来客数" value={batchForm.repeatCustomers} onChange={batchFieldChangeHandlers.repeatCustomers} suffix="名" placeholder="未入力" numeric /> : null}
                        {customersIsAutoCalculated ? (
                          <div className="summary-card compact">
                            <span>客数（自動計算）</span>
                            <strong>{batchForm.customers === "" ? "未入力" : `${number(parseNumber(batchForm.customers))}名`}</strong>
                          </div>
                        ) : (
                          <Field label="客数" value={batchForm.customers} onChange={batchFieldChangeHandlers.customers} suffix="名" placeholder="未入力" numeric />
                        )}
                      </div>
                    ) : null}

                    {showReviewCountField ? (
                      <div className="daily-section-card">
                        <h3>口コミ</h3>
                        <Field label="口コミ数" value={batchForm.reviewCount} onChange={batchFieldChangeHandlers.reviewCount} suffix="件" placeholder="未入力" numeric />
                      </div>
                    ) : null}

                    {useCashBreakdown ? (
                      <div className="daily-section-card">
                        <h3>日計</h3>
                        <Field label="現金" value={batchForm.cashAmount} onChange={batchFieldChangeHandlers.cashAmount} suffix="円" placeholder="未入力" numeric />
                        <Field label="キャッシュレス" value={batchForm.cashlessAmount} onChange={batchFieldChangeHandlers.cashlessAmount} suffix="円" placeholder="未入力" numeric />
                        <Field label="ポイント利用" value={batchForm.pointAmount} onChange={batchFieldChangeHandlers.pointAmount} suffix="円" placeholder="未入力" numeric />
                      </div>
                    ) : null}

                    <div className="daily-section-card">
                      <h3>メモ</h3>
                      <label className="field">
                        <span>メモ</span>
                        <textarea value={batchForm.memo} onChange={(event) => setBatchForm((prev) => ({ ...prev, memo: event.target.value }))} rows={2} />
                      </label>
                    </div>

                    {batchFormStatus.message ? <div className={`notice-box ${batchFormStatus.status === "error" ? "warning" : ""}`}>{batchFormStatus.message}</div> : null}
                    <div className="button-row">
                      <button className="primary-button" type="button" onClick={handleSaveBatchEntry} disabled={batchFormBusy}>
                        {batchFormBusy ? "保存中…" : batchEditId ? "まとめて入力を更新" : "まとめて入力を保存"}
                      </button>
                      {batchEditId ? <button className="secondary-button" type="button" onClick={resetBatchForm}>編集をキャンセル</button> : null}
                    </div>

                    <div className="daily-section-card">
                      <h3>{formatMonthLabel(selectedMonth)}のまとめて入力一覧</h3>
                      {batchEntries.length ? (
                        <div className="stack">
                          {[...batchEntries].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))).map((entry) => {
                            // 配分対象営業日数(要件9: 実際に配分された営業日数を分母にした
                            // 1日平均)。店休日・既存の実日次入力・他のまとめ入力と重複して
                            // 除外された日は含まれない — getBatchAllocatedEntriesの結果を
                            // そのまま数えるだけで、ここでは独自の日数計算をしない。
                            const allocatedForThisEntry = batchAllocatedEntries.filter((item) => item.batchEntryId === entry.id);
                            const allocatedDayCount = allocatedForThisEntry.length;
                            return (
                              <div key={entry.id} className="preview-card">
                                <strong>{entry.startDate} 〜 {entry.endDate}（まとめて入力）</strong>
                                <small>
                                  {entry.totalSales !== null ? `総売上 ${money(entry.totalSales)} ` : ""}
                                  {entry.customers !== null ? `客数 ${entry.customers}名 ` : ""}
                                  {entry.reviewCount !== null ? `口コミ ${entry.reviewCount}件 ` : ""}
                                  {entry.cashAmount !== null || entry.cashlessAmount !== null || entry.pointAmount !== null ? "日計あり" : ""}
                                </small>
                                <small>
                                  配分対象営業日数 {allocatedDayCount}日
                                  {entry.totalSales !== null && allocatedDayCount > 0 ? `（1日平均 ${money(Math.round(entry.totalSales / allocatedDayCount))}）` : ""}
                                  {allocatedDayCount === 0 ? "（店休日・既存データ等と重複し、現在配分できる日がありません）" : ""}
                                </small>
                                <div className="button-row">
                                  <button className="text-button" type="button" onClick={() => handleEditBatchEntry(entry)}>編集</button>
                                  <button className="text-button" type="button" onClick={() => handleDeleteBatchEntry(entry)}>削除</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="helper-text">この月のまとめて入力はまだありません。</p>
                      )}
                    </div>
                  </section>
                ) : null}
                {dailyInputMode === "daily" || !canEditMonthlyData(currentRole) ? (
                <section className="panel daily-entry-panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">DAILY</p>
                      <h2>売上入力</h2>
                    </div>
                  </div>

                  {/* 販売前総合チェックで発見: saveStatus(日次入力保存・日締め・店休日設定・
                      営業日設定が共通で更新するstate)は正しく更新されていたが、それを表示する
                      JSXがどこにも無く実際には何も画面に出ていなかった——保存が失敗した場合は
                      別経路(setNotice→notice-box)で既に見えているため実害は無かったが、
                      「保存成功時に成功したことが分かる」を満たしていなかった。この1行だけを
                      追加し、saveStatusを書き込んでいる全操作(保存・日締め・店休日・営業日
                      設定)に共通の成功/保存中/エラー表示を与える。値の計算・保存処理自体は
                      無変更(表示を追加しただけ)。 */}
                  {saveStatus.message ? (
                    <p className={`daily-save-status-line${saveStatus.error ? " error" : saveStatus.status === "saving" ? " saving" : " success"}`}>
                      {saveStatus.message}
                    </p>
                  ) : null}

                  {/* 日次入力UI整理(要件2・3): ①営業進捗はコンパクトな1〜2行の帯にする
                      (以前の.daily-progress-card/.daily-progress-main/.daily-progress-value/
                      .daily-progress-metaは廃止、進捗バーは残すが細く・目立たせない)。
                      営業進捗の値自体(progressRate/completedDays/businessDayCount/
                      remainingBusinessDays)はbusinessDaySummaryをそのまま表示するだけで、
                      計算ロジックには一切触れていない。 */}
                  <div className="daily-progress-compact">
                    <div className="daily-progress-compact-row">
                      <span className="daily-progress-compact-label">営業進捗</span>
                      <span className="daily-progress-compact-figure">{businessDaySummary.completedDays ?? 0} / {businessDaySummary.businessDayCount ?? 0}日</span>
                      <span className="daily-progress-compact-figure muted">残り{businessDaySummary.remainingBusinessDays === null ? "-" : businessDaySummary.remainingBusinessDays}営業日</span>
                      <span className={`status-chip ${businessDaySummary.progressRate === null ? "neutral" : businessDaySummary.progressRate >= 100 ? "good" : businessDaySummary.progressRate >= 50 ? "warning" : "danger"}`}>
                        {businessDaySummary.progressRate === null ? "未設定" : `${Math.round(businessDaySummary.progressRate)}%`}
                      </span>
                    </div>
                    <div className="daily-progress-compact-track"><div className="daily-progress-compact-fill" style={{ width: `${Math.min(100, businessDaySummary.progressRate || 0)}%` }} /></div>
                  </div>

                  {/* 要件4: 営業日設定ボタンは進捗の直下(関連性が分かる位置)にそのまま残す。
                      営業日設定・店休日設定・営業日数計算のロジックは無変更。 */}
                  <div className="button-row">
                    <button className="secondary-button daily-business-day-button" type="button" onClick={startManualBusinessDayEdit}>営業日設定</button>
                  </div>
                  {isBusinessDayEditing ? (
                    <div className="daily-settings-card">
                      <h4>カレンダーで店休日を設定</h4>
                      <p className="helper-text">日付をクリックすると店休日として設定・解除できます（複数選択可）。営業日数は自動計算されます。</p>
                      <BusinessCalendarGrid
                        monthValue={selectedMonth}
                        closedDates={businessDaySummary.closedDates}
                        holidayDates={getStoreHolidayDates(appState, selectedStoreId, selectedMonth)}
                        onDayClick={toggleStoreHolidayDate}
                      />
                      <div className="summary-card compact" style={{ marginTop: 10 }}>
                        <span>今月営業日数（自動計算）</span>
                        <strong>{businessDaySummary.businessDayCount}日</strong>
                      </div>
                      <h4 style={{ marginTop: 16 }}>従来の店休日数設定（数値のみ・任意）</h4>
                      <p className="helper-text">上のカレンダーで日付を設定している場合、こちらの数値は使われません。</p>
                      <div className="inline-form">
                        <label className="field">
                          <span>店休日</span>
                          <NumericInput value={businessDayInput} onChange={setBusinessDayInput} placeholder="店休日数を入力" />
                        </label>
                        <label className="field">
                          <span>営業日数（手動）</span>
                          <NumericInput value={manualBusinessDayInput} onChange={setManualBusinessDayInput} placeholder="営業日数を入力" />
                        </label>
                        <button className="primary-button" type="button" onClick={saveHolidayCount}>保存</button>
                        <button className="secondary-button" type="button" onClick={saveManualBusinessDayCount}>手動保存</button>
                        <button className="secondary-button" type="button" onClick={resetBusinessDaySetting}>自動計算</button>
                        <button className="secondary-button" type="button" onClick={() => setIsBusinessDayEditing(false)}>閉じる</button>
                      </div>
                    </div>
                  ) : null}

                  {/* keyにdailyForm.date+dailyModeを含める: 対象日や編集モードが切り替わる
                      たびにReactへこのフォームを完全に作り直させる(差分パッチではなく)。
                      disabled等のprops自体は毎回正しく渡っているはずだが、万一DOM側に古い
                      属性が残るクラスの不具合があっても、モード遷移のたびに新しいDOMノードへ
                      置き換わるため確実に解消される、という追加の安全策。 */}
                  <form id="daily-form" key={`${dailyForm.date || "none"}__${dailyMode}`} onSubmit={submitDailyEntry}>
                    {/* 日次入力UI改善(要件5・6): 店舗は画面上部のヘッダー(topbar、
                        handleUnifiedStoreSwitchを呼ぶ同一の<select>)に常時表示されているため、
                        ここに全く同じ値・onChange・選択肢を複製していた<select>は削除した
                        (状態(selectedStore/appState.currentCompanyId等)・切替ロジック自体は
                        ヘッダー側にそのまま残っているため、店舗切替機能への影響は無い)。
                        対象日は従来disabled={dailyMode === "view"}で閲覧中は日付変更できなかった
                        が、これは「日付のナビゲーション」と「その日のデータの編集可否」を混同して
                        いた根本原因(要件16・20の依存関係調査で判明)——日付変更自体は
                        handleDailyDateChange(カレンダーのonDayClickと全く同じ関数)を呼ぶだけの
                        画面遷移で、保存・編集とは無関係のため、常に操作可能にする。displayLabel
                        で「8月24日（月）」を常時表示し、対象日が空白に見える不具合を防ぐ
                        (要件6)。 */}
                    <div className="daily-basic-info">
                      <Field
                        label="対象日"
                        type="date"
                        value={dailyForm.date}
                        onChange={(value) => handleDailyDateChange(value)}
                        displayLabel={formatDailyDateLabel(dailyForm.date) || "日付未選択"}
                      />
                      <div className="field">
                        <span>日締め状態</span>
                        <div className={`value-pill ${isSelectedDailyEntryClosed ? "active" : "inactive"}`}>
                          {isSelectedDailyEntryClosed ? "締め済み" : "未締め"}
                        </div>
                      </div>
                    </div>

                    {/* 要件5: 新規入力/編集/キャンセル/日締めを常時4つ並べるのをやめ、状態に応じて
                        必要な操作だけを出す。各ボタンのonClick/disabled式は既存のまま変更して
                        いない(表示するボタンの組み合わせだけを状態で出し分ける)。「新規入力」は
                        対象日を選択した時点でhandleDailyDateChangeが自動的にcreateモードへ
                        遷移させるため常時ボタンとしては不要と判断し削除(要件5で明示的に許可)
                        ——空の日付を選択すればこれまで通りすぐ入力できる。店休日は要件どおり
                        操作自体を出さない(下のフォームも非表示のため)。
                        スマホUI改善(要件8・15): ボタン群はdailyActionButtons(コンポーネント
                        冒頭で1度だけ定義)を参照するだけにし、下の.daily-fixed-action-barと
                        全く同じ要素をそのまま再利用する——ロジックの二重実装を避ける。ここは
                        フォーム内の通常位置(PC/タブレット、およびスマホでも固定バーが出ない
                        ケースのフォールバック)として常に描画し、スマホ幅では.daily-action-row
                        -inlineクラスでCSS側から非表示にする(固定バー側と表示が重複しない
                        ようにするだけで、DOM/ロジックの複製ではない)。 */}
                    {dailyActionButtons ? (
                      <div className="button-row daily-action-row-inline">
                        {dailyActionButtons}
                      </div>
                    ) : null}

                    {isDailyFormDateHoliday ? (
                      <div className="notice-box">
                        この日（{dailyForm.date}）は店休日です。日次入力・保存・日締めはできません。
                      </div>
                    ) : null}
                    {isDailyDateBatchLocked ? (
                      <div className="notice-box">
                        この日はまとめて入力（{dailyDateBatchAllocation?.batchEntryId ? batchEntries.find((entry) => entry.id === dailyDateBatchAllocation.batchEntryId)?.startDate : ""}〜{dailyDateBatchAllocation?.batchEntryId ? batchEntries.find((entry) => entry.id === dailyDateBatchAllocation.batchEntryId)?.endDate : ""}の期間）で反映されています。編集・削除は「まとめて入力」から行ってください。
                      </div>
                    ) : null}
                    {isStaffPastOrFutureDateLocked ? (
                      <div className="notice-box">
                        スタッフが入力できるのは今日の分のみです。過去日・未来日は閲覧のみで、編集・保存・日締めはできません。
                      </div>
                    ) : null}
                    {/* 不具合修正(要件3・4): 以前は「店長以上にご連絡ください」という文言のみで、
                        締め済みロック中は編集ボタン自体が非表示になり、実際には下の「日締め解除」
                        ボタン自体は(ハードロックでない限り)押せるにもかかわらず、その案内が
                        無かった。文言を実際の操作手順に合わせて修正。 */}
                    {isDailyEntryLockedForStaff ? (
                      <div className="notice-box">
                        この日は日締め済みのため編集できません。編集するには、先に「日締めを解除」してください。
                      </div>
                    ) : null}
                    {dailyMode === "view" && dailyOriginalEntry ? (
                      <div className="preview-card">
                        <strong>入力済みの内容</strong>
                        <small>日付 {dailyOriginalEntry.date} / 総売上 {money(dailyOriginalEntry.totalSales || 0)} / 客数 {dailyOriginalEntry.customers || 0}名</small>
                      </div>
                    ) : null}

                    {isDailyFormDateHoliday ? null : (
                    <>
                    {/* 要件7: メイン入力(売上・客数)は基本構造を維持しつつ、専用グリッド
                        (.daily-main-grid)へ分離する——以前は基本情報・任意項目とすべて同じ
                        1つの3列グリッド(.daily-form-grid)に混在しており、それが要件8の
                        「日計だけ表示時に右へ大きな空白ができる」原因だった。 */}
                    <div className="daily-main-grid">
                    <div className="daily-section-card">
                      <h3>売上入力</h3>
                      {/* value={x || ""}, not value={x}: an untouched field is "" or a loaded
                          0 (both falsy) and must show blank, not literal "0"; the moment the
                          user types "0" it's the non-empty *string* "0" (truthy) and displays
                          correctly. Save-time parseNumber()/buildDailyEntryPayload treat "" and
                          0 identically, so totals/KPIs/progress are never affected — this is
                          display-only. */}
                      {showTechnicalSalesField ? <Field label="技術売上（税込）" value={dailyForm.technicalSales || ""} onChange={dailyFieldChangeHandlers.technicalSales} suffix="円" placeholder="金額を入力" disabled={!canEditDailyEntry} numeric /> : null}
                      {showRetailSalesField ? <Field label="店販売上（税込）" value={dailyForm.retailSales || ""} onChange={dailyFieldChangeHandlers.retailSales} suffix="円" placeholder="金額を入力" disabled={!canEditDailyEntry} numeric /> : null}
                      {showOtherSalesField ? <Field label="その他売上（税込）" value={dailyForm.otherSales || ""} onChange={dailyFieldChangeHandlers.otherSales} suffix="円" placeholder="金額を入力" disabled={!canEditDailyEntry} numeric /> : null}
                      {totalSalesIsAutoCalculated ? (
                        <div className="summary-card compact">
                          <span>総売上（税込）</span>
                          <strong>{money(parseNumber(dailyForm.totalSales))}</strong>
                        </div>
                      ) : (
                        <Field label="総売上（税込）" value={dailyForm.totalSales || ""} onChange={dailyFieldChangeHandlers.totalSales} suffix="円" placeholder="金額を入力" disabled={!canEditDailyEntry} numeric />
                      )}
                    </div>

                    {showCustomersField ? (
                      <div className="daily-section-card">
                        <h3>客数</h3>
                        {/* 総売上と同じ考え方: 入力項目(新規・再来)を先に並べ、自動合計される
                            客数は結果として一番下に置く(要件: どこが入力でどこが自動計算か
                            直感的に分かるように)。 */}
                        {showNewCustomersField ? <Field label="新規客数" value={dailyForm.newCustomers || ""} onChange={dailyFieldChangeHandlers.newCustomers} suffix="名" placeholder="人数を入力" disabled={!canEditDailyEntry} numeric /> : null}
                        {showRepeatCustomersField ? <Field label="再来客数" value={dailyForm.repeatCustomers || ""} onChange={dailyFieldChangeHandlers.repeatCustomers} suffix="名" placeholder="人数を入力" disabled={!canEditDailyEntry} numeric /> : null}
                        {customersIsAutoCalculated ? (
                          <div className="summary-card compact">
                            <span>客数</span>
                            <strong>{number(parseNumber(dailyForm.customers))}名</strong>
                          </div>
                        ) : (
                          <Field label="客数" value={dailyForm.customers || ""} onChange={dailyFieldChangeHandlers.customers} suffix="名" placeholder="人数を入力" disabled={!canEditDailyEntry} numeric />
                        )}
                      </div>
                    ) : null}
                    </div>

                    {/* 要件8・9・12: 日計・口コミ・メモ(今後増える任意項目も含む)専用の
                        可変グリッド。個数に応じてauto-fillで自然に列数が決まり(要件9)、
                        0個の場合はエリア自体を描画しない(要件8・10・11)。今後任意カードが
                        増えても、この配列にJSXを1つ追加するだけで同じグリッドへ自然に並ぶ
                        (要件12: 列数やページ全体のCSSを書き直す必要がない)。 */}
                    {(useCashBreakdown || showReviewCountField || showMemoField) ? (
                    <div className="daily-optional-grid">
                    {useCashBreakdown ? (
                      <details className="daily-section-card cash-breakdown-card" open>
                        <summary className="cash-breakdown-summary">
                          <h3>日計</h3>
                          {/* 文字入力時の画面ガクつき再調査で発見: 以前は{cashBreakdownHasAnyValue ?
                              <span/> : null}でDOMへの挿入・削除自体を切り替えていたため、日計の
                              いずれかの欄へ最初の1文字を入力した瞬間に要素が出現し、この
                              <summary>の高さが変わって周辺(下のcash-breakdown-body全体)が
                              ずれる原因になっていた。挿入・削除ではなくvisibilityの切り替えに
                              変更し、常に同じ高さを確保する(表示するテキスト・判定ロジックは
                              無変更)。 */}
                          <span className={`cash-breakdown-summary-pill ${cashBreakdownIsMatched ? "match" : "mismatch"}${cashBreakdownHasAnyValue ? "" : " is-empty"}`}>
                            日計{"　"}{money(cashBreakdownTotal)}{"　"}{cashBreakdownIsMatched ? "✓" : `差額 ${money(Math.abs(cashBreakdownDiff))}`}
                          </span>
                        </summary>
                        <div className="cash-breakdown-body">
                          <Field label="現金" value={cashBreakdownForm.cashAmount || ""} onChange={cashBreakdownFieldChangeHandlers.cashAmount} suffix="円" placeholder="金額を入力" disabled={!canEditDailyEntry} numeric />
                          <Field label="キャッシュレス" value={cashBreakdownForm.cashlessAmount || ""} onChange={cashBreakdownFieldChangeHandlers.cashlessAmount} suffix="円" placeholder="金額を入力" disabled={!canEditDailyEntry} numeric />
                          <Field label="ポイント利用" value={cashBreakdownForm.pointAmount || ""} onChange={cashBreakdownFieldChangeHandlers.pointAmount} suffix="円" placeholder="金額を入力" disabled={!canEditDailyEntry} numeric />
                          <div className="summary-card compact">
                            <span>日計合計</span>
                            <strong>{money(cashBreakdownTotal)}</strong>
                          </div>
                          {/* 上のcash-breakdown-summary-pillと同じ理由・同じ対応(挿入・削除では
                              なくvisibilityで切り替え、高さの変動を無くす)。 */}
                          <div className={`value-pill ${cashBreakdownIsMatched ? "active" : "inactive"}${cashBreakdownHasAnyValue ? "" : " is-empty"}`}>
                            {cashBreakdownIsMatched ? "✓ 日計一致" : `差額 ${money(Math.abs(cashBreakdownDiff))}`}
                          </div>
                          <button type="button" className="text-button" onClick={() => setShowCashBreakdownMonthly(true)}>月別日計を見る</button>
                        </div>
                      </details>
                    ) : null}

                    {showReviewCountField ? (
                      <div className="daily-section-card">
                        <h3>口コミ</h3>
                        <Field label="口コミ数" value={dailyForm.reviewCount || ""} onChange={dailyFieldChangeHandlers.reviewCount} suffix="件" placeholder="件数を入力" disabled={!canEditDailyEntry} numeric />
                      </div>
                    ) : null}

                    {showMemoField ? (
                      <div className="daily-section-card daily-optional-full">
                        <h3>メモ</h3>
                        <label className="field">
                          <span>メモ</span>
                          <textarea value={dailyForm.memo || ""} onChange={(event) => setDailyForm((prev) => ({ ...prev, memo: event.target.value }))} disabled={!canEditDailyEntry} rows={3} />
                        </label>
                      </div>
                    ) : null}
                    </div>
                    ) : null}
                    </>
                    )}
                  </form>

                  {/* スマホUI改善(要件8): 保存・日締めをスマホの画面下部の固定バーからも操作
                      できるようにする。中身はdailyActionButtons(上のフォーム内と全く同じ
                      JSX・同じonClick/disabled/type="submit" form="daily-form")をそのまま
                      再利用するだけで、保存関数・イベント経路を複製しない(要件15)。
                      「保存」ボタンはform="daily-form"でこのボタン自身が<form>の外にあっても
                      同じフォームのsubmitイベントを発火させる(HTML標準機能、二重の保存関数を
                      書かずに済む)。position:fixedのためDOM上の位置は見た目に影響しない。
                      表示はshowDailyFixedActionBarがtrueの時(毎日入力モードでボタンが
                      1つ以上ある時)だけ・CSS側で≤900pxのみdisplayさせる(PCでは常時非表示)。 */}
                  {showDailyFixedActionBar ? (
                    <div className="daily-fixed-action-bar">
                      {dailyActionButtons}
                    </div>
                  ) : null}

                  {/* 要件13: 自動計算指標(入力欄ではなく結果)は追加入力エリアと分離し、独立
                      した専用グリッド(.daily-metrics-grid、PC4列→iPhoneでも2列を維持)にする。
                      説明文は削除し、見れば分かるUIに寄せる(計算式自体は無変更)。 */}
                  <div className="kpi-grid daily-metrics-grid">
                    {showCustomersField ? <MetricCard label="客単価" value={money(dailyEffectiveCustomers ? dailyEffectiveTotalSales / dailyEffectiveCustomers : 0)} /> : null}
                    {totalSalesIsAutoCalculated ? <MetricCard label="店販率" value={percent(dailyEffectiveTotalSales ? (parseNumber(dailyForm.retailSales) / dailyEffectiveTotalSales) * 100 : 0)} /> : null}
                    {showNewCustomersField ? <MetricCard label="新規率" value={percent(dailyEffectiveCustomers ? (parseNumber(dailyForm.newCustomers) / dailyEffectiveCustomers) * 100 : 0)} /> : null}
                    {showRepeatCustomersField ? <MetricCard label="再来率" value={percent(dailyEffectiveCustomers ? (parseNumber(dailyForm.repeatCustomers) / dailyEffectiveCustomers) * 100 : 0)} /> : null}
                  </div>

                  {/* 要件14: 分析可能なデータが無い(buildDailyInsightが「不足」の定型文を返した)
                      場合はカード自体を非表示にする——AI分析ロジック・判定基準は既存のまま、
                      表示条件だけを追加する。 */}
                  {currentCompany && aiAnalysisSettings[currentCompany.id] && dailyInsight && dailyInsight !== "分析に必要なデータが不足しています" ? (
                    <div className="insight-card">
                      <p className="eyebrow">今日のAI分析</p>
                      <strong>{dailyInsight}</strong>
                    </div>
                  ) : null}

                  <div className="calendar-card">
                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">CALENDAR</p>
                        <h3>月カレンダー</h3>
                      </div>
                    </div>
                    <p className="helper-text">緑=日締め完了 / 赤=店休日 / 通常色=未締め営業日</p>
                    <BusinessCalendarGrid
                      monthValue={selectedMonth}
                      closedDates={businessDaySummary.closedDates}
                      holidayDates={businessDaySummary.holidayDates}
                      todayIso={formatLocalDate(new Date())}
                      onDayClick={(iso) => handleDailyDateChange(iso)}
                    />
                  </div>
                </section>
                ) : null}

                {showCashBreakdownMonthly ? (
                  <MonthlyCashBreakdownModal
                    appState={appState}
                    storeId={selectedStoreId}
                    storeName={selectedStoreEntity?.name || ""}
                    initialMonth={selectedMonth}
                    onClose={() => setShowCashBreakdownMonthly(false)}
                  />
                ) : null}

                {todayEntry ? (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">RESULT</p>
                        <h2>本日の確認</h2>
                      </div>
                    </div>
                    <div className="kpi-grid compact-grid">
                      <MetricCard label="本日の実績売上" value={money(todayActual)} />
                      <MetricCard label="本日の目標との差額" value={moneyDiff(todayActual - summary.todayTarget)} />
                      <MetricCard label="本日の達成率" value={percent(todayAchievement)} />
                    </div>
                  </section>
                ) : null}
              </>
            )}
          </div>
        )}

        {activePage === "monthly" && (
          <div className="stack">
            {setupChecklistReturnPending && (
              <div className="notice-box setup-return-banner">
                <span>初期設定から移動しました</span>
                <button className="text-button" type="button" onClick={() => { setActivePage("dashboard"); setSetupChecklistReturnPending(false); }}>← 初期設定に戻る</button>
              </div>
            )}
            <div className="subnav">
              {visibleMonthlyTabs.map((tab) => (
                <button
                  key={tab.id}
                  className={activeMonthlyTab === tab.id ? "subnav-button active" : "subnav-button"}
                  onClick={() => {
                    if (activeMonthlyTab === "input" && tab.id !== "input" && !confirmLeaveInputSettings()) return;
                    setActiveMonthlyTab(tab.id);
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {!selectedStore ? (
              <div className="empty-card">店舗を追加してから月締めを行ってください。</div>
            ) : (
              <>
                {!isAllStoresView && selectedStoreEntity?.status === "suspended" && (
                  <div className="notice-box warning">この店舗は現在停止中です。新規の目標・費用登録はできません(過去のデータは引き続き確認できます)。「店舗管理」から運営を再開できます。</div>
                )}
                {activeMonthlyTab === "basic" && showBasicMonthlyTab && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>基本設定</h2>
                        <p className="helper-text">店舗名やスタッフ数など、店舗の基本情報を管理します。</p>
                      </div>
                    </div>
                    {isAllStoresView ? (
                      <p className="helper-text">基本設定は店舗を選択すると変更できます。</p>
                    ) : (
                      <div className="setup-card">
                        <div className="store-form-grid">
                          <label className="field">
                            <span>店舗名</span>
                            <input ref={storeFormNameInputRef} value={storeForm.name} onChange={(event) => setStoreForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="店舗名" />
                          </label>
                          <label className="field">
                            <span>在籍スタッフ数</span>
                            <NumericInput value={storeForm.staffCount} onChange={storeFieldChangeHandlers.staffCount} placeholder="例: 6" />
                          </label>
                          <label className="field">
                            <span>生産性計算人数（任意）</span>
                            <NumericInput value={storeForm.productivityStaffCount} onChange={storeFieldChangeHandlers.productivityStaffCount} allowDecimal placeholder="例: 5.0" />
                            <small className="field-hint">未入力の場合は在籍スタッフ数で計算します。パート・アルバイト・時短スタッフがいる場合のみ、小数で調整できます(例: 5.0 / 5.5 / 5.6)。</small>
                          </label>
                        </div>
                        <div className="toggle-panel">
                          <SaveStatusInline dirty={false} status={storeFormStatus} />
                          <button className="primary-button" type="button" onClick={handleSaveStore} disabled={storeFormStatus.status === "saving"}>
                            {storeFormStatus.status === "saving" ? "保存中…" : "保存"}
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {activeMonthlyTab === "input" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>日次入力の設定</h2>
                        <p className="helper-text">毎日の入力で使用する項目や機能を選択できます。必要なものだけONにすると、日次入力画面に表示されます。</p>
                      </div>
                    </div>
                    {isAllStoresView ? (
                      <p className="helper-text">入力設定は店舗を選択すると変更できます。</p>
                    ) : (
                      <>
                        <p className="helper-text">店舗ごとに設定でき、いつでも変更できます。</p>
                        <div className="setup-card">
                          <div className="panel-heading compact"><div><h3>入力項目</h3></div></div>
                          <FieldToggleList
                            keys={dailyFieldKeys}
                            labels={dailyFieldLabels}
                            values={dailyFieldDraft.fields}
                            editable={inputSettingsEditable}
                            onToggle={updateDailyFieldToggle}
                            showStateLabel
                          />
                        </div>
                        <div className="setup-card">
                          <div className="panel-heading compact"><div><h3>機能</h3></div></div>
                          <FieldToggleList
                            keys={["useCashBreakdown", "useInventoryTracking"]}
                            labels={{ useCashBreakdown: "日計管理", useInventoryTracking: "在庫管理" }}
                            values={{ useCashBreakdown: cashBreakdownDraft, useInventoryTracking: inventoryTrackingDraft }}
                            editable={inputSettingsEditable}
                            onToggle={(key, value) => (key === "useCashBreakdown" ? updateCashBreakdownDraft(value) : updateInventoryTrackingDraft(value))}
                            showStateLabel
                          />
                          <p className="helper-text">
                            日計管理: 日々の売上を、現金・キャッシュレス・ポイント利用など支払方法別に記録できます。※ 総売上や損益には重複して加算されません。
                          </p>
                          <p className="helper-text">
                            在庫管理: 月初在庫・月末在庫を入力し、材料・仕入原価の計算に使用します。OFFの店舗は仕入・発注額がそのまま原価になります。
                          </p>
                        </div>
                        {inputSettingsEditable ? (
                          <div className="toggle-panel">
                            <SaveStatusInline dirty={inputSettingsDirty} status={inputSettingsSaveStatus} />
                            <button className="primary-button" type="button" onClick={handleSaveInputSettings} disabled={!inputSettingsDirty || inputSettingsSaveStatus.status === "saving"}>
                              {inputSettingsSaveStatus.status === "saving" ? "保存中…" : "変更を保存"}
                            </button>
                          </div>
                        ) : null}
                      </>
                    )}
                  </section>
                )}

                {activeMonthlyTab === "target" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>目標設定</h2>
                      </div>
                    </div>

                    {!isAllStoresView && (
                      <div className="setup-card">
                        <div className="panel-heading compact"><div><h3>① 使用する目標項目</h3></div></div>
                        <p className="helper-text">この店舗で管理する目標項目を選択してください。OFFにした項目は、下の目標入力欄や各画面に表示されません。</p>
                        <FieldToggleList
                          keys={monthlyTargetFieldKeys}
                          labels={monthlyTargetFieldLabels}
                          values={monthlyTargetFieldDraft.fields}
                          editable={inputSettingsEditable}
                          onToggle={updateMonthlyTargetFieldToggle}
                          showStateLabel
                        />
                        {inputSettingsEditable ? (
                          <div className="toggle-panel">
                            <SaveStatusInline dirty={monthlyTargetFieldDirty} status={monthlyTargetFieldSaveStatus} />
                            <button className="primary-button" type="button" onClick={handleSaveMonthlyTargetFieldSettings} disabled={monthlyTargetFieldSaveStatus.status === "saving"}>
                              {monthlyTargetFieldSaveStatus.status === "saving" ? "保存中…" : "変更を保存"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )}

                    <div className="setup-card target-values-card">
                      <div className="panel-heading compact"><div><h3>{isAllStoresView ? "① 全店舗共通の月間目標を入力" : "② 月間目標を入力"}</h3></div></div>
                      <p className="helper-text">
                        {isAllStoresView
                          ? "会社全体の目標として保存されます。各店舗の月間目標は変更されません。休業日はここで設定した値が全店舗共通の営業日数として使われます(店舗ごとの休業日数の合計ではありません)。"
                          : "対象月の目標数値を入力してください。"}
                      </p>
                      <div className="month-switcher">
                        <button type="button" className="month-switcher-arrow" aria-label="前月" onClick={() => handleTargetMonthChange(getMonthOffset(targetSelectedMonth, -1))}>‹</button>
                        <span className="month-switcher-label">対象月：{formatMonthLabel(targetSelectedMonth)}</span>
                        <button type="button" className="month-switcher-arrow" aria-label="翌月" onClick={() => handleTargetMonthChange(getMonthOffset(targetSelectedMonth, 1))}>›</button>
                      </div>

                      {targetLoadStatus.status === "loading" ? (
                        <div className="empty-card">読み込み中…</div>
                      ) : (
                        <>
                          <div className="input-grid">
                            {activeMonthlyTargetFieldSettings.fields.targetSales ? <Field label="月間目標売上（税込）" value={targetDraft.targetSales} onChange={targetFieldChangeHandlers.targetSales} suffix="円" numeric placeholder="例: 5,000,000" /> : null}
                            {!isAllStoresView && activeMonthlyTargetFieldSettings.fields.holidayCount ? <Field label="休業日" value={targetHolidayDraft} onChange={(value) => { setTargetHolidayDraft(value); setTargetDirty(true); }} suffix="日" numeric placeholder="例: 4" /> : null}
                            {activeMonthlyTargetFieldSettings.fields.targetTechnicalSales ? <Field label="技術売上目標（税込）" value={targetDraft.targetTechnicalSales} onChange={targetFieldChangeHandlers.targetTechnicalSales} suffix="円" numeric placeholder="例: 4,500,000" /> : null}
                            {activeMonthlyTargetFieldSettings.fields.targetRetailSales ? <Field label="店販売上目標（税込）" value={targetDraft.targetRetailSales} onChange={targetFieldChangeHandlers.targetRetailSales} suffix="円" numeric placeholder="例: 500,000" /> : null}
                            {activeMonthlyTargetFieldSettings.fields.targetCustomers ? <Field label="客数目標" value={targetDraft.targetCustomers} onChange={targetFieldChangeHandlers.targetCustomers} suffix="名" numeric placeholder="例: 400" /> : null}
                            {activeMonthlyTargetFieldSettings.fields.targetAverageSpend ? <Field label="客単価目標" value={targetDraft.targetAverageSpend} onChange={targetFieldChangeHandlers.targetAverageSpend} suffix="円" numeric placeholder="例: 12,500" /> : null}
                            {activeMonthlyTargetFieldSettings.fields.targetNewCustomers ? <Field label="新規客数目標" value={targetDraft.targetNewCustomers} onChange={targetFieldChangeHandlers.targetNewCustomers} suffix="名" numeric placeholder="例: 80" /> : null}
                            {activeMonthlyTargetFieldSettings.fields.targetRepeatCustomers ? <Field label="再来客数目標" value={targetDraft.targetRepeatCustomers} onChange={targetFieldChangeHandlers.targetRepeatCustomers} suffix="名" numeric placeholder="例: 320" /> : null}
                            {showReviewCountTargetField ? <Field label="目標口コミ数" value={targetDraft.targetReviewCount} onChange={targetFieldChangeHandlers.targetReviewCount} suffix="件" numeric placeholder="例: 20" /> : null}
                          </div>
                          {isAllStoresView ? (
                            <div className="daily-settings-card">
                              <h4>全店舗共通の店休日設定</h4>
                              <p className="helper-text">日付をクリックすると全店舗共通の店休日として設定・解除できます（複数選択可）。各店舗個別の店休日設定とは別管理で、店舗ごとの設定は変更されません。営業日数はここで選択した日付から自動計算されます。</p>
                              <BusinessCalendarGrid
                                monthValue={targetSelectedMonth}
                                closedDates={[]}
                                holidayDates={getAllStoresHolidayDates(appState, appState.currentCompanyId, targetSelectedMonth)}
                                onDayClick={toggleAllStoresHolidayDate}
                              />
                              <div className="summary-card compact" style={{ marginTop: 10 }}>
                                <span>全店舗の今月営業日数（自動計算）</span>
                                <strong>{getAllStoresBusinessDaySummary(appState, appState.currentCompanyId, currentCompanyStores, targetSelectedMonth).businessDayCount}日</strong>
                              </div>
                            </div>
                          ) : null}
                          <div className="toggle-panel target-save-row">
                            <SaveStatusInline dirty={targetDirty} status={targetSaveStatus} />
                            <button className="primary-button target-save-button" type="button" onClick={handleSaveMonthlyTarget} disabled={targetSaveStatus.status === "saving"}>
                              {targetSaveStatus.status === "saving" ? "保存中…" : "目標を保存"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </section>
                )}

                {activeMonthlyTab === "fixed" && isAllStoresView ? (
                  <section className="panel">
                    <div className="empty-card">全店舗ビューでは費用入力は利用できません。店舗を選択してください。</div>
                  </section>
                ) : activeMonthlyTab === "fixed" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">EXPENSE</p>
                        <h2>費用入力</h2>
                      </div>
                    </div>
                    <div className="panel-heading compact cost-section-heading">
                      <div>
                        <p className="eyebrow">SALES-LINKED</p>
                        <h3>売上連動費</h3>
                        <p className="helper-text">売上に応じて自動計算される費用です</p>
                      </div>
                    </div>
                    <CostRateEstimationPanel
                      key={`labor-${selectedStoreId}-${selectedMonth}`}
                      costType="labor"
                      title="人件費"
                      rateLabel="人件費率"
                      sales={summary.sales}
                      autoEstimate={summary.laborCostAutoEstimate}
                      summaryAmount={summary.laborCost}
                      summarySource={summary.laborCostSource}
                      mode={selectedStoreEntity?.settings?.laborCostMode || "fixed"}
                      rate={selectedStoreEntity?.settings?.laborCostRate || 0}
                      fixedAmount={summary.laborCost}
                      hasMultipleFixedItems={fixedCosts.filter((item) => item.categoryKey === "labor").length > 1}
                      fixedItemsCount={fixedCosts.filter((item) => item.categoryKey === "labor").length}
                      fixedItemsTotal={summary.laborCost}
                      canEdit={canEditMonthlyData(currentRole)}
                      onSaveSettings={handleSaveCostRateSettings}
                      onSaveOverride={handleSaveCostOverride}
                      onSaveFixedAmount={handleSaveCostFixedAmount}
                    />
                    <CostRateEstimationPanel
                      key={`purchase-${selectedStoreId}-${selectedMonth}`}
                      costType="purchase"
                      title="仕入・発注額"
                      rateLabel="仕入率"
                      sales={summary.sales}
                      autoEstimate={summary.purchaseCostAutoEstimate}
                      summaryAmount={summary.purchaseAmount}
                      summarySource={summary.purchaseCostSource}
                      mode={selectedStoreEntity?.settings?.purchaseCostMode || "fixed"}
                      rate={selectedStoreEntity?.settings?.purchaseCostRate || 0}
                      fixedAmount={summary.purchaseAmount}
                      hasMultipleFixedItems={fixedCosts.filter((item) => item.categoryKey === "materials").length > 1}
                      fixedItemsCount={fixedCosts.filter((item) => item.categoryKey === "materials").length}
                      fixedItemsTotal={summary.purchaseAmount}
                      canEdit={canEditMonthlyData(currentRole)}
                      onSaveSettings={handleSaveCostRateSettings}
                      onSaveOverride={handleSaveCostOverride}
                      onSaveFixedAmount={handleSaveCostFixedAmount}
                    />
                    <div className="panel-heading compact cost-section-heading">
                      <div>
                        <p className="eyebrow">FIXED</p>
                        <h3>固定費・その他費用</h3>
                        <p className="helper-text">毎月固定または個別に入力する費用です</p>
                      </div>
                    </div>
                    <form className="inline-form cost-item-form" onSubmit={submitFixedCost}>
                      <input value={fixedForm.name} onChange={(event) => setFixedForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="費用名（例: 家賃、HPB）" />
                      <select
                        value={fixedForm.categoryKey || ""}
                        onChange={(event) => {
                          const nextCategoryKey = event.target.value;
                          const nextIsSingleMonth = nextCategoryKey === "labor" || nextCategoryKey === "materials";
                          setFixedForm((prev) => ({
                            ...prev,
                            categoryKey: nextCategoryKey,
                            periodType: nextIsSingleMonth ? "limited" : prev.periodType,
                            startMonth: nextIsSingleMonth ? (prev.startMonth || selectedMonth) : prev.startMonth,
                            endMonth: nextIsSingleMonth ? (prev.startMonth || selectedMonth) : prev.endMonth,
                          }));
                        }}
                        required
                      >
                        <option value="">費用カテゴリを選択</option>
                        {costCategoryKeys.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}
                      </select>
                      {/* 継続費用は新規登録・編集どちらでも基本値を出す(要件1-4)。単月・
                          期間限定は既存仕様通り新規登録時だけ(金額は月次一覧側で個別管理)。 */}
                      {!fixedForm.id || fixedForm.periodType === "ongoing" ? (
                        <NumericInput
                          value={fixedForm.amount}
                          onChange={(value) => setFixedForm((prev) => ({ ...prev, amount: value }))}
                          placeholder={fixedForm.periodType === "ongoing" ? "基本値（毎月自動反映）" : "今月の金額"}
                        />
                      ) : null}
                      {fixedForm.categoryKey === "labor" || fixedForm.categoryKey === "materials" ? (
                        <label className="field">
                          <span>対象年月</span>
                          <input
                            type="month"
                            value={fixedForm.startMonth || ""}
                            onChange={(event) => setFixedForm((prev) => ({ ...prev, startMonth: event.target.value, endMonth: event.target.value }))}
                            required
                          />
                        </label>
                      ) : (
                        <>
                          <div className="segmented-control" role="group" aria-label="適用期間">
                            <button
                              type="button"
                              className={fixedForm.periodType === "limited" ? "segmented-button" : "segmented-button active"}
                              onClick={() => setFixedForm((prev) => ({ ...prev, periodType: "ongoing", endMonth: "" }))}
                            >
                              継続
                            </button>
                            <button
                              type="button"
                              className={fixedForm.periodType === "limited" ? "segmented-button active" : "segmented-button"}
                              onClick={() => setFixedForm((prev) => ({ ...prev, periodType: "limited" }))}
                            >
                              単月・期間限定
                            </button>
                          </div>
                          {fixedForm.periodType === "limited" ? (
                            <>
                              <label className="field">
                                <span>開始月</span>
                                <input type="month" value={fixedForm.startMonth || ""} onChange={(event) => setFixedForm((prev) => ({ ...prev, startMonth: event.target.value }))} required />
                              </label>
                              <label className="field">
                                <span>終了月</span>
                                <input type="month" value={fixedForm.endMonth || ""} onChange={(event) => setFixedForm((prev) => ({ ...prev, endMonth: event.target.value }))} required />
                              </label>
                            </>
                          ) : null}
                        </>
                      )}
                      <button className="primary-button" type="submit" disabled={fixedCostFormBusy}>{fixedCostFormBusy ? "保存中…" : (fixedForm.id ? "更新" : "追加")}</button>
                      {fixedForm.id ? <button className="secondary-button" type="button" onClick={cancelEditFixedCost}>キャンセル</button> : null}
                      <details className="advanced-fields">
                        <summary>詳細設定（任意）</summary>
                        <div className="advanced-fields-body">
                          <input value={fixedForm.memo || ""} onChange={(event) => setFixedForm((prev) => ({ ...prev, memo: event.target.value }))} placeholder="備考（任意）" />
                        </div>
                      </details>
                    </form>
                    {/* 要件7・8: ドラッグハンドル(≡)で並び替え可能。PCはハンドルを押したまま
                        上下移動、iPhoneはハンドルを長押しして上下移動(Pointer Eventsでマウス・
                        タッチを統一的に処理)。入力欄・編集・削除ボタンはハンドルと別要素なので、
                        誤操作にはならない。 */}
                    <div className="list-card">
                      {fixedCosts.map((item) => {
                        const periodLabel = item.periodType === "limited"
                          ? (item.startMonth && item.startMonth === item.endMonth ? `${item.startMonth}のみ` : `${item.startMonth}〜${item.endMonth}`)
                          : "継続";
                        const previousAmount = getPreviousMonthCostAmount(appState, item.id, selectedMonth);
                        const savedAmount = getCostMonthlyAmount(appState, item.id, selectedMonth);
                        const draftAmount = getCostAmountDraft(item);
                        // 単月項目(人件費/材料・発注費等)は月ごとに新しいitem idになるため上のidベースの
                        // 前月比較が効かない。名前+カテゴリが一致する前月項目があればサジェスト表示する。
                        const suggestedPreviousAmount = previousAmount === undefined
                          ? getPreviousMonthAmountByNameAndCategory(appState, selectedStoreId, item.name, item.categoryKey, selectedMonth)
                          : undefined;
                        return (
                          <div
                            key={item.id}
                            data-cost-item-id={item.id}
                            className={`list-row cost-row ${fixedCostDragId === item.id ? "cost-row-dragging" : ""} ${fixedCostDragOverId === item.id && fixedCostDragId && fixedCostDragId !== item.id ? "cost-row-drag-over" : ""}`}
                          >
                            <span
                              className="cost-row-drag-handle"
                              onPointerDown={(event) => handleFixedCostDragPointerDown(event, item.id)}
                              onPointerMove={handleFixedCostDragPointerMove}
                              onPointerUp={handleFixedCostDragPointerUp}
                              onPointerCancel={handleFixedCostDragPointerUp}
                              aria-label="ドラッグして並び替え"
                              role="button"
                              tabIndex={-1}
                            >
                              ≡
                            </span>
                            <div>
                              <strong>{item.name}</strong>
                              <small>{getCostCategoryLabel(item.categoryKey)} ／ {item.periodType === "limited" ? "単月・期間限定" : "継続"} ／ {periodLabel}{item.memo ? ` ／ ${item.memo}` : ""}</small>
                            </div>
                            <div className="cost-row-amount">
                              <NumericInput
                                value={draftAmount}
                                placeholder={savedAmount === undefined ? "未入力" : ""}
                                onChange={getCostAmountDraftHandler(item.id)}
                              />
                              {/* 要件6: 継続費用は基本値が毎月自動反映されるため「前月をコピー」は
                                  不要(常に基本値=前月扱いになってしまい紛らわしいため非表示にする)。
                                  単月・期間限定費用は既存仕様のまま維持する。 */}
                              {item.periodType === "limited" && previousAmount !== undefined ? (
                                <button className="text-button" type="button" onClick={() => copyPreviousMonthAmountFor(item)}>前月をコピー（{money(previousAmount)}）</button>
                              ) : item.periodType === "limited" && suggestedPreviousAmount !== undefined ? (
                                <small className="helper-text">前月の{item.name}: {money(suggestedPreviousAmount)}</small>
                              ) : null}
                              <button className="secondary-button" type="button" onClick={() => saveCostAmountFor(item)}>保存</button>
                            </div>
                            <div className="row-actions">
                              <button className="text-button" type="button" onClick={() => editFixedCost(item)}>項目編集</button>
                              <button className="text-button danger" type="button" onClick={() => removeFixedCost(item.id)}>削除</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {activeMonthlyTab === "closing" && isAllStoresView ? (
                  <section className="panel">
                    <div className="empty-card">全店舗ビューでは月締めは利用できません。店舗を選択してください。</div>
                  </section>
                ) : activeMonthlyTab === "closing" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">MANAGEMENT</p>
                        <h2>月締め</h2>
                      </div>
                    </div>
                    <p className="helper-text">月締めは、損益表に必要な入力が揃っているかを確認し、月の実績を確定するための画面です。金額の入力・修正は「費用入力」タブで行います。</p>
                    {monthNeedsReconfirmation ? (
                      <div className="empty-card danger-text">確定後に費用・在庫データが変更されています。内容をご確認のうえ、必要であれば再確定してください。</div>
                    ) : null}
                    <div className="list-card">
                      {monthClosingChecklist.items.map((item) => (
                        <div key={item.key} className="list-row">
                          <div>
                            <strong>{item.entered ? "✅" : "☐"} {item.label}</strong>
                            <small>{item.entered ? "入力済み" : "未確認"}</small>
                          </div>
                          <div className="row-actions">
                            {!item.entered ? (
                              <button
                                className="text-button"
                                type="button"
                                onClick={() => {
                                  if (item.key === "sales") {
                                    setActivePage("daily");
                                    return;
                                  }
                                  setActiveMonthlyTab("fixed");
                                  setFixedForm({ ...defaultFixedCostItem, startMonth: selectedMonth, categoryKey: item.categoryKey });
                                }}
                              >
                                登録する
                              </button>
                            ) : null}
                            {item.categoryKey ? (
                              <button
                                className="text-button"
                                type="button"
                                onClick={() => handleToggleHiddenClosingCategory(item.categoryKey, true)}
                              >
                                対象外にする
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    {monthClosingChecklist.hiddenItems.length > 0 ? (
                      <details className="advanced-fields">
                        <summary>対象外項目を管理（{monthClosingChecklist.hiddenItems.length}件）</summary>
                        <div className="advanced-fields-body">
                          <div className="list-card">
                            {monthClosingChecklist.hiddenItems.map((item) => (
                              <div key={item.key} className="list-row">
                                <div><strong>{item.label}</strong><small>対象外</small></div>
                                <div className="row-actions">
                                  <button className="text-button" type="button" onClick={() => handleToggleHiddenClosingCategory(item.categoryKey, false)}>表示に戻す</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </details>
                    ) : null}
                    <div className="toggle-panel">
                      <div>
                        <strong>{monthClosingStatus.closed ? "月締め済み" : "未締め"}</strong>
                        <small>{monthClosingStatus.lockedAt ? `最終確定: ${new Date(monthClosingStatus.lockedAt).toLocaleString("ja-JP")}` : "締め状態はまだ未設定です"}</small>
                      </div>
                      <button className={monthClosingStatus.closed ? "secondary-button" : "primary-button"} type="button" onClick={toggleMonthClosing}>
                        {monthClosingStatus.closed ? "締めを解除" : monthNeedsReconfirmation ? "再確定する" : "この月を確定する"}
                      </button>
                    </div>
                    {useInventoryTracking ? (
                      <div className="setup-card">
                        <div className="panel-heading compact">
                          <div>
                            <p className="eyebrow">INVENTORY</p>
                            <h3>在庫</h3>
                          </div>
                        </div>
                        {previousInventoryBalance === undefined ? (
                          <>
                            <p className="helper-text">前月末の在庫データがまだありません。初回のみ「月初在庫」（今月が始まった時点の在庫金額）を入力してください。</p>
                            <div className="inline-form">
                              <label className="field">
                                <span>月初在庫</span>
                                <NumericInput value={openingInventoryDraft} onChange={setOpeningInventoryDraft} placeholder="金額" />
                                <small className="field-hint">前月末から繰り越した在庫金額</small>
                              </label>
                              <button className="secondary-button" type="button" onClick={saveOpeningInventoryBalance}>月初在庫を保存</button>
                            </div>
                          </>
                        ) : (
                          <p className="helper-text">前月末在庫: {money(previousInventoryBalance)}</p>
                        )}
                        <div className="inline-form">
                          <label className="field">
                            <span>当月末在庫</span>
                            <NumericInput value={closingInventoryDraft} onChange={setClosingInventoryDraft} placeholder="金額" />
                          </label>
                          <button className="secondary-button" type="button" onClick={saveClosingInventoryBalance}>当月末在庫を保存</button>
                        </div>
                      </div>
                    ) : null}
                  </section>
                )}

                {activeMonthlyTab === "pnl" && isAllStoresView ? (
                  <section className="panel">
                    <div className="empty-card">全店舗ビューでは損益表は利用できません。店舗を選択してください。</div>
                  </section>
                ) : activeMonthlyTab === "pnl" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">P&L</p>
                        <h2>月次損益表</h2>
                      </div>
                    </div>
                    <p className="helper-text">本画面は店舗経営管理用の概算損益です。税務申告上の利益・納税額とは異なる場合があります。</p>
                    {summary.isProvisionalProfit ? (
                      <div className="empty-card">
                        ※{summary.missingCriticalCategories.map((key) => getCostCategoryLabel(key)).join("・")}が未入力のため、営業利益は算出できません。「費用入力」タブで登録すると確認できます。
                      </div>
                    ) : null}

                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">SALES</p>
                        <h3>売上</h3>
                      </div>
                    </div>
                    <div className="summary-grid">
                      <div className="summary-card"><span>総売上（税込）</span><strong>{money(summary.sales)}</strong></div>
                      <div className="summary-card"><span>技術売上（税込）</span><strong>{money(summary.technicalSales)}</strong></div>
                      <div className="summary-card"><span>店販売上（税込）</span><strong>{money(summary.retailSales)}</strong></div>
                    </div>

                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">COST</p>
                        <h3>原価</h3>
                      </div>
                    </div>
                    <div className="summary-grid">
                      {/* 在庫管理OFFの店舗は仕入・発注額=材料・仕入原価がそのまま同額になるため、
                          重複を避けて原価の内訳(仕入・発注額)は在庫管理ONの店舗だけ表示する。 */}
                      {/* 補助表示(要件13): 自動計算中は「◯◯率◯%から自動計算」、手動確定後は
                          「確定値」。スマホでも読める短い文言にする。useInventoryTracking OFFの
                          店舗では仕入・発注額カード自体が非表示のため、その場合は同じ金額を
                          表示している材料・仕入原価カード側に補助表示を出す。 */}
                      {useInventoryTracking ? (
                        <div className="summary-card">
                          <span>仕入・発注額</span>
                          <strong>{formatMoneyOrDash(summary.purchaseAmount, summary.categoryHasEntry.materials)}</strong>
                          {summary.purchaseCostSource === "manual" ? <small className="cost-source-caption">確定値</small>
                            : summary.purchaseCostSource === "auto" ? <small className="cost-source-caption">仕入率{Number(selectedStoreEntity?.settings?.purchaseCostRate || 0).toFixed(1)}%から自動計算</small>
                            : null}
                        </div>
                      ) : null}
                      <div className="summary-card">
                        <span>材料・仕入原価</span>
                        <strong>{formatMoneyOrDash(summary.costOfGoodsSold, summary.categoryHasEntry.materials)}</strong>
                        {!useInventoryTracking && summary.purchaseCostSource === "manual" ? <small className="cost-source-caption">確定値</small>
                          : !useInventoryTracking && summary.purchaseCostSource === "auto" ? <small className="cost-source-caption">仕入率{Number(selectedStoreEntity?.settings?.purchaseCostRate || 0).toFixed(1)}%から自動計算</small>
                          : null}
                      </div>
                      <div className="summary-card"><span>材料・仕入原価率</span><strong>{formatPercentOrDash(summary.costOfGoodsSoldRate, summary.categoryHasEntry.materials)}</strong></div>
                    </div>

                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">EXPENSE</p>
                        <h3>費用</h3>
                      </div>
                    </div>
                    <div className="summary-grid">
                      <div className="summary-card">
                        <span>人件費</span>
                        <strong>{formatMoneyOrDash(summary.laborCost, summary.categoryHasEntry.labor)}</strong>
                        {summary.laborCostSource === "manual" ? <small className="cost-source-caption">確定値</small>
                          : summary.laborCostSource === "auto" ? <small className="cost-source-caption">人件費率{Number(selectedStoreEntity?.settings?.laborCostRate || 0).toFixed(1)}%から自動計算</small>
                          : null}
                      </div>
                      <div className="summary-card"><span>人件費率</span><strong>{formatPercentOrDash(summary.laborRate, summary.categoryHasEntry.labor)}</strong></div>
                      <div className="summary-card"><span>経費合計</span><strong>{formatMoneyOrDash(summary.expenseCost, summary.hasExpenseCostData)}</strong></div>
                    </div>

                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">PROFIT</p>
                        <h3>利益</h3>
                      </div>
                    </div>
                    <div className="summary-grid">
                      <div className="summary-card"><span>粗利益</span><strong>{formatMoneyOrDash(summary.grossProfit, summary.categoryHasEntry.materials)}</strong></div>
                      <div className="summary-card emphasize"><span>営業利益</span><strong>{formatMoneyOrDash(summary.operatingProfit, !summary.isProvisionalProfit)}</strong></div>
                      <div className="summary-card emphasize"><span>営業利益率</span><strong>{formatPercentOrDash(summary.operatingMargin, !summary.isProvisionalProfit)}</strong></div>
                    </div>

                    {/* 経営指標(KPI)セクションは廃止し、同じ位置に「消費税考慮」を配置する。損益表の
                        主役はあくまで営業利益/営業利益率(上の利益グループ)で、消費税関連は別枠の
                        参考情報として混同しないよう分けている。 */}
                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">TAX</p>
                        <h3>消費税考慮</h3>
                      </div>
                    </div>
                    <div className="toggle-panel">
                      <div>
                        <strong>消費税を考慮する</strong>
                        <small>{appState.taxSettings?.considerConsumptionTax ? "ON" : "OFF"}</small>
                      </div>
                      <button
                        className={appState.taxSettings?.considerConsumptionTax ? "secondary-button" : "primary-button"}
                        type="button"
                        onClick={() => handleToggleConsiderConsumptionTax(!appState.taxSettings?.considerConsumptionTax)}
                      >
                        {appState.taxSettings?.considerConsumptionTax ? "OFFにする" : "ONにする"}
                      </button>
                    </div>
                    {appState.taxSettings?.considerConsumptionTax ? (
                      <>
                        <div className="inline-form">
                          <label className="field">
                            <span>消費税率（%）</span>
                            <NumericInput value={taxSettingsForm.consumptionTaxReserveRate} onChange={(value) => setTaxSettingsForm((prev) => ({ ...prev, consumptionTaxReserveRate: value }))} allowDecimal placeholder="例: 10" />
                          </label>
                          <button className="secondary-button" type="button" onClick={handleSaveTaxSettings}>引当率を保存</button>
                        </div>
                        <div className="summary-grid">
                          <div className="summary-card"><span>消費税引当額（概算）</span><strong>{money(summary.consumptionTaxReserveAmount)}</strong></div>
                          <div className="summary-card"><span>消費税考慮後利益</span><strong>{money(summary.profitAfterConsumptionTaxReserve)}</strong></div>
                        </div>
                        <div className="helper-text">消費税引当額は店舗経営・資金管理用の概算です。実際の納税額は税務処理・課税方式等により異なります。</div>
                      </>
                    ) : null}
                  </section>
                )}
              </>
            )}
          </div>
        )}

        {activePage === "companies" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">COMPANY</p>
                <h2>会社管理</h2>
              </div>
            </div>
            {normalizeRole(currentRole) === "system_admin" ? (() => {
              // 削除済み(ゴミ箱)会社は集計・通常の会社選択・通常一覧のどこにも含めない
              // (要件4・6②)。将来の有料契約社数・MRR集計は「契約中」のみを対象にできるよう、
              // ここで会社数を契約状態ごとに数えておく(契約中のみが課金対象、という前提の
              // 集計構造)。
              const liveCompanies = (appState.companies || []).filter((company) => !company.deletedAt);
              const statusCounts = { free: 0, trial: 0, active: 0, suspended: 0 };
              liveCompanies.forEach((company) => {
                const status = company.contractStatus || "trial";
                if (status in statusCounts) statusCounts[status] += 1;
              });
              return (
                <>
                  <div className="kpi-hero-grid">
                    <MetricCard label="全会社数" value={String(liveCompanies.length)} />
                    <MetricCard label="契約中" value={String(statusCounts.active)} tone="good" />
                    <MetricCard label="無料利用" value={String(statusCounts.free)} />
                    <MetricCard label="トライアル" value={String(statusCounts.trial)} tone="warning" />
                    <MetricCard label="停止" value={String(statusCounts.suspended)} tone="warning" />
                  </div>
                  <div className="inline-form">
                    <label className="field">
                      <span>会社選択</span>
                      <select value={appState.currentCompanyId || ""} onChange={(event) => handleCompanySwitch(event.target.value)}>
                        {liveCompanies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                      </select>
                    </label>
                  </div>
                </>
              );
            })() : null}
            <p className="management-help">会社を追加して、店舗・ユーザー・設定をまとめて管理できます。業種を先に選ぶと、後続の店舗登録も自然になります。</p>
            <div className="inline-form">
              <input value={companyForm.name} onChange={(event) => setCompanyForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="会社名" />
              <select value={companyForm.businessType || "salon"} onChange={(event) => setCompanyForm((prev) => ({ ...prev, businessType: event.target.value }))}>
                <option value="salon">サロン</option>
                <option value="nail">ネイルサロン</option>
                <option value="eyelash">まつげサロン</option>
                <option value="esthetic">エステサロン</option>
              </select>
              {/* 契約状態は新規作成時にだけこのセレクトで選ぶ(要件1)。作成後の状態変更は
                  下の会社カードの「契約中へ変更」「停止」ボタン経由のみで行う — このフォームの
                  「会社情報を更新」は元々companiesテーブルへ実際に反映されない(会社名・業種の
                  編集もローカル表示のみ)ため、編集モードでこのセレクトを操作できてしまうと
                  「契約状態を変えたつもりが実際には何も変わらない」トラップになる。 */}
              {!companyEditId && (
                <select value={companyForm.contractStatus} onChange={(event) => setCompanyForm((prev) => ({ ...prev, contractStatus: event.target.value }))}>
                  <option value="free">無料利用</option>
                  <option value="trial">トライアル</option>
                  <option value="active">契約中</option>
                  <option value="suspended">停止中</option>
                </select>
              )}
              <button className="primary-button" type="button" onClick={handleSaveCompany} disabled={companyFormBusy}>{companyFormBusy ? "保存中…" : companyEditId ? "会社情報を更新" : "会社追加"}</button>
              {/* 危険度に応じて配置(要件10): 会社情報を更新(通常)の隣に、赤系(危険)の
                  「会社データを削除」を並べる。これは物理削除ではなく論理削除(要件6②) —
                  company_idに紐づくデータには一切触れず、30日間はゴミ箱から復元できる。 */}
              {companyEditId && (
                <button className="text-button danger" type="button" onClick={() => requestSoftDeleteCompany((appState.companies || []).find((c) => c.id === companyEditId))}>
                  会社データを削除
                </button>
              )}
              {/* 「会社追加」(サロンマネージャー内に新規会社を作成)とは明確に別の操作 —
                  「加盟店追加」は既に利用中の別会社へ閲覧専用の連携リクエストを送るだけで、
                  新しい会社レコードは一切作らない(要件1)。system_admin限定。本部側は現在
                  会社切替セレクタで選択中の会社(appState.currentCompanyId)になる。 */}
              {canCreateFranchiseRequest(currentRole) ? (
                <button className="secondary-button" type="button" onClick={() => { setFranchiseRequestTargetId(""); setFranchiseRequestSearch(""); setFranchiseRequestStatus({ status: "idle", message: "" }); setShowFranchiseRequestModal(true); }}>
                  加盟店追加
                </button>
              ) : null}
            </div>
            {(appState.companies || []).filter((company) => !company.deletedAt).filter((company) => normalizeRole(currentRole) === "system_admin" || company.id === currentCompany?.id).length ? (
              <div className="card-grid">
                {(appState.companies || []).filter((company) => !company.deletedAt).filter((company) => normalizeRole(currentRole) === "system_admin" || company.id === currentCompany?.id).map((company) => {
                  const companyUsers = (appState.users || []).filter((user) => user.companyId === company.id);
                  return (
                    <div key={company.id} className="info-card">
                      <div className="info-card-head">
                        <div>
                          <strong>{company.name}</strong>
                          <small>{company.code}</small>
                        </div>
                        {/* 会社カードのメイン状態表示は契約状態のみ(要件: 「有効」のような
                            利用状態と契約状態を重複表示しない)。停止中は一目で利用不可と
                            分かるよう赤系(error)にする。 */}
                        <span className={`status-pill ${{ free: "saving", trial: "warning", active: "saved", suspended: "error" }[company.contractStatus || "trial"]}`}>
                          契約：{CONTRACT_STATUS_LABELS[company.contractStatus || "trial"]}
                        </span>
                      </div>
                      <div className="info-card-meta">
                        <span>業種 {getBusinessTypeLabel(company.businessType || "salon")}</span>
                        <span>店舗数 {company.stores?.length || 0}</span>
                        <span>ユーザー数 {companyUsers.length}</span>
                        {/* 無料利用理由(要件2) — 無料利用中の会社にのみ表示。今後無料利用の
                            会社が増えても、なぜ無料なのかここで確認できる。 */}
                        {company.contractStatus === "free" && (
                          <span>理由 {company.freeReason ? FREE_REASON_LABELS[company.freeReason] || company.freeReason : "未設定"}</span>
                        )}
                        {canManageCompanies(currentRole) && (
                          <span className={`status-pill ${aiAnalysisSettings[company.id] ? "saved" : "warning"}`}>AI分析 {aiAnalysisSettings[company.id] ? "ON" : "OFF"}</span>
                        )}
                      </div>
                      {canManageCompanies(currentRole) && company.contractStatus === "free" && (
                        <div className="row-actions">
                          <select
                            className="text-button"
                            value=""
                            disabled={freeReasonSavingId === company.id}
                            onChange={(event) => {
                              const reason = event.target.value;
                              if (reason) handleUpdateCompanyFreeReason(company, reason);
                            }}
                          >
                            <option value="">無料利用理由を変更...</option>
                            {Object.entries(FREE_REASON_LABELS).map(([key, label]) => (
                              <option key={key} value={key}>{label}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="row-actions">
                        <button className="text-button" type="button" onClick={() => handleEditCompany(company)}>編集</button>
                        <button className="text-button" type="button" onClick={() => handleCompanySwitch(company.id)}>切替</button>
                        {/* 許可されている遷移先だけを選択肢にする(無料利用/トライアル/契約中/
                            停止中の組み合わせはCONTRACT_STATUS_ALLOWED_NEXT参照) —
                            company_id・店舗・ユーザー・売上等の既存データには一切触れない、
                            契約状態の列を1つ更新するだけ。valueは常に空へ戻すことで、選択の
                            たびに毎回このメニューから選び直す「実行専用メニュー」として扱う。 */}
                        {canManageCompanies(currentRole) && (
                          <select
                            className="text-button"
                            value=""
                            disabled={companyStatusSavingId === company.id}
                            onChange={(event) => {
                              const targetStatus = event.target.value;
                              if (targetStatus) handleCompanyContractAction(company, targetStatus);
                            }}
                          >
                            <option value="">契約状態を変更...</option>
                            {(CONTRACT_STATUS_ALLOWED_NEXT[company.contractStatus || "trial"] || []).map((status) => (
                              <option key={status} value={status}>{CONTRACT_STATUS_LABELS[status]}へ変更</option>
                            ))}
                          </select>
                        )}
                        {/* AI分析の契約ON/OFFはsystem_admin限定(要件) — company_adminには
                            ボタン自体を出さない(UIを隠すだけでなくRLS/Edge Function側でも
                            強制しているのは上のhandleToggleCompanyAiAnalysis参照)。 */}
                        {canManageCompanies(currentRole) && (
                          <button className="text-button" type="button" onClick={() => handleToggleCompanyAiAnalysis(company)}>
                            AI分析を{aiAnalysisSettings[company.id] ? "無効化" : "有効化"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="management-empty">まだ会社が登録されていません。上のフォームから最初の会社を追加してください。</div>
            )}
            {/* ゴミ箱(削除済み会社、要件6②): 通常の会社一覧には一切表示せず、system_admin が
                明示的に開いた時だけ表示する。ここからのみ「復元」「完全削除」ができる。 */}
            {canManageCompanies(currentRole) && (
              <>
                <div className="row-actions" style={{ marginTop: 16 }}>
                  <button className="text-button" type="button" onClick={() => setShowDeletedCompanies((prev) => !prev)}>
                    {showDeletedCompanies ? "ゴミ箱を閉じる" : `ゴミ箱を表示(${(appState.companies || []).filter((c) => c.deletedAt).length})`}
                  </button>
                </div>
                {showDeletedCompanies && (
                  <div className="card-grid">
                    {(appState.companies || []).filter((company) => company.deletedAt).map((company) => (
                      <div key={company.id} className="info-card">
                        <div className="info-card-head">
                          <div>
                            <strong>{company.name}</strong>
                            <small>{company.code}</small>
                          </div>
                          <span className="status-pill error">削除済み</span>
                        </div>
                        <div className="info-card-meta">
                          <span>削除日 {company.deletedAt ? new Date(company.deletedAt).toLocaleDateString("ja-JP") : "-"}</span>
                          <span>完全削除可能日 {company.deletionScheduledAt ? new Date(company.deletionScheduledAt).toLocaleDateString("ja-JP") : "-"}</span>
                        </div>
                        <div className="row-actions">
                          <button className="text-button" type="button" disabled={companyRestoreSavingId === company.id} onClick={() => handleRestoreCompany(company)}>
                            {companyRestoreSavingId === company.id ? "復元中…" : "復元"}
                          </button>
                          <button className="text-button danger" type="button" onClick={() => requestHardDeleteCompany(company)}>
                            完全削除
                          </button>
                        </div>
                      </div>
                    ))}
                    {!(appState.companies || []).some((company) => company.deletedAt) && (
                      <div className="management-empty">削除済みの会社はありません。</div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {activePage === "stores" && (
          <StoreManagementPage
            currentRole={currentRole}
            franchiseReadOnly={isFranchiseReadOnlyForCurrentUser()}
            newStoreName={newStoreName}
            setNewStoreName={setNewStoreName}
            newStoreFormStatus={newStoreFormStatus}
            handleCreateNewStore={handleCreateNewStore}
            selectedStoreEntity={selectedStoreEntity}
            onManageStore={openStoreManagement}
            showArchivedStores={showArchivedStores}
            setShowArchivedStores={setShowArchivedStores}
            stores={filteredStores}
            handleStoreLifecycleAction={handleStoreLifecycleAction}
            handleDuplicateStore={handleDuplicateStore}
            requestHardDeleteStore={requestHardDeleteStore}
          />
        )}

        {activePage === "users" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">USER</p>
                <h2>ユーザー管理</h2>
              </div>
            </div>
            <p className="management-help">店舗ごと・権限ごとにユーザーを確認できます。招待後は7日間有効で、期限切れ時は再送できます。</p>
            {isFranchiseReadOnlyForCurrentUser() ? (
              <div className="empty-card">加盟店のスタッフ情報は表示されません（別会社として独立して管理されています）。</div>
            ) : !canViewUserManagement(currentRole) ? (
              <div className="empty-card">この権限ではユーザー管理を操作できません。</div>
            ) : (
              <>
                <div className="setup-card">
                  <div className="panel-heading compact">
                    <div>
                      <p className="eyebrow">INVITE</p>
                      <h3>新しいユーザーを招待</h3>
                    </div>
                  </div>
                  <div className="inline-form">
                    <input value={userForm.name} onChange={(event) => setUserForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="氏名" />
                    <input value={userForm.email} onChange={(event) => setUserForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="メールアドレス" />
                    <select value={invitableRoles.includes(userForm.role) ? userForm.role : (invitableRoles[invitableRoles.length - 1] || "")} onChange={(event) => setUserForm((prev) => ({ ...prev, role: event.target.value }))}>
                      {invitableRoles.map((roleOption) => <option key={roleOption} value={roleOption}>{getRoleLabel(roleOption)}</option>)}
                    </select>
                    <button className="primary-button" type="button" onClick={handleSaveUser} disabled={userFormBusy}>{userFormBusy ? "送信中…" : "招待する"}</button>
                  </div>
                  <div className="inline-form">
                    <label className="field">
                      <span>主要所属店舗</span>
                      <select value={userForm.primaryStoreId || ""} onChange={(event) => setUserForm((prev) => ({ ...prev, primaryStoreId: event.target.value, storeIds: event.target.value ? [event.target.value] : prev.storeIds }))}>
                        <option value="">未設定</option>
                        {inviteScopedStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="input-grid">
                    {inviteScopedStores.map((store) => (
                      <label key={store.id} className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <input type="checkbox" checked={userForm.storeIds.includes(store.id)} onChange={() => toggleUserStoreSelection(store.id)} />
                        <span>{store.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="filters" style={{ marginTop: 16 }}>
                  <label>
                    <span>店舗で絞り込み</span>
                    <select value={userFilterStoreId} onChange={(event) => setUserFilterStoreId(event.target.value)}>
                      <option value="">すべての店舗</option>
                      {currentCompanyStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                      <option value="__none__">所属店舗なし</option>
                    </select>
                  </label>
                  <label>
                    <span>権限で絞り込み</span>
                    <select value={userFilterRole} onChange={(event) => setUserFilterRole(event.target.value)}>
                      <option value="">すべての権限</option>
                      {ROLE_GROUP_ORDER.map((role) => <option key={role} value={role}>{getRoleLabel(role)}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>名前・メールで検索</span>
                    <input value={userSearchQuery} onChange={(event) => setUserSearchQuery(event.target.value)} placeholder="検索..." />
                  </label>
                </div>

                {groupedManageableUsers.length ? (
                  <div className="user-store-groups">
                    {groupedManageableUsers.map((group) => {
                      const isCollapsed = collapsedUserStoreGroups.has(group.key);
                      const totalInGroup = group.roleGroups.reduce((sum, roleGroup) => sum + roleGroup.users.length, 0);
                      return (
                        <div key={group.key} className="user-store-group">
                          <button type="button" className="user-store-group-header" onClick={() => toggleUserStoreGroupCollapsed(group.key)}>
                            <span className={`chevron ${isCollapsed ? "collapsed" : ""}`}>▾</span>
                            <strong>{group.storeName}</strong>
                            <span className="user-store-group-count">{totalInGroup}名</span>
                          </button>
                          {!isCollapsed && (
                            <div className="user-role-groups">
                              {group.roleGroups.map((roleGroup) => (
                                <div key={roleGroup.role} className="user-role-group">
                                  <p className="user-role-group-title">{getRoleLabel(roleGroup.role)}</p>
                                  <div className="user-staff-list">
                                    {roleGroup.users.map((user) => {
                                      const statusMeta = getUserStatusMeta(user);
                                      const isRegistered = Boolean(user.authUserId);
                                      const isSelf = user.id === currentUser?.profileId;
                                      const rowPermissions = getUserRowPermissions(currentRole, user);
                                      return (
                                        <div key={user.id} className="user-staff-row">
                                          <div className="user-staff-row-main">
                                            <div className="user-staff-row-identity">
                                              <strong>{user.name}</strong>
                                              <small>{user.email}</small>
                                            </div>
                                            <span className={`status-pill ${statusMeta.tone === "success" ? "saved" : statusMeta.tone === "danger" ? "error" : statusMeta.tone === "warning" ? "warning" : "saving"}`}>{statusMeta.label}</span>
                                          </div>
                                          <div className="user-staff-row-meta">
                                            {statusMeta.expiresAt ? <span>招待期限 {statusMeta.expiresAt.toLocaleDateString("ja-JP")}</span> : null}
                                            {isRegistered && user.lastLoginAt ? <span>最終ログイン {new Date(user.lastLoginAt).toLocaleDateString("ja-JP")}</span> : null}
                                          </div>
                                          {statusMeta.key === "invite_send_failed" ? (
                                            <p className="dashboard-hint">招待情報は作成されましたが、メール送信に失敗しました。再送信または招待URLをコピーしてください。</p>
                                          ) : null}
                                          <div className="row-actions">
                                            {rowPermissions.canEdit && (
                                              <button className="text-button" type="button" onClick={() => handleEditUser(user)}>編集</button>
                                            )}
                                            {rowPermissions.canEdit && !isSelf && (
                                              <button className="text-button" type="button" onClick={() => handleToggleUserStatus(user)} disabled={togglingStatusUserId === user.id}>
                                                {togglingStatusUserId === user.id ? "処理中…" : (user.isActive ? "停止" : "再開")}
                                              </button>
                                            )}
                                            {!isRegistered && (
                                              <>
                                                <button className="text-button" type="button" onClick={() => handleInviteEmail(user)} disabled={resendingUserId === user.id}>
                                                  {resendingUserId === user.id ? "送信中…" : "招待メールを再送"}
                                                </button>
                                                <button className="text-button" type="button" onClick={() => handleCopyInviteLink(user)} disabled={copyingInviteLinkUserId === user.id}>
                                                  {copyingInviteLinkUserId === user.id ? "生成中…" : "招待リンクをコピー"}
                                                </button>
                                              </>
                                            )}
                                            {!isSelf && rowPermissions.canDelete && (
                                              <button className="text-button danger" type="button" onClick={() => requestDeleteUser(user)}>{isRegistered ? "削除" : "招待取消"}</button>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="management-empty">条件に一致するユーザーがいません。</div>
                )}
              </>
            )}
          </section>
        )}

        {editUserTargetId && (
          <div className="modal-overlay" onClick={closeEditUserModal}>
            <div className="modal-card" onClick={(event) => event.stopPropagation()}>
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">EDIT USER</p>
                  <h3>ユーザー情報を編集</h3>
                </div>
              </div>
              {editUserError ? <div className="notice-box">{editUserError}</div> : null}
              <label className="field">
                <span>氏名</span>
                <input value={editUserDraft.name} onChange={(event) => setEditUserDraft((prev) => ({ ...prev, name: event.target.value }))} placeholder="氏名" />
              </label>
              <label className="field">
                <span>メールアドレス</span>
                <input value={editUserDraft.email} onChange={(event) => setEditUserDraft((prev) => ({ ...prev, email: event.target.value }))} placeholder="メールアドレス" />
              </label>
              <label className="field">
                <span>権限</span>
                <select
                  value={invitableRoles.includes(editUserDraft.role) ? editUserDraft.role : editUserDraft.role}
                  onChange={(event) => setEditUserDraft((prev) => ({ ...prev, role: event.target.value }))}
                  disabled={!invitableRoles.includes(editUserDraft.role) && !invitableRoles.includes((appState.users || []).find((user) => user.id === editUserTargetId)?.role)}
                >
                  {(invitableRoles.includes(editUserDraft.role) ? invitableRoles : [editUserDraft.role, ...invitableRoles]).map((roleOption) => (
                    <option key={roleOption} value={roleOption}>{getRoleLabel(roleOption)}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>主要所属店舗</span>
                <select value={editUserDraft.primaryStoreId} onChange={(event) => setEditUserDraft((prev) => ({ ...prev, primaryStoreId: event.target.value, storeIds: event.target.value && !prev.storeIds.includes(event.target.value) ? [...prev.storeIds, event.target.value] : prev.storeIds }))}>
                  <option value="">未設定</option>
                  {inviteScopedStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </label>
              <div className="setup-card">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">STORE ACCESS</p>
                    <h3>所属店舗</h3>
                  </div>
                </div>
                <div className="input-grid">
                  {inviteScopedStores.map((store) => (
                    <label key={store.id} className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" checked={editUserDraft.storeIds.includes(store.id)} onChange={() => toggleEditUserStoreSelection(store.id)} />
                      <span>{store.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>有効/停止</span>
                <select value={editUserDraft.isActive ? "active" : "suspended"} onChange={(event) => setEditUserDraft((prev) => ({ ...prev, isActive: event.target.value === "active" }))}>
                  <option value="active">有効</option>
                  <option value="suspended">停止</option>
                </select>
              </label>
              <div className="row-actions" style={{ marginTop: 12 }}>
                <button className="secondary-button" type="button" onClick={closeEditUserModal} disabled={editUserSaving}>キャンセル</button>
                <button className="primary-button" type="button" onClick={handleSaveUserEdit} disabled={editUserSaving}>{editUserSaving ? "保存中..." : "保存する"}</button>
              </div>
            </div>
          </div>
        )}

        {deleteUserTargetId && (() => {
          const deleteTarget = (appState.users || []).find((user) => user.id === deleteUserTargetId);
          if (!deleteTarget) return null;
          const isPendingInvite = !deleteTarget.authUserId;
          return (
            <div className="modal-overlay" onClick={closeDeleteUserModal}>
              <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">{isPendingInvite ? "CANCEL INVITE" : "DELETE USER"}</p>
                    <h3>{isPendingInvite ? "この招待を取り消しますか？" : "このユーザーを削除しますか？"}</h3>
                  </div>
                </div>
                {deleteUserError ? <div className="notice-box">{deleteUserError}</div> : null}
                <p>
                  <strong>{deleteTarget.name}</strong>（{deleteTarget.email}）{isPendingInvite ? "への招待を取り消します。" : "を削除します。"}
                </p>
                <p className="helper-text">
                  {isPendingInvite
                    ? "このメールアドレスはまだ登録が完了していないため、招待情報を削除するだけです。あとから同じメールアドレスで再度招待できます。"
                    : "Supabaseの認証アカウント・ユーザー情報・所属店舗・招待情報が削除されます。このユーザーが過去に入力した売上・費用・月締め等の業務データは削除されず、履歴として保持されます。この操作は取り消せません。"}
                </p>
                <div className="row-actions" style={{ marginTop: 12 }}>
                  <button className="secondary-button" type="button" onClick={closeDeleteUserModal} disabled={deleteUserSaving}>キャンセル</button>
                  <button className="primary-button danger-button" type="button" onClick={handleConfirmDeleteUser} disabled={deleteUserSaving}>
                    {deleteUserSaving ? (isPendingInvite ? "取消中..." : "削除中...") : (isPendingInvite ? "招待を取り消す" : "削除する")}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {hardDeleteTargetId && (() => {
          const hardDeleteTarget = (currentCompany?.stores || []).find((store) => store.id === hardDeleteTargetId);
          if (!hardDeleteTarget) return null;
          const confirmMatches = hardDeleteConfirmText === hardDeleteTarget.name;
          return (
            <div className="modal-overlay" onClick={closeHardDeleteModal}>
              <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">DELETE STORE PERMANENTLY</p>
                    <h3>店舗を完全に削除しますか？</h3>
                  </div>
                </div>
                {hardDeleteError ? <div className="notice-box">{hardDeleteError}</div> : null}
                <p className="notice-box warning">
                  <strong>{hardDeleteTarget.name}</strong> および関連データが完全に削除され、元に戻せません。
                </p>
                <p className="helper-text">
                  日次売上・月間目標・費用・月締め・在庫・スタッフ所属等のデータが1件でも存在する場合は削除できません(停止またはアーカイブをご利用ください)。続行するには、店舗名「{hardDeleteTarget.name}」を正確に入力してください。
                </p>
                <label className="field">
                  <span>店舗名を入力</span>
                  <input value={hardDeleteConfirmText} onChange={(event) => setHardDeleteConfirmText(event.target.value)} placeholder={hardDeleteTarget.name} disabled={hardDeleteSaving} />
                </label>
                <div className="row-actions" style={{ marginTop: 12 }}>
                  <button className="secondary-button" type="button" onClick={closeHardDeleteModal} disabled={hardDeleteSaving}>キャンセル</button>
                  <button className="primary-button danger-button" type="button" onClick={handleConfirmHardDeleteStore} disabled={!confirmMatches || hardDeleteSaving}>
                    {hardDeleteSaving ? "削除中..." : "完全に削除する"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 会社の論理削除(3段階の2段目、要件7) — company_idに紐づくデータには一切触れず、
            会社名の完全一致を入力するまで削除ボタンは無効のまま。30日間はゴミ箱から復元できる
            旨を明記する。 */}
        {companySoftDeleteTargetId && (() => {
          const softDeleteTarget = (appState.companies || []).find((company) => company.id === companySoftDeleteTargetId);
          if (!softDeleteTarget) return null;
          const softConfirmMatches = companySoftDeleteConfirmText === softDeleteTarget.name;
          return (
            <div className="modal-overlay" onClick={closeSoftDeleteCompanyModal}>
              <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">DELETE COMPANY</p>
                    <h3>この会社を削除しますか？</h3>
                  </div>
                </div>
                {companySoftDeleteError ? <div className="notice-box">{companySoftDeleteError}</div> : null}
                <p className="notice-box warning">
                  <strong>{softDeleteTarget.name}</strong>を削除します。30日間は「ゴミ箱」から復元でき、店舗・ユーザー・売上・日次入力・月次データ・費用・設定などのデータは削除されません。復元しないまま30日が経過すると完全削除の対象になります。
                </p>
                <p className="helper-text">
                  続行するには、削除する会社名「{softDeleteTarget.name}」を正確に入力してください。
                </p>
                <label className="field">
                  <span>会社名を入力</span>
                  <input value={companySoftDeleteConfirmText} onChange={(event) => setCompanySoftDeleteConfirmText(event.target.value)} placeholder={softDeleteTarget.name} disabled={companySoftDeleteSaving} />
                </label>
                <div className="row-actions" style={{ marginTop: 12 }}>
                  <button className="secondary-button" type="button" onClick={closeSoftDeleteCompanyModal} disabled={companySoftDeleteSaving}>キャンセル</button>
                  <button className="primary-button danger-button" type="button" onClick={handleConfirmSoftDeleteCompany} disabled={!softConfirmMatches || companySoftDeleteSaving}>
                    {companySoftDeleteSaving ? "削除中..." : "削除する"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 完全削除(3段階の最終段階、要件8) — 通常削除より確認を1段厳重にする: 会社名の
            完全一致に加えて「完全削除」という固定フレーズの入力も必須。復元不可であることを
            明記する。ゴミ箱(削除済み会社)からのみ起動できる。 */}
        {companyHardDeleteTargetId && (() => {
          const companyHardDeleteTarget = (appState.companies || []).find((company) => company.id === companyHardDeleteTargetId);
          if (!companyHardDeleteTarget) return null;
          const companyConfirmMatches = companyHardDeleteConfirmText === companyHardDeleteTarget.name && companyHardDeleteConfirmPhrase === "完全削除";
          return (
            <div className="modal-overlay" onClick={closeCompanyHardDeleteModal}>
              <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">DELETE COMPANY PERMANENTLY</p>
                    <h3>会社データを完全に削除しますか？</h3>
                  </div>
                </div>
                {companyHardDeleteError ? <div className="notice-box">{companyHardDeleteError}</div> : null}
                <p className="notice-box warning">
                  この操作を行うと、<strong>{companyHardDeleteTarget.name}</strong>に紐づく店舗・ユーザー・売上・日次入力・月次データ・費用・設定などのデータが完全に削除されます。<strong>この操作は元に戻せません(復元不可)。</strong>
                </p>
                <p className="helper-text">
                  続行するには、削除対象の会社名「{companyHardDeleteTarget.name}」を正確に入力してください。
                </p>
                <label className="field">
                  <span>会社名を入力</span>
                  <input value={companyHardDeleteConfirmText} onChange={(event) => setCompanyHardDeleteConfirmText(event.target.value)} placeholder={companyHardDeleteTarget.name} disabled={companyHardDeleteSaving} />
                </label>
                <p className="helper-text">
                  さらに、「完全削除」と正確に入力してください。
                </p>
                <label className="field">
                  <span>「完全削除」と入力</span>
                  <input value={companyHardDeleteConfirmPhrase} onChange={(event) => setCompanyHardDeleteConfirmPhrase(event.target.value)} placeholder="完全削除" disabled={companyHardDeleteSaving} />
                </label>
                <div className="row-actions" style={{ marginTop: 12 }}>
                  <button className="secondary-button" type="button" onClick={closeCompanyHardDeleteModal} disabled={companyHardDeleteSaving}>キャンセル</button>
                  <button className="primary-button danger-button" type="button" onClick={handleConfirmHardDeleteCompany} disabled={!companyConfirmMatches || companyHardDeleteSaving}>
                    {companyHardDeleteSaving ? "削除中..." : "完全に削除する"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {activePage === "franchise" && canManageFranchisePartnerships(currentRole) && (
          <div className="stack">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">FRANCHISE</p>
                  <h2>受信した連携リクエスト</h2>
                </div>
              </div>
              {incomingPendingFranchiseRequests.length ? (
                <div className="card-grid">
                  {incomingPendingFranchiseRequests.map((row) => (
                    <div key={row.id} className="info-card">
                      <div className="info-card-head">
                        <div>
                          <strong>{row.parent_company?.name || "会社"}</strong>
                          <small>申請日時: {row.created_at ? new Date(row.created_at).toLocaleString("ja-JP") : "-"}</small>
                        </div>
                      </div>
                      <p className="helper-text">
                        この会社があなたの会社を加盟店として連携をリクエストしています。承認すると、この会社があなたの会社の売上・KPI等のデータを閲覧できるようになります（あなたの会社から相手のデータが見えるようにはなりません）。承認前はどのデータも一切閲覧されません。
                      </p>
                      <div className="row-actions">
                        <button className="secondary-button" type="button" disabled={franchiseActionBusyId === row.id} onClick={() => handleRespondFranchiseRelationship(row.id, "reject")}>拒否</button>
                        <button className="primary-button" type="button" disabled={franchiseActionBusyId === row.id} onClick={() => handleRespondFranchiseRelationship(row.id, "approve")}>承認</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-card">受信したリクエストはありません</div>
              )}
            </section>

            {outgoingPendingFranchiseRequests.length ? (
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">FRANCHISE</p>
                    <h2>送信済み・承認待ち</h2>
                  </div>
                </div>
                <div className="card-grid">
                  {outgoingPendingFranchiseRequests.map((row) => (
                    <div key={row.id} className="info-card">
                      <div className="info-card-head">
                        <div>
                          <strong>{row.partner_company?.name || "会社"}</strong>
                          <small>申請日時: {row.created_at ? new Date(row.created_at).toLocaleString("ja-JP") : "-"}</small>
                        </div>
                      </div>
                      <p className="helper-text">相手会社の承認待ちです。承認されるまでこちらからはデータを閲覧できません。</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">FRANCHISE</p>
                  <h2>連携中の加盟店</h2>
                </div>
                {canCreateFranchiseRequest(currentRole) ? (
                  <button className="secondary-button" type="button" onClick={() => { setFranchiseRequestTargetId(""); setFranchiseRequestSearch(""); setFranchiseRequestStatus({ status: "idle", message: "" }); setShowFranchiseRequestModal(true); }}>
                    加盟店を追加
                  </button>
                ) : null}
              </div>
              {approvedFranchisePartnerships.length ? (
                <div className="card-grid">
                  {approvedFranchisePartnerships.map((row) => {
                    const partner = (appState.companies || []).find((c) => c.id === row.partner_company_id);
                    const canDisconnect = normalizeRole(currentRole) === "system_admin" || row.parent_company_id === myCompanyId;
                    return (
                      <div key={row.id} className="info-card">
                        <div className="info-card-head">
                          <div>
                            <strong>{row.partner_company?.name || partner?.name || "会社"}</strong>
                            <small>加盟日: {row.joined_at || "-"}</small>
                          </div>
                        </div>
                        <div className="row-actions">
                          <button className="secondary-button" type="button" disabled={franchiseViewBusy} onClick={() => handleFranchiseView(row.partner_company_id)}>表示する</button>
                          {canDisconnect ? (
                            <button
                              className="text-button danger"
                              type="button"
                              disabled={franchiseActionBusyId === row.id}
                              onClick={() => {
                                if (window.confirm("この加盟店連携を解除しますか？解除後は本部からこの会社のデータを閲覧できなくなります（加盟店側のデータは一切削除されません、後から再申請もできます）。")) {
                                  void handleRespondFranchiseRelationship(row.id, "disconnect");
                                }
                              }}
                            >
                              連携を解除
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-card">連携中の加盟店はありません</div>
              )}
            </section>
          </div>
        )}

        {showFranchiseRequestModal ? (
          <div className="modal-overlay" onClick={() => setShowFranchiseRequestModal(false)}>
            <div className="modal-card" onClick={(event) => event.stopPropagation()}>
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">FRANCHISE REQUEST</p>
                  <h3>加盟店追加</h3>
                </div>
              </div>
              <p className="helper-text">
                本部「{(appState.companies || []).find((c) => c.id === appState.currentCompanyId)?.name || ""}」として、既にサロンマネージャーを利用中の別会社へ加盟店連携リクエストを送信します。新しい会社は作成されません。
              </p>
              <label className="field">
                <span>会社名・会社コードで検索</span>
                <input
                  value={franchiseRequestSearch}
                  onChange={(event) => { setFranchiseRequestSearch(event.target.value); setFranchiseRequestTargetId(""); }}
                  placeholder="会社名または会社コードを入力"
                />
              </label>
              {franchiseRequestSearch.trim() && !franchiseRequestTargetId ? (
                <div className="card-grid" style={{ maxHeight: 220, overflowY: "auto" }}>
                  {franchiseCandidateCompanies.length ? franchiseCandidateCompanies.map((company) => (
                    <button key={company.id} type="button" className="list-row" onClick={() => setFranchiseRequestTargetId(company.id)}>
                      <strong>{company.name}</strong> <small>{company.code}</small>
                    </button>
                  )) : <div className="empty-card">該当する会社が見つかりません</div>}
                </div>
              ) : null}
              {franchiseRequestTargetId ? (
                <div className="notice-box">
                  「{(appState.companies || []).find((c) => c.id === franchiseRequestTargetId)?.name || ""}」へ加盟店連携リクエストを送信しますか？
                </div>
              ) : null}
              {franchiseRequestStatus.message ? <div className={`notice-box ${franchiseRequestStatus.status === "error" ? "error" : ""}`}>{franchiseRequestStatus.message}</div> : null}
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={() => setShowFranchiseRequestModal(false)}>キャンセル</button>
                <button className="primary-button" type="button" disabled={!franchiseRequestTargetId || franchiseRequestStatus.status === "saving"} onClick={handleSubmitFranchiseRequest}>
                  {franchiseRequestStatus.status === "saving" ? "送信中…" : "リクエストを送信"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {franchiseDetailRelationshipId ? (() => {
          const row = companyPartnerships.find((item) => item.id === franchiseDetailRelationshipId);
          if (!row) return null;
          return (
            <div className="modal-overlay" onClick={() => setFranchiseDetailRelationshipId("")}>
              <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">FRANCHISE REQUEST</p>
                    <h3>加盟店連携リクエスト</h3>
                  </div>
                </div>
                <p><strong>申請元会社:</strong> {row.parent_company?.name || "会社"}</p>
                <p><strong>申請日時:</strong> {row.created_at ? new Date(row.created_at).toLocaleString("ja-JP") : "-"}</p>
                <p className="helper-text">
                  承認すると、この会社があなたの会社の売上・日次データ・月間目標・損益・費用等を閲覧できるようになります（本部側の全店舗集計・売上・損益には一切合算されません）。あなたの会社から相手のデータが見えるようにはなりません。拒否した場合、連携は成立しません。
                </p>
                <div className="button-row">
                  <button className="secondary-button" type="button" disabled={franchiseActionBusyId === row.id} onClick={() => handleRespondFranchiseRelationship(row.id, "reject")}>拒否</button>
                  <button className="primary-button" type="button" disabled={franchiseActionBusyId === row.id} onClick={() => handleRespondFranchiseRelationship(row.id, "approve")}>承認</button>
                </div>
              </div>
            </div>
          );
        })() : null}

        {activePage === "monthlyReview" && (
          <MonthlyReviewPage
            summary={monthlyReviewSummary}
            text={monthlyReviewText}
            monthValue={selectedMonth}
            isAllStoresView={isAllStoresView}
            storeName={isAllStoresView ? "全店舗" : (selectedStoreEntity?.name || selectedStore)}
            canEdit={canEditMonthlyReview}
            saveStatus={monthlyReviewSaveStatus}
            onSaveFields={saveMonthlyReviewFields}
            onFlushFields={flushMonthlyReviewSave}
            // storeName(表示名)ではなくid基準のキー——同名店舗が別会社(加盟店等)に存在
            // しても下書きのリセット判定が正しく別物として扱われるようにする。
            reviewContextKey={`${appState.currentCompanyId}::${isAllStoresView ? "all" : selectedStoreId}::${selectedMonth}`}
          />
        )}
        {activePage === "faq" && (
          <FaqPage
            companyId={appState.currentCompanyId}
            storeId={selectedStoreId}
            userId={appState.currentUserId}
          />
        )}
        {/* AI広告自動運用システム(V1)。system_admin専用の完全に独立したモジュール
            (要件2・23)——company_id/store_idに紐づかない社内マーケティングデータのみを扱う。
            canManageAdOps(currentRole)はNAV_ITEMS_BY_ROLEによる遷移不可に加えた二重の防御
            (URLを直接いじって別ページからactivePageだけ変更されても表示しない)。 */}
        {activePage === "adOps" && canManageAdOps(currentRole) && (
          <AdOpsPage userId={appState.currentUserId} />
        )}
      </main>
      {/* AI分析はaiAnalysisSettings(companies.ai_analysis_enabledの独立した取得結果)が
          trueの会社のみ表示する(要件: OFFの会社ではAI分析ボタン・AIコメント等を一切表示
          しない)。実際の利用停止はai-assistant Edge Function側のcompany_id判定が担保して
          おり、これはあくまでUI上の入口を隠すだけ — フローティングボタン自体を出さなければ
          チャット画面(AiChatScreen)を開く経路がそもそも無くなる。 */}
      {currentCompany && aiAnalysisSettings[currentCompany.id] && (
        <>
          {/* 日次入力UI改善(要件9): スマホ固定アクションバー(daily-fixed-action-bar)が
              出ている間は、AIボタンがそれに被らないよう追加でクラスを渡す
              (ai-floating-button-raised、App.cssの≤900pxブロックでbottomをさらに上げる)。
              他ページ・PC・バー非表示時はclassNameが空文字のまま(見た目は無変更)。 */}
          <AiFloatingButton onClick={() => openAiChat()} className={showDailyFixedActionBar ? "ai-floating-button-raised" : ""} />
          {aiChatOpen ? (
            <AiChatScreen
              role={currentRole}
              storeName={selectedStoreEntity?.name || selectedStore}
              storeId={selectedStoreId}
              monthValue={selectedMonth}
              isAllStoresView={isAllStoresView}
              summary={summary}
              target={target}
              businessDaySummary={businessDaySummary}
              initialQuestion={aiChatInitialQuestion}
              onClose={closeAiChat}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

// 上部の「営業進捗」に既に大きな進捗バーがあるため、KPIカード内には進捗バーを持たない
// (項目名→メイン数値→補足情報のシンプルな構成に統一)。
// 売上画面UI/UX改善(要件1・2・9・20): KPIの重要度に強弱をつけるための追加プロパティ。
// primary: 月間達成率・月末着地予測・1日平均必要売上の3項目だけに使う、少し強めた表示
// (文字サイズ・太さ)。secondary: それ以外のKPI(客数達成率・口コミ数・平均客単価等)を
// 少し弱めた表示にする。statusLabel: 色だけに意味を持たせない(要件20)ための短い状態文言
// (順調/やや遅れ/要注意)——toneが同じ情報を色でも表すが、色覚特性等に依存しないよう文言も
// 併記する。色の使い方自体は既存のtone(good/warning/danger)の仕組みをそのまま使い、新しい
// 判定ロジックは追加しない(呼び出し元がforecastStatusTone等、既存計算値から渡すだけ)。
function MetricCard({ label, value, secondaryValue = "", hint = "", tone = "", statusLabel = "", emphasize = false, hero = false, primary = false, secondary = false, className = "", onClick = null }) {
  return (
    <div
      className={`metric-card ${tone} ${emphasize ? "emphasize" : ""} ${hero ? "hero" : ""} ${primary ? "metric-card-primary" : ""} ${secondary ? "metric-card-secondary" : ""} ${className} ${onClick ? "clickable" : ""}`}
      onClick={onClick || undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); } } : undefined}
    >
      <div className="metric-card-heading">
        <span>{label}</span>
        {statusLabel ? <span className={`metric-status-label ${tone}`}>{statusLabel}</span> : null}
      </div>
      <strong>{value}</strong>
      {secondaryValue ? <strong className="metric-card-secondary-value">{secondaryValue}</strong> : null}
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

// 月間目標を1つも登録していない店舗向けの案内。目標系カードごとに「未登録」を繰り返し表示
// せず、この1枚だけをkpi-hero-gridの先頭に出す。警告・エラーではなく中立トーン(.setup-card)
// にし、目標を1つでも登録すればhasAnyTargetがtrueになり自動的に消える(表示ON/OFFの設定は
// 持たない)。
// 初回利用時の設定チェックリスト(要件9)。項目をクリックすると管理画面の該当タブ(または
// 営業日設定のカレンダー編集UI)へ直接移動する——タスク管理・期限管理までは今回作らない。
// 必須項目(固定費設定を除く4項目)がすべて完了すると(呼び出し元のshowSetupChecklistが
// falseになり)このカード自体が描画されなくなるため、設定完了後にずっと居座って邪魔になる
// ことは無い。固定費設定は任意項目として区別し、完了状況の分母(X/Y)には含めない。
function SetupChecklistCard({ items, onNavigate, onDismiss }) {
  const requiredItems = items.filter((item) => !item.optional);
  const doneCount = requiredItems.filter((item) => item.done).length;
  return (
    <div className="setup-card setup-checklist-card">
      <div className="setup-checklist-card-heading">
        <div>
          <p className="eyebrow">GETTING STARTED</p>
          <strong>初期設定 {doneCount}/{requiredItems.length} 完了</strong>
        </div>
        <button type="button" className="setup-checklist-close" onClick={onDismiss} aria-label="閉じる">×</button>
      </div>
      <p className="helper-text">まずはこの店舗の基本設定を進めましょう。完了した項目には自動でチェックが付きます。</p>
      <div className="setup-checklist-list">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`setup-checklist-item ${item.done ? "done" : item.optional ? "optional" : "pending"}`}
            onClick={() => onNavigate(item)}
          >
            <span className="setup-checklist-item-top">
              <span className="setup-checklist-item-label">{item.done ? "✓" : "○"} {item.label}</span>
              <span className="setup-checklist-item-status">{item.done ? "設定済み" : item.optional ? "任意" : "未設定"}</span>
            </span>
            <span className="setup-checklist-item-desc">{item.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TargetSetupHint({ onGoToTarget }) {
  return (
    <div className="setup-card target-setup-hint">
      <p className="helper-text">月間目標を設定すると、達成率・目標までの残額・1日あたり必要売上が表示されます。</p>
      <button type="button" className="secondary-button" onClick={onGoToTarget}>目標を設定する</button>
    </div>
  );
}

// 人件費・仕入(材料・発注費)の「月途中は売上連動で自動推定、実額確定後は手動で上書き」
// 設定パネル。costType("labor"|"purchase")ごとに費用入力タブへ2枚並べる(人件費・仕入)。
// 表示順序は「1.固定額/売上連動 2.率設定(または月額) 3.自動計算額 4.計算根拠 5.実額修正」
// (初めて使う人にも流れが伝わるようにする要件)。
// モード切替は即保存(useInventoryTrackingトグルと同じ規約、離散的な選択のため)。率・月額・
// 確定額(override)はどれも金額/数値入力なので、期首在庫・当月末在庫と同じdraft+明示保存
// ボタンの形にする(1文字入力するたびにSupabaseへ書き込まないため)。呼び出し元がstoreId・
// 対象月を含むkeyを渡しており、店舗/対象月の切替では別インスタンスとして再マウントされる
// ため、draftをuseEffectで同期する必要が無い(react-hooks/set-state-in-effectの警告対象に
// なる書き方を避ける、Reactの推奨パターン)。
// 保存の成否をbusyAction/savedFlashで管理し、ボタン付近に小さく「保存しました」を一時表示
// する(大きな通知バナーは使わない)。busyActionが立っている間は全ボタンをdisabledにして
// 連打による二重保存を防ぐ。
function CostRateEstimationPanel({
  costType, title, rateLabel, sales, autoEstimate, summaryAmount, summarySource,
  mode, rate, fixedAmount, hasMultipleFixedItems, fixedItemsCount, fixedItemsTotal,
  canEdit, onSaveSettings, onSaveOverride, onSaveFixedAmount,
}) {
  const [rateDraft, setRateDraft] = useState(rate || "");
  const [fixedAmountDraft, setFixedAmountDraft] = useState(fixedAmount || "");
  const [overrideDraft, setOverrideDraft] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [savedFlash, setSavedFlash] = useState("");
  const flashTimerRef = useRef(null);
  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  const runAction = async (actionKey, fn) => {
    if (busyAction) return; // 連打による二重保存防止
    setBusyAction(actionKey);
    try {
      const ok = await fn();
      if (ok !== false) {
        setSavedFlash(actionKey);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setSavedFlash(""), 2000);
      }
    } finally {
      setBusyAction("");
    }
  };

  const isSalesLinked = mode === "sales_linked";
  const isBusy = Boolean(busyAction);
  const savedNote = (actionKey) => (savedFlash === actionKey ? <span className="cost-save-flash">保存しました</span> : null);

  return (
    <div className="setup-card cost-rate-estimation-panel">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">{costType === "labor" ? "LABOR" : "PURCHASE"}</p>
          <h3>{title}</h3>
        </div>
      </div>

      {/* 1. 固定額/売上連動の切替 */}
      <div className="segmented-control" role="group" aria-label={`${title}の計算方法`}>
        <button
          type="button"
          className={!isSalesLinked ? "segmented-button active" : "segmented-button"}
          disabled={!canEdit || isBusy}
          onClick={() => runAction("mode", () => onSaveSettings(costType, "fixed", rate))}
        >
          固定額
        </button>
        <button
          type="button"
          className={isSalesLinked ? "segmented-button active" : "segmented-button"}
          disabled={!canEdit || isBusy}
          onClick={() => runAction("mode", () => onSaveSettings(costType, "sales_linked", rate))}
        >
          売上連動
        </button>
      </div>

      {!isSalesLinked ? (
        // 固定額モード: 率・自動計算額・計算根拠は出さず、シンプルに月額だけを表示する。
        hasMultipleFixedItems ? (
          <p className="helper-text cost-rate-multi-item-note">
            費用入力欄に{fixedItemsCount}件登録されています（合計 {money(fixedItemsTotal || 0)}）。個別に編集する場合は下の「固定費・その他費用」の費用入力欄をご利用ください。
          </p>
        ) : (
          <div className="inline-form cost-rate-inline-form">
            <label className="field">
              <span>月額</span>
              <NumericInput value={fixedAmountDraft} onChange={setFixedAmountDraft} placeholder="金額を入力" disabled={!canEdit || isBusy} />
            </label>
            {canEdit ? (
              <button type="button" className="secondary-button" disabled={isBusy} onClick={() => runAction("fixedAmount", () => onSaveFixedAmount(costType, fixedAmountDraft))}>
                月額を保存
              </button>
            ) : null}
            {savedNote("fixedAmount")}
          </div>
        )
      ) : (
        <>
          {/* 2. 率設定 */}
          <div className="inline-form cost-rate-inline-form">
            <label className="field">
              <span>{rateLabel}（%）</span>
              <NumericInput value={rateDraft} onChange={setRateDraft} allowDecimal placeholder="例: 40" disabled={!canEdit || isBusy} />
            </label>
            {canEdit ? (
              <button type="button" className="secondary-button" disabled={isBusy} onClick={() => runAction("rate", () => onSaveSettings(costType, "sales_linked", rateDraft))}>
                {rateLabel}を保存
              </button>
            ) : null}
            {savedNote("rate")}
          </div>

          {/* 3-4. 自動計算額と計算根拠(現在売上に応じてリアルタイムに変わる、常にautoEstimateを表示する) */}
          <div className="cost-auto-estimate">
            <p className="cost-auto-estimate-amount">自動計算額 {money(autoEstimate || 0)}</p>
            <p className="cost-auto-estimate-basis helper-text">現在売上 {money(sales || 0)} × {rateLabel}{Number(rate || 0).toFixed(1)}%</p>
          </div>

          {/* 5. 実額修正 */}
          <div className="cost-override-section">
            <p className="cost-override-label">実額に修正（任意）</p>
            <div className="inline-form cost-rate-inline-form">
              <label className="field">
                <span>¥ 実際の金額を入力</span>
                <NumericInput value={overrideDraft} onChange={setOverrideDraft} placeholder="例: 1920000" disabled={!canEdit || isBusy} />
              </label>
              {canEdit ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isBusy}
                  onClick={() => runAction("override", async () => {
                    const ok = await onSaveOverride(costType, Number(overrideDraft) || 0);
                    if (ok !== false) setOverrideDraft("");
                    return ok;
                  })}
                >
                  実額を反映
                </button>
              ) : null}
              {savedNote("override")}
            </div>
            <p className="helper-text cost-override-hint">給与・請求額など実際の金額が確定した場合のみ入力してください</p>
            {summarySource === "manual" ? (
              <div className="cost-override-active">
                <p className="helper-text">自動計算額：{money(autoEstimate || 0)} ／ 反映中の実額：{money(summaryAmount || 0)}</p>
                {canEdit ? (
                  <div className="inline-form cost-rate-inline-form">
                    <button type="button" className="text-button" disabled={isBusy} onClick={() => runAction("reset", () => onSaveOverride(costType, null))}>自動計算に戻す</button>
                    {savedNote("reset")}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

// 月カレンダーの共通表示: 日締め完了=緑、店休日=赤、それ以外(未締めの営業日)=通常色。
// onDayClickを渡すとクリックで日付をトグル/選択できる(店休日設定・対象日選択の両方で使う)。
function BusinessCalendarGrid({ monthValue, closedDates = [], holidayDates = [], onDayClick = null, todayIso = "" }) {
  const closedSet = new Set(closedDates);
  const holidaySet = new Set(holidayDates);
  const [yearStr, monthStr] = monthValue.split("-");
  const daysInMonth = new Date(Number(yearStr), Number(monthStr), 0).getDate();
  return (
    <div className="calendar-grid">
      {Array.from({ length: 42 }, (_, index) => {
        const day = index + 1;
        if (day > daysInMonth) return <div key={index} className="calendar-day muted" />;
        const iso = `${monthValue}-${String(day).padStart(2, "0")}`;
        const isHoliday = holidaySet.has(iso);
        const isClosed = closedSet.has(iso);
        const stateClass = isHoliday ? "holiday" : isClosed ? "closed" : "";
        const isToday = todayIso === iso;
        const className = `calendar-day ${stateClass} ${onDayClick ? "clickable" : ""} ${isToday ? "today" : ""}`.trim();
        return (
          <div
            key={index}
            className={className}
            onClick={onDayClick ? (event) => onDayClick(iso, event) : undefined}
            role={onDayClick ? "button" : undefined}
            tabIndex={onDayClick ? 0 : undefined}
            onKeyDown={onDayClick ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onDayClick(iso); } } : undefined}
            title={isHoliday ? "店休日" : isClosed ? "日締め済み" : ""}
          >
            {day}
          </div>
        );
      })}
    </div>
  );
}

const POPOVER_VIEWPORT_MARGIN = 12;
const POPOVER_TRIGGER_GAP = 8;

// 全店舗カレンダーの「未締め店舗」ポップオーバー(要件13)。MonthPicker.jsxのPC/タブレット版
// (トリガー起点+computeAnchoredPopoverPosition)と全く同じ位置計算ロジックを再利用する —
// 独立した純粋関数として既にpopoverPosition.test.jsで画面幅375px等を含め検証済みのため、
// ここで改めて手書きの位置計算をせず、実クリック確認ができない制約下でも位置ロジックの
// 正しさをコードレベルで担保できる。クリックされた日付セル(anchorEl)を起点に表示し、
// document.bodyへportalするため、カレンダーカードのoverflow/stacking contextの影響を
// 受けない(MonthPickerの教訓と同じ)。
function UnclosedStoresPopover({ dateIso, anchorEl, info, onClose }) {
  const panelRef = useRef(null);
  const [position, setPosition] = useState(null);
  const isOpen = Boolean(dateIso && anchorEl);

  useLayoutEffect(() => {
    // isOpenがfalseの間はこのコンポーネント自体がnullを返す(下のearly return参照)ため、
    // positionを明示的にリセットする必要は無い — 次に開いた時にrecomputeが必ず最新値へ
    // 上書きする(MonthPicker.jsxの同型ロジックと同じ考え方)。
    if (!isOpen) return undefined;
    const recompute = () => {
      const triggerRect = anchorEl?.getBoundingClientRect();
      const panelRect = panelRef.current?.getBoundingClientRect();
      if (!triggerRect || !panelRect) return;
      setPosition(computeAnchoredPopoverPosition({
        triggerRect,
        panelWidth: panelRect.width,
        panelHeight: panelRect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        margin: POPOVER_VIEWPORT_MARGIN,
        gap: POPOVER_TRIGGER_GAP,
      }));
    };
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [isOpen, anchorEl, dateIso]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  const unclosedNames = info?.unclosedStoreNames || [];

  return createPortal(
    <>
      <div className="unclosed-stores-popover-overlay" onClick={onClose} />
      <div
        ref={panelRef}
        className="unclosed-stores-popover"
        role="dialog"
        aria-label={`${dateIso}の未締め店舗`}
        style={{
          position: "fixed",
          left: position ? `${position.left}px` : "-9999px",
          top: position ? `${position.top}px` : "-9999px",
          maxHeight: position ? `${position.maxHeight}px` : undefined,
          visibility: position ? "visible" : "hidden",
        }}
      >
        <div className="unclosed-stores-popover-heading">
          <strong>{dateIso} 未締め店舗</strong>
          <button type="button" className="unclosed-stores-popover-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        {unclosedNames.length ? (
          <ul className="unclosed-stores-popover-list">
            {unclosedNames.map((name) => <li key={name}>{name}</li>)}
          </ul>
        ) : (
          <p className="unclosed-stores-popover-empty">未締め店舗はありません(表示が最新でない可能性があります。再読み込みしてご確認ください)。</p>
        )}
      </div>
    </>,
    document.body
  );
}

// Cycled by index, not tied to a specific field name — a category added later just gets the
// next color in the loop, so this never needs updating when new sales fields show up.
const SALES_COMPOSITION_COLORS = ["#2f7df6", "#38b28f", "#f5a524", "#e35757", "#8b5cf6", "#14b8a6", "#ec4899", "#84cc16"];

// 売上画面UI/UX改善(要件6): 技術売上96.9%/店販売上3.1%のように差が大きいと円グラフでは
// 小さい項目が見えづらいため、100%積み上げの横棒グラフへ変更する。items(key/label/amount/
// ratio)の集計ロジックは呼び出し元(salesComposition useMemo)から一切変更していない——
// ここは受け取ったitemsをそのまま描画するだけ。
function SalesCompositionCard({ items }) {
  return (
    <section className="panel sales-composition-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">COMPOSITION</p>
          <h2>売上構成</h2>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="empty-card">売上データが入力されると内訳を表示します。</div>
      ) : (
        <div className="sales-composition-body">
          <div className="sales-composition-bar" role="img" aria-label="売上構成の内訳">
            {items.map((item, index) => (
              <div
                key={item.key}
                className="sales-composition-bar-segment"
                style={{ width: `${Math.max(item.ratio * 100, item.ratio > 0 ? 2 : 0)}%`, background: SALES_COMPOSITION_COLORS[index % SALES_COMPOSITION_COLORS.length] }}
                title={`${item.label} ${percent(item.ratio * 100)}`}
              />
            ))}
          </div>
          <ul className="sales-composition-legend">
            {items.map((item, index) => (
              <li key={item.key}>
                <span className="sales-composition-swatch" style={{ background: SALES_COMPOSITION_COLORS[index % SALES_COMPOSITION_COLORS.length] }} />
                <span className="sales-composition-label">{item.label}</span>
                <strong className="sales-composition-amount">{money(item.amount)}</strong>
                <span className="sales-composition-percent">{percent(item.ratio * 100)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// 金額・人数・率などの数値入力欄で共通利用する、composition-safeな数値入力(要件6: 全ての
// 数値入力を共通処理にまとめる)。type="number"は使わない — 全角数字等の「HTML的に無効な
// 数値」が入ると、画面には入力した文字が残ったままevent.target.valueだけが空文字になる
// ブラウザの仕様があり、店舗のスタッフ数入力で実際にこれが原因の不具合が起きたため(過去の
// 修正参照)。代わりにtype="text" + inputMode="numeric"/"decimal" とし、
function FieldImpl({ label, value, onChange, suffix = "", type = "text", numeric = false, allowDecimal = false, disabled = false, placeholder = "", displayLabel = "" }) {
  const normalizedValue = value === undefined || value === null ? "" : value;
  return (
    <label className="field">
      <span>{label}</span>
      {/* 日次入力の対象日(要件6)専用: <input type="date">はブラウザ・OSのロケール表示に
          依存し空白に見えることがあるため、「8月24日（月）」のような読みやすい文字列を
          別途常時表示する。displayLabelを渡さない他の全Field呼び出し(50箇所以上)は
          従来通り何も追加描画されない(デフォルト""で無効化)。 */}
      {displayLabel ? <strong className="field-display-label">{displayLabel}</strong> : null}
      <div className="input-with-suffix">
        {numeric ? (
          <NumericInput value={normalizedValue} onChange={onChange} allowDecimal={allowDecimal} disabled={disabled} placeholder={placeholder} />
        ) : (
          <input type={type} value={normalizedValue} onChange={(event) => onChange(event.target.value)} disabled={disabled} placeholder={placeholder} />
        )}
        {suffix ? <span>{suffix}</span> : null}
      </div>
    </label>
  );
}
// memo化(NumericInputと同じ理由): アプリ内のほぼ全ての入力画面(日次入力・まとめて入力・
// 月間目標・固定費/変動費・店舗情報・スタッフ招待・初期設定等)が共有する最も呼び出し
// 回数の多いコンポーネント。既存の全呼び出し元(<Field .../>、50箇所以上)は
// この行だけでmemo化の恩恵を受けられ、呼び出し側のJSXを1つも変更する必要が無い。
const Field = memo(FieldImpl);

// テスト専用のnamed export(総合品質チェック: 文字入力時のガクつき再測定)。デフォルト
// exportのApp(main.jsxが使う唯一の経路)には一切影響しない、純粋な追加。実際に出荷される
// memo化済みField/NumericInputそのものを、再構築コピーではなくこの経路で直接テストする。
export { Field, NumericInput };
export default App;
