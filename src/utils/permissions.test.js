import test from "node:test";
import assert from "node:assert/strict";
import { getAllowedStoreIdsForRole, canManageCompanies, canManageStores, canChangeStoreLifecycle, canHardDeleteStore, canManageUsers, canEditMonthlyData, canViewUserManagement, normalizeRole, canAccessPage, isAdminRole, canManageFranchisePartnerships, canCreateFranchiseRequest, getVisibleNavItems, resolveDefaultPage } from "./permissions.js";

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

test("「使い方・FAQ」はAI機能とは無関係に全ロール(system_admin/company_admin/store_manager/staff)からアクセスできる", () => {
  ["system_admin", "company_admin", "store_manager", "staff"].forEach((role) => {
    assert.equal(canAccessPage(role, "faq"), true, `${role} should be able to access faq`);
    assert.ok(getVisibleNavItems(role).map((item) => item.id).includes("faq"), `${role} nav should include faq`);
  });
  // 先頭は引き続きdashboardのまま(faqが初期表示ページになってしまわないこと)。
  assert.equal(resolveDefaultPage("staff"), "dashboard");
});
