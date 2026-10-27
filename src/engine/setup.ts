import { dir, q } from './dmath';
import type { Catalog } from './fleet';
import { hullAt, inBounds, polysOverlap, polyCircleOverlap, dist } from './geometry';
import { randInt, rollD6, seedRng, shuffle } from './rng';
import type { Coin, CrewDef, GameConfig, GameState, Island, Ship, ShipDef, TreasureDef } from './types';

export const ISLAND_NAMES = [
  'Gull Rock', 'Saltmarsh Key', 'Ember Cay', 'Driftwood Isle', 'Lantern Reef', 'Tortoise Key',
  'Widow’s Shoal', 'Coral Crown', 'Mango Cay', 'Skull Bight', 'Sunken Bell', 'Parrot’s Rest',
  'Brimstone Isle', 'Whistler Key', 'Mermaid Steps', 'Calico Cay',
];

/** Each player brings six treasures worth 12 gold in all (rulebook setup).
 * With a unique treasure (worth 0) the five coins still add up to 12. */
const COINS_PLAIN = [1, 1, 2, 2, 3, 3];
const COINS_WITH_UNIQUE = [1, 2, 2, 3, 4];

/** Wild islands needed: three treasures go on each. */
export function wildIslandCount(players: number): number {
  return (players * 6) / 3;
}

function layoutIslands(st: GameState, rng: GameState['rng']): Island[] {
  const W = st.width;
  const H = st.height;
  const names = shuffle(rng, [...ISLAND_NAMES]);
  const isl: Island[] = [];
  const rr = () => 1.9 + randInt(rng, 7) / 10;
  // Home islands near opposite short edges.
  const r0 = rr();
  const r1 = rr();
  isl.push({ id: 0, name: names[0], x: q(W / 2 + (randInt(rng, 13) - 6)), y: q(r0 + 4.5), r: r0, home: 0, coins: [], look: randInt(rng, 1000) });
  isl.push({ id: 1, name: names[1], x: q(W / 2 + (randInt(rng, 13) - 6)), y: q(H - r1 - 4.5), r: r1, home: 1, coins: [], look: randInt(rng, 1000) });
  const need = wildIslandCount(2);
  // Islands at least two L apart, edge to edge (rulebook: 2 L bars).
  const minGap = 12;
  const gap = (a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }) => dist(a, b) - a.r - b.r;
  let best: Island[] = [];
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < 30; attempt++) {
    const trial: Island[] = isl.slice(0, 2).map((x) => ({ ...x }));
    for (let tries = 0; trial.length < 2 + need && tries < 600; tries++) {
      const r = rr();
      const x = 3 + r + randInt(rng, Math.floor((W - 6 - 2 * r) * 10)) / 10;
      const y = 8 + randInt(rng, Math.floor((H - 16) * 10)) / 10;
      if (trial.every((o) => gap({ x, y, r }, o) >= minGap)) trial.push({ id: trial.length, name: names[trial.length], x: q(x), y: q(y), r, home: null, coins: [], look: randInt(rng, 1000) });
    }
    if (trial.length < 2 + need) continue;
    let m = Infinity;
    for (const a of trial) for (const b of trial) if (a.id < b.id) m = Math.min(m, gap(a, b));
    if (m > bestScore) {
      bestScore = m;
      best = trial;
    }
    if (attempt >= 3) break;
  }
  if (best.length) isl.splice(0, isl.length, ...best);
  // Fallback grid if the table is too small for random placement.
  const grid = [
    [0.22, 0.33], [0.78, 0.33], [0.22, 0.67], [0.78, 0.67], [0.5, 0.5], [0.5, 0.2],
  ];
  for (let g = 0; isl.length < 2 + need; g++) {
    const [fx, fy] = grid[g % grid.length];
    isl.push({ id: isl.length, name: names[isl.length], x: q(W * fx), y: q(H * fy), r: 2, home: null, coins: [], look: randInt(rng, 1000) });
  }
  return isl;
}

/** Put a ship docked at an island: bow touching, stern pointing out. */
export function findDockSpot(st: GameState, ship: Ship, islandId: number, prefer: number): { x: number; y: number; heading: number } | null {
  const isl = st.islands[islandId];
  for (let k = 0; k < 48; k++) {
    // Try angles fanning out from the preferred one: 0, +7.5, -7.5, +15 ...
    const off = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 7.5;
    const a = prefer + off;
    const d = dir(a);
    const pose = { x: q(isl.x + d.x * (isl.r + 0.04)), y: q(isl.y + d.y * (isl.r + 0.04)), heading: q(((a + 180 + 540) % 360) - 180) };
    const poly = hullAt(ship.def.masts, pose);
    if (!inBounds(poly, st.width, st.height)) continue;
    if (st.islands.some((o) => polyCircleOverlap(poly, o, o.r))) continue;
    if (st.ships.some((o) => !o.sunk && o.id !== ship.id && polysOverlap(poly, hullAt(o.def.masts, o)))) continue;
    return pose;
  }
  return null;
}

