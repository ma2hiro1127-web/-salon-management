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

// PWAアップデート対策(要件6): 以前はsw.js側でself.skipWaiting()を無条件に呼んでいたため、
// デプロイのたびに、開きっぱなしのタブ/PWAが更新チェックのタイミング(フォーカス復帰・
// 定期チェック等)で新しいService Workerへ即座に切り替わり、直後のcontrollerchangeで
// window.location.reload()が無条件に走っていた——日次入力の途中でも問答無用でリロードされ、
// 入力中のデータが失われ得る設計になっていた(自動保存の数百msの隙間に当たれば消える)。
// 今回、sw.js側のself.skipWaiting()は撤去し、新しいService Workerは「待機中(waiting)」の
// ままブラウザに保持させる——ページ側から明示的にSKIP_WAITINGメッセージを送るまで、現在
// 開いているタブは古いバージョンのまま安全に動き続ける。新バージョンの検知はApp.jsx側の
// 「新しいバージョンがあります」バナー(SwUpdateBanner)経由でユーザーへ知らせ、ユーザーが
// 自分のタイミングで「更新する」を押した時だけSKIP_WAITINGを送る——強制リロードは一切
// 行わない。ボタンを押さずに使い続けても、次にタブ/PWAを閉じて開き直した時には(その時点で
// このタブを制御しているService Worker自体が居ない新しいナビゲーションになるため)自然に
// 最新版が使われる。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      let reloadRequested = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // controllerchangeは「ユーザーがSwUpdateBannerの『更新する』を押してSKIP_WAITINGを
        // 送った」時にだけ起こる(sw.js側がもうskipWaitingを自動では呼ばないため)。ここでの
        // reloadは、その明示的な操作への応答であり、勝手なタイミングでの強制リロードではない。
        if (reloadRequested) return;
        reloadRequested = true;
        window.location.reload();
      });

      // 新しいService Workerが「待機中(installed済み、まだ制御はしていない)」になったことを
      // 検知し、App.jsx側へ知らせるためのカスタムイベントを発火する。既にこのタブを制御して
      // いるService Worker(controller)が存在する場合だけ「更新」とみなす——controllerが
      // 無い状態でのinstalledは単なる初回インストールであり、通知不要。
      const notifyUpdateWaiting = () => {
        if (!navigator.serviceWorker.controller) return;
        window.dispatchEvent(new CustomEvent('salon-manager:sw-update-available', {
          detail: {
            applyUpdate: () => {
              registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
            },
          },
        }));
      };

      // このタブを開いた時点で、既に(前回のデプロイで)waiting中のService Workerが存在する
      // ケース(前回タブを開いていた間の定期チェックで見つかったが、その時は適用しなかった等)。
      if (registration.waiting) {
        notifyUpdateWaiting();
      }
      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed') {
            notifyUpdateWaiting();
          }
        });
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
