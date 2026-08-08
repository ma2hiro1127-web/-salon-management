export const ROLE_OPTIONS = ["owner", "admin", "system_admin", "company_admin", "store_manager", "staff"];

export const normalizeRole = (role) => {
  const normalized = `${role || ""}`.trim().toLowerCase();
  if (normalized === "owner" || normalized === "system_admin") return "system_admin";
  if (normalized === "admin" || normalized === "company_admin") return "company_admin";
  if (normalized === "manager" || normalized === "store_manager") return "store_manager";
  return normalized === "staff" ? "staff" : "staff";
};

export const isAdminRole = (role) => normalizeRole(role) === "system_admin" || normalizeRole(role) === "company_admin";

export const NAV_ITEMS_BY_ROLE = {
  system_admin: ["dashboard", "daily", "monthly", "companies", "stores", "users", "settings"],
  company_admin: ["dashboard", "daily", "monthly", "stores", "users", "settings"],
  store_manager: ["dashboard", "daily", "monthly", "stores", "settings"],
  staff: ["dashboard", "daily", "stores"],
  owner: ["dashboard", "daily", "monthly", "companies", "stores", "users", "settings"],
  admin: ["dashboard", "daily", "monthly", "stores", "users", "settings"],
};

export const canAccessPage = (role, page) => {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return false;
  return NAV_ITEMS_BY_ROLE[normalizedRole]?.includes(page) || false;
};

export const canManageCompanies = (role) => normalizeRole(role) === "system_admin";
export const canManageStores = (role) => normalizeRole(role) === "system_admin" || normalizeRole(role) === "company_admin";
// Store name editing is intentionally broader than full store management (create/delete/
// archive stay canManageStores-only): a store_manager should be able to rename their own
// store, but callers must still additionally check the store is in the caller's
// allowedStoreIds — this only says the *role* is ever allowed to edit a name, not which store.
export const canEditStoreName = (role) => normalizeRole(role) === "system_admin" || normalizeRole(role) === "company_admin" || normalizeRole(role) === "store_manager";
export const canManageUsers = (role) => normalizeRole(role) === "system_admin" || normalizeRole(role) === "company_admin";
export const canEditMonthlyData = (role) => normalizeRole(role) === "system_admin" || normalizeRole(role) === "company_admin" || normalizeRole(role) === "store_manager";
export const canViewUserManagement = (role) => normalizeRole(role) === "system_admin" || normalizeRole(role) === "company_admin";
// 「全店舗」(company_admin専用の仮想集計ビュー)を店舗選択欄に表示・選択できるかどうか。
// 一般スタッフ・店舗管理者には表示しない。
export const canViewAllStores = (role) => normalizeRole(role) === "company_admin";

export const getVisibleNavItems = (role) => {
  const normalizedRole = normalizeRole(role);
  const pages = NAV_ITEMS_BY_ROLE[normalizedRole] || NAV_ITEMS_BY_ROLE.staff;
  return pages.map((page) => ({
    id: page,
    label: {
      dashboard: "売上",
      daily: "日次入力",
      monthly: "管理画面",
      companies: "会社管理",
      stores: "店舗管理",
      users: "ユーザー管理",
      settings: "設定",
    }[page] || page,
  }));
};

export const getTopbarVisibility = (role) => ({
  showCompanySelector: normalizeRole(role) === "system_admin",
  showStoreSelector: normalizeRole(role) !== "staff",
  showMonthSelector: true,
});

export const getAllowedStoreIdsForRole = ({ role, companyStoreIds = [], currentUserStoreIds = [] }) => {
  if (!Array.isArray(companyStoreIds) || companyStoreIds.length === 0) return [];
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "system_admin" || normalizedRole === "company_admin") {
    return companyStoreIds;
  }
  const allowed = (currentUserStoreIds || []).filter((storeId) => companyStoreIds.includes(storeId));
  return allowed.length ? allowed : [];
};

// ログイン成功時・セッション復元時(ページ更新/再ログイン)の初期表示ページ。どの権限でも
// NAV_ITEMS_BY_ROLEの先頭は"dashboard"(売上)なので、素直にそれを使う。管理画面("monthly")
// は権限に関わらずナビゲーションからこれまで通り開けるので、ここでは初期遷移先だけを扱う。
export const resolveDefaultPage = (role) => {
  const normalizedRole = normalizeRole(role);
  return NAV_ITEMS_BY_ROLE[normalizedRole]?.[0] || "dashboard";
};
