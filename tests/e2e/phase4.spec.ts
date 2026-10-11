import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeBmp } from '../../src/import-export/bmp';
import { declaredSize, sniffImageType } from '../../src/import-export/browser-decode';
import { decodePng } from '../../src/import-export/png';
import { launch, pixelToPage, quit, stubOpenDialog, stubSaveDialog } from './fixtures';

type Hook = {
  __pixelcraft: {
    pixel(x: number, y: number): number;
    composite(x: number, y: number): number;
    state(): { layers: number; history: string[]; tool: string };
  };
};
const state = (page: Page) => page.evaluate(() => (window as unknown as Hook).__pixelcraft.state());
const pixel = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as unknown as Hook).__pixelcraft.pixel(a!, b!), [x, y]);
const ink = (page: Page) =>
  page.evaluate(() => {
    let n = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((window as unknown as Hook).__pixelcraft.pixel(x, y) & 255) n++;
    return n;
  });

async function exportAs(page: Page, app: Parameters<typeof stubSaveDialog>[0], format: string, path: string): Promise<Uint8Array> {
  await page.keyboard.press('Control+Shift+e');
  await expect(page.getByTestId('export-png-dialog')).toBeVisible();
  await page.getByLabel('Formato').selectOption(format);
  await expect(page.getByTestId('export-size')).not.toBeEmpty();
  await stubSaveDialog(app, path);
  await page.getByTestId('export-confirm').click();
  await expect(page.getByTestId('export-png-dialog')).toBeHidden();
  await expect.poll(() => existsSync(path)).toBe(true);
  return new Uint8Array(readFileSync(path));
}

test('text, gradient, command palette, shortcuts, formats and tileset', async () => {
  const { app, page, home } = await launch();
  await page.getByTestId('quick-16x16').click();

  // Text tool with live preview, applied as one step and undoable
  await page.keyboard.press('t');
  expect((await state(page)).tool).toBe('text');
  const p = await pixelToPage(page, 1, 1);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('text-dialog')).toBeVisible();
  await page.getByTestId('text-input').fill('Oi');
  await expect(page.getByTestId('text-size')).toContainText('em (1, 1)');
  if (process.env.PIXELCRAFT_SHOTS) await page.screenshot({ path: join(process.env.PIXELCRAFT_SHOTS, 'phase4-text.png') });
  await page.getByTestId('text-apply').click();
  expect((await state(page)).history.at(-1)).toBe('Texto');
  expect(await ink(page)).toBeGreaterThan(10);
  await page.keyboard.press('Control+z');
  expect(await ink(page)).toBe(0);

  // Gradient: smooth, left to right
  await page.keyboard.press('Shift+g');
  expect((await state(page)).tool).toBe('gradient');
  await page.getByLabel('Pontilhado').selectOption('none');
  const a = await pixelToPage(page, 0, 8);
  const b = await pixelToPage(page, 15, 8);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  const left = await pixel(page, 0, 3);
  const right = await pixel(page, 15, 3);
  expect(left & 255).toBe(255);
  expect(right & 255).toBe(255);
  expect(left).not.toBe(right);
  expect((await state(page)).history.at(-1)).toBe('Degradê');

  // Command palette runs a command by fuzzy search
  const layersBefore = (await state(page)).layers;
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('command-palette')).toBeVisible();
  await page.getByTestId('command-input').fill('nova camada');
  await page.getByTestId('command-input').press('Enter');
  await expect(page.getByTestId('command-palette')).toBeHidden();
  await expect.poll(async () => (await state(page)).layers).toBe(layersBefore + 1);

  // Custom shortcut
  await page.keyboard.press('F1');
  await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
  await page.getByLabel('Buscar atalhos').fill('Mosaico');
  await page.getByTestId('shortcut-view.tiledPreview').getByTestId('shortcut-record').click();
  await page.keyboard.press('Control+Alt+y');
  await expect(page.getByTestId('shortcut-view.tiledPreview')).toContainText('alterado');
  await page.getByRole('button', { name: 'Fechar', exact: true }).last().click();
  await expect(page.getByTestId('shortcuts-dialog')).toBeHidden();
  await page.keyboard.press('Control+Alt+y');
  await page.getByRole('menuitem', { name: 'Visualizar', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: /Mosaico/ })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  // JPEG, WebP and BMP exports
  const jpg = await exportAs(page, app, 'jpeg', join(home, 'img.jpg'));
  expect(sniffImageType(jpg)).toBe('jpeg');
  expect(declaredSize(jpg, 'jpeg')).toEqual({ width: 16, height: 16 });
  const webp = await exportAs(page, app, 'webp', join(home, 'img.webp'));
  expect(sniffImageType(webp)).toBe('webp');
  expect(declaredSize(webp, 'webp')).toEqual({ width: 16, height: 16 });
  const bmp = decodeBmp(await exportAs(page, app, 'bmp', join(home, 'img.bmp')), 1e6);
  const composite = await page.evaluate(() => (window as unknown as Hook).__pixelcraft.composite(15, 3));
  expect(bmp.get(15, 3)).toBe(composite);

  // Import the BMP back as a layer
  const before = (await state(page)).layers;
  await stubOpenDialog(app, [join(home, 'img.bmp')]);
  await page.keyboard.press('Control+Shift+o');
  await expect(page.getByTestId('toast-success').filter({ hasText: 'importada como camada' })).toBeVisible();
  expect((await state(page)).layers).toBe(before + 1);

  // Tileset with a Tiled map
  await page.getByRole('menuitem', { name: 'Imagem', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Tiles e tileset…' }).click();
  await expect(page.getByTestId('tiles-dialog')).toBeVisible();
  await page.getByLabel('Largura do tile').fill('4');
  await page.getByLabel('Altura do tile').fill('4');
  await page.getByLabel('Altura do tile').press('Tab');
  await expect(page.getByTestId('tileset-info')).toContainText('4×4 células');
  if (process.env.PIXELCRAFT_SHOTS) await page.screenshot({ path: join(process.env.PIXELCRAFT_SHOTS, 'phase4-tiles.png') });
  const ts = join(home, 'tiles.png');
  await stubSaveDialog(app, ts);
  await page.getByTestId('tileset-export').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: 'Tileset exportado' })).toBeVisible();
  const sheet = decodePng(new Uint8Array(readFileSync(ts)));
  expect(sheet.height % 4).toBe(0);
  const map = JSON.parse(readFileSync(join(home, 'tiles.tmj'), 'utf8'));
  expect(map.width).toBe(4);
  expect(map.layers[0].data).toHaveLength(16);
  expect(map.tilesets[0].image).toBe('tiles.png');
  await quit(app);
});
