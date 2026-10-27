// The rules reducer: applyMove(state, move) -> new state + events.
// Pure: the input state is never modified; all randomness comes from st.rng.
// Rule references point at docs/rules.md sections (R1, R2...).

import { effectsOf, has } from './abilities';
import { cannonsOf, lineOfFire, cannonBonus, type Cannon } from './combat';
import { distPointPoly, hull, islandDist, S_LEN, TOUCH } from './geometry';
import {
  availableBars,
  bowTouches,
  cargoFree,
  comeAboutPose,
  dockedIsland,
  isDerelict,
  isPinned,
  mastsLeft,
  resolveMove,
  shipsTouching,
  towBlocked,
  towPose,
} from './movement';
import { randInt, rollD6 } from './rng';
import { findDockSpot } from './setup';
import type { ActionKind, GameEvent, GameState, Move, Ship } from './types';

export class RuleError extends Error {}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  state: GameState;
  events: GameEvent[];
}

interface Ctx {
  st: GameState;
  ev: GameEvent[];
}

function fail(msg: string): never {
  throw new RuleError(msg);
}

function log(c: Ctx, text: string, player = c.st.active) {
  c.st.log.push({ turn: c.st.turn, player, text });
  if (c.st.log.length > 400) c.st.log.splice(0, c.st.log.length - 400);
}

export function score(st: GameState, p: number): number {
  const home = st.islands[st.players[p].home];
  return home.coins.reduce((a, id) => a + (st.coins[id].gone ? 0 : st.coins[id].value), 0) + st.players[p].bonusGold;
}

function shipOf(c: Ctx, id: number): Ship {
  const s = c.st.ships[id];
  if (!s) fail('No such ship.');
  return s;
}

function ownShip(c: Ctx, id: number, by: number): Ship {
  const s = shipOf(c, id);
  if (s.owner !== by) fail('That is not your ship.');
  if (s.sunk) fail('That ship has sunk.');
  return s;
}

// ------------------------------------------------------------------ win/end

function finish(c: Ctx, winner: number | null, reason: string) {
  const st = c.st;
  if (st.over) return;
  st.over = true;
  st.winner = winner;
  st.draw = winner === null;
  st.endReason = reason;
  st.current = null;
  st.pending = null;
  st.closing = null;
  c.ev.push({ e: 'gameOver', winner, reason });
  log(c, winner === null ? `Draw: ${reason}` : `${st.players[winner].name} wins: ${reason}`);
}

function endOnGold(c: Ctx, reason: string) {
  const a = score(c.st, 0);
  const b = score(c.st, 1);
  finish(c, a === b ? null : a > b ? 0 : 1, `${reason} (${a}–${b} gold)`);
}

/** R9: more than half the starting gold at home wins at once. */
function checkWin(c: Ctx) {
  const st = c.st;
  for (let p = 0; p < 2; p++) {
    if (score(st, p) * 2 > st.startingGold) {
      finish(c, p, `${score(st, p)} of ${st.startingGold} gold is home.`);
      return;
    }
  }
}

function playerCanAct(st: GameState, p: number): boolean {
  return st.ships.some((s) => {
    if (s.sunk || s.owner !== p) return false;
    if (!isDerelict(s)) return true;
    if (has(st, s, 'derelictMoveS')) return true;
    const home = s.docked !== null && st.islands[s.docked].home === p;
    return home || has(st, s, 'shipwright');
  });
}

function checkEnd(c: Ctx) {
  const st = c.st;
  if (st.over) return;
  checkWin(c);
  if (st.over) return;
  // R9: all treasure is home or gone.
  const inPlay = st.coins.some((coin) => {
    if (coin.gone || coin.value <= 0) return false;
    return !st.islands.some((i) => i.home !== null && i.coins.includes(coin.id));
  });
  if (!inPlay) {
    endOnGold(c, 'All treasure has been claimed');
    return;
  }
  if (!playerCanAct(st, 0) && !playerCanAct(st, 1)) {
    endOnGold(c, 'No ship on either side can sail');
    return;
  }
  // A player with no ships afloat can never score again; once the other side
  // already leads, the game is decided.
  for (let p = 0; p < 2; p++) {
    const afloat = st.ships.some((s) => !s.sunk && s.owner === p);
    if (!afloat && score(st, 1 - p) > score(st, p)) {
      finish(c, 1 - p, `${st.players[p].name} has no ships left.`);
      return;
    }
  }
}

// ------------------------------------------------------------------ actions

function newCurrent(ship: Ship, kind: ActionKind) {
  return { ship: ship.id, kind, fired: [], canShoot: false, canExplore: false, rammed: null, boarded: false, towed: false, armorHits: [] as [number, number][] };
}

