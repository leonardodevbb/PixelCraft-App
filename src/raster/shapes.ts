import type { Point } from './rect';

/** Callback receiving logical pixel coordinates. */
export type Plot = (x: number, y: number) => void;

/** Bresenham line, inclusive of both endpoints. */
export function line(x0: number, y0: number, x1: number, y1: number, plot: Plot): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    plot(x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Snaps `to` so the segment from `from` is horizontal, vertical or at 45°,
 * used when the user holds Shift with the line tool.
 */
export function constrainLine(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx > ady * 2) return { x: to.x, y: from.y };
  if (ady > adx * 2) return { x: from.x, y: to.y };
  const d = Math.max(adx, ady);
  return { x: from.x + Math.sign(dx) * d, y: from.y + Math.sign(dy) * d };
}

/** Makes the box spanned by two corners square (Shift with rectangle/ellipse). */
export function constrainSquare(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: from.x + (dx < 0 ? -d : d), y: from.y + (dy < 0 ? -d : d) };
}

export function rectOutline(x0: number, y0: number, x1: number, y1: number, plot: Plot): void {
  const ax = Math.min(x0, x1);
  const bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1);
  const by = Math.max(y0, y1);
  for (let x = ax; x <= bx; x++) {
    plot(x, ay);
    if (by !== ay) plot(x, by);
  }
  for (let y = ay + 1; y < by; y++) {
    plot(ax, y);
    if (bx !== ax) plot(bx, y);
  }
}

export function rectFilled(x0: number, y0: number, x1: number, y1: number, plot: Plot): void {
  const ax = Math.min(x0, x1);
  const bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1);
  const by = Math.max(y0, y1);
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) plot(x, y);
}

/**
 * Pixel-exact ellipse outline inscribed in the inclusive box (x0,y0)-(x1,y1).
 * Alois Zingl's bounding-box ellipse algorithm, which handles even and odd
 * sizes symmetrically. Points may be reported more than once.
 */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number, plot: Plot): void {
  let ax = Math.min(x0, x1);
  let bx = Math.max(x0, x1);
  let ay = Math.min(y0, y1);
  let by = Math.max(y0, y1);
  let a = bx - ax;
  const b = by - ay;
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  let e2: number;
  ay += (b + 1) >> 1;
  by = ay - b1;
  a *= 8 * a;
  b1 = 8 * b * b;
  do {
    plot(bx, ay);
    plot(ax, ay);
    plot(ax, by);
    plot(bx, by);
    e2 = 2 * err;
    if (e2 <= dy) {
      ay++;
      by--;
      err += dy += a;
    }
    if (e2 >= dx || 2 * err > dy) {
      ax++;
      bx--;
      err += dx += b1;
    }
  } while (ax <= bx);
  // Finish the tips of very flat ellipses.
  while (ay - by <= b) {
    plot(ax - 1, ay);
    plot(bx + 1, ay++);
    plot(ax - 1, by);
    plot(bx + 1, by--);
  }
}

function dedupe(plot: Plot): Plot {
  const seen = new Set<string>();
  return (x, y) => {
    const k = `${x},${y}`;
    if (seen.has(k)) return;
    seen.add(k);
    plot(x, y);
  };
}

export function ellipseOutline(x0: number, y0: number, x1: number, y1: number, plot: Plot): void {
  ellipsePoints(x0, y0, x1, y1, dedupe(plot));
}

export function ellipseFilled(x0: number, y0: number, x1: number, y1: number, plot: Plot): void {
  const spans = new Map<number, [number, number]>();
  ellipsePoints(x0, y0, x1, y1, (x, y) => {
    const s = spans.get(y);
    if (!s) spans.set(y, [x, x]);
    else {
      if (x < s[0]) s[0] = x;
      if (x > s[1]) s[1] = x;
    }
  });
  for (const [y, [l, r]] of spans) for (let x = l; x <= r; x++) plot(x, y);
}

export type BrushShape = 'square' | 'circle';

/**
 * Offsets covered by a brush of the given size, relative to the pointer pixel.
 * Even sizes extend one pixel further to the top-left, matching the common
 * behaviour of pixel art editors.
 */
export function brushFootprint(size: number, shape: BrushShape): Point[] {
  const s = Math.max(1, Math.floor(size));
  const start = -Math.floor(s / 2);
  const out: Point[] = [];
  const c = (s - 1) / 2;
  const r2 = (s / 2) * (s / 2) - 0.5;
  for (let dy = 0; dy < s; dy++) {
    for (let dx = 0; dx < s; dx++) {
      if (shape === 'circle' && s > 2) {
        const ox = dx - c;
        const oy = dy - c;
        if (ox * ox + oy * oy > r2) continue;
      }
      out.push({ x: start + dx, y: start + dy });
    }
  }
  return out;
}
