import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  dailyFieldKeys,
  dailyFieldPresets,
  defaultDailyEntry,
  defaultDailyFieldSettings,
  defaultFixedCostItem,
  defaultMonthlyTargetFieldSettings,
  defaultTarget,
  costCategoryKeys,
  getCostCategoryLabel,
  monthlyTargetFieldKeys,
  ALL_STORES_VALUE,
} from "./data/defaults.js";
import {
  STORAGE_KEYS,
  buildDailyEntryPayload,
  buildDailyStateFromRows,
  buildCashBreakdownStateFromRows,
  dailySalesRowToEntry,
  buildMonthClosingStateFromRows,
  buildTargetStateFromRows,
  buildFixedCostsStateFromRows,
  buildVariableCostsStateFromRows,
  buildMonthlyClosingItemsStateFromRows,
  buildCompanySettingsFromRow,
  buildStoreProfilesByStoreId,
  pruneStaleKeys,
  buildMonthKey,
  calculateMonthSummary,
  deduplicateDailyEntries,
  getBusinessDaySettings,
  formatMonthLabel,
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
  getCostMonthlyAmount,
  getPreviousMonthCostAmount,
  buildCostMonthlyAmountsStateFromRows,
  getInventoryBalance,
  getPreviousMonthInventoryBalance,
  buildStoreInventoryBalancesStateFromRows,
  formatLocalDate,
  getMonthInfo,
  getMonthOffset,
  getTargetForStoreMonth,
  getAllStoresTargetForCompanyMonth,
  getAllStoresBusinessDaySettings,
  getAllStoresBusinessDaySummary,
  calculateAllStoresMonthSummary,
  buildAllStoresTargetStateFromRows,
  buildCompanyMonthKey,
  getStoreHolidayDates,
  getAllStoresHolidayDates,
  isHolidayDate,
  buildStoreHolidaysStateFromRows,
  buildAllStoresHolidaysStateFromRows,
  mergeRemoteAppState,
  money,
  moneyDiff,
  number,
  parseNumber,
  percent,
  readAppState,
  readStorage,
  sanitizeNumericInputValue,
  normalizeAppState,
  writeAppState,
} from "./utils/storage.js";
import { getAllowedStoreIdsForRole, getVisibleNavItems, resolveDefaultPage, canAccessPage, canManageCompanies, canManageStores, canChangeStoreLifecycle, canHardDeleteStore, canEditStoreName, canManageUsers as canManageUsersByRole, canViewUserManagement, canViewAllStores, getInvitableRoles, getRoleLabel, normalizeRole, isAdminRole, canManageFranchisePartnerships, canCreateFranchiseRequest } from "./utils/permissions.js";
import { createInitialAppState } from "./data/defaults.js";
import LoginScreen from "./components/LoginScreen.jsx";
import AccessDenied from "./components/AccessDenied.jsx";
import {
  supabase,
  isSupabaseConfigured,
  getSupabaseConfigurationIssue,
  getSupabaseErrorMessage,
  isAuthTimingErrorMessage,
  AUTH_SESSION_EXPIRED_MESSAGE,
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
  createUserProfileRecord,
  upsertDailySalesEntry,
  updateDailySalesClosingState,
  loadDailySalesForCompanyRange,
  upsertDailyCashBreakdown,
  loadDailyCashBreakdownForCompanyRange,
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
  upsertFixedCostToSupabase,
  deleteFixedCostFromSupabase,
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
  logSupabaseError,
  signUpWithEmail,
  getProfilesForDebug,
  resolveRoleForEmail,
  updateProfileRole,
  updateProfileStoreAssignments,
  getInviteInfo,
  acceptInvite,
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
import { loadLatestTenantSnapshot, upsertTenantSnapshot } from "./utils/supabaseRemote.js";
import { getBusinessTypeDefaultStoreName, getBusinessTypeLabel } from "./utils/businessProfile.js";
import { getLocalizedSupabaseErrorMessage } from "./utils/authMessages.js";
import { buildInviteLink, createInviteToken, isInviteExpired, getUserStatusMeta } from "./utils/invitations.js";
import { computeStoreSummary, normalizeStoreUrls, sortStoresForManagement } from "./utils/storeManagement.js";
import AiAssistantCard from "./components/ai/AiAssistantCard.jsx";
import AiFloatingButton from "./components/ai/AiFloatingButton.jsx";
import AiChatScreen from "./components/ai/AiChatScreen.jsx";
import MonthlyDashboardPage from "./components/dashboard/MonthlyDashboardPage.jsx";
import MonthlyCashBreakdownModal from "./components/cashBreakdown/MonthlyCashBreakdownModal.jsx";
import FaqPage from "./components/faq/FaqPage.jsx";

const targetMonthOptions = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));

// "fixed" の内部idはSupabase保存先(fixed_costsテーブル)に合わせて維持しつつ、旧「固定費」
// 「販管費」の2画面をユーザーからは区別させない単一の「費用入力」タブへ統合。
const monthlyTabs = [
  { id: "target", label: "目標設定" },
  { id: "fixed", label: "費用入力" },
  { id: "closing", label: "月締め" },
  { id: "pnl", label: "損益表" },
];

const ensureMonthValue = (value) => value || new Date().toISOString().slice(0, 7);
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
// error.messageをそのまま画面表示に使ってよいかを判定する薄いヘルパー。JWT/セッションの
// タイミング起因エラー(クロックスキュー等)は生のまま出さず、再ログイン案内に差し替える
// (getSupabaseErrorMessageと同じ規約を、getSupabaseErrorMessageを経由しない箇所にも適用する)。
const resolveErrorReason = (error, fallback) => {
  const message = error instanceof Error ? error.message : "";
  if (isAuthTimingErrorMessage(message)) return AUTH_SESSION_EXPIRED_MESSAGE;
  return message || fallback;
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

// ユーザー管理画面で、ある行の編集・削除ボタンを表示してよいかどうかのクライアント側の判定。
// あくまでUIをわかりやすくするためのもので、実際の可否はSupabase RLS/Edge Function側の
// チェックが最終的な担保(要件5: UIを隠すだけでなくサーバー側でも保護する)。
// - system_adminは誰からも削除できない(自分自身を含め、他のsystem_adminからも)。
// - company_adminはsystem_admin行を編集・削除できない(自社に紛れ込んでいた場合の保険)。
// - store_managerが見る一覧(manageableUsers)は、そもそも自分の管理する店舗のstaffのみに
//   絞り込み済みなので、そこに並ぶ行は常に操作対象になり得る。
const getUserRowPermissions = (currentRole, targetUser) => {
  const role = normalizeRole(currentRole);
  if (role === "system_admin") {
    return { canEdit: true, canDelete: targetUser.role !== "system_admin" };
  }
  if (role === "company_admin") {
    const isTargetSystemAdmin = targetUser.role === "system_admin";
    return { canEdit: !isTargetSystemAdmin, canDelete: !isTargetSystemAdmin };
  }
  return { canEdit: true, canDelete: true };
};

const refreshAuthDebugInfo = async ({ sessionUser = null, role = "", profile = null, hasSession = false, authUser = null, setDebugInfo = null } = {}) => {
  if (!setDebugInfo) return;
  try {
    const { data: sessionData } = await getSupabaseSession();
    const activeUser = sessionData?.session?.user || sessionUser || authUser || null;
    const resolvedRole = normalizeRole(role || profile?.role || "staff");
    const profiles = await getProfilesForDebug();
    return setDebugInfo({
      userId: activeUser?.id || profile?.auth_user_id || "",
      email: activeUser?.email || profile?.email || "",
      role: resolvedRole,
      hasSession: Boolean(sessionData?.session || hasSession),
      profiles,
    });
  } catch {
    return setDebugInfo((prev) => ({ ...prev, hasSession: false, profiles: [] }));
  }
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
});

const dailyFieldLabels = {
  technicalSales: "技術売上",
  retailSales: "店販売上",
  customers: "来店客数",
  newCustomers: "新規客数",
  repeatCustomers: "再来客数",
  memo: "メモ",
  reviewCount: "口コミ数",
  otherSales: "その他売上",
};

const monthlyTargetFieldLabels = {
  targetSales: "月間目標売上",
  targetTechnicalSales: "技術売上目標",
  targetRetailSales: "店販売上目標",
  targetCustomers: "目標客数",
  targetAverageSpend: "目標客単価",
  targetNewCustomers: "目標新規数",
  targetRepeatCustomers: "目標再来数",
  targetReviewCount: "目標口コミ数",
  targetLaborRate: "人件費率",
  targetMaterialRate: "材料費率",
  targetAdRate: "広告費率",
  targetOperatingMargin: "営業利益率",
  holidayCount: "休業日",
};

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

// loadTenantStateFromSupabase always defaults selectedStore to the alphabetically-first store in
// the company. Every login/session-restore path needs to override that with whatever store this
// device actually had selected — but resolving that by NAME alone breaks the instant another
// device renames the store (the cached name goes stale while the id stays valid), silently
// stranding the session on a different, often-empty store while things like store ranking (which
// always reads the company's current store list, never a cached selection) keep looking correct.
// Resolving by the durable selectedStoreId first, and only falling back to a name match or
// Supabase's own default when there's truly no id match, is what makes every entry point below
// self-heal to the SAME store across a rename instead of drifting to an arbitrary one.
const resolvePreferredStoreSelection = ({ tenantState, localRecoveredState, currentCompanyId, role = "staff" }) => {
  const targetStores = (tenantState?.companies || []).find((company) => company.id === currentCompanyId)?.stores
    || tenantState?.companies?.[0]?.stores
    || [];
  const availableStoreNames = new Set(targetStores.map((store) => store.name));
  const storeMatchedById = localRecoveredState?.selectedStoreId
    ? targetStores.find((store) => store.id === localRecoveredState.selectedStoreId)
    : null;
  // 「全店舗」は実店舗ではないのでavailableStoreNamesには含まれない。権限がある間は
  // 実店舗へ戻さず、そのまま維持する。
  if (localRecoveredState?.selectedStore === ALL_STORES_VALUE && canViewAllStores(role)) {
    return { selectedStore: ALL_STORES_VALUE, selectedStoreId: "" };
  }
  const selectedStore = storeMatchedById
    ? storeMatchedById.name
    : (localRecoveredState?.selectedStore && availableStoreNames.has(localRecoveredState.selectedStore)
      ? localRecoveredState.selectedStore
      : (tenantState?.selectedStore || localRecoveredState?.selectedStore || ""));
  const selectedStoreId = storeMatchedById
    ? storeMatchedById.id
    : (targetStores.find((store) => store.name === selectedStore)?.id || tenantState?.selectedStoreId || "");
  return { selectedStore, selectedStoreId };
};

