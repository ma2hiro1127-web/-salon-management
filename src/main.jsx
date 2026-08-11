import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

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
      registration.update().catch(() => {});
    }).catch(() => {
      // Service worker registration can fail in some environments, but the app still works.
    })
  })
}
