import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./src/renderer', import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  publicDir: fileURLToPath(new URL('./assets/public', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: true,
  },
  server: { port: 5199, strictPort: true },
});
