#!/usr/bin/env python3
"""verify.sh用: 現在のeslint結果と、コミット済みのlint-baseline.jsonを比較し、
ベースラインに無い(=新しく発生した)エラーだけを一覧出力する。

照合キーは (filePath, ruleId, message) — 行番号は含めない。App.jsx等の巨大な
単一ファイルではコード追加/移動のたびに既存の違反の行番号がずれるため、行番号を
キーに含めると「内容は同じ既存の違反」を毎回「新規」と誤判定してしまう。
"""
import json
import sys

baseline_path, lint_json_path = sys.argv[1], sys.argv[2]

try:
    with open(baseline_path) as f:
        baseline = set(tuple(x) for x in json.load(f))
except FileNotFoundError:
    baseline = set()

with open(lint_json_path) as f:
    raw = f.read()

try:
    data = json.loads(raw)
except Exception:
    print("__PARSE_ERROR__")
    sys.exit(0)

current = []
for file_result in data:
    path = file_result.get("filePath", "")
    for msg in file_result.get("messages", []):
        if msg.get("severity") != 2:
            continue
        current.append((path, msg.get("ruleId") or "", msg.get("message", ""), msg.get("line", 0)))

new_ones = [c for c in current if (c[0], c[1], c[2]) not in baseline]
for path, rule, message, line in new_ones:
    print(f"{path}:{line}  [{rule}]  {message}")
print(f"__COUNT__:{len(new_ones)}")
