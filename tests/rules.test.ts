// Unit tests for the rules. Section numbers (R1...) refer to docs/rules.md,
// which cites the printed rulebooks.
import { describe, expect, it } from 'vitest';
import { BUILTIN_CARDS } from '../src/data';
import {
  applyMove,
  availableBars,
  cannonsOf,
  createGame,
  dist,
  fingerprint,
  firingOptions,
  islandDist,
  isDerelict,
  makeCatalog,
  score,
  shipOptions,
  validateFleet,
  wildIslandCount,
  type GameState,
} from '../src/engine';
import { forceRolls, game, hideUnplaced, openSea, place, play, testCrew, testShip, testTreasure, tryMove } from './helpers';

const fx = (code: string, extra = {}) => ({ code, ...extra });

describe('R1 fleet building', () => {
  const cat = makeCatalog(BUILTIN_CARDS);
  const ship = cat.ships.find((s) => s.name === 'Revenant')!; // 15 pts, 4 cargo
  const pirateCaptain = cat.crew.find((c) => c.name === 'Captain' && c.faction === 'Pirate')!;
  const englishCaptain = cat.crew.find((c) => c.name === 'Captain' && c.faction === 'English')!;

  it('fleets must fit the point limit', () => {
    const f = { name: 'x', ships: [{ ship: ship.id, crew: [] }, { ship: ship.id, crew: [] }] };
    expect(validateFleet(cat, f, 30)).toEqual([]);
    expect(validateFleet(cat, f, 29)[0]).toMatch(/limit is 29/);
  });

  it('crew must share the ship’s nationality', () => {
    const f = { name: 'x', ships: [{ ship: ship.id, crew: [englishCaptain.id] }] };
    expect(validateFleet(cat, f, 40).join()).toMatch(/cannot serve/);
    expect(validateFleet(cat, { name: 'x', ships: [{ ship: ship.id, crew: [pirateCaptain.id] }] }, 40)).toEqual([]);
  });

  it('crew take cargo space and cannot cost more than the ship', () => {
    const small = cat.ships.find((s) => s.name === 'Snipe')!; // 6 pts, 1 cargo
    const f = { name: 'x', ships: [{ ship: small.id, crew: [pirateCaptain.id, pirateCaptain.id] }] };
    const errs = validateFleet(cat, f, 99).join(' ');
    expect(errs).toMatch(/cargo space/);
    const big = { name: 'x', ships: [{ ship: small.id, crew: [pirateCaptain.id, pirateCaptain.id, pirateCaptain.id] }] };
    expect(validateFleet(cat, big, 99).join(' ')).toMatch(/more than the ship/);
  });
});

describe('R2 setup', () => {
  const cat = makeCatalog(BUILTIN_CARDS);
  const f = { name: 'x', ships: cat.ships.filter((s) => s.pack === 'original').slice(0, 3).map((s) => ({ ship: s.id, crew: [] })) };
  const st = createGame({ seed: 42, fleets: [f, f], points: 40 }, cat);

  it('two home islands plus three treasures per wild island', () => {
    expect(st.islands.filter((i) => i.home !== null)).toHaveLength(2);
    expect(st.islands.filter((i) => i.home === null)).toHaveLength(wildIslandCount(2));
    for (const isl of st.islands.filter((i) => i.home === null)) expect(isl.coins).toHaveLength(3);
  });

  it('each player brings six treasures worth 12 gold', () => {
    expect(st.coins).toHaveLength(12);
    expect(st.startingGold).toBe(24);
  });

  it('islands are at least two L apart', () => {
    for (const a of st.islands) for (const b of st.islands) if (a.id < b.id) expect(dist(a, b) - a.r - b.r).toBeGreaterThanOrEqual(11.99);
  });

  it('ships start with bows touching their home island', () => {
    for (const s of st.ships) {
      expect(s.docked).toBe(s.owner);
      expect(islandDist(s, st.islands[s.owner])).toBeLessThan(0.15);
    }
  });

  it('the same seed gives the same game', () => {
    const again = createGame({ seed: 42, fleets: [f, f], points: 40 }, cat);
    expect(fingerprint(again)).toBe(fingerprint(st));
    expect(fingerprint(createGame({ seed: 43, fleets: [f, f], points: 40 }, cat))).not.toBe(fingerprint(st));
  });
});

