import { blendRegion } from '../layers/compose';
import { composeFrame } from '../layers/compose';
import {
  cloneLayer,
  depthOf,
  insertLayer,
  moveLayer,
  nestingDepth,
  nextLayerName,
  removeLayer,
  slotOf,
  subtreeIds,
  type LayerSlot,
} from '../layers/tree';
import { LIMITS } from '../project/limits';
import {
  allLayers,
  celKey,
  findLayer,
  isEffectivelyVisible,
  makeGroupLayer,
  makePixelLayer,
  mapLayer,
  parseCelKey,
  pixelLayers,
  type DocState,
  type GroupLayer,
  type ImageId,
  type LayerId,
  type LayerNode,
  type PixelLayer,
} from '../project/model';
import { PixelBuffer } from '../raster/pixel-buffer';
import { extractPiece } from './selection-ops';
import { EditorError, type EditorSession } from './session';

export type LayerProps = Partial<Pick<LayerNode, 'name' | 'visible' | 'locked' | 'opacity' | 'blendMode' | 'colorTag' | 'exportable'>>;

function layerCount(st: DocState): number {
  return allLayers(st.layers).length;
}

function assertRoom(st: DocState, extra = 1): void {
  if (layerCount(st) + extra > LIMITS.maxLayers) throw new EditorError(`Limite de ${LIMITS.maxLayers} camadas atingido.`);
}

/** Slot just above the active layer (inside it when it is an expanded group). */
function slotAboveActive(s: EditorSession): LayerSlot {
  const loc = findLayer(s.state.layers, s.activeLayerId);
  if (!loc) return { parentId: null, index: s.state.layers.length };
  if (loc.layer.type === 'group' && loc.layer.expanded) return { parentId: loc.layer.id, index: loc.layer.children.length };
  return { parentId: loc.parent?.id ?? null, index: loc.index + 1 };
}

export function addLayer(s: EditorSession, name?: string): LayerId {
  s.cancelDraft();
  assertRoom(s.state);
  const layer = makePixelLayer(name ?? nextLayerName(s.state.layers, 'Camada'));
  const slot = slotAboveActive(s);
  s.apply('Nova camada', (st) => ({ ...st, layers: insertLayer(st.layers, layer, slot) }), { layerId: layer.id });
  return layer.id;
}

export function addGroup(s: EditorSession, name?: string): LayerId {
  s.cancelDraft();
  assertRoom(s.state);
  const slot = slotAboveActive(s);
  if (depthOf(s.state.layers, slot.parentId) + 1 > LIMITS.maxGroupDepth) throw new EditorError(`Limite de ${LIMITS.maxGroupDepth} níveis de grupos atingido.`);
  const g = makeGroupLayer(name ?? nextLayerName(s.state.layers, 'Grupo'));
  s.apply('Novo grupo', (st) => ({ ...st, layers: insertLayer(st.layers, g, slot) }), { layerId: g.id });
  return g.id;
}

/** Wraps a layer in a new group at the same position. */
export function groupLayer(s: EditorSession, id: LayerId = s.activeLayerId): LayerId {
  s.cancelDraft();
  const st = s.state;
  assertRoom(st);
  const loc = findLayer(st.layers, id);
  if (!loc) throw new EditorError('Camada inexistente.');
  if (loc.depth + 1 + nestingDepth(loc.layer) > LIMITS.maxGroupDepth) throw new EditorError(`Limite de ${LIMITS.maxGroupDepth} níveis de grupos atingido.`);
  const g = makeGroupLayer(nextLayerName(st.layers, 'Grupo'), [loc.layer]);
  const slot = slotOf(st.layers, id)!;
  s.apply('Agrupar camada', (cur) => ({ ...cur, layers: insertLayer(removeLayer(cur.layers, id), g, slot) }), { layerId: g.id });
  return g.id;
}

/** Moves a group's children to its parent, replacing the group. */
export function ungroup(s: EditorSession, id: LayerId = s.activeLayerId): void {
  s.cancelDraft();
  const loc = findLayer(s.state.layers, id);
  if (!loc || loc.layer.type !== 'group') throw new EditorError('Selecione um grupo para desagrupar.');
  const g = loc.layer;
  const slot = slotOf(s.state.layers, id)!;
  const first = g.children.at(-1)?.id;
  s.apply(
    'Desagrupar',
    (st) => {
      let layers = removeLayer(st.layers, id);
      g.children.forEach((c, i) => {
        layers = insertLayer(layers, c, { parentId: slot.parentId, index: slot.index + i });
      });
      return { ...st, layers };
    },
    first ? { layerId: first } : undefined,
  );
}

