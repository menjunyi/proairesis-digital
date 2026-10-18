import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Production configuration is written by prepare-release.mjs. Refuse ambient
  // .env files so a release is derived only from reviewed source and explicit
  // release variables.
  envDir: false,
  plugins: [react()],
  server: {
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3003',
      '/config.json': 'http://127.0.0.1:3003',
    },
  },
  build: { sourcemap: false },
});
