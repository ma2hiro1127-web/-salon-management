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
  // system_adminは「通常機能すべて＋会社管理」— company_admin等が使える画面はすべて使え、
  // それに加えてsystem_admin専用の会社管理("companies")が使える(要件: system_adminを
  // 専用画面に切り替えるのではなく、通常権限のスーパーセットとして扱う)。RLS側もこれに
  // 合わせてsystem_adminの業務データアクセスを維持している(20260818000000で復元)。
  // "franchise"(加盟店連携)はsystem_admin/company_adminだけに追加する — 加盟店連携リクエスト
  // の送信(system_admin限定)・承認/拒否・閲覧切替はどちらのロールにも関係するが、
  // store_manager/staffには加盟店データを一切見せない(要件10)ため含めない。
  // "faq"(ヘルプ・お問い合わせ)は2026-09の機能追加で、使い方に関する問い合わせを自己解決
  // できるようにする全社共通の窓口へ役割が変わったため、staffにも表示する(以前は管理者向け
  // ヘルプとしてsystem_admin/company_admin/store_manager限定だったが、日々入力を行う
  // staffこそ「使い方がわからない」の当事者であり、除外する理由が無くなったため)。
  // "adOps"(AI広告運用)はsystem_admin専用の完全に独立したモジュール(要件2: 一般ユーザーには
  // 絶対に表示しない)。company_admin以下には一切追加しない——この配列がURLの存在しないこの
  // SPAにおける唯一の認可ゲートのため、ここに含めないこと自体が直接アクセス拒否になる。
  system_admin: ["dashboard", "daily", "monthly", "monthlyDashboard", "monthlyReview", "stores", "users", "companies", "franchise", "faq", "adOps"],
  company_admin: ["dashboard", "daily", "monthly", "monthlyDashboard", "monthlyReview", "stores", "users", "franchise", "faq"],
  // store_manager gets "users" too, but scoped down to "invite staff into my own store(s) only"
  // — see canManageUsers/getInvitableRoles below and the ユーザー管理 page's own store_manager
  // branch in App.jsx. No "companies" (店舗管理会社), and no monthly-target-adjacent company-wide
  // settings beyond their own store.
  store_manager: ["dashboard", "daily", "monthly", "monthlyDashboard", "monthlyReview", "stores", "users", "faq"],
  // 月次経営ダッシュボードは店舗横断比較・会社全体集計を含むため、staffには意図的に含めない。
  // 店舗管理("stores")も同様にstaffの通常業務範囲外のため含めない — この配列がURLの
  // 存在しないこのSPAにおける唯一の認可ゲート(canAccessPage)なので、ここから外すことが
  // そのままURL直接アクセスの拒否にもなる。faqも管理者向けヘルプのためstaffには含めない
  // (要件8: 権限体系の正式仕様)。
  // monthlyReview(月次レビュー)はstaffにも閲覧を許可する(要件8: 「原則として閲覧のみ」=
  // 見えないのではなく、見られるが編集はできない)。他の管理系画面(monthlyDashboard/stores等)
  // とは異なり、店舗全体で「今月どうだったか」を共有するのが目的の画面のため、staffも含めて
  // 見える状態にする——編集可否はページ内でcanEditMonthlyData(既存のsystem_admin/
  // company_admin/store_manager限定の判定関数、新規に権限判定を作らない)で別途ゲートする。
  staff: ["dashboard", "daily", "monthlyReview", "faq"],
  owner: ["dashboard", "daily", "monthly", "monthlyDashboard", "stores", "users", "companies", "franchise", "faq"],
  admin: ["dashboard", "daily", "monthly", "monthlyDashboard", "stores", "users", "franchise", "faq"],
};

export const canAccessPage = (role, page) => {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return false;
  return NAV_ITEMS_BY_ROLE[normalizedRole]?.includes(page) || false;
};

export const canManageCompanies = (role) => normalizeRole(role) === "system_admin";
// AI広告運用(要件2・23): system_admin限定。canAccessPage("adOps")と同じ判定だが、ページ
// 遷移とは別に個々のボタン(保存・AI評価実行・予算承認/却下・緊急停止等)を直接ガードする
// 場所でも使えるよう、canManageCompaniesと同じ形の専用関数として公開する。
export const canManageAdOps = (role) => normalizeRole(role) === "system_admin";
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
  // system_admin権限そのものは、通常の会社ユーザー招待/編集フローからは付与できない
  // (会社管理画面の是正・要件3) — システム全体の管理者を増やす操作は、この画面のような
  // 「1つの会社を対象にした」導線とは別に、意図的に切り離しておく。RLS側(profiles_insert_
  // company_scoped, 20260823030000)も同じ制約をDBレベルで強制している。
  if (normalized === "system_admin") return ["company_admin", "store_manager", "staff"];
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

// 加盟店連携(閲覧専用)関連の画面・操作にアクセスできるか。store_manager/staffは常にfalse
// (要件10)。リクエストの新規送信自体はさらにsystem_admin限定(App.jsx側で個別にチェックする)。
export const canManageFranchisePartnerships = (role) => normalizeRole(role) === "system_admin" || normalizeRole(role) === "company_admin";
export const canCreateFranchiseRequest = (role) => normalizeRole(role) === "system_admin";

