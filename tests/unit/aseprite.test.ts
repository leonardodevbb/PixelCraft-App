import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { AsepriteError, decodeAseprite, encodeAseprite, isAseprite } from '../../src/import-export/aseprite';
import { createDocument } from '../../src/project/create';
import { celKey, makeFrame, makeGroupLayer, makePixelLayer, pixelLayers, type ProjectDocument } from '../../src/project/model';
import { blendPixel, BLEND_MODES } from '../../src/raster/blend';
import { rgba } from '../../src/raster/color';
import { PixelBuffer } from '../../src/raster/pixel-buffer';
import { BLUE, GREEN, RED } from './helpers';

/** Little-endian byte builder for hand-made .aseprite files. */
class Bytes {
  a: number[] = [];
  byte(v: number): this {
    this.a.push(v & 255);
    return this;
  }
  word(v: number): this {
    return this.byte(v).byte(v >> 8);
  }
  dword(v: number): this {
    return this.word(v & 0xffff).word(v >>> 16);
  }
  zeros(n: number): this {
    for (let i = 0; i < n; i++) this.byte(0);
    return this;
  }
  raw(b: ArrayLike<number>): this {
    for (let i = 0; i < b.length; i++) this.byte(b[i]!);
    return this;
  }
  str(s: string): this {
    const b = new TextEncoder().encode(s);
    return this.word(b.length).raw(b);
  }
}

const chunk = (type: number, body: Bytes): Bytes => new Bytes().dword(body.a.length + 6).word(type).raw(body.a);

function file(w: number, h: number, depth: number, frames: Bytes[][], transparentIndex = 0): Uint8Array {
  const body = new Bytes();
  for (const chunks of frames) {
    const size = 16 + chunks.reduce((n, c) => n + c.a.length, 0);
    body.dword(size).word(0xf1fa).word(chunks.length).word(120).zeros(2).dword(chunks.length);
    for (const c of chunks) body.raw(c.a);
  }
  const head = new Bytes()
    .dword(128 + body.a.length)
    .word(0xa5e0)
    .word(frames.length)
    .word(w)
    .word(h)
    .word(depth)
    .dword(1)
    .word(100)
    .zeros(8)
    .byte(transparentIndex)
    .zeros(3)
    .word(0)
    .byte(1)
    .byte(1)
    .word(0)
    .word(0)
    .word(8)
    .word(8)
    .zeros(84);
  expect(head.a.length).toBe(128);
  return Uint8Array.from([...head.a, ...body.a]);
}

const layerChunk = (name: string, opts: { type?: number; level?: number; blend?: number; flags?: number; tileset?: number } = {}): Bytes => {
  const b = new Bytes()
    .word(opts.flags ?? 3)
    .word(opts.type ?? 0)
    .word(opts.level ?? 0)
    .zeros(4)
    .word(opts.blend ?? 0)
    .byte(255)
    .zeros(3)
    .str(name);
  if (opts.type === 2) b.dword(opts.tileset ?? 0);
  return chunk(0x2004, b);
};

const celChunk = (layer: number, x: number, y: number, w: number, h: number, pixels: number[], compressed = true): Bytes => {
  const b = new Bytes().word(layer).word(x).word(y).byte(255).word(compressed ? 2 : 0).word(0).zeros(5).word(w).word(h);
  b.raw(compressed ? zlibSync(Uint8Array.from(pixels)) : pixels);
  return chunk(0x2005, b);
};

