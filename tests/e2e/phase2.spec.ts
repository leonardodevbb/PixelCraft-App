import { expect, test, type Page } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, pixelToPage, quit, stubOpenDialog, stubSaveDialog } from './fixtures';

interface Snapshot {
  width: number;
  height: number;
  layerNames: string[];
  activeLayer: string | null;
  selection: { x: number; y: number; w: number; h: number; area: number } | null;
  palette: number;
  history: string[];
  tool: string;
}

type Hook = { __pixelcraft: { pixel(x: number, y: number): number; composite(x: number, y: number): number; state(): Snapshot } };
const pixel = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => (window as unknown as Hook).__pixelcraft.pixel(px!, py!), [x, y]);
const composite = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => (window as unknown as Hook).__pixelcraft.composite(px!, py!), [x, y]);
const state = (page: Page) => page.evaluate(() => (window as unknown as Hook).__pixelcraft.state());

async function dragPx(page: Page, from: [number, number], to: [number, number], opts: { button?: 'left' | 'right'; modifiers?: string[] } = {}): Promise<void> {
  const a = await pixelToPage(page, ...from);
  const b = await pixelToPage(page, ...to);
  for (const m of opts.modifiers ?? []) await page.keyboard.down(m);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down({ button: opts.button ?? 'left' });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up({ button: opts.button ?? 'left' });
  for (const m of opts.modifiers ?? []) await page.keyboard.up(m);
}

async function newDoc(page: Page, w: number, h: number): Promise<void> {
  await page.getByTestId('start-new').click();
  await page.getByTestId('project-width').fill(String(w));
  await page.getByTestId('project-width').press('Tab');
  await page.getByTestId('project-height').fill(String(h));
  await page.getByTestId('project-height').press('Tab');
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('editor-canvas')).toBeVisible();
}

async function menu(page: Page, top: string, ...path: string[]): Promise<void> {
  await page.getByRole('menuitem', { name: top, exact: true }).click();
  for (const p of path) await page.getByRole('menuitem', { name: p }).first().click();
}

test('selections, clipboard, move and layers', async () => {
  const { app, page } = await launch();
  await newDoc(page, 16, 16);
  await page.getByTestId('palette-10').click();

  // Filled rectangle, then select part of it and copy into a new layer.
  await page.keyboard.press('Shift+U');
  await dragPx(page, [2, 2], [5, 5]);
  expect(await pixel(page, 3, 3)).toBe(0xe8434fff);

  await page.keyboard.press('m');
  await dragPx(page, [2, 2], [3, 3]);
  expect((await state(page)).selection).toMatchObject({ x: 2, y: 2, w: 2, h: 2 });

  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+Shift+v');
  const s = await state(page);
  expect(s.layerNames).toHaveLength(2);
  expect(s.activeLayer).toBe('Colado');
  expect(s.tool).toBe('move');
  await expect(page.getByTestId('layer-row')).toHaveCount(2);

  // Move the pasted pixels 8 px right in one step; undo restores.
  await dragPx(page, [2, 2], [10, 2]);
  expect(await pixel(page, 10, 2)).toBe(0xe8434fff);
  expect(await pixel(page, 2, 2)).toBe(0);
  expect((await state(page)).selection).toMatchObject({ x: 10, y: 2 });
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 2, 2)).toBe(0xe8434fff);
  await page.keyboard.press('Control+y');

  // Arrow-key nudge
  await page.keyboard.press('ArrowDown');
  expect(await pixel(page, 10, 3)).toBe(0xe8434fff);
  expect((await state(page)).selection).toMatchObject({ x: 10, y: 3 });

  // Deselect, hide the pasted layer from the panel, composite loses the pixel.
  await page.keyboard.press('Control+d');
  expect((await state(page)).selection).toBeNull();
  await page.getByTestId('layer-row').first().getByTestId('layer-visibility').click();
  expect(await composite(page, 10, 3)).toBe(0);
  await page.keyboard.press('Control+z');
  expect(await composite(page, 10, 3)).toBe(0xe8434fff);

  // Rename by double click
  await page.getByTestId('layer-row').first().dblclick();
  await page.getByLabel('Nome da camada').fill('Detalhe');
  await page.getByLabel('Nome da camada').press('Enter');
  expect((await state(page)).layerNames).toContain('Detalhe');

  if (process.env.PIXELCRAFT_SHOTS) await page.screenshot({ path: join(process.env.PIXELCRAFT_SHOTS, 'phase2-layers.png') });

  // New layer + merge down
  await page.getByTestId('layer-add').click();
  expect((await state(page)).layerNames).toHaveLength(3);
  await page.keyboard.press('Control+e');
  expect((await state(page)).layerNames).toHaveLength(2);

  // Bucket fill inside the base rectangle on the bottom layer
  await page.getByTestId('layer-row').last().click();
  await page.getByTestId('palette-20').click();
  await page.keyboard.press('g');
  const p = await pixelToPage(page, 0, 15);
  await page.mouse.click(p.x, p.y);
  expect(await pixel(page, 0, 15)).not.toBe(0);
  expect(await pixel(page, 3, 3)).toBe(0xe8434fff);

  // Magic wand selects the red block (16 px)
  await page.keyboard.press('w');
  const w = await pixelToPage(page, 3, 3);
  await page.mouse.click(w.x, w.y);
  expect((await state(page)).selection?.area).toBe(16);
  await page.keyboard.press('Delete');
  expect(await pixel(page, 3, 3)).toBe(0);

  // History panel jumps back
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('history-list')).toBeVisible();
  await page.getByRole('button', { name: 'Estado inicial' }).click();
  expect(await composite(page, 3, 3)).toBe(0);
  expect((await state(page)).layerNames).toHaveLength(1);
  await page.getByTestId('tab-layers').click();
  await quit(app);
});

