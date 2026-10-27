// Pooled effects: splashes, smoke, wake foam, muzzle flashes, cannonballs.
// All particles of a kind share one InstancedMesh.
import * as THREE from 'three';

interface P {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
}

class Pool {
  mesh: THREE.InstancedMesh;
  ps: P[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    n: number,
    private gravity: number,
    private flat = false,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) this.ps.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, size: 1, grow: 0 });
    this.mesh.count = 0;
  }
  spawn(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, grow = 0) {
    const p = this.ps.find((x) => !x.alive);
    if (!p) return;
    p.alive = true;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.life = 0;
    p.max = life;
    p.size = size;
    p.grow = grow;
  }
  update(dt: number) {
    let n = 0;
    for (const p of this.ps) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.alive = false;
        continue;
      }
      p.vel.y -= this.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (this.gravity > 0 && p.pos.y < 0) p.life = p.max;
      const k = 1 - p.life / p.max;
      const sz = Math.max(0.001, p.size * (this.flat ? 1 + p.grow * (1 - k) : k + p.grow * (1 - k)));
      this.s.set(sz, this.flat ? 1 : sz, sz);
      this.m.compose(p.pos, this.q, this.s);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  get busy() {
    return this.ps.some((p) => p.alive);
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

export interface Ball {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  done: () => void;
}

export class Effects {
  group = new THREE.Group();
  private splash: Pool;
  private smoke: Pool;
  private wake: Pool;
  private flash: Pool;
  private splinter: Pool;
  private balls: Ball[] = [];
  private ballGeo = new THREE.SphereGeometry(0.07, 6, 4);
  private ballMat = new THREE.MeshBasicMaterial({ color: '#222' });

  constructor(scale = 1) {
    const sphere = new THREE.IcosahedronGeometry(1, 0);
    this.splash = new Pool(sphere, new THREE.MeshLambertMaterial({ color: '#f4fbff', flatShading: true }), Math.round(160 * scale), 9);
    this.smoke = new Pool(sphere.clone(), new THREE.MeshLambertMaterial({ color: '#cfcac0', transparent: true, opacity: 0.7, flatShading: true, depthWrite: false }), Math.round(80 * scale), -0.4);
    this.wake = new Pool(new THREE.CircleGeometry(1, 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e9f7ff', transparent: true, opacity: 0.45, depthWrite: false }), Math.round(260 * scale), 0, true);
    this.flash = new Pool(sphere.clone(), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }), 24, 0);
    this.splinter = new Pool(new THREE.BoxGeometry(1, 0.4, 0.4), new THREE.MeshLambertMaterial({ color: '#8a5a32', flatShading: true }), Math.round(90 * scale), 9);
    this.group.add(this.splash.mesh, this.smoke.mesh, this.wake.mesh, this.flash.mesh, this.splinter.mesh);
    this.wake.mesh.renderOrder = 1;
  }

  splashAt(p: THREE.Vector3, big = 1) {
    for (let i = 0; i < 14 * big; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.4 + Math.random() * 1.1;
      this.splash.spawn(new THREE.Vector3(p.x, 0.05, p.z), new THREE.Vector3(Math.cos(a) * s * 0.5, 2.2 + Math.random() * 2.5 * big, Math.sin(a) * s * 0.5), 1.1, 0.06 + Math.random() * 0.06);
    }
    for (let i = 0; i < 3; i++) this.wake.spawn(new THREE.Vector3(p.x, 0.04, p.z), new THREE.Vector3(), 1.4, 0.25 * big, 3);
  }

  hitAt(p: THREE.Vector3) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      this.splinter.spawn(p, new THREE.Vector3(Math.cos(a) * 1.4, 2 + Math.random() * 2, Math.sin(a) * 1.4), 1.2, 0.08 + Math.random() * 0.05);
    }
    this.smokeAt(p, 4);
  }

  smokeAt(p: THREE.Vector3, n = 5) {
    for (let i = 0; i < n; i++) this.smoke.spawn(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3)), new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.5, (Math.random() - 0.5) * 0.3), 1.6, 0.12, 2.5);
  }

  muzzle(p: THREE.Vector3) {
    this.flash.spawn(p, new THREE.Vector3(), 0.18, 0.35, 0);
    this.smokeAt(p, 4);
  }

  wakeAt(p: THREE.Vector3, size = 0.2) {
    this.wake.spawn(new THREE.Vector3(p.x, 0.035, p.z), new THREE.Vector3(), 1.6, size, 2.2);
  }

  /** Fire a cannonball along an arc; calls done when it lands. */
  shoot(from: THREE.Vector3, to: THREE.Vector3, done: () => void) {
    const mesh = new THREE.Mesh(this.ballGeo, this.ballMat);
    mesh.position.copy(from);
    this.group.add(mesh);
    const dur = 0.25 + from.distanceTo(to) * 0.06;
    this.balls.push({ mesh, from: from.clone(), to: to.clone(), t: 0, dur, done });
  }

  update(dt: number) {
    this.splash.update(dt);
    this.smoke.update(dt);
    this.wake.update(dt);
    this.flash.update(dt);
    this.splinter.update(dt);
    for (const b of [...this.balls]) {
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      b.mesh.position.lerpVectors(b.from, b.to, k);
      b.mesh.position.y += Math.sin(k * Math.PI) * (0.4 + b.from.distanceTo(b.to) * 0.08);
      if (k >= 1) {
        this.group.remove(b.mesh);
        this.balls.splice(this.balls.indexOf(b), 1);
        b.done();
      }
    }
  }

  dispose() {
    for (const p of [this.splash, this.smoke, this.wake, this.flash, this.splinter]) p.dispose();
    this.ballGeo.dispose();
    this.ballMat.dispose();
  }
}
