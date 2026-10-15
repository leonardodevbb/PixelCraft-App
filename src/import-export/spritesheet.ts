import { PixelBuffer } from '../raster/pixel-buffer';
import { scaleInteger } from '../raster/scale';
import { drawOver } from '../editor/raster-ops';
import type { DocState, Frame } from '../project/model';
import { tagRange } from '../animation/tags';
import { MAX_EXPORT_DIMENSION } from './export-image';

export type SheetLayout = 'horizontal' | 'vertical' | 'grid';

export interface SheetOptions {
  layout: SheetLayout;
  /** Columns for the grid layout. */
  columns: number;
  /** Space between frames, in output pixels. */
  padding: number;
  /** Space around the sheet, in output pixels. */
  margin: number;
  scale: number;
}

export interface SheetGeometry {
  width: number;
  height: number;
  columns: number;
  rows: number;
  cellW: number;
  cellH: number;
  positions: { x: number; y: number }[];
}

export function sheetGeometry(count: number, frameW: number, frameH: number, o: SheetOptions): SheetGeometry {
  const cellW = frameW * o.scale;
  const cellH = frameH * o.scale;
  const columns = o.layout === 'horizontal' ? count : o.layout === 'vertical' ? 1 : Math.max(1, Math.min(count, o.columns));
  const rows = Math.max(1, Math.ceil(count / columns));
  const width = o.margin * 2 + columns * cellW + (columns - 1) * o.padding;
  const height = o.margin * 2 + rows * cellH + (rows - 1) * o.padding;
  const positions = Array.from({ length: count }, (_, i) => ({
    x: o.margin + (i % columns) * (cellW + o.padding),
    y: o.margin + Math.floor(i / columns) * (cellH + o.padding),
  }));
  return { width, height, columns, rows, cellW, cellH, positions };
}

export function sheetFits(g: SheetGeometry): boolean {
  return g.width <= MAX_EXPORT_DIMENSION && g.height <= MAX_EXPORT_DIMENSION && g.width * g.height <= MAX_EXPORT_DIMENSION * 8192;
}

/** Packs already-rendered frames (at 1×) into one sheet. */
export function buildSpritesheet(images: PixelBuffer[], o: SheetOptions): { image: PixelBuffer; geometry: SheetGeometry } {
  if (images.length === 0) throw new RangeError('Nenhum quadro para a spritesheet.');
  const { width: fw, height: fh } = images[0]!;
  const g = sheetGeometry(images.length, fw, fh, o);
  if (!sheetFits(g)) throw new RangeError(`A spritesheet ficaria com ${g.width}×${g.height} px, acima do limite. Use grade, menos escala ou menos espaçamento.`);
  const out = new PixelBuffer(g.width, g.height);
  images.forEach((img, i) => {
    const p = g.positions[i]!;
    drawOver(out, o.scale > 1 ? scaleInteger(img, o.scale) : img, p.x, p.y);
  });
  return { image: out, geometry: g };
}

export interface SheetTag {
  name: string;
  from: number;
  to: number;
  direction: 'forward' | 'reverse' | 'pingpong';
  /** #RRGGBBAA, as Aseprite writes it. */
  color?: string;
  repeat?: string;
}

/** The document's tags as frame index ranges, in the layout spritesheet JSON uses. */
export interface TagSpan {
  id: string;
  name: string;
  from: number;
  to: number;
  direction: SheetTag['direction'];
  color: string;
  repeat: number;
}

export function frameTags(state: Pick<DocState, 'frames' | 'tags'>): TagSpan[] {
  return state.tags.flatMap((t) => {
    const r = tagRange(state, t);
    return r ? [{ id: t.id, name: t.name, from: r.from, to: r.to, direction: t.direction, color: t.color, repeat: t.repeat }] : [];
  });
}

/**
 * JSON metadata in the widely used "array" layout (frames with x/y/w/h and
 * duration, plus meta.frameTags), which game engines such as Phaser and
 * many importers understand.
 */
export function spritesheetJson(opts: {
  imageName: string;
  baseName: string;
  frames: Frame[];
  geometry: SheetGeometry;
  scale: number;
  tags: SheetTag[];
  appVersion: string;
}): string {
  const { geometry: g } = opts;
  const pad = String(opts.frames.length - 1).length;
  return (
    JSON.stringify(
      {
        frames: opts.frames.map((f, i) => ({
          filename: `${opts.baseName} ${String(i).padStart(pad, '0')}`,
          frame: { x: g.positions[i]!.x, y: g.positions[i]!.y, w: g.cellW, h: g.cellH },
          rotated: false,
          trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: g.cellW, h: g.cellH },
          sourceSize: { w: g.cellW, h: g.cellH },
          duration: f.duration,
        })),
        meta: {
          app: 'PixelCraft',
          version: opts.appVersion,
          image: opts.imageName,
          format: 'RGBA8888',
          size: { w: g.width, h: g.height },
          scale: String(opts.scale),
          frameTags: opts.tags,
        },
      },
      null,
      2,
    ) + '\n'
  );
}
