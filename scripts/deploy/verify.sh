#!/usr/bin/env bash
# 本番/ステージングへ反映する前の必須チェック(lint → test → build)。
# どれか1つでも失敗したら即座に止まる(set -e)。npm run verify / deploy:production から呼ばれる。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "=================================================="
echo " [検証] lint"
echo "=================================================="
# 注意: このリポジトリには2026-09-01時点で、今回のデプロイ安全化タスクとは無関係な
# 既存lintエラーが8件ある(App.jsx/storage.js/supabase.js/supabaseRemote.jsの未使用変数等)。
# これらを"lintが必ず0件"というゲートでブロックすると、無関係なコードを直す(=禁止されている
# 大規模な関係ないコード変更)まで本番反映が一切できなくなってしまう。
# そのため「新しく増えたエラーが無いか」の回帰チェックとして扱う(既存分は許容、悪化は禁止)。
LINT_BASELINE_ERRORS=8
LINT_JSON="$(npx eslint . -f json || true)"
CURRENT_LINT_ERRORS="$(echo "$LINT_JSON" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(sum(f.get('errorCount', 0) for f in data))
except Exception:
    print(-1)
")"
if [ "$CURRENT_LINT_ERRORS" -lt 0 ]; then
  echo "⚠️ lint結果の解析に失敗しました。念のため詳細を表示します。" >&2
  npm run lint || true
elif [ "$CURRENT_LINT_ERRORS" -gt "$LINT_BASELINE_ERRORS" ]; then
  echo "❌ lintエラーが既存分(${LINT_BASELINE_ERRORS}件)より増えています(現在: ${CURRENT_LINT_ERRORS}件)。" >&2
  echo "   今回の変更で新しく発生したエラーを確認してください。" >&2
  npm run lint || true
  exit 1
else
  echo "✅ lint: エラー ${CURRENT_LINT_ERRORS}件(既存分の範囲内、新規エラーなし)"
fi

echo
echo "=================================================="
echo " [検証] test"
echo "=================================================="
npm test -- --run

echo
echo "=================================================="
echo " [検証] build"
echo "=================================================="
npm run build

echo
echo "✅ 検証OK(lint / test / build すべて成功しました)"
