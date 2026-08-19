import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
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
      // pageshowはbfcache(ブラウザ内メモリ上のページ復帰)からの復帰時に、visibilitychange/
      // focusより先に、あるいはそれらが発火しないまま単独で発火することがある(特にPWAの
      // ウィンドウ切り替え・タブ復帰) — App.jsx側のhydrateFromSupabase再取得トリガーで既に
      // 同じ理由でpageshowを併用しているのと同じ抜け漏れが、Service Worker本体の更新
      // チェック側にもあった。これが無いと、対象月選択UI等をデプロイしても、開きっぱなしの
      // PWA/タブが更新チェックのタイミングを逃し、古いバンドルのまま動き続けることがある。
      window.addEventListener('pageshow', () => {
        registration.update().catch(() => {});
      });
      window.setInterval(() => {
        registration.update().catch(() => {});
      }, 5 * 60 * 1000);
    }).catch(() => {
      // Service worker registration can fail in some environments, but the app still works.
    })
  })
}