/** R3: each ship may take one action per turn. */
function beginAction(c: Ctx, ship: Ship, kind: ActionKind) {
  const st = c.st;
  if (st.current && st.current.ship === ship.id) fail('This ship is already taking an action; end it first.');
  if (st.current) closeCurrent(c, true);
  if (ship.towedBy !== null && kind !== 'repair') fail('A ship under tow cannot act.');
  if (ship.actionsUsed >= ship.actionsAllowed) fail(`${ship.def.name} has already acted this turn.`);
  if (ship.sameKindOnly && ship.actionsUsed > 0 && kind !== ship.lastActionKind) fail('Her extra action must repeat the same action.');
  ship.actionsUsed++;
  ship.lastActionKind = kind;
  st.current = newCurrent(ship, kind);
}

function defenderMayBoard(c: Ctx): Ship | null {
  const cur = c.st.current;
  if (!cur || cur.rammed === null || cur.boarded) return null;
  const att = c.st.ships[cur.ship];
  const def = c.st.ships[cur.rammed];
  if (att.sunk || def.sunk || isDerelict(def)) return null;
  if (!shipsTouching(att, def)) return null;
  return def;
}

function rollExtra(c: Ctx, ship: Ship) {
  if (ship.sunk || ship.flags.extraRolled) return;
  const ea = has(c.st, ship, 'extraAction');
  const da = has(c.st, ship, 'doubleAction');
  if (!ea && !da) return;
  if (ship.actionsUsed < ship.actionsAllowed) return;
  ship.flags.extraRolled = true;
  const roll = rollD6(c.st.rng);
  const granted = roll >= 5;
  if (granted) {
    ship.actionsAllowed++;
    ship.sameKindOnly = da && !ea;
  }
  c.ev.push({ e: 'extraAction', ship: ship.id, roll, granted });
  log(c, `${ship.def.name} rolls ${roll} for an extra action${granted ? ': granted!' : '.'}`);
}

/** Close the current action. Returns false if it now waits on a choice. */
function closeCurrent(c: Ctx, strict: boolean, then: 'action' | 'turn' = 'action'): boolean {
  const st = c.st;
  const cur = st.current;
  if (!cur) return true;
  const def = defenderMayBoard(c);
  if (def) {
    if (strict) fail('End this ship’s action first: the rammed ship may board.');
    cur.boarded = true;
    st.pending = { kind: 'defenderBoard', player: def.owner, defender: def.id, attacker: cur.ship };
    st.closing = then;
    return false;
  }
  rollExtra(c, st.ships[cur.ship]);
  st.current = null;
  return true;
}

function passTurn(c: Ctx) {
  const st = c.st;
  st.current = null;
  st.closing = null;
  st.active = 1 - st.active;
  st.turn++;
  for (const s of st.ships) {
    s.flags.firstHitIgnored = false;
    if (s.owner !== st.active) continue;
    s.actionsUsed = 0;
    s.actionsAllowed = 1;
    s.sameKindOnly = false;
    s.lastActionKind = null;
    s.flags.extraRolled = false;
    s.flags.rerollUsed = false;
    s.flags.hitCrewUsed = false;
    s.flags.pickpocketUsed = false;
    s.flags.peekUsed = false;
    s.flags.once = [];
    // Rum: the ship may not act on the turn after loading it.
    if (s.flags.rumTurn === st.turn - 2) s.actionsAllowed = 0;
  }
  c.ev.push({ e: 'turn', player: st.active, turn: st.turn });
  if (st.turn > st.maxRounds * 2) endOnGold(c, `Turn limit of ${st.maxRounds} rounds reached`);
}

// ------------------------------------------------------------------ treasure

/** R7: treasure is unloaded (free) when docking at your home island. */
function unload(c: Ctx, ship: Ship) {
  const st = c.st;
  const home = st.islands[st.players[ship.owner].home];
  const coins = [...ship.cargo, ...ship.uniques.filter((id) => st.coins[id].value > 0)].filter((id) => !st.coins[id].gone);
  if (coins.length === 0) return;
  let gold = 0;
  for (const id of coins) {
    home.coins.push(id);
    gold += st.coins[id].value;
    c.ev.push({ e: 'treasureMoved', from: `ship:${ship.id}`, to: `island:${home.id}`, coin: id });
  }
  ship.cargo = [];
  ship.uniques = ship.uniques.filter((id) => !coins.includes(id));
  let bonus = 0;
  for (const e of effectsOf(st, ship)) if (e.code === 'treasureBonus') bonus = Math.max(bonus, e.n ?? 1);
  if (bonus) st.players[ship.owner].bonusGold += bonus;
  gold += bonus;
  for (const id of coins) if (!st.players[ship.owner].known.includes(id)) st.players[ship.owner].known.push(id);
  c.ev.push({ e: 'unloaded', ship: ship.id, island: home.id, gold });
  log(c, `${ship.def.name} unloads ${gold} gold at ${home.name}.`, ship.owner);
  checkWin(c);
}

function atOwnHome(st: GameState, ship: Ship): boolean {
  return ship.docked !== null && st.islands[ship.docked].home === ship.owner;
}

