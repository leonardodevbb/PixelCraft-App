import { PixelBuffer } from '../raster/pixel-buffer';

export class BmpError extends Error {}

/**
 * 32-bit BMP with a BITMAPV4HEADER and explicit channel masks, so the alpha
 * channel survives in programs that support it (GIMP, browsers).
 */
export function encodeBmp(img: PixelBuffer): Uint8Array {
  const { width, height } = img;
  const headerSize = 14 + 108;
  const dataSize = width * height * 4;
  const out = new Uint8Array(headerSize + dataSize);
  const v = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  v.setUint32(2, out.length, true);
  v.setUint32(10, headerSize, true);
  v.setUint32(14, 108, true);
  v.setInt32(18, width, true);
  v.setInt32(22, -height, true); // top-down
  v.setUint16(26, 1, true);
  v.setUint16(28, 32, true);
  v.setUint32(30, 3, true); // BI_BITFIELDS
  v.setUint32(34, dataSize, true);
  v.setUint32(38, 2835, true); // 72 DPI
  v.setUint32(42, 2835, true);
  v.setUint32(54, 0x00ff0000, true); // R
  v.setUint32(58, 0x0000ff00, true); // G
  v.setUint32(62, 0x000000ff, true); // B
  v.setUint32(66, 0xff000000, true); // A
  v.setUint32(70, 0x73524742, true); // 'sRGB'
  const d = img.data;
  for (let i = 0, o = headerSize; i < d.length; i += 4, o += 4) {
    out[o] = d[i + 2]!;
    out[o + 1] = d[i + 1]!;
    out[o + 2] = d[i]!;
    out[o + 3] = d[i + 3]!;
  }
  return out;
}

/** Decodes uncompressed 24/32-bit BMPs (the common case); others go through the browser decoder. */
export function decodeBmp(data: Uint8Array, maxPixels: number): PixelBuffer {
  if (data.length < 54 || data[0] !== 0x42 || data[1] !== 0x4d) throw new BmpError('Não é um BMP.');
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const offset = v.getUint32(10, true);
  const hsize = v.getUint32(14, true);
  if (hsize < 40) throw new BmpError('Cabeçalho BMP não suportado.');
  const width = v.getInt32(18, true);
  const rawH = v.getInt32(22, true);
  const height = Math.abs(rawH);
  const bpp = v.getUint16(28, true);
  const comp = v.getUint32(30, true);
  if (width <= 0 || height <= 0 || width * height > maxPixels) throw new BmpError('Dimensões do BMP inválidas ou grandes demais.');
  if (!(bpp === 24 || bpp === 32) || !(comp === 0 || comp === 3)) throw new BmpError('Formato BMP não suportado.');
  let masks = [0x00ff0000, 0x0000ff00, 0x000000ff, bpp === 32 ? 0xff000000 : 0];
  if (comp === 3) {
    const mOff = hsize >= 52 ? 54 : 14 + hsize;
    masks = [v.getUint32(mOff, true), v.getUint32(mOff + 4, true), v.getUint32(mOff + 8, true), hsize >= 56 ? v.getUint32(mOff + 12, true) : 0];
  }
  // Bit position and width of each channel mask.
  const sh = masks.map((m) => (m ? 31 - Math.clz32(m & -m) : 0));
  const bits = masks.map((m, i) => (m ? 32 - Math.clz32(m >>> sh[i]!) : 0));
  const scaleTo8 = (val: number, b: number): number => (b === 8 ? val : b === 0 ? 255 : Math.round((val * 255) / ((1 << b) - 1)));
  const stride = Math.ceil((width * bpp) / 32) * 4;
  if (offset + stride * height > data.length) throw new BmpError('Arquivo BMP truncado.');
  const img = new PixelBuffer(width, height);
  const out = img.data;
  const hasAlpha = bpp === 32 && masks[3] !== 0;
  for (let y = 0; y < height; y++) {
    const row = rawH > 0 ? height - 1 - y : y;
    const base = offset + row * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (bpp === 24) {
        const p = base + x * 3;
        out[o] = data[p + 2]!;
        out[o + 1] = data[p + 1]!;
        out[o + 2] = data[p]!;
        out[o + 3] = 255;
      } else {
        const px = v.getUint32(base + x * 4, true);
        for (let c = 0; c < 3; c++) out[o + c] = scaleTo8(((px & masks[c]!) >>> 0) >>> sh[c]!, bits[c]!);
        out[o + 3] = hasAlpha ? scaleTo8(((px & masks[3]!) >>> 0) >>> sh[3]!, bits[3]!) : 255;
      }
    }
  }
  // 32-bit BI_RGB files usually leave the 4th byte unused (0): treat as opaque.
  if (bpp === 32 && comp === 0) {
    let any = false;
    for (let i = 3; i < out.length; i += 4) if (out[i]) {
      any = true;
      break;
    }
    if (!any) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  }
  return img;
}
