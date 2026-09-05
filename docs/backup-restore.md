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

**循環外部キー(companies ⇔ profiles)について**: `companies`と`profiles`の間には循環する
外部キー制約がある(`profiles.company_id → companies.id`、`companies`側の一部カラムが
`profiles.id`を参照)。dump時にpg_dumpが`circular foreign-key constraints`という警告を出すが、
これは正常・想定内で、dump自体は問題なく完了する(警告はダンプ失敗の判定には一切使っていない)。
**ただし復元時は要注意**: `data.sql`を素朴に上から順に`COPY`していくと、どちらのテーブルを
先に入れても相手側の未挿入行を参照するタイミングが発生し、外部キー制約違反になることがある。
復元時は`data.sql`を流す**前**に、そのセッションだけ外部キー制約(トリガー経由で実装されている)
を一時的に無効化すること:
```sql
SET session_replication_role = replica;  -- data.sql流し込みの直前に実行
-- ここで data.sql を実行(psql -f data.sql 等)
SET session_replication_role = DEFAULT;  -- 完了後に必ず戻す
```
(`pg_restore --disable-triggers`と同じ効果を、プレーンSQLの`psql`実行でも得るための操作。
スーパーユーザー権限が必要 — Supabaseのpostgresロールでは通常問題ない。)

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
   `companies`⇔`profiles`間の循環外部キー(上記「循環外部キーについて」参照)により、
   `data.sql`をそのまま流すと外部キー制約違反になることがあるため、**必ずトリガーを一時的に
   無効化してから**実行する:
   ```sql
   SET session_replication_role = replica;
   ```
   - **新規の空DBへの復元の場合**: そのまま実行してよい。
     ```bash
     psql "$RESTORE_TARGET_URL" -v ON_ERROR_STOP=1 -c "SET session_replication_role = replica;" -f data.sql -c "SET session_replication_role = DEFAULT;"
     ```
   - **既にデータが入っている本番DBへ「特定テーブルだけ」戻す場合**: `data.sql`を丸ごと流すと
     主キー重複エラーになる。対象テーブルだけ`TRUNCATE ... CASCADE`してから、そのテーブルの
     `COPY`ブロックだけを抽出して流す(全テーブルを一括で戻すのは事故のリスクが高いため、
     原則として影響範囲を最小限にする)。この場合も`session_replication_role = replica`を
     忘れずに設定し、完了後は`DEFAULT`へ戻すこと。

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

---

## 5. 運用ルール(再発防止、2026-09-05の障害を受けて追記)

### 5-1. SupabaseのDatabase passwordを変更・リセットした場合

- **GitHub Actionsの`SUPABASE_DB_URL`も必ず同時に更新すること。** Supabase側でパスワードだけを
  変更しても、GitHub Secrets側は自動的には追従しない——放置すると次回のバックアップから
  `password authentication failed`で失敗し続ける(下記「6. 過去の障害事例」参照)。
- **パスワード単体ではなく、正しい接続URL全体を保存すること。** `postgresql://postgres.<project-ref>:<パスワード>@aws-0-<region>.pooler.supabase.com:5432/postgres`
  のような完全な接続文字列(Session pooler、port 5432)をそのまま`SUPABASE_DB_URL`へ設定する
  — パスワード部分だけを差し替えた断片を保存しない。

### 5-2. 更新先のGitHubリポジトリ(重要・取り違え注意)

- 正しいリポジトリは **`ma2hiro1127-web/-salon-management`**(先頭にハイフンが付く)。
- このアカウントには**ハイフンなしの`salon-management`という別リポジトリ(private)も存在する**
  ため、検索・自動補完で誤って開きやすい。**取り違えないこと。**
- 心配な場合は、リポジトリ直下で`git remote -v`を実行し、表示されたURLと同じリポジトリで
  Secretsを設定しているか確認する。

### 5-3. GitHubでの更新場所

```
Settings
→ Secrets and variables
→ Actions
→ Repository secrets
→ SUPABASE_DB_URL
→ Update secret
```

### 5-4. 更新後の確認手順

