// Computer opponent. Stateless and deterministic: the same state always gives
// the same move, so bot-vs-bot games replay exactly.
import { has } from './abilities';
import { hitChance } from './combat';
import { barLen, dist, islandDist, shipLength } from './geometry';
import { dir, datan2, normDeg } from './dmath';
import { cargoFree, comeAboutPose, isDerelict, mastsLeft, resolveMove, MAX_TURN } from './movement';
import { pendingOptions, shipOptions } from './options';
import type { Bar, GameState, Move, Segment, Ship } from './types';

function cannonValue(ship: Ship, i: number): number {
  const c = ship.def.cannons[i];
  if (!c) return 0;
  // Lower rank is better; L range is worth a bit more.
  return 7 - Number(c[0]) + (c[1] === 'L' ? 0.6 : 0);
}

function chooseMastToLose(ship: Ship, mine: boolean): string {
  let best = -1;
  let bestV = mine ? Infinity : -Infinity;
  ship.masts.forEach((m, i) => {
    if (!m) return;
    const v = cannonValue(ship, i);
    if (mine ? v < bestV : v > bestV) {
      bestV = v;
      best = i;
    }
  });
  return `mast:${best}`;
}

function decidePending(st: GameState, me: number): Move {
  const p = st.pending!;
  const opts = pendingOptions(st);
  if (p.kind === 'mastLoss') {
    const ship = st.ships[p.ship];
    return { t: 'choose', by: me, option: chooseMastToLose(ship, ship.owner === me) };
  }
  if (p.kind === 'defenderBoard') {
    const d = st.ships[p.defender];
    const a = st.ships[p.attacker];
    const want = mastsLeft(d) >= mastsLeft(a) && (a.cargo.length > 0 || a.crew.some((c) => c.alive));
    return { t: 'choose', by: me, option: want ? 'board' : 'decline' };
  }
  // Spoils: treasure first, then the costliest crew.
  if (opts.includes('treasure')) return { t: 'choose', by: me, option: 'treasure' };
  const loser = st.ships[p.loser];
  const crew = opts
    .filter((o) => o.startsWith('crew:'))
    .map((o) => loser.crew.find((c) => c.id === Number(o.slice(5)))!)
    .sort((x, y) => y.def.points - x.def.points || x.id - y.id);
  return { t: 'choose', by: me, option: crew.length ? `crew:${crew[0].id}` : 'none' };
}

function coinGuess(st: GameState, me: number, id: number): number {
  return st.players[me].known.includes(id) ? st.coins[id].value : 2;
}

/** Where should this ship head? */
function goalFor(st: GameState, ship: Ship, me: number): { x: number; y: number; island: number | null; kind: string } | null {
  const home = st.islands[st.players[me].home];
  const full = cargoFree(st, ship) === 0;
  const carrying = ship.cargo.length > 0 || ship.towing !== null && st.ships[ship.towing].cargo.length > 0;
  if (isDerelict(ship) || full || (carrying && (ship.cargo.length >= 2 || !nearestTreasureIsland(st, ship)))) {
    return { x: home.x, y: home.y, island: home.id, kind: 'home' };
  }
  if (carrying) {
    // Pick up more only if an island is much closer than home.
    const isl = nearestTreasureIsland(st, ship);
    if (isl && dist(ship, isl) < dist(ship, home) * 0.5) return { x: isl.x, y: isl.y, island: isl.id, kind: 'island' };
    return { x: home.x, y: home.y, island: home.id, kind: 'home' };
  }
  // Hunt treasure-laden enemies that are close.
  const prey = st.ships
    .filter((t) => !t.sunk && t.owner !== me && t.cargo.length > 0 && !(t.docked !== null && st.islands[t.docked].home === t.owner))
    .sort((a, b) => dist(ship, a) - dist(ship, b) || a.id - b.id)[0];
  const isl = nearestTreasureIsland(st, ship);
  if (prey && ship.def.cannons.length && (!isl || dist(ship, prey) < dist(ship, isl) * 0.7)) {
    return { x: prey.x, y: prey.y, island: null, kind: 'hunt' };
  }
  if (isl) return { x: isl.x, y: isl.y, island: isl.id, kind: 'island' };
  // Nothing left on islands: chase any enemy ship.
  const any = st.ships.filter((t) => !t.sunk && t.owner !== me).sort((a, b) => dist(ship, a) - dist(ship, b) || a.id - b.id)[0];
  if (any && ship.def.cannons.length) return { x: any.x, y: any.y, island: null, kind: 'hunt' };
  return { x: home.x, y: home.y, island: home.id, kind: 'home' };
}

