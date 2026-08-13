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
  normalizeAppState,
  writeAppState,
} from "./utils/storage.js";
import { getAllowedStoreIdsForRole, getVisibleNavItems, resolveDefaultPage, canAccessPage, canManageCompanies, canManageStores, canEditStoreName, canManageUsers as canManageUsersByRole, canViewUserManagement, canViewAllStores, getInvitableRoles, getRoleLabel, normalizeRole, isAdminRole } from "./utils/permissions.js";
import { createInitialAppState } from "./data/defaults.js";
import LoginScreen from "./components/LoginScreen.jsx";
import AccessDenied from "./components/AccessDenied.jsx";
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
  createStoreRecord,
  updateStoreRecord,
  updateStoreActiveState,
  normalizeDailyFieldSettings,
  normalizeMonthlyTargetFieldSettings,
  loadStoreInputSettingsForCompany,
  upsertStoreInputSettings,
  createUserProfileRecord,
  upsertDailySalesEntry,
  updateDailySalesClosingState,
  loadDailySalesForCompanyRange,
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
  deleteUserAccount,
  updateProfileDetails,
  refreshInviteState,
} from "./utils/supabase.js";
import { loadLatestTenantSnapshot, upsertTenantSnapshot } from "./utils/supabaseRemote.js";
import { getBusinessTypeDefaultStoreName, getBusinessTypeLabel } from "./utils/businessProfile.js";
import { getLocalizedSupabaseErrorMessage } from "./utils/authMessages.js";
import { buildInviteLink, createInviteToken, isInviteExpired } from "./utils/invitations.js";
import { computeStoreSummary, normalizeStoreUrls, sortStoresForManagement } from "./utils/storeManagement.js";
import AiAssistantCard from "./components/ai/AiAssistantCard.jsx";
import AiFloatingButton from "./components/ai/AiFloatingButton.jsx";
import AiChatScreen from "./components/ai/AiChatScreen.jsx";
import MonthlyDashboardPage from "./components/dashboard/MonthlyDashboardPage.jsx";

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

const getRankTone = (achievement) => {
  if (achievement >= 100) return "good";
  if (achievement >= 95) return "warning";
  return "danger";
};

const formatChangeRate = (value) => {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
};

