import type { PixelBuffer } from '../raster/pixel-buffer';
import { encodeBmp } from './bmp';
import { encodePng } from './png';

export type ImageFormat = 'png' | 'bmp' | 'jpeg' | 'webp';

export const IMAGE_FORMATS: { id: ImageFormat; label: string; ext: string; alpha: boolean; lossy: boolean }[] = [
  { id: 'png', label: 'PNG', ext: 'png', alpha: true, lossy: false },
  { id: 'bmp', label: 'BMP (32 bits)', ext: 'bmp', alpha: true, lossy: false },
  { id: 'jpeg', label: 'JPEG', ext: 'jpg', alpha: false, lossy: true },
  { id: 'webp', label: 'WebP', ext: 'webp', alpha: true, lossy: true },
];

/**
 * Encodes an image. PNG and BMP use PixelCraft's own encoders (exact);
 * JPEG and WebP use the browser engine's encoders (lossy, `quality` 0..1).
 */
export async function encodeImage(img: PixelBuffer, format: ImageFormat, opts: { quality?: number; software?: string } = {}): Promise<Uint8Array> {
  if (format === 'png') return encodePng(img, opts.software ? { text: { Software: opts.software } } : {});
  if (format === 'bmp') return encodeBmp(img);
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível para codificar a imagem.');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: format === 'jpeg' ? 'image/jpeg' : 'image/webp', quality: opts.quality ?? 0.92 });
  if (blob.type !== (format === 'jpeg' ? 'image/jpeg' : 'image/webp')) throw new Error(`Este sistema não consegue gerar ${format.toUpperCase()}.`);
  return new Uint8Array(await blob.arrayBuffer());
}
