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
export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'add',
  'subtract',
  'divide',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiplicação',
  screen: 'Tela',
  overlay: 'Sobreposição',
  darken: 'Escurecer',
  lighten: 'Clarear',
  'color-dodge': 'Subexposição de cor',
  'color-burn': 'Superexposição de cor',
  'hard-light': 'Luz forte',
  'soft-light': 'Luz suave',
  difference: 'Diferença',
  exclusion: 'Exclusão',
  hue: 'Matiz',
  saturation: 'Saturação',
  color: 'Cor',
  luminosity: 'Luminosidade',
  add: 'Adição',
  subtract: 'Subtração',
  divide: 'Divisão',
};

type BlendFn = (cb: number, cs: number) => number;

const multiply: BlendFn = (cb, cs) => cb * cs;
const screen: BlendFn = (cb, cs) => cb + cs - cb * cs;
const hardLight: BlendFn = (cb, cs) => (cs <= 0.5 ? multiply(cb, 2 * cs) : screen(cb, 2 * cs - 1));
const softLight: BlendFn = (cb, cs) => {
  if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
  const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
  return cb + (2 * cs - 1) * (d - cb);
};

type SeparableMode = Exclude<BlendMode, 'hue' | 'saturation' | 'color' | 'luminosity'>;

const FUNCS: Record<SeparableMode, BlendFn> = {
  normal: (_cb, cs) => cs,
  multiply,
  screen,
  overlay: (cb, cs) => hardLight(cs, cb),
  darken: Math.min,
  lighten: Math.max,
  'color-dodge': (cb, cs) => (cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs))),
  'color-burn': (cb, cs) => (cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs)),
  'hard-light': hardLight,
  'soft-light': softLight,
  difference: (cb, cs) => Math.abs(cb - cs),
  exclusion: (cb, cs) => cb + cs - 2 * cb * cs,
  add: (cb, cs) => Math.min(1, cb + cs),
  subtract: (cb, cs) => Math.max(0, cb - cs),
  divide: (cb, cs) => (cb === 0 ? 0 : cs <= 0 ? 1 : Math.min(1, cb / cs)),
};

/* Non-separable modes (W3C Compositing and Blending, section 10.2). */
type RGB = [number, number, number];
const lum = (c: RGB): number => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c: RGB): RGB {
  const l = lum(c);
  const n = Math.min(...c);
  const x = Math.max(...c);
  let out: RGB = c;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as RGB;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as RGB;
  return out;
}
function setLum(c: RGB, l: number): RGB {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}
const sat = (c: RGB): number => Math.max(...c) - Math.min(...c);
function setSat(c: RGB, s: number): RGB {
  const max = Math.max(...c);
  const min = Math.min(...c);
  if (max === min) return [0, 0, 0];
  return c.map((v) => ((v - min) * s) / (max - min)) as RGB;
}
const NON_SEPARABLE: Record<'hue' | 'saturation' | 'color' | 'luminosity', (cb: RGB, cs: RGB) => RGB> = {
  hue: (cb, cs) => setLum(setSat(cs, sat(cb)), lum(cb)),
  saturation: (cb, cs) => setLum(setSat(cb, sat(cs)), lum(cb)),
  color: (cb, cs) => setLum(cs, lum(cb)),
  luminosity: (cb, cs) => setLum(cb, lum(cs)),
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
  const ao = as + ab * (1 - as);
  const cb: RGB = [dst[i]! / 255, dst[i + 1]! / 255, dst[i + 2]! / 255];
  const cs: RGB = [sr / 255, sg / 255, sb / 255];
  let mixed: RGB;
  if (mode in NON_SEPARABLE) mixed = NON_SEPARABLE[mode as keyof typeof NON_SEPARABLE](cb, cs);
  else {
    const f = FUNCS[mode as SeparableMode];
    mixed = [f(cb[0], cs[0]), f(cb[1], cs[1]), f(cb[2], cs[2])];
  }
  for (let k = 0; k < 3; k++) {
    const csp = (1 - ab) * cs[k]! + ab * mixed[k]!;
    dst[i + k] = Math.round(((as * csp + ab * cb[k]! * (1 - as)) / ao) * 255);
  }
  dst[i + 3] = Math.round(ao * 255);
}
