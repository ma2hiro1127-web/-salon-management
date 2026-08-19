# DBバックアップ・復元手順

サロンマネージャー(Supabaseプロジェクト `mtjiauhliezbjjpqpvuj`)の自動バックアップと、緊急時の復元手順。

## この仕組みが守るもの・守らないもの

**守るもの**: 誤削除・バグによるデータ破損・誤ったSQL実行・大量誤更新など、`public`スキーマ
(companies/stores/profiles/daily_sales等、業務データを持つ全23テーブル)への意図しない変更。

**空のテーブルについて**: `data.sql`は行が1件も無い(空の)テーブルについてはCOPYブロック自体を
出力しない(テーブル名への言及自体が無くなる)。これは異常ではなく正常な挙動 — `run_backup.sh`
の検証は、テーブルの存在自体は毎回のダンプが作った`schema.sql`を基準に確認し、`data.sql`は
「行があるテーブルの一覧」としてのみ扱うため、空テーブルがあってもバックアップ失敗にはならない。

**守らないもの**: Supabaseプロジェクト自体の消失、およびSupabase Auth(`auth`スキーマ、
ログイン用のユーザー・パスワードハッシュ・セッション)。理由と対処は「Authとの整合性」の章を参照。

---

## 1. 初回セットアップ(手動で1回だけ必要)

### 1-1. バックアップ保存用の privateリポジトリを作成

GitHub上で新しい**プライベート**リポジトリを作成する(例: `salon-management-backups`)。
**publicにしないこと** — バックアップには売上・顧客数・会社情報等の実データが含まれるため、
公開リポジトリに置くと情報漏洩になる。README等、最低1コミットしてから空でない状態にしておく
(空リポジトリだと最初のpushで挙動が変わる場合があるため)。

### 1-2. そのリポジトリへ書き込めるPersonal Access Tokenを発行

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens で、
**1-1で作ったバックアップ用リポジトリだけ**を対象に、Contents: Read and write 権限を持つ
トークンを発行する(必要以上に強い権限を持つトークンを作らないこと)。

### 1-3. サロンマネージャー本体のリポジトリへ Secrets / Variables を設定

`ma2hiro1127-web/-salon-management` → Settings → Secrets and variables → Actions で、以下を設定する。

| 種別 | 名前 | 値 |
|---|---|---|
| Secret | `SUPABASE_DB_URL` | Supabaseダッシュボード → Project Settings → Database → Connection string → **URI**タブに表示される接続文字列。`[YOUR-PASSWORD]`部分を実際のDBパスワードへ置き換える(**Session pooler**の接続文字列を推奨 — port 5432、`pgbouncer`非対応の完全なSQL機能が必要なため、Transaction poolerは不可)。 |
| Secret | `BACKUP_REPO_TOKEN` | 1-2で発行したトークン |
| Variable | `BACKUP_REPO` | `<あなたのGitHubユーザー名>/salon-management-backups`(1-1で作ったリポジトリ名) |

**これら3つはコード中に一切書き込まない。** `SUPABASE_DB_URL`にはDBパスワードそのものが
含まれるため、特に慎重に扱うこと(Secretsに保存されたあとはGitHub上でも再表示不可)。

### 1-4. 動作確認

Actions タブ → 「Database Backup」ワークフロー → 「Run workflow」で手動実行し、成功することを
確認する。成功すると、バックアップリポジトリに `daily/YYYY-MM-DD/` ディレクトリが作成され、
`roles.sql.gz` / `schema.sql.gz` / `data.sql.gz` の3ファイルが入る。

---

## 2. 復元手順

### 大原則

- **本番DBへ直接復元しない。** まず別のDB(新規Supabaseプロジェクトの無料枠、またはローカルの
  一時Postgres)へ復元し、内容を確認してから、必要な分だけ本番へ反映する。
- **復元前に、その時点の本番DBも追加でバックアップを取る**(ワークフローを手動実行するか、
  `supabase db dump --linked -f pre-restore-backup.sql --schema public --data-only --use-copy`)。
  「復元してみたら実は逆に古いデータで上書きしてしまった」を後から取り消せるようにするため。

### 手順

1. **復元対象のバックアップを選ぶ**
   バックアップリポジトリの `daily/` `weekly/` `monthly/` から、復元したい日付のディレクトリを選ぶ。

2. **復元前に現在の本番DBを追加バックアップする**(上記「大原則」参照)。

3. **復元先を確認する**
   これから実行するコマンドの接続先が「新しく作った空のテスト用DB」であって、本番URLでは
   ないことを、コマンドを実行する直前に必ず目視で再確認する。

4. **ファイルを展開する**
   ```bash
   gunzip -k daily/2026-08-19/schema.sql.gz
   gunzip -k daily/2026-08-19/data.sql.gz
   ```

