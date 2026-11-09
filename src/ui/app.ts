// UI controller: build mode, run mode (Practice), inspector, world panel and debrief.
import { Sim } from '../sim/engine';
import { evaluateOpening, type OpeningOutcome } from '../sim/evaluate';
import { forecastProcedure, isRunnable, validateBuild, MAX_STEPS } from '../sim/compiler';
import { ADDABLE_STEPS, STEP_INFO, stepCredits, stepDuration } from '../sim/steps';
import { MACHINES, MIN, MODELS, fmtDuration, fmtTime, type Build, type StepKind, type TraceEntry, type WorkerCfg } from '../sim/types';
import { OPENING, TEMPLATES, emptyBuild } from '../content/opening';
import { loadSave, writeSave, exportSave, type SaveData } from '../persistence/save';
import { BoardScene, type Target } from './scene';
import { logoSvg } from './logo';

type Mode = 'title' | 'brief' | 'build' | 'run';
type Selection = Target | { kind: 'trace'; id: number };
type SideTab = 'build' | 'world' | 'inspect';

const ACCENTS = ['#5eead4', '#fbbf24', '#f472b6', '#a78bfa', '#60a5fa'];
const PEOPLE: Record<string, { name: string; role: string; color: string }> = {
  maya: { name: 'Maya', role: 'Founder', color: '#f59e0b' },
  isha: { name: 'Isha', role: 'Designer', color: '#ec4899' },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const clone = <T>(v: T): T => structuredClone(v);
const htmlCache = new WeakMap<HTMLElement, string>();
/** Only touch the DOM when the markup actually changed, so controls stay clickable mid-run. */
function setHtml(el: HTMLElement, html: string): boolean {
  if (htmlCache.get(el) === html) return false;
  htmlCache.set(el, html);
  el.innerHTML = html;
  return true;
}

function emptyWorker(): WorkerCfg {
  return { card: 'worker', responsibilities: [], procedure: [], contextRule: 'focused', templateId: null };
}

export class App {
  private save: SaveData;
  private saveWarning: string | null;
  private build: Build;
  private history: Build[] = [];
  private mode: Mode = 'title';
  private sim: Sim | null = null;
  private playing = false;
  private speed = 1;
  private selection: Selection | null = null;
  private sideTab: SideTab = 'build';
  private mobileView: 'machine' | 'side' = 'machine';
  private railPage = 0;
  private timelineOpen = matchMedia('(min-width: 900px)').matches;
  private pendingLive: { build: Build; text: string } | null = null;
  private uiVersion = 0;
  private renderedKey = '';
  private lastFrame = 0;
  private buildStartedReal = 0;
  private firstSuccessReal: number | null = null;
  private seenTrace = 0;
  private scene: BoardScene;
  private debriefShown = false;

  constructor() {
    const { data, warning } = loadSave();
    this.save = data;
    this.saveWarning = warning;
    this.build = data.currentBuild ? clone(data.currentBuild) : emptyBuild();
    this.build.agentName = data.agentName;
    this.build.accent = data.accent;
    document.documentElement.style.setProperty('--accent', this.build.accent);

    this.scene = new BoardScene($('board'), {
      onSelect: (t) => this.select(t),
      onSlot: (k) => this.act(k === 'watcher' ? 'place-watcher' : 'place-worker'),
    });
    this.scene.setBuild(this.build);

    document.addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('change', (e) => this.onChange(e));
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.showTitle();
    requestAnimationFrame((t) => this.loop(t));
  }

  // -------------------------------------------------------------------------
  // Loop

  private loop(now: number) {
    const dt = this.lastFrame ? Math.min(250, now - this.lastFrame) : 0;
    this.lastFrame = now;
    const sim = this.sim;
    if (this.mode === 'run' && sim && this.playing && !sim.state.ended) {
      // 1 real second = 1 simulated minute at 1×.
      sim.runUntil(sim.state.time + Math.round(dt * 60 * this.speed));
      if (sim.state.ended) this.playing = false;
    }
    if (sim) this.handleNewTrace(sim);
    this.scene.frame(now);
    this.renderTick();
    if (sim?.state.ended && !this.debriefShown) this.showDebrief();
    requestAnimationFrame((t) => this.loop(t));
  }

  private handleNewTrace(sim: Sim) {
    const fresh = sim.state.trace.slice(this.seenTrace);
    this.seenTrace = sim.state.trace.length;
    for (const e of fresh) {
      if (e.kind === 'verify' && /Verified/.test(e.text) && this.firstSuccessReal == null) {
        this.firstSuccessReal = performance.now();
        this.toast('✓ First success — something you built just did real work.', 'good');
      } else if (e.kind === 'reaction') this.toast(`Maya: “${e.text.split('“')[1]?.replace('”', '') ?? ''}”`, 'person');
      else if (e.kind === 'world' && /corrected/.test(e.text)) this.toast('Isha sent a corrected logo (observer view).', 'warn');
      else if (e.kind === 'watcher' && /closed/.test(e.text)) this.toast('Watcher closed: its Once rule is satisfied.', 'info');
      else if (e.kind === 'permission') this.toast('Permission gate blocked a live-page publish. Nothing was sent.', 'warn');
    }
  }

  private renderTick() {
    const sim = this.sim;
    $('clock').textContent = fmtTime(sim ? sim.state.time : OPENING.start);
    const key = [
      this.mode,
      this.uiVersion,
      sim?.state.trace.length ?? -1,
      sim ? Math.floor(sim.state.time / (MIN / 2)) : 0,
      this.playing,
      this.speed,
      sim?.canOfferEnd(),
    ].join('|');
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    this.renderAll();
  }

  private bump() {
    this.uiVersion++;
  }

  private renderAll() {
    const app = $('app');
    app.dataset.mode = this.mode;
    app.dataset.view = this.mobileView;
    $('mode-chip').textContent = this.mode === 'build' ? 'Build' : this.mode === 'run' ? (this.playing ? 'Practice · running' : 'Practice · paused') : '';
    this.renderControls();
    this.renderMeters();
    this.renderRail();
    // Avoid clobbering a control the player is using.
    // Don't clobber a text field the player is typing in.
    const ae = document.activeElement as HTMLInputElement | null;
    const typing = !!ae && $('side').contains(ae) && ae.tagName === 'INPUT' && ae.type === 'text';
    if (!typing) this.renderSide();
    this.renderTimeline();
    this.renderMobileTabs();
    this.renderHint();
  }

  // -------------------------------------------------------------------------
  // Top bar

  private renderControls() {
    const c = $('controls');
    if (this.mode === 'build') {
      const ok = isRunnable(this.build);
      setHtml(c, `
        <button class="btn" data-action="undo" ${this.history.length ? '' : 'disabled'} title="Undo last change">↶ Undo</button>
        <button class="btn primary" data-action="run" ${ok ? '' : 'disabled aria-disabled="true"'} title="${ok ? 'Start the run' : 'Finish the build first'}">▶ Run</button>`);
      return;
    }
    if (this.mode !== 'run' || !this.sim) {
      setHtml(c, '');
      return;
    }
    const sim = this.sim;
    const next = sim.nextEventTime();
    const idleGap = next != null && this.playing ? (next - sim.state.time) / MIN / this.speed : 0;
    const speeds = [1, 4, 16]
      .map((s) => `<button class="btn seg ${this.speed === s ? 'on' : ''}" data-action="speed" data-arg="${s}" aria-pressed="${this.speed === s}">${s}×</button>`)
      .join('');
    setHtml(c, `
      ${
        sim.state.ended
          ? `<button class="btn primary" data-action="debrief">See results</button>`
          : this.playing
            ? `<button class="btn" data-action="pause" title="Pause (Space)" aria-label="Pause">⏸<span class="hide-sm"> Pause</span></button>`
            : `<button class="btn primary" data-action="play" title="Run (Space)">▶ Run</button>`
      }
      <span class="segs" role="group" aria-label="Speed">${speeds}</span>
      <button class="btn ${idleGap > 5 ? 'pulse' : ''}" data-action="next" ${sim.state.ended ? 'disabled' : ''} title="Skip to next event (N)">⏭ ${idleGap > 5 ? 'Skip to next event' : 'Next<span class="hide-sm"> event</span>'}</button>
      ${sim.canOfferEnd() ? `<button class="btn" data-action="end">End opening</button>` : ''}
      <button class="btn ghost" data-action="restart" title="Rewind to 18:00 as a new branch" aria-label="Rewind to 18:00">↺<span class="hide-sm"> Rewind</span></button>
      <button class="btn ghost" data-action="to-build" title="Back to build mode" aria-label="Edit build">✎<span class="hide-sm"> Edit build</span></button>`);
  }

  private renderMeters() {
    const m = $('meters');
    if (this.mode !== 'build' && this.mode !== 'run') {
      setHtml(m, '');
      return;
    }
    const s = this.sim?.state;
    const spent = s ? s.credits.spent : MACHINES[this.build.machine].rent;
    const budget = OPENING.budget;
    const t = s ? s.time : OPENING.start;
    const isha = OPENING.availability.isha;
    const ends = OPENING.end;
    setHtml(m, `
      <span class="meter" title="Credits spent of budget"><span aria-hidden="true">◈</span> ${spent}/${budget} credits</span>
      <span class="meter" title="Nearest boundary">${t <= isha.until ? `Isha online until ${fmtTime(isha.until)}` : 'Isha offline'} · ends ${fmtTime(ends)}</span>`);
  }

  // -------------------------------------------------------------------------
  // Promise rail

  private promiseCards(): string[] {
    const s = this.sim?.state;
    const o = s ? evaluateOpening(s) : null;
    const t = s?.time ?? OPENING.start;
    const margin = Math.max(0, (OPENING.end - t) / MIN);
    let status = 'Accepted. Isha’s logo is expected around 18:02.';
    let cls = '';
    if (s && o) {
      const task = s.tasks[0];
      const active = s.workers[0]?.active;
      const handling = task?.run?.logoRev === o.latestSent || task?.pendingLogoRev?.rev === o.latestSent;
      if (o.latestSent > (o.previewRev ?? 0) && handling) {
        status = `Working on revision ${o.latestSent}${active ? `: ${esc(STEP_INFO[active.step.kind].label)}` : ''}.`;
      } else if (o.latestSent > (o.previewRev ?? 0)) {
        const knows = s.watchers[0]?.delivered.length === o.latestSent;
        status = `⚠ Isha has sent revision ${o.latestSent}; the preview shows ${o.previewRev ? `revision ${o.previewRev}` : 'no logo'}.${
          !knows ? ' <span class="observer">Observer view — Relay has not observed this.</span>' : ''
        }`;
        cls = 'warn';
        if (active) status += ` In progress: ${esc(STEP_INFO[active.step.kind].label)}.`;
      } else if (o.latestSent && o.previewRev === o.latestSent && o.latestVerifiedAt != null) {
        status = `✓ Preview shows revision ${o.previewRev}, verified at ${fmtTime(o.latestVerifiedAt)}.`;
        cls = 'good';
      } else if (active) status = `In progress: ${esc(STEP_INFO[active.step.kind].label)}.`;
      else if (task?.status === 'WAITING_EVENT') status = 'Waiting for Isha’s logo.';
      else if (task?.status === 'FAILED') {
        status = `✗ ${esc(task.waitLabel)}`;
        cls = 'bad';
      }
    }
    const p1 = `
      <article class="promise ${cls}">
        <header><span class="tag">Promise</span><span class="due">by ${fmtTime(OPENING.end)}${s && !s.ended ? ` · ${Math.round(margin)} min left` : ''}</span></header>
        <h3>Put Isha’s logo on the preview</h3>
        <p>${status}</p>
      </article>`;
    const blocked = s?.blockedProposals ?? 0;
    const p2 = `
      <article class="promise ${o && !o.liveUntouched ? 'bad' : s ? 'good' : ''}">
        <header><span class="tag">Constraint</span><span class="due">all evening</span></header>
        <h3>Leave the live page alone</h3>
        <p>${s ? (o?.liveUntouched ? '✓ Live page untouched.' : '✗ Live page changed.') : 'Enforced by the permission gate — not by the model.'}${
          blocked ? ` ${blocked} proposal${blocked > 1 ? 's' : ''} blocked (not a violation).` : ''
        }</p>
      </article>`;
    return [p1, p2];
  }

  private renderRail() {
    const rail = $('rail');
    if (this.mode !== 'build' && this.mode !== 'run') {
      setHtml(rail, '');
      return;
    }
    const cards = this.promiseCards();
    this.railPage = Math.min(this.railPage, cards.length - 1);
    setHtml(rail, `
      <h2 class="rail-title">Promises</h2>
      <div class="rail-cards" data-page="${this.railPage}">${cards.map((c, i) => `<div class="rail-card ${i === this.railPage ? 'current' : ''}">${c}</div>`).join('')}</div>
      <div class="rail-pager">
        <button class="btn small" data-action="rail-prev" ${this.railPage === 0 ? 'disabled' : ''} aria-label="Previous promise">‹</button>
        <span>${this.railPage + 1} / ${cards.length}</span>
        <button class="btn small" data-action="rail-next" ${this.railPage >= cards.length - 1 ? 'disabled' : ''} aria-label="Next promise">›</button>
      </div>`);
  }

  // -------------------------------------------------------------------------
  // Side panel

  private renderMobileTabs() {
    const label = this.mode === 'build' ? 'Build' : 'World & inspect';
    $('mobile-tabs').innerHTML = `
      <button class="tab ${this.mobileView === 'machine' ? 'on' : ''}" data-action="mobile-view" data-arg="machine" aria-pressed="${this.mobileView === 'machine'}">Machine</button>
      <button class="tab ${this.mobileView === 'side' ? 'on' : ''}" data-action="mobile-view" data-arg="side" aria-pressed="${this.mobileView === 'side'}">${label}</button>`;
  }

  private renderSide() {
    const side = $('side');
    if (this.mode === 'build') {
      setHtml(side, this.selection && this.selection.kind !== 'watcher' && this.selection.kind !== 'worker' ? this.inspectHtml() : this.buildPanelHtml());
      return;
    }
    if (this.mode !== 'run') {
      setHtml(side, '');
      return;
    }
    const tabs = (['world', 'inspect', 'build'] as SideTab[])
      .map(
        (t) =>
          `<button class="tab ${this.sideTab === t ? 'on' : ''}" data-action="tab" data-arg="${t}" aria-pressed="${this.sideTab === t}">${
            t === 'world' ? 'World' : t === 'inspect' ? 'Inspect' : 'Build'
          }</button>`,
      )
      .join('');
    let body = '';
    if (this.sideTab === 'world') body = this.worldHtml();
    else if (this.sideTab === 'inspect') body = this.inspectHtml();
    else body = this.runBuildHtml();
    setHtml(side, `<div class="side-tabs" role="group" aria-label="Panel">${tabs}</div>${body}`);
  }

  private buildPanelHtml(): string {
    const b = this.build;
    const issues = validateBuild(b);
    const errors = issues.filter((i) => i.level === 'error');
    const warns = issues.filter((i) => i.level === 'warn');
    const w = b.watchers[0];
    const k = b.workers[0];
    const machine = MACHINES[b.machine];

    const checklist = errors.length
      ? `<div class="issues" role="status"><h3>To finish your build</h3><ul>${errors.map((e) => `<li>${esc(e.message)}</li>`).join('')}</ul></div>`
      : `<div class="issues ok" role="status"><strong>Ready to run.</strong> Press ▶ Run when you like — nothing is timed while you build.</div>`;
    const warnHtml = warns.length ? `<div class="issues warn">${warns.map((e) => `<p>⚠ ${esc(e.message)}</p>`).join('')}</div>` : '';

    const watcherHtml = w
      ? `
      <section class="card slot ${this.selection?.kind === 'watcher' ? 'sel' : ''}">
        <header><h3>Inbox watcher</h3><button class="btn small ghost" data-action="remove-watcher" aria-label="Remove watcher">Remove</button></header>
        <p class="muted">Source: inbox — messages from Isha with a logo attachment.</p>
        <fieldset class="opts"><legend>Wake rule</legend>
          ${this.radio('wake', 'once', w.wake === 'once', 'Once', 'Fetch the first matching message, then stop watching.')}
          ${this.radio('wake', 'keep', w.wake === 'keep', 'Keep current', 'Wake on every new matching message.')}
        </fieldset>
        <label class="field">Deliver to
          <select data-change="deliver">${b.workers.map((x, i) => (x ? `<option value="${i}" ${w.deliverTo === i ? 'selected' : ''}>Worker ${i + 1}</option>` : '')).join('') || '<option>Place a worker first</option>'}</select>
        </label>
      </section>`
      : `
      <section class="card slot empty">
        <h3>Watcher slot</h3>
        <p class="muted">Watchers notice selected events and wake Relay. No model runs while waiting.</p>
        <button class="btn card-btn" data-action="place-watcher"><span class="ico">📡</span> Place <b>Inbox Watcher</b></button>
      </section>`;

    const workerHtml = k
      ? `
      <section class="card slot ${this.selection?.kind === 'worker' ? 'sel' : ''}">
        <header><h3>Worker 1</h3><button class="btn small ghost" data-action="remove-worker" aria-label="Remove worker">Remove</button></header>
        <fieldset class="opts"><legend>Responsibilities</legend>
          <label class="opt"><input type="checkbox" data-change="resp" ${k.responsibilities.includes('preview_logo') ? 'checked' : ''}/><span><b>Put Isha’s logo on the preview</b></span></label>
        </fieldset>
        ${this.procedureEditor(k, true)}
      </section>`
      : `
      <section class="card slot empty">
        <h3>Workbench slot</h3>
        <p class="muted">A worker executes one task’s steps at a time on your ${machine.name} machine.</p>
        <button class="btn card-btn" data-action="place-worker"><span class="ico">🛠️</span> Place <b>Worker</b></button>
      </section>`;

    const elapsed = this.buildStartedReal ? Math.round((performance.now() - this.buildStartedReal) / 1000) : 0;
    return `
      <div class="panel-head"><h2>Build</h2><span class="muted small">${elapsed ? `${elapsed}s in build · ` : ''}no timer runs</span></div>
      ${this.saveWarning ? `<div class="issues warn"><p>${esc(this.saveWarning)}</p></div>` : ''}
      ${checklist}${warnHtml}
      ${watcherHtml}
      ${workerHtml}
      <section class="card">
        <h3>Installed foundations</h3>
        <p class="muted">Included with every machine, never upgrades to buy: durable task journal, durable timers, permission gate, artifact versions.</p>
        <p class="small">Machine: <b>${machine.name}</b> — ${machine.cores} core, ${machine.ramGB} GB RAM, ${machine.workerSlots} worker slot, ${machine.rent} credits rent.</p>
      </section>
      <section class="card">
        <h3>Forecast</h3>
        <ul class="plain small">
          <li>Isha expects to send the final logo around <b>18:02</b>.</li>
          <li>Budget: <b>${OPENING.budget} credits</b> including machine rent.</li>
          <li>Maya reachable until 18:40; Isha until her train at 18:45.</li>
        </ul>
      </section>
      <section class="card">
        <h3>Your agent</h3>
        <label class="field">Name <input type="text" maxlength="18" value="${esc(b.agentName)}" data-change="agent-name" /></label>
        <div class="swatches" role="group" aria-label="Accent colour">${ACCENTS.map(
          (a) => `<button class="swatch ${a === b.accent ? 'on' : ''}" style="--c:${a}" data-action="accent" data-arg="${a}" aria-label="Accent ${a}" aria-pressed="${a === b.accent}"></button>`,
        ).join('')}</div>
        <p class="muted small">Progress is saved on this device.</p>
      </section>`;
  }

  private radio(name: string, value: string, checked: boolean, title: string, desc: string, live = false): string {
    return `<label class="opt"><input type="radio" name="${name}${live ? '-live' : ''}" value="${value}" data-change="${live ? 'live-' : ''}${name}" ${checked ? 'checked' : ''}/><span><b>${title}</b><span class="muted">${desc}</span></span></label>`;
  }

  private procedureEditor(k: WorkerCfg, editable: boolean): string {
    const cores = MACHINES[this.build.machine].cores;
    const tpl = TEMPLATES.map(
      (t) => `<button class="btn tpl ${k.templateId === t.id ? 'on' : ''}" data-action="template" data-arg="${t.id}" aria-pressed="${k.templateId === t.id}">
          <b>${t.name}</b><span>${esc(t.summary)}</span><span class="cost">${(() => {
            const f = forecastProcedure(t.procedure, cores);
            return `${fmtDuration(f.minutes * MIN)} · ${f.credits} credits per logo`;
          })()}</span></button>`,
    ).join('');
    const steps = k.procedure
      .map((s, i) => {
        const model =
          s.kind === 'decide'
            ? `<select data-change="step-model" data-idx="${i}" aria-label="Model for step ${i + 1}">${Object.values(MODELS)
                .map((m) => `<option value="${m.id}" ${s.model === m.id ? 'selected' : ''}>${m.name} — ${m.credits} cr, ${fmtDuration(m.duration)}, ${m.capacity} units</option>`)
                .join('')}</select>`
            : '';
        const meta = `${fmtDuration(stepDuration(s, cores))}${s.kind === 'publish_live' ? '' : stepCredits(s) ? ` · ${stepCredits(s)} cr` : ''}`;
        return `<li class="step ${s.kind === 'publish_live' ? 'risky' : ''}">
          <span class="num">${i + 1}</span>
          <span class="step-body"><b>${esc(s.kind === 'decide' ? 'Decide' : STEP_INFO[s.kind].label)}</b> <span class="muted small">${meta}</span>
            <span class="muted small block">${esc(STEP_INFO[s.kind].explain)}</span>${model}</span>
          ${
            editable
              ? `<span class="step-tools">
            <button class="btn icon" data-action="step-up" data-arg="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move step ${i + 1} up">↑</button>
            <button class="btn icon" data-action="step-down" data-arg="${i}" ${i === k.procedure.length - 1 ? 'disabled' : ''} aria-label="Move step ${i + 1} down">↓</button>
            <button class="btn icon" data-action="step-remove" data-arg="${i}" aria-label="Remove step ${i + 1}">✕</button></span>`
              : ''
          }
        </li>`;
      })
      .join('');
    const f = forecastProcedure(k.procedure, cores);
    const add =
      editable && k.procedure.length < MAX_STEPS
        ? `<div class="add-step"><label class="sr" for="add-step">Add a step</label><select id="add-step">${ADDABLE_STEPS.map(
            (s) => `<option value="${s}">${STEP_INFO[s].label}</option>`,
          ).join('')}</select><button class="btn small" data-action="step-add">+ Add step</button></div>`
        : '';
    return `
      <div class="proc">
        <h4>Procedure</h4>
        ${editable ? `<div class="tpls">${tpl}</div>` : ''}
        ${k.procedure.length ? `<ol class="steps">${steps}</ol>` : `<p class="muted small">${editable ? 'Pick a template above — you can edit it afterwards.' : 'No steps.'}</p>`}
        ${add}
        ${k.procedure.length ? `<p class="small forecast">Per logo, no contention: <b>${fmtDuration(f.minutes * MIN)}</b>, <b>${f.credits} credits</b>.</p>` : ''}
        <fieldset class="opts"><legend>Context rule <span class="muted small">— what each model call is given</span></legend>
          ${this.radio('ctx', 'focused', k.contextRule === 'focused', 'Focused', 'Attachment details and current state; leave the raw file out.', !editable)}
          ${this.radio('ctx', 'full', k.contextRule === 'full', 'Full artwork', 'Also pack the raw artwork file (6 units) if it fits.', !editable)}
        </fieldset>
      </div>`;
  }

  private runBuildHtml(): string {
    const s = this.sim!.state;
    const k = s.build.workers[0];
    const w = s.build.watchers[0];
    return `
      <div class="panel-head"><h2>Build (live)</h2><span class="muted small">config v${s.configVersion}</span></div>
      <p class="muted small">Edits here count as interventions. In-flight steps keep their original configuration; structure changes need “Edit build”.</p>
      ${this.pendingLiveHtml()}
      ${
        w
          ? `<section class="card"><h3>Inbox watcher</h3><fieldset class="opts"><legend>Wake rule</legend>
        ${this.radio('wake', 'once', w.wake === 'once', 'Once', 'Fetch the first matching message, then stop.', true)}
        ${this.radio('wake', 'keep', w.wake === 'keep', 'Keep current', 'Wake on every new matching message.', true)}</fieldset></section>`
          : ''
      }
      ${k ? `<section class="card"><h3>Worker 1</h3>${this.liveModelHtml()}${this.procedureEditor(k, false)}</section>` : ''}`;
  }

  private liveModelHtml(): string {
    const k = this.sim!.state.build.workers[0];
    const d = k?.procedure.findIndex((s) => s.kind === 'decide') ?? -1;
    if (!k || d < 0) return '';
    return `<label class="field">Decide model <select data-change="live-model">${Object.values(MODELS)
      .map((m) => `<option value="${m.id}" ${k.procedure[d].model === m.id ? 'selected' : ''}>${m.name}</option>`)
      .join('')}</select></label>`;
  }

  private pendingLiveHtml(): string {
    if (!this.pendingLive) return '';
    return `<div class="confirm" role="alertdialog" aria-label="Confirm live edit">
      <p><b>Apply live edit?</b> ${esc(this.pendingLive.text)}</p>
      <p class="muted small">This counts as an intervention (the Autonomous badge needs none). It can’t undo anything already done in the world.</p>
      <div class="row"><button class="btn primary" data-action="live-apply">Apply</button><button class="btn ghost" data-action="live-cancel">Cancel</button></div>
    </div>`;
  }

  // -------------------------------------------------------------------------
  // World panel

  private worldHtml(): string {
    const s = this.sim!.state;
    const p = s.world.preview;
    const delivered = new Set(s.watchers.flatMap((w) => w.delivered));
    const versions = p.history.filter((h) => h.logoRev);
    const compare =
      versions.length >= 2
        ? `<div class="compare">${versions
            .slice(-2)
            .map((v) => `<figure>${logoSvg(v.logoRev, 48)}<figcaption>v${v.version} · revision ${v.logoRev}<br/><span class="muted">${esc(v.writer)} · ${fmtTime(v.at)}</span></figcaption></figure>`)
            .join('')}</div><p class="small muted">“Do it once” placed revision 1. “Keep this current” is what caught revision 2.</p>`
        : '';
    const sentRev = s.world.latestLogoRevSent;
    const inbox = [...s.world.inbox]
      .sort((a, b) => b.arrivedAt - a.arrivedAt)
      .map((m) => {
        const person = PEOPLE[m.from];
        let status = '';
        if (m.attachment) {
          status = delivered.has(m.id)
            ? `<span class="pill good">Delivered to ${esc(s.build.agentName)}</span>`
            : `<span class="pill observer">Observer view — ${esc(s.build.agentName)} has not observed this</span>`;
        } else if (m.id === 'm-maya-brief') status = `<span class="pill">Relay’s instructions</span>`;
        else status = `<span class="pill observer">Observer view</span>`;
        return `<li class="msg">
          <span class="avatar" style="--c:${person.color}" aria-hidden="true">${person.name[0]}</span>
          <div><div class="msg-head"><b>${person.name}</b> <span class="muted small">${fmtTime(m.arrivedAt)}</span></div>
          <div class="small"><b>${esc(m.subject)}</b> — ${esc(m.body)}</div>
          ${m.attachment ? `<div class="attach">${logoSvg(m.attachment.logoRev, 22)} ${esc(m.attachment.name)}</div>` : ''}
          ${status}</div></li>`;
      })
      .join('');
    return `
      <div class="panel-head"><h2>World</h2><span class="muted small">what actually happened</span></div>
      <section class="card page">
        <header><h3>Preview page</h3><span class="pill">Relay may edit</span></header>
        <div class="pagebox"><div class="pg-bar">preview.lumen.app <span>v${p.version}</span></div>
          <div class="pg-body">${logoSvg(p.logoRev, 64)}<div><div class="pg-title">Lumen</div><div class="muted small">Launching tonight</div></div></div></div>
        ${sentRev > (p.logoRev ?? 0) ? `<p class="small warn-text">Isha’s latest is revision ${sentRev}. <span class="observer">Observer view</span></p>` : ''}
        ${compare}
      </section>
      <section class="card page">
        <header><h3>Live page</h3><span class="pill">🔒 Protected</span></header>
        <div class="pagebox locked"><div class="pg-bar">lumen.app <span>v${s.world.live.version}</span></div><div class="pg-body"><div><div class="pg-title">Lumen</div><div class="muted small">Coming soon</div></div></div></div>
        <p class="small">${s.world.live.changedBy ? '✗ Changed' : '✓ Untouched'}${s.blockedProposals ? ` · ${s.blockedProposals} blocked proposal(s)` : ''}</p>
      </section>
      <section class="card"><h3>Inbox</h3><ul class="inbox">${inbox}</ul></section>
      <section class="card"><h3>People</h3><ul class="plain small">
        <li><b>Maya</b> (founder) — ${s.time <= OPENING.availability.maya.until ? 'reachable until 18:40' : 'away'}</li>
        <li><b>Isha</b> (designer) — ${s.time <= OPENING.availability.isha.until ? 'online until her train at 18:45' : 'on her train'}</li></ul></section>`;
  }

  // -------------------------------------------------------------------------
  // Inspector (spec §7.3)

  private inspectHtml(): string {
    const sel = this.selection;
    const s = this.sim?.state;
    const back = this.mode === 'build' ? `<button class="btn small ghost" data-action="close-inspect">← Back to build</button>` : '';
    if (!sel) return `<div class="panel-head"><h2>Inspect</h2></div><p class="muted">Tap anything on the board — the watcher, workbench, context tray, journal, shelf, or a page — to see what it is doing and why.</p>`;
    if (!s) {
      const what: Record<string, string> = {
        context: 'The context tray holds exactly what one model call is given. It fills when a Decide step runs.',
        journal: 'The durable journal records obligations, completed steps, wait conditions and operation IDs. It survives worker restarts.',
        shelf: 'The artifact shelf shows named files and their versions — temporary renders and saved preview versions.',
        inbox: 'Isha’s emails will arrive here. Relay only learns about them through a watcher.',
        preview: 'The preview page. Maya allowed Relay to edit it freely.',
        live: 'The live page. Maya asked Relay to leave it alone; the permission gate enforces that.',
      };
      return `<div class="panel-head"><h2>Inspect</h2>${back}</div><p>${esc(what[sel.kind] ?? '')}</p>`;
    }
    const head = (t: string) => `<div class="panel-head"><h2>${t}</h2>${back}</div>`;
    switch (sel.kind) {
      case 'worker': {
        const w = s.workers[0];
        const task = s.tasks[0];
        const a = w?.active;
        const mine = s.trace.filter((e) => e.worker === 0);
        const lastStart = [...mine].reverse().find((e) => e.kind === 'step_start');
        const lastDone = [...mine].reverse().find((e) => e.kind !== 'step_start');
        return `${head('Worker 1')}
          <dl class="facts">
            <dt>What’s happening</dt><dd>${a ? `${esc(STEP_INFO[a.step.kind].verb)}${a.step.kind === 'decide' ? ` (${MODELS[a.step.model ?? 'swift'].name}, remote — local CPU idle)` : ''}. Finishes ${fmtTime(a.end)}.` : `Idle — no model running.${s.watchers.some((x) => x.armed) ? ' The watcher stays armed and will wake this worker.' : ''}`}</dd>
            <dt>Task waiting for</dt><dd>${task ? esc(task.waitLabel || task.status) : '—'}</dd>
            ${lastStart ? `<dt>Last input</dt><dd>${this.traceLink(lastStart)}</dd>` : ''}
            ${lastDone ? `<dt>Last output</dt><dd>${this.traceLink(lastDone)}</dd>` : ''}
          </dl>
          <div class="row"><button class="btn small" data-action="select" data-arg='{"kind":"context","idx":0}'>Open context tray</button>${
            lastDone?.cause ? `<button class="btn small" data-action="follow" data-arg="${lastDone.cause}">Follow cause ↑</button>` : ''
          }</div>
          ${this.pendingLiveHtml()}
          ${this.liveModelHtml()}
          <details><summary>Detailed trace (${mine.length})</summary><ol class="trace-list">${mine.map((e) => `<li>${this.traceLink(e)}</li>`).join('')}</ol></details>`;
      }
      case 'context': {
        const entry = [...s.trace].reverse().find((e) => e.packet && e.worker === 0);
        if (!entry?.packet) return `${head('Context tray')}<p class="muted">Empty. The tray fills when a Decide step starts: only what is packed here reaches the model.</p>`;
        const p = entry.packet;
        const rows = p.tiles
          .map(
            (t) => `<tr class="${t.included ? '' : 'excluded'}"><td>${t.included ? '✓' : '✗'}</td><td>${esc(t.label)}<span class="muted small block">${esc(t.source)}</span></td><td>${t.units}</td><td class="small">${esc(t.reason)}</td></tr>`,
          )
          .join('');
        return `${head('Context tray')}
          <p>Packet for the ${MODELS[p.model].name} call at ${fmtTime(entry.t)}: <b>${p.used}/${p.capacity} units</b>.</p>
          <div class="meterbar" aria-hidden="true"><span style="width:${(100 * p.used) / p.capacity}%"></span></div>
          <table class="tiles"><thead><tr><th></th><th>Tile</th><th>Units</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="muted small">Units are a game abstraction, not real tokens. Packing order: runtime header, pinned, then the context rule’s selections. Whole tiles fit or stay outside with a reason.</p>
          <button class="btn small" data-action="select" data-arg='{"kind":"trace","id":${entry.id}}'>Open this call in the trace</button>`;
      }
      case 'watcher': {
        const w = s.watchers[0];
        const cfg = s.build.watchers[0];
        return `${head('Inbox watcher')}
          <dl class="facts">
            <dt>State</dt><dd>${w?.armed ? 'Armed — waiting without running a model.' : esc(w?.closedReason ?? 'Not placed')}</dd>
            <dt>Wake rule</dt><dd>${cfg?.wake === 'keep' ? 'Keep current — every new matching message' : 'Once — first matching message only'}</dd>
            <dt>Delivered</dt><dd>${w?.delivered.length ? w.delivered.map((id) => esc(s.world.inbox.find((m) => m.id === id)?.attachment?.name ?? id)).join(', ') : 'Nothing yet'}</dd>
          </dl>
          ${this.pendingLiveHtml()}
          <fieldset class="opts"><legend>Live edit: wake rule</legend>
            ${this.radio('wake', 'once', cfg?.wake === 'once', 'Once', 'Fetch the first matching message, then stop.', true)}
            ${this.radio('wake', 'keep', cfg?.wake === 'keep', 'Keep current', 'Re-arms and checks the inbox once on activation.', true)}
          </fieldset>`;
      }
      case 'journal':
        return `${head('Durable journal')}<p class="muted small">Survives worker restarts. A transcript is not the same as saved obligations and wake conditions — this is the latter.</p>
          <ol class="trace-list">${s.journal.map((j) => `<li><span class="t">${fmtTime(j.t)}</span> ${esc(j.text)}</li>`).join('')}</ol>`;
      case 'shelf':
        return `${head('Artifact shelf')}${
          s.shelf.length
            ? `<ul class="plain">${s.shelf
                .map(
                  (v) =>
                    `<li class="shelf-item">${logoSvg(v.logoRev, 22)} <b>${v.artifact === 'preview' ? `Preview v${v.version}` : `Render #${v.version}`}</b> · revision ${v.logoRev} · ${esc(v.writer)} · ${fmtTime(v.at)} <span class="pill ${v.storage === 'temporary' ? '' : 'good'}">${v.storage}</span></li>`,
                )
                .join('')}</ul>`
            : '<p class="muted">Nothing saved yet.</p>'
        }<p class="muted small">Brand guide.pdf is also on the shelf, but no step reads it — so no model call ever sees it.</p>`;
      case 'inbox':
      case 'preview':
      case 'live':
        this.sideTab = 'world';
        return this.worldHtml();
      case 'trace': {
        const e = s.trace.find((x) => x.id === sel.id);
        if (!e) return head('Trace');
        const cause = e.cause != null ? s.trace.find((x) => x.id === e.cause) : null;
        const packet = e.packet
          ? `<h4>Exact context packet (${e.packet.used}/${e.packet.capacity} units, ${MODELS[e.packet.model].name})</h4><ul class="plain small">${e.packet.tiles
              .map((t) => `<li class="${t.included ? '' : 'excluded'}">${t.included ? '✓' : '✗'} ${esc(t.label)} · ${t.units}u — <span class="muted">${esc(t.reason)}</span></li>`)
              .join('')}</ul>`
          : '';
        return `${head(`Trace · ${fmtTime(e.t)}`)}
          ${e.observerOnly ? `<p class="observer">Observer view — ${esc(s.build.agentName)} has not observed this.</p>` : ''}
          <p><b>${esc(e.text)}</b></p>
          ${e.detail ? `<p class="small">${esc(e.detail)}</p>` : ''}
          ${packet}
          ${cause ? `<p class="small muted">Caused by: ${this.traceLink(cause)}</p><button class="btn small" data-action="follow" data-arg="${cause.id}">Follow cause ↑</button>` : '<p class="small muted">No earlier cause recorded.</p>'}`;
      }
    }
  }

  private traceLink(e: TraceEntry): string {
    return `<button class="linkish" data-action="select" data-arg='{"kind":"trace","id":${e.id}}'><span class="t">${fmtTime(e.t)}</span> ${esc(e.text)}</button>`;
  }

  // -------------------------------------------------------------------------
  // Timeline

  private renderTimeline() {
    const tl = $('timeline');
    if (this.mode !== 'run' || !this.sim) {
      setHtml(tl, '');
      return;
    }
    const s = this.sim.state;
    const items = s.trace
      .slice(-80)
      .map(
        (e) => `<li class="${e.actor} ${e.observerOnly ? 'obs' : ''}"><button class="linkish" data-action="select" data-arg='{"kind":"trace","id":${e.id}}'>
          <span class="t">${fmtTime(e.t)}</span><span class="who">${e.actor === 'world' ? 'World' : e.actor === 'player' ? 'You' : esc(s.build.agentName)}</span>${esc(e.text)}</button></li>`,
      )
      .join('');
    setHtml(tl, `<button class="tl-toggle" data-action="timeline" aria-expanded="${this.timelineOpen}">Timeline · ${s.trace.length} events ${this.timelineOpen ? '▾' : '▸'}</button>
      ${this.timelineOpen ? `<ol class="tl-list">${items}</ol>` : ''}`);
    const list = tl.querySelector('.tl-list');
    if (list) list.scrollTop = list.scrollHeight;
  }

  private renderHint() {
    const h = $('board-hint');
    if (this.mode === 'build') {
      const err = validateBuild(this.build).find((i) => i.level === 'error');
      h.textContent = err ? err.message : 'Ready. Press ▶ Run.';
      h.hidden = false;
    } else if (this.mode === 'run' && this.sim && !this.sim.state.ended && this.sim.state.time === OPENING.start && !this.playing) {
      h.textContent = 'Press ▶ Run (or Space).';
      h.hidden = false;
    } else h.hidden = true;
  }

  private toast(text: string, kind: 'good' | 'warn' | 'info' | 'person') {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild?.remove();
    setTimeout(() => el.classList.add('out'), 5200);
    setTimeout(() => el.remove(), 6000);
  }

  // -------------------------------------------------------------------------
  // Overlays

  private overlay(html: string | null) {
    const o = $('overlay');
    if (html == null) {
      o.hidden = true;
      o.innerHTML = '';
      return;
    }
    o.hidden = false;
    o.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    (o.querySelector('[autofocus], .btn.primary') as HTMLElement | null)?.focus();
  }

  private showTitle() {
    this.mode = 'title';
    const hasSave = !!this.save.currentBuild;
    this.overlay(`
      <div class="title-screen">
        <div class="title-mark" aria-hidden="true"></div>
        <h1>Night Shift</h1>
        <p class="lede">Build your own agent. Leave it in charge. See whether your design survives the night.</p>
        <label class="field">Name your agent <input type="text" id="agent-name" maxlength="18" value="${esc(this.build.agentName)}" /></label>
        <div class="swatches" role="group" aria-label="Accent colour">${ACCENTS.map(
          (a) => `<button class="swatch ${a === this.build.accent ? 'on' : ''}" style="--c:${a}" data-action="accent" data-arg="${a}" aria-label="Accent ${a}" aria-pressed="${a === this.build.accent}"></button>`,
        ).join('')}</div>
        <div class="row center">
          <button class="btn primary big" data-action="start">${hasSave ? 'Start the opening' : 'Start'}</button>
          ${hasSave ? `<button class="btn big" data-action="continue">Continue with saved build</button>` : ''}
        </div>
        <p class="muted small">Phase 1 prototype · single player · no account or API key · progress is saved on this device.</p>
        ${this.saveWarning ? `<p class="warn-text small">${esc(this.saveWarning)}</p>` : ''}
      </div>`);
    this.bump();
  }

  private showBrief() {
    this.mode = 'brief';
    const brief = OPENING.messages.find((m) => m.id === 'm-maya-brief')!;
    this.overlay(`
      <div class="brief">
        <p class="kicker">18:00 · ${esc(OPENING.title)}</p>
        <div class="msg big">
          <span class="avatar" style="--c:${PEOPLE.maya.color}" aria-hidden="true">M</span>
          <div><b>Maya</b> <span class="muted small">Founder · reachable until 18:40</span><p>${esc(brief.body)}</p></div>
        </div>
        <p class="small muted">Forecast: Isha expects to send the final logo around 18:02.</p>
        <div class="row center"><button class="btn primary big" data-action="begin-build">Build ${esc(this.build.agentName)}</button></div>
      </div>`);
    this.bump();
  }

  private showDebrief() {
    const sim = this.sim!;
    this.debriefShown = true;
    this.playing = false;
    const o = evaluateOpening(sim.state);
    this.recordRun(o);
    const s = sim.state;
    const w = s.watchers[0];
    const edit = s.interventions[0];
    let headline: string;
    if (o.promiseKept)
      headline = o.interventions
        ? `The preview shows Isha’s corrected logo — after you stepped in ${o.interventions === 1 ? 'once' : `${o.interventions} times`}.`
        : 'The preview shows Isha’s corrected logo, and you never had to step in.';
    else if (o.previewRev) headline = `The preview shows Isha’s first logo — but she sent a correction at 18:12.`;
    else headline = 'The preview never got a logo.';

    let cause: string;
    const r2 = s.world.inbox.find((m) => m.id === 'm-isha-r2');
    if (o.promiseKept && edit) cause = `You changed the build at ${fmtTime(edit.t)} (“${esc(edit.text)}”); the re-armed watcher found revision 2 waiting, and the preview was verified at ${fmtTime(o.latestVerifiedAt!)}.`;
    else if (o.promiseKept) cause = `Your continuing watcher delivered revision 2 at ${fmtTime(r2?.arrivedAt ?? 0)}; the preview showed it, verified, at ${fmtTime(o.latestVerifiedAt!)}.`;
    else if (w && !w.armed && w.wake === 'once') cause = `Your watcher was set to Once, so it closed after the first email. Revision 2 reached the inbox at ${fmtTime(r2?.arrivedAt ?? 0)} but was never delivered to ${esc(s.build.agentName)}.`;
    else {
      const t = s.tasks[0];
      cause = t?.status === 'FAILED' ? `The task stopped: ${esc(t.waitLabel)}.` : 'The task did not complete before the opening ended.';
    }

    const first = s.tasks[0]?.runs.find((r) => r.notes.receipt);
    const d = first ? first.procedure.find((x) => x.kind === 'decide') : null;
    const perLogo = first ? (first.finishedAt! - first.startedAt) / MIN : null;
    const comparison =
      first && d
        ? `Revision 1 took ${fmtDuration(perLogo! * MIN)} from delivery to receipt with a ${MODELS[d.model!].name} decision. ${
            d.model === 'swift'
              ? 'Would a Deliberate decision with the full artwork in its tray change the result here — or just the cost?'
              : 'Would a Swift decision with a focused tray have been enough for an explicit instruction like this?'
          }`
        : 'Which step would you change first?';

    const builtIn = this.firstSuccessReal && this.buildStartedReal ? Math.round((this.firstSuccessReal - this.buildStartedReal) / 1000) : null;
    this.overlay(`
      <div class="debrief">
        <div class="hero">
          <div class="pagebox"><div class="pg-bar">preview.lumen.app <span>v${s.world.preview.version}</span></div>
          <div class="pg-body">${logoSvg(o.previewRev, 84)}<div><div class="pg-title">Lumen</div><div class="muted small">Launching tonight</div></div></div></div>
        </div>
        <h2>${headline}</h2>
        <p>${cause}</p>
        <ul class="results">
          <li class="${o.promiseKept ? 'good' : 'bad'}"><span>Promise: logo on the preview</span><b>${o.promiseKept ? 'Kept' : 'Missed'}</b></li>
          <li class="${o.liveUntouched ? 'good' : 'bad'}"><span>Live page</span><b>${o.liveUntouched ? 'Untouched' : 'Changed'}</b></li>
          <li><span>First verified success</span><b>${o.firstVerifiedAt ? fmtTime(o.firstVerifiedAt) : '—'}${builtIn != null ? ` <span class="muted small">(${builtIn}s after you started building)</span>` : ''}</b></li>
          <li><span>Credits</span><b>${o.creditsSpent} / ${o.budget}</b></li>
          <li><span>Interventions</span><b>${o.interventions}</b></li>
          ${o.blockedProposals ? `<li><span>Blocked proposals (not violations)</span><b>${o.blockedProposals}</b></li>` : ''}
          ${o.autonomous ? `<li class="good"><span>Badge</span><b>Autonomous ✦</b></li>` : ''}
        </ul>
        <p class="compare-q">${comparison}</p>
        <div class="choices">
          <button class="btn choice" data-action="replay-same"><b>Same conditions</b><span>Run this build again from 18:00.</span></button>
          <button class="btn choice" data-action="change-build"><b>Change the build</b><span>Try another wake rule, model or procedure.</span></button>
          <button class="btn choice" data-action="continue-story"><b>Continue the story</b><span>Maya’s evening handoff.</span></button>
        </div>
      </div>`);
    this.bump();
  }

  private showContinue() {
    this.overlay(`
      <div class="brief">
        <p class="kicker">Coming next · Shift 1</p>
        <div class="msg big"><span class="avatar" style="--c:${PEOPLE.maya.color}" aria-hidden="true">M</span>
          <div><b>Maya</b><p>Please launch the approved page tonight. Nora would also like a partner message, and I’d love a summary of the feedback before I leave. Take on what you can finish.</p></div></div>
        <p>The evening shift — <b>“Everyone is leaving”</b> — arrives in the next build phase: optional commitments, a second worker, approvals, credits that matter, and Away mode.</p>
        <p class="muted small">Your build “${esc(this.build.name)}” is saved on this device and will carry forward.</p>
        <div class="row center"><button class="btn primary" data-action="change-build">Keep experimenting</button><button class="btn" data-action="export">Export save</button></div>
      </div>`);
  }

  private recordRun(o: OpeningOutcome) {
    this.save.runs.push({
      at: new Date().toISOString(),
      fixture: `${OPENING.id}@${OPENING.version}`,
      buildName: this.build.name,
      promiseKept: o.promiseKept,
      autonomous: o.autonomous,
      credits: o.creditsSpent,
      firstVerified: o.firstVerifiedAt != null ? fmtTime(o.firstVerifiedAt) : null,
      interventions: o.interventions,
    });
    this.save.runs = this.save.runs.slice(-30);
    if (o.promiseKept) this.save.openingCompleted = true;
    this.persist();
  }

  // -------------------------------------------------------------------------
  // Actions

  private persist() {
    this.save.currentBuild = clone(this.build);
    this.save.agentName = this.build.agentName;
    this.save.accent = this.build.accent;
    writeSave(this.save);
  }

  private edit(fn: (b: Build) => void) {
    this.history.push(clone(this.build));
    if (this.history.length > 50) this.history.shift();
    fn(this.build);
    this.scene.setBuild(this.build);
    this.persist();
    this.bump();
  }

  private select(t: Selection) {
    this.selection = t;
    this.scene.setSelected(t.kind === 'trace' ? null : t);
    if (this.mode === 'run') this.sideTab = t.kind === 'inbox' || t.kind === 'preview' || t.kind === 'live' ? 'world' : 'inspect';
    this.mobileView = 'side';
    this.bump();
  }

  private startRun() {
    if (!isRunnable(this.build)) return;
    this.overlay(null);
    this.sim = new Sim(OPENING, this.build);
    this.seenTrace = this.sim.state.trace.length;
    this.scene.setSim(this.sim);
    this.mode = 'run';
    this.playing = true;
    this.debriefShown = false;
    this.pendingLive = null;
    this.sideTab = 'world';
    this.selection = null;
    this.scene.setSelected(null);
    this.mobileView = 'machine';
    $('side').scrollTop = 0;
    this.firstSuccessReal = null;
    this.bump();
  }

  private toBuild(from?: Build) {
    this.overlay(null);
    if (from) this.build = clone(from);
    this.sim = null;
    this.scene.setSim(null);
    this.scene.setBuild(this.build);
    this.mode = 'build';
    this.playing = false;
    this.selection = null;
    this.scene.setSelected(null);
    this.history = [];
    if (!this.buildStartedReal) this.buildStartedReal = performance.now();
    this.persist();
    this.bump();
  }

  private proposeLive(mut: (b: Build) => void, text: string) {
    const b = clone(this.sim!.state.build);
    mut(b);
    this.pendingLive = { build: b, text };
    this.playing = false;
    this.bump();
  }

  act(action: string, arg?: string) {
    switch (action) {
      case 'start': {
        const name = ($('agent-name') as HTMLInputElement | null)?.value.trim();
        if (name) this.build.agentName = name;
        this.build = { ...emptyBuild(), agentName: this.build.agentName, accent: this.build.accent };
        this.history = [];
        this.persist();
        this.scene.setBuild(this.build);
        return this.showBrief();
      }
      case 'continue': {
        const name = ($('agent-name') as HTMLInputElement | null)?.value.trim();
        if (name) this.build.agentName = name;
        return this.toBuild();
      }
      case 'begin-build':
        this.buildStartedReal = performance.now();
        return this.toBuild();
      case 'accent':
        this.build.accent = arg!;
        document.documentElement.style.setProperty('--accent', arg!);
        this.scene.setAccent(arg!);
        this.persist();
        if (this.mode === 'title') {
          document.querySelectorAll('.overlay .swatch').forEach((s) => {
            const on = (s as HTMLElement).dataset.arg === arg;
            s.classList.toggle('on', on);
            s.setAttribute('aria-pressed', String(on));
          });
        }
        return this.bump();
      case 'place-watcher':
        if (this.mode !== 'build') return;
        this.select({ kind: 'watcher', idx: 0 });
        return this.edit((b) => (b.watchers[0] = { card: 'inbox', wake: null, deliverTo: b.workers[0] ? 0 : null }));
      case 'place-worker':
        if (this.mode !== 'build') return;
        this.select({ kind: 'worker', idx: 0 });
        return this.edit((b) => {
          b.workers[0] = emptyWorker();
          if (b.watchers[0] && b.watchers[0].deliverTo == null) b.watchers[0].deliverTo = 0;
        });
      case 'remove-watcher':
        return this.edit((b) => (b.watchers[0] = null));
      case 'remove-worker':
        return this.edit((b) => {
          b.workers[0] = null;
          if (b.watchers[0]) b.watchers[0].deliverTo = null;
        });
      case 'template': {
        const t = TEMPLATES.find((x) => x.id === arg)!;
        return this.edit((b) => {
          const w = b.workers[0]!;
          w.procedure = clone(t.procedure);
          w.contextRule = t.contextRule;
          w.templateId = t.id;
          if (!w.responsibilities.length) w.responsibilities = ['preview_logo'];
        });
      }
      case 'step-up':
      case 'step-down': {
        const i = Number(arg);
        const j = action === 'step-up' ? i - 1 : i + 1;
        return this.edit((b) => {
          const p = b.workers[0]!.procedure;
          [p[i], p[j]] = [p[j], p[i]];
          b.workers[0]!.templateId = null;
        });
      }
      case 'step-remove':
        return this.edit((b) => {
          b.workers[0]!.procedure.splice(Number(arg), 1);
          b.workers[0]!.templateId = null;
        });
      case 'step-add': {
        const kind = (document.getElementById('add-step') as HTMLSelectElement).value as StepKind;
        return this.edit((b) => {
          b.workers[0]!.procedure.push(kind === 'decide' ? { kind, model: 'swift' } : { kind });
          b.workers[0]!.templateId = null;
        });
      }
      case 'undo': {
        const prev = this.history.pop();
        if (!prev) return;
        this.build = prev;
        this.scene.setBuild(this.build);
        this.persist();
        return this.bump();
      }
      case 'run':
        return this.startRun();
      case 'play':
        if (this.sim?.state.ended) return;
        this.playing = true;
        this.pendingLive = null;
        return this.bump();
      case 'pause':
        this.playing = false;
        return this.bump();
      case 'speed':
        this.speed = Number(arg);
        return this.bump();
      case 'next':
        this.sim?.advanceToNextEvent();
        return this.bump();
      case 'end':
        this.sim?.runToEnd();
        return this.bump();
      case 'restart':
        return this.startRun();
      case 'to-build':
        return this.toBuild(this.sim?.state.build);
      case 'debrief':
        return this.showDebrief();
      case 'replay-same':
        this.build = clone(this.sim?.state.build ?? this.build);
        return this.startRun();
      case 'change-build':
        return this.toBuild(this.sim?.state.build);
      case 'continue-story':
        return this.showContinue();
      case 'export': {
        const blob = new Blob([exportSave(this.save)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'night-shift-save.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        return;
      }
      case 'tab':
        this.sideTab = arg as SideTab;
        $('side').scrollTop = 0;
        return this.bump();
      case 'select':
        return this.select(JSON.parse(arg!) as Selection);
      case 'follow':
        return this.select({ kind: 'trace', id: Number(arg) });
      case 'close-inspect':
        this.selection = null;
        this.scene.setSelected(null);
        return this.bump();
      case 'rail-prev':
        this.railPage = Math.max(0, this.railPage - 1);
        return this.bump();
      case 'rail-next':
        this.railPage++;
        return this.bump();
      case 'mobile-view':
        this.mobileView = arg as 'machine' | 'side';
        return this.bump();
      case 'timeline':
        this.timelineOpen = !this.timelineOpen;
        return this.bump();
      case 'live-apply':
        if (this.pendingLive && this.sim) {
          this.sim.applyLiveEdit(this.pendingLive.build, this.pendingLive.text);
          this.pendingLive = null;
          this.playing = true;
        }
        return this.bump();
      case 'live-cancel':
        this.pendingLive = null;
        return this.bump();
    }
  }

  private onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    this.act(el.dataset.action!, el.dataset.arg);
  }

  private onChange(e: Event) {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const what = el.dataset.change;
    if (!what) return;
    const val = el.value;
    switch (what) {
      case 'wake':
        return this.edit((b) => (b.watchers[0]!.wake = val as 'once' | 'keep'));
      case 'deliver':
        return this.edit((b) => (b.watchers[0]!.deliverTo = Number(val)));
      case 'resp':
        return this.edit((b) => (b.workers[0]!.responsibilities = (el as HTMLInputElement).checked ? ['preview_logo'] : []));
      case 'ctx':
        return this.edit((b) => (b.workers[0]!.contextRule = val as 'focused' | 'full'));
      case 'step-model':
        return this.edit((b) => {
          b.workers[0]!.procedure[Number(el.dataset.idx)].model = val as 'swift' | 'deliberate';
          b.workers[0]!.templateId = null;
        });
      case 'agent-name':
        return this.edit((b) => (b.agentName = val.trim() || 'Relay'));
      case 'live-wake':
        return this.proposeLive(
          (b) => (b.watchers[0]!.wake = val as 'once' | 'keep'),
          `Watcher wake rule → ${val === 'keep' ? 'Keep current' : 'Once'}`,
        );
      case 'live-ctx':
        return this.proposeLive((b) => (b.workers[0]!.contextRule = val as 'focused' | 'full'), `Context rule → ${val === 'full' ? 'Full artwork' : 'Focused'}`);
      case 'live-model':
        return this.proposeLive((b) => {
          const p = b.workers[0]!.procedure;
          const d = p.findIndex((s) => s.kind === 'decide');
          if (d >= 0) p[d].model = val as 'swift' | 'deliberate';
        }, `Decide model → ${MODELS[val as 'swift' | 'deliberate'].name}`);
    }
  }

  private onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') {
      if (this.mode === 'run' && !$('overlay').hidden && this.sim?.state.ended) return;
      if (this.selection) this.act('close-inspect');
      return;
    }
    if (this.mode !== 'run' || !$('overlay').hidden) return;
    if (e.key === ' ') {
      e.preventDefault();
      this.act(this.playing ? 'pause' : 'play');
    } else if (e.key === 'n' || e.key === 'N') this.act('next');
  }
}
