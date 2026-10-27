// Menus: title, quick play, fleet builder, settings, how to play, legal, coverage.
import {
  crewKeywords,
  entryCost,
  fleetCost,
  isCovered,
  quickFleet,
  validateFleet,
  type CardDef,
  type CrewDef,
  type Fleet,
  type ShipDef,
} from '../../engine';
import { EXTRA_PACK, getCatalog, packList, syncContent } from '../content';
import { getSettings, loadJSON, saveJSON, setSettings, type Settings } from '../settings';
import { cardEl } from './card';
import { clear, h, modal, toast } from './dom';

export interface Nav {
  go: (screen: string, arg?: unknown) => void;
  play: (fleet: Fleet | null, opts: { points: number; faction?: string; assemble: boolean }) => void;
}

const FLEETS_KEY = 'potsm.fleets.v1';
export const savedFleets = (): Fleet[] => loadJSON<Fleet[]>(FLEETS_KEY, []);
const saveFleets = (f: Fleet[]) => saveJSON(FLEETS_KEY, f);

function screen(title: string, nav: Nav, ...body: (Node | string)[]): HTMLElement {
  return h('div', { class: 'screen' }, h('header', { class: 'screen-head' }, h('button', { class: 'icon-btn', 'aria-label': 'Back', onClick: () => nav.go('title') }, '←'), h('h1', {}, title)), h('div', { class: 'screen-body' }, ...body));
}

export function titleScreen(nav: Nav): HTMLElement {
  return h(
    'div',
    { class: 'title-screen' },
    h('div', { class: 'title-art', 'aria-hidden': 'true' }, h('div', { class: 'sun' }), h('div', { class: 'title-ship' }, '⛵')),
    h('h1', { class: 'logo' }, 'Pirates', h('small', {}, 'of the Spanish Main')),
    h('p', { class: 'tag' }, 'Build your fleet. Hunt the treasure. Sink the rest.'),
    h(
      'nav',
      { class: 'menu' },
      h('button', { class: 'btn primary big', onClick: () => nav.go('quick') }, '⚓ Quick play'),
      h('button', { class: 'btn big', onClick: () => nav.go('builder') }, '🛠 Fleet builder'),
      h('button', { class: 'btn big', onClick: () => nav.go('howto') }, '📖 How to play'),
      h('button', { class: 'btn big', onClick: () => nav.go('settings') }, '⚙ Settings'),
    ),
    h('footer', { class: 'title-foot' }, h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); nav.go('legal'); } }, 'Unofficial fan project — legal notice'), ' · ', h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); nav.go('coverage'); } }, 'Card coverage'), ' · v', __APP_VERSION__),
  );
}

function factionsByPack(): { pack: string; name: string; factions: string[] }[] {
  const cat = getCatalog();
  return packList().map((p) => ({
    pack: p.id,
    name: p.name,
    factions: [...new Set(cat.ships.filter((s) => s.pack === p.id && isCovered(s) && s.faction).map((s) => s.faction!))].sort(),
  }));
}

export function quickScreen(nav: Nav): HTMLElement {
  const s = getSettings();
  let points = s.points;
  let choice: string = 'random';
  let assemble = true;
  const fleets = savedFleets();
  const pts = h('div', { class: 'seg' });
  const drawPts = () => {
    clear(pts);
    for (const p of [20, 30, 40, 50]) pts.append(h('button', { class: `btn ${p === points ? 'primary' : ''}`, onClick: () => { points = p; setSettings({ points: p }); drawPts(); } }, `${p} pts`));
  };
  drawPts();
  const list = h('div', { class: 'choices' });
  const drawList = () => {
    clear(list);
    const item = (key: string, label: string, sub = '') =>
      list.append(h('button', { class: `choice ${choice === key ? 'sel' : ''}`, onClick: () => { choice = key; drawList(); } }, h('b', {}, label), sub ? h('small', {}, sub) : null));
    item('random', '🎲 Random fleet', 'Any faction, any pack');
    for (const g of factionsByPack()) for (const f of g.factions) item(`faction:${f}`, f, g.name);
    fleets.forEach((f, i) => item(`saved:${i}`, `⭐ ${f.name}`, `${fleetCost(getCatalog(), f)} pts saved fleet`));
  };
  drawList();
  const asm = h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: true, onChange: (e: Event) => (assemble = (e.target as HTMLInputElement).checked) }), ' Build my ships before battle (snap the pieces together)');
  const start = h('button', { class: 'btn primary big', onClick: () => {
    if (choice.startsWith('saved:')) {
      const f = fleets[Number(choice.slice(6))];
      const errs = validateFleet(getCatalog(), f, points);
      if (errs.length) return void toast(errs[0], 'bad', 3500);
      nav.play(f, { points, assemble });
    } else nav.play(null, { points, faction: choice.startsWith('faction:') ? choice.slice(8) : undefined, assemble });
  } }, '⚔ Set sail');
  return screen('Quick play', nav, h('h3', {}, 'Point limit'), pts, h('h3', {}, 'Your fleet'), list, asm, start);
}