export function deleteLayer(s: EditorSession, id: LayerId = s.activeLayerId): void {
  s.cancelDraft();
  const st = s.state;
  const loc = findLayer(st.layers, id);
  if (!loc) return;
  const ids = new Set(subtreeIds(loc.layer));
  const remainingPixel = pixelLayers(st.layers).filter((l) => !ids.has(l.id));
  if (remainingPixel.length === 0) throw new EditorError('O documento precisa de pelo menos uma camada de pixels.');
  // Next active: the sibling below, else above, else the parent.
  const sib = loc.siblings;
  const nextActive = sib[loc.index - 1]?.id ?? sib[loc.index + 1]?.id ?? loc.parent?.id ?? remainingPixel[0]!.id;
  s.apply(
    loc.layer.type === 'group' ? 'Excluir grupo' : 'Excluir camada',
    (cur) => {
      const cels: Record<string, ImageId> = {};
      for (const [k, v] of Object.entries(cur.cels)) if (!ids.has(parseCelKey(k).layerId)) cels[k] = v;
      return { ...cur, layers: removeLayer(cur.layers, id), cels };
    },
    { layerId: nextActive },
  );
}

/** Copies a layer (or group with its contents) right above it. Images are copied, links inside it kept. */
export function duplicateLayer(s: EditorSession, id: LayerId = s.activeLayerId): LayerId {
  s.cancelDraft();
  const st = s.state;
  const loc = findLayer(st.layers, id);
  if (!loc) throw new EditorError('Camada inexistente.');
  const count = subtreeIds(loc.layer).length;
  assertRoom(st, count);
  const map = new Map<LayerId, LayerId>();
  const copy = cloneLayer(loc.layer, map, ' (cópia)');
  const cels: Record<string, ImageId> = { ...st.cels };
  const imgMap = new Map<ImageId, ImageId>();
  const newImages: ImageId[] = [];
  for (const [k, v] of Object.entries(st.cels)) {
    const { layerId, frameId } = parseCelKey(k);
    const nl = map.get(layerId);
    if (!nl) continue;
    let ni = imgMap.get(v);
    if (!ni) {
      const src = s.image(v);
      if (!src) continue;
      ni = s.addImage(src.clone());
      imgMap.set(v, ni);
      newImages.push(ni);
    }
    cels[celKey(nl, frameId)] = ni;
  }
  const slot = { parentId: loc.parent?.id ?? null, index: loc.index + 1 };
  const next = { ...st, layers: insertLayer(st.layers, copy, slot), cels };
  s.commit(loc.layer.type === 'group' ? 'Duplicar grupo' : 'Duplicar camada', next, [], newImages, { ...s.context, layerId: copy.id });
  return copy.id;
}

export function setLayerProps(s: EditorSession, id: LayerId, props: LayerProps, label = 'Propriedades da camada'): void {
  const loc = findLayer(s.state.layers, id);
  if (!loc) return;
  const changed = (Object.keys(props) as (keyof LayerProps)[]).some((k) => loc.layer[k] !== props[k]);
  if (!changed) return;
  if (props.name !== undefined) {
    const name = props.name.trim().slice(0, LIMITS.maxNameLength);
    if (!name) throw new EditorError('O nome da camada não pode ficar vazio.');
    props = { ...props, name };
  }
  if (props.opacity !== undefined) props = { ...props, opacity: Math.max(0, Math.min(100, Math.round(props.opacity))) };
  s.cancelDraft();
  s.apply(label, (st) => ({ ...st, layers: mapLayer(st.layers, id, (l) => ({ ...l, ...props }) as LayerNode) }));
}

/** Expanding/collapsing a group is view state: it does not create an undo step. */
export function setGroupExpanded(s: EditorSession, id: LayerId, expanded: boolean): void {
  const loc = findLayer(s.state.layers, id);
  if (!loc || loc.layer.type !== 'group' || loc.layer.expanded === expanded) return;
  s.replaceStateSilently({ ...s.state, layers: mapLayer(s.state.layers, id, (l) => ({ ...(l as GroupLayer), expanded })) });
}

