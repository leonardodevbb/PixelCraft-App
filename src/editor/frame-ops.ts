import { LIMITS } from '../project/limits';
import { celKey, makeFrame, parseCelKey, pixelLayers, type AnimationSettings, type FrameId, type ImageId, type LayerId } from '../project/model';
import { PixelBuffer } from '../raster/pixel-buffer';
import { EditorError, type EditorSession } from './session';
import { fixTagsAfterRemoval, TAG_COLORS } from '../animation/tags';
import { newId } from '../project/ids';
import type { Tag } from '../project/model';

function assertRoom(s: EditorSession, extra = 1): void {
  if (s.state.frames.length + extra > LIMITS.maxFrames) throw new EditorError(`Limite de ${LIMITS.maxFrames} quadros atingido.`);
}

function clampDuration(ms: number): number {
  return Math.max(LIMITS.minFrameDuration, Math.min(LIMITS.maxFrameDuration, Math.round(ms)));
}

function frameIndex(s: EditorSession, id: FrameId = s.activeFrameId): number {
  const i = s.state.frames.findIndex((f) => f.id === id);
  if (i < 0) throw new EditorError('Quadro inexistente.');
  return i;
}

/** Adds an empty frame after the active one (same duration) and selects it. */
export function addFrame(s: EditorSession): FrameId {
  s.cancelDraft();
  assertRoom(s);
  const i = frameIndex(s);
  const f = makeFrame(s.state.frames[i]!.duration);
  s.apply('Novo quadro', (st) => ({ ...st, frames: [...st.frames.slice(0, i + 1), f, ...st.frames.slice(i + 1)] }), { frameId: f.id });
  return f.id;
}

/**
 * Duplicates the active frame right after it. With `linked`, the new cels
 * share images with the original (editing one edits both) until unlinked.
 */
export function duplicateFrame(s: EditorSession, linked = false): FrameId {
  s.cancelDraft();
  assertRoom(s);
  const st = s.state;
  const i = frameIndex(s);
  const src = st.frames[i]!;
  const f = { ...makeFrame(src.duration) };
  const cels: Record<string, ImageId> = { ...st.cels };
  const newImages: ImageId[] = [];
  for (const [k, id] of Object.entries(st.cels)) {
    const { layerId, frameId } = parseCelKey(k);
    if (frameId !== src.id) continue;
    if (linked) cels[celKey(layerId, f.id)] = id;
    else {
      const img = s.image(id);
      if (!img) continue;
      const nid = s.addImage(img.clone());
      newImages.push(nid);
      cels[celKey(layerId, f.id)] = nid;
    }
  }
  const next = { ...st, frames: [...st.frames.slice(0, i + 1), f, ...st.frames.slice(i + 1)], cels };
  s.commit(linked ? 'Duplicar quadro (vinculado)' : 'Duplicar quadro', next, [], newImages, { ...s.context, frameId: f.id, selection: s.selection });
  return f.id;
}

export function deleteFrame(s: EditorSession, id: FrameId = s.activeFrameId): void {
  s.cancelDraft();
  const st = s.state;
  if (st.frames.length <= 1) throw new EditorError('A animação precisa de pelo menos um quadro.');
  const i = frameIndex(s, id);
  const nextActive = st.frames[i + 1]?.id ?? st.frames[i - 1]!.id;
  s.apply(
    'Excluir quadro',
    (cur) => {
      const cels: Record<string, ImageId> = {};
      for (const [k, v] of Object.entries(cur.cels)) if (parseCelKey(k).frameId !== id) cels[k] = v;
      const frames = cur.frames.filter((f) => f.id !== id);
      return { ...cur, frames, cels, tags: fixTagsAfterRemoval(cur, frames) };
    },
    { frameId: nextActive },
  );
}

