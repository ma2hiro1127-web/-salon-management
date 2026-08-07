import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  dailyFieldKeys,
  dailyFieldPresets,
  defaultClosingItem,
  defaultDailyEntry,
  defaultDailyFieldSettings,
  defaultFixedCostItem,
  defaultMonthlyTargetFieldSettings,
  defaultTarget,
  defaultVariableCostItem,
  expenseCategories,
  fixedCostCategories,
  monthlyTargetFieldKeys,
  variableCostCategories,
} from "./data/defaults.js";
import {
  STORAGE_KEYS,
  buildDailyEntryPayload,
  buildDailyStateFromRows,
  dailySalesRowToEntry,
  buildMonthClosingStateFromRows,
  buildTargetStateFromRows,
  buildMonthKey,
  calculateMonthSummary,
  calculateTaxSummary,
  deduplicateDailyEntries,
  getBusinessDaySettings,
  formatMonthLabel,
  getBusinessDaySummary,
  getClosingItemsForStoreMonth,
  getCustomerTargetSummary,
  getSalesStatusComment,
  getDailyResultsForStoreMonth,
  getFixedCostsForStoreMonth,
  formatLocalDate,
  getMonthInfo,
  getTargetForStoreMonth,
  getVariableCostsForStoreMonth,
  mergeRemoteAppState,
  money,
  moneyDiff,
  number,
  parseNumber,
  percent,
  readAppState,
  readStorage,
  normalizeAppState,
  rekeyStoreNamedMaps,
  writeAppState,
} from "./utils/storage.js";
import { getAllowedStoreIdsForRole, getVisibleNavItems, resolveDefaultPage, canAccessPage, canManageCompanies, canManageStores, canEditStoreName, canManageUsers as canManageUsersByRole, canEditMonthlyData, canViewUserManagement, normalizeRole, isAdminRole } from "./utils/permissions.js";
import { createInitialAppState } from "./data/defaults.js";
import AuthGate from "./components/AuthGate.jsx";
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
  getProfileByEmail,
  createCompanyRecord,
  createStoreRecord,
  updateStoreRecord,
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
  logSupabaseError,
  signUpWithEmail,
  getProfilesForDebug,
  resolveRoleForEmail,
  updateProfileRole,
  updateProfileStoreAssignments,
} from "./utils/supabase.js";
import { loadLatestTenantSnapshot, upsertTenantSnapshot } from "./utils/supabaseRemote.js";
import { getBusinessTypeDefaultStoreName, getBusinessTypeLabel } from "./utils/businessProfile.js";
import { getLocalizedSupabaseErrorMessage } from "./utils/authMessages.js";
import { buildInviteLink, createInviteToken, getInvitationStatusMeta, isInviteExpired } from "./utils/invitations.js";
import { resolveLocalLoginCandidate } from "./utils/authFlow.js";
import { computeStoreSummary, normalizeStoreUrls, sortStoresForManagement } from "./utils/storeManagement.js";

const navItems = [
  { id: "dashboard", label: "売上" },
  { id: "daily", label: "日次入力" },
  { id: "monthly", label: "管理画面" },
  { id: "companies", label: "会社管理" },
  { id: "stores", label: "店舗管理" },
  { id: "users", label: "ユーザー管理" },
  { id: "settings", label: "設定" },
];

const targetMonthOptions = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));

const monthlyTabs = [
  { id: "target", label: "目標設定" },
  { id: "fixed", label: "固定費" },
  { id: "variable", label: "販管費" },
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

const getStatusTone = ({ error = false, status = "idle" } = {}) => {
  if (error) return "error";
  if (status === "saving" || status === "syncing" || status === "loaded") return "saving";
  if (status === "saved" || status === "synced") return "saved";
  return "neutral";
};

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

const buildStatusCards = ({ saveStatus, syncStatus, isSupabaseConfigured, isOnline }) => ([
  {
    key: "save",
    label: "入力保存",
    message: saveStatus.message || "自動保存待機中",
    tone: getStatusTone(saveStatus),
    timestamp: saveStatus.timestamp,
  },
  {
    key: "sync",
    label: "Supabase同期",
    message: syncStatus.message || (isSupabaseConfigured ? "同期待機中" : "同期未対応"),
    tone: getStatusTone(syncStatus),
    timestamp: syncStatus.timestamp,
  },
  {
    key: "network",
    label: "通信状態",
    message: isOnline ? "オンライン" : "オフラインでも端末保存中",
    tone: isOnline ? "saved" : "error",
    timestamp: "",
  },
]);

const getMetricTone = (value, warningThreshold = 80, successThreshold = 100) => {
  if (!Number.isFinite(value)) return "neutral";
  if (value >= successThreshold) return "good";
  if (value >= warningThreshold) return "warning";
  return "danger";
};

const getMonthOffset = (monthValue, offset) => {
  const [year, month] = monthValue.split("-").map(Number);
  const nextDate = new Date(year, month - 1 + offset, 1);
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
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

const formatTimestamp = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
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
});

const dailyFieldLabels = {
  technicalSales: "技術売上",
  retailSales: "店販売上",
  customers: "来店客数",
  newCustomers: "新規客数",
  repeatCustomers: "再来客数",
  memo: "メモ",
};

const monthlyTargetFieldLabels = {
  targetSales: "月間目標売上",
  targetTechnicalSales: "技術売上目標",
  targetRetailSales: "店販売上目標",
  targetCustomers: "目標客数",
  targetAverageSpend: "目標客単価",
  targetNewCustomers: "目標新規数",
  targetRepeatCustomers: "目標再来数",
  targetLaborRate: "人件費率",
  targetMaterialRate: "材料費率",
  targetAdRate: "広告費率",
  targetOperatingMargin: "営業利益率",
  holidayCount: "休業日",
};

const createStoreFormDefaults = () => ({
  name: "",
  code: "",
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
});

