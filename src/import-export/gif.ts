import { medianCut, nearestColor } from '../palette/analysis';
import { alpha, blue, green, red, rgba, type RGBA } from '../raster/color';
import { PixelBuffer } from '../raster/pixel-buffer';

/* ======================================================================
 * GIF89a encoder and decoder, written for PixelCraft.
 * GIF stores at most 256 colours and 1-bit transparency, so the encoder
 * keeps colours exact when it can and otherwise quantises with median cut.
 * ====================================================================== */

export class GifError extends Error {}

export interface GifFrameIn {
  image: PixelBuffer;
  delayMs: number;
}

export interface GifEncodeOptions {
  /** null = play once; 0 = loop forever; n = repeat n extra times. */
  loop: number | null;
  /** Pixels with alpha below this become transparent (GIF has no partial alpha). */
  alphaThreshold?: number;
  /** When set, semi-transparent pixels are blended over this colour first. */
  matte?: RGBA | null;
}

export interface GifEncodeReport {
  bytes: Uint8Array;
  colors: number;
  /** True when the image had more colours than GIF allows and was quantised. */
  quantized: boolean;
  /** True when some delays had to be rounded to 10 ms steps. */
  delaysRounded: boolean;
}

class ByteWriter {
  private buf = new Uint8Array(1 << 16);
  length = 0;
  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.length));
    this.buf = b;
  }
  byte(v: number): void {
    this.ensure(1);
    this.buf[this.length++] = v & 255;
  }
  u16(v: number): void {
    this.byte(v);
    this.byte(v >> 8);
  }
  bytes(a: ArrayLike<number>): void {
    this.ensure(a.length);
    this.buf.set(a, this.length);
    this.length += a.length;
  }
  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

function prepare(c: RGBA, threshold: number, matte: RGBA | null): RGBA | null {
  const a = alpha(c);
  if (matte !== null && a > 0 && a < 255) {
    const t = a / 255;
    return rgba(
      Math.round(red(c) * t + red(matte) * (1 - t)),
      Math.round(green(c) * t + green(matte) * (1 - t)),
      Math.round(blue(c) * t + blue(matte) * (1 - t)),
    );
  }
  if (a === 0 || a < threshold) return null;
  return rgba(red(c), green(c), blue(c));
}

/** LZW-compresses palette indices into GIF sub-blocks. */
function lzw(w: ByteWriter, indices: Uint8Array, minCodeSize: number): void {
  w.byte(minCodeSize);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let next = eoi + 1;
  let size = minCodeSize + 1;
  let table = new Map<number, number>();
  const block = new Uint8Array(255);
  let blockLen = 0;
  let acc = 0;
  let bits = 0;
  const flushBlock = (): void => {
    if (!blockLen) return;
    w.byte(blockLen);
    w.bytes(block.subarray(0, blockLen));
    blockLen = 0;
  };
  const emit = (code: number): void => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      block[blockLen++] = acc & 255;
      if (blockLen === 255) flushBlock();
      acc >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0] ?? 0;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!;
    const key = prefix * 256 + k;
    const found = table.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table = new Map();
      next = eoi + 1;
      size = minCodeSize + 1;
    } else {
      if (next >= 1 << size) size++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) {
    block[blockLen++] = acc & 255;
    if (blockLen === 255) flushBlock();
  }
  flushBlock();
  w.byte(0);
}

