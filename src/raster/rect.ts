export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export function rectIsEmpty(r: Rect): boolean {
  return r.w <= 0 || r.h <= 0;
}

export function intersectRect(a: Rect, b: Rect): Rect {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a || rectIsEmpty(a)) return { ...b };
  if (rectIsEmpty(b)) return { ...a };
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Normalised rectangle spanning two inclusive corner pixels. */
export function rectFromCorners(a: Point, b: Point): Rect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}
