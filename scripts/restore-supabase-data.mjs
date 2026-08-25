// Restores tables from a backup produced by scripts/backup-supabase-data.mjs.
//
// Restores in FK-dependency order (companies -> stores -> everything else) so a restore never
// fails on a foreign key it hasn't inserted the parent for yet. Every row is upserted by its
// primary key, so re-running a restore is safe (idempotent) and never creates duplicates.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-supabase-data.mjs backups/<timestamp> [companyId]
//
// If companyId is given, only rows belonging to that company are restored (recommended — a full
// unscoped restore will overwrite every company's current data with whatever was in the backup,
// which is rarely what you want for a targeted recovery).
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const backupDir = process.argv[2];
const scopeCompanyId = process.argv[3] || null;

if (!url || !serviceKey) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var.");
  process.exit(1);
}
if (!backupDir || !existsSync(backupDir)) {
  console.error("Usage: node scripts/restore-supabase-data.mjs <backup-dir> [companyId]");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// Order matters: a child table's FK must have its parent already restored.
// βテスト開始前の総点検で発見: backup-supabase-data.mjsと同じ理由で、以下10テーブルが
// このリストから漏れていた(バックアップ側の同じ調査・同じ修正を参照)。復元スクリプトが
// これらのテーブルを一切知らないと、たとえbackup側を直しても「復元できないデータ」が
// 残ってしまうため、両方を必ず同期させる。
const TABLES_IN_ORDER = [
  { name: "companies", pk: "id" },
  { name: "stores", pk: "id" },
  { name: "profiles", pk: "id" },
  { name: "user_stores", pk: "user_id,company_id,store_id" },
  { name: "daily_sales", pk: "id" },
  { name: "monthly_targets", pk: "id" },
  { name: "monthly_closings", pk: "id" },
  { name: "store_input_settings", pk: "id" },
  { name: "fixed_costs", pk: "id" },
  { name: "variable_costs", pk: "id" },
  { name: "monthly_closing_items", pk: "id" },
  { name: "company_settings", pk: "company_id" },
  { name: "store_profiles", pk: "store_id" },
  { name: "tenant_snapshots", pk: "id" },
  { name: "company_all_stores_holidays", pk: "id" },
  { name: "company_all_stores_targets", pk: "id" },
  { name: "company_partnerships", pk: "id" },
  { name: "cost_monthly_amounts", pk: "id" },
  { name: "daily_batch_entries", pk: "id" },
  { name: "daily_cash_breakdown", pk: "id" },
  { name: "monthly_reviews", pk: "id" },
  { name: "store_business_holidays", pk: "id" },
  { name: "store_inventory_balances", pk: "id" },
  { name: "store_status_audit_log", pk: "id" },
];

const scopeFilter = (row) => {
  if (!scopeCompanyId) return true;
  if ("company_id" in row) return row.company_id === scopeCompanyId;
  if ("id" in row && ["companies"].includes) return true; // companies row itself filtered below by id
  return true;
};

for (const { name, pk } of TABLES_IN_ORDER) {
  const filePath = path.join(backupDir, `${name}.json`);
  if (!existsSync(filePath)) {
    console.log(`SKIP    ${name}: no backup file`);
    continue;
  }
  let rows = JSON.parse(readFileSync(filePath, "utf8"));
  if (scopeCompanyId) {
    rows = name === "companies"
      ? rows.filter((row) => row.id === scopeCompanyId)
      : rows.filter(scopeFilter);
  }
  if (!rows.length) {
    console.log(`EMPTY   ${name}: 0 row(s) in scope`);
    continue;
  }
  const { error } = await supabase.from(name).upsert(rows, { onConflict: pk });
  if (error) {
    console.error(`FAILED  ${name}: ${error.message}`);
    process.exit(1);
  }
  console.log(`OK      ${name}: restored ${rows.length} row(s)`);
}

console.log("\nRestore complete.");
