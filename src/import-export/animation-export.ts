import { playbackOrder } from '../animation/playback';
import type { ImageLookup } from '../layers/compose';
import type { DocState, Frame } from '../project/model';
import type { RGBA } from '../raster/color';
import type { PixelBuffer } from '../raster/pixel-buffer';
import { encodeGif, type GifEncodeReport } from './gif';
import { renderFrameForExport } from './export-image';
import { encodePng } from './png';
import { buildSpritesheet, frameTags, spritesheetJson, type SheetOptions } from './spritesheet';

/** 'all' or the name of a frame tag (its range runs until the next tag). */
export type FrameRange = string;

export function framesInRange(state: DocState, range: FrameRange): Frame[] {
  if (range === 'all') return state.frames;
  const tag = frameTags(state.frames).find((t) => t.name === range);
  return tag ? state.frames.slice(tag.from, tag.to + 1) : state.frames;
}

export function rangeOptions(state: DocState): { value: string; label: string }[] {
  const tags = frameTags(state.frames);
  return [{ value: 'all', label: `Todos os quadros (${state.frames.length})` }, ...tags.map((t) => ({ value: t.name, label: `Marcador "${t.name}" (${t.to - t.from + 1})` }))];
}

function render(state: DocState, lookup: ImageLookup, frames: Frame[], scale: number, background: RGBA | null): PixelBuffer[] {
  return frames.map((f) => renderFrameForExport(state, lookup, { frameId: f.id, scale, background }));
}

export interface GifExportOptions {
  range: FrameRange;
  scale: number;
  background: RGBA | null;
  /** null = play once, 0 = forever, n = extra repeats. */
  loop: number | null;
  alphaThreshold: number;
}

/** Applies the document's ping-pong/reverse settings to the exported frame order. */
export function exportGif(state: DocState, lookup: ImageLookup, o: GifExportOptions): GifEncodeReport & { frameCount: number } {
  const frames = framesInRange(state, o.range);
  const images = render(state, lookup, frames, o.scale, o.background);
  const order = playbackOrder(frames.length, state.animation);
  const report = encodeGif(
    order.map((i) => ({ image: images[i]!, delayMs: frames[i]!.duration })),
    { loop: o.loop, alphaThreshold: o.alphaThreshold, matte: o.background },
  );
  return { ...report, frameCount: order.length };
}

export interface SequenceFile {
  name: string;
  data: Uint8Array;
}

export function exportSequence(state: DocState, lookup: ImageLookup, o: { range: FrameRange; scale: number; background: RGBA | null; baseName: string; generator: string }): SequenceFile[] {
  const frames = framesInRange(state, o.range);
  const pad = Math.max(3, String(frames.length).length);
  return frames.map((f, i) => ({
    name: `${o.baseName}_${String(i + 1).padStart(pad, '0')}.png`,
    data: encodePng(renderFrameForExport(state, lookup, { frameId: f.id, scale: o.scale, background: o.background }), { text: { Software: o.generator } }),
  }));
}

export function exportSpritesheet(
  state: DocState,
  lookup: ImageLookup,
  o: SheetOptions & { range: FrameRange; background: RGBA | null; imageName: string; generator: string; appVersion: string },
): { png: Uint8Array; json: string; width: number; height: number } {
  const frames = framesInRange(state, o.range);
  const images = render(state, lookup, frames, 1, o.background);
  const { image, geometry } = buildSpritesheet(images, o);
  const base = o.imageName.replace(/\.png$/i, '');
  const first = state.frames.indexOf(frames[0]!);
  const tags = frameTags(state.frames, state.animation.loop === 'pingpong' ? 'pingpong' : state.animation.direction)
    .map((t) => ({ ...t, from: t.from - first, to: t.to - first }))
    .filter((t) => t.to >= 0 && t.from < frames.length)
    .map((t) => ({ ...t, from: Math.max(0, t.from), to: Math.min(frames.length - 1, t.to) }));
  const json = spritesheetJson({ imageName: o.imageName, baseName: base, frames, geometry, scale: o.scale, tags, appVersion: o.appVersion });
  return { png: encodePng(image, { text: { Software: o.generator } }), json, width: image.width, height: image.height };
}
