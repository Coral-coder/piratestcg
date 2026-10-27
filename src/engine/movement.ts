import { has, hasCaptain } from './abilities';
import { dir, normDeg, q } from './dmath';
import {
  barLen,
  dist,
  hullAt,
  inBounds,
  islandDist,
  polyCircleOverlap,
  polysOverlap,
  hull,
  sternAt,
  type Pose,
  TOUCH,
  distPolyPoly,
  distPointPoly,
} from './geometry';
import type { Bar, GameState, Segment, Ship } from './types';

/** Most a ship may turn at the start of each ruler segment (our reading:
 * the ruler is laid off the bow, forward of the beam). */
export const MAX_TURN = 90;
const STEP = 0.1;
/** Radius of the bow point for contact tests (must be below TOUCH). */
const BOW_R = 0.08;
const SHIP_OVERLAP = 0.1;

export const isDerelict = (s: Ship) => !s.sunk && s.masts.every((m) => !m);
export const mastsLeft = (s: Ship) => s.masts.filter(Boolean).length;

export function cargoUsed(state: GameState, ship: Ship): number {
  let n = ship.cargo.length;
  for (const c of ship.crew) if (c.alive && !c.def.effects.some((e) => e.code === 'noCargoSpace')) n++;
  return n;
}

export function cargoCapacity(state: GameState, ship: Ship): number {
  let cap = ship.def.cargo;
  if (has(state, ship, 'cargoPlus')) cap += 1;
  // Linked crew on the same ship give +1 cargo space (rulebook "Link").
  const alive = ship.crew.filter((c) => c.alive);
  let linked = false;
  for (const a of alive)
    for (const b of alive)
      if (a !== b && a.def.links?.includes(b.def.name)) linked = true;
  if (linked) cap += 1;
  return cap;
}

export const cargoFree = (state: GameState, ship: Ship) => Math.max(0, cargoCapacity(state, ship) - cargoUsed(state, ship));

/** The ruler segments this ship may use this move, e.g. ['L'] or ['S','L']. */
export function availableBars(state: GameState, ship: Ship): Bar[] {
  if (ship.sunk || ship.towedBy !== null) return [];
  if (isDerelict(ship)) return has(state, ship, 'derelictMoveS') ? ['S'] : [];
  if (ship.towing !== null) return ['S'];
  if (has(state, ship, 'slowWhenLoaded') && cargoFree(state, ship) === 0 && ship.cargo.length > 0) return ['S'];
  const bars: Bar[] = [...ship.def.move];
  if (has(state, ship, 'plusS')) bars.push('S');
  if (has(state, ship, 'plusSWhenEmpty') && ship.cargo.length === 0) bars.push('S');
  if (has(state, ship, 'plusLWhenFull') && ship.masts.every(Boolean)) bars.push('L');
  if (hasCaptain(ship) && has(state, ship, 'plusSWithCaptain')) bars.push('S');
  if (hasCaptain(ship) && has(state, ship, 'plusLWithCaptain')) bars.push('L');
  return bars;
}

export function isPinned(state: GameState, ship: Ship): boolean {
  if (ship.pinnedTo === null) return false;
  const other = state.ships[ship.pinnedTo];
  if (!other || other.sunk || isDerelict(other)) return false;
  return distPolyPoly(hull(ship), hull(other)) <= TOUCH;
}

export type Contact = { kind: 'ship' | 'island' | 'edge'; id: number };

export interface MoveResult {
  ok: boolean;
  error?: string;
  path: Pose[];
  final: Pose;
  dockedAt: number | null;
  contact: Contact | null;
}

function blocked(state: GameState, ship: Ship, pose: Pose, ignore: number[], ignoreIsland: number | null = null): Contact | null {
  const poly = hullAt(ship.def.masts, pose);
  if (!inBounds(poly, state.width, state.height)) return { kind: 'edge', id: -1 };
  for (const isl of state.islands) if (isl.id !== ignoreIsland && polyCircleOverlap(poly, isl, isl.r)) return { kind: 'island', id: isl.id };
  for (const o of state.ships) {
    if (o.sunk || o.id === ship.id || ignore.includes(o.id)) continue;
    // Hulls may graze (as models do on the table) but not overlap.
    if (polysOverlap(poly, hull(o), SHIP_OVERLAP)) return { kind: 'ship', id: o.id };
  }
  return null;
}

/** May this ship dock at this island? Not at an enemy home, unless raiding. */
export function canDockAt(state: GameState, ship: Ship, islandId: number): boolean {
  const isl = state.islands[islandId];
  if (isl.home === null || isl.home === ship.owner) return true;
  return has(state, ship, 'raidHome');
}

export function dockedIsland(state: GameState, ship: Ship, pose: Pose): number | null {
  let best: number | null = null;
  let bd = Infinity;
  for (const isl of state.islands) {
    const d = islandDist(pose, isl);
    if (d <= TOUCH && d < bd && canDockAt(state, ship, isl.id)) {
      best = isl.id;
      bd = d;
    }
  }
  return best;
}

