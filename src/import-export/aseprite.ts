import { unzlibSync, zlibSync } from 'fflate';
import { tagRange } from '../animation/tags';
import { BLEND_MODES, type BlendMode } from '../raster/blend';
import { rgba, type RGBA } from '../raster/color';
import { PixelBuffer } from '../raster/pixel-buffer';
import { newId } from '../project/ids';
import { checkDimensions, LIMITS } from '../project/limits';
import {
  allLayers,
  celKey,
  DEFAULT_ANIMATION,
  DEFAULT_TILES,
  makeFrame,
  makeGroupLayer,
  makePixelLayer,
  type DocState,
  type GroupLayer,
  type LayerNode,
  type ProjectDocument,
  type Tag,
  type TagDirection,
} from '../project/model';
import { defaultPalette } from '../palette/defaults';

/**
 * Reader and writer for Aseprite's .aseprite/.ase files, following the
 * official specification (aseprite/docs/ase-file-specs.md).
 *
 * Reading supports RGBA, grayscale and indexed sprites, layer groups, linked
 * cels, cel opacity (baked into the pixels), tags with colour/direction/repeat,
 * palettes and tilemap layers (flattened into pixels). Writing produces an
 * RGBA sprite that Aseprite opens with the same layers, frames, durations,
 * linked cels, tags and palette.
 */

export class AsepriteError extends Error {}

const MAGIC = 0xa5e0;
const FRAME_MAGIC = 0xf1fa;

/** Aseprite's blend mode numbers, in its order. */
const ASE_BLEND: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'add',
  'subtract',
  'divide',
];

const DIRECTIONS: TagDirection[] = ['forward', 'reverse', 'pingpong', 'pingpong'];

