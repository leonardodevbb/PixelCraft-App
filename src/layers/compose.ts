import { blendPixel } from '../raster/blend';
import { PixelBuffer } from '../raster/pixel-buffer';
import { type Rect, intersectRect, rectIsEmpty } from '../raster/rect';
import { celKey, type DocState, type FrameId, type LayerNode } from '../project/model';

export interface ComposeOptions {
  /** Restrict work to this region (in document pixels). Defaults to the whole document. */
  region?: Rect;
  /** Leave out layers flagged as non-exportable (guides/references). */
  exportOnly?: boolean;
  /** Replace cel images, keyed by celKey (used for live tool drafts). */
  overrides?: ReadonlyMap<string, PixelBuffer>;
  /** Only include these layers (and their ancestors' effects). */
  onlyLayers?: ReadonlySet<string>;
  /** Override the visibility rule: include hidden layers too. */
  includeHidden?: boolean;
}

export type ImageLookup = (id: string) => PixelBuffer | undefined;

/**
 * Composites the visible layers of one frame. Groups are composited in
 * isolation (children into a temporary buffer) and then blended with the
 * group's own opacity and mode.
 */
export function composeFrame(
  state: DocState,
  images: ImageLookup,
  frameId: FrameId,
  opts: ComposeOptions = {},
  target?: PixelBuffer,
): PixelBuffer {
  const out = target ?? new PixelBuffer(state.width, state.height);
  const region = intersectRect(opts.region ?? out.bounds, out.bounds);
  if (rectIsEmpty(region)) return out;
  clearRegion(out, region);
  composeInto(out, state.layers, state, images, frameId, opts, region);
  return out;
}

function clearRegion(buf: PixelBuffer, r: Rect): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    const i = (y * buf.width + r.x) * 4;
    buf.data.fill(0, i, i + r.w * 4);
  }
}

function included(layer: LayerNode, opts: ComposeOptions): boolean {
  if (!opts.includeHidden && !layer.visible) return false;
  if (opts.exportOnly && !layer.exportable) return false;
  return true;
}

function containsSelected(layer: LayerNode, only: ReadonlySet<string>): boolean {
  if (only.has(layer.id)) return true;
  return layer.type === 'group' && layer.children.some((c) => containsSelected(c, only));
}

function composeInto(
  out: PixelBuffer,
  layers: LayerNode[],
  state: DocState,
  images: ImageLookup,
  frameId: FrameId,
  opts: ComposeOptions,
  region: Rect,
): void {
  for (const layer of layers) {
    if (!included(layer, opts)) continue;
    if (opts.onlyLayers && !containsSelected(layer, opts.onlyLayers)) continue;
    const opacity = layer.opacity / 100;
    if (opacity <= 0) continue;
    let src: PixelBuffer | undefined;
    if (layer.type === 'group') {
      src = new PixelBuffer(out.width, out.height);
      composeInto(src, layer.children, state, images, frameId, opts, region);
    } else {
      const key = celKey(layer.id, frameId);
      src = opts.overrides?.get(key);
      if (!src) {
        const id = state.cels[key];
        src = id ? images(id) : undefined;
      }
    }
    if (!src) continue;
    blendRegion(out, src, region, opacity, layer.blendMode);
  }
}

export function blendRegion(
  out: PixelBuffer,
  src: PixelBuffer,
  region: Rect,
  opacity: number,
  mode: LayerNode['blendMode'],
): void {
  const d = out.data;
  const s = src.data;
  const r = intersectRect(region, src.bounds);
  for (let y = r.y; y < r.y + r.h; y++) {
    let si = (y * src.width + r.x) * 4;
    let di = (y * out.width + r.x) * 4;
    for (let x = 0; x < r.w; x++, si += 4, di += 4) {
      const a = s[si + 3]!;
      if (a === 0) continue;
      blendPixel(d, di, s[si]!, s[si + 1]!, s[si + 2]!, a, opacity, mode);
    }
  }
}