1. `SUPABASE_DB_URL`の **Last updated** が更新されたことを確認する
2. GitHub Actionsの **Database Backup** ワークフローを手動実行(Run workflow)する
3. 全ステップが **Success** になることを確認する
4. バックアップ用private リポジトリ(`BACKUP_REPO`)の`daily/<当日の日付>/`に、
   `roles.sql.gz` / `schema.sql.gz` / `data.sql.gz` の3ファイルが実際に生成されていることを
   確認する(存在確認だけでなく、サイズが0バイトでないことも見る)

### 5-5. 障害時の確認順序

1. まず`password authentication failed`が出ていないか確認する——出ていれば
   `SUPABASE_DB_URL`の**パスワードが古い**ことを最初に疑う(上記5-1)。
2. ワークフローの「Show connection info (safe, no password)」ステップのログで、
   接続先ホスト名・ポート・ユーザー名・DB名が意図した値かを診断する
   (**パスワードの値そのものはこのログにも一切出力されない** — 長さのみ表示)。
3. Secretの更新先リポジトリが正しいか(上記5-2)を確認する。
4. 上記のいずれにも該当しない場合のみ、Supabase CLIのバージョン・pg_dump互換性・
   ネットワーク到達性(Session pooler経由か等)を疑う。

### 5-6. 現在の正常仕様(変更しないこと)

- 毎日04:00 JST(cron `0 19 * * *`)に自動バックアップを実行する
- Supabase CLIのバージョンは動作確認済みバージョンに固定する(現在: 2.111.0。`latest`には
  戻さない — 詳細は`.github/workflows/db-backup.yml`のコメント参照)
- 失敗時はGitHubの標準通知(ワークフロー失敗メール)がそのまま届く仕様を維持する
- daily 7日 / weekly 4週 / monthly 3か月の世代管理・古い世代の自動削除(上記「4. 世代管理」)は
  継続する
- 上記以外の、現在正常稼働している既存のバックアップ処理・スクリプトには変更を加えない

---

## 6. 過去の障害事例

### 事例1: 2026-09-03〜09-05, `password authentication failed`によるバックアップ全滅

- **内容**: 2026-09-03・09-04の定期実行(毎日04:00 JST)が2日連続で失敗。GitHubから
  「Database Backup: All jobs have failed」の通知が届いた。
- **原因**: `SUPABASE_DB_URL`シークレットは2026-08-19から変更されておらず、9/2までは正常に
  動作していたが、その間にSupabase側のデータベースパスワードが変更されており、シークレットに
  保存された古いパスワードのままでは認証が通らなくなっていた。接続先ホスト・ポート・
  ユーザー名(project ref付きの正しい形式)自体は問題なかった。
- **復旧手順**:
  1. `gh run view --log-failed`で失敗ログを確認し、`pg_dumpall: FATAL: password authentication failed for user "postgres"`を特定
  2. ワークフローに「接続情報(パスワード以外)を安全に表示する診断ステップ」を追加し、
     ホスト・ポート・ユーザー名・DB名が正しいことを確認、パスワードのみが原因と切り分け
  3. Supabase Dashboard → Project Settings → Database → Connection string から
     現在の正しいSession pooler接続文字列を取得
  4. GitHub側`SUPABASE_DB_URL`シークレットを更新
     - 1回目の更新はハイフンなしの別リポジトリ(`ma2hiro1127-web/salon-management`)へ
       誤って保存してしまい、正しいリポジトリ(`-salon-management`)側は未更新のままだった
       ため、再度失敗を確認(上記「5-2」の注意点はこの実体験から追記した)
     - 正しいリポジトリで再更新し、Last updatedの変化を確認
  5. `gh workflow run "Database Backup" --ref main`で手動実行し、全ステップSuccessを確認
  6. バックアップ用リポジトリに`roles.sql.gz` / `schema.sql.gz` / `data.sql.gz`(37テーブル、
     約4.5MB)が実際に生成されていることを確認して完了
- **再発防止**: 本節「5. 運用ルール」を新設。あわせてCLIバージョンの固定と、パスワードを
  含まない接続情報の診断ログをワークフローに追加した。