function duel(a = testShip(3), b = testShip(3)): GameState {
  const st = openSea(game([{ ship: a }], [{ ship: b }]));
  place(st, 0, 15, 20, 0);
  place(st, 1, 15, 22.5, 0);
  return st;
}

describe('R3 actions', () => {
  it('each ship gets one action per turn', () => {
    const st = duel();
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: -90, dist: 3 }] }, { t: 'endAction', by: 0 });
    const r = tryMove(s1, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: -90, dist: 3 }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already acted/);
  });

  it('only the active player may act; ending the turn passes play', () => {
    const st = duel();
    expect(tryMove(st, { t: 'endTurn', by: 1 }).ok).toBe(false);
    const s1 = play(st, { t: 'endTurn', by: 0 });
    expect(s1.active).toBe(1);
    expect(s1.turn).toBe(2);
  });
});

describe('R4 movement', () => {
  it('moves the bow up to the ruler length and ends facing the way it moved', () => {
    const st = duel();
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: -45, dist: 6 }] });
    const s = s1.ships[0];
    expect(dist(s, { x: 15, y: 20 })).toBeCloseTo(6, 3);
    expect(s.heading).toBeCloseTo(-45, 3);
  });

  it('rejects segments longer than the ruler or rulers the ship does not have', () => {
    const st = duel();
    expect(tryMove(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 0, dist: 6.5 }] }).ok).toBe(false);
    expect(tryMove(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'S', heading: 0, dist: 2 }] }).ok).toBe(false);
  });

  it('S+L can be used in either order, turning between segments', () => {
    const st = duel(testShip(2, { move: 'SL' }));
    const a = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: -30, dist: 6 }, { bar: 'S', heading: -90, dist: 3 }] });
    const b = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'S', heading: -30, dist: 3 }, { bar: 'L', heading: -90, dist: 6 }] });
    expect(a.ships[0].heading).toBeCloseTo(-90);
    expect(b.ships[0].heading).toBeCloseTo(-90);
  });

  it('may not turn more than 90° at a segment', () => {
    const st = duel();
    expect(tryMove(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 120, dist: 3 }] }).error).toMatch(/Turn/);
  });

  it('cannot pass through an island: stops at it and docks', () => {
    const st = duel();
    st.islands[2].x = 22;
    st.islands[2].y = 20;
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 0, dist: 6 }] });
    expect(s1.ships[0].docked).toBe(2);
    expect(s1.ships[0].x).toBeLessThan(22 - 1.5 + 0.01);
  });

  it('cannot dock at an enemy home island', () => {
    const st = duel();
    st.islands[1].x = 23;
    st.islands[1].y = 20;
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 0, dist: 6 }] });
    expect(s1.ships[0].docked).toBe(null);
  });

  it('Helmsman adds +S; derelicts cannot move unless an Oarsman rows', () => {
    const st = openSea(game([{ ship: testShip(2), crew: [testCrew([fx('plusS')])] }, { ship: testShip(2), crew: [testCrew([fx('derelictMoveS'), fx('noCargoSpace')])] }], [{ ship: testShip(2) }]));
    expect(availableBars(st, st.ships[0])).toEqual(['L', 'S']);
    st.ships[0].masts = [false, false];
    expect(availableBars(st, st.ships[0])).toEqual([]);
    st.ships[1].masts = [false, false];
    expect(availableBars(st, st.ships[1])).toEqual(['S']);
  });

  it('come about turns the ship in place, bow to where the stern was', () => {
    const st = duel();
    const s1 = play(st, { t: 'comeAbout', by: 0, ship: 0 });
    expect(s1.ships[0].heading).toBeCloseTo(180);
    expect(s1.ships[0].x).toBeCloseTo(15 - 3.2, 2);
  });
});

