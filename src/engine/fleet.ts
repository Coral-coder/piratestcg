import { IMPLEMENTED } from './abilities';
import { seedRng, shuffle } from './rng';
import type { CardDef, CrewDef, Fleet, FleetEntry, ShipDef, TreasureDef } from './types';

export interface Catalog {
  ships: ShipDef[];
  crew: CrewDef[];
  treasure: TreasureDef[];
  byId: Map<string, CardDef>;
}

export function makeCatalog(cards: CardDef[]): Catalog {
  const byId = new Map<string, CardDef>();
  for (const c of cards) byId.set(c.id, c);
  return {
    ships: cards.filter((c): c is ShipDef => c.kind === 'ship'),
    crew: cards.filter((c): c is CrewDef => c.kind === 'crew'),
    treasure: cards.filter((c): c is TreasureDef => c.kind === 'treasure'),
    byId,
  };
}

/** Fully supported: every part of the card is modelled by the engine. */
export function isCovered(c: CardDef): boolean {
  return !c.unsupported?.length && c.effects.every((e) => IMPLEMENTED.has(e.code));
}

function crewAllowedOn(ship: ShipDef, crew: CrewDef, others: CrewDef[]): boolean {
  if (!crew.faction || crew.faction === ship.faction) return true;
  if (ship.effects.some((e) => e.code === 'anyCrew' || (e.code === 'allowCrew' && e.faction === crew.faction))) return true;
  return others.some((o) => o.effects.some((e) => e.code === 'anyCrew'));
}

export function crewCosts(crew: CrewDef[]): number[] {
  const discounters = crew.filter((c) => c.effects.some((e) => e.code === 'crewDiscount'));
  return crew.map((c) => {
    const discount = discounters.some((d) => d !== c) ? 1 : 0;
    return Math.max(0, c.points - discount);
  });
}

export function entryCost(cat: Catalog, e: FleetEntry): number {
  const ship = cat.byId.get(e.ship);
  if (!ship) return 0;
  const crew = e.crew.map((id) => cat.byId.get(id)).filter((c): c is CrewDef => !!c && c.kind === 'crew');
  return ship.points + crewCosts(crew).reduce((a, b) => a + b, 0);
}

export function fleetCost(cat: Catalog, f: Fleet): number {
  return f.ships.reduce((a, e) => a + entryCost(cat, e), 0);
}

export function crewSlots(ship: ShipDef, crew: CrewDef[]): number {
  let cap = ship.cargo;
  if ([...ship.effects, ...crew.flatMap((c) => c.effects)].some((e) => e.code === 'cargoPlus')) cap += 1;
  for (const a of crew) for (const b of crew) if (a !== b && a.links?.includes(b.name)) return cap + 1;
  return cap;
}

/** Problems with a fleet, empty when it is legal. */
export function validateFleet(cat: Catalog, f: Fleet, limit: number): string[] {
  const errs: string[] = [];
  if (f.ships.length === 0) errs.push('A fleet needs at least one ship.');
  const total = fleetCost(cat, f);
  if (total > limit) errs.push(`Fleet costs ${total} points; the limit is ${limit}.`);
  for (const e of f.ships) {
    const ship = cat.byId.get(e.ship);
    if (!ship || ship.kind !== 'ship') {
      errs.push(`Unknown ship ${e.ship}.`);
      continue;
    }
    const crew = e.crew.map((id) => cat.byId.get(id)).filter((c): c is CrewDef => !!c && c.kind === 'crew');
    if (crew.length !== e.crew.length) errs.push(`${ship.name}: unknown crew.`);
    const crewPts = crewCosts(crew).reduce((a, b) => a + b, 0);
    if (crewPts > ship.points) errs.push(`${ship.name}: crew cost ${crewPts}, more than the ship's ${ship.points}.`);
    const spaceTakers = crew.filter((c) => !c.effects.some((x) => x.code === 'noCargoSpace')).length;
    if (spaceTakers > crewSlots(ship, crew)) errs.push(`${ship.name}: not enough cargo space for that crew.`);
    for (const c of crew) if (!crewAllowedOn(ship, c, crew)) errs.push(`${ship.name}: ${c.name} is ${c.faction} and cannot serve on a ${ship.faction} ship.`);
  }
  return errs;
}

/** A random legal fleet for quick play, built from covered cards only. */
export function quickFleet(cat: Catalog, limit: number, seed: number, opts: { faction?: string; packs?: string[]; name?: string } = {}): Fleet {
  const rng = seedRng(seed);
  const okPack = (c: CardDef) => !opts.packs || opts.packs.includes(c.pack);
  let ships = cat.ships.filter((s) => isCovered(s) && okPack(s) && s.masts <= 5 && s.cannons.length > 0);
  if (opts.faction) ships = ships.filter((s) => s.faction === opts.faction);
  ships = shuffle(rng, [...ships]);
  const crewPool = cat.crew.filter((c) => isCovered(c) && okPack(c));
  const fleet: Fleet = { name: opts.name ?? 'Quick fleet', ships: [] };
  let left = limit;
  // Prefer two to four ships.
  for (const s of ships) {
    if (fleet.ships.length >= 4) break;
    if (s.points > left - (fleet.ships.length === 0 ? 4 : 0)) continue;
    // Keep the first pick affordable so there is room for more ships.
    if (fleet.ships.length === 0 && s.points > limit * 0.6) continue;
    fleet.ships.push({ ship: s.id, crew: [] });
    left -= s.points;
  }
  if (fleet.ships.length === 0 && ships.length) {
    const cheapest = [...ships].sort((a, b) => a.points - b.points || (a.id < b.id ? -1 : 1))[0];
    fleet.ships.push({ ship: cheapest.id, crew: [] });
    left = limit - cheapest.points;
  }
  // Add crew with what is left, favouring useful keywords.
  const useful = ['moveShoot', 'dockExplore', 'plusS', 'rerollMiss', 'shipwright'];
  for (let pass = 0; pass < 3 && left > 0; pass++) {
    for (const e of fleet.ships) {
      const ship = cat.byId.get(e.ship) as ShipDef;
      const cands = shuffle(
        rng,
        crewPool.filter((c) => c.faction === ship.faction && c.effects.some((x) => useful.includes(x.code))),
      );
      for (const c of cands) {
        const trial = { ...e, crew: [...e.crew, c.id] };
        const cost = entryCost(cat, trial) - entryCost(cat, e);
        if (cost > left) continue;
        const errs = validateFleet(cat, { name: '', ships: [trial] }, 999);
        if (errs.length) continue;
        if (trial.crew.length > 2) continue;
        e.crew.push(c.id);
        left -= cost;
        break;
      }
    }
  }
  return fleet;
}
