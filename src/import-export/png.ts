import { unzlibSync, zlibSync } from 'fflate';
import { PixelBuffer } from '../raster/pixel-buffer';
import { crc32 } from './crc32';

/**
 * Self-contained PNG codec. Pixels go straight between PixelBuffer and the
 * file without passing through a canvas, so exported and saved images are
 * bit-exact (a canvas would premultiply alpha and could round colors of
 * semi-transparent pixels).
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export class PngError extends Error {}

export interface PngEncodeOptions {
  /** zlib level 0..9, default 6. */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** tEXt chunks to embed. */
  text?: Record<string, string>;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out, 4, 8 + data.length);
  out.set(u32(crc), 8 + data.length);
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Filtered scanlines of an RGBA image, choosing a filter per row heuristically. */
function filterRows(img: PixelBuffer): Uint8Array {
  const { width: w, height: h, data } = img;
  if (w < 1 || h < 1) throw new PngError('Uma imagem PNG precisa ter pelo menos 1×1 pixel.');
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  const candidate = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    const prev = y > 0 ? row - stride : -1;
    let bestSum = Infinity;
    let bestType = 0;
    const best = new Uint8Array(stride);
    for (let type = 0; type < 5; type++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = data[row + i]!;
        const a = i >= 4 ? data[row + i - 4]! : 0;
        const b = prev >= 0 ? data[prev + i]! : 0;
        const c = i >= 4 && prev >= 0 ? data[prev + i - 4]! : 0;
        let v: number;
        switch (type) {
          case 0: v = x; break;
          case 1: v = x - a; break;
          case 2: v = x - b; break;
          case 3: v = x - ((a + b) >> 1); break;
          default: v = x - paeth(a, b, c);
        }
        v &= 255;
        candidate[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) {
        bestSum = sum;
        bestType = type;
        best.set(candidate);
      }
    }
    raw[y * (stride + 1)] = bestType;
    raw.set(best, y * (stride + 1) + 1);
  }
  return raw;
}

function ihdrChunk(w: number, h: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(w), 0);
  ihdr.set(u32(h), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return chunk('IHDR', ihdr);
}

function textChunks(text: Record<string, string> = {}): Uint8Array[] {
  return Object.entries(text).map(([k, v]) => {
    const kb = new TextEncoder().encode(k.slice(0, 79));
    const vb = new TextEncoder().encode(v);
    const d = new Uint8Array(kb.length + 1 + vb.length);
    d.set(kb, 0);
    d.set(vb, kb.length + 1);
    return chunk('tEXt', d);
  });
}

