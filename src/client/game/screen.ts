// The game screen: owns the engine state, the 3D world and the HUD, and
// turns taps and drags into engine moves.
import * as THREE from 'three';
import {
  applyMove,
  barLen,
  botMove,
  cargoFree,
  datan2,
  dir,
  hitChance,
  isDerelict,
  normDeg,
  pendingOptions,
  resolveMove,
  score,
  shipOptions,
  toAct,
  hull,
  distPointPoly,
  MAX_TURN,
  type Bar,
  type GameEvent,
  type GameState,
  type Move,
  type MoveResult,
  type Segment,
  type Ship,
} from '../../engine';
import { sfx } from '../audio';
import { getSettings } from '../settings';
import { cardEl } from '../ui/card';
import { clear, dieFace, h, modal, toast } from '../ui/dom';
import { basic, buildShip, poseShip } from './models';
import { World } from './world';

const HUMAN = 0;
const BOT = 1;

type Mode = 'idle' | 'move' | 'shoot' | 'explore';

export interface GameScreenOptions {
  state: GameState;
  onExit: () => void;
  /** Called after every applied move (the tutorial listens). */
  onMove?: (m: Move, st: GameState, ev: GameEvent[]) => void;
  /** Hide the bot's moves (tutorial uses a passive opponent). */
  passiveBot?: () => boolean;
}

interface MovePlan {
  ship: number;
  segs: Segment[];
  bar: Bar;
  current: Segment | null;
  preview: MoveResult | null;
}

export class GameScreen {
  root: HTMLElement;
  world: World;
  state: GameState;
  private mode: Mode = 'idle';
  private selected: number | null = null;
  private plan: MovePlan | null = null;
  private cannon: string | null = null;
  private busy = false;
  private dragging = false;
  private downAt: { x: number; y: number; t: number } | null = null;
  private ghost: THREE.Group | null = null;
  private top: HTMLElement;
  private sheet: HTMLElement;
  private endBtn: HTMLButtonElement;
  private labels: HTMLElement;
  private dice: HTMLElement;
  private logEl: HTMLElement;
  private alive = true;
  private labelEls: { el: HTMLElement; pos: THREE.Vector3 }[] = [];

  constructor(private host: HTMLElement, private opts: GameScreenOptions) {
    this.state = opts.state;
    this.root = h('div', { class: 'game' });
    host.append(this.root);
    const stage = h('div', { class: 'stage' });
    this.root.append(stage);
    this.world = new World(stage);
    this.world.setTable(this.state, HUMAN);
    this.world.syncShips(this.state);
    this.world.syncTreasure(this.state, HUMAN);
    this.labels = h('div', { class: 'labels' });
    this.top = h('div', { class: 'topbar' });
    this.sheet = h('div', { class: 'sheet' });
    this.dice = h('div', { class: 'dice-tray' });
    this.logEl = h('div', { class: 'log hidden' });
    this.endBtn = h('button', { class: 'end-turn', onClick: () => this.endTurn() }, 'End turn') as HTMLButtonElement;
    this.root.append(this.labels, this.top, this.dice, this.logEl, this.sheet, this.endBtn);
    this.bindInput(stage);
    this.world.onFrame = () => this.frame();
    this.refresh();
    void this.pump();
    // Test hook (used by the Playwright checks): lets a script inspect state
    // and hand the human side to the bot.
    (window as unknown as { __pirates?: unknown }).__pirates = this;
  }

  /** When set, the bot also plays the human side (for automated playtests). */
  autoHuman = false;

  // ------------------------------------------------------------------ state

  private get myTurn() {
    return !this.state.over && toAct(this.state) === HUMAN;
  }

  private async apply(m: Move): Promise<boolean> {
    const r = applyMove(this.state, m);
    if (!r.ok) {
      toast(r.error ?? 'Not allowed.', 'bad');
      return false;
    }
    this.state = r.state;
    this.busy = true;
    this.refresh();
    await this.animate(r.events);
    if (!this.alive) return true;
    this.world.syncShips(this.state);
    this.world.syncTreasure(this.state, HUMAN);
    this.busy = false;
    this.opts.onMove?.(m, this.state, r.events);
    this.refresh();
    void this.pump();
    return true;
  }

  /** Run the bot and automatic choices until the human has something to do. */
  private pumping = false;
  private async pump() {
    if (this.pumping || this.busy || !this.alive) return;
    this.pumping = true;
    try {
      while (this.alive && !this.state.over) {
        const who = toAct(this.state);
        if (who === BOT || this.autoHuman) {
          await this.world.wait(this.botDelay());
          if (!this.alive) return;
          let m = botMove(this.state, who);
          if (who === BOT && this.opts.passiveBot?.() && !this.state.pending) m = { t: 'endTurn', by: BOT };
          this.focusFor(m);
          const ok = await this.applyQuiet(m);
          if (!ok) await this.applyQuiet(this.state.current ? { t: 'endAction', by: who } : { t: 'endTurn', by: who });
          continue;
        }
        // Human: auto-resolve mast choices if the setting asks for it.
        const p = this.state.pending;
        if (p && p.kind === 'mastLoss' && getSettings().autoMasts) {
          await this.applyQuiet(botMove(this.state, HUMAN));
          continue;
        }
        break;
      }
    } finally {
      this.pumping = false;
    }
    if (this.state.over) this.showEnd();
    this.refresh();
  }

