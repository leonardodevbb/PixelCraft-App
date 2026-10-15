import { describe, expect, it } from 'vitest';
import { rgba, TRANSPARENT } from '../../src/raster/color';
import { PixelBuffer } from '../../src/raster/pixel-buffer';
import { renderPlacement, scale2x } from '../../src/raster/transform';
import { transformTool } from '../../src/editor/tools/transform-tool';
import { borderSelection, colorSelection, contractSelection, expandSelection, rectSelection, selectionArea } from '../../src/editor/selection';
import { activeImage, ascii, BLUE, drag, makeHost, newSession, RED } from './helpers';

function fromAscii(rows: string[], colors: Record<string, number> = { '#': RED, B: BLUE }): PixelBuffer {
  const b = new PixelBuffer(rows[0]!.length, rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch !== '.' && b.set(x, y, colors[ch]!)));
  return b;
}

describe('scale2x', () => {
  it('rounds the inside corner of an L instead of making blocks', () => {
    const src = fromAscii(['##', '#.']);
    const out = scale2x(src);
    // The empty pixel loses its corner facing the L: a diagonal edge appears.
    expect(ascii(out, 4, 4)).toBe('####\n####\n###.\n##..');
  });
  it('never invents colours', () => {
    const src = fromAscii(['#B.', 'B#B', '.B#']);
    const out = scale2x(scale2x(src));
    const colors = new Set<number>();
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) colors.add(out.get(x, y));
    expect([...colors].sort()).toEqual([TRANSPARENT, BLUE, RED].sort());
  });
});

describe('renderPlacement', () => {
  const src = fromAscii(['##B', '#..']);
  it('reproduces the piece exactly with an identity placement', () => {
    const r = renderPlacement(src, { cx: 1.5, cy: 1, sx: 1, sy: 1, angle: 0 });
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.buffer.equals(src)).toBe(true);
  });
  it('rotates 90° losslessly', () => {
    const r = renderPlacement(src, { cx: 10, cy: 10, sx: 1, sy: 1, angle: 90 }, 'rotsprite');
    expect(r.buffer.width).toBe(2);
    expect(r.buffer.height).toBe(3);
    // Clockwise: the left column becomes the top row.
    expect(r.buffer.get(0, 0)).toBe(RED);
    expect(r.buffer.get(1, 0)).toBe(RED);
    expect(r.buffer.get(1, 2)).toBe(BLUE);
  });
  it('scales by 2 like nearest neighbour', () => {
    const r = renderPlacement(src, { cx: 3, cy: 2, sx: 2, sy: 2, angle: 0 });
    expect(r.buffer.width).toBe(6);
    expect(ascii(r.buffer, 6, 4)).toBe('######\n######\n##....\n##....');
  });
  it('mirrors with a negative scale', () => {
    const r = renderPlacement(src, { cx: 1.5, cy: 1, sx: -1, sy: 1, angle: 0 });
    expect(r.buffer.get(0, 0)).toBe(BLUE);
    expect(r.buffer.get(2, 1)).toBe(RED);
  });
  it('rotsprite at 45° keeps the original palette', () => {
    const big = fromAscii(['..##..', '.#BB#.', '#BBBB#', '#BBBB#', '.#BB#.', '..##..']);
    const r = renderPlacement(big, { cx: 3, cy: 3, sx: 1, sy: 1, angle: 45 }, 'rotsprite');
    for (let y = 0; y < r.buffer.height; y++) for (let x = 0; x < r.buffer.width; x++) expect([TRANSPARENT, RED, BLUE]).toContain(r.buffer.get(x, y));
  });
});

describe('transform tool', () => {
  function setup() {
    const s = newSession(8, 8);
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 1, y: 1 }, { x: 2, y: 1 }]);
    s.setSelection(rectSelection({ x: 1, y: 1, w: 2, h: 1 }));
    return { s, h };
  }
  it('moves the lifted piece and applies as one history entry with the new selection', () => {
    const { s, h } = setup();
    const before = s.history.entries.length;
    transformTool.activate(h);
    drag(h, 'transform', [{ x: 1, y: 1 }, { x: 4, y: 5 }]);
    transformTool.apply(h);
    expect(ascii(activeImage(s), 8, 8).split('\n')[5]).toBe('....##..');
    expect(activeImage(s)!.get(1, 1)).toBe(TRANSPARENT);
    expect(s.history.entries.length).toBe(before + 1);
    expect(s.selection!.bounds).toEqual({ x: 4, y: 5, w: 2, h: 1 });
  });
  it('scales from a corner handle, keeping the opposite corner in place', () => {
    const { s, h } = setup();
    transformTool.activate(h);
    // Bottom-right corner of the 2×1 piece is at document (3, 2).
    const t = transformTool;
    const ev = (fx: number, fy: number) => ({ x: Math.floor(fx), y: Math.floor(fy), fx, fy, slot: 'primary' as const, shift: false, ctrl: false, alt: false });
    t.onDown(ev(3, 2), h);
    t.onMove(ev(5, 3), h);
    t.onUp();
    t.apply(h);
    expect(ascii(activeImage(s), 8, 8).split('\n').slice(0, 4).join('\n')).toBe('........\n.####...\n.####...\n........');
  });
  it('rotates by a typed angle and cancels back to the original', () => {
    const { s, h } = setup();
    const img = activeImage(s)!.clone();
    transformTool.activate(h);
    transformTool.setParams(h, { angle: 90 });
    expect(transformTool.info!.angle).toBe(90);
    transformTool.cancel(h);
    expect(activeImage(s)!.equals(img)).toBe(true);
    expect(transformTool.active).toBe(false);
  });
  it('transforms the whole layer content when nothing is selected', () => {
    const s = newSession(6, 6);
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 2, y: 2 }]);
    transformTool.activate(h);
    transformTool.setParams(h, { sx: 3, sy: 3 });
    transformTool.apply(h);
    // Scaling is around the centre of the piece.
    expect(ascii(activeImage(s), 6, 6)).toBe('......\n.###..\n.###..\n.###..\n......\n......');
    expect(s.selection).toBeNull();
  });
  it('reports an empty layer', () => {
    const s = newSession(4, 4);
    const h = makeHost(s);
    transformTool.activate(h);
    expect(transformTool.active).toBe(false);
    expect(h.messages[0]).toMatch(/vazia/);
  });
});

describe('modify selection', () => {
  const sel = rectSelection({ x: 5, y: 5, w: 4, h: 4 });
  it('expands with a square or a round tip', () => {
    expect(selectionArea(expandSelection(sel, 1, 'square'))).toBe(36);
    // Round expansion leaves the far corners out.
    expect(selectionArea(expandSelection(sel, 2, 'circle'))).toBeLessThan(64);
  });
  it('contracts and returns null when nothing is left', () => {
    expect(contractSelection(sel, 1)!.bounds).toEqual({ x: 6, y: 6, w: 2, h: 2 });
    expect(contractSelection(sel, 2)).toBeNull();
  });
  it('border keeps a band along the edge', () => {
    expect(selectionArea(borderSelection(sel, 1)!)).toBe(12);
  });
  it('selects every pixel of a colour', () => {
    const img = fromAscii(['#.#', '.B.', '#..']);
    expect(selectionArea(colorSelection(img, RED, 0)!)).toBe(3);
    expect(selectionArea(colorSelection(img, rgba(250, 0, 0), 5)!)).toBe(3);
  });
});
