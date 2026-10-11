import { Player, playbackOrder } from '../../animation/playback';
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
    const order = playbackOrder(st.frames.length, st.animation);
    const start = st.frames.findIndex((f) => f.id === (useEditor.getState().playFrameId ?? session.activeFrameId));
    return {
      player: new Player(order, st.frames.map((f) => f.duration), st.animation.loop === 'once', start),
      ids: st.frames.map((f) => f.id),
    };
  };
  let { player, ids } = build();
  // Rebuild when frames, durations or modes change during playback.
  let frames = session.state.frames;
  let anim = session.state.animation;
  unsub = session.subscribe(() => {
    if (session.state.frames !== frames || session.state.animation !== anim) {
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
