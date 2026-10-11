import type { BlendMode } from '../raster/blend';
import type { RGBA } from '../raster/color';
import type { PixelBuffer } from '../raster/pixel-buffer';
import { newId } from './ids';

export type LayerId = string;
export type FrameId = string;
export type ImageId = string;

interface LayerBase {
  id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..100 */
  opacity: number;
  blendMode: BlendMode;
  /** Identification color shown in the layers panel, as #RRGGBB, or null. */
  colorTag: string | null;
  /** When false the layer is a guide/reference and is left out of exports. */
  exportable: boolean;
}

export interface PixelLayer extends LayerBase {
  type: 'pixel';
}

export interface GroupLayer extends LayerBase {
  type: 'group';
  expanded: boolean;
  /** Bottom-to-top. */
  children: LayerNode[];
}

export type LayerNode = PixelLayer | GroupLayer;

export interface Frame {
  id: FrameId;
  /** Display time in milliseconds. */
  duration: number;
}

export type TagDirection = 'forward' | 'reverse' | 'pingpong';

/**
 * A named range of frames (an animation such as "walk" or "jump"). The
 * endpoints are frame ids, so the tag follows its frames when they move and
 * frames inserted inside the range join it.
 */
export interface Tag {
  id: string;
  name: string;
  from: FrameId;
  to: FrameId;
  /** #RRGGBB shown on the timeline. */
  color: string;
  direction: TagDirection;
  /** Times the tag plays in a row when played or exported; 0 = forever. */
  repeat: number;
}

export type LoopMode = 'loop' | 'once' | 'pingpong';
export type PlayDirection = 'forward' | 'reverse';

export interface AnimationSettings {
  fps: number;
  loop: LoopMode;
  direction: PlayDirection;
}

export interface TileSettings {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export interface Palette {
  id: string;
  name: string;
  colors: RGBA[];
}

export interface Guide {
  axis: 'x' | 'y';
  position: number;
}

export interface SymmetrySettings {
  horizontal: boolean;
  vertical: boolean;
  /** Axis positions in pixel units; .5 values sit on a pixel centre. */
  axisX: number;
  axisY: number;
}

/**
 * Everything about a document except pixel data. Treated as an immutable
 * value: operations build a new state and keep unchanged branches shared, so
 * the history can keep old states by reference at almost no cost.
 */
export interface DocState {
  width: number;
  height: number;
  /** Bottom-to-top. */
  layers: LayerNode[];
  frames: Frame[];
  /** Animation tags, in the order they were created. */
  tags: Tag[];
  /** `${layerId}/${frameId}` → image. A missing entry is a transparent cel. */
  cels: Readonly<Record<string, ImageId>>;
  palette: Palette;
  animation: AnimationSettings;
  tiles: TileSettings;
  guides: Guide[];
  symmetry: SymmetrySettings;
  /**
   * 'indexed' keeps every pixel on a palette colour: painting snaps to the
   * palette and editing a palette entry recolours its pixels. Absent = 'rgb'.
   */
  colorMode?: ColorMode;
}

export type ColorMode = 'rgb' | 'indexed';

export interface ProjectDocument {
  id: string;
  name: string;
  state: DocState;
  images: Map<ImageId, PixelBuffer>;
}

export function celKey(layerId: LayerId, frameId: FrameId): string {
  return `${layerId}/${frameId}`;
}

export function parseCelKey(key: string): { layerId: LayerId; frameId: FrameId } {
  const i = key.indexOf('/');
  return { layerId: key.slice(0, i), frameId: key.slice(i + 1) };
}

export function makePixelLayer(name: string, partial: Partial<PixelLayer> = {}): PixelLayer {
  return {
    id: newId('L'),
    name,
    visible: true,
    locked: false,
    opacity: 100,
    blendMode: 'normal',
    colorTag: null,
    exportable: true,
    ...partial,
    type: 'pixel',
  };
}

export function makeGroupLayer(name: string, children: LayerNode[] = [], partial: Partial<GroupLayer> = {}): GroupLayer {
  return {
    id: newId('G'),
    name,
    visible: true,
    locked: false,
    opacity: 100,
    blendMode: 'normal',
    colorTag: null,
    exportable: true,
    expanded: true,
    ...partial,
    children,
    type: 'group',
  };
}

export function makeFrame(duration = 100): Frame {
  return { id: newId('F'), duration };
}

/* ---------- layer tree helpers ---------- */

export interface LayerLocation {
  layer: LayerNode;
  parent: GroupLayer | null;
  siblings: LayerNode[];
  index: number;
  depth: number;
}

export function walkLayers(
  layers: LayerNode[],
  visit: (loc: LayerLocation) => void,
  parent: GroupLayer | null = null,
  depth = 0,
): void {
  layers.forEach((layer, index) => {
    visit({ layer, parent, siblings: layers, index, depth });
    if (layer.type === 'group') walkLayers(layer.children, visit, layer, depth + 1);
  });
}

export function findLayer(layers: LayerNode[], id: LayerId): LayerLocation | null {
  let found: LayerLocation | null = null;
  walkLayers(layers, (loc) => {
    if (!found && loc.layer.id === id) found = loc;
  });
  return found;
}

export function allLayers(layers: LayerNode[]): LayerNode[] {
  const out: LayerNode[] = [];
  walkLayers(layers, (l) => out.push(l.layer));
  return out;
}

export function pixelLayers(layers: LayerNode[]): PixelLayer[] {
  return allLayers(layers).filter((l): l is PixelLayer => l.type === 'pixel');
}

/** Rebuilds the tree replacing the layer with `id` by the result of `fn` (null removes it). */
export function mapLayer(
  layers: LayerNode[],
  id: LayerId,
  fn: (layer: LayerNode) => LayerNode | null,
): LayerNode[] {
  const out: LayerNode[] = [];
  for (const layer of layers) {
    if (layer.id === id) {
      const next = fn(layer);
      if (next) out.push(next);
      continue;
    }
    if (layer.type === 'group') {
      const children = mapLayer(layer.children, id, fn);
      out.push(children === layer.children ? layer : { ...layer, children });
    } else out.push(layer);
  }
  return out;
}

/** True if the layer and all of its ancestors are visible. */
export function isEffectivelyVisible(layers: LayerNode[], id: LayerId): boolean {
  const path = layerPath(layers, id);
  return path !== null && path.every((l) => l.visible);
}

/** True if the layer or any ancestor is locked. */
export function isEffectivelyLocked(layers: LayerNode[], id: LayerId): boolean {
  const path = layerPath(layers, id);
  return path === null || path.some((l) => l.locked);
}

/** Ancestors from the root down to and including the layer. */
export function layerPath(layers: LayerNode[], id: LayerId): LayerNode[] | null {
  for (const layer of layers) {
    if (layer.id === id) return [layer];
    if (layer.type === 'group') {
      const sub = layerPath(layer.children, id);
      if (sub) return [layer, ...sub];
    }
  }
  return null;
}

export const DEFAULT_ANIMATION: AnimationSettings = { fps: 10, loop: 'loop', direction: 'forward' };
export const DEFAULT_TILES: TileSettings = { width: 16, height: 16, offsetX: 0, offsetY: 0 };
