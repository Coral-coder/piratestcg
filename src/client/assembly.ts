// Assembly view: punch each ship's pieces out of its card and snap them
// together, like the printed game's plastic punch-out cards.
import * as THREE from 'three';
import { shipLength, type ShipDef } from '../engine';
import { sfx } from './audio';
import { factionColors } from './content';
import { getSettings, isSmallScreen, isTouch } from './settings';
import { h } from './ui/dom';
import { buildShip, disposeObject, disposeShared, lambert, previewShip } from './game/models';

interface Piece {
  obj: THREE.Object3D;
  start: { p: THREE.Vector3; q: THREE.Quaternion };
  end: { p: THREE.Vector3; q: THREE.Quaternion };
  placed: boolean;
  /** -1 idle; below 0 waiting to start (counts up); 0..1 flying. */
  anim: number;
  started: boolean;
  hull: boolean;
}


const easeOutBack = (t: number) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export function runAssembly(host: HTMLElement, defs: ShipDef[], onDone: () => void): () => void {
  const root = h('div', { class: 'assembly' });
  host.append(root);
  const stage = h('div', { class: 'assembly-stage' });
  const title = h('div', { class: 'assembly-title' });
  const hint = h('div', { class: 'assembly-hint' }, isTouch() ? 'Tap the pieces to punch them out and snap them together.' : 'Click the pieces to punch them out and snap them together.');
  const nextBtn = h('button', { class: 'btn primary' }, 'Next ship ▶');
  const autoBtn = h('button', { class: 'btn' }, 'Build it for me');
  const skipBtn = h('button', { class: 'btn ghost' }, 'Skip to battle');
  root.append(title, stage, hint, h('div', { class: 'assembly-actions' }, autoBtn, nextBtn, skipBtn));

  const low = getSettings().quality === 'low' || (getSettings().quality === 'auto' && (isTouch() || isSmallScreen()));
  const renderer = new THREE.WebGLRenderer({ antialias: !low, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight('#fff7e6', '#3a2a1a', 1.8));
  const sun = new THREE.DirectionalLight('#ffffff', 2);
  sun.position.set(3, 8, 5);
  scene.add(sun);

  // The card the pieces punch out of.
  const cardGroup = new THREE.Group();
  scene.add(cardGroup);
  let pieces: Piece[] = [];
  let shipGroup: THREE.Group | null = null;
  let index = 0;
  let spin = 0;
  let sparks: { m: THREE.Mesh; v: THREE.Vector3; t: number }[] = [];
  const sparkGeo = new THREE.OctahedronGeometry(0.05, 0);
  const sparkMat = new THREE.MeshBasicMaterial({ color: '#fff1a8' });

  function resize() {
    const w = stage.clientWidth || 360;
    const hh = stage.clientHeight || 360;
    renderer.setSize(w, hh, false);
    camera.aspect = w / hh;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  function clearShip() {
    if (shipGroup) {
      scene.remove(shipGroup);
      disposeObject(shipGroup);
    }
    while (cardGroup.children.length) {
      const c = cardGroup.children[0] as THREE.Mesh;
      cardGroup.remove(c);
      c.geometry?.dispose();
    }
    pieces = [];
  }

  function load(i: number) {
    clearShip();
    const def = defs[i];
    title.textContent = `${def.name} — ${def.faction ?? ''} · ${def.points} pts · ${def.masts} mast${def.masts > 1 ? 's' : ''}`;
    nextBtn.textContent = i < defs.length - 1 ? 'Next ship ▶' : 'Set sail! ⚓';
    nextBtn.classList.add('dim');
    const L = shipLength(def.masts);
    const col = factionColors(def.faction);
    const card = new THREE.Mesh(new THREE.BoxGeometry(L + 2.7, 0.08, 4.3), lambert(col.trim));
    card.position.set(-L / 2, -0.04, 1.2);
    cardGroup.add(card);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(L + 2.4, 4.0), new THREE.MeshLambertMaterial({ color: '#e9dcbc' }));
    face.rotation.x = -Math.PI / 2;
    face.position.set(-L / 2, 0.005, 1.2);
    cardGroup.add(face);
    const v = buildShip(previewShip(def, 0));
    v.ring.visible = false;
    shipGroup = v.group;
    scene.add(shipGroup);
    const hullParts = shipGroup.children.filter((c) => !v.masts.includes(c as THREE.Group));
    const hullGroup = new THREE.Group();
    for (const c of hullParts) hullGroup.add(c);
    shipGroup.add(hullGroup);
    // Hull lies on its side at the front of the card.
    const add = (obj: THREE.Object3D, sp: THREE.Vector3, sq: THREE.Quaternion, hull: boolean) => {
      const end = { p: obj.position.clone(), q: obj.quaternion.clone() };
      obj.position.copy(sp);
      obj.quaternion.copy(sq);
      pieces.push({ obj, start: { p: sp.clone(), q: sq.clone() }, end, placed: false, anim: -1, started: false, hull });
      // A punched-out outline on the card.
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(hull ? L * 1.02 : 1.5, hull ? 0.7 : 0.95), new THREE.MeshBasicMaterial({ color: '#3a2a1a', transparent: true, opacity: 0.6 }));
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(hull ? sp.x - L / 2 : sp.x, 0.008, sp.z);
      cardGroup.add(hole);
    };
    add(hullGroup, new THREE.Vector3(0, 0.12, 2.4), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), true);
    v.masts.forEach((m, k) => {
      const x = -L / 2 + (k - (v.masts.length - 1) / 2) * 1.05;
      add(m, new THREE.Vector3(x, 0.06, 0.7), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2)), false);
    });
    // Camera framing.
    const span = Math.max(L + 3, 6);
    const tall = stage.clientHeight > stage.clientWidth;
    camera.position.set(-L / 2 + span * 0.12, span * (tall ? 1.15 : 0.7), span * (tall ? 1.25 : 0.95) + 1.2);
    camera.lookAt(-L / 2, 0.9, 0.9);
    spin = 0;
  }

  function snap(p: Piece) {
    if (p.placed || p.started) return;
    // The hull goes first: masts wait for their sockets.
    const hullPiece = pieces.find((x) => x.hull && !x.placed);
    if (!p.hull && hullPiece) {
      if (!hullPiece.started) snap(hullPiece);
      const queued = pieces.filter((x) => x.started && !x.placed && !x.hull).length;
      p.started = true;
      p.anim = -(1 - Math.max(0, hullPiece.anim)) * 0.55 - 0.15 * queued - 0.05;
      return;
    }
    p.started = true;
    p.anim = 0;
    sfx.dice();
  }

  function done() {
    return pieces.every((p) => p.placed);
  }

  function autoBuild() {
    let delay = 0;
    for (const p of pieces) {
      if (p.placed || p.started) continue;
      setTimeout(() => snap(p), delay);
      delay += 260;
    }
  }

  const ray = new THREE.Raycaster();
  function onTap(ev: PointerEvent) {
    sfx.unlock();
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    const objs = pieces.filter((p) => !p.placed).map((p) => p.obj);
    const hit = ray.intersectObjects(objs, true)[0];
    if (hit) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !pieces.some((p) => p.obj === o)) o = o.parent;
      const p = pieces.find((x) => x.obj === o);
      if (p) snap(p);
    } else {
      // Missed: snap the next piece anyway, so it never feels stuck.
      const next = pieces.find((p) => !p.placed && !p.started);
      if (next) snap(next);
    }
  }
  renderer.domElement.addEventListener('pointerup', onTap);

  let raf = 0;
  let last = performance.now();
  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const p of pieces) {
      if (!p.started || p.placed) continue;
      if (p.anim < 0) {
        p.anim = Math.min(0, p.anim + dt);
        if (p.anim === 0) sfx.dice();
        continue;
      }
      p.anim = Math.min(1, p.anim + dt / 0.55);
      const k = easeOutBack(p.anim);
      p.obj.position.lerpVectors(p.start.p, p.end.p, k);
      p.obj.position.y += Math.sin(Math.min(1, p.anim) * Math.PI) * 1.4;
      p.obj.quaternion.slerpQuaternions(p.start.q, p.end.q, Math.min(1, p.anim * 1.3));
      if (p.anim >= 1) {
        p.placed = true;
        p.obj.position.copy(p.end.p);
        p.obj.quaternion.copy(p.end.q);
        sfx.snap();
        // Sparkle at the joint.
        const at = new THREE.Vector3().setFromMatrixPosition(p.obj.matrixWorld);
        for (let i = 0; i < 10; i++) {
          const m = new THREE.Mesh(sparkGeo, sparkMat);
          m.position.copy(at).add(new THREE.Vector3(0, 0.3, 0));
          scene.add(m);
          sparks.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3), t: 0 });
        }
        if (done()) {
          nextBtn.classList.remove('dim');
          nextBtn.classList.add('pulse');
          setTimeout(() => sfx.bell(), 120);
        }
      }
    }
    for (const s of [...sparks]) {
      s.t += dt;
      s.v.y -= 6 * dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.scale.setScalar(Math.max(0.01, 1 - s.t / 0.7));
      if (s.t > 0.7) {
        scene.remove(s.m);
        sparks.splice(sparks.indexOf(s), 1);
      }
    }
    if (shipGroup && done()) {
      spin += dt;
      shipGroup.rotation.y = Math.sin(spin * 0.8) * 0.5;
    }
    renderer.render(scene, camera);
  }

  function finish() {
    cleanup();
    onDone();
  }
  function cleanup() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    renderer.domElement.removeEventListener('pointerup', onTap);
    clearShip();
    sparks.forEach((s) => scene.remove(s.m));
    sparks = [];
    sparkGeo.dispose();
    sparkMat.dispose();
    disposeShared();
    renderer.dispose();
    renderer.forceContextLoss();
    root.remove();
  }

  nextBtn.addEventListener('click', () => {
    if (!done()) {
      autoBuild();
      return;
    }
    nextBtn.classList.remove('pulse');
    index++;
    if (index >= defs.length) finish();
    else load(index);
  });
  autoBtn.addEventListener('click', autoBuild);
  skipBtn.addEventListener('click', finish);

  resize();
  load(0);
  raf = requestAnimationFrame(loop);
  return cleanup;
}
