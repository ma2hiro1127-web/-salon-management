#!/usr/bin/env bash
# サロンマネージャー Supabase Storage バケットのバックアップ本体(2026-09-28追加)。
#
# 現在このアプリが使うバケットはsupport-attachments(問い合わせ添付ファイル)のみで、
# 2026-09-28時点で8ファイル・約490KBという小規模かつ低頻度更新のため、毎回バケット全体を
# まるごと取得する単純な方式でもコスト・時間ともに無視できる。ファイル数・容量が今後大きく
# 増えた場合は、この「毎回全件コピー」の設計のままスケールさせず、差分バックアップ等を
# 別途検討すること(要件: 無制限にコピーしてコストが増える設計にしない、への対応方針)。
#
# ファイル一覧はSUPABASE_DB_URL経由でstorage.objectsテーブル(メタデータはPostgres側にある)
# から取得する。実ファイルのバイト列はPostgresの外(オブジェクトストレージ)にあるため、
# ダウンロードにはSupabase Storage REST API + service_role鍵が必要
# (SUPABASE_SERVICE_ROLE_KEY、新規Secret。docs/backup-restore.md参照)。
#
# DBバックアップ(run_backup.sh)と同じく、失敗時は即座に非ゼロ終了する(set -euo pipefail)。
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required (Storageファイル本体の取得に使う。値はコードにもログにも一切出力しない)}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is required (例: mtjiauhliezbjjpqpvuj)}"

OUT_DIR="${1:?Usage: backup_storage.sh <output-dir> <bucket-name>}"
BUCKET="${2:?Usage: backup_storage.sh <output-dir> <bucket-name>}"

FILES_DIR="$OUT_DIR/files"
mkdir -p "$FILES_DIR"

echo "[storage-backup] listing objects in bucket '$BUCKET'..."
psql "$SUPABASE_DB_URL" -Atc "select name from storage.objects where bucket_id = '$BUCKET' order by name;" > "$OUT_DIR/_file_list.txt"

FILE_COUNT=$(grep -c . "$OUT_DIR/_file_list.txt" || true)
echo "[storage-backup] found $FILE_COUNT object(s)"

if [ "$FILE_COUNT" -gt 0 ]; then
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    dest="$FILES_DIR/$path"
    mkdir -p "$(dirname "$dest")"
    # パスワード相当の秘密(service_role鍵)をログへ絶対に出さない — curlの-sSはエラー時にURL・
    # ステータスは出すが、ヘッダ(Authorization)自体は出力しない。
    http_code=$(curl -sS -o "$dest" -w '%{http_code}' \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      "https://$SUPABASE_PROJECT_REF.supabase.co/storage/v1/object/$BUCKET/$path")
    if [ "$http_code" != "200" ]; then
      echo "::error::VERIFY-FAIL(storage-download): failed to download object (HTTP $http_code) — path omitted from log" >&2
      exit 1
    fi
  done < "$OUT_DIR/_file_list.txt"
fi

echo "[storage-backup]   verifying downloaded file count matches listing..."
DOWNLOADED_COUNT=$(find "$FILES_DIR" -type f | wc -l | tr -d ' ')
if [ "$DOWNLOADED_COUNT" != "$FILE_COUNT" ]; then
  echo "::error::VERIFY-FAIL(storage-count-mismatch): expected $FILE_COUNT file(s) from storage.objects, but downloaded $DOWNLOADED_COUNT — treating backup as failed" >&2
  exit 1
fi

echo "[storage-backup] OK — $DOWNLOADED_COUNT file(s), $(du -sh "$FILES_DIR" 2>/dev/null | cut -f1 || echo '0')"
