import type { CardDef } from '../engine/types';
import { ORIGINAL_CARDS } from './original';
import spanishMain from './spanish-main.json';

type RawCard = Omit<CardDef, 'pack'> & { pack?: string };

export function withPack(cards: RawCard[], pack: string): CardDef[] {
  return cards.map((c) => ({ ...c, pack, effects: c.effects ?? [] }) as CardDef);
}

export const SPANISH_MAIN_CARDS: CardDef[] = withPack(spanishMain as unknown as RawCard[], 'spanish-main');

/** Content that ships with the site. */
export const BUILTIN_CARDS: CardDef[] = [...ORIGINAL_CARDS, ...SPANISH_MAIN_CARDS];

export const PACKS: { id: string; name: string; note: string }[] = [
  { id: 'original', name: 'Original Fleets', note: 'Our own ships, crews and treasure.' },
  { id: 'spanish-main', name: 'Spanish Main', note: 'Ship names and stats from the 2004 first set.' },
];

/** Optional pack, fetched only after the player turns on the setting. */
export async function fetchExtraPack(baseUrl: string, file: string, pack: string): Promise<CardDef[]> {
  const res = await fetch(new URL(`packs/${file}`, baseUrl).toString());
  if (!res.ok) throw new Error(`Could not load the pack (${res.status}).`);
  return withPack((await res.json()) as RawCard[], pack);
}
