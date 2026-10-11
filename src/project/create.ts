import { defaultPalette } from '../palette/defaults';
import type { RGBA } from '../raster/color';
import { PixelBuffer } from '../raster/pixel-buffer';
import { newId } from './ids';
import { checkDimensions } from './limits';
import {
  DEFAULT_ANIMATION,
  DEFAULT_TILES,
  celKey,
  makeFrame,
  makePixelLayer,
  type DocState,
  type ProjectDocument,
} from './model';

export interface NewDocumentOptions {
  name?: string;
  width: number;
  height: number;
  /** Optional opaque background color for the first layer. */
  background?: RGBA | null;
  frameDuration?: number;
}

export function createDocument(opts: NewDocumentOptions): ProjectDocument {
  const err = checkDimensions(opts.width, opts.height);
  if (err) throw new RangeError(err);
  const layer = makePixelLayer('Camada 1');
  const frame = makeFrame(opts.frameDuration ?? 100);
  const images = new Map<string, PixelBuffer>();
  const cels: Record<string, string> = {};
  if (opts.background != null) {
    const img = new PixelBuffer(opts.width, opts.height);
    img.fill(opts.background);
    const id = newId('I');
    images.set(id, img);
    cels[celKey(layer.id, frame.id)] = id;
  }
  const state: DocState = {
    width: opts.width,
    height: opts.height,
    layers: [layer],
    frames: [frame],
    cels,
    palette: defaultPalette(),
    animation: { ...DEFAULT_ANIMATION },
    tiles: { ...DEFAULT_TILES },
    guides: [],
    symmetry: { horizontal: false, vertical: false, axisX: opts.width / 2, axisY: opts.height / 2 },
  };
  return { id: newId('D'), name: opts.name?.trim() || 'Sem título', state, images };
}
