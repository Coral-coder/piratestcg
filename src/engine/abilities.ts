import type { CrewDef, CrewInst, Effect, GameState, Ship } from './types';

/**
 * Effect codes the engine implements. The coverage report checks every card
 * against this list; anything else on a card is reported as unsupported.
 */
export const IMPLEMENTED = new Set([
  'moveShoot',
  'dockExplore',
  'plusS',
  'plusSWhenEmpty',
  'plusLWhenFull',
  'plusSWithCaptain',
  'plusLWithCaptain',
  'slowWhenLoaded',
  'rerollMiss',
  'musket',
  'derelictMoveS',
  'noCargoSpace',
  'shipwright',
  'boardBonus',
  'boardBonusVs',
  'cannonBonusVs',
  'cannonBonusVsNot',
  'cannonBonusWithCaptain',
  'cannonBonusPerFriendly',
  'cannonAura',
  'immuneL',
  'clearShot',
  'doubleHit',
  'chooseMast',
  'ignoreFirstHit',
  'ramImmune',
  'extraAction',
  'doubleAction',
  'sinksAtZero',
  'misfire',
  'hitKillsCrew',
  'hitKillsCargo',
  'raidHome',
  'crewImmortal',
  'cargoPlus',
  'unloadWithinS',
  'allLRange',
  'anyCrew',
  'allowCrew',
  'cantLoadLast',
  'unpinnable',
  'pinKillsCrew',
  'fixedCannons',
  'pickpocket',
  'repairOnSink',
  'salvager',
  'armored',
  'weakVs',
  'longShot',
  'treasureBonus',
  'shortenEnemyRange',
  'crewDiscount',
  'plunder',
  'peekIsland',
  'peekCargo',
  'noShootLoaded',
  'greedyBoarder',
  'rum',
  'canRam',
]);

/** Keyword names for the crew abilities the rulebook names. */
export const KEYWORDS: Record<string, string> = {
  moveShoot: 'Captain',
  dockExplore: 'Explorer',
  plusS: 'Helmsman',
  rerollMiss: 'Cannoneer',
  musket: 'Musketeer',
  derelictMoveS: 'Oarsman',
  shipwright: 'Shipwright',
};

