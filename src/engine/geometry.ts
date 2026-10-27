import { dir, q } from './dmath';
import type { Island, Ship } from './types';

export interface Pt {
  x: number;
  y: number;
}

/** Ruler lengths in inches, as on the printed S (short) and L (long) bars. */
export const S_LEN = 3;
export const L_LEN = 6;
export const barLen = (b: 'S' | 'L') => (b === 'S' ? S_LEN : L_LEN);

/** Two pieces closer than this count as touching. */
export const TOUCH = 0.15;
/** Overlap tolerance so pieces that touch are not treated as colliding. */
const EPS = 0.02;

export function shipLength(masts: number): number {
  return 1.7 + 0.5 * Math.min(Math.max(masts, 1), 6);
}
export function shipWidth(masts: number): number {
  return 0.75 + 0.12 * Math.min(Math.max(masts, 1), 6);
}

export interface Pose {
  x: number;
  y: number;
  heading: number;
}

/** Convex hull outline for a ship at a pose: pointed bow, square stern. */
export function hullAt(masts: number, p: Pose): Pt[] {
  const L = shipLength(masts);
  const W = shipWidth(masts) / 2;
  const f = dir(p.heading);
  const s = { x: -f.y, y: f.x };
  const sh = L * 0.28;
  return [
    { x: p.x, y: p.y },
    { x: p.x - f.x * sh + s.x * W, y: p.y - f.y * sh + s.y * W },
    { x: p.x - f.x * L + s.x * W, y: p.y - f.y * L + s.y * W },
    { x: p.x - f.x * L - s.x * W, y: p.y - f.y * L - s.y * W },
    { x: p.x - f.x * sh - s.x * W, y: p.y - f.y * sh - s.y * W },
  ];
}

export function hull(ship: Ship): Pt[] {
  return hullAt(ship.def.masts, ship);
}

export function sternAt(masts: number, p: Pose): Pt {
  const f = dir(p.heading);
  const L = shipLength(masts);
  return { x: p.x - f.x * L, y: p.y - f.y * L };
}

/** Mast centres, bow to stern. */
export function mastPoints(ship: Pose & { def: { masts: number } }): Pt[] {
  const n = ship.def.masts;
  const L = shipLength(n);
  const f = dir(ship.heading);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : 0.22 + (0.62 * i) / (n - 1);
    out.push({ x: ship.x - f.x * L * t, y: ship.y - f.y * L * t });
  }
  return out;
}

export function centerOf(ship: Ship): Pt {
  const f = dir(ship.heading);
  const L = shipLength(ship.def.masts) / 2;
  return { x: ship.x - f.x * L, y: ship.y - f.y * L };
}

// ---------------------------------------------------------------- primitives

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;

export function dist(a: Pt, b: Pt): number {
  return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
}

export function distPointSeg(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let t = l2 === 0 ? 0 : dot(sub(p, a), ab) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

export function closestOnSeg(p: Pt, a: Pt, b: Pt): Pt {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let t = l2 === 0 ? 0 : dot(sub(p, a), ab) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  // Convex polygon, either winding.
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = cross(sub(b, a), sub(p, a));
    if (c !== 0) {
      const s = c > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

export function distPointPoly(p: Pt, poly: Pt[]): number {
  if (pointInPoly(p, poly)) return 0;
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) m = Math.min(m, distPointSeg(p, poly[i], poly[(i + 1) % poly.length]));
  return m;
}

export function closestOnPoly(p: Pt, poly: Pt[]): Pt {
  let best = poly[0];
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const c = closestOnSeg(p, poly[i], poly[(i + 1) % poly.length]);
    const d = dist(p, c);
    if (d < m) {
      m = d;
      best = c;
    }
  }
  return best;
}

function segsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (den === 0) return false;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function segIntersectsPoly(a: Pt, b: Pt, poly: Pt[]): boolean {
  if (pointInPoly(a, poly) || pointInPoly(b, poly)) return true;
  for (let i = 0; i < poly.length; i++) if (segsIntersect(a, b, poly[i], poly[(i + 1) % poly.length])) return true;
  return false;
}

export function segIntersectsCircle(a: Pt, b: Pt, c: Pt, r: number): boolean {
  return distPointSeg(c, a, b) < r;
}

export function distPolyPoly(a: Pt[], b: Pt[]): number {
  if (polysOverlap(a, b, 0)) return 0;
  let m = Infinity;
  for (const p of a) m = Math.min(m, distPointPoly(p, b));
  for (const p of b) m = Math.min(m, distPointPoly(p, a));
  return m;
}

/** SAT test; overlap must exceed `tol` to count. */
export function polysOverlap(a: Pt[], b: Pt[], tol = EPS): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      const axis = { x: -(p2.y - p1.y), y: p2.x - p1.x };
      const len = Math.sqrt(axis.x * axis.x + axis.y * axis.y);
      if (len === 0) continue;
      axis.x /= len;
      axis.y /= len;
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const p of a) {
        const d = dot(p, axis);
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const p of b) {
        const d = dot(p, axis);
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA - minB <= tol || maxB - minA <= tol) return false;
    }
  }
  return true;
}

export function polyCircleOverlap(poly: Pt[], c: Pt, r: number): boolean {
  return distPointPoly(c, poly) < r - EPS;
}

export function polyCircleDist(poly: Pt[], c: Pt, r: number): number {
  return Math.max(0, distPointPoly(c, poly) - r);
}

export function islandDist(p: Pt, isl: Island): number {
  return Math.max(0, dist(p, isl) - isl.r);
}

export function inBounds(poly: Pt[], w: number, h: number): boolean {
  for (const p of poly) if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) return false;
  return true;
}

export function qPose(p: Pose): Pose {
  return { x: q(p.x), y: q(p.y), heading: q(p.heading) };
}