/** Moves a layer to a slot (drag and drop in the panel). */
export function moveLayerTo(s: EditorSession, id: LayerId, to: LayerSlot): void {
  s.cancelDraft();
  const st = s.state;
  const loc = findLayer(st.layers, id);
  if (!loc) return;
  if (depthOf(st.layers, to.parentId) + nestingDepth(loc.layer) > LIMITS.maxGroupDepth)
    throw new EditorError(`Limite de ${LIMITS.maxGroupDepth} níveis de grupos atingido.`);
  let layers: LayerNode[];
  try {
    layers = moveLayer(st.layers, id, to);
  } catch (e) {
    throw new EditorError((e as Error).message);
  }
  if (layers === st.layers) return;
  s.apply('Reordenar camadas', (cur) => ({ ...cur, layers }));
}

/** Moves a layer one step up/down among its siblings, entering/leaving groups at the edges. */
export function stepLayer(s: EditorSession, id: LayerId, dir: 1 | -1): void {
  const st = s.state;
  const loc = findLayer(st.layers, id);
  if (!loc) return;
  const target = loc.index + dir;
  const parentId = loc.parent?.id ?? null;
  if (target < 0 || target >= loc.siblings.length) {
    // Leave the group, placing the layer just above/below it.
    if (!loc.parent) return;
    const ps = slotOf(st.layers, loc.parent.id)!;
    moveLayerTo(s, id, { parentId: ps.parentId, index: dir > 0 ? ps.index + 1 : ps.index });
    return;
  }
  const neighbour = loc.siblings[target]!;
  if (neighbour.type === 'group' && neighbour.expanded) {
    // Enter the group from the edge we're crossing.
    moveLayerTo(s, id, { parentId: neighbour.id, index: dir > 0 ? 0 : neighbour.children.length });
    return;
  }
  moveLayerTo(s, id, { parentId, index: dir > 0 ? target + 1 : target });
}

/** Layer directly below among siblings, if it is a pixel layer. */
export function layerBelow(s: EditorSession, id: LayerId = s.activeLayerId): PixelLayer | null {
  const loc = findLayer(s.state.layers, id);
  if (!loc) return null;
  const below = loc.siblings[loc.index - 1];
  return below && below.type === 'pixel' ? below : null;
}

/**
 * Merges a pixel layer into the pixel layer below it, applying the upper
 * layer's opacity and blend mode. The lower layer keeps its own properties.
 */
export function mergeDown(s: EditorSession, id: LayerId = s.activeLayerId): void {
  s.cancelDraft();
  const st = s.state;
  const loc = findLayer(st.layers, id);
  if (!loc || loc.layer.type !== 'pixel') throw new EditorError('Só camadas de pixels podem ser mescladas para baixo.');
  const below = layerBelow(s, id);
  if (!below) throw new EditorError('Não há uma camada de pixels logo abaixo para mesclar.');
  if (below.locked || loc.layer.locked) throw new EditorError('Desbloqueie as camadas antes de mesclar.');
  const upper = loc.layer;
  const cels: Record<string, ImageId> = {};
  for (const [k, v] of Object.entries(st.cels)) if (parseCelKey(k).layerId !== upper.id) cels[k] = v;
  const newImages: ImageId[] = [];
  for (const f of st.frames) {
    const uId = st.cels[celKey(upper.id, f.id)];
    const up = uId ? s.image(uId) : undefined;
    if (!up || up.isEmpty() || !upper.visible) continue;
    const bId = st.cels[celKey(below.id, f.id)];
    const out = bId ? s.image(bId)!.clone() : new PixelBuffer(st.width, st.height);
    blendRegion(out, up, out.bounds, upper.opacity / 100, upper.blendMode);
    const ni = s.addImage(out);
    newImages.push(ni);
    cels[celKey(below.id, f.id)] = ni;
  }
  const next = { ...st, layers: removeLayer(st.layers, upper.id), cels };
  s.commit('Mesclar para baixo', next, [], newImages, { ...s.context, layerId: below.id });
}

/**
 * Flattens every visible layer into a single new layer that replaces them.
 * Hidden layers are kept untouched; groups left empty are removed.
 */
