import { playbackOrder } from '../animation/playback';
import type { ImageLookup } from '../layers/compose';
import type { AnimationSettings, DocState, Frame } from '../project/model';
import type { RGBA } from '../raster/color';
import type { PixelBuffer } from '../raster/pixel-buffer';
import { encodeGif, type GifEncodeOptions, type GifEncodeReport, type GifFrameIn } from './gif';
import { renderFrameForExport } from './export-image';
import { encodeApng, encodePng, type ApngFrame } from './png';
import { buildSpritesheet, frameTags, spritesheetJson, type SheetOptions } from './spritesheet';

/** 'all' or the id of an animation tag. */
export type FrameRange = string;

export function framesInRange(state: DocState, range: FrameRange): Frame[] {
  if (range === 'all') return state.frames;
  const tag = frameTags(state).find((t) => t.id === range);
  return tag ? state.frames.slice(tag.from, tag.to + 1) : state.frames;
}

/** Playback settings for a range: a tag plays with its own direction. */
export function rangeAnimation(state: DocState, range: FrameRange): Pick<AnimationSettings, 'loop' | 'direction'> {
  const tag = range === 'all' ? undefined : state.tags.find((t) => t.id === range);
  if (!tag) return state.animation;
  return { loop: tag.direction === 'pingpong' ? 'pingpong' : 'loop', direction: tag.direction === 'reverse' ? 'reverse' : 'forward' };
}

export function rangeOptions(state: DocState): { value: string; label: string }[] {
  const tags = frameTags(state);
  return [{ value: 'all', label: `Todos os quadros (${state.frames.length})` }, ...tags.map((t) => ({ value: t.id, label: `Tag "${t.name}" (${t.to - t.from + 1})` }))];
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

/** Frames (in playback order, honouring ping-pong/reverse) and encoder options for a GIF export. */
export function prepareGif(state: DocState, lookup: ImageLookup, o: GifExportOptions): { frames: GifFrameIn[]; options: GifEncodeOptions } {
  const frames = framesInRange(state, o.range);
  const images = render(state, lookup, frames, o.scale, o.background);
  const order = playbackOrder(frames.length, rangeAnimation(state, o.range));
  return {
    frames: order.map((i) => ({ image: images[i]!, delayMs: frames[i]!.duration })),
    options: { loop: o.loop, alphaThreshold: o.alphaThreshold, matte: o.background },
  };
}

export function exportGif(state: DocState, lookup: ImageLookup, o: GifExportOptions): GifEncodeReport & { frameCount: number } {
  const { frames, options } = prepareGif(state, lookup, o);
  return { ...encodeGif(frames, options), frameCount: frames.length };
}

export interface ApngExportOptions {
  range: FrameRange;
  scale: number;
  background: RGBA | null;
  /** null = play once, 0 = forever, n = total plays. */
  loop: number | null;
  generator: string;
}

/** Frames in playback order for an APNG, which keeps full alpha and exact durations. */
export function prepareApng(state: DocState, lookup: ImageLookup, o: Omit<ApngExportOptions, 'loop' | 'generator'>): ApngFrame[] {
  const frames = framesInRange(state, o.range);
  const images = render(state, lookup, frames, o.scale, o.background);
  return playbackOrder(frames.length, rangeAnimation(state, o.range)).map((i) => ({ image: images[i]!, delayMs: frames[i]!.duration }));
}

export function exportApng(state: DocState, lookup: ImageLookup, o: ApngExportOptions): { bytes: Uint8Array; frameCount: number } {
  const frames = prepareApng(state, lookup, o);
  return { bytes: encodeApng(frames, { plays: o.loop ?? 1, text: { Software: o.generator } }), frameCount: frames.length };
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
  const tags = frameTags(state)
    .map((t) => ({ ...t, from: t.from - first, to: t.to - first }))
    .filter((t) => t.to >= 0 && t.from < frames.length)
    .map((t) => ({
      name: t.name,
      from: Math.max(0, t.from),
      to: Math.min(frames.length - 1, t.to),
      direction: t.direction,
      color: `${t.color}ff`,
      ...(t.repeat ? { repeat: String(t.repeat) } : {}),
    }));
  const json = spritesheetJson({ imageName: o.imageName, baseName: base, frames, geometry, scale: o.scale, tags, appVersion: o.appVersion });
  return { png: encodePng(image, { text: { Software: o.generator } }), json, width: image.width, height: image.height };
}
