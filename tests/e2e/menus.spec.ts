import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { launch, pixelToPage, quit, stubSaveDialog } from './fixtures';

type Hook = { __pixelcraft: { pixel(x: number, y: number): number; state(): { layers: number; layerNames: string[]; history: string[] } } };
const state = (page: Page) => page.evaluate(() => (window as unknown as Hook).__pixelcraft.state());

async function menu(page: Page, top: string, item: string | RegExp): Promise<void> {
  await page.getByRole('menuitem', { name: top, exact: true }).click();
  await page.getByRole('menu').getByText(item, { exact: typeof item === 'string' }).first().click();
}

test('project properties, guides, playback modes, recents, diagnostics, duplicate and text layer', async () => {
  const { app, page, home } = await launch();
  await page.getByTestId('quick-16x16').click();

  // Properties: add a guide and switch to ping-pong
  await menu(page, 'Arquivo', 'Propriedades do projeto…');
  await expect(page.getByTestId('document-properties-dialog')).toBeVisible();
  await page.getByTestId('guide-add').click();
  await expect(page.getByTestId('guide-list').locator('li')).toHaveCount(1);
  await page.getByLabel('Repetição').selectOption('pingpong');
  expect((await state(page)).history.slice(-2)).toEqual(['Adicionar guia', 'Configurar animação']);
  await page.keyboard.press('Escape');

  // The Animation menu reflects and changes the mode
  await page.getByRole('menuitem', { name: 'Animação', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Modo de reprodução' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: /Vai e volta/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemcheckbox', { name: /Tocar uma vez/ }).click();
  expect((await state(page)).history.at(-1)).toBe('Configurar animação');

  // Duplicate selection (Edit menu)
  await page.getByTestId('palette-10').click();
  await page.keyboard.press('b');
  const p = await pixelToPage(page, 2, 2);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Control+a');
  await menu(page, 'Editar', 'Duplicar seleção');
  expect(await page.evaluate(() => (window as unknown as Hook).__pixelcraft.pixel(3, 3))).toBe(0xe8434fff);
  expect(await page.evaluate(() => (window as unknown as Hook).__pixelcraft.pixel(2, 2))).toBe(0xe8434fff);
  await page.keyboard.press('Control+d');

  // Text on its own layer
  const layers = (await state(page)).layers;
  await page.keyboard.press('t');
  const t = await pixelToPage(page, 1, 8);
  await page.mouse.click(t.x, t.y);
  await page.getByTestId('text-input').fill('Ok');
  await page.getByLabel('Criar em uma nova camada').check();
  await page.getByTestId('text-apply').click();
  const after = await state(page);
  expect(after.layers).toBe(layers + 1);
  expect(after.layerNames).toContain('Ok');
  expect(after.history.at(-1)).toBe('Texto em nova camada');

  // Save, then the project shows up in Abrir recentes
  await stubSaveDialog(app, join(home, 'menus.pixelcraft'));
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('toast-success').filter({ hasText: 'Projeto salvo' })).toBeVisible();
  await page.keyboard.press('Control+Shift+r');
  await expect(page.getByTestId('recent-dialog')).toContainText('menus.pixelcraft');
  await page.keyboard.press('Escape');

  // Diagnostics report
  await menu(page, 'Ajuda', 'Informações de diagnóstico');
  await expect(page.getByLabel('Relatório de diagnóstico')).toHaveValue(/PixelCraft \d+\.\d+\.\d+[\s\S]*Documento: 16×16, 2 camadas/);
  await quit(app);
});
