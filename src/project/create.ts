import { defaultPalette } from '../palette/defaults';
import type { RGBA } from '../raster/color';
import { PixelBuffer } from '../raster/pixel-buffer';
import { newId } from './ids';
import { checkDimensions, LIMITS } from './limits';
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

/**
 * Builds a one-layer document whose frames are the given images (all the
 * same size), e.g. from an animated GIF or a sliced spritesheet.
 */
export function documentFromFrames(name: string, frames: { image: PixelBuffer; duration?: number }[]): ProjectDocument {
  const first = frames[0];
  if (!first) throw new RangeError('Nenhum quadro para importar.');
  if (frames.length > LIMITS.maxFrames) throw new RangeError(`Mais de ${LIMITS.maxFrames} quadros.`);
  const { width, height } = first.image;
  const doc = createDocument({ name, width, height });
  const layer = doc.state.layers[0]!;
  const cels: Record<string, string> = {};
  const list = frames.map((f) => {
    if (f.image.width !== width || f.image.height !== height) throw new RangeError('Todos os quadros precisam ter o mesmo tamanho.');
    const frame = makeFrame(Math.max(LIMITS.minFrameDuration, Math.min(LIMITS.maxFrameDuration, Math.round(f.duration ?? 100))));
    if (!f.image.isEmpty()) {
      const id = newId('I');
      doc.images.set(id, f.image);
      cels[celKey(layer.id, frame.id)] = id;
    }
    return frame;
  });
  doc.state = { ...doc.state, frames: list, cels };
  return doc;
}
