import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Teaches no-unused-vars that a component referenced in JSX is used.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Empty catch blocks are used deliberately where a failure is genuinely
      // ignorable (storage blocked in private mode, sandboxed downloads).
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
]
