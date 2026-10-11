import { describe, expect, it } from 'vitest';
import { getTool, type ToolPointer } from '../../src/editor/tools';
import { stampText, textBounds } from '../../src/editor/text-ops';
import { activeImage, ascii, makeHost, newSession, RED } from './helpers';

const pt = (x: number, y: number, pressure?: number): ToolPointer => ({ x, y, fx: x + 0.5, fy: y + 0.5, slot: 'primary', shift: false, ctrl: false, alt: false, ...(pressure === undefined ? {} : { pressure }) });

describe('pen pressure', () => {
  it('scales freehand strokes from 1 px up to the chosen size', () => {
    const s = newSession(20, 9);
    const host = makeHost(s, { size: 5, shape: 'square', pressureSize: true });
    const pencil = getTool('pencil')!;
    pencil.onDown(pt(2, 4, 0), host);
    pencil.onMove(pt(16, 4, 1), host);
    pencil.onUp(pt(16, 4, 1), host);
    const img = activeImage(s)!;
    const column = (x: number) => [...Array(9).keys()].filter((y) => img.get(x, y) !== 0).length;
    expect(column(2)).toBe(1);
    expect(column(16)).toBe(5);
  });

  it('is ignored without the option or without a pen', () => {
    const s = newSession(10, 9);
    const host = makeHost(s, { size: 3, shape: 'square' });
    const pencil = getTool('pencil')!;
    pencil.onDown(pt(4, 4, 0), host);
    pencil.onUp(pt(4, 4, 0), host);
    expect(ascii(activeImage(s), 10, 9).split('\n')[3]).toBe('...###....');
    const s2 = newSession(10, 9);
    const h2 = makeHost(s2, { size: 3, shape: 'square', pressureSize: true });
    pencil.onDown(pt(4, 4), h2);
    pencil.onUp(pt(4, 4), h2);
    expect(ascii(activeImage(s2), 10, 9).split('\n')[3]).toBe('...###....');
  });
});

describe('text from another font', () => {
  it('stamps a pre-rasterized mask instead of the pixel font', () => {
    const s = newSession(8, 8);
    const mask = { width: 3, height: 2, mask: Uint8Array.of(1, 0, 1, 0, 1, 0) };
    expect(textBounds('ignored', 2, 3, { mask })).toEqual({ x: 2, y: 3, w: 3, h: 2 });
    stampText(s, 'ignored', 2, 3, { color: RED, mask });
    expect(ascii(activeImage(s), 8, 8).split('\n').slice(3, 5)).toEqual(['..#.#...', '...#....']);
  });
});
