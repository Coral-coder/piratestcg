import { activeCrew, effectsOf, has, hasCaptain } from './abilities';
import {
  closestOnPoly,
  dist,
  distPointPoly,
  distPointSeg,
  hull,
  mastPoints,
  type Pt,
  S_LEN,
  L_LEN,
  segIntersectsCircle,
  segIntersectsPoly,
  distPolyPoly,
} from './geometry';
import { isDerelict } from './movement';
import type { GameState, Ship } from './types';

export interface Cannon {
  id: string;
  rank: number;
  bar: 'S' | 'L';
  /** Firing points (one mast, or every mast for a musket). */
  from: Pt[];
  musket: boolean;
}

export function parseCannon(s: string): { rank: number; bar: 'S' | 'L' } {
  return { rank: Number(s[0]), bar: s[1] === 'L' ? 'L' : 'S' };
}

/** Cannons the ship can fire right now. */
export function cannonsOf(state: GameState, ship: Ship): Cannon[] {
  const out: Cannon[] = [];
  if (ship.sunk) return out;
  const pts = mastPoints(ship);
  const fixed = has(state, ship, 'fixedCannons');
  const derelict = isDerelict(ship);
  const allL = has(state, ship, 'allLRange');
  if (!derelict) {
    ship.def.cannons.forEach((c, i) => {
      if (!ship.masts[i] && !fixed) return;
      const p = parseCannon(c);
      out.push({ id: `mast:${i}`, rank: p.rank, bar: allL ? 'L' : p.bar, from: [pts[i]], musket: false });
    });
  }
  // Musketeer: one 3S cannon per musketeer, from any mast, even a lost one.
  for (const c of activeCrew(ship)) {
    if (c.def.effects.some((e) => e.code === 'musket')) out.push({ id: `musket:${c.id}`, rank: 3, bar: 'S', from: pts, musket: true });
  }
  return out;
}

export function rangeOf(state: GameState, cannon: Cannon, target: Ship, long: boolean): number {
  let r = cannon.bar === 'L' ? L_LEN : S_LEN;
  if (long && !cannon.musket) r *= 2;
  if (has(state, target, 'shortenEnemyRange')) r = Math.min(r, S_LEN);
  return r;
}

/** Is the cannon reaching at L-range (for "L-range cannons cannot hit")? */
export function isLRange(state: GameState, cannon: Cannon, target: Ship, long: boolean): boolean {
  return rangeOf(state, cannon, target, long) > S_LEN;
}

export function isValidTarget(state: GameState, shooter: Ship, target: Ship): boolean {
  if (target.sunk || target.owner === shooter.owner) return false;
  // Ships docked at their own home island cannot be targeted.
  if (target.docked !== null && state.islands[target.docked].home === target.owner) return false;
  return true;
}

function lineClear(state: GameState, shooter: Ship, target: Ship, from: Pt, to: Pt, clearShot: boolean, mastIdx: number | null): boolean {
  for (const isl of state.islands) if (segIntersectsCircle(from, to, isl, isl.r * 0.92)) return false;
  if (!clearShot) {
    for (const o of state.ships) {
      if (o.sunk || o.id === shooter.id || o.id === target.id || o.id === target.towing || o.id === target.towedBy) continue;
      if (segIntersectsPoly(from, to, hull(o))) return false;
    }
  }
  // The firing ship's own standing masts block the line (no firing along the keel).
  if (mastIdx !== null) {
    const pts = mastPoints(shooter);
    for (let i = 0; i < pts.length; i++) {
      if (i === mastIdx || !shooter.masts[i]) continue;
      if (distPointSeg(pts[i], from, to) < 0.12 && dist(pts[i], from) > 0.05) return false;
    }
  }
  return true;
}

/** Points on the target to aim at: corners, edge midpoints and the nearest point. */
function aimPoints(target: Ship, from: Pt): Pt[] {
  const poly = hull(target);
  const pts: Pt[] = [closestOnPoly(from, poly), ...poly];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  pts.push(...mastPoints(target));
  return pts;
}

/** Firing point and aim point if the cannon can hit the target, else null. */
export function lineOfFire(state: GameState, shooter: Ship, cannon: Cannon, target: Ship, long = false): { from: Pt; to: Pt } | null {
  if (!isValidTarget(state, shooter, target)) return null;
  if (has(state, target, 'immuneL') && isLRange(state, cannon, target, long)) return null;
  const range = rangeOf(state, cannon, target, long);
  const clear = has(state, shooter, 'clearShot');
  const poly = hull(target);
  for (let fi = 0; fi < cannon.from.length; fi++) {
    const from = cannon.from[fi];
    if (distPointPoly(from, poly) > range) continue;
    const mastIdx = cannon.musket ? null : Number(cannon.id.split(':')[1]);
    for (const to of aimPoints(target, from)) {
      if (dist(from, to) > range + 1e-9) continue;
      if (lineClear(state, shooter, target, from, to, clear, mastIdx)) return { from, to };
    }
  }
  return null;
}

export function friendlyWithinS(state: GameState, ship: Ship): Ship[] {
  const h = hull(ship);
  return state.ships.filter((o) => !o.sunk && o.id !== ship.id && o.owner === ship.owner && distPolyPoly(h, hull(o)) <= S_LEN);
}

/** Bonus to a cannon roll. Musket cannons cannot be improved. */
export function cannonBonus(state: GameState, shooter: Ship, cannon: Cannon, target: Ship): number {
  if (cannon.musket) return 0;
  let b = 0;
  const fx = effectsOf(state, shooter);
  const tf = target.def.faction;
  for (const e of fx) {
    if (e.code === 'cannonBonusVs' && e.faction === tf) b += 1;
    if (e.code === 'cannonBonusVsNot' && e.faction !== tf) b += 1;
  }
  if (fx.some((e) => e.code === 'cannonBonusWithCaptain') && hasCaptain(shooter)) b += 1;
  if (fx.some((e) => e.code === 'cannonBonusPerFriendly')) b += friendlyWithinS(state, shooter).length;
  // Aura from a friendly ship within S.
  if (friendlyWithinS(state, shooter).some((o) => has(state, o, 'cannonAura'))) b += 1;
  for (const e of effectsOf(state, target)) if (e.code === 'weakVs' && e.faction === shooter.def.faction) b += 1;
  return b;
}

/** All (cannon, target) pairs the ship could fire at now, for UI and bot. */
export function firingOptions(state: GameState, ship: Ship, fired: string[] = []): { cannon: Cannon; target: Ship; long: boolean; need: number; bonus: number }[] {
  const out: { cannon: Cannon; target: Ship; long: boolean; need: number; bonus: number }[] = [];
  if (has(state, ship, 'noShootLoaded') && ship.cargo.length > 0) return out;
  const longOk = has(state, ship, 'longShot');
  for (const c of cannonsOf(state, ship)) {
    if (fired.includes(c.id)) continue;
    for (const t of state.ships) {
      if (lineOfFire(state, ship, c, t, false)) out.push({ cannon: c, target: t, long: false, need: c.rank, bonus: cannonBonus(state, ship, c, t) });
      else if (longOk && !c.musket && lineOfFire(state, ship, c, t, true)) out.push({ cannon: c, target: t, long: true, need: 6, bonus: 0 });
    }
  }
  return out;
}

/** Chance (0..1) a cannon roll hits: natural 1 always misses. */
export function hitChance(need: number, bonus: number, long: boolean): number {
  if (long) return 1 / 6;
  let n = 0;
  for (let r = 2; r <= 6; r++) if (r + bonus >= need) n++;
  return n / 6;
}