/** Moves a frame to a new index (0-based, final position). */
export function moveFrame(s: EditorSession, id: FrameId, to: number): void {
  s.cancelDraft();
  const frames = [...s.state.frames];
  const from = frameIndex(s, id);
  const target = Math.max(0, Math.min(frames.length - 1, to));
  if (from === target) return;
  const [f] = frames.splice(from, 1);
  frames.splice(target, 0, f!);
  s.apply('Reordenar quadros', (st) => ({ ...st, frames }));
}

export function setFrameDuration(s: EditorSession, ids: FrameId[], ms: number): void {
  const d = clampDuration(ms);
  const set = new Set(ids);
  if (!s.state.frames.some((f) => set.has(f.id) && f.duration !== d)) return;
  s.apply(ids.length > 1 ? 'Duração dos quadros' : 'Duração do quadro', (st) => ({
    ...st,
    frames: st.frames.map((f) => (set.has(f.id) ? { ...f, duration: d } : f)),
  }));
}

/** Sets the FPS and makes every frame last 1000/fps ms. */
export function setFps(s: EditorSession, fps: number): void {
  const f = Math.max(1, Math.min(60, Math.round(fps)));
  const d = clampDuration(1000 / f);
  s.apply('Velocidade da animação', (st) => ({ ...st, animation: { ...st.animation, fps: f }, frames: st.frames.map((fr) => ({ ...fr, duration: d })) }));
}

export function setAnimation(s: EditorSession, patch: Partial<AnimationSettings>): void {
  const a = s.state.animation;
  if ((Object.keys(patch) as (keyof AnimationSettings)[]).every((k) => a[k] === patch[k])) return;
  s.apply('Configurar animação', (st) => ({ ...st, animation: { ...st.animation, ...patch } }));
}

/** Creates a tag over the frames from index `from` to `to` (inclusive). */
export function addTag(s: EditorSession, from: number, to: number, props: Partial<Omit<Tag, 'id' | 'from' | 'to'>> = {}): string {
  const frames = s.state.frames;
  const a = frames[Math.max(0, Math.min(from, to))];
  const b = frames[Math.min(frames.length - 1, Math.max(from, to))];
  if (!a || !b) throw new EditorError('Intervalo de quadros inválido.');
  const n = s.state.tags.length;
  const tag: Tag = {
    id: newId('T'),
    name: cleanTagName(props.name) ?? `Tag ${n + 1}`,
    from: a.id,
    to: b.id,
    color: props.color ?? TAG_COLORS[n % TAG_COLORS.length]!,
    direction: props.direction ?? 'forward',
    repeat: props.repeat ?? 0,
  };
  s.apply('Nova tag', (st) => ({ ...st, tags: [...st.tags, tag] }));
  return tag.id;
}

function cleanTagName(name: string | undefined): string | undefined {
  return name?.trim().slice(0, 60) || undefined;
}

export function updateTag(s: EditorSession, id: string, patch: Partial<Omit<Tag, 'id'>>): void {
  const t = s.state.tags.find((x) => x.id === id);
  if (!t) throw new EditorError('Tag inexistente.');
  const next = { ...t, ...patch, name: cleanTagName(patch.name) ?? t.name, repeat: Math.max(0, Math.min(1000, Math.round(patch.repeat ?? t.repeat))) };
  if ((Object.keys(next) as (keyof Tag)[]).every((k) => next[k] === t[k])) return;
  s.apply('Editar tag', (st) => ({ ...st, tags: st.tags.map((x) => (x.id === id ? next : x)) }));
}

/** Changes which frames a tag covers (indices, inclusive). */
export function setTagRange(s: EditorSession, id: string, from: number, to: number): void {
  const frames = s.state.frames;
  const a = frames[Math.max(0, Math.min(from, to))];
  const b = frames[Math.min(frames.length - 1, Math.max(from, to))];
  if (!a || !b) throw new EditorError('Intervalo de quadros inválido.');
  updateTag(s, id, { from: a.id, to: b.id });
}

export function removeTag(s: EditorSession, id: string): void {
  if (!s.state.tags.some((t) => t.id === id)) return;
  s.apply('Remover tag', (st) => ({ ...st, tags: st.tags.filter((t) => t.id !== id) }));
}

