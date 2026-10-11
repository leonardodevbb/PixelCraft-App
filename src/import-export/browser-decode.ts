import { PixelBuffer } from '../raster/pixel-buffer';
import { decodePng, isPng } from './png';

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
