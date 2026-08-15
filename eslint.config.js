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
      // __BUILD_TIME__/__BUILD_COMMIT__ are injected at build time via vite.config.js's
      // `define` — not real browser globals, but ESLint needs to know they're intentional
      // (see main.jsx).
      globals: { ...globals.browser, __BUILD_TIME__: 'readonly', __BUILD_COMMIT__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Node-context config files (not part of the browser bundle) — process.env etc. are
    // legitimately available here, unlike in the app source above.
    files: ['vite.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
