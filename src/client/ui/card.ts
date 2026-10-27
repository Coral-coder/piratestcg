// Our own card layout for ships, crew and treasure (no scans of printed cards).
import { cargoCapacity, cargoUsed, crewKeywords, describe, isCovered, isDerelict, type CardDef, type GameState, type Ship } from '../../engine';
import { factionColors } from '../content';
import { dieFace, h } from './dom';

export function moveText(move: string[]): string {
  return move.join('+');
}

export function cardEl(def: CardDef, opts: { ship?: Ship; state?: GameState; compact?: boolean; onClick?: () => void } = {}): HTMLElement {
  const col = factionColors(def.faction);
  const partial = !isCovered(def);
  const head = h(
    'div',
    { class: 'card-head', style: { background: `linear-gradient(90deg, ${col.trim}, ${col.flag})` } },
    h('span', { class: 'card-name' }, def.name),
    h('span', { class: 'card-pts' }, `${def.points}`),
  );
  const body = h('div', { class: 'card-body' });
  if (def.kind === 'ship') {
    const s = opts.ship;
    const masts = s ? `${s.masts.filter(Boolean).length}/${def.masts}` : `${def.masts}`;
    const cargo = s && opts.state ? `${cargoUsed(opts.state, s)}/${cargoCapacity(opts.state, s)}` : `${def.cargo}`;
    body.append(
      h('div', { class: 'card-stats' },
        h('span', { title: 'Masts' }, '⛵ ', masts),
        h('span', { title: 'Cargo' }, '📦 ', cargo),
        h('span', { title: 'Base move' }, '🧭 ', moveText(def.move)),
      ),
      h('div', { class: 'card-cannons' }, ...def.cannons.map((c, i) => dieFace(Number(c[0]), c[1] as 'S' | 'L', s && !s.masts[i] ? 'lost' : ''))),
    );
  } else {
    const kw = def.kind === 'crew' ? crewKeywords(def) : [];
    body.append(h('div', { class: 'card-kind' }, def.kind === 'crew' ? `Crew${kw.length ? ' · ' + kw.join(', ') : ''}` : 'Unique treasure'));
  }
  const fx = def.effects.map((e) => h('li', {}, describe(e)));
  if (fx.length) body.append(h('ul', { class: 'card-fx' }, ...fx));
  if (partial) body.append(h('div', { class: 'card-partial', title: 'Some of this card’s printed text is not modelled yet.' }, '⚠ partial: some text not modelled yet'));
  if (opts.ship && opts.state && !opts.compact) {
    const s = opts.ship;
    const crew = s.crew.filter((c) => c.alive);
    if (crew.length) body.append(h('div', { class: 'card-crew' }, 'Crew: ', crew.map((c) => c.def.name + (crewKeywords(c.def).length ? ` (${crewKeywords(c.def).join(', ')})` : '')).join(', ')));
    const st: string[] = [];
    if (isDerelict(s)) st.push('Derelict');
    if (s.docked !== null) st.push(`Docked at ${opts.state.islands[s.docked].name}`);
    if (s.pinnedTo !== null) st.push('Pinned');
    if (s.towing !== null) st.push('Towing');
    if (s.uniques.length) st.push(s.uniques.map((id) => opts.state!.coins[id].unique?.name).join(', '));
    if (st.length) body.append(h('div', { class: 'card-status' }, st.join(' · ')));
  }
  const el = h('div', { class: `card ${opts.compact ? 'compact' : ''} ${def.kind}`, style: { borderColor: col.trim }, onClick: opts.onClick }, head, body, h('div', { class: 'card-foot' }, `${def.faction ?? 'Any'} · ${def.id}`));
  return el;
}