function barsSubset(want: Bar[], have: Bar[]): boolean {
  const pool = [...have];
  for (const b of want) {
    const i = pool.indexOf(b);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

/** First thing the bow point runs into at this pose, if any. */
function bowContact(state: GameState, ship: Ship, p: Pose, ignore: number[], skipIsland: number | null): Contact | null {
  if (p.x < 0 || p.y < 0 || p.x > state.width || p.y > state.height) return { kind: 'edge', id: -1 };
  for (const isl of state.islands) if (isl.id !== skipIsland && dist(p, isl) < isl.r + BOW_R) return { kind: 'island', id: isl.id };
  for (const o of state.ships) {
    if (o.sunk || o.id === ship.id || ignore.includes(o.id)) continue;
    if (distPointPoly(p, hull(o)) < BOW_R) return { kind: 'ship', id: o.id };
  }
  return null;
}

/**
 * Work out where a move takes a ship. Pure: does not touch the state.
 * As on the tabletop, the ruler laid from the bow may not cross an island or
 * a ship, and the ship's final position may not overlap anything. The bow
 * stops at the first island or ship it reaches, which ends the move (that is
 * how docking and ramming contact happen).
 */
export function resolveMove(state: GameState, ship: Ship, segs: Segment[], skipBarCheck = false): MoveResult {
  const start: Pose = { x: ship.x, y: ship.y, heading: ship.heading };
  const fail = (error: string): MoveResult => ({ ok: false, error, path: [start], final: start, dockedAt: ship.docked, contact: null });
  if (segs.length === 0) return fail('No ruler segments.');
  if (!skipBarCheck && !barsSubset(segs.map((s) => s.bar), availableBars(state, ship))) return fail('Those ruler lengths are not available.');
  if (isPinned(state, ship)) return fail('Pinned: cannot move until the enemy moves away.');
  const ignore = ship.towing !== null ? [ship.towing] : [];
  // Ships touching at the start (e.g. a rammed ship) do not stop the bow from backing off them.
  const startTouch = state.ships.filter((o) => !o.sunk && o.id !== ship.id && distPointPoly(start, hull(o)) < BOW_R).map((o) => o.id);
  let pose = start;
  const path: Pose[] = [start];
  let contact: Contact | null = null;
  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si];
    if (!(seg.dist > 0) || seg.dist > barLen(seg.bar) + 1e-9) return fail('Segment longer than its ruler.');
    const turn = Math.abs(normDeg(seg.heading - pose.heading));
    // Leaving a dock, the first ruler may point any way off the island.
    const leavingDock = si === 0 && ship.docked !== null;
    if (turn > MAX_TURN + 1e-9 && !leavingDock) return fail(`Turn of ${Math.round(turn)}° is more than ${MAX_TURN}°.`);
    const h = normDeg(seg.heading);
    const f = dir(h);
    const at = (t: number): Pose => ({ x: pose.x + f.x * t, y: pose.y + f.y * t, heading: h });
    // Islands and ships the bow starts against do not block it while it moves away.
    let skipIsland: number | null = null;
    for (const isl of state.islands) if (dist(pose, isl) < isl.r + BOW_R) skipIsland = isl.id;
    if (skipIsland !== null) {
      const isl = state.islands[skipIsland];
      if ((pose.x - isl.x) * f.x + (pose.y - isl.y) * f.y <= 0) return si === 0 ? fail('That heading runs into the island.') : finish(path, state, ship, contact);
    }
    const skipShips = si === 0 ? [...ignore, ...startTouch] : ignore;
    let lo = 0;
    let hit: Contact | null = null;
    const n = Math.max(1, Math.ceil(seg.dist / STEP));
    for (let i = 1; i <= n; i++) {
      const t = (seg.dist * i) / n;
      const c = bowContact(state, ship, at(t), skipShips, skipIsland);
      if (c) {
        hit = c;
        let a = lo;
        let b = t;
        for (let k = 0; k < 12; k++) {
          const m = (a + b) / 2;
          if (bowContact(state, ship, at(m), skipShips, skipIsland)) b = m;
          else a = m;
        }
        lo = a;
        break;
      }
      lo = t;
    }
    // The hull must fit where it ends; slide back along the ruler until it does.
    let end = lo;
    while (end > 1e-6 && blocked(state, ship, at(end), ignore)) {
      end = Math.max(0, end - 0.05);
      hit = null;
    }
    if (end <= 1e-6) {
      if (si === 0) return fail('Blocked: no room to move that way.');
      break;
    }
    pose = { x: q(at(end).x), y: q(at(end).y), heading: q(h) };
    path.push(pose);
    if (hit) {
      contact = hit;
      break;
    }
    const d = dockedIsland(state, ship, pose);
    if (d !== null && d !== ship.docked) break;
  }
  return finish(path, state, ship, contact);
}

function finish(path: Pose[], state: GameState, ship: Ship, contact: Contact | null): MoveResult {
  const final = path[path.length - 1];
  return { ok: true, path, final, dockedAt: dockedIsland(state, ship, final), contact };
}

/** Come about: turn in place so the bow ends where the stern was. */
export function comeAboutPose(state: GameState, ship: Ship): Pose | null {
  const st = sternAt(ship.def.masts, ship);
  const pose = { x: q(st.x), y: q(st.y), heading: q(normDeg(ship.heading + 180)) };
  if (blocked(state, ship, pose, ship.towing !== null ? [ship.towing] : [])) return null;
  return pose;
}

/** Place a towed ship with its bow against the tower's stern. */
export function towPose(tower: Ship): Pose {
  const st = sternAt(tower.def.masts, tower);
  const f = dir(tower.heading);
  return { x: q(st.x - f.x * 0.05), y: q(st.y - f.y * 0.05), heading: tower.heading };
}

export function towBlocked(state: GameState, towed: Ship, pose: Pose, tower: Ship): boolean {
  return blocked(state, towed, pose, [tower.id]) !== null;
}

export function shipsTouching(a: Ship, b: Ship): boolean {
  return distPolyPoly(hull(a), hull(b)) <= TOUCH;
}

/** Bow of `a` touches some part of `b`. */
export function bowTouches(a: Ship, b: Ship): boolean {
  const poly = hull(b);
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    // distance from a's bow point to edge
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((a.x - p1.x) * dx + (a.y - p1.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    m = Math.min(m, dist(a, { x: p1.x + dx * t, y: p1.y + dy * t }));
  }
  return m <= TOUCH * 1.5;
}
