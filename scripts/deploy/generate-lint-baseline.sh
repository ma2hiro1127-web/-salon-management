#!/usr/bin/env bash
# lint-baseline.json を、現在のワーキングツリーのlint結果から明示的に再生成する。
# verify.sh はこのファイルに「無い」新規違反だけを失敗条件にするため、既存コードへ
# 手を入れてベースラインを増やしたい場合は、このスクリプトを実行してdiffをコミットに
# 含める(=何が新しく「許容」されたかがレビューで必ず見える形にする。verify.sh側で
# こっそり緩めることはできない設計)。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

BASELINE_FILE="$REPO_ROOT/scripts/deploy/lint-baseline.json"

echo "現在のlint結果からベースラインを再生成します..."
(npx eslint . -f json || true) | python3 -c "
import json, sys

data = json.load(sys.stdin)
entries = []
for file_result in data:
    path = file_result.get('filePath', '')
    for msg in file_result.get('messages', []):
        if msg.get('severity') != 2:
            continue
        entries.append([path, msg.get('ruleId') or '', msg.get('message', '')])

# 決定的な出力にするため整列
entries.sort()
print(json.dumps(entries, ensure_ascii=False, indent=2))
" > "$BASELINE_FILE"

COUNT="$(python3 -c "import json; print(len(json.load(open('$BASELINE_FILE'))))")"
echo "✅ ${COUNT}件のベースラインを $BASELINE_FILE に書き込みました。"
echo "   git diff で何が新しく許容されたかを必ず確認してからコミットしてください。"
