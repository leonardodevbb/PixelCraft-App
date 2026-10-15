import { describe, expect, it } from 'vitest';
import { tagRange, tagsAt } from '../../src/animation/tags';
import {
  addFrame,
  addTag,
  copyFrames,
  deleteFrame,
  deleteFrames,
  duplicateFrames,
  moveFrames,
  pasteFrames,
  removeTag,
  reverseFrameRange,
  updateTag,
} from '../../src/editor/frame-ops';
import { framesInRange, prepareGif, rangeOptions } from '../../src/import-export/animation-export';
import { activeImage, drag, makeHost, newSession, RED } from './helpers';

function fiveFrames() {
  const s = newSession(4, 4);
  const h = makeHost(s);
  for (let i = 0; i < 4; i++) addFrame(s);
  // Mark each frame with a pixel in its own column so order is visible.
  s.state.frames.forEach((f, i) => {
    s.setActiveFrame(f.id);
    drag(h, 'pencil', [{ x: i % 4, y: Math.floor(i / 4) }]);
  });
  s.setActiveFrame(s.state.frames[0]!.id);
  return { s, h, ids: s.state.frames.map((f) => f.id) };
}

describe('animation tags', () => {
  it('covers a range, follows inserted frames and reports tags at a frame', () => {
    const { s, ids } = fiveFrames();
    const t = addTag(s, 1, 3, { name: 'andar', direction: 'pingpong' });
    const tag = s.state.tags.find((x) => x.id === t)!;
    expect(tagRange(s.state, tag)).toEqual({ from: 1, to: 3 });
    expect(tagsAt(s.state, ids[2]!).map((x) => x.name)).toEqual(['andar']);
    expect(tagsAt(s.state, ids[0]!)).toEqual([]);
    // A frame inserted inside the range joins the tag.
    s.setActiveFrame(ids[1]!);
    addFrame(s);
    expect(tagRange(s.state, s.state.tags[0]!)).toEqual({ from: 1, to: 4 });
  });
  it('shrinks when an end frame is deleted and disappears with its last frame', () => {
    const { s, ids } = fiveFrames();
    addTag(s, 1, 2, { name: 'a' });
    deleteFrame(s, ids[2]!);
    expect(tagRange(s.state, s.state.tags[0]!)).toEqual({ from: 1, to: 1 });
    deleteFrame(s, ids[1]!);
    expect(s.state.tags).toEqual([]);
    s.undo();
    s.undo();
    expect(tagRange(s.state, s.state.tags[0]!)).toEqual({ from: 1, to: 2 });
  });
  it('edits and removes as single undo steps', () => {
    const { s } = fiveFrames();
    const t = addTag(s, 0, 1);
    updateTag(s, t, { name: '  pular ', repeat: 3, color: '#2ec4b6' });
    expect(s.state.tags[0]).toMatchObject({ name: 'pular', repeat: 3, color: '#2ec4b6' });
    removeTag(s, t);
    expect(s.state.tags).toEqual([]);
    s.undo();
    expect(s.state.tags[0]!.name).toBe('pular');
  });
  it('exports a tag on its own with its direction', () => {
    const { s } = fiveFrames();
    const t = addTag(s, 1, 3, { name: 'andar', direction: 'pingpong' });
    expect(framesInRange(s.state, t)).toHaveLength(3);
    expect(rangeOptions(s.state).map((o) => o.value)).toEqual(['all', t]);
    const gif = prepareGif(s.state, s.lookup, { range: t, scale: 1, background: null, loop: 0, alphaThreshold: 128 });
    // Ping-pong over 3 frames: 0 1 2 1.
    expect(gif.frames).toHaveLength(4);
  });
});

describe('several frames', () => {
  it('copies and pastes frames with their pixels after the active one', () => {
    const { s, ids } = fiveFrames();
    const clip = copyFrames(s, [ids[0]!, ids[1]!]);
    s.setActiveFrame(ids[4]!);
    const made = pasteFrames(s, clip);
    expect(made).toHaveLength(2);
    expect(s.state.frames.slice(5).map((f) => f.id)).toEqual(made);
    s.setActiveFrame(made[1]!);
    expect(activeImage(s)!.get(1, 0)).toBe(RED);
    expect(activeImage(s)!.get(0, 0)).toBe(0);
    // Pasted pixels are copies, not links.
    expect(s.state.cels[`${s.activeLayerId}/${made[1]}`]).not.toBe(s.state.cels[`${s.activeLayerId}/${ids[1]}`]);
  });
  it('pastes frames copied from another document onto the same layer position', () => {
    const { s, ids } = fiveFrames();
    const clip = copyFrames(s, [ids[3]!]);
    const other = newSession(4, 4);
    const [id] = pasteFrames(other, clip);
    other.setActiveFrame(id!);
    expect(activeImage(other)!.get(3, 0)).toBe(RED);
  });
  it('deletes, duplicates, moves and reverses a block', () => {
    const { s, ids } = fiveFrames();
    deleteFrames(s, [ids[1]!, ids[2]!]);
    expect(s.state.frames.map((f) => f.id)).toEqual([ids[0], ids[3], ids[4]]);
    expect(s.history.entries.at(-1)!.label).toBe('Excluir quadros');
    s.undo();
    const dup = duplicateFrames(s, [ids[0]!, ids[1]!]);
    expect(s.state.frames.map((f) => f.id)).toEqual([ids[0], ids[1], ...dup, ids[2], ids[3], ids[4]]);
    s.undo();
    moveFrames(s, [ids[0]!, ids[1]!], 3);
    expect(s.state.frames.map((f) => f.id)).toEqual([ids[2], ids[3], ids[4], ids[0], ids[1]]);
    s.undo();
    reverseFrameRange(s, [ids[1]!, ids[2]!, ids[3]!]);
    expect(s.state.frames.map((f) => f.id)).toEqual([ids[0], ids[3], ids[2], ids[1], ids[4]]);
  });
  it('never deletes every frame', () => {
    const { s, ids } = fiveFrames();
    expect(() => deleteFrames(s, ids)).toThrow(/pelo menos um quadro/);
  });
});
