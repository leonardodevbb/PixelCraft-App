import { describe, expect, it } from 'vitest';
import { decodeBmp, encodeBmp, BmpError } from '../../src/import-export/bmp';
import { guessCellSize, sliceRects, sliceSheet } from '../../src/import-export/slice';
import { buildTilesetImage, extractTiles, tiledMapJson, tileGrid } from '../../src/import-export/tileset';
import { gradientColor, gradientT } from '../../src/raster/gradient';
import { PixelBuffer } from '../../src/raster/pixel-buffer';
import { stampText, textBounds } from '../../src/editor/text-ops';
import { documentFromFrames } from '../../src/project/create';
import { declaredSize, sniffImageType } from '../../src/import-export/browser-decode';
import { fuzzyScore } from '../../src/shortcuts/fuzzy';
import { newSession as makeSession, makeHost, drag } from './helpers';

const RED = 0xff0000ff;
const BLUE = 0x0000ffff;

describe('BMP', () => {
  it('round-trips 32-bit with alpha', () => {
    const img = new PixelBuffer(3, 2);
    img.set(0, 0, RED);
    img.set(2, 1, 0x11223380);
    const out = decodeBmp(encodeBmp(img), 1e6);
    expect(out.equals(img)).toBe(true);
  });
  it('reads bottom-up 24-bit with row padding', () => {
    const w = 3;
    const h = 2;
    const stride = 12;
    const data = new Uint8Array(54 + stride * h);
    const v = new DataView(data.buffer);
    data[0] = 0x42;
    data[1] = 0x4d;
    v.setUint32(10, 54, true);
    v.setUint32(14, 40, true);
    v.setInt32(18, w, true);
    v.setInt32(22, h, true);
    v.setUint16(28, 24, true);
    // bottom row first: pixel (0,1) = blue (B,G,R order)
    data[54] = 255;
    // top row: pixel (2,0) = red
    data[54 + stride + 8] = 255;
    const img = decodeBmp(data, 1e6);
    expect(img.get(0, 1)).toBe(BLUE);
    expect(img.get(2, 0)).toBe(RED);
    expect(img.get(1, 0)).toBe(0x000000ff);
  });
  it('rejects oversized and truncated files', () => {
    const big = encodeBmp(new PixelBuffer(10, 10));
    expect(() => decodeBmp(big, 50)).toThrow(BmpError);
    expect(() => decodeBmp(big.subarray(0, 100), 1e6)).toThrow(BmpError);
  });
});

describe('spritesheet slicing', () => {
  it('slices a grid with margin and spacing, skipping empty cells', () => {
    const sheet = new PixelBuffer(2 + 4 + 1 + 4, 2 + 4);
    sheet.set(2, 2, RED);
    sheet.set(7, 2, BLUE);
    const o = { frameWidth: 4, frameHeight: 4, offsetX: 2, offsetY: 2, gapX: 1, gapY: 1, columns: 0, rows: 0, skipEmpty: false };
    const rects = sliceRects(sheet.width, sheet.height, o);
    expect(rects).toEqual([
      { x: 2, y: 2, w: 4, h: 4 },
      { x: 7, y: 2, w: 4, h: 4 },
    ]);
    const frames = sliceSheet(sheet, { ...o, skipEmpty: true });
    expect(frames.map((f) => f.get(0, 0))).toEqual([RED, BLUE]);
  });
  it('guesses square cells for horizontal strips', () => {
    expect(guessCellSize(64, 16)).toEqual({ w: 16, h: 16 });
  });
});

describe('tileset', () => {
  const img = new PixelBuffer(8, 4);
  // Tile A at (0,0) and (2,0) of a 4×2 grid of 2×2 tiles; tile B at (1,1).
  for (const [x, y] of [[0, 0], [4, 0]]) img.set(x!, y!, RED);
  img.set(2, 2, BLUE);

  it('dedupes identical tiles and skips empty ones', () => {
    const ex = extractTiles(img, { width: 2, height: 2, offsetX: 0, offsetY: 0 });
    expect([ex.grid.cols, ex.grid.rows]).toEqual([4, 2]);
    expect(ex.tiles).toHaveLength(2);
    expect(ex.map).toEqual([0, -1, 0, -1, -1, 1, -1, -1]);
    const all = extractTiles(img, { width: 2, height: 2, offsetX: 0, offsetY: 0 }, { dedupe: false, skipEmpty: false });
    expect(all.tiles).toHaveLength(8);
  });
  it('honours the grid offset', () => {
    expect(tileGrid(8, 4, { width: 2, height: 2, offsetX: 1, offsetY: 0 })).toMatchObject({ originX: 1, cols: 3, rows: 2 });
  });
  it('packs a tileset image and a Tiled map that rebuilds the source', () => {
    const ex = extractTiles(img, { width: 2, height: 2, offsetX: 0, offsetY: 0 });
    const sheet = buildTilesetImage(ex.tiles, 2, 2, 8);
    expect([sheet.width, sheet.height]).toEqual([4, 2]);
    const map = JSON.parse(tiledMapJson(ex, { image: 't.png', width: 4, height: 2, columns: 8, spacing: 0 }, 'x'));
    expect(map.layers[0].data).toEqual([1, 0, 1, 0, 0, 2, 0, 0]);
    expect(map.tilesets[0]).toMatchObject({ firstgid: 1, tilecount: 2, columns: 2, tilewidth: 2 });
    // Rebuild from the map and compare.
    const rebuilt = new PixelBuffer(8, 4);
    map.layers[0].data.forEach((gid: number, i: number) => {
      if (!gid) return;
      const t = gid - 1;
      rebuilt.paste(sheet.extract({ x: (t % 2) * 2, y: Math.floor(t / 2) * 2, w: 2, h: 2 }), (i % 4) * 2, Math.floor(i / 4) * 2);
    });
    expect(rebuilt.equals(img)).toBe(true);
  });
});

