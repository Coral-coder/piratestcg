// Low-poly procedural models: hulls, masts, sails, islands, coins.
// Everything is built from code and canvas drawing: no external art.
import * as THREE from 'three';
import { mastPoints, shipLength, shipWidth, type Ship, type ShipDef } from '../../engine';
import { factionColors, PLAYER_COLORS } from '../content';
import { drawEmblem } from '../emblems';

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

/** Free a temporary object's own GPU resources, leaving shared ones cached. */
export function disposeObject(o: THREE.Object3D): void {
  const shared = new Set<unknown>([...geoCache.values(), ...matCache.values()]);
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) if (!shared.has(mat)) mat.dispose();
  });
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

// Paint bands on the hull, from the waterline up (as on the printed models).
const BAND_TOP = 0.17;
const WALE = 0.06;

function bandColor(y: number, trim: string): string {
  if (y > BAND_TOP) return '#8a5a32';
  if (y > WALE) return trim;
  if (y > 0) return '#1d1712';
  return '#4a2a1a';
}

/** Hull shell from stations bow (x=0) to stern (x=-L), z across, painted in bands. */
export function hullGeometry(masts: number, trim = '#5b4632'): THREE.BufferGeometry {
  return geo('hull' + masts + trim, () => {
    const L = shipLength(masts);
    const W = shipWidth(masts);
    const N = 16;
    const pos: number[] = [];
    const col: number[] = [];
    const sections: THREE.Vector3[][] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = -t * L;
      const w = Math.max(halfWidth(t, W), 0.002);
      const top = sheer(t);
      const kd = KEEL * (t < 0.12 ? 0.25 + (0.75 * t) / 0.12 : t > 0.9 ? 1 - (t - 0.9) * 2 : 1);
      const half = [
        new THREE.Vector3(x, top, w * 0.9),
        new THREE.Vector3(x, BAND_TOP, w),
        new THREE.Vector3(x, WALE, w),
        new THREE.Vector3(x, 0, w * 0.97),
        new THREE.Vector3(x, kd * 0.55, w * 0.76),
        new THREE.Vector3(x, kd * 0.92, w * 0.32),
      ];
      const keel = new THREE.Vector3(x, kd, 0);
      sections.push([...half.map((v) => v.clone().setZ(-v.z)), keel, ...half.reverse()]);
    }
    const c = new THREE.Color();
    const tri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3, fixed?: string) => {
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
      c.set(fixed ?? bandColor((a.y + b.y + d.y) / 3, trim)).convertSRGBToLinear();
      for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    };
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
    const mid = st.length >> 1;
    for (let j = 0; j < st.length - 1; j++) tri(st[mid], st[j + 1], st[j], '#6a4126');
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  });
}

