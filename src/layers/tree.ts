import { newId } from '../project/ids';
import { findLayer, type GroupLayer, type LayerId, type LayerNode } from '../project/model';

/** Where a layer sits: parent group (null = root) and index in its children (bottom-to-top). */
export interface LayerSlot {
  parentId: LayerId | null;
  index: number;
}

function childrenOf(layers: LayerNode[], parentId: LayerId | null): LayerNode[] | null {
  if (parentId === null) return layers;
  const loc = findLayer(layers, parentId);
  return loc && loc.layer.type === 'group' ? loc.layer.children : null;
}

function replaceChildren(layers: LayerNode[], parentId: LayerId | null, children: LayerNode[]): LayerNode[] {
  if (parentId === null) return children;
  return layers.map((l) => {
    if (l.id === parentId && l.type === 'group') return { ...l, children };
    if (l.type === 'group') {
      const sub = replaceChildren(l.children, parentId, children);
      return sub === l.children ? l : { ...l, children: sub };
    }
    return l;
  }) as LayerNode[];
}

export function slotOf(layers: LayerNode[], id: LayerId): LayerSlot | null {
  const loc = findLayer(layers, id);
  return loc ? { parentId: loc.parent?.id ?? null, index: loc.index } : null;
}

export function insertLayer(layers: LayerNode[], node: LayerNode, slot: LayerSlot): LayerNode[] {
  const siblings = childrenOf(layers, slot.parentId);
  if (!siblings) throw new Error('Grupo de destino inexistente.');
  const index = Math.max(0, Math.min(siblings.length, slot.index));
  return replaceChildren(layers, slot.parentId, [...siblings.slice(0, index), node, ...siblings.slice(index)]);
}

export function removeLayer(layers: LayerNode[], id: LayerId): LayerNode[] {
  const slot = slotOf(layers, id);
  if (!slot) return layers;
  const siblings = childrenOf(layers, slot.parentId)!;
  return replaceChildren(layers, slot.parentId, siblings.filter((l) => l.id !== id));
}

/** Depth of the deepest group nesting inside a node (a pixel layer is 0). */
export function nestingDepth(node: LayerNode): number {
  if (node.type !== 'group') return 0;
  return 1 + Math.max(0, ...node.children.map(nestingDepth));
}

export function depthOf(layers: LayerNode[], parentId: LayerId | null): number {
  if (parentId === null) return 0;
  const loc = findLayer(layers, parentId);
  return loc ? loc.depth + 1 : 0;
}

export function isDescendant(node: LayerNode, id: LayerId): boolean {
  return node.type === 'group' && node.children.some((c) => c.id === id || isDescendant(c, id));
}

/**
 * Moves a layer to a slot. The index refers to the destination list *before*
 * the layer is removed from its current position.
 */
export function moveLayer(layers: LayerNode[], id: LayerId, to: LayerSlot): LayerNode[] {
  const loc = findLayer(layers, id);
  if (!loc) return layers;
  if (to.parentId === id || (to.parentId && isDescendant(loc.layer, to.parentId))) throw new Error('Não é possível mover um grupo para dentro dele mesmo.');
  const from = slotOf(layers, id)!;
  let index = to.index;
  if (from.parentId === to.parentId && from.index < to.index) index--;
  if (from.parentId === to.parentId && from.index === index) return layers;
  return insertLayer(removeLayer(layers, id), loc.layer, { parentId: to.parentId, index });
}

/** Deep copy with fresh ids; `map` receives old → new ids for every node. */
export function cloneLayer(node: LayerNode, map: Map<LayerId, LayerId>, suffix = ''): LayerNode {
  const id = newId(node.type === 'group' ? 'G' : 'L');
  map.set(node.id, id);
  if (node.type === 'group') {
    return { ...node, id, name: node.name + suffix, children: node.children.map((c) => cloneLayer(c, map)) } satisfies GroupLayer;
  }
  return { ...node, id, name: node.name + suffix };
}

/** All ids in a subtree, the node included. */
export function subtreeIds(node: LayerNode): LayerId[] {
  if (node.type !== 'group') return [node.id];
  return [node.id, ...node.children.flatMap(subtreeIds)];
}

/** Flat list in panel order (top-most first), skipping children of collapsed groups. */
export function panelRows(layers: LayerNode[], depth = 0, out: { layer: LayerNode; depth: number }[] = []): { layer: LayerNode; depth: number }[] {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!;
    out.push({ layer: l, depth });
    if (l.type === 'group' && l.expanded) panelRows(l.children, depth + 1, out);
  }
  return out;
}

/** Unique name like "Camada 3" not used by any layer. */
export function nextLayerName(layers: LayerNode[], base: string): string {
  const names = new Set<string>();
  const visit = (ls: LayerNode[]): void => {
    for (const l of ls) {
      names.add(l.name);
      if (l.type === 'group') visit(l.children);
    }
  };
  visit(layers);
  for (let i = 1; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}