function maybeUnload(c: Ctx, ship: Ship) {
  const st = c.st;
  if (atOwnHome(st, ship)) {
    unload(c, ship);
    if (ship.towing !== null) {
      const t = st.ships[ship.towing];
      t.docked = ship.docked;
      unload(c, t);
    }
    return;
  }
  if (has(st, ship, 'unloadWithinS')) {
    const home = st.islands[st.players[ship.owner].home];
    if (islandDist(ship, home) <= S_LEN) unload(c, ship);
  }
}

// ------------------------------------------------------------------ damage

function killCrew(c: Ctx, ship: Ship, crewId?: number): boolean {
  if (has(c.st, ship, 'crewImmortal')) return false;
  const alive = ship.crew.filter((x) => x.alive);
  if (!alive.length) return false;
  const victim = crewId !== undefined ? alive.find((x) => x.id === crewId) : [...alive].sort((a, b) => b.def.points - a.def.points || a.id - b.id)[0];
  if (!victim) return false;
  victim.alive = false;
  c.ev.push({ e: 'crewLost', ship: ship.id, crew: victim.id });
  log(c, `${victim.def.name} is lost from ${ship.def.name}.`);
  return true;
}

function releaseTow(st: GameState, ship: Ship) {
  if (ship.towing !== null) {
    st.ships[ship.towing].towedBy = null;
    ship.towing = null;
  }
  if (ship.towedBy !== null) {
    st.ships[ship.towedBy].towing = null;
    ship.towedBy = null;
  }
}

/** R6: a sunk ship's treasure is split; the shooter gets the odd gold. */
function sinkShip(c: Ctx, ship: Ship, by: number) {
  const st = c.st;
  if (ship.sunk) return;
  ship.sunk = true;
  for (const cr of ship.crew) cr.alive = false;
  let gold = 0;
  for (const id of [...ship.cargo, ...ship.uniques]) {
    const coin = st.coins[id];
    if (!coin.unique || coin.value > 0) gold += coin.value;
    coin.gone = true;
  }
  ship.cargo = [];
  ship.uniques = [];
  const other = by === ship.owner ? 1 - by : ship.owner;
  st.players[by].bonusGold += Math.ceil(gold / 2);
  st.players[other].bonusGold += Math.floor(gold / 2);
  releaseTow(st, ship);
  ship.docked = null;
  ship.pinnedTo = null;
  for (const o of st.ships) if (o.pinnedTo === ship.id) o.pinnedTo = null;
  c.ev.push({ e: 'sunk', ship: ship.id });
  log(c, `${ship.def.name} sinks!${gold ? ` Her ${gold} gold is shared out.` : ''}`);
  if (st.current && st.current.ship === ship.id) st.current = null;
  checkWin(c);
}

function eliminateMast(c: Ctx, ship: Ship, idx: number, by: number) {
  if (!ship.masts[idx]) fail('That mast is already gone.');
  ship.masts[idx] = false;
  c.ev.push({ e: 'mastLost', ship: ship.id, mast: idx });
  if (isDerelict(ship)) {
    if (has(c.st, ship, 'sinksAtZero')) {
      sinkShip(c, ship, by);
      return;
    }
    c.ev.push({ e: 'derelict', ship: ship.id });
    log(c, `${ship.def.name} is dismasted and derelict.`);
    if (ship.towing !== null) releaseTow(c.st, c.st.ships[ship.towing]);
  }
}

/** Lose masts; asks the chooser when there is a real choice. */
function loseMasts(c: Ctx, ship: Ship, count: number, chooser: number, by: number, cause: 'shot' | 'ram' | 'misfire') {
  const alive = ship.masts.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
  if (count >= alive.length) {
    for (const i of alive) if (!ship.sunk) eliminateMast(c, ship, i, by);
    return;
  }
  c.st.pending = { kind: 'mastLoss', player: chooser, ship: ship.id, count, by, cause };
}

/** Auto choice for a ship's own misfire: drop its weakest cannon. */
function worstMast(ship: Ship): number {
  let best = -1;
  let bestRank = -1;
  ship.masts.forEach((m, i) => {
    if (!m) return;
    const r = Number(ship.def.cannons[i]?.[0] ?? 6) + (ship.def.cannons[i]?.[1] === 'S' ? 0.5 : 0);
    if (r >= bestRank) {
      bestRank = r;
      best = i;
    }
  });
  return best;
}

function repairOne(c: Ctx, ship: Ship): boolean {
  const idx = ship.masts.findIndex((m) => !m);
  if (idx < 0) return false;
  const wasDerelict = isDerelict(ship);
  ship.masts[idx] = true;
  c.ev.push({ e: 'mastRepaired', ship: ship.id, mast: idx });
  if (wasDerelict && ship.towedBy !== null) releaseTow(c.st, ship);
  return true;
}