export function reverseFrames(s: EditorSession): void {
  if (s.state.frames.length < 2) return;
  s.cancelDraft();
  s.apply('Inverter ordem dos quadros', (st) => ({ ...st, frames: [...st.frames].reverse() }));
}

/** True when the cel's image is also used by another cel. */
export function isCelLinked(s: EditorSession, layerId: LayerId, frameId: FrameId): boolean {
  const id = s.state.cels[celKey(layerId, frameId)];
  if (!id) return false;
  let n = 0;
  for (const v of Object.values(s.state.cels)) if (v === id && ++n > 1) return true;
  return false;
}

/** Gives a linked cel its own copy of the image. */
export function unlinkCel(s: EditorSession, layerId: LayerId = s.activeLayerId, frameId: FrameId = s.activeFrameId): void {
  if (!isCelLinked(s, layerId, frameId)) return;
  s.cancelDraft();
  const key = celKey(layerId, frameId);
  const img = s.image(s.state.cels[key]!)!;
  const nid = s.addImage(img.clone());
  s.commit('Desvincular célula', { ...s.state, cels: { ...s.state.cels, [key]: nid } }, [], [nid]);
}

/** Makes the cel show the same image as the previous frame (linked). */
export function linkCelToPrevious(s: EditorSession, layerId: LayerId = s.activeLayerId, frameId: FrameId = s.activeFrameId): void {
  const i = frameIndex(s, frameId);
  const prev = s.state.frames[i - 1];
  if (!prev) throw new EditorError('O primeiro quadro não tem quadro anterior para vincular.');
  if (!s.canEditLayer(layerId)) throw new EditorError('A camada está bloqueada.');
  s.cancelDraft();
  const src = s.state.cels[celKey(layerId, prev.id)];
  const key = celKey(layerId, frameId);
  s.apply('Vincular ao quadro anterior', (st) => {
    const cels = { ...st.cels };
    if (src) cels[key] = src;
    else delete cels[key];
    return { ...st, cels };
  });
}

export function goToFrame(s: EditorSession, delta: number, wrap = true): void {
  const n = s.state.frames.length;
  let i = frameIndex(s) + delta;
  if (wrap) i = ((i % n) + n) % n;
  else i = Math.max(0, Math.min(n - 1, i));
  s.setActiveFrame(s.state.frames[i]!.id);
}

/* ---------- several frames at once ---------- */

/** Indices of the given frames in timeline order. */
function indicesOf(s: EditorSession, ids: readonly FrameId[]): number[] {
  const set = new Set(ids);
  const out: number[] = [];
  s.state.frames.forEach((f, i) => set.has(f.id) && out.push(i));
  return out;
}

/** Deletes several frames in one step; at least one frame always remains. */
export function deleteFrames(s: EditorSession, ids: readonly FrameId[]): void {
  const idx = indicesOf(s, ids);
  if (!idx.length) return;
  if (idx.length >= s.state.frames.length) throw new EditorError('A animação precisa de pelo menos um quadro.');
  if (idx.length === 1) return deleteFrame(s, s.state.frames[idx[0]!]!.id);
  s.cancelDraft();
  const gone = new Set(idx.map((i) => s.state.frames[i]!.id));
  const after = s.state.frames.slice(idx.at(-1)! + 1).find((f) => !gone.has(f.id)) ?? [...s.state.frames].reverse().find((f) => !gone.has(f.id))!;
  s.apply(
    'Excluir quadros',
    (cur) => {
      const cels: Record<string, ImageId> = {};
      for (const [k, v] of Object.entries(cur.cels)) if (!gone.has(parseCelKey(k).frameId)) cels[k] = v;
      const frames = cur.frames.filter((f) => !gone.has(f.id));
      return { ...cur, frames, cels, tags: fixTagsAfterRemoval(cur, frames) };
    },
    { frameId: after.id },
  );
}

/** Frames copied to the internal clipboard: durations and a copy of each layer's pixels. */
export interface FrameClip {
  frames: { duration: number; cels: { layerId: LayerId; layerIndex: number; image: PixelBuffer }[] }[];
}

