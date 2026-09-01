# デプロイ運用の安全化(2026-09-01)

## 背景

`git push origin main` の時点でVercelの既存GitHub連携により確認前に本番
(`https://salon-manager.net`)へ自動デプロイされてしまうことが判明したため、
「未確認の変更が本番へ即反映される事故」を防ぐ目的で運用を整備した。

## 何が危険だったか

- Vercelの`salon-management`(本番)プロジェクトは`Production Branch = main`に設定されており、
  `main`へのpushは即座に本番ドメイン`salon-manager.net`へ反映される。この設定自体は
  Vercel/GitHub連携の標準的な挙動だが、`main`への直接pushを止める仕組み(GitHub Branch
  Protection等)が一切無く、誰でも(Claude Codeも含め)確認前にうっかりpushしてしまえる
  状態だった。
- 本番Vercelプロジェクトの環境変数に、フロントエンドから一切参照されていない未使用の
  `ANTHRONIC_API_KEY`(スペルミスされた変数名の残骸)が`preview`環境にも設定されており、
  不要にPreviewビルドへ露出していた(実害は無かったが、不要な露出であることに変わりはない)。

## 今回行ったこと

1. **`.github/workflows/ci.yml`を新設**: push/PR毎に`scripts/deploy/verify.sh`
   (lint→test→build)を自動実行する。デプロイやDBには一切触れない、コード品質チェックのみ。
2. **安全なnpmコマンドを整備**(`scripts/deploy/`配下):
   - `npm run verify` — lint→test→buildをまとめて実行。lintは既存の8件
     (このタスクとは無関係な、元からあったエラー)は許容し、**新規に増えたエラーだけを
     検出する回帰チェック**にしている(既存debtでデプロイが永久にできなくなるのを防ぐため)。
   - `npm run deploy:staging` — 既存の安全な手順(`git worktree`でメインディレクトリの
     `.vercel`(本番リンク)に触れずに`salon-management-staging`プロジェクトへデプロイ)を
     1コマンドにラップ。
   - `npm run deploy:production` — `verify`が失敗している状態では実行不可。
     「salon-manager.netの本番環境へ反映されます」という明示確認(`yes`入力必須)を
     挟んでから`main`をpushする。
3. **この開発環境限定のgit pre-pushフック**(`.git/hooks/pre-push`、リポジトリには
   含まれない)を設置。`main`への直接pushは`ALLOW_MAIN_PUSH=1`が無い限りブロックされる。
   `npm run deploy:production`は確認プロンプトを通過した後に自動でこのフラグを立てる。
4. **未使用の漏れていた秘密情報を削除**: 本番Vercelプロジェクトの`ANTHRONIC_API_KEY`を削除。
5. **ステージングVercelプロジェクトのGit連携を試行→撤回**: API経由でGitHubリポジトリとの
   連携自体は作成できたが、「Production Branch」を`main`から`staging`へ変更する操作だけは
   API経由でどうしても出来なかった(`main`のままだと余計な重複ビルドが走るだけで実害は
   無いが、意図と異なるため)。実害が出る前に連携を削除し、変更前の状態(`link: None`)へ
   戻した。ステージングへの反映は`npm run deploy:staging`が引き続き確実な方法。
6. **ドキュメント更新**: `docs/staging-review/deploy-workflow.md`を今回の運用に合わせて
   更新。

## 今後、普段の修正はどう進めればいいか

```
1. Claude Codeで修正
        ↓
2. npm run deploy:staging でステージングへ反映
        ↓
3. https://salon-management-staging.vercel.app で実機確認
        ↓
4. npm run deploy:production で本番へ反映(「yes」の入力が必要)
```

## 誤って本番へ反映される可能性は残っているか

- **この開発環境(このMac・このディレクトリ)からは**、pre-pushフックにより`main`への
  直接pushがブロックされるため、`npm run deploy:production`を使わない限り本番へは
  反映されない。
- ただし、**Vercel側の「pushで自動デプロイ」設定自体は残っている**(GitHub Branch
  ProtectionはこちらからはAPI経由で設定できないため)。別の端末・別のGitHubアカウントから
  `main`へ直接pushできてしまう状態は今回のセッションだけでは解消できていない。
  完全に塞ぐには、GitHub側で下記の手動設定が必要(後述)。

## 問題発生時の戻し方

- **アプリコードを戻したい場合**: `git revert <コミット>` して
  `npm run deploy:production`を実行する(通常のデプロイと同じ確認フロー)。
- **今すぐ止血だけしたい場合(Vercel側)**: Vercelダッシュボード →
  `salon-management`プロジェクト → Deployments → 直前の正常なデプロイを選択 →
  「Promote to Production」。またはCLIで`vercel rollback`。
- **DB変更を伴う場合**: 今回の対応ではDBスキーマは一切変更していない。今後
  migrationを本番へ適用する際は、必ず事前に提案し明示承認を得てから実行する運用とする
  (自動実行の仕組みは追加していない)。

## 本番DBとステージングDBは完全に分離されているか

分離されている(今回のセッションで直接確認済み)。

- 本番: Supabaseプロジェクト`mtjiauhliezbjjpqpvuj`
- ステージング: Supabaseプロジェクト`orexflqvvukmujjroyhl`(別プロジェクト)
- Vercel本番プロジェクトの環境変数(`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`)は
  `production`スコープのみに設定されており、Preview環境には渡っていない
  (=Previewビルドが誤って本番DBへ繋がることは無い)。

## バックアップは正常か

正常。`.github/workflows/db-backup.yml`が毎日04:00 JSTに本番DBをダンプし、
プライベートなバックアップ用リポジトリへ保存している(日次7世代/週次4世代/月次3世代を保持)。
直近10回の実行をGitHub Actions APIで確認したところ、すべて成功していた
(2026-08-22〜08-31、失敗ゼロ)。

## GitHub/Vercel画面で手動設定してほしい項目

この環境にはGitHub認証情報が無く、Branch Protectionの設定はAPI経由では行えないため、
以下はユーザー側での手動設定が必要。

1. **GitHub → リポジトリ → Settings → Branches → Add branch protection rule**
   - Branch name pattern: `main`
   - 「Require a pull request before merging」をON
   - 「Require status checks to pass before merging」をON →
     `verify`(今回追加した`.github/workflows/ci.yml`のジョブ名)を必須ステータスチェックに
     追加
   - 「Do not allow bypassing the above settings」もONにしておくと、管理者含め誰も
     直接pushできなくなる(推奨)
   - これを設定すると、`main`への変更はすべてPull Request経由・CI(lint/test/build)
     成功後のみ可能になる
2. (任意)Vercelダッシュボード → `salon-management-staging`プロジェクト → Settings →
   Git → 「Connect Git Repository」→ 対象リポジトリ選択 → 「Production Branch」を
   `staging`に設定 — これを行うと`git push origin staging`だけでステージングへ
   自動反映されるようになる(現状は`npm run deploy:staging`で確実に反映可能なので必須ではない)。