class Reader {
  pos = 0;
  constructor(readonly b: Uint8Array) {}
  private need(n: number): void {
    if (this.pos + n > this.b.length) throw new AsepriteError('Arquivo .aseprite truncado.');
  }
  byte(): number {
    this.need(1);
    return this.b[this.pos++]!;
  }
  word(): number {
    this.need(2);
    const v = this.b[this.pos]! | (this.b[this.pos + 1]! << 8);
    this.pos += 2;
    return v;
  }
  short(): number {
    const v = this.word();
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  dword(): number {
    this.need(4);
    const v = (this.b[this.pos]! | (this.b[this.pos + 1]! << 8) | (this.b[this.pos + 2]! << 16) | (this.b[this.pos + 3]! << 24)) >>> 0;
    this.pos += 4;
    return v;
  }
  long(): number {
    return this.dword() | 0;
  }
  bytes(n: number): Uint8Array {
    this.need(n);
    const v = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }
  string(): string {
    const n = this.word();
    return new TextDecoder().decode(this.bytes(n));
  }
}

/** Inflates exactly `size` bytes; anything else means a corrupt (or hostile) cel. */
function inflate(data: Uint8Array, size: number): Uint8Array {
  let out: Uint8Array;
  try {
    out = unzlibSync(data, { out: new Uint8Array(size) });
  } catch {
    throw new AsepriteError('Imagem compactada corrompida no arquivo .aseprite.');
  }
  if (out.length !== size) throw new AsepriteError('Imagem com tamanho inesperado no arquivo .aseprite.');
  return out;
}

interface RawLayer {
  type: number;
  flags: number;
  level: number;
  blend: number;
  opacity: number;
  name: string;
  tileset: number;
}

interface Tileset {
  tileW: number;
  tileH: number;
  count: number;
  /** All tiles stacked vertically, already converted to RGBA. */
  image: PixelBuffer;
}

/** Reads an .aseprite/.ase file into a PixelCraft document. */
export function decodeAseprite(bytes: Uint8Array, name = 'Sem título'): ProjectDocument {
  if (bytes.length < 128) throw new AsepriteError('Arquivo .aseprite curto demais.');
  const r = new Reader(bytes);
  r.dword(); // file size (not trusted)
  if (r.word() !== MAGIC) throw new AsepriteError('O arquivo não é um .aseprite válido (assinatura ausente).');
  const frameCount = r.word();
  const width = r.word();
  const height = r.word();
  const depth = r.word();
  const flags = r.dword();
  const speed = r.word();
  r.skip(8);
  const transparentIndex = r.byte();
  r.skip(3);
  r.word(); // number of colours
  r.skip(2); // pixel ratio
  const gridX = r.short();
  const gridY = r.short();
  const gridW = r.word();
  const gridH = r.word();
  r.pos = 128;
  const dimErr = checkDimensions(width, height);
  if (dimErr) throw new AsepriteError(dimErr);
  if (frameCount < 1 || frameCount > LIMITS.maxFrames) throw new AsepriteError(`O arquivo tem ${frameCount} quadros; o limite é ${LIMITS.maxFrames}.`);
  if (depth !== 32 && depth !== 16 && depth !== 8) throw new AsepriteError(`Profundidade de cor não suportada: ${depth} bits.`);
  const bpp = depth / 8;

  const layers: RawLayer[] = [];
  let palette: RGBA[] = [];
  let sawNewPalette = false;
  const tilesets = new Map<number, Tileset>();
  const pendingTileset: { id: number; data: Uint8Array }[] = [];
  const frames = Array.from({ length: frameCount }, () => makeFrame(Math.max(LIMITS.minFrameDuration, speed || 100)));
  /** Per frame: layer index → image (linked cels resolved later). */
  const cels: { layer: number; frame: number; image?: PixelBuffer; linkTo?: number }[] = [];
  const tags: Tag[] = [];
  let pendingTagUserData = 0;
  let total = 0;

  // Raw cel pixels are converted after the palette is known (it may come later in the frame).
  const pendingPixels: { cel: (typeof cels)[number]; x: number; y: number; w: number; h: number; data: Uint8Array; opacity: number }[] = [];
  const pendingTiles: { cel: (typeof cels)[number]; x: number; y: number; w: number; h: number; tiles: Uint32Array; idMask: number; xf: number; yf: number; df: number; opacity: number }[] = [];
  let lastObject: 'layer' | 'cel' | 'tags' | 'other' = 'other';

  for (let fi = 0; fi < frameCount; fi++) {
    const start = r.pos;
    const frameBytes = r.dword();
    if (r.word() !== FRAME_MAGIC) throw new AsepriteError(`Quadro ${fi + 1} corrompido no arquivo .aseprite.`);
    const oldChunks = r.word();
    const duration = r.word();
    r.skip(2);
    const newChunks = r.dword();
    if (duration > 0) frames[fi] = { ...frames[fi]!, duration: Math.max(LIMITS.minFrameDuration, Math.min(LIMITS.maxFrameDuration, duration)) };
    const chunks = newChunks || (oldChunks === 0xffff ? 0 : oldChunks);
    const frameEnd = start + frameBytes;
    if (frameEnd > bytes.length) throw new AsepriteError('Arquivo .aseprite truncado.');
    for (let ci = 0; ci < chunks && r.pos < frameEnd; ci++) {
      const cstart = r.pos;
      const size = r.dword();
      const type = r.word();
      const cend = cstart + size;
      if (size < 6 || cend > frameEnd) throw new AsepriteError('Bloco inválido no arquivo .aseprite.');
      switch (type) {
        case 0x0004:
        case 0x0011: {
          if (sawNewPalette) break;
          const packets = r.word();
          let idx = 0;
          for (let p = 0; p < packets; p++) {
            idx += r.byte();
            const n = r.byte() || 256;
            for (let k = 0; k < n; k++) {
              let [cr, cg, cb] = [r.byte(), r.byte(), r.byte()];
              if (type === 0x0011) [cr, cg, cb] = [(cr << 2) | (cr >> 4), (cg << 2) | (cg >> 4), (cb << 2) | (cb >> 4)];
              palette[idx++] = rgba(cr, cg, cb);
            }
          }
          lastObject = 'other';
          break;
        }
        case 0x2019: {
          sawNewPalette = true;
          const n = r.dword();
          const from = r.dword();
          const to = r.dword();
          r.skip(8);
          if (n > 65536 || to >= n || from > to) throw new AsepriteError('Paleta inválida no arquivo .aseprite.');
          if (palette.length < n) palette = [...palette, ...new Array<RGBA>(n - palette.length).fill(0)];
          palette.length = n;
          for (let k = from; k <= to; k++) {
            const ef = r.word();
            palette[k] = rgba(r.byte(), r.byte(), r.byte(), r.byte());
            if (ef & 1) r.string();
          }
          lastObject = 'other';
          break;
        }
        case 0x2004: {
          if (layers.length >= LIMITS.maxLayers) throw new AsepriteError(`O arquivo tem mais de ${LIMITS.maxLayers} camadas.`);
          const lf = r.word();
          const lt = r.word();
          const level = r.word();
          r.skip(4);
          const blend = r.word();
          const opacity = r.byte();
          r.skip(3);
          const lname = r.string();
          const tileset = lt === 2 ? r.dword() : -1;
          layers.push({ type: lt, flags: lf, level, blend, opacity: flags & 1 ? opacity : 255, name: lname, tileset });
          lastObject = 'layer';
          break;
        }
        case 0x2005: {
          const layer = r.word();
          const x = r.short();
          const y = r.short();
          const opacity = r.byte();
          const ct = r.word();
          r.short(); // z-index: PixelCraft keeps the layer order
          r.skip(5);
          const cel: (typeof cels)[number] = { layer, frame: fi };
          if (ct === 1) cel.linkTo = r.word();
          else if (ct === 0 || ct === 2) {
            const w = r.word();
            const h = r.word();
            if (w > LIMITS.maxDimension || h > LIMITS.maxDimension) throw new AsepriteError('Célula grande demais no arquivo .aseprite.');
            total += w * h * 4;
            if (total > LIMITS.maxTotalImageBytes) throw new AsepriteError('O arquivo excede o limite de memória de imagens.');
            const raw = r.bytes(cend - r.pos);
            const data = ct === 0 ? raw.subarray(0, w * h * bpp) : inflate(raw, w * h * bpp);
            if (data.length < w * h * bpp) throw new AsepriteError('Célula truncada no arquivo .aseprite.');
            pendingPixels.push({ cel, x, y, w, h, data, opacity });
          } else if (ct === 3) {
            const w = r.word();
            const h = r.word();
            const bits = r.word();
            const idMask = r.dword();
            const xf = r.dword();
            const yf = r.dword();
            const df = r.dword();
            r.skip(10);
            if (w * h > LIMITS.maxPixels || ![8, 16, 32].includes(bits)) throw new AsepriteError('Mapa de tiles inválido no arquivo .aseprite.');
            const data = inflate(r.bytes(cend - r.pos), (w * h * bits) / 8);
            const tiles = new Uint32Array(w * h);
            for (let k = 0; k < w * h; k++) {
              if (bits === 8) tiles[k] = data[k]!;
              else if (bits === 16) tiles[k] = data[k * 2]! | (data[k * 2 + 1]! << 8);
              else tiles[k] = (data[k * 4]! | (data[k * 4 + 1]! << 8) | (data[k * 4 + 2]! << 16) | (data[k * 4 + 3]! << 24)) >>> 0;
            }
            pendingTiles.push({ cel, x, y, w, h, tiles, idMask, xf, yf, df, opacity });
          }
          cels.push(cel);
          lastObject = 'cel';
          break;
        }
        case 0x2018: {
          const n = r.word();
          r.skip(8);
          for (let k = 0; k < n; k++) {
            const from = r.word();
            const to = r.word();
            const dir = r.byte();
            const repeat = r.word();
            r.skip(6);
            const [cr, cg, cb] = [r.byte(), r.byte(), r.byte()];
            r.skip(1);
            const tname = r.string();
            const a = frames[Math.min(from, frameCount - 1)]!;
            const b = frames[Math.min(to, frameCount - 1)]!;
            tags.push({
              id: newId('T'),
              name: tname.slice(0, 60) || `Tag ${k + 1}`,
              from: a.id,
              to: b.id,
              color: `#${[cr, cg, cb].map((v) => v.toString(16).padStart(2, '0')).join('')}`,
              direction: DIRECTIONS[dir] ?? 'forward',
              repeat: Math.min(1000, repeat),
            });
          }
          pendingTagUserData = n;
          lastObject = 'tags';
          break;
        }
        case 0x2020: {
          const uf = r.dword();
          if (uf & 1) r.string();
          if (uf & 2 && lastObject === 'tags' && pendingTagUserData > 0) {
            const tag = tags[tags.length - pendingTagUserData]!;
            const [cr, cg, cb] = [r.byte(), r.byte(), r.byte()];
            r.byte();
            tag.color = `#${[cr, cg, cb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
          }
          if (lastObject === 'tags' && pendingTagUserData > 0) pendingTagUserData--;
          break;
        }
        case 0x2023: {
          const id = r.dword();
          const tf = r.dword();
          const count = r.dword();
          const tileW = r.word();
          const tileH = r.word();
          r.short();
          r.skip(14);
          r.string();
          if (tf & 1) r.skip(8);
          if (tf & 2) {
            const len = r.dword();
            if (tileW * tileH * count > LIMITS.maxPixels) throw new AsepriteError('Tileset grande demais no arquivo .aseprite.');
            const data = inflate(r.bytes(len), tileW * tileH * count * bpp);
            tilesets.set(id, { tileW, tileH, count, image: new PixelBuffer(tileW, tileH * count, new Uint8ClampedArray(data.length / bpp * 4)) });
            pendingTileset.push({ id, data });
          }
          lastObject = 'other';
          break;
        }
        default:
          lastObject = type === 0x2022 ? 'other' : lastObject;
      }
      r.pos = cend;
    }
    r.pos = frameEnd;
  }

  /** Converts raw pixels of the sprite's colour mode to RGBA. */
  const toRgba = (src: Uint8Array, out: Uint8ClampedArray, n: number, background: boolean, opacity: number): void => {
    for (let k = 0; k < n; k++) {
      let cr: number;
      let cg: number;
      let cb: number;
      let ca: number;
      if (bpp === 4) [cr, cg, cb, ca] = [src[k * 4]!, src[k * 4 + 1]!, src[k * 4 + 2]!, src[k * 4 + 3]!];
      else if (bpp === 2) [cr, cg, cb, ca] = [src[k * 2]!, src[k * 2]!, src[k * 2]!, src[k * 2 + 1]!];
      else {
        const idx = src[k]!;
        if (idx === transparentIndex && !background) [cr, cg, cb, ca] = [0, 0, 0, 0];
        else {
          const c = palette[idx] ?? 0;
          [cr, cg, cb, ca] = [c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
        }
      }
      out[k * 4] = cr;
      out[k * 4 + 1] = cg;
      out[k * 4 + 2] = cb;
      out[k * 4 + 3] = Math.round((ca * opacity) / 255);
    }
  };

  for (const t of pendingTileset) {
    const ts = tilesets.get(t.id)!;
    toRgba(t.data, ts.image.data, ts.tileW * ts.tileH * ts.count, false, 255);
  }

  const isBackground = (layer: number): boolean => !!((layers[layer]?.flags ?? 0) & 8);
  for (const p of pendingPixels) {
    const piece = new PixelBuffer(p.w, p.h);
    toRgba(p.data, piece.data, p.w * p.h, isBackground(p.cel.layer), p.opacity);
    const img = new PixelBuffer(width, height);
    img.paste(piece, p.x, p.y);
    // paste() replaces; a cel never overlaps itself so replacing is correct.
    p.cel.image = img;
  }
  for (const t of pendingTiles) {
    const ts = tilesets.get(layers[t.cel.layer]?.tileset ?? -1);
    const img = new PixelBuffer(width, height);
    if (ts) {
      for (let ty = 0; ty < t.h; ty++)
        for (let tx = 0; tx < t.w; tx++) {
          const v = t.tiles[ty * t.w + tx]!;
          const id = v & t.idMask;
          if (id === 0 || id >= ts.count) continue;
          for (let py = 0; py < ts.tileH; py++)
            for (let px = 0; px < ts.tileW; px++) {
              let sx = px;
              let sy = py;
              if (v & t.df) [sx, sy] = [sy, sx];
              if (v & t.xf) sx = ts.tileW - 1 - sx;
              if (v & t.yf) sy = ts.tileH - 1 - sy;
              const c = ts.image.get(sx, id * ts.tileH + sy);
              const a = Math.round(((c & 255) * t.opacity) / 255);
              img.set(t.x + tx * ts.tileW + px, t.y + ty * ts.tileH + py, ((c & 0xffffff00) | a) >>> 0);
            }
        }
    }
    t.cel.image = img;
  }

  // Layer tree from child levels; ids are assigned in file order (NOTE.2).
  const nodes: LayerNode[] = layers.map((l, i) => {
    const props = {
      visible: !!(l.flags & 1),
      locked: !(l.flags & 2),
      opacity: Math.round((l.opacity / 255) * 100),
      blendMode: ASE_BLEND[l.blend] ?? 'normal',
      exportable: !(l.flags & 64),
    };
    const lname = l.name.slice(0, LIMITS.maxNameLength) || `Camada ${i + 1}`;
    return l.type === 1 ? makeGroupLayer(lname, [], { ...props, expanded: !(l.flags & 32) }) : makePixelLayer(lname, props);
  });
  // Aseprite lists layers bottom to top with children right after their group.
  const roots: LayerNode[] = [];
  const stack: GroupLayer[] = [];
  layers.forEach((l, i) => {
    const node = nodes[i]!;
    stack.length = Math.min(stack.length, l.level);
    const parent = stack[l.level - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    if (node.type === 'group') stack[l.level] = node;
  });
  const depthOk = (ls: LayerNode[], d: number): boolean => d <= LIMITS.maxGroupDepth && ls.every((x) => x.type !== 'group' || depthOk(x.children, d + 1));
  if (!depthOk(roots, 0)) throw new AsepriteError('Grupos aninhados em excesso no arquivo .aseprite.');
  if (!roots.length) roots.push(makePixelLayer('Camada 1'));

  const images = new Map<string, PixelBuffer>();
  const celMap: Record<string, string> = {};
  const byPos = new Map<string, string>();
  for (const c of cels) {
    const node = nodes[c.layer];
    if (!node || node.type !== 'pixel' || !c.image) continue;
    if (c.image.isEmpty()) continue;
    const id = newId('I');
    images.set(id, c.image);
    celMap[celKey(node.id, frames[c.frame]!.id)] = id;
    byPos.set(`${c.layer}/${c.frame}`, id);
  }
  for (const c of cels) {
    if (c.linkTo === undefined) continue;
    const node = nodes[c.layer];
    const target = byPos.get(`${c.layer}/${c.linkTo}`);
    if (node && target) celMap[celKey(node.id, frames[c.frame]!.id)] = target;
  }

  const base = defaultPalette();
  const colors = palette.filter((_, i) => i < LIMITS.maxPaletteColors);
  const state: DocState = {
    width,
    height,
    layers: roots,
    frames,
    tags,
    cels: celMap,
    palette: colors.length ? { id: newId('P'), name: 'Paleta do Aseprite', colors } : base,
    animation: { ...DEFAULT_ANIMATION },
    tiles: gridW > 0 && gridH > 0 ? { width: gridW, height: gridH, offsetX: Math.max(0, gridX % gridW), offsetY: Math.max(0, gridY % gridH) } : { ...DEFAULT_TILES },
    guides: [],
    symmetry: { horizontal: false, vertical: false, axisX: width / 2, axisY: height / 2 },
  };
  if (allLayers(roots).length > LIMITS.maxLayers) throw new AsepriteError('O arquivo tem camadas demais.');
  return { id: newId('D'), name, state, images };
}

class Writer {
  private parts: Uint8Array[] = [];
  length = 0;
  private push(a: Uint8Array): void {
    this.parts.push(a);
    this.length += a.length;
  }
  byte(v: number): void {
    this.push(Uint8Array.of(v & 255));
  }
  word(v: number): void {
    this.push(Uint8Array.of(v & 255, (v >> 8) & 255));
  }
  dword(v: number): void {
    this.push(Uint8Array.of(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255));
  }
  zeros(n: number): void {
    this.push(new Uint8Array(n));
  }
  bytes(a: Uint8Array): void {
    this.push(a);
  }
  string(s: string): void {
    const b = new TextEncoder().encode(s);
    this.word(b.length);
    this.push(b);
  }
  done(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

function chunk(type: number, body: (w: Writer) => void): Uint8Array {
  const w = new Writer();
  body(w);
  const data = w.done();
  const out = new Writer();
  out.dword(data.length + 6);
  out.word(type);
  out.bytes(data);
  return out.done();
}

/** Writes the document as an RGBA .aseprite file. */
export function encodeAseprite(doc: ProjectDocument): Uint8Array {
  const st = doc.state;
  // Flatten the tree in Aseprite order: bottom to top, children after their group.
  const flat: { node: LayerNode; level: number }[] = [];
  const walk = (ls: LayerNode[], level: number): void => {
    for (const l of ls) {
      flat.push({ node: l, level });
      if (l.type === 'group') walk(l.children, level + 1);
    }
  };
  walk(st.layers, 0);
  const frameChunks: Uint8Array[][] = st.frames.map(() => []);
  const first = frameChunks[0]!;
  first.push(
    chunk(0x2019, (w) => {
      const pal = st.palette.colors.length ? st.palette.colors : [0];
      w.dword(pal.length);
      w.dword(0);
      w.dword(pal.length - 1);
      w.zeros(8);
      for (const c of pal) {
        w.word(0);
        w.byte(c >>> 24);
        w.byte((c >>> 16) & 255);
        w.byte((c >>> 8) & 255);
        w.byte(c & 255);
      }
    }),
  );
  for (const { node, level } of flat) {
    first.push(
      chunk(0x2004, (w) => {
        let f = 0;
        if (node.visible) f |= 1;
        if (!node.locked) f |= 2;
        if (node.type === 'group' && !node.expanded) f |= 32;
        if (!node.exportable) f |= 64;
        w.word(f);
        w.word(node.type === 'group' ? 1 : 0);
        w.word(level);
        w.word(0);
        w.word(0);
        w.word(Math.max(0, ASE_BLEND.indexOf(node.blendMode)));
        w.byte(Math.round((node.opacity / 100) * 255));
        w.zeros(3);
        w.string(node.name);
      }),
    );
  }
  if (st.tags.length) {
    const spans = st.tags.flatMap((t) => {
      const r = tagRange(st, t);
      return r ? [{ t, r }] : [];
    });
    first.push(
      chunk(0x2018, (w) => {
        w.word(spans.length);
        w.zeros(8);
        for (const { t, r } of spans) {
          w.word(r.from);
          w.word(r.to);
          w.byte(DIRECTIONS.indexOf(t.direction));
          w.word(t.repeat);
          w.zeros(6);
          const c = parseInt(t.color.slice(1), 16);
          w.byte((c >> 16) & 255);
          w.byte((c >> 8) & 255);
          w.byte(c & 255);
          w.byte(0);
          w.string(t.name);
        }
      }),
    );
    for (const { t } of spans)
      first.push(
        chunk(0x2020, (w) => {
          const c = parseInt(t.color.slice(1), 16);
          w.dword(2);
          w.byte((c >> 16) & 255);
          w.byte((c >> 8) & 255);
          w.byte(c & 255);
          w.byte(255);
        }),
      );
  }
  // Cels: the first frame that uses an image stores it, later ones link to it.
  flat.forEach(({ node }, li) => {
    if (node.type !== 'pixel') return;
    const seen = new Map<string, number>();
    st.frames.forEach((f, fi) => {
      const id = st.cels[celKey(node.id, f.id)];
      const img = id ? doc.images.get(id) : undefined;
      if (!id || !img) return;
      const linked = seen.get(id);
      if (linked !== undefined) {
        frameChunks[fi]!.push(
          chunk(0x2005, (w) => {
            w.word(li);
            w.word(0);
            w.word(0);
            w.byte(255);
            w.word(1);
            w.word(0);
            w.zeros(5);
            w.word(linked);
          }),
        );
        return;
      }
      const b = img.contentBounds();
      if (!b) return;
      seen.set(id, fi);
      const piece = img.extract(b);
      frameChunks[fi]!.push(
        chunk(0x2005, (w) => {
          w.word(li);
          w.word(b.x);
          w.word(b.y);
          w.byte(255);
          w.word(2);
          w.word(0);
          w.zeros(5);
          w.word(b.w);
          w.word(b.h);
          w.bytes(zlibSync(new Uint8Array(piece.data.buffer, piece.data.byteOffset, piece.data.length)));
        }),
      );
    });
  });

  const body = new Writer();
  st.frames.forEach((f, fi) => {
    const chunks = frameChunks[fi]!;
    const size = 16 + chunks.reduce((n, c) => n + c.length, 0);
    body.dword(size);
    body.word(FRAME_MAGIC);
    body.word(Math.min(chunks.length, 0xffff));
    body.word(f.duration);
    body.zeros(2);
    body.dword(chunks.length);
    for (const c of chunks) body.bytes(c);
  });
  const frames = body.done();
  const head = new Writer();
  head.dword(128 + frames.length);
  head.word(MAGIC);
  head.word(st.frames.length);
  head.word(st.width);
  head.word(st.height);
  head.word(32);
  head.dword(1 | 2);
  head.word(st.frames[0]?.duration ?? 100);
  head.zeros(8);
  head.byte(0);
  head.zeros(3);
  head.word(Math.min(256, st.palette.colors.length));
  head.byte(1);
  head.byte(1);
  head.word(st.tiles.offsetX);
  head.word(st.tiles.offsetY);
  head.word(st.tiles.width);
  head.word(st.tiles.height);
  head.zeros(84);
  const h = head.done();
  const out = new Uint8Array(h.length + frames.length);
  out.set(h);
  out.set(frames, h.length);
  return out;
}

export function isAseprite(bytes: Uint8Array): boolean {
  return bytes.length >= 6 && bytes[4] === 0xe0 && bytes[5] === 0xa5;
}

/** Blend modes Aseprite understands (all of PixelCraft's). */
export const ASEPRITE_BLEND_MODES: readonly BlendMode[] = BLEND_MODES;