/** Dark gun ports along both sides of the painted band. */
export function gunportGeometry(masts: number, count: number): THREE.BufferGeometry {
  return geo(`ports${masts}x${count}`, () => {
    const L = shipLength(masts);
    const W = shipWidth(masts);
    const pos: number[] = [];
    const n = Math.max(2, Math.min(12, count));
    for (let i = 0; i < n; i++) {
      const t = 0.32 + (0.55 * i) / Math.max(1, n - 1);
      const x = -t * L;
      const z = halfWidth(t, W) + 0.006;
      for (const side of [1, -1]) {
        const zz = z * side;
        const y0 = 0.085;
        const y1 = 0.145;
        const x0 = x - 0.035;
        const x1 = x + 0.035;
        if (side > 0) pos.push(x0, y0, zz, x1, y0, zz, x1, y1, zz, x0, y0, zz, x1, y1, zz, x0, y1, zz);
        else pos.push(x0, y0, zz, x1, y1, zz, x1, y0, zz, x0, y0, zz, x0, y1, zz, x1, y1, zz);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  });
}

/** Gunwale rails along both sides. */
function railGeometry(masts: number): THREE.BufferGeometry {
  return geo('rail' + masts, () => {
    const L = shipLength(masts);
    const W = shipWidth(masts);
    const pts: number[] = [];
    const N = 16;
    for (const side of [1, -1]) {
      for (let i = 0; i < N; i++) {
        for (const t of [i / N, (i + 1) / N]) pts.push(-t * L, sheer(t) + 0.05, side * halfWidth(t, W) * 0.9);
      }
    }
    // Posts.
    for (let i = 1; i < N; i += 2) {
      const t = i / N;
      for (const side of [1, -1]) pts.push(-t * L, sheer(t), side * halfWidth(t, W) * 0.9, -t * L, sheer(t) + 0.05, side * halfWidth(t, W) * 0.9);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  });
}

export function deckGeometry(masts: number): THREE.BufferGeometry {
  return geo('deck' + masts, () => {
    const L = shipLength(masts);
    const W = shipWidth(masts);
    const shape = new THREE.Shape();
    const N = 16;
    shape.moveTo(0, 0);
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      shape.lineTo(-t * L, halfWidth(t, W) * 0.88);
    }
    for (let i = N; i >= 1; i--) {
      const t = i / N;
      shape.lineTo(-t * L, -halfWidth(t, W) * 0.88);
    }
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(Math.PI / 2);
    g.translate(0, DECK - 0.02, 0);
    return g;
  });
}

/** Deck planking texture. */
function deckTexture(): THREE.Texture {
  const key = 'deckTex';
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c0915c';
  g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 8) {
    g.fillStyle = y % 16 ? '#b6864f' : '#c89a64';
    g.fillRect(0, y, 64, 7);
    g.fillStyle = '#7a5530';
    g.fillRect(0, y + 7, 64, 1);
    g.fillRect(((y * 37) % 64) | 0, y, 1, 7);
  }
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.5, 1.5);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
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

function sailGeometry(w: number, h: number, flare = 0.12): THREE.BufferGeometry {
  return geo(`sail${w.toFixed(2)}x${h.toFixed(2)}x${flare}`, () => {
    const g = new THREE.PlaneGeometry(w, h, 6, 3);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const v = 0.5 - y / h; // 0 at top, 1 at foot
      p.setX(i, x * (1 + flare * v));
      // Billow forward (+x after rotation), most at the foot.
      p.setZ(i, (0.06 + 0.1 * v) * (1 - Math.pow((2 * x) / w, 2)));
    }
    g.computeVertexNormals();
    g.rotateY(Math.PI / 2); // face along the keel
    return g;
  });
}

const EMBLEM_INK: Record<string, string> = {
  Pirate: '#f1ece0', English: '#c8102e', Spanish: '#b3262c', French: '#1d3f8f', American: '#203a7a',
  Brethren: '#1c0b0b', 'Azure Crown': '#2a5aa8', Sunreach: '#7a3a00', 'Jade Tide': '#0f3a2c',
};

