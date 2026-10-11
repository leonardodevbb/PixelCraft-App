import { composeFrame, type ImageLookup } from '../layers/compose';
import type { DocState, FrameId } from '../project/model';
import { blendPixel } from '../raster/blend';
import type { RGBA } from '../raster/color';
import { PixelBuffer } from '../raster/pixel-buffer';
import { scaleInteger } from '../raster/scale';

export interface ImageExportOptions {
  frameId: FrameId;
  /** Integer scale factor ≥ 1 (nearest neighbour). */
  scale: number;
  /** Solid background composited under the image, or null to keep transparency. */
  background: RGBA | null;
}

export const MAX_EXPORT_DIMENSION = 16384;

export function exportDimensions(state: DocState, scale: number): { width: number; height: number } {
  return { width: state.width * scale, height: state.height * scale };
}

/** Renders one frame of exportable layers at the requested scale. */
export function renderFrameForExport(state: DocState, images: ImageLookup, opts: ImageExportOptions): PixelBuffer {
  const scale = Math.floor(opts.scale);
  const { width, height } = exportDimensions(state, scale);
  if (scale < 1 || width > MAX_EXPORT_DIMENSION || height > MAX_EXPORT_DIMENSION) {
    throw new RangeError(`A escala escolhida gera uma imagem maior que ${MAX_EXPORT_DIMENSION} pixels.`);
  }
  let img = composeFrame(state, images, opts.frameId, { exportOnly: true });
  if (opts.background !== null) img = flattenOnto(img, opts.background);
  return scaleInteger(img, scale);
}

/** Composites the image over an opaque (or translucent) background color. */
export function flattenOnto(img: PixelBuffer, bg: RGBA): PixelBuffer {
  const out = new PixelBuffer(img.width, img.height);
  out.fill(bg);
  const d = out.data;
  const s = img.data;
  for (let i = 0; i < s.length; i += 4) {
    if (s[i + 3] === 0) continue;
    blendPixel(d, i, s[i]!, s[i + 1]!, s[i + 2]!, s[i + 3]!, 1, 'normal');
  }
  return out;
}
