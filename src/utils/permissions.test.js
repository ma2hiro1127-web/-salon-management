import test from "node:test";
import assert from "node:assert/strict";
import { getAllowedStoreIdsForRole, canManageCompanies, canManageStores, canChangeStoreLifecycle, canHardDeleteStore, canManageUsers, canEditMonthlyData, canViewUserManagement, normalizeRole, canAccessPage, isAdminRole, canManageFranchisePartnerships, canCreateFranchiseRequest, getVisibleNavItems, resolveDefaultPage, getInvitableRoles, isFranchiseReadOnly, getUserRowPermissions } from "./permissions.js";

test("system and company admins can access all stores in their company", () => {
  assert.deepEqual(getAllowedStoreIdsForRole({ role: "system_admin", companyStoreIds: ["s1", "s2"], currentUserStoreIds: ["s1"] }), ["s1", "s2"]);
  assert.deepEqual(getAllowedStoreIdsForRole({ role: "company_admin", companyStoreIds: ["s1", "s2"], currentUserStoreIds: ["s1"] }), ["s1", "s2"]);
});

test("store scoped roles only see assigned stores", () => {
  assert.deepEqual(getAllowedStoreIdsForRole({ role: "store_manager", companyStoreIds: ["s1", "s2"], currentUserStoreIds: ["s1"] }), ["s1"]);
  assert.deepEqual(getAllowedStoreIdsForRole({ role: "staff", companyStoreIds: ["s1", "s2"], currentUserStoreIds: ["s2"] }), ["s2"]);
});

test("role normalization and page access stay consistent for owner/admin aliases", () => {
  assert.equal(normalizeRole("Owner"), "system_admin");
  assert.equal(normalizeRole("admin"), "company_admin");
  assert.equal(canAccessPage("owner", "users"), true);
  assert.equal(canAccessPage("company_admin", "monthly"), true);
  assert.equal(isAdminRole("staff"), false);
});

test("role-based management permissions are scoped correctly", () => {
  assert.equal(canManageCompanies("system_admin"), true);
  assert.equal(canManageCompanies("company_admin"), false);
  assert.equal(canManageStores("system_admin"), true);
  assert.equal(canManageStores("company_admin"), true);
  assert.equal(canManageStores("store_manager"), false);
  assert.equal(canManageUsers("system_admin"), true);
  assert.equal(canManageUsers("company_admin"), true);
  // store_manager can manage (invite/edit/delete) staff within their own store — see the
  // delete-user and send-invite-email Edge Functions, which scope this to staff-role targets
  // sharing a store with the caller.
  assert.equal(canManageUsers("store_manager"), true);
  assert.equal(canEditMonthlyData("system_admin"), true);
  assert.equal(canEditMonthlyData("store_manager"), true);
  assert.equal(canEditMonthlyData("staff"), false);
  assert.equal(canViewUserManagement("system_admin"), true);
  assert.equal(canViewUserManagement("company_admin"), true);
  assert.equal(canViewUserManagement("store_manager"), true);
});

test("store lifecycle (suspend/resume/archive/restore) is allowed for system_admin/company_admin only, never store_manager/staff", () => {
  assert.equal(canChangeStoreLifecycle("system_admin"), true);
  assert.equal(canChangeStoreLifecycle("company_admin"), true);
  assert.equal(canChangeStoreLifecycle("store_manager"), false);
  assert.equal(canChangeStoreLifecycle("staff"), false);
});

test("hard-deleting a store is system_admin only — company_admin can suspend/archive but never permanently delete", () => {
  assert.equal(canHardDeleteStore("system_admin"), true);
  assert.equal(canHardDeleteStore("company_admin"), false);
  assert.equal(canHardDeleteStore("store_manager"), false);
  assert.equal(canHardDeleteStore("staff"), false);
});

test("加盟店連携(閲覧専用): system_admin/company_adminだけがアクセス可能、store_manager/staffは不可(要件10)", () => {
  assert.equal(canManageFranchisePartnerships("system_admin"), true);
  assert.equal(canManageFranchisePartnerships("company_admin"), true);
  assert.equal(canManageFranchisePartnerships("store_manager"), false);
  assert.equal(canManageFranchisePartnerships("staff"), false);
  assert.equal(canAccessPage("system_admin", "franchise"), true);
  assert.equal(canAccessPage("company_admin", "franchise"), true);
  assert.equal(canAccessPage("store_manager", "franchise"), false);
  assert.equal(canAccessPage("staff", "franchise"), false);
});

test("加盟店連携リクエストの新規送信はsystem_admin限定(company_adminは受信・承認・拒否のみ)", () => {
  assert.equal(canCreateFranchiseRequest("system_admin"), true);
  assert.equal(canCreateFranchiseRequest("company_admin"), false);
  assert.equal(canCreateFranchiseRequest("store_manager"), false);
});

