import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launch, quit } from './fixtures';


// axe-core is evaluated through the debugger protocol, which is not subject
// to the app's Content-Security-Policy (an injected <script> would be).
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

interface Violation {
  id: string;
  impact: string;
  help: string;
  nodes: { target: string[] }[];
}

async function audit(page: Page, label: string): Promise<string[]> {
  await page.evaluate(AXE);
  const violations = (await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(ctx: Document, o: object): Promise<{ violations: unknown[] }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return r.violations;
  })) as Violation[];
  return violations.map((v) => `${label}: ${v.id} (${v.impact}) ${v.help} -> ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

test('no WCAG A/AA violations on the main screens', async () => {
  const { app, page } = await launch();
  const problems: string[] = [];
  await expect(page.getByTestId('quick-16x16')).toBeVisible();
  problems.push(...(await audit(page, 'início')));
  await page.getByTestId('quick-16x16').click();
  await expect(page.getByTestId('timeline')).toBeVisible();
  problems.push(...(await audit(page, 'editor')));
  for (const [key, id, label] of [
    ['Control+Shift+e', 'export-png-dialog', 'exportar'],
    ['Control+,', 'preferences-dialog', 'preferências'],
    ['F1', 'shortcuts-dialog', 'atalhos'],
    ['Control+k', 'command-palette', 'paleta de comandos'],
    ['Control+n', 'new-project-dialog', 'novo projeto'],
    ['Control+Alt+c', 'resize-canvas-dialog', 'tamanho da tela'],
    ['Control+Alt+i', 'resize-content-dialog', 'redimensionar'],
    ['Control+Alt+g', 'export-gif-dialog', 'exportar GIF'],
    ['Control+Alt+s', 'export-spritesheet-dialog', 'exportar spritesheet'],
    ['Control+Alt+p', 'document-properties-dialog', 'propriedades'],
    ['Control+Shift+r', 'recent-dialog', 'recentes'],
  ] as const) {
    await page.keyboard.press(key);
    await expect(page.getByTestId(id)).toBeVisible();
    problems.push(...(await audit(page, label)));
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(id)).toBeHidden();
  }
  // Dialogs opened from menus / tools
  for (const [menu, item, id] of [
    ['Imagem', 'Tiles e tileset…', 'tiles-dialog'],
    ['Ajuda', 'Sobre o PixelCraft', 'about-dialog'],
    ['Ajuda', 'Informações de diagnóstico', 'diagnostics-dialog'],
  ] as const) {
    await page.getByRole('menuitem', { name: menu, exact: true }).click();
    await page.getByRole('menuitem', { name: item }).click();
    await expect(page.getByTestId(id)).toBeVisible();
    problems.push(...(await audit(page, id)));
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(id)).toBeHidden();
  }
  await page.keyboard.press('t');
  const box = (await page.getByTestId('editor-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('text-dialog')).toBeVisible();
  problems.push(...(await audit(page, 'texto')));
  await page.keyboard.press('Escape');

  // Light theme too
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  problems.push(...(await audit(page, 'editor (tema claro)')));
  console.log(problems.join('\n'));
  expect(problems).toEqual([]);
  await quit(app);
});

test('first-run tutorial appears once and can be turned off', async () => {
  const { app, page } = await launch({ tutorial: true });
  await page.getByTestId('quick-16x16').click();
  await expect(page.getByTestId('tutorial-dialog')).toBeVisible();
  if (process.env.PIXELCRAFT_SHOTS) await page.screenshot({ path: `${process.env.PIXELCRAFT_SHOTS}/phase6-tutorial.png` });
  {
    const found = await audit(page, 'tutorial');
    expect(found).toEqual([]);
  }
  for (let i = 0; i < 4; i++) await page.getByTestId('tutorial-next').click();
  await page.getByLabel('Mostrar ao abrir').uncheck();
  await page.getByTestId('tutorial-done').click();
  await expect(page.getByTestId('tutorial-dialog')).toBeHidden();
  // Reopen from the Help menu
  await page.getByRole('menuitem', { name: 'Ajuda', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Primeiros passos' }).click();
  await expect(page.getByTestId('tutorial-dialog')).toBeVisible();
  await quit(app);
});
