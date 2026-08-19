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
    echo "::error::VERIFY-FAIL(empty-file): $path is missing or empty — treating backup as failed" >&2
    exit 1
  fi
done

# 不具合修正の経緯:
#  1回目: 「業務で使用中の全23テーブル」を固定配列でハードコードし、data.sql側にCOPY行が
#    無いテーブルを一律で失敗にしていた。supabase db dumpは行が1件も無い(空の)テーブルには
#    COPYブロック自体を出力しないため、本番の空テーブル(variable_costs等)で誤検知していた。
#  2回目(今回): 1回目の修正で固定配列は撤去したが、CREATE TABLE/COPY行を抽出する
#    grep -oE '...' | sed ... | sort -u という一連のパイプラインを、コマンド置換
#    (VAR=$(...))の中でset -eo pipefail下に置いたままにしていた。grepは「1件もマッチしない」
#    場合に終了コード1を返す仕様のため、pipefail下ではそのパイプライン全体の終了コードが1に
#    なり、代入文の実行中にset -eが働いて、こちらの::error::メッセージを一切出さないまま
#    スクリプトがその場で終了していた(実際のGitHub Actionsログで「verifying dump
#    integrity...」の直後に何のメッセージも無くexit code 1になっていたのはこれが原因)。
#    さらに、正規表現自体もpublic.<table>という完全一致だけを想定しており、実際のsupabase db
#    dump出力がスキーマ名を省略する・識別子をダブルクォートで囲む、等の書式差異があった場合に
#    1件もマッチしない可能性があった。
#  今回の対策: (a) 該当なしを正常に起こりうる結果として明示的に || true で受け止め、
#    このスクリプト自身がset -eで落ちないようにする。(b) 正規表現を
#    "public."有無・ダブルクォート有無のどちらにも一致する形に緩和する。
#    (c) 各判定の結果を必ずログへ出力し、失敗時は「どの条件で失敗したか」を明示する。
echo "[backup]   extracting table names from schema.sql..."
SCHEMA_TABLES=$(grep -oE '^CREATE TABLE( IF NOT EXISTS)? [^(]+' "$OUT_DIR/schema.sql" \
  | sed -E 's/^CREATE TABLE( IF NOT EXISTS)? //; s/"//g; s/^public\.//; s/[[:space:]]+$//' \
  | sort -u || true)
SCHEMA_TABLE_COUNT=0
if [ -n "$SCHEMA_TABLES" ]; then
  SCHEMA_TABLE_COUNT=$(printf '%s\n' "$SCHEMA_TABLES" | grep -c . || true)
fi
echo "[backup]   found $SCHEMA_TABLE_COUNT table(s) in schema.sql"

if [ "$SCHEMA_TABLE_COUNT" -eq 0 ]; then
  echo "::error::VERIFY-FAIL(no-tables-in-schema): schema.sql contains no 'CREATE TABLE ...' statements matched by the verifier — the schema dump looks broken, or its format changed. First 20 lines of schema.sql for debugging:" >&2
  head -20 "$OUT_DIR/schema.sql" >&2
  exit 1
fi

# 主要テーブル(このアプリの根幹をなす、今後も存在し続ける前提のテーブルだけの最小限リスト)。
# ここに列挙していないテーブルの追加・削除・改名はこの検証に一切影響しない。
CRITICAL_TABLES=(companies stores profiles daily_sales)
missing_critical=()
for table in "${CRITICAL_TABLES[@]}"; do
  if ! printf '%s\n' "$SCHEMA_TABLES" | grep -qx "$table"; then
    missing_critical+=("$table")
  fi
done
if [ "${#missing_critical[@]}" -gt 0 ]; then
  echo "::error::VERIFY-FAIL(missing-critical-table): critical table(s) missing from schema dump: ${missing_critical[*]} — this should never happen and indicates a broken/partial dump. Tables actually found: $SCHEMA_TABLES" >&2
  exit 1
fi
echo "[backup]   all critical tables present: ${CRITICAL_TABLES[*]}"

echo "[backup]   extracting table names with rows from data.sql..."
DATA_TABLES=$(grep -oE '^COPY [^(]+\(' "$OUT_DIR/data.sql" \
  | sed -E 's/^COPY //; s/"//g; s/^public\.//; s/[[:space:](]+$//' \
  | sort -u || true)
DATA_TABLE_COUNT=0
if [ -n "$DATA_TABLES" ]; then
  DATA_TABLE_COUNT=$(printf '%s\n' "$DATA_TABLES" | grep -c . || true)
fi
echo "[backup]   found $DATA_TABLE_COUNT table(s) with rows in data.sql"

# data.sqlに現れるテーブルは、必ずschema.sqlにも存在するはず(存在しなければスキーマと
# データの取得が食い違っている=本物の異常)。data.sqlに1件もCOPY行が無いこと自体は失敗では
# ない(会社作成直後で全テーブルが空、等でも起こりうる)。
extra_in_data=()
if [ -n "$DATA_TABLES" ]; then
  while IFS= read -r table; do
    [ -z "$table" ] && continue
    if ! printf '%s\n' "$SCHEMA_TABLES" | grep -qx "$table"; then
      extra_in_data+=("$table")
    fi
  done <<< "$DATA_TABLES"
fi
if [ "${#extra_in_data[@]}" -gt 0 ]; then
  echo "::error::VERIFY-FAIL(data-schema-mismatch): data dump references table(s) not found in schema dump: ${extra_in_data[*]}" >&2
  exit 1
fi

# 参考情報として、どのテーブルが空だったか(data.sqlに現れなかったか)を出力する。
# これは失敗条件ではない — 「テーブルは存在するが0件」を「テーブルが存在しない」と混同しない。
empty_tables=()
while IFS= read -r table; do
  [ -z "$table" ] && continue
  if [ -z "$DATA_TABLES" ] || ! printf '%s\n' "$DATA_TABLES" | grep -qx "$table"; then
    empty_tables+=("$table")
  fi
done <<< "$SCHEMA_TABLES"

echo "[backup] OK — $(du -sh "$OUT_DIR" | cut -f1) across $SCHEMA_TABLE_COUNT tables in schema dump"
echo "[backup]   $DATA_TABLE_COUNT table(s) have rows in data dump"
if [ "${#empty_tables[@]}" -gt 0 ]; then
  echo "[backup]   ${#empty_tables[@]} table(s) currently empty (present in schema, no rows to copy — normal): ${empty_tables[*]}"
fi
