// Bundles the main process and preload script with esbuild (CommonJS, as
// required for sandboxed preloads). Usage: node scripts/build-electron.mjs [--watch]
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};
const configs = [
  { ...common, entryPoints: ['src/app/main.ts'], outfile: 'dist-electron/main.cjs' },
  { ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist-electron/preload.cjs' },
];

if (watch) {
  for (const c of configs) await (await context(c)).watch();
} else {
  await Promise.all(configs.map((c) => build(c)));
}