/** Sailcloth: seams, weathered edges and (on the course) the faction emblem. */
function sailTexture(faction: string | undefined, color: string, emblem: boolean): THREE.Texture {
  const key = `sail|${faction}|${color}|${emblem}`;
  let t = texCache.get(key);
  if (t) return t;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, S, S);
  // Light from above, shade toward the foot.
  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  // Vertical cloth seams.
  g.fillStyle = 'rgba(0,0,0,0.10)';
  for (let x = 12; x < S; x += 16) g.fillRect(x, 0, 1.5, S);
  // Reef band and bolt-rope edge.
  g.fillStyle = 'rgba(0,0,0,0.14)';
  g.fillRect(0, S * 0.22, S, 2);
  g.strokeStyle = 'rgba(40,25,10,0.55)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, S - 4, S - 4);
  if (emblem) {
    g.translate(S / 2, S * 0.56);
    drawEmblem(g, faction, S * 0.62, EMBLEM_INK[faction ?? ''] ?? '#3a2a1a');
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

/** Stern flag: faction colours with the emblem. */
function flagTexture(faction: string | undefined): THREE.Texture {
  const key = 'flag|' + faction;
  let t = texCache.get(key);
  if (t) return t;
  const colors = factionColors(faction);
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = faction === 'English' ? '#f4f1ea' : colors.flag;
  g.fillRect(0, 0, 96, 64);
  g.translate(48, 32);
  drawEmblem(g, faction, 52, faction === 'Pirate' ? '#f1ece0' : faction === 'English' ? '#c8102e' : '#f8f2e2');
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
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

const WOOD = '#5a3d24';
const RIG = '#2b1d12';

/**
 * One mast: tapered pole, crow's nest, yards, up to three sails, its cannon
 * die, and its own shrouds (so the rigging falls with the mast).
 * Origin at the mast foot.
 */
export function buildMast(ship: Pick<Ship, 'def'>, i: number): THREE.Group {
  const g = new THREE.Group();
  const n = ship.def.masts;
  const h = mastHeight(n, i);
  const W = shipWidth(n);
  const L = shipLength(n);
  const colors = factionColors(ship.def.faction);
  const pole = new THREE.Mesh(geo('pole' + h.toFixed(2), () => new THREE.CylinderGeometry(0.022, 0.055, h, 6).translate(0, h / 2, 0)), lambert(WOOD));
  g.add(pole);
  const nest = new THREE.Mesh(geo('nest', () => new THREE.CylinderGeometry(0.1, 0.08, 0.06, 8)), lambert('#4a3220'));
  nest.position.y = h * 0.7;
  g.add(nest);
  const sw = W * 1.2;
  const plain = lambert('#ffffff', { side: THREE.DoubleSide, map: sailTexture(ship.def.faction, colors.sail, false) });
  const marked = lambert('#ffffff', { side: THREE.DoubleSide, map: sailTexture(ship.def.faction, colors.sail, true) });
  const sails: [number, number, number, THREE.Material][] = [
    [sw, h * 0.34, h * 0.42, marked],
    [sw * 0.82, h * 0.24, h * 0.7, plain],
  ];
  if (h > 2.2) sails.push([sw * 0.6, h * 0.14, h * 0.89, plain]);
  for (const [w, sh, y, mat] of sails) {
    const s = new THREE.Mesh(sailGeometry(w, sh), mat);
    s.position.y = y;
    g.add(s);
    const yard = new THREE.Mesh(geo('yard' + w.toFixed(2), () => new THREE.CylinderGeometry(0.016, 0.022, w * 1.08, 5).rotateX(Math.PI / 2)), lambert('#4a3220'));
    yard.position.y = y + sh / 2;
    g.add(yard);
  }
  // Pennant at the very top.
  const pen = new THREE.Mesh(geo('pennant', () => {
    const s = new THREE.BufferGeometry();
    s.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.32, -0.03, 0, 0, -0.07, 0], 3));
    return s;
  }), basic(colors.flag, { side: THREE.DoubleSide }));
  pen.position.y = h + 0.02;
  g.add(pen);
  // Shrouds from the masthead down to the rails, and a stay toward the bow.
  const pts = mastPoints({ x: 0, y: 0, heading: 0, def: ship.def });
  const t = -pts[i].x / L;
  const w = halfWidth(t, W) * 0.9;
  const rig: number[] = [];
  for (const side of [1, -1]) {
    for (const dx of [-0.12, 0.05, 0.2]) rig.push(0, h * 0.68, 0, dx - 0.05, 0.03, side * w);
    rig.push(0, h * 0.98, 0, -0.05, h * 0.7, side * 0.1);
  }
  const fwd = i === 0 ? -pts[0].x + 0.65 : pts[i - 1].x - pts[i].x;
  rig.push(0, h * 0.95, 0, fwd, i === 0 ? 0.1 : h * 0.55, 0);
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(rig, 3)),
    rigMaterial(),
  );
  lines.userData.ownGeometry = true;
  g.add(lines);
  const c = ship.def.cannons[i];
  if (c) {
    const tex = dieTexture(Number(c[0]), c[1] === 'L' ? 'L' : 'S');
    const decal = new THREE.Mesh(geo('decal', () => new THREE.PlaneGeometry(0.26, 0.26).rotateY(Math.PI / 2)), basic('#ffffff', { map: tex, side: THREE.DoubleSide }));
    decal.position.set(0.2, h * 0.31, sw * 0.32);
    decal.name = 'die';
    g.add(decal);
  }
  return g;
}