// ------------------------------------------------------------------ fleet builder

export function builderScreen(nav: Nav, editIndex: number | null = null): HTMLElement {
  const cat = getCatalog();
  const fleets = savedFleets();
  let fleet: Fleet = editIndex !== null && fleets[editIndex] ? structuredClone(fleets[editIndex]) : { name: 'My fleet', ships: [] };
  let limit = getSettings().points;
  let pack = 'all';
  let faction = 'all';
  let query = '';
  let crewFor: number | null = null;
  const left = h('div', { class: 'builder-cat' });
  const right = h('div', { class: 'builder-fleet' });

  const filters = h('div', { class: 'filters' });
  const packSel = h('select', { onChange: (e: Event) => { pack = (e.target as HTMLSelectElement).value; draw(); } }, h('option', { value: 'all' }, 'All packs'), ...packList().map((p) => h('option', { value: p.id }, p.name)));
  const facSel = h('select', { onChange: (e: Event) => { faction = (e.target as HTMLSelectElement).value; draw(); } }, h('option', { value: 'all' }, 'All factions'), ...[...new Set(cat.ships.map((s) => s.faction ?? ''))].filter(Boolean).sort().map((f) => h('option', { value: f }, f)));
  const search = h('input', { type: 'search', placeholder: 'Search…', onInput: (e: Event) => { query = (e.target as HTMLInputElement).value.toLowerCase(); draw(); } });
  filters.append(packSel, facSel, search);

  const ok = (c: CardDef) => (pack === 'all' || c.pack === pack) && (faction === 'all' || c.faction === faction) && (!query || c.name.toLowerCase().includes(query));

  function addShip(s: ShipDef) {
    fleet.ships.push({ ship: s.id, crew: [] });
    crewFor = fleet.ships.length - 1;
    draw();
  }
  function addCrew(c: CrewDef) {
    if (crewFor === null) return;
    const e = fleet.ships[crewFor];
    const trial = { ...e, crew: [...e.crew, c.id] };
    const errs = validateFleet(cat, { name: '', ships: [trial] }, 999);
    if (errs.length) return void toast(errs[0], 'bad', 3000);
    e.crew.push(c.id);
    draw();
  }

  function draw() {
    clear(left);
    clear(right);
    // Catalog side.
    if (crewFor !== null && fleet.ships[crewFor]) {
      const ship = cat.byId.get(fleet.ships[crewFor].ship) as ShipDef;
      left.append(h('div', { class: 'builder-mode' }, `Adding crew to ${ship.name}`, h('button', { class: 'btn small', onClick: () => { crewFor = null; draw(); } }, 'Back to ships')));
      const crew = cat.crew.filter((c) => ok(c) && (c.faction === ship.faction || ship.effects.some((e) => e.code === 'anyCrew' || (e.code === 'allowCrew' && e.faction === c.faction))));
      const grid = h('div', { class: 'card-grid' });
      for (const c of crew.slice(0, 120)) grid.append(cardEl(c, { compact: true, onClick: () => addCrew(c) }));
      left.append(grid);
    } else {
      const grid = h('div', { class: 'card-grid' });
      for (const s of cat.ships.filter(ok).slice(0, 160)) grid.append(cardEl(s, { compact: true, onClick: () => addShip(s) }));
      left.append(grid);
    }
    // Fleet side.
    const cost = fleetCost(cat, fleet);
    const errs = validateFleet(cat, fleet, limit);
    const limitSel = h('select', { onChange: (e: Event) => { limit = Number((e.target as HTMLSelectElement).value); setSettings({ points: limit }); draw(); } }, ...[20, 30, 40, 50, 60].map((p) => h('option', { value: String(p), selected: p === limit }, `${p} pts`)));
    right.append(
      h('div', { class: 'fleet-head' }, h('input', { class: 'fleet-name', value: fleet.name, onChange: (e: Event) => (fleet.name = (e.target as HTMLInputElement).value) }), limitSel),
      h('div', { class: `points ${cost > limit ? 'over' : ''}` }, h('b', {}, `${cost}`), ` / ${limit} points`, h('div', { class: 'bar' }, h('i', { style: { width: `${Math.min(100, (cost / limit) * 100)}%` } }))),
    );
    fleet.ships.forEach((e, i) => {
      const s = cat.byId.get(e.ship) as ShipDef | undefined;
      if (!s) return;
      const crew = e.crew.map((id) => cat.byId.get(id) as CrewDef).filter(Boolean);
      right.append(
        h('div', { class: `fleet-ship ${crewFor === i ? 'sel' : ''}` },
          h('div', { class: 'fs-top' }, h('b', {}, s.name), h('span', {}, ` ${entryCost(cat, e)} pts`), h('button', { class: 'icon-btn small', 'aria-label': 'Remove ship', onClick: () => { fleet.ships.splice(i, 1); crewFor = null; draw(); } }, '✕')),
          h('div', { class: 'fs-crew' }, ...crew.map((c, k) => h('span', { class: 'chip' }, c.name + (crewKeywords(c).length ? ` (${crewKeywords(c).join(',')})` : ''), h('button', { 'aria-label': 'Remove crew', onClick: () => { e.crew.splice(k, 1); draw(); } }, '×'))), h('button', { class: 'btn small', onClick: () => { crewFor = i; draw(); } }, '+ crew')),
        ),
      );
    });
    if (!fleet.ships.length) right.append(h('p', { class: 'hint' }, 'Tap ships on the left to add them.'));
    for (const e of errs) right.append(h('div', { class: 'warn' }, e));
    right.append(
      h('div', { class: 'fleet-actions' },
        h('button', { class: 'btn', onClick: () => { fleet = quickFleet(cat, limit, (Date.now() & 0xffffff) >>> 0, { faction: faction === 'all' ? undefined : faction, name: fleet.name }); crewFor = null; draw(); } }, '🎲 Fill for me'),
        h('button', { class: 'btn', onClick: () => save() }, '💾 Save'),
        h('button', { class: 'btn primary', disabled: errs.length > 0, onClick: () => { save(); nav.play(fleet, { points: limit, assemble: true }); } }, '⚔ Play'),
      ),
    );
    if (fleets.length) {
      right.append(h('h3', {}, 'Saved fleets'));
      fleets.forEach((f, i) => right.append(h('div', { class: 'saved' }, h('button', { class: 'linkish', onClick: () => { fleet = structuredClone(f); editIndex = i; draw(); } }, `${f.name} (${fleetCost(cat, f)} pts)`), h('button', { class: 'icon-btn small', 'aria-label': 'Delete fleet', onClick: () => { fleets.splice(i, 1); saveFleets(fleets); if (editIndex === i) editIndex = null; draw(); } }, '🗑'))));
    }
  }
  function save() {
    if (editIndex !== null && fleets[editIndex]) fleets[editIndex] = structuredClone(fleet);
    else {
      fleets.push(structuredClone(fleet));
      editIndex = fleets.length - 1;
    }
    saveFleets(fleets);
    toast('Fleet saved.', 'good');
    draw();
  }
  draw();
  return screen('Fleet builder', nav, h('div', { class: 'builder' }, h('div', { class: 'builder-left' }, filters, left), right));
}

