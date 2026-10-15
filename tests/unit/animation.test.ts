import { describe, expect, it } from 'vitest';
import { celKey } from '../../src/project/model';
import { PixelBuffer } from '../../src/raster/pixel-buffer';
import { rgba } from '../../src/raster/color';
import {
  addFrame,
  deleteFrame,
  duplicateFrame,
  goToFrame,
  isCelLinked,
  linkCelToPrevious,
  moveFrame,
  reverseFrames,
  setFps,
  setFrameDuration,
  addTag,
  unlinkCel,
} from '../../src/editor/frame-ops';
import { Player, playbackOrder, cycleDuration } from '../../src/animation/playback';
import { decodeGif, encodeGif } from '../../src/import-export/gif';
import { buildSpritesheet, frameTags, sheetGeometry, spritesheetJson } from '../../src/import-export/spritesheet';
import { activeImage, drag, makeHost, newSession, RED, BLUE } from './helpers';

describe('frame operations', () => {
  it('adds, duplicates, moves and deletes frames with undo', () => {
    const s = newSession(4, 4);
    drag(makeHost(s), 'pencil', [{ x: 0, y: 0 }]);
    const f1 = s.activeFrameId;
    const f2 = duplicateFrame(s);
    expect(s.activeFrameId).toBe(f2);
    expect(activeImage(s)!.get(0, 0)).toBe(RED);
    expect(isCelLinked(s, s.activeLayerId, f2)).toBe(false);
    const f3 = addFrame(s);
    expect(s.state.frames.map((f) => f.id)).toEqual([f1, f2, f3]);
    expect(activeImage(s)).toBeUndefined();
    moveFrame(s, f3, 0);
    expect(s.state.frames[0]!.id).toBe(f3);
    deleteFrame(s, f3);
    expect(s.state.frames).toHaveLength(2);
    s.undo();
    expect(s.state.frames).toHaveLength(3);
  });
  it('refuses to delete the last frame', () => {
    const s = newSession(2, 2);
    expect(() => deleteFrame(s)).toThrow();
  });
  it('linked cels share edits until unlinked', () => {
    const s = newSession(4, 1);
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 0, y: 0 }]);
    const f2 = duplicateFrame(s, true);
    expect(isCelLinked(s, s.activeLayerId, f2)).toBe(true);
    drag(h, 'pencil', [{ x: 1, y: 0 }]);
    // Painting on a linked cel copies on write: the frames diverge.
    const a = s.state.cels[celKey(s.activeLayerId, s.state.frames[0]!.id)];
    const b = s.state.cels[celKey(s.activeLayerId, f2)];
    expect(a).not.toBe(b);
    linkCelToPrevious(s);
    expect(isCelLinked(s, s.activeLayerId, f2)).toBe(true);
    unlinkCel(s);
    expect(isCelLinked(s, s.activeLayerId, f2)).toBe(false);
  });
  it('sets durations, fps, tags and reverses', () => {
    const s = newSession(2, 2);
    addFrame(s);
    addFrame(s);
    setFps(s, 20);
    expect(s.state.frames.every((f) => f.duration === 50)).toBe(true);
    setFrameDuration(s, [s.activeFrameId], 5);
    expect(s.state.frames.at(-1)!.duration).toBe(10);
    const tag = addTag(s, 0, 1, { name: 'andar' });
    expect(s.state.tags.find((t) => t.id === tag)!.name).toBe('andar');
    const ids = s.state.frames.map((f) => f.id);
    reverseFrames(s);
    expect(s.state.frames.map((f) => f.id)).toEqual([...ids].reverse());
    goToFrame(s, 1);
    expect(s.activeFrameId).toBe(s.state.frames[1]!.id);
  });
});

describe('playback', () => {
  it('builds orders for every mode', () => {
    expect(playbackOrder(4, { loop: 'loop', direction: 'forward' })).toEqual([0, 1, 2, 3]);
    expect(playbackOrder(4, { loop: 'loop', direction: 'reverse' })).toEqual([3, 2, 1, 0]);
    expect(playbackOrder(4, { loop: 'pingpong', direction: 'forward' })).toEqual([0, 1, 2, 3, 2, 1]);
    expect(cycleDuration([100, 50, 50, 100], [0, 1, 2, 3])).toBe(300);
  });
  it('advances by per-frame durations and stops when playing once', () => {
    const p = new Player([0, 1, 2], [100, 200, 100], true);
    expect(p.advance(99)).toBe(0);
    expect(p.advance(1)).toBe(1);
    expect(p.advance(199)).toBe(1);
    expect(p.advance(1)).toBe(2);
    expect(p.advance(1000)).toBe(2);
    expect(p.done).toBe(true);
    const loop = new Player([0, 1], [100, 100], false);
    expect(loop.advance(250)).toBe(0);
  });
});