export function encodeGif(frames: GifFrameIn[], opts: GifEncodeOptions): GifEncodeReport {
  if (frames.length === 0) throw new GifError('Nenhum quadro para exportar.');
  const { width, height } = frames[0]!.image;
  if (width > 65535 || height > 65535) throw new GifError('GIF suporta no máximo 65535×65535 pixels.');
  for (const f of frames) if (f.image.width !== width || f.image.height !== height) throw new GifError('Todos os quadros precisam ter o mesmo tamanho.');
  const threshold = opts.alphaThreshold ?? 128;
  const matte = opts.matte ?? null;

  // Normalise pixels and gather colours.
  const prepared = frames.map((f) => {
    const out = new Uint32Array(width * height);
    const d = f.image.data;
    for (let i = 0, p = 0; p < out.length; p++, i += 4) {
      const c = ((d[i]! << 24) | (d[i + 1]! << 16) | (d[i + 2]! << 8) | d[i + 3]!) >>> 0;
      const n = prepare(c, threshold, matte);
      out[p] = n === null ? 0 : n;
    }
    return out;
  });
  let hasTransparent = false;
  const counts = new Map<RGBA, number>();
  for (const px of prepared)
    for (let i = 0; i < px.length; i++) {
      const c = px[i]!;
      if (c === 0) hasTransparent = true;
      else counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  const maxColors = hasTransparent ? 255 : 256;
  const quantized = counts.size > maxColors;
  const colors = quantized ? medianCut(counts, maxColors) : [...counts.keys()];
  if (colors.length === 0) colors.push(rgba(0, 0, 0));
  const offset = hasTransparent ? 1 : 0; // index 0 = transparent
  const index = new Map<RGBA, number>();
  if (!quantized) colors.forEach((c, i) => index.set(c, i + offset));
  const lookup = (c: RGBA): number => {
    if (c === 0) return 0;
    let i = index.get(c);
    if (i === undefined) {
      i = colors.indexOf(nearestColor(c, colors)) + offset;
      index.set(c, i);
    }
    return i;
  };
  const total = colors.length + offset;
  let bitsPerColor = 1;
  while (1 << bitsPerColor < total) bitsPerColor++;
  const tableSize = 1 << bitsPerColor;

  const w = new ByteWriter();
  w.ascii('GIF89a');
  w.u16(width);
  w.u16(height);
  w.byte(0x80 | 0x70 | (bitsPerColor - 1));
  w.byte(0);
  w.byte(0);
  for (let i = 0; i < tableSize; i++) {
    const c = i < offset ? 0 : (colors[i - offset] ?? 0);
    w.byte(red(c));
    w.byte(green(c));
    w.byte(blue(c));
  }
  if (opts.loop !== null && frames.length > 1) {
    w.bytes([0x21, 0xff, 0x0b]);
    w.ascii('NETSCAPE2.0');
    w.bytes([3, 1]);
    w.u16(Math.max(0, Math.min(65535, opts.loop)));
    w.byte(0);
  }
  let delaysRounded = false;
  const indices = new Uint8Array(width * height);
  const minCode = Math.max(2, bitsPerColor);
  frames.forEach((f, fi) => {
    const cs = Math.max(2, Math.round(f.delayMs / 10));
    if (cs * 10 !== f.delayMs) delaysRounded = true;
    w.bytes([0x21, 0xf9, 4]);
    w.byte(((hasTransparent ? 2 : 1) << 2) | (hasTransparent ? 1 : 0));
    w.u16(Math.min(65535, cs));
    w.byte(0);
    w.byte(0);
    w.byte(0x2c);
    w.u16(0);
    w.u16(0);
    w.u16(width);
    w.u16(height);
    w.byte(0);
    const px = prepared[fi]!;
    for (let i = 0; i < px.length; i++) indices[i] = lookup(px[i]!);
    lzw(w, indices, minCode);
  });
  w.byte(0x3b);
  return { bytes: w.result(), colors: colors.length, quantized, delaysRounded };
}

/* ---------------- decoder ---------------- */

export interface GifFrameOut {
  image: PixelBuffer;
  delayMs: number;
}

export interface GifDecodeOptions {
  maxPixels: number;
  maxFrames: number;
}

class Reader {
  pos = 0;
  constructor(private readonly d: Uint8Array) {}
  get left(): number {
    return this.d.length - this.pos;
  }
  byte(): number {
    if (this.pos >= this.d.length) throw new GifError('Arquivo GIF truncado.');
    return this.d[this.pos++]!;
  }
  u16(): number {
    return this.byte() | (this.byte() << 8);
  }
  take(n: number): Uint8Array {
    if (this.pos + n > this.d.length) throw new GifError('Arquivo GIF truncado.');
    const out = this.d.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  subBlocks(): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (;;) {
      const n = this.byte();
      if (n === 0) return out;
      out.push(this.take(n));
    }
  }
}

function lzwDecode(blocks: Uint8Array[], minCodeSize: number, pixelCount: number): Uint8Array {
  if (minCodeSize < 2 || minCodeSize > 8) throw new GifError('Tamanho de código LZW inválido.');
  const out = new Uint8Array(pixelCount);
  let op = 0;
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const lengths = new Uint16Array(4096);
  for (let i = 0; i < clear; i++) {
    suffix[i] = i;
    lengths[i] = 1;
    prefix[i] = -1;
  }
  let next = eoi + 1;
  let size = minCodeSize + 1;
  let prev = -1;
  let acc = 0;
  let bits = 0;
  const stack = new Uint8Array(4096);
  outer: for (const b of blocks) {
    for (let bi = 0; bi < b.length; bi++) {
      acc |= b[bi]! << bits;
      bits += 8;
      while (bits >= size) {
        const code = acc & ((1 << size) - 1);
        acc >>>= size;
        bits -= size;
        if (code === clear) {
          next = eoi + 1;
          size = minCodeSize + 1;
          prev = -1;
          continue;
        }
        if (code === eoi) break outer;
        let cur = code;
        if (code < next && (code < clear || code > eoi)) {
          // known code
        } else if (code === next && prev >= 0) {
          cur = prev;
        } else if (code < clear) {
          // literal
        } else throw new GifError('Dados LZW corrompidos no GIF.');
        // Unwind `cur` into the stack.
        let sp = 0;
        let c = cur;
        while (c >= 0) {
          if (sp >= 4096) throw new GifError('Dados LZW corrompidos no GIF.');
          stack[sp++] = suffix[c]!;
          c = prefix[c]!;
        }
        const first = stack[sp - 1]!;
        for (let i = sp - 1; i >= 0 && op < pixelCount; i--) out[op++] = stack[i]!;
        if (code === next && prev >= 0 && op < pixelCount) out[op++] = first;
        if (prev >= 0 && next < 4096) {
          prefix[next] = prev;
          suffix[next] = first;
          lengths[next] = lengths[prev]! + 1;
          next++;
          if (next === 1 << size && size < 12) size++;
        }
        prev = code;
        if (op >= pixelCount) break outer;
      }
    }
  }
  return out;
}

/** Decodes every frame of a GIF into full-canvas RGBA buffers (disposal applied). */
export function decodeGif(data: Uint8Array, opts: GifDecodeOptions): GifFrameOut[] {
  const r = new Reader(data);
  const sig = String.fromCharCode(...r.take(6));
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new GifError('Não é um arquivo GIF.');
  const width = r.u16();
  const height = r.u16();
  if (!width || !height) throw new GifError('GIF com dimensões inválidas.');
  if (width * height > opts.maxPixels) throw new GifError(`O GIF (${width}×${height}) excede o tamanho máximo suportado.`);
  const packed = r.byte();
  r.byte(); // background index (ignored: we use transparency)
  r.byte();
  let global: Uint8Array | null = null;
  if (packed & 0x80) global = r.take(3 * (1 << ((packed & 7) + 1)));

  const canvas = new PixelBuffer(width, height);
  const frames: GifFrameOut[] = [];
  let gce = { disposal: 0, delay: 0, transparent: -1 };
  for (;;) {
    if (r.left <= 0) break;
    const t = r.byte();
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = r.byte();
      if (label === 0xf9) {
        const blocks = r.subBlocks();
        const b = blocks[0];
        if (b && b.length >= 4) gce = { disposal: (b[0]! >> 2) & 7, delay: b[1]! | (b[2]! << 8), transparent: b[0]! & 1 ? b[3]! : -1 };
      } else r.subBlocks();
      continue;
    }
    if (t !== 0x2c) throw new GifError('Bloco GIF desconhecido.');
    if (frames.length >= opts.maxFrames) throw new GifError(`O GIF tem mais de ${opts.maxFrames} quadros.`);
    const fx = r.u16();
    const fy = r.u16();
    const fw = r.u16();
    const fh = r.u16();
    const fp = r.byte();
    let table = global;
    if (fp & 0x80) table = r.take(3 * (1 << ((fp & 7) + 1)));
    if (!table) throw new GifError('GIF sem tabela de cores.');
    const interlaced = (fp & 0x40) !== 0;
    const minCode = r.byte();
    const pixels = lzwDecode(r.subBlocks(), minCode, fw * fh);
    const before = gce.disposal === 3 ? canvas.clone() : null;
    const rowOrder = interlaced ? interlaceRows(fh) : null;
    for (let y = 0; y < fh; y++) {
      const dy = fy + (rowOrder ? rowOrder[y]! : y);
      if (dy >= height) continue;
      for (let x = 0; x < fw; x++) {
        const dx = fx + x;
        if (dx >= width) continue;
        const idx = pixels[y * fw + x]!;
        if (idx === gce.transparent) continue;
        const o = idx * 3;
        if (o + 2 >= table.length) continue;
        canvas.set(dx, dy, rgba(table[o]!, table[o + 1]!, table[o + 2]!));
      }
    }
    frames.push({ image: canvas.clone(), delayMs: (gce.delay || 10) * 10 });
    if (gce.disposal === 2) {
      for (let y = fy; y < Math.min(height, fy + fh); y++) for (let x = fx; x < Math.min(width, fx + fw); x++) canvas.set(x, y, 0);
    } else if (gce.disposal === 3 && before) canvas.paste(before, 0, 0);
    gce = { disposal: 0, delay: 0, transparent: -1 };
  }
  if (frames.length === 0) throw new GifError('O GIF não contém imagens.');
  return frames;
}

/** Maps stored row number → actual row for interlaced images. */
function interlaceRows(h: number): number[] {
  const rows: number[] = [];
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ] as const)
    for (let y = start; y < h; y += step) rows.push(y);
  return rows;
}
