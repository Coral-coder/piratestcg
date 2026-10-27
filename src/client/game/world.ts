// The 3D table: renderer, camera, sea, islands, ships and effects.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mastPoints, shipLength, type GameState, type Pose } from '../../engine';
import { getSettings, isSmallScreen, isTouch } from '../settings';
import { Effects } from './fx';
import {
  basic,
  buildIsland,
  buildShip,
  chestGeometry,
  coinGeometry,
  disposeShared,
  lambert,
  palmLeavesGeometry,
  palmTrunkGeometry,
  poseShip,
  type IslandView,
  type ShipView,
} from './models';

const SEA_VS = `
uniform float uTime;
varying vec3 vPos;
varying float vH;
void main() {
  vec3 p = position;
  float h = sin(p.x * 0.35 + uTime * 1.1) * 0.05 + sin(p.z * 0.27 - uTime * 0.8) * 0.05 + sin((p.x + p.z) * 0.6 + uTime * 1.7) * 0.02;
  p.y += h;
  vH = h;
  vPos = (modelMatrix * vec4(p, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const SEA_FS = `
uniform vec2 uSize;
uniform float uTime;
varying vec3 vPos;
varying float vH;
void main() {
  vec3 deep = vec3(0.04, 0.24, 0.36);
  vec3 shallow = vec3(0.10, 0.48, 0.58);
  vec3 c = mix(deep, shallow, clamp(vH * 5.0 + 0.5, 0.0, 1.0));
  // Inside the table: a touch lighter, with a faint inch grid every 6".
  vec2 q = vPos.xz;
  float inside = step(0.0, q.x) * step(0.0, q.y) * step(q.x, uSize.x) * step(q.y, uSize.y);
  vec2 g = abs(fract(q / 6.0 - 0.5) - 0.5) * 6.0;
  float grid = (1.0 - smoothstep(0.0, 0.06, min(g.x, g.y))) * 0.05 * inside;
  c = mix(c * 0.62, c, inside) + grid;
  // Rope border around the table.
  float dx = min(abs(q.x), abs(q.x - uSize.x));
  float dy = min(abs(q.y), abs(q.y - uSize.y));
  float onX = step(-0.2, q.y) * step(q.y, uSize.y + 0.2);
  float onY = step(-0.2, q.x) * step(q.x, uSize.x + 0.2);
  float edge = max((1.0 - smoothstep(0.05, 0.16, dx)) * onX, (1.0 - smoothstep(0.05, 0.16, dy)) * onY);
  c = mix(c, vec3(0.85, 0.72, 0.48), edge);
  // Sparkles.
  float sp = pow(max(0.0, sin(q.x * 1.7 + sin(q.y * 0.9) * 2.0 + uTime * 1.3) * sin(q.y * 1.3 + sin(q.x * 0.7) * 2.0 - uTime * 0.9)), 40.0);
  c += sp * 0.12;
  // Fade to the horizon.
  vec2 centre = uSize * 0.5;
  float d = length(q - centre) / (length(uSize) * 1.2);
  c = mix(c, vec3(0.55, 0.75, 0.85), smoothstep(0.55, 1.0, d));
  gl_FragColor = vec4(c, 1.0);
}`;

type Tween = (dt: number) => boolean; // returns true when finished

export interface PickResult {
  ship: number | null;
  island: number | null;
  point: THREE.Vector3 | null;
}

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  fx: Effects;
  ships = new Map<number, ShipView>();
  islands: IslandView[] = [];
  overlay = new THREE.Group();
  private sea: THREE.Mesh;
  private seaMat: THREE.ShaderMaterial;
  private tweens: Tween[] = [];
  private raf = 0;
  private last = 0;
  private time = 0;
  private coins: THREE.InstancedMesh;
  private chests: THREE.InstancedMesh;
  private palmsT: THREE.InstancedMesh | null = null;
  private palmsL: THREE.InstancedMesh | null = null;
  private ray = new THREE.Raycaster();
  private resizeObs: ResizeObserver;
  private sinking = new Set<number>();
  onFrame: ((dt: number) => void) | null = null;
  width = 42;
  height = 60;

  constructor(private host: HTMLElement) {
    const s = getSettings();
    const low = s.quality === 'low' || (s.quality === 'auto' && (isTouch() || isSmallScreen()));
    this.renderer = new THREE.WebGLRenderer({ antialias: !low, powerPreference: 'high-performance' });
    // Cap the pixel ratio: phones reload pages that use too much memory.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'world-canvas';
    this.scene.background = new THREE.Color('#8fc3d6');
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 95;
    this.controls.screenSpacePanning = false;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    this.scene.add(new THREE.HemisphereLight('#dff3ff', '#2b4a55', 1.6));
    const sun = new THREE.DirectionalLight('#fff4dc', 2.2);
    sun.position.set(-20, 40, -10);
    this.scene.add(sun);

    this.seaMat = new THREE.ShaderMaterial({ vertexShader: SEA_VS, fragmentShader: SEA_FS, uniforms: { uTime: { value: 0 }, uSize: { value: new THREE.Vector2(42, 60) } } });
    const seaGeo = new THREE.PlaneGeometry(240, 240, low ? 48 : 96, low ? 48 : 96).rotateX(-Math.PI / 2);
    this.sea = new THREE.Mesh(seaGeo, this.seaMat);
    this.scene.add(this.sea);

    this.fx = new Effects(low ? 0.6 : 1);
    this.scene.add(this.fx.group, this.overlay);
    this.coins = new THREE.InstancedMesh(coinGeometry(), lambert('#ffd24a', { emissive: '#6a4a00' }), 80);
    this.coins.count = 0;
    this.chests = new THREE.InstancedMesh(chestGeometry(), lambert('#8b5a2b'), 16);
    this.chests.count = 0;
    // Instance counts change after the first frame; skip culling on a stale bounding sphere.
    this.coins.frustumCulled = false;
    this.chests.frustumCulled = false;
    this.scene.add(this.coins, this.chests);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  setTable(st: GameState, viewer: number) {
    this.width = st.width;
    this.height = st.height;
    this.seaMat.uniforms.uSize.value.set(st.width, st.height);
    this.sea.position.set(st.width / 2, 0, st.height / 2);
    // Islands.
    const palms: THREE.Matrix4[] = [];
    for (const isl of st.islands) {
      const v = buildIsland(isl);
      this.scene.add(v.group);
      this.islands.push(v);
      palms.push(...v.palms);
    }
    this.palmsT = new THREE.InstancedMesh(palmTrunkGeometry(), lambert('#7a5534'), palms.length);
    this.palmsL = new THREE.InstancedMesh(palmLeavesGeometry(), lambert('#3f8a3a', { side: THREE.DoubleSide }), palms.length);
    palms.forEach((m, i) => {
      this.palmsT!.setMatrixAt(i, m);
      this.palmsL!.setMatrixAt(i, m);
    });
    this.palmsT.frustumCulled = false;
    this.palmsL.frustumCulled = false;
    this.scene.add(this.palmsT, this.palmsL);
    // Camera behind the viewer's home island, looking up the table.
    const home = st.islands[st.players[viewer].home];
    const dirZ = home.y < st.height / 2 ? 1 : -1;
    const small = this.host.clientWidth < 700;
    this.controls.target.set(st.width / 2, 0, home.y + dirZ * (small ? 12 : 16));
    this.camera.position.set(st.width / 2, small ? 30 : 26, home.y - dirZ * (small ? 14 : 10));
    this.controls.update();
  }

  /** Pan so (x, z) sits in the upper part of the screen, clear of the bottom sheet. */
  focusAbove(x: number, z: number) {
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const dist = this.camera.position.distanceTo(this.controls.target);
    const tall = this.host.clientHeight > this.host.clientWidth;
    this.focus(x - fwd.x * dist * (tall ? 0.28 : 0.12), z - fwd.z * dist * (tall ? 0.28 : 0.12));
  }

  focus(x: number, z: number, dur = 0.6) {
    const from = this.controls.target.clone();
    const to = new THREE.Vector3(x, 0, z);
    const off = this.camera.position.clone().sub(from);
    let t = 0;
    this.tween((dt) => {
      t += dt / dur;
      const k = t >= 1 ? 1 : 1 - Math.pow(1 - t, 3);
      this.controls.target.lerpVectors(from, to, k);
      this.camera.position.copy(this.controls.target).add(off);
      return t >= 1;
    });
  }

  /** Create or update ship meshes to match the state (no animation). */
  syncShips(st: GameState) {
    for (const s of st.ships) {
      let v = this.ships.get(s.id);
      if (s.sunk) {
        if (v && !this.sinking.has(s.id)) {
          this.scene.remove(v.group);
          this.ships.delete(s.id);
        }
        continue;
      }
      if (!v) {
        v = buildShip(s);
        this.ships.set(s.id, v);
        this.scene.add(v.group);
      }
      poseShip(v.group, s.x, s.y, s.heading);
      v.masts.forEach((m, i) => {
        if (s.masts[i] && !m.visible) {
          m.visible = true;
          m.rotation.set(0, 0, 0);
          m.position.y = 0.28;
        }
        if (!s.masts[i] && m.visible && !m.userData.falling) m.visible = false;
      });
      (v.streamer.material as THREE.MeshBasicMaterial) = basic(s.owner === 0 ? '#2ec4b6' : '#ff5a5f', { side: THREE.DoubleSide });
      v.streamer.visible = s.masts.some(Boolean);
    }
  }

  syncTreasure(st: GameState, viewer: number) {
    const m = new THREE.Matrix4();
    let n = 0;
    let c = 0;
    st.islands.forEach((isl, i) => {
      const spot = this.islands[i].coinSpot;
      let k = 0;
      for (const id of isl.coins) {
        const coin = st.coins[id];
        if (coin.unique && isl.home === null) {
          m.makeTranslation(spot.x - 0.5, spot.y + 0.1, spot.z - 0.3);
          if (c < 16) this.chests.setMatrixAt(c++, m);
          continue;
        }
        // Stacks of three.
        const sx = spot.x + (Math.floor(k / 3) - 0.5) * 0.52;
        m.makeTranslation(sx, spot.y + (k % 3) * 0.075, spot.z);
        if (n < 80) this.coins.setMatrixAt(n++, m);
        k++;
      }
    });
    void viewer;
    this.coins.count = n;
    this.chests.count = c;
    this.coins.instanceMatrix.needsUpdate = true;
    this.chests.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- animation

  tween(t: Tween) {
    this.tweens.push(t);
  }

  get animating() {
    return this.tweens.length > 0;
  }

  /** Sail a ship along a path of poses. */
  sail(id: number, path: Pose[], speed = 7): Promise<void> {
    const v = this.ships.get(id);
    if (!v || path.length < 2) return Promise.resolve();
    return new Promise((done) => {
      let seg = 0;
      let t = 0;
      let wakeT = 0;
      const L = shipLength(v.masts.length);
      this.tween((dt) => {
        const a = path[seg];
        const b = path[seg + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 0.001;
        t += (dt * speed) / len;
        const k = Math.min(1, t);
        // Turn quickly at the start of each segment.
        const turnK = Math.min(1, k * 4);
        let dh = b.heading - a.heading;
        while (dh > 180) dh -= 360;
        while (dh < -180) dh += 360;
        poseShip(v.group, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.heading + dh * turnK);
        wakeT += dt;
        if (wakeT > 0.05) {
          wakeT = 0;
          const stern = new THREE.Vector3(-L, 0, 0).applyMatrix4(v.group.matrixWorld);
          this.fx.wakeAt(stern, 0.18 + L * 0.03);
          this.fx.wakeAt(new THREE.Vector3(0, 0, 0).applyMatrix4(v.group.matrixWorld), 0.12);
        }
        if (k >= 1) {
          seg++;
          t = 0;
          if (seg >= path.length - 1) {
            done();
            return true;
          }
        }
        return false;
      });
    });
  }

  mastWorld(id: number, i: number): THREE.Vector3 {
    const v = this.ships.get(id);
    if (!v) return new THREE.Vector3();
    const m = v.masts[i] ?? v.masts[0];
    return new THREE.Vector3(0, 0.6, 0).applyMatrix4(m.matrixWorld);
  }

  shipCenter(id: number): THREE.Vector3 {
    const v = this.ships.get(id);
    if (!v) return new THREE.Vector3();
    return new THREE.Vector3(-shipLength(v.masts.length) / 2, 0.4, 0).applyMatrix4(v.group.matrixWorld);
  }

  dropMast(id: number, i: number): Promise<void> {
    const v = this.ships.get(id);
    const m = v?.masts[i];
    if (!v || !m || !m.visible) return Promise.resolve();
    m.userData.falling = true;
    const side = Math.random() < 0.5 ? -1 : 1;
    let t = 0;
    return new Promise((done) => {
      this.tween((dt) => {
        t += dt;
        const k = Math.min(1, t / 0.9);
        m.rotation.x = side * (Math.PI / 2) * k * k;
        if (t > 0.9) m.position.y = 0.28 - (t - 0.9) * 1.2;
        if (t > 0.85 && t - dt <= 0.85) this.fx.splashAt(this.mastWorld(id, i).setY(0), 1.2);
        if (t > 1.6) {
          m.visible = false;
          m.userData.falling = false;
          m.rotation.set(0, 0, 0);
          m.position.y = 0.28;
          done();
          return true;
        }
        return false;
      });
    });
  }

  sink(id: number): Promise<void> {
    const v = this.ships.get(id);
    if (!v) return Promise.resolve();
    this.sinking.add(id);
    let t = 0;
    const base = v.group.position.clone();
    return new Promise((done) => {
      this.tween((dt) => {
        t += dt;
        v.group.position.y = base.y - t * 0.35;
        v.group.rotateZ(dt * 0.25);
        if (Math.random() < 0.3) this.fx.splashAt(this.shipCenter(id).setY(0), 0.6);
        if (t > 2.2) {
          this.scene.remove(v.group);
          this.ships.delete(id);
          this.sinking.delete(id);
          done();
          return true;
        }
        return false;
      });
    });
  }

  shake(id: number) {
    const v = this.ships.get(id);
    if (!v) return;
    let t = 0;
    const base = v.group.position.clone();
    this.tween((dt) => {
      t += dt;
      v.group.position.x = base.x + Math.sin(t * 60) * 0.06 * (1 - t / 0.5);
      if (t > 0.5) {
        v.group.position.copy(base);
        return true;
      }
      return false;
    });
  }

  wait(sec: number): Promise<void> {
    let t = 0;
    return new Promise((done) =>
      this.tween((dt) => {
        t += dt;
        if (t >= sec) {
          done();
          return true;
        }
        return false;
      }),
    );
  }

  // ---------------------------------------------------------------- picking

  pick(clientX: number, clientY: number): PickResult {
    const r = this.renderer.domElement.getBoundingClientRect();
    const nd = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(nd, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    const hitPlane = this.ray.ray.intersectPlane(plane, point);
    let ship: number | null = null;
    let best = Infinity;
    const groups = [...this.ships.values()].map((v) => v.group);
    const hits = this.ray.intersectObjects(groups, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.shipId === undefined) o = o.parent;
      if (o && h.distance < best && h.object.visible) {
        best = h.distance;
        ship = o.userData.shipId as number;
      }
    }
    // Generous touch target: nearest ship within 1" of the tap point on the sea.
    if (ship === null && hitPlane) {
      let bd = isTouch() ? 1.4 : 0.8;
      for (const [id, v] of this.ships) {
        const c = new THREE.Vector3(-shipLength(v.masts.length) / 2, 0, 0).applyMatrix4(v.group.matrixWorld);
        const d = Math.hypot(c.x - point.x, c.z - point.z) - shipLength(v.masts.length) / 2;
        if (d < bd) {
          bd = d;
          ship = id;
        }
      }
    }
    let island: number | null = null;
    if (hitPlane) {
      this.islands.forEach((v, i) => {
        const p = v.group.position;
        if (Math.hypot(p.x - point.x, p.z - point.z) < 3) island = i;
      });
    }
    return { ship, island, point: hitPlane ? point : null };
  }

  project(p: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const v = p.clone().project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, visible: v.z < 1 && v.z > -1 };
  }

  mastPointsWorld(st: GameState, id: number) {
    const s = st.ships[id];
    return mastPoints(s).map((p) => new THREE.Vector3(p.x, 0.05, p.y));
  }

  // ---------------------------------------------------------------- loop

  private resize() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 58 : 48;
    this.camera.updateProjectionMatrix();
  }

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.seaMat.uniforms.uTime.value = this.time;
    for (const t of [...this.tweens]) if (t(dt)) this.tweens.splice(this.tweens.indexOf(t), 1);
    // Gentle bobbing.
    for (const v of this.ships.values()) {
      const g = v.group;
      if (this.sinking.has(g.userData.shipId)) continue;
      g.position.y = Math.sin(this.time * 1.3 + v.bob) * 0.03;
      g.rotation.x = Math.sin(this.time * 1.1 + v.bob) * 0.025;
    }
    this.fx.update(dt);
    this.controls.update();
    this.onFrame?.(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.fx.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !(m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) m.geometry.dispose();
    });
    this.seaMat.dispose();
    this.sea.geometry.dispose();
    this.coins.dispose();
    this.chests.dispose();
    this.palmsT?.dispose();
    this.palmsL?.dispose();
    disposeShared();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