/** Encodes 8-bit RGBA (color type 6). */
export function encodePng(img: PixelBuffer, opts: PngEncodeOptions = {}): Uint8Array {
  const raw = filterRows(img);
  return concat([
    new Uint8Array(SIGNATURE),
    ihdrChunk(img.width, img.height),
    ...textChunks(opts.text),
    chunk('IDAT', zlibSync(raw, { level: opts.level ?? 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export interface ApngFrame {
  image: PixelBuffer;
  delayMs: number;
}

/**
 * Encodes an animated PNG. Unlike GIF it keeps full alpha, millions of
 * colours and millisecond durations. Every frame covers the whole canvas and
 * replaces it (APNG_BLEND_OP_SOURCE), so semi-transparent pixels never pile up.
 * `plays`: 0 = forever.
 */
export function encodeApng(frames: ApngFrame[], opts: PngEncodeOptions & { plays?: number } = {}): Uint8Array {
  const first = frames[0];
  if (!first) throw new PngError('Uma animação precisa de pelo menos um quadro.');
  const { width: w, height: h } = first.image;
  const parts: Uint8Array[] = [new Uint8Array(SIGNATURE), ihdrChunk(w, h)];
  const actl = new Uint8Array(8);
  actl.set(u32(frames.length), 0);
  actl.set(u32(opts.plays ?? 0), 4);
  parts.push(chunk('acTL', actl), ...textChunks(opts.text));
  let seq = 0;
  frames.forEach((f, i) => {
    if (f.image.width !== w || f.image.height !== h) throw new PngError('Todos os quadros de um APNG precisam ter o mesmo tamanho.');
    const fctl = new Uint8Array(26);
    fctl.set(u32(seq++), 0);
    fctl.set(u32(w), 4);
    fctl.set(u32(h), 8);
    // x/y offsets stay 0. Delay as a fraction of a second: ms / 1000.
    const delay = Math.max(0, Math.min(65535, Math.round(f.delayMs)));
    fctl[20] = delay >> 8;
    fctl[21] = delay & 255;
    fctl[22] = 1000 >> 8;
    fctl[23] = 1000 & 255;
    fctl[24] = 0; // dispose: none
    fctl[25] = 0; // blend: source
    parts.push(chunk('fcTL', fctl));
    const z = zlibSync(filterRows(f.image), { level: opts.level ?? 6 });
    if (i === 0) parts.push(chunk('IDAT', z));
    else {
      const fd = new Uint8Array(4 + z.length);
      fd.set(u32(seq++), 0);
      fd.set(z, 4);
      parts.push(chunk('fdAT', fd));
    }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return concat(parts);
}

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

export interface DecodeLimits {
  maxPixels: number;
}

function readU32(d: Uint8Array, o: number): number {
  return ((d[o]! << 24) | (d[o + 1]! << 16) | (d[o + 2]! << 8) | d[o + 3]!) >>> 0;
}

export function isPng(d: Uint8Array): boolean {
  return d.length >= 8 && SIGNATURE.every((b, i) => d[i] === b);
}

/** Reads the header only (cheap) — used to validate sizes before decoding. */
export function readPngInfo(d: Uint8Array): PngInfo {
  if (!isPng(d)) throw new PngError('O arquivo não é um PNG válido (assinatura ausente).');
  if (d.length < 33) throw new PngError('PNG truncado.');
  const type = String.fromCharCode(d[12]!, d[13]!, d[14]!, d[15]!);
  if (type !== 'IHDR') throw new PngError('PNG inválido: IHDR ausente.');
  return {
    width: readU32(d, 16),
    height: readU32(d, 20),
    bitDepth: d[24]!,
    colorType: d[25]!,
    interlace: d[28]!,
  };
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const VALID_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/**
 * Decodes any standard PNG (all color types and bit depths, tRNS, Adam7) to
 * 8-bit straight RGBA. 16-bit samples are reduced by taking the high byte.
 * Gamma/ICC chunks are ignored on purpose so stored values stay unchanged.
 */
export function decodePng(d: Uint8Array, limits: DecodeLimits = { maxPixels: 4096 * 4096 }): PixelBuffer {
  const info = readPngInfo(d);
  const { width: w, height: h, bitDepth, colorType, interlace } = info;
  if (w === 0 || h === 0) throw new PngError('PNG com dimensões nulas.');
  if (w * h > limits.maxPixels) throw new PngError(`Imagem grande demais (${w}×${h}).`);
  const channels = CHANNELS[colorType];
  if (!channels || !VALID_DEPTHS[colorType]!.includes(bitDepth)) {
    throw new PngError(`Formato PNG não suportado (tipo ${colorType}, ${bitDepth} bits).`);
  }
  if (interlace > 1) throw new PngError('Método de entrelaçamento PNG inválido.');

  let off = 8;
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  let sawEnd = false;
  while (off + 12 <= d.length) {
    const len = readU32(d, off);
    const type = String.fromCharCode(d[off + 4]!, d[off + 5]!, d[off + 6]!, d[off + 7]!);
    if (off + 12 + len > d.length) throw new PngError('PNG truncado.');
    const body = d.subarray(off + 8, off + 8 + len);
    const crc = readU32(d, off + 8 + len);
    if (crc32(d, off + 4, off + 8 + len) !== crc) throw new PngError(`PNG corrompido (CRC inválido no bloco ${type}).`);
    if (type === 'IDAT') idat.push(body);
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IEND') {
      sawEnd = true;
      break;
    }
    off += 12 + len;
  }
  if (!sawEnd && idat.length === 0) throw new PngError('PNG sem dados de imagem.');
  if (colorType === 3 && !palette) throw new PngError('PNG indexado sem paleta.');

  const bpp = Math.max(1, (channels * bitDepth) >> 3); // bytes per complete pixel for filtering
  const passes =
    interlace === 1
      ? [
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ]
      : [[0, 0, 1, 1]];
  let expected = 0;
  const passDims = passes.map(([x0, y0, dx, dy]) => {
    const pw = Math.ceil((w - x0!) / dx!);
    const ph = Math.ceil((h - y0!) / dy!);
    const stride = Math.ceil((pw * channels * bitDepth) / 8);
    if (pw > 0 && ph > 0) expected += (stride + 1) * ph;
    return { pw, ph, stride };
  });

  const compressed = concat(idat);
  let raw: Uint8Array;
  try {
    // Bounded output: a zip bomb cannot inflate past the expected size.
    raw = unzlibSync(compressed, { out: new Uint8Array(expected) });
  } catch {
    throw new PngError('Falha ao descompactar os dados do PNG.');
  }
  if (raw.length < expected) throw new PngError('Dados do PNG incompletos.');

  const out = new PixelBuffer(w, h);
  const px = out.data;
  let pos = 0;
  passes.forEach(([x0, y0, dx, dy], pi) => {
    const { pw, ph, stride } = passDims[pi]!;
    if (pw <= 0 || ph <= 0) return;
    let prev: Uint8Array = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const ft = raw[pos++]!;
      const line = raw.subarray(pos, pos + stride);
      pos += stride;
      unfilter(ft, line, prev, bpp);
      for (let x = 0; x < pw; x++) {
        const tx = x0! + x * dx!;
        const ty = y0! + y * dy!;
        writePixel(px, (ty * w + tx) * 4, line, x, colorType, bitDepth, palette, trns);
      }
      prev = line;
    }
  });
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function unfilter(type: number, line: Uint8Array, prev: Uint8Array, bpp: number): void {
  const n = line.length;
  switch (type) {
    case 0:
      return;
    case 1:
      for (let i = bpp; i < n; i++) line[i] = (line[i]! + line[i - bpp]!) & 255;
      return;
    case 2:
      for (let i = 0; i < n; i++) line[i] = (line[i]! + prev[i]!) & 255;
      return;
    case 3:
      for (let i = 0; i < n; i++) line[i] = (line[i]! + (((i >= bpp ? line[i - bpp]! : 0) + prev[i]!) >> 1)) & 255;
      return;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp]! : 0;
        const c = i >= bpp ? prev[i - bpp]! : 0;
        line[i] = (line[i]! + paeth(a, prev[i]!, c)) & 255;
      }
      return;
    default:
      throw new PngError(`Filtro PNG inválido (${type}).`);
  }
}

function sample(line: Uint8Array, index: number, depth: number): number {
  if (depth === 8) return line[index]!;
  if (depth === 16) return (line[index * 2]! << 8) | line[index * 2 + 1]!;
  const perByte = 8 / depth;
  const byte = line[Math.floor(index / perByte)]!;
  const shift = 8 - depth * ((index % perByte) + 1);
  return (byte >> shift) & ((1 << depth) - 1);
}

function to8(v: number, depth: number): number {
  if (depth === 8) return v;
  if (depth === 16) return v >> 8;
  return Math.round((v * 255) / ((1 << depth) - 1));
}

function writePixel(
  px: Uint8ClampedArray,
  o: number,
  line: Uint8Array,
  x: number,
  colorType: number,
  depth: number,
  palette: Uint8Array | null,
  trns: Uint8Array | null,
): void {
  switch (colorType) {
    case 0: {
      const v = sample(line, x, depth);
      const g = to8(v, depth);
      const transparent = trns && trns.length >= 2 && ((trns[0]! << 8) | trns[1]!) === v;
      px[o] = px[o + 1] = px[o + 2] = g;
      px[o + 3] = transparent ? 0 : 255;
      return;
    }
    case 2: {
      const r = sample(line, x * 3, depth);
      const g = sample(line, x * 3 + 1, depth);
      const b = sample(line, x * 3 + 2, depth);
      const transparent =
        trns && trns.length >= 6 && ((trns[0]! << 8) | trns[1]!) === r && ((trns[2]! << 8) | trns[3]!) === g && ((trns[4]! << 8) | trns[5]!) === b;
      px[o] = to8(r, depth);
      px[o + 1] = to8(g, depth);
      px[o + 2] = to8(b, depth);
      px[o + 3] = transparent ? 0 : 255;
      return;
    }
    case 3: {
      const i = sample(line, x, depth);
      if (!palette || i * 3 + 2 >= palette.length) {
        px[o] = px[o + 1] = px[o + 2] = px[o + 3] = 0;
        return;
      }
      px[o] = palette[i * 3]!;
      px[o + 1] = palette[i * 3 + 1]!;
      px[o + 2] = palette[i * 3 + 2]!;
      px[o + 3] = trns && i < trns.length ? trns[i]! : 255;
      return;
    }
    case 4: {
      const g = to8(sample(line, x * 2, depth), depth);
      px[o] = px[o + 1] = px[o + 2] = g;
      px[o + 3] = to8(sample(line, x * 2 + 1, depth), depth);
      return;
    }
    default: {
      px[o] = to8(sample(line, x * 4, depth), depth);
      px[o + 1] = to8(sample(line, x * 4 + 1, depth), depth);
      px[o + 2] = to8(sample(line, x * 4 + 2, depth), depth);
      px[o + 3] = to8(sample(line, x * 4 + 3, depth), depth);
    }
  }
}