  private async applyQuiet(m: Move): Promise<boolean> {
    const r = applyMove(this.state, m);
    if (!r.ok) return false;
    this.state = r.state;
    this.busy = true;
    this.refresh();
    await this.animate(r.events);
    if (!this.alive) return true;
    this.world.syncShips(this.state);
    this.world.syncTreasure(this.state, HUMAN);
    this.busy = false;
    this.opts.onMove?.(m, this.state, r.events);
    return true;
  }

  private botDelay() {
    const s = getSettings().botSpeed;
    return s === 'fast' ? 0.15 : s === 'slow' ? 0.9 : 0.45;
  }

  private focusFor(m: Move) {
    if ('ship' in m) {
      const s = this.state.ships[m.ship];
      if (s && (m.t === 'move' || m.t === 'fire')) {
        const p = this.world.project(new THREE.Vector3(s.x, 0, s.y));
        const r = this.world.renderer.domElement.getBoundingClientRect();
        if (!p.visible || p.x < 0 || p.y < 0 || p.x > r.width || p.y > r.height) this.world.focus(s.x, s.y);
      }
    }
  }

  // ------------------------------------------------------------------ animation

  private async animate(events: GameEvent[]) {
    for (const e of events) {
      if (!this.alive) return;
      switch (e.e) {
        case 'moved':
          await this.world.sail(e.ship, e.path);
          break;
        case 'shot':
          await this.animShot(e);
          break;
        case 'mastLost':
          sfx.crack();
          await this.world.dropMast(e.ship, e.mast);
          break;
        case 'sunk':
          sfx.splash();
          this.float(this.world.shipCenter(e.ship), 'Sunk!', 'bad');
          await this.world.sink(e.ship);
          break;
        case 'derelict':
          this.float(this.world.shipCenter(e.ship), 'Derelict', 'bad');
          break;
        case 'unloaded':
          sfx.coin();
          this.float(this.world.shipCenter(e.ship), `+${e.gold} gold`, 'good');
          this.world.syncTreasure(this.state, HUMAN);
          await this.world.wait(0.4);
          break;
        case 'explored':
          sfx.coin();
          this.float(this.world.shipCenter(e.ship), e.took.length ? `Loaded ${e.took.length}` : 'Explored', 'good');
          this.world.syncTreasure(this.state, HUMAN);
          break;
        case 'ram':
          sfx.hit();
          this.world.shake(e.target);
          this.showDice([e.roll], e.hit ? 'Ram hits!' : 'Ram glances off', e.hit);
          await this.world.wait(0.7);
          break;
        case 'board':
          sfx.dice();
          this.showDice(e.rolls, `Boarding ${e.totals[0]} vs ${e.totals[1]}`, this.state.ships[e.winner].owner === HUMAN);
          await this.world.wait(1.0);
          break;
        case 'crewLost':
          this.float(this.world.shipCenter(e.ship), 'Crew lost', 'bad');
          break;
        case 'extraAction':
          if (e.granted) this.float(this.world.shipCenter(e.ship), `Rolled ${e.roll}: extra action!`, 'good');
          break;
        case 'towed':
          this.float(this.world.shipCenter(e.target), 'In tow', 'info');
          break;
        case 'turn':
          sfx.bell();
          this.banner(e.player === HUMAN ? 'Your turn' : 'Enemy turn');
          break;
        case 'docked':
          sfx.snap();
          break;
        case 'info':
          this.float(this.world.shipCenter(this.state.current?.ship ?? 0), e.text, 'info');
          break;
        default:
          break;
      }
    }
  }

