// バージョンはデプロイのたびに変える必要はないが、キャッシュ内容に影響する変更(この
// ファイル自体の挙動変更など)をした際は上げること。上げると activate 時に古いキャッシュを
// 丸ごと破棄するため、PWA/ホーム画面追加後に「更新したのに古い画面のまま」を防げる。
// v6: PWA(Macのdockに追加した版)だけAI分析トグルの修正が反映されない不具合の対策として
// 上げた — ブラウザがService Worker本体(このファイル)のバイト差分をチェックするのは
// 通常ページ遷移時のみで、開きっぱなしのPWAウィンドウ(mainjs側でloadイベントが一度しか
// 発火しない)は、明示的に再チェックしない限りいつまでも古いバージョンのままだった。
// v7: fetchハンドラがオリジンを見ずに全GETを横取りしており、Supabase REST API(companies等)
// へのクロスオリジンGETまでCache Storageへ保存 → ネットワークが失敗/中断した瞬間に
// その古いレスポンスをフォールバックで返していた。Dock版PWAはウィンドウの背景化/復帰時に
// 通常のChromeタブより積極的にネットワーク接続を抑制されるため、「AI分析ボタンを押した
// 直後(=PWAがフォアグラウンドに戻った直後)」がまさにこのフォールバックへ落ちやすい
// タイミングと重なっていた。これがChrome版では再現せずPWA版だけ「1回目は古い値に戻り、
// 2回目(接続が落ち着いた後)は成功する」形で再現していた根本原因 — 下のfetchハンドラを
// 同一オリジンのみに限定する。
// v8: 加盟店連携機能を実装したのに「反映されていない」という報告 — 本番デプロイ自体は
// 確認済みで正しく最新コードが配信されている。長時間開きっぱなしのPWA/タブは、JS実行
// コンテキストが既にメモリ上にロードされたままなので、fetchハンドラが network-first でも
// ページ自体を再読み込みしない限り新しいバンドルは反映されない。このファイル(sw.js)を
// 変更してバイト差分を作ることで、ブラウザに新しいService Workerの install/activate
// (=古いCache Storageの破棄)を確実に発火させ、次の起動・再読み込み時に最新版が
// 表示されやすくする。
// v9: 加盟店を開いた後、店舗プルダウンから自社へ戻れなくなる不具合の修正(hydrateFromSupabase
// が加盟店自身の過去スナップショットからisViewingFranchiseを誤って引き継いでいたバグ)。
// v10: 会社管理画面の是正 — 会社カードから重複していた「管理者を招待」導線を削除、
// 無料利用理由変更に成功通知を追加、system_admin付与を通常のユーザー招待から除外。
// v11: 日次入力画面の客数カードの並びを、新規客数→再来客数→客数(自動合計)に変更。
// v12: 加盟店を選択すると常にその加盟店の「全店舗ビュー」(ALL_STORES_VALUE)を開いていた
// ため、損益表・月締め・費用入力・日次入力など単一店舗前提のページが軒並み「全店舗
// ビューでは利用できません」で弾かれていた不具合の修正。店舗プルダウンの加盟店欄を
// 会社単位1行から店舗単位に展開し、選択すると必ず実店舗が選ばれた状態(isAllStoresView
// にならない状態)になるようにした。
// v13: 総合監査での修正 — 加盟店閲覧中の店舗設定(日次入力項目/月間目標項目/在庫管理/
// 日計管理)トグルが、保存時にはguardFranchiseReadOnlyで拒否される一方、見た目は編集
// 可能なままだった不整合を修正(既存の読み取り専用表示分岐に合流)。
// v14: 加盟店に店舗が1件も登録されていない場合にhandleFranchiseViewがALL_STORES_VALUEへ
// フォールバックしていた経路を修正。0店舗の会社を選んでも自社の全店舗ビューへ移動したり
// currentCompanyId/isViewingFranchiseを中途半端に切り替えたりせず、現在の表示状態を
// 一切変更せずに「店舗が登録されていません」と通知するだけにした。
// v15: 店舗重複作成の事故防止 — 既存店舗がある会社で「店舗を追加」から新規作成する際、
// 既存店舗名・追加する店舗名を見せて確認するダイアログを追加。作成完了時の通知文言も
// 「新しい店舗として追加しました」に明確化。加盟店閲覧中の「複製」操作も他の書き込み
// ハンドラと同じ明示的な拒否に揃えた(実データはRLSで元々作成不可)。
// v16: 会社追加→招待→company_admin初回ログインの正式フローを整備。company_adminが
// company_idに有効な店舗0件の状態でログインした場合だけ「最初の店舗を登録」画面を
// 強制表示する(setup.completeフラグではなく実際の店舗数を基準にする、店舗が1件でも
// あれば二度と出ない)。「店舗を追加」時に既存店舗名との類似(全角半角・大文字小文字・
// スペース・「本店」等の接尾辞違い)を検知した場合は警告文言を強める。
const CACHE_NAME = 'salon-manager-cache-v16';
const APP_SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/mask-icon.svg',
  '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-192.png', '/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // 同一オリジン(このアプリ自身の静的ファイル)以外は一切横取りしない。Supabase等の
  // API呼び出しをこのService Workerがキャッシュ・フォールバック対象にしてしまうと、
  // ネットワークが一瞬不安定になっただけでAPIの最新レスポンスの代わりに古いレスポンスを
  // 返してしまう(下のCACHE_NAME v7コメント参照)。ここで早期returnすればブラウザが
  // 素の(Service Worker非経由の)fetchとして処理する。
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith(
    // cache: 'no-store' でService Worker自身のfetchがブラウザHTTPキャッシュを経由しないように
    // する(index.html等は元々Cache-Control: max-age=0だが、念のための二重の安全策)。
    fetch(event.request, { cache: 'no-store' })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html')))
  );
});