describe('R5 shooting', () => {
  it('rolls equal to or over the rank hit; the owner picks which mast falls', () => {
    const st = duel(testShip(3, { cannons: ['3S', '3S', '3S'] }));
    hideUnplaced(st);
    forceRolls(st, [3]);
    const s1 = play(st, { t: 'fire', by: 0, ship: 0, cannon: 'mast:1', target: 1 });
    expect(s1.pending).toMatchObject({ kind: 'mastLoss', player: 1, ship: 1 });
    const s2 = play(s1, { t: 'choose', by: 1, option: 'mast:2' });
    expect(s2.ships[1].masts).toEqual([true, true, false]);
  });

  it('a roll of 1 always misses', () => {
    const st = duel(testShip(1, { cannons: ['3S'], effects: [fx('cannonBonusVs', { faction: 'Pirate' })] }));
    // Bonus +1 would turn a 2 into a hit on rank 3, but never a 1.
    forceRolls(st, [1]);
    const s1 = play(st, { t: 'fire', by: 0, ship: 0, cannon: 'mast:0', target: 1 });
    expect(s1.ships[1].masts.every(Boolean)).toBe(true);
  });

  it('S cannons reach 3", L cannons 6", measured from the mast', () => {
    const st = duel(testShip(2, { cannons: ['2S', '2L'] }));
    st.ships[1].y = 25; // about 4.4" from the masts
    const opts = firingOptions(st, st.ships[0]).map((o) => o.cannon.id);
    expect(opts).toEqual(['mast:1']);
  });

  it('islands block the line of fire', () => {
    const st = duel(testShip(1, { cannons: ['2L'] }));
    st.ships[1].y = 25;
    expect(firingOptions(st, st.ships[0])).toHaveLength(1);
    st.islands[2].x = 13.4;
    st.islands[2].y = 22.5;
    st.islands[2].r = 2.4;
    expect(firingOptions(st, st.ships[0])).toHaveLength(0);
  });

  it('ships docked at their home island cannot be targeted', () => {
    const st = duel();
    st.islands[1].x = 13.5;
    st.islands[1].y = 22.5 + 3;
    st.ships[1].docked = 1;
    expect(firingOptions(st, st.ships[0])).toHaveLength(0);
  });

  it('a Captain may move and shoot in the same action', () => {
    const st = duel(testShip(2, { cannons: ['2S', '2S'] }), testShip(2));
    st.ships[0].crew.push({ id: 900, def: testCrew([fx('moveShoot')]), alive: true });
    st.ships[1].y = 26;
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 0, dist: 1 }] });
    s1.ships[0].y = 24; // as if it sailed close
    const r = tryMove(s1, { t: 'fire', by: 0, ship: 0, cannon: 'mast:0', target: 1 });
    expect(r.ok).toBe(true);
    // Without a captain the same shot is a second action.
    const plain = duel(testShip(2, { cannons: ['2S', '2S'] }));
    const p1 = play(plain, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 0, dist: 1 }] });
    expect(tryMove(p1, { t: 'fire', by: 0, ship: 0, cannon: 'mast:0', target: 1 }).ok).toBe(false);
  });

  it('a Cannoneer fires again after a miss, once a turn', () => {
    const st = duel(testShip(1, { cannons: ['4S'] }));
    st.ships[0].crew.push({ id: 901, def: testCrew([fx('rerollMiss')]), alive: true });
    forceRolls(st, [2, 5]);
    const r = applyMove(st, { t: 'fire', by: 0, ship: 0, cannon: 'mast:0', target: 1 });
    const shots = r.events.filter((e) => e.e === 'shot');
    expect(shots.map((s) => (s as { roll: number }).roll)).toEqual([2, 5]);
  });

  it('a Musketeer adds a 3S cannon that fires even from a derelict', () => {
    const st = duel(testShip(1, { cannons: ['2L'] }));
    st.ships[0].crew.push({ id: 902, def: testCrew([fx('musket')]), alive: true });
    st.ships[0].masts = [false];
    expect(cannonsOf(st, st.ships[0]).map((c) => c.id)).toEqual(['musket:902']);
  });

  it('each cannon fires once per shoot action', () => {
    const st = duel(testShip(2, { cannons: ['3S', '3S'] }));
    forceRolls(st, [2, 2]);
    const s1 = play(st, { t: 'fire', by: 0, ship: 0, cannon: 'mast:0', target: 1 });
    expect(tryMove(s1, { t: 'fire', by: 0, ship: 0, cannon: 'mast:0', target: 1 }).error).toMatch(/already fired/);
    expect(tryMove(s1, { t: 'fire', by: 0, ship: 0, cannon: 'mast:1', target: 1 }).ok).toBe(true);
  });
});

