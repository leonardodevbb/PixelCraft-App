import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

const root = fileURLToPath(new URL('./src/renderer', import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [
    react(),
    {
      // Strict Content-Security-Policy for production builds (dev needs Vite's inline preamble).
      name: 'pixelcraft-csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace(
          '<meta charset="UTF-8" />',
          `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
        ),
    },
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  publicDir: fileURLToPath(new URL('./assets/public', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: true,
  },
  server: { port: 5199, strictPort: true },
});
