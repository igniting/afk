// One workbench on the board: model lamp, CPU/RAM meters, task card and context tray.
// The scene creates one per worker slot and positions them side by side.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { MODELS, type ActiveStep, type ContextPacket } from '../sim/types';
import { PURPOSE_LABEL, STEP_INFO } from '../sim/steps';

const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05, ...extra });

function label(text: string, cls: string): CSS2DObject {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  return new CSS2DObject(div);
}

const TILE_COLORS: Record<string, string> = { header: '#64748b', pinned: '#fbbf24', retrieved: '#38bdf8', raw: '#a78bfa', file: '#f472b6' };

export class BenchView {
  readonly group = new THREE.Group();
  readonly tray = new THREE.Group();
  private trayTiles = new THREE.Group();
  private trayKey = '';
  private lamp: THREE.Mesh;
  private modelLabel: CSS2DObject;
  private cpuFill: THREE.Mesh;
  private ramFill: THREE.Mesh;
  private meterLabel: CSS2DObject;
  private card = new THREE.Group();
  private cardMesh: THREE.Mesh;
  private progress: THREE.Mesh;
  private taskLabel: CSS2DObject;
  private trayLabel: CSS2DObject;
  private nameLabel: CSS2DObject;

  constructor(readonly idx: number) {
    const g = this.group;
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
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 20), mat('#312e81', { emissive: '#000000' }));
    this.lamp.position.set(-1.15, 1.7, -0.45);
    g.add(box, this.lamp);
    this.modelLabel = label('AI model', 'lbl small');
    this.modelLabel.position.set(-1.15, 2.05, -0.45);
    g.add(this.modelLabel);

    const meter = (x: number, color: string) => {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.4, 0.28), new THREE.MeshStandardMaterial({ color: '#94a3b8', transparent: true, opacity: 0.18 }));
      frame.position.set(x, 1.7, -0.7);
      const fill = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.36, 0.24), mat(color, { emissive: color, emissiveIntensity: 0.35 }));
      fill.position.set(x, 1.02, -0.7);
      fill.scale.y = 0.001;
      g.add(frame, fill);
      return fill;
    };
    this.cpuFill = meter(1.15, '#f59e0b');
    this.ramFill = meter(1.55, '#60a5fa');
    this.meterLabel = label('CPU idle', 'lbl small detail');
    this.meterLabel.position.set(1.35, 2.7, -0.7);
    g.add(this.meterLabel);

    this.cardMesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.7), mat('#e2e8f0'));
    this.card.add(this.cardMesh);
    this.progress = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.08), mat('#5eead4', { emissive: '#5eead4', emissiveIntensity: 0.6 }));
    this.progress.position.set(0, 0.03, 0.27);
    this.card.add(this.progress);
    this.card.position.set(0.05, 1.6, -0.2);
    this.card.rotation.x = 0.5;
    this.taskLabel = label('', 'lbl task');
    this.taskLabel.position.set(0, 0.55, 0);
    this.card.add(this.taskLabel);
    this.card.visible = false;
    g.add(this.card);

    const trayMesh = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.62), mat('#0f172a'));
    this.tray.add(trayMesh, this.trayTiles);
    this.tray.position.set(-0.45, 1.03, 0.55);
    this.trayLabel = label('Context tray', 'lbl small detail');
    this.trayLabel.position.set(0, 0, 0.62);
    this.tray.add(this.trayLabel);
    g.add(this.tray);

    this.nameLabel = label(`Worker ${idx + 1}`, 'lbl obj');
    this.nameLabel.position.set(0, 0.0, 1.45);
    g.add(this.nameLabel);
  }

  setName(text: string) {
    this.nameLabel.element.textContent = text;
  }

  setModelText(text: string) {
    this.modelLabel.element.textContent = text;
  }

  reset() {
    this.card.visible = false;
    (this.lamp.material as THREE.MeshStandardMaterial).emissive.set('#000');
    this.cpuFill.scale.y = this.ramFill.scale.y = 0.001;
    this.meterLabel.element.textContent = 'CPU idle';
    this.setTiles(null);
  }

  setTiles(packet: ContextPacket | null) {
    const tiles = packet?.tiles ?? [];
    const key = JSON.stringify(tiles.map((t) => [t.units, t.included, t.category]));
    this.trayLabel.element.textContent = packet
      ? `Context ${packet.used}/${packet.capacity} units${tiles.some((t) => !t.included) ? ` · ${tiles.filter((t) => !t.included).length} left out` : ''}`
      : 'Context tray';
    if (key === this.trayKey) return;
    this.trayKey = key;
    this.trayTiles.clear();
    let x = -0.88;
    let ex = 1.15;
    for (const t of tiles) {
      const w = t.units * 0.085;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w - 0.02, 0.08, 0.42), mat(TILE_COLORS[t.category] ?? '#999', { transparent: !t.included, opacity: t.included ? 1 : 0.55 }));
      if (t.included) {
        m.position.set(x + w / 2, 0.07, 0);
        x += w;
      } else {
        m.position.set(ex + w / 2, 0.0, 0.05);
        m.rotation.y = 0.25;
        ex += w + 0.05;
      }
      m.castShadow = true;
      m.userData.target = { kind: 'context', idx: this.idx };
      this.trayTiles.add(m);
    }
  }

  /** Project one worker's current step onto the bench. */
  project(opts: {
    active: ActiveStep | null;
    time: number;
    pulse: number;
    accent: THREE.Color;
    detail: boolean;
    reduceMotion: boolean;
    now: number;
    taskTitle: string | null;
    name: string;
    idleText: string;
    ram: { used: number; total: number };
  }) {
    const { active, detail } = opts;
    const lamp = this.lamp.material as THREE.MeshStandardMaterial;
    if (active?.remote) {
      lamp.emissive.set('#a78bfa').multiplyScalar(0.5 + 0.8 * opts.pulse);
      this.modelLabel.element.textContent = detail ? `Model: ${MODELS[active.step.model ?? 'swift'].name} · thinking (remote)` : 'AI thinking…';
    } else {
      lamp.emissive.set('#000');
      this.modelLabel.element.textContent = 'AI model';
    }
    const cpu = active?.cpu ? 1 : 0;
    this.cpuFill.scale.y = Math.max(0.001, cpu);
    this.cpuFill.position.y = 1.02 + 0.68 * cpu;
    const ram = active ? Math.min(1, active.ramGB / opts.ram.total) : 0;
    this.ramFill.scale.y = Math.max(0.001, ram);
    this.ramFill.position.y = 1.02 + 0.68 * ram;
    this.meterLabel.element.textContent = `${cpu ? 'CPU busy' : 'CPU idle'} · RAM ${opts.ram.used}/${opts.ram.total} GB`;

    if (active) {
      this.card.visible = true;
      const u = (opts.time - active.start) / Math.max(1, active.end - active.start);
      this.progress.scale.x = Math.max(0.01, Math.min(1, u));
      this.progress.position.x = -0.5 + 0.5 * this.progress.scale.x;
      const left = Math.max(0, active.end - opts.time) / 1000;
      const step =
        active.step.kind === 'op'
          ? active.step.op!.label + (active.cpu && active.rate != null && active.rate < 1 ? ` (${Math.round(active.rate * 100)}% CPU)` : '')
          : active.step.kind === 'decide' && active.step.purpose && active.step.purpose !== 'logo'
            ? PURPOSE_LABEL[active.step.purpose]
            : STEP_INFO[active.step.kind].label;
      const job = opts.taskTitle ? `${opts.taskTitle}: ` : '';
      this.taskLabel.element.textContent = detail
        ? `${active.taskId} · ${step} · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} left`
        : `${job}${step}`;
      (this.cardMesh.material as THREE.MeshStandardMaterial).color.copy(opts.accent);
      this.nameLabel.element.textContent = `${opts.name} · working`;
      if (!opts.reduceMotion) this.card.position.y = 1.6 + Math.sin(opts.now / 400 + this.idx) * 0.04;
    } else {
      this.card.visible = false;
      this.nameLabel.element.textContent = opts.idleText;
    }
  }
}
