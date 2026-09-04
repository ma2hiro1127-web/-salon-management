#!/usr/bin/env python3
"""verify.sh用: 現在のeslint結果と、コミット済みのlint-baseline.jsonを比較し、
ベースラインに無い(=新しく発生した)エラーだけを一覧出力する。

照合キーは (相対filePath, ruleId, message) — 行番号は含めない。App.jsx等の巨大な
単一ファイルではコード追加/移動のたびに既存の違反の行番号がずれるため、行番号を
キーに含めると「内容は同じ既存の違反」を毎回「新規」と誤判定してしまう。

パスは必ずリポジトリルートからの相対パスへ正規化する——eslintのJSON出力の
filePathは絶対パスであり、これをそのままベースラインへ保存すると、生成した
マシン(例: ローカルの/Users/...)と実行環境(例: CIランナーの/home/runner/...)
で絶対パスが一致せず、既存分が丸ごと「新規」と誤判定されてしまう
(2026-09-04、CIで実際にこの不具合が発生し発見)。
"""
import json
import os
import sys

baseline_path, lint_json_path, repo_root = sys.argv[1], sys.argv[2], sys.argv[3]


def to_relative(path):
    try:
        return os.path.relpath(path, repo_root)
    except ValueError:
        return path

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
    path = to_relative(file_result.get("filePath", ""))
    for msg in file_result.get("messages", []):
        if msg.get("severity") != 2:
            continue
        current.append((path, msg.get("ruleId") or "", msg.get("message", ""), msg.get("line", 0)))

new_ones = [c for c in current if (c[0], c[1], c[2]) not in baseline]
for path, rule, message, line in new_ones:
    print(f"{path}:{line}  [{rule}]  {message}")
print(f"__COUNT__:{len(new_ones)}")