function applyHit(c: Ctx, shooter: Ship, target: Ship) {
  const st = c.st;
  if (isDerelict(target)) {
    // R6: a hit on a derelict sinks it.
    sinkShip(c, target, shooter.owner);
    if (has(st, shooter, 'repairOnSink') && repairOne(c, shooter)) log(c, `${shooter.def.name} patches a mast after the sinking.`);
    return;
  }
  if (has(st, target, 'armored') && st.current) {
    const cur = st.current;
    let e = cur.armorHits.find((x) => x[0] === target.id);
    if (!e) {
      e = [target.id, 0];
      cur.armorHits.push(e);
    }
    e[1]++;
    if (e[1] % 2 === 1) {
      log(c, `${target.def.name}'s heavy timbers absorb the hit.`);
      c.ev.push({ e: 'info', text: 'Armor absorbed the hit' });
      return;
    }
  }
  if (has(st, target, 'ignoreFirstHit') && target.masts.every(Boolean) && !target.flags.firstHitIgnored) {
    target.flags.firstHitIgnored = true;
    log(c, `${target.def.name} shrugs off the first hit.`);
    c.ev.push({ e: 'info', text: 'First hit ignored' });
    return;
  }
  if (has(st, shooter, 'hitKillsCrew') && !shooter.flags.hitCrewUsed && killCrew(c, target)) shooter.flags.hitCrewUsed = true;
  if (has(st, shooter, 'hitKillsCargo') && target.cargo.length) {
    const k = randInt(st.rng, target.cargo.length);
    const id = target.cargo.splice(k, 1)[0];
    st.coins[id].gone = true;
    c.ev.push({ e: 'treasureMoved', from: `ship:${target.id}`, to: 'sea', coin: id });
    log(c, `Treasure from ${target.def.name} goes overboard.`);
  }
  const count = has(st, shooter, 'doubleHit') ? 2 : 1;
  const chooser = has(st, shooter, 'chooseMast') ? shooter.owner : target.owner;
  loseMasts(c, target, count, chooser, shooter.owner, 'shot');
}

/** R5: roll a d6; equal or higher than the cannon's rank hits; 1 always misses. */
function resolveShot(c: Ctx, ship: Ship, cannon: Cannon, target: Ship, long: boolean, from: { x: number; y: number }, again = false) {
  const st = c.st;
  const roll = rollD6(st.rng);
  const bonus = long ? 0 : cannonBonus(st, ship, cannon, target);
  const need = long ? 6 : cannon.rank;
  const hit = roll !== 1 && (long ? roll === 6 : roll + bonus >= need);
  c.ev.push({ e: 'shot', ship: ship.id, cannon: cannon.id, target: target.id, roll, need: need - bonus, hit, from });
  log(c, `${ship.def.name} fires ${cannon.rank}${cannon.bar}${long ? ' (long)' : ''} at ${target.def.name}: rolls ${roll}${bonus ? `+${bonus}` : ''} — ${hit ? 'HIT' : 'miss'}.`);
  if (roll === 1 && !cannon.musket && has(st, ship, 'misfire') && mastsLeft(ship) > 0) {
    log(c, `${ship.def.name}'s gun bursts!`);
    eliminateMast(c, ship, worstMast(ship), 1 - ship.owner);
    if (ship.sunk) return;
  }
  if (hit) {
    applyHit(c, ship, target);
    return;
  }
  if (!again && has(st, ship, 'rerollMiss') && !ship.flags.rerollUsed) {
    ship.flags.rerollUsed = true;
    log(c, 'The cannoneer reloads and fires again.');
    resolveShot(c, ship, cannon, target, long, from, true);
  }
}

// ------------------------------------------------------------------ boarding

function boardBonus(st: GameState, ship: Ship, vs: Ship): number {
  let b = 0;
  for (const e of effectsOf(st, ship)) {
    if (e.code === 'boardBonus') b += e.n ?? 1;
    if (e.code === 'boardBonusVs' && e.faction === vs.def.faction) b += 1;
  }
  return b;
}

export function spoilsOptions(st: GameState, winner: Ship, loser: Ship): string[] {
  const opts: string[] = [];
  if (loser.cargo.length && cargoFree(st, winner) > 0) opts.push('treasure');
  if (!has(st, loser, 'crewImmortal')) for (const cr of loser.crew) if (cr.alive) opts.push(`crew:${cr.id}`);
  opts.push('none');
  return opts;
}

/** R4: each side rolls a d6 and adds its masts; ties are re-rolled. */
function resolveBoard(c: Ctx, a: Ship, d: Ship) {
  const st = c.st;
  for (let k = 0; k < 30; k++) {
    const ra = rollD6(st.rng);
    const rd = rollD6(st.rng);
    const ta = ra + mastsLeft(a) + boardBonus(st, a, d);
    const td = rd + mastsLeft(d) + boardBonus(st, d, a);
    if (ta === td) {
      log(c, `Boarding: ${ta} vs ${td}, a tie — roll again.`);
      continue;
    }
    const win = ta > td ? a : d;
    const lose = win === a ? d : a;
    c.ev.push({ e: 'board', ship: a.id, target: d.id, rolls: [ra, rd], totals: [ta, td], winner: win.id });
    log(c, `Boarding ${d.def.name}: ${ta} vs ${td}. ${win.def.name} wins the melee!`);
    const opts = spoilsOptions(st, win, lose);
    if (opts.length > 1) st.pending = { kind: 'boardSpoils', player: win.owner, winner: win.id, loser: lose.id };
    return;
  }
}

