// Card content: the built-in packs, plus the optional pack that is only
// downloaded after the player switches it on in Settings.
import { BUILTIN_CARDS, fetchExtraPack, PACKS } from '../data';
import { makeCatalog, type CardDef, type Catalog } from '../engine';
import { getSettings } from './settings';

let extra: CardDef[] | null = null;
let catalog: Catalog = makeCatalog(BUILTIN_CARDS);

export const EXTRA_PACK = { id: 'forbidden-paradise', file: 'forbidden-paradise.json', name: 'Forbidden Paradise' };

export function getCatalog(): Catalog {
  return catalog;
}

export function packList() {
  return extra ? [...PACKS, { id: EXTRA_PACK.id, name: EXTRA_PACK.name, note: 'Optional fan pack.' }] : PACKS;
}

/** Load or unload the optional pack to match the setting. */
export async function syncContent(): Promise<void> {
  if (getSettings().forbiddenParadise) {
    if (!extra) extra = await fetchExtraPack(document.baseURI, EXTRA_PACK.file, EXTRA_PACK.id);
    catalog = makeCatalog([...BUILTIN_CARDS, ...extra]);
  } else {
    extra = null;
    catalog = makeCatalog(BUILTIN_CARDS);
  }
}

export const FACTION_COLORS: Record<string, { sail: string; trim: string; flag: string }> = {
  Pirate: { sail: '#2d2a2a', trim: '#1b1b1b', flag: '#111111' },
  English: { sail: '#f3efe4', trim: '#9b1c24', flag: '#c8102e' },
  Spanish: { sail: '#efe0b8', trim: '#a8811c', flag: '#f1bf00' },
  French: { sail: '#f4f1ea', trim: '#1d3f8f', flag: '#1d3f8f' },
  American: { sail: '#f2f2f2', trim: '#203a7a', flag: '#203a7a' },
  Brethren: { sail: '#8c2b2b', trim: '#3a1414', flag: '#b3262c' },
  'Azure Crown': { sail: '#e3ecf7', trim: '#2a5aa8', flag: '#2a5aa8' },
  Sunreach: { sail: '#e2b259', trim: '#7a4b12', flag: '#d98e04' },
  'Jade Tide': { sail: '#5aa889', trim: '#1c4a3a', flag: '#2e8b6a' },
};

export function factionColors(f?: string) {
  return (f && FACTION_COLORS[f]) || { sail: '#e8e2d0', trim: '#5b4632', flag: '#777' };
}

/** Owner streamers: you and the computer. */
export const PLAYER_COLORS = ['#2ec4b6', '#ff5a5f'];
