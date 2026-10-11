import { expect, test, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../../src/import-export/png';
import { deserializeProject } from '../../src/project/serialize';
import { launch, pixelToPage, stubOpenDialog, stubSaveDialog } from './fixtures';

const pixel = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => (window as unknown as { __pixelcraft: { pixel(x: number, y: number): number } }).__pixelcraft.pixel(px!, py!), [x, y]);

test('create, draw, save, reopen and export a sprite', async () => {
  const { app, page, home } = await launch();
  await expect(page.getByTestId('start-screen')).toBeVisible();

  // New 16x16 project through the dialog
  await page.getByTestId('start-new').click();
  await page.getByTestId('project-name').fill('Herói');
  await page.getByTestId('project-width').fill('16');
  await page.getByTestId('project-width').press('Tab');
  await page.getByTestId('project-height').fill('16');
  await page.getByTestId('project-height').press('Tab');
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('doc-title')).toContainText('Herói');
  await expect(page.getByTestId('doc-title')).toContainText('16×16');

  // Pick a palette color and draw a horizontal line with the pencil
  await page.getByTestId('palette-10').click(); // #e8434f
  await page.keyboard.press('b');
  const a = await pixelToPage(page, 2, 3);
  const b = await pixelToPage(page, 9, 3);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 2 });
  await page.mouse.up();
  for (let x = 2; x <= 9; x++) expect(await pixel(page, x, 3)).toBe(0xe8434fff);
  expect(await pixel(page, 10, 3)).toBe(0);

  // Rectangle with the secondary color (right button)
  await page.keyboard.press('u');
  const r0 = await pixelToPage(page, 1, 6);
  const r1 = await pixelToPage(page, 6, 10);
  await page.mouse.move(r0.x, r0.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(r1.x, r1.y, { steps: 3 });
  await page.mouse.up({ button: 'right' });
  expect(await pixel(page, 1, 6)).toBe(0xffffffff);
  expect(await pixel(page, 6, 10)).toBe(0xffffffff);
  expect(await pixel(page, 3, 8)).toBe(0); // outline only

  // Undo / redo via keyboard
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 1, 6)).toBe(0);
  await page.keyboard.press('Control+y');
  expect(await pixel(page, 1, 6)).toBe(0xffffffff);

  // Eraser removes one pixel
  await page.keyboard.press('e');
  const e = await pixelToPage(page, 5, 3);
  await page.mouse.click(e.x, e.y);
  expect(await pixel(page, 5, 3)).toBe(0);
  await expect(page.locator('.dirty-dot')).toBeVisible();

  // Save (Ctrl+S → save dialog)
  const projectPath = join(home, 'heroi.pixelcraft');
  await stubSaveDialog(app, projectPath);
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('toast-success').first()).toContainText('salvo');
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  expect(existsSync(projectPath)).toBe(true);
  const doc = deserializeProject(new Uint8Array(readFileSync(projectPath)));
  expect(doc.state.width).toBe(16);
  const img = [...doc.images.values()][0]!;
  expect(img.get(2, 3)).toBe(0xe8434fff);
  expect(img.get(5, 3)).toBe(0);

  // Export PNG at 4x
  const pngPath = join(home, 'heroi@4x.png');
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('export-png-dialog')).toBeVisible();
  await page.getByRole('radio', { name: '4×' }).click();
  await expect(page.getByTestId('export-dims')).toHaveText('64×64 px');
  await stubSaveDialog(app, pngPath);
  await page.getByTestId('export-confirm').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: 'PNG exportado' })).toBeVisible();
  const png = decodePng(new Uint8Array(readFileSync(pngPath)));
  expect(png.width).toBe(64);
  expect(png.height).toBe(64);
  expect(png.get(8, 12)).toBe(0xe8434fff); // pixel (2,3) scaled
  expect(png.get(11, 15)).toBe(0xe8434fff);
  expect(png.get(20, 12)).toBe(0); // erased pixel (5,3) stays transparent
  expect(png.get(0, 0)).toBe(0);

  // Close and reopen from the recent list
  await page.keyboard.press('Control+w');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await expect(page.getByTestId('recent-list')).toContainText('heroi');
  await page.getByTestId('recent-list').getByRole('button', { name: /heroi/i }).first().click();
  await expect(page.getByTestId('doc-title')).toContainText('heroi');
  expect(await pixel(page, 2, 3)).toBe(0xe8434fff);
  expect(await pixel(page, 1, 6)).toBe(0xffffffff);
  await page.screenshot({ path: 'test-results/phase1-reopened.png' });

  // Edit and save again over the same file
  await page.keyboard.press('b');
  const p = await pixelToPage(page, 15, 15);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Control+s');
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const again = deserializeProject(new Uint8Array(readFileSync(projectPath)));
  expect([...again.images.values()][0]!.get(15, 15)).toBe(0xe8434fff);
  await app.close();
});

test('opens a project through the open dialog and rejects invalid files', async () => {
  const { app, page, home } = await launch();
  const bad = join(home, 'quebrado.pixelcraft');
  (await import('node:fs')).writeFileSync(bad, 'isto não é um zip');
  await stubOpenDialog(app, [bad]);
  await page.getByTestId('start-open').click();
  await expect(page.getByTestId('toast-error')).toContainText('Não foi possível abrir');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await app.close();
});

test('asks before discarding unsaved changes', async () => {
  const { app, page } = await launch();
  await page.getByTestId('quick-16x16').click();
  const p = await pixelToPage(page, 1, 1);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Control+w');
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByTestId('editor-canvas')).toBeVisible();
  await page.keyboard.press('Control+w');
  await page.getByTestId('confirm-alt').click();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await app.close();
});
