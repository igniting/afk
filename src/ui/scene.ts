// Presentation: the three.js machine board. It only *reads* simulation state and turns
// state changes into visuals — it never decides outcomes (spec §16).
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Sim } from '../sim/engine';
import { fmtTime, type Build, type TraceEntry } from '../sim/types';
import { LOGO_COLORS, drawPage } from './logo';
import { BenchView } from './bench';

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
  private detail = false;
  private ro: ResizeObserver;

  // parts
  private watcher = new THREE.Group();
  private dish!: THREE.Mesh;
  private watcherLamp!: THREE.Mesh;
  private watcherLabel!: CSS2DObject;
  private watcherSlot = new THREE.Group();
  private hook = new THREE.Group();
  private hookLabel!: CSS2DObject;
  private benches: BenchView[] = [];
  private benchSlot = new THREE.Group();
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
  private liveCanvas = document.createElement('canvas');
  private liveTex!: THREE.CanvasTexture;
  private liveKey = '';
  private liveLabel!: CSS2DObject;
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
    const worldLbl = label('Outside world', 'lbl zone world');
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
    this.slot('watcher', p, this.watcherSlot, '📡 Place watcher');

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
    for (const i of [0, 1, 2, 3]) {
      const b = new BenchView(i);
      tag(b.group, { kind: 'worker', idx: i });
      tag(b.tray, { kind: 'context', idx: i });
      b.group.visible = i === 0;
      this.benches.push(b);
      this.pickables.push(b.group);
      this.scene.add(b.group);
    }
    this.layoutBenches(1);
    this.slot('worker', POS.bench, this.benchSlot, '🛠️ Place worker');
  }

  /** One worker sits centre stage; two share the workbench pad side by side. */
  private layoutBenches(count: number) {
    this.benches.forEach((b, i) => {
      b.group.visible = i < count;
      if (count > 2) {
        // Four benches in a 2 × 2 grid on the workbench pad.
        b.group.position.set(POS.bench.x + (i % 2 === 0 ? -1.25 : 1.25), 0, POS.bench.z + (i < 2 ? -0.75 : 1.15));
        b.group.scale.setScalar(0.52);
      } else if (count > 1) {
        b.group.position.set(POS.bench.x + (i === 0 ? -1.25 : 1.25), 0, POS.bench.z);
        b.group.scale.setScalar(0.64);
      } else {
        b.group.position.copy(POS.bench);
        b.group.scale.setScalar(1);
      }
    });
  }

  private benchPos(i: number | undefined): THREE.Vector3 {
    const b = this.benches[i ?? 0];
    return b && b.group.visible ? b.group.position : POS.bench;
  }

  private buildRecords() {
    const j = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, 1.3), mat('#7c2d12'));
    cover.position.y = 0.15;
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.16, 1.22), mat('#fef3c7'));
    pages.position.set(0.04, 0.3, 0);
    cover.castShadow = pages.castShadow = true;
    j.add(cover, pages);
    this.journalLabel = label('Journal', 'lbl obj detail');
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
    const sl = label('Artifact shelf', 'lbl obj detail');
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

    this.liveCanvas.width = 512;
    this.liveCanvas.height = 320;
    this.liveTex = new THREE.CanvasTexture(this.liveCanvas);
    this.liveTex.colorSpace = THREE.SRGBColorSpace;
    this.drawLive(null, 1);
    const live = monitor(POS.live, this.liveTex, 'Live page · protected', { kind: 'live' });
    this.liveLabel = live.l;
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

  private drawLive(rev: number | null, version: number) {
    drawPage(this.liveCanvas.getContext('2d')!, 512, 320, { title: 'lumen.app', logoRev: rev, locked: rev == null, version });
    this.liveTex.needsUpdate = true;
  }

  private drawPreview(rev: number | null, version: number, tagline: string | null = null, needsTagline = false) {
    drawPage(this.previewCanvas.getContext('2d')!, 512, 320, { title: 'preview.lumen.app', logoRev: rev, version, tagline, needsTagline });
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

  /** Simple view hides technical labels (CPU/RAM, context units, journal) to keep the board readable. */
  setDetail(on: boolean) {
    this.host.dataset.detail = String(on);
    this.detail = on;
    if (this.build) this.setBuild(this.build);
  }

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
    const count = build.workers.filter(Boolean).length;
    this.layoutBenches(Math.max(count, 1));
    this.benches[0].group.visible = !!k;
    // Guided build: reveal the worker slot only once the watcher is placed.
    this.benchSlot.visible = !k && !this.sim && !build.accepted && (this.detail || !!w);
    for (const l of this.slotLabels) l.element.style.display = l.parent?.visible ? '' : 'none';
    if (w) this.watcherLabel.element.textContent = `Watcher · ${w.wake === 'keep' ? 'keeps watching' : w.wake === 'once' ? 'checks once' : 'wake rule?'}`;
    build.workers.forEach((wk, i) => {
      if (!wk) return;
      const jobs = wk.responsibilities.filter((r) => r === 'preview_logo' || r === 'launch' || build.accepted?.includes(r));
      const names: Record<string, string> = { preview_logo: 'logo', launch: 'launch', feedback: 'feedback', partner: 'Nora' };
      const label = jobs.length > 2 ? `${jobs.length} jobs` : jobs.map((j) => names[j] ?? j.replace(/_/g, ' ')).join(' + ');
      this.benches[i].setName(count > 1 || jobs.length > 1 ? `W${i + 1}: ${label}` : `${build.agentName} · worker`);
    });
    if (!this.sim) {
      this.benches.forEach((b) => b.reset());
      this.hook.visible = !!w && !!k;
      this.hookLabel.element.textContent = 'Jobs wait here for their emails';
    }
  }

  setSim(sim: Sim | null) {
    this.sim = sim;
    this.lastTrace = sim ? sim.state.trace.length : 0;
    this.flyers.forEach((f) => this.scene.remove(f.mesh));
    this.flyers = [];
    this.shelfKey = this.previewKey = this.liveKey = '';
    this.receiptGlow = 0;
    if (!sim) {
      this.drawPreview(null, 1);
      this.drawLive(null, 1);
      this.liveLabel.element.textContent = 'Live page · protected';
      this.previewLabel.element.textContent = 'Preview page · Relay may edit';
      this.inboxLabel.element.textContent = 'Inbox';
      this.shelfCards.clear();
      this.benches.forEach((b) => b.reset());
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
        return this.benchPos(t.idx);
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
      this.journalLabel.element.textContent = 'Journal (durable)';
      this.inboxLabel.element.textContent = 'Inbox';
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
        this.watcherLabel.element.textContent = `Watcher · ${wr.wake === 'keep' ? 'keeps watching' : 'checks once'} · on`;
      } else {
        wLamp.color.set('#475569');
        wLamp.emissive.set('#000');
        this.dish.rotation.x = -0.1;
        this.watcherLabel.element.textContent = 'Watcher · switched off';
      }
    }

    // Waiting hook: jobs parked on a person or an event, with no worker held.
    // Only work that is actually parked shows on the hook (not jobs that haven't been triggered yet).
    const waiting = s.tasks.filter(
      (t) =>
        (t.status === 'WAITING_EVENT' && t.run) ||
        t.status === 'WAITING_APPROVAL' ||
        t.status === 'WAITING_PERSON' ||
        t.status === 'WAITING_BUDGET' ||
        (t.status === 'WAITING_EVENT' && !t.runs.length && t.waitLabel !== 'Waiting for its trigger'),
    );
    this.hook.visible = waiting.length > 0;
    if (waiting.length) {
      const short = (t: (typeof waiting)[number]) =>
        t.status === 'WAITING_APPROVAL' ? 'Maya’s OK' : t.status === 'WAITING_BUDGET' ? 'credits (budget spent)' : t.waitLabel.replace(/^Keeping current: waiting for /, '').replace(/^Waiting for /i, '').replace(/^Wait (until|for) /i, '');
      const multi = s.tasks.length > 1;
      this.hookLabel.element.textContent = this.detail
        ? waiting.map((t) => `${t.id} waits: ${short(t)}`).join(' · ') + ` · ${this.fixtureAvailability(sim)}`
        : multi
          ? `Waiting: ${waiting.slice(0, 3).map(short).join(' · ')}${waiting.length > 3 ? ` +${waiting.length - 3}` : ''}`
          : `Waiting for ${short(waiting[0])}`;
      if (!this.reduceMotion) this.hook.rotation.z = Math.sin(this.now / 700) * 0.04;
    }

    this.layoutBenches(Math.max(1, s.workers.length));
    const armed = s.watchers.some((w) => w.armed);
    s.workers.forEach((w) => {
      const b = this.benches[w.idx];
      if (!b) return;
      const t = w.active ? s.tasks.find((x) => x.id === w.active!.taskId) : null;
      const short: Record<string, string> = { preview_logo: '', launch: 'Launch', feedback: 'Feedback', partner: 'Partner' };
      if (t && !(t.responsibility in short)) short[t.responsibility] = t.title.split(' ').slice(0, 2).join(' ');
      const name = s.workers.length > 1 ? `W${w.idx + 1}` : s.build.agentName;
      b.project({
        active: w.active,
        time: s.time,
        pulse,
        accent: this.accent,
        detail: this.detail,
        reduceMotion: this.reduceMotion,
        now: this.now,
        taskTitle: t && s.tasks.length > 1 ? short[t.responsibility] : null,
        name,
        idleText: this.detail ? `${name} · idle${armed ? ' · watcher armed' : ''}` : `${name} · idle`,
        ram: { used: s.ram.usedGB, total: s.ram.totalGB },
      });
      const packet = [...s.trace].reverse().find((e) => e.packet && e.worker === w.idx)?.packet ?? null;
      b.setTiles(packet);
    });

    // Live monitor
    const lk = `${s.world.live.version}:${s.world.live.logoRev}`;
    if (lk !== this.liveKey) {
      this.liveKey = lk;
      this.drawLive(s.world.live.logoRev, s.world.live.version);
      this.liveLabel.element.textContent = s.world.live.changedBy ? `Live page · v${s.world.live.version} · published` : s.goal === 'preview' ? 'Live page · protected' : 'Live page · needs Maya’s OK';
    }

    this.journalLabel.element.textContent = `Journal · ${s.journal.length} entries`;
    this.inboxLabel.element.textContent = `Inbox · ${s.world.inbox.length}`;

    // Preview monitor
    const pk = `${s.world.preview.version}:${s.world.preview.logoRev}:${s.world.preview.tagline}`;
    if (pk !== this.previewKey) {
      this.previewKey = pk;
      this.drawPreview(s.world.preview.logoRev, s.world.preview.version, s.world.preview.tagline, s.needsTagline);
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

  /** Which worker a delivered message goes to (for the flying-envelope animation). */
  private ownerOf(e: TraceEntry): number {
    const s = this.sim?.state;
    if (!s) return 0;
    const want = /Feedback/i.test(e.text) ? 'feedback' : /confirmed/i.test(e.text) ? 'partner' : null;
    const t = s.tasks.find((x) => (want ? x.responsibility === want : x.responsibility === 'launch' || x.responsibility === 'preview_logo'));
    return t?.owner ?? 0;
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
          this.fly(env2, POS.watcher, this.benchPos(this.ownerOf(e)), 700);
        });
        break;
      }
      case 'write': {
        const from = this.benchPos(e.worker);
        if (/Live page published/.test(e.text)) {
          this.fly(this.envelope('#4ade80'), from, POS.live, 900);
          break;
        }
        if (!/saved/.test(e.text)) break;
        const card = this.envelope(this.accent.getStyle());
        this.fly(card, from, /board|message/.test(e.text) ? POS.shelf : POS.preview, 900);
        const copy = this.envelope(this.accent.getStyle());
        this.fly(copy, from, POS.shelf, 900);
        break;
      }
      case 'verify':
        if (/Verified/.test(e.text)) this.receiptGlow = 1;
        break;
      case 'permission': {
        if (!/blocks/.test(e.text)) break;
        const from = this.benchPos(e.worker);
        const card = this.envelope('#f87171');
        this.fly(card, from, POS.live, 700, () => {
          this.liveFlash = 1;
          const back = this.envelope('#f87171');
          this.fly(back, POS.live, from, 600);
        });
        break;
      }
    }
  }
}
