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
  store_manager: ["dashboard", "daily", "monthly", "settings"],
  staff: ["dashboard", "daily"],
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
export const canManageUsers = (role) => normalizeRole(role) === "system_admin" || normalizeRole(role) === "company_admin";
export const canEditMonthlyData = (role) => normalizeRole(role) === "system_admin" || normalizeRole(role) === "company_admin" || normalizeRole(role) === "store_manager";
export const canViewUserManagement = (role) => normalizeRole(role) === "system_admin" || normalizeRole(role) === "company_admin";

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

export const resolveDefaultPage = (role) => {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "staff") return "dashboard";
  if (normalizedRole === "system_admin" || normalizedRole === "company_admin") return "monthly";
  return NAV_ITEMS_BY_ROLE[normalizedRole]?.[0] || "dashboard";
};