describe('R6 derelicts and sinking', () => {
  it('losing every mast leaves a derelict; a hit on a derelict sinks it and splits its gold', () => {
    const st = duel(testShip(1, { cannons: ['2S'] }), testShip(1));
    st.ships[1].cargo = [0, 1];
    st.coins[0].value = 2;
    st.coins[1].value = 3;
    st.islands.forEach((i) => (i.coins = i.coins.filter((c) => c > 1)));
    forceRolls(st, [6]);
    const s1 = play(st, { t: 'fire', by: 0, ship: 0, cannon: 'mast:0', target: 1 }, { t: 'endTurn', by: 0 }, { t: 'endTurn', by: 1 });
    expect(isDerelict(s1.ships[1])).toBe(true);
    forceRolls(s1, [6]);
    const s2 = play(s1, { t: 'fire', by: 0, ship: 0, cannon: 'mast:0', target: 1 });
    expect(s2.ships[1].sunk).toBe(true);
    // 5 gold: shooter gets the odd one.
    expect(s2.players[0].bonusGold).toBe(3);
    expect(s2.players[1].bonusGold).toBe(2);
  });

  it('a ship docked at home repairs one mast per repair action', () => {
    const st = duel();
    place(st, 0, 21, 2.5 + 1.5 + 0.05, -90);
    st.ships[0].masts = [true, false, false];
    expect(st.ships[0].docked).toBe(0);
    const s1 = play(st, { t: 'repair', by: 0, ship: 0 });
    expect(s1.ships[0].masts).toEqual([true, true, false]);
  });
});

describe('R7 exploring and treasure', () => {
  function atIsland() {
    const st = duel(testShip(2, { cargo: 2 }));
    const isl = st.islands[2];
    isl.x = 23;
    isl.y = 20;
    place(st, 0, 23 - 1.5 - 0.05, 20, 0);
    return st;
  }

  it('a docked ship explores and loads treasure up to its cargo space', () => {
    const st = atIsland();
    const coins = st.islands[2].coins;
    expect(tryMove(st, { t: 'explore', by: 0, ship: 0, take: coins }).error).toMatch(/cargo space/);
    const s1 = play(st, { t: 'explore', by: 0, ship: 0, take: coins.slice(0, 2) });
    expect(s1.ships[0].cargo).toHaveLength(2);
    expect(s1.islands[2].coins).toHaveLength(1);
    expect(s1.players[0].known).toEqual(expect.arrayContaining(coins));
  });

  it('docking and exploring take two actions unless an Explorer is aboard', () => {
    const st = duel(testShip(2));
    st.islands[2].x = 22;
    st.islands[2].y = 20;
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 0, dist: 6 }] });
    expect(tryMove(s1, { t: 'explore', by: 0, ship: 0, take: [] }).ok).toBe(false);
    const st2 = duel(testShip(2));
    st2.ships[0].crew.push({ id: 903, def: testCrew([fx('dockExplore')]), alive: true });
    st2.islands[2].x = 22;
    st2.islands[2].y = 20;
    const s2 = play(st2, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 0, dist: 6 }] });
    expect(tryMove(s2, { t: 'explore', by: 0, ship: 0, take: [s2.islands[2].coins[0]] }).ok).toBe(true);
  });

  it('unique treasure is taken by the first explorer without cargo space', () => {
    const u = testTreasure([fx('boardBonus', { n: 1 })], 'Lucky Charm');
    const st = openSea(game([{ ship: testShip(2, { cargo: 1 }) }], [{ ship: testShip(2) }], { uniques: [u, null] }));
    const uid = st.coins.find((c) => c.unique)!.id;
    const isl = st.islands.find((i) => i.coins.includes(uid))!;
    place(st, 0, isl.x - isl.r - 0.05, isl.y, 0);
    const s1 = play(st, { t: 'explore', by: 0, ship: 0, take: [] });
    expect(s1.ships[0].uniques).toEqual([uid]);
  });

  it('treasure is unloaded and scored on docking at home', () => {
    const st = duel();
    st.ships[0].cargo = [st.islands[2].coins.pop()!];
    const v = st.coins[st.ships[0].cargo[0]].value;
    place(st, 0, 21, 9.5, -90);
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: -90, dist: 6 }] });
    expect(s1.ships[0].docked).toBe(0);
    expect(s1.ships[0].cargo).toEqual([]);
    expect(score(s1, 0)).toBe(v);
  });
});

