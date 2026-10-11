// Development runner: Vite dev server + esbuild watch + Electron.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/';

const esbuild = spawn(process.execPath, ['scripts/build-electron.mjs', '--watch'], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 1500));

const electronBin = (await import('electron')).default;
const extra = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
const app = spawn(electronBin, ['.', ...extra], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
app.on('exit', async (code) => {
  esbuild.kill();
  await server.close();
  process.exit(code ?? 0);
});
