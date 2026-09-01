#!/usr/bin/env bash
# Vercelの「Ignored Build Step」(vercel.json の ignoreCommand)から呼ばれるスクリプト。
#
# GitHub Branch Protectionがprivateリポジトリ+無料プランでは「Not enforced」
# (実際には強制されない)ため、mainへ直接pushされてしまった場合でも、
# **Vercel自身がその内容を実際にビルド・本番反映しない**という、もう一段深い安全網。
#
# 直近のコミットメッセージに、末尾トレーラー行として
#   Deploy-Approved-By: npm-run-deploy-production
# という行が完全一致で無い限り、ビルドそのものを丸ごとスキップする。
# (この機能を単に文章で説明しているだけのコミット――たとえばこのスクリプト自身を追加した
#  コミット――で誤って反応しないよう、部分一致ではなく行全体の完全一致にしている。
#  実際に検証中、`[production-deploy]`という文字列をブラケット付きの説明文として
#  コミットメッセージの本文に書いただけで誤反応することが分かったため、この形式に変更した)
#
# このトレーラーは scripts/deploy/deploy-production.sh が確認プロンプト通過後にだけ
# 付与する(空コミットとして追加してからpushする)ため、正規の手順を通らない限り
# Vercel側でも本番反映が起きない。
#
# 重要: これはGitHub連携経由の自動ビルド(git push契機)にのみ適用される。
# npm run deploy:staging が使う `vercel --prod` のCLI直接デプロイには影響しない
# (ignoreCommandはgit連携ビルドの仕組みのため)。
#
# Vercelの仕様: このスクリプトが exit 0 で終了するとビルドをスキップする。
#              0以外の終了コードなら通常通りビルドを続行する。
set -uo pipefail

COMMIT_MESSAGE="$(git log -1 --pretty=%B 2>/dev/null || echo '')"

# 行全体の完全一致のみ許可(部分一致だと、この仕組みを説明しているだけの文章にも
# 誤反応してしまうため)。
if echo "$COMMIT_MESSAGE" | grep -qE '^Deploy-Approved-By: npm-run-deploy-production$'; then
  echo "[ignore-build] Deploy-Approved-By トレーラーを検出しました → ビルドを続行します"
  exit 1
fi

echo "[ignore-build] Deploy-Approved-By トレーラーが見つかりません → このビルドはスキップします"
echo "[ignore-build] (npm run deploy:production を経由したデプロイのみビルドされます)"
exit 0
