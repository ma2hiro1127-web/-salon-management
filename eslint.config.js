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
      // __APP_VERSION__ is a build-time constant injected by vite.config.js's `define`
      // (a text substitution, not a real runtime global) — declared here so ESLint's
      // no-undef doesn't flag it in source files that reference it.
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Node-context files (Vite's own config, standalone CLI scripts) run outside the
    // browser and legitimately reference Node globals like `process` — scope `globals.node`
    // to just these so browser-context app code doesn't also start accepting Node globals.
    files: ['vite.config.js', 'scripts/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