// サイドメニューの余白区切り用のグループ分け(表示専用、権限ロジックには使わない)。
// 「売上」ページ名と紛らわしくなるため見出し文字は出さず、グループの切れ目に余白を
// 空けるためだけに使う(App.jsxのnav-group-start判定)。
const NAV_ITEM_CATEGORY = {
  dashboard: "sales",
  daily: "sales",
  monthly: "sales",
  monthlyDashboard: "sales",
  monthlyReview: "sales",
  stores: "management",
  users: "management",
  companies: "management",
  franchise: "management",
  faq: "other",
  adOps: "management",
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
      monthlyReview: "月次レビュー",
      daily: "日次入力",
      monthly: "管理画面",
      companies: "会社管理",
      stores: "店舗管理",
      users: "ユーザー管理",
      franchise: "加盟店連携",
      faq: "ヘルプ・お問い合わせ",
      adOps: "AI広告運用",
    }[page] || page,
  }));
};

export const getTopbarVisibility = (role) => ({
  showCompanySelector: normalizeRole(role) === "system_admin",
  showStoreSelector: normalizeRole(role) !== "staff",
  showMonthSelector: true,
});

// 加盟店閲覧中(読み取り専用)かどうかの判定。以前はApp.jsx内に「isFranchiseReadOnlyFor
// CurrentUser」(guardFranchiseReadOnly等の書き込みガードが呼ぶ)と「canEditMonthlyReview」
// (月次レビューの編集可否)の2箇所で、全く同じ式(appState.isViewingFranchise &&
// normalizeRole(currentRole) !== "system_admin")が手書きで複製されていた——コード内コメント
// 自体が「変更すると2箇所の判定が将来ズレる可能性がある」と明記していた既知のリスクだった
// (原因: canEditMonthlyReviewの定義がisFranchiseReadOnlyForCurrentUserの定義より前の行に
// あり、素直に呼び出すとTDZ(const初期化前参照)でReferenceErrorになるため複製されていた)。
// ここでisViewingFranchise/roleの2値だけから判定する純粋関数として切り出すことで、
// モジュールレベルでimportされる側になり、コンポーネント内の宣言順序(TDZ)に一切依存しなく
// なる——両呼び出し元はこの1つの実装だけを参照すればよくなり、今後も判定がズレる余地が
// 構造的に無くなる。system_adminだけは加盟店閲覧中でも正規の読み書き権限を持つ(元々全社に
// 対して正規の読み書き権限を持つ最上位ロールのため、加盟店閲覧という状態自体に左右されない)。
export const isFranchiseReadOnly = (isViewingFranchise, role) => Boolean(isViewingFranchise) && normalizeRole(role) !== "system_admin";

// ユーザー管理画面で、ある行の編集・削除ボタンを表示してよいかどうかの判定。あくまでUIを
// わかりやすくするためのもので、実際の可否はSupabase RLS/Edge Function側のチェックが
// 最終的な担保(要件5: UIを隠すだけでなくサーバー側でも保護する)。
// - 実際に稼働しているsystem_admin(authUserIdあり=登録済み)は誰からも削除できない
//   (自分自身を含め、他のsystem_adminからも)。
// - company_adminは稼働中のsystem_admin行を編集・削除できない(自社に紛れ込んでいた場合の保険)。
// - store_managerが見る一覧(manageableUsers)は、そもそも自分の管理する店舗のstaffのみに
//   絞り込み済みなので、そこに並ぶ行は常に操作対象になり得る。
// 2026-09-04追記: 「system_adminは削除できない」の対象を、実際に登録済み(authUserIdあり)の
// 行だけに絞った。以前はrole==='system_admin'というだけで一律ブロックしていたため、
// メールアドレス起因の自動昇格(resolveRoleForEmail)によってsystem_admin役割のまま
// 一度もログインせずに招待中断・停止となった行(業務データも実権限も一切持たない)が
// 永久に削除できなくなる不具合があった——実際の管理者アカウントを守るという本来の目的は
// authUserIdの有無で十分に達成できる。
// 以前はApp.jsx内のコンポーネント外(モジュールレベル)にあったが、他の役割別権限判定と
// 同じくpermissions.jsへ集約し、単体テストできるようにした(ロジック自体は無変更)。
export const getUserRowPermissions = (currentRole, targetUser) => {
  const role = normalizeRole(currentRole);
  const isTargetActiveSystemAdmin = targetUser.role === "system_admin" && Boolean(targetUser.authUserId);
  if (role === "system_admin") {
    return { canEdit: true, canDelete: !isTargetActiveSystemAdmin };
  }
  if (role === "company_admin") {
    const isTargetSystemAdmin = targetUser.role === "system_admin";
    return { canEdit: !isTargetSystemAdmin, canDelete: !isTargetActiveSystemAdmin };
  }
  return { canEdit: true, canDelete: true };
};

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