function newShip(st: GameState, def: ShipDef, owner: number, crew: CrewDef[]): Ship {
  return {
    id: st.ships.length,
    owner,
    originalOwner: owner,
    def,
    x: 0,
    y: 0,
    heading: 0,
    masts: new Array(def.masts).fill(true),
    crew: crew.map((c) => ({ id: st.nextId++, def: c, alive: true })),
    cargo: [],
    uniques: [],
    sunk: false,
    docked: null,
    pinnedTo: null,
    towing: null,
    towedBy: null,
    actionsUsed: 0,
    actionsAllowed: 1,
    lastActionKind: null,
    sameKindOnly: false,
    flags: { extraRolled: false, rerollUsed: false, hitCrewUsed: false, firstHitIgnored: false, pickpocketUsed: false, peekUsed: false, rumTurn: -10, once: [] },
  };
}

export interface SetupOptions {
  /** Unique treasure each player adds to the pool (at most one each). */
  uniques?: [TreasureDef | null, TreasureDef | null];
}

export function createGame(cfg: GameConfig, cat: Catalog, opts: SetupOptions = {}): GameState {
  const rng = seedRng(cfg.seed);
  const st: GameState = {
    version: 1,
    seed: cfg.seed,
    rng,
    width: cfg.width ?? 42,
    height: cfg.height ?? 60,
    points: cfg.points,
    maxRounds: cfg.maxRounds ?? 40,
    players: [0, 1].map((p) => ({ name: cfg.names?.[p] ?? `Player ${p + 1}`, home: p, bonusGold: 0, known: [], resigned: false })),
    islands: [],
    coins: [],
    ships: [],
    turn: 1,
    active: 0,
    current: null,
    pending: null,
    closing: null,
    startingGold: 0,
    winner: null,
    draw: false,
    over: false,
    endReason: '',
    log: [],
    nextId: 1000,
  };
  st.islands = layoutIslands(st, st.rng);

  // Treasure: each player's contribution, shuffled face down, three per wild island.
  const coins: Coin[] = [];
  for (let p = 0; p < 2; p++) {
    const u = opts.uniques?.[p] ?? null;
    const values = u ? COINS_WITH_UNIQUE : COINS_PLAIN;
    for (const v of values) coins.push({ id: coins.length, value: v });
    if (u) coins.push({ id: coins.length, value: 0, unique: u });
  }
  st.coins = coins;
  st.startingGold = coins.reduce((a, c) => a + c.value, 0);
  const order = shuffle(st.rng, coins.map((c) => c.id));
  const wild = st.islands.filter((i) => i.home === null);
  order.forEach((id, i) => wild[Math.floor(i / 3) % wild.length].coins.push(id));

  // Fleets: bows touching the home island, facing it.
  for (let p = 0; p < 2; p++) {
    const home = st.islands[p];
    const toward = p === 0 ? 90 : -90; // towards the table centre
    const entries = cfg.fleets[p].ships;
    entries.forEach((e, i) => {
      const def = cat.byId.get(e.ship);
      if (!def || def.kind !== 'ship') return;
      const crew = e.crew.map((id) => cat.byId.get(id)).filter((c): c is CrewDef => !!c && c.kind === 'crew');
      const ship = newShip(st, def, p, crew);
      const spread = (i - (entries.length - 1) / 2) * 42;
      const pose = findDockSpot(st, ship, home.id, toward + spread);
      if (!pose) return;
      ship.x = pose.x;
      ship.y = pose.y;
      ship.heading = pose.heading;
      ship.docked = home.id;
      st.ships.push(ship);
    });
  }
  // Each player rolls a d6, rerolling ties; the higher roll goes first.
  let a = 0;
  let b = 0;
  while (a === b) {
    a = rollD6(st.rng);
    b = rollD6(st.rng);
  }
  st.active = a > b ? 0 : 1;
  st.log.push({ turn: 1, player: st.active, text: `Rolls ${a} vs ${b}: first move to ${st.players[st.active].name}.` });
  return st;
}
