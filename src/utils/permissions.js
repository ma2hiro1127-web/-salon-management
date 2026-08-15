export const ROLE_OPTIONS = ["owner", "admin", "system_admin", "company_admin", "store_manager", "staff"];

export const normalizeRole = (role) => {
  const normalized = `${role || ""}`.trim().toLowerCase();
  if (normalized === "owner" || normalized === "system_admin") return "system_admin";
  if (normalized === "admin" || normalized === "company_admin") return "company_admin";
  if (normalized === "manager" || normalized === "store_manager") return "store_manager";
  return normalized === "staff" ? "staff" : "staff";
};

export const isAdminRole = (role) => normalizeRole(role) === "system_admin" || normalizeRole(role) === "company_admin";

// Display-only Japanese labels for the 4 canonical roles — the underlying stored value
// (profiles.role, currentRole, etc.) is never touched, this is purely what's shown on screen.
const ROLE_LABELS_JA = {
  system_admin: "システム管理者",
  company_admin: "会社管理者",
  store_manager: "店舗管理者",
  staff: "一般スタッフ",
};
export const getRoleLabel = (role) => ROLE_LABELS_JA[normalizeRole(role)] || role || "";

// 並び順は実際の使用頻度に合わせている: 売上系(毎日使う)→管理系(随時)→その他。
// 月次ダッシュボードは月末・月次確認が主な用途のため、日次入力・管理画面より後ろに置く。
export const NAV_ITEMS_BY_ROLE = {
  system_admin: ["dashboard", "daily", "monthly", "monthlyDashboard", "stores", "users", "companies", "settings"],
  company_admin: ["dashboard", "daily", "monthly", "monthlyDashboard", "stores", "users", "settings"],
  // store_manager gets "users" too, but scoped down to "invite staff into my own store(s) only"
  // — see canManageUsers/getInvitableRoles below and the ユーザー管理 page's own store_manager
  // branch in App.jsx. No "companies" (店舗管理会社), and no monthly-target-adjacent company-wide
  // settings beyond their own store.
  store_manager: ["dashboard", "daily", "monthly", "monthlyDashboard", "stores", "users", "settings"],
  // 月次経営ダッシュボードは店舗横断比較・会社全体集計を含むため、staffには意図的に含めない。
  staff: ["dashboard", "daily", "stores"],
  owner: ["dashboard", "daily", "monthly", "monthlyDashboard", "stores", "users", "companies", "settings"],
  admin: ["dashboard", "daily", "monthly", "monthlyDashboard", "stores", "users", "settings"],
};

export const canAccessPage = (role, page) => {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return false;
  return NAV_ITEMS_BY_ROLE[normalizedRole]?.includes(page) || false;
};

export const canManageCompanies = (role) => normalizeRole(role) === "system_admin";
export const canManageStores = (role) => normalizeRole(role) === "system_admin" || normalizeRole(role) === "company_admin";
// 停止/再開/アーカイブ/復元 — canManageStoresと同じ対象(system_admin/company_admin)。
// store_managerはこれらの操作を一切行えない(店舗管理画面自体には店舗名編集のみ許可されて
// いるが、状態変更ボタンは表示しない)。canManageStoresのエイリアスだが、店舗の「状態変更」
// という操作の意味が分かるよう別名で公開する。
export const canChangeStoreLifecycle = (role) => canManageStores(role);
// 完全削除はsystem_admin限定。company_adminであっても不可(誤操作で過去データを含む店舗を
// 完全に失うリスクを最上位の管理権限のみに限定するため) — stores_delete_system_admin_only
// RLSポリシー・delete-store Edge Functionの権限チェックと同じ規約。
export const canHardDeleteStore = (role) => normalizeRole(role) === "system_admin";
// Store name editing is intentionally broader than full store management (create/delete/
// archive stay canManageStores-only): a store_manager should be able to rename their own
// store, but callers must still additionally check the store is in the caller's
// allowedStoreIds — this only says the *role* is ever allowed to edit a name, not which store.
export const canEditStoreName = (role) => normalizeRole(role) === "system_admin" || normalizeRole(role) === "company_admin" || normalizeRole(role) === "store_manager";
// store_manager can now reach ユーザー管理 too, but only to invite staff into their own
// store(s) — see getInvitableRoles, which is what actually gates *which* roles/scope each
// caller can assign (both in the UI and, authoritatively, in RLS's profiles/user_stores insert
// policies — this function only gates whether the page/action is reachable at all).
export const canManageUsers = (role) => {
  const normalized = normalizeRole(role);
  return normalized === "system_admin" || normalized === "company_admin" || normalized === "store_manager";
};
export const canEditMonthlyData = (role) => normalizeRole(role) === "system_admin" || normalizeRole(role) === "company_admin" || normalizeRole(role) === "store_manager";
export const canViewUserManagement = (role) => canManageUsers(role);

// Which roles `role` is allowed to invite/assign to someone else. This is the UI-side mirror of
// the profiles_insert_company_scoped / profiles_update_company_scoped RLS policies (see
// 20260805130000_company_scoped_rls.sql + 20260809000000_invite_flow_hardening.sql) — RLS is
// still the actual enforcement, this just keeps the invite form / role-change control from
// offering choices the backend would reject anyway.
export const getInvitableRoles = (role) => {
  const normalized = normalizeRole(role);
  if (normalized === "system_admin") return ["system_admin", "company_admin", "store_manager", "staff"];
  if (normalized === "company_admin") return ["company_admin", "store_manager", "staff"];
  if (normalized === "store_manager") return ["staff"];
  return [];
};
// 「全店舗」(company_admin/system_admin専用の仮想集計ビュー)を店舗選択欄に表示・選択できる
// かどうか。一般スタッフ・店舗管理者には表示しない。system_adminは複数会社を横断管理できる
// ロールだが、「全店舗」はあくまで現在対象にしているcompany_id(currentCompanyId)の店舗を
// 集計するものであり、会社をまたいで合算するものではない(呼び出し側で必ずcurrentCompanyId
// でスコープする — calculateAllStoresMonthSummary/getAllStoresBusinessDaySummary等を参照)。
export const canViewAllStores = (role) => normalizeRole(role) === "company_admin" || normalizeRole(role) === "system_admin";

// サイドメニューの余白区切り用のグループ分け(表示専用、権限ロジックには使わない)。
// 「売上」ページ名と紛らわしくなるため見出し文字は出さず、グループの切れ目に余白を
// 空けるためだけに使う(App.jsxのnav-group-start判定)。
const NAV_ITEM_CATEGORY = {
  dashboard: "sales",
  daily: "sales",
  monthly: "sales",
  monthlyDashboard: "sales",
  stores: "management",
  users: "management",
  companies: "management",
  settings: "other",
};

export const getVisibleNavItems = (role) => {
  const normalizedRole = normalizeRole(role);
  const pages = NAV_ITEMS_BY_ROLE[normalizedRole] || NAV_ITEMS_BY_ROLE.staff;
  return pages.map((page) => ({
    id: page,
    category: NAV_ITEM_CATEGORY[page] || "other",
    label: {
      dashboard: "売上",
      monthlyDashboard: "月次ダッシュボード",
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
