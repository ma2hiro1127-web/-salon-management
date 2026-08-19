#!/usr/bin/env bash
# サロンマネージャー Supabase DB 自動バックアップ本体。
#
# publicスキーマ(companies/stores/profiles/daily_sales等、業務データを持つ全23テーブル)を
# 対象に、Supabase CLI(公式ツール、内部でpg_dumpをラップ)を使って
#   1. roles.sql   ロール定義(--role-only)
#   2. schema.sql  テーブル定義(スキーマのみ、--schema public)
#   3. data.sql    実データ(--schema public --data-only --use-copy、COPY文形式で高速・省容量)
# の3ファイルをプレーンなSQLとして出力する(pg_dump標準機能のみ、独自形式は使わない)。
#
# authスキーマ(Supabase Authのユーザー・パスワードハッシュ等)は意図的に対象外にしている —
# 理由はdocs/backup-restore.mdを参照。publicスキーマのprofiles.auth_user_idはauth.usersへの
# 外部キー制約を持たない設計のため、このバックアップの復元はauth側に一切触れない。
#
# 失敗時は即座に非ゼロ終了する(set -euo pipefail)。「ファイルが空でもとりあえず成功扱い」に
# しない — 呼び出し元(GitHub Actionsワークフロー)はこのスクリプトの終了コードだけを見て
# 成功/失敗を判定する。
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required (postgresql connection string, percent-encoded password)}"
OUT_DIR="${1:?Usage: run_backup.sh <output-directory>}"

mkdir -p "$OUT_DIR"

echo "[backup] dumping roles..."
supabase db dump --db-url "$SUPABASE_DB_URL" --role-only -f "$OUT_DIR/roles.sql"

echo "[backup] dumping schema (public only)..."
supabase db dump --db-url "$SUPABASE_DB_URL" --schema public -f "$OUT_DIR/schema.sql"

echo "[backup] dumping data (public only)..."
supabase db dump --db-url "$SUPABASE_DB_URL" --schema public --data-only --use-copy -f "$OUT_DIR/data.sql"

echo "[backup] verifying dump integrity..."

# ファイルサイズが0でないこと(要件8: 存在するだけでは成功扱いにしない)。
for f in roles.sql schema.sql data.sql; do
  path="$OUT_DIR/$f"
  if [ ! -s "$path" ]; then
    echo "::error::$path is missing or empty — treating backup as failed" >&2
    exit 1
  fi
done

# 想定テーブルが実際にデータダンプへ含まれていること(業務で使用中の全23テーブル)。
# COPY public.<table> という行が無ければ、そのテーブルは(空でも)ダンプに含まれていない
# ことになるため、テーブル名のtypo・スキーマ指定ミス等を検知できる。
EXPECTED_TABLES=(
  companies company_all_stores_holidays company_all_stores_targets company_partnerships
  company_settings cost_monthly_amounts daily_batch_entries daily_cash_breakdown daily_sales
  fixed_costs monthly_closing_items monthly_closings monthly_targets profiles
  store_business_holidays store_input_settings store_inventory_balances store_profiles
  store_status_audit_log stores tenant_snapshots user_stores variable_costs
)
missing=()
for table in "${EXPECTED_TABLES[@]}"; do
  if ! grep -q "COPY public\.${table} " "$OUT_DIR/data.sql"; then
    missing+=("$table")
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "::error::expected tables missing from data dump: ${missing[*]}" >&2
  exit 1
fi

echo "[backup] OK — $(du -sh "$OUT_DIR" | cut -f1) across ${#EXPECTED_TABLES[@]} expected tables confirmed present"
