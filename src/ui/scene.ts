// Presentation: the three.js machine board. It only *reads* simulation state and turns
// state changes into visuals — it never decides outcomes (spec §16).
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Sim } from '../sim/engine';
import { MODELS, fmtTime, type Build, type TraceEntry } from '../sim/types';
import { STEP_INFO } from '../sim/steps';
import { LOGO_COLORS, drawPage } from './logo';

export type Target =
  | { kind: 'watcher'; idx: number }
  | { kind: 'worker'; idx: number }
  | { kind: 'context'; idx: number }
  | { kind: 'journal' }
  | { kind: 'shelf' }
  | { kind: 'inbox' }
  | { kind: 'preview' }
  | { kind: 'live' };

export interface SceneCallbacks {
  onSelect(t: Target): void;
  onSlot(kind: 'watcher' | 'worker'): void;
}

const POS = {
  watcher: new THREE.Vector3(-4.7, 0, 0.7),
  bench: new THREE.Vector3(0, 0, 0.7),
  journal: new THREE.Vector3(3.9, 0, 1.5),
  shelf: new THREE.Vector3(5.1, 0, -0.1),
  inbox: new THREE.Vector3(-4.7, 0, -3.5),
  preview: new THREE.Vector3(0.4, 0, -3.7),
  live: new THREE.Vector3(4.6, 0, -3.7),
};

interface Flyer {
  mesh: THREE.Object3D;
  path: THREE.Vector3[];
  t0: number;
  dur: number;
  done?: () => void;
}

const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05, ...extra });

function label(text: string, cls = 'lbl'): CSS2DObject {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  return new CSS2DObject(div);
}

function tag(obj: THREE.Object3D, target: Target) {
  obj.traverse((o) => (o.userData.target = target));
}

export class BoardScene {
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private raycaster = new THREE.Raycaster();
  private pickables: THREE.Object3D[] = [];
  private flyers: Flyer[] = [];
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private accent = new THREE.Color('#5eead4');
  private lastTrace = 0;
  private now = 0;
  private sim: Sim | null = null;
  private build: Build | null = null;
  private selected: Target | null = null;
  private ro: ResizeObserver;

  // parts
  private watcher = new THREE.Group();
  private dish!: THREE.Mesh;
  private watcherLamp!: THREE.Mesh;
  private watcherLabel!: CSS2DObject;
  private watcherSlot = new THREE.Group();
  private hook = new THREE.Group();
  private hookLabel!: CSS2DObject;
  private bench = new THREE.Group();
  private benchSlot = new THREE.Group();
  private benchLabel!: CSS2DObject;
  private modelLamp!: THREE.Mesh;
  private modelLabel!: CSS2DObject;
  private cpuFill!: THREE.Mesh;
  private ramFill!: THREE.Mesh;
  private cpuLabel!: CSS2DObject;
  private taskCard = new THREE.Group();
  private taskLabel!: CSS2DObject;
  private progress!: THREE.Mesh;
  private tray = new THREE.Group();
  private trayTiles = new THREE.Group();
  private trayLabel!: CSS2DObject;
  private trayKey = '';
  private journalLabel!: CSS2DObject;
  private shelfCards = new THREE.Group();
  private shelfKey = '';
  private inboxLabel!: CSS2DObject;
  private inboxFlag!: THREE.Mesh;
  private previewCanvas = document.createElement('canvas');
  private previewTex!: THREE.CanvasTexture;
  private previewKey = '';
  private previewLabel!: CSS2DObject;
  private liveLock!: THREE.Mesh;
  private liveFlash = 0;
  private receipt!: THREE.Mesh;
  private receiptGlow = 0;
  private selection!: THREE.Mesh;
  private slotLabels: CSS2DObject[] = [];

  constructor(private host: HTMLElement, private cb: SceneCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    host.appendChild(this.labels.domElement);

    this.scene.background = new THREE.Color('#0b1120');
    this.scene.fog = new THREE.Fog('#0b1120', 22, 40);
    this.buildWorld();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.bindPointer();
  }

