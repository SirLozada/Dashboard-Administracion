import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(root, '../shared') } },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(root, '..')] },
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
  build: { outDir: path.resolve(root, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
