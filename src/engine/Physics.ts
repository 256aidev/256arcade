export interface Rect {
  x: number; y: number; w: number; h: number;
}

export interface Circle {
  x: number; y: number; r: number;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

export function circlesOverlap(a: Circle, b: Circle): boolean {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy < (a.r + b.r) * (a.r + b.r);
}

export function circleRectOverlap(c: Circle, r: Rect): boolean {
  const cx = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const cy = Math.max(r.y, Math.min(c.y, r.y + r.h));
  const dx = c.x - cx, dy = c.y - cy;
  return dx * dx + dy * dy < c.r * c.r;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}
