# Salon Manager

サロン経営管理Webアプリです。店舗別・月別の売上・費用・KPIを管理し、日次入力と月次締めを分けて扱える構成になっています。

## 起動方法

```bash
npm install
npm run dev
```

## 主な機能

- ダッシュボードで月別の売上・目標達成率・営業日数を確認
- 日次入力で売上データを保存
- 月次の固定費・販管費・締め項目を管理
- 店舗別・月別にデータを分離
- localStorage を利用した自動保存
- PWA 対応（ホーム画面追加・オフライン表示）

## データ構造

アプリの状態は `src/data/defaults.js` と `src/utils/storage.js` の保存層で管理しています。

- `stores`: 店舗名の配列
- `selectedStore`: 選択中の店舗
- `selectedMonth`: 選択中の年月
- `targets`: 店舗別・年月別の目標
- `dailyResults`: 店舗別・年月別の日次実績
- `fixedCosts`: 店舗別・年月別の固定費
- `variableCosts`: 店舗別・年月別の販管費
- `monthClosing`: 店舗別・年月別の月締め項目
- `businessDaySettings`: 店舗別・年月別の営業日数設定
- `dayClosingStates`: 店舗別・年月別の日締め完了状態
- `saveStatus`: 保存状態とメッセージ

## 保存方法

現段階ではブラウザの localStorage に保存しています。これにより、ページ更新やブラウザ再起動後もデータが復元されます。

注意点:
- localStorage は端末内保存のため、端末間同期やバックアップはできません
- 将来的に Supabase などのデータベースへ移行しやすいよう、状態は保存層で一元管理しています

## PWA

- `public/manifest.webmanifest` でインストール設定を提供
- `public/sw.js` でオフライン時にも最低限の表示を維持
- iPhone Safari / Android Chrome からホーム画面追加可能な構成です

## 開発メモ

- 既存の UI を大きく壊さないよう、機能単位で段階的に拡張しています
- 保存処理はコンポーネント直書きではなく、保存層で管理する構成にしています
