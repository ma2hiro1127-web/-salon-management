# DBバックアップ・復元手順

サロンマネージャー(Supabaseプロジェクト `mtjiauhliezbjjpqpvuj`)の自動バックアップと、緊急時の復元手順。

## この仕組みが守るもの・守らないもの

**守るもの**: 誤削除・バグによるデータ破損・誤ったSQL実行・大量誤更新など、`public`スキーマ
(companies/stores/profiles/daily_sales等、業務データを持つ全23テーブル)への意図しない変更。

**空のテーブルについて**: `data.sql`は行が1件も無い(空の)テーブルについてはCOPYブロック自体を
出力しない(テーブル名への言及自体が無くなる)。これは異常ではなく正常な挙動 — `run_backup.sh`
の検証は、テーブルの存在自体は毎回のダンプが作った`schema.sql`を基準に確認し、`data.sql`は
「行があるテーブルの一覧」としてのみ扱うため、空テーブルがあってもバックアップ失敗にはならない。

**守らないもの**: Supabaseプロジェクト自体の消失、Supabase Auth(`auth`スキーマ、
ログイン用のユーザー・パスワードハッシュ・セッション)、Supabase Storageのファイル本体、
Edge Functionsの実行環境、Supabase Secrets(環境変数)の値そのもの。詳細は
「4. DBバックアップに含まれないもの」を参照。

**保存先が2つある理由**: このバックアップは(a)プライベートリポジトリ`BACKUP_REPO`への
git push(daily 7日/weekly 4週/monthly 3か月のローテーション、主たる長期保存先)と、
(b)GitHub Actions Artifact(直近35日、同じrunがどちらも同じダンプから作る)の
2か所へ独立して保存される。(a)へのpushが何らかの理由(トークン期限切れ等)で失敗しても、
(b)はそのrunの中で先に完了しているため取りこぼさない、という冗長化が目的。日常的な復元は
どちらから行っても内容は同じ。

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

## 3. GitHub Actions Artifactの取得方法

主たる復元手順(上記「2. 復元手順」)は`BACKUP_REPO`のgit clone/pullを前提にしているが、
同じ内容がGitHub Actions Artifactとしても直近35日分保存されている。`BACKUP_REPO`への
アクセスに問題がある場合や、特定の1回の実行結果だけをすぐ確認したい場合はこちらを使う。

### Web UIから

1. `ma2hiro1127-web/-salon-management`リポジトリ → **Actions** タブ → **Database Backup** を開く
2. 取得したい実行日の run をクリックする
3. その run のページ下部 **Artifacts** に `db-backup-YYYY-MM-DD-runNNN` が表示されるのでクリックしてダウンロードする(zip 1つに `roles.sql.gz` / `schema.sql.gz` / `data.sql.gz` がまとまっている)

### GitHub CLI(`gh`)から

```bash
# 直近の実行一覧を見て run ID を確認する
gh run list --workflow="Database Backup" --limit 10

# 該当run IDのArtifactを、カレントディレクトリ配下へダウンロードする
gh run download <run-id> --repo ma2hiro1127-web/-salon-management
```

### 展開する

```bash
gunzip -k schema.sql.gz
gunzip -k data.sql.gz
gunzip -k roles.sql.gz
```

以降は「2. 復元手順」の手順4以降と同じ。

**保存期間**: 35日。それより古いものは`BACKUP_REPO`側(daily 7日はArtifactより短いが、
weekly 4週・monthly 3か月はより長く残る)を使う。

---

## 4. DBバックアップに含まれないもの

`public`スキーマのpg_dumpだけでは復旧できないものを整理する。「販売前」に必ず認識しておくこと。