function takeTreasure(c: Ctx, from: Ship, to: Ship, max: number) {
  const st = c.st;
  let n = 0;
  while (n < max && from.cargo.length && cargoFree(st, to) > 0) {
    const k = randInt(st.rng, from.cargo.length);
    const id = from.cargo.splice(k, 1)[0];
    to.cargo.push(id);
    c.ev.push({ e: 'treasureMoved', from: `ship:${from.id}`, to: `ship:${to.id}`, coin: id });
    n++;
  }
  if (n) log(c, `${to.def.name} takes ${n} treasure from ${from.def.name}.`);
  maybeUnload(c, to);
}

// ------------------------------------------------------------------ choose

function choose(c: Ctx, option: string) {
  const st = c.st;
  const p = st.pending;
  if (!p) fail('Nothing to choose.');
  if (!p) return;
  if (p.kind === 'mastLoss') {
    const ship = st.ships[p.ship];
    const m = /^mast:(\d+)$/.exec(option);
    if (!m) fail('Choose a mast.');
    const idx = Number(m![1]);
    if (!ship.masts[idx]) fail('That mast is already gone.');
    st.pending = null;
    eliminateMast(c, ship, idx, p.by ?? 1 - ship.owner);
    const left = p.count - 1;
    if (left > 0 && !ship.sunk) loseMasts(c, ship, left, p.player, p.by ?? 1 - ship.owner, p.cause);
  } else if (p.kind === 'boardSpoils') {
    const win = st.ships[p.winner];
    const lose = st.ships[p.loser];
    const opts = spoilsOptions(st, win, lose);
    if (!opts.includes(option)) fail('Not a valid choice.');
    st.pending = null;
    if (option === 'treasure') takeTreasure(c, lose, win, has(st, win, 'greedyBoarder') ? 99 : 1);
    else if (option.startsWith('crew:')) killCrew(c, lose, Number(option.slice(5)));
  } else if (p.kind === 'defenderBoard') {
    if (option !== 'board' && option !== 'decline') fail('Board or decline.');
    st.pending = null;
    if (option === 'board') resolveBoard(c, st.ships[p.defender], st.ships[p.attacker]);
  }
  resume(c);
}

/** Continue closing an action or turn that waited on a choice. */
function resume(c: Ctx) {
  const st = c.st;
  if (st.pending || st.over || !st.closing) return;
  const then = st.closing;
  st.closing = null;
  if (!closeCurrent(c, false, then)) return;
  if (then === 'turn') passTurn(c);
}

// ------------------------------------------------------------------ dispatch

function doMove(c: Ctx, m: Extract<Move, { t: 'move' }>) {
  const st = c.st;
  const ship = ownShip(c, m.ship, m.by);
  if (st.current?.ship === ship.id) fail('This ship is already taking an action; end it first.');
  const res = resolveMove(st, ship, m.segs);
  if (!res.ok) fail(res.error ?? 'Illegal move.');
  beginAction(c, ship, 'move');
  const prevDock = ship.docked;
  ship.x = res.final.x;
  ship.y = res.final.y;
  ship.heading = res.final.heading;
  ship.docked = res.dockedAt;
  c.ev.push({ e: 'moved', ship: ship.id, path: res.path });
  followTow(c, ship);
  const cur = st.current!;
  cur.canShoot = has(st, ship, 'moveShoot');
  if (ship.docked !== null && ship.docked !== prevDock) {
    c.ev.push({ e: 'docked', ship: ship.id, island: ship.docked });
    const isl = st.islands[ship.docked];
    log(c, `${ship.def.name} docks at ${isl.name}.`);
    if (isl.home !== ship.owner && has(st, ship, 'dockExplore')) cur.canExplore = true;
  }
  maybeUnload(c, ship);
}

function followTow(c: Ctx, ship: Ship) {
  const st = c.st;
  if (ship.towing === null) return;
  const t = st.ships[ship.towing];
  const pose = towPose(ship);
  if (towBlocked(st, t, pose, ship)) {
    log(c, `The tow line to ${t.def.name} parts.`);
    releaseTow(st, ship);
    return;
  }
  const from = { x: t.x, y: t.y, heading: t.heading };
  t.x = pose.x;
  t.y = pose.y;
  t.heading = pose.heading;
  t.docked = ship.docked;
  c.ev.push({ e: 'moved', ship: t.id, path: [from, pose] });
}

