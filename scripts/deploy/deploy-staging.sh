#!/usr/bin/env bash
# [ステージング] salon-management-staging Vercelプロジェクトへ、今のブランチの内容を
# デプロイする。本番プロジェクト(salon-management)・本番Supabaseには一切触れない。
#
# git worktreeで完全に別ディレクトリを使うことで、メインディレクトリの
# .vercel/project.json(本番リンク)を誤って書き換えるリスクを構造的に排除している
# (過去に rsync でディレクトリを複製した際、.vercel を巻き込んで本番リンクが
# 誤って上書きされた事故があったため、rsyncではなく必ずgit worktreeを使う)。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKTREE_DIR="$(dirname "$REPO_ROOT")/salon-management-staging-worktree"
STAGING_PROJECT="salon-management-staging"

echo "=================================================="
echo " [ステージング] salon-management-staging へデプロイします"
echo " (本番 salon-manager.net には触れません)"
echo "=================================================="

cd "$REPO_ROOT"
CURRENT_REF="$(git rev-parse HEAD)"
echo "対象コミット: $(git log -1 --oneline)"

if [ ! -d "$WORKTREE_DIR" ]; then
  echo "worktreeを新規作成します: $WORKTREE_DIR"
  git worktree add --detach "$WORKTREE_DIR" "$CURRENT_REF"
else
  echo "既存worktreeを最新コミットへ更新します: $WORKTREE_DIR"
  git -C "$WORKTREE_DIR" fetch "$REPO_ROOT" "$CURRENT_REF"
  git -C "$WORKTREE_DIR" checkout --detach "$CURRENT_REF"
fi

cd "$WORKTREE_DIR"

if ! grep -q "\"projectName\":\"${STAGING_PROJECT}\"" .vercel/project.json 2>/dev/null; then
  echo "Vercelプロジェクトをステージングへリンクします..."
  vercel link -y --project "$STAGING_PROJECT"
fi

# 安全確認(最終防波堤): このworktreeが本当にステージング以外へリンクされていたら中断する。
if ! grep -q "\"projectName\":\"${STAGING_PROJECT}\"" .vercel/project.json 2>/dev/null; then
  echo "❌ エラー: .vercel/project.json がステージング(${STAGING_PROJECT})以外にリンクされています。中断します。" >&2
  cat .vercel/project.json >&2
  exit 1
fi

echo "依存関係をインストールします..."
npm install --no-audit --no-fund >/dev/null

echo "デプロイします..."
vercel --prod --yes --force

echo
echo "✅ 完了しました。 https://salon-management-staging.vercel.app を実機で確認してください。"
