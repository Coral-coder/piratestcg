import './style.css';
import { createGame, quickFleet, type Fleet, type GameState, type ShipDef, type TreasureDef, isCovered } from '../engine';
import { runAssembly } from './assembly';
import { getCatalog, syncContent } from './content';
import { GameScreen } from './game/screen';
import { getSettings } from './settings';
import { TutorialPanel } from './tutorial';
import { toast } from './ui/dom';
import { builderScreen, coverageScreen, howtoScreen, legalScreen, quickScreen, settingsScreen, titleScreen, type Nav } from './ui/menus';

const app = document.getElementById('app')!;
let cleanup: (() => void) | null = null;

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

function pickUnique(seed: number): TreasureDef | null {
  const pool = getCatalog().treasure.filter((t) => isCovered(t));
  return pool.length ? pool[seed % pool.length] : null;
}

function show(el: HTMLElement) {
  cleanup?.();
  cleanup = null;
  app.replaceChildren(el);
  window.scrollTo(0, 0);
}

function startGame(state: GameState, opts: { tutorial?: boolean } = {}) {
  cleanup?.();
  app.replaceChildren();
  let tut: TutorialPanel | null = null;
  const gs = new GameScreen(app, {
    state,
    onExit: () => nav.go('title'),
    onMove: (m, st, ev) => tut?.onMove(m, st, ev),
    passiveBot: opts.tutorial ? () => (tut ? tut.step < 4 : false) : undefined,
  });
  if (opts.tutorial) tut = new TutorialPanel(gs.root);
  cleanup = () => {
    tut?.dispose();
    gs.dispose();
  };
}

function buildState(fleet: Fleet | null, points: number, faction?: string): GameState {
  const cat = getCatalog();
  const seed = randomSeed();
  const mine = fleet ?? quickFleet(cat, points, seed ^ 0x51, { faction, name: 'Your fleet' });
  const foeFactions = [...new Set(cat.ships.filter((s) => isCovered(s) && s.faction).map((s) => s.faction!))].sort();
  const foe = quickFleet(cat, points, seed ^ 0x77, { faction: foeFactions[seed % foeFactions.length], name: 'Enemy fleet' });
  return createGame({ seed, fleets: [mine, foe], points, names: ['You', 'The enemy'] }, cat, { uniques: [pickUnique(seed), pickUnique(seed >>> 3)] });
}

const nav: Nav = {
  go(screenName: string) {
    switch (screenName) {
      case 'quick': return show(quickScreen(nav));
      case 'builder': return show(builderScreen(nav));
      case 'settings': return show(settingsScreen(nav));
      case 'howto': return show(howtoScreen(nav));
      case 'legal': return show(legalScreen(nav));
      case 'coverage': return show(coverageScreen(nav));
      case 'tutorial': {
        const cat = getCatalog();
        const kestrel = cat.ships.find((s) => s.name === 'Kestrel')!;
        const steadfast = cat.ships.find((s) => s.name === 'Steadfast')!;
        const explorer = cat.crew.find((c) => c.name === 'Explorer' && c.faction === 'Azure Crown')!;
        const captain = cat.crew.find((c) => c.name === 'Captain' && c.faction === 'Azure Crown')!;
        const foe = quickFleet(cat, 20, 99, { faction: 'Brethren' });
        const seed = 20251;
        const st = createGame({ seed, points: 20, names: ['You', 'The enemy'], fleets: [{ name: 'Tutorial', ships: [{ ship: kestrel.id, crew: [explorer.id] }, { ship: steadfast.id, crew: [captain.id] }] }, foe] }, cat);
        st.active = 0;
        return startGame(st, { tutorial: true });
      }
      default:
        return show(titleScreen(nav));
    }
  },
  play(fleet, opts) {
    let st: GameState;
    try {
      st = buildState(fleet, opts.points, opts.faction);
    } catch (e) {
      toast(String((e as Error).message), 'bad');
      return;
    }
    const mine = st.ships.filter((s) => s.owner === 0).map((s) => s.def as ShipDef);
    if (opts.assemble && mine.length) {
      cleanup?.();
      app.replaceChildren();
      cleanup = runAssembly(app, mine, () => {
        cleanup = null;
        startGame(st);
      });
    } else startGame(st);
  },
};

async function boot() {
  try {
    if (getSettings().forbiddenParadise) await syncContent();
  } catch {
    toast('Could not load the optional pack; playing without it.', 'bad');
  }
  nav.go('title');
}
void boot();
