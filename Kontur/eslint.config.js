// ESLint (только для разработки: npm run lint). Движок работает и в браузере, и в Node; сервер, скрипты и тесты —
// Node; студия (player/) — браузер. Свои проверки без зависимостей — в scripts/lint.mjs (stdout сервера, конфликты).
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'out/**', 'lit-out/**', '**/*.min.js'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
    },
  },
  { files: ['engine/**/*.js'], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  { files: ['**/*.mjs', 'eslint.config.js'], languageOptions: { globals: globals.node } },
  // константы WebGPU кладёт в globalThis пакет webgpu (Object.assign(globalThis, globals))
  { files: ['mcp/lit/gpu-*.mjs'], languageOptions: { globals: { GPUBufferUsage: 'readonly', GPUMapMode: 'readonly', GPUShaderStage: 'readonly', GPUTextureUsage: 'readonly' } } },
  // скрипты-черновики сцен: неиспользуемые константы палитры и let — норма, проверяются только ошибки
  { files: ['examples/**'], rules: { 'no-unused-vars': 'off', 'prefer-const': 'off' } },
  {
    files: ['player/**/*.js'],
    languageOptions: { globals: globals.browser },
    rules: {
      // разметка — только через setHTML(el, html`…`) из player/ed/html.js: подстановки там экранируются
      'no-restricted-syntax': ['error',
        { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: 'Используйте setHTML(el, html`…`) из ./html.js' },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'Используйте setHTML(el, html`…`) из ./html.js' }],
    },
  },
  { files: ['player/ed/html.js'], rules: { 'no-restricted-syntax': 'off' } },
];
