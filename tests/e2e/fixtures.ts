import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Launched {
  app: ElectronApplication;
  page: Page;
  home: string;
}

/** Starts the built app with isolated XDG directories. */
export async function launch(opts: { args?: string[]; home?: string } = {}): Promise<Launched> {
  const home = opts.home ?? mkdtempSync(join(tmpdir(), 'pixelcraft-e2e-'));
  // PIXELCRAFT_E2E_EXECUTABLE runs the suite against a packaged build
  // (e.g. release/linux-unpacked/pixelcraft) instead of the dev checkout.
  const packaged = process.env.PIXELCRAFT_E2E_EXECUTABLE;
  const args = [...(packaged ? [] : ['.']), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), ...(opts.args ?? [])];
  const app = await electron.launch({
    ...(packaged ? { executablePath: packaged } : {}),
    args,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_DATA_HOME: join(home, 'data'),
      XDG_CACHE_HOME: join(home, 'cache'),
      PIXELCRAFT_MULTI_INSTANCE: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, home };
}

/** Makes the next native save dialog return `path` without showing UI. */
export async function stubSaveDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as typeof dialog.showSaveDialog;
  }, path);
}

export async function stubOpenDialog(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: p })) as typeof dialog.showOpenDialog;
  }, paths);
}

/** Center of document pixel (x, y) in page coordinates. */
export async function pixelToPage(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('editor-canvas').boundingBox();
  if (!box) throw new Error('canvas not visible');
  const t = await page.evaluate(() => (window as unknown as { __pixelcraft: { transform(): { zoom: number; offsetX: number; offsetY: number } } }).__pixelcraft.transform());
  return { x: box.x + t.offsetX + (x + 0.5) * t.zoom, y: box.y + t.offsetY + (y + 0.5) * t.zoom };
}

/** Quits without the unsaved-changes prompt (tests leave documents dirty on purpose). */
export async function quit(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: a }) => setTimeout(() => a.exit(0), 10)).catch(() => undefined);
  await app.close().catch(() => undefined);
}
