import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// このセッションが実際にどのビルドのJSを動かしているかをコンソールで直接確認できるように
// する。「Chrome通常タブでは直った不具合がPWA版だけ再現する」ような報告があった際、まず
// ここを比較すれば、単にPWA側が古いJSバンドルのまま止まっているだけなのか、それとも同じ
// 最新コードで別の不具合が起きているのかを一目で切り分けられる。
console.info('[build-info] Salon Manager build:', __BUILD_TIME__, 'display-mode:', window.matchMedia('(display-mode: standalone)').matches ? 'standalone(PWA)' : 'browser');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      // 既にこのタブ/PWAが古いService Workerの管理下で開かれていた場合、新しいバージョンが
      // 有効化された瞬間に自動でリロードする。これが無いと、ホーム画面に追加したPWAや
      // 開きっぱなしのタブが「アプリを更新したのに古い画面のまま」になり続けてしまう。
      let hasReloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hasReloaded) return;
        hasReloaded = true;
        window.location.reload();
      });
      // registration.update()はブラウザにService Worker本体(sw.js)のバイト差分を
      // 再チェックさせる。これを「起動時に1回だけ」しか呼ばないと、Macのdockに追加した
      // PWAのように、一度開いたらほぼ閉じられずload イベントが二度と発火しないウィンドウは、
      // 新しいバージョンをデプロイしても永久に古いJSバンドルのまま動き続けてしまう
      // (Chrome通常タブでは正常に動くのにPWA版だけ古い不具合が残る、という症状の原因)。
      // ウィンドウがフォーカスを取り戻すたびと、開きっぱなしの間は定期的にも再チェックする。
      registration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update().catch(() => {});
        }
      });
      window.setInterval(() => {
        registration.update().catch(() => {});
      }, 30 * 60 * 1000);
    }).catch(() => {
      // Service worker registration can fail in some environments, but the app still works.
    })
  })
}
