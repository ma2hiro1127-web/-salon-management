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
const CACHE_NAME = 'salon-manager-cache-v7';
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
