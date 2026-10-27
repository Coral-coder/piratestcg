// Low-poly procedural models: hulls, masts, sails, islands, coins.
// Everything is built from code: no external art.
import * as THREE from 'three';
import { mastPoints, shipLength, shipWidth, type Ship } from '../../engine';
import { factionColors, PLAYER_COLORS } from '../content';

// ------------------------------------------------------------ shared caches

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();
const texCache = new Map<string, THREE.Texture>();

function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}

export function lambert(color: string, opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const key = 'l' + color + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
    matCache.set(key, m);
  }
  return m as THREE.MeshLambertMaterial;
}

export function basic(color: string, opts: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  const key = 'b' + color + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, ...opts });
    matCache.set(key, m);
  }
  return m as THREE.MeshBasicMaterial;
}

/** Free every cached GPU resource (called when leaving the game). */
export function disposeShared(): void {
  for (const g of geoCache.values()) g.dispose();
  for (const m of matCache.values()) m.dispose();
  for (const t of texCache.values()) t.dispose();
  geoCache.clear();
  matCache.clear();
  texCache.clear();
}

// ------------------------------------------------------------ hull

const DECK = 0.28;
const KEEL = -0.18;

function halfWidth(t: number, W: number): number {
  if (t < 0.3) return (W / 2) * Math.pow(t / 0.3, 0.6);
  return (W / 2) * (1 - 0.12 * Math.pow((t - 0.3) / 0.7, 2));
}

function sheer(t: number): number {
  return DECK + 0.12 * Math.pow(1 - t, 3) + 0.16 * Math.pow(t, 4);
}

/** Hull shell from stations bow (x=0) to stern (x=-L), z across. */
export function hullGeometry(masts: number): THREE.BufferGeometry {
  return geo('hull' + masts, () => {
    const L = shipLength(masts);
    const W = shipWidth(masts);
    const N = 9;
    const pos: number[] = [];
    const sections: THREE.Vector3[][] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = -t * L;
      const w = Math.max(halfWidth(t, W), 0.001);
      const top = sheer(t);
      const kd = KEEL * (t < 0.12 ? t / 0.12 : 1);
      sections.push([
        new THREE.Vector3(x, top, -w),
        new THREE.Vector3(x, (top + kd) * 0.45, -w * 0.95),
        new THREE.Vector3(x, kd * 0.8, -w * 0.55),
        new THREE.Vector3(x, kd, 0),
        new THREE.Vector3(x, kd * 0.8, w * 0.55),
        new THREE.Vector3(x, (top + kd) * 0.45, w * 0.95),
        new THREE.Vector3(x, top, w),
      ]);
    }
    const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < N; i++) {
      const s0 = sections[i];
      const s1 = sections[i + 1];
      for (let j = 0; j < s0.length - 1; j++) {
        tri(s0[j], s1[j], s1[j + 1]);
        tri(s0[j], s1[j + 1], s0[j + 1]);
      }
    }
    // Transom.
    const st = sections[N];
    for (let j = 1; j < st.length - 1; j++) tri(st[0], st[j + 1], st[j]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });
}

export function deckGeometry(masts: number): THREE.BufferGeometry {
  return geo('deck' + masts, () => {
    const L = shipLength(masts);
    const W = shipWidth(masts);
    const shape = new THREE.Shape();
    const N = 12;
    shape.moveTo(0, 0);
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      shape.lineTo(-t * L, halfWidth(t, W) * 0.9);
    }
    for (let i = N; i >= 1; i--) {
      const t = i / N;
      shape.lineTo(-t * L, -halfWidth(t, W) * 0.9);
    }
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(Math.PI / 2);
    g.translate(0, DECK - 0.02, 0);
    return g;
  });
}

// ------------------------------------------------------------ cannon dice

