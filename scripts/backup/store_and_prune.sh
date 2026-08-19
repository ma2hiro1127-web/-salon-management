#!/usr/bin/env bash
# 生成済みのバックアップ(roles.sql/schema.sql/data.sql)を、チェックアウト済みの外部プライベート
# バックアップリポジトリ内へ世代別ディレクトリで配置し、保持期限を過ぎた古い世代を削除する。
#
# 世代管理(要件5):
#   daily/YYYY-MM-DD/   … 直近7日分を保持
#   weekly/YYYY-Www/    … 日曜日実行分のみ追加保存、直近4週分を保持
#   monthly/YYYY-MM/    … 毎月1日実行分のみ追加保存、直近3か月分を保持
#
# 容量節約のため、コピー時にgzip圧縮する(標準的なgzip形式のみ使用、独自形式ではない —
# 復元時はgunzipで戻すだけ)。
set -euo pipefail

SOURCE_DIR="${1:?Usage: store_and_prune.sh <source-dump-dir> <backup-repo-dir>}"
REPO_DIR="${2:?Usage: store_and_prune.sh <source-dump-dir> <backup-repo-dir>}"

DATE_TAG="$(date -u +%Y-%m-%d)"
DOW="$(date -u +%u)"   # 1=Mon .. 7=Sun
DOM="$(date -u +%d)"
WEEK_TAG="$(date -u +%Y-W%V)"
MONTH_TAG="$(date -u +%Y-%m)"

copy_generation() {
  local kind="$1" tag="$2"
  local dest="$REPO_DIR/$kind/$tag"
  mkdir -p "$dest"
  for f in roles.sql schema.sql data.sql; do
    gzip -9 -c "$SOURCE_DIR/$f" > "$dest/$f.gz"
  done
  echo "[store] wrote $kind/$tag"
}

copy_generation daily "$DATE_TAG"

if [ "$DOW" = "7" ]; then
  copy_generation weekly "$WEEK_TAG"
fi

if [ "$DOM" = "01" ]; then
  copy_generation monthly "$MONTH_TAG"
fi

prune() {
  local kind="$1" keep_count="$2"
  local dir="$REPO_DIR/$kind"
  [ -d "$dir" ] || return 0
  # ディレクトリ名は YYYY-MM-DD / YYYY-Www / YYYY-MM なので文字列ソートがそのまま時系列順になる。
  # GNU/BSD差異のある`head -n -N`には頼らず、配列の先頭から明示的に削除件数分だけ処理する。
  local all_dirs=()
  while IFS= read -r line; do
    all_dirs+=("$line")
  done < <(find "$dir" -mindepth 1 -maxdepth 1 -type d | sort)
  local total="${#all_dirs[@]}"
  if [ "$total" -le "$keep_count" ]; then
    return 0
  fi
  local delete_count=$((total - keep_count))
  echo "[prune] removing $delete_count old $kind generation(s):"
  local i
  for ((i = 0; i < delete_count; i++)); do
    echo "  ${all_dirs[$i]}"
    rm -rf "${all_dirs[$i]}"
  done
}

prune daily 7
prune weekly 4
prune monthly 3

echo "[store] done. current sizes:"
du -sh "$REPO_DIR"/daily "$REPO_DIR"/weekly "$REPO_DIR"/monthly 2>/dev/null || true
