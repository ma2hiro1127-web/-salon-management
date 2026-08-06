import test from "node:test";
import assert from "node:assert/strict";
import { buildTenantSnapshotRow } from "./supabaseRemote.js";

test("buildTenantSnapshotRow preserves the active company, store, and user context", () => {
  const appState = {
    currentCompanyId: "company-1",
    currentUserId: "profile-1",
    selectedStore: "本店",
    selectedMonth: "2026-08",
  };

  const company = { id: "company-1", name: "サロン本社" };
  const store = { id: "store-1", name: "本店" };
  const user = { id: "profile-1", authUserId: "auth-user-1" };

  const row = buildTenantSnapshotRow({ company, store, user, appState });

  assert.equal(row.id, "company-1:store-1:2026-08");
  assert.equal(row.company_id, "company-1");
  assert.equal(row.store_id, "store-1");
  assert.equal(row.target_month, "2026-08");
  assert.equal(row.created_by, "profile-1");
  assert.equal(row.payload.currentCompanyId, "company-1");
  assert.equal(row.payload.currentUserId, "profile-1");
  assert.equal(row.payload.selectedStore, "本店");
  assert.equal(row.payload.currentAuthUserId, "auth-user-1");
});