  dispose() {
    this.ro.disconnect();
    this.renderer.dispose();
    this.host.innerHTML = '';
  }

  // -------------------------------------------------------------------------
  // Static world

  private buildWorld() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#c7d2fe', '#0b1120', 0.9));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(-5, 12, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
    s.add(sun);

    const board = new THREE.Mesh(new THREE.BoxGeometry(15.5, 0.4, 6.2), mat('#1e293b'));
    board.position.set(0, -0.2, 0.75);
    board.receiveShadow = true;
    s.add(board);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(15.5, 0.3, 3), mat('#111a2e'));
    strip.position.set(0, -0.25, -3.6);
    strip.receiveShadow = true;
    s.add(strip);
    const worldLbl = label('Outside world — observer view', 'lbl zone world');
    worldLbl.position.set(7.4, 0.05, -2.25);
    worldLbl.center.set(1, 0.5);
    s.add(worldLbl);

    const pads: [string, THREE.Vector3, number][] = [
      ['Watchers', new THREE.Vector3(-4.7, 0, 0.75), 3.6],
      ['Workbench', new THREE.Vector3(0, 0, 0.75), 5],
      ['Shared records', new THREE.Vector3(4.65, 0, 0.75), 3.6],
    ];
    for (const [name, p, w] of pads) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 5.4), mat('#273449'));
      pad.position.set(p.x, 0.03, p.z);
      pad.receiveShadow = true;
      s.add(pad);
      const l = label(name, 'lbl zone');
      l.position.set(p.x, 0.1, p.z + 2.8);
      s.add(l);
    }

    this.buildWatcher();
    this.buildBench();
    this.buildRecords();
    this.buildOutside();

    this.selection = new THREE.Mesh(
      new THREE.RingGeometry(1.3, 1.45, 48),
      new THREE.MeshBasicMaterial({ color: '#fbbf24', transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    this.selection.rotation.x = -Math.PI / 2;
    this.selection.visible = false;
    s.add(this.selection);
  }

  private slot(kind: 'watcher' | 'worker', at: THREE.Vector3, group: THREE.Group, text: string) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.0, 40),
      new THREE.MeshBasicMaterial({ color: '#64748b', transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, 0.08, at.z);
    group.add(ring);
    const btnDiv = document.createElement('button');
    btnDiv.className = 'slot-btn';
    btnDiv.textContent = text;
    btnDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onSlot(kind);
    });
    const l = new CSS2DObject(btnDiv);
    l.position.set(at.x, 0.4, at.z);
    group.add(l);
    this.slotLabels.push(l);
    this.scene.add(group);
  }

  private buildWatcher() {
    const p = POS.watcher;
    const g = this.watcher;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.25, 32), mat('#334155'));
    base.position.y = 0.12;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.4, 12), mat('#94a3b8'));
    pole.position.y = 0.9;
    this.dish = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2.8),
      mat('#cbd5e1', { side: THREE.DoubleSide }),
    );
    this.dish.position.y = 1.65;
    this.dish.rotation.x = -1.0; // faces the inbox behind it
    this.watcherLamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), mat('#5eead4', { emissive: '#5eead4', emissiveIntensity: 1 }));
    this.watcherLamp.position.set(0, 1.62, 0.05);
    for (const m of [base, pole, this.dish]) m.castShadow = true;
    g.add(base, pole, this.dish, this.watcherLamp);
    this.watcherLabel = label('Inbox watcher', 'lbl obj');
    this.watcherLabel.position.set(-0.9, -0.05, 2.0);
    this.watcherLabel.center.set(0.2, 0.5); // anchor near its left so it stays on narrow screens
    g.add(this.watcherLabel);
    g.position.copy(p);
    tag(g, { kind: 'watcher', idx: 0 });
    this.pickables.push(g);
    this.scene.add(g);
    this.slot('watcher', p, this.watcherSlot, '+ Place watcher');

    // Waiting hook: a task card hanging from a hook (spec §7.2)
    const h = this.hook;
    const hookMesh = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 24, Math.PI * 1.3), mat('#fbbf24', { metalness: 0.5 }));
    hookMesh.position.set(0, 2.75, 0);
    hookMesh.rotation.z = Math.PI * 0.85;
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 6), mat('#fbbf24'));
    string.position.set(0, 2.38, 0);
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.04), mat('#fde68a'));
    card.position.set(0, 1.95 + 0.0, 0);
    card.castShadow = true;
    h.add(hookMesh, string, card);
    this.hookLabel = label('', 'lbl hook');
    this.hookLabel.position.set(0, 3.15, 0);
    h.add(this.hookLabel);
    h.position.set(p.x + 1.15, 0, p.z - 0.2);
    h.visible = false;
    tag(h, { kind: 'watcher', idx: 0 });
    this.scene.add(h);
  }

  private buildBench() {
    const p = POS.bench;
    const g = this.bench;
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, 2.0), mat('#475569'));
    top.position.y = 0.92;
    top.castShadow = top.receiveShadow = true;
    g.add(top);
    for (const [x, z] of [[-1.65, -0.85], [1.65, -0.85], [-1.65, 0.85], [1.65, 0.85]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.12), mat('#334155'));
      leg.position.set(x, 0.42, z);
      leg.castShadow = true;
      g.add(leg);
    }
    // Model module: a replaceable decision box with a lamp lit only during remote inference.
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.7), mat('#1e1b4b'));
    box.position.set(-1.15, 1.28, -0.45);
    box.castShadow = true;
    this.modelLamp = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 20), mat('#312e81', { emissive: '#000000' }));
    this.modelLamp.position.set(-1.15, 1.7, -0.45);
    g.add(box, this.modelLamp);
    this.modelLabel = label('Model', 'lbl small');
    this.modelLabel.position.set(-1.15, 2.05, -0.45);
    g.add(this.modelLabel);

    // CPU & RAM meters
    const meter = (x: number, color: string) => {
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 1.4, 0.28),
        new THREE.MeshStandardMaterial({ color: '#94a3b8', transparent: true, opacity: 0.18 }),
      );
      frame.position.set(x, 1.7, -0.7);
      const fill = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.36, 0.24), mat(color, { emissive: color, emissiveIntensity: 0.35 }));
      fill.position.set(x, 1.02, -0.7);
      fill.scale.y = 0.001;
      g.add(frame, fill);
      return fill;
    };
    this.cpuFill = meter(1.15, '#f59e0b');
    this.ramFill = meter(1.55, '#60a5fa');
    // One combined label avoids overlap: "CPU idle · RAM 0/2 GB".
    this.cpuLabel = label('CPU', 'lbl small');
    this.cpuLabel.position.set(1.35, 2.7, -0.7);
    g.add(this.cpuLabel);

    // Task card with progress bar
    const card = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.7), mat('#e2e8f0'));
    this.taskCard.add(card);
    this.progress = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.08), mat('#5eead4', { emissive: '#5eead4', emissiveIntensity: 0.6 }));
    this.progress.position.set(0, 0.03, 0.27);
    this.taskCard.add(this.progress);
    this.taskCard.position.set(0.05, 1.6, -0.2);
    this.taskCard.rotation.x = 0.5;
    this.taskLabel = label('', 'lbl task');
    this.taskLabel.position.set(0, 0.55, 0);
    this.taskCard.add(this.taskLabel);
    this.taskCard.visible = false;
    g.add(this.taskCard);

    // Context tray
    const tray = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.62), mat('#0f172a'));
    this.tray.add(tray, this.trayTiles);
    this.tray.position.set(-0.45, 1.03, 0.55);
    this.trayLabel = label('Context tray', 'lbl small');
    this.trayLabel.position.set(0, 0, 0.62);
    this.tray.add(this.trayLabel);
    tag(this.tray, { kind: 'context', idx: 0 });
    g.add(this.tray);

    this.benchLabel = label('Worker 1', 'lbl obj');
    this.benchLabel.position.set(0, 0.0, 1.45);
    g.add(this.benchLabel);
    g.position.copy(p);
    tag(g, { kind: 'worker', idx: 0 });
    tag(this.tray, { kind: 'context', idx: 0 });
    this.pickables.push(g);
    this.scene.add(g);
    this.slot('worker', p, this.benchSlot, '+ Place worker');
  }

  private buildRecords() {
    const j = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, 1.3), mat('#7c2d12'));
    cover.position.y = 0.15;
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.16, 1.22), mat('#fef3c7'));
    pages.position.set(0.04, 0.3, 0);
    cover.castShadow = pages.castShadow = true;
    j.add(cover, pages);
    this.journalLabel = label('Journal', 'lbl obj');
    this.journalLabel.position.set(0, 0.0, 0.95);
    j.add(this.journalLabel);
    j.position.copy(POS.journal);
    tag(j, { kind: 'journal' });
    this.pickables.push(j);
    this.scene.add(j);

    const s = new THREE.Group();
    const plank = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 0.7), mat('#a16207'));
    plank.position.y = 0.6;
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 0.08), mat('#713f12'));
    back.position.set(0, 0.65, -0.33);
    for (const m of [plank, back]) m.castShadow = true;
    s.add(plank, back, this.shelfCards);
    const sl = label('Artifact shelf', 'lbl obj');
    sl.position.set(0, 0.0, 0.6);
    s.add(sl);
    s.position.copy(POS.shelf);
    tag(s, { kind: 'shelf' });
    this.pickables.push(s);
    this.scene.add(s);
  }

  private buildOutside() {
    // Inbox
    const ib = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.9), mat('#2563eb'));
    box.position.y = 0.9;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, 0.15), mat('#334155'));
    post.position.y = 0.3;
    this.inboxFlag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.25), mat('#ef4444'));
    this.inboxFlag.position.set(0.68, 1.1, 0.1);
    box.castShadow = true;
    ib.add(box, post, this.inboxFlag);
    this.inboxLabel = label('Inbox', 'lbl obj');
    this.inboxLabel.position.set(0, 1.65, 0);
    ib.add(this.inboxLabel);
    ib.position.copy(POS.inbox);
    tag(ib, { kind: 'inbox' });
    this.pickables.push(ib);
    this.scene.add(ib);

    // Monitors
    const monitor = (pos: THREE.Vector3, tex: THREE.Texture, title: string, target: Target) => {
      const g = new THREE.Group();
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 0.2), mat('#334155'));
      stand.position.y = 0.45;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.65, 0.12), mat('#0f172a'));
      frame.position.y = 1.65;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.45, 1.5), new THREE.MeshBasicMaterial({ map: tex }));
      screen.position.set(0, 1.65, 0.07);
      frame.castShadow = true;
      g.add(stand, frame, screen);
      const l = label(title, 'lbl obj');
      l.position.set(0, 2.75, 0);
      g.add(l);
      g.position.copy(pos);
      tag(g, target);
      this.pickables.push(g);
      this.scene.add(g);
      return { g, l };
    };
    this.previewCanvas.width = 512;
    this.previewCanvas.height = 320;
    this.previewTex = new THREE.CanvasTexture(this.previewCanvas);
    this.previewTex.colorSpace = THREE.SRGBColorSpace;
    this.previewLabel = monitor(POS.preview, this.previewTex, 'Preview page · Relay may edit', { kind: 'preview' }).l;
    this.drawPreview(null, 1);

    const liveCanvas = document.createElement('canvas');
    liveCanvas.width = 512;
    liveCanvas.height = 320;
    drawPage(liveCanvas.getContext('2d')!, 512, 320, { title: 'lumen.app', logoRev: null, locked: true, version: 1 });
    const liveTex = new THREE.CanvasTexture(liveCanvas);
    liveTex.colorSpace = THREE.SRGBColorSpace;
    const live = monitor(POS.live, liveTex, 'Live page · protected', { kind: 'live' });
    this.liveLock = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.06, 8, 20, Math.PI), mat('#94a3b8', { metalness: 0.6, emissive: '#000' }));
    this.liveLock.position.set(1.1, 2.62, 0.1);
    const lockBody = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.36, 0.14), mat('#94a3b8', { metalness: 0.6 }));
    lockBody.position.set(1.1, 2.42, 0.1);
    live.g.add(this.liveLock, lockBody);

    // Receipt line from bench to preview monitor
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(POS.bench.x + 0.3, 1.2, POS.bench.z - 0.9),
      new THREE.Vector3((POS.bench.x + POS.preview.x) / 2, 2.6, (POS.bench.z + POS.preview.z) / 2),
      new THREE.Vector3(POS.preview.x, 1.2, POS.preview.z + 0.2),
    );
    this.receipt = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 40, 0.045, 8),
      new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0 }),
    );
    this.scene.add(this.receipt);
  }

  private drawPreview(rev: number | null, version: number) {
    drawPage(this.previewCanvas.getContext('2d')!, 512, 320, { title: 'preview.lumen.app', logoRev: rev, version });
    this.previewTex.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // Inputs

  private bindPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
      const t = this.pick(e);
      if (t) this.cb.onSelect(t);
    });
    el.addEventListener('pointermove', (e) => {
      el.style.cursor = this.pick(e) ? 'pointer' : 'default';
    });
  }

  private pick(e: PointerEvent): Target | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables.filter((p) => p.visible), true);
    for (const h of hits) if (h.object.userData.target) return h.object.userData.target as Target;
    return null;
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Fit the board width (~16 units) horizontally; keep a pleasant tilt.
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const portrait = aspect < 1.3;
    // In portrait the board is width-limited, so look more top-down to use the vertical space.
    const distW = (portrait ? 7.6 : 8.1) / Math.tan(hfov / 2);
    const distH = 5.6 / Math.tan(vfov / 2);
    const dist = Math.max(distW, distH);
    const dir = (portrait ? new THREE.Vector3(0, 0.9, 0.44) : new THREE.Vector3(0, 0.78, 0.63)).normalize();
    this.camera.position.copy(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, 0, -0.9));
    this.camera.lookAt(0, 0.6, -0.9);
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  // State projection

  setAccent(hex: string) {
    this.accent.set(hex);
  }

  setBuild(build: Build) {
    this.build = build;
    this.setAccent(build.accent);
    const w = build.watchers[0];
    const k = build.workers[0];
    this.watcher.visible = !!w;
    this.watcherSlot.visible = !w && !this.sim;
    this.bench.visible = !!k;
    this.benchSlot.visible = !k && !this.sim;
    for (const l of this.slotLabels) l.element.style.display = l.parent?.visible ? '' : 'none';
    if (w) this.watcherLabel.element.textContent = `Inbox watcher · ${w.wake === 'keep' ? 'Keep current' : w.wake === 'once' ? 'Once' : 'wake rule?'}`;
    if (k) {
      const d = k.procedure.find((s) => s.kind === 'decide');
      this.modelLabel.element.textContent = d?.model ? `Model: ${MODELS[d.model].name}` : 'Model: —';
      this.benchLabel.element.textContent = `${build.agentName} · Worker 1`;
    }
    if (!this.sim) {
      this.taskCard.visible = false;
      this.hook.visible = !!w && !!k;
      this.hookLabel.element.textContent = 'T1 will wait here for Isha’s logo';
      this.setTrayTiles([]);
    }
  }

  setSim(sim: Sim | null) {
    this.sim = sim;
    this.lastTrace = sim ? sim.state.trace.length : 0;
    this.flyers.forEach((f) => this.scene.remove(f.mesh));
    this.flyers = [];
    this.shelfKey = this.trayKey = this.previewKey = '';
    this.receiptGlow = 0;
    if (!sim) {
      this.drawPreview(null, 1);
      this.shelfCards.clear();
      this.setTrayTiles([]);
    }
    if (this.build) this.setBuild(sim ? sim.state.build : this.build);
  }

  setSelected(t: Target | null) {
    this.selected = t;
  }

  private posOf(t: Target): THREE.Vector3 | null {
    switch (t.kind) {
      case 'watcher':
        return POS.watcher;
      case 'worker':
      case 'context':
        return POS.bench;
      case 'journal':
        return POS.journal;
      case 'shelf':
        return POS.shelf;
      case 'inbox':
        return POS.inbox;
      case 'preview':
        return POS.preview;
      case 'live':
        return POS.live;
    }
  }

  private setTrayTiles(tiles: { units: number; included: boolean; category: string }[]) {
    const key = JSON.stringify(tiles);
    if (key === this.trayKey) return;
    this.trayKey = key;
    this.trayTiles.clear();
    let x = -0.88;
    let ex = 1.15;
    const colors: Record<string, string> = { header: '#64748b', pinned: '#fbbf24', retrieved: '#38bdf8', raw: '#a78bfa', file: '#f472b6' };
    for (const t of tiles) {
      const w = t.units * 0.085;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w - 0.02, 0.08, 0.42), mat(colors[t.category] ?? '#999', { transparent: !t.included, opacity: t.included ? 1 : 0.55 }));
      if (t.included) {
        m.position.set(x + w / 2, 0.07, 0);
        x += w;
      } else {
        m.position.set(ex + w / 2, 0.0, 0.05);
        m.rotation.y = 0.25;
        ex += w + 0.05;
      }
      m.castShadow = true;
      this.trayTiles.add(m);
    }
    tag(this.tray, { kind: 'context', idx: 0 });
  }

  /** Called every animation frame. */
  frame(nowMs: number) {
    const dt = this.now ? Math.min(0.1, (nowMs - this.now) / 1000) : 0;
    this.now = nowMs;
    const sim = this.sim;
    const pulse = this.reduceMotion ? 1 : 0.75 + 0.25 * Math.sin(nowMs / 300);

    // Selection ring
    const sp = this.selected && this.posOf(this.selected);
    this.selection.visible = !!sp;
    if (sp) this.selection.position.set(sp.x, 0.09, sp.z);

    if (sim) this.projectSim(sim, pulse);
    else {
      (this.watcherLamp.material as THREE.MeshStandardMaterial).emissive.copy(this.accent).multiplyScalar(0.4);
      (this.modelLamp.material as THREE.MeshStandardMaterial).emissive.set('#000');
      this.cpuFill.scale.y = this.ramFill.scale.y = 0.001;
      this.cpuLabel.element.textContent = 'CPU idle · RAM 0/2 GB';
      this.journalLabel.element.textContent = 'Journal (durable)';
      this.inboxLabel.element.textContent = 'Inbox';
      this.trayLabel.element.textContent = 'Context tray';
    }

    // Flyers
    for (const f of [...this.flyers]) {
      const u = Math.min(1, (nowMs - f.t0) / f.dur);
      const [a, c, b] = f.path;
      const p = new THREE.Vector3()
        .copy(a)
        .multiplyScalar((1 - u) * (1 - u))
        .add(c.clone().multiplyScalar(2 * u * (1 - u)))
        .add(b.clone().multiplyScalar(u * u));
      f.mesh.position.copy(p);
      f.mesh.rotation.y += dt * 3;
      if (u >= 1) {
        this.scene.remove(f.mesh);
        this.flyers.splice(this.flyers.indexOf(f), 1);
        f.done?.();
      }
    }

    // Receipt glow & live lock flash decay
    this.receiptGlow = Math.max(0, this.receiptGlow - dt * 0.35);
    (this.receipt.material as THREE.MeshBasicMaterial).opacity = this.receiptGlow * 0.9;
    this.liveFlash = Math.max(0, this.liveFlash - dt * 0.8);
    (this.liveLock.material as THREE.MeshStandardMaterial).emissive.setRGB(this.liveFlash, 0, 0);

    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  private projectSim(sim: Sim, pulse: number) {
    const s = sim.state;
    const wr = s.watchers[0];
    const wLamp = this.watcherLamp.material as THREE.MeshStandardMaterial;
    if (wr) {
      if (wr.armed) {
        wLamp.color.copy(this.accent);
        wLamp.emissive.copy(this.accent).multiplyScalar(pulse);
        this.dish.rotation.x = -1.0;
        this.watcherLabel.element.textContent = `Watcher · ${wr.wake === 'keep' ? 'Keep current' : 'Once'} · armed`;
      } else {
        wLamp.color.set('#475569');
        wLamp.emissive.set('#000');
        this.dish.rotation.x = -0.1;
        this.watcherLabel.element.textContent = 'Watcher · closed (Once)';
      }
    }

    const task = s.tasks[0];
    const worker = s.workers[0];
    const active = worker?.active;

    // Waiting hook
    const waiting = task && task.status === 'WAITING_EVENT';
    this.hook.visible = !!waiting;
    if (waiting) {
      const avail = this.fixtureAvailability(sim);
      this.hookLabel.element.textContent = `${task.id} waiting: ${task.status === 'WAITING_EVENT' ? 'logo from Isha' : ''} · ${avail}`;
      if (!this.reduceMotion) this.hook.rotation.z = Math.sin(this.now / 700) * 0.04;
    }

    // Model lamp: on only during remote inference; CPU can stay idle meanwhile.
    const lamp = this.modelLamp.material as THREE.MeshStandardMaterial;
    if (active?.remote) {
      lamp.emissive.set('#a78bfa').multiplyScalar(0.5 + 0.8 * pulse);
      this.modelLabel.element.textContent = `Model: ${MODELS[active.step.model ?? 'swift'].name} · thinking (remote)`;
    } else {
      lamp.emissive.set('#000');
      const d = s.build.workers[0]?.procedure.find((x) => x.kind === 'decide');
      this.modelLabel.element.textContent = d?.model ? `Model: ${MODELS[d.model].name}` : 'Model';
    }
    const cpu = active?.cpu ? 1 : 0;
    this.cpuFill.scale.y = Math.max(0.001, cpu);
    this.cpuFill.position.y = 1.02 + 0.68 * cpu;
    const ram = s.ram.usedGB / s.ram.totalGB;
    this.cpuLabel.element.textContent = `${cpu ? 'CPU 1/1 busy' : 'CPU idle'} · RAM ${s.ram.usedGB}/${s.ram.totalGB} GB`;
    this.ramFill.scale.y = Math.max(0.001, ram);
    this.ramFill.position.y = 1.02 + 0.68 * ram;

    // Task card & progress
    if (active) {
      this.taskCard.visible = true;
      const u = (s.time - active.start) / Math.max(1, active.end - active.start);
      this.progress.scale.x = Math.max(0.01, Math.min(1, u));
      this.progress.position.x = -0.5 + 0.5 * this.progress.scale.x;
      const left = Math.max(0, active.end - s.time) / 1000;
      const mm = Math.floor(left / 60);
      const ss = Math.floor(left % 60);
      this.taskLabel.element.textContent = `${active.taskId} · ${STEP_INFO[active.step.kind].label}${active.step.kind === 'decide' ? ` (${MODELS[active.step.model ?? 'swift'].name})` : ''} · ${mm}:${String(ss).padStart(2, '0')} left`;
      ((this.taskCard.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.copy(this.accent);
      this.benchLabel.element.textContent = `${s.build.agentName} · Worker 1 · working`;
      if (!this.reduceMotion) this.taskCard.position.y = 1.6 + Math.sin(this.now / 400) * 0.04;
    } else {
      this.taskCard.visible = false;
      const armed = s.watchers.some((w) => w.armed);
      this.benchLabel.element.textContent = `${s.build.agentName} · idle · 0 active workers${armed ? ' · watcher armed' : ''}`;
    }

    // Context tray: show the latest packet for this worker
    const lastPacket = [...s.trace].reverse().find((e) => e.packet && e.worker === 0)?.packet;
    if (lastPacket) {
      this.setTrayTiles(lastPacket.tiles);
      const ex = lastPacket.tiles.filter((t) => !t.included).length;
      this.trayLabel.element.textContent = `Context ${lastPacket.used}/${lastPacket.capacity} units${ex ? ` · ${ex} left out` : ''}`;
    } else {
      this.setTrayTiles([]);
      this.trayLabel.element.textContent = 'Context tray · empty';
    }

    this.journalLabel.element.textContent = `Journal · ${s.journal.length} entries`;
    this.inboxLabel.element.textContent = `Inbox · ${s.world.inbox.length}`;

    // Preview monitor
    const pk = `${s.world.preview.version}:${s.world.preview.logoRev}`;
    if (pk !== this.previewKey) {
      this.previewKey = pk;
      this.drawPreview(s.world.preview.logoRev, s.world.preview.version);
      this.previewLabel.element.textContent = `Preview page · v${s.world.preview.version}`;
    }

    // Shelf cards (versioned artifacts)
    const sk = JSON.stringify(s.shelf);
    if (sk !== this.shelfKey) {
      this.shelfKey = sk;
      this.shelfCards.clear();
      const shown = s.shelf.slice(-5);
      shown.forEach((v, i) => {
        const temp = v.storage === 'temporary';
        const card = new THREE.Mesh(
          new THREE.BoxGeometry(0.42, 0.6, 0.04),
          mat(LOGO_COLORS[v.logoRev] ?? '#999', { transparent: temp, opacity: temp ? 0.45 : 1 }),
        );
        card.position.set(-1.0 + i * 0.5, 0.97, -0.05);
        card.rotation.x = -0.12;
        card.castShadow = true;
        this.shelfCards.add(card);
      });
      tag(this.shelfCards, { kind: 'shelf' });
    }

    // New trace entries → animations
    const fresh = s.trace.slice(this.lastTrace);
    this.lastTrace = s.trace.length;
    for (const e of fresh) this.animate(e);
  }

  private fixtureAvailability(sim: Sim): string {
    const a = sim.fixture.availability.isha;
    return sim.state.time <= a.until ? `Isha online until ${fmtTime(a.until)}` : 'Isha offline';
  }

  private envelope(color = '#f8fafc'): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.3), mat(color, { emissive: color, emissiveIntensity: 0.25 }));
    m.castShadow = true;
    this.scene.add(m);
    return m;
  }

  private fly(mesh: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, dur = 900, done?: () => void) {
    if (this.reduceMotion) {
      this.scene.remove(mesh);
      done?.();
      return;
    }
    const a = from.clone().setY(from.y + 1.4);
    const b = to.clone().setY(to.y + 1.4);
    const c = a.clone().lerp(b, 0.5).setY(Math.max(a.y, b.y) + 1.6);
    this.flyers.push({ mesh, path: [a, c, b], t0: this.now, dur, done });
  }

  private animate(e: TraceEntry) {
    switch (e.kind) {
      case 'world': {
        const env = this.envelope('#fde68a');
        const sky = POS.inbox.clone().add(new THREE.Vector3(-1.5, 3, -1));
        this.fly(env, sky, POS.inbox, 800);
        if (!this.reduceMotion) this.inboxFlag.rotation.z = -0.9;
        break;
      }
      case 'deliver': {
        const env = this.envelope('#fde68a');
        this.fly(env, POS.inbox, POS.watcher, 700, () => {
          const env2 = this.envelope(this.accent.getStyle());
          this.fly(env2, POS.watcher, POS.bench, 700);
        });
        break;
      }
      case 'write': {
        if (!/saved/.test(e.text)) break;
        const card = this.envelope(this.accent.getStyle());
        this.fly(card, POS.bench, POS.preview, 900);
        const copy = this.envelope(this.accent.getStyle());
        this.fly(copy, POS.bench, POS.shelf, 900);
        break;
      }
      case 'verify':
        if (/Verified/.test(e.text)) this.receiptGlow = 1;
        break;
      case 'permission': {
        const card = this.envelope('#f87171');
        this.fly(card, POS.bench, POS.live, 700, () => {
          this.liveFlash = 1;
          const back = this.envelope('#f87171');
          this.fly(back, POS.live, POS.bench, 600);
        });
        break;
      }
    }
  }
}
