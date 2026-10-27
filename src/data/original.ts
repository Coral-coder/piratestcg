// Original content for this project: our own ships, crew and treasure.
import type { CardDef, CrewDef, Effect, ShipDef, TreasureDef } from '../engine/types';

export const ORIGINAL_FACTIONS = ['Brethren', 'Azure Crown', 'Sunreach', 'Jade Tide'] as const;

let n = 0;
const id = () => `ORG-${String(++n).padStart(3, '0')}`;

function ship(name: string, faction: string, points: number, cargo: number, move: string, cannons: string[], effects: Effect[] = []): ShipDef {
  return { id: id(), kind: 'ship', pack: 'original', name, faction, points, masts: cannons.length, cargo, move: move.split('') as ShipDef['move'], cannons, effects };
}
function crew(name: string, faction: string, points: number, effects: Effect[], links?: string[]): CrewDef {
  return { id: id(), kind: 'crew', pack: 'original', name, faction, points, effects, ...(links ? { links } : {}) };
}
function treasure(name: string, effects: Effect[]): TreasureDef {
  return { id: id(), kind: 'treasure', pack: 'original', name, points: 0, effects };
}

const e = (code: string, extra: Partial<Effect> = {}): Effect => ({ code, ...extra });

export const ORIGINAL_SHIPS: ShipDef[] = [
  // The Brethren: a free company of pirates under crimson sails.
  ship('Crimson Maw', 'Brethren', 14, 4, 'L', ['3S', '2L', '2L', '3S'], [e('boardBonus', { n: 1 })]),
  ship('Widowmaker', 'Brethren', 18, 5, 'L', ['2S', '2L', '3L', '2L', '2S'], [e('clearShot')]),
  ship('Ragged Lantern', 'Brethren', 9, 3, 'L', ['3S', '3L', '3S'], [e('hitKillsCrew')]),
  ship('Gallows Gull', 'Brethren', 6, 3, 'SL', ['3S', '3L'], [e('plusSWhenEmpty')]),
  ship('Sea Jackal', 'Brethren', 5, 2, 'SS', ['3S'], [e('pickpocket')]),
  // The Azure Crown: a disciplined royal navy.
  ship('Sovereign’s Wrath', 'Azure Crown', 17, 4, 'L', ['2S', '3L', '2L', '3L', '2S'], [e('ignoreFirstHit')]),
  ship('Steadfast', 'Azure Crown', 12, 4, 'L', ['3S', '3L', '3L', '3S'], [e('chooseMast')]),
  ship('Lord Halloran', 'Azure Crown', 10, 4, 'L', ['2S', '3L', '2S'], [e('cannonBonusVs', { faction: 'Brethren' })]),
  ship('Kestrel', 'Azure Crown', 7, 2, 'SL', ['3S', '3L'], [e('dockExplore')]),
  ship('Pennant', 'Azure Crown', 5, 2, 'L', ['3S'], [e('derelictMoveS')]),
  // Sunreach: a rich merchant empire that guards its cargo.
  ship('Gilded Sun', 'Sunreach', 15, 7, 'L', ['3S', '3L', '3L', '3S'], [e('treasureBonus', { n: 1 })]),
  ship('Brass Lion', 'Sunreach', 13, 4, 'L', ['3S', '2L', '2L', '3S'], [e('ramImmune')]),
  ship('Amber Dawn', 'Sunreach', 9, 5, 'SS', ['4S', '3L', '4S'], [e('boardBonus', { n: 1 })]),
  ship('Saffron Wind', 'Sunreach', 8, 4, 'SL', ['3L', '3L'], [e('unloadWithinS')]),
  ship('Copper Wren', 'Sunreach', 4, 2, 'SS', ['4S'], [e('cargoPlus')]),
  // The Jade Tide: a far-sailing eastern fleet of junks and sloops.
  ship('Jade Serpent', 'Jade Tide', 15, 4, 'L', ['2S', '3L', '3L', '2S'], [e('extraAction')]),
  ship('Tide Dragon', 'Jade Tide', 12, 3, 'L', ['2S', '2L', '2S'], [e('cannonBonusPerFriendly')]),
  ship('Lotus Moon', 'Jade Tide', 11, 4, 'L', ['3L', '3L', '3L'], [e('longShot')]),
  ship('Paper Tiger', 'Jade Tide', 6, 3, 'SL', ['3S', '4L'], [e('immuneL')]),
  ship('Silk Kite', 'Jade Tide', 5, 2, 'SS', ['3S'], [e('dockExplore')]),
];

const generic: [string, number, Effect[]][] = [
  ['Captain', 3, [e('moveShoot')]],
  ['Helmsman', 2, [e('plusS')]],
  ['Explorer', 1, [e('dockExplore')]],
  ['Cannoneer', 2, [e('rerollMiss')]],
  ['Musketeer', 3, [e('musket')]],
  ['Oarsman', 1, [e('derelictMoveS'), e('noCargoSpace')]],
  ['Shipwright', 2, [e('shipwright')]],
];

export const ORIGINAL_CREW: CrewDef[] = [
  crew('“Red Mag” Corran', 'Brethren', 5, [e('moveShoot'), e('boardBonus', { n: 1 })], ['Old Salt Benno']),
  crew('Old Salt Benno', 'Brethren', 2, [e('shipwright')], ['“Red Mag” Corran']),
  crew('Knife-Eye Tobiah', 'Brethren', 3, [e('pickpocket')]),
  crew('Commodore Ellis Vane', 'Azure Crown', 5, [e('moveShoot'), e('cannonBonusVs', { faction: 'Brethren' })], ['Lt. Harriet Pell']),
  crew('Lt. Harriet Pell', 'Azure Crown', 3, [e('chooseMast')], ['Commodore Ellis Vane']),
  crew('Chaplain Morrow', 'Azure Crown', 2, [e('anyCrew')]),
  crew('Factor Oyelaran', 'Sunreach', 3, [e('treasureBonus', { n: 1 })], ['Navigator Quill']),
  crew('Navigator Quill', 'Sunreach', 2, [e('unloadWithinS')], ['Factor Oyelaran']),
  crew('Quartermaster Ines Ruhl', 'Sunreach', 3, [e('cargoPlus'), e('noCargoSpace')]),
  crew('Admiral Mei Sorrow', 'Jade Tide', 5, [e('moveShoot'), e('extraAction')], ['Wu the Lookout']),
  crew('Wu the Lookout', 'Jade Tide', 1, [e('peekIsland')], ['Admiral Mei Sorrow']),
  crew('Gunner Lan Ho', 'Jade Tide', 3, [e('cannonBonusWithCaptain')]),
  ...['Brethren', 'Azure Crown', 'Sunreach', 'Jade Tide'].flatMap((f) => generic.map(([nm, pts, fx]) => crew(nm, f, pts, fx))),
];

export const ORIGINAL_TREASURE: TreasureDef[] = [
  treasure('Storm Chart', [e('dockExplore')]),
  treasure('Lucky Doubloon', [e('boardBonus', { n: 1 })]),
  treasure('Tellan’s Spyglass', [e('peekCargo')]),
  treasure('Cask of Black Rum', [e('rum')]),
  treasure('Sea-Witch’s Veil', [e('shortenEnemyRange')]),
];

export const ORIGINAL_CARDS: CardDef[] = [...ORIGINAL_SHIPS, ...ORIGINAL_CREW, ...ORIGINAL_TREASURE];
