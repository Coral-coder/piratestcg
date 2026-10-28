// Our own card design for ships, crew and treasure. Ship art is rendered
// from the game's own 3D models; crew and treasure get drawn medallions.
import { cargoCapacity, cargoUsed, crewKeywords, describe, isCovered, isDerelict, type CardDef, type GameState, type Ship } from '../../engine';
import { factionColors } from '../content';
import { emblemURL } from '../emblems';
import { dieFace, h } from './dom';
import { shipPortrait } from './portrait';

export function moveText(move: string[]): string {
  return move.join('+');
}

const KEYWORD_GLYPH: Record<string, string> = {
  Captain: '⚓', Explorer: '🧭', Helmsman: '☸', Cannoneer: '💥', Musketeer: '🎯', Oarsman: '🚣', Shipwright: '🔨',
};

const PACK_LABEL: Record<string, string> = { original: 'Original', 'spanish-main': 'Spanish Main', 'forbidden-paradise': 'Forbidden Paradise' };

// Render portraits only when a card scrolls into view.
let observer: IntersectionObserver | null = null;
const pending = new WeakMap<Element, () => void>();
function whenVisible(el: Element, fn: () => void) {
  if (typeof IntersectionObserver === 'undefined') return fn();
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer!.unobserve(e.target);
        pending.get(e.target)?.();
        pending.delete(e.target);
      }
    }, { rootMargin: '200px' });
  }
  pending.set(el, fn);
  observer.observe(el);
}

function artFor(def: CardDef): HTMLElement {
  const col = factionColors(def.faction);
  const art = h('div', { class: 'card-art', style: { background: `radial-gradient(ellipse at 50% 35%, #fdf3da 0%, ${col.sail}55 55%, ${col.trim}aa 100%)` } });
  if (def.kind === 'ship') {
    const sea = h('div', { class: 'card-sea' });
    const img = h('img', { class: 'card-ship', alt: '', draggable: 'false' }) as HTMLImageElement;
    art.append(sea, img);
    whenVisible(art, () => {
      void shipPortrait(def).then((url) => {
        if (url) img.src = url;
        else img.remove();
      });
    });
  } else if (def.kind === 'crew') {
    const kw = crewKeywords(def);
    art.append(
      h('div', { class: 'medallion', style: { background: `radial-gradient(circle at 35% 30%, ${col.flag}, ${col.trim})` } },
        h('img', { class: 'medal-emblem', src: emblemURL(def.faction, '#ffffff33', 96), alt: '' }),
        h('span', { class: 'medal-glyph' }, KEYWORD_GLYPH[kw[0]] ?? '⚔'),
      ),
    );
  } else {
    art.append(h('div', { class: 'medallion treasure' }, h('span', { class: 'medal-glyph' }, '🗝')));
  }
  return art;
}

export function cardEl(def: CardDef, opts: { ship?: Ship; state?: GameState; compact?: boolean; onClick?: () => void } = {}): HTMLElement {
  const col = factionColors(def.faction);
  const partial = !isCovered(def);
  const s = opts.ship;
  const head = h(
    'div',
    { class: 'card-head' },
    h('img', { class: 'card-emblem', src: emblemURL(def.faction, '#f6ecd0', 64), alt: def.faction ?? '' }),
    h('span', { class: 'card-name' }, def.name),
    h('span', { class: 'card-pts', title: 'Point cost' }, String(def.points)),
  );
  const art = artFor(def);
  if (def.kind === 'ship') {
    const masts = s ? `${s.masts.filter(Boolean).length}/${def.masts}` : `${def.masts}`;
    const cargo = s && opts.state ? `${cargoUsed(opts.state, s)}/${cargoCapacity(opts.state, s)}` : `${def.cargo}`;
    art.append(
      h('div', { class: 'card-stats' },
        h('span', { class: 'stat', title: 'Masts' }, h('i', { class: 'ico mast' }), masts),
        h('span', { class: 'stat', title: 'Cargo' }, h('i', { class: 'ico cargo' }), cargo),
        h('span', { class: 'stat', title: 'Base move' }, h('i', { class: 'ico move' }), moveText(def.move)),
      ),
    );
  }
  const body = h('div', { class: 'card-body' });
  if (def.kind === 'ship') body.append(h('div', { class: 'card-cannons', title: 'Cannons, bow to stern' }, ...def.cannons.map((c, i) => dieFace(Number(c[0]), c[1] as 'S' | 'L', s && !s.masts[i] ? 'lost' : ''))));
  else {
    const kw = def.kind === 'crew' ? crewKeywords(def) : [];
    body.append(h('div', { class: 'card-kind' }, def.kind === 'crew' ? (kw.length ? kw.join(' · ') : 'Crew') : 'Unique treasure'));
  }
  const text = h('div', { class: 'card-text' });
  if (def.effects.length) for (const e of def.effects) text.append(h('p', {}, describe(e)));
  else text.append(h('p', { class: 'flavor' }, def.kind === 'ship' ? 'A sturdy ship with no special tricks.' : 'No special ability.'));
  if (partial) text.append(h('p', { class: 'card-partial', title: 'Some of this card’s printed text is not modelled yet.' }, '⚠ partly modelled'));
  body.append(text);
  if (s && opts.state && !opts.compact) {
    const crew = s.crew.filter((c) => c.alive);
    if (crew.length) body.append(h('div', { class: 'card-crew' }, '👥 ', crew.map((c) => c.def.name + (crewKeywords(c.def).length ? ` (${crewKeywords(c.def).join(', ')})` : '')).join(', ')));
    const st: string[] = [];
    if (isDerelict(s)) st.push('Derelict');
    if (s.docked !== null) st.push(`Docked at ${opts.state.islands[s.docked].name}`);
    if (s.pinnedTo !== null) st.push('Pinned');
    if (s.towing !== null) st.push('Towing');
    if (s.uniques.length) st.push(s.uniques.map((id) => opts.state!.coins[id].unique?.name).join(', '));
    if (st.length) body.append(h('div', { class: 'card-status' }, st.join(' · ')));
  }
  return h(
    'div',
    {
      class: `card ${opts.compact ? 'compact' : ''} ${def.kind}`,
      style: { '--fc': col.trim, '--ff': col.flag } as unknown as Partial<CSSStyleDeclaration>,
      onClick: opts.onClick,
      role: opts.onClick ? 'button' : undefined,
      tabindex: opts.onClick ? '0' : undefined,
    },
    head,
    art,
    body,
    h('div', { class: 'card-foot' }, h('span', {}, def.faction ?? 'Any'), h('span', {}, `${PACK_LABEL[def.pack] ?? def.pack} · ${def.id}`)),
  );
}
