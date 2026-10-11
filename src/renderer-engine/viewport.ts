/**
 * Maps between screen (CSS pixel) coordinates and document pixels. Zoom is
 * the size of one document pixel on screen; it never touches document data.
 */
export const ZOOM_LEVELS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];
export const MIN_ZOOM = ZOOM_LEVELS[0]!;
export const MAX_ZOOM = ZOOM_LEVELS.at(-1)!;

export interface ViewTransform {
  zoom: number;
  /** Screen position of the document's top-left corner. */
  offsetX: number;
  offsetY: number;
}

export function screenToDoc(t: ViewTransform, sx: number, sy: number): { x: number; y: number; fx: number; fy: number } {
  const fx = (sx - t.offsetX) / t.zoom;
  const fy = (sy - t.offsetY) / t.zoom;
  return { x: Math.floor(fx), y: Math.floor(fy), fx, fy };
}

export function docToScreen(t: ViewTransform, x: number, y: number): { sx: number; sy: number } {
  return { sx: t.offsetX + x * t.zoom, sy: t.offsetY + y * t.zoom };
}

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function nextZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_LEVELS.find((l) => l > z + 1e-9) ?? MAX_ZOOM;
  return [...ZOOM_LEVELS].reverse().find((l) => l < z - 1e-9) ?? MIN_ZOOM;
}

/** Zooms keeping the document point under (sx, sy) fixed on screen. */
export function zoomAround(t: ViewTransform, zoom: number, sx: number, sy: number): ViewTransform {
  const z = clampZoom(zoom);
  const fx = (sx - t.offsetX) / t.zoom;
  const fy = (sy - t.offsetY) / t.zoom;
  return { zoom: z, offsetX: Math.round(sx - fx * z), offsetY: Math.round(sy - fy * z) };
}

export type FitMode = 'fit' | 'width' | 'height';

/** Largest zoom (integer when ≥ 1, for crisp pixels) that fits the document, centred. */
export function fitTransform(
  docW: number,
  docH: number,
  viewW: number,
  viewH: number,
  mode: FitMode = 'fit',
  margin = 32,
): ViewTransform {
  const aw = Math.max(1, viewW - margin * 2);
  const ah = Math.max(1, viewH - margin * 2);
  let z = mode === 'width' ? aw / docW : mode === 'height' ? ah / docH : Math.min(aw / docW, ah / docH);
  if (z >= 1) z = Math.floor(z);
  else z = [...ZOOM_LEVELS].reverse().find((l) => l <= z) ?? MIN_ZOOM;
  z = clampZoom(z);
  return centerTransform(docW, docH, viewW, viewH, z);
}

export function centerTransform(docW: number, docH: number, viewW: number, viewH: number, zoom: number): ViewTransform {
  return {
    zoom,
    offsetX: Math.round((viewW - docW * zoom) / 2),
    offsetY: Math.round((viewH - docH * zoom) / 2),
  };
}