  private async animShot(e: Extract<GameEvent, { e: 'shot' }>) {
    const from = new THREE.Vector3(e.from.x, 0.9, e.from.y);
    const to = this.world.shipCenter(e.target);
    sfx.cannon();
    this.world.fx.muzzle(from);
    this.showDice([e.roll], `${e.hit ? 'HIT' : 'Miss'} (needs ${Math.max(2, e.need)}+)`, e.hit);
    const target = e.hit ? to : to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, -0.4, (Math.random() - 0.5) * 2));
    await new Promise<void>((done) => this.world.fx.shoot(from, target, done));
    if (e.hit) {
      sfx.hit();
      this.world.fx.hitAt(to);
    } else {
      sfx.splash();
      this.world.fx.splashAt(target.setY(0));
    }
    await this.world.wait(0.25);
  }

  private showDice(rolls: number[], text: string, good: boolean) {
    clear(this.dice);
    const faces = rolls.map((r) => dieFace(r, null, 'rolling'));
    this.dice.append(h('div', { class: 'dice-row' }, ...faces), h('div', { class: `dice-text ${good ? 'good' : 'bad'}` }, text));
    this.dice.classList.add('show');
    let n = 0;
    const iv = setInterval(() => {
      n++;
      faces.forEach((f, i) => {
        f.querySelector('b')!.textContent = String(n < 6 ? 1 + Math.floor(Math.random() * 6) : rolls[i]);
        if (n >= 6) f.classList.remove('rolling');
      });
      if (n >= 6) clearInterval(iv);
    }, 60);
    clearTimeout((this.dice as unknown as { _t?: number })._t);
    (this.dice as unknown as { _t?: number })._t = window.setTimeout(() => this.dice.classList.remove('show'), 1800);
  }

  private float(pos: THREE.Vector3, text: string, kind: 'good' | 'bad' | 'info') {
    const el = h('div', { class: `float ${kind}` }, text);
    this.labels.append(el);
    const item = { el, pos: pos.clone().add(new THREE.Vector3(0, 1.5, 0)) };
    this.labelEls.push(item);
    setTimeout(() => {
      el.remove();
      this.labelEls = this.labelEls.filter((x) => x !== item);
    }, 1600);
  }

  private banner(text: string) {
    const el = h('div', { class: 'banner' }, text);
    this.root.append(el);
    setTimeout(() => el.remove(), 1300);
  }

  private frame() {
    for (const l of this.labelEls) {
      const p = this.world.project(l.pos);
      l.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      l.el.style.display = p.visible ? '' : 'none';
    }
    // Pulse the selected ring.
    const t = performance.now() / 1000;
    for (const [id, v] of this.world.ships) {
      const m = v.ring.material as THREE.MeshBasicMaterial;
      if (id === this.selected) m.opacity = 0.6 + 0.4 * Math.sin(t * 6);
    }
  }

  // ------------------------------------------------------------------ input

  private bindInput(stage: HTMLElement) {
    const el = this.world.renderer.domElement;
    el.addEventListener('pointerdown', (ev) => {
      sfx.unlock();
      this.downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() };
      if (this.mode === 'move' && this.plan && this.myTurn && !this.busy) {
        const pk = this.world.pick(ev.clientX, ev.clientY);
        if (pk.point && this.nearReach(pk.point)) {
          this.dragging = true;
          this.world.controls.enabled = false;
          el.setPointerCapture(ev.pointerId);
          this.aimAt(pk.point);
        }
      }
    });
    el.addEventListener('pointermove', (ev) => {
      if (!this.dragging) return;
      const pk = this.world.pick(ev.clientX, ev.clientY);
      if (pk.point) this.aimAt(pk.point);
    });
    const up = (ev: PointerEvent) => {
      const d = this.downAt;
      this.downAt = null;
      if (this.dragging) {
        this.dragging = false;
        this.world.controls.enabled = true;
        this.renderSheet();
        return;
      }
      if (!d) return;
      const moved = Math.hypot(ev.clientX - d.x, ev.clientY - d.y);
      if (moved > 8 || performance.now() - d.t > 600) return; // that was a camera drag
      this.tap(ev.clientX, ev.clientY);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', () => {
      this.dragging = false;
      this.world.controls.enabled = true;
    });
    void stage;
  }

  private tap(x: number, y: number) {
    const pk = this.world.pick(x, y);
    if (this.mode === 'shoot' && pk.ship !== null && this.selected !== null) {
      const t = this.state.ships[pk.ship];
      if (t.owner !== HUMAN) {
        this.fireAt(pk.ship);
        return;
      }
    }
    if (pk.ship !== null) {
      this.select(pk.ship);
      return;
    }
    if (pk.island !== null && this.mode === 'idle') {
      this.showIsland(pk.island);
      return;
    }
    if (this.mode === 'idle') this.select(null);
  }

  private select(id: number | null) {
    if (this.mode === 'move' || this.mode === 'shoot') this.cancelMode();
    this.selected = id;
    if (id !== null) {
      const s = this.state.ships[id];
      const p = this.world.project(new THREE.Vector3(s.x, 0, s.y));
      const r = this.world.renderer.domElement.getBoundingClientRect();
      // Keep the ship clear of the action sheet at the bottom.
      if (!p.visible || p.y > r.height * 0.5 || p.y < 60 || p.x < 20 || p.x > r.width - 20) this.world.focusAbove(s.x, s.y);
    }
    this.refresh();
  }

  private cancelMode() {
    this.mode = 'idle';
    this.plan = null;
    this.cannon = null;
    this.clearOverlay();
  }

  private clearOverlay() {
    const o = this.world.overlay;
    while (o.children.length) o.remove(o.children[0]);
    this.ghost = null;
  }

  // ------------------------------------------------------------------ moving

  private startMove(id: number) {
    const s = this.state.ships[id];
    const o = shipOptions(this.state, s);
    if (!o.bars.length) {
      toast(o.pinned ? 'Pinned: she cannot move until the enemy moves away.' : 'This ship cannot move.', 'bad');
      return;
    }
    this.mode = 'move';
    const bars = [...o.bars].sort((a, b) => (a === b ? 0 : a === 'L' ? -1 : 1));
    this.plan = { ship: id, segs: [], bar: bars[0], current: null, preview: null };
    this.drawMoveOverlay();
    this.renderSheet();
    toast('Drag from the bow to lay the ruler. Release, then Sail.', 'info', 2600);
  }

  private remainingBars(): Bar[] {
    if (!this.plan) return [];
    const s = this.state.ships[this.plan.ship];
    const pool = [...shipOptions(this.state, s).bars];
    for (const seg of this.plan.segs) pool.splice(pool.indexOf(seg.bar), 1);
    return pool;
  }

  /** Pose where the next ruler starts. */
  private segStart(): { x: number; y: number; heading: number; first: boolean } {
    const s = this.state.ships[this.plan!.ship];
    if (!this.plan!.segs.length) return { x: s.x, y: s.y, heading: s.heading, first: true };
    const r = resolveMove(this.state, s, this.plan!.segs);
    const f = r.final;
    return { x: f.x, y: f.y, heading: f.heading, first: false };
  }

  private nearReach(p: THREE.Vector3): boolean {
    const st = this.segStart();
    return Math.hypot(p.x - st.x, p.z - st.y) < barLen(this.plan!.bar) + 2.5;
  }

  private aimAt(p: THREE.Vector3) {
    const plan = this.plan!;
    const ship = this.state.ships[plan.ship];
    const st = this.segStart();
    let tx = p.x;
    let ty = p.z;
    // Snap to an island under the pointer: aim for its centre so the ship docks.
    for (const isl of this.state.islands) {
      if (Math.hypot(tx - isl.x, ty - isl.y) < isl.r + 0.8 && (isl.home === null || isl.home === HUMAN)) {
        tx = isl.x;
        ty = isl.y;
      }
    }
    // Snap to an enemy ship under the pointer (to ram).
    for (const o of this.state.ships) {
      if (o.sunk || o.owner === HUMAN) continue;
      if (distPointPoly({ x: tx, y: ty }, hull(o)) < 0.5) {
        const c = hull(o).reduce((a, q) => ({ x: a.x + q.x / 5, y: a.y + q.y / 5 }), { x: 0, y: 0 });
        tx = c.x;
        ty = c.y;
      }
    }
    let heading = datan2(ty - st.y, tx - st.x);
    const leaving = st.first && ship.docked !== null;
    if (!leaving) {
      const d = normDeg(heading - st.heading);
      if (d > MAX_TURN) heading = normDeg(st.heading + MAX_TURN);
      if (d < -MAX_TURN) heading = normDeg(st.heading - MAX_TURN);
    }
    const len = barLen(plan.bar);
    let dist = Math.min(len, Math.hypot(tx - st.x, ty - st.y));
    if (dist > len * 0.9) dist = len;
    dist = Math.max(0.2, Math.round(dist * 20) / 20);
    plan.current = { bar: plan.bar, heading: Math.round(heading * 10) / 10, dist };
    plan.preview = resolveMove(this.state, ship, [...plan.segs, plan.current]);
    if (!plan.preview.ok) {
      // Snap to the nearest legal heading or length, so the ruler never just refuses.
      let best: { seg: Segment; res: MoveResult; d: number } | null = null;
      for (const off of [4, -4, 8, -8, 12, -12, 18, -18, 25, -25, 35, -35, 45, -45]) {
        for (const dd of [dist, len]) {
          const hh = normDeg(heading + off);
          if (!leaving && Math.abs(normDeg(hh - st.heading)) > MAX_TURN) continue;
          const seg = { bar: plan.bar, heading: Math.round(hh * 10) / 10, dist: dd };
          const res = resolveMove(this.state, ship, [...plan.segs, seg]);
          if (!res.ok) continue;
          const d = Math.hypot(res.final.x - tx, res.final.y - ty) + Math.abs(off) * 0.02;
          if (!best || d < best.d) best = { seg, res, d };
        }
        if (best) break;
      }
      if (best) {
        plan.current = best.seg;
        plan.preview = best.res;
      }
    }
    this.drawMoveOverlay();
  }

  private addSegment() {
    const plan = this.plan!;
    if (!plan.current || !plan.preview?.ok) return;
    plan.segs.push(plan.current);
    plan.current = null;
    sfx.snap();
    const rest = this.remainingBars();
    if (rest.length && !plan.preview.contact && plan.preview.dockedAt === this.state.ships[plan.ship].docked) {
      plan.bar = rest.includes('L') ? 'L' : rest[0];
    }
    this.drawMoveOverlay();
    this.renderSheet();
  }

  private async sail() {
    const plan = this.plan;
    if (!plan) return;
    const segs = plan.current && plan.preview?.ok ? [...plan.segs, plan.current] : plan.segs;
    if (!segs.length) {
      toast('Lay a ruler first: drag from the bow.', 'bad');
      return;
    }
    this.mode = 'idle';
    this.plan = null;
    this.clearOverlay();
    await this.apply({ t: 'move', by: HUMAN, ship: plan.ship, segs });
  }

  private drawMoveOverlay() {
    this.clearOverlay();
    const plan = this.plan;
    if (!plan) return;
    const ship = this.state.ships[plan.ship];
    const o = this.world.overlay;
    const st = this.segStart();
    const len = barLen(plan.bar);
    const leaving = st.first && ship.docked !== null;
    const color = plan.bar === 'L' ? '#e53935' : '#ffffff';
    // Reach fan.
    const span = leaving ? Math.PI * 2 : (MAX_TURN * 2 * Math.PI) / 180;
    const fanGeo = new THREE.CircleGeometry(len, 40, 0, span);
    fanGeo.rotateX(-Math.PI / 2);
    const fan = new THREE.Mesh(fanGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }));
    fan.position.set(st.x, 0.06, st.y);
    // CircleGeometry starts at +x and sweeps toward -z after rotateX; align it to the heading.
    fan.rotation.y = leaving ? 0 : (-(st.heading - MAX_TURN) * Math.PI) / 180;
    fan.scale.z = -1;
    fan.renderOrder = 3;
    o.add(fan);
    const edge = new THREE.Mesh(new THREE.RingGeometry(len - 0.06, len, 48, 1, 0, span).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    edge.position.copy(fan.position);
    edge.rotation.y = fan.rotation.y;
    edge.scale.z = -1;
    o.add(edge);
    // Committed rulers.
    let px = ship.x;
    let py = ship.y;
    for (const seg of plan.segs) {
      const f = dir(seg.heading);
      this.addRuler(px, py, seg.heading, seg.dist, seg.bar, 0.9);
      px += f.x * seg.dist;
      py += f.y * seg.dist;
    }
    if (plan.current) this.addRuler(st.x, st.y, plan.current.heading, plan.current.dist, plan.current.bar, 0.95);
    // Ghost at the resolved end.
    const pv = plan.preview;
    if (pv) {
      const g = buildShip({ ...ship, masts: ship.masts });
      const okColor = !pv.ok ? '#ff4d4d' : pv.dockedAt !== null && pv.dockedAt !== ship.docked ? '#5cff8d' : pv.contact?.kind === 'ship' ? '#ffb84d' : '#ffffff';
      g.group.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) m.material = new THREE.MeshBasicMaterial({ color: okColor, transparent: true, opacity: 0.35, depthWrite: false });
      });
      poseShip(g.group, pv.final.x, pv.final.y, pv.final.heading);
      o.add(g.group);
      this.ghost = g.group;
      // Path line.
      const pts = pv.path.map((p) => new THREE.Vector3(p.x, 0.12, p.y));
      if (pts.length > 1) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: okColor }));
        o.add(line);
      }
    }
  }

  private addRuler(x: number, y: number, heading: number, dist: number, bar: Bar, opacity: number) {
    const g = new THREE.BoxGeometry(dist, 0.06, 0.32);
    g.translate(dist / 2, 0, 0);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: bar === 'L' ? '#d32f2f' : '#f5f5f5', transparent: true, opacity }));
    m.position.set(x, 0.14, y);
    m.rotation.y = (-heading * Math.PI) / 180;
    this.world.overlay.add(m);
    // Tick marks every inch.
    for (let i = 1; i < dist; i++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.32), basic(bar === 'L' ? '#ffffff' : '#333333'));
      const f = dir(heading);
      t.position.set(x + f.x * i, 0.15, y + f.y * i);
      t.rotation.y = m.rotation.y;
      this.world.overlay.add(t);
    }
  }

  // ------------------------------------------------------------------ shooting

  private startShoot(id: number) {
    const s = this.state.ships[id];
    const opts = shipOptions(this.state, s);
    if (!opts.fire.length) {
      toast('No enemy in range and line of fire.', 'bad');
      return;
    }
    this.mode = 'shoot';
    this.cannon = opts.fire[0].cannon.id;
    this.drawShootOverlay();
    this.renderSheet();
  }

  private drawShootOverlay() {
    this.clearOverlay();
    if (this.selected === null) return;
    const s = this.state.ships[this.selected];
    const o = this.world.overlay;
    const fire = shipOptions(this.state, s).fire;
    const cannons = new Map(fire.map((f) => [f.cannon.id, f.cannon]));
    for (const c of cannons.values()) {
      const sel = c.id === this.cannon;
      for (const p of c.from.slice(0, c.musket ? 1 : 1)) {
        const r = (c.bar === 'L' ? 6 : 3) * (fire.find((f) => f.cannon.id === c.id)?.long ? 2 : 1);
        const ring = new THREE.Mesh(new THREE.RingGeometry(r - (sel ? 0.08 : 0.04), r, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: c.bar === 'L' ? '#ff5252' : '#ffffff', transparent: true, opacity: sel ? 0.8 : 0.25, depthWrite: false }));
        ring.position.set(p.x, 0.07, p.y);
        o.add(ring);
      }
    }
    // Target markers.
    for (const f of fire.filter((x) => x.cannon.id === this.cannon)) {
      const t = f.target;
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.45, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffeb3b', transparent: true, opacity: 0.9, depthWrite: false }));
      const c = this.world.shipCenter(t.id);
      ring.position.set(c.x, 0.08, c.z);
      o.add(ring);
    }
  }

  private async fireAt(target: number) {
    if (this.selected === null) return;
    const s = this.state.ships[this.selected];
    const fire = shipOptions(this.state, s).fire.filter((f) => f.target.id === target);
    if (!fire.length) {
      toast('No cannon can reach that ship.', 'bad');
      return;
    }
    const pick = fire.find((f) => f.cannon.id === this.cannon) ?? [...fire].sort((a, b) => hitChance(b.need, b.bonus, b.long) - hitChance(a.need, a.bonus, a.long))[0];
    this.clearOverlay();
    const ok = await this.apply({ t: 'fire', by: HUMAN, ship: s.id, cannon: pick.cannon.id, target, long: pick.long || undefined });
    if (!ok) return;
    const left = this.selected !== null && !this.state.ships[this.selected].sunk ? shipOptions(this.state, this.state.ships[this.selected]).fire : [];
    if (left.length && this.state.current?.ship === s.id) {
      this.cannon = left[0].cannon.id;
      this.mode = 'shoot';
      this.drawShootOverlay();
    } else this.mode = 'idle';
    this.renderSheet();
  }

  // ------------------------------------------------------------------ HUD

  private refresh() {
    if (!this.alive) return;
    this.renderTop();
    this.renderRings();
    this.renderSheet();
    this.endBtn.style.display = this.myTurn && !this.state.pending ? '' : 'none';
    const left = this.state.ships.filter((s) => s.owner === HUMAN && !s.sunk && shipOptions(this.state, s).canStart && (shipOptions(this.state, s).bars.length || shipOptions(this.state, s).fire.length)).length;
    this.endBtn.textContent = left ? `End turn (${left} can act)` : 'End turn ▶';
    this.endBtn.classList.toggle('pulse', left === 0);
    this.endBtn.disabled = this.busy;
  }

  private renderTop() {
    const st = this.state;
    const need = Math.floor(st.startingGold / 2) + 1;
    clear(this.top);
    const who = st.over ? 'Game over' : toAct(st) === HUMAN ? (st.pending ? 'Your choice' : 'Your turn') : 'Enemy turn';
    this.top.append(
      h('button', { class: 'icon-btn', 'aria-label': 'Menu', onClick: () => this.menu() }, '☰'),
      h('div', { class: 'score you' }, h('b', {}, String(score(st, HUMAN))), h('span', {}, ' gold')),
      h('div', { class: 'turninfo' }, h('div', {}, who), h('small', {}, `Round ${Math.ceil(st.turn / 2)} · ${need} gold wins`)),
      h('div', { class: 'score foe' }, h('b', {}, String(score(st, BOT))), h('span', {}, ' gold')),
      h('button', { class: 'icon-btn', 'aria-label': 'Log', onClick: () => this.toggleLog() }, '📜'),
    );
  }

  private renderRings() {
    for (const [id, v] of this.world.ships) {
      const s = this.state.ships[id];
      if (!s) continue;
      const m = v.ring.material as THREE.MeshBasicMaterial;
      let color = '#ff5a5f';
      let op = 0.45;
      if (s.owner === HUMAN) {
        const o = shipOptions(this.state, s);
        const can = this.myTurn && (o.canStart || o.acting);
        color = can ? '#2ef2c4' : '#7d8b8f';
        op = can ? 0.9 : 0.35;
      }
      if (isDerelict(s)) color = '#3b3b3b';
      if (id === this.selected) color = '#ffeb3b';
      // Rings get their own material so the selected one can pulse alone.
      if (m.userData.color !== color || m.userData.op !== op) {
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false });
        mat.userData = { color, op, own: true };
        if (m.userData.own) m.dispose();
        v.ring.material = mat;
      }
    }
  }

  private renderSheet(): void {
    clear(this.sheet);
    const st = this.state;
    // Nothing to tap while the table animates: get out of the way.
    this.sheet.classList.toggle('hidden', this.busy && !st.pending);
    // Pending choices first.
    if (st.pending && toAct(st) === HUMAN) {
      this.renderPending();
      return;
    }
    if (this.selected === null) {
      this.sheet.classList.remove('open');
      if (this.myTurn && !this.busy) this.sheet.append(h('div', { class: 'hint' }, 'Tap one of your ships (glowing ring) to give it an action.'));
      this.sheet.classList.toggle('mini', true);
      return;
    }
    this.sheet.classList.remove('mini');
    this.sheet.classList.add('open');
    const s = st.ships[this.selected];
    if (!s || s.sunk) {
      this.selected = null;
      return this.renderSheet();
    }
    const card = cardEl(s.def, { ship: s, state: st });
    const actions = h('div', { class: 'actions' });
    const mine = s.owner === HUMAN;
    if (mine && this.myTurn && !this.busy) this.fillActions(s, actions);
    else if (!mine) actions.append(h('div', { class: 'hint' }, s.cargo.length ? `Carrying ${s.cargo.length} treasure.` : 'Enemy ship.'));
    const close = h('button', { class: 'icon-btn close', 'aria-label': 'Close', onClick: () => this.select(null) }, '✕');
    // While aiming, the card folds away so the table stays visible.
    this.sheet.classList.toggle('aiming', this.mode === 'move' || this.mode === 'shoot');
    this.sheet.append(close, h('div', { class: 'sheet-row' }, card, actions));
  }

  private btn(label: string, onClick: () => void, primary = false, disabled = false) {
    return h('button', { class: `btn ${primary ? 'primary' : ''}`, onClick, disabled }, label);
  }

  private fillActions(s: Ship, el: HTMLElement) {
    const st = this.state;
    const o = shipOptions(st, s);
    if (this.mode === 'move' && this.plan) {
      const rest = this.remainingBars();
      const pv = this.plan.preview;
      el.append(h('div', { class: 'hint' }, `Ruler: ${this.plan.bar === 'L' ? 'L (6")' : 'S (3")'}. Drag on the sea to aim.`));
      const choose = h('div', { class: 'bars' });
      for (const b of [...new Set(rest)]) choose.append(this.btn(b, () => { this.plan!.bar = b; if (this.plan!.current) this.plan!.current = null; this.plan!.preview = null; this.drawMoveOverlay(); this.renderSheet(); }, b === this.plan.bar));
      el.append(choose);
      if (pv && !pv.ok) el.append(h('div', { class: 'warn' }, pv.error ?? 'Blocked'));
      if (pv && pv.ok && pv.dockedAt !== null && pv.dockedAt !== s.docked) el.append(h('div', { class: 'good' }, `Docks at ${st.islands[pv.dockedAt].name}`));
      if (pv && pv.ok && pv.contact?.kind === 'ship') el.append(h('div', { class: 'good' }, 'Touches a ship: you can ram after moving'));
      if (this.plan.current && pv?.ok && rest.length > 1 && !pv.contact) el.append(this.btn('+ Next ruler', () => this.addSegment()));
      el.append(this.btn('⛵ Sail', () => void this.sail(), true, !(this.plan.segs.length || pv?.ok)), this.btn('Cancel', () => { this.cancelMode(); this.renderSheet(); }));
      return;
    }
    if (this.mode === 'shoot') {
      const fire = o.fire;
      const ids = [...new Set(fire.map((f) => f.cannon.id))];
      el.append(h('div', { class: 'hint' }, 'Pick a cannon, then tap a highlighted enemy.'));
      const row = h('div', { class: 'cannons' });
      for (const id of ids) {
        const f = fire.find((x) => x.cannon.id === id)!;
        const chance = Math.round(Math.max(...fire.filter((x) => x.cannon.id === id).map((x) => hitChance(x.need, x.bonus, x.long))) * 100);
        const b = h('button', { class: `cannon-btn ${id === this.cannon ? 'sel' : ''}`, onClick: () => { this.cannon = id; this.drawShootOverlay(); this.renderSheet(); } }, dieFace(f.cannon.rank, f.cannon.bar), h('small', {}, `${chance}%`));
        row.append(b);
      }
      el.append(row);
      const targets = fire.filter((f) => f.cannon.id === this.cannon);
      for (const t of targets) el.append(this.btn(`Fire at ${t.target.def.name} (${Math.round(hitChance(t.need, t.bonus, t.long) * 100)}%)`, () => void this.fireAt(t.target.id), true));
      el.append(this.btn(st.current?.ship === s.id ? 'Done shooting' : 'Cancel', () => { this.cancelMode(); if (st.current?.ship === s.id) void this.apply({ t: 'endAction', by: HUMAN }); else this.renderSheet(); }));
      return;
    }
    if (this.mode === 'explore' && o.explore) this.renderExplore(s, el, o.explore);
    if (this.mode === 'explore') return;
    const acting = o.acting;
    if (acting) {
      // Free options after a move.
      if (o.explore && o.explore.free) el.append(this.btn(`🔎 Explore ${st.islands[o.explore.island].name}`, () => { this.mode = 'explore'; this.renderSheet(); }, true));
      for (const t of o.ram) el.append(this.btn(`💥 Ram ${st.ships[t].def.name}`, () => void this.apply({ t: 'ram', by: HUMAN, ship: s.id, target: t }), true));
      if (o.board !== null) el.append(this.btn(`⚔ Board ${st.ships[o.board].def.name}`, () => void this.apply({ t: 'board', by: HUMAN, ship: s.id, target: o.board! }), true));
      for (const t of o.tow) el.append(this.btn(`🪢 Tow ${st.ships[t].def.name}`, () => void this.apply({ t: 'tow', by: HUMAN, ship: s.id, target: t })));
      if (o.fire.length) el.append(this.btn('🎯 Shoot', () => this.startShoot(s.id), true));
      for (const t of o.pickpocket) el.append(this.btn(`🫳 Steal from ${st.ships[t].def.name}`, () => void this.apply({ t: 'pickpocket', by: HUMAN, ship: s.id, target: t })));
      for (const t of o.plunder) el.append(this.btn(`💰 Plunder ${st.ships[t].def.name}`, () => void this.apply({ t: 'plunder', by: HUMAN, ship: s.id, target: t })));
      el.append(this.btn('✔ Done', () => void this.apply({ t: 'endAction', by: HUMAN })));
      return;
    }
    if (!o.canStart) {
      el.append(h('div', { class: 'hint' }, s.towedBy !== null ? 'Under tow.' : 'Already acted this turn.'));
      for (const t of o.pickpocket) el.append(this.btn(`🫳 Steal from ${st.ships[t].def.name}`, () => void this.apply({ t: 'pickpocket', by: HUMAN, ship: s.id, target: t })));
      return;
    }
    el.append(this.btn(`⛵ Move (${o.bars.join('+') || '—'})`, () => this.startMove(s.id), true, !o.bars.length));
    el.append(this.btn(`🎯 Shoot${o.fire.length ? ` (${new Set(o.fire.map((f) => f.target.id)).size} target)` : ''}`, () => this.startShoot(s.id), false, !o.fire.length));
    if (o.explore) el.append(this.btn(`🔎 Explore`, () => { this.mode = 'explore'; this.renderSheet(); }, true));
    for (const t of o.exploreShips) el.append(this.btn(`📦 Take cargo from ${st.ships[t].def.name}`, () => void this.apply({ t: 'exploreShip', by: HUMAN, ship: s.id, target: t, take: st.ships[t].cargo.slice(0, cargoFree(st, s)) })));
    if (o.repair) el.append(this.btn('🔧 Repair a mast', () => void this.apply({ t: 'repair', by: HUMAN, ship: s.id })));
    if (o.comeAbout) el.append(this.btn('↩ Come about', () => void this.apply({ t: 'comeAbout', by: HUMAN, ship: s.id })));
    for (const t of o.pickpocket) el.append(this.btn(`🫳 Steal from ${st.ships[t].def.name}`, () => void this.apply({ t: 'pickpocket', by: HUMAN, ship: s.id, target: t })));
  }

  private renderExplore(s: Ship, el: HTMLElement, ex: { island: number; coins: number[]; max: number; free: boolean }) {
    const st = this.state;
    const isl = st.islands[ex.island];
    const chosen = new Set([...ex.coins].sort((a, b) => st.coins[b].value - st.coins[a].value).slice(0, ex.max));
    const uniques = isl.coins.filter((id) => st.coins[id].unique);
    el.append(h('div', { class: 'hint' }, `${isl.name}: you look at the treasure. Load up to ${ex.max}.`));
    const row = h('div', { class: 'coins' });
    const redraw = () => {
      clear(row);
      for (const id of ex.coins) {
        const on = chosen.has(id);
        row.append(h('button', { class: `coin ${on ? 'on' : ''}`, onClick: () => { if (on) chosen.delete(id); else if (chosen.size < ex.max) chosen.add(id); redraw(); } }, `${st.coins[id].value}`));
      }
      for (const id of uniques) row.append(h('span', { class: 'coin unique', title: 'Unique treasure: taken automatically' }, st.coins[id].unique!.name));
    };
    redraw();
    el.append(row, this.btn('Load treasure', () => { this.mode = 'idle'; void this.apply({ t: 'explore', by: HUMAN, ship: s.id, take: [...chosen] }); }, true), this.btn('Cancel', () => { this.mode = 'idle'; this.renderSheet(); }));
  }

  private renderPending() {
    const st = this.state;
    const p = st.pending!;
    this.sheet.classList.add('open');
    this.sheet.classList.remove('mini');
    const opts = pendingOptions(st);
    const box = h('div', { class: 'pending' });
    if (p.kind === 'mastLoss') {
      const s = st.ships[p.ship];
      box.append(h('h3', {}, s.owner === HUMAN ? `${s.def.name} is hit! Choose the mast to lose (${p.count}).` : `Your shot lands! Choose which mast of ${s.def.name} falls.`));
      const row = h('div', { class: 'cannons' });
      for (const o of opts) {
        const i = Number(o.split(':')[1]);
        const c = s.def.cannons[i];
        row.append(h('button', { class: 'cannon-btn', onClick: () => void this.apply({ t: 'choose', by: HUMAN, option: o }) }, dieFace(Number(c[0]), c[1] as 'S' | 'L'), h('small', {}, `Mast ${i + 1}`)));
      }
      box.append(row);
    } else if (p.kind === 'defenderBoard') {
      const a = st.ships[p.attacker];
      const d = st.ships[p.defender];
      box.append(h('h3', {}, `${a.def.name} rammed ${d.def.name}. Board her?`), h('p', {}, `Each side rolls a d6 + masts: you ${d.masts.filter(Boolean).length}, them ${a.masts.filter(Boolean).length}.`));
      box.append(this.btn('⚔ Board!', () => void this.apply({ t: 'choose', by: HUMAN, option: 'board' }), true), this.btn('Let her go', () => void this.apply({ t: 'choose', by: HUMAN, option: 'decline' })));
    } else {
      const lose = st.ships[p.loser];
      box.append(h('h3', {}, `You won the melee aboard ${lose.def.name}! Take your spoils:`));
      for (const o of opts) {
        const label = o === 'treasure' ? '💰 Steal a treasure' : o === 'none' ? 'Nothing' : `☠ Eliminate ${lose.crew.find((c) => c.id === Number(o.slice(5)))?.def.name}`;
        box.append(this.btn(label, () => void this.apply({ t: 'choose', by: HUMAN, option: o }), o === 'treasure'));
      }
    }
    this.sheet.append(box);
  }

  private showIsland(i: number) {
    const st = this.state;
    const isl = st.islands[i];
    const known = st.players[HUMAN].known;
    const coins = isl.coins.map((id) => (isl.home !== null || known.includes(id) ? (st.coins[id].unique ? st.coins[id].unique!.name : `${st.coins[id].value}`) : '?'));
    const what = isl.home === HUMAN ? 'Your home island' : isl.home === BOT ? 'Enemy home island' : 'Wild island';
    toast(`${isl.name} — ${what}. ${isl.coins.length ? `Treasure: ${coins.join(', ')}` : 'No treasure.'}`, 'info', 3200);
  }

  private toggleLog() {
    this.logEl.classList.toggle('hidden');
    clear(this.logEl);
    for (const l of this.state.log.slice(-40).reverse()) this.logEl.append(h('div', { class: l.player === HUMAN ? 'you' : 'foe' }, `R${Math.ceil(l.turn / 2)} · ${l.text}`));
  }

  private endTurn() {
    if (!this.myTurn || this.busy) return;
    this.cancelMode();
    this.selected = null;
    void this.apply({ t: 'endTurn', by: HUMAN });
  }

  private menu() {
    modal('Paused', h('p', {}, 'The tide waits for you.'), [
      { label: 'Resume', primary: true, onClick: () => undefined },
      { label: 'Strike colours (resign)', onClick: () => void this.apply({ t: 'resign', by: HUMAN }) },
      { label: 'Quit to menu', onClick: () => this.opts.onExit() },
    ]);
  }

  private showEnd() {
    const st = this.state;
    const won = st.winner === HUMAN;
    sfx.bell();
    modal(st.draw ? 'A draw!' : won ? 'Victory!' : 'Defeat', h('p', {}, st.endReason), [
      { label: 'Back to menu', primary: true, onClick: () => this.opts.onExit() },
      { label: 'Look at the table', onClick: () => undefined },
    ]);
  }

  /** Hand the human side to the bot (or take it back). */
  setAutoHuman(on: boolean) {
    this.autoHuman = on;
    if (on) void this.pump();
  }

  dispose() {
    this.alive = false;
    this.world.dispose();
    this.root.remove();
  }
}

