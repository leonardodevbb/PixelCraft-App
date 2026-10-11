import { expect, test } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, pixelToPage, quit } from './fixtures';

type Hook = { __pixelcraft: { pixel(x: number, y: number): number; state(): { dirty: boolean } } };

test('recovers unsaved work after the app is killed', async () => {
  const first = await launch({ settings: { autosaveSeconds: 1 } });
  const { page, home } = first;
  await page.getByTestId('quick-16x16').click();
  await page.getByTestId('palette-10').click();
  await page.keyboard.press('b');
  const p = await pixelToPage(page, 3, 4);
  await page.mouse.click(p.x, p.y);
  const dir = join(home, 'data', 'pixelcraft', 'recovery');
  await expect.poll(() => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.pixelcraft')).length : 0), { timeout: 10_000 }).toBe(1);

  // Simulate a crash: no close handshake, no cleanup.
  first.app.process().kill('SIGKILL');

  const second = await launch({ home });
  const page2 = second.page;
  await expect(page2.getByRole('heading', { name: 'Recuperar trabalho não salvo' })).toBeVisible();
  await page2.getByRole('button', { name: /Sem título/ }).first().click();
  await expect(page2.getByTestId('toast-success').filter({ hasText: 'foi recuperado' })).toBeVisible();
  expect(await page2.evaluate(() => (window as unknown as Hook).__pixelcraft.pixel(3, 4))).toBe(0xe8434fff);
  expect((await page2.evaluate(() => (window as unknown as Hook).__pixelcraft.state())).dirty).toBe(true);
  await quit(second.app);
});