test('image operations, palettes and preferences', async () => {
  const { app, page, home } = await launch();
  await newDoc(page, 8, 8);
  await page.getByTestId('palette-10').click();
  await page.keyboard.press('b');
  const a = await pixelToPage(page, 0, 0);
  await page.mouse.click(a.x, a.y);

  // Resize canvas to 12×10 anchored at the centre through the dialog.
  await menu(page, 'Imagem', 'Tamanho da tela…');
  await expect(page.getByTestId('resize-canvas-dialog')).toBeVisible();
  await page.getByLabel('Manter proporção').uncheck();
  await page.getByTestId('size-width').fill('12');
  await page.getByTestId('size-width').press('Tab');
  await page.getByTestId('size-height').fill('10');
  await page.getByTestId('size-height').press('Tab');
  await page.getByRole('radio', { name: 'centro', exact: true }).click();
  await page.getByTestId('resize-apply').click();
  let s = await state(page);
  expect([s.width, s.height]).toEqual([12, 10]);
  expect(await pixel(page, 2, 1)).toBe(0xe8434fff);

  // Rotate and flip keep the pixel, undo is atomic.
  await menu(page, 'Imagem', 'Girar', 'Girar 90° horário');
  s = await state(page);
  expect([s.width, s.height]).toEqual([10, 12]);
  await page.keyboard.press('Control+z');
  expect((await state(page)).width).toBe(12);

  // Trim back to the single pixel
  await menu(page, 'Imagem', 'Aparar bordas transparentes');
  s = await state(page);
  expect([s.width, s.height]).toEqual([1, 1]);

  // Palette: add primary, import a GPL file, export as HEX
  const before = (await state(page)).palette;
  await page.getByTestId('palette-add').click();
  expect((await state(page)).palette).toBe(before + 1);

  const gpl = join(home, 'retro.gpl');
  writeFileSync(gpl, 'GIMP Palette\nName: Retro\n#\n255 0 0\n0 255 0\n0 0 255\n');
  await stubOpenDialog(app, [gpl]);
  await page.getByTestId('palette-import').click();
  await expect(page.getByTestId('toast-success').first()).toContainText('Retro');
  expect((await state(page)).palette).toBe(3);

  const hex = join(home, 'out.hex');
  await stubSaveDialog(app, hex);
  await page.getByTestId('palette-export').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: 'HEX' })).toBeVisible();
  expect(readFileSync(hex, 'utf8')).toBe('ff0000\n00ff00\n0000ff\n');

  // Palette tools reports the colour count
  await page.getByTestId('palette-tools').click();
  await expect(page.getByTestId('color-count')).toContainText('1');
  await expect(page.getByTestId('out-of-palette')).toBeVisible();
  await page.keyboard.press('Escape');

  // Preferences: switching theme applies immediately
  await page.keyboard.press('Control+,');
  await expect(page.getByTestId('preferences-dialog')).toBeVisible();
  await page.getByLabel('Tema').selectOption('light');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  if (process.env.PIXELCRAFT_SHOTS) await page.screenshot({ path: join(process.env.PIXELCRAFT_SHOTS, 'phase2-prefs.png') });
  await page.getByRole('button', { name: 'Concluir' }).click();
  await quit(app);
});
