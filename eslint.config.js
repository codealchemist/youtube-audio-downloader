import neostandard from 'neostandard'
import globals from 'globals'

export default [
  ...neostandard({ ignores: ['out/**', 'test-results/**', 'playwright-report/**'] }),
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser }
  },
  {
    files: ['src/preload/**/*.cjs', 'test/e2e/fixtures/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node }
  }
]