function sampleDoc(): ProjectDocument {
  const doc = createDocument({ width: 6, height: 4, name: 'Herói' });
  const bottom = makePixelLayer('Fundo', { opacity: 50, blendMode: 'normal' });
  const inner = makePixelLayer('Olhos', { blendMode: 'multiply', visible: false });
  const group = makeGroupLayer('Cabeça', [inner], { expanded: false });
  const top = makePixelLayer('Contorno', { locked: true, exportable: false, blendMode: 'hue' });
  const f1 = makeFrame(80);
  const f2 = makeFrame(150);
  const f3 = makeFrame(200);
  const a = new PixelBuffer(6, 4);
  a.set(1, 1, RED);
  a.set(5, 3, rgba(10, 20, 30, 128));
  const b = new PixelBuffer(6, 4);
  b.set(0, 0, BLUE);
  const c = new PixelBuffer(6, 4);
  c.set(2, 3, GREEN);
  doc.images.set('IA', a);
  doc.images.set('IB', b);
  doc.images.set('IC', c);
  doc.state = {
    ...doc.state,
    layers: [bottom, group, top],
    frames: [f1, f2, f3],
    cels: {
      [celKey(bottom.id, f1.id)]: 'IA',
      [celKey(bottom.id, f2.id)]: 'IA', // linked
      [celKey(bottom.id, f3.id)]: 'IA', // linked
      [celKey(inner.id, f2.id)]: 'IB',
      [celKey(top.id, f3.id)]: 'IC',
    },
    tags: [
      { id: 'T1', name: 'andar', from: f1.id, to: f2.id, color: '#3fa34d', direction: 'pingpong', repeat: 3 },
      { id: 'T2', name: 'pular', from: f3.id, to: f3.id, color: '#e8434f', direction: 'reverse', repeat: 0 },
    ],
    palette: { id: 'P', name: 'p', colors: [RED, GREEN, BLUE, rgba(1, 2, 3, 4)] },
  };
  return doc;
}