function App() {
  const [theme, setTheme] = useState(() => (readStorage(STORAGE_KEYS.theme, "light") === "dark" ? "dark" : "light"));
  const [activePage, setActivePage] = useState("dashboard");
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("invite") ? "招待登録用のリンクです。メールアドレスとパスワードを設定してください。" : "";
  });
  const [authMode, setAuthMode] = useState(() => {
    if (typeof window === "undefined") return "login";
    const params = new URLSearchParams(window.location.search);
    return params.get("invite") ? "signup" : "login";
  });
  const [currentRole, setCurrentRole] = useState("staff");
  const [debugInfo, setDebugInfo] = useState({ userId: "", email: "", role: "staff", hasSession: false, profiles: [] });
  const [inviteToken, setInviteToken] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("invite") || "";
  });
  // 招待リンクの宛先メールアドレス(get_invite_infoから取得)。新規登録フォームのメール欄を
  // これで事前入力・固定することで、招待されたメールアドレスと違うメールアドレスを手入力して
  // しまい「招待メールアドレスと一致するメールアドレスで登録してください」で詰まる事故を防ぐ。
  const [inviteEmail, setInviteEmail] = useState("");
  const [activeMonthlyTab, setActiveMonthlyTab] = useState("closing");
  const [companyForm, setCompanyForm] = useState({ name: "", code: "", contractStatus: "trial", businessType: "salon" });
  const [storeForm, setStoreForm] = useState(createStoreFormDefaults());
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
  // Inline feedback right next to the 店舗追加 button — the shared top-of-page `notice` can be
  // scrolled out of view once the store form is scrolled into view (via focusStoreForm), making
  // a real success/failure result look like nothing happened. This always renders in the same
  // spot the user is already looking at.
  const [storeFormStatus, setStoreFormStatus] = useState({ status: "idle", message: "" });
  // storeFormStatusのstate更新は次のレンダーまでボタンのdisabledに反映されないため、
  // ほぼ同時に2回押された場合はstateだけのガードでは両方すり抜けてしまう(その場合、店舗名の
  // 一意制約が無いため2件の店舗が作られたり、在籍スタッフ数の保存が2回目の呼び出しの値で
  // 上書きされたりする)。refはレンダーを待たずに同期的に読み書きできるため、こちらを一次防御
  // として使う。
  const savingStoreRef = useRef(false);
  const [userForm, setUserForm] = useState({ name: "", email: "", role: "store_manager", storeIds: [], primaryStoreId: "", invitationStatus: "invited", loginCount: 0, lastLoginAt: "", isActive: true });
  // 「招待する」ボタンの二重送信防止(要件8: ボタン連打・二重実行によるAuthユーザー重複作成を
  // 防ぐ)。招待フォーム全体を対象にした単一のフラグで十分(フォームは一度に1件しか送信しない)。
  const [userFormBusy, setUserFormBusy] = useState(false);
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
  // 店舗プロフィールフォームはモーダルではなく常時表示のインラインフォーム(店舗一覧より
  // 前に描画される)なので、「店舗を追加」/「編集」ボタンを押しても画面内に変化が見えず、
  // 「ボタンが反応しない」ように見えていた — フォームへスクロール+フォーカスして明示的に
  // 開いたことが分かるようにする。
  const storeFormSectionRef = useRef(null);
  const storeFormNameInputRef = useRef(null);
  const focusStoreForm = () => {
    window.requestAnimationFrame(() => {
      storeFormSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      storeFormNameInputRef.current?.focus();
    });
  };
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
  // 月別日計一覧モーダルの開閉のみを持つ(月・店舗はモーダル側のローカルstateで完結させ、
  // 日次入力側のselectedMonth/dailyFormには一切影響しない)。
  const [showCashBreakdownMonthly, setShowCashBreakdownMonthly] = useState(false);
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
  const [notice, setNotice] = useState("");
  const [businessDayInput, setBusinessDayInput] = useState("");
  const [manualBusinessDayInput, setManualBusinessDayInput] = useState("");
  const [isBusinessDayEditing, setIsBusinessDayEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState({ status: "saved", message: "自動保存済み", timestamp: "", error: false });
  const [syncStatus, setSyncStatus] = useState({ status: "idle", message: "同期待機中", timestamp: "", error: false });
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
  // Past and future months both need to be selectable (spec: "過去月と未来月も選択可能"). A
  // fixed ±5 year window around "now" comfortably covers that, plus the currently selected
  // year in case it's ever outside the window for any reason (e.g. data from an unusual date).
  const targetYearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const selectedYear = Number(targetSelectedMonth.slice(0, 4)) || currentYear;
    const years = new Set([selectedYear]);
    for (let offset = -5; offset <= 5; offset += 1) years.add(currentYear + offset);
    return Array.from(years).sort((a, b) => a - b);
  }, [targetSelectedMonth]);
  // 日次入力項目の設定(店舗ごと、月の概念はない)。stores.daily_field_settings は他の店舗情報と
  // 同じタイミングでロードされるため、対象月選択のような専用フェッチは不要。
  const [dailyFieldDraft, setDailyFieldDraft] = useState(() => defaultDailyFieldSettings());
  const [dailyFieldSaveStatus, setDailyFieldSaveStatus] = useState({ status: "idle", message: "" });
  const [dailyFieldDirty, setDailyFieldDirty] = useState(false);
  // Same idea as dailyFieldDraft above, for 月間目標設定's own toggleable fields.
  const [monthlyTargetFieldDraft, setMonthlyTargetFieldDraft] = useState(() => defaultMonthlyTargetFieldSettings());
  const [monthlyTargetFieldSaveStatus, setMonthlyTargetFieldSaveStatus] = useState({ status: "idle", message: "" });
  const [monthlyTargetFieldDirty, setMonthlyTargetFieldDirty] = useState(false);
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
  const currentCompany = useMemo(() => appState.companies?.find((company) => company.id === appState.currentCompanyId) || appState.companies?.[0] || null, [appState.companies, appState.currentCompanyId]);
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
  const manageableUsers = useMemo(() => (appState.users || []).filter((user) => {
    const normalizedCurrentRole = normalizeRole(currentRole);
    if (normalizedCurrentRole === "system_admin") return true;
    if (user.companyId !== currentCompany?.id) return false;
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

  useEffect(() => {
    // A brand-new invitee opening /signup?invite=TOKEN has no Supabase session yet — this whole
    // effect's job on that first load is exactly to notice that and fall through to the
    // "no session" branches below. Those branches used to hardcode setAuthMode("login"),
    // silently overwriting the "signup" mode the ?invite= param had already set at initial
    // useState — so every invite link bounced straight to the login screen instead of
    // registration. Preserving "signup" here (and only here) whenever the URL still carries an
    // invite token is the fix; an authenticated session always still wins and goes to "app".
    const hasInviteIntent = typeof window !== "undefined" && Boolean(new URLSearchParams(window.location.search).get("invite"));
    const initializeAuth = async () => {
      try {
        if (!isSupabaseConfigured) {
          setCurrentUser(null);
          setCurrentRole("staff");
          setDebugInfo({ userId: "", email: "", role: "staff", hasSession: false, profiles: [] });
          setAuthMode(hasInviteIntent ? "signup" : "login");
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
          setDebugInfo({ userId: "", email: "", role: "staff", hasSession: false, profiles: [] });
          setAuthMode("signup");
          setActivePage("dashboard");
          setAppState(initialAppStateValue);
          setSyncStatus({ status: "idle", message: "同期待機中", timestamp: "", error: false });
          setAuthLoading(false);
          return;
        }
        if (session?.user) {
          const profile = await ensureProfileForAuthUser({ authUserId: session.user.id, email: session.user.email, role: resolveRoleForEmail(session.user.email) });
          if (!profile) {
            throw new Error("プロフィール情報を取得できませんでした");
          }
          const tenantState = await loadTenantStateFromSupabase({ authUserId: session.user.id, email: session.user.email, currentProfile: profile });
          const localRecoveredState = normalizeAppState(readAppState());
          const nextUser = buildAuthenticatedUser({ profile, authUser: session.user });
          setCurrentUser(nextUser);
          setCurrentRole(normalizeRole(profile?.role || "staff"));
          const reconciledCompanies = tenantState.companies?.length ? tenantState.companies : localRecoveredState.companies || [];
          const reconciledCurrentCompanyId = profile?.company_id || tenantState.currentCompanyId || localRecoveredState.currentCompanyId || "";
          // Single source of truth for "which store should this session resume on" — see
          // resolvePreferredStoreSelection's own comments (id-first resolution so a rename never
          // strands the session, and an explicit ALL_STORES_VALUE guard so "全店舗" survives a
          // session restore instead of being treated as "no store selected"). Substituting
          // reconciledCompanies in here preserves this call site's own companies fallback
          // (tenantState's list, or the locally-cached one if tenantState's hasn't loaded yet).
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
            // Same class of bug as the store-selection fix above: loadTenantStateFromSupabase's
            // tenantState.selectedMonth is always just "today's real month" (createInitialAppState's
            // default), never the month the user actually had open — putting it first here meant a
            // session viewing, say, next month's fixed costs would silently snap back to the
            // current month on every refresh/re-login. Prefer the device's own cached month.
            selectedMonth: localRecoveredState.selectedMonth || tenantState.selectedMonth || new Date().toISOString().slice(0, 7),
            // セッション復元(ページ再読み込み・再ログイン)は常に自社(本来のcompany_id)から
            // 始める、という意図的な単純化(加盟店の閲覧状態はセッションをまたいで保持しない)。
            // ここで明示的にfalse/""へ戻さないと、直前のlocalStorageキャッシュに残っている
            // isViewingFranchise: true(...localRecoveredStateの展開経由)が生き残ってしまい、
            // currentCompanyIdは正しく自社へ戻っているのにisViewingFranchiseだけtrueのまま、
            // という不整合な状態でページが再開してしまう。
            isViewingFranchise: false,
            homeCompanyIdBeforeFranchiseView: "",
          };
          writeAppState(reconciledState);
          setAppState(reconciledState);
          setSyncStatus({ status: "syncing", message: "同期中です…", timestamp: new Date().toISOString(), error: false });
          void hydrateFromSupabase({ authUser: session.user, profile, tenantState: reconciledState });
          await refreshAuthDebugInfo({ sessionUser: session.user, role: profile?.role, profile, hasSession: true, authUser: session.user, setDebugInfo });
          setAuthMode("app");
          setActivePage(resolveDefaultPage(profile?.role || "staff"));
          return;
        }

        setCurrentUser(null);
        setCurrentRole("staff");
        setDebugInfo({ userId: "", email: "", role: "staff", hasSession: false, profiles: [] });
        setAuthMode(hasInviteIntent ? "signup" : "login");
        setActivePage("dashboard");
        setAppState(initialAppStateValue);
      } catch (error) {
        setCurrentUser(null);
        setCurrentRole("staff");
        setDebugInfo({ userId: "", email: "", role: "staff", hasSession: false, profiles: [] });
        setAuthMode(hasInviteIntent ? "signup" : "login");
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
    setDailyFieldSaveStatus({ status: "idle", message: "" });
    setMonthlyTargetFieldDraft(normalizeMonthlyTargetFieldSettings(selectedStoreEntity?.settings?.monthlyTargetFields));
    setMonthlyTargetFieldDirty(false);
    setMonthlyTargetFieldSaveStatus({ status: "idle", message: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore]);
  const setupProgress = useMemo(() => getCompanySetupProgress(currentCompany), [currentCompany]);
  // Only ever reachable in local/demo mode (isSupabaseConfigured === false): every company
  // fetched from Supabase (see normalizedCompanies in supabase.js) has setup.complete hardcoded
  // to true, since there's no per-step "is this company fully onboarded" concept once companies/
  // stores/store_input_settings/company_settings are all real tables — a company either exists
  // or it doesn't. Not dead code — it's the non-Supabase demo mode's own onboarding flow — just
  // never triggered once Supabase is configured.
  const showInitialSetup = Boolean(currentCompany && !currentCompany.setup?.complete && isAdminUser);
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
  const fixedCosts = useMemo(() => getFixedCostsForStoreMonth(appState, selectedStoreId, selectedMonth), [appState, selectedStoreId, selectedMonth]);
  const useInventoryTracking = Boolean(selectedStoreEntity?.settings?.useInventoryTracking);
  // 日計管理(要件2: 任意機能、初期値OFF)。OFFの店舗では日次入力画面に日計カード自体を
  // 一切描画しない(余白も残さない)。
  const useCashBreakdown = Boolean(selectedStoreEntity?.settings?.useCashBreakdown);
  const summary = useMemo(
    () => (isAllStoresView
      ? calculateAllStoresMonthSummary(appState, currentCompany, selectedMonth)
      : calculateMonthSummary(appState, selectedStoreId, selectedMonth, { useInventoryTracking, hiddenCategories: selectedStoreEntity?.settings?.hiddenClosingCategories || [] })),
    [appState, currentCompany, isAllStoresView, selectedStoreId, selectedMonth, useInventoryTracking, selectedStoreEntity]
  );
  const businessDaySummary = useMemo(
    () => (isAllStoresView
      ? getAllStoresBusinessDaySummary(appState, appState.currentCompanyId, currentCompanyStores, selectedMonth)
      : getBusinessDaySummary(appState, selectedStoreId, selectedMonth)),
    [appState, currentCompanyStores, isAllStoresView, selectedStoreId, selectedMonth]
  );
  const customerTargetSummary = useMemo(() => getCustomerTargetSummary({ customers: summary.customers, targetCustomers: summary.customerTarget, businessDayCount: summary.businessDays, completedDays: summary.completedDays, remainingBusinessDays: summary.remainingBusinessDays, targetAverageCustomersPerDay: parseNumber(target.targetAverageCustomersPerDay) }), [summary.businessDays, summary.completedDays, summary.customerTarget, summary.customers, summary.remainingBusinessDays, target.targetAverageCustomersPerDay]);
  // 損益表・費用入力を使っていない店舗でも使える独立指標。店舗単位の設定値(生産性計算人数)
  // を使うだけで、月間目標や費用データの有無とは無関係に成立する。
  const staffProductivitySummary = useMemo(() => getStaffProductivitySummary({
    sales: summary.sales,
    forecast: summary.forecast,
    staffCount: selectedStoreEntity?.staffCount,
    productivityStaffCount: selectedStoreEntity?.productivityStaffCount,
  }), [summary.sales, summary.forecast, selectedStoreEntity]);
  const businessDaySettings = useMemo(() => getBusinessDaySettings(appState, selectedStoreId, selectedMonth), [appState, selectedStoreId, selectedMonth]);
  const monthClosingStatus = useMemo(() => {
    const key = buildMonthKey(selectedStoreId, selectedMonth);
    return appState.monthClosingStatus?.[key] || { closed: false, lockedAt: "", note: "" };
  }, [appState.monthClosingStatus, selectedStoreId, selectedMonth]);
  const monthClosingChecklist = useMemo(
    () => getMonthClosingChecklist(appState, selectedStoreId, selectedMonth, { useInventoryTracking, hiddenCategories: selectedStoreEntity?.settings?.hiddenClosingCategories || [] }),
    [appState, selectedStoreId, selectedMonth, useInventoryTracking, selectedStoreEntity]
  );
  const monthNeedsReconfirmation = useMemo(
    () => needsMonthReconfirmation(appState, selectedStoreId, selectedMonth),
    [appState, selectedStoreId, selectedMonth]
  );
  const todayEntry = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
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
  const rankingRows = useMemo(() => {
    const previousMonth = getMonthOffset(selectedMonth, -1);

    // ランキングの売上はダッシュボードの総売上(summary.sales、入力済み全件)と同じ基準にする —
    // 以前はsummary.closedSales(日締め済みの日だけ)を使っており、当日分を入力しただけでは
    // ランキングに反映されず「ダッシュボードは最新なのにランキングだけ古い」という不具合の
    // 原因になっていた。日締めを待たず、入力した時点でランキングにも反映される。
    const rows = currentCompanyStores.map((store) => {
      const storeSummary = calculateMonthSummary(appState, store.id, selectedMonth);
      // previousSummary.entries.length(前月の日次入力が1件でもあるか)で「先月データが
      // 存在しない」を判定する — 前月の売上が本当に0円だった場合と区別するため。
      const previousSummary = calculateMonthSummary(appState, store.id, previousMonth);

      return {
        storeId: store.id,
        storeName: store.name,
        sales: storeSummary.sales,
        previousSales: previousSummary.sales,
        hasPreviousSales: previousSummary.entries.length > 0,
      };
    });

    return [...rows]
      .sort((left, right) => right.sales - left.sales)
      .map((row, index) => ({ ...row, currentRank: index + 1 }));
  }, [appState, selectedMonth, currentCompanyStores]);
  const goToMonthlyTargetSetting = () => {
    // 月間目標設定パネルは selectedMonth (ヘッダーの対象月) とは独立した専用の月選択
    // (targetSelectedMonth) を持つため、ここで同期させないとダッシュボードで見ていた
    // 月とは違う月の目標画面に着地してしまう。店舗 (selectedStore) はグローバルな状態
    // なので自動的に引き継がれる。
    setTargetSelectedMonth(selectedMonth);
    setActivePage("monthly");
    setActiveMonthlyTab("target");
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
  // ⑤ 月末着地予測 vs 目標: forecast itself doesn't need a target to compute (it's pace-based),
  // only this comparison line does.
  const forecastVsTarget = summary.forecast - parseNumber(target.targetSales);
  // KPIエリア(目標に対する数値)用。実績値は営業進捗カードに表示するため、ここには置かない
  // (数字を混在させない、という今回の整理方針)。目標未設定の項目は配列に入れない
  // (0円/0名として表示しない — 任意項目のご指示に基づく)。
  const dashboardSupportMetrics = useMemo(() => {
    // 「必要客数◯名/日」は客数達成率カード側にまとめたため、平均客単価カードは数値だけの
    // シンプルな表示にする(効率系: 数字中心、補足最小限)。
    const items = [{ label: "平均客単価", value: money(summary.averageSpend), hint: "" }];
    if (hasSalesTarget) {
      items.push({ label: "1日平均必要売上", value: money(summary.dailyNeededSales), hint: `残り${summary.remainingBusinessDays ?? 0}営業日` });
    }
    // 「目標客数まで」はkpi-hero-gridの「客数達成率」カード(secondaryValue)と同じ数字
    // (remainingCustomersTarget)を表示するだけの重複カードだったため廃止。
    // 全店舗ビューでは店舗ごとの生産性計算人数という単一の値が存在しないため出さない。
    if (!isAllStoresView && selectedStoreEntity) {
      items.push({
        label: "1人あたり月間売上",
        value: staffProductivitySummary.hasStaffCount ? `${money(staffProductivitySummary.current)} / 人` : "スタッフ数未設定",
        hint: staffProductivitySummary.hasStaffCount ? `月末予測 ${money(staffProductivitySummary.monthEndForecast)} / 人` : "",
      });
    }
    return items;
  }, [summary.averageSpend, hasSalesTarget, summary.dailyNeededSales, summary.remainingBusinessDays, isAllStoresView, selectedStoreEntity, staffProductivitySummary]);
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
        const session = data?.session;
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
        await refreshAuthDebugInfo({ sessionUser: authUser, role: profile?.role, profile, hasSession: Boolean(session || sessionData?.session), authUser, setDebugInfo });
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
        await refreshAuthDebugInfo({ sessionUser: authUser, role: profile?.role, profile, hasSession: true, authUser, setDebugInfo });
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
        await refreshAuthDebugInfo({ sessionUser: authUser, role: profile?.role, profile, hasSession: true, authUser, setDebugInfo });
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
      await refreshAuthDebugInfo({ sessionUser: authUser, role: profile?.role, profile, hasSession: true, authUser, setDebugInfo });
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
      setDebugInfo({ userId: "", email: "", role: "staff", hasSession: false, profiles: [] });
      setCurrentRole("staff");
      setAuthMode("login");
      setActivePage("dashboard");
      setAppState(initialAppStateValue);
      setSyncStatus({ status: "idle", message: "同期待機中", timestamp: "", error: false });
      setAuthError("");
      setAuthSuccess("");
    }
  };

  const canAccessCurrentPage = canAccessPage(currentRole, activePage);
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
    const requestId = ++hydrateRequestRef.current;
    try {
      console.info("[sync-hydrate] start", {
        authUserId: authUser?.id,
        profileId: profile?.id,
        companyId: companyIdOverride || profile?.company_id,
        selectedStore: tenantState?.selectedStore,
        selectedMonth: tenantState?.selectedMonth,
      });
      setSyncStatus({ status: "syncing", message: "同期中です…", timestamp: new Date().toISOString(), error: false });
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

      // daily_sales is the authoritative source for daily sales figures + day-closing state
      // (see upsertDailySalesEntry/updateDailySalesClosingState) — not the tenant_snapshots
      // blob below, which may still hold older copies for dates saved before this table was
      // wired up. Fetch a window wide enough for the dashboard/ranking view (current month +
      // the two prior months it compares against) across every store in the company at once;
      // RLS scopes the result to whichever stores this user can actually see. A failed fetch
      // here fails the whole hydrate (see catch block) rather than silently showing stale or
      // empty progress/ranking numbers.
      const dailySalesRange = getDailySalesQueryRange(targetMonth);
      const dailySalesResult = await loadDailySalesForCompanyRange({ companyId, startDate: dailySalesRange.startDate, endDate: dailySalesRange.endDate });
      if (!dailySalesResult.ok) {
        throw dailySalesResult.error || new Error("日次売上データの取得に失敗しました");
      }
      const dailySalesState = buildDailyStateFromRows(dailySalesResult.data);

      // 日計(現金/キャッシュレス/ポイント利用の内訳)。daily_salesと同じ日付レンジで、
      // 完全に別テーブル・別のstateとして取得する — 総売上等の計算には一切混ざらない。
      const cashBreakdownResult = await loadDailyCashBreakdownForCompanyRange({ companyId, startDate: dailySalesRange.startDate, endDate: dailySalesRange.endDate });
      if (!cashBreakdownResult.ok) {
        throw cashBreakdownResult.error || new Error("日計データの取得に失敗しました");
      }
      const cashBreakdownState = buildCashBreakdownStateFromRows(cashBreakdownResult.data);

      // Same reasoning for monthly_closings: it's the authoritative table now (see
      // upsertMonthlyClosingState), so a fresh device/session needs this fetched directly
      // instead of only ever reflecting whatever was last embedded in a tenant_snapshots row.
      const closingMonths = [targetMonth, getMonthOffset(targetMonth, -1), getMonthOffset(targetMonth, -2)];
      const monthlyClosingsResult = await loadMonthlyClosingsForCompany({ companyId, yearMonths: closingMonths });
      if (!monthlyClosingsResult.ok) {
        throw monthlyClosingsResult.error || new Error("月締めデータの取得に失敗しました");
      }
      const monthClosingStatusOverlay = buildMonthClosingStateFromRows(monthlyClosingsResult.data);

      // Same reasoning again for monthly_targets: without this, appState.targets was only ever
      // populated by the 月間目標設定 panel's own per-visit fetch for whichever store+month
      // *that panel* happens to be showing (a separate, independent month selector from this
      // one) — so the dashboard's target-based metrics could see a store/month as "no target
      // registered" simply because nobody had opened the target panel for it this session, not
      // because no target was actually ever saved. Reuses the same 3-month window as
      // monthly_closings above.
      const monthlyTargetsResult = await loadMonthlyTargetsForCompany({ companyId, yearMonths: closingMonths });
      if (!monthlyTargetsResult.ok) {
        throw monthlyTargetsResult.error || new Error("月間目標データの取得に失敗しました");
      }
      const targetStateOverlay = buildTargetStateFromRows(monthlyTargetsResult.data);

      // company_all_stores_targets (「全店舗」company_admin専用ビューの目標+営業日設定)。
      // store_idを持たず company_id 単位なので storeIdToName は不要。同じ3か月ウィンドウを
      // 使い、pruneStaleKeysで会社切り替え時に前の会社のキャッシュが残らないようにする。
      const allStoresTargetsResult = await loadAllStoresTargetsForCompany({ companyId, yearMonths: closingMonths });
      if (!allStoresTargetsResult.ok) {
        throw allStoresTargetsResult.error || new Error("全店舗目標データの取得に失敗しました");
      }
      const allStoresTargetStateOverlay = buildAllStoresTargetStateFromRows(allStoresTargetsResult.data);

      // 店休日(カレンダーの具体的な日付)。daily_salesと同じ日付レンジ(過去2か月+対象月)で
      // 取得する — 営業進捗/KPIが参照する期間と一致させるため。
      const storeHolidaysResult = await loadStoreHolidaysForCompanyRange({ companyId, startDate: dailySalesRange.startDate, endDate: dailySalesRange.endDate });
      if (!storeHolidaysResult.ok) {
        throw storeHolidaysResult.error || new Error("店休日データの取得に失敗しました");
      }
      const storeHolidaysOverlay = buildStoreHolidaysStateFromRows(storeHolidaysResult.data);

      const allStoresHolidaysResult = await loadAllStoresHolidaysForCompanyRange({ companyId, startDate: dailySalesRange.startDate, endDate: dailySalesRange.endDate });
      if (!allStoresHolidaysResult.ok) {
        throw allStoresHolidaysResult.error || new Error("全店舗店休日データの取得に失敗しました");
      }
      const allStoresHolidaysOverlay = buildAllStoresHolidaysStateFromRows(allStoresHolidaysResult.data);

      // fixed_costs (see 20260808000000_create_fixed_costs.sql): a "翌月以降も継続" item is
      // computed by looking backwards across every earlier month's entries for the store (see
      // getFixedCostsForStoreMonth), so — unlike monthly_targets/monthly_closings above — this
      // can't be windowed to a few recent months; fetch every fixed_costs row for the company.
      const fixedCostsResult = await loadFixedCostsForCompany({ companyId });
      if (!fixedCostsResult.ok) {
        throw fixedCostsResult.error || new Error("固定費データの取得に失敗しました");
      }
      const fixedCostsOverlay = buildFixedCostsStateFromRows(fixedCostsResult.data);

      // cost_monthly_amounts (費用の対象月ごとの金額) — direct month lookup, no carry-forward
      // (see getCostMonthlyAmount), so windowed the same as variable_costs/monthly_closings below.
      const costMonthlyAmountsResult = await loadCostMonthlyAmountsForCompany({ companyId, yearMonths: closingMonths });
      if (!costMonthlyAmountsResult.ok) {
        throw costMonthlyAmountsResult.error || new Error("費用の月次金額データの取得に失敗しました");
      }
      const costMonthlyAmountsOverlay = buildCostMonthlyAmountsStateFromRows(costMonthlyAmountsResult.data);

      // store_inventory_balances (在庫管理ONの店舗の月末在庫/期首在庫) — direct month lookup,
      // no carry-forward, windowed the same as cost_monthly_amounts above.
      const storeInventoryBalancesResult = await loadStoreInventoryBalancesForCompany({ companyId, yearMonths: closingMonths });
      if (!storeInventoryBalancesResult.ok) {
        throw storeInventoryBalancesResult.error || new Error("在庫データの取得に失敗しました");
      }
      const storeInventoryBalancesOverlay = buildStoreInventoryBalancesStateFromRows(storeInventoryBalancesResult.data);

      // variable_costs (販管費) and monthly_closing_items (月締め項目) — direct month lookup,
      // no carry-forward, so windowed the same as monthly_targets/monthly_closings above.
      const variableCostsResult = await loadVariableCostsForCompany({ companyId, yearMonths: closingMonths });
      if (!variableCostsResult.ok) {
        throw variableCostsResult.error || new Error("販管費データの取得に失敗しました");
      }
      const variableCostsOverlay = buildVariableCostsStateFromRows(variableCostsResult.data);

      const monthlyClosingItemsResult = await loadMonthlyClosingItemsForCompany({ companyId, yearMonths: closingMonths });
      if (!monthlyClosingItemsResult.ok) {
        throw monthlyClosingItemsResult.error || new Error("月締め項目データの取得に失敗しました");
      }
      const monthlyClosingItemsOverlay = buildMonthlyClosingItemsStateFromRows(monthlyClosingItemsResult.data);

      // company_settings (business type/currency/display prefs/tax settings/showOtherSales) —
      // a single row for the whole company. null when no row exists yet (brand-new company);
      // applyCompanySettingsToCompanies below falls back to the hardcoded defaults in that case,
      // same as before this table existed.
      const companySettingsResult = await loadCompanySettings({ companyId });
      const companySettingsOverlay = buildCompanySettingsFromRow(companySettingsResult.data);

      // store_profiles (address/phone/manager/representative/hours/description/URLs/etc) —
      // keyed by store_id, one row per store, fetched company-wide alongside store_input_settings.
      const storeProfilesResult = await loadStoreProfilesForCompany({ companyId });
      const storeProfilesByStoreId = buildStoreProfilesByStoreId(storeProfilesResult.data);

      // store_input_settings (daily/monthly field visibility) is the authoritative source now
      // — see 20260807000000_create_store_input_settings.sql. Fetched company-wide alongside
      // daily_sales/monthly_closings above, then merged onto each store's settings object
      // below wherever appState.companies gets (re)built, the same way those other two tables
      // overlay onto dailyResults/dayClosingStates/monthClosingStatus.
      const storeInputSettingsResult = await loadStoreInputSettingsForCompany({ companyId });
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
              ...(inputRow ? {
                dailyFieldSettings: normalizeDailyFieldSettings(inputRow.daily_fields),
                monthlyTargetFields: normalizeMonthlyTargetFieldSettings(inputRow.monthly_target_fields),
                useInventoryTracking: Boolean(inputRow.use_inventory_tracking),
                useCashBreakdown: Boolean(inputRow.use_cash_breakdown),
                hiddenClosingCategories: normalizeHiddenClosingCategories(inputRow.hidden_closing_categories),
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
      // company's stores is inside the just-fetched, fully authoritative set.
      const companyStoreIdPrefixes = (company?.stores || []).map((store) => `${store.id}__`);
      const unboundedExpectedKeysFor = (mergedMap) => new Set(
        Object.keys(mergedMap || {}).filter((key) => companyStoreIdPrefixes.some((prefix) => key.startsWith(prefix)))
      );
      // cost_monthly_amounts is fetched windowed by target_month (like variable_costs), but keyed
      // by cost item id rather than store id — so its expected-key set has to be built from
      // whichever cost item ids belong to this company (from the just-merged fixedCosts map)
      // crossed with the fetched month window, not from companyStoreIdPrefixes/windowedExpectedKeys.
      const costMonthlyAmountsExpectedKeysFor = (mergedFixedCosts) => {
        const costItemIds = new Set();
        Object.entries(mergedFixedCosts || {}).forEach(([key, items]) => {
          if (!companyStoreIdPrefixes.some((prefix) => key.startsWith(prefix))) return;
          (Array.isArray(items) ? items : []).forEach((item) => {
            if (item.id) costItemIds.add(item.id);
          });
        });
        const expected = new Set();
        costItemIds.forEach((itemId) => {
          closingMonths.forEach((month) => expected.add(`${itemId}__${month}`));
        });
        return expected;
      };
      const applyDailySalesOverlay = (state) => {
        const merged = mergeRemoteAppState(state, {
          dailyResults: dailySalesState.dailyResults,
          dayClosingStates: dailySalesState.dayClosingStates,
          dayClosingUpdatedAt: dailySalesState.dayClosingUpdatedAt,
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
          fixedCosts: fixedCostsOverlay.fixedCosts,
          costMonthlyAmounts: costMonthlyAmountsOverlay.costMonthlyAmounts,
          storeInventoryBalances: storeInventoryBalancesOverlay.storeInventoryBalances,
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
        return {
          ...merged,
          dailyResults: prunedDailyResults,
          dayClosingStates: prunedDayClosingStates,
          dayClosingUpdatedAt: prunedDayClosingUpdatedAt,
          cashBreakdownResults: prunedCashBreakdownResults,
          targets: pruneStaleKeys(merged.targets, windowedExpectedKeys, targetStateOverlay.targets),
          allStoresTargets: pruneStaleKeys(merged.allStoresTargets, companyMonthExpectedKeys, allStoresTargetStateOverlay.allStoresTargets),
          allStoresBusinessDaySettings: pruneStaleKeys(merged.allStoresBusinessDaySettings, companyMonthExpectedKeys, allStoresTargetStateOverlay.allStoresBusinessDaySettings),
          storeHolidays: pruneStaleKeys(merged.storeHolidays, windowedExpectedKeys, storeHolidaysOverlay.storeHolidays),
          allStoresHolidays: pruneStaleKeys(merged.allStoresHolidays, companyMonthExpectedKeys, allStoresHolidaysOverlay.allStoresHolidays),
          fixedCosts: pruneStaleKeys(merged.fixedCosts, unboundedExpectedKeysFor(merged.fixedCosts), fixedCostsOverlay.fixedCosts),
          // costMonthlyAmounts keys are `${costItemId}__${targetMonth}`, not `${storeId}__${month}`,
          // so windowedExpectedKeys (built from store ids) can't be reused here — build the
          // expected set from this company's own cost item ids (just resolved via the fixedCosts
          // merge above) crossed with the fetched month window instead.
          costMonthlyAmounts: pruneStaleKeys(merged.costMonthlyAmounts, costMonthlyAmountsExpectedKeysFor(merged.fixedCosts), costMonthlyAmountsOverlay.costMonthlyAmounts),
          // storeInventoryBalances keys are `${storeId}__${targetMonth}` — the same shape
          // windowedExpectedKeys already uses, so it can be reused directly (unlike costMonthlyAmounts).
          storeInventoryBalances: pruneStaleKeys(merged.storeInventoryBalances, windowedExpectedKeys, storeInventoryBalancesOverlay.storeInventoryBalances),
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
      const remoteSnapshotSignature = JSON.stringify({
        ...nextRemoteState,
        companySnapshots: Object.fromEntries(Object.entries(nextRemoteState.companySnapshots || {}).map(([key, value]) => [key, {
          ...(value || {}),
          companySnapshots: undefined,
        }])),
      });
      if (hydrateRequestRef.current !== requestId) return;
      setAppState((prev) => {
        const merged = applyDailySalesOverlay(mergeRemoteAppState(prev, nextRemoteState));
        writeAppState(merged);
        return merged;
      });
      // Recorded against the *fetched* (pre-merge) snapshot, not the merged result: if the
      // merge pulled in local-only data the snapshot didn't have, appState will now diverge
      // from this signature, which is what makes the autosave effect push that data back up.
      lastPersistedRef.current = remoteSnapshotSignature;
      setSyncStatus({ status: "loaded", message: "同期データを読み込みました", timestamp: new Date().toISOString(), error: false });
      hydrateRetryCountRef.current = 0;
      setSyncInitialized(true);
    } catch (error) {
      // Deliberately do NOT set syncInitialized(true) here. That flag is what gates the
      // autosave effect (see its `!syncInitialized` guard) — flipping it on a failed fetch
      // was the exact "open screen → state is empty → autosave fires → overwrites real
      // Supabase data → THEN the real fetch finally lands" race this app was vulnerable to.
      // Leaving it false blocks all outgoing writes until a hydrate genuinely succeeds.
      logSupabaseError({ operation: "hydrateFromSupabase", table: "tenant_snapshots", userId: authUser?.id, companyId: companyIdOverride || profile?.company_id, storeId: tenantState?.selectedStore, error });
      const reason = getSupabaseErrorMessage(error);
      setSyncStatus({ status: "error", message: `同期エラー: ${reason}`, timestamp: new Date().toISOString(), error: true });
      if (hydrateRetryTimerRef.current) {
        window.clearTimeout(hydrateRetryTimerRef.current);
      }
      const attempt = hydrateRetryCountRef.current + 1;
      hydrateRetryCountRef.current = attempt;
      const delayMs = Math.min(3000 * attempt, 15000);
      hydrateRetryTimerRef.current = window.setTimeout(() => {
        void hydrateFromSupabase({ authUser, profile, tenantState, companyIdOverride });
      }, delayMs);
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
    const company = (nextState.companies || []).find((item) => item.id === nextState.currentCompanyId);
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
    const result = await upsertTenantSnapshot({ company, store, user, appState: nextState, targetMonth: nextState.selectedMonth || new Date().toISOString().slice(0, 7) });
    if (!result.ok || result.skipped) {
      const reason = result?.error?.message || "不明な理由";
      console.warn("Supabase sync skipped", { reason, result });
      setSyncStatus({ status: "error", message: `同期に失敗しました: ${reason}`, timestamp: new Date().toISOString(), error: true });
      return result;
    }
    setSyncStatus({ status: "synced", message: "同期済み", timestamp: new Date().toISOString(), error: false });
    return result;
  };

  const handleSaveCompany = async () => {
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
      const nextState = {
        ...appState,
        companies: existingCompany ? (appState.companies || []).map((company) => (company.id === companyId ? nextCompany : company)) : [...(appState.companies || []), nextCompany],
        currentCompanyId: companyId,
        companySnapshots: {
          ...(appState.companySnapshots || {}),
          [companyId]: {
            ...(appState.companySnapshots?.[companyId] || createInitialAppState()),
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
      const nextCompany = {
        ...currentCompany,
        stores: existingStore
          ? (currentCompany?.stores || []).map((store) => (store.id === existingStore.id ? nextStore : store))
          : [...(currentCompany?.stores || []), nextStore],
        setup: { ...(currentCompany?.setup || {}), store: true },
      };
      // Renaming a store no longer needs to rekey anything: every per-store/month map is keyed
      // by the store's stable id (buildMonthKey), which a rename never changes. Only the display
      // name embedded in companySnapshots needs updating, alongside its paired selectedStoreId
      // (which was already correct and doesn't change either, but must stay explicitly set here
      // — see applyCompanySnapshot, which restores this pair verbatim on the next company switch).
      const nextState = {
        ...appState,
        companies: (appState.companies || []).map((company) => (company.id === companyId ? nextCompany : company)),
        companySnapshots: {
          ...(appState.companySnapshots || {}),
          [companyId]: {
            ...(appState.companySnapshots?.[companyId] || createInitialAppState()),
            stores: nextCompany.stores.map((store) => store.name),
            selectedStore: nextStore.name,
            selectedStoreId: nextStore.id,
          },
        },
      };
      persistTenantState(nextState);
      setStoreForm(createStoreFormDefaults());
      setStoreEditId("");
      const successMessage = existingStore ? `${nextStore.name} を更新しました` : `${nextStore.name} を追加しました`;
      setStoreFormStatus({ status: "saved", message: successMessage });
    } catch (error) {
      // console.error here (not just the UI notice) so the real cause is visible in devtools
      // even if a future UI change makes the notice easy to miss — this exact failure mode
      // (an error that fired but gave no visible sign anything went wrong) is what prompted
      // adding storeFormStatus in the first place.
      console.error("handleSaveStore failed", error);
      const message = getSupabaseErrorMessage(error);
      setNotice(message);
      setStoreFormStatus({ status: "error", message });
    } finally {
      savingStoreRef.current = false;
    }
  };

  const handleSaveUser = async () => {
    if (!canManageUsers(currentRole)) {
      setNotice("ユーザー招待はシステム管理者・会社管理者・店長が実行できます");
      return;
    }
    if (!userForm.name.trim() || !userForm.email.trim()) return;
    // ボタン連打・二重実行防止(招待フロー整理の要件8)。送信中は早期returnし、Authユーザーの
    // 重複作成につながる同時多重実行を防ぐ。
    if (userFormBusy) return;
    const normalizedEmail = userForm.email.trim().toLowerCase();
    const duplicateUser = (appState.users || []).find((user) => user.email === normalizedEmail);
    if (duplicateUser) {
      // 既存行の状態によってメッセージを出し分ける(招待フロー整理の要件1-2)。
      // 「登録済み」で一律ブロックしていたのが、送信失敗後に同じメールアドレスでもう一度
      // 招待しようとすると誤解を招くメッセージで詰まってしまう不具合の直接の原因だった —
      // まだ登録が完了していない(招待中/メール未送信/期限切れ)場合は、新規に招待を作り直す
      // のではなく既存の行から「再招待」するよう案内する。
      const duplicateStatus = getUserStatusMeta(duplicateUser);
      if (duplicateStatus.key === "active" || duplicateStatus.key === "not_logged_in") {
        setNotice("このメールアドレスはすでに登録済みです");
      } else if (duplicateStatus.key === "suspended") {
        setNotice("このメールアドレスは停止中のユーザーとして登録されています。ユーザー一覧から状態をご確認ください");
      } else {
        setNotice("このメールアドレスへの招待はすでに作成されています(招待待ち)。ユーザー一覧から「再招待」を押して送信し直してください");
      }
      return;
    }
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

    setUserFormBusy(true);
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
      const nextState = {
        ...appState,
        users: [...(appState.users || []), nextUser],
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
          const pendingState = {
            ...appState,
            users: [...(appState.users || []), { ...nextUser, invitationStatus: "pending" }],
          };
          persistTenantState(pendingState);
          setNotice(`${nextUser.name} を招待しましたが、招待メールの送信に失敗しました: ${resolveInviteEmailErrorMessage(emailResult.error)}(「再招待」で送信し直すか、「URLコピー」から招待URLを直接共有できます)`);
          return;
        }
        return;
      }
    } catch (error) {
      setNotice(getSupabaseErrorMessage(error));
    } finally {
      setUserFormBusy(false);
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
      const homeCompanyId = appState.isViewingFranchise ? appState.homeCompanyIdBeforeFranchiseView : appState.currentCompanyId;
      const alreadyPresent = (appState.companies || []).some((company) => company.id === partnerCompanyId);
      const nextCompanies = alreadyPresent
        ? (appState.companies || []).map((company) => (company.id === partnerCompanyId ? { ...company, ...result.company } : company))
        : [...(appState.companies || []), result.company];
      const targetStore = (targetStoreId && activeFranchiseStores.find((store) => store.id === targetStoreId)) || activeFranchiseStores[0];
      const nextState = {
        ...appState,
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
  // すぎない — 保存ハンドラの先頭で呼び、trueが返れば以降の処理を中断する。
  const isFranchiseReadOnlyForCurrentUser = () => appState.isViewingFranchise && normalizeRole(currentRole) !== "system_admin";
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

  const handleEditStore = (store) => {
    setStoreEditId(store.id);
    setStoreForm({
      name: store.name || "",
      postalCode: store.postalCode || "",
      address: store.address || "",
      phone: store.phone || "",
      managerName: store.managerName || "",
      representativeName: store.representativeName || "",
      openingDate: store.openingDate || "",
      openingHour: store.openingHour || "09:00",
      closingHour: store.closingHour || "20:00",
      closedDays: store.closedDays || "月",
      businessHours: store.businessHours || "09:00-20:00",
      description: store.description || "",
      website: store.website || "",
      instagram: store.instagram || "",
      googleMapUrl: store.googleMapUrl || "",
      serviceTypes: (store.serviceTypes || []).join(", "),
      urls: Array.isArray(store.urls) ? store.urls : normalizeStoreUrls(store.urls || []),
      isActive: store.isActive !== false,
      status: store.status || "active",
      staffCount: store.staffCount ? String(store.staffCount) : "",
      productivityStaffCount: store.productivityStaffCount ? String(store.productivityStaffCount) : "",
    });
    setStoreSettingsForm({ ...createStoreSettingsDefaults(), ...(store.settings || {}) });
    focusStoreForm();
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
        }
        const detailsResult = await updateProfileDetails({ profileId: targetUser.id, name: editUserDraft.name.trim(), email: normalizedEmail, isActive: editUserDraft.isActive });
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
      const nextState = {
        ...appState,
        users: (appState.users || []).map((user) => (user.id === targetUser.id
          ? { ...user, name: editUserDraft.name.trim(), email: normalizedEmail, role: nextRole, storeIds: nextStoreIds, primaryStoreId: nextPrimaryStoreId, isActive: editUserDraft.isActive }
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
      const nextState = {
        ...appState,
        users: (appState.users || []).filter((user) => user.id !== targetUser.id),
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
      const nextState = {
        ...appState,
        companies: (appState.companies || []).map((item) => (item.id === company.id ? { ...item, contractStatus: nextStatus, lastUpdatedAt: new Date().toISOString() } : item)),
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
      const nextState = {
        ...appState,
        companies: (appState.companies || []).map((company) => (company.id === target.id ? { ...company, deletedAt, deletedBy: currentUser?.profileId || "", deletionScheduledAt } : company)),
        currentCompanyId: appState.currentCompanyId === target.id ? "" : appState.currentCompanyId,
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
      const nextState = {
        ...appState,
        companies: (appState.companies || []).map((item) => (item.id === company.id ? { ...item, deletedAt: "", deletedBy: "", deletionScheduledAt: "" } : item)),
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
      const nextState = {
        ...appState,
        companies: (appState.companies || []).filter((company) => company.id !== target.id),
        currentCompanyId: appState.currentCompanyId === target.id ? "" : appState.currentCompanyId,
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
      const nextState = {
        ...appState,
        companies: (appState.companies || []).map((item) => (item.id === company.id ? { ...item, freeReason: freeReason || "" } : item)),
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

  const applyStoreStatusLocally = (storeId, status) => {
    const nextCompany = {
      ...currentCompany,
      stores: (currentCompany?.stores || []).map((item) => (item.id === storeId ? { ...item, status, isActive: status !== "archived" } : item)),
    };
    const nextState = {
      ...appState,
      companies: (appState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)),
    };
    persistTenantState(nextState);
  };

  const handleStoreLifecycleAction = async (store, action) => {
    const meta = STORE_LIFECYCLE_ACTIONS[action];
    if (!meta) return;
    if (!window.confirm(meta.confirmMessage(store.name))) return;
    if (isSupabaseConfigured) {
      const result = await updateStoreStatus({ storeId: store.id, action });
      if (!result.ok) {
        setNotice(`${meta.failureMessage}: ${getSupabaseErrorMessage(result.error)}`);
        return;
      }
    }
    applyStoreStatusLocally(store.id, meta.nextStatus);
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
    const duplicateName = `${store.name} コピー`;
    if (!isSupabaseConfigured) {
      const nextCompany = {
        ...currentCompany,
        stores: [...(currentCompany?.stores || []), { ...store, id: `${store.id}-copy-${Date.now()}`, name: duplicateName, code: crypto.randomUUID(), isActive: true, status: "active" }],
      };
      persistTenantState(syncLegacyStoreNamesSnapshot({ ...appState, companies: (appState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)) }, currentCompany?.id, nextCompany.stores));
      return;
    }
    try {
      // A locally-fabricated id here would never exist in the real stores table — every
      // subsequent daily_sales/monthly_targets write for it would fail FK/RLS. Create a real row.
      const createdStore = await createStoreRecord({ companyId: currentCompany?.id, name: duplicateName, code: crypto.randomUUID() });
      const nextStore = { ...store, id: createdStore.id, name: duplicateName, code: createdStore.code, isActive: true, status: "active" };
      const nextCompany = { ...currentCompany, stores: [...(currentCompany?.stores || []), nextStore] };
      persistTenantState(syncLegacyStoreNamesSnapshot({ ...appState, companies: (appState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)) }, currentCompany?.id, nextCompany.stores));
    } catch (error) {
      setNotice(`店舗の複製に失敗しました: ${getSupabaseErrorMessage(error)}`);
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
      const nextCompany = { ...currentCompany, stores: (currentCompany?.stores || []).filter((store) => store.id !== target.id) };
      persistTenantState(syncLegacyStoreNamesSnapshot({ ...appState, companies: (appState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)) }, currentCompany?.id, nextCompany.stores));
      closeHardDeleteModal();
    } finally {
      setHardDeleteSaving(false);
    }
  };

  const handleToggleUserStatus = async (user) => {
    if (!window.confirm(`${user.name} を${user.isActive ? "利用停止" : "再開"}しますか？`)) return;
    if (togglingStatusUserId === user.id) return;
    const nextActive = !user.isActive;
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
      }
      const nextState = {
        ...appState,
        users: (appState.users || []).map((item) => item.id === user.id ? { ...item, isActive: nextActive } : item),
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
    const nextState = {
      ...appState,
      companies: (appState.companies || []).map((company) => company.id === currentCompany?.id ? {
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

  const applyDailyFieldPreset = (presetKey) => {
    setDailyFieldDraft({ mode: presetKey, fields: { ...dailyFieldPresets[presetKey] } });
    setDailyFieldDirty(true);
  };

  const updateDailyFieldToggle = (fieldKey, value) => {
    setDailyFieldDraft((prev) => ({ mode: "custom", fields: { ...prev.fields, [fieldKey]: value } }));
    setDailyFieldDirty(true);
  };

  const mirrorDailyFieldSettingsIntoAppState = (storeId, settings) => {
    setAppState((prev) => ({
      ...prev,
      companies: (prev.companies || []).map((company) => ({
        ...company,
        stores: (company.stores || []).map((store) => (
          (storeId ? store.id === storeId : store.name === selectedStore)
            ? { ...store, settings: { ...(store.settings || createStoreSettingsDefaults()), dailyFieldSettings: settings } }
            : store
        )),
      })),
    }));
  };

  const handleSaveDailyFieldSettings = async () => {
    if (guardFranchiseReadOnly()) return;
    if (!selectedStore) {
      setNotice("店舗を先に追加してください");
      return;
    }
    if (!isSupabaseConfigured) {
      mirrorDailyFieldSettingsIntoAppState(null, dailyFieldDraft);
      setDailyFieldDirty(false);
      setDailyFieldSaveStatus({ status: "saved", message: "保存しました（ローカル）" });
      return;
    }
    const { store } = resolveTargetCompanyAndStore();
    if (!store?.id) {
      setDailyFieldSaveStatus({ status: "error", message: "店舗情報を確認できませんでした" });
      setNotice("店舗情報を確認できませんでした");
      return;
    }

    setDailyFieldSaveStatus({ status: "saving", message: "保存中…" });
    try {
      // store_input_settings is the authoritative field-visibility table now (see
      // 20260807000000_create_store_input_settings.sql); it's what hydrateFromSupabase reads
      // back. updateStoreDailyFieldSettings (the old stores.daily_field_settings column) is
      // left as-is rather than deleted, so nothing that ever read that column directly loses
      // its last-known value, but this save path no longer needs to write it too.
      const result = await upsertStoreInputSettings({ companyId: appState.currentCompanyId, storeId: store.id, dailyFields: dailyFieldDraft });
      if (!result?.ok) {
        throw new Error(result?.error?.message || "保存に失敗しました");
      }
      mirrorDailyFieldSettingsIntoAppState(store.id, dailyFieldDraft);
      setDailyFieldDirty(false);
      setDailyFieldSaveStatus({ status: "saved", message: "保存しました" });
    } catch (error) {
      const reason = resolveErrorReason(error, "保存に失敗しました");
      setDailyFieldSaveStatus({ status: "error", message: reason });
      setNotice(`日次入力項目設定の保存に失敗しました: ${reason}`);
    }
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

  // 「在庫管理を使う」トグル(店舗単位、store_input_settings.use_inventory_tracking)。単一の
  // ON/OFFなので他の項目設定のようなdraft/dirty管理は持たず、切り替え次第すぐ保存する。
  const handleToggleInventoryTracking = async (checked) => {
    if (guardFranchiseReadOnly()) return;
    const { store } = resolveTargetCompanyAndStore();
    if (!store?.id) {
      setNotice("店舗情報を確認できませんでした");
      return;
    }
    if (isSupabaseConfigured) {
      const result = await upsertStoreInputSettings({ companyId: appState.currentCompanyId, storeId: store.id, useInventoryTracking: checked });
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
            ? { ...s, settings: { ...(s.settings || createStoreSettingsDefaults()), useInventoryTracking: checked } }
            : s
        )),
      })),
    }));
  };

  // 「日計管理を使う」トグル(店舗単位、store_input_settings.use_cash_breakdown)。在庫管理と
  // 同じ単純なON/OFFなのでdraft/dirty管理は持たず、切り替え次第すぐ保存する。初期値は必ず
  // OFF(createStoreSettingsDefaults参照)。
  const handleToggleCashBreakdown = async (checked) => {
    if (guardFranchiseReadOnly()) return;
    const { store } = resolveTargetCompanyAndStore();
    if (!store?.id) {
      setNotice("店舗情報を確認できませんでした");
      return;
    }
    if (isSupabaseConfigured) {
      const result = await upsertStoreInputSettings({ companyId: appState.currentCompanyId, storeId: store.id, useCashBreakdown: checked });
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
            ? { ...s, settings: { ...(s.settings || createStoreSettingsDefaults()), useCashBreakdown: checked } }
            : s
        )),
      })),
    }));
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
      const nextState = {
        ...appState,
        users: (appState.users || []).map((item) => item.id === user.id ? { ...item, invitationStatus: "invited", inviteToken: inviteTokenValue, inviteLink, inviteExpiresAt } : item),
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
        // "pending"(メール未送信)に更新済み — ローカル状態もそれに合わせる。
        persistTenantState({
          ...nextState,
          users: (nextState.users || []).map((item) => item.id === user.id ? { ...item, invitationStatus: "pending" } : item),
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
        persistTenantState({
          ...appState,
          users: (appState.users || []).map((item) => item.id === user.id
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

    const safeState = {
      ...appState,
      companySnapshots: Object.fromEntries(Object.entries(appState.companySnapshots || {}).map(([key, value]) => [key, {
        ...(value || {}),
        companySnapshots: undefined,
      }]))
    };
    const snapshot = JSON.stringify(safeState);
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
      tenantState: appState,
    });
  }, [authMode, currentUser?.authUserId, currentUser?.profileId, appState.currentCompanyId, appState.selectedStore, appState.selectedMonth, currentRole]);

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
    const key = buildMonthKey(selectedStoreId, selectedMonth);
    const existing = appState.cashBreakdownResults?.[key]?.[dailyForm.date];
    const nextForm = existing
      ? { cashAmount: existing.cashAmount, cashlessAmount: existing.cashlessAmount, pointAmount: existing.pointAmount }
      : { cashAmount: "", cashlessAmount: "", pointAmount: "" };
    setCashBreakdownForm(nextForm);
    lastCashBreakdownAutoSaveSignatureRef.current = getCashBreakdownAutoSaveSignature(nextForm);
  }, [dailyForm.date, selectedStoreId, selectedMonth, appState.cashBreakdownResults]);

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
  }, [authMode, currentUser?.authUserId, currentUser?.profileId, appState.currentCompanyId, appState.selectedStore, appState.selectedMonth, currentRole]);

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
  }, [selectedMonth, selectedStore]);

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

    const existingEntry = dailyEntries.find((entry) => entry.date === dailyForm.date) || null;
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

      const key = buildMonthKey(selectedStoreId, selectedMonth);
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
      setDailyInsight(buildDailyInsight({ form: entry, target, businessDayCount: businessDaySummary.businessDayCount || 0 }));
      lastAutoSaveSignatureRef.current = getDailyAutoSaveSignature(entry);
      persistSaveStatus("saved", "保存済み ✓", false);
      return { ok: true, data: entry, autoSave };
    } catch (error) {
      logSupabaseError({ operation: "saveDailyEntry", table: "daily_sales", userId: appState.currentUserId, companyId: appState.currentCompanyId, storeId: store?.id, businessDate: dailyForm.date, error });
      const reason = getSupabaseErrorMessage(error);
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

      const key = buildMonthKey(selectedStoreId, selectedMonth);
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
        setTargetSaveStatus({ status: "saved", message: `保存しました（ローカル） / 全店舗 ${savedMonthLabel}` });
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
        setTargetSaveStatus({ status: "saved", message: `保存しました / 全店舗 ${savedMonthLabel}` });
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

    const savedStoreName = selectedStore;
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
      setTargetSaveStatus({ status: "saved", message: `保存しました（ローカル） / ${savedStoreName} ${savedMonthLabel}` });
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
      setTargetSaveStatus({ status: "saved", message: `保存しました / ${savedStoreName} ${savedMonthLabel}` });
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
    const existingEntry = dailyEntries.find((entry) => entry.date === nextDate) || null;

    if (existingEntry) {
      // Load totalSales exactly as stored — recomputing it from technicalSales+retailSales
      // here would zero out a legacy total-sales-only entry the instant it's opened, before
      // the user has touched anything (updateDailyField is what re-derives it live once the
      // user actually edits technicalSales/retailSales).
      setDailyForm({ ...existingEntry });
      setDailyMode("view");
      setDailyOriginalEntry({ ...existingEntry });
      setDailyInsight(buildDailyInsight({ form: existingEntry, target, businessDayCount: businessDaySummary.businessDayCount || 0 }));
      return;
    }

    setDailyForm({ ...defaultDailyEntry, date: nextDate });
    setDailyMode("create");
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

  const startNewDailyEntry = () => {
    const defaultValue = { ...defaultDailyEntry, date: dailyForm.date || "" };
    setDailyForm(defaultValue);
    setDailyMode("create");
    setDailyOriginalEntry(null);
    setDailyInsight("");
  };

  const editDailyEntry = () => {
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
    const isEditing = Boolean(fixedForm.id);
    if (!fixedForm.name) {
      setNotice("費用名は必須です");
      return;
    }
    if (!isEditing && !fixedForm.amount) {
      setNotice("金額は必須です");
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
    const nextItem = { id: itemId, name: fixedForm.name, category: fixedForm.category || "", categoryKey: fixedForm.categoryKey, memo: fixedForm.memo || "", periodType, startMonth, endMonth };

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

    // 新規登録時だけ、入力された金額をこの項目の対象月(selectedMonth)の初回金額として保存する。
    // 編集時はこのフォームに金額欄自体を出していない(月次一覧側でのみ金額を編集する)ので触らない。
    if (!isEditing && fixedForm.amount) {
      await persistCostMonthlyAmount({ costItemId: itemId, targetMonth: selectedMonth, amount: fixedForm.amount });
    }

    setFixedForm({ ...defaultFixedCostItem, startMonth: selectedMonth });
  };

  const editFixedCost = (item) => {
    setFixedForm({ ...defaultFixedCostItem, ...item, amount: "" });
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
    setAppState((prev) => {
      // Same reasoning as submitFixedCost above: the item being removed may live under a
      // different month-key than whichever month is currently on screen (it could be a
      // continuing cost carried forward from an earlier startMonth).
      const nextFixedCosts = { ...prev.fixedCosts };
      Object.keys(nextFixedCosts).forEach((existingKey) => {
        if (existingKey.startsWith(`${prev.selectedStoreId}__`)) {
          nextFixedCosts[existingKey] = (nextFixedCosts[existingKey] || []).filter((item) => item.id !== itemId);
        }
      });
      // Its cost_monthly_amounts rows cascade-delete in Supabase (FK on delete cascade); drop the
      // matching local entries too so a deleted item's old amounts don't linger in memory.
      const nextCostMonthlyAmounts = { ...prev.costMonthlyAmounts };
      Object.keys(nextCostMonthlyAmounts).forEach((existingKey) => {
        if (existingKey.startsWith(`${itemId}__`)) delete nextCostMonthlyAmounts[existingKey];
      });
      return { ...prev, fixedCosts: nextFixedCosts, costMonthlyAmounts: nextCostMonthlyAmounts };
    });
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
      setNotice("期首在庫の金額を入力してください");
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
    if (!selectedStore || !dailyForm.date) {
      setNotice("締め対象の日付を入力してください");
      return;
    }
    if (isHolidayDate(getStoreHolidayDates(appState, selectedStoreId, dailyForm.date.slice(0, 7)), dailyForm.date)) {
      setNotice("この日は店休日のため日締めできません");
      return;
    }
    const todayIso = new Date().toISOString().slice(0, 10);
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

    const key = buildMonthKey(selectedStoreId, selectedMonth);

    const { store } = resolveTargetCompanyAndStore();
    if (isSupabaseConfigured && !store?.id) {
      const message = "店舗情報を確認できませんでした";
      logSupabaseError({ operation: "toggleDayClosing", table: "daily_sales", userId: appState.currentUserId, companyId: appState.currentCompanyId, businessDate: dailyForm.date, error: new Error(message) });
      persistSaveStatus("error", message, true);
      setNotice(message);
      return;
    }

    persistSaveStatus("saving", "保存中…", false);
    const remoteResult = await updateDailySalesClosingState({
      companyId: appState.currentCompanyId,
      storeId: store?.id,
      businessDate: dailyForm.date,
      userId: appState.currentUserId,
      entry: dailyForm,
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

  if (!currentUser && !authLoading) {
    return <LoginScreen mode={authMode} onModeChange={handleModeChange} onSubmit={handleLogin} onSignUp={handleSignUp} onResetPassword={handleResetPassword} onSetNewPassword={handleSetNewPassword} loading={authLoading} error={authError} success={authSuccess} inviteEmail={inviteToken ? inviteEmail : ""} />;
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
                  <button className="primary-button" type="button" onClick={handleSaveCompany}>会社情報を保存</button>
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
                  <button className="primary-button" type="button" onClick={handleSaveUser}>管理者を登録</button>
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
                  onClick={() => { setActivePage(item.id); setMobileNavOpen(false); }}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="sidebar-footer" />
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-heading">
            <button
              type="button"
              className="secondary-button mobile-nav-toggle"
              aria-expanded={mobileNavOpen}
              aria-controls="primary-nav"
              aria-label={mobileNavOpen ? "メニューを閉じる" : "メニューを開く"}
              onClick={() => setMobileNavOpen((prev) => !prev)}
            >
              <span aria-hidden="true">{mobileNavOpen ? "✕" : "☰"}</span>
            </button>
            <div>
              <p className="eyebrow">SALON MANAGEMENT</p>
              <h1>{activePage === "dashboard" ? "売上" : activePage === "monthlyDashboard" ? "月次ダッシュボード" : activePage === "daily" ? "日次入力" : activePage === "monthly" ? "管理画面" : activePage === "companies" ? "会社管理" : activePage === "stores" ? "店舗管理" : activePage === "users" ? "ユーザー管理" : activePage === "franchise" ? "加盟店連携" : activePage === "faq" ? "使い方・FAQ" : "設定"}</h1>
              {currentUser ? (
                <div className="user-role-badge" style={{ marginTop: 6 }}>
                  {currentUser?.role || currentRole === "system_admin" ? "管理者" : currentRole}
                </div>
              ) : null}
            </div>
          </div>

          <div className="filters">
            {/* 店舗切替一覧: 自社店舗と加盟店(承認済みのみ)を同じ<select>から選べるように
                する(別々のセレクタに分けない)。加盟店を閲覧中でも、自社の「全店舗」・
                自社の各店舗は常にこの一覧の上部に表示され続けるため、追加のバナーや
                「本社に戻る」ボタンを設けなくても、この<select>だけで本社・加盟店を
                行き来できる。自社欄はhomeStoresForDropdown(閲覧状態に左右されない、
                常に本社を指す参照)から描画するため、加盟店を開いた後も消えない。
                加盟店側は"──── 加盟店 ────"という視覚的な区切り(optgroup)の下に、
                会社名+店舗名で店舗単位で列挙する(自社店舗と同じ「1店舗を選ぶ」扱いにする
                ため — 会社単位で1行にして全店舗ビューを開く仕様だと、損益表・月締め・
                費用入力等の単一店舗前提ページが軒並み弾かれてしまっていた)。承認済み
                (status='approved')の連携だけが対象のため、pending/rejected/disconnectedの
                加盟店はここに一切出てこない。 */}
            <label>
              店舗
              <select
                value={appState.isViewingFranchise ? `__franchise__:${appState.currentCompanyId}:${appState.selectedStoreId || ""}` : selectedStore}
                onChange={(event) => handleUnifiedStoreSwitch(event.target.value)}
                disabled={franchiseViewBusy}
              >
                {canViewAllStores(currentRole) ? <option value={ALL_STORES_VALUE}>全店舗</option> : null}
                {homeStoresForDropdown.length ? homeStoresForDropdown.map((store) => <option key={store.id} value={store.name}>{store.name}</option>) : <option value="">未登録</option>}
                {viewableFranchisePartnerStores.length > 0 ? (
                  <optgroup label="──── 加盟店 ────">
                    {viewableFranchisePartnerStores.map((item) => (
                      <option key={`${item.companyId}:${item.storeId}`} value={`__franchise__:${item.companyId}:${item.storeId}`}>{item.companyName} {item.storeName}</option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={handleLogout}>ログアウト</button>
            <label>
              対象月
              <input type="month" value={ensureMonthValue(selectedMonth)} onChange={(event) => handleMonthSwitch(event.target.value)} />
            </label>
          </div>
        </header>

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
        {/* このnoticeは「成功しました」等の完了通知には使わない — 画面上部にはエラーのみ
            表示する(誤操作でデータを失わないための警告や、対応が必要な保存失敗など)。
            成功・完了の確認は、各操作の近く(保存ステータスチップ・ボタンラベル等)に留める。 */}
        {notice ? <div className="notice-box error">{notice}</div> : null}
        {activePage === "dashboard" && (
          <div className="dashboard-layout">
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
                <div className="business-progress-grid">
                  <div><span>今月営業日数</span><strong>{businessDaySummary.businessDayCount ? `${businessDaySummary.businessDayCount}日` : "未設定"}</strong></div>
                  <div><span>営業完了</span><strong>{businessDaySummary.completedDays}日</strong></div>
                  <div><span>残り営業日</span><strong>{businessDaySummary.remainingBusinessDays === null ? "未設定" : `${businessDaySummary.remainingBusinessDays}日`}</strong></div>
                  <div><span>総売上</span><strong>{money(summary.sales)}</strong></div>
                  <div><span>1日平均売上</span><strong>{money(summary.averageDailySales)}</strong></div>
                  <div><span>顧客数</span><strong>{number(summary.customers)}名</strong></div>
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
                  auto-flowでそのまま整う。 */}
              <div className="kpi-hero-grid">
                {!hasAnyTarget ? <TargetSetupHint onGoToTarget={goToMonthlyTargetSetting} /> : null}
                {hasSalesTarget ? (
                  <MetricCard
                    label="月間達成率"
                    value={percent(summary.targetAchievement)}
                    secondaryValue={`目標売上まで ${money(summary.remainingSalesTarget)}`}
                    tone={summary.remainingSalesTarget === 0 ? "good" : getMetricTone(summary.targetAchievement, 85, 100)}
                    emphasize
                    hero
                    onClick={goToMonthlyTargetSetting}
                  />
                ) : null}
                <MetricCard
                  label="月末着地予測"
                  value={money(summary.forecast)}
                  hint={hasSalesTarget
                    ? <span className={forecastVsTarget >= 0 ? "text-success" : "text-danger"}>{`目標より${forecastVsTarget >= 0 ? "＋" : "▲"}${money(Math.abs(forecastVsTarget))}`}</span>
                    : null}
                  tone={hasSalesTarget ? (forecastVsTarget >= 0 ? "good" : "warning") : ""}
                />
                {hasCustomerTarget ? (
                  <MetricCard
                    label="客数達成率"
                    value={percent(customerTargetSummary.achievementRate)}
                    secondaryValue={`目標まで ${customerTargetSummary.remainingCustomers}名`}
                    hint={`必要客数 ${customerTargetSummary.remainingCustomersPerDay.toFixed(1)}名/日`}
                    tone={getMetricTone(customerTargetSummary.achievementRate, 85, 100)}
                  />
                ) : null}
                {effectiveShowReviewCountField ? (
                  <MetricCard
                    label="口コミ数"
                    value={showReviewCountTargetField && hasReviewCountTarget
                      ? `${number(summary.reviewCount)}件 / ${number(summary.reviewCountTarget)}件`
                      : `${number(summary.reviewCount)}件`}
                    hint={showReviewCountTargetField && hasReviewCountTarget ? `達成率 ${percent(summary.reviewCountAchievement)}` : null}
                    tone={showReviewCountTargetField && hasReviewCountTarget ? getMetricTone(summary.reviewCountAchievement, 85, 100) : ""}
                  />
                ) : null}
                {dashboardSupportMetrics.map((item) => <MetricCard key={item.label} label={item.label} value={item.value} hint={item.hint} />)}
              </div>
              </div>
              {currentCompany && aiAnalysisSettings[currentCompany.id] ? <AiAssistantCard onOpen={() => openAiChat()} onQuickQuestion={(question) => openAiChat(question)} /> : null}
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
                  <p className="helper-text">緑=登録店舗すべての日締めが完了した日／赤=全店舗の店休日／通常色=まだ全店舗の日締めが揃っていない営業日。会社全体の営業状況確認用です。</p>
                  <BusinessCalendarGrid
                    monthValue={selectedMonth}
                    closedDates={businessDaySummary.closedDates}
                    holidayDates={businessDaySummary.holidayDates}
                    todayIso={formatLocalDate(new Date())}
                  />
                </div>
              ) : null}
            </section>

            <div className="dashboard-right-column">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">RANKING</p>
                  <h2>店舗売上ランキング</h2>
                </div>
              </div>
              {stores.length === 0 ? (
                <div className="empty-card">店舗を追加してください。</div>
              ) : (
                <div className="ranking-list">
                  {rankingRows.map((row) => (
                    <div key={row.storeId} className="ranking-row">
                      <div className="ranking-row-rank">{row.currentRank === 1 ? "🥇" : row.currentRank === 2 ? "🥈" : row.currentRank === 3 ? "🥉" : row.currentRank}</div>
                      <div className="ranking-row-main">
                        <span className="ranking-row-name">{row.storeName}</span>
                        <strong className="ranking-row-sales">{money(row.sales)}</strong>
                      </div>
                      <small className="ranking-row-previous">先月 {row.hasPreviousSales ? money(row.previousSales) : "－"}</small>
                    </div>
                  ))}
                </div>
              )}
            </section>
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
          <div className="stack">
            {!selectedStore ? (
              <div className="empty-card">店舗を追加してから日次入力を始めてください。</div>
            ) : isAllStoresView ? (
              <div className="empty-card">全店舗ビューでは日次入力はできません。実績は登録店舗ごとの日締め済みデータから自動集計されます。入力する場合は店舗を選択してください。</div>
            ) : (
              <>
                {selectedStoreEntity?.status === "suspended" && (
                  <div className="notice-box warning">この店舗は現在停止中です。新規の売上・日次入力はできません(過去のデータは引き続き確認できます)。「店舗管理」から運営を再開できます。</div>
                )}
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">DAILY</p>
                      <h2>売上入力</h2>
                    </div>
                  </div>

                  <div className="daily-progress-card">
                    <div className="business-progress-header compact">
                      <div>
                        <p className="eyebrow">PROGRESS</p>
                        <h3>営業進捗</h3>
                      </div>
                      <span className={`status-chip ${businessDaySummary.progressRate === null ? "neutral" : businessDaySummary.progressRate >= 100 ? "good" : businessDaySummary.progressRate >= 50 ? "warning" : "danger"}`}>
                        {businessDaySummary.progressRate === null ? "未設定" : `${Math.round(businessDaySummary.progressRate)}%`}
                      </span>
                    </div>
                    <div className="daily-progress-main">
                      <div className="daily-progress-value">{businessDaySummary.completedDays ?? 0} / {businessDaySummary.businessDayCount ?? 0}日</div>
                      <div className="daily-progress-meta">残り{businessDaySummary.remainingBusinessDays === null ? "-" : businessDaySummary.remainingBusinessDays}営業日</div>
                    </div>
                  </div>

                  <div className="button-row">
                    <button className="secondary-button" type="button" onClick={startManualBusinessDayEdit}>営業日設定</button>
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

                  <div className="button-row">
                    <button className="secondary-button" type="button" onClick={startNewDailyEntry}>新規入力</button>
                    <button className="secondary-button" type="button" onClick={editDailyEntry} disabled={!dailyForm.id || dailyMode === "edit" || isDailyEntryLockedForStaff}>編集</button>
                    <button className="secondary-button" type="button" onClick={cancelDailyEntryEdit}>キャンセル</button>
                    <button className="secondary-button" type="button" onClick={toggleDayClosing} disabled={isDailyFormDateHoliday || isDailyEntryLockedForStaff}>{isSelectedDailyEntryClosed ? "日締めを解除" : "日締め"}</button>
                  </div>

                  {isDailyFormDateHoliday ? (
                    <div className="notice-box">
                      この日（{dailyForm.date}）は店休日です。日次入力・保存・日締めはできません。
                    </div>
                  ) : null}
                  {isDailyEntryLockedForStaff ? (
                    <div className="notice-box">
                      この日は日締め済みのため編集・削除できません。修正が必要な場合は店長以上にご連絡ください。
                    </div>
                  ) : null}

                  <form id="daily-form" className="daily-form-grid" onSubmit={submitDailyEntry}>
                    <div className="daily-section-card">
                      <h3>基本情報</h3>
                      <label className="field">
                        <span>店舗</span>
                        <select
                          value={appState.isViewingFranchise ? `__franchise__:${appState.currentCompanyId}:${appState.selectedStoreId || ""}` : selectedStore}
                          onChange={(event) => handleUnifiedStoreSwitch(event.target.value)}
                          disabled={franchiseViewBusy}
                        >
                          {canViewAllStores(currentRole) ? <option value={ALL_STORES_VALUE}>全店舗</option> : null}
                          {homeStoresForDropdown.length ? homeStoresForDropdown.map((store) => <option key={store.id} value={store.name}>{store.name}</option>) : <option value="">未登録</option>}
                          {viewableFranchisePartnerStores.length > 0 ? (
                            <optgroup label="──── 加盟店 ────">
                              {viewableFranchisePartnerStores.map((item) => (
                                <option key={`${item.companyId}:${item.storeId}`} value={`__franchise__:${item.companyId}:${item.storeId}`}>{item.companyName} {item.storeName}</option>
                              ))}
                            </optgroup>
                          ) : null}
                        </select>
                      </label>
                      <Field label="対象日" type="date" value={dailyForm.date} onChange={(value) => handleDailyDateChange(value)} disabled={dailyMode === "view"} />
                      <div className="field">
                        <span>日締め状態</span>
                        <div className={`value-pill ${isSelectedDailyEntryClosed ? "active" : "inactive"}`}>
                          {isSelectedDailyEntryClosed ? "締め済み" : "未締め"}
                        </div>
                      </div>
                    </div>

                    {isDailyFormDateHoliday ? null : (
                    <>
                    <div className="daily-section-card">
                      <h3>売上入力</h3>
                      {/* value={x || ""}, not value={x}: an untouched field is "" or a loaded
                          0 (both falsy) and must show blank, not literal "0"; the moment the
                          user types "0" it's the non-empty *string* "0" (truthy) and displays
                          correctly. Save-time parseNumber()/buildDailyEntryPayload treat "" and
                          0 identically, so totals/KPIs/progress are never affected — this is
                          display-only. */}
                      {showTechnicalSalesField ? <Field label="技術売上（税込）" value={dailyForm.technicalSales || ""} onChange={(value) => updateDailyField("technicalSales", value)} suffix="円" placeholder="金額を入力" disabled={dailyMode === "view"} numeric /> : null}
                      {showRetailSalesField ? <Field label="店販売上（税込）" value={dailyForm.retailSales || ""} onChange={(value) => updateDailyField("retailSales", value)} suffix="円" placeholder="金額を入力" disabled={dailyMode === "view"} numeric /> : null}
                      {showOtherSalesField ? <Field label="その他売上（税込）" value={dailyForm.otherSales || ""} onChange={(value) => updateDailyField("otherSales", value)} suffix="円" placeholder="金額を入力" disabled={dailyMode === "view"} numeric /> : null}
                      {totalSalesIsAutoCalculated ? (
                        <div className="summary-card compact">
                          <span>総売上（税込）</span>
                          <strong>{money(parseNumber(dailyForm.totalSales))}</strong>
                        </div>
                      ) : (
                        <Field label="総売上（税込）" value={dailyForm.totalSales || ""} onChange={(value) => updateDailyField("totalSales", value)} suffix="円" placeholder="金額を入力" disabled={dailyMode === "view"} numeric />
                      )}
                    </div>

                    {showCustomersField ? (
                      <div className="daily-section-card">
                        <h3>客数</h3>
                        {/* 総売上と同じ考え方: 入力項目(新規・再来)を先に並べ、自動合計される
                            客数は結果として一番下に置く(要件: どこが入力でどこが自動計算か
                            直感的に分かるように)。 */}
                        {showNewCustomersField ? <Field label="新規客数" value={dailyForm.newCustomers || ""} onChange={(value) => updateDailyField("newCustomers", value)} suffix="名" placeholder="人数を入力" disabled={dailyMode === "view"} numeric /> : null}
                        {showRepeatCustomersField ? <Field label="再来客数" value={dailyForm.repeatCustomers || ""} onChange={(value) => updateDailyField("repeatCustomers", value)} suffix="名" placeholder="人数を入力" disabled={dailyMode === "view"} numeric /> : null}
                        {customersIsAutoCalculated ? (
                          <div className="summary-card compact">
                            <span>客数</span>
                            <strong>{number(parseNumber(dailyForm.customers))}名</strong>
                          </div>
                        ) : (
                          <Field label="客数" value={dailyForm.customers || ""} onChange={(value) => updateDailyField("customers", value)} suffix="名" placeholder="人数を入力" disabled={dailyMode === "view"} numeric />
                        )}
                      </div>
                    ) : null}

                    {useCashBreakdown ? (
                      <details className="daily-section-card cash-breakdown-card" open>
                        <summary className="cash-breakdown-summary">
                          <h3>日計</h3>
                          {cashBreakdownHasAnyValue ? (
                            <span className={`cash-breakdown-summary-pill ${cashBreakdownIsMatched ? "match" : "mismatch"}`}>
                              日計{"　"}{money(cashBreakdownTotal)}{"　"}{cashBreakdownIsMatched ? "✓" : `差額 ${money(Math.abs(cashBreakdownDiff))}`}
                            </span>
                          ) : null}
                        </summary>
                        <div className="cash-breakdown-body">
                          <Field label="現金" value={cashBreakdownForm.cashAmount || ""} onChange={(value) => updateCashBreakdownField("cashAmount", value)} suffix="円" placeholder="金額を入力" disabled={dailyMode === "view"} numeric />
                          <Field label="キャッシュレス" value={cashBreakdownForm.cashlessAmount || ""} onChange={(value) => updateCashBreakdownField("cashlessAmount", value)} suffix="円" placeholder="金額を入力" disabled={dailyMode === "view"} numeric />
                          <Field label="ポイント利用" value={cashBreakdownForm.pointAmount || ""} onChange={(value) => updateCashBreakdownField("pointAmount", value)} suffix="円" placeholder="金額を入力" disabled={dailyMode === "view"} numeric />
                          <div className="summary-card compact">
                            <span>日計合計</span>
                            <strong>{money(cashBreakdownTotal)}</strong>
                          </div>
                          {cashBreakdownHasAnyValue ? (
                            <div className={`value-pill ${cashBreakdownIsMatched ? "active" : "inactive"}`}>
                              {cashBreakdownIsMatched ? "✓ 日計一致" : `差額 ${money(Math.abs(cashBreakdownDiff))}`}
                            </div>
                          ) : null}
                          <button type="button" className="text-button" onClick={() => setShowCashBreakdownMonthly(true)}>月別日計を見る</button>
                        </div>
                      </details>
                    ) : null}

                    {showReviewCountField ? (
                      <div className="daily-section-card">
                        <h3>口コミ</h3>
                        <Field label="口コミ数" value={dailyForm.reviewCount || ""} onChange={(value) => updateDailyField("reviewCount", value)} suffix="件" placeholder="件数を入力" disabled={dailyMode === "view"} numeric />
                      </div>
                    ) : null}

                    {showMemoField ? (
                      <div className="daily-section-card">
                        <h3>メモ</h3>
                        <label className="field">
                          <span>メモ</span>
                          <textarea value={dailyForm.memo || ""} onChange={(event) => setDailyForm((prev) => ({ ...prev, memo: event.target.value }))} disabled={dailyMode === "view"} rows={3} />
                        </label>
                      </div>
                    ) : null}
                    </>
                    )}
                  </form>

                  <div className="helper-text">必要な数字だけ入力すれば、客単価・店販率・新規率・再来率は自動計算されます。</div>
                  {dailyMode === "view" && dailyOriginalEntry ? (
                    <div className="preview-card">
                      <strong>入力済みの内容</strong>
                      <small>日付 {dailyOriginalEntry.date} / 総売上 {money(dailyOriginalEntry.totalSales || 0)} / 客数 {dailyOriginalEntry.customers || 0}名</small>
                    </div>
                  ) : null}

                  <div className="kpi-grid compact-grid">
                    {showCustomersField ? <MetricCard label="客単価" value={money(dailyEffectiveCustomers ? dailyEffectiveTotalSales / dailyEffectiveCustomers : 0)} /> : null}
                    {totalSalesIsAutoCalculated ? <MetricCard label="店販率" value={percent(dailyEffectiveTotalSales ? (parseNumber(dailyForm.retailSales) / dailyEffectiveTotalSales) * 100 : 0)} /> : null}
                    {showNewCustomersField ? <MetricCard label="新規率" value={percent(dailyEffectiveCustomers ? (parseNumber(dailyForm.newCustomers) / dailyEffectiveCustomers) * 100 : 0)} /> : null}
                    {showRepeatCustomersField ? <MetricCard label="再来率" value={percent(dailyEffectiveCustomers ? (parseNumber(dailyForm.repeatCustomers) / dailyEffectiveCustomers) * 100 : 0)} /> : null}
                  </div>

                  {currentCompany && aiAnalysisSettings[currentCompany.id] ? (
                    <div className="insight-card">
                      <p className="eyebrow">今日のAI分析</p>
                      <strong>{dailyInsight || "分析に必要なデータが不足しています"}</strong>
                    </div>
                  ) : null}

                  <div className="calendar-card">
                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">CALENDAR</p>
                        <h3>月カレンダー</h3>
                      </div>
                    </div>
                    <p className="helper-text">緑=日締め完了／赤=店休日／通常色=未締めの営業日。日付をクリックすると対象日を選択できます。</p>
                    <BusinessCalendarGrid
                      monthValue={selectedMonth}
                      closedDates={businessDaySummary.closedDates}
                      holidayDates={businessDaySummary.holidayDates}
                      todayIso={formatLocalDate(new Date())}
                      onDayClick={(iso) => handleDailyDateChange(iso)}
                    />
                  </div>
                </section>

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
            <div className="subnav">
              {monthlyTabs.map((tab) => (
                <button key={tab.id} className={activeMonthlyTab === tab.id ? "subnav-button active" : "subnav-button"} onClick={() => setActiveMonthlyTab(tab.id)}>
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
                {activeMonthlyTab === "target" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">TARGET</p>
                        <h2>{isAllStoresView ? "全店舗目標設定" : "月間目標設定"}</h2>
                      </div>
                    </div>
                    {isAllStoresView ? (
                      <p className="helper-text">会社全体の目標として保存されます。各店舗の月間目標は変更されません。休業日はここで設定した値が全店舗共通の営業日数として使われます(店舗ごとの休業日数の合計ではありません)。</p>
                    ) : null}
                    <div className="filters">
                      <label className="field">
                        <span>対象年</span>
                        <select
                          value={targetSelectedMonth.slice(0, 4)}
                          onChange={(event) => handleTargetMonthChange(`${event.target.value}-${targetSelectedMonth.slice(5, 7)}`)}
                        >
                          {targetYearOptions.map((year) => <option key={year} value={year}>{year}年</option>)}
                        </select>
                      </label>
                      <label className="field">
                        <span>対象月</span>
                        <select
                          value={targetSelectedMonth.slice(5, 7)}
                          onChange={(event) => handleTargetMonthChange(`${targetSelectedMonth.slice(0, 4)}-${event.target.value}`)}
                        >
                          {targetMonthOptions.map((month) => <option key={month} value={month}>{Number(month)}月</option>)}
                        </select>
                      </label>
                      <div className="value-pill">{formatMonthLabel(targetSelectedMonth)}</div>
                    </div>

                    {targetLoadStatus.status === "loading" ? (
                      <div className="empty-card">読み込み中…</div>
                    ) : (
                      <>
                        <div className="input-grid">
                          {activeMonthlyTargetFieldSettings.fields.targetSales ? <Field label="月間目標売上（税込）" value={targetDraft.targetSales} onChange={(value) => updateTargetDraftField("targetSales", value)} suffix="円" numeric /> : null}
                          {!isAllStoresView && activeMonthlyTargetFieldSettings.fields.holidayCount ? <Field label="休業日" value={targetHolidayDraft} onChange={(value) => { setTargetHolidayDraft(value); setTargetDirty(true); }} suffix="日" numeric /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetTechnicalSales ? <Field label="技術売上目標（税込）" value={targetDraft.targetTechnicalSales} onChange={(value) => updateTargetDraftField("targetTechnicalSales", value)} suffix="円" numeric /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetRetailSales ? <Field label="店販売上目標（税込）" value={targetDraft.targetRetailSales} onChange={(value) => updateTargetDraftField("targetRetailSales", value)} suffix="円" numeric /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetCustomers ? <Field label="客数目標" value={targetDraft.targetCustomers} onChange={(value) => updateTargetDraftField("targetCustomers", value)} suffix="名" numeric /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetAverageSpend ? <Field label="客単価目標" value={targetDraft.targetAverageSpend} onChange={(value) => updateTargetDraftField("targetAverageSpend", value)} suffix="円" numeric /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetNewCustomers ? <Field label="新規客数目標" value={targetDraft.targetNewCustomers} onChange={(value) => updateTargetDraftField("targetNewCustomers", value)} suffix="名" numeric /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetRepeatCustomers ? <Field label="再来客数目標" value={targetDraft.targetRepeatCustomers} onChange={(value) => updateTargetDraftField("targetRepeatCustomers", value)} suffix="名" numeric /> : null}
                          {showReviewCountTargetField ? <Field label="目標口コミ数" value={targetDraft.targetReviewCount} onChange={(value) => updateTargetDraftField("targetReviewCount", value)} suffix="件" numeric /> : null}
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
                        <div className="toggle-panel">
                          <div>
                            {targetSaveStatus.status === "error" ? (
                              <strong className="danger-text">{targetSaveStatus.message}</strong>
                            ) : (
                              <strong>{targetSaveStatus.message || (targetDirty ? "未保存の変更があります" : "変更はありません")}</strong>
                            )}
                          </div>
                          <button className="primary-button" type="button" onClick={handleSaveMonthlyTarget} disabled={targetSaveStatus.status === "saving"}>
                            {targetSaveStatus.status === "saving" ? "保存中…" : "保存"}
                          </button>
                        </div>
                      </>
                    )}
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
                      {!fixedForm.id ? (
                        <NumericInput value={fixedForm.amount} onChange={(value) => setFixedForm((prev) => ({ ...prev, amount: value }))} placeholder="今月の金額" />
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
                      <button className="primary-button" type="submit">{fixedForm.id ? "更新" : "追加"}</button>
                      {fixedForm.id ? <button className="secondary-button" type="button" onClick={cancelEditFixedCost}>キャンセル</button> : null}
                      <details className="advanced-fields">
                        <summary>詳細設定（任意）</summary>
                        <div className="advanced-fields-body">
                          <input value={fixedForm.memo || ""} onChange={(event) => setFixedForm((prev) => ({ ...prev, memo: event.target.value }))} placeholder="備考（任意）" />
                        </div>
                      </details>
                    </form>
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
                          <div key={item.id} className="list-row cost-row">
                            <div>
                              <strong>{item.name}</strong>
                              <small>{getCostCategoryLabel(item.categoryKey)} ／ {item.periodType === "limited" ? "単月・期間限定" : "継続"} ／ {periodLabel}{item.memo ? ` ／ ${item.memo}` : ""}</small>
                            </div>
                            <div className="cost-row-amount">
                              <NumericInput
                                value={draftAmount}
                                placeholder={savedAmount === undefined ? "未入力" : ""}
                                onChange={(value) => setCostAmountDraft(item.id, value)}
                              />
                              {previousAmount !== undefined ? (
                                <button className="text-button" type="button" onClick={() => copyPreviousMonthAmountFor(item)}>前月をコピー（{money(previousAmount)}）</button>
                              ) : suggestedPreviousAmount !== undefined ? (
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
                            <p className="helper-text">前月末の在庫データがまだありません。初回のみ「期首在庫」（今月が始まった時点の在庫金額）を入力してください。</p>
                            <div className="inline-form">
                              <label className="field">
                                <span>期首在庫</span>
                                <NumericInput value={openingInventoryDraft} onChange={setOpeningInventoryDraft} placeholder="金額" />
                              </label>
                              <button className="secondary-button" type="button" onClick={saveOpeningInventoryBalance}>期首在庫を保存</button>
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
                      {useInventoryTracking ? (
                        <div className="summary-card"><span>仕入・発注額</span><strong>{formatMoneyOrDash(summary.purchaseAmount, summary.categoryHasEntry.materials)}</strong></div>
                      ) : null}
                      <div className="summary-card"><span>材料・仕入原価</span><strong>{formatMoneyOrDash(summary.costOfGoodsSold, summary.categoryHasEntry.materials)}</strong></div>
                      <div className="summary-card"><span>材料・仕入原価率</span><strong>{formatPercentOrDash(summary.costOfGoodsSoldRate, summary.categoryHasEntry.materials)}</strong></div>
                    </div>

                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">EXPENSE</p>
                        <h3>費用</h3>
                      </div>
                    </div>
                    <div className="summary-grid">
                      <div className="summary-card"><span>人件費</span><strong>{formatMoneyOrDash(summary.laborCost, summary.categoryHasEntry.labor)}</strong></div>
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
                            <span>消費税引当率（%）</span>
                            <NumericInput value={taxSettingsForm.consumptionTaxReserveRate} onChange={(value) => setTaxSettingsForm((prev) => ({ ...prev, consumptionTaxReserveRate: value }))} allowDecimal placeholder="例: 5" />
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
              <button className="primary-button" type="button" onClick={handleSaveCompany}>{companyEditId ? "会社情報を更新" : "会社追加"}</button>
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
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">STORE</p>
                <h2>店舗管理</h2>
              </div>
            </div>
            <p className="management-help">店舗名を登録するだけで、日次売上・月間目標・費用・月締め・スタッフ所属・権限・店舗ランキング等を店舗ごとに紐づけて管理できます。</p>
            {isFranchiseReadOnlyForCurrentUser() ? (
              <div className="empty-card">加盟店の店舗情報は閲覧専用です（登録・編集・各種設定の変更はできません）。</div>
            ) : null}
            {canEditStoreName(currentRole) && !isFranchiseReadOnlyForCurrentUser() && (
            <div className="setup-card" ref={storeFormSectionRef}>
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">STORE</p>
                  <h3>{storeEditId ? "店舗名を編集" : "店舗を登録"}</h3>
                </div>
              </div>
              {/* 店舗登録・編集で入力するのは店舗名のみ — store_idは自動発行、company_idは
                  ログイン中の会社へ自動で紐づく。以前あった住所・電話番号・営業時間・URL等の
                  詳細プロフィール項目は、店舗を経営データに紐づけるための識別画面としては
                  不要なため画面から外した(Supabase側のカラム・既存データはそのまま)。
                  「店舗を追加」ボタンは以前ここと右上の2箇所にあり、右上側は入力欄をリセット
                  するだけで実際には何も登録しないため紛らわしかった — このフォーム内の1つに
                  統一した。 */}
              <div className="store-form-grid">
                <label className="field">
                  <span>店舗名</span>
                  <input ref={storeFormNameInputRef} value={storeForm.name} onChange={(event) => setStoreForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="店舗名" />
                </label>
                <label className="field">
                  <span>在籍スタッフ数</span>
                  <NumericInput value={storeForm.staffCount} onChange={(value) => setStoreForm((prev) => ({ ...prev, staffCount: value }))} placeholder="例: 6" />
                </label>
                <label className="field">
                  <span>生産性計算人数（任意）</span>
                  <NumericInput value={storeForm.productivityStaffCount} onChange={(value) => setStoreForm((prev) => ({ ...prev, productivityStaffCount: value }))} allowDecimal placeholder="例: 5.0" />
                  <small className="field-hint">未入力の場合は在籍スタッフ数で計算します。パート・アルバイト・時短スタッフがいる場合のみ、小数で調整できます(例: 5.0 / 5.5 / 5.6)。</small>
                </label>
              </div>
              {storeFormStatus.message ? <div className="notice-box">{storeFormStatus.message}</div> : null}
              <div className="button-row">
                <button className="primary-button" type="button" onClick={handleSaveStore} disabled={storeFormStatus.status === "saving"}>
                  {storeFormStatus.status === "saving" ? "追加中…" : storeEditId ? "店舗名を更新" : "店舗追加"}
                </button>
                <button className="secondary-button" type="button" onClick={() => { setStoreEditId(""); setStoreForm(createStoreFormDefaults()); setStoreFormStatus({ status: "idle", message: "" }); }}>クリア</button>
              </div>
            </div>
            )}
            <div className="setup-card">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">DAILY FORM</p>
                  <h3>日次入力項目の設定</h3>
                </div>
              </div>
              {!selectedStore ? (
                <div className="empty-card">店舗を選択してください。</div>
              ) : (!canEditStoreName(currentRole) || isFranchiseReadOnlyForCurrentUser()) ? (
                <div className="field-switch-grid">
                  {dailyFieldKeys.map((fieldKey) => (
                    <label key={fieldKey} className="field-switch">
                      <span>{dailyFieldLabels[fieldKey]}</span>
                      <input type="checkbox" checked={Boolean(dailyFieldDraft.fields[fieldKey])} disabled />
                    </label>
                  ))}
                </div>
              ) : (
                <>
                  <p className="helper-text">日付・総売上・日締めは常に表示されます。それ以外の項目は店舗ごとに表示・非表示を選べます。</p>
                  <div className="button-row">
                    <button className="secondary-button" type="button" onClick={() => applyDailyFieldPreset("simple")}>かんたん入力にする</button>
                    <button className="secondary-button" type="button" onClick={() => applyDailyFieldPreset("detailed")}>詳細入力にする</button>
                  </div>
                  <div className="field-switch-grid">
                    {dailyFieldKeys.map((fieldKey) => (
                      <label key={fieldKey} className="field-switch">
                        <span>{dailyFieldLabels[fieldKey]}</span>
                        <input
                          type="checkbox"
                          checked={Boolean(dailyFieldDraft.fields[fieldKey])}
                          onChange={(event) => updateDailyFieldToggle(fieldKey, event.target.checked)}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="toggle-panel">
                    <div>
                      {dailyFieldSaveStatus.status === "error" ? (
                        <strong className="danger-text">{dailyFieldSaveStatus.message}</strong>
                      ) : (
                        <strong>{dailyFieldSaveStatus.message || (dailyFieldDirty ? "未保存の変更があります" : "変更はありません")}</strong>
                      )}
                    </div>
                    <button className="primary-button" type="button" onClick={handleSaveDailyFieldSettings} disabled={dailyFieldSaveStatus.status === "saving"}>
                      {dailyFieldSaveStatus.status === "saving" ? "保存中…" : "保存"}
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="setup-card">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">TARGET FORM</p>
                  <h3>月間目標設定の項目設定</h3>
                </div>
              </div>
              {!selectedStore ? (
                <div className="empty-card">店舗を選択してください。</div>
              ) : (!canEditStoreName(currentRole) || isFranchiseReadOnlyForCurrentUser()) ? (
                <div className="field-switch-grid">
                  {monthlyTargetFieldKeys.map((fieldKey) => (
                    <label key={fieldKey} className="field-switch">
                      <span>{monthlyTargetFieldLabels[fieldKey]}</span>
                      <input type="checkbox" checked={Boolean(monthlyTargetFieldDraft.fields[fieldKey])} disabled />
                    </label>
                  ))}
                </div>
              ) : (
                <>
                  <p className="helper-text">対象店舗・対象年月は常に表示されます。それ以外の項目は店舗ごとに表示・非表示を選べます。</p>
                  <div className="field-switch-grid">
                    {monthlyTargetFieldKeys.map((fieldKey) => (
                      <label key={fieldKey} className="field-switch">
                        <span>{monthlyTargetFieldLabels[fieldKey]}</span>
                        <input
                          type="checkbox"
                          checked={Boolean(monthlyTargetFieldDraft.fields[fieldKey])}
                          onChange={(event) => updateMonthlyTargetFieldToggle(fieldKey, event.target.checked)}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="toggle-panel">
                    <div>
                      {monthlyTargetFieldSaveStatus.status === "error" ? (
                        <strong className="danger-text">{monthlyTargetFieldSaveStatus.message}</strong>
                      ) : (
                        <strong>{monthlyTargetFieldSaveStatus.message || (monthlyTargetFieldDirty ? "未保存の変更があります" : "変更はありません")}</strong>
                      )}
                    </div>
                    <button className="primary-button" type="button" onClick={handleSaveMonthlyTargetFieldSettings} disabled={monthlyTargetFieldSaveStatus.status === "saving"}>
                      {monthlyTargetFieldSaveStatus.status === "saving" ? "保存中…" : "保存"}
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="setup-card">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">INVENTORY</p>
                  <h3>在庫管理</h3>
                </div>
              </div>
              {!selectedStore ? (
                <div className="empty-card">店舗を選択してください。</div>
              ) : (
                <>
                  <p className="helper-text">ONにすると月締め画面で期首在庫・当月末在庫を入力でき、材料・仕入原価が「前月末在庫+当月仕入・発注額-当月末在庫」で自動計算されます。OFFの店舗は仕入・発注額がそのまま原価になります(初期値OFF)。</p>
                  <label className="field-switch">
                    <span>在庫管理を使う</span>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedStoreEntity?.settings?.useInventoryTracking)}
                      disabled={!canEditStoreName(currentRole) || isFranchiseReadOnlyForCurrentUser()}
                      onChange={(event) => handleToggleInventoryTracking(event.target.checked)}
                    />
                  </label>
                </>
              )}
            </div>
            <div className="setup-card">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">CASH BREAKDOWN</p>
                  <h3>日計管理</h3>
                </div>
              </div>
              {!selectedStore ? (
                <div className="empty-card">店舗を選択してください。</div>
              ) : (
                <>
                  <p className="helper-text">ONにすると日次入力画面に「日計」カードが表示され、その日の総売上が現金・キャッシュレス・ポイント利用のどの支払方法だったかを記録・確認できます。総売上や損益・月次集計には加算されません(初期値OFF)。</p>
                  <label className="field-switch">
                    <span>日計管理を使う</span>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedStoreEntity?.settings?.useCashBreakdown)}
                      disabled={!canEditStoreName(currentRole) || isFranchiseReadOnlyForCurrentUser()}
                      onChange={(event) => handleToggleCashBreakdown(event.target.checked)}
                    />
                  </label>
                </>
              )}
            </div>
            {canManageStores(currentRole) && (
              <div className="row-actions" style={{ marginBottom: 4 }}>
                <button className="secondary-button" type="button" onClick={() => setShowArchivedStores((prev) => !prev)}>
                  {showArchivedStores ? "運営中/停止中の店舗を表示" : "アーカイブ店舗を表示"}
                </button>
              </div>
            )}
            {filteredStores.length ? (
              <div className="card-grid store-card-grid">
                {filteredStores.map((store) => {
                  const summary = computeStoreSummary(store, { staffCount: store.staffIds?.length || store.staffCount || 0 });
                  const statusLabel = store.status === "archived" ? "アーカイブ" : store.status === "suspended" ? "停止中" : "運営中";
                  const statusTone = store.status === "archived" ? "warning" : store.status === "suspended" ? "error" : "saved";
                  const canOperate = canChangeStoreLifecycle(currentRole) && !isFranchiseReadOnlyForCurrentUser();
                  return (
                    <div key={store.id} className="info-card store-info-card">
                      <div className="info-card-head">
                        <div>
                          <strong>{store.name}</strong>
                        </div>
                        <span className={`status-pill ${statusTone}`}>{statusLabel}</span>
                      </div>
                      <div className="store-metrics">
                        <div>
                          <span>達成率</span>
                          <strong>{summary.achievementRate}%</strong>
                        </div>
                        <div>
                          <span>前月比</span>
                          <strong>{summary.changeRate}%</strong>
                        </div>
                        <div>
                          <span>スタッフ</span>
                          <strong>{summary.staffCount}人</strong>
                        </div>
                      </div>
                      <div className="row-actions">
                        <button className="text-button" type="button" onClick={() => handleStoreSwitch(store.name)}>選択</button>
                        {canEditStoreName(currentRole) && !isFranchiseReadOnlyForCurrentUser() && (canManageStores(currentRole) || allowedStoreIds.includes(store.id)) && (
                          <button className="text-button" type="button" onClick={() => handleEditStore(store)}>編集</button>
                        )}
                        {canOperate && store.status === "archived" && (
                          <button className="text-button" type="button" onClick={() => handleStoreLifecycleAction(store, "restore")}>復元</button>
                        )}
                        {canOperate && store.status === "active" && (
                          <button className="text-button" type="button" onClick={() => handleStoreLifecycleAction(store, "suspend")}>停止</button>
                        )}
                        {canOperate && store.status === "suspended" && (
                          <button className="text-button" type="button" onClick={() => handleStoreLifecycleAction(store, "resume")}>再開</button>
                        )}
                      </div>
                      {canOperate && (
                        <div className="row-actions compact-actions">
                          {store.status === "archived" ? (
                            canHardDeleteStore(currentRole) && (
                              <button className="text-button danger" type="button" onClick={() => requestHardDeleteStore(store)}>完全削除</button>
                            )
                          ) : (
                            <>
                              <button className="text-button" type="button" onClick={() => handleDuplicateStore(store)}>複製</button>
                              <button className="text-button" type="button" onClick={() => handleStoreLifecycleAction(store, "archive")}>アーカイブ</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="management-empty">{showArchivedStores ? "アーカイブ済みの店舗はありません。" : "まだ店舗が登録されていません。上のフォームから店舗を追加してください。"}</div>
            )}
          </section>
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

        {activePage === "faq" && <FaqPage />}

        {activePage === "settings" && (
          <div className="stack settings-stack">
            <section className="panel">
              <div className="panel-heading">
                <h2>表示設定</h2>
              </div>
              <div className="toggle-panel">
                <div>
                  <strong>ダークモード</strong>
                  <small>{theme === "dark" ? "オン" : "オフ"}</small>
                </div>
                <button className="secondary-button" type="button" onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}>
                  {theme === "dark" ? "ライトに切替" : "ダークに切替"}
                </button>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <h2>入力・編集設定</h2>
              </div>
              <div className="input-grid">
                <label className="field">
                  <span>過去データの編集期限（日）</span>
                  <input type="number" value={companySettingsForm.editDeadlineDays || 7} onChange={(event) => setCompanySettingsForm((prev) => ({ ...prev, editDeadlineDays: Number(event.target.value) }))} />
                </label>
                <label className="field">
                  <span>一般スタッフの過去編集</span>
                  <select value={companySettingsForm.allowStaffPastEdit ? "on" : "off"} onChange={(event) => setCompanySettingsForm((prev) => ({ ...prev, allowStaffPastEdit: event.target.value === "on" }))}>
                    <option value="off">不可</option>
                    <option value="on">可</option>
                  </select>
                </label>
              </div>
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={handleSaveCompanySettings}>入力・編集設定を保存</button>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <h2>損益・税設定</h2>
              </div>
              <p className="helper-text">損益表に資金確保用の概算消費税引当額を表示します。正式な納税額の自動計算ではありません。</p>
              <div className="input-grid">
                <label className="field">
                  <span>消費税引当を表示する</span>
                  <select value={taxSettingsForm.considerConsumptionTax ? "on" : "off"} onChange={(event) => setTaxSettingsForm((prev) => ({ ...prev, considerConsumptionTax: event.target.value === "on" }))}>
                    <option value="off">OFF</option>
                    <option value="on">ON</option>
                  </select>
                </label>
                {taxSettingsForm.considerConsumptionTax ? (
                  <label className="field">
                    <span>消費税引当率（%）</span>
                    <NumericInput value={taxSettingsForm.consumptionTaxReserveRate} onChange={(value) => setTaxSettingsForm((prev) => ({ ...prev, consumptionTaxReserveRate: value }))} allowDecimal placeholder="例: 10" />
                  </label>
                ) : null}
              </div>
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={handleSaveTaxSettings}>損益・税設定を保存</button>
              </div>
            </section>
          </div>
        )}
      </main>
      {/* AI分析はaiAnalysisSettings(companies.ai_analysis_enabledの独立した取得結果)が
          trueの会社のみ表示する(要件: OFFの会社ではAI分析ボタン・AIコメント等を一切表示
          しない)。実際の利用停止はai-assistant Edge Function側のcompany_id判定が担保して
          おり、これはあくまでUI上の入口を隠すだけ — フローティングボタン自体を出さなければ
          チャット画面(AiChatScreen)を開く経路がそもそも無くなる。 */}
      {currentCompany && aiAnalysisSettings[currentCompany.id] && (
        <>
          <AiFloatingButton onClick={() => openAiChat()} />
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
function MetricCard({ label, value, secondaryValue = "", hint = "", tone = "", emphasize = false, hero = false, onClick = null }) {
  return (
    <div
      className={`metric-card ${tone} ${emphasize ? "emphasize" : ""} ${hero ? "hero" : ""} ${onClick ? "clickable" : ""}`}
      onClick={onClick || undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); } } : undefined}
    >
      <span>{label}</span>
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
function TargetSetupHint({ onGoToTarget }) {
  return (
    <div className="setup-card target-setup-hint">
      <p className="helper-text">月間目標を設定すると、達成率・目標までの残額・1日あたり必要売上が表示されます。</p>
      <button type="button" className="secondary-button" onClick={onGoToTarget}>目標を設定する</button>
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
            onClick={onDayClick ? () => onDayClick(iso) : undefined}
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

// Cycled by index, not tied to a specific field name — a category added later just gets the
// next color in the loop, so this never needs updating when new sales fields show up.
const SALES_COMPOSITION_COLORS = ["#2f7df6", "#38b28f", "#f5a524", "#e35757", "#8b5cf6", "#14b8a6", "#ec4899", "#84cc16"];

function SalesCompositionCard({ items }) {
  const gradientStops = (() => {
    let cursor = 0;
    return items.map((item, index) => {
      const start = cursor;
      cursor += item.ratio * 360;
      return `${SALES_COMPOSITION_COLORS[index % SALES_COMPOSITION_COLORS.length]} ${start}deg ${cursor}deg`;
    });
  })();

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
          <div
            className="sales-composition-pie"
            style={{ background: items.length === 1 ? SALES_COMPOSITION_COLORS[0] : `conic-gradient(${gradientStops.join(", ")})` }}
          />
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
// sanitizeNumericInputValue で全角数字・￥・カンマ・スペース等を自動的に半角の数字へ正規化
// する(要件2・7)。
//
// IME変換中(日本語入力の確定前、compositionstart〜compositionend)は正規化・強制上書きを
// 行わない — 変換途中の文字を書き換えると、入力中の文字が消えたりカーソル位置がずれたり
// するため(要件3)。生の入力値はそのままstateへ反映し、変換確定時(compositionend)に
// 初めて正規化する。
function NumericInput({ value, onChange, allowDecimal = false, onBlur, ...rest }) {
  const composingRef = useRef(false);
  return (
    <input
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={value === undefined || value === null ? "" : value}
      onChange={(event) => {
        if (composingRef.current) {
          onChange(event.target.value);
          return;
        }
        onChange(sanitizeNumericInputValue(event.target.value, { allowDecimal }));
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        onChange(sanitizeNumericInputValue(event.target.value, { allowDecimal }));
      }}
      onBlur={(event) => {
        onChange(sanitizeNumericInputValue(event.target.value, { allowDecimal }));
        onBlur?.(event);
      }}
      {...rest}
    />
  );
}

function Field({ label, value, onChange, suffix = "", type = "text", numeric = false, allowDecimal = false, disabled = false, placeholder = "" }) {
  const normalizedValue = value === undefined || value === null ? "" : value;
  return (
    <label className="field">
      <span>{label}</span>
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

export default App;