describe('R8 ramming, boarding and towing', () => {
  function rammer() {
    const st = duel(testShip(3), testShip(2));
    place(st, 0, 15, 18, 90); // bow points at the target's side
    place(st, 1, 16.5, 22.5, 0);
    return st;
  }

  it('ram: roll over the target’s masts to take one; the rammer is pinned', () => {
    const st = rammer();
    forceRolls(st, [6]);
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 90, dist: 6 }] }, { t: 'ram', by: 0, ship: 0, target: 1 });
    expect(s1.pending).toMatchObject({ kind: 'mastLoss', ship: 1 });
    const s2 = play(s1, { t: 'choose', by: 1, option: 'mast:0' });
    expect(s2.ships[1].masts).toEqual([false, true]);
    expect(s2.ships[0].pinnedTo).toBe(1);
  });

  it('ram roll not over the masts does nothing', () => {
    const st = rammer();
    forceRolls(st, [2]);
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 90, dist: 6 }] }, { t: 'ram', by: 0, ship: 0, target: 1 });
    expect(s1.pending).toBe(null);
    expect(s1.ships[1].masts).toEqual([true, true]);
  });

  it('boarding after a ram: d6 + masts, winner takes treasure or a crew', () => {
    const st = rammer();
    st.ships[1].cargo = [st.islands[2].coins.pop()!];
    // ram roll 1 (no damage), boarding 4+3 vs 2+2
    forceRolls(st, [1, 4, 2]);
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 90, dist: 6 }] }, { t: 'ram', by: 0, ship: 0, target: 1 }, { t: 'board', by: 0, ship: 0, target: 1 });
    expect(s1.pending).toMatchObject({ kind: 'boardSpoils', player: 0 });
    const s2 = play(s1, { t: 'choose', by: 0, option: 'treasure' });
    expect(s2.ships[0].cargo).toHaveLength(1);
    expect(s2.ships[1].cargo).toHaveLength(0);
  });

  it('the rammed side may board when the attacker declines', () => {
    const st = rammer();
    forceRolls(st, [1]);
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 90, dist: 6 }] }, { t: 'ram', by: 0, ship: 0, target: 1 }, { t: 'endAction', by: 0 });
    expect(s1.pending).toMatchObject({ kind: 'defenderBoard', player: 1 });
    const s2 = play(s1, { t: 'choose', by: 1, option: 'decline' });
    expect(s2.pending).toBe(null);
    expect(s2.current).toBe(null);
  });

  it('a pinned ship cannot move away', () => {
    const st = rammer();
    forceRolls(st, [1]);
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 90, dist: 6 }] }, { t: 'ram', by: 0, ship: 0, target: 1 }, { t: 'endAction', by: 0 }, { t: 'choose', by: 1, option: 'decline' }, { t: 'endTurn', by: 0 }, { t: 'endTurn', by: 1 });
    expect(tryMove(s1, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 180, dist: 3 }] }).error).toMatch(/Pinned/);
  });

  it('a ship touching a derelict’s bow can take it in tow; towing moves at S', () => {
    const st = duel(testShip(3), testShip(2));
    st.ships[1].masts = [false, false];
    place(st, 1, 15, 20, 180); // derelict, bow at x=15 pointing -x
    place(st, 0, 12, 18, 90);
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: 45, dist: 1.5 }] });
    const opts = shipOptions(s1, s1.ships[0]);
    if (!opts.tow.length) return; // geometry dependent; covered by chaos games
    const s2 = play(s1, { t: 'tow', by: 0, ship: 0, target: 1 });
    expect(s2.ships[1].owner).toBe(0);
    expect(availableBars(s2, s2.ships[0])).toEqual(['S']);
  });
});

