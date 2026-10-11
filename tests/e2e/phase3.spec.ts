import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeGif } from '../../src/import-export/gif';
import { decodePng } from '../../src/import-export/png';
import { launch, pixelToPage, quit, stubOpenDialog, stubSaveDialog } from './fixtures';

type Hook = { __pixelcraft: { pixel(x: number, y: number): number; state(): { frames: number; activeFrame: number; playing: boolean; durations: number[] } } };
const state = (page: Page) => page.evaluate(() => (window as unknown as Hook).__pixelcraft.state());

async function dot(page: Page, x: number, y: number): Promise<void> {
  const p = await pixelToPage(page, x, y);
  await page.mouse.click(p.x, p.y);
}

test('frames, playback and animation exports', async () => {
  const { app, page, home } = await launch();
  await page.getByTestId('quick-16x16').click();
  await expect(page.getByTestId('timeline')).toBeVisible();
  await page.getByTestId('palette-10').click();
  await page.keyboard.press('b');
  await dot(page, 0, 0);

  // Frame 2 (empty) via the button, frame 3 duplicated from 2 via keyboard
  await page.getByTestId('frame-add').click();
  await dot(page, 5, 5);
  await page.keyboard.press('Alt+d');
  await dot(page, 10, 10);
  const s = await state(page);
  expect(s.frames).toBe(3);
  expect(s.activeFrame).toBe(2);
  await expect(page.getByTestId('frame-cell')).toHaveCount(3);

  // Navigation with , and .
  await page.keyboard.press(',');
  expect((await state(page)).activeFrame).toBe(1);
  expect(await page.evaluate(() => (window as unknown as Hook).__pixelcraft.pixel(10, 10))).toBe(0);
  await page.keyboard.press('.');

  // Edit the second frame's duration inline
  await page.getByTestId('frame-cell').nth(1).locator('.frame-duration').click();
  await page.getByLabel('Duração do quadro em milissegundos').fill('250');
  await page.getByLabel('Duração do quadro em milissegundos').press('Enter');
  expect((await state(page)).durations).toEqual([100, 250, 100]);

  // Onion skin and playback
  await page.getByTestId('onion-toggle').click();
  await page.getByTestId('anim-play').click();
  await expect.poll(async () => (await state(page)).playing).toBe(true);
  await page.waitForTimeout(400);
  if (process.env.PIXELCRAFT_SHOTS) await page.screenshot({ path: join(process.env.PIXELCRAFT_SHOTS, 'phase3-timeline.png') });
  await page.getByTestId('anim-play').click();
  expect((await state(page)).playing).toBe(false);

  // GIF at 2x
  const gif = join(home, 'anim.gif');
  await page.getByRole('menuitem', { name: 'Arquivo', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Exportar GIF animado…' }).click();
  await expect(page.getByTestId('export-gif-dialog')).toBeVisible();
  await page.getByRole('radio', { name: '2×' }).click();
  await expect(page.getByTestId('gif-size')).toContainText('calculado');
  await stubSaveDialog(app, gif);
  await page.getByTestId('anim-export-confirm').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: 'GIF exportado' })).toBeVisible();
  const frames = decodeGif(new Uint8Array(readFileSync(gif)), { maxPixels: 1e6, maxFrames: 10 });
  expect(frames.map((f) => f.delayMs)).toEqual([100, 250, 100]);
  expect(frames[0]!.image.width).toBe(32);
  expect(frames[0]!.image.get(0, 0)).toBe(0xe8434fff);
  expect(frames[1]!.image.get(0, 0)).toBe(0);
  expect(frames[2]!.image.get(21, 21)).toBe(0xe8434fff);

  // Spritesheet in a grid with JSON
  const sheet = join(home, 'sheet.png');
  await page.keyboard.press('Control+Alt+s');
  await expect(page.getByTestId('export-spritesheet-dialog')).toBeVisible();
  await page.getByLabel('Disposição').selectOption('grid');
  await page.getByLabel('Colunas').fill('2');
  await page.getByLabel('Colunas').press('Tab');
  await expect(page.getByTestId('anim-export-dims')).toContainText('32×32');
  await stubSaveDialog(app, sheet);
  await page.getByTestId('anim-export-confirm').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: 'Spritesheet' })).toBeVisible();
  const png = decodePng(new Uint8Array(readFileSync(sheet)));
  expect([png.width, png.height]).toEqual([32, 32]);
  expect(png.get(16 + 5, 5)).toBe(0xe8434fff);
  const meta = JSON.parse(readFileSync(join(home, 'sheet.json'), 'utf8'));
  expect(meta.frames).toHaveLength(3);
  expect(meta.frames[2].frame).toEqual({ x: 0, y: 16, w: 16, h: 16 });
  expect(meta.frames[1].duration).toBe(250);

  // PNG sequence into a folder
  const dir = join(home, 'seq');
  mkdirSync(dir);
  await stubOpenDialog(app, [dir]);
  await page.getByRole('menuitem', { name: 'Arquivo', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Exportar sequência de PNG…' }).click();
  await page.getByTestId('anim-export-confirm').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: 'PNGs exportados' })).toBeVisible();
  expect(readdirSync(dir).sort()).toEqual(['Sem título_001.png', 'Sem título_002.png', 'Sem título_003.png']);

  // Delete a frame and undo
  await page.getByTestId('frame-delete').click();
  expect((await state(page)).frames).toBe(2);
  await page.keyboard.press('Control+z');
  expect((await state(page)).frames).toBe(3);
  await quit(app);
});