export function copyFrames(s: EditorSession, ids: readonly FrameId[]): FrameClip {
  const layers = pixelLayers(s.state.layers);
  return {
    frames: indicesOf(s, ids).map((i) => {
      const f = s.state.frames[i]!;
      const cels: FrameClip['frames'][number]['cels'] = [];
      layers.forEach((l, layerIndex) => {
        const img = s.celImage(l.id, f.id);
        if (img && !img.isEmpty()) cels.push({ layerId: l.id, layerIndex, image: img.clone() });
      });
      return { duration: f.duration, cels };
    }),
  };
}

/**
 * Inserts copied frames after the active frame. Pixels go back to the layer
 * they came from; frames copied from another document land on the layer in
 * the same position (or the active layer if there are fewer layers).
 * Returns the new frame ids.
 */
export function pasteFrames(s: EditorSession, clip: FrameClip): FrameId[] {
  if (!clip.frames.length) return [];
  s.cancelDraft();
  assertRoom(s, clip.frames.length);
  const st = s.state;
  const layers = pixelLayers(st.layers);
  const at = frameIndex(s) + 1;
  const cels: Record<string, ImageId> = { ...st.cels };
  const newImages: ImageId[] = [];
  const made = clip.frames.map((cf) => {
    const f = makeFrame(clampDuration(cf.duration));
    for (const c of cf.cels) {
      const layer = layers.find((l) => l.id === c.layerId) ?? layers[c.layerIndex] ?? layers.find((l) => l.id === s.activeLayerId);
      if (!layer) continue;
      let img = c.image;
      if (img.width !== st.width || img.height !== st.height) {
        const fit = new PixelBuffer(st.width, st.height);
        fit.paste(img, 0, 0);
        img = fit;
      } else img = img.clone();
      const id = s.addImage(img);
      newImages.push(id);
      cels[celKey(layer.id, f.id)] = id;
    }
    return f;
  });
  const frames = [...st.frames.slice(0, at), ...made, ...st.frames.slice(at)];
  s.commit(made.length > 1 ? 'Colar quadros' : 'Colar quadro', { ...st, frames, cels }, [], newImages, { ...s.context, frameId: made[0]!.id });
  return made.map((f) => f.id);
}

/** Duplicates a block of frames right after its last frame. */
export function duplicateFrames(s: EditorSession, ids: readonly FrameId[]): FrameId[] {
  const idx = indicesOf(s, ids);
  if (!idx.length) return [];
  const clip = copyFrames(s, ids);
  const last = s.state.frames[idx.at(-1)!]!.id;
  if (s.activeFrameId !== last) s.setActiveFrame(last);
  return pasteFrames(s, clip);
}

/** Moves a block of frames so it starts at index `to` (in the timeline without the block). */
export function moveFrames(s: EditorSession, ids: readonly FrameId[], to: number): void {
  const idx = indicesOf(s, ids);
  if (!idx.length) return;
  s.cancelDraft();
  const block = idx.map((i) => s.state.frames[i]!);
  const rest = s.state.frames.filter((_, i) => !idx.includes(i));
  const target = Math.max(0, Math.min(rest.length, to));
  const frames = [...rest.slice(0, target), ...block, ...rest.slice(target)];
  if (frames.every((f, i) => f === s.state.frames[i])) return;
  s.apply('Reordenar quadros', (st) => ({ ...st, frames }));
}

/** Reverses the order of the given frames in place (all frames when fewer than two are given). */
export function reverseFrameRange(s: EditorSession, ids: readonly FrameId[]): void {
  const idx = indicesOf(s, ids);
  if (idx.length < 2) return reverseFrames(s);
  s.cancelDraft();
  const frames = [...s.state.frames];
  const picked = idx.map((i) => frames[i]!).reverse();
  idx.forEach((i, k) => (frames[i] = picked[k]!));
  s.apply('Inverter ordem dos quadros', (st) => ({ ...st, frames }));
}