/** The printed cannon die: white with black pips for S, red with white pips for L. */
export function dieTexture(rank: number, bar: 'S' | 'L'): THREE.Texture {
  const key = `die${rank}${bar}`;
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = bar === 'L' ? '#c62828' : '#fafafa';
  g.strokeStyle = '#222';
  g.lineWidth = 4;
  g.beginPath();
  g.roundRect(4, 4, 56, 56, 10);
  g.fill();
  g.stroke();
  g.fillStyle = bar === 'L' ? '#fff' : '#111';
  const P: Record<number, [number, number][]> = {
    1: [[32, 32]],
    2: [[20, 20], [44, 44]],
    3: [[18, 18], [32, 32], [46, 46]],
    4: [[20, 20], [44, 20], [20, 44], [44, 44]],
    5: [[18, 18], [46, 18], [32, 32], [18, 46], [46, 46]],
    6: [[20, 16], [44, 16], [20, 32], [44, 32], [20, 48], [44, 48]],
  };
  for (const [x, y] of P[Math.min(6, Math.max(1, rank))]) {
    g.beginPath();
    g.arc(x, y, 5.5, 0, Math.PI * 2);
    g.fill();
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

function sailGeometry(w: number, h: number): THREE.BufferGeometry {
  return geo(`sail${w.toFixed(2)}x${h.toFixed(2)}`, () => {
    const g = new THREE.PlaneGeometry(w, h, 4, 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      // Billow forward (+x after rotation) in the middle.
      p.setZ(i, 0.12 * (1 - Math.pow((2 * x) / w, 2)) * (1 - 0.4 * Math.pow((2 * y) / h, 2)));
    }
    g.computeVertexNormals();
    g.rotateY(Math.PI / 2); // face along the keel
    return g;
  });
}

export interface ShipView {
  group: THREE.Group;
  hull: THREE.Mesh;
  masts: THREE.Group[];
  ring: THREE.Mesh;
  streamer: THREE.Mesh;
  bob: number;
}

export function mastHeight(masts: number, i: number): number {
  const base = 1.5 + 0.18 * masts;
  const mid = (masts - 1) / 2;
  return base * (1 - 0.12 * Math.abs(i - mid) / Math.max(1, mid));
}

/** One mast with two sails and its cannon die. Origin at the mast foot. */
export function buildMast(ship: Pick<Ship, 'def'>, i: number): THREE.Group {
  const g = new THREE.Group();
  const n = ship.def.masts;
  const h = mastHeight(n, i);
  const W = shipWidth(n);
  const colors = factionColors(ship.def.faction);
  const pole = new THREE.Mesh(geo('pole' + h.toFixed(2), () => new THREE.CylinderGeometry(0.035, 0.05, h, 5).translate(0, h / 2, 0)), lambert('#5a3d24'));
  g.add(pole);
  const sailMat = lambert(colors.sail, { side: THREE.DoubleSide });
  const sw = W * 1.15;
  const lower = new THREE.Mesh(sailGeometry(sw, h * 0.36), sailMat);
  lower.position.y = h * 0.42;
  const upper = new THREE.Mesh(sailGeometry(sw * 0.8, h * 0.26), sailMat);
  upper.position.y = h * 0.76;
  g.add(lower, upper);
  for (const y of [h * 0.6, h * 0.24, h * 0.9]) {
    const yard = new THREE.Mesh(geo('yard' + sw.toFixed(2), () => new THREE.CylinderGeometry(0.02, 0.02, sw * 1.05, 4).rotateX(Math.PI / 2)), lambert('#4a3220'));
    yard.position.y = y;
    g.add(yard);
  }
  const c = ship.def.cannons[i];
  if (c) {
    const tex = dieTexture(Number(c[0]), c[1] === 'L' ? 'L' : 'S');
    const decal = new THREE.Mesh(geo('decal', () => new THREE.PlaneGeometry(0.34, 0.34).rotateY(Math.PI / 2)), basic('#ffffff', { map: tex, side: THREE.DoubleSide }));
    decal.position.set(0.14, h * 0.42, 0);
    decal.name = 'die';
    g.add(decal);
  }
  return g;
}

export function buildShip(ship: Ship): ShipView {
  const group = new THREE.Group();
  const colors = factionColors(ship.def.faction);
  const hull = new THREE.Mesh(hullGeometry(ship.def.masts), lambert('#7b4f2c', { side: THREE.DoubleSide }));
  hull.name = 'hull';
  const deck = new THREE.Mesh(deckGeometry(ship.def.masts), lambert('#b98b57', { side: THREE.DoubleSide }));
  group.add(hull, deck);
  const L = shipLength(ship.def.masts);
  // Stern castle on bigger ships.
  if (ship.def.masts >= 3) {
    const castle = new THREE.Mesh(geo('castle' + ship.def.masts, () => new THREE.BoxGeometry(L * 0.18, 0.22, shipWidth(ship.def.masts) * 0.82)), lambert(colors.trim));
    castle.position.set(-L * 0.9, DECK + 0.11, 0);
    group.add(castle);
  }
  // Bowsprit.
  const sprit = new THREE.Mesh(geo('sprit', () => new THREE.CylinderGeometry(0.025, 0.035, 0.7, 4).rotateZ(Math.PI / 2 - 0.3)), lambert('#5a3d24'));
  sprit.position.set(0.15, DECK + 0.15, 0);
  group.add(sprit);
  const pts = mastPoints({ x: 0, y: 0, heading: 0, def: ship.def });
  const masts: THREE.Group[] = [];
  for (let i = 0; i < ship.def.masts; i++) {
    const m = buildMast(ship, i);
    m.position.set(pts[i].x, DECK, pts[i].y);
    m.visible = ship.masts[i];
    group.add(m);
    masts.push(m);
  }
  // Owner streamer on the tallest mast, faction flag at the stern.
  const tallest = Math.floor((ship.def.masts - 1) / 2);
  const streamer = new THREE.Mesh(geo('streamer', () => {
    const s = new THREE.BufferGeometry();
    s.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.55, -0.06, 0, 0, -0.16, 0], 3));
    s.computeVertexNormals();
    return s;
  }), basic(PLAYER_COLORS[ship.owner], { side: THREE.DoubleSide }));
  streamer.position.set(pts[tallest].x, DECK + mastHeight(ship.def.masts, tallest) + 0.02, pts[tallest].y);
  group.add(streamer);
  const flag = new THREE.Mesh(geo('flag', () => new THREE.PlaneGeometry(0.32, 0.2).translate(-0.16, 0, 0)), basic(colors.flag, { side: THREE.DoubleSide }));
  flag.position.set(-L - 0.05, DECK + 0.6, 0);
  const flagPole = new THREE.Mesh(geo('flagpole', () => new THREE.CylinderGeometry(0.015, 0.015, 0.7, 4)), lambert('#3a2a1a'));
  flagPole.position.set(-L + 0.02, DECK + 0.35, 0);
  group.add(flag, flagPole);
  // Selection / status ring.
  const ring = new THREE.Mesh(geo('ring', () => new THREE.RingGeometry(0.92, 1, 40).rotateX(-Math.PI / 2)), basic('#ffffff', { transparent: true, opacity: 0.85, depthWrite: false }));
  ring.scale.set(L * 0.62, 1, shipWidth(ship.def.masts) * 1.05);
  ring.position.set(-L / 2, 0.03, 0);
  ring.renderOrder = 2;
  group.add(ring);
  group.userData.shipId = ship.id;
  return { group, hull, masts, ring, streamer, bob: (ship.id * 1.7) % 6.28 };
}