// ------------------------------------------------------------------ settings

export function settingsScreen(nav: Nav): HTMLElement {
  const s = getSettings();
  const row = (label: string, control: HTMLElement, note = '') => h('div', { class: 'setting' }, h('div', {}, h('b', {}, label), note ? h('small', {}, note) : null), control);
  const toggle = (key: keyof Settings, after?: () => void) =>
    h('input', { type: 'checkbox', class: 'switch', checked: Boolean(s[key]), onChange: (e: Event) => { setSettings({ [key]: (e.target as HTMLInputElement).checked } as Partial<Settings>); after?.(); } });
  const select = (key: keyof Settings, opts: [string, string][]) => h('select', { onChange: (e: Event) => setSettings({ [key]: (e.target as HTMLSelectElement).value } as Partial<Settings>) }, ...opts.map(([v, l]) => h('option', { value: v, selected: s[key] === v }, l)));
  const fp = toggle('forbiddenParadise', async () => {
    try {
      await syncContent();
      toast(getSettings().forbiddenParadise ? `${EXTRA_PACK.name} pack loaded.` : `${EXTRA_PACK.name} pack removed.`, 'good');
    } catch (e) {
      setSettings({ forbiddenParadise: false });
      (fp as HTMLInputElement).checked = false;
      toast(String((e as Error).message), 'bad');
    }
  });
  return screen(
    'Settings',
    nav,
    row('Forbidden Paradise', fp, 'Adds an optional fan pack of extra ships and crew, downloaded only when switched on. Our own models and art throughout.'),
    row('Graphics', select('quality', [['auto', 'Auto'], ['low', 'Low (phones)'], ['high', 'High']])),
    row('Sound', toggle('sound')),
    row('Auto-pick lost masts', toggle('autoMasts'), 'When your ship is hit, drop its weakest cannon for you.'),
    row('Computer speed', select('botSpeed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']])),
    h('button', { class: 'btn', onClick: () => modal('Reset saved data?', h('p', {}, 'This clears your saved fleets and settings on this device.'), [{ label: 'Cancel', onClick: () => undefined }, { label: 'Reset', primary: true, onClick: () => { try { localStorage.clear(); } catch { /* */ } location.reload(); } }]) }, 'Reset saved data'),
  );
}

