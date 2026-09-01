#!/usr/bin/env bash
# Vercelの「Ignored Build Step」(vercel.json の ignoreCommand)から呼ばれるスクリプト。
#
# GitHub Branch Protectionがprivateリポジトリ+無料プランでは「Not enforced」
# (実際には強制されない)ため、mainへ直接pushされてしまった場合でも、
# **Vercel自身がその内容を実際にビルド・本番反映しない**という、もう一段深い安全網。
#
# 直近のコミットメッセージに [production-deploy] という合言葉が含まれていない限り、
# ビルドそのものを丸ごとスキップする。この合言葉は scripts/deploy/deploy-production.sh が
# 確認プロンプト通過後にだけ付与する(空コミットとして追加してからpushする)ため、
# 正規の手順を通らない限りVercel側でも本番反映が起きない。
#
# 重要: これはGitHub連携経由の自動ビルド(git push契機)にのみ適用される。
# npm run deploy:staging が使う `vercel --prod` のCLI直接デプロイには影響しない
# (ignoreCommandはgit連携ビルドの仕組みのため)。
#
# Vercelの仕様: このスクリプトが exit 0 で終了するとビルドをスキップする。
#              0以外の終了コードなら通常通りビルドを続行する。
set -uo pipefail

COMMIT_MESSAGE="$(git log -1 --pretty=%B 2>/dev/null || echo '')"

if echo "$COMMIT_MESSAGE" | grep -qF "[production-deploy]"; then
  echo "[ignore-build] '[production-deploy]' マーカーを検出しました → ビルドを続行します"
  exit 1
fi

echo "[ignore-build] '[production-deploy]' マーカーが見つかりません → このビルドはスキップします"
echo "[ignore-build] (npm run deploy:production を経由したデプロイのみビルドされます)"
exit 0
