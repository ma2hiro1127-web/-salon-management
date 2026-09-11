# Supabase バックアップ

**このドキュメントは古い調査メモです。現在の正式なバックアップ手順は
[docs/backup-restore.md](./backup-restore.md) を参照してください。**

このメモを書いた時点(2026年8月)ではSupabaseの自動バックアップ(PITR)が無効で、手動の
JSONバックアップ(`scripts/backup-supabase-data.mjs`)しか無い状態でした。その後、
GitHub Actionsの`.github/workflows/db-backup.yml`(毎日04:00 JST自動実行、
`workflow_dispatch`で手動実行も可能)によって、スキーマ・RLSポリシー・DB関数・Trigger・
実データを含む完全なSQLダンプが自動的に取得され、プライベートリポジトリとGitHub Actions
Artifactの両方へ保存される仕組みが稼働済みです。日常のバックアップ・復元作業は
`docs/backup-restore.md`に従ってください。

`scripts/backup-supabase-data.mjs` / `scripts/restore-supabase-data.mjs`(データのみの
JSON形式)は、上記の自動バックアップが使えない特殊な状況(調査用に特定テーブルだけを
素早くJSONで確認したい場合等)向けの補助ツールとして残していますが、通常の運用では使いません。
