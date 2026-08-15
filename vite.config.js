import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // ビルドごとに固定されるタイムスタンプ。main.jsxが起動時にコンソールへ出す — Chrome
    // 通常タブとPWAで同じJSバンドルが動いているか(=PWA側が古いキャッシュのまま止まって
    // いないか)を、devtoolsを開くだけで直接見分けられるようにするための目印。
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    // Vercelがビルド時に自動で設定するgit commit SHA(ローカルビルドでは空文字になる)。
    // build時刻だけでなく実コミットも比較できるようにする。
    __BUILD_COMMIT__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || ''),
  },
})