function doComeAbout(c: Ctx, m: Extract<Move, { t: 'comeAbout' }>) {
  const st = c.st;
  const ship = ownShip(c, m.ship, m.by);
  if (availableBars(st, ship).length === 0) fail('This ship cannot move.');
  if (isPinned(st, ship)) fail('Pinned: cannot move until the enemy moves away.');
  const pose = comeAboutPose(st, ship);
  if (!pose) fail('No room to come about here.');
  beginAction(c, ship, 'comeAbout');
  const from = { x: ship.x, y: ship.y, heading: ship.heading };
  ship.x = pose!.x;
  ship.y = pose!.y;
  ship.heading = pose!.heading;
  ship.docked = dockedIsland(st, ship, ship);
  c.ev.push({ e: 'moved', ship: ship.id, path: [from, pose!] });
  followTow(c, ship);
  maybeUnload(c, ship);
}

function doFire(c: Ctx, m: Extract<Move, { t: 'fire' }>) {
  const st = c.st;
  const ship = ownShip(c, m.ship, m.by);
  const cur = st.current;
  const continuing = !!cur && cur.ship === ship.id && (cur.kind === 'shoot' || (cur.kind === 'move' && cur.canShoot));
  if (cur && cur.ship === ship.id && !continuing) fail('This ship cannot shoot during this action.');
  if (has(st, ship, 'noShootLoaded') && ship.cargo.length) fail('She cannot shoot while carrying treasure.');
  const cannon = cannonsOf(st, ship).find((x) => x.id === m.cannon);
  if (!cannon) fail('No such cannon.');
  if (continuing && cur!.fired.includes(m.cannon)) fail('That cannon has already fired this action.');
  const long = !!m.long;
  if (long && !has(st, ship, 'longShot')) fail('This ship cannot fire at double range.');
  const target = shipOf(c, m.target);
  const lof = lineOfFire(st, ship, cannon!, target, long);
  if (!lof) fail('Target is out of range or the line of fire is blocked.');
  if (!continuing) beginAction(c, ship, 'shoot');
  st.current!.fired.push(cannon!.id);
  resolveShot(c, ship, cannon!, target, long, lof!.from);
}

function doExplore(c: Ctx, m: Extract<Move, { t: 'explore' }>) {
  const st = c.st;
  const ship = ownShip(c, m.ship, m.by);
  const cur = st.current;
  const free = !!cur && cur.ship === ship.id && cur.kind === 'move' && cur.canExplore;
  if (ship.docked === null) fail('Dock at an island to explore it.');
  const isl = st.islands[ship.docked!];
  if (isl.home === ship.owner) fail('Treasure is unloaded at home automatically.');
  const raid = isl.home !== null;
  if (raid && !has(st, ship, 'raidHome')) fail('You cannot explore an enemy home island.');
  const take = [...new Set(m.take)];
  for (const id of take) {
    if (!isl.coins.includes(id) || st.coins[id].unique) fail('That treasure is not on this island.');
  }
  if (take.length > cargoFree(st, ship)) fail('Not enough cargo space.');
  if (raid && take.length > 1) fail('A raid may take only one treasure.');
  const plain = isl.coins.filter((id) => !st.coins[id].unique);
  if (has(st, ship, 'cantLoadLast') && take.length > 0 && take.length >= plain.length) fail('This ship may never load the last treasure from an island.');
  if (free) cur!.canExplore = false;
  else beginAction(c, ship, 'explore');
  const known = st.players[ship.owner].known;
  for (const id of isl.coins) if (!known.includes(id)) known.push(id);
  // Unique treasure must be taken by the first ship to explore (no cargo space).
  if (!raid) {
    for (const id of isl.coins.filter((x) => st.coins[x].unique)) {
      const coin = st.coins[id];
      if (coin.unique!.effects.some((e) => e.code === 'rum')) {
        coin.value = Math.max(0, 6 - ship.crew.filter((x) => x.alive).length);
        ship.flags.rumTurn = st.turn;
      }
      ship.uniques.push(id);
      isl.coins = isl.coins.filter((x) => x !== id);
      log(c, `${ship.def.name} finds ${coin.unique!.name}!`);
    }
  }
  isl.coins = isl.coins.filter((id) => !take.includes(id));
  ship.cargo.push(...take);
  c.ev.push({ e: 'explored', ship: ship.id, island: isl.id, took: take });
  log(c, `${ship.def.name} explores ${isl.name} and loads ${take.length} treasure.`);
}