describe('.aseprite files', () => {
  it('round-trips layers, groups, linked cels, tags, palette and durations', () => {
    const bytes = encodeAseprite(sampleDoc());
    expect(isAseprite(bytes)).toBe(true);
    const doc = decodeAseprite(bytes, 'Herói');
    const st = doc.state;
    expect([st.width, st.height]).toEqual([6, 4]);
    expect(st.frames.map((f) => f.duration)).toEqual([80, 150, 200]);

    expect(st.layers.map((l) => l.name)).toEqual(['Fundo', 'Cabeça', 'Contorno']);
    const [bottom, group, top] = st.layers;
    expect(bottom).toMatchObject({ opacity: 50, blendMode: 'normal', visible: true, locked: false });
    expect(group).toMatchObject({ type: 'group', expanded: false });
    expect(group!.type === 'group' && group!.children.map((l) => [l.name, l.blendMode, l.visible])).toEqual([['Olhos', 'multiply', false]]);
    expect(top).toMatchObject({ locked: true, exportable: false, blendMode: 'hue' });

    const [f1, f2, f3] = st.frames;
    const img = (layerId: string, frameId: string) => doc.images.get(st.cels[celKey(layerId, frameId)]!)!;
    expect(img(bottom!.id, f1!.id).get(1, 1)).toBe(RED);
    expect(img(bottom!.id, f1!.id).get(5, 3)).toBe(rgba(10, 20, 30, 128));
    // Linked cels share one image.
    expect(st.cels[celKey(bottom!.id, f2!.id)]).toBe(st.cels[celKey(bottom!.id, f1!.id)]);
    expect(st.cels[celKey(bottom!.id, f3!.id)]).toBe(st.cels[celKey(bottom!.id, f1!.id)]);
    const eyes = pixelLayers(st.layers).find((l) => l.name === 'Olhos')!;
    expect(img(eyes.id, f2!.id).get(0, 0)).toBe(BLUE);
    expect(st.cels[celKey(eyes.id, f1!.id)]).toBeUndefined();
    expect(img(top!.id, f3!.id).get(2, 3)).toBe(GREEN);

    expect(st.tags.map((t) => [t.name, t.color, t.direction, t.repeat])).toEqual([
      ['andar', '#3fa34d', 'pingpong', 3],
      ['pular', '#e8434f', 'reverse', 0],
    ]);
    expect(st.tags[0]).toMatchObject({ from: f1!.id, to: f2!.id });
    expect(st.palette.colors).toEqual([RED, GREEN, BLUE, rgba(1, 2, 3, 4)]);
  });

  it('every blend mode survives the round trip', () => {
    const doc = createDocument({ width: 2, height: 2, name: 'm' });
    doc.state = { ...doc.state, layers: BLEND_MODES.map((m) => makePixelLayer(m, { blendMode: m })) };
    const back = decodeAseprite(encodeAseprite(doc));
    expect(back.state.layers.map((l) => l.blendMode)).toEqual([...BLEND_MODES]);
  });

  it('reads an indexed sprite with the old palette chunk and a transparent index', () => {
    const pal = chunk(0x0004, new Bytes().word(1).byte(0).byte(3).raw([0, 0, 0, 255, 0, 0, 0, 0, 255]));
    const bytes = file(3, 1, 8, [[pal, layerChunk('L'), celChunk(0, 0, 0, 3, 1, [0, 1, 2], false)]], 0);
    const doc = decodeAseprite(bytes);
    const img = doc.images.get(Object.values(doc.state.cels)[0]!)!;
    expect([img.get(0, 0), img.get(1, 0), img.get(2, 0)]).toEqual([0, RED, BLUE]);
    expect(doc.state.palette.colors.slice(0, 3)).toEqual([rgba(0, 0, 0), RED, BLUE]);
  });

  it('reads a grayscale sprite and positions cels by their offset', () => {
    const bytes = file(4, 4, 16, [[layerChunk('L'), celChunk(0, 2, 1, 2, 1, [200, 255, 50, 128])]]);
    const doc = decodeAseprite(bytes);
    const img = doc.images.get(Object.values(doc.state.cels)[0]!)!;
    expect(img.get(2, 1)).toBe(rgba(200, 200, 200, 255));
    expect(img.get(3, 1)).toBe(rgba(50, 50, 50, 128));
    expect(img.get(0, 0)).toBe(0);
  });

  it('flattens tilemap layers into pixels, honouring tile flips', () => {
    // Tileset 0: 2×1 tiles, tile 0 empty, tile 1 = [red, blue].
    const tiles = [0, 0, 0, 0, 0, 0, 0, 0, ...[255, 0, 0, 255, 0, 0, 255, 255]];
    const zipped = zlibSync(Uint8Array.from(tiles));
    const ts = chunk(0x2023, new Bytes().dword(0).dword(2).dword(2).word(2).word(1).word(1).zeros(14).str('ts').dword(zipped.length).raw(zipped));
    // Tilemap 2×1: tile 1, then tile 1 flipped on X (bit 31).
    const map = new Bytes().dword(1).dword(1 | 0x80000000);
    const cel = chunk(
      0x2005,
      new Bytes()
        .word(0)
        .word(0)
        .word(0)
        .byte(255)
        .word(3)
        .word(0)
        .zeros(5)
        .word(2)
        .word(1)
        .word(32)
        .dword(0x1fffffff)
        .dword(0x80000000)
        .dword(0x40000000)
        .dword(0x20000000)
        .zeros(10)
        .raw(zlibSync(Uint8Array.from(map.a))),
    );
    const doc = decodeAseprite(file(4, 1, 32, [[ts, layerChunk('Mapa', { type: 2, tileset: 0 }), cel]]));
    const img = doc.images.get(Object.values(doc.state.cels)[0]!)!;
    expect([0, 1, 2, 3].map((x) => img.get(x, 0))).toEqual([RED, BLUE, BLUE, RED]);
  });

  it('rejects truncated and hostile files with a readable error', () => {
    const good = encodeAseprite(sampleDoc());
    expect(() => decodeAseprite(good.subarray(0, 60))).toThrow(AsepriteError);
    expect(() => decodeAseprite(good.subarray(0, good.length - 10))).toThrow(AsepriteError);
    const badMagic = good.slice();
    badMagic[4] = 0;
    expect(() => decodeAseprite(badMagic)).toThrow(/assinatura/);
    // A cel that claims a huge size but carries a tiny zlib stream.
    const liar = new Bytes().word(0).word(0).word(0).byte(255).word(2).word(0).zeros(5).word(4).word(4).raw(zlibSync(Uint8Array.of(1, 2, 3)));
    expect(() => decodeAseprite(file(4, 4, 32, [[layerChunk('L'), chunk(0x2005, liar)]]))).toThrow(AsepriteError);
    const huge = file(4, 4, 32, [[]]);
    huge[8] = 0xff;
    huge[9] = 0xff; // width 65535
    expect(() => decodeAseprite(huge)).toThrow(AsepriteError);
  });
});