// ------------------------------------------------------------------ how to play

export function howtoScreen(nav: Nav): HTMLElement {
  const sec = (t: string, ...p: string[]) => h('section', { class: 'rules' }, h('h3', {}, t), ...p.map((x) => h('p', { html: x })));
  return screen(
    'How to play',
    nav,
    h('button', { class: 'btn primary big', onClick: () => nav.go('tutorial') }, '🧭 Start the guided tutorial'),
    sec('Goal', 'Bring <b>more than half</b> of all the gold on the table back to your <b>home island</b>. Gold lies face down on the wild islands.'),
    sec('Your turn', 'Each ship gets <b>one action</b>: <b>move</b>, <b>shoot</b>, <b>explore</b> or <b>repair</b>. Ships with a glowing ring can still act. Tap <b>End turn</b> when you are done.'),
    sec('Moving', 'Ships move with rulers laid from the bow: <b>S</b> is 3 inches (white), <b>L</b> is 6 inches (red). A ship with S+L uses both, turning between them. Tap <b>Move</b>, then drag on the sea: the fan shows your reach and the ghost ship shows where you will end. A green ghost means you will dock.'),
    sec('Treasure', 'Dock at a wild island, then <b>Explore</b> to look at the coins and load what fits in your hold. An <b>Explorer</b> crew lets you dock and explore in one action. Dock at home to unload and score.'),
    sec('Shooting', 'Each mast has a cannon die like <b>3S</b>: roll a d6, <b>3 or more</b> hits, out to S range (L cannons reach 6"). A 1 always misses. Each hit knocks down a mast. A ship with no masts is <b>derelict</b>; one more hit sinks her.'),
    sec('Ramming and boarding', 'If your bow touches an enemy after moving you may <b>ram</b>: roll higher than her masts to break one. Then you may <b>board</b>: both roll a d6 + masts, and the winner steals treasure or kills a crew.'),
    sec('Crew', '<b>Captain</b>: move and shoot in one action. <b>Explorer</b>: dock and explore at once. <b>Helmsman</b>: +S move. <b>Cannoneer</b>: re-fire a miss. <b>Musketeer</b>: an extra 3S gun. <b>Oarsman</b>: row a derelict. <b>Shipwright</b>: repair anywhere.'),
    sec('Camera', 'Drag to orbit, pinch or scroll to zoom, two fingers (or right mouse) to pan.'),
    h('p', {}, h('a', { href: 'https://github.com/Coral-coder/piratestcg/blob/main/docs/rules.md', target: '_blank', rel: 'noopener' }, 'Full rules with sources')),
  );
}

export function legalScreen(nav: Nav): HTMLElement {
  return screen(
    'Legal notice',
    nav,
    h('p', {}, 'This is an unofficial, free, non-commercial fan project. It is not affiliated with, endorsed by, or sponsored by WizKids, NECA, The Walt Disney Company or any of their partners.'),
    h('p', {}, '“Pirates of the Spanish Main” and the Pirates constructible strategy game are trademarks of their respective owners. Card names and statistics are used for fan play only. Ability text is written fresh for this project.'),
    h('p', {}, 'All 3D models, sounds and art here were made for this project in code. No scans of printed cards or studio art are used or hosted.'),
    h('p', {}, 'Source code: MIT licence. Built with three.js (MIT).'),
    h('p', {}, 'If you are a rights holder and want something changed, please open an issue on the project page.'),
  );
}

export function coverageScreen(nav: Nav): HTMLElement {
  const cat = getCatalog();
  const rows = packList().map((p) => {
    const cards = [...cat.ships, ...cat.crew, ...cat.treasure].filter((c) => c.pack === p.id);
    const ok = cards.filter(isCovered).length;
    return h('tr', {}, h('td', {}, p.name), h('td', {}, String(cards.length)), h('td', {}, `${ok} (${cards.length ? Math.round((ok / cards.length) * 100) : 0}%)`));
  });
  return screen(
    'Card coverage',
    nav,
    h('p', {}, 'A card is fully modelled when the engine plays every part of its text. Partial cards are still playable and are marked ⚠ in the fleet builder.'),
    h('table', { class: 'cov' }, h('thead', {}, h('tr', {}, h('th', {}, 'Pack'), h('th', {}, 'Cards'), h('th', {}, 'Fully modelled'))), h('tbody', {}, ...rows)),
  );
}
