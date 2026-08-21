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

// statement timeout不具合(実運用で1行3.4MBに達し、店舗切替のような些細な変更のUPDATEが
// Postgresのstatement_timeoutへ到達した)の再発防止テスト。原因はbuildTenantSnapshotRowが
// appStateを丸ごとpayloadへコピーしており、dailyResults等の独自テーブルを持つ日単位の
// 蓄積データまで含めて二重保存していたこと。ここでは「独自テーブルを持つ重いフィールドは
// 一切payloadに含まれない」ことを直接検証する——将来また同じ理由でこの関数が肥大化する
// (`{...appState}`のような丸ごとスプレッドへ戻ってしまう)ことを防ぐ。
test("buildTenantSnapshotRow: 独自のSupabaseテーブルを持つ重いフィールド(日次データ・費用・目標等)はpayloadに一切含めない(statement timeout不具合の再発防止)", () => {
  const heavyFields = {
    dailyResults: { "store-1__2026-08": [{ date: "2026-08-01", totalSales: 100000 }] },
    dailyBatchEntries: { "store-1__2026-08": [{ id: "batch-1" }] },
    cashBreakdownResults: { "store-1__2026-08": { "2026-08-01": { cashAmount: 1000 } } },
    fixedCosts: { "store-1__2026-08": [{ id: "fixed-1" }] },
    costMonthlyAmounts: { "fixed-1__2026-08": { amount: 50000 } },
    storeInventoryBalances: { "store-1__2026-08": { amount: 10000 } },
    variableCosts: { "store-1__2026-08": [{ id: "var-1" }] },
    monthClosing: { "store-1__2026-08": [{ id: "close-1" }] },
    monthClosingStatus: { "store-1__2026-08": true },
    targets: { "store-1__2026-08": { targetSales: 1000000 } },
    allStoresTargets: { "company-1__2026-08": { targetSales: 5000000 } },
    allStoresBusinessDaySettings: { "company-1__2026-08": { holidayCount: 4 } },
    storeHolidays: { "store-1__2026-08": ["2026-08-10"] },
    allStoresHolidays: { "company-1__2026-08": ["2026-08-10"] },
    monthlyReviews: { "store-1__2026-08": { reflection: "text" } },
    storeStatusAuditLog: [{ storeId: "store-1", action: "suspend" }],
    businessDaySettings: { "store-1__2026-08": { mode: "manual" } },
    dayClosingStates: { "store-1__2026-08": { "2026-08-01": true } },
    dayClosingUpdatedAt: { "store-1__2026-08": { "2026-08-01": "2026-08-01T00:00:00Z" } },
    dailyResultBackups: { "store-1__2026-08": [{ date: "2026-08-01" }] },
    companySnapshots: { "company-1": { selectedStore: "本店" } },
  };
  const appState = {
    currentCompanyId: "company-1",
    currentUserId: "profile-1",
    selectedStore: "本店",
    selectedMonth: "2026-08",
    companies: [{ id: "company-1", name: "サロン本社" }],
    users: [{ id: "profile-1" }],
    ...heavyFields,
  };
  const company = { id: "company-1", name: "サロン本社" };
  const store = { id: "store-1", name: "本店" };
  const user = { id: "profile-1", authUserId: "auth-user-1" };

  const row = buildTenantSnapshotRow({ company, store, user, appState });

  Object.keys(heavyFields).forEach((key) => {
    assert.equal(key in row.payload, false, `${key} must not be included in the tenant_snapshots payload`);
  });
  // 軽量な構造情報・選択状態は引き続き含まれる。
  assert.deepEqual(row.payload.companies, appState.companies);
  assert.deepEqual(row.payload.users, appState.users);
  assert.equal(row.payload.selectedStore, "本店");
});