| 対象 | このバックアップに含まれる? | 実際の保存場所・対処 |
|---|---|---|
| `public`スキーマのテーブル定義・データ・RLSポリシー・DB関数・Trigger・Enum・View | ✅ 含まれる | `schema.sql`(定義一式、RLSポリシー・関数・Trigger・Enum・Viewも`public`スキーマに属するものはすべて`pg_dump --schema public`の対象)、`data.sql`(実データ) |
| Supabase Auth(`auth.users`、パスワードハッシュ、セッション) | ❌ 含まれない | 意図的に対象外(理由は次章「5. Authとの整合性」)。同一プロジェクトへの`public`復元では実害なし。プロジェクト自体を作り直す場合はAuthユーザーの復元手段が無く、招待メールの再送が必要 |
| Supabase Storageのファイル本体(`support-attachments`等) | ❌ 含まれない | `storage.buckets`/`storage.objects`は`storage`スキーマに属し、かつファイルの実体(バイナリ)はPostgresの外(S3互換オブジェクトストレージ)にあるため、`pg_dump --schema public`には一切現れない。バケット定義(`support-attachments`がprivateであること等)自体は`supabase/migrations/20260911000000_support_inquiries.sql`にコードとして存在するため`supabase db push`で再作成できるが、**過去にアップロードされた添付ファイルの実体は今回のバックアップ対象外**。現状、問い合わせ添付ファイルは業務継続に必須のデータではないため今回のスコープ外としたが、重要度が上がった場合は別途`supabase storage`のダウンロードバックアップを検討すること |
| Edge Functionsのコード | ✅(このリポジトリ自体がバックアップ) | `supabase/functions/`配下としてこのGitリポジトリにすべてコミットされている。DBバックアップとは別に、**リポジトリ自体の復旧(GitHub上に存在する限り消えない、ローカルcloneでも可)がEdge Functionsのバックアップを兼ねる** |
| Supabase Secrets(環境変数の値) | ❌ 含まれない(意図的) | 値自体をバックアップへ含めることは禁止事項(漏洩リスク)。**名前の一覧**は「6. Secretsの再設定」を参照。値は各サービス(Stripeダッシュボード等)の管理画面、またはパスワードマネージャー等、このリポジトリの外で別途安全に管理すること |
| Supabaseプロジェクト自体(project ref、リージョン等のプロジェクト設定) | ❌ 含まれない | プロジェクトが消失した場合は新規作成が必要。`supabase/migrations/`を`supabase db push`で新プロジェクトへ適用すればスキーマ相当は再現できるが、project ref自体は変わるため、フロントエンド(`.env`相当の`VITE_SUPABASE_URL`等)・Edge Functionsの環境変数・GitHub ActionsのSecretsをすべて新project ref向けに更新し直す必要がある(このシナリオは今回のスコープ外の大規模障害対応) |

---

## 5. Authとの整合性(要件3への回答)

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

## 6. Secretsの再設定・Edge Functionsの再デプロイ(プロジェクト新規作成等の大規模復旧時)

**通常の復旧(同一Supabaseプロジェクトへ`public`スキーマだけ戻す)ではこの章は不要。**
プロジェクト自体を作り直す場合や、Edge Functionsの環境変数が失われた場合にのみ必要。

### 6-1. Supabase Secrets(Edge Functionsの環境変数)

値は**このリポジトリにもバックアップにも一切保存していない**(要件どおり)。名前の一覧だけ
ここに残す — 実際の値は各サービスのダッシュボード、またはチーム内で別途安全に管理している
記録(パスワードマネージャー等)から再取得すること。`supabase secrets list --project-ref <ref>`
で現在設定されている**名前の一覧**は確認できる(値は表示されない)。

