#!/usr/bin/env bash
# [本番] salon-manager.net (Vercelプロジェクト: salon-management) へ反映する。
#
# 安全のため、実行するたびに以下を必ず行う:
#   1. mainブランチであること・コミット漏れが無いことの確認
#   2. verify.sh (lint/test/build) が全て成功すること(失敗していたら反映不可)
#   3. 「本番へ反映します」の明示的な確認(yesと入力しないと止まる)
#   4. [production-deploy]マーカーを含む空コミットを追加する
#      (GitHub Branch Protectionがprivateリポジトリ+無料プランでは実際には強制されない
#       ため、Vercel側のIgnored Build Step(scripts/deploy/ignore-build.sh)がこの
#       マーカーの有無で「実際にビルドするかどうか」を判定する追加の安全網になっている)
#   5. ここまで通って初めて git push origin main を実行する
#      (実際のVercelへのデプロイは、既存のGitHub連携がpushをトリガーに行う。
#       このスクリプトは「うっかり本番反映」を防ぐための確認ゲート)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "=================================================="
echo " [本番] これは salon-manager.net の本番環境へ反映されます"
echo "=================================================="

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "❌ エラー: 本番反映は main ブランチから行ってください(現在のブランチ: $CURRENT_BRANCH)" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "❌ エラー: コミットされていない変更があります。先にコミットしてください。" >&2
  git status --short >&2
  exit 1
fi

echo "検証(lint / test / build)を実行します..."
bash "$REPO_ROOT/scripts/deploy/verify.sh"

echo
echo "検証OKです。以下のコミットを本番へ反映しようとしています:"
git log -1 --oneline
echo
read -r -p "本番(salon-manager.net)へ反映してよろしいですか? (yes と入力): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "中断しました。何も反映していません。"
  exit 1
fi

# Vercel側のIgnored Build Step(scripts/deploy/ignore-build.sh)が本番反映を許可する
# 合言葉を、空コミット(ファイル変更なし)として追加する。
git commit --allow-empty -m "chore: production deploy [production-deploy] $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ローカルのpre-pushフック(mainへの直接pushをブロックする安全網)を、
# この正規の手順でだけ通過させる。
ALLOW_MAIN_PUSH=1 git push origin main

echo
echo "✅ 本番へ反映しました。数分以内に https://salon-manager.net へ反映されます。"
echo "⚠️  public/sw.js の CACHE_NAME を今回の変更に合わせて上げ忘れていないか確認してください。"
