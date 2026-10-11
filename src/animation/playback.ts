import type { AnimationSettings } from '../project/model';

/**
 * Order in which frames play for one cycle. Ping-pong goes forward then back
 * without repeating the end frames; reverse plays the sequence backwards.
 */
export function playbackOrder(count: number, a: Pick<AnimationSettings, 'loop' | 'direction'>): number[] {
  if (count <= 0) return [];
  let seq = Array.from({ length: count }, (_, i) => i);
  if (a.direction === 'reverse') seq.reverse();
  if (a.loop === 'pingpong' && count > 2) seq = [...seq, ...seq.slice(1, -1).reverse()];
  else if (a.loop === 'pingpong' && count === 2) seq = [...seq];
  return seq;
}

/** Total time of one cycle in ms. */
export function cycleDuration(durations: number[], order: number[]): number {
  return order.reduce((t, i) => t + (durations[i] ?? 0), 0);
}

/**
 * Tracks playback position. `advance(elapsed)` returns the frame index to
 * show; with loop mode 'once' it stops on the last frame of the order.
 */
export class Player {
  private pos = 0;
  private acc = 0;
  done = false;

  constructor(
    private order: number[],
    private durations: number[],
    private once: boolean,
    startIndex = 0,
  ) {
    const p = order.indexOf(startIndex);
    this.pos = p >= 0 ? p : 0;
  }

  get current(): number {
    return this.order[this.pos] ?? 0;
  }

  advance(elapsedMs: number): number {
    if (this.done || this.order.length === 0) return this.current;
    this.acc += elapsedMs;
    // Guard against pathological durations so a long pause can't spin forever.
    let guard = 10_000;
    while (guard-- > 0) {
      const d = Math.max(1, this.durations[this.current] ?? 100);
      if (this.acc < d) break;
      this.acc -= d;
      if (this.pos + 1 >= this.order.length) {
        if (this.once) {
          this.done = true;
          this.acc = 0;
          break;
        }
        this.pos = 0;
      } else this.pos++;
    }
    return this.current;
  }
}