describe('blend modes', () => {
  const mix = (mode: (typeof BLEND_MODES)[number], base: number[], src: number[]): number[] => {
    const d = Uint8ClampedArray.from([...base, 255]);
    blendPixel(d, 0, src[0]!, src[1]!, src[2]!, 255, 1, mode);
    return [...d.subarray(0, 3)];
  };
  it('implements the separable modes on opaque pixels', () => {
    expect(mix('multiply', [200, 100, 50], [128, 255, 0])).toEqual([100, 100, 0]);
    expect(mix('screen', [0, 255, 128], [128, 0, 128])).toEqual([128, 255, 192]);
    expect(mix('add', [200, 10, 0], [100, 10, 0])).toEqual([255, 20, 0]);
    expect(mix('subtract', [200, 10, 0], [100, 20, 0])).toEqual([100, 0, 0]);
    expect(mix('difference', [200, 10, 0], [100, 20, 0])).toEqual([100, 10, 0]);
    expect(mix('darken', [200, 10, 0], [100, 20, 0])).toEqual([100, 10, 0]);
    expect(mix('lighten', [200, 10, 0], [100, 20, 0])).toEqual([200, 20, 0]);
  });
  it('implements the non-separable modes', () => {
    // Luminosity of black onto a colour gives black; colour of grey onto grey stays grey.
    expect(mix('luminosity', [255, 0, 0], [0, 0, 0])).toEqual([0, 0, 0]);
    expect(mix('color', [128, 128, 128], [128, 128, 128])).toEqual([128, 128, 128]);
    // Saturation of a grey source removes the colour but keeps the luminance.
    const [r, g, b] = mix('saturation', [255, 0, 0], [128, 128, 128]);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
  it('a transparent source never changes the destination', () => {
    for (const m of BLEND_MODES) {
      const d = Uint8ClampedArray.of(10, 20, 30, 255);
      blendPixel(d, 0, 255, 255, 255, 0, 1, m);
      expect([...d]).toEqual([10, 20, 30, 255]);
    }
  });
});

describe('APNG and SVG export', () => {
  /** Lists the chunk types of a PNG with their data. */
  const chunks = (b: Uint8Array): { type: string; data: Uint8Array }[] => {
    const out = [];
    let p = 8;
    while (p < b.length) {
      const n = ((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0;
      out.push({ type: String.fromCharCode(...b.subarray(p + 4, p + 8)), data: b.subarray(p + 8, p + 8 + n) });
      p += 12 + n;
    }
    return out;
  };

  it('writes one fcTL per frame with exact durations and the play count', async () => {
    const { encodeApng, decodePng } = await import('../../src/import-export/png');
    const a = new PixelBuffer(2, 2);
    a.set(0, 0, rgba(255, 0, 0, 100));
    const b = new PixelBuffer(2, 2);
    b.set(1, 1, BLUE);
    const bytes = encodeApng([{ image: a, delayMs: 85 }, { image: b, delayMs: 230 }], { plays: 3 });
    const cs = chunks(bytes);
    expect(cs.map((c) => c.type)).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND']);
    const actl = cs[1]!.data;
    expect([actl[3], actl[7]]).toEqual([2, 3]);
    const delay = (d: Uint8Array) => ((d[20]! << 8) | d[21]!) / ((d[22]! << 8) | d[23]!);
    expect(delay(cs[2]!.data)).toBeCloseTo(0.085);
    expect(delay(cs[4]!.data)).toBeCloseTo(0.23);
    // Sequence numbers run 0,1,2 across fcTL/fdAT.
    expect([cs[2]!.data[3], cs[4]!.data[3], cs[5]!.data[3]]).toEqual([0, 1, 2]);
    // The default image (first frame) is a regular PNG with semi-transparency intact.
    expect(decodePng(bytes).get(0, 0)).toBe(rgba(255, 0, 0, 100));
  });

  it('exports SVG with one path per colour and no transparent pixels', async () => {
    const { encodeSvg } = await import('../../src/import-export/svg');
    const img = new PixelBuffer(4, 2);
    img.set(0, 0, RED);
    img.set(1, 0, RED);
    img.set(3, 1, rgba(0, 0, 255, 128));
    const svg = encodeSvg(img, 10);
    expect(svg).toContain('width="40" height="20" viewBox="0 0 4 2"');
    expect(svg).toContain('<path fill="#ff0000" d="M0 0h2v1h-2z"/>');
    expect(svg).toContain('fill="#0000ff" fill-opacity="0.502" d="M3 1h1v1h-1z"');
    expect(svg.match(/<path/g)).toHaveLength(2);
  });
});
