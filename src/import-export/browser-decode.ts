import { PixelBuffer } from '../raster/pixel-buffer';
import { decodePng, isPng } from './png';
import { decodeGif } from './gif';
import { BmpError, decodeBmp } from './bmp';

export class ImageDecodeError extends Error {}

export function sniffImageType(d: Uint8Array): 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | null {
  if (isPng(d)) return 'png';
  if (d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) return 'jpeg';
  if (d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x38) return 'gif';
  if (d[0] === 0x52 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x46 && d[8] === 0x57 && d[9] === 0x45 && d[10] === 0x42 && d[11] === 0x50) return 'webp';
  if (d[0] === 0x42 && d[1] === 0x4d) return 'bmp';
  return null;
}

/**
 * Decodes an image file to straight RGBA. PNG goes through our own decoder
 * (bit-exact). Other formats use the browser's decoders with color
 * conversion and premultiplication disabled; for JPEG/WebP lossy data this is
 * the best available, and fully opaque pixels come out exact.
 */
export async function decodeImage(data: Uint8Array, maxPixels: number): Promise<PixelBuffer> {
  const type = sniffImageType(data);
  if (!type) throw new ImageDecodeError('Formato de imagem não reconhecido. Use PNG, JPEG, WebP, BMP ou GIF.');
  if (type === 'png') return decodePng(data, { maxPixels });
  if (type === 'gif') return decodeGif(data, { maxPixels, maxFrames: 1 })[0]!.image;
  if (type === 'bmp') {
    try {
      return decodeBmp(data, maxPixels);
    } catch (e) {
      if (e instanceof BmpError && /grandes demais|inválidas/.test(e.message)) throw new ImageDecodeError(e.message);
      // Other BMP variants (RLE, palettes) fall through to the browser decoder.
    }
  }
  // Check the declared size first so a tiny file can't make us decode a huge image.
  const declared = declaredSize(data, type);
  if (declared && declared.width * declared.height > maxPixels) throw new ImageDecodeError(`A imagem é grande demais (${declared.width}×${declared.height}).`);
  const mime = { jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }[type];
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(new Blob([data as BlobPart], { type: mime }), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
  } catch {
    throw new ImageDecodeError('Não foi possível decodificar a imagem (arquivo corrompido ou formato não suportado).');
  }
  if (bmp.width * bmp.height > maxPixels) {
    bmp.close();
    throw new ImageDecodeError(`A imagem é grande demais (${bmp.width}×${bmp.height}).`);
  }
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new ImageDecodeError('Canvas indisponível para decodificar a imagem.');
  ctx.drawImage(bmp, 0, 0);
  const id = ctx.getImageData(0, 0, bmp.width, bmp.height, { colorSpace: 'srgb' });
  bmp.close();
  return new PixelBuffer(id.width, id.height, new Uint8ClampedArray(id.data));
}

/** Dimensions from the JPEG/WebP/BMP header, without decoding pixels. */
export function declaredSize(d: Uint8Array, type: ReturnType<typeof sniffImageType>): { width: number; height: number } | null {
  const u16be = (i: number): number => ((d[i] ?? 0) << 8) | (d[i + 1] ?? 0);
  const u16le = (i: number): number => (d[i] ?? 0) | ((d[i + 1] ?? 0) << 8);
  const u24le = (i: number): number => u16le(i) | ((d[i + 2] ?? 0) << 16);
  if (type === 'jpeg') {
    let i = 2;
    while (i + 9 < d.length) {
      if (d[i] !== 0xff) {
        i++;
        continue;
      }
      const m = d[i + 1]!;
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) {
        i += m === 0xff ? 1 : 2;
        continue;
      }
      const len = u16be(i + 2);
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: u16be(i + 5), width: u16be(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (type === 'webp') {
    const chunk = String.fromCharCode(d[12] ?? 0, d[13] ?? 0, d[14] ?? 0, d[15] ?? 0);
    if (chunk === 'VP8X') return { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (chunk === 'VP8L') {
      const b = (d[21] ?? 0) | ((d[22] ?? 0) << 8) | ((d[23] ?? 0) << 16) | ((d[24] ?? 0) << 24);
      return { width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    return null;
  }
  if (type === 'bmp' && d.length >= 26) {
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    return { width: Math.abs(v.getInt32(18, true)), height: Math.abs(v.getInt32(22, true)) };
  }
  return null;
}