export function crewKeywords(def: CrewDef): string[] {
  const out: string[] = [];
  for (const e of def.effects) {
    const k = KEYWORDS[e.code];
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Can this crew use its abilities on this ship? (nationality rule) */
export function crewAllowed(ship: Ship, crew: CrewDef): boolean {
  if (!crew.faction || crew.faction === ship.def.faction) return true;
  for (const e of ship.def.effects) {
    if (e.code === 'anyCrew') return true;
    if (e.code === 'allowCrew' && e.faction === crew.faction) return true;
  }
  // A crew granting "any nationality" (e.g. a chaplain) opens the ship to all.
  for (const c of ship.crew) if (c.alive && c.def.effects.some((e) => e.code === 'anyCrew')) return true;
  return false;
}

export function activeCrew(ship: Ship): CrewInst[] {
  return ship.crew.filter((c) => c.alive && crewAllowed(ship, c.def));
}

/** All effects on a ship: printed, crew and face-up unique treasure. Identical
 * effects from different sources do not stack. */
export function effectsOf(state: GameState, ship: Ship): Effect[] {
  const all: Effect[] = [...ship.def.effects];
  for (const c of activeCrew(ship)) all.push(...c.def.effects);
  for (const id of ship.uniques) {
    const coin = state.coins[id];
    if (coin && coin.unique && !coin.gone) all.push(...coin.unique.effects);
  }
  const seen = new Set<string>();
  const out: Effect[] = [];
  for (const e of all) {
    const k = e.code + '|' + (e.n ?? '') + '|' + (e.faction ?? '');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

export function has(state: GameState, ship: Ship, code: string): boolean {
  return effectsOf(state, ship).some((e) => e.code === code);
}

export function find(state: GameState, ship: Ship, code: string): Effect[] {
  return effectsOf(state, ship).filter((e) => e.code === code);
}

export function hasCaptain(ship: Ship): boolean {
  return activeCrew(ship).some((c) => c.def.effects.some((e) => e.code === 'moveShoot'));
}

/** Plain-language description of an effect, written for this project. */
export function describe(e: Effect): string {
  const f = e.faction ?? '';
  switch (e.code) {
    case 'moveShoot': return 'Captain: may move and shoot in the same action.';
    case 'dockExplore': return 'Explorer: may dock and explore a wild island in the same action.';
    case 'plusS': return 'Helmsman: +S to base move.';
    case 'plusSWhenEmpty': return '+S to base move while carrying no treasure.';
    case 'plusLWhenFull': return '+L to base move while all masts stand.';
    case 'plusSWithCaptain': return '+S to base move with a Captain aboard.';
    case 'plusLWithCaptain': return '+L to base move with a Captain aboard.';
    case 'slowWhenLoaded': return 'Base move drops to S when the hold is full.';
    case 'rerollMiss': return 'Cannoneer: once a turn, a cannon that misses fires again.';
    case 'musket': return 'Musketeer: adds a 3S cannon that fires from any mast, even a lost one.';
    case 'derelictMoveS': return 'Oarsman: if derelict, the ship can still move S.';
    case 'noCargoSpace': return 'Takes no cargo space.';
    case 'shipwright': return 'Shipwright: may repair at sea or at any island.';
    case 'boardBonus': return `+${e.n ?? 1} to boarding rolls.`;
    case 'boardBonusVs': return `+1 to boarding rolls against ${f} ships.`;
    case 'cannonBonusVs': return `+1 to cannon rolls against ${f} ships.`;
    case 'cannonBonusVsNot': return `+1 to cannon rolls against non-${f} ships.`;
    case 'cannonBonusWithCaptain': return '+1 to cannon rolls with a Captain aboard.';
    case 'cannonBonusPerFriendly': return '+1 to cannon rolls for each friendly ship within S.';
    case 'cannonAura': return 'Friendly ships within S get +1 to cannon rolls.';
    case 'immuneL': return 'Cannons firing at L range cannot hit her.';
    case 'clearShot': return 'Other ships do not block her line of fire.';
    case 'doubleHit': return 'Each hit takes two masts.';
    case 'chooseMast': return 'When she hits, you pick the mast that falls.';
    case 'ignoreFirstHit': return 'Ignores the first hit each turn while all masts stand.';
    case 'ramImmune': return 'Ramming cannot take her masts.';
    case 'extraAction': return 'Once a turn, roll a d6: on 5–6 she gets an extra action.';
    case 'doubleAction': return 'Once a turn, roll a d6: on 5–6 she may repeat the same action.';
    case 'sinksAtZero': return 'Sinks the moment her last mast falls.';
    case 'misfire': return 'Loses a mast whenever she rolls a 1 on a cannon roll.';
    case 'hitKillsCrew': return 'Once a turn, a hit also kills one enemy crew.';
    case 'hitKillsCargo': return 'A hit also throws one enemy cargo overboard.';
    case 'raidHome': return 'May dock at an enemy home island and take one treasure.';
    case 'crewImmortal': return 'Her crew cannot be eliminated unless she sinks.';
    case 'cargoPlus': return '+1 cargo space.';
    case 'unloadWithinS': return 'May unload when within S of home.';
    case 'allLRange': return 'All her cannons have L range.';
    case 'anyCrew': return 'Crew of any nationality work aboard.';
    case 'allowCrew': return `${f} crew work aboard.`;
    case 'cantLoadLast': return 'Cannot take the last treasure from an island.';
    case 'unpinnable': return 'Cannot be pinned.';
    case 'pinKillsCrew': return 'When she rams and pins, one enemy crew is lost.';
    case 'fixedCannons': return 'Her cannons stay when masts fall (none while derelict).';
    case 'pickpocket': return 'Once a turn, takes a random treasure from a ship she touches.';
    case 'repairOnSink': return 'Repairs a mast when she sinks a ship.';
    case 'salvager': return 'Claims any derelict she explores and tows it home.';
    case 'armored': return 'Two hits in one shoot action are needed to take a mast.';
    case 'weakVs': return `${f} ships get +1 to cannon rolls against her.`;
    case 'longShot': return 'May double cannon range, but then needs a 6 to hit.';
    case 'treasureBonus': return `One treasure is worth +${e.n ?? 1} gold when unloaded.`;
    case 'shortenEnemyRange': return 'Enemy cannons reach her only at S range.';
    case 'crewDiscount': return 'Other crew on her cost 1 point less.';
    case 'plunder': return `May take as much treasure as she can carry from a touching ${f} ship.`;
    case 'peekIsland': return 'Once a turn, may look at one hidden treasure on an island.';
    case 'peekCargo': return 'Once a turn, may look at one hidden cargo on a ship.';
    case 'noShootLoaded': return 'Cannot shoot while carrying treasure.';
    case 'greedyBoarder': return 'Wins at boarding take as much treasure as she can carry.';
    case 'rum': return 'Rum: worth 6 minus her crew when loaded; she rests the next turn.';
    case 'moveAfterUnload': return 'Once a turn, may move S after unloading.';
    case 'canRam': return 'Any ship may ram.';
    default: return 'Special ability.';
  }
}
