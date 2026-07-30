import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

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
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
    },
  },
});