function doExploreShip(c: Ctx, m: Extract<Move, { t: 'exploreShip' }>) {
  const st = c.st;
  const ship = ownShip(c, m.ship, m.by);
  const target = shipOf(c, m.target);
  if (target.sunk || target.id === ship.id) fail('Not a valid ship.');
  if (target.owner !== ship.owner && !isDerelict(target)) fail('Only friendly ships or derelicts can be explored.');
  if (!shipsTouching(ship, target)) fail('The ships must touch.');
  const take = [...new Set(m.take)];
  for (const id of take) if (!target.cargo.includes(id)) fail('That treasure is not aboard.');
  if (take.length > cargoFree(st, ship)) fail('Not enough cargo space.');
  beginAction(c, ship, 'explore');
  target.cargo = target.cargo.filter((id) => !take.includes(id));
  ship.cargo.push(...take);
  for (const id of take) c.ev.push({ e: 'treasureMoved', from: `ship:${target.id}`, to: `ship:${ship.id}`, coin: id });
  log(c, `${ship.def.name} takes ${take.length} treasure from ${target.def.name}.`);
  if (has(st, ship, 'salvager') && isDerelict(target)) {
    // Claim the derelict; both ships dock at your home island.
    releaseTow(st, target);
    target.owner = ship.owner;
    const home = st.players[ship.owner].home;
    for (const s of [ship, target]) {
      const spot = findDockSpot(st, s, home, s.owner === 0 ? 90 : -90);
      if (spot) {
        const from = { x: s.x, y: s.y, heading: s.heading };
        s.x = spot.x;
        s.y = spot.y;
        s.heading = spot.heading;
        s.docked = home;
        s.pinnedTo = null;
        c.ev.push({ e: 'moved', ship: s.id, path: [from, spot] });
      }
    }
    log(c, `${ship.def.name} claims ${target.def.name} and brings her home.`);
    for (const s of [ship, target]) if (atOwnHome(st, s)) unload(c, s);
  }
}

function doRepair(c: Ctx, m: Extract<Move, { t: 'repair' }>) {
  const st = c.st;
  const ship = ownShip(c, m.ship, m.by);
  if (!atOwnHome(st, ship) && !has(st, ship, 'shipwright')) fail('Repairs need your home island (or a Shipwright).');
  if (ship.masts.every(Boolean)) fail('Nothing to repair.');
  beginAction(c, ship, 'repair');
  repairOne(c, ship);
  log(c, `${ship.def.name} repairs a mast.`);
}

function postMove(c: Ctx, ship: Ship): NonNullable<GameState['current']> {
  const cur = c.st.current;
  if (!cur || cur.ship !== ship.id || cur.kind !== 'move') fail('Only right after this ship moves.');
  return cur!;
}

function doRam(c: Ctx, m: Extract<Move, { t: 'ram' }>) {
  const st = c.st;
  const ship = ownShip(c, m.ship, m.by);
  const cur = postMove(c, ship);
  if (cur.rammed !== null) fail('Already rammed this action.');
  if (isDerelict(ship)) fail('A derelict cannot ram.');
  const target = shipOf(c, m.target);
  if (target.sunk || target.owner === ship.owner) fail('Ram an enemy ship.');
  if (!bowTouches(ship, target)) fail('Her bow must touch the enemy.');
  const roll = rollD6(st.rng);
  const immune = has(st, target, 'ramImmune');
  const hit = !immune && roll > mastsLeft(target);
  cur.rammed = target.id;
  c.ev.push({ e: 'ram', ship: ship.id, target: target.id, roll, hit });
  log(c, `${ship.def.name} rams ${target.def.name}: rolls ${roll} against ${mastsLeft(target)} masts — ${hit ? 'a mast cracks!' : 'no damage.'}`);
  if (hit) loseMasts(c, target, 1, target.owner, ship.owner, 'ram');
  if (!target.sunk && !isDerelict(target) && !has(st, ship, 'unpinnable')) {
    ship.pinnedTo = target.id;
    if (has(st, ship, 'pinKillsCrew')) killCrew(c, target);
  }
}

function doBoard(c: Ctx, m: Extract<Move, { t: 'board' }>) {
  const ship = ownShip(c, m.ship, m.by);
  const cur = postMove(c, ship);
  if (cur.rammed !== m.target) fail('Boarding follows a ram on that ship.');
  if (cur.boarded) fail('Already boarded.');
  const target = shipOf(c, m.target);
  if (target.sunk) fail('She has sunk.');
  cur.boarded = true;
  resolveBoard(c, ship, target);
}

function doTow(c: Ctx, m: Extract<Move, { t: 'tow' }>) {
  const st = c.st;
  const ship = ownShip(c, m.ship, m.by);
  const cur = postMove(c, ship);
  if (cur.towed || ship.towing !== null) fail('Already towing.');
  if (isDerelict(ship)) fail('A derelict cannot tow.');
  const target = shipOf(c, m.target);
  if (target.sunk || !isDerelict(target) || target.towedBy !== null) fail('Only a free derelict can be towed.');
  if (distPointPoly(target, hull(ship)) > TOUCH * 1.5) fail('Touch the derelict’s bow to take her in tow.');
  const pose = towPose(ship);
  if (towBlocked(st, target, pose, ship)) fail('No room astern to tow her.');
  cur.towed = true;
  const from = { x: target.x, y: target.y, heading: target.heading };
  target.x = pose.x;
  target.y = pose.y;
  target.heading = pose.heading;
  target.owner = ship.owner;
  target.pinnedTo = null;
  ship.towing = target.id;
  target.towedBy = ship.id;
  target.docked = ship.docked;
  c.ev.push({ e: 'towed', ship: ship.id, target: target.id });
  c.ev.push({ e: 'moved', ship: target.id, path: [from, pose] });
  log(c, `${ship.def.name} takes ${target.def.name} in tow.`);
  maybeUnload(c, ship);
}

