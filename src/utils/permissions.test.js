import test from "node:test";
import assert from "node:assert/strict";
import { getAllowedStoreIdsForRole, canManageCompanies, canManageStores, canManageUsers, canEditMonthlyData, canViewUserManagement, normalizeRole, canAccessPage, isAdminRole } from "./permissions.js";

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
  assert.equal(canManageUsers("store_manager"), false);
  assert.equal(canEditMonthlyData("system_admin"), true);
  assert.equal(canEditMonthlyData("store_manager"), true);
  assert.equal(canEditMonthlyData("staff"), false);
  assert.equal(canViewUserManagement("system_admin"), true);
  assert.equal(canViewUserManagement("company_admin"), true);
  assert.equal(canViewUserManagement("store_manager"), false);
});