const getRankingMetric = (row, rankingSort, mode = "current") => {
  if (mode === "previous") {
    switch (rankingSort) {
      case "achievement":
        return row.previousAchievement;
      case "change":
        return row.previousChangeRate;
      case "profit":
        return row.previousOperatingProfit;
      default:
        return row.previousSales;
    }
  }

  switch (rankingSort) {
    case "achievement":
      return row.achievement;
    case "change":
      return row.currentChangeRate;
    case "profit":
      return row.operatingProfit;
    default:
      return row.sales;
  }
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

const getUserStatusMeta = (user) => {
  if (user?.isActive === false) {
    return { key: "suspended", label: "停止中", tone: "danger", expiresAt: null };
  }
  if (!user?.authUserId) {
    if (user?.inviteExpiresAt && isInviteExpired(user.inviteExpiresAt)) {
      return { key: "invite_expired", label: "招待期限切れ", tone: "warning", expiresAt: new Date(user.inviteExpiresAt) };
    }
    return { key: "invited", label: "招待中", tone: "info", expiresAt: user?.inviteExpiresAt ? new Date(user.inviteExpiresAt) : null };
  }
  if (!user?.lastLoginAt || !user?.loginCount) {
    return { key: "not_logged_in", label: "未ログイン", tone: "info", expiresAt: null };
  }
  return { key: "active", label: "利用中", tone: "success", expiresAt: null };
};

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
  const [activeMonthlyTab, setActiveMonthlyTab] = useState("closing");
  const [rankingSort, setRankingSort] = useState("sales");
  const [expandedRankingStore, setExpandedRankingStore] = useState("");
  const [companyForm, setCompanyForm] = useState({ name: "", code: "", contractStatus: "trial", businessType: "salon" });
  const [storeForm, setStoreForm] = useState(createStoreFormDefaults());
  // 検索・並び替えUIは撤去したが、filteredStoresの絞り込み/並び替えロジック自体は変更せず
  // 維持している(空検索=絞り込みなし、achievement=既存のデフォルト順)。setterは今は使わ
  // ないため取得しない。
  const [storeSearch] = useState("");
  const [storeSort] = useState("achievement");
  // Inline feedback right next to the 店舗追加 button — the shared top-of-page `notice` can be
  // scrolled out of view once the store form is scrolled into view (via focusStoreForm), making
  // a real success/failure result look like nothing happened. This always renders in the same
  // spot the user is already looking at.
  const [storeFormStatus, setStoreFormStatus] = useState({ status: "idle", message: "" });
  const [userForm, setUserForm] = useState({ name: "", email: "", role: "store_manager", companyId: "", storeIds: [], primaryStoreId: "", invitationStatus: "invited", loginCount: 0, lastLoginAt: "", isActive: true });
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
  const autoSaveTimerRef = useRef(null);
  const lastAutoSaveSignatureRef = useRef("");
  const remoteSyncChannelRef = useRef(null);
  const hydrateRetryTimerRef = useRef(null);
  const hydrateRetryCountRef = useRef(0);
  const { stores, selectedStore, selectedStoreId, selectedMonth } = appState;
  // 「全店舗」はcompany_admin専用の仮想ビュー(storesテーブルに実店舗として存在しない)。
  // selectedStoreがこの予約値のときは、以降のすべての店舗依存ロジックを分岐させる。
  const isAllStoresView = selectedStore === ALL_STORES_VALUE;
  const currentCompany = useMemo(() => appState.companies?.find((company) => company.id === appState.currentCompanyId) || appState.companies?.[0] || null, [appState.companies, appState.currentCompanyId]);
  const currentCompanyStores = useMemo(() => currentCompany?.stores || [], [currentCompany]);
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
  const totalSalesIsAutoCalculated = showTechnicalSalesField && showRetailSalesField;
  const customersIsAutoCalculated = showNewCustomersField && showRepeatCustomersField;
  // updateDailyField keeps dailyForm.totalSales/dailyForm.customers correctly synced whether
  // they're auto-calculated (technicalSales+retailSales / newCustomers+repeatCustomers) or
  // typed directly, so both are always safe to read as-is here.
  const dailyEffectiveTotalSales = parseNumber(dailyForm.totalSales);
  const dailyEffectiveCustomers = parseNumber(dailyForm.customers);
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
    const source = roleScoped.filter((store) => {
      if (!searchValue) return true;
      return (store.name || "").toLowerCase().includes(searchValue);
    });
    return sortStoresForManagement(source, storeSort);
  }, [currentCompany?.stores, storeSearch, storeSort, currentRole, allowedStoreIds]);
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

        const { data: { session }, error } = await getSupabaseSession();
        if (error) throw error;
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
  const summary = useMemo(
    () => (isAllStoresView
      ? calculateAllStoresMonthSummary(appState, currentCompany, selectedMonth)
      : calculateMonthSummary(appState, selectedStoreId, selectedMonth, { useInventoryTracking })),
    [appState, currentCompany, isAllStoresView, selectedStoreId, selectedMonth, useInventoryTracking]
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
    () => getMonthClosingChecklist(appState, selectedStoreId, selectedMonth, { useInventoryTracking }),
    [appState, selectedStoreId, selectedMonth, useInventoryTracking]
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
  const rankingRows = useMemo(() => {
    const previousMonth = getMonthOffset(selectedMonth, -1);
    const previousPreviousMonth = getMonthOffset(selectedMonth, -2);

    // ランキングの売上はダッシュボードの総売上(summary.sales、入力済み全件)と同じ基準にする —
    // 以前はsummary.closedSales(日締め済みの日だけ)を使っており、当日分を入力しただけでは
    // ランキングに反映されず「ダッシュボードは最新なのにランキングだけ古い」という不具合の
    // 原因になっていた。日締めを待たず、入力した時点でランキングにも反映される。
    const rows = currentCompanyStores.map((store) => {
      const storeSummary = calculateMonthSummary(appState, store.id, selectedMonth);
      const previousSummary = calculateMonthSummary(appState, store.id, previousMonth);
      const previousPreviousSummary = calculateMonthSummary(appState, store.id, previousPreviousMonth);
      const currentSales = storeSummary.sales;
      const previousSales = previousSummary.sales;
      const previousPreviousSales = previousPreviousSummary.sales;
      const achievement = storeSummary.targetAchievement;
      const previousAchievement = previousSummary.targetAchievement;
      const currentChangeRate = previousSales > 0 ? ((currentSales - previousSales) / previousSales) * 100 : 0;
      const previousChangeRate = previousPreviousSales > 0 ? ((previousSales - previousPreviousSales) / previousPreviousSales) * 100 : 0;
      // 目標未登録の店舗は達成率が常に0%になる(calculateMonthSummary側の仕様)ため、それを
      // 「未達成」として色付け・ラベル表示しない(任意項目のため、未入力=悪い実績ではない)。
      const hasTargetSales = Boolean(storeSummary.target.targetSales);

      return {
        storeId: store.id,
        storeName: store.name,
        sales: currentSales,
        targetSales: storeSummary.target.targetSales,
        hasTargetSales,
        achievement,
        operatingProfit: storeSummary.operatingProfit,
        previousSales,
        previousAchievement,
        previousOperatingProfit: previousSummary.operatingProfit,
        previousChangeRate,
        currentChangeRate,
        forecast: storeSummary.forecast,
        tone: hasTargetSales ? getRankTone(achievement) : "neutral",
        achievementLabel: !hasTargetSales ? "目標未設定" : achievement >= 100 ? "順調" : achievement >= 95 ? "要確認" : "要改善",
      };
    });

    const compareRows = (left, right) => {
      const leftValue = getRankingMetric(left, rankingSort, "current");
      const rightValue = getRankingMetric(right, rankingSort, "current");
      return rightValue - leftValue;
    };

    const previousCompareRows = (left, right) => {
      const leftValue = getRankingMetric(left, rankingSort, "previous");
      const rightValue = getRankingMetric(right, rankingSort, "previous");
      return rightValue - leftValue;
    };

    const rankedRows = [...rows].sort(compareRows).map((row, index) => ({ ...row, currentRank: index + 1 }));
    const previousRankedRows = [...rows].sort(previousCompareRows).map((row, index) => ({ ...row, previousRank: index + 1 }));
    // Keyed by storeId, not storeName — two stores sharing a display name would otherwise get
    // each other's previous-rank/trend arrow.
    const previousRankMap = new Map(previousRankedRows.map((row) => [row.storeId, row.previousRank]));

    return rankedRows.map((row) => ({
      ...row,
      previousRank: previousRankMap.get(row.storeId) || 0,
      trend: row.previousRank ? (row.currentRank < row.previousRank ? "↑" : row.currentRank > row.previousRank ? "↓" : "→") : "→",
    }));
  }, [appState, rankingSort, selectedMonth, currentCompanyStores]);
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
      items.push({ label: "必要な1日売上", value: money(summary.dailyNeededSales), hint: `残り${summary.remainingBusinessDays ?? 0}営業日` });
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
        });
        await refreshAuthDebugInfo({ sessionUser: authUser, role: profile?.role, profile, hasSession: true, authUser, setDebugInfo });
        window.localStorage.setItem("salon-user", JSON.stringify(nextUser));
        window.localStorage.setItem("salon-role", nextRole);
        setAuthMode("app");
        setActivePage(resolveDefaultPage(nextRole));
        setInviteToken("");
        setAuthSuccess("招待登録が完了しました。管理画面へ移動します。");
      } catch (error) {
        setAuthError(getLocalizedSupabaseErrorMessage(error));
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
        });
        await refreshAuthDebugInfo({ sessionUser: authUser, role: profile?.role, profile, hasSession: true, authUser, setDebugInfo });
        window.localStorage.setItem("salon-user", JSON.stringify(nextUser));
        window.localStorage.setItem("salon-role", normalizeRole(profile?.role || resolveRoleForEmail(authUser.email)));
        setAuthMode("app");
        setActivePage(resolveDefaultPage(normalizeRole(profile?.role || resolveRoleForEmail(authUser.email))));
        setAuthSuccess("アカウントを作成しました。管理画面へ移動します。" );
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
      const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email));
      if (error) throw error;
      setAuthSuccess("パスワード再設定用のメールを送信しました。" );
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

  const hydrateFromSupabase = async ({ authUser, profile, tenantState }) => {
    if (!isSupabaseConfigured || !profile?.company_id || !authUser?.id) return;
    try {
      console.info("[sync-hydrate] start", {
        authUserId: authUser?.id,
        profileId: profile?.id,
        companyId: profile?.company_id,
        selectedStore: tenantState?.selectedStore,
        selectedMonth: tenantState?.selectedMonth,
      });
      setSyncStatus({ status: "syncing", message: "同期中です…", timestamp: new Date().toISOString(), error: false });
      const companyId = profile.company_id || tenantState?.currentCompanyId || "";
      const company = (tenantState?.companies || []).find((item) => item.id === companyId) || (tenantState?.companies || [])[0] || null;
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
        return {
          ...merged,
          dailyResults: prunedDailyResults,
          dayClosingStates: prunedDayClosingStates,
          dayClosingUpdatedAt: prunedDayClosingUpdatedAt,
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
        setAppState((prev) => {
          let merged = mergeRemoteAppState(prev, {
            ...(hasLocalFallbackCache ? fallbackState : {}),
            // companies/users must always reflect the just-fetched stores/profiles tables,
            // never a possibly-stale localStorage cache — see the identical fix below for
            // why letting a cached list win here silently breaks store_id resolution.
            companies: applyStoreInputSettingsToCompanies(tenantState?.companies?.length ? tenantState.companies : (fallbackState.companies || [])),
            users: tenantState?.users?.length ? tenantState.users : (fallbackState.users || []),
            currentCompanyId: profile?.company_id || prev.currentCompanyId || companyId,
            currentUserId: profile?.id || prev.currentUserId || "",
            currentAuthUserId: profile?.auth_user_id || authUser.id || prev.currentAuthUserId || "",
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
        currentCompanyId: remoteState.currentCompanyId || tenantState?.currentCompanyId || companyId || "",
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
      };
      const remoteSnapshotSignature = JSON.stringify({
        ...nextRemoteState,
        companySnapshots: Object.fromEntries(Object.entries(nextRemoteState.companySnapshots || {}).map(([key, value]) => [key, {
          ...(value || {}),
          companySnapshots: undefined,
        }])),
      });
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
      logSupabaseError({ operation: "hydrateFromSupabase", table: "tenant_snapshots", userId: authUser?.id, companyId: profile?.company_id, storeId: tenantState?.selectedStore, error });
      const reason = getSupabaseErrorMessage(error);
      setSyncStatus({ status: "error", message: `同期エラー: ${reason}`, timestamp: new Date().toISOString(), error: true });
      if (hydrateRetryTimerRef.current) {
        window.clearTimeout(hydrateRetryTimerRef.current);
      }
      const attempt = hydrateRetryCountRef.current + 1;
      hydrateRetryCountRef.current = attempt;
      const delayMs = Math.min(3000 * attempt, 15000);
      hydrateRetryTimerRef.current = window.setTimeout(() => {
        void hydrateFromSupabase({ authUser, profile, tenantState });
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
    const normalizedCode = (companyForm.code || normalizedName).trim().toLowerCase();

    try {
      let createdCompany = null;
      if (!existingCompany) {
        createdCompany = await createCompanyRecord({
          name: normalizedName,
          code: normalizedCode,
          createdByProfileId: appState.currentUserId || currentUser?.profileId || "",
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
      setNotice(existingCompany ? `${nextCompany.name} を更新しました` : `${nextCompany.name} を追加しました`);
    } catch (error) {
      setNotice(getSupabaseErrorMessage(error));
    }
  };

  const handleSaveStore = async () => {
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
        // storeForm から取る(他のプロフィール項目のように「画面に無いので既存値を維持」
        // ではない)。
        staffCount: parseNumber(storeForm.staffCount) || 0,
        productivityStaffCount: parseNumber(storeForm.productivityStaffCount) || 0,
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
      setNotice(successMessage);
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
    }
  };

  const handleSaveUser = async () => {
    if (!canManageUsers(currentRole)) {
      setNotice("ユーザー招待はシステム管理者・会社管理者・店長が実行できます");
      return;
    }
    if (!userForm.name.trim() || !userForm.email.trim()) return;
    const normalizedEmail = userForm.email.trim().toLowerCase();
    const duplicateUser = (appState.users || []).find((user) => user.email === normalizedEmail);
    if (duplicateUser) {
      setNotice("同じメールアドレスのユーザーが既に登録されています");
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
    const companyId = normalizedCurrentRole === "system_admin" ? (userForm.companyId || appState.currentCompanyId) : appState.currentCompanyId;
    const inviterStoreIds = normalizedCurrentRole === "store_manager" ? allowedStoreIds : currentCompanyStores.map((store) => store.id);
    const inviteTokenValue = createInviteToken();
    const inviteLink = buildInviteLink(typeof window !== "undefined" && window.location?.origin ? window.location.origin : "", inviteTokenValue);
    const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const requestedStoreIds = (userForm.storeIds.length ? userForm.storeIds : (inviterStoreIds[0] ? [inviterStoreIds[0]] : [])).filter((storeId) => inviterStoreIds.includes(storeId));
    const requestedPrimaryStoreId = inviterStoreIds.includes(userForm.primaryStoreId) ? userForm.primaryStoreId : (requestedStoreIds[0] || "");

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
      setUserForm({ name: "", email: "", role: invitableRoles[invitableRoles.length - 1] || "staff", companyId: "", storeIds: [], primaryStoreId: "", invitationStatus: "invited", loginCount: 0, lastLoginAt: "", isActive: true });

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
          setNotice(`${nextUser.name} を招待しましたが、招待メールの送信に失敗しました: ${getSupabaseErrorMessage(emailResult.error)}（「リンク」からURLをコピーして直接共有することもできます）`);
          return;
        }
        setNotice(`${nextUser.name} を招待し、招待メールを送信しました`);
        return;
      }
      setNotice(`${nextUser.name} を招待しました。招待リンクを共有してください。`);
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
    setNotice(`${company.name} を編集します`);
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
      setNotice(`${editUserDraft.name.trim()} の情報を更新しました`);
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
    if (!window.confirm(`${targetUser.name}（${targetUser.email}）を削除します。この操作は取り消せません。本当によろしいですか？`)) {
      return;
    }
    setDeleteUserSaving(true);
    setDeleteUserError("");
    try {
      if (isSupabaseConfigured) {
        const result = await deleteUserAccount({ profileId: targetUser.id });
        if (!result.ok) {
          throw result.error || new Error("削除に失敗しました");
        }
      }
      const nextState = {
        ...appState,
        users: (appState.users || []).filter((user) => user.id !== targetUser.id),
      };
      persistTenantState(nextState);
      setNotice(`${targetUser.name} を削除しました`);
      closeDeleteUserModal();
    } catch (error) {
      setDeleteUserError(getSupabaseErrorMessage(error));
    } finally {
      setDeleteUserSaving(false);
    }
  };

  const handleToggleCompanyStatus = (company) => {
    if (!window.confirm(`${company.name} を${company.isActive ? "利用停止" : "再開"}しますか？`)) return;
    const nextState = {
      ...appState,
      companies: (appState.companies || []).map((item) => item.id === company.id ? { ...item, isActive: !item.isActive, lastUpdatedAt: new Date().toISOString() } : item),
    };
    persistTenantState(nextState);
    setNotice(company.isActive ? `${company.name} を停止しました` : `${company.name} を再開しました`);
  };

  // These four used to only call persistTenantState (local state + the legacy tenant_snapshots
  // blob) — never the real stores.is_active column. Any user-visible "停止しました"/
  // "アーカイブしました" silently reverted on the very next hydrate (login, reload, another
  // device), since a fresh fetch from Supabase always wins over the stale local copy. Fixed to
  // persist through updateStoreActiveState first, only touching local state after the write
  // actually succeeds, with an honest failure message otherwise — same pattern as the rest of
  // this app's write paths. "削除" intentionally maps to the same is_active = false as "アーカ
  // イブ" (see updateStoreActiveState's own comment: a real row delete would cascade-destroy
  // that store's historical daily_sales/monthly_targets/etc, which must never happen).
  const applyStoreActiveStateLocally = (storeId, isActive) => {
    const nextCompany = {
      ...currentCompany,
      stores: (currentCompany?.stores || []).map((item) => (item.id === storeId ? { ...item, isActive, status: isActive ? "active" : "archived" } : item)),
    };
    const nextState = {
      ...appState,
      companies: (appState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)),
    };
    persistTenantState(nextState);
  };

  const handleToggleStoreStatus = async (store) => {
    if (!window.confirm(`${store.name} を${store.isActive ? "利用停止" : "再開"}しますか？`)) return;
    const nextActive = !store.isActive;
    if (isSupabaseConfigured) {
      const result = await updateStoreActiveState({ storeId: store.id, isActive: nextActive });
      if (!result.ok) {
        setNotice(`店舗状態の更新に失敗しました: ${getSupabaseErrorMessage(result.error)}`);
        return;
      }
    }
    applyStoreActiveStateLocally(store.id, nextActive);
    setNotice(nextActive ? `${store.name} を再開しました` : `${store.name} を停止しました`);
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
      setNotice(`${duplicateName} を複製しました（ローカル）`);
      return;
    }
    try {
      // A locally-fabricated id here would never exist in the real stores table — every
      // subsequent daily_sales/monthly_targets write for it would fail FK/RLS. Create a real row.
      const createdStore = await createStoreRecord({ companyId: currentCompany?.id, name: duplicateName, code: crypto.randomUUID() });
      const nextStore = { ...store, id: createdStore.id, name: duplicateName, code: createdStore.code, isActive: true, status: "active" };
      const nextCompany = { ...currentCompany, stores: [...(currentCompany?.stores || []), nextStore] };
      persistTenantState(syncLegacyStoreNamesSnapshot({ ...appState, companies: (appState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)) }, currentCompany?.id, nextCompany.stores));
      setNotice(`${duplicateName} を複製しました`);
    } catch (error) {
      setNotice(`店舗の複製に失敗しました: ${getSupabaseErrorMessage(error)}`);
    }
  };

  const handleArchiveStore = async (store) => {
    if (!window.confirm(`${store.name} をアーカイブしますか？`)) return;
    if (isSupabaseConfigured) {
      const result = await updateStoreActiveState({ storeId: store.id, isActive: false });
      if (!result.ok) {
        setNotice(`店舗のアーカイブに失敗しました: ${getSupabaseErrorMessage(result.error)}`);
        return;
      }
    }
    applyStoreActiveStateLocally(store.id, false);
    setNotice(`${store.name} をアーカイブしました`);
  };

  const handleRestoreStore = async (store) => {
    if (isSupabaseConfigured) {
      const result = await updateStoreActiveState({ storeId: store.id, isActive: true });
      if (!result.ok) {
        setNotice(`店舗の復元に失敗しました: ${getSupabaseErrorMessage(result.error)}`);
        return;
      }
    }
    applyStoreActiveStateLocally(store.id, true);
    setNotice(`${store.name} を復元しました`);
  };

  const handleDeleteStore = async (store) => {
    if (!window.confirm(`${store.name} を削除しますか？（過去の売上・目標等のデータは保持されます）`)) return;
    if (isSupabaseConfigured) {
      const result = await updateStoreActiveState({ storeId: store.id, isActive: false });
      if (!result.ok) {
        setNotice(`店舗の削除に失敗しました: ${getSupabaseErrorMessage(result.error)}`);
        return;
      }
    }
    applyStoreActiveStateLocally(store.id, false);
    setNotice(`${store.name} を削除しました`);
  };

  const handleToggleUserStatus = async (user) => {
    if (!window.confirm(`${user.name} を${user.isActive ? "利用停止" : "再開"}しますか？`)) return;
    const nextActive = !user.isActive;
    if (isSupabaseConfigured) {
      const result = await updateProfileDetails({ profileId: user.id, name: user.name, email: user.email, isActive: nextActive });
      if (!result?.ok && !result?.skipped) {
        setNotice(`状態の変更に失敗しました: ${getSupabaseErrorMessage(result?.error)}`);
        return;
      }
    }
    const nextState = {
      ...appState,
      users: (appState.users || []).map((item) => item.id === user.id ? { ...item, isActive: nextActive } : item),
    };
    persistTenantState(nextState);
    setNotice(nextActive ? `${user.name} を再開しました` : `${user.name} を停止しました`);
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
    setNotice("初期設定を完了しました");
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
    setNotice("会社基本設定を保存しました");
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
    const ok = await persistTaxSettings({
      ...appState.taxSettings,
      considerConsumptionTax: Boolean(taxSettingsForm.considerConsumptionTax),
      consumptionTaxReserveRate: parseNumber(taxSettingsForm.consumptionTaxReserveRate),
    });
    if (ok) setNotice("消費税の設定を保存しました");
  };

  // 損益表の「消費税考慮」セクションのON/OFFトグル用。在庫管理トグルと同様、単一のON/OFFなので
  // 切り替え次第すぐ保存する(引当率は別途、既存のtaxSettingsForm+保存ボタンで確定させる)。
  const handleToggleConsiderConsumptionTax = async (checked) => {
    const ok = await persistTaxSettings({ ...appState.taxSettings, considerConsumptionTax: checked });
    if (ok) {
      setTaxSettingsForm((prev) => ({ ...prev, considerConsumptionTax: checked }));
      setNotice(checked ? "消費税考慮をONにしました" : "消費税考慮をOFFにしました");
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
      const reason = error instanceof Error ? error.message : "保存に失敗しました";
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
      const reason = error instanceof Error ? error.message : "保存に失敗しました";
      setMonthlyTargetFieldSaveStatus({ status: "error", message: reason });
      setNotice(`月間目標項目設定の保存に失敗しました: ${reason}`);
    }
  };

  // 「在庫管理を使う」トグル(店舗単位、store_input_settings.use_inventory_tracking)。単一の
  // ON/OFFなので他の項目設定のようなdraft/dirty管理は持たず、切り替え次第すぐ保存する。
  const handleToggleInventoryTracking = async (checked) => {
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
    setNotice(checked ? "在庫管理をONにしました" : "在庫管理をOFFにしました");
  };

  const handleInviteEmail = async (user) => {
    if (user.authUserId) {
      setNotice(`${user.name} はすでに登録済みです`);
      return;
    }
    const inviteTokenValue = user.inviteToken || createInviteToken();
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
      setNotice(`${user.name} の招待リンクを更新しました（7日間有効）`);
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
      setNotice(`招待リンクは更新しましたが、招待メールの送信に失敗しました: ${getSupabaseErrorMessage(emailResult.error)}（「リンク」からURLをコピーして直接共有することもできます）`);
      return;
    }
    setNotice(`${user.name} に招待メールを再送しました（7日間有効）`);
  };

  const handleCopyInviteLink = async (user) => {
    const inviteLink = user.inviteLink || buildInviteLink(typeof window !== "undefined" && window.location?.origin ? window.location.origin : "", user.inviteToken || createInviteToken());
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteLink);
        setNotice(`${user.name} の招待リンクをコピーしました`);
        return;
      }
    } catch (error) {
      console.warn("Clipboard write failed", error);
    }
    window.prompt("招待リンク", inviteLink);
  };

  useEffect(() => {
    if (authMode !== "app" || !currentUser?.authUserId || !syncInitialized) return;

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
    const timestamp = new Date().toISOString();
    setSaveStatus({ status: "saving", message: "保存中…", timestamp, error: false });

    void persistToSupabase(appState).then((result) => {
      if (result?.ok && !result?.skipped) {
        setSaveStatus({ status: "saved", message: "保存済み ✓", timestamp, error: false });
        return;
      }
      setSaveStatus({ status: "saved", message: "同期待機中", timestamp, error: false });
    }).catch((error) => {
      setSaveStatus({ status: "error", message: error instanceof Error ? error.message : "保存に失敗しました", timestamp, error: true });
    });
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

  useEffect(() => {
    const handleFocus = () => {
      if (!isSupabaseConfigured || authMode !== "app" || !currentUser?.authUserId || !currentUser?.profileId) return;
      void hydrateFromSupabase({
        authUser: { id: currentUser.authUserId, email: currentUser.email },
        profile: { id: currentUser.profileId, company_id: appState.currentCompanyId, role: currentRole },
        tenantState: appState,
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleFocus();
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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
        tenantState: appState,
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

      setDailyForm(entry);
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
      if (!silent) {
        setNotice("日次実績を保存しました");
      }
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
      setNotice("入力済みの日付です。編集ボタンで内容を確認・更新できます。");
      return;
    }

    setDailyForm({ ...defaultDailyEntry, date: nextDate });
    setDailyMode("create");
    setDailyOriginalEntry(null);
    setDailyInsight("");
    setNotice("");
  };

  const submitDailyEntry = (event) => {
    event?.preventDefault();
    void saveDailyEntry({ silent: false, force: true, switchToView: true });
  };

  const startNewDailyEntry = () => {
    const defaultValue = { ...defaultDailyEntry, date: dailyForm.date || "" };
    setDailyForm(defaultValue);
    setDailyMode("create");
    setDailyOriginalEntry(null);
    setDailyInsight("");
    setNotice("新規入力モードです");
  };

  const editDailyEntry = () => {
    if (!dailyForm.id) {
      setNotice("編集対象のデータがありません");
      return;
    }
    setDailyMode("edit");
    setNotice("編集モードです。内容を確認してから完了してください。" );
  };

  const cancelDailyEntryEdit = () => {
    if (dailyOriginalEntry) {
      setDailyForm({ ...dailyOriginalEntry });
      setDailyMode("view");
      setDailyInsight(buildDailyInsight({ form: dailyOriginalEntry, target, businessDayCount: businessDaySummary.businessDayCount || 0 }));
      setNotice("編集をキャンセルしました");
      return;
    }
    setDailyForm({ ...defaultDailyEntry, date: dailyForm.date || "" });
    setDailyMode("create");
    setDailyInsight("");
    setNotice("入力をキャンセルしました");
  };

  // 「費用入力」の項目定義(名前・カテゴリ・備考・継続/期間限定)。金額はここでは扱わず、
  // persistCostMonthlyAmount経由でcostMonthlyAmountsに対象月ごと別保存する(下記参照)。
  // 継続の場合、開始月は画面には出さず対象月(selectedMonth追従、942行目のeffect参照)を
  // そのまま使い、終了月は常に空にする。期間限定の場合だけ開始月・終了月を必須にする。
  const submitFixedCost = async (event) => {
    event.preventDefault();
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

    setNotice(fixedForm.id ? "費用を更新しました" : "費用を追加しました");
    setFixedForm({ ...defaultFixedCostItem, startMonth: selectedMonth });
  };

  const editFixedCost = (item) => {
    setFixedForm({ ...defaultFixedCostItem, ...item, amount: "" });
    setNotice("編集モードです。内容を確認して更新してください。");
  };

  const cancelEditFixedCost = () => {
    setFixedForm({ ...defaultFixedCostItem, startMonth: selectedMonth });
  };

  const removeFixedCost = async (itemId) => {
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
    setNotice("費用を削除しました");
  };

  // 対象月ごとの費用金額(cost_monthly_amounts)を1件upsertする。新規登録時の初回金額保存と、
  // 月次一覧のインライン保存(saveCostAmountFor)の両方から共通で呼ぶ。
  const persistCostMonthlyAmount = async ({ costItemId, targetMonth, amount }) => {
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
      setNotice("金額を保存しました");
    }
  };

  // 在庫管理ONの店舗の月次在庫入力(月締め画面)。store_inventory_balancesへ対象月ごとに
  // upsertする共通ヘルパー — 「期首在庫」は選択月の前月分として、「当月末在庫」は選択月
  // そのものとして同じテーブルに保存する(getPreviousMonthInventoryBalanceが前者を読む)。
  const persistInventoryBalance = async (targetMonth, amount) => {
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
    const ok = await persistInventoryBalance(getMonthOffset(selectedMonth, -1), openingInventoryDraft);
    if (ok) setNotice("期首在庫を保存しました");
  };

  const saveClosingInventoryBalance = async () => {
    if (closingInventoryDraft === "") {
      setNotice("当月末在庫の金額を入力してください");
      return;
    }
    const ok = await persistInventoryBalance(selectedMonth, closingInventoryDraft);
    if (ok) setNotice("当月末在庫を保存しました");
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
    setNotice("店休日数を保存しました");
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
    setNotice("営業日数を手動設定しました");
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
    setNotice("営業日数を自動計算に戻しました");
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
    setNotice(isCurrentlyHoliday ? `${dateIso}の店休日を解除しました` : `${dateIso}を店休日に設定しました`);
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
    setNotice(isCurrentlyHoliday ? `${dateIso}の全店舗店休日を解除しました` : `${dateIso}を全店舗店休日に設定しました`);
  };

  const toggleMonthClosing = async () => {
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
    setNotice(nextClosed ? "月締めを確定しました" : "月締めを解除しました");
  };

  const toggleDayClosing = async () => {
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
    setNotice(nextClosed ? "日締めが完了しました" : "日締めを解除しました");
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
    return <LoginScreen mode={authMode} onModeChange={handleModeChange} onSubmit={handleLogin} onSignUp={handleSignUp} onResetPassword={handleResetPassword} loading={authLoading} error={authError} success={authSuccess} />;
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
                  <input value={companyForm.code} onChange={(event) => setCompanyForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="会社コード" />
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
                  <button className="primary-button" type="button" onClick={handleSaveStore}>店舗を追加</button>
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
              <h1>{activePage === "dashboard" ? "売上" : activePage === "monthlyDashboard" ? "月次ダッシュボード" : activePage === "daily" ? "日次入力" : activePage === "monthly" ? "管理画面" : activePage === "companies" ? "会社管理" : activePage === "stores" ? "店舗管理" : activePage === "users" ? "ユーザー管理" : "設定"}</h1>
              {currentUser ? (
                <div className="user-role-badge" style={{ marginTop: 6 }}>
                  {currentUser?.role || currentRole === "system_admin" ? "管理者" : currentRole}
                </div>
              ) : null}
            </div>
          </div>

          <div className="filters">
            <label>
              店舗
              <select value={selectedStore} onChange={(event) => handleStoreSwitch(event.target.value)}>
                {canViewAllStores(currentRole) ? <option value={ALL_STORES_VALUE}>全店舗</option> : null}
                {visibleStores.length ? visibleStores.map((store) => <option key={store.id} value={store.name}>{store.name}</option>) : <option value="">未登録</option>}
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={handleLogout}>ログアウト</button>
            <label>
              対象月
              <input type="month" value={ensureMonthValue(selectedMonth)} onChange={(event) => handleMonthSwitch(event.target.value)} />
            </label>
          </div>
        </header>

        {!isOnline ? <div className="notice-box">オフラインです。入力内容は端末に保存されています。</div> : null}
        {notice ? <div className="notice-box">{notice}</div> : null}
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
                    progress={summary.targetAchievement}
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
                    progress={customerTargetSummary.achievementRate}
                    secondaryValue={`目標まで ${customerTargetSummary.remainingCustomers}名`}
                    hint={`必要客数 ${customerTargetSummary.remainingCustomersPerDay.toFixed(1)}名/日`}
                    tone={getMetricTone(customerTargetSummary.achievementRate, 85, 100)}
                  />
                ) : null}
                {showReviewCountTargetField && hasReviewCountTarget ? (
                  <MetricCard
                    label="口コミ数達成率"
                    value={percent(summary.reviewCountAchievement)}
                    progress={summary.reviewCountAchievement}
                    secondaryValue={`目標まで ${number(summary.remainingReviewCountTarget)}件`}
                    tone={getMetricTone(summary.reviewCountAchievement, 85, 100)}
                  />
                ) : null}
                {dashboardSupportMetrics.map((item) => <MetricCard key={item.label} label={item.label} value={item.value} hint={item.hint} />)}
              </div>
              </div>
              <AiAssistantCard onOpen={() => openAiChat()} onQuickQuestion={(question) => openAiChat(question)} />
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
                <select value={rankingSort} onChange={(event) => setRankingSort(event.target.value)}>
                  <option value="sales">現在売上順</option>
                  <option value="achievement">目標達成率順</option>
                  <option value="change">前月比順</option>
                  <option value="profit">営業利益順</option>
                </select>
              </div>
              {stores.length === 0 ? (
                <div className="empty-card">店舗を追加してください。</div>
              ) : (
                <div className="ranking-accordion">
                  {rankingRows.map((row) => {
                    const isExpanded = expandedRankingStore === row.storeId;
                    return (
                      <button key={row.storeId} type="button" className={`ranking-card-accordion ${isExpanded ? "expanded" : ""}`} onClick={() => setExpandedRankingStore((current) => (current === row.storeId ? "" : row.storeId))}>
                        <div className="ranking-card-summary">
                          <div className="ranking-card-main">
                            <div className="ranking-card-rank">{row.currentRank === 1 ? "🥇" : row.currentRank === 2 ? "🥈" : row.currentRank === 3 ? "🥉" : row.currentRank}</div>
                            <div className="ranking-card-title">
                              <strong>{row.storeName}</strong>
                              <span>{row.trend} 前回 {row.previousRank || "-"}位</span>
                            </div>
                          </div>
                          <div className="ranking-card-kpis">
                            <span className={`status-chip ${!row.hasTargetSales ? "neutral" : row.achievement >= 100 ? "good" : row.achievement >= 85 ? "warning" : "danger"}`}>{row.hasTargetSales ? percent(row.achievement) : "－"}</span>
                            <span className={`status-chip ${row.currentChangeRate >= 0 ? "good" : "danger"}`}>{formatChangeRate(row.currentChangeRate)}</span>
                          </div>
                          <div className="ranking-card-value-block">
                            <span>現在売上</span>
                            <strong>{money(row.sales)}</strong>
                          </div>
                          <div className="ranking-card-toggle">{isExpanded ? "▲" : "▼"}</div>
                        </div>
                        {isExpanded ? (
                          <div className="ranking-card-details">
                            <div className="ranking-detail-item">
                              <span>目標売上</span>
                              <strong>{row.hasTargetSales ? money(row.targetSales) : "－"}</strong>
                            </div>
                            <div className="ranking-detail-item">
                              <span>前月売上</span>
                              <strong>{money(row.previousSales)}</strong>
                            </div>
                            <div className={`ranking-detail-item ${row.currentChangeRate >= 0 ? "positive" : "negative"}`}>
                              <span>前月比</span>
                              <strong>{formatChangeRate(row.currentChangeRate)}</strong>
                            </div>
                            <div className="ranking-detail-item">
                              <span>月末着地予測</span>
                              <strong>{money(row.forecast)}</strong>
                            </div>
                            <div className="ranking-detail-item">
                              <span>目標達成率</span>
                              <strong>{row.hasTargetSales ? percent(row.achievement) : "－"}</strong>
                            </div>
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
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
                          <input value={businessDayInput} onChange={(event) => setBusinessDayInput(event.target.value)} placeholder="店休日数を入力" type="number" min="0" max="31" />
                        </label>
                        <label className="field">
                          <span>営業日数（手動）</span>
                          <input value={manualBusinessDayInput} onChange={(event) => setManualBusinessDayInput(event.target.value)} placeholder="営業日数を入力" type="number" min="1" max="31" />
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
                        <select value={selectedStore} onChange={(event) => handleStoreSwitch(event.target.value)}>
                          {canViewAllStores(currentRole) ? <option value={ALL_STORES_VALUE}>全店舗</option> : null}
                          {visibleStores.length ? visibleStores.map((store) => <option key={store.id} value={store.name}>{store.name}</option>) : <option value="">未登録</option>}
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
                      {showTechnicalSalesField ? <Field label="技術売上（税込）" value={dailyForm.technicalSales || ""} onChange={(value) => updateDailyField("technicalSales", value)} suffix="円" placeholder="金額を入力" disabled={dailyMode === "view"} /> : null}
                      {showRetailSalesField ? <Field label="店販売上（税込）" value={dailyForm.retailSales || ""} onChange={(value) => updateDailyField("retailSales", value)} suffix="円" placeholder="金額を入力" disabled={dailyMode === "view"} /> : null}
                      {showOtherSalesField ? <Field label="その他売上（税込）" value={dailyForm.otherSales || ""} onChange={(value) => updateDailyField("otherSales", value)} suffix="円" placeholder="金額を入力" disabled={dailyMode === "view"} /> : null}
                      {totalSalesIsAutoCalculated ? (
                        <div className="summary-card compact">
                          <span>総売上（税込）</span>
                          <strong>{money(parseNumber(dailyForm.totalSales))}</strong>
                        </div>
                      ) : (
                        <Field label="総売上（税込）" value={dailyForm.totalSales || ""} onChange={(value) => updateDailyField("totalSales", value)} suffix="円" placeholder="金額を入力" disabled={dailyMode === "view"} />
                      )}
                    </div>

                    {showCustomersField ? (
                      <div className="daily-section-card">
                        <h3>客数</h3>
                        {customersIsAutoCalculated ? (
                          <div className="summary-card compact">
                            <span>客数</span>
                            <strong>{number(parseNumber(dailyForm.customers))}名</strong>
                          </div>
                        ) : (
                          <Field label="客数" value={dailyForm.customers || ""} onChange={(value) => updateDailyField("customers", value)} suffix="名" placeholder="人数を入力" disabled={dailyMode === "view"} />
                        )}
                        {showNewCustomersField ? <Field label="新規客数" value={dailyForm.newCustomers || ""} onChange={(value) => updateDailyField("newCustomers", value)} suffix="名" placeholder="人数を入力" disabled={dailyMode === "view"} /> : null}
                        {showRepeatCustomersField ? <Field label="再来客数" value={dailyForm.repeatCustomers || ""} onChange={(value) => updateDailyField("repeatCustomers", value)} suffix="名" placeholder="人数を入力" disabled={dailyMode === "view"} /> : null}
                      </div>
                    ) : null}

                    {showReviewCountField ? (
                      <div className="daily-section-card">
                        <h3>口コミ</h3>
                        <Field label="口コミ数" value={dailyForm.reviewCount || ""} onChange={(value) => updateDailyField("reviewCount", value)} suffix="件" placeholder="件数を入力" disabled={dailyMode === "view"} type="number" />
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

                  <div className="insight-card">
                    <p className="eyebrow">今日のAI分析</p>
                    <strong>{dailyInsight || "分析に必要なデータが不足しています"}</strong>
                  </div>

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
                          {activeMonthlyTargetFieldSettings.fields.targetSales ? <Field label="月間目標売上（税込）" value={targetDraft.targetSales} onChange={(value) => updateTargetDraftField("targetSales", value)} suffix="円" type="number" /> : null}
                          {!isAllStoresView && activeMonthlyTargetFieldSettings.fields.holidayCount ? <Field label="休業日" value={targetHolidayDraft} onChange={(value) => { setTargetHolidayDraft(value); setTargetDirty(true); }} suffix="日" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetTechnicalSales ? <Field label="技術売上目標（税込）" value={targetDraft.targetTechnicalSales} onChange={(value) => updateTargetDraftField("targetTechnicalSales", value)} suffix="円" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetRetailSales ? <Field label="店販売上目標（税込）" value={targetDraft.targetRetailSales} onChange={(value) => updateTargetDraftField("targetRetailSales", value)} suffix="円" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetCustomers ? <Field label="客数目標" value={targetDraft.targetCustomers} onChange={(value) => updateTargetDraftField("targetCustomers", value)} suffix="名" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetAverageSpend ? <Field label="客単価目標" value={targetDraft.targetAverageSpend} onChange={(value) => updateTargetDraftField("targetAverageSpend", value)} suffix="円" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetNewCustomers ? <Field label="新規客数目標" value={targetDraft.targetNewCustomers} onChange={(value) => updateTargetDraftField("targetNewCustomers", value)} suffix="名" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetRepeatCustomers ? <Field label="再来客数目標" value={targetDraft.targetRepeatCustomers} onChange={(value) => updateTargetDraftField("targetRepeatCustomers", value)} suffix="名" type="number" /> : null}
                          {showReviewCountTargetField ? <Field label="目標口コミ数" value={targetDraft.targetReviewCount} onChange={(value) => updateTargetDraftField("targetReviewCount", value)} suffix="件" type="number" /> : null}
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
                        <input value={fixedForm.amount} onChange={(event) => setFixedForm((prev) => ({ ...prev, amount: event.target.value }))} placeholder="今月の金額" type="number" />
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
                              <input
                                type="number"
                                value={draftAmount}
                                placeholder={savedAmount === undefined ? "未入力" : ""}
                                onChange={(event) => setCostAmountDraft(item.id, event.target.value)}
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
                            <strong>{item.entered ? "✅" : "⚠️"} {item.label}</strong>
                            <small>{item.entered ? "入力済み" : "未入力"}</small>
                          </div>
                          {!item.entered ? (
                            <div className="row-actions">
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
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    {monthClosingChecklist.missingItems.length > 0 ? (
                      <div className="empty-card">損益表に必要な未入力項目があります: {monthClosingChecklist.missingItems.map((item) => item.label).join("、")}</div>
                    ) : null}
                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">P&L PREVIEW</p>
                        <h3>現時点の損益表</h3>
                      </div>
                    </div>
                    <div className="summary-grid">
                      <div className="summary-card"><span>店販比率</span><strong>{percent(summary.retailRatio || 0)}</strong></div>
                      <div className="summary-card"><span>人件費率</span><strong>{formatPercentOrDash(summary.laborRate, summary.categoryHasEntry.labor)}</strong></div>
                      <div className="summary-card"><span>材料・仕入原価率</span><strong>{formatPercentOrDash(summary.costOfGoodsSoldRate, summary.categoryHasEntry.materials)}</strong></div>
                      <div className="summary-card emphasize">
                        <span>営業利益率</span>
                        <strong>{formatPercentOrDash(summary.operatingMargin, !summary.isProvisionalProfit)}</strong>
                      </div>
                    </div>
                    {summary.isProvisionalProfit ? (
                      <p className="helper-text">※{summary.missingCriticalCategories.map((key) => getCostCategoryLabel(key)).join("・")}が未入力のため、営業利益は算出できません。</p>
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
                                <input type="number" value={openingInventoryDraft} onChange={(event) => setOpeningInventoryDraft(event.target.value)} placeholder="金額" />
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
                            <input type="number" value={closingInventoryDraft} onChange={(event) => setClosingInventoryDraft(event.target.value)} placeholder="金額" />
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
                            <input type="number" value={taxSettingsForm.consumptionTaxReserveRate} onChange={(event) => setTaxSettingsForm((prev) => ({ ...prev, consumptionTaxReserveRate: event.target.value }))} placeholder="例: 5" />
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
            {normalizeRole(currentRole) === "system_admin" ? (
              <div className="inline-form">
                <label className="field">
                  <span>会社選択</span>
                  <select value={appState.currentCompanyId || ""} onChange={(event) => handleCompanySwitch(event.target.value)}>
                    {(appState.companies || []).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                  </select>
                </label>
              </div>
            ) : null}
            <p className="management-help">会社を追加して、店舗・ユーザー・設定をまとめて管理できます。業種を先に選ぶと、後続の店舗登録も自然になります。</p>
            <div className="inline-form">
              <input value={companyForm.name} onChange={(event) => setCompanyForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="会社名" />
              <input value={companyForm.code} onChange={(event) => setCompanyForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="会社コード" />
              <select value={companyForm.businessType || "salon"} onChange={(event) => setCompanyForm((prev) => ({ ...prev, businessType: event.target.value }))}>
                <option value="salon">サロン</option>
                <option value="nail">ネイルサロン</option>
                <option value="eyelash">まつげサロン</option>
                <option value="esthetic">エステサロン</option>
              </select>
              <select value={companyForm.contractStatus} onChange={(event) => setCompanyForm((prev) => ({ ...prev, contractStatus: event.target.value }))}>
                <option value="trial">トライアル</option>
                <option value="active">契約中</option>
                <option value="suspended">停止中</option>
              </select>
              <button className="primary-button" type="button" onClick={handleSaveCompany}>{companyEditId ? "会社情報を更新" : "会社追加"}</button>
            </div>
            {(appState.companies || []).filter((company) => normalizeRole(currentRole) === "system_admin" || company.id === currentCompany?.id).length ? (
              <div className="card-grid">
                {(appState.companies || []).filter((company) => normalizeRole(currentRole) === "system_admin" || company.id === currentCompany?.id).map((company) => {
                  const companyUsers = (appState.users || []).filter((user) => user.companyId === company.id);
                  return (
                    <div key={company.id} className="info-card">
                      <div className="info-card-head">
                        <div>
                          <strong>{company.name}</strong>
                          <small>{company.code}</small>
                        </div>
                        <span className={`status-pill ${company.isActive ? "saved" : "error"}`}>{company.isActive ? "有効" : "停止"}</span>
                      </div>
                      <div className="info-card-meta">
                        <span>業種 {getBusinessTypeLabel(company.businessType || "salon")}</span>
                        <span>店舗数 {company.stores?.length || 0}</span>
                        <span>ユーザー数 {companyUsers.length}</span>
                        <span>契約 {company.contractStatus || "trial"}</span>
                      </div>
                      <div className="row-actions">
                        <button className="text-button" type="button" onClick={() => handleEditCompany(company)}>編集</button>
                        <button className="text-button" type="button" onClick={() => handleCompanySwitch(company.id)}>切替</button>
                        <button className="text-button" type="button" onClick={() => handleToggleCompanyStatus(company)}>{company.isActive ? "停止" : "再開"}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="management-empty">まだ会社が登録されていません。上のフォームから最初の会社を追加してください。</div>
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
            {canEditStoreName(currentRole) && (
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
                  <input type="number" min="0" step="1" value={storeForm.staffCount} onChange={(event) => setStoreForm((prev) => ({ ...prev, staffCount: event.target.value }))} placeholder="例: 6" />
                </label>
                <label className="field">
                  <span>生産性計算人数（任意）</span>
                  <input type="number" min="0" step="0.1" value={storeForm.productivityStaffCount} onChange={(event) => setStoreForm((prev) => ({ ...prev, productivityStaffCount: event.target.value }))} placeholder="例: 5.0" />
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
              ) : !canEditStoreName(currentRole) ? (
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
              ) : !canEditStoreName(currentRole) ? (
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
                      disabled={!canEditStoreName(currentRole)}
                      onChange={(event) => handleToggleInventoryTracking(event.target.checked)}
                    />
                  </label>
                </>
              )}
            </div>
            {filteredStores.length ? (
              <div className="card-grid store-card-grid">
                {filteredStores.map((store) => {
                  const summary = computeStoreSummary(store, { staffCount: store.staffIds?.length || store.staffCount || 0 });
                  const statusLabel = store.status === "archived" ? "アーカイブ" : store.isActive === false ? "停止" : "運営中";
                  return (
                    <div key={store.id} className="info-card store-info-card">
                      <div className="info-card-head">
                        <div>
                          <strong>{store.name}</strong>
                        </div>
                        <span className={`status-pill ${store.isActive === false || store.status === "archived" ? "error" : "saved"}`}>{statusLabel}</span>
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
                        {canEditStoreName(currentRole) && (canManageStores(currentRole) || allowedStoreIds.includes(store.id)) && (
                          <button className="text-button" type="button" onClick={() => handleEditStore(store)}>編集</button>
                        )}
                        {canManageStores(currentRole) && (store.status === "archived" ? (
                          <button className="text-button" type="button" onClick={() => handleRestoreStore(store)}>復元</button>
                        ) : (
                          <button className="text-button" type="button" onClick={() => handleToggleStoreStatus(store)}>{store.isActive ? "停止" : "再開"}</button>
                        ))}
                      </div>
                      {canManageStores(currentRole) && (
                        <div className="row-actions compact-actions">
                          <button className="text-button" type="button" onClick={() => handleDuplicateStore(store)}>複製</button>
                          {store.status === "archived" ? null : <button className="text-button" type="button" onClick={() => handleArchiveStore(store)}>アーカイブ</button>}
                          <button className="text-button danger" type="button" onClick={() => handleDeleteStore(store)}>削除</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="management-empty">まだ店舗が登録されていません。上のフォームから店舗を追加してください。</div>
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
            {!canViewUserManagement(currentRole) ? (
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
                    <button className="primary-button" type="button" onClick={handleSaveUser}>招待する</button>
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
                                          <div className="row-actions">
                                            <button className="text-button" type="button" onClick={() => handleEditUser(user)}>編集</button>
                                            <button className="text-button" type="button" onClick={() => handleToggleUserStatus(user)}>{user.isActive ? "停止" : "再開"}</button>
                                            {!isRegistered && (
                                              <>
                                                <button className="text-button" type="button" onClick={() => handleCopyInviteLink(user)}>招待リンクをコピー</button>
                                                <button className="text-button" type="button" onClick={() => handleInviteEmail(user)}>招待メール再送</button>
                                              </>
                                            )}
                                            {user.id !== currentUser?.profileId && (
                                              <button className="text-button danger" type="button" onClick={() => requestDeleteUser(user)}>削除</button>
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
          return (
            <div className="modal-overlay" onClick={closeDeleteUserModal}>
              <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">DELETE USER</p>
                    <h3>このユーザーを削除しますか？</h3>
                  </div>
                </div>
                {deleteUserError ? <div className="notice-box">{deleteUserError}</div> : null}
                <p>
                  <strong>{deleteTarget.name}</strong>（{deleteTarget.email}）を削除します。
                </p>
                <p className="helper-text">
                  Supabaseの認証アカウント・ユーザー情報・所属店舗・招待情報が削除されます。このユーザーが過去に入力した売上・費用・月締め等の業務データは削除されず、履歴として保持されます。この操作は取り消せません。
                </p>
                <div className="row-actions" style={{ marginTop: 12 }}>
                  <button className="secondary-button" type="button" onClick={closeDeleteUserModal} disabled={deleteUserSaving}>キャンセル</button>
                  <button className="primary-button danger-button" type="button" onClick={handleConfirmDeleteUser} disabled={deleteUserSaving}>{deleteUserSaving ? "削除中..." : "削除する"}</button>
                </div>
              </div>
            </div>
          );
        })()}

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
                    <input type="number" value={taxSettingsForm.consumptionTaxReserveRate} onChange={(event) => setTaxSettingsForm((prev) => ({ ...prev, consumptionTaxReserveRate: event.target.value }))} placeholder="例: 10" />
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
    </div>
  );
}

// progress(0-100、任意)を渡すと数値のすぐ下に細い進捗バーを表示する。目標達成率系の
// カードで「上に内容が寄って下が空白になる」問題を、意味のある情報(進捗バー)で埋めるための
// 共通の仕組み — 今後増えるカードも同じpropを使うだけで同じ見た目に揃う。
function MetricCard({ label, value, secondaryValue = "", hint = "", tone = "", progress = null, emphasize = false, hero = false, onClick = null }) {
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
      {typeof progress === "number" ? (
        <div className="metric-card-progress">
          <div className={`metric-card-progress-fill ${tone}`} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      ) : null}
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

function Field({ label, value, onChange, suffix = "", type = "text", disabled = false, placeholder = "" }) {
  const normalizedValue = value === undefined || value === null ? "" : value;
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-with-suffix">
        <input type={type} value={normalizedValue} onChange={(event) => onChange(event.target.value)} disabled={disabled} placeholder={placeholder} />
        {suffix ? <span>{suffix}</span> : null}
      </div>
    </label>
  );
}

export default App;
