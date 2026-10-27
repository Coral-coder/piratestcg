import { BUILTIN_CARDS } from '../src/data';
import {
  applyMove,
  createGame,
  dockedIsland,
  makeCatalog,
  rollD6,
  seedRng,
  type CardDef,
  type Effect,
  type GameState,
  type Move,
  type ShipDef,
  type CrewDef,
  type TreasureDef,
} from '../src/engine';

let n = 0;
export function testShip(masts: number, opts: { cannons?: string[]; move?: string; cargo?: number; effects?: Effect[]; faction?: string; points?: number; name?: string } = {}): ShipDef {
  return {
    id: `T-${++n}`,
    kind: 'ship',
    pack: 'test',
    name: opts.name ?? `Test ship ${n}`,
    faction: opts.faction ?? 'Pirate',
    points: opts.points ?? 10,
    masts,
    cargo: opts.cargo ?? 4,
    move: (opts.move ?? 'L').split('') as ShipDef['move'],
    cannons: opts.cannons ?? new Array(masts).fill('3S'),
    effects: opts.effects ?? [],
  };
}

export function testCrew(effects: Effect[], opts: { faction?: string; points?: number; name?: string; links?: string[] } = {}): CrewDef {
  return { id: `TC-${++n}`, kind: 'crew', pack: 'test', name: opts.name ?? `Crew ${n}`, faction: opts.faction ?? 'Pirate', points: opts.points ?? 2, effects, ...(opts.links ? { links: opts.links } : {}) };
}

export function testTreasure(effects: Effect[], name = 'Trinket'): TreasureDef {
  return { id: `TT-${++n}`, kind: 'treasure', pack: 'test', name, points: 0, effects };
}

export type Side = { ship: ShipDef; crew?: CrewDef[] }[];

/** A game with the given fleets, player 0 to act, islands moved to known spots. */
export function game(a: Side, b: Side, opts: { seed?: number; uniques?: [TreasureDef | null, TreasureDef | null] } = {}): GameState {
  const extra: CardDef[] = [...a, ...b].flatMap((e) => [e.ship, ...(e.crew ?? [])]);
  const cat = makeCatalog([...BUILTIN_CARDS, ...extra]);
  const fleet = (s: Side) => ({ name: 't', ships: s.map((e) => ({ ship: e.ship.id, crew: (e.crew ?? []).map((c) => c.id) })) });
  const st = createGame({ seed: opts.seed ?? 1, fleets: [fleet(a), fleet(b)], points: 100 }, cat, { uniques: opts.uniques });
  st.active = 0;
  return st;
}

/** Move every island out of the way: homes at the short edges, wild islands in the corners. */
export function openSea(st: GameState): GameState {
  const spots = [
    [21, 2.5],
    [21, 57.5],
    [3, 3],
    [39, 3],
    [3, 57],
    [39, 57],
  ];
  st.islands.forEach((isl, i) => {
    isl.x = spots[i][0];
    isl.y = spots[i][1];
    isl.r = 1.5;
  });
  for (const s of st.ships) {
    s.docked = null;
    s.x = 1000; // parked until placed
  }
  return st;
}

export function place(st: GameState, id: number, x: number, y: number, heading: number): void {
  const s = st.ships[id];
  s.x = x;
  s.y = y;
  s.heading = heading;
  s.docked = dockedIsland(st, s, s);
}

/** Park unplaced ships far away by sinking them quietly (keeps tests focused). */
export function hideUnplaced(st: GameState): void {
  for (const s of st.ships) if (s.x === 1000) s.sunk = true;
}

/** Set the RNG so the next d6 rolls come out as given. */
export function forceRolls(st: GameState, rolls: number[]): void {
  for (let seed = 0; seed < 5_000_000; seed++) {
    const r = seedRng(seed);
    let ok = true;
    for (const want of rolls) {
      if (rollD6(r) !== want) {
        ok = false;
        break;
      }
    }
    if (ok) {
      st.rng = seedRng(seed);
      return;
    }
  }
  throw new Error('no seed found');
}

export function play(st: GameState, ...moves: Move[]): GameState {
  let s = st;
  for (const m of moves) {
    const r = applyMove(s, m);
    if (!r.ok) throw new Error(`${JSON.stringify(m)}: ${r.error}`);
    s = r.state;
  }
  return s;
}

export function tryMove(st: GameState, m: Move) {
  return applyMove(st, m);
}
