import { expect, test, type Page } from '@playwright/test';
import { launch, pixelToPage, quit } from './fixtures';

interface Snapshot {
  selection: { x: number; y: number; w: number; h: number; area: number } | null;
  history: string[];
  tool: string;
  frames: number;
  activeFrame: number;
}

type Hook = { __pixelcraft: { pixel(x: number, y: number): number; state(): Snapshot } };
const pixel = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => (window as unknown as Hook).__pixelcraft.pixel(px!, py!), [x, y]);
const state = (page: Page) => page.evaluate(() => (window as unknown as Hook).__pixelcraft.state());

async function dragPx(page: Page, from: [number, number], to: [number, number], steps = 4): Promise<void> {
  const a = await pixelToPage(page, ...from);
  const b = await pixelToPage(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
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

test('drawing tools, inks and on-canvas transform', async () => {
  const { app, page } = await launch();
  await newDoc(page, 16, 16);

  // Pixel-perfect pencil: a stair stroke keeps no L corners.
  await page.getByTestId('tool-pencil').click();
  await page.getByLabel('Pixel perfeito').check();
  const path: [number, number][] = [[1, 1], [2, 1], [2, 2], [3, 2], [3, 3]];
  const pts = await Promise.all(path.map((p) => pixelToPage(page, ...p)));
  await page.mouse.move(pts[0]!.x, pts[0]!.y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y);
  await page.mouse.up();
  expect(await pixel(page, 1, 1)).not.toBe(0);
  expect(await pixel(page, 2, 1)).toBe(0);
  expect(await pixel(page, 2, 2)).not.toBe(0);
  expect(await pixel(page, 3, 3)).not.toBe(0);

  // Lock-alpha ink: a line across the canvas only recolours existing pixels.
  await page.getByTestId('tool-line').click();
  await page.getByLabel('Tinta').selectOption('lock-alpha');
  await page.getByTestId('palette-10').click();
  await dragPx(page, [0, 2], [15, 2]);
  expect(await pixel(page, 2, 2)).toBe(0xe8434fff);
  expect(await pixel(page, 8, 2)).toBe(0);
  await page.getByLabel('Tinta').selectOption('simple');

  // Spray lands inside its circle.
  await page.keyboard.press('a');
  expect((await state(page)).tool).toBe('spray');
  await dragPx(page, [10, 10], [11, 10], 6);
  let sprayed = 0;
  for (let y = 0; y < 16; y++) for (let x = 6; x < 16; x++) if ((await pixel(page, x, y)) !== 0) sprayed++;
  expect(sprayed).toBeGreaterThan(0);
  await page.keyboard.press('Control+z');

  // Transform: select the stroke, rotate 90° by typing, apply with the button.
  await page.keyboard.press('m');
  await dragPx(page, [1, 1], [3, 3]);
  await page.keyboard.press('Control+t');
  expect((await state(page)).tool).toBe('transform');
  await page.getByTestId('transform-angle').fill('90');
  await page.getByTestId('transform-angle').press('Enter');
  await page.getByTestId('transform-apply').click();
  const st = await state(page);
  expect(st.history.at(-1)).toBe('Transformar');
  // The top-left pixel of the diagonal moved to the top-right after a clockwise turn.
  expect(await pixel(page, 3, 1)).not.toBe(0);
  expect(await pixel(page, 1, 1)).toBe(0);

  // Dragging inside the box moves it; Enter applies instead of playing.
  await page.keyboard.press('Control+t');
  await dragPx(page, [2, 2], [6, 2]);
  await page.keyboard.press('Enter');
  expect((await state(page)).history.at(-1)).toBe('Transformar');
  expect((await state(page)).selection).toMatchObject({ x: 5, y: 1 });

  await quit(app);
});

test('animation tags, frame range selection and copy/paste of frames', async () => {
  const { app, page } = await launch();
  await newDoc(page, 8, 8);
  // Three frames, each with a pixel in its own column.
  await page.getByTestId('tool-pencil').click();
  for (let i = 0; i < 3; i++) {
    if (i > 0) await page.getByTestId('frame-add').click();
    const p = await pixelToPage(page, i, 0);
    await page.mouse.click(p.x, p.y);
  }
  const cells = page.getByTestId('frame-cell');
  await expect(cells).toHaveCount(3);

  // Shift+click picks frames 2–3, then a tag is created from them.
  await cells.nth(1).click();
  await cells.nth(2).click({ modifiers: ['Shift'] });
  await page.getByTestId('tag-new').click();
  await expect(page.getByTestId('tag-from')).toHaveValue('2');
  await expect(page.getByTestId('tag-to')).toHaveValue('3');
  await page.getByTestId('tag-name').fill('andar');
  await page.getByTestId('tag-apply').click();
  await expect(page.getByTestId('tag-band-start')).toHaveText('andar');

  // Copy the two selected frames and paste them after the last one.
  await page.keyboard.press('Alt+c');
  await page.keyboard.press('Alt+v');
  await expect(cells).toHaveCount(5);
  expect((await state(page)).activeFrame).toBe(3);
  expect(await pixel(page, 1, 0)).not.toBe(0);

  // Edit the tag through its band, then delete it.
  await page.getByTestId('tag-band-start').click();
  await page.getByTestId('tag-name').fill('correr');
  await page.getByTestId('tag-apply').click();
  await expect(page.getByTestId('tag-band-start')).toHaveText('correr');
  await page.getByTestId('tag-band-start').click();
  await page.getByTestId('tag-delete').click();
  await expect(page.getByTestId('tag-band-start')).toHaveCount(0);

  await quit(app);
});
