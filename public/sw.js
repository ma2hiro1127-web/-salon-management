// バージョンはデプロイのたびに変える必要はないが、キャッシュ内容に影響する変更(この
// ファイル自体の挙動変更など)をした際は上げること。上げると activate 時に古いキャッシュを
// 丸ごと破棄するため、PWA/ホーム画面追加後に「更新したのに古い画面のまま」を防げる。
const CACHE_NAME = 'salon-manager-cache-v5';
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