| Secret名 | 再取得元 |
|---|---|
| `STRIPE_SECRET_KEY` | Stripeダッシュボード(本番/LIVEモード)→ 開発者 → APIキー |
| `STRIPE_WEBHOOK_SECRET` | Stripeダッシュボード → 開発者 → Webhook → 対象エンドポイント → 署名シークレット |
| `STRIPE_TEST_SECRET_KEY` / `STRIPE_TEST_WEBHOOK_SECRET` | Stripeダッシュボード(テストモード)の同じ画面 |
| `STRIPE_PRICE_BASE_MONTHLY` / `_YEARLY` / `STRIPE_PRICE_STORE_ADDON_MONTHLY` / `_YEARLY` | Stripeダッシュボード(LIVEモード)→ 商品カタログ → 対象Priceの ID |
| `STRIPE_TEST_PRICE_*`(4種、上と同じ組み合わせ) | Stripeダッシュボード(テストモード)の商品カタログ |
| `RESEND_API_KEY` | Resendダッシュボード → API Keys |
| `SUPPORT_FROM_EMAIL` | 運用ルールに従って設定する送信元アドレス(値そのものは機密ではない) |
| `SELF_SIGNUP_TEST_KEY` | 新規に安全なランダム文字列を生成して設定し直してよい(検証用バイパスキー、実質パスワード相当なので使い回さない) |
| `ANTHROPIC_API_KEY` | Anthropic Consoleダッシュボード → API Keys |
| `APP_URL` | 値そのものは機密ではない(例: `https://salon-manager.net`)。**末尾に改行を含めないこと**(過去に改行混入でCheckout URLが壊れた実例あり) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWKS` / `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` / `SUPABASE_DB_URL` | Supabaseが自動管理するプロジェクト固有の値(Project Settings → API / Database)。プロジェクトを作り直した場合はすべて新しい値になる |

設定場所: `supabase secrets set <NAME>=<VALUE> --project-ref <ref>`、またはSupabase
Dashboard → Edge Functions → Secrets。

### 6-2. Edge Functionsの再デプロイ

コードは本リポジトリの`supabase/functions/`配下にすべて存在する(Gitでバックアップ済み)。
プロジェクトを作り直した場合、または特定の関数だけロールバックしたい場合:

```bash
# 個別に1つデプロイ
supabase functions deploy <function-name> --project-ref <ref>

# supabase/functions/配下の全関数をまとめてデプロイ
for d in supabase/functions/*/; do
  fn="$(basename "$d")"
  supabase functions deploy "$fn" --project-ref <ref>
done
```

デプロイ後、Secrets(6-1)が正しく設定されていないと関数が500エラーになるため、Secrets設定 →
Edge Functions再デプロイの順で行う。

### 6-3. 復旧後の確認項目(まとめ)

このリポジトリを使った復旧作業がすべて終わったら、以下を順に確認する(「2. 復元手順」
9〜11と重複する項目も含め、最終チェックリストとして1か所にまとめたもの):

- [ ] `select count(*) from public.companies;` 等、主要テーブルの件数が復元前の把握値と一致する
- [ ] RLSが全テーブルで有効(`relrowsecurity = true`)
- [ ] `supabase migration list --linked` でmigration適用状況が`supabase/migrations/`と一致する
- [ ] ログインできる(既存ユーザーで実際に1件テストログイン)
- [ ] system_admin画面で会社一覧・店舗一覧が正しく表示される
- [ ] Stripe関連: Webhookエンドポイントの疎通(Stripeダッシュボード → Webhook → 最近のイベント配信が200を返しているか)
- [ ] Edge Functionsが最新コードでデプロイされている(`supabase functions list --project-ref <ref>`のバージョン番号を確認)
- [ ] 本番URLへ実際にアクセスし、トップページ・ログイン画面が正常に表示される

---

## 7. 世代管理

| 世代 | 保存期間 | 保存タイミング |
|---|---|---|
| daily | 直近7日 | 毎日 |
| weekly | 直近4週 | 毎週日曜 |
| monthly | 直近3か月 | 毎月1日 |

古い世代は`scripts/backup/store_and_prune.sh`が自動削除する。

---

## 8. 運用ルール(再発防止、2026-09-05の障害を受けて追記)

### 5-1. SupabaseのDatabase passwordを変更・リセットした場合

- **GitHub Actionsの`SUPABASE_DB_URL`も必ず同時に更新すること。** Supabase側でパスワードだけを
  変更しても、GitHub Secrets側は自動的には追従しない——放置すると次回のバックアップから
  `password authentication failed`で失敗し続ける(下記「9. 過去の障害事例」参照)。
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
- daily 7日 / weekly 4週 / monthly 3か月の世代管理・古い世代の自動削除(上記「7. 世代管理」)は
  継続する
- 上記以外の、現在正常稼働している既存のバックアップ処理・スクリプトには変更を加えない

---

## 9. 過去の障害事例

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
- **再発防止**: 本節「8. 運用ルール」を新設。あわせてCLIバージョンの固定と、パスワードを
  含まない接続情報の診断ログをワークフローに追加した。
