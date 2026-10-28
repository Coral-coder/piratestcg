// Card art: each ship's portrait is rendered from its own 3D model, once,
// into an image. One small offscreen renderer is created on demand and
// released when idle, so it never holds a WebGL context for long.
import * as THREE from 'three';
import { shipLength, type ShipDef } from '../../engine';
import { buildShip, disposeObject, previewShip } from '../game/models';

const W = 360;
const H = 240;
const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let idle = 0;
const queue: { def: ShipDef; done: (url: string) => void }[] = [];
let scheduled = false;

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff6e0', '#3a4a55', 2.0));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
}

function release() {
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = null;
  scene = null;
  camera = null;
}

function renderOne(def: ShipDef): string {
  if (!renderer) setup();
  const v = buildShip(previewShip(def, 0));
  v.ring.visible = false;
  v.streamer.visible = false;
  const L = shipLength(def.masts);
  // Three-quarter view from off the starboard bow.
  v.group.rotation.y = -0.55;
  v.group.position.set(L * 0.45, -0.25, 0);
  scene!.add(v.group);
  const box = new THREE.Box3().setFromObject(v.group);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  camera!.position.set(c.x + size * 0.42, c.y + size * 0.2, c.z + size * 1.08);
  camera!.lookAt(c.x, c.y - size * 0.03, c.z);
  renderer!.render(scene!, camera!);
  const url = renderer!.domElement.toDataURL('image/webp', 0.9);
  scene!.remove(v.group);
  disposeObject(v.group);
  return url;
}

function pump() {
  scheduled = false;
  // A few per frame keeps scrolling smooth.
  for (let n = 0; n < 4 && queue.length; n++) {
    const job = queue.shift()!;
    let url = cache.get(job.def.id);
    if (!url) {
      try {
        url = renderOne(job.def);
      } catch {
        url = '';
      }
      cache.set(job.def.id, url);
    }
    job.done(url);
  }
  if (queue.length) {
    scheduled = true;
    requestAnimationFrame(pump);
  }
  clearTimeout(idle);
  idle = window.setTimeout(release, 1500);
}

/** Portrait image URL for a ship (empty string if WebGL is unavailable). */
export function shipPortrait(def: ShipDef): Promise<string> {
  const hit = cache.get(def.id);
  if (hit !== undefined) return Promise.resolve(hit);
  return new Promise((done) => {
    queue.push({ def, done });
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(pump);
    }
  });
}