function rigMaterial(): THREE.LineBasicMaterial {
  const key = 'rig';
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.LineBasicMaterial({ color: RIG, transparent: true, opacity: 0.75 });
    matCache.set(key, m);
  }
  return m as THREE.LineBasicMaterial;
}

export function buildShip(ship: Ship): ShipView {
  const group = new THREE.Group();
  const colors = factionColors(ship.def.faction);
  const n = ship.def.masts;
  const L = shipLength(n);
  const W = shipWidth(n);
  const hull = new THREE.Mesh(hullGeometry(n, colors.trim), lambert('#ffffff', { side: THREE.DoubleSide, vertexColors: true }));
  hull.name = 'hull';
  const deck = new THREE.Mesh(deckGeometry(n), lambert('#ffffff', { side: THREE.DoubleSide, map: deckTexture() }));
  const ports = new THREE.Mesh(gunportGeometry(n, ship.def.cannons.length * 2), basic('#140d08', { side: THREE.DoubleSide }));
  const rails = new THREE.LineSegments(railGeometry(n), rigMaterial());
  group.add(hull, deck, ports, rails);
  // Stern castle with lit windows on bigger ships; a forecastle on the biggest.
  if (n >= 2) {
    const cl = L * (n >= 3 ? 0.22 : 0.16);
    const ch = n >= 3 ? 0.26 : 0.16;
    const cw = halfWidth(0.9, W) * 1.7;
    const castle = new THREE.Mesh(geo(`castle${n}`, () => new THREE.BoxGeometry(cl, ch, cw)), lambert('#7a4d2a'));
    castle.position.set(-L + cl / 2 + 0.02, DECK + ch / 2 - 0.02, 0);
    const cap = new THREE.Mesh(geo(`castlecap${n}`, () => new THREE.BoxGeometry(cl + 0.04, 0.035, cw + 0.04)), lambert(colors.trim));
    cap.position.set(castle.position.x, DECK + ch, 0);
    group.add(castle, cap);
    const win = basic('#ffcf73');
    for (let k = 0; k < (n >= 3 ? 3 : 2); k++) {
      const wmesh = new THREE.Mesh(geo('window', () => new THREE.PlaneGeometry(0.06, 0.07).rotateY(-Math.PI / 2)), win);
      wmesh.position.set(-L + 0.015, DECK + ch * 0.55, (k - (n >= 3 ? 1 : 0.5)) * cw * 0.3);
      group.add(wmesh);
    }
    const lantern = new THREE.Mesh(geo('lantern', () => new THREE.SphereGeometry(0.05, 6, 4)), basic('#ffd27a'));
    lantern.position.set(-L - 0.02, DECK + ch + 0.12, 0);
    group.add(lantern);
  }
  if (n >= 4) {
    const fc = new THREE.Mesh(geo(`fore${n}`, () => new THREE.BoxGeometry(L * 0.12, 0.12, halfWidth(0.22, W) * 1.6)), lambert('#7a4d2a'));
    fc.position.set(-L * 0.17, DECK + 0.06, 0);
    group.add(fc);
  }
  // Figurehead, bowsprit and jib.
  const head = new THREE.Mesh(geo('figure', () => new THREE.ConeGeometry(0.05, 0.16, 5).rotateZ(-Math.PI / 2)), lambert('#d8b04a'));
  head.position.set(0.05, DECK + 0.03, 0);
  const sprit = new THREE.Mesh(geo('sprit', () => new THREE.CylinderGeometry(0.018, 0.032, 0.8, 5).rotateZ(Math.PI / 2 - 0.32).translate(0.38, 0.12, 0)), lambert(WOOD));
  sprit.position.set(0, DECK + 0.04, 0);
  group.add(head, sprit);
  const pts = mastPoints({ x: 0, y: 0, heading: 0, def: ship.def });
  const foreH = mastHeight(n, 0);
  const tip = new THREE.Vector3(0.75, DECK + 0.29, 0);
  const jibG = geo(`jib${n}`, () => {
    const s = new THREE.BufferGeometry();
    s.setAttribute('position', new THREE.Float32BufferAttribute([tip.x, tip.y, 0, pts[0].x + 0.05, DECK + foreH * 0.62, 0, pts[0].x * 0.35, DECK + 0.12, 0], 3));
    s.setAttribute('uv', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0.2, 0], 2));
    s.computeVertexNormals();
    return s;
  });
  const jib = new THREE.Mesh(jibG, lambert('#ffffff', { side: THREE.DoubleSide, map: sailTexture(ship.def.faction, colors.sail, false) }));
  group.add(jib);
  const masts: THREE.Group[] = [];
  for (let i = 0; i < n; i++) {
    const m = buildMast(ship, i);
    m.position.set(pts[i].x, DECK, pts[i].y);
    m.visible = ship.masts[i];
    group.add(m);
    masts.push(m);
  }
  // Owner streamer on the tallest mast, faction flag at the stern.
  const tallest = Math.floor((n - 1) / 2);
  const streamer = new THREE.Mesh(geo('streamer', () => {
    const s = new THREE.BufferGeometry();
    s.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.6, -0.08, 0, 0, -0.18, 0], 3));
    s.computeVertexNormals();
    return s;
  }), basic(PLAYER_COLORS[ship.owner], { side: THREE.DoubleSide }));
  streamer.position.set(pts[tallest].x, DECK + mastHeight(n, tallest) - 0.08, pts[tallest].y);
  group.add(streamer);
  const flag = new THREE.Mesh(geo('flag', () => new THREE.PlaneGeometry(0.42, 0.28, 3, 1).translate(-0.21, 0, 0)), basic('#ffffff', { side: THREE.DoubleSide, map: flagTexture(ship.def.faction) }));
  flag.name = 'flag';
  const flagPole = new THREE.Mesh(geo('flagpole', () => new THREE.CylinderGeometry(0.012, 0.016, 0.8, 4)), lambert('#3a2a1a'));
  flagPole.position.set(-L - 0.02, DECK + 0.45, 0);
  flag.position.set(-L - 0.03, DECK + 0.7, 0);
  group.add(flag, flagPole);
  // Selection / status ring.
  const ring = new THREE.Mesh(geo('ring', () => new THREE.RingGeometry(0.92, 1, 40).rotateX(-Math.PI / 2)), basic('#ffffff', { transparent: true, opacity: 0.85, depthWrite: false }));
  ring.scale.set(L * 0.62, 1, W * 1.05);
  ring.position.set(-L / 2, 0.03, 0);
  ring.renderOrder = 2;
  group.add(ring);
  group.userData.shipId = ship.id;
  return { group, hull, masts, ring, streamer, bob: (ship.id * 1.7) % 6.28 };
}

/** A stand-alone ship (not in a game) for previews and the assembly view. */
export function previewShip(def: ShipDef, owner = 0): Ship {
  return {
    id: 0, owner, originalOwner: owner, def, x: 0, y: 0, heading: 0, masts: new Array(def.masts).fill(true), crew: [], cargo: [], uniques: [], sunk: false, docked: null, pinnedTo: null, towing: null, towedBy: null,
    actionsUsed: 0, actionsAllowed: 1, lastActionKind: null, sameKindOnly: false,
    flags: { extraRolled: false, rerollUsed: false, hitCrewUsed: false, firstHitIgnored: false, pickpocketUsed: false, peekUsed: false, rumTurn: -10, once: [] },
  };
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
