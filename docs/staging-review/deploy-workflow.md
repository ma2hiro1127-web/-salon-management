# ステージング → 本番 反映フロー

このドキュメントは、開発・修正をステージングで確認してから本番へ反映するための運用手順です。
2026-09-01のデプロイ安全化対応で内容を更新しました(最新の運用は
[`docs/deploy-safety.md`](../deploy-safety.md)も参照してください)。

## ブランチとデプロイ先の対応

| ブランチ | デプロイ先 | Vercelプロジェクト | Supabaseプロジェクト |
| --- | --- | --- | --- |
| `main` | 本番 (`https://salon-manager.net`) | `salon-management` | `mtjiauhliezbjjpqpvuj`(本番) |
| `staging` | ステージング (`https://salon-management-staging.vercel.app`) | `salon-management-staging` | `orexflqvvukmujjroyhl`(ステージング) |

`main`ブランチへのpushで本番Vercelが自動デプロイされる設定は、今回**変更していません**
(既存の設定のまま)。ただし2026-09-01の対応で、このリスクに対して以下の安全網を追加しました。

- `npm run verify` / `npm run deploy:staging` / `npm run deploy:production` という
  安全なコマンドを整備(詳細は[`docs/deploy-safety.md`](../deploy-safety.md))。
- `main`への直接pushをこの開発環境限定でブロックするgit pre-pushフックを設置。
- push/PR毎にlint・test・buildを自動実行するGitHub Actions CI
  (`.github/workflows/ci.yml`)を新設。

> **`staging`VercelプロジェクトのGit連携について(現状)**: `salon-management-staging`
> プロジェクトはGitHubリポジトリとは連携していません。2026-09-01時点でVercel APIから
> 連携の作成自体は成功しましたが、「Production Branch」を`main`以外(`staging`)に
> 変更する操作だけがAPI経由でどうしても出来ませんでした(前回セッションと同じ制約)。
> `main`のままだと`main`へのpush毎にこのステージングプロジェクトも(実害は無いが)
> 無駄に再ビルドされてしまうため、今回は連携を作成せず`None`のままにしています。
> ステージングへの反映は`npm run deploy:staging`(git worktree + `vercel --prod`を
> 内部でラップ済み)で行ってください。GitHub連携でのpush自動反映を有効にしたい場合は、
> Vercelダッシュボード → `salon-management-staging`プロジェクト → Settings → Git →
> 「Connect Git Repository」→ 対象リポジトリを選択 → 「Production Branch」を
> `staging`に設定、の手順で今も設定可能です(ダッシュボードからは可能な操作です)。

## 基本的な開発フロー(2026-09-01時点の推奨)

```
1. 開発・修正(Claude Codeで実施、mainブランチ上で作業)
        ↓
2. npm run deploy:staging でステージング環境へ反映
        ↓
3. ステージングURL(https://salon-management-staging.vercel.app)で実機確認
        ↓
4. npm run deploy:production で本番へ反映(確認プロンプトあり)
```

### ステージングへの反映
```bash
npm run deploy:staging
```
内部で git worktree を使い、メインディレクトリの`.vercel`(本番リンク)には一切触れずに
`salon-management-staging`プロジェクトへデプロイします。

### 本番への反映(ステージングで確認が取れた後)
```bash
npm run deploy:production
```
`verify`(lint/test/build)が失敗している状態では実行できません。「salon-manager.netの
本番環境へ反映されます」という確認が出るので、`yes`と入力した場合のみ本番へpushされます。

## アプリコード・DBスキーマ・ダミーデータ・Secretsの扱い

- **アプリコード**: ステージングで確認・承認された変更のみ`main`へマージして本番反映する。
- **DBスキーマ**: `supabase/migrations/`配下のファイルとして管理する既存方針のまま。
  新しいマイグレーションはまずステージング(`orexflqvvukmujjroyhl`)へ適用して検証し、
  問題なければ本番(`mtjiauhliezbjjpqpvuj`)へ同じファイルを適用する。
  **破壊的なmigration(DROP・大量UPDATE/DELETE等)は自動実行せず、必ず事前にユーザーへ
  提案し明示承認を得てから実行する。**
  ```bash
  # ステージングへ適用(例)
  supabase db push --db-url "<ステージングの接続文字列>" --include-all

  # 検証後、本番へ適用(例。実行前に必ず内容を確認すること)
  supabase link --project-ref mtjiauhliezbjjpqpvuj
  supabase db push
  ```
- **ダミーデータ**: ステージングのダミーデータ(テスト会社・テスト店舗・テストアカウント等)は
  本番へは一切コピーしない。本番への適用はスキーマ(マイグレーション)のみ。
- **Secrets・環境変数**: 本番とステージングで完全に別の値を使用する。本番のSecrets
  (`ANTHROPIC_API_KEY`等)をステージングへ流用しない方針を継続する(現状、ステージングでは
  `ANTHROPIC_API_KEY`を未設定のままにしており、AI機能は動作しない)。
  2026-09-01の対応で、本番Vercelプロジェクトに残っていた未使用の`ANTHRONIC_API_KEY`
  (スペルミスされた変数名、フロントエンドから一切参照されていない残骸)を削除済み。

## レビュー終了時のクリーンアップ(環境自体は削除しない)

外部エンジニアのレビューが終わったら、以下だけを行う。**ステージング環境そのもの
(Supabase/Vercelプロジェクト)は削除せず、今後の開発に継続利用する。**

1. GitHubリポジトリのCollaborator設定から外部エンジニアを削除
2. レビュー用テストアカウント(company_admin/store_manager/staff、必要に応じてsystem_admin)を
   Supabaseダッシュボード(Authentication)から無効化または削除
3. `SELF_SIGNUP_TEST_KEY`をローテーション(念のため、次回の利用に備えて新しい値へ変更)