function frame(color: number, x: number): PixelBuffer {
  const b = new PixelBuffer(5, 3);
  b.set(x, 1, color);
  return b;
}

describe('GIF', () => {
  it('round trips frames, transparency and delays', () => {
    const frames = [
      { image: frame(RED, 0), delayMs: 100 },
      { image: frame(BLUE, 2), delayMs: 250 },
      { image: frame(RED, 4), delayMs: 40 },
    ];
    const r = encodeGif(frames, { loop: 0 });
    expect(r.quantized).toBe(false);
    const out = decodeGif(r.bytes, { maxPixels: 1e6, maxFrames: 10 });
    expect(out).toHaveLength(3);
    out.forEach((f, i) => {
      expect(f.image.equals(frames[i]!.image)).toBe(true);
      expect(f.delayMs).toBe(frames[i]!.delayMs);
    });
  });
  it('quantises images with more than 256 colours', () => {
    const img = new PixelBuffer(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) img.set(x, y, rgba(x * 8, y * 8, (x + y) * 4));
    const r = encodeGif([{ image: img, delayMs: 100 }], { loop: null });
    expect(r.quantized).toBe(true);
    expect(r.colors).toBeLessThanOrEqual(256);
    const out = decodeGif(r.bytes, { maxPixels: 1e6, maxFrames: 2 });
    expect(out[0]!.image.width).toBe(32);
  });
  it('compresses long runs (exercises code size growth and table reset)', () => {
    const img = new PixelBuffer(200, 200);
    let seed = 7;
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 200; x++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        img.set(x, y, rgba((seed >> 8) & 0xf0, (seed >> 12) & 0xf0, 0));
      }
    const r = encodeGif([{ image: img, delayMs: 100 }], { loop: null });
    const out = decodeGif(r.bytes, { maxPixels: 1e6, maxFrames: 2 });
    expect(out[0]!.image.equals(img)).toBe(true);
  });
  it('rejects malformed data', () => {
    expect(() => decodeGif(new Uint8Array([1, 2, 3]), { maxPixels: 100, maxFrames: 1 })).toThrow();
    const big = encodeGif([{ image: new PixelBuffer(20, 20), delayMs: 100 }], { loop: null }).bytes;
    expect(() => decodeGif(big, { maxPixels: 100, maxFrames: 1 })).toThrow();
    expect(() => decodeGif(big.slice(0, 30), { maxPixels: 1e6, maxFrames: 1 })).toThrow();
  });
});

describe('spritesheet', () => {
  it('lays out a grid with padding and margin', () => {
    const g = sheetGeometry(5, 8, 8, { layout: 'grid', columns: 3, padding: 1, margin: 2, scale: 2 });
    expect([g.columns, g.rows]).toEqual([3, 2]);
    expect(g.width).toBe(2 * 2 + 3 * 16 + 2);
    expect(g.positions[4]).toEqual({ x: 2 + 17, y: 2 + 17 });
  });
  it('packs frames and writes metadata', () => {
    const imgs = [frame(RED, 0), frame(BLUE, 1)];
    const { image, geometry } = buildSpritesheet(imgs, { layout: 'horizontal', columns: 1, padding: 0, margin: 0, scale: 1 });
    expect(image.width).toBe(10);
    expect(image.get(6, 1)).toBe(BLUE);
    const frames = [
      { id: 'a', duration: 100 },
      { id: 'b', duration: 120 },
    ];
    const tags = frameTags({ frames, tags: [{ id: 'T', name: 'idle', from: 'a', to: 'b', color: '#000000', direction: 'forward', repeat: 0 }] }).map(({ name, from, to, direction }) => ({ name, from, to, direction }));
    const json = JSON.parse(spritesheetJson({ imageName: 'x.png', baseName: 'x', frames, geometry, scale: 1, tags, appVersion: 'test' }));
    expect(json.frames[1].frame).toEqual({ x: 5, y: 0, w: 5, h: 3 });
    expect(json.frames[1].duration).toBe(120);
    expect(json.meta.frameTags).toEqual([{ name: 'idle', from: 0, to: 1, direction: 'forward' }]);
  });
});
