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

test('memory returns to baseline after opening and closing documents repeatedly', async () => {
  const { app, page } = await launch({ args: ['--js-flags=--expose-gc'] });
  const heap = async (): Promise<number> =>
    page.evaluate(async () => {
      const w = window as unknown as { gc?: () => void };
      for (let i = 0; i < 3; i++) {
        w.gc?.();
        await new Promise((r) => setTimeout(r, 50));
      }
      return (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
    });
  expect(await page.evaluate(() => typeof (window as unknown as { gc?: unknown }).gc)).toBe('function');

  const cycle = async (): Promise<void> => {
    await page.getByTestId('quick-16x16').waitFor();
    await page.keyboard.press('Control+n');
    await page.getByTestId('project-width').fill('512');
    await page.getByTestId('project-width').press('Tab');
    await page.getByTestId('project-height').fill('512');
    await page.getByTestId('project-height').press('Tab');
    await page.getByTestId('create-project').click();
    await page.keyboard.press('g');
    const p = await pixelToPage(page, 10, 10);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press('Control+Shift+n');
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press('Control+w');
    await page.getByTestId('confirm-alt').click();
  };
  // Pixel buffers live outside the JS heap, so also watch the renderer's resident memory.
  const rendererMB = async (): Promise<number> =>
    app.evaluate(({ app: a }) => Math.max(...a.getAppMetrics().filter((m) => m.type === 'Tab').map((m) => m.memory.workingSetSize)) / 1024);
  for (let i = 0; i < 3; i++) await cycle();
  const base = await heap();
  const baseRss = await rendererMB();
  for (let i = 0; i < 15; i++) await cycle();
  const end = await heap();
  const endRss = await rendererMB();
  const growth = (end - base) / 1024 / 1024;
  console.log(`[memória] heap JS ${(base / 1048576).toFixed(1)} → ${(end / 1048576).toFixed(1)} MB; renderer ${baseRss.toFixed(0)} → ${endRss.toFixed(0)} MB`);
  // Each cycle allocates ~2 MB of pixels plus undo data: a leak would add ~30+ MB.
  expect(growth).toBeLessThan(8);
  expect(endRss - baseRss).toBeLessThan(40);
  await quit(app);
});
