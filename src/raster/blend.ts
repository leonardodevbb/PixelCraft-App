/**
 * Straight-alpha compositing following the W3C Compositing and Blending
 * Level 1 model (source-over with a separable blend function):
 *
 *   Cs' = (1 - ab) * Cs + ab * B(Cb, Cs)
 *   ao  = as + ab * (1 - as)
 *   Co  = (as * Cs' + ab * Cb * (1 - as)) / ao
 *
 * Fully opaque pixels drawn in Normal mode therefore come out bit-exact.
 */
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'add'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiplicação',
  screen: 'Tela',
  overlay: 'Sobreposição',
  add: 'Adição',
};

type BlendFn = (cb: number, cs: number) => number;

const multiply: BlendFn = (cb, cs) => cb * cs;
const screen: BlendFn = (cb, cs) => cb + cs - cb * cs;
const hardLight: BlendFn = (cb, cs) => (cs <= 0.5 ? multiply(cb, 2 * cs) : screen(cb, 2 * cs - 1));

const FUNCS: Record<BlendMode, BlendFn> = {
  normal: (_cb, cs) => cs,
  multiply,
  screen,
  overlay: (cb, cs) => hardLight(cs, cb),
  add: (cb, cs) => Math.min(1, cb + cs),
};

/**
 * Composites one source pixel onto the destination array at index `i`.
 * `opacity` (0..1) scales the source alpha (layer opacity).
 */
export function blendPixel(
  dst: Uint8ClampedArray,
  i: number,
  sr: number,
  sg: number,
  sb: number,
  sa255: number,
  opacity: number,
  mode: BlendMode,
): void {
  const as = (sa255 / 255) * opacity;
  if (as <= 0) return;
  const ab = dst[i + 3]! / 255;
  if (mode === 'normal' && (as >= 1 || ab === 0)) {
    if (as >= 1) {
      dst[i] = sr;
      dst[i + 1] = sg;
      dst[i + 2] = sb;
      dst[i + 3] = 255;
      return;
    }
    dst[i] = sr;
    dst[i + 1] = sg;
    dst[i + 2] = sb;
    dst[i + 3] = Math.round(as * 255);
    return;
  }
  const f = FUNCS[mode];
  const ao = as + ab * (1 - as);
  const mix = (cb255: number, cs255: number): number => {
    const cb = cb255 / 255;
    const cs = cs255 / 255;
    const csp = (1 - ab) * cs + ab * f(cb, cs);
    return Math.round(((as * csp + ab * cb * (1 - as)) / ao) * 255);
  };
  dst[i] = mix(dst[i]!, sr);
  dst[i + 1] = mix(dst[i + 1]!, sg);
  dst[i + 2] = mix(dst[i + 2]!, sb);
  dst[i + 3] = Math.round(ao * 255);
}