5. **スキーマを復元する**(スキーマがまだ無い、まっさらな復元先の場合のみ必要。既に
   `supabase db push`でマイグレーション適用済みのDBへ復元する場合はこの手順は不要 — 6を参照)
   ```bash
   psql "$RESTORE_TARGET_URL" -f schema.sql
   ```
   **`schema public already exists` という1行のエラーは正常・想定内。**
   Postgres/SupabaseのDBには`public`スキーマが最初から存在するため、`CREATE SCHEMA public;`の
   行だけは必ずエラーになる(実害なし)。このコマンドは`-v ON_ERROR_STOP=1`を付けずに実行し、
   このエラーだけで停止しないようにすること。実行後、テーブル数が23個作成されていることを
   確認する:
   ```sql
   select count(*) from information_schema.tables where table_schema='public';
   -- 23 になっていればOK
   ```

6. **データを復元する**
   - **新規の空DBへの復元の場合**: そのまま実行してよい。
     ```bash
     psql "$RESTORE_TARGET_URL" -v ON_ERROR_STOP=1 -f data.sql
     ```
   - **既にデータが入っている本番DBへ「特定テーブルだけ」戻す場合**: `data.sql`を丸ごと流すと
     主キー重複エラーになる。対象テーブルだけ`TRUNCATE ... CASCADE`してから、そのテーブルの
     `COPY`ブロックだけを抽出して流す(全テーブルを一括で戻すのは事故のリスクが高いため、
     原則として影響範囲を最小限にする)。

7. **migration状態を確認する**
   本番相当のDBへ復元した場合、`supabase migration list --linked`で、リポジトリの
   `supabase/migrations/`と実DBの適用履歴が一致しているか確認する。ズレていれば
   `supabase db push --linked`で追いつかせる。

8. **RLSを確認する**
   `select tablename, relrowsecurity from pg_class join pg_tables on tablename=relname where schemaname='public';`
   相当のクエリで、全テーブルのRLSが有効(true)になっていることを確認する。データのみの
   復元(`data.sql`だけを流した場合)ではRLSポリシー自体は変更されないはずだが、まっさらな
   DBへ`schema.sql`から復元した場合は、RLSポリシーはmigrationで作られるものなので、
   `supabase db push --linked`を必ず実行してから確認すること。

9. **Authとの紐付けを確認する**
   `select id, auth_user_id, company_id, role from public.profiles;`を実行し、
   `auth_user_id`がSupabase Auth側の実在ユーザーと対応しているか確認する(下記
   「Authとの整合性」参照)。**同じSupabaseプロジェクトへ`data.sql`だけを復元する分には、
   Auth側は一切変更されないため、このステップは通常「変化なし」を確認するだけでよい。**

10. **company / store / user を確認する**
    `select count(*) from public.companies;` `select count(*) from public.stores;`
    `select count(*) from public.profiles;` で、復元前に把握していた件数と一致するか確認する。

11. **売上等の主要データを確認する**
    直近の`daily_sales`/`daily_batch_entries`等、実際に画面で見て違和感のあった期間のデータを
    抜き出して確認する。

---

## 3. Authとの整合性(要件3への回答)

- 今回のバックアップは`public`スキーマのみを対象にしており、Supabase Auth本体(`auth`スキーマ
  — ログインID・パスワードハッシュ・セッション)は**意図的に対象外**にしている。
  - 理由1: `auth`スキーマには**パスワードハッシュ等の機微情報**が含まれ、バックアップファイル
    自体の取り扱いリスクが跳ね上がる(要件7「バックアップファイルにも不要な秘密情報を含めない」
    に反する)。
  - 理由2: `public.profiles.auth_user_id`は`auth.users.id`への**外部キー制約を持たない設計**
    (このアプリのDB設計として既に確認済み)。つまり、`public`スキーマだけを復元しても、
    「存在しないauth_user_idを参照してエラーになる」ことは起きない。
- **同じSupabaseプロジェクトへ`public`スキーマだけ復元するケース**(今回のバックアップが
  想定している主なシナリオ = 誤操作・バグ・誤SQLからの復旧)では、Auth側は一切触っていない
  ため、**ユーザーのログイン・権限は復元前後で完全に維持される**。
- **「Supabaseプロジェクト自体が消えた」場合**(新しいプロジェクトを作り直す必要がある場合)は、
  今回のバックアップだけでは**Authユーザーを復元できない**。全ユーザーへ再度招待メールを
  送り直す形になる。この対応は今回のスコープ外であり、別途「Supabaseプロジェクト自体の
  障害対策」として検討が必要。

---

## 4. 世代管理

| 世代 | 保存期間 | 保存タイミング |
|---|---|---|
| daily | 直近7日 | 毎日 |
| weekly | 直近4週 | 毎週日曜 |
| monthly | 直近3か月 | 毎月1日 |

古い世代は`scripts/backup/store_and_prune.sh`が自動削除する。