function nearestTreasureIsland(st: GameState, ship: Ship) {
  let best = null;
  let bd = Infinity;
  for (const isl of st.islands) {
    if (isl.home !== null || isl.coins.length === 0) continue;
    if (has(st, ship, 'cantLoadLast') && isl.coins.filter((id) => !st.coins[id].unique).length < 2 && !isl.coins.some((id) => st.coins[id].unique)) continue;
    // Spread out: avoid islands a friendly ship is already docked at.
    const crowd = st.ships.some((o) => o.id !== ship.id && !o.sunk && o.owner === ship.owner && o.docked === isl.id) ? 8 : 0;
    const d = dist(ship, isl) + crowd;
    if (d < bd) {
      bd = d;
      best = isl;
    }
  }
  return best;
}

function permutations(bars: Bar[]): Bar[][] {
  if (bars.length <= 1) return [bars];
  const out: Bar[][] = [];
  const seen = new Set<string>();
  bars.forEach((b, i) => {
    for (const rest of permutations([...bars.slice(0, i), ...bars.slice(i + 1)])) {
      const p = [b, ...rest];
      const k = p.join('');
      if (!seen.has(k)) {
        seen.add(k);
        out.push(p);
      }
    }
  });
  return out;
}

function clampTurn(from: number, want: number): number {
  const d = normDeg(want - from);
  if (d > MAX_TURN) return normDeg(from + MAX_TURN);
  if (d < -MAX_TURN) return normDeg(from - MAX_TURN);
  return normDeg(want);
}

/** Search a few ruler layouts and keep the one that ends best. */
export function planMove(st: GameState, ship: Ship, goal: { x: number; y: number; island: number | null; kind: string }, bars: Bar[]): { segs: Segment[]; score: number } | null {
  let best: { segs: Segment[]; score: number } | null = null;
  const startD = dist(ship, goal);
  const offsets = [0, 25, -25, 50, -50, 90, -90];
  const orders = permutations(bars).slice(0, 4);
  for (const order of orders) {
    const n = Math.min(order.length, 3);
    // Greedy layout per first-segment offset; later segments aim at the goal.
    for (const off1 of offsets) {
      for (const off2 of n > 1 ? [0, 30, -30] : [0]) {
        const segs: Segment[] = [];
        let pose = { x: ship.x, y: ship.y, heading: ship.heading };
        for (let i = 0; i < n; i++) {
          const want = datan2(goal.y - pose.y, goal.x - pose.x) + (i === 0 ? off1 : off2);
          const h = clampTurn(pose.heading, want);
          const remain = dist(pose, goal);
          const len = barLen(order[i]);
          const d = goal.kind === 'hunt' ? Math.min(len, Math.max(0.5, remain - 1.5)) : len;
          segs.push({ bar: order[i], heading: Math.round(h * 10) / 10, dist: Math.round(d * 100) / 100 });
          const f = dir(h);
          pose = { x: pose.x + f.x * d, y: pose.y + f.y * d, heading: h };
        }
        const res = resolveMove(st, ship, segs);
        if (!res.ok) continue;
        const fin = res.final;
        let score = startD - dist(fin, goal);
        if (goal.island !== null && res.dockedAt === goal.island) score += 100;
        else if (res.dockedAt !== null && st.islands[res.dockedAt].home === null && st.islands[res.dockedAt].coins.length && goal.kind !== 'home') score += 40;
        if (goal.island !== null) score -= islandDist(fin, st.islands[goal.island]) * 0.5;
        // Keep away from the table edge.
        const margin = Math.min(fin.x, fin.y, st.width - fin.x, st.height - fin.y);
        const margin0 = Math.min(ship.x, ship.y, st.width - ship.x, st.height - ship.y);
        if (margin < shipLength(ship.def.masts) && margin < margin0) score -= 2;
        if (!best || score > best.score + 1e-9) best = { segs, score };
      }
    }
  }
  return best;
}

function shotValue(st: GameState, me: number, o: ReturnType<typeof shipOptions>['fire'][number]): number {
  const t = o.target;
  const p = hitChance(o.need, o.bonus, o.long);
  let v = 1 + t.cargo.length * 2;
  if (isDerelict(t)) v = 6 + t.cargo.reduce((a, id) => a + coinGuess(st, me, id), 0) * 2;
  else if (mastsLeft(t) === 1) v += 3;
  return p * v;
}

