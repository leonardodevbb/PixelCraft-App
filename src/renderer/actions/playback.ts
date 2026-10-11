import { Player, playbackOrder } from '../../animation/playback';
import { tagRange, tagsAt } from '../../animation/tags';
import { useEditor } from '../state/editor-store';

let raf = 0;
let unsub: (() => void) | null = null;

export function stopPlayback(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  unsub?.();
  unsub = null;
  if (useEditor.getState().playing) useEditor.setState({ playing: false, playFrameId: null });
}

/**
 * Plays the animation in the editor using each frame's duration and the
 * document's loop mode and direction. Editing stops playback.
 */
export function startPlayback(): void {
  const { session } = useEditor.getState();
  if (!session || session.state.frames.length < 2) return;
  stopPlayback();
  const build = (): { player: Player; ids: string[] } => {
    const st = session.state;
    // A one-frame tag would show nothing moving, so it plays everything instead.
    const tag = useEditor.getState().playTagOnly
      ? tagsAt(st, session.activeFrameId).find((t) => {
          const r = tagRange(st, t);
          return !!r && r.to > r.from;
        })
      : undefined;
    const range = tag ? tagRange(st, tag) : null;
    // A tag plays on its own frames, with its own direction.
    const frames = range ? st.frames.slice(range.from, range.to + 1) : st.frames;
    const anim = tag ? { loop: tag.direction === 'pingpong' ? ('pingpong' as const) : ('loop' as const), direction: tag.direction === 'reverse' ? ('reverse' as const) : ('forward' as const) } : st.animation;
    const order = playbackOrder(frames.length, anim);
    const start = frames.findIndex((f) => f.id === (useEditor.getState().playFrameId ?? session.activeFrameId));
    return {
      player: new Player(order, frames.map((f) => f.duration), !tag && st.animation.loop === 'once', start),
      ids: frames.map((f) => f.id),
    };
  };
  let { player, ids } = build();
  // Rebuild when frames, durations or modes change during playback.
  let frames = session.state.frames;
  let anim = session.state.animation;
  let tags = session.state.tags;
  unsub = session.subscribe(() => {
    if (session.state.frames !== frames || session.state.animation !== anim || session.state.tags !== tags) {
      tags = session.state.tags;
      frames = session.state.frames;
      anim = session.state.animation;
      ({ player, ids } = build());
    }
  });
  useEditor.setState({ playing: true, playFrameId: ids[player.current] ?? null });
  let last = performance.now();
  const tick = (now: number): void => {
    const st = useEditor.getState();
    if (!st.playing || st.session !== session) return stopPlayback();
    const i = player.advance(Math.min(now - last, 1000));
    last = now;
    const id = ids[i] ?? null;
    if (id !== st.playFrameId) useEditor.setState({ playFrameId: id });
    if (player.done) {
      // "Once": stay on the last frame shown, then end.
      if (id) session.setActiveFrame(id);
      return stopPlayback();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export function togglePlayback(): void {
  if (useEditor.getState().playing) stopPlayback();
  else startPlayback();
}