const getUserInvitationMeta = (user) => {
  const invitationStatus = String(user?.invitationStatus || "active").toLowerCase();
  const meta = getInvitationStatusMeta(invitationStatus);
  const expireAt = user?.inviteExpiresAt ? new Date(user.inviteExpiresAt) : null;
  const expired = Boolean(expireAt && isInviteExpired(user.inviteExpiresAt));

  if (invitationStatus === "invited") {
    return { ...meta, expiresAt: expireAt, status: expired ? "expired" : "invited" };
  }
  if (invitationStatus === "registered") {
    return { ...meta, expiresAt: null, status: "registered" };
  }
  if (invitationStatus === "expired") {
    return { ...meta, expiresAt: null, status: "expired" };
  }
  if (invitationStatus === "suspended") {
    return { ...meta, expiresAt: null, status: "suspended" };
  }
  return { ...meta, expiresAt: null, status: invitationStatus };
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

const buildDailyInsight = ({ form, targetSales, businessDayCount }) => {
  const totalSales = parseNumber(form.totalSales);
  const retailSales = parseNumber(form.retailSales);
  const customers = parseNumber(form.customers);
  const newCustomers = parseNumber(form.newCustomers);
  const repeatCustomers = parseNumber(form.repeatCustomers);
  const targetDailySales = businessDayCount > 0 ? targetSales / businessDayCount : 0;

  if (!totalSales && !retailSales && !customers && !newCustomers && !repeatCustomers) {
    return "分析に必要なデータが不足しています";
  }

  const insights = [];
  if (targetDailySales > 0 && totalSales > 0) {
    const rate = ((totalSales / targetDailySales) - 1) * 100;
    insights.push(`今日は目標より${Math.abs(rate).toFixed(0)}%${rate >= 0 ? "高い" : "低い"}です`);
  }

  if (totalSales > 0 && retailSales > 0) {
    const retailRatio = retailSales / totalSales;
    insights.push(retailRatio >= 0.7 ? "店販率は概ね良好です" : "店販率が目標を下回っています");
  }

  if (customers > 0) {
    const newRate = (newCustomers / customers) * 100;
    const repeatRate = (repeatCustomers / customers) * 100;
    insights.push(newRate >= 30 ? "新規客数は順調です" : "新規客数をもう少し増やせると伸びます");
    insights.push(repeatRate >= 50 ? "再来率は安定しています" : "再来率をもう少し改善すると利益率が上がります");
  }

  return insights.slice(0, 3).join("\n");
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
    companySnapshots[defaultCompanyId] = { ...createInitialAppState(), ...seeded, stores: defaultCompany.stores.map((store) => store.name), selectedStore: defaultCompany.stores[0]?.name || "", selectedMonth: seeded.selectedMonth || createInitialAppState().selectedMonth };
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

const getLocalFallbackAuthUser = () => null;

const canManageCompany = (role) => canManageCompanies(role);
const canManageStore = (role) => canManageStores(role);
const canManageUsers = (role) => canManageUsersByRole(role);

const buildStoredUserHydrationState = async ({ storedUser, setCurrentUser, setCurrentRole, setAppState, setAuthMode, setActivePage, setDebugInfo, setSyncStatus, setAuthError, hydrateFromSupabase, refreshAuthDebugInfo }) => {
  if (!storedUser?.authUserId && !storedUser?.email) return false;

  try {
    const profile = await ensureProfileForAuthUser({ authUserId: storedUser.authUserId, email: storedUser.email, role: storedUser.role });
    const tenantState = await loadTenantStateFromSupabase({ authUserId: storedUser.authUserId, email: storedUser.email, currentProfile: profile });
    const nextUser = buildAuthenticatedUser({
      profile,
      authUser: storedUser.authUserId ? { id: storedUser.authUserId, email: storedUser.email } : null,
      fallback: storedUser,
      role: storedUser.role,
      companyId: storedUser.company_id,
      storeId: storedUser.store_id,
    });
    const nextState = {
      ...tenantState,
      currentCompanyId: nextUser.company_id || tenantState.currentCompanyId || storedUser.company_id || "",
      currentUserId: nextUser.profileId,
      currentAuthUserId: nextUser.authUserId,
    };

    setCurrentUser(nextUser);
    setCurrentRole(normalizeRole(profile?.role || storedUser.role || "staff"));
    setAppState(nextState);
    setSyncStatus({ status: "syncing", message: "同期中です…", timestamp: new Date().toISOString(), error: false });
    await hydrateFromSupabase({
      authUser: { id: nextUser.authUserId, email: nextUser.email },
      profile: { id: nextUser.profileId, company_id: nextState.currentCompanyId, role: normalizeRole(profile?.role || storedUser.role || "staff") },
      tenantState: nextState,
    });
    await refreshAuthDebugInfo({ sessionUser: { id: nextUser.authUserId, email: nextUser.email }, role: profile?.role, profile, hasSession: false, authUser: { id: nextUser.authUserId, email: nextUser.email }, setDebugInfo });
    window.localStorage.setItem("salon-user", JSON.stringify(nextUser));
    window.localStorage.setItem("salon-role", normalizeRole(profile?.role || storedUser.role || "staff"));
    setAuthMode("app");
    setActivePage(resolveDefaultPage(normalizeRole(profile?.role || storedUser.role || "staff")));
    return true;
  } catch (error) {
    console.warn("Stored-user hydration failed", error);
    setAuthError(getLocalizedSupabaseErrorMessage(error));
    return false;
  }
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
  const [storeSearch, setStoreSearch] = useState("");
  const [storeSort, setStoreSort] = useState("achievement");
  const [userForm, setUserForm] = useState({ name: "", email: "", role: "store_manager", companyId: "", storeIds: [], primaryStoreId: "", invitationStatus: "invited", loginCount: 0, lastLoginAt: "", isActive: true });
  const [appState, setAppState] = useState(initialAppStateValue);
  const [companyEditId, setCompanyEditId] = useState("");
  const [storeEditId, setStoreEditId] = useState("");
  const [userEditId, setUserEditId] = useState("");
  const [companySettingsForm, setCompanySettingsForm] = useState(createCompanySettingsDefaults());
  const [storeSettingsForm, setStoreSettingsForm] = useState(createStoreSettingsDefaults());
  const [setupStep, setSetupStep] = useState("company");
  const [dailyForm, setDailyForm] = useState({ ...defaultDailyEntry });
  const updateDailyField = (field, value) => {
    setDailyForm((prev) => {
      const next = { ...prev, [field]: value };
      if (totalSalesIsAutoCalculated && (field === "technicalSales" || field === "retailSales")) {
        next.totalSales = parseNumber(field === "technicalSales" ? value : prev.technicalSales) + parseNumber(field === "retailSales" ? value : prev.retailSales);
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
  const [fixedForm, setFixedForm] = useState(defaultFixedCostItem);
  const [variableForm, setVariableForm] = useState(defaultVariableCostItem);
  const [closingForm, setClosingForm] = useState(defaultClosingItem);
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
  const lastPersistedRef = useRef("");
  const autoSaveTimerRef = useRef(null);
  const lastAutoSaveSignatureRef = useRef("");
  const remoteSyncChannelRef = useRef(null);
  const hydrateRetryTimerRef = useRef(null);
  const hydrateRetryCountRef = useRef(0);
  const { stores, selectedStore, selectedMonth } = appState;
  const currentCompany = useMemo(() => appState.companies?.find((company) => company.id === appState.currentCompanyId) || appState.companies?.[0] || null, [appState.companies, appState.currentCompanyId]);
  const currentCompanyStores = useMemo(() => currentCompany?.stores || [], [currentCompany]);
  const selectedStoreEntity = useMemo(() => currentCompanyStores.find((store) => store.name === selectedStore) || currentCompanyStores[0] || null, [currentCompanyStores, selectedStore]);
  const activeDailyFieldSettings = useMemo(() => normalizeDailyFieldSettings(selectedStoreEntity?.settings?.dailyFieldSettings), [selectedStoreEntity]);
  const activeMonthlyTargetFieldSettings = useMemo(() => normalizeMonthlyTargetFieldSettings(selectedStoreEntity?.settings?.monthlyTargetFields), [selectedStoreEntity]);
  const showTechnicalSalesField = Boolean(activeDailyFieldSettings.fields.technicalSales);
  const showRetailSalesField = Boolean(activeDailyFieldSettings.fields.retailSales);
  const showCustomersField = Boolean(activeDailyFieldSettings.fields.customers);
  const showNewCustomersField = showCustomersField && Boolean(activeDailyFieldSettings.fields.newCustomers);
  const showRepeatCustomersField = showCustomersField && Boolean(activeDailyFieldSettings.fields.repeatCustomers);
  const showMemoField = Boolean(activeDailyFieldSettings.fields.memo);
  const totalSalesIsAutoCalculated = showTechnicalSalesField && showRetailSalesField;
  const customersIsAutoCalculated = showNewCustomersField && showRepeatCustomersField;
  // updateDailyField keeps dailyForm.totalSales/dailyForm.customers correctly synced whether
  // they're auto-calculated (technicalSales+retailSales / newCustomers+repeatCustomers) or
  // typed directly, so both are always safe to read as-is here.
  const dailyEffectiveTotalSales = parseNumber(dailyForm.totalSales);
  const dailyEffectiveCustomers = parseNumber(dailyForm.customers);
  const currentUserProfile = useMemo(() => (appState.users || []).find((user) => user.id === appState.currentUserId) || null, [appState.currentUserId, appState.users]);
  const allowedStoreIds = useMemo(() => getAllowedStoreIdsForRole({ role: currentRole, companyStoreIds: currentCompanyStores.map((store) => store.id), currentUserStoreIds: currentUserProfile?.storeIds || [] }), [currentRole, currentCompanyStores, currentUserProfile]);
  const visibleStores = useMemo(() => {
    if (!currentCompanyStores.length) return [];
    return currentCompanyStores.filter((store) => allowedStoreIds.includes(store.id));
  }, [allowedStoreIds, currentCompanyStores]);
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
      const haystack = [store.name, store.code, store.address, store.phone, store.managerName, (store.serviceTypes || []).join(" ")].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(searchValue);
    });
    return sortStoresForManagement(source, storeSort);
  }, [currentCompany?.stores, storeSearch, storeSort, currentRole, allowedStoreIds]);
  const activeBusinessType = companyForm.businessType || currentCompany?.businessType || "salon";
  const storeNamePlaceholder = getBusinessTypeDefaultStoreName(activeBusinessType);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        if (!isSupabaseConfigured) {
          setCurrentUser(null);
          setCurrentRole("staff");
          setDebugInfo({ userId: "", email: "", role: "staff", hasSession: false, profiles: [] });
          setAuthMode("login");
          setActivePage("dashboard");
          setAppState(initialAppStateValue);
          return;
        }

        const { data: { session }, error } = await getSupabaseSession();
        if (error) throw error;
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
          const availableStoreNames = new Set((reconciledCompanies.find((company) => company.id === reconciledCurrentCompanyId)?.stores || reconciledCompanies[0]?.stores || []).map((store) => store.name));
          // loadTenantStateFromSupabase always defaults selectedStore to the alphabetically-first
          // store in the company, which previously clobbered whichever store the user actually had
          // open on this device (e.g. 本店 losing out to フィーネ横浜). Only fall back to that
          // default when the device's own last-selected store no longer exists.
          const preferredSelectedStore = localRecoveredState.selectedStore && availableStoreNames.has(localRecoveredState.selectedStore)
            ? localRecoveredState.selectedStore
            : (tenantState.selectedStore || localRecoveredState.selectedStore || "");
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
            selectedMonth: tenantState.selectedMonth || localRecoveredState.selectedMonth || new Date().toISOString().slice(0, 7),
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
        setAuthMode("login");
        setActivePage("dashboard");
        setAppState(initialAppStateValue);
      } catch (error) {
        setCurrentUser(null);
        setCurrentRole("staff");
        setDebugInfo({ userId: "", email: "", role: "staff", hasSession: false, profiles: [] });
        setAuthMode("login");
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
    if (selectedStoreEntity) {
      setStoreSettingsForm(selectedStoreEntity.settings || createStoreSettingsDefaults());
    }
  }, [selectedStoreEntity]);

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
  const showInitialSetup = Boolean(currentCompany && !currentCompany.setup?.complete && isAdminUser);
  const target = getTargetForStoreMonth(appState, selectedStore, selectedMonth);
  const dailyEntries = useMemo(() => getDailyResultsForStoreMonth(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const fixedCosts = useMemo(() => getFixedCostsForStoreMonth(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const variableCosts = useMemo(() => getVariableCostsForStoreMonth(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const closingItems = useMemo(() => getClosingItemsForStoreMonth(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const summary = useMemo(() => calculateMonthSummary(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const businessDaySummary = useMemo(() => getBusinessDaySummary(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const taxSummary = useMemo(() => calculateTaxSummary({ sales: summary.sales, totalExpenses: summary.expenseTotal, taxRate: appState.taxSettings?.rate ?? 0.1, roundingMode: appState.taxSettings?.roundingMode || "half-up" }), [appState.taxSettings?.rate, appState.taxSettings?.roundingMode, summary.expenseTotal, summary.sales]);
  const customerTargetSummary = useMemo(() => getCustomerTargetSummary({ customers: summary.customers, targetCustomers: summary.customerTarget, businessDayCount: summary.businessDays, completedDays: summary.completedDays, remainingBusinessDays: summary.remainingBusinessDays, targetAverageCustomersPerDay: parseNumber(target.targetAverageCustomersPerDay) }), [summary.businessDays, summary.completedDays, summary.customerTarget, summary.customers, summary.remainingBusinessDays, target.targetAverageCustomersPerDay]);
  const salesStatusComment = useMemo(() => getSalesStatusComment({
    targetSales: parseNumber(target.targetSales),
    closedSales: summary.closedSales,
    businessDayCount: summary.businessDays,
    completedDays: summary.completedDays,
    remainingBusinessDays: summary.remainingBusinessDays,
    targetCustomers: summary.customerTarget,
    customers: summary.customers,
    targetAverageSpend: parseNumber(target.targetAverageSpend),
    averageSpend: summary.averageSpend,
    // Included so the same underlying situation reads differently across different days
    // instead of repeating verbatim (see pickVariant) — stable within a single day/store/month.
    seed: `${selectedStore}-${selectedMonth}-${new Date().toISOString().slice(0, 10)}`,
  }), [target.targetSales, target.targetAverageSpend, summary.closedSales, summary.businessDays, summary.completedDays, summary.remainingBusinessDays, summary.customerTarget, summary.customers, summary.averageSpend, selectedStore, selectedMonth]);
  const businessDaySettings = useMemo(() => getBusinessDaySettings(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const monthClosingStatus = useMemo(() => {
    const key = buildMonthKey(selectedStore, selectedMonth);
    return appState.monthClosingStatus?.[key] || { closed: false, lockedAt: "", note: "" };
  }, [appState.monthClosingStatus, selectedStore, selectedMonth]);
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

    const rows = currentCompanyStores.map((store) => {
      const storeSummary = calculateMonthSummary(appState, store.name, selectedMonth);
      const previousSummary = calculateMonthSummary(appState, store.name, previousMonth);
      const previousPreviousSummary = calculateMonthSummary(appState, store.name, previousPreviousMonth);
      const currentChangeRate = previousSummary.sales > 0 ? ((storeSummary.sales - previousSummary.sales) / previousSummary.sales) * 100 : 0;
      const previousChangeRate = previousPreviousSummary.sales > 0 ? ((previousSummary.sales - previousPreviousSummary.sales) / previousPreviousSummary.sales) * 100 : 0;

      return {
        storeId: store.id,
        storeName: store.name,
        sales: storeSummary.sales,
        targetSales: storeSummary.target.targetSales,
        achievement: storeSummary.targetAchievement,
        operatingProfit: storeSummary.operatingProfit,
        previousSales: previousSummary.sales,
        previousAchievement: previousSummary.targetAchievement,
        previousOperatingProfit: previousSummary.operatingProfit,
        previousChangeRate,
        currentChangeRate,
        forecast: storeSummary.forecast,
        tone: getRankTone(storeSummary.targetAchievement),
        achievementLabel: storeSummary.targetAchievement >= 100 ? "順調" : storeSummary.targetAchievement >= 95 ? "要確認" : "要改善",
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
    const previousRankMap = new Map(previousRankedRows.map((row) => [row.storeName, row.previousRank]));

    return rankedRows.map((row) => ({
      ...row,
      previousRank: previousRankMap.get(row.storeName) || 0,
      trend: row.previousRank ? (row.currentRank < row.previousRank ? "↑" : row.currentRank > row.previousRank ? "↓" : "→") : "→",
    }));
  }, [appState, rankingSort, selectedMonth, currentCompanyStores]);
  const statusCards = useMemo(() => buildStatusCards({ saveStatus, syncStatus, isSupabaseConfigured, isOnline }), [saveStatus, syncStatus, isSupabaseConfigured, isOnline]);
  const goToMonthlyTargetSetting = () => {
    setActivePage("monthly");
    setActiveMonthlyTab("target");
  };
  // Whether a monthly target actually exists in Supabase for the store+month currently on
  // screen — not just "is the target panel showing something", since that panel has its own
  // independent month selector (see targetSelectedMonth) and could be looking at a different
  // month entirely. appState.targets is kept fresh for this exact store+month by
  // hydrateFromSupabase's monthly_targets overlay (see loadMonthlyTargetsForCompany).
  const hasSalesTarget = parseNumber(target.targetSales) > 0;
  const hasCustomerTarget = parseNumber(target.targetCustomers) > 0;
  // ④ 目標との差額: positive (at/over target) is green "＋", short of target is red "▲".
  const salesVsTarget = summary.sales - parseNumber(target.targetSales);
  // ⑤ 月末着地予測 vs 目標: forecast itself doesn't need a target to compute (it's pace-based),
  // only this comparison line does.
  const forecastVsTarget = summary.forecast - parseNumber(target.targetSales);
  const dashboardSupportMetrics = useMemo(() => ([
    { label: "平均客単価", value: money(summary.averageSpend), hint: `必要客数 ${customerTargetSummary.remainingCustomersPerDay.toFixed(1)}名/日` },
    { label: "1日平均売上", value: money(summary.averageSales), hint: `必要売上 ${money(summary.dailyNeededSales)}` },
    { label: "顧客数", value: number(summary.customers), hint: `新規 ${number(summary.newCustomers)} / 再来 ${number(summary.repeatCustomers)}` },
  ]), [summary.averageSpend, customerTargetSummary.remainingCustomersPerDay, summary.averageSales, summary.dailyNeededSales, summary.customers, summary.newCustomers, summary.repeatCustomers]);
  // One unified AI comment card (順調/注意/要改善), replacing the previous 3-card split
  // (目標まで/目標ペース/必要な1日平均売上) — see getSalesStatusComment for the tier logic.
  // getSalesStatusComment already produces a sensible "月間目標を設定すると..." fallback
  // message when neither a sales nor a customer target is registered (salesState/customerState
  // both null) — this just decides whether to show the tier badge for that case.
  const aiComment = salesStatusComment;
  const aiCommentUnset = !aiComment.salesState && !aiComment.customerState;
  const aiCommentTone = aiCommentUnset ? "neutral" : ({ "順調": "good", "注意": "warning", "要改善": "danger" }[aiComment.tier] || "neutral");

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
        setAppState({
          ...tenantState,
          currentCompanyId: profile?.company_id || tenantState.currentCompanyId || "",
          currentUserId: nextUser.profileId,
          currentAuthUserId: nextUser.authUserId,
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
    const invitedUser = inviteToken
      ? (appState.users || []).find((user) => String(user.inviteToken || "").trim() === inviteToken) || null
      : null;

    if (invitedUser) {
      if (!invitedUser.isActive || invitedUser.invitationStatus === "suspended") {
        setAuthError("この招待は無効です。管理者にお問い合わせください。");
        setAuthLoading(false);
        return;
      }
      if (isInviteExpired(invitedUser.inviteExpiresAt)) {
        setAuthError("この招待リンクは期限切れです。管理者にお問い合わせください。");
        setAuthLoading(false);
        return;
      }
      if (String(invitedUser.email || "").trim().toLowerCase() && normalizedEmail !== String(invitedUser.email || "").trim().toLowerCase()) {
        setAuthError("招待メールアドレスと一致するメールアドレスで登録してください。");
        setAuthLoading(false);
        return;
      }
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

      if (invitedUser) {
        const nextCompanyId = invitedUser.companyId || appState.currentCompanyId || currentCompany?.id || "";
        const nextRole = normalizeRole(invitedUser.role || "store_manager");
        const profile = authUser
          ? await ensureProfileForAuthUser({ authUserId: authUser.id, email: normalizedEmail, role: nextRole, companyId: nextCompanyId })
          : null;
        const nextUser = buildAuthenticatedUser({
          profile,
          authUser,
          fallback: {
            ...invitedUser,
            company_id: nextCompanyId,
            store_id: invitedUser.primaryStoreId || invitedUser.storeIds?.[0] || "",
          },
          role: nextRole,
          companyId: nextCompanyId,
          storeId: invitedUser.primaryStoreId || invitedUser.storeIds?.[0] || "",
        });
        const nextUserId = nextUser.profileId;
        const nextState = {
          ...appState,
          currentUserId: nextUserId,
          currentAuthUserId: nextUser.authUserId,
          currentCompanyId: nextCompanyId,
          users: (appState.users || []).map((user) => user.id === nextUserId ? {
            ...user,
            name: user.name || invitedUser.name || normalizedEmail.split("@")[0],
            email: normalizedEmail,
            role: nextRole,
            companyId: nextCompanyId,
            storeIds: invitedUser.storeIds?.length ? invitedUser.storeIds : user.storeIds || [],
            primaryStoreId: invitedUser.primaryStoreId || user.primaryStoreId || "",
            isActive: user.isActive !== false,
            invitationStatus: "registered",
            inviteRegisteredAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
            loginCount: (user.loginCount || 0) + 1,
            authUserId: authUser?.id || user.authUserId || "",
          } : user),
        };
        persistTenantState(nextState);
        setCurrentUser(nextUser);
        setCurrentRole(nextRole);
        window.localStorage.setItem("salon-user", JSON.stringify(nextUser));
        window.localStorage.setItem("salon-role", nextRole);
        setAuthMode("app");
        setActivePage(resolveDefaultPage(nextRole));
        setInviteToken("");
        setAuthSuccess("招待登録が完了しました。管理画面へ移動します。" );
        return;
      }

      const signInResult = await signInWithEmail(normalizedEmail, password);
      if (!signInResult.error && signInResult.data?.user) {
        const authUser = signInResult.data.user;
        const profile = await ensureProfileForAuthUser({ authUserId: authUser.id, email: authUser.email, role: resolveRoleForEmail(authUser.email) });
        const tenantState = await loadTenantStateFromSupabase({ authUserId: authUser.id, email: authUser.email, currentProfile: profile });
        const nextUser = buildAuthenticatedUser({ profile, authUser, role: resolveRoleForEmail(authUser.email) });
        setCurrentUser(nextUser);
        setCurrentRole(normalizeRole(profile?.role || resolveRoleForEmail(authUser.email)));
        setAppState({
          ...tenantState,
          currentCompanyId: profile?.company_id || tenantState.currentCompanyId || "",
          currentUserId: nextUser.profileId,
          currentAuthUserId: nextUser.authUserId,
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
      const selectedStoreName = tenantState?.selectedStore || company?.stores?.[0]?.name || "";
      const store = company?.stores?.find((item) => item.name === selectedStoreName) || company?.stores?.[0] || null;
      const storeId = store?.id || null;
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
      const storeIdToName = Object.fromEntries((company?.stores || []).map((item) => [item.id, item.name]));
      const dailySalesState = buildDailyStateFromRows(dailySalesResult.data, storeIdToName);

      // Same reasoning for monthly_closings: it's the authoritative table now (see
      // upsertMonthlyClosingState), so a fresh device/session needs this fetched directly
      // instead of only ever reflecting whatever was last embedded in a tenant_snapshots row.
      const closingMonths = [targetMonth, getMonthOffset(targetMonth, -1), getMonthOffset(targetMonth, -2)];
      const monthlyClosingsResult = await loadMonthlyClosingsForCompany({ companyId, yearMonths: closingMonths });
      if (!monthlyClosingsResult.ok) {
        throw monthlyClosingsResult.error || new Error("月締めデータの取得に失敗しました");
      }
      const monthClosingStatusOverlay = buildMonthClosingStateFromRows(monthlyClosingsResult.data, storeIdToName);

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
      const targetStateOverlay = buildTargetStateFromRows(monthlyTargetsResult.data, storeIdToName);

      // store_input_settings (daily/monthly field visibility) is the authoritative source now
      // — see 20260807000000_create_store_input_settings.sql. Fetched company-wide alongside
      // daily_sales/monthly_closings above, then merged onto each store's settings object
      // below wherever appState.companies gets (re)built, the same way those other two tables
      // overlay onto dailyResults/dayClosingStates/monthClosingStatus.
      const storeInputSettingsResult = await loadStoreInputSettingsForCompany({ companyId });
      const storeInputSettingsByStoreId = Object.fromEntries(
        (storeInputSettingsResult.data || []).map((row) => [row.store_id, row])
      );
      const applyStoreInputSettingsToCompanies = (companies) => (companies || []).map((company) => ({
        ...company,
        stores: (company.stores || []).map((store) => {
          const row = storeInputSettingsByStoreId[store.id];
          if (!row) return store;
          return {
            ...store,
            settings: {
              ...(store.settings || createStoreSettingsDefaults()),
              dailyFieldSettings: normalizeDailyFieldSettings(row.daily_fields),
              monthlyTargetFields: normalizeMonthlyTargetFieldSettings(row.monthly_target_fields),
            },
          };
        }),
      }));

      const applyDailySalesOverlay = (state) => mergeRemoteAppState(state, {
        dailyResults: dailySalesState.dailyResults,
        dayClosingStates: dailySalesState.dayClosingStates,
        dayClosingUpdatedAt: dailySalesState.dayClosingUpdatedAt,
        monthClosingStatus: monthClosingStatusOverlay,
        // Only targets, deliberately not businessDaySettings here: saveHolidayCount/
        // saveManualBusinessDayCount/resetBusinessDaySetting (the 営業日設定 quick-edit on the
        // daily entry page) only ever update businessDaySettings locally — they don't persist
        // to monthly_targets at all (a separate, pre-existing gap outside this change's scope).
        // Overlaying it here would let a fresh hydrate silently discard an unsaved local
        // holiday-count edit sooner than it already can.
        targets: targetStateOverlay.targets,
      });

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
        setAppState((prev) => {
          let merged = (fallbackState && Object.keys(fallbackState.dailyResults || {}).length)
            ? mergeRemoteAppState(prev, {
                ...fallbackState,
                // companies/users must always reflect the just-fetched stores/profiles tables,
                // never a possibly-stale localStorage cache — see the identical fix below for
                // why letting a cached list win here silently breaks store_id resolution.
                companies: applyStoreInputSettingsToCompanies(tenantState?.companies?.length ? tenantState.companies : (fallbackState.companies || [])),
                users: tenantState?.users?.length ? tenantState.users : (fallbackState.users || []),
                currentCompanyId: profile?.company_id || prev.currentCompanyId || companyId,
                currentUserId: profile?.id || prev.currentUserId || "",
                currentAuthUserId: profile?.auth_user_id || authUser.id || prev.currentAuthUserId || "",
              })
            : prev;
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
      const resolvedSelectedStore = tenantState?.selectedStore || selectedStoreName || remoteState.selectedStore || "";
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
        currentUserId: remoteState.currentUserId || tenantState?.currentUserId || profile.id || "",
        currentAuthUserId: remoteState.currentAuthUserId || tenantState?.currentAuthUserId || profile.auth_user_id || authUser.id || "",
        selectedStore: resolvedSelectedStore,
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
    const store = company?.stores?.find((item) => item.name === nextState.selectedStore) || company?.stores?.[0] || null;
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
      setNotice(existingStore ? "この店舗の編集権限がありません" : "店舗作成はシステム管理者または会社管理者が実行できます");
      return;
    }
    if (!storeForm.name.trim()) return;

    try {
      let createdStore = null;
      if (!existingStore) {
        createdStore = await createStoreRecord({ companyId, name: storeForm.name.trim(), code: (storeForm.code || storeForm.name).trim().toLowerCase() });
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
      const normalizedUrls = normalizeStoreUrls(storeForm.urls || []);
      const serviceTypes = (storeForm.serviceTypes || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const nextStore = {
        id: storeId,
        name: storeForm.name.trim(),
        code: (storeForm.code || storeForm.name).trim().toLowerCase(),
        companyId,
        postalCode: storeForm.postalCode,
        address: storeForm.address,
        phone: storeForm.phone,
        managerName: storeForm.managerName,
        representativeName: storeForm.representativeName,
        openingDate: storeForm.openingDate,
        openingHour: storeForm.openingHour,
        closingHour: storeForm.closingHour,
        closedDays: storeForm.closedDays,
        businessHours: storeForm.businessHours,
        description: storeForm.description,
        website: storeForm.website,
        instagram: storeForm.instagram,
        googleMapUrl: storeForm.googleMapUrl,
        serviceTypes,
        urls: normalizedUrls,
        status: existingStore?.status || storeForm.status || "active",
        isActive: storeForm.isActive !== false,
        settings: { ...createStoreSettingsDefaults(), ...(existingStore?.settings || {}), ...(storeSettingsForm || {}) },
      };
      const nextCompany = {
        ...currentCompany,
        stores: existingStore
          ? (currentCompany?.stores || []).map((store) => (store.id === existingStore.id ? nextStore : store))
          : [...(currentCompany?.stores || []), nextStore],
        setup: { ...(currentCompany?.setup || {}), store: true },
      };
      const renamedState = existingStore && existingStore.name !== nextStore.name
        ? rekeyStoreNamedMaps(appState, existingStore.name, nextStore.name)
        : appState;
      const nextState = {
        ...renamedState,
        companies: (renamedState.companies || []).map((company) => (company.id === companyId ? nextCompany : company)),
        companySnapshots: {
          ...(renamedState.companySnapshots || {}),
          [companyId]: {
            ...(renamedState.companySnapshots?.[companyId] || createInitialAppState()),
            stores: nextCompany.stores.map((store) => store.name),
            selectedStore: nextStore.name,
          },
        },
      };
      persistTenantState(nextState);
      setStoreForm(createStoreFormDefaults());
      setStoreEditId("");
      setNotice(existingStore ? `${nextStore.name} を更新しました` : `${nextStore.name} を追加しました`);
    } catch (error) {
      setNotice(getSupabaseErrorMessage(error));
    }
  };

  const handleSaveUser = async () => {
    if (!canManageUsers(currentRole)) {
      setNotice("ユーザー作成はシステム管理者または会社管理者が実行できます");
      return;
    }
    if (!userForm.name.trim() || !userForm.email.trim()) return;
    const normalizedEmail = userForm.email.trim().toLowerCase();
    const duplicateUser = (appState.users || []).find((user) => user.email === normalizedEmail && user.id !== userEditId);
    if (duplicateUser) {
      setNotice("同じメールアドレスのユーザーが既に登録されています");
      return;
    }
    const normalizedCurrentRole = normalizeRole(currentRole);
    const companyId = normalizedCurrentRole === "company_admin" ? appState.currentCompanyId : (userForm.companyId || appState.currentCompanyId);
    const role = normalizedCurrentRole === "company_admin" ? (userForm.role === "system_admin" ? "store_manager" : userForm.role) : userForm.role;
    const existingUser = (appState.users || []).find((user) => user.id === userEditId) || null;
    const inviteTokenValue = existingUser?.inviteToken || createInviteToken();
    const inviteLink = buildInviteLink(typeof window !== "undefined" && window.location?.origin ? window.location.origin : "", inviteTokenValue);
    const inviteExpiresAt = existingUser?.inviteExpiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    try {
      let createdProfile = null;
      let authUserId = existingUser?.authUserId || "";
      if (!existingUser) {
        const signupResult = await signUpWithEmail(normalizedEmail, "password123");
        authUserId = signupResult?.data?.user?.id || "";
        createdProfile = await createUserProfileRecord({
          name: userForm.name.trim(),
          email: normalizedEmail,
          role,
          companyId,
          storeIds: userForm.storeIds.length ? userForm.storeIds : (currentCompanyStores[0]?.id ? [currentCompanyStores[0].id] : []),
          primaryStoreId: userForm.primaryStoreId || userForm.storeIds[0] || currentCompanyStores[0]?.id || "",
          authUserId,
        });
      }

      const selectedStores = userForm.storeIds.length ? userForm.storeIds : (currentCompanyStores[0]?.id ? [currentCompanyStores[0].id] : []);
      const nextUser = {
        id: existingUser?.id || createdProfile?.id || `user-${Date.now()}`,
        name: userForm.name.trim(),
        email: normalizedEmail,
        role,
        companyId,
        storeIds: selectedStores,
        primaryStoreId: userForm.primaryStoreId || userForm.storeIds[0] || currentCompanyStores[0]?.id || "",
        isActive: userForm.isActive !== false,
        invitationStatus: existingUser?.invitationStatus || userForm.invitationStatus || "invited",
        lastLoginAt: existingUser?.lastLoginAt || userForm.lastLoginAt || "",
        loginCount: existingUser?.loginCount || userForm.loginCount || 0,
        inviteExpiresAt: userForm.invitationStatus === "invited" ? inviteExpiresAt : "",
        inviteToken: existingUser?.inviteToken || inviteTokenValue,
        inviteLink: existingUser?.inviteLink || inviteLink,
        authUserId: existingUser?.authUserId || createdProfile?.auth_user_id || authUserId || "",
      };
      const nextState = {
        ...appState,
        users: existingUser ? (appState.users || []).map((user) => (user.id === nextUser.id ? nextUser : user)) : [...(appState.users || []), nextUser],
      };
      persistTenantState(nextState);
      setUserForm({ name: "", email: "", role: "store_manager", companyId: "", storeIds: [], primaryStoreId: "", invitationStatus: "invited", loginCount: 0, lastLoginAt: "", isActive: true });
      setUserEditId("");
      setNotice(existingUser ? `${nextUser.name} を更新しました` : `${nextUser.name} を招待しました。招待リンクを共有してください。`);
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
    const nextState = {
      ...appState,
      selectedStore: storeName,
      companySnapshots: { ...(appState.companySnapshots || {}), [appState.currentCompanyId]: { ...(appState.companySnapshots?.[appState.currentCompanyId] || createInitialAppState()), selectedStore: storeName } },
    };
    persistTenantState(nextState);
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
      code: store.code || "",
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
    });
    setStoreSettingsForm({ ...createStoreSettingsDefaults(), ...(store.settings || {}) });
  };

  const handleEditUser = (user) => {
    setUserEditId(user.id);
    setUserForm({ name: user.name, email: user.email, role: user.role, companyId: user.companyId || "", storeIds: user.storeIds || [], primaryStoreId: user.primaryStoreId || "", invitationStatus: user.invitationStatus || "invited", loginCount: user.loginCount || 0, lastLoginAt: user.lastLoginAt || "", isActive: user.isActive !== false });
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

  const handleToggleStoreStatus = (store) => {
    if (!window.confirm(`${store.name} を${store.isActive ? "利用停止" : "再開"}しますか？`)) return;
    const nextCompany = {
      ...currentCompany,
      stores: (currentCompany?.stores || []).map((item) => item.id === store.id ? { ...item, isActive: !item.isActive, status: item.isActive ? "paused" : "active" } : item),
    };
    const nextState = {
      ...appState,
      companies: (appState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)),
    };
    persistTenantState(nextState);
    setNotice(store.isActive ? `${store.name} を停止しました` : `${store.name} を再開しました`);
  };

  const handleDuplicateStore = (store) => {
    const duplicateName = `${store.name} コピー`;
    const nextCompany = {
      ...currentCompany,
      stores: [...(currentCompany?.stores || []), {
        ...store,
        id: `${store.id}-copy-${Date.now()}`,
        name: duplicateName,
        code: `${(store.code || duplicateName).replace(/\s+/g, "-").toLowerCase()}-copy`,
        isActive: true,
        status: "active",
      }],
    };
    const nextState = {
      ...appState,
      companies: (appState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)),
    };
    persistTenantState(nextState);
    setNotice(`${duplicateName} を複製しました`);
  };

  const handleArchiveStore = (store) => {
    if (!window.confirm(`${store.name} をアーカイブしますか？`)) return;
    const nextCompany = {
      ...currentCompany,
      stores: (currentCompany?.stores || []).map((item) => item.id === store.id ? { ...item, isActive: false, status: "archived" } : item),
    };
    const nextState = {
      ...appState,
      companies: (appState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)),
    };
    persistTenantState(nextState);
    setNotice(`${store.name} をアーカイブしました`);
  };

  const handleRestoreStore = (store) => {
    const nextCompany = {
      ...currentCompany,
      stores: (currentCompany?.stores || []).map((item) => item.id === store.id ? { ...item, isActive: true, status: "active" } : item),
    };
    const nextState = {
      ...appState,
      companies: (appState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)),
    };
    persistTenantState(nextState);
    setNotice(`${store.name} を復元しました`);
  };

  const handleDeleteStore = (store) => {
    if (!window.confirm(`${store.name} を削除しますか？`)) return;
    const nextCompany = {
      ...currentCompany,
      stores: (currentCompany?.stores || []).filter((item) => item.id !== store.id),
    };
    const nextState = {
      ...appState,
      companies: (appState.companies || []).map((company) => (company.id === currentCompany?.id ? nextCompany : company)),
    };
    persistTenantState(nextState);
    setNotice(`${store.name} を削除しました`);
  };

  const handleToggleUserStatus = (user) => {
    if (!window.confirm(`${user.name} を${user.isActive ? "利用停止" : "再開"}しますか？`)) return;
    const nextState = {
      ...appState,
      users: (appState.users || []).map((item) => item.id === user.id ? { ...item, isActive: !item.isActive } : item),
    };
    persistTenantState(nextState);
    setNotice(user.isActive ? `${user.name} を停止しました` : `${user.name} を再開しました`);
  };

  const handleUpdateUserRole = async (user, nextRole) => {
    if (isSupabaseConfigured) {
      const result = await updateProfileRole({ profileId: user.id, role: nextRole });
      if (!result?.ok && !result?.skipped) {
        const reason = getSupabaseErrorMessage(result?.error);
        setNotice(`権限の変更に失敗しました: ${reason}`);
        return;
      }
    }
    const nextState = {
      ...appState,
      users: (appState.users || []).map((item) => item.id === user.id ? { ...item, role: nextRole } : item),
    };
    persistTenantState(nextState);
    setNotice(`${user.name} の権限を ${nextRole} に変更しました`);
  };

  const handleUpdateUserStores = async (user, nextStoreIds) => {
    if (isSupabaseConfigured) {
      const result = await updateProfileStoreAssignments({ profileId: user.id, companyId: appState.currentCompanyId, storeIds: nextStoreIds, primaryStoreId: nextStoreIds[0] || "" });
      if (!result?.ok && !result?.skipped) {
        const reason = getSupabaseErrorMessage(result?.error);
        setNotice(`所属店舗の変更に失敗しました: ${reason}`);
        return;
      }
    }
    const nextState = {
      ...appState,
      users: (appState.users || []).map((item) => item.id === user.id ? { ...item, storeIds: nextStoreIds, primaryStoreId: nextStoreIds[0] || "" } : item),
    };
    persistTenantState(nextState);
    setNotice(`${user.name} の所属店舗を更新しました`);
  };

  const handleMarkInvitationSent = (user) => {
    const nextState = {
      ...appState,
      users: (appState.users || []).map((item) => item.id === user.id ? { ...item, invitationStatus: "invited", inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), lastLoginAt: item.lastLoginAt || "", loginCount: item.loginCount || 0 } : item),
    };
    persistTenantState(nextState);
    setNotice(`${user.name} に招待メールを送信しました（7日間有効）`);
  };

  const handleMarkRegistered = (user) => {
    const nextState = {
      ...appState,
      users: (appState.users || []).map((item) => item.id === user.id ? { ...item, invitationStatus: "registered", loginCount: item.loginCount || 0 } : item),
    };
    persistTenantState(nextState);
    setNotice(`${user.name} を登録済みに更新しました`);
  };

  const handleSimulateLogin = (user) => {
    const nextState = {
      ...appState,
      users: (appState.users || []).map((item) => item.id === user.id ? { ...item, invitationStatus: "registered", lastLoginAt: new Date().toISOString(), loginCount: (item.loginCount || 0) + 1 } : item),
    };
    persistTenantState(nextState);
    setNotice(`${user.name} のログイン回数を更新しました`);
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

  const handleSaveCompanySettings = () => {
    const nextState = {
      ...appState,
      companies: (appState.companies || []).map((company) => company.id === currentCompany?.id ? {
        ...company,
        businessType: companySettingsForm.businessType || company.businessType || "salon",
        settings: { ...createCompanySettingsDefaults(), ...(company.settings || {}), ...(companySettingsForm || {}), businessType: companySettingsForm.businessType || company.businessType || "salon" },
        setup: { ...(company.setup || {}), settings: true, complete: Boolean(company.setup?.company && company.setup?.store && company.setup?.admin && company.setup?.settings) },
        lastUpdatedAt: new Date().toISOString(),
      } : company),
    };
    persistTenantState(nextState);
    setNotice("会社基本設定を保存しました");
  };

  const handleSaveStoreSettings = () => {
    const nextCompany = {
      ...currentCompany,
      stores: (currentCompany?.stores || []).map((store) => store.name === selectedStore ? { ...store, settings: storeSettingsForm } : store),
    };
    const nextState = {
      ...appState,
      companies: (appState.companies || []).map((company) => company.id === currentCompany?.id ? nextCompany : company),
    };
    persistTenantState(nextState);
    setNotice("店舗初期設定を保存しました");
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

  const handleInviteEmail = (user) => {
    const inviteTokenValue = user.inviteToken || createInviteToken();
    const inviteLink = buildInviteLink(typeof window !== "undefined" && window.location?.origin ? window.location.origin : "", inviteTokenValue);
    const nextState = {
      ...appState,
      users: (appState.users || []).map((item) => item.id === user.id ? { ...item, invitationStatus: "invited", inviteToken: inviteTokenValue, inviteLink, inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() } : item),
    };
    persistTenantState(nextState);
    setNotice(`${user.name} に招待リンクを更新しました`);
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

  const handlePasswordReset = (user) => {
    const nextState = {
      ...appState,
      users: (appState.users || []).map((item) => item.id === user.id ? { ...item, invitationStatus: "invited" } : item),
    };
    persistTenantState(nextState);
    setNotice(`${user.name} にパスワード設定メールを送信しました（デモ）`);
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

    const hasAnyValue = [dailyForm.totalSales, dailyForm.technicalSales, dailyForm.retailSales, dailyForm.otherSales, dailyForm.customers, dailyForm.newCustomers, dailyForm.repeatCustomers].some((value) => parseNumber(value) > 0) || Boolean(dailyForm.memo);
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
  }, [dailyForm.date, dailyForm.totalSales, dailyForm.technicalSales, dailyForm.retailSales, dailyForm.otherSales, dailyForm.customers, dailyForm.newCustomers, dailyForm.repeatCustomers, dailyForm.memo, dailyMode, selectedStore, selectedMonth, dailyForm.id, dailyEntries]);

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
    if (!selectedStore) {
      const fallbackStore = visibleStores[0]?.name || "";
      if (fallbackStore) {
        setAppState((prev) => ({ ...prev, selectedStore: fallbackStore }));
      }
      return;
    }
    const selectedStoreExists = visibleStores.some((store) => store.name === selectedStore);
    if (!selectedStoreExists) {
      const fallbackStore = visibleStores[0]?.name || "";
      if (fallbackStore) {
        setAppState((prev) => ({ ...prev, selectedStore: fallbackStore }));
      }
    }
  }, [selectedStore, visibleStores]);

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

    if (dailyMode === "view") {
      return { ok: true, skipped: true };
    }

    const hasAnyValue = [dailyForm.totalSales, dailyForm.technicalSales, dailyForm.retailSales, dailyForm.otherSales, dailyForm.customers, dailyForm.newCustomers, dailyForm.repeatCustomers].some((value) => parseNumber(value) > 0) || Boolean(dailyForm.memo);
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

      const key = buildMonthKey(selectedStore, selectedMonth);
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
      setDailyInsight(buildDailyInsight({ form: entry, targetSales: parseNumber(target.targetSales), businessDayCount: businessDaySummary.businessDayCount || 0 }));
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
    const store = company?.stores?.find((item) => item.name === selectedStore) || null;
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
      const { company, store } = resolveTargetCompanyAndStore();
      let loadedTarget = null;
      let loadedHolidayCount = null;
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
        loadedTarget = getTargetForStoreMonth(appState, selectedStore, targetSelectedMonth);
        loadedHolidayCount = getBusinessDaySettings(appState, selectedStore, targetSelectedMonth).holidayCount;
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
    const savedStoreName = selectedStore;
    const savedMonthLabel = formatMonthLabel(targetSelectedMonth);
    const { company, store } = resolveTargetCompanyAndStore();
    if (!isSupabaseConfigured) {
      // Local-only/dev mode: mirror straight into appState (still explicit-save, not
      // per-keystroke) so the rest of the app reflects it.
      const key = buildMonthKey(selectedStore, targetSelectedMonth);
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

      const key = buildMonthKey(selectedStore, targetSelectedMonth);
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
      setDailyInsight(buildDailyInsight({ form: existingEntry, targetSales: parseNumber(target.targetSales), businessDayCount: businessDaySummary.businessDayCount || 0 }));
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
      setDailyInsight(buildDailyInsight({ form: dailyOriginalEntry, targetSales: parseNumber(target.targetSales), businessDayCount: businessDaySummary.businessDayCount || 0 }));
      setNotice("編集をキャンセルしました");
      return;
    }
    setDailyForm({ ...defaultDailyEntry, date: dailyForm.date || "" });
    setDailyMode("create");
    setDailyInsight("");
    setNotice("入力をキャンセルしました");
  };

  const copyPreviousDayData = () => {
    const selectedDate = dailyForm.date || new Date().toISOString().slice(0, 10);
    const currentDate = new Date(`${selectedDate}T00:00:00`);
    currentDate.setDate(currentDate.getDate() - 1);
    const previousDate = formatLocalDate(currentDate);
    const sourceEntry = dailyEntries.find((entry) => entry.date === previousDate) || null;
    if (!sourceEntry) {
      setNotice("前日のデータがありません");
      return;
    }
    setDailyForm({
      ...defaultDailyEntry,
      date: selectedDate,
      totalSales: sourceEntry.totalSales ?? "",
      technicalSales: sourceEntry.technicalSales ?? "",
      retailSales: sourceEntry.retailSales ?? "",
      otherSales: sourceEntry.otherSales ?? "",
      customers: sourceEntry.customers ?? "",
      newCustomers: sourceEntry.newCustomers ?? "",
      repeatCustomers: sourceEntry.repeatCustomers ?? "",
    });
    setDailyMode("edit");
    setDailyOriginalEntry(null);
    setDailyInsight("");
    setNotice(`${previousDate}のデータをコピーしました`);
  };

  const removeDailyEntry = (entryId) => {
    if (!window.confirm("この日次実績を削除しますか？")) {
      return;
    }
    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.dailyResults?.[key] || [];
      return {
        ...prev,
        dailyResults: {
          ...prev.dailyResults,
          [key]: list.filter((item) => item.id !== entryId),
        },
      };
    });
    setNotice("日次実績を削除しました");
  };

  const submitFixedCost = (event) => {
    event.preventDefault();
    if (!fixedForm.name || !fixedForm.amount) {
      setNotice("項目名と金額は必須です");
      return;
    }

    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.fixedCosts?.[key] || [];
      const nextItem = { ...fixedForm, amount: parseNumber(fixedForm.amount) };
      const updated = fixedForm.id
        ? list.map((item) => (item.id === fixedForm.id ? nextItem : item))
        : [...list, { ...nextItem, id: crypto.randomUUID() }];

      return {
        ...prev,
        fixedCosts: {
          ...prev.fixedCosts,
          [key]: updated,
        },
      };
    });

    setNotice("月固定費を保存しました");
    setFixedForm({ ...defaultFixedCostItem });
  };

  const editFixedCost = (item) => {
    setFixedForm(item);
    setNotice("固定費を編集します");
  };

  const removeFixedCost = (itemId) => {
    if (!window.confirm("この固定費を削除しますか？")) {
      return;
    }
    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.fixedCosts?.[key] || [];
      return {
        ...prev,
        fixedCosts: {
          ...prev.fixedCosts,
          [key]: list.filter((item) => item.id !== itemId),
        },
      };
    });
    setNotice("固定費を削除しました");
  };

  const submitVariableCost = (event) => {
    event.preventDefault();
    if (!variableForm.name || !variableForm.amount) {
      setNotice("項目名と金額は必須です");
      return;
    }

    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.variableCosts?.[key] || [];
      const nextItem = { ...variableForm, amount: parseNumber(variableForm.amount) };
      const updated = variableForm.id
        ? list.map((item) => (item.id === variableForm.id ? nextItem : item))
        : [...list, { ...nextItem, id: crypto.randomUUID() }];

      return {
        ...prev,
        variableCosts: {
          ...prev.variableCosts,
          [key]: updated,
        },
      };
    });

    setNotice("月販管費を保存しました");
    setVariableForm({ ...defaultVariableCostItem });
  };

  const editVariableCost = (item) => {
    setVariableForm(item);
    setNotice("販管費を編集します");
  };

  const removeVariableCost = (itemId) => {
    if (!window.confirm("この販管費を削除しますか？")) {
      return;
    }
    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.variableCosts?.[key] || [];
      return {
        ...prev,
        variableCosts: {
          ...prev.variableCosts,
          [key]: list.filter((item) => item.id !== itemId),
        },
      };
    });
    setNotice("販管費を削除しました");
  };

  const submitClosingItem = (event) => {
    event.preventDefault();
    if (!closingForm.name || !closingForm.amount) {
      setNotice("項目名と金額は必須です");
      return;
    }

    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.monthClosing?.[key] || [];
      const nextItem = { ...closingForm, amount: parseNumber(closingForm.amount) };
      const updated = closingForm.id
        ? list.map((item) => (item.id === closingForm.id ? nextItem : item))
        : [...list, { ...nextItem, id: crypto.randomUUID() }];

      return {
        ...prev,
        monthClosing: {
          ...prev.monthClosing,
          [key]: updated,
        },
      };
    });

    setNotice("月締め項目を保存しました");
    setClosingForm({ ...defaultClosingItem });
  };

  const editClosingItem = (item) => {
    setClosingForm(item);
    setNotice("月締め項目を編集します");
  };

  const removeClosingItem = (itemId) => {
    if (!window.confirm("この月締め項目を削除しますか？")) {
      return;
    }
    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.monthClosing?.[key] || [];
      return {
        ...prev,
        monthClosing: {
          ...prev.monthClosing,
          [key]: list.filter((item) => item.id !== itemId),
        },
      };
    });
    setNotice("月締め項目を削除しました");
  };

  const saveHolidayCount = (event) => {
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
    const key = buildMonthKey(selectedStore, selectedMonth);
    setAppState((prev) => ({
      ...prev,
      businessDaySettings: {
        ...prev.businessDaySettings,
        [key]: {
          ...prev.businessDaySettings?.[key],
          holidayCount: parsed,
          mode: prev.businessDaySettings?.[key]?.mode === "manual" ? "manual" : "auto",
        },
      },
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

  const saveManualBusinessDayCount = () => {
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
    const key = buildMonthKey(selectedStore, selectedMonth);
    setAppState((prev) => ({
      ...prev,
      businessDaySettings: {
        ...prev.businessDaySettings,
        [key]: {
          ...prev.businessDaySettings?.[key],
          mode: "manual",
          businessDayCount: parsed,
        },
      },
    }));
    setIsBusinessDayEditing(false);
    persistSaveStatus("saved", "営業日数を手動設定しました");
    setNotice("営業日数を手動設定しました");
  };

  const resetBusinessDaySetting = () => {
    if (!selectedStore) {
      setNotice("店舗を選択してください");
      return;
    }
    if (monthClosingStatus.closed && !window.confirm("月締め済みの月の営業日数を自動計算に戻しますか？")) {
      return;
    }
    const key = buildMonthKey(selectedStore, selectedMonth);
    setAppState((prev) => ({
      ...prev,
      businessDaySettings: {
        ...prev.businessDaySettings,
        [key]: {
          ...prev.businessDaySettings?.[key],
          mode: "auto",
          businessDayCount: undefined,
        },
      },
    }));
    setIsBusinessDayEditing(false);
    persistSaveStatus("saved", "営業日数を自動計算に戻しました");
    setNotice("営業日数を自動計算に戻しました");
  };

  const toggleMonthClosing = async () => {
    if (!selectedStore) {
      setNotice("店舗を選択してください");
      return;
    }

    const key = buildMonthKey(selectedStore, selectedMonth);
    const nextClosed = !Boolean(monthClosingStatus.closed);
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
    const todayIso = new Date().toISOString().slice(0, 10);
    if (dailyForm.date > todayIso) {
      setNotice("未来日は締めできません");
      return;
    }
    if (!window.confirm(`この日の締めを${dailyForm.date}で切り替えますか？`)) {
      return;
    }
    // Best-effort: keeps the normal save path (validation, local dailyForm/insight updates)
    // working the same as always for the common case. Its result is deliberately NOT treated
    // as a precondition below anymore — see updateDailySalesClosingState, which now upserts
    // the row itself using dailyForm, so day-closing can no longer be silently blocked by
    // saveDailyEntry's dailyMode==="view" no-op (the normal state right after opening an
    // already-saved entry, which is exactly when a user goes to close it).
    await saveDailyEntry({ silent: true, force: true });

    const key = buildMonthKey(selectedStore, selectedMonth);
    const current = appState.dayClosingStates?.[key] || {};
    const nextClosed = !Boolean(current[dailyForm.date]);

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

  const handleStoreAdd = () => {
    const trimmed = newStoreName.trim();
    if (!trimmed) {
      setNotice("店舗名を入力してください");
      return;
    }
    if (stores.includes(trimmed)) {
      setNotice("既に登録済みの店舗名です");
      return;
    }
    setAppState((prev) => ({
      ...prev,
      stores: [...prev.stores, trimmed],
      selectedStore: trimmed,
    }));
    setNewStoreName("");
    setNotice("店舗を追加しました");
  };

  const handleStoreUpdate = (event) => {
    event.preventDefault();
    const trimmed = storeFormName.trim();
    if (!trimmed || !storeEditId) return;
    setAppState((prev) => ({
      ...prev,
      stores: prev.stores.map((store) => (store === storeEditId ? trimmed : store)),
      selectedStore: prev.selectedStore === storeEditId ? trimmed : prev.selectedStore,
    }));
    setStoreFormName("");
    setStoreEditId("");
    setNotice("店舗名を更新しました");
  };

  const handleStoreDelete = (storeName) => {
    if (!window.confirm(`${storeName} を削除しますか？`)) {
      return;
    }
    if (stores.length <= 1) {
      setAppState((prev) => ({ ...prev, stores: [], selectedStore: "" }));
      setNotice("最後の店舗を削除しました");
      return;
    }
    const nextStores = stores.filter((item) => item !== storeName);
    setAppState((prev) => ({
      ...prev,
      stores: nextStores,
      selectedStore: prev.selectedStore === storeName ? nextStores[0] : prev.selectedStore,
    }));
    setNotice("店舗を削除しました");
  };

  const copyPreviousMonthData = (section) => {
    const previousMonth = getMonthOffset(selectedMonth, -1);
    const sourceKey = buildMonthKey(selectedStore, previousMonth);
    const targetKey = buildMonthKey(selectedStore, selectedMonth);

    setAppState((prev) => {
      if (section === "fixed") {
        return {
          ...prev,
          fixedCosts: {
            ...prev.fixedCosts,
            [targetKey]: (prev.fixedCosts?.[sourceKey] || []).map((item) => ({ ...item, id: crypto.randomUUID() })),
          },
        };
      }
      if (section === "variable") {
        return {
          ...prev,
          variableCosts: {
            ...prev.variableCosts,
            [targetKey]: (prev.variableCosts?.[sourceKey] || []).map((item) => ({ ...item, id: crypto.randomUUID() })),
          },
        };
      }
      return {
        ...prev,
        monthClosing: {
          ...prev.monthClosing,
          [targetKey]: (prev.monthClosing?.[sourceKey] || []).map((item) => ({ ...item, id: crypto.randomUUID() })),
        },
      };
    });
    setNotice(`前月データを${selectedMonth}へコピーしました`);
  };

  const startEditStore = (storeName) => {
    setStoreEditId(storeName);
    setStoreFormName(storeName);
  };

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
                  <input value={storeForm.code} onChange={(event) => setStoreForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="店舗コード" />
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
          <nav className="nav">
            {visibleNavItems.map((item) => (
              <button key={item.id} className={activePage === item.id ? "nav-button active" : "nav-button"} onClick={() => setActivePage(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-footer" />
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">SALON MANAGEMENT</p>
            <h1>{activePage === "dashboard" ? "売上" : activePage === "daily" ? "日次入力" : activePage === "monthly" ? "管理画面" : activePage === "companies" ? "会社管理" : activePage === "stores" ? "店舗管理" : activePage === "users" ? "ユーザー管理" : "設定"}</h1>
            {currentUser ? (
              <div className="user-role-badge" style={{ marginTop: 6 }}>
                {currentUser?.role || currentRole === "system_admin" ? "管理者" : currentRole}
              </div>
            ) : null}
          </div>

          <div className="filters">
            <label>
              店舗
              <select value={selectedStore} onChange={(event) => setAppState((prev) => ({ ...prev, selectedStore: event.target.value }))}>
                {visibleStores.length ? visibleStores.map((store) => <option key={store.id} value={store.name}>{store.name}</option>) : <option value="">未登録</option>}
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={handleLogout}>ログアウト</button>
            <label>
              対象月
              <input type="month" value={ensureMonthValue(selectedMonth)} onChange={(event) => setAppState((prev) => ({ ...prev, selectedMonth: event.target.value }))} />
            </label>
          </div>
        </header>

        {normalizeRole(currentRole) === "system_admin" && (
          <section className="status-overview-panel">
            <div className="status-overview-header">
              <div>
                <p className="eyebrow">SYNC STATUS (system_admin only)</p>
                <h2>保存と同期</h2>
              </div>
              <small>{isSupabaseConfigured ? "Supabase へ自動保存" : "ローカル保存のみ"}</small>
            </div>
            <div className="status-overview-grid">
              {statusCards.map((item) => (
                <div key={item.key} className={`status-overview-card ${item.tone}`}>
                  <span>{item.label}</span>
                  <strong>{item.message}</strong>
                  <small>{item.timestamp ? formatTimestamp(item.timestamp) : ""}</small>
                </div>
              ))}
            </div>
          </section>
        )}

        {!isOnline ? <div className="notice-box">オフラインです。入力内容は端末に保存されています。</div> : null}
        {notice ? <div className="notice-box">{notice}</div> : null}
        {activePage === "dashboard" && (
          <div className="dashboard-layout">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">KPI</p>
                  <h2>売上</h2>
                </div>
                {normalizeRole(currentRole) === "system_admin" && (
                  <div className="status-stack compact-status-stack">
                    <div className={`status-pill ${getStatusTone(saveStatus)}`}>{saveStatus.message || "自動保存済み"}</div>
                    <div className={`status-pill ${getStatusTone(syncStatus)}`}>{syncStatus.message || (isSupabaseConfigured ? "同期待機中" : "同期未対応")}</div>
                  </div>
                )}
              </div>
              <div className="kpi-hero-grid">
                {hasSalesTarget ? (
                  <MetricCard
                    label="月間達成率"
                    value={percent(summary.targetAchievement)}
                    hint={`目標 ${money(target.targetSales || 0)} に対して ${money(summary.sales)}`}
                    tone={getMetricTone(summary.targetAchievement, 85, 100)}
                    emphasize
                  />
                ) : (
                  <TargetMissingCard label="月間達成率" onGoToTarget={goToMonthlyTargetSetting} emphasize />
                )}
                {hasSalesTarget ? (
                  <MetricCard
                    label="目標との差額"
                    value={salesVsTarget >= 0 ? `＋${money(salesVsTarget)}（目標達成）` : `▲${money(Math.abs(salesVsTarget))}`}
                    hint={`現在売上 ${money(summary.sales)}`}
                    tone={salesVsTarget >= 0 ? "good" : "danger"}
                    emphasize
                  />
                ) : (
                  <TargetMissingCard label="目標との差額" onGoToTarget={goToMonthlyTargetSetting} emphasize />
                )}
                <MetricCard
                  label="月末着地予測"
                  value={money(summary.forecast)}
                  hint={hasSalesTarget
                    ? <span className={forecastVsTarget >= 0 ? "text-success" : "text-danger"}>{`目標より${forecastVsTarget >= 0 ? "＋" : "▲"}${money(Math.abs(forecastVsTarget))}`}</span>
                    : `残り営業日 ${summary.remainingBusinessDays ?? 0}日`}
                  tone={hasSalesTarget ? (forecastVsTarget >= 0 ? "good" : "warning") : ""}
                  emphasize
                />
                {hasCustomerTarget ? (
                  <MetricCard
                    label="客数達成率"
                    value={percent(customerTargetSummary.achievementRate)}
                    hint={`残り ${customerTargetSummary.remainingCustomers}名`}
                    tone={getMetricTone(customerTargetSummary.achievementRate, 85, 100)}
                    emphasize
                  />
                ) : (
                  <TargetMissingCard label="客数達成率" onGoToTarget={goToMonthlyTargetSetting} emphasize />
                )}
              </div>
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
                  <div><span>目標売上まで</span><strong>{money(summary.remainingSalesTarget)}</strong></div>
                  <div><span>残り1日必要売上</span><strong>{money(summary.dailyNeededSales)}</strong></div>
                  <div><span>目標客数まで</span><strong>{summary.remainingCustomersTarget}名</strong></div>
                </div>
              </div>
              <div className="kpi-grid">
                {dashboardSupportMetrics.map((item) => <MetricCard key={item.label} label={item.label} value={item.value} hint={item.hint} />)}
              </div>
              <div className={`ai-comment-card ${aiCommentTone}`}>
                <div className="panel-heading compact">
                  <p className="eyebrow">AI COMMENT</p>
                  {!aiCommentUnset && <span className={`status-chip ${aiCommentTone}`}>{aiComment.tier}</span>}
                </div>
                {aiComment.lines.map((line, index) => <p key={index}>{line}</p>)}
              </div>
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
            </section>

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
                    const isExpanded = expandedRankingStore === row.storeName;
                    return (
                      <button key={row.storeName} type="button" className={`ranking-card-accordion ${isExpanded ? "expanded" : ""}`} onClick={() => setExpandedRankingStore((current) => (current === row.storeName ? "" : row.storeName))}>
                        <div className="ranking-card-summary">
                          <div className="ranking-card-main">
                            <div className="ranking-card-rank">{row.currentRank === 1 ? "🥇" : row.currentRank === 2 ? "🥈" : row.currentRank === 3 ? "🥉" : row.currentRank}</div>
                            <div className="ranking-card-title">
                              <strong>{row.storeName}</strong>
                              <span>{row.trend} 前回 {row.previousRank || "-"}位</span>
                            </div>
                          </div>
                          <div className="ranking-card-kpis">
                            <span className={`status-chip ${row.achievement >= 100 ? "good" : row.achievement >= 85 ? "warning" : "danger"}`}>{percent(row.achievement)}</span>
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
                              <strong>{money(row.targetSales)}</strong>
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
                              <strong>{percent(row.achievement)}</strong>
                            </div>
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {activePage === "daily" && (
          <div className="stack">
            {!selectedStore ? (
              <div className="empty-card">店舗を追加してから日次入力を始めてください。</div>
            ) : (
              <>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">DAILY</p>
                      <h2>売上入力</h2>
                    </div>
                    {normalizeRole(currentRole) === "system_admin" && (
                      <div className="status-stack compact-status-stack">
                        <div className={`status-pill ${getStatusTone(saveStatus)}`}>{saveStatus.message || "自動保存済み"}</div>
                        <div className={`status-pill ${getStatusTone(syncStatus)}`}>{syncStatus.message || (isSupabaseConfigured ? "同期待機中" : "同期未対応")}</div>
                        {saveStatus.timestamp ? <div className="timestamp-pill">最終保存 {formatTimestamp(saveStatus.timestamp)}</div> : null}
                      </div>
                    )}
                  </div>

                  <div className="daily-save-banner">
                    <strong>日次入力は自動保存されます</strong>
                    <small>入力から約0.4秒後に保存し、オンライン時はSupabaseへ同期します。</small>
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
                    <button className="secondary-button" type="button" onClick={editDailyEntry} disabled={!dailyForm.id || dailyMode === "edit"}>編集</button>
                    <button className="secondary-button" type="button" onClick={cancelDailyEntryEdit}>キャンセル</button>
                    <button className="secondary-button" type="button" onClick={toggleDayClosing}>日締め</button>
                  </div>

                  <form id="daily-form" className="daily-form-grid" onSubmit={submitDailyEntry}>
                    <div className="daily-section-card">
                      <h3>基本情報</h3>
                      <label className="field">
                        <span>店舗</span>
                        <select value={selectedStore} onChange={(event) => setAppState((prev) => ({ ...prev, selectedStore: event.target.value }))}>
                          {stores.length ? stores.map((storeName) => <option key={storeName} value={storeName}>{storeName}</option>) : <option value="">未登録</option>}
                        </select>
                      </label>
                      <Field label="対象日" type="date" value={dailyForm.date} onChange={(value) => handleDailyDateChange(value)} disabled={dailyMode === "view"} />
                      <div className="field">
                        <span>日締め状態</span>
                        <div className={`value-pill ${appState.dayClosingStates?.[buildMonthKey(selectedStore, selectedMonth)]?.[dailyForm.date] ? "active" : "inactive"}`}>
                          {appState.dayClosingStates?.[buildMonthKey(selectedStore, selectedMonth)]?.[dailyForm.date] ? "締め済み" : "未締め"}
                        </div>
                      </div>
                    </div>

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
                      {appState.preferences?.showOtherSales ? <Field label="その他売上（税込）" value={dailyForm.otherSales || ""} onChange={(value) => setDailyForm((prev) => ({ ...prev, otherSales: value }))} suffix="円" placeholder="金額を入力" disabled={dailyMode === "view"} /> : null}
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

                    {showMemoField ? (
                      <div className="daily-section-card">
                        <h3>メモ</h3>
                        <label className="field">
                          <span>メモ</span>
                          <textarea value={dailyForm.memo || ""} onChange={(event) => setDailyForm((prev) => ({ ...prev, memo: event.target.value }))} disabled={dailyMode === "view"} rows={3} />
                        </label>
                      </div>
                    ) : null}
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
                    <p className="eyebrow">AI COMMENT</p>
                    <strong>{dailyInsight || "分析に必要なデータが不足しています"}</strong>
                  </div>

                  <div className="calendar-card">
                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">CALENDAR</p>
                        <h3>月カレンダー</h3>
                      </div>
                    </div>
                    <div className="calendar-grid">
                      {Array.from({ length: 35 }, (_, index) => {
                        const day = index + 1;
                        const monthInfo = new Date(`${selectedMonth}-01`);
                        const isInMonth = day <= new Date(monthInfo.getFullYear(), monthInfo.getMonth() + 1, 0).getDate();
                        if (!isInMonth) return <div key={index} className="calendar-day muted" />;
                        const iso = `${selectedMonth}-${String(day).padStart(2, "0")}`;
                        const entry = dailyEntries.find((item) => item.date === iso);
                        const closed = appState.dayClosingStates?.[buildMonthKey(selectedStore, selectedMonth)]?.[iso];
                        const className = entry ? "calendar-day filled" : closed ? "calendar-day closed" : "calendar-day empty";
                        return <div key={index} className={className}>{day}</div>;
                      })}
                    </div>
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
                        <h2>月間目標設定</h2>
                      </div>
                    </div>
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
                          {activeMonthlyTargetFieldSettings.fields.holidayCount ? <Field label="休業日" value={targetHolidayDraft} onChange={(value) => { setTargetHolidayDraft(value); setTargetDirty(true); }} suffix="日" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetTechnicalSales ? <Field label="技術売上目標（税込）" value={targetDraft.targetTechnicalSales} onChange={(value) => updateTargetDraftField("targetTechnicalSales", value)} suffix="円" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetRetailSales ? <Field label="店販売上目標（税込）" value={targetDraft.targetRetailSales} onChange={(value) => updateTargetDraftField("targetRetailSales", value)} suffix="円" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetCustomers ? <Field label="客数目標" value={targetDraft.targetCustomers} onChange={(value) => updateTargetDraftField("targetCustomers", value)} suffix="名" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetAverageSpend ? <Field label="客単価目標" value={targetDraft.targetAverageSpend} onChange={(value) => updateTargetDraftField("targetAverageSpend", value)} suffix="円" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetNewCustomers ? <Field label="新規客数目標" value={targetDraft.targetNewCustomers} onChange={(value) => updateTargetDraftField("targetNewCustomers", value)} suffix="名" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetRepeatCustomers ? <Field label="再来客数目標" value={targetDraft.targetRepeatCustomers} onChange={(value) => updateTargetDraftField("targetRepeatCustomers", value)} suffix="名" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetLaborRate ? <Field label="人件費率目標" value={targetDraft.targetLaborRate} onChange={(value) => updateTargetDraftField("targetLaborRate", value)} suffix="%" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetMaterialRate ? <Field label="材料費率目標" value={targetDraft.targetMaterialRate} onChange={(value) => updateTargetDraftField("targetMaterialRate", value)} suffix="%" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetAdRate ? <Field label="広告費率目標" value={targetDraft.targetAdRate} onChange={(value) => updateTargetDraftField("targetAdRate", value)} suffix="%" type="number" /> : null}
                          {activeMonthlyTargetFieldSettings.fields.targetOperatingMargin ? <Field label="営業利益率目標" value={targetDraft.targetOperatingMargin} onChange={(value) => updateTargetDraftField("targetOperatingMargin", value)} suffix="%" type="number" /> : null}
                        </div>
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

                {activeMonthlyTab === "fixed" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">FIXED</p>
                        <h2>月固定費</h2>
                      </div>
                      <button className="secondary-button" type="button" onClick={() => copyPreviousMonthData("fixed")}>前月をコピー</button>
                    </div>
                    <form className="inline-form" onSubmit={submitFixedCost}>
                      <input value={fixedForm.name} onChange={(event) => setFixedForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="項目名" />
                      <select value={fixedForm.category} onChange={(event) => setFixedForm((prev) => ({ ...prev, category: event.target.value }))}>
                        {fixedCostCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select>
                      <input value={fixedForm.amount} onChange={(event) => setFixedForm((prev) => ({ ...prev, amount: event.target.value }))} placeholder="金額" type="number" />
                      <input type="month" value={fixedForm.startMonth || ""} onChange={(event) => setFixedForm((prev) => ({ ...prev, startMonth: event.target.value }))} placeholder="開始月" />
                      <input type="month" value={fixedForm.endMonth || ""} onChange={(event) => setFixedForm((prev) => ({ ...prev, endMonth: event.target.value }))} placeholder="終了月" />
                      <select value={fixedForm.applyMode} onChange={(event) => setFixedForm((prev) => ({ ...prev, applyMode: event.target.value }))}>
                        <option value="this-month">当月のみ</option>
                        <option value="this-month-onward">以降適用</option>
                      </select>
                      <input value={fixedForm.memo || ""} onChange={(event) => setFixedForm((prev) => ({ ...prev, memo: event.target.value }))} placeholder="備考" />
                      <button className="primary-button" type="submit">追加 / 更新</button>
                    </form>
                    <div className="list-card">
                      {fixedCosts.map((item) => (
                        <div key={item.id} className="list-row">
                          <div>
                            <strong>{item.name}</strong>
                            <small>{item.category} / {money(item.amount)}{item.startMonth || item.endMonth ? ` / ${item.startMonth || ""}${item.endMonth ? `〜${item.endMonth}` : ""}` : ""}{item.memo ? ` / ${item.memo}` : ""}</small>
                          </div>
                          <div className="row-actions">
                            <button className="text-button" type="button" onClick={() => editFixedCost(item)}>編集</button>
                            <button className="text-button danger" type="button" onClick={() => removeFixedCost(item.id)}>削除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {activeMonthlyTab === "variable" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">VARIABLE</p>
                        <h2>月販管費入力</h2>
                      </div>
                      <button className="secondary-button" type="button" onClick={() => copyPreviousMonthData("variable")}>前月をコピー</button>
                    </div>
                    <form className="inline-form" onSubmit={submitVariableCost}>
                      <input value={variableForm.name} onChange={(event) => setVariableForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="項目名" />
                      <select value={variableForm.category} onChange={(event) => setVariableForm((prev) => ({ ...prev, category: event.target.value }))}>
                        {variableCostCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select>
                      <input value={variableForm.amount} onChange={(event) => setVariableForm((prev) => ({ ...prev, amount: event.target.value }))} placeholder="金額" type="number" />
                      <input type="date" value={variableForm.incurredDate || ""} onChange={(event) => setVariableForm((prev) => ({ ...prev, incurredDate: event.target.value }))} placeholder="発生日" />
                      <select value={variableForm.type} onChange={(event) => setVariableForm((prev) => ({ ...prev, type: event.target.value }))}>
                        <option value="regular">定例</option>
                        <option value="temporary">臨時</option>
                      </select>
                      <input value={variableForm.memo || ""} onChange={(event) => setVariableForm((prev) => ({ ...prev, memo: event.target.value }))} placeholder="備考" />
                      <button className="primary-button" type="submit">追加 / 更新</button>
                    </form>
                    <div className="list-card">
                      {variableCosts.map((item) => (
                        <div key={item.id} className="list-row">
                          <div>
                            <strong>{item.name}</strong>
                            <small>{item.category} / {money(item.amount)}{item.incurredDate ? ` / ${item.incurredDate}` : ""}{item.type === "temporary" ? " / 臨時" : " / 定例"}{item.memo ? ` / ${item.memo}` : ""}</small>
                          </div>
                          <div className="row-actions">
                            <button className="text-button" type="button" onClick={() => editVariableCost(item)}>編集</button>
                            <button className="text-button danger" type="button" onClick={() => removeVariableCost(item.id)}>削除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {activeMonthlyTab === "closing" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">MANAGEMENT</p>
                        <h2>管理画面</h2>
                      </div>
                      <button className="secondary-button" type="button" onClick={() => copyPreviousMonthData("closing")}>前月をコピー</button>
                    </div>
                    <form className="inline-form" onSubmit={submitClosingItem}>
                      <input value={closingForm.name} onChange={(event) => setClosingForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="項目名" />
                      <input value={closingForm.amount} onChange={(event) => setClosingForm((prev) => ({ ...prev, amount: event.target.value }))} placeholder="金額" type="number" />
                      <select value={closingForm.category} onChange={(event) => setClosingForm((prev) => ({ ...prev, category: event.target.value }))}>
                        {expenseCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select>
                      <button className="primary-button" type="submit">追加 / 更新</button>
                    </form>
                    <div className="toggle-panel">
                      <div>
                        <strong>{monthClosingStatus.closed ? "月締め済み" : "未締め"}</strong>
                        <small>{monthClosingStatus.lockedAt ? `最終確定: ${new Date(monthClosingStatus.lockedAt).toLocaleString("ja-JP")}` : "締め状態はまだ未設定です"}</small>
                      </div>
                      <button className={monthClosingStatus.closed ? "secondary-button" : "primary-button"} type="button" onClick={toggleMonthClosing}>
                        {monthClosingStatus.closed ? "締めを解除" : "月締めを確定"}
                      </button>
                    </div>
                    <div className="summary-grid">
                      <div className="summary-card"><span>店販比率</span><strong>{percent(summary.retailRatio || 0)}</strong></div>
                      <div className="summary-card"><span>人件費率</span><strong>{percent(summary.laborRate)}</strong></div>
                      <div className="summary-card"><span>材料費率</span><strong>{percent(summary.materialRate)}</strong></div>
                      <div className="summary-card"><span>固定費率</span><strong>{percent(summary.fixedRate)}</strong></div>
                      <div className="summary-card"><span>販管費率</span><strong>{percent(summary.variableRate)}</strong></div>
                      <div className="summary-card"><span>営業利益率</span><strong>{percent(summary.operatingMargin)}</strong></div>
                    </div>
                    <div className="list-card">
                      {closingItems.map((item) => (
                        <div key={item.id} className="list-row">
                          <div>
                            <strong>{item.name}</strong>
                            <small>{item.category} / {money(item.amount)}</small>
                          </div>
                          <div className="row-actions">
                            <button className="text-button" type="button" onClick={() => editClosingItem(item)}>編集</button>
                            <button className="text-button danger" type="button" onClick={() => removeClosingItem(item.id)}>削除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {activeMonthlyTab === "pnl" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">P&L</p>
                        <h2>月次損益表</h2>
                      </div>
                    </div>
                    <div className="summary-grid">
                      <div className="summary-card"><span>総売上（税込）</span><strong>{money(summary.sales)}</strong></div>
                      <div className="summary-card"><span>技術売上（税込）</span><strong>{money(summary.technicalSales)}</strong></div>
                      <div className="summary-card"><span>店販売上（税込）</span><strong>{money(summary.retailSales)}</strong></div>
                      <div className="summary-card"><span>その他売上（税込）</span><strong>{money(summary.otherSales)}</strong></div>
                      <div className="summary-card"><span>税込売上</span><strong>{money(taxSummary.grossSales)}</strong></div>
                      <div className="summary-card"><span>税抜売上</span><strong>{money(taxSummary.taxExclusiveSales)}</strong></div>
                      <div className="summary-card"><span>消費税相当額</span><strong>{money(taxSummary.taxAmount)}</strong></div>
                      <div className="summary-card"><span>適用税率</span><strong>{percent(taxSummary.rate * 100)}</strong></div>
                      <div className="summary-card"><span>税込費用</span><strong>{money(summary.expenseTotal)}</strong></div>
                      <div className="summary-card"><span>税抜費用</span><strong>{money(taxSummary.taxExclusiveExpenses)}</strong></div>
                      <div className="summary-card"><span>概算納税額</span><strong>{money(taxSummary.estimatedTax)}</strong></div>
                      <div className="summary-card"><span>人件費</span><strong>{money(summary.laborCost)}</strong></div>
                      <div className="summary-card"><span>材料費</span><strong>{money(summary.materialCost)}</strong></div>
                      <div className="summary-card"><span>発注費</span><strong>{money(summary.orderCost)}</strong></div>
                      <div className="summary-card"><span>固定費合計</span><strong>{money(summary.fixedCost)}</strong></div>
                      <div className="summary-card"><span>販管費合計</span><strong>{money(summary.variableCost)}</strong></div>
                      <div className="summary-card"><span>設備投資</span><strong>{money(summary.equipmentInvestmentCost)}</strong></div>
                      <div className="summary-card"><span>その他経費</span><strong>{money(summary.otherCost)}</strong></div>
                      <div className="summary-card"><span>費用合計</span><strong>{money(summary.expenseTotal)}</strong></div>
                      <div className="summary-card"><span>粗利益</span><strong>{money(summary.grossProfit)}</strong></div>
                      <div className="summary-card"><span>営業利益</span><strong>{money(summary.operatingProfit)}</strong></div>
                      <div className="summary-card"><span>調整後営業利益</span><strong>{money(summary.adjustedOperatingProfit)}</strong></div>
                      <div className="summary-card"><span>営業利益率</span><strong>{percent(summary.operatingMargin)}</strong></div>
                      <div className="summary-card"><span>調整後営業利益率</span><strong>{percent(summary.adjustedOperatingMargin)}</strong></div>
                    </div>
                    <div className="helper-text">消費税額は簡易計算による参考値です。実際の申告額は課税区分、控除対象、免税・簡易課税制度などにより異なります。</div>
                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">TARGET</p>
                        <h3>客数目標</h3>
                      </div>
                    </div>
                    <div className="summary-grid">
                      <div className="summary-card"><span>目標客数</span><strong>{customerTargetSummary.targetCustomers}名</strong></div>
                      <div className="summary-card"><span>現在客数</span><strong>{customerTargetSummary.customers}名</strong></div>
                      <div className="summary-card"><span>不足客数</span><strong>{customerTargetSummary.remainingCustomers}名</strong></div>
                      <div className="summary-card"><span>達成率</span><strong>{percent(customerTargetSummary.achievementRate)}</strong></div>
                      <div className="summary-card"><span>残り営業日数</span><strong>{customerTargetSummary.remainingBusinessDays}</strong></div>
                      <div className="summary-card"><span>残り1日あたり必要客数</span><strong>{customerTargetSummary.remainingCustomersPerDay.toFixed(1)}名</strong></div>
                      <div className="summary-card"><span>現在のペースでの月末予測客数</span><strong>{customerTargetSummary.forecastCustomers.toFixed(1)}名</strong></div>
                      <div className="summary-card"><span>状態</span><strong>{customerTargetSummary.statusLabel}</strong></div>
                    </div>
                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">AI</p>
                        <h3>売上状況</h3>
                      </div>
                    </div>
                    <div className="insight-card">
                      {salesStatusComment.lines.length ? (
                        salesStatusComment.lines.map((line, index) => <strong key={index} style={{ display: "block" }}>{line}</strong>)
                      ) : (
                        <strong>データを入力すると表示されます</strong>
                      )}
                    </div>
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
              {canManageStores(currentRole) && (
                <button className="primary-button" type="button" onClick={() => {
                  setStoreEditId("");
                  setStoreForm(createStoreFormDefaults());
                }}>店舗を追加</button>
              )}
            </div>
            <p className="management-help">店舗ごとに基本情報・売上目標・問い合わせ先・URLをまとめて管理できるように整理しました。検索・並替え・複製・アーカイブもすぐに利用できます。</p>
            <div className="inline-form">
              <label className="field">
                <span>検索</span>
                <input value={storeSearch} onChange={(event) => setStoreSearch(event.target.value)} placeholder="店舗名・住所・担当名" />
              </label>
              <label className="field">
                <span>並び替え</span>
                <select value={storeSort} onChange={(event) => setStoreSort(event.target.value)}>
                  <option value="achievement">達成率順</option>
                  <option value="sales">売上順</option>
                  <option value="profit">粗利順</option>
                  <option value="staff">スタッフ順</option>
                  <option value="name">店舗名順</option>
                </select>
              </label>
            </div>
            {canEditStoreName(currentRole) && (
            <div className="setup-card">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">STORE PROFILE</p>
                  <h3>店舗プロフィール</h3>
                </div>
              </div>
              <div className="store-form-grid">
                <label className="field">
                  <span>店舗名</span>
                  <input value={storeForm.name} onChange={(event) => setStoreForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="店舗名" />
                </label>
                <label className="field">
                  <span>店舗コード</span>
                  <input value={storeForm.code} onChange={(event) => setStoreForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="店舗コード" />
                </label>
                <label className="field">
                  <span>郵便番号</span>
                  <input value={storeForm.postalCode} onChange={(event) => setStoreForm((prev) => ({ ...prev, postalCode: event.target.value }))} placeholder="郵便番号" />
                </label>
                <label className="field">
                  <span>住所</span>
                  <input value={storeForm.address} onChange={(event) => setStoreForm((prev) => ({ ...prev, address: event.target.value }))} placeholder="住所" />
                </label>
                <label className="field">
                  <span>電話番号</span>
                  <input value={storeForm.phone} onChange={(event) => setStoreForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="電話番号" />
                </label>
                <label className="field">
                  <span>店長名</span>
                  <input value={storeForm.managerName} onChange={(event) => setStoreForm((prev) => ({ ...prev, managerName: event.target.value }))} placeholder="店長名" />
                </label>
                <label className="field">
                  <span>担当者名</span>
                  <input value={storeForm.representativeName} onChange={(event) => setStoreForm((prev) => ({ ...prev, representativeName: event.target.value }))} placeholder="担当者名" />
                </label>
                <label className="field">
                  <span>開店日</span>
                  <input type="date" value={storeForm.openingDate} onChange={(event) => setStoreForm((prev) => ({ ...prev, openingDate: event.target.value }))} />
                </label>
                <label className="field">
                  <span>営業時間</span>
                  <input value={storeForm.businessHours} onChange={(event) => setStoreForm((prev) => ({ ...prev, businessHours: event.target.value }))} placeholder="09:00-20:00" />
                </label>
                <label className="field">
                  <span>開店時間</span>
                  <input type="time" value={storeForm.openingHour} onChange={(event) => setStoreForm((prev) => ({ ...prev, openingHour: event.target.value }))} />
                </label>
                <label className="field">
                  <span>閉店時間</span>
                  <input type="time" value={storeForm.closingHour} onChange={(event) => setStoreForm((prev) => ({ ...prev, closingHour: event.target.value }))} />
                </label>
                <label className="field">
                  <span>定休日</span>
                  <input value={storeForm.closedDays} onChange={(event) => setStoreForm((prev) => ({ ...prev, closedDays: event.target.value }))} placeholder="定休日" />
                </label>
                <label className="field">
                  <span>サービス内容</span>
                  <input value={storeForm.serviceTypes} onChange={(event) => setStoreForm((prev) => ({ ...prev, serviceTypes: event.target.value }))} placeholder="カット,カラー" />
                </label>
                <label className="field">
                  <span>公式サイト</span>
                  <input value={storeForm.website} onChange={(event) => setStoreForm((prev) => ({ ...prev, website: event.target.value }))} placeholder="https://" />
                </label>
                <label className="field">
                  <span>Instagram</span>
                  <input value={storeForm.instagram} onChange={(event) => setStoreForm((prev) => ({ ...prev, instagram: event.target.value }))} placeholder="https://" />
                </label>
                <label className="field">
                  <span>Google Map</span>
                  <input value={storeForm.googleMapUrl} onChange={(event) => setStoreForm((prev) => ({ ...prev, googleMapUrl: event.target.value }))} placeholder="https://" />
                </label>
              </div>
              <label className="field">
                <span>店舗メモ</span>
                <textarea value={storeForm.description} onChange={(event) => setStoreForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="営業時間・スタッフ体制・備考" rows={4} />
              </label>
              <div className="store-url-list">
                {(storeForm.urls || []).map((entry, index) => (
                  <div key={`${entry.label || "url"}-${index}`} className="store-url-row">
                    <input value={entry.label || "URL"} onChange={(event) => setStoreForm((prev) => ({ ...prev, urls: prev.urls.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) }))} placeholder="ラベル" />
                    <input value={entry.value || ""} onChange={(event) => setStoreForm((prev) => ({ ...prev, urls: prev.urls.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) }))} placeholder="https://" />
                    <button className="text-button danger" type="button" onClick={() => setStoreForm((prev) => ({ ...prev, urls: prev.urls.filter((_, itemIndex) => itemIndex !== index) }))}>削除</button>
                  </div>
                ))}
                <button className="secondary-button" type="button" onClick={() => setStoreForm((prev) => ({ ...prev, urls: [...(prev.urls || []), { label: "URL", value: "" }] }))}>URLを追加</button>
              </div>
              <div className="button-row">
                <button className="primary-button" type="button" onClick={handleSaveStore}>{storeEditId ? "店舗情報を更新" : "店舗追加"}</button>
                <button className="secondary-button" type="button" onClick={() => { setStoreEditId(""); setStoreForm(createStoreFormDefaults()); }}>クリア</button>
              </div>
            </div>
            )}
            <div className="setup-card">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">STORE SETTINGS</p>
                  <h3>店舗初期設定</h3>
                </div>
              </div>
              <div className="input-grid">
                <label className="field">
                  <span>月間売上目標</span>
                  <input value={storeSettingsForm.monthlyTargetSales || ""} onChange={(event) => setStoreSettingsForm((prev) => ({ ...prev, monthlyTargetSales: event.target.value }))} />
                </label>
                <label className="field">
                  <span>店販売上目標</span>
                  <input value={storeSettingsForm.retailTargetSales || ""} onChange={(event) => setStoreSettingsForm((prev) => ({ ...prev, retailTargetSales: event.target.value }))} />
                </label>
                <label className="field">
                  <span>客数目標</span>
                  <input value={storeSettingsForm.customerTarget || ""} onChange={(event) => setStoreSettingsForm((prev) => ({ ...prev, customerTarget: event.target.value }))} />
                </label>
                <label className="field">
                  <span>営業日</span>
                  <input value={storeSettingsForm.businessDays || ""} onChange={(event) => setStoreSettingsForm((prev) => ({ ...prev, businessDays: event.target.value }))} />
                </label>
              </div>
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={handleSaveStoreSettings}>店舗設定を保存</button>
              </div>
            </div>
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
                          <small>{store.code}</small>
                        </div>
                        <span className={`status-pill ${store.isActive === false || store.status === "archived" ? "error" : "saved"}`}>{statusLabel}</span>
                      </div>
                      <div className="info-card-meta">
                        <span>{store.address || "住所未設定"}</span>
                        <span>{store.phone || "電話未設定"}</span>
                        <span>{store.managerName || "店長未設定"}</span>
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
                      <div className="store-chip-row">
                        {(store.serviceTypes || []).slice(0, 3).map((serviceType) => <span key={serviceType} className="status-chip neutral">{serviceType}</span>)}
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
            <p className="management-help">ユーザーは役割・所属店舗・招待状態を管理画面から一括で設定できます。招待後は7日間有効で、期限切れ時は再送できます。</p>
            {!canViewUserManagement(currentRole) ? (
              <div className="empty-card">この権限ではユーザー管理を操作できません。</div>
            ) : (
              <>
                <div className="inline-form">
                  <input value={userForm.name} onChange={(event) => setUserForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="氏名" />
                  <input value={userForm.email} onChange={(event) => setUserForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="メールアドレス" />
                  <select value={userForm.role} onChange={(event) => setUserForm((prev) => ({ ...prev, role: event.target.value }))}>
                    <option value="system_admin">system_admin</option>
                    <option value="company_admin">company_admin</option>
                    <option value="store_manager">store_manager</option>
                    <option value="staff">staff</option>
                  </select>
                  <button className="primary-button" type="button" onClick={handleSaveUser}>{userEditId ? "ユーザー情報を更新" : "招待する"}</button>
                </div>
                <div className="inline-form">
                  <label className="field">
                    <span>主要所属店舗</span>
                    <select value={userForm.primaryStoreId || ""} onChange={(event) => setUserForm((prev) => ({ ...prev, primaryStoreId: event.target.value, storeIds: event.target.value ? [event.target.value] : prev.storeIds }))}>
                      <option value="">未設定</option>
                      {(currentCompanyStores || []).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="setup-card">
                  <div className="panel-heading compact">
                    <div>
                      <p className="eyebrow">STORE ACCESS</p>
                      <h3>所属店舗</h3>
                    </div>
                  </div>
                  <div className="input-grid">
                    {(currentCompanyStores || []).map((store) => (
                      <label key={store.id} className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <input type="checkbox" checked={userForm.storeIds.includes(store.id)} onChange={() => toggleUserStoreSelection(store.id)} />
                        <span>{store.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {(appState.users || []).filter((user) => normalizeRole(currentRole) === "system_admin" || user.companyId === currentCompany?.id).length ? (
                  <div className="card-grid">
                    {(appState.users || []).filter((user) => normalizeRole(currentRole) === "system_admin" || user.companyId === currentCompany?.id).map((user) => {
                      const storeNames = (user.storeIds || []).map((storeId) => currentCompanyStores.find((store) => store.id === storeId)?.name || storeId).join(", ");
                      const invitationMeta = getUserInvitationMeta(user);
                      return (
                        <div key={user.id} className="info-card">
                          <div className="info-card-head">
                            <div>
                              <strong>{user.name}</strong>
                              <small>{user.email}</small>
                            </div>
                            <span className={`status-pill ${invitationMeta.tone === "warning" ? "warning" : invitationMeta.tone === "error" ? "error" : "saved"}`}>{invitationMeta.label}</span>
                          </div>
                          <div className="info-card-meta">
                            <span>{user.role}</span>
                            <span>{storeNames || "所属店舗なし"}</span>
                            <span>{user.lastLoginAt ? `最終ログイン ${new Date(user.lastLoginAt).toLocaleString("ja-JP")}` : "未ログイン"}</span>
                            <span>ログイン回数 {user.loginCount || 0}</span>
                            <span>{invitationMeta.expiresAt ? `有効期限 ${new Date(invitationMeta.expiresAt).toLocaleDateString("ja-JP")}` : "有効期限なし"}</span>
                          </div>
                          <div className="row-actions">
                            <button className="text-button" type="button" onClick={() => handleEditUser(user)}>編集</button>
                            <button className="text-button" type="button" onClick={() => handleMarkInvitationSent(user)}>招待</button>
                            <button className="text-button" type="button" onClick={() => handleMarkRegistered(user)}>登録済み</button>
                            <button className="text-button" type="button" onClick={() => handleSimulateLogin(user)}>ログ記録</button>
                            <button className="text-button" type="button" onClick={() => handleToggleUserStatus(user)}>{user.isActive ? "停止" : "再開"}</button>
                          </div>
                          <div className="row-actions">
                            <button className="text-button" type="button" onClick={() => handleUpdateUserRole(user, user.role === "system_admin" ? "company_admin" : user.role === "company_admin" ? "store_manager" : user.role === "store_manager" ? "staff" : "system_admin")}>権限変更</button>
                            <button className="text-button" type="button" onClick={() => handleUpdateUserStores(user, (user.storeIds || []).length ? user.storeIds : (currentCompanyStores[0]?.id ? [currentCompanyStores[0].id] : []))}>所属店舗変更</button>
                            <button className="text-button" type="button" onClick={() => handleCopyInviteLink(user)}>リンク</button>
                            <button className="text-button" type="button" onClick={() => handlePasswordReset(user)}>再設定</button>
                            <button className="text-button" type="button" onClick={() => handleInviteEmail(user)}>再送</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="management-empty">まだユーザーが登録されていません。上のフォームから招待してください。</div>
                )}
              </>
            )}
          </section>
        )}

        {activePage === "settings" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">PREFS</p>
                <h2>表示設定</h2>
              </div>
              {normalizeRole(currentRole) === "system_admin" && (
                <div className={`status-pill ${saveStatus.error ? "error" : saveStatus.status === "saving" ? "saving" : "saved"}`}>
                  {saveStatus.message || "自動保存済み"}
                </div>
              )}
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
            <div className="toggle-panel">
              <div>
                <strong>その他売上を使用する</strong>
                <small>{appState.preferences?.showOtherSales ? "オン" : "オフ"}</small>
              </div>
              <button className="secondary-button" type="button" onClick={() => setAppState((prev) => ({ ...prev, preferences: { ...prev.preferences, showOtherSales: !Boolean(prev.preferences?.showOtherSales) } }))}>
                {appState.preferences?.showOtherSales ? "オフにする" : "オンにする"}
              </button>
            </div>
            <div className="setup-card">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">COMPANY SETTINGS</p>
                  <h3>会社基本設定</h3>
                </div>
              </div>
              <div className="input-grid">
                <label className="field">
                  <span>業種</span>
                  <select value={companySettingsForm.businessType || "salon"} onChange={(event) => setCompanySettingsForm((prev) => ({ ...prev, businessType: event.target.value }))}>
                    <option value="salon">サロン</option>
                    <option value="nail">ネイルサロン</option>
                    <option value="eyelash">まつげサロン</option>
                    <option value="esthetic">エステサロン</option>
                  </select>
                </label>
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
                <label className="field">
                  <span>月締め日</span>
                  <input value={companySettingsForm.closingDay || "月末"} onChange={(event) => setCompanySettingsForm((prev) => ({ ...prev, closingDay: event.target.value }))} />
                </label>
                <label className="field">
                  <span>編集期限（日）</span>
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
                <button className="secondary-button" type="button" onClick={handleSaveCompanySettings}>会社基本設定を保存</button>
              </div>
            </div>
            <div className="empty-card">初期設定が完了すると、各権限ごとの画面がそのまま使えます。</div>

            {normalizeRole(currentRole) === "system_admin" && (
              <div className="setup-card">
                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">DEBUG (system_admin only)</p>
                    <h3>保存・同期デバッグ情報</h3>
                  </div>
                </div>
                <div className="status-overview-grid">
                  {statusCards.map((item) => (
                    <div key={item.key} className={`status-overview-card ${item.tone}`}>
                      <span>{item.label}</span>
                      <strong>{item.message}</strong>
                      <small>{item.timestamp ? formatTimestamp(item.timestamp) : ""}</small>
                    </div>
                  ))}
                </div>
                <div className="input-grid">
                  <label className="field"><span>auth user id</span><input value={debugInfo.userId || ""} readOnly /></label>
                  <label className="field"><span>email</span><input value={debugInfo.email || ""} readOnly /></label>
                  <label className="field"><span>role</span><input value={debugInfo.role || ""} readOnly /></label>
                  <label className="field"><span>session</span><input value={debugInfo.hasSession ? "active" : "none"} readOnly /></label>
                  <label className="field"><span>company_id</span><input value={appState.currentCompanyId || ""} readOnly /></label>
                  <label className="field"><span>profile_id (currentUserId)</span><input value={appState.currentUserId || ""} readOnly /></label>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function MetricCard({ label, value, hint = "", tone = "", emphasize = false }) {
  return (
    <div className={`metric-card ${tone} ${emphasize ? "emphasize" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

// Fallback for a dashboard metric that's computed from a monthly target when none has been
// saved yet for the store+month on screen — shown instead of a misleading 0%/¥0, with a direct
// link into the 月間目標設定 panel so there's always an obvious next action.
function TargetMissingCard({ label, onGoToTarget, emphasize = false }) {
  return (
    <div className={`metric-card neutral ${emphasize ? "emphasize" : ""}`}>
      <span>{label}</span>
      <strong className="metric-missing-label">月間目標未登録</strong>
      <button type="button" className="metric-missing-link" onClick={onGoToTarget}>月間目標設定</button>
    </div>
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
