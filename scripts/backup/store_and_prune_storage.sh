#!/usr/bin/env bash
# backup_storage.shが取得したファイル一式を、backup-repo内に世代別ディレクトリで保存し、
# 保持期限を過ぎた古い世代を削除する(2026-09-28追加)。
#
# store_and_prune.sh(DBダンプ用、roles.sql/schema.sql/data.sqlの3固定ファイルを個別gzip)とは
# 対象の形が違う(バケット内の任意のファイルツリー)ため、1つのtarアーカイブにまとめてから
# gzipする方式にしている——既存のstore_and_prune.shはDBダンプ専用のまま変更しない
# (無関係な変更で動作実績のあるスクリプトを壊さないため)。世代管理の考え方(daily 7日/
# weekly 4週/monthly 3か月)自体はDBバックアップと完全に同じにする。
set -euo pipefail

SOURCE_DIR="${1:?Usage: store_and_prune_storage.sh <source-files-dir> <backup-repo-dir> <bucket-name>}"
REPO_DIR="${2:?Usage: store_and_prune_storage.sh <source-files-dir> <backup-repo-dir> <bucket-name>}"
BUCKET="${3:?Usage: store_and_prune_storage.sh <source-files-dir> <backup-repo-dir> <bucket-name>}"

BASE_DIR="$REPO_DIR/storage/$BUCKET"

DATE_TAG="$(date -u +%Y-%m-%d)"
DOW="$(date -u +%u)"   # 1=Mon .. 7=Sun
DOM="$(date -u +%d)"
WEEK_TAG="$(date -u +%Y-W%V)"
MONTH_TAG="$(date -u +%Y-%m)"

copy_generation() {
  local kind="$1" tag="$2"
  local dest_dir="$BASE_DIR/$kind"
  mkdir -p "$dest_dir"
  # tar自体はアーカイブ化のみ(圧縮なし)、gzipで圧縮する(標準的なgzip形式のみ使用)。
  # SOURCE_DIRが空(ファイル0件)でもtarは空アーカイブを正常に作れるため、失敗にはならない。
  tar -C "$SOURCE_DIR" -cf - . | gzip -9 > "$dest_dir/$tag.tar.gz"
  echo "[store-storage] wrote $kind/$tag.tar.gz"
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
  local dir="$BASE_DIR/$kind"
  [ -d "$dir" ] || return 0
  local all_files=()
  while IFS= read -r line; do
    all_files+=("$line")
  done < <(find "$dir" -mindepth 1 -maxdepth 1 -type f -name '*.tar.gz' | sort)
  local total="${#all_files[@]}"
  if [ "$total" -le "$keep_count" ]; then
    return 0
  fi
  local delete_count=$((total - keep_count))
  echo "[prune-storage] removing $delete_count old $kind generation(s):"
  local i
  for ((i = 0; i < delete_count; i++)); do
    echo "  ${all_files[$i]}"
    rm -f "${all_files[$i]}"
  done
}

prune daily 7
prune weekly 4
prune monthly 3

echo "[store-storage] done. current size:"
du -sh "$BASE_DIR" 2>/dev/null || true
