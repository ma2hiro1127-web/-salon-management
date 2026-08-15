import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { collectSalonManagerDiagnostics } from './utils/diagnostics.js'

// このセッションが実際にどのビルドのJSを動かしているか、localStorage/IndexedDB/Cache
// Storage/Service Workerの状態を、起動のたびに自動で1回コンソールへ出す。加えて
// window.salonManagerDiagnostics()としても公開しているので、「ONにした直後」「OFFへ戻った
// 直後」等、任意のタイミングでdevtoolsコンソールから手動実行できる — Chrome通常タブと
// PWA版でこの出力を見比べれば、同じビルドが動いているか、どのストレージ領域に差分が
// あるかを直接確認できる。
void collectSalonManagerDiagnostics('startup');

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