function decideCurrent(st: GameState, me: number, ship: Ship): Move {
  const o = shipOptions(st, ship);
  if (o.explore && o.explore.free && o.explore.max > 0) {
    return { t: 'explore', by: me, ship: ship.id, take: pickCoins(st, me, o.explore.coins, o.explore.max) };
  }
  if (o.ram.length) {
    const t = st.ships[o.ram[0]];
    if (t.cargo.length > 0 || mastsLeft(ship) >= mastsLeft(t)) return { t: 'ram', by: me, ship: ship.id, target: t.id };
  }
  if (o.board !== null) {
    const t = st.ships[o.board];
    if (mastsLeft(ship) + 1 >= mastsLeft(t) && (t.cargo.length > 0 || t.crew.some((c) => c.alive))) return { t: 'board', by: me, ship: ship.id, target: t.id };
  }
  if (o.tow.length) {
    const t = st.ships[o.tow[0]];
    if (t.cargo.length > 0 || t.owner !== me) return { t: 'tow', by: me, ship: ship.id, target: t.id };
  }
  if (o.pickpocket.length) return { t: 'pickpocket', by: me, ship: ship.id, target: o.pickpocket[0] };
  if (o.plunder.length) return { t: 'plunder', by: me, ship: ship.id, target: o.plunder[0] };
  if (o.fire.length) {
    const best = [...o.fire].sort((a, b) => shotValue(st, me, b) - shotValue(st, me, a) || (a.cannon.id < b.cannon.id ? -1 : 1))[0];
    if (shotValue(st, me, best) > 0.15) return { t: 'fire', by: me, ship: ship.id, cannon: best.cannon.id, target: best.target.id, long: best.long || undefined };
  }
  return { t: 'endAction', by: me };
}

function pickCoins(st: GameState, me: number, coins: number[], max: number): number[] {
  // Exploring reveals the island's treasure, so the bot sees true values here.
  return [...coins].sort((a, b) => st.coins[b].value - st.coins[a].value || a - b).slice(0, Math.max(0, max));
}

function decideStart(st: GameState, me: number, ship: Ship): Move | null {
  const o = shipOptions(st, ship);
  if (!o.canStart) return null;
  if (o.repair && ship.docked !== null && st.islands[ship.docked].home === me) return { t: 'repair', by: me, ship: ship.id };
  if (o.explore && o.explore.max > 0 && ship.cargo.length < 3) return { t: 'explore', by: me, ship: ship.id, take: pickCoins(st, me, o.explore.coins, o.explore.max) };
  if (o.explore && st.islands[o.explore.island].coins.some((id) => st.coins[id].unique)) return { t: 'explore', by: me, ship: ship.id, take: [] };
  if (o.exploreShips.length && cargoFree(st, ship) > 0) {
    // Only salvage derelicts; shuffling gold between healthy friends wastes actions.
    const t = st.ships[o.exploreShips[0]];
    if (t.cargo.length && isDerelict(t)) return { t: 'exploreShip', by: me, ship: ship.id, target: t.id, take: t.cargo.slice(0, cargoFree(st, ship)) };
  }
  if (o.repair && isDerelict(ship)) return { t: 'repair', by: me, ship: ship.id };
  const captain = has(st, ship, 'moveShoot');
  const shots = o.fire.map((f) => shotValue(st, me, f));
  const bestShot = shots.length ? Math.max(...shots) : 0;
  const goal = goalFor(st, ship, me);
  // Shoot instead of moving when a good shot is lined up and we are not hauling gold.
  if (!captain && o.fire.length && ship.cargo.length === 0 && (bestShot >= 0.9 || (goal?.kind === 'hunt' && bestShot > 0.3))) {
    const i = shots.indexOf(bestShot);
    const f = o.fire[i];
    return { t: 'fire', by: me, ship: ship.id, cannon: f.cannon.id, target: f.target.id, long: f.long || undefined };
  }
  if (o.bars.length && goal) {
    const plan = planMove(st, ship, goal, o.bars);
    // Coming about is worth it when it points us at the goal and no plain move helps.
    let aboutScore = -Infinity;
    if (o.comeAbout) {
      const pose = comeAboutPose(st, ship);
      if (pose) {
        const ahead = dir(pose.heading);
        const toGoal = { x: goal.x - pose.x, y: goal.y - pose.y };
        const len = Math.sqrt(toGoal.x * toGoal.x + toGoal.y * toGoal.y) || 1;
        aboutScore = (ahead.x * toGoal.x + ahead.y * toGoal.y) / len; // cosine, at most 1
      }
    }
    if (plan && (plan.score > 0.3 || plan.score >= aboutScore)) return { t: 'move', by: me, ship: ship.id, segs: plan.segs };
    if (o.comeAbout && aboutScore > 0) return { t: 'comeAbout', by: me, ship: ship.id };
    if (plan) return { t: 'move', by: me, ship: ship.id, segs: plan.segs };
  }
  if (o.fire.length && bestShot > 0.1) {
    const i = shots.indexOf(bestShot);
    const f = o.fire[i];
    return { t: 'fire', by: me, ship: ship.id, cannon: f.cannon.id, target: f.target.id, long: f.long || undefined };
  }
  if (o.repair) return { t: 'repair', by: me, ship: ship.id };
  return null;
}

/** The bot's next move for player `me` (call only when it is their turn or choice). */
export function botMove(st: GameState, me: number): Move {
  if (st.pending) return decidePending(st, me);
  if (st.current) {
    const ship = st.ships[st.current.ship];
    return decideCurrent(st, me, ship);
  }
  for (const ship of st.ships) {
    if (ship.sunk || ship.owner !== me) continue;
    const m = decideStart(st, me, ship);
    if (m) return m;
  }
  return { t: 'endTurn', by: me };
}
