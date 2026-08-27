# ステージング → 本番 反映フロー

このドキュメントは、開発・修正をステージングで確認してから本番へ反映するための運用手順です。

## ブランチとデプロイ先の対応

| ブランチ | デプロイ先 | Vercelプロジェクト | Supabaseプロジェクト |
| --- | --- | --- | --- |
| `main` | 本番 (`https://salon-manager.net`) | `salon-management` | `mtjiauhliezbjjpqpvuj`(本番) |
| `staging` | ステージング (`https://salon-management-staging.vercel.app`) | `salon-management-staging` | `orexflqvvukmujjroyhl`(ステージング) |

`main`ブランチへのpushで本番Vercelが自動デプロイされる設定は、今回**変更していません**
(既存の設定のまま)。`staging`ブランチは今回新設し、ステージングVercelプロジェクトと
GitHub連携済みです。

> **重要(現状の制約)**: `staging`ブランチをpushした際にステージングVercelプロジェクトが
> 自動デプロイされるようにするには、Vercelダッシュボードで1回だけ手動設定が必要です
> (Vercel APIから変更できなかったため)。設定方法:
> Vercelダッシュボード → `salon-management-staging`プロジェクト → Settings → Git →
> 「Production Branch」を `main` から `staging` に変更。この設定を行うまでは、
> ステージングへの反映は下記の「手動デプロイ」コマンドで行ってください(今回はこの方法で
> 動作確認済みです)。

## 基本的な開発フロー

```
1. 開発・修正(mainまたは作業ブランチ)
        ↓
2. staging ブランチへ反映 → ステージング環境で確認
        ↓
3. 問題なければ main ブランチへ反映 → 本番へ反映
```

### ステージングへの反映
```bash
git checkout staging
git merge main   # または該当のコミットを取り込む
git push origin staging
```
上記のVercel設定が未完了の場合は、手動デプロイで代替できます:
```bash
# salon-management-staging プロジェクトにリンクされたディレクトリ/worktreeから
vercel --prod --yes
```

### 本番への反映(ステージングで確認が取れた後)
```bash
git checkout main
git merge staging   # ステージングで確認済みの変更を取り込む
git push origin main   # 既存の自動デプロイでそのまま本番反映される
```

## アプリコード・DBスキーマ・ダミーデータ・Secretsの扱い

- **アプリコード**: ステージングで確認・承認された変更のみ`main`へマージして本番反映する。
- **DBスキーマ**: `supabase/migrations/`配下のファイルとして管理する既存方針のまま。
  新しいマイグレーションはまずステージング(`orexflqvvukmujjroyhl`)へ適用して検証し、
  問題なければ本番(`mtjiauhliezbjjpqpvuj`)へ同じファイルを適用する。
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

## レビュー終了時のクリーンアップ(環境自体は削除しない)

外部エンジニアのレビューが終わったら、以下だけを行う。**ステージング環境そのもの
(Supabase/Vercelプロジェクト)は削除せず、今後の開発に継続利用する。**

1. GitHubリポジトリのCollaborator設定から外部エンジニアを削除
2. レビュー用テストアカウント(company_admin/store_manager/staff、必要に応じてsystem_admin)を
   Supabaseダッシュボード(Authentication)から無効化または削除
3. `SELF_SIGNUP_TEST_KEY`をローテーション(念のため、次回の利用に備えて新しい値へ変更)
