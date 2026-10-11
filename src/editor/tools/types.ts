import type { RGBA } from '../../raster/color';
import type { BrushShape } from '../../raster/shapes';
import type { DitherMode, GradientShape } from '../../raster/gradient';
import type { EditorSession } from '../session';
import type { Point, Rect } from '../../raster/rect';

export type ToolId =
  | 'pencil'
  | 'brush'
  | 'eraser'
  | 'line'
  | 'rect'
  | 'rect-filled'
  | 'ellipse'
  | 'ellipse-filled'
  | 'bucket'
  | 'eyedropper'
  | 'select-rect'
  | 'select-lasso'
  | 'magic-wand'
  | 'move'
  | 'text'
  | 'gradient'
  | 'pan';

export type ColorSlot = 'primary' | 'secondary';

export interface ToolPointer {
  /** Logical pixel coordinates (may be outside the document). */
  x: number;
  y: number;
  /** Sub-pixel coordinates, for tools that care. */
  fx: number;
  fy: number;
  slot: ColorSlot;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface ToolOptions {
  size: number;
  shape: BrushShape;
  /** 0..100 */
  opacity: number;
  /** 0..100 */
  tolerance: number;
  contiguous: boolean;
  sampleMerged: boolean;
  gradientShape: GradientShape;
  dither: DitherMode;
  /** Text tool: integer pixel scale, letter and line spacing, alignment. */
  textScale: number;
  letterSpacing: number;
  lineSpacing: number;
  textAlign: 'left' | 'center' | 'right';
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  size: 1,
  shape: 'square',
  opacity: 100,
  tolerance: 0,
  contiguous: true,
  sampleMerged: false,
  gradientShape: 'linear',
  dither: 'bayer4',
  textScale: 1,
  letterSpacing: 1,
  lineSpacing: 1,
  textAlign: 'left',
};

/** Transient visuals a tool can ask the canvas to draw. */
export interface ToolPreview {
  marquee?: Rect | null;
  lasso?: Point[] | null;
  /** Shift the selection outline while dragging. */
  selectionOffset?: Point | null;
}

export interface ToolHost {
  session: EditorSession;
  options: ToolOptions;
  color(slot: ColorSlot): RGBA;
  setColor(slot: ColorSlot, c: RGBA): void;
  /** Report a recoverable problem (locked layer, …) to the user. */
  notify(message: string): void;
  /** Symmetry enabled for this stroke (from document settings + UI toggle). */
  symmetryActive: boolean;
  preview(p: ToolPreview): void;
  /** Text tool: asks the UI to open the text editor at a pixel. */
  requestText?(at: Point): void;
}

export interface Tool {
  id: ToolId;
  label: string;
  onDown(p: ToolPointer, host: ToolHost): void;
  onMove(p: ToolPointer, host: ToolHost): void;
  onUp(p: ToolPointer, host: ToolHost): void;
  /** Escape or focus loss in the middle of an interaction. */
  cancel(host: ToolHost): void;
  /** CSS cursor for the canvas. */
  cursor: string;
}
