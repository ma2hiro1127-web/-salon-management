import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      // __BUILD_TIME__ is injected at build time via vite.config.js's `define` — not a real
      // browser global, but ESLint needs to know it's intentional (see main.jsx).
      globals: { ...globals.browser, __BUILD_TIME__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
