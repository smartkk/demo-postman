// @ts-check
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');

/**
 * 轻量 ESLint 配置：目标是「存量全绿 + 拦住新增坏味道」。
 * 故意不做类型感知（type-checked）规则，保持秒级反馈；
 * 类型问题由 tsc --noEmit（CI 同跑）负责。
 */
module.exports = tseslint.config(
  {
    ignores: [
      'out/**',
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'browser-extension/**',
      // 一次性探查/验证脚本，非应用代码，不纳入 lint
      'gui-test-artifacts/**',
      '_kill.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 主进程大量使用 console 打日志，统一放行
      'no-console': 'off',
      // 允许 _ 前缀的未使用参数（回调签名占位）与 catch 绑定
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'prefer-const': 'error',
      // 存量代码存在 == 比较，先告警不阻断，新代码逐步收敛
      eqeqeq: ['warn', 'smart'],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // CommonJS 配置文件与脚本（tailwind/postcss/electron-vite/eslint 自身等）
    files: ['*.js', '*.cjs'],
    languageOptions: {
      globals: {
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
    },
  },
  {
    // 测试目录：node 环境
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    // 渲染进程：浏览器全局 + React Hooks 规则
    files: ['src/renderer/**/*.{ts,tsx}', 'src/preload/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        React: 'readonly',
        HTMLElement: 'readonly',
        NodeJS: 'readonly',
      },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  }
);
