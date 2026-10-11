import { describe, expect, it } from 'vitest';
import { blendPixel } from '../../src/raster/blend';
import { colorDistance, hslToRgb, parseHex, rgbToHsl, rgba, toHex, hsvToRgb, rgbToHsv } from '../../src/raster/color';
import { PixelBuffer } from '../../src/raster/pixel-buffer';
import { scaleInteger, resizeNearest } from '../../src/raster/scale';
import { brushFootprint, constrainLine, ellipseFilled, ellipseOutline, line, rectOutline } from '../../src/raster/shapes';

function plotToGrid(w: number, h: number, draw: (plot: (x: number, y: number) => void) => void): string {
  const g = Array.from({ length: h }, () => Array<string>(w).fill('.'));
  draw((x, y) => {
    if (x >= 0 && y >= 0 && x < w && y < h) g[y]![x] = '#';
  });
  return g.map((r) => r.join('')).join('\n');
}

describe('color', () => {
  it('packs and formats hex', () => {
    expect(toHex(rgba(255, 128, 0))).toBe('#ff8000');
    expect(toHex(rgba(1, 2, 3, 4))).toBe('#01020304');
    expect(parseHex('#f80')).toBe(rgba(255, 136, 0));
    expect(parseHex('ff800080')).toBe(rgba(255, 128, 0, 128));
    expect(parseHex('#zzz')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
  });
  it('round-trips HSL and HSV for primaries', () => {
    for (const c of [rgba(255, 0, 0), rgba(0, 255, 0), rgba(0, 0, 255), rgba(10, 200, 77), rgba(128, 128, 128)]) {
      expect(hslToRgb(rgbToHsl(c))).toBe(c);
      expect(hsvToRgb(rgbToHsv(c))).toBe(c);
    }
  });
  it('treats all fully transparent colors as equal', () => {
    expect(colorDistance(rgba(255, 0, 0, 0), rgba(0, 0, 255, 0))).toBe(0);
    expect(colorDistance(rgba(0, 0, 0), rgba(255, 255, 255))).toBeGreaterThan(80);
  });
});

describe('shapes', () => {
  it('draws a connected diagonal line including both endpoints', () => {
    const pts: string[] = [];
    line(0, 0, 3, 3, (x, y) => pts.push(`${x},${y}`));
    expect(pts).toEqual(['0,0', '1,1', '2,2', '3,3']);
  });
  it('draws lines in every direction without gaps', () => {
    for (const [x1, y1] of [[7, 2], [-5, 3], [2, -7], [-4, -4], [0, 6]] as const) {
      const pts: [number, number][] = [];
      line(0, 0, x1, y1, (x, y) => pts.push([x, y]));
      expect(pts[0]).toEqual([0, 0]);
      expect(pts.at(-1)).toEqual([x1, y1]);
      for (let i = 1; i < pts.length; i++) {
        expect(Math.abs(pts[i]![0] - pts[i - 1]![0])).toBeLessThanOrEqual(1);
        expect(Math.abs(pts[i]![1] - pts[i - 1]![1])).toBeLessThanOrEqual(1);
      }
    }
  });
  it('constrains lines to 0/45/90 degrees', () => {
    expect(constrainLine({ x: 0, y: 0 }, { x: 10, y: 2 })).toEqual({ x: 10, y: 0 });
    expect(constrainLine({ x: 0, y: 0 }, { x: 1, y: 9 })).toEqual({ x: 0, y: 9 });
    expect(constrainLine({ x: 0, y: 0 }, { x: 5, y: -4 })).toEqual({ x: 5, y: -5 });
  });
  it('draws a rectangle outline', () => {
    expect(plotToGrid(5, 4, (p) => rectOutline(0, 0, 4, 3, p))).toBe('#####\n#...#\n#...#\n#####');
  });
  it('draws a symmetric ellipse of even and odd sizes', () => {
    for (const [w, h] of [[8, 6], [7, 5], [10, 10], [3, 3], [1, 5], [6, 1]] as const) {
      const g = plotToGrid(w, h, (p) => ellipseOutline(0, 0, w - 1, h - 1, p));
      const rows = g.split('\n');
      // touches all four sides of its box
      expect(rows[0]).toContain('#');
      expect(rows.at(-1)).toContain('#');
      expect(rows.some((r) => r[0] === '#')).toBe(true);
      expect(rows.some((r) => r[w - 1] === '#')).toBe(true);
      // mirror-symmetric horizontally and vertically
      for (const r of rows) expect(r).toBe([...r].reverse().join(''));
      expect(rows).toEqual([...rows].reverse());
    }
  });
  it('fills an ellipse fully inside its outline', () => {
    const filled = plotToGrid(9, 7, (p) => ellipseFilled(0, 0, 8, 6, p));
    const outline = plotToGrid(9, 7, (p) => ellipseOutline(0, 0, 8, 6, p));
    for (let i = 0; i < filled.length; i++) if (outline[i] === '#') expect(filled[i]).toBe('#');
    expect(filled.split('\n')[3]).toBe('#########');
  });
  it('builds square and round brush footprints', () => {
    expect(brushFootprint(1, 'square')).toEqual([{ x: 0, y: 0 }]);
    expect(brushFootprint(2, 'square')).toHaveLength(4);
    expect(brushFootprint(3, 'circle')).toHaveLength(5); // plus shape
    expect(brushFootprint(5, 'circle').length).toBeLessThan(25);
  });
});

describe('PixelBuffer', () => {
  it('extracts, pastes and diffs regions', () => {
    const a = new PixelBuffer(4, 4);
    a.set(1, 2, rgba(9, 9, 9));
    const b = a.clone();
    b.set(3, 3, rgba(1, 1, 1));
    b.set(2, 0, rgba(1, 1, 1));
    expect(a.diffBounds(b)).toEqual({ x: 2, y: 0, w: 2, h: 4 });
    const part = b.extract({ x: 2, y: 0, w: 2, h: 4 });
    const c = a.clone();
    c.paste(part, 2, 0);
    expect(c.equals(b)).toBe(true);
    expect(a.contentBounds()).toEqual({ x: 1, y: 2, w: 1, h: 1 });
  });
  it('rejects mismatched data sizes', () => {
    expect(() => new PixelBuffer(2, 2, new Uint8ClampedArray(3))).toThrow();
  });
});

describe('blend', () => {
  it('keeps opaque normal pixels exact', () => {
    const d = new Uint8ClampedArray([10, 20, 30, 255]);
    blendPixel(d, 0, 200, 100, 50, 255, 1, 'normal');
    expect([...d]).toEqual([200, 100, 50, 255]);
  });
  it('mixes half transparent colors over opaque', () => {
    const d = new Uint8ClampedArray([0, 0, 0, 255]);
    blendPixel(d, 0, 255, 255, 255, 128, 1, 'normal');
    expect(d[0]).toBe(128);
    expect(d[3]).toBe(255);
  });
  it('multiplies and screens', () => {
    const m = new Uint8ClampedArray([255, 128, 0, 255]);
    blendPixel(m, 0, 128, 128, 128, 255, 1, 'multiply');
    expect([...m]).toEqual([128, 64, 0, 255]);
    const s = new Uint8ClampedArray([0, 128, 255, 255]);
    blendPixel(s, 0, 128, 128, 128, 255, 1, 'screen');
    expect([...s]).toEqual([128, 192, 255, 255]);
    const a = new Uint8ClampedArray([200, 100, 0, 255]);
    blendPixel(a, 0, 100, 100, 100, 255, 1, 'add');
    expect([...a]).toEqual([255, 200, 100, 255]);
  });
  it('applies layer opacity', () => {
    const d = new Uint8ClampedArray([0, 0, 0, 0]);
    blendPixel(d, 0, 255, 0, 0, 255, 0.5, 'normal');
    expect([...d]).toEqual([255, 0, 0, 128]);
  });
});

describe('scale', () => {
  it('upscales with nearest neighbour', () => {
    const a = new PixelBuffer(2, 1);
    a.set(0, 0, rgba(255, 0, 0));
    a.set(1, 0, rgba(0, 0, 255, 100));
    const s = scaleInteger(a, 3);
    expect(s.width).toBe(6);
    expect(s.height).toBe(3);
    expect(s.get(2, 2)).toBe(rgba(255, 0, 0));
    expect(s.get(3, 0)).toBe(rgba(0, 0, 255, 100));
    expect(resizeNearest(s, 2, 1).equals(a)).toBe(true);
  });
});
