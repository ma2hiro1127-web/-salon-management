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

# 不具合修正: 以前はここに「業務で使用中の全23テーブル」を固定配列でハードコードし、
# data.sql(--data-only)側に COPY public.<table> という行が無いテーブルを一律で失敗にしていた。
# しかし supabase db dump --data-only は、行が1件も無い(空の)テーブルについてはCOPYブロック
# 自体を出力しない(空のCOPY public.x (...) FROM stdin; \.という空ブロックにはならず、
# テーブルへの言及自体が無くなる)。variable_costs・monthly_closings・store_status_audit_log
# 等、本番でまだ0件のテーブルがあると、そのテーブル名がdata.sqlに一切現れないため「欠落」と
# 誤検知して失敗していた——これが今回のエラーの直接の原因。
#
# 修正後の方式(要件どおりschema.sqlとdata.sqlで役割を分ける):
#   - 「テーブルが存在するか」は毎回このダンプ自身が作ったschema.sqlを基準に動的に判定する
#     (過去のテーブル名を固定リストで持たない — 追加/削除/改名してもここの更新は不要)。
#   - schema.sqlに1つもCREATE TABLEが無ければ、ダンプ自体が壊れているとみなし必ず失敗する。
#   - 「本当に必要な主要テーブル」だけは、今後も存在し続けることが前提の最小限のセーフティ
#     ネットとして固定リストで持ち、schema.sqlから欠落していたら必ず失敗する(スキーマダンプ
#     自体の欠落・権限不足等、本物の異常を見逃さないため)。
#   - data.sql側は「行があるテーブルの一覧」を出すだけで、空テーブル(=data.sqlに現れない)は
#     正常として扱う。data.sqlにあるのにschema.sqlに存在しないテーブルがあれば、スキーマと
#     データの整合性が壊れている証拠なので失敗する。
SCHEMA_TABLES=$(grep -oE '^CREATE TABLE( IF NOT EXISTS)? public\.[A-Za-z0-9_]+' "$OUT_DIR/schema.sql" \
  | sed -E 's/^CREATE TABLE( IF NOT EXISTS)? public\.//' | sort -u)
SCHEMA_TABLE_COUNT=$(echo "$SCHEMA_TABLES" | grep -c . || true)

if [ "$SCHEMA_TABLE_COUNT" -eq 0 ]; then
  echo "::error::schema.sql contains no 'CREATE TABLE public.*' statements — the schema dump looks broken" >&2
  exit 1
fi

# 主要テーブル(このアプリの根幹をなす、今後も存在し続ける前提のテーブルだけの最小限リスト)。
# ここに列挙していないテーブルの追加・削除・改名はこの検証に一切影響しない。
CRITICAL_TABLES=(companies stores profiles daily_sales)
missing_critical=()
for table in "${CRITICAL_TABLES[@]}"; do
  if ! echo "$SCHEMA_TABLES" | grep -qx "$table"; then
    missing_critical+=("$table")
  fi
done
if [ "${#missing_critical[@]}" -gt 0 ]; then
  echo "::error::critical table(s) missing from schema dump: ${missing_critical[*]} — this should never happen and indicates a broken/partial dump" >&2
  exit 1
fi

DATA_TABLES=$(grep -oE '^COPY public\.[A-Za-z0-9_]+' "$OUT_DIR/data.sql" | sed -E 's/^COPY public\.//' | sort -u)

# data.sqlに現れるテーブルは、必ずschema.sqlにも存在するはず(存在しなければスキーマと
# データの取得が食い違っている=本物の異常)。
extra_in_data=()
while IFS= read -r table; do
  [ -z "$table" ] && continue
  if ! echo "$SCHEMA_TABLES" | grep -qx "$table"; then
    extra_in_data+=("$table")
  fi
done <<< "$DATA_TABLES"
if [ "${#extra_in_data[@]}" -gt 0 ]; then
  echo "::error::data dump references table(s) not found in schema dump: ${extra_in_data[*]}" >&2
  exit 1
fi

# 参考情報として、どのテーブルが空だったか(data.sqlに現れなかったか)を出力する。
# これは失敗条件ではない — 「テーブルは存在するが0件」を「テーブルが存在しない」と混同しない。
empty_tables=()
while IFS= read -r table; do
  [ -z "$table" ] && continue
  if ! echo "$DATA_TABLES" | grep -qx "$table"; then
    empty_tables+=("$table")
  fi
done <<< "$SCHEMA_TABLES"

echo "[backup] OK — $(du -sh "$OUT_DIR" | cut -f1) across $SCHEMA_TABLE_COUNT tables in schema dump"
echo "[backup]   $(echo "$DATA_TABLES" | grep -c . || true) table(s) have rows in data dump"
if [ "${#empty_tables[@]}" -gt 0 ]; then
  echo "[backup]   ${#empty_tables[@]} table(s) currently empty (present in schema, no rows to copy — normal): ${empty_tables[*]}"
fi
