// Full logical (data-only) backup of every table this app owns, exported as JSON.
//
// This project is currently on a Supabase tier with PITR/physical backups disabled
// (`supabase backups list` -> pitr_enabled: false, backups: []), so this script is the only
// backup mechanism in place until that's upgraded — see docs/BACKUP.md for the full picture
// (this script vs. PITR vs. `supabase db dump`, and how to restore from each).
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup-supabase-data.mjs
//
// Requires VITE_SUPABASE_URL (already in .env) and SUPABASE_SERVICE_ROLE_KEY (service_role key,
// NEVER the anon key — RLS would otherwise silently hide rows from this export). Get it with:
//   supabase projects api-keys list --project-ref <ref> --output-format json
//
// Writes one timestamped JSON file per table plus a combined snapshot, all under backups/
// (gitignored — these files contain real business data and must never be committed).
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var.");
  console.error("Run: SUPABASE_SERVICE_ROLE_KEY=<service_role key> node scripts/backup-supabase-data.mjs");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// Every table this app writes to. Keep this list in sync with supabase/migrations/ — a table
// added there without being added here silently falls out of the backup.
const TABLES = [
  "companies",
  "stores",
  "profiles",
  "user_stores",
  "daily_sales",
  "monthly_targets",
  "monthly_closings",
  "store_input_settings",
  "fixed_costs",
  "variable_costs",
  "monthly_closing_items",
  "company_settings",
  "store_profiles",
  "tenant_snapshots",
];

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "backups", timestamp);
mkdirSync(outDir, { recursive: true });

const combined = {};
let hadError = false;

for (const table of TABLES) {
  const { data, error } = await supabase.from(table).select("*");
  if (error) {
    console.error(`FAILED  ${table}: ${error.message}`);
    hadError = true;
    continue;
  }
  combined[table] = data;
  writeFileSync(path.join(outDir, `${table}.json`), JSON.stringify(data, null, 2));
  console.log(`OK      ${table}: ${data.length} row(s)`);
}

writeFileSync(path.join(outDir, "_all-tables.json"), JSON.stringify(combined, null, 2));
console.log(`\nBackup written to ${outDir}`);

if (hadError) {
  console.error("\nOne or more tables failed — this backup is incomplete. Do not rely on it alone.");
  process.exit(1);
}
