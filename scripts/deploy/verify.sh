#!/usr/bin/env bash
# 本番/ステージングへ反映する前の必須チェック(lint → test → build)。
# どれか1つでも失敗したら即座に止まる(set -e)。npm run verify / deploy:production から呼ばれる。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "=================================================="
echo " [検証] lint"
echo "=================================================="
# 注意: このリポジトリには既存(今回の変更とは無関係)のlintエラーが一定数ある
# (App.jsx/storage.js/supabase.js/supabaseRemote.jsの未使用変数、および
# eslint-plugin-react-hooksの実験的ルール由来のもの等)。
#
# 2026-09-04: 単純な「件数」比較(以前の方式)は、App.jsx(10,000行超の単一コンポーネント)
# に対して1行変更しただけでもreact-hooksの実験的な全体解析結果が変わり、既存の(無関係な)
# パターンを新たに検出することがあると判明した——件数だけを見ていると、本物の新規バグと
# 「解析結果の揺れで既存コードが新たに検出されただけ」を区別できず、件数の上限を安易に
# 引き上げると本当に新しいバグを見逃すリスクがある。そのため、ファイルパス+ルールID+
# メッセージの組み合わせ(行番号は含めない——構造変化で行がずれても既存分として正しく
# 認識するため)でベースライン(lint-baseline.json)と照合し、「そこに無い新しい違反」だけを
# 失敗条件にする。ベースラインはgit管理下にあるため、意図的に既存コードへ手を入れて
# ベースラインを増やす場合は、scripts/deploy/generate-lint-baseline.sh で明示的に再生成し、
# その差分がレビューで見える形にする(こっそり緩めることはできない)。
BASELINE_FILE="$REPO_ROOT/scripts/deploy/lint-baseline.json"
LINT_JSON_FILE="$(mktemp)"
trap 'rm -f "$LINT_JSON_FILE"' EXIT
(npx eslint . -f json || true) > "$LINT_JSON_FILE"

NEW_VIOLATIONS="$(python3 "$REPO_ROOT/scripts/deploy/lint_diff.py" "$BASELINE_FILE" "$LINT_JSON_FILE")"

if echo "$NEW_VIOLATIONS" | grep -q "__PARSE_ERROR__"; then
  echo "⚠️ lint結果の解析に失敗しました。念のため詳細を表示します。" >&2
  npm run lint || true
  exit 1
fi

NEW_COUNT="$(echo "$NEW_VIOLATIONS" | grep "__COUNT__:" | sed 's/__COUNT__://')"
if [ "$NEW_COUNT" -gt 0 ]; then
  echo "❌ 既存ベースラインに無い新しいlintエラーが ${NEW_COUNT} 件見つかりました:" >&2
  echo "$NEW_VIOLATIONS" | grep -v "__COUNT__:" >&2
  exit 1
else
  echo "✅ lint: 新規エラーなし(既存ベースラインの範囲内)"
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
