import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/**
 * 生产构建时收紧 CSP。
 *
 * dev 必须保留 'unsafe-eval'（Vite HMR 与 React Refresh 依赖它），
 * 但应用代码本身不使用 eval / new Function，打包后就没有理由继续放开，
 * 摘掉可以同时消掉 Electron 的安全告警与这份额外的攻击面。
 */
function tightenCspForBuild(): Plugin {
  return {
    name: 'tighten-csp-for-build',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html: string) {
      return html.replace(" 'unsafe-eval'", '');
    },
  };
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['http-mitm-proxy'],
      },
    },
  },
  preload: {},
  renderer: {
    plugins: [react(), tightenCspForBuild()],
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
    },
  },
});