export function mergeVisible(s: EditorSession): void {
  s.cancelDraft();
  const st = s.state;
  const visible = pixelLayers(st.layers).filter((l) => isEffectivelyVisible(st.layers, l.id));
  if (visible.length < 2) throw new EditorError('É preciso ter pelo menos duas camadas visíveis para mesclar.');
  const merged = makePixelLayer('Mesclada');
  const drop = new Set(visible.map((l) => l.id));
  const cels: Record<string, ImageId> = {};
  for (const [k, v] of Object.entries(st.cels)) if (!drop.has(parseCelKey(k).layerId)) cels[k] = v;
  const newImages: ImageId[] = [];
  for (const f of st.frames) {
    const img = composeFrame(st, s.lookup, f.id);
    if (img.isEmpty()) continue;
    const ni = s.addImage(img);
    newImages.push(ni);
    cels[celKey(merged.id, f.id)] = ni;
  }
  const prune = (ls: LayerNode[]): LayerNode[] =>
    ls.flatMap((l): LayerNode[] => {
      if (drop.has(l.id)) return [];
      if (l.type === 'group') {
        const children = prune(l.children);
        // Visible groups whose content was merged disappear with it.
        if (children.length === 0 && l.children.length > 0) return [];
        return [{ ...l, children }];
      }
      return [l];
    });
  const layers = [...prune(st.layers), merged];
  s.commit('Mesclar visíveis', { ...st, layers, cels }, [], newImages, { ...s.context, layerId: merged.id });
}

/** New layer with a copy (or cut) of the selected pixels of the active cel. */
export function layerFromSelection(s: EditorSession, cut: boolean): LayerId {
  s.cancelDraft();
  const st = s.state;
  const sel = s.selection;
  if (!sel) throw new EditorError('Faça uma seleção primeiro.');
  const src = s.celImage(s.activeLayerId, s.activeFrameId);
  if (!src) throw new EditorError('A seleção está vazia nesta camada.');
  if (cut && !s.canEditLayer()) throw new EditorError('A camada ativa está bloqueada.');
  assertRoom(st);
  const piece = extractPiece(src, sel);
  if (piece.buffer.isEmpty()) throw new EditorError('A seleção está vazia nesta camada.');
  const full = new PixelBuffer(st.width, st.height);
  full.paste(piece.buffer, piece.x, piece.y);
  const layer = makePixelLayer(nextLayerName(st.layers, cut ? 'Recorte' : 'Cópia'));
  const newImages: ImageId[] = [];
  const cels: Record<string, ImageId> = { ...st.cels };
  const ni = s.addImage(full);
  newImages.push(ni);
  cels[celKey(layer.id, s.activeFrameId)] = ni;
  if (cut) {
    const rest = src.clone();
    const b = sel.bounds;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (sel.mask[y * b.w + x]) rest.set(b.x + x, b.y + y, 0);
    const ri = s.addImage(rest);
    newImages.push(ri);
    cels[celKey(s.activeLayerId, s.activeFrameId)] = ri;
  }
  const slot = slotOf(st.layers, s.activeLayerId)!;
  const next = { ...st, layers: insertLayer(st.layers, layer, { ...slot, index: slot.index + 1 }), cels };
  s.commit(cut ? 'Recortar para nova camada' : 'Copiar para nova camada', next, [], newImages, { ...s.context, layerId: layer.id });
  return layer.id;
}

/** Inserts a full-size image as a new layer on the active frame (paste/import as layer). */
export function addLayerWithImage(s: EditorSession, name: string, img: PixelBuffer, x = 0, y = 0): LayerId {
  s.cancelDraft();
  const st = s.state;
  assertRoom(st);
  const full = new PixelBuffer(st.width, st.height);
  full.paste(img, x, y);
  const layer = makePixelLayer(name.slice(0, LIMITS.maxNameLength) || nextLayerName(st.layers, 'Camada'));
  const ni = s.addImage(full);
  const slot = slotAboveActive(s);
  const next = { ...st, layers: insertLayer(st.layers, layer, slot), cels: { ...st.cels, [celKey(layer.id, s.activeFrameId)]: ni } };
  s.commit('Colar em nova camada', next, [], [ni], { ...s.context, layerId: layer.id });
  return layer.id;
}
