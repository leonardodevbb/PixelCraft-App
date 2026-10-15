import type { DocState, FrameId, Tag } from '../project/model';

/** Colours offered for new tags, cycled in order. */
export const TAG_COLORS = ['#ff7a3d', '#2ec4b6', '#7b5cff', '#ffd23f', '#ff4f81', '#3ccf91', '#4aa8ff', '#c08a5b'];

export const TAG_DIRECTION_LABELS: Record<Tag['direction'], string> = {
  forward: 'Para frente',
  reverse: 'Ao contrário',
  pingpong: 'Vai e volta',
};

/** First and last frame index of a tag (endpoints may be stored in either order). */
export function tagRange(state: Pick<DocState, 'frames'>, tag: Tag): { from: number; to: number } | null {
  const a = state.frames.findIndex((f) => f.id === tag.from);
  const b = state.frames.findIndex((f) => f.id === tag.to);
  if (a < 0 || b < 0) return null;
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

/** Tags containing the frame, innermost (shortest) first. */
export function tagsAt(state: Pick<DocState, 'frames' | 'tags'>, frameId: FrameId): Tag[] {
  const i = state.frames.findIndex((f) => f.id === frameId);
  return state.tags
    .map((t) => ({ t, r: tagRange(state, t) }))
    .filter((x) => x.r && x.r.from <= i && i <= x.r.to)
    .sort((a, b) => a.r!.to - a.r!.from - (b.r!.to - b.r!.from))
    .map((x) => x.t);
}

/**
 * Keeps tags valid after frames were removed: an endpoint that disappeared
 * moves inwards to the nearest surviving frame of the old range; a tag whose
 * frames are all gone is dropped.
 */
export function fixTagsAfterRemoval(before: Pick<DocState, 'frames' | 'tags'>, frames: DocState['frames']): Tag[] {
  const alive = new Set(frames.map((f) => f.id));
  const out: Tag[] = [];
  for (const t of before.tags) {
    const r = tagRange(before, t);
    if (!r) continue;
    const ids = before.frames.slice(r.from, r.to + 1).map((f) => f.id).filter((id) => alive.has(id));
    if (!ids.length) continue;
    out.push({ ...t, from: ids[0]!, to: ids.at(-1)! });
  }
  return out;
}