test("「franchise」ナビ項目追加後もresolveDefaultPage(先頭は常にdashboard)は変わらない", () => {
  assert.equal(resolveDefaultPage("system_admin"), "dashboard");
  assert.equal(resolveDefaultPage("company_admin"), "dashboard");
  const systemAdminNav = getVisibleNavItems("system_admin").map((item) => item.id);
  const companyAdminNav = getVisibleNavItems("company_admin").map((item) => item.id);
  assert.ok(systemAdminNav.includes("franchise"));
  assert.ok(companyAdminNav.includes("franchise"));
  assert.ok(!getVisibleNavItems("store_manager").map((item) => item.id).includes("franchise"));
  assert.ok(!getVisibleNavItems("staff").map((item) => item.id).includes("franchise"));
});

test("「使い方・FAQ」はAI機能とは無関係だが、管理者向けヘルプとしてsystem_admin/company_admin/store_managerのみアクセスでき、staffには表示・URL直接アクセスとも許可しない(権限体系の正式仕様・要件8)", () => {
  ["system_admin", "company_admin", "store_manager"].forEach((role) => {
    assert.equal(canAccessPage(role, "faq"), true, `${role} should be able to access faq`);
    assert.ok(getVisibleNavItems(role).map((item) => item.id).includes("faq"), `${role} nav should include faq`);
  });
  assert.equal(canAccessPage("staff", "faq"), false);
  assert.ok(!getVisibleNavItems("staff").map((item) => item.id).includes("faq"));
  // 先頭は引き続きdashboardのまま(faqが初期表示ページになってしまわないこと)。
  assert.equal(resolveDefaultPage("staff"), "dashboard");
});

test("system_adminであっても、通常の会社ユーザー招待/編集からsystem_adminを付与することはできない(会社管理画面の是正・要件3)", () => {
  assert.deepEqual(getInvitableRoles("system_admin"), ["company_admin", "store_manager", "staff"]);
  assert.ok(!getInvitableRoles("system_admin").includes("system_admin"));
  assert.deepEqual(getInvitableRoles("company_admin"), ["company_admin", "store_manager", "staff"]);
  assert.deepEqual(getInvitableRoles("store_manager"), ["staff"]);
});

// 総合品質チェックで発見した問題E(権限判定の二重実装)の回帰テスト: 以前はApp.jsx内で
// isFranchiseReadOnlyForCurrentUser(書き込みガード用)とcanEditMonthlyReview(月次レビューの
// 編集可否)が同じ判定式を手書きで複製していた(TDZ制約が理由)。isFranchiseReadOnlyという
// 1つの純粋関数へ統一したので、両方の呼び出し元が同じ結果になることをここで直接検証する。
test("isFranchiseReadOnly: 加盟店閲覧中はsystem_admin以外すべて読み取り専用、system_adminのみ書き込み可能", () => {
  assert.equal(isFranchiseReadOnly(true, "system_admin"), false);
  assert.equal(isFranchiseReadOnly(true, "company_admin"), true);
  assert.equal(isFranchiseReadOnly(true, "store_manager"), true);
  assert.equal(isFranchiseReadOnly(true, "staff"), true);
  // owner/adminのようなロールのエイリアスもnormalizeRole経由で正しく解決される。
  assert.equal(isFranchiseReadOnly(true, "owner"), false);
  assert.equal(isFranchiseReadOnly(true, "admin"), true);
});

test("isFranchiseReadOnly: 加盟店を閲覧していない(通常時)は誰であっても読み取り専用にしない", () => {
  assert.equal(isFranchiseReadOnly(false, "system_admin"), false);
  assert.equal(isFranchiseReadOnly(false, "company_admin"), false);
  assert.equal(isFranchiseReadOnly(false, "store_manager"), false);
  assert.equal(isFranchiseReadOnly(false, "staff"), false);
  // isViewingFranchiseがfalsy値(undefined/null/空文字)の場合も同様に読み取り専用にしない。
  assert.equal(isFranchiseReadOnly(undefined, "company_admin"), false);
  assert.equal(isFranchiseReadOnly(null, "company_admin"), false);
});

test("getUserRowPermissions: system_adminは誰の行も編集できるが、system_admin自身の行だけは削除できない", () => {
  assert.deepEqual(getUserRowPermissions("system_admin", { role: "company_admin" }), { canEdit: true, canDelete: true });
  assert.deepEqual(getUserRowPermissions("system_admin", { role: "system_admin" }), { canEdit: true, canDelete: false });
});

test("getUserRowPermissions: company_adminはsystem_admin行を編集・削除できない(自社に紛れ込んでいた場合の保険)", () => {
  assert.deepEqual(getUserRowPermissions("company_admin", { role: "system_admin" }), { canEdit: false, canDelete: false });
  assert.deepEqual(getUserRowPermissions("company_admin", { role: "store_manager" }), { canEdit: true, canDelete: true });
  assert.deepEqual(getUserRowPermissions("company_admin", { role: "staff" }), { canEdit: true, canDelete: true });
});

test("getUserRowPermissions: store_manager/staffが見る一覧は既に自分の管理範囲へ絞り込み済みのため、並んでいる行は常に編集・削除可能", () => {
  assert.deepEqual(getUserRowPermissions("store_manager", { role: "staff" }), { canEdit: true, canDelete: true });
});