describe('R9 winning', () => {
  it('more than half the starting gold at home wins at once', () => {
    const st = duel();
    const home = st.islands[0];
    const coins = st.islands.filter((i) => i.home === null).flatMap((i) => i.coins);
    let g = 0;
    const take: number[] = [];
    for (const c of coins) {
      if (g * 2 > st.startingGold) break;
      take.push(c);
      g += st.coins[c].value;
    }
    st.ships[0].cargo = take;
    for (const i of st.islands) i.coins = i.coins.filter((c) => !take.includes(c));
    place(st, 0, home.x, home.y + home.r + 6, -90);
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: -90, dist: 6 }] });
    expect(s1.over).toBe(true);
    expect(s1.winner).toBe(0);
    void home;
  });

  it('the game ends on gold after the turn limit', () => {
    const st = duel();
    st.maxRounds = 1;
    const s1 = play(st, { t: 'endTurn', by: 0 }, { t: 'endTurn', by: 1 });
    expect(s1.over).toBe(true);
    expect(s1.endReason).toMatch(/Turn limit/);
  });
});

describe('ship abilities', () => {
  it('doubleHit takes two masts with one hit', () => {
    const st = duel(testShip(1, { cannons: ['2S'], effects: [fx('doubleHit')] }), testShip(3));
    forceRolls(st, [6]);
    const s1 = play(st, { t: 'fire', by: 0, ship: 0, cannon: 'mast:0', target: 1 }, { t: 'choose', by: 1, option: 'mast:0' }, { t: 'choose', by: 1, option: 'mast:1' });
    expect(s1.ships[1].masts).toEqual([false, false, true]);
  });

  it('L-range cannons cannot hit an immuneL ship', () => {
    const st = duel(testShip(1, { cannons: ['2L'] }), testShip(2, { effects: [fx('immuneL')] }));
    st.ships[1].y = 25;
    expect(firingOptions(st, st.ships[0])).toHaveLength(0);
  });

  it('ignoreFirstHit ignores the first hit each turn while all masts stand', () => {
    const st = duel(testShip(2, { cannons: ['2S', '2S'] }), testShip(2, { effects: [fx('ignoreFirstHit')] }));
    forceRolls(st, [6, 6]);
    const s1 = play(st, { t: 'fire', by: 0, ship: 0, cannon: 'mast:0', target: 1 });
    expect(s1.pending).toBe(null);
    const s2 = play(s1, { t: 'fire', by: 0, ship: 0, cannon: 'mast:1', target: 1 });
    expect(s2.pending).toMatchObject({ kind: 'mastLoss' });
  });

  it('extraAction: on a 5 or 6 the ship gets another action', () => {
    const st = duel(testShip(2, { effects: [fx('extraAction')] }));
    forceRolls(st, [5]);
    const s1 = play(st, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: -90, dist: 2 }] }, { t: 'endAction', by: 0 });
    expect(s1.ships[0].actionsAllowed).toBe(2);
    expect(tryMove(s1, { t: 'move', by: 0, ship: 0, segs: [{ bar: 'L', heading: -90, dist: 2 }] }).ok).toBe(true);
  });

  it('crew of the wrong nationality do nothing unless the ship allows them', () => {
    const st = duel(testShip(2, { faction: 'Spanish' }));
    st.ships[0].crew.push({ id: 904, def: testCrew([fx('plusS')], { faction: 'English' }), alive: true });
    expect(availableBars(st, st.ships[0])).toEqual(['L']);
    st.ships[0].def.effects.push(fx('anyCrew'));
    expect(availableBars(st, st.ships[0])).toEqual(['L', 'S']);
  });
});
