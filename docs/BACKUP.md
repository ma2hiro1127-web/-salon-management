# Supabase バックアップ

## 現状（要対応）

このプロジェクトは `supabase backups list` で確認した結果、**自動バックアップ（PITR: Point-in-Time Recovery）が無効**です（無料/現行プランでは物理バックアップ機能自体が提供されません）。つまり、手動でバックアップを取得しない限り、誤操作やSupabase側の障害からデータを復元する手段がありません。

```bash
supabase backups list --project-ref <project-ref>
# => "pitr_enabled": false, "backups": []
```

以下のいずれか（できれば併用）を運用に組み込んでください。

---

## 方法1: データのみのJSONバックアップ（今すぐ使える・追加インストール不要）

`scripts/backup-supabase-data.mjs` を追加しました。このプロジェクトが依存する全テーブルの内容を丸ごとJSONとして書き出します。

### 実行方法

```bash
# service_role キーを取得（表示専用、環境変数に渡すだけで保存はしない）
supabase projects api-keys list --project-ref <project-ref> --output-format json

SUPABASE_SERVICE_ROLE_KEY=<service_role key> node scripts/backup-supabase-data.mjs
```

`backups/<タイムスタンプ>/` 配下にテーブルごとのJSON＋全体をまとめた `_all-tables.json` が出力されます。`backups/` は `.gitignore` 済みです（実データのためコミットしない）。

### 制限事項

- **データのみ**。スキーマ・RLSポリシー・トリガー・関数は含まれません（それらは `supabase/migrations/` にコードとして既に保存されているため、リポジトリ自体がスキーマのバックアップを兼ねています）。
- 復元は手動（テーブルごとに `upsert` し直す）。緊急時の「最後に読み込んだ全データを確認できる」ためのものであり、ワンコマンド復元ではありません。

### 復元方法（データが消えた場合の手当て）

```js
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
const supabase = createClient(url, serviceRoleKey);
const rows = JSON.parse(fs.readFileSync("backups/<timestamp>/daily_sales.json"));
await supabase.from("daily_sales").upsert(rows, { onConflict: "id" });
```

テーブルの依存順（外部キー制約）に注意: `companies` → `stores` → それ以外、の順で復元してください。

### 推奨頻度

日次売上を毎日締めているため、**最低でも週1回**、できれば日次で自動実行するのが望ましいです（cronやGitHub Actionsのscheduled workflowでこのスクリプトを実行し、出力をS3等の外部ストレージへアップロードする運用を推奨）。

---

## 方法2: `supabase db dump`（スキーマ+データの完全なSQLダンプ）

Supabase CLI標準のダンプ機能。スキーマ・RLS・関数・トリガーまで含めた完全なpg_dump形式のSQLを取得できます。

```bash
supabase db dump --linked -f backup.sql
```

**注意**: このマシンでは Docker Desktop が入っていないため実行できませんでした（`supabase db dump` はローカルでpg_dumpツールをDocker経由で動かす仕組みのため）。Docker Desktop をインストールした環境、またはCI（GitHub Actions等、Dockerが標準で使える環境）で実行してください。

復元は `supabase db push` またはリンクしたプロジェクトへ直接 `psql < backup.sql` で流し込めます。

---

## 方法3: 直接 `pg_dump`（Dockerなしで方法2相当のことをする場合）

```bash
brew install postgresql@17   # pg_dump / psql を取得
pg_dump "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" -f backup.sql
```

接続文字列はSupabaseダッシュボードの Project Settings > Database から取得してください（パスワードは環境変数等で安全に扱うこと。コマンド履歴に平文で残さない）。

---

## 方法4（本命・推奨）: Supabaseの有料プランでPITRを有効化

方法1〜3はすべて「手動で定期実行する」運用に依存しており、実行を忘れれば無意味になります。本番の売上データを扱う以上、最終的には **Supabase Proプラン以上にアップグレードしてPITR（継続的な自動バックアップ）を有効化する**ことを強く推奨します。有効化後は、誤ってデータを削除した場合でも任意の時点（分単位）まで即座にロールバックできます。

設定場所: Supabaseダッシュボード → Project Settings → Backups。

---

## まとめ

| 方法 | 自動化 | スキーマ含む | 追加インストール | 復元の手軽さ |
|---|---|---|---|---|
| ① JSONバックアップ（本リポジトリに追加済み） | 手動/cron次第 | ✗（migrationsが別途スキーマの正） | 不要 | 手動upsert |
| ② `supabase db dump` | 手動/CI次第 | ✓ | Docker | `psql`流し込み |
| ③ 直接 `pg_dump` | 手動/cron次第 | ✓ | postgresql-client | `psql`流し込み |
| ④ Supabase PITR | 完全自動 | ✓ | 不要（有料プラン） | ダッシュボードからワンクリック |

短期的には①を定期実行しつつ、中期的に④への移行を検討してください。
