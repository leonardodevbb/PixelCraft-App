import { describe, expect, it } from 'vitest';
import { composeFrame } from '../../src/layers/compose';
import { addLayer } from '../../src/editor/layer-ops';
import { encodePng, decodePng } from '../../src/import-export/png';
import { encodeGif } from '../../src/import-export/gif';
import { PixelBuffer } from '../../src/raster/pixel-buffer';
import { newSession, makeHost, drag } from './helpers';

/**
 * Coarse performance guards for large documents. Limits are generous (CI
 * machines vary); the measured times are printed for the docs.
 */
function time<T>(label: string, fn: () => T): { ms: number; value: T } {
  const t0 = performance.now();
  const value = fn();
  const ms = performance.now() - t0;
  console.log(`[perf] ${label}: ${ms.toFixed(1)} ms`);
  return { ms, value };
}

describe('large documents', () => {
  it('2048×2048 with 8 layers: fill, compose, undo', () => {
    const s = newSession(2048, 2048);
    for (let i = 0; i < 7; i++) addLayer(s);
    const host = makeHost(s, { tolerance: 0, contiguous: true });
    expect(time('bucket fill 2048² (4.2 MP)', () => drag(host, 'bucket', [{ x: 10, y: 10 }])).ms).toBeLessThan(3000);
    expect(time('compose 8 layers 2048²', () => composeFrame(s.state, s.lookup, s.activeFrameId)).ms).toBeLessThan(3000);
    expect(time('pencil stroke 200 points', () => drag(host, 'pencil', Array.from({ length: 200 }, (_, i) => ({ x: i * 10, y: i * 10 })))).ms).toBeLessThan(2000);
    expect(time('undo + redo', () => (s.undo(), s.redo())).ms).toBeLessThan(2000);
  });

  it('PNG 2048² round-trip and GIF 30 frames 256²', () => {
    const img = new PixelBuffer(2048, 2048);
    for (let y = 0; y < 2048; y++) for (let x = 0; x < 2048; x++) img.set(x, y, (((x * 7) & 255) << 24) | (((y * 3) & 255) << 16) | 0x80ff);
    const png = time('encode PNG 2048²', () => encodePng(img)).value;
    expect(time('decode PNG 2048²', () => decodePng(png)).value.width).toBe(2048);
    const frames = Array.from({ length: 30 }, (_, i) => {
      const f = new PixelBuffer(256, 256);
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) f.set(x, y, ((((x + i) * 5) & 255) << 24) | ((y & 255) << 16) | 0xff);
      return { image: f, delayMs: 100 };
    });
    expect(time('encode GIF 30×256² (quantized)', () => encodeGif(frames, { loop: 0 })).ms).toBeLessThan(15000);
  }, 60000);
});