function doPickpocket(c: Ctx, m: Extract<Move, { t: 'pickpocket' }>) {
  const st = c.st;
  const ship = ownShip(c, m.ship, m.by);
  if (!has(st, ship, 'pickpocket') || ship.flags.pickpocketUsed) fail('Not available.');
  const target = shipOf(c, m.target);
  if (target.sunk || target.owner === ship.owner || !target.cargo.length) fail('Nothing to take.');
  if (!shipsTouching(ship, target)) fail('The ships must touch.');
  if (cargoFree(st, ship) <= 0) fail('No cargo space.');
  ship.flags.pickpocketUsed = true;
  takeTreasure(c, target, ship, 1);
}

function doPlunder(c: Ctx, m: Extract<Move, { t: 'plunder' }>) {
  const st = c.st;
  const ship = ownShip(c, m.ship, m.by);
  const target = shipOf(c, m.target);
  const ok = effectsOf(st, ship).some((e) => e.code === 'plunder' && e.faction === target.def.faction);
  if (!ok || ship.flags.once.includes('plunder')) fail('Not available.');
  if (target.sunk || target.owner === ship.owner || !target.cargo.length) fail('Nothing to take.');
  if (!shipsTouching(ship, target)) fail('The ships must touch.');
  if (cargoFree(st, ship) <= 0) fail('No cargo space.');
  ship.flags.once.push('plunder');
  takeTreasure(c, target, ship, 99);
}

function doPeekIsland(c: Ctx, m: Extract<Move, { t: 'peekIsland' }>) {
  const st = c.st;
  const ship = ownShip(c, m.ship, m.by);
  if (!has(st, ship, 'peekIsland') || ship.flags.peekUsed) fail('Not available.');
  const isl = st.islands[m.island];
  if (!isl || isl.home !== null) fail('Pick a wild island.');
  const known = st.players[ship.owner].known;
  const hidden = isl.coins.filter((id) => !known.includes(id));
  if (!hidden.length) fail('Nothing hidden there.');
  ship.flags.peekUsed = true;
  known.push(hidden[randInt(st.rng, hidden.length)]);
  log(c, `${ship.def.name} spies on the treasure of ${isl.name}.`);
}

function doPeekCargo(c: Ctx, m: Extract<Move, { t: 'peekCargo' }>) {
  const st = c.st;
  const ship = ownShip(c, m.ship, m.by);
  if (!has(st, ship, 'peekCargo') || ship.flags.once.includes('peekCargo')) fail('Not available.');
  const target = shipOf(c, m.target);
  const known = st.players[ship.owner].known;
  const hidden = target.cargo.filter((id) => !known.includes(id));
  if (!hidden.length) fail('Nothing hidden there.');
  ship.flags.once.push('peekCargo');
  known.push(hidden[randInt(st.rng, hidden.length)]);
  log(c, `${ship.def.name} spies on ${target.def.name}'s hold.`);
}

function dispatch(c: Ctx, m: Move) {
  const st = c.st;
  if (m.t === 'resign') {
    if (m.by !== 0 && m.by !== 1) fail('Unknown player.');
    st.players[m.by].resigned = true;
    finish(c, 1 - m.by, `${st.players[m.by].name} strikes their colours.`);
    return;
  }
  if (st.pending) {
    if (m.t !== 'choose') fail('A choice is pending.');
    if (m.by !== st.pending.player) fail('Waiting for the other player to choose.');
    choose(c, m.option);
    return;
  }
  if (m.by !== st.active) fail('Not your turn.');
  switch (m.t) {
    case 'move': return doMove(c, m);
    case 'comeAbout': return doComeAbout(c, m);
    case 'fire': return doFire(c, m);
    case 'explore': return doExplore(c, m);
    case 'exploreShip': return doExploreShip(c, m);
    case 'repair': return doRepair(c, m);
    case 'ram': return doRam(c, m);
    case 'board': return doBoard(c, m);
    case 'tow': return doTow(c, m);
    case 'pickpocket': return doPickpocket(c, m);
    case 'plunder': return doPlunder(c, m);
    case 'peekIsland': return doPeekIsland(c, m);
    case 'peekCargo': return doPeekCargo(c, m);
    case 'endAction':
      closeCurrent(c, false, 'action');
      return;
    case 'endTurn':
      if (closeCurrent(c, false, 'turn')) passTurn(c);
      return;
    case 'choose':
      fail('Nothing to choose.');
  }
}

export function applyMove(state: GameState, move: Move): ApplyResult {
  if (state.over) return { ok: false, error: 'The game is over.', state, events: [] };
  const st = structuredClone(state);
  const c: Ctx = { st, ev: [] };
  try {
    dispatch(c, move);
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, error: e.message, state, events: [] };
    throw e;
  }
  checkEnd(c);
  return { ok: true, state: st, events: c.ev };
}

/** Who has to act next (the pending chooser, else the active player). */
export function toAct(st: GameState): number {
  return st.pending ? st.pending.player : st.active;
}

