import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { crc32 } from '../../src/import-export/crc32';
import { decodePng, encodePng, PngError, readPngInfo } from '../../src/import-export/png';
import { rgba } from '../../src/raster/color';
import { PixelBuffer } from '../../src/raster/pixel-buffer';

function randomImage(w: number, h: number, seed = 1): PixelBuffer {
  const img = new PixelBuffer(w, h);
  let s = seed;
  for (let i = 0; i < img.data.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    img.data[i] = s >> 16;
  }
  return img;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
function chunk(type: string, data: number[] | Uint8Array): number[] {
  const body = [...type].map((c) => c.charCodeAt(0)).concat([...data]);
  return [...u32(data.length), ...body, ...u32(crc32(new Uint8Array(body)))];
}
/** Builds a PNG from raw (unfiltered) scanlines for any color type. */
function buildPng(w: number, h: number, depth: number, type: number, rows: number[][], extra: number[] = [], interlace = 0): Uint8Array {
  const raw = rows.flatMap((r) => [0, ...r]);
  const ihdr = [...u32(w), ...u32(h), depth, type, 0, 0, interlace];
  return new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', ihdr),
    ...extra,
    ...chunk('IDAT', zlibSync(new Uint8Array(raw))),
    ...chunk('IEND', []),
  ]);
}

describe('PNG codec', () => {
  it('round-trips RGBA bit-exactly, including semi-transparent pixels', () => {
    for (const [w, h] of [[1, 1], [7, 3], [33, 17], [64, 64]] as const) {
      const img = randomImage(w, h, w * h);
      const out = decodePng(encodePng(img));
      expect(out.equals(img)).toBe(true);
    }
  });
  it('writes valid header info and text chunks', () => {
    const png = encodePng(new PixelBuffer(5, 9), { text: { Software: 'PixelCraft' } });
    expect(readPngInfo(png)).toMatchObject({ width: 5, height: 9, bitDepth: 8, colorType: 6, interlace: 0 });
    expect(new TextDecoder().decode(png)).toContain('PixelCraft');
  });
  it('decodes grayscale with tRNS', () => {
    const png = buildPng(3, 1, 8, 0, [[0, 128, 255]], chunk('tRNS', [0, 128]));
    const img = decodePng(png);
    expect(img.get(0, 0)).toBe(rgba(0, 0, 0));
    expect(img.get(1, 0)).toBe(rgba(128, 128, 128, 0));
    expect(img.get(2, 0)).toBe(rgba(255, 255, 255));
  });
  it('decodes 2-bit indexed color with palette alpha', () => {
    const plte = chunk('PLTE', [255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const trns = chunk('tRNS', [255, 100]);
    // indices 0,1,2,1 packed in one byte: 00 01 10 01
    const png = buildPng(4, 1, 2, 3, [[0b00011001]], [...plte, ...trns]);
    const img = decodePng(png);
    expect(img.get(0, 0)).toBe(rgba(255, 0, 0));
    expect(img.get(1, 0)).toBe(rgba(0, 255, 0, 100));
    expect(img.get(2, 0)).toBe(rgba(0, 0, 255));
  });
  it('decodes 16-bit RGB', () => {
    const png = buildPng(1, 1, 16, 2, [[0x12, 0x34, 0xab, 0xcd, 0xff, 0xff]]);
    expect(decodePng(png).get(0, 0)).toBe(rgba(0x12, 0xab, 0xff));
  });
  it('decodes Adam7 interlaced images', () => {
    // 2x2 RGBA interlaced: pass1 (0,0); pass6 (1,0); pass7 row 1 (0,1),(1,1)
    const p = (r: number) => [r, 0, 0, 255];
    const raw = [0, ...p(10), 0, ...p(20), 0, ...p(30), ...p(40)];
    const ihdr = [...u32(2), ...u32(2), 8, 6, 0, 0, 1];
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', ihdr), ...chunk('IDAT', zlibSync(new Uint8Array(raw))), ...chunk('IEND', [])]);
    const img = decodePng(png);
    expect([img.get(0, 0), img.get(1, 0), img.get(0, 1), img.get(1, 1)].map((c) => c >>> 24)).toEqual([10, 20, 30, 40]);
  });
  it('rejects corrupted data with clear errors', () => {
    const png = encodePng(randomImage(4, 4));
    const bad = png.slice();
    bad[40] = bad[40]! ^ 0xff;
    expect(() => decodePng(bad)).toThrow(PngError);
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow(/não é um PNG/);
    expect(() => decodePng(png.slice(0, 50))).toThrow(PngError);
  });
  it('refuses images over the pixel limit before inflating', () => {
    const png = buildPng(100, 100, 8, 0, Array.from({ length: 100 }, () => Array(100).fill(0)));
    expect(() => decodePng(png, { maxPixels: 50 * 50 })).toThrow(/grande demais/);
  });
});
