import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// アプリバージョン表示(要件5): デプロイのたびに自動で変わる識別子が欲しいので、
// package.jsonの手動バージョン(運用上ほぼ更新されない)には頼らず、Vercelがビルド時に
// 自動で渡すgitコミットSHA(VERCEL_GIT_COMMIT_SHA)をそのまま使う。ローカル開発ビルドなど
// この環境変数が無い場合は日時ベースの識別子にフォールバックする——どちらの場合も
// 「今どのビルドが動いているか」を後から目視で区別できることが目的で、正式なsemverでは無い。
const resolveAppVersion = () => {
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA
  if (commitSha) return commitSha.slice(0, 7)
  return `dev-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
})