describe('gradient', () => {
  it('interpolates without dithering', () => {
    expect(gradientT('linear', { x: 0, y: 0 }, { x: 10, y: 0 }, 5, 3)).toBe(0.5);
    expect(gradientT('radial', { x: 0, y: 0 }, { x: 10, y: 0 }, 0, 20)).toBe(1);
    expect(gradientColor('linear', 'none', { x: 0, y: 0 }, { x: 2, y: 0 }, 0x000000ff, 0xffffffff, 1, 0)).toBe(0x808080ff);
  });
  it('dithers using only the two colors, in proportion', () => {
    let blue = 0;
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const c = gradientColor('linear', 'bayer4', { x: 0, y: 0 }, { x: 0, y: 4 }, RED, BLUE, x, 2);
        expect([RED, BLUE]).toContain(c);
        if (c === BLUE) blue++;
      }
    expect(blue).toBe(8);
  });
  it('gradient tool fills the selection only', () => {
    const s = makeSession(8, 8);
    s.setSelection({ bounds: { x: 0, y: 0, w: 4, h: 8 }, mask: new Uint8Array(32).fill(1) });
    const host = makeHost(s);
    host.colors.primary = RED;
    host.colors.secondary = BLUE;
    host.options.dither = 'none';
    drag(host, 'gradient', [
      { x: 0, y: 0 },
      { x: 0, y: 7 },
    ]);
    const img = s.celImage(s.context.layerId, s.context.frameId)!;
    expect(img.get(1, 0)).toBe(RED);
    expect(img.get(1, 7)).toBe(BLUE);
    expect(img.get(6, 4)).toBe(0);
    expect(s.state.width).toBe(8);
  });
});

describe('text', () => {
  it('stamps bitmap text as one undoable step', () => {
    const s = makeSession(32, 16);
    expect(stampText(s, 'Hi', 1, 1, { color: RED })).toBe(true);
    const img = s.celImage(s.context.layerId, s.context.frameId)!;
    let ink = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) if (img.get(x, y) === RED) ink++;
    expect(ink).toBeGreaterThan(10);
    expect(img.get(0, 0)).toBe(0);
    expect(textBounds('Hi', 1, 1, { scale: 2 }).w).toBe(textBounds('Hi', 1, 1, {}).w * 2);
    s.undo();
    expect(s.celImage(s.context.layerId, s.context.frameId)?.isEmpty() ?? true).toBe(true);
  });
});

describe('misc', () => {
  it('fuzzy matches command labels', () => {
    expect(fuzzyScore('Exportar GIF animado…', 'exp gif')).toBeGreaterThan(0);
    expect(fuzzyScore('Exportar GIF animado…', 'zzz')).toBeLessThanOrEqual(0);
    expect(fuzzyScore('Exportar GIF', 'gif')).toBeGreaterThan(fuzzyScore('Gradiente infinito f', 'gif'));
  });
  it('builds an animated document from frames', () => {
    const a = new PixelBuffer(4, 4);
    a.set(0, 0, RED);
    const doc = documentFromFrames('anim', [
      { image: a, duration: 80 },
      { image: new PixelBuffer(4, 4), duration: 120 },
    ]);
    expect(doc.state.frames.map((f) => f.duration)).toEqual([80, 120]);
    expect(doc.state.width).toBe(4);
  });
});

describe('declared image size (bomb guard)', () => {
  const samples = { jpeg: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAVACUDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgqKKK8M/VAooooAKKKKACiiigAooooAKKKKAP/9k=', webpLossless: 'UklGRh4AAABXRUJQVlA4TBEAAAAvJAAFAAdQhSJXof+BiOh/AAA=', webpLossy: 'UklGRkoAAABXRUJQVlA4ID4AAABQAwCdASolABUAPtFmrFCoJaQipWgBABoJZwDG5oAAK/fDcAD+7QcvrvFpRr/8lP8Xfebvvuus23d6pgAAAA==' };
  for (const [name, b64] of Object.entries(samples))
    it(`reads ${name} dimensions from the header`, () => {
      const d = new Uint8Array(Buffer.from(b64, 'base64'));
      expect(declaredSize(d, sniffImageType(d))).toEqual({ width: 37, height: 21 });
    });
  it('reads BMP dimensions', () => {
    const d = encodeBmp(new PixelBuffer(5, 9));
    expect(declaredSize(d, 'bmp')).toEqual({ width: 5, height: 9 });
  });
});
