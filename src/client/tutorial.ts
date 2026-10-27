// Guided first game: a checklist of steps that tick off as you play.
import type { GameEvent, GameState, Move } from '../engine';
import { h } from './ui/dom';

interface Step {
  text: string;
  done: (m: Move, st: GameState, ev: GameEvent[]) => boolean;
}

export const TUTORIAL_STEPS: Step[] = [
  { text: 'Tap your ship (the glowing ring), then tap ⛵ Move.', done: (m) => m.t === 'move' },
  { text: 'Lay rulers towards a wild island until the ghost turns green, then ⛵ Sail to dock.', done: (_m, _s, ev) => ev.some((e) => e.e === 'docked') },
  { text: 'Tap 🔎 Explore and load the best coins. (Your Explorer lets you do it right after docking.)', done: (_m, _s, ev) => ev.some((e) => e.e === 'explored') },
  { text: 'Tap End turn. The enemy moves; then it is your turn again.', done: (m) => m.t === 'endTurn' && m.by === 0 },
  { text: 'Sail home and dock to unload your gold.', done: (_m, _s, ev) => ev.some((e) => e.e === 'unloaded') },
  { text: 'With a ship near the enemy, tap 🎯 Shoot, pick a cannon and tap the target.', done: (_m, _s, ev) => ev.some((e) => e.e === 'shot') },
  { text: 'Keep going: bring home more than half the gold to win!', done: () => false },
];

export class TutorialPanel {
  el: HTMLElement;
  private i = 0;
  constructor(host: HTMLElement) {
    this.el = h('div', { class: 'tutorial' });
    host.append(this.el);
    this.draw();
  }
  get step() {
    return this.i;
  }
  onMove(m: Move, st: GameState, ev: GameEvent[]) {
    while (this.i < TUTORIAL_STEPS.length - 1 && TUTORIAL_STEPS[this.i].done(m, st, ev)) this.i++;
    this.draw();
  }
  private draw() {
    this.el.replaceChildren(
      h('b', {}, `Tutorial ${Math.min(this.i + 1, TUTORIAL_STEPS.length)}/${TUTORIAL_STEPS.length}`),
      h('span', {}, TUTORIAL_STEPS[this.i].text),
      h('button', { class: 'icon-btn small', 'aria-label': 'Hide tutorial', onClick: () => this.el.classList.toggle('collapsed') }, '–'),
    );
  }
  dispose() {
    this.el.remove();
  }
}