/** Apply engine pose to a ship group. */
export function poseShip(group: THREE.Object3D, x: number, y: number, heading: number): void {
  group.position.set(x, 0, y);
  group.rotation.set(0, (-heading * Math.PI) / 180, 0);
}

// ------------------------------------------------------------ islands

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface IslandView {
  group: THREE.Group;
  coinSpot: THREE.Vector3;
  palms: THREE.Matrix4[];
}

export function buildIsland(isl: { x: number; y: number; r: number; look: number; home: number | null }): IslandView {
  const r = rand(isl.look * 7919 + 13);
  const group = new THREE.Group();
  group.position.set(isl.x, 0, isl.y);
  // Shallows ring.
  const shallow = new THREE.Mesh(geo('shallow', () => new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2)), basic('#5fd0c6', { transparent: true, opacity: 0.35, depthWrite: false }));
  shallow.scale.setScalar(isl.r * 1.35);
  shallow.position.y = 0.02;
  group.add(shallow);
  // Sand: jittered cylinder.
  const sandG = new THREE.CylinderGeometry(isl.r * 0.98, isl.r * 1.02, 0.34, 14, 1);
  const p = sandG.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const k = 0.9 + r() * 0.12;
    p.setX(i, x * k);
    p.setZ(i, z * k);
    if (p.getY(i) > 0) p.setY(i, p.getY(i) + r() * 0.05);
  }
  sandG.computeVertexNormals();
  const sand = new THREE.Mesh(sandG, lambert('#e8d39a'));
  sand.position.y = 0.06;
  group.add(sand);
  // Green hill.
  const hillG = new THREE.DodecahedronGeometry(isl.r * 0.62, 0);
  hillG.scale(1, 0.42 + r() * 0.25, 1);
  const hill = new THREE.Mesh(hillG, lambert(isl.home !== null ? '#5f9e4a' : '#4f8f43'));
  hill.position.set((r() - 0.5) * isl.r * 0.3, 0.25, (r() - 0.5) * isl.r * 0.3);
  hill.rotation.y = r() * 6;
  group.add(hill);
  // Rocks.
  for (let i = 0; i < 3; i++) {
    const rock = new THREE.Mesh(geo('rock', () => new THREE.DodecahedronGeometry(0.22, 0)), lambert('#8a8478'));
    const a = r() * Math.PI * 2;
    rock.position.set(Math.cos(a) * isl.r * 0.85, 0.12, Math.sin(a) * isl.r * 0.85);
    rock.scale.setScalar(0.6 + r());
    group.add(rock);
  }
  // Palms (returned as matrices for instancing).
  const palms: THREE.Matrix4[] = [];
  const count = 2 + Math.floor(r() * 3);
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const d = isl.r * (0.25 + r() * 0.45);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(isl.x + Math.cos(a) * d, 0.2, isl.y + Math.sin(a) * d),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.4, r() * 6, (r() - 0.5) * 0.4)),
      new THREE.Vector3(1, 0.8 + r() * 0.5, 1),
    );
    palms.push(m);
  }
  if (isl.home !== null) {
    // A small fort with the owner's colours.
    const fort = new THREE.Group();
    const wall = new THREE.Mesh(geo('fortwall', () => new THREE.CylinderGeometry(0.55, 0.62, 0.45, 8)), lambert('#b9a98c'));
    wall.position.y = 0.45;
    const tower = new THREE.Mesh(geo('forttower', () => new THREE.CylinderGeometry(0.22, 0.25, 0.7, 6)), lambert('#a89878'));
    tower.position.set(0.25, 0.75, 0.1);
    const pole = new THREE.Mesh(geo('fortpole', () => new THREE.CylinderGeometry(0.02, 0.02, 0.9, 4)), lambert('#3a2a1a'));
    pole.position.set(0.25, 1.5, 0.1);
    const flag = new THREE.Mesh(geo('fortflag', () => new THREE.PlaneGeometry(0.5, 0.3).translate(0.25, 0, 0)), basic(PLAYER_COLORS[isl.home], { side: THREE.DoubleSide }));
    flag.position.set(0.25, 1.8, 0.1);
    fort.add(wall, tower, pole, flag);
    fort.position.set(-isl.r * 0.2, 0, -isl.r * 0.15);
    group.add(fort);
  }
  // Treasure sits on the beach, clear of the hill.
  const hx = hill.position.x;
  const hz = hill.position.z;
  const len = Math.hypot(hx, hz) || 1;
  const away = { x: -hx / len, z: -hz / len };
  const beach = new THREE.Vector3(isl.x + away.x * isl.r * 0.72, 0.3, isl.y + away.z * isl.r * 0.72);
  return { group, coinSpot: beach, palms };
}

export function palmTrunkGeometry() {
  return geo('palmtrunk', () => new THREE.CylinderGeometry(0.045, 0.07, 1.1, 5).translate(0, 0.55, 0));
}
export function palmLeavesGeometry() {
  return geo('palmleaves', () => {
    const g = new THREE.ConeGeometry(0.6, 0.35, 7, 1, true);
    g.translate(0, 1.15, 0);
    return g;
  });
}
export function coinGeometry() {
  return geo('coin', () => new THREE.CylinderGeometry(0.24, 0.24, 0.07, 12));
}
export function chestGeometry() {
  return geo('chest', () => new THREE.BoxGeometry(0.34, 0.22, 0.24));
}
