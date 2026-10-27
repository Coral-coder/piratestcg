// What a ship can do right now, for the UI ("show what's legal") and the bot.
import { has } from './abilities';
import { firingOptions } from './combat';
import { distPointPoly, hull, TOUCH } from './geometry';
import { availableBars, bowTouches, cargoFree, comeAboutPose, isDerelict, isPinned, shipsTouching } from './movement';
import { spoilsOptions } from './rules';
import type { Bar, GameState, Ship } from './types';

export interface ShipOptions {
  canStart: boolean;
  acting: boolean;
  bars: Bar[];
  pinned: boolean;
  comeAbout: boolean;
  fire: ReturnType<typeof firingOptions>;
  explore: { island: number; coins: number[]; max: number; free: boolean } | null;
  exploreShips: number[];
  repair: boolean;
  ram: number[];
  board: number | null;
  tow: number[];
  pickpocket: number[];
  plunder: number[];
}

export function shipOptions(st: GameState, ship: Ship): ShipOptions {
  const empty: ShipOptions = { canStart: false, acting: false, bars: [], pinned: false, comeAbout: false, fire: [], explore: null, exploreShips: [], repair: false, ram: [], board: null, tow: [], pickpocket: [], plunder: [] };
  if (st.over || st.pending || ship.sunk || ship.owner !== st.active) return empty;
  const cur = st.current && st.current.ship === ship.id ? st.current : null;
  const left = ship.actionsUsed < ship.actionsAllowed && (ship.towedBy === null);
  const sameOk = (k: string) => !ship.sameKindOnly || ship.actionsUsed === 0 || ship.lastActionKind === k;
  const canStart = !cur && left;
  const o: ShipOptions = { ...empty, canStart, acting: !!cur };
  o.pinned = isPinned(st, ship);
  if (canStart && sameOk('move') && !o.pinned) o.bars = availableBars(st, ship);
  o.comeAbout = canStart && sameOk('comeAbout') && !o.pinned && availableBars(st, ship).length > 0 && comeAboutPose(st, ship) !== null;
  const shootNow = cur ? cur.kind === 'shoot' || (cur.kind === 'move' && cur.canShoot) : canStart && sameOk('shoot');
  if (shootNow) o.fire = firingOptions(st, ship, cur?.fired ?? []);
  if (ship.docked !== null) {
    const isl = st.islands[ship.docked];
    const raid = isl.home !== null && isl.home !== ship.owner && has(st, ship, 'raidHome');
    const free = !!cur && cur.kind === 'move' && cur.canExplore;
    if ((isl.home === null || raid) && (free || (canStart && sameOk('explore')))) {
      const plain = isl.coins.filter((id) => !st.coins[id].unique);
      let max = Math.min(cargoFree(st, ship), raid ? 1 : 99, plain.length);
      if (has(st, ship, 'cantLoadLast')) max = Math.min(max, plain.length - 1);
      if (isl.coins.length) o.explore = { island: isl.id, coins: plain, max: Math.max(0, max), free };
    }
  }
  if (canStart && sameOk('explore')) {
    o.exploreShips = st.ships
      .filter((t) => !t.sunk && t.id !== ship.id && (t.owner === ship.owner || isDerelict(t)) && t.cargo.length + 0 >= 0 && shipsTouching(ship, t))
      .filter((t) => t.cargo.length > 0 || (has(st, ship, 'salvager') && isDerelict(t)))
      .map((t) => t.id);
  }
  if (canStart && sameOk('repair') && ship.masts.some((m) => !m)) {
    const home = ship.docked !== null && st.islands[ship.docked].home === ship.owner;
    o.repair = home || has(st, ship, 'shipwright');
  }
  if (ship.towedBy !== null && !cur && ship.actionsUsed < ship.actionsAllowed && ship.masts.some((m) => !m)) {
    o.repair = (ship.docked !== null && st.islands[ship.docked].home === ship.owner) || has(st, ship, 'shipwright');
  }
  if (cur && cur.kind === 'move' && !isDerelict(ship)) {
    if (cur.rammed === null) o.ram = st.ships.filter((t) => !t.sunk && t.owner !== ship.owner && bowTouches(ship, t)).map((t) => t.id);
    if (cur.rammed !== null && !cur.boarded && !st.ships[cur.rammed].sunk) o.board = cur.rammed;
    if (!cur.towed && ship.towing === null)
      o.tow = st.ships.filter((t) => !t.sunk && t.id !== ship.id && isDerelict(t) && t.towedBy === null && distPointPoly(t, hull(ship)) <= TOUCH * 1.5).map((t) => t.id);
  }
  const touchingEnemies = st.ships.filter((t) => !t.sunk && t.owner !== ship.owner && t.cargo.length && shipsTouching(ship, t));
  if (has(st, ship, 'pickpocket') && !ship.flags.pickpocketUsed && cargoFree(st, ship) > 0) o.pickpocket = touchingEnemies.map((t) => t.id);
  if (cargoFree(st, ship) > 0 && !ship.flags.once.includes('plunder'))
    o.plunder = touchingEnemies.filter((t) => ship.def.effects.some((e) => e.code === 'plunder' && e.faction === t.def.faction)).map((t) => t.id);
  return o;
}

export function pendingOptions(st: GameState): string[] {
  const p = st.pending;
  if (!p) return [];
  if (p.kind === 'mastLoss') return st.ships[p.ship].masts.map((m, i) => (m ? `mast:${i}` : '')).filter(Boolean);
  if (p.kind === 'defenderBoard') return ['board', 'decline'];
  return spoilsOptions(st, st.ships[p.winner], st.ships[p.loser]);
}
