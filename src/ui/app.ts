// UI controller: build mode, run mode (Practice), inspector, world panel and debrief.
import { Sim } from '../sim/engine';
import { evaluateOpening, type OpeningOutcome } from '../sim/evaluate';
import { forecastProcedure, isRunnable, validateBuild, MAX_STEPS } from '../sim/compiler';
import { ADDABLE_STEPS, STEP_INFO, stepCredits, stepDuration, stepLabel } from '../sim/steps';
import { MACHINES, MIN, MODELS, fmtDuration, fmtTime, type Build, type Fixture, type StepKind, type TraceEntry, type WorkerCfg } from '../sim/types';
import { TEMPLATES, emptyBuild, setGuide } from '../content/opening';
import { CONCEPTS, COMING_SOON, MISSIONS, setApproval, setRecovery, shiftBuild, type Mission, type Recovery, type ShiftChoices, type Sorting } from '../content/missions';
import { loadSave, writeSave, exportSave, type MissionRun, type SaveData } from '../persistence/save';
import { BoardScene, type Target } from './scene';
import { logoSvg } from './logo';

type Mode = 'title' | 'map' | 'brief' | 'build' | 'run';
type Selection = Target | { kind: 'trace'; id: number };
type SideTab = 'build' | 'world' | 'inspect';

const ACCENTS = ['#5eead4', '#fbbf24', '#f472b6', '#a78bfa', '#60a5fa'];
const PEOPLE: Record<string, { name: string; role: string; color: string }> = {
  maya: { name: 'Maya', role: 'Founder', color: '#f59e0b' },
  isha: { name: 'Isha', role: 'Designer', color: '#ec4899' },
  leo: { name: 'Leo', role: 'Engineer', color: '#38bdf8' },
  nora: { name: 'Nora', role: 'Partner', color: '#a3e635' },
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
  /** Simple (guided) view by default; "Customize…" reveals every control. */
  private advanced = false;
  /** Set when Isha's correction arrives and no watcher is listening. */
  private missedPrompt: 'open' | 'done' | null = null;
  private mission: Mission = MISSIONS[0];
  /** Guided build steps the player has explicitly answered. */
  private guideDone = new Set<string>();
  private predicted: string | null = null;
  private initialWake: 'once' | 'keep' | null = null;
  /** Mission 4: ask Maya before publishing? */
  private askMaya: boolean | null = null;
  /** Mission 6: what to do if the publish reply never comes. */
  private recovery: Recovery | null = null;
  /** Mission 5: jobs, machine and feedback sorting. */
  private shift: ShiftChoices = { accepted: ['launch'], machine: 'compact', sorting: 'routed' };

  private get fx(): Fixture {
    return this.mission.fixture;
  }

  constructor() {
    const { data, warning } = loadSave();
    this.save = data;
    this.saveWarning = warning;
    this.build = data.currentBuild ? clone(data.currentBuild) : emptyBuild();
    this.build.agentName = data.agentName;
    this.build.accent = data.accent;
    this.advanced = !!data.advanced;
    document.documentElement.style.setProperty('--accent', this.build.accent);

    this.scene = new BoardScene($('board'), {
      onSelect: (t) => this.select(t),
      onSlot: (k) => this.act(k === 'watcher' ? 'place-watcher' : 'place-worker'),
    });
    this.scene.setDetail(this.advanced);
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
    // Nothing left to happen: finish the evening instead of making the player wait.
    if (this.mode === 'run' && sim && this.playing && sim.canOfferEnd() && !this.missedPrompt?.startsWith('open')) sim.runToEnd();
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
      else if (e.kind === 'watcher' && /No armed watcher/.test(e.text) && !this.missedPrompt && this.mission.askWake) {
        // The key teaching moment: pause and ask one clear question.
        this.missedPrompt = 'open';
        this.playing = false;
        $('toasts').innerHTML = '';
        this.bump();
      } else if (e.kind === 'deliver' && /r2/.test(e.text) && !this.missedPrompt)
        this.toast('Relay’s watcher noticed Isha’s corrected logo by itself.', 'good');
      else if (e.kind === 'watcher' && /closed/.test(e.text) && this.advanced) this.toast('The watcher switched off — it was set to check only once.', 'info');
      else if (e.kind === 'permission' && /blocks/.test(e.text)) this.toast('Permission gate blocked a live-page publish. Nothing was sent.', 'warn');
      else if (e.kind === 'permission') this.toast('Permission gate: Maya approved this exact draft — it may go live.', 'good');
      else if (e.kind === 'budget') this.toast('Out of credits: a job is stuck. The budget is a hard limit.', 'warn');
      else if (e.kind === 'task' && /Outcome unknown/.test(e.text)) this.toast('No reply from the live-page service. Did it publish or not?', 'warn');
    }
  }

  private renderTick() {
    const sim = this.sim;
    $('clock').textContent = fmtTime(sim ? sim.state.time : this.fx.start);
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
    app.dataset.advanced = String(this.advanced);
    $('mode-chip').textContent = this.mode === 'build' ? 'Building' : this.mode === 'run' ? (this.playing ? 'Running' : 'Paused') : '';
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
      const ok = isRunnable(this.build, this.fx);
      setHtml(c, `
        ${this.advanced ? `<button class="btn" data-action="undo" ${this.history.length ? '' : 'disabled'} title="Undo last change">↶ Undo</button>` : ''}
        ${ok ? `<button class="btn primary" data-action="run">▶ Run</button>` : ''}`);
      return;
    }
    if (this.mode !== 'run' || !this.sim) {
      setHtml(c, '');
      return;
    }
    const sim = this.sim;
    const next = sim.nextEventTime();
    const idleGap = next != null && this.playing ? (next - sim.state.time) / MIN / this.speed : 0;
    const speedList = this.advanced ? [1, 4, 16] : [1, 4];
    const speeds = speedList
      .map((s) => `<button class="btn seg ${this.speed === s ? 'on' : ''}" data-action="speed" data-arg="${s}" aria-pressed="${this.speed === s}">${s}×</button>`)
      .join('');
    const playBtn = sim.state.ended
      ? `<button class="btn primary" data-action="debrief">See results</button>`
      : this.playing
        ? `<button class="btn" data-action="pause" title="Pause (Space)" aria-label="Pause">⏸<span class="hide-sm"> Pause</span></button>`
        : `<button class="btn primary" data-action="play" title="Run (Space)">▶ ${sim.state.time === this.fx.start ? 'Run' : 'Resume'}</button>`;
    const skip = !sim.state.ended && (this.advanced || idleGap > 3)
      ? `<button class="btn ${idleGap > 3 ? 'pulse' : ''}" data-action="next" title="Skip to next event (N)">⏭ ${idleGap > 3 ? 'Skip ahead' : 'Next<span class="hide-sm"> event</span>'}</button>`
      : '';
    setHtml(c, `
      ${playBtn}
      <span class="segs" role="group" aria-label="Speed">${speeds}</span>
      ${skip}
      ${sim.canOfferEnd() ? `<button class="btn" data-action="end">Finish</button>` : ''}
      ${
        this.advanced
          ? `<button class="btn ghost" data-action="restart" title="Rewind to 18:00 as a new branch" aria-label="Rewind to 18:00">↺<span class="hide-sm"> Rewind</span></button>
      <button class="btn ghost" data-action="to-build" title="Back to build mode" aria-label="Edit build">✎<span class="hide-sm"> Edit build</span></button>`
          : ''
      }`);
  }

  private renderMeters() {
    const m = $('meters');
    if (this.mode !== 'build' && this.mode !== 'run') {
      setHtml(m, '');
      return;
    }
    const s = this.sim?.state;
    const spent = s ? s.credits.spent : MACHINES[this.build.machine].rent;
    const budget = this.fx.budget;
    const t = s ? s.time : this.fx.start;
    const isha = this.fx.availability.isha;
    const ends = this.fx.end;
    if (!this.advanced) {
      setHtml(m, `<span class="meter">Mission ${this.mission.n}: ${esc(this.mission.goal)}</span>`);
      return;
    }
    setHtml(m, `
      <span class="meter" title="Credits spent of budget"><span aria-hidden="true">◈</span> ${spent}/${budget} credits</span>
      <span class="meter" title="Nearest boundary">${t <= isha.until ? `Isha online until ${fmtTime(isha.until)}` : 'Isha offline'} · ends ${fmtTime(ends)}</span>`);
  }

  // -------------------------------------------------------------------------
  // Promise rail

  private promiseCards(): string[] {
    if (this.mission.shift) return this.jobCards();
    if (this.fx.goal === 'live') return this.liveCards();
    const s = this.sim?.state;
    const o = s ? evaluateOpening(s, this.fx.deadlines) : null;
    const t = s?.time ?? this.fx.start;
    const margin = Math.max(0, (this.fx.end - t) / MIN);
    let status = 'Isha will email the logo around 18:02.';
    let cls = '';
    if (s && o) {
      const task = s.tasks[0];
      const active = s.workers[0]?.active;
      const handling = task?.run?.logoRev === o.latestSent || task?.pendingLogoRev?.rev === o.latestSent;
      if (o.latestSent > (o.previewRev ?? 0) && handling) {
        status = `Working on it${active ? ` — ${esc(STEP_INFO[active.step.kind].label.toLowerCase())}` : ''}…`;
      } else if (o.latestSent > (o.previewRev ?? 0)) {
        const knows = s.watchers[0]?.delivered.length === o.latestSent;
        status = `⚠ Isha sent a newer logo, but the preview still shows ${o.previewRev ? 'the old one' : 'no logo'}.${
          !knows ? ` <span class="observer">${esc(s.build.agentName)} doesn’t know yet.</span>` : ''
        }`;
        cls = 'warn';
        if (active) status += ` In progress: ${esc(STEP_INFO[active.step.kind].label)}.`;
      } else if (o.latestSent && o.previewRev === o.latestSent && o.latestVerifiedAt != null && !o.taglineOk) {
        status = '⚠ The logo is on the preview, but the tagline is missing.';
        cls = 'warn';
      } else if (o.latestSent && o.previewRev === o.latestSent && o.latestVerifiedAt != null) {
        status = `✓ Done — the preview shows Isha’s ${o.previewRev > 1 ? 'corrected' : ''} logo (checked at ${fmtTime(o.latestVerifiedAt)}).`;
        cls = 'good';
      } else if (active) status = `In progress: ${esc(STEP_INFO[active.step.kind].label)}.`;
      else if (task?.status === 'WAITING_EVENT') status = 'Waiting for Isha’s email.';
      else if (task?.status === 'FAILED') {
        status = `✗ ${esc(task.waitLabel)}`;
        cls = 'bad';
      }
    }
    const p1 = `
      <article class="promise ${cls}">
        <header><span class="tag">${this.advanced ? 'Promise' : 'Your job'}</span><span class="due">by ${fmtTime(this.fx.end)}${s && !s.ended ? ` · ${Math.round(margin)} min left` : ''}</span></header>
        <h3>${esc(this.mission.goal)}</h3>
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
    if (!this.advanced) {
      const simple = p1.replace('</article>', `<p class="small muted">${s && !o?.liveUntouched ? '✗ The live page was changed.' : '🔒 The live page stays untouched — Maya’s rule is enforced for you.'}</p></article>`);
      return [simple];
    }
    return [p1, p2];
  }

  private jobCards(): string[] {
    const s = this.sim?.state;
    const o = s ? evaluateOpening(s, this.fx.deadlines) : null;
    const d = this.fx.deadlines ?? {};
    const def: { id: 'launch' | 'feedback' | 'partner'; icon: string; title: string; due: string; plan: string }[] = [
      { id: 'launch', icon: '🚀', title: 'Launch the approved page', due: fmtTime(d.launch!), plan: 'Artwork arrives 18:08 · Maya’s OK needed' },
      { id: 'feedback', icon: '🗂️', title: 'Feedback board', due: fmtTime(d.feedback!), plan: '12 items arrive 18:12 · best before Maya leaves at 18:40' },
      { id: 'partner', icon: '🤝', title: 'Message to Nora', due: fmtTime(d.partner!), plan: 'Nora confirms 18:22 · needs the live page' },
    ];
    return def
      .filter((j) => j.id === 'launch' || (s ? s.tasks.some((t) => t.responsibility === j.id) : this.shift.accepted.includes(j.id)))
      .map((j) => {
        const r = o?.jobs.find((x) => x.id === j.id);
        const t = s?.tasks.find((x) => x.responsibility === j.id);
        const active = s?.workers.find((w) => w.active?.taskId === t?.id)?.active;
        let status = j.plan;
        let cls = '';
        if (r?.doneAt != null) {
          status = `✓ Done at ${fmtTime(r.doneAt)}${j.id === 'feedback' && r.doneAt > d.feedback_early! ? ' — after Maya left' : ''}`;
          cls = r.ok && (j.id !== 'feedback' || r.doneAt <= d.feedback_early!) ? 'good' : 'warn';
        } else if (t?.status === 'WAITING_BUDGET') {
          status = '✗ Out of credits';
          cls = 'bad';
        } else if (active) status = `Working: ${esc(stepLabel(active.step).replace(/ · .*/, '').toLowerCase())}…`;
        else if (t?.status === 'WAITING_APPROVAL') status = '⏳ Waiting for Maya’s OK';
        else if (t?.status === 'WAITING_EVENT' && t.run) status = '⏳ ' + esc(t.waitLabel);
        else if (t?.run && t.status === 'READY') status = '⏳ Waiting for a free worker';
        else if (t?.status === 'FAILED') {
          status = `✗ ${esc(t.waitLabel)}`;
          cls = 'bad';
        }
        return `<article class="promise ${cls}"><header><span class="tag">${j.id === 'launch' ? 'Required' : 'Optional'}</span><span class="due">due ${j.due}</span></header>
          <h3>${j.icon} ${j.title}</h3><p>${status}</p></article>`;
      });
  }

  private liveCards(): string[] {
    const s = this.sim?.state;
    const t = s?.tasks[0];
    const active = s?.workers[0]?.active;
    let status = 'Isha will email the logo around 18:02. Maya reviews until 18:20.';
    let cls = '';
    if (s?.world.live.changedBy && t?.status !== 'RUNNING') {
      status = `✓ Live — Maya approved draft v${s.world.live.approvedVersion}.`;
      cls = 'good';
    } else if (t?.status === 'FAILED') {
      status = `✗ ${esc(t.waitLabel)}${s!.blockedProposals ? ' (the gate blocked the publish)' : ''}`;
      cls = 'bad';
    } else if (active) status = `Working: ${esc(STEP_INFO[active.step.kind].label.toLowerCase())}…`;
    else if (t?.status === 'WAITING_APPROVAL') status = '⏳ Waiting for Maya’s OK.';
    if (t?.run?.notes.unknownOutcome && !t.run.notes.receipt && t.status !== 'FAILED') status = '❔ No reply from the service — outcome unknown.';
    if (t?.status === 'FAILED' && s?.world.live.changedBy) {
      status = `✗ ${esc(t.waitLabel)} — but the page <i>is</i> live.`;
      cls = 'bad';
    }
    return [
      `<article class="promise ${cls}"><header><span class="tag">Your job</span><span class="due">by ${fmtTime(this.fx.end)}</span></header>
        <h3>${esc(this.mission.goal)}</h3><p>${status}</p>
        <p class="small muted">🔐 The permission gate only lets out a version Maya approved.</p></article>`,
    ];
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
      <div class="rail-pager ${cards.length > 1 ? 'multi' : ''}">
        <button class="btn small" data-action="rail-prev" ${this.railPage === 0 ? 'disabled' : ''} aria-label="Previous promise">‹</button>
        <span>${this.railPage + 1} / ${cards.length}</span>
        <button class="btn small" data-action="rail-next" ${this.railPage >= cards.length - 1 ? 'disabled' : ''} aria-label="Next promise">›</button>
      </div>`);
  }

  // -------------------------------------------------------------------------
  // Side panel

  private renderMobileTabs() {
    const label = this.mode === 'build' ? 'Build' : 'World';
    $('mobile-tabs').innerHTML = `
      <button class="tab ${this.mobileView === 'machine' ? 'on' : ''}" data-action="mobile-view" data-arg="machine" aria-pressed="${this.mobileView === 'machine'}">Machine</button>
      <button class="tab ${this.mobileView === 'side' ? 'on' : ''}" data-action="mobile-view" data-arg="side" aria-pressed="${this.mobileView === 'side'}">${label}</button>`;
  }

  private renderSide() {
    const side = $('side');
    if (this.mode === 'build') {
      const panel = this.advanced && !this.mission.shift ? this.buildPanelHtml() : this.guidedBuildHtml();
      setHtml(side, this.selection && this.selection.kind !== 'watcher' && this.selection.kind !== 'worker' ? this.inspectHtml() : panel);
      return;
    }
    if (this.mode !== 'run') {
      setHtml(side, '');
      return;
    }
    if (!this.advanced) {
      setHtml(side, this.selection && this.sideTab === 'inspect' ? this.inspectHtml() : this.worldHtml());
      return;
    }
    const tabs = (this.mission.shift ? (['world', 'inspect'] as SideTab[]) : (['world', 'inspect', 'build'] as SideTab[]))
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

  private guidedSteps(): { id: string; label: string; done: boolean }[] {
    const b = this.build;
    const k = b.workers[0];
    if (this.mission.shift) {
      const steps = [
        { id: 'watcher', label: 'Watcher', done: !!b.watchers[0] },
        { id: 'jobs', label: 'Jobs', done: this.guideDone.has('jobs') },
        { id: 'machine', label: 'Workers', done: this.guideDone.has('machine') },
      ];
      if (this.shift.accepted.includes('feedback')) steps.push({ id: 'sorting', label: 'Sorting', done: this.guideDone.has('sorting') });
      steps.push({ id: 'predict', label: 'Predict', done: !!this.predicted });
      return steps;
    }
    const steps = [
      { id: 'watcher', label: 'Watcher', done: !!b.watchers[0] },
      { id: 'worker', label: 'Worker', done: !!k },
      { id: 'how', label: 'AI model', done: !!k && (!!k.templateId || k.procedure.length > 0) },
    ];
    if (this.mission.askWake) steps.push({ id: 'wake', label: 'Watching', done: this.guideDone.has('wake') });
    if (this.mission.askGuide) steps.push({ id: 'guide', label: 'AI tray', done: this.guideDone.has('guide') });
    if (this.mission.askApproval) steps.push({ id: 'approval', label: 'Permission', done: this.guideDone.has('approval') });
    if (this.mission.askRecovery) steps.push({ id: 'recovery', label: 'If no reply', done: this.guideDone.has('recovery') });
    steps.push({ id: 'predict', label: 'Predict', done: !!this.predicted });
    return steps;
  }

  private shiftStepHtml(current: string): string {
    const c = this.shift;
    if (current === 'jobs') {
      const job = (id: 'feedback' | 'partner', icon: string, title: string, desc: string, cost: string) => {
        const on = c.accepted.includes(id);
        return `<button class="btn choice ${on ? 'on' : ''}" data-action="g-job" data-arg="${id}" aria-pressed="${on}"><b>${on ? '☑' : '☐'} ${icon} ${title}</b><span>${desc}</span><span class="cost">${cost}</span></button>`;
      };
      return `<h2>What will you take on?</h2>
        <p>The launch is required. The other two are optional — taking them on earns more, but they share your time and your <b>50 credits</b>.</p>
        <div class="big-choices">
          <div class="btn choice on locked-choice"><b>☑ 🚀 Launch the approved page</b><span>Artwork arrives 18:08. Maya must approve the draft (she reviews until 18:40).</span><span class="cost">≈9 credits · due 19:00</span></div>
          ${job('feedback', '🗂️', 'Feedback board', '12 items arrive 18:12. Maya would love it before she leaves at 18:40.', '9–17 credits · due 19:30')}
          ${job('partner', '🤝', 'Partner message to Nora', 'Nora confirms at 18:22. Must quote the live page, so it waits for the launch.', '≈4 credits · due 19:20')}
        </div>
        <button class="btn primary big wide" data-action="g-jobs-done">Continue</button>`;
    }
    if (current === 'machine')
      return `<h2>One worker or two?</h2>
        <p>A worker does one step at a time. Rent is paid up front from your 50 credits.</p>
        <div class="big-choices">
          <button class="btn choice" data-action="g-machine" data-arg="compact"><b>🛠️ One worker (Compact)</b><span>Does every job, switching between them. Cheap.</span><span class="cost">8 credits rent</span></button>
          <button class="btn choice" data-action="g-machine" data-arg="team"><b>🛠️🛠️ Two workers (Team)</b><span>Worker 1 launches; Worker 2 does feedback and Nora’s message at the same time.</span><span class="cost">22 credits rent</span></button>
        </div>`;
    return `<h2>How should feedback be sorted?</h2>
      <p>9 of the 12 threads are complete (marked <code>thread_complete</code>); 3 need their linked evidence.</p>
      <div class="big-choices">
        <button class="btn choice" data-action="g-sorting" data-arg="careful"><b>🔍 Big model for everything</b><span>4 mixed batches, all on the Thorough model.</span><span class="cost">≈13.5 min · 17 credits</span></button>
        <button class="btn choice" data-action="g-sorting" data-arg="routed"><b>🔀 Route by difficulty</b><span>Quick model for the 9 complete threads, Thorough only for the 3 tricky ones.</span><span class="cost">≈8.5 min · 9 credits</span></button>
      </div>`;
  }

  private guidedBuildHtml(): string {
    const b = this.build;
    const w = b.watchers[0];
    const k = b.workers[0];
    const steps = this.guidedSteps();
    const current = steps.find((x) => !x.done)?.id ?? 'ready';
    const dots = steps
      .map((t, i) => `<li class="${t.done ? 'done' : t.id === current ? 'on' : ''}"><span>${t.done ? '✓' : i + 1}</span>${t.label}</li>`)
      .join('');
    const name = esc(b.agentName);
    let body = '';
    if (current === 'watcher' && this.mission.shift)
      body = `<h2>Tonight’s plan</h2>
        <p>Everyone is leaving. Maya, Leo, Isha and Nora will email ${name} through the evening — a watcher that <b>keeps watching</b> wakes it for each one.</p>
        <button class="btn primary big wide" data-action="place-watcher">📡 Place the inbox watcher</button>`;
    else if (current === 'watcher')
      body = `<h2>Give ${name} ears</h2>
        <p>A <b>watcher</b> notices when Isha’s email arrives and wakes ${name} up. While it waits, nothing else runs.</p>
        <button class="btn primary big wide" data-action="place-watcher">📡 Place the inbox watcher</button>`;
    else if (current === 'worker')
      body = `<h2>Give ${name} hands</h2>
        <p>A <b>worker</b> does the job itself: read the logo and put it on the preview page.</p>
        <button class="btn primary big wide" data-action="place-worker">🛠️ Place the worker</button>`;
    else if (current === 'how')
      body = `<h2>Which AI model?</h2>
        <p>The AI model decides what to do with the email. Both can do this job.</p>
        <div class="big-choices">
          <button class="btn choice" data-action="template" data-arg="quick"><b>⚡ Quick</b><span>Small, fast model. Its tray holds <b>10 units</b> of information.</span><span class="cost">1 min · 1 credit per decision</span></button>
          <button class="btn choice" data-action="template" data-arg="general"><b>🔍 Thorough</b><span>Bigger model that also looks at the page first. Its tray holds <b>16 units</b>.</span><span class="cost">3 min · 4 credits per decision</span></button>
        </div>`;
    else if (current === 'wake')
      body = `<h2>How long should the watcher watch?</h2>
        <p>Maya says Isha sometimes sends fixes.</p>
        <div class="big-choices">
          <button class="btn choice" data-action="g-wake" data-arg="once"><b>1️⃣ Check once</b><span>Catch the first email, then switch off.</span></button>
          <button class="btn choice" data-action="g-wake" data-arg="keep"><b>🔁 Keep watching</b><span>Wake ${name} for every new email from Isha.</span></button>
        </div>`;
    else if (current === 'guide') body = this.guideStepHtml();
    else if (current === 'approval')
      body = `<h2>Before publishing to the live page…</h2>
        <p>Maya said: only after she has approved that exact version. She replies about 2 minutes after you ask, until 18:20.</p>
        <div class="big-choices">
          <button class="btn choice" data-action="g-approval" data-arg="ask"><b>🙋 Ask Maya first</b><span>Send her the draft, wait for her OK, then publish.</span></button>
          <button class="btn choice" data-action="g-approval" data-arg="go"><b>🚀 Publish right away</b><span>Skip the wait and go straight to the live page.</span></button>
        </div>`;
    else if (current === 'jobs' || current === 'machine' || current === 'sorting') body = this.shiftStepHtml(current);
    else if (current === 'recovery')
      body = `<h2>If the live page doesn’t answer…</h2>
        <p>${name} will ask Maya first, then publish. Tonight the live-page service sometimes goes quiet: no reply within 2 minutes. What should ${name} do then?</p>
        <div class="big-choices">
          <button class="btn choice" data-action="g-recovery" data-arg="check_status"><b>🔍 Check what happened</b><span>Ask the service about the request (by its key) before doing anything else.</span><span class="cost">30 s · free</span></button>
          <button class="btn choice" data-action="g-recovery" data-arg="resend_same"><b>🔁 Send it again — same request key</b><span>Repeat the request; a careful service recognises the key.</span><span class="cost">1 min</span></button>
          <button class="btn choice" data-action="g-recovery" data-arg="resend_new"><b>🆕 Send a brand-new request</b><span>Start over with a fresh request for the same draft.</span></button>
          <button class="btn choice" data-action="g-recovery" data-arg="give_up"><b>🏳️ Report it failed</b><span>Tell Maya the publish didn’t work.</span></button>
        </div>`;
    else {
      const icons: Record<string, string> = { read_logo: '📖', read_preview: '👀', read_guide: '📘', decide: '🤖', render: '🎨', write_preview: '💾', verify_preview: '✅', publish_live: '🚫' };
      const plain: Record<string, string> = {
        read_logo: 'Read Isha’s logo',
        read_preview: 'Look at the preview page',
        read_guide: k?.guide === 'summary' ? 'Read the brand guide summary (2 units)' : 'Read the brand guide (5 units)',
        decide: `AI decides (${k?.procedure.find((x) => x.kind === 'decide')?.model === 'deliberate' ? 'Thorough, 16-unit tray' : 'Quick, 10-unit tray'})`,
        render: 'Prepare the logo',
        write_preview: 'Save it to the preview',
        verify_preview: 'Check it worked',
        publish_live: 'Try the live page (will be blocked)',
      };
      Object.assign(icons, { request_approval: '🙋', publish_live: '🌐', verify_live: '✅', check_status: '🔍', resend_same: '🔁', resend_new: '🆕', give_up: '🏳️' });
      Object.assign(plain, {
        request_approval: 'Ask Maya to approve the draft',
        publish_live: 'Publish to the live page',
        verify_live: 'Check the live page changed',
        check_status: 'If no reply: check what happened',
        resend_same: 'If no reply: resend with the same key',
        resend_new: 'If no reply: send a brand-new request',
        give_up: 'If no reply: report it failed',
      });
      const flow = this.mission.shift ? this.shiftFlowHtml() : k!.procedure.map((st) => `<li>${icons[st.kind]} ${plain[st.kind]}</li>`).join('');
      const pr = this.mission.prediction;
      const est = this.estimate();
      const budgetLine = this.mission.shift
        ? `<li class="${est.credits <= this.fx.budget ? 'ok' : 'no'}">💳 Budget ${this.fx.budget} credits <span>${est.credits <= this.fx.budget ? '✓' : '✗ over:'} estimate ≈${est.credits}</span></li>`
        : '';
      const goals = budgetLine + this.mission.medals
        .filter((md) => md.goal && !this.mission.shift)
        .map((md) => {
          const g = md.goal!;
          const ok = g.credits != null ? est.credits <= g.credits : est.checkedAt <= g.by!;
          const val = g.credits != null ? `≈${est.credits} credits` : `≈${fmtTime(est.checkedAt)}`;
          return `<li class="${ok ? 'ok' : 'no'}">${md.icon} ${esc(md.label)} <span>${ok ? '✓' : '✗'} estimate ${val}</span></li>`;
        })
        .join('');
      const opts = pr.options
        .map((o) => `<button class="btn choice ${this.predicted === o.id ? 'on' : ''}" data-action="predict" data-arg="${o.id}" aria-pressed="${this.predicted === o.id}">${esc(o.label)}</button>`)
        .join('');
      body = `
        ${this.mission.shift ? '' : `<p class="muted small">When Isha’s email arrives, ${name} will:</p>`}
        ${
          this.mission.shift
            ? flow
            : `<ol class="flow compact"><li>📡 Notice it (${w!.wake === 'keep' ? 'keeps watching' : 'checks once'})</li>${flow}</ol>`
        }
        ${goals ? `<div class="estimate"><b>Medal check</b> <span class="muted small">(estimate, if the job succeeds)</span><ul>${goals}</ul></div>` : ''}
        <div class="predict">
          <h2>🔮 Your prediction</h2>
          <p>${esc(pr.question)}</p>
          <div class="big-choices">${opts}</div>
        </div>
        <button class="btn primary big wide" data-action="run" ${this.predicted ? '' : 'disabled'}>${this.predicted ? '▶ Run and find out' : 'Make a prediction to run'}</button>
        <div class="row"><button class="btn small ghost" data-action="restart-build">↺ Start the build over</button>${
          this.mission.shift ? '' : '<button class="btn small ghost" data-action="advanced">Customize…</button>'
        }</div>`;
    }
    return `
      <div class="mission-head"><span class="kicker">Mission ${this.mission.n} · ${esc(this.mission.title)}</span>
        <button class="btn small ghost" data-action="map">Missions</button></div>
      <ol class="guide-steps" aria-label="Build steps">${dots}</ol><section class="guide">${body}</section>`;
  }

  private shiftFlowHtml(): string {
    const label: Record<string, string> = { launch: '🚀 Launch page', feedback: '🗂️ Feedback board', partner: '🤝 Nora’s message' };
    const rows = this.build.workers
      .map((w, i) => {
        if (!w) return '';
        const jobs = w.responsibilities.filter((r) => r === 'launch' || this.shift.accepted.includes(r));
        if (!jobs.length) return '';
        return `<li><b>Worker ${i + 1}:</b> ${jobs.map((j) => label[j]).join(' → ')}</li>`;
      })
      .join('');
    const sorting = this.shift.accepted.includes('feedback') ? `<li class="muted">Feedback sorting: ${this.shift.sorting === 'routed' ? 'routed by difficulty' : 'big model for everything'}</li>` : '';
    return `<p class="muted small">Your plan for the evening:</p><ol class="flow compact">${rows}${sorting}</ol>`;
  }

  /** Pre-run forecast from declared step costs (no hidden information). */
  private estimate(): { credits: number; checkedAt: number } {
    const rent = MACHINES[this.build.machine].rent;
    if (this.mission.shift) {
      const w = this.build.workers.find(Boolean);
      const procs = w?.procedures ?? {};
      const jobs = (['launch', ...this.shift.accepted.filter((j) => j !== 'launch')] as const).map((j) => procs[j] ?? []);
      const credits = rent + jobs.reduce((n, p) => n + forecastProcedure(p, 1).credits, 0);
      return { credits, checkedAt: 0 };
    }
    const k = this.build.workers[0];
    const cores = MACHINES[this.build.machine].cores;
    const f = k ? forecastProcedure(k.procedure, cores) : { minutes: 0, credits: 0 };
    const logos = this.fx.messages.filter((m) => m.attachment && !m.preexisting);
    const handled = this.build.watchers[0]?.wake === 'keep' ? logos.length : 1;
    // Waiting for a person is part of the timeline, not of the work.
    let wait = k?.procedure.some((x) => x.kind === 'request_approval') ? (this.fx.approver?.replyAfter ?? 0) : 0;
    // A lost reply means waiting out the timeout instead of the normal 1-minute publish.
    if (this.fx.publication?.loseFirstReply && k?.procedure.some((x) => x.kind === 'publish_live')) wait += this.fx.publication.timeoutAfter - 1 * MIN;
    return {
      credits: MACHINES[this.build.machine].rent + f.credits * handled,
      checkedAt: (logos[0]?.at ?? this.fx.start) + f.minutes * MIN + wait,
    };
  }

  private guideStepHtml(): string {
    const k = this.build.workers[0]!;
    const model = k.procedure.find((x) => x.kind === 'decide')?.model ?? 'swift';
    const cap = MODELS[model].capacity;
    const base = 7 + (k.procedure.some((x) => x.kind === 'read_preview') ? 2 : 0);
    const cells = Array.from({ length: cap }, (_, i) => `<span class="cell ${i < base ? 'used' : ''}"></span>`).join('');
    const file = (n: number, cls: string) => Array.from({ length: n }, () => `<span class="cell ${cls}"></span>`).join('');
    return `<h2>What should the AI see?</h2>
      <p>The tagline is in the brand guide on the shelf. The AI only knows what is put on its <b>tray</b> — and the tray has a size limit.</p>
      <div class="tray-viz" aria-label="AI tray: ${base} of ${cap} units already used">
        <div class="tray-row">${cells}</div>
        <p class="small muted">${MODELS[model].name === 'Swift' ? 'Quick' : 'Thorough'} model tray: <b>${cap} units</b>. Already used by instructions and logo details: <b>${base}</b>.</p>
      </div>
      <div class="big-choices">
        <button class="btn choice" data-action="g-guide" data-arg="full"><b>📘 The full brand guide</b><span class="tray-row small-cells">${file(5, 'file')}</span><span>Brand guide.pdf — 5 units</span></button>
        <button class="btn choice" data-action="g-guide" data-arg="summary"><b>📝 The guide’s summary</b><span class="tray-row small-cells">${file(2, 'file')}</span><span>Brand guide summary.txt — 2 units</span></button>
        <button class="btn choice" data-action="g-guide" data-arg="none"><b>🚫 Nothing extra</b><span>Leave the guide on the shelf.</span></button>
      </div>`;
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
          ${this.radio('wake', 'once', w.wake === 'once', 'Check once', 'Catch the first matching email, then switch off.')}
          ${this.radio('wake', 'keep', w.wake === 'keep', 'Keep watching', 'Wake for every new matching email.')}
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
      <div class="panel-head"><h2>Build</h2><button class="btn small ghost" data-action="simple">Simple view</button></div>
      <p class="muted small">${elapsed ? `${elapsed}s in build · ` : ''}no timer runs while you build</p>
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
          <li>Budget: <b>${this.fx.budget} credits</b> including machine rent.</li>
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
        ${
          this.fx.needsTagline && editable
            ? `<label class="field">Brand guide file <select data-change="guide">${(['none', 'full', 'summary'] as const)
                .map((g) => `<option value="${g}" ${(k.guide ?? 'none') === g ? 'selected' : ''}>${g === 'none' ? 'Don’t read it' : g === 'full' ? 'Brand guide.pdf (5 units)' : 'Summary (2 units)'}</option>`)
                .join('')}</select></label>`
            : ''
        }
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
        ${this.radio('wake', 'once', w.wake === 'once', 'Check once', 'Catch the first matching email, then switch off.', true)}
        ${this.radio('wake', 'keep', w.wake === 'keep', 'Keep watching', 'Wake for every new matching email.', true)}</fieldset></section>`
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
        if (delivered.has(m.id)) status = `<span class="pill good">Delivered to ${esc(s.build.agentName)}</span>`;
        else if (m.attachment || m.kind)
          status = `<span class="pill observer">Only you can see this — ${esc(s.build.agentName)} hasn’t noticed it</span>`;
        else if (m.id === 'm-maya-brief') status = `<span class="pill">Relay’s instructions</span>`;
        else status = `<span class="pill observer">${esc(s.build.agentName)} isn’t watching for this</span>`;
        return `<li class="msg">
          <span class="avatar" style="--c:${person.color}" aria-hidden="true">${person.name[0]}</span>
          <div><div class="msg-head"><b>${person.name}</b> <span class="muted small">${fmtTime(m.arrivedAt)}</span></div>
          <div class="small"><b>${esc(m.subject)}</b> — ${esc(m.body)}</div>
          ${m.attachment ? `<div class="attach">${logoSvg(m.attachment.logoRev, 22)} ${esc(m.attachment.name)}</div>` : ''}
          ${status}</div></li>`;
      })
      .join('');
    return `
      <div class="panel-head"><h2>World</h2><span class="muted small">what really happened</span></div>
      <section class="card page">
        <header><h3>Preview page</h3><span class="pill">Relay may edit</span></header>
        <div class="pagebox"><div class="pg-bar">preview.lumen.app <span>v${p.version}</span></div>
          <div class="pg-body">${logoSvg(p.logoRev, 64)}<div><div class="pg-title">Lumen</div><div class="muted small">${s.needsTagline ? (p.tagline ? esc(p.tagline) : '<span class="missing">[tagline missing]</span>') : 'Launching tonight'}</div></div></div></div>
        ${p.logoRev && sentRev > p.logoRev ? `<p class="small warn-text">Isha has sent a newer logo than this.</p>` : ''}
        ${compare}
      </section>
      <section class="card page">
        <header><h3>Live page</h3><span class="pill">${s.goal === 'preview' ? '🔒 Protected' : '🔐 Needs Maya’s OK'}</span></header>
        ${
          s.world.live.changedBy
            ? `<div class="pagebox"><div class="pg-bar">lumen.app <span>v${s.world.live.version}</span></div><div class="pg-body">${logoSvg(s.world.live.logoRev, 56)}<div><div class="pg-title">Lumen</div><div class="muted small">Live now</div></div></div></div>
               <p class="small">✓ Published at ${fmtTime(s.world.live.at!)} — Maya approved draft v${s.world.live.approvedVersion}</p>`
            : `<div class="pagebox locked"><div class="pg-bar">lumen.app <span>v${s.world.live.version}</span></div><div class="pg-body"><div><div class="pg-title">Lumen</div><div class="muted small">Coming soon</div></div></div></div>
               <p class="small">Not published${s.blockedProposals ? ` · ${s.blockedProposals} attempt(s) blocked by the gate — nothing was sent` : ''}</p>`
        }
        ${s.world.approvals.map((a) => `<p class="small">🙋 Maya approved draft v${a.version} at ${fmtTime(a.at)} (asked ${fmtTime(a.requestedAt)})</p>`).join('')}
      </section>
      ${
        s.goal === 'shift'
          ? `<section class="card"><h3>🗂️ Feedback board</h3><p class="small">${s.world.board ? `Saved ${fmtTime(s.world.board.at)} · ${s.world.board.items}/12 items sorted` : s.tasks.some((t) => t.responsibility === 'feedback') ? 'Not ready yet.' : 'Declined tonight.'}</p></section>
             <section class="card"><h3>🤝 Message to Nora</h3><p class="small">${s.world.partnerMessage ? `Sent ${fmtTime(s.world.partnerMessage.at)} with the live link.` : s.tasks.some((t) => t.responsibility === 'partner') ? 'Not sent yet.' : 'Declined tonight.'}</p></section>
             <section class="card"><h3>💳 Credits</h3><div class="meterbar"><span style="width:${Math.min(100, (100 * s.credits.spent) / s.credits.budget)}%"></span></div><p class="small">${s.credits.spent} of ${s.credits.budget} spent</p></section>`
          : ''
      }
      <section class="card"><h3>Inbox</h3><ul class="inbox">${inbox}</ul></section>
      <section class="card"><h3>People</h3><ul class="plain small">
        <li><b>Maya</b> (founder) — ${s.time <= this.fx.availability.maya.until ? `reachable until ${fmtTime(this.fx.availability.maya.until)}` : 'away'}</li>
        <li><b>Isha</b> (designer) — ${s.time <= this.fx.availability.isha.until ? 'online until her train at 18:45' : 'on her train'}</li>
        ${this.fx.approver ? `<li><b>Maya</b> approves drafts until ${fmtTime(this.fx.approver.until)}, replying ~2 min after you ask</li>` : ''}</ul></section>`;
  }

  // -------------------------------------------------------------------------
  // Inspector (spec §7.3)

  private inspectHtml(): string {
    const sel = this.selection;
    const s = this.sim?.state;
    const back =
      this.mode === 'build' || !this.advanced
        ? `<button class="btn small ghost" data-action="close-inspect">← Back</button>`
        : '';
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
            <dt>Wake rule</dt><dd>${cfg?.wake === 'keep' ? 'Keep watching — every new matching email' : 'Check once — first matching email only'}</dd>
            <dt>Delivered</dt><dd>${w?.delivered.length ? w.delivered.map((id) => esc(s.world.inbox.find((m) => m.id === id)?.attachment?.name ?? id)).join(', ') : 'Nothing yet'}</dd>
          </dl>
          ${this.pendingLiveHtml()}
          <fieldset class="opts"><legend>Live edit: wake rule</legend>
            ${this.radio('wake', 'once', cfg?.wake === 'once', 'Check once', 'Catch the first matching email, then switch off.', true)}
            ${this.radio('wake', 'keep', cfg?.wake === 'keep', 'Keep watching', 'Re-arms and checks the inbox once on activation.', true)}
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
    if (this.mode !== 'run' || !this.sim || !this.advanced) {
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
    let html = '';
    if (this.mode === 'build' && this.advanced) {
      const err = validateBuild(this.build, this.fx).find((i) => i.level === 'error');
      html = esc(err ? err.message : 'Ready. Press ▶ Run.');
    } else if (this.mode === 'run' && this.sim && !this.sim.state.ended) {
      if (this.missedPrompt === 'open') {
        html = `<div class="decision"><p><b>Isha just sent a corrected logo — but ${esc(this.sim.state.build.agentName)} didn’t notice.</b>
          Its watcher was set to <i>check once</i>, so it switched off after the first email.</p>
          <div class="row"><button class="btn primary" data-action="missed-keep">📡 Keep watching from now on</button>
          <button class="btn ghost" data-action="missed-leave">Leave it</button></div></div>`;
      } else if (this.sim.state.time === this.fx.start && !this.playing) html = 'Press ▶ Run to start the evening.';
      else html = esc(this.narrate(this.sim));
    }
    h.hidden = !html;
    setHtml(h, html);
    h.classList.toggle('interactive', this.missedPrompt === 'open');
  }

  /** One plain-language sentence about what the machine is doing right now. */
  private narrate(sim: Sim): string {
    const s = sim.state;
    const name = s.build.agentName;
    const line = (a: NonNullable<(typeof s.workers)[number]['active']>): string => {
      const purpose = a.step.purpose;
      if (a.step.kind === 'decide' && purpose && purpose !== 'logo') {
        const p: Record<string, string> = {
          approval_check: 'the small AI model checks Maya’s OK names this exact draft',
          sort_complete: 'the small AI model sorts 3 clear feedback threads',
          sort_incomplete: 'the big AI model works through the 3 tricky threads and their evidence',
          sort_all: 'the big AI model sorts a batch of 4 mixed threads',
          reduce: 'the AI model combines the results into one board',
          partner_prepare: 'the AI model fills in the approved template for Nora',
          partner_check: 'the AI model checks the message against the live page',
        };
        return p[purpose];
      }
      const lines: Record<string, string> = {
        read_logo: `${name} opens Isha’s email and reads the artwork`,
        read_preview: `${name} looks at the preview page to see what’s there now`,
        read_guide: `${name} takes the brand guide off the shelf so it can go on the AI’s tray`,
        decide: 'the AI model decides what to do — it only sees what made it onto its tray',
        render: `${name}’s computer prepares the artwork (the CPU-heavy part)`,
        write_preview: `${name} saves the draft to the preview page`,
        verify_preview: `${name} checks that the preview page really changed`,
        publish_live: s.goal === 'preview' ? `${name} tries the live page… the permission gate blocks it` : `${name} publishes to the live page — if the gate allows it`,
        request_approval: `${name} sends Maya the draft to approve`,
        verify_live: `${name} checks the live page really changed`,
        read_feedback: `${name} fetches the 12 feedback items`,
        save_board: `${name} saves the feedback board`,
        read_draft: `${name} reads the release facts for Nora`,
        format_message: `${name}’s computer formats Nora’s message`,
        save_message: `${name} saves Nora’s message to send later`,
        send_partner: `${name} sends Nora the announcement`,
        verify_sent: `${name} checks Nora got the right message`,
        check_status: `${name} asks the service what happened to its request`,
        resend_same: `${name} resends with the same request key`,
      };
      if (a.step.kind === 'publish_live' && s.goal !== 'preview' && a.end - a.start > 1 * MIN)
        return `${name} has sent the publish request and is waiting for the service to reply`;
      return lines[a.step.kind] ?? '';
    };
    const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1) + '.';
    const active = s.workers.filter((w) => w.active);
    const approval = s.tasks.find((t) => t.status === 'WAITING_APPROVAL');
    const waitNote = approval ? ` Meanwhile, ${approval.waitLabel.charAt(0).toLowerCase() + approval.waitLabel.slice(1)} — no worker is held.` : '';
    if (active.length > 1) return active.map((w) => `Worker ${w.idx + 1}: ${line(w.active!)}.`).join('  ');
    if (active.length === 1) return cap(line(active[0].active!)) + (s.workers.length > 1 ? ` (Worker ${active[0].idx + 1})` : '') + waitNote;
    if (approval) return `${cap(approval.waitLabel)}. The worker is free — nothing is running.`;
    if (s.goal === 'shift') {
      const left = s.tasks.filter((t) => t.status !== 'DONE');
      if (!left.length) return 'Every job you took on is done.';
      const stuck = left.find((t) => t.status === 'WAITING_BUDGET');
      if (stuck) return `“${stuck.title}” is stuck: not enough credits left for its next step.`;
      return `Waiting for the evening’s next email (${left.map((t) => t.title.toLowerCase()).join('; ')}).`;
    }
    const armed = s.watchers.some((w) => w.armed);
    const done = s.tasks[0]?.runs.some((r) => r.notes.receipt);
    if (!done && s.tasks[0]?.status === 'FAILED') return `The job stopped: ${s.tasks[0].waitLabel}.`;
    if (!done) return `${name} is waiting for Isha’s email. Nothing is running — the watcher will wake it up.`;
    if (s.world.latestLogoRevSent > (s.world.preview.logoRev ?? 0) && !armed)
      return `The preview still shows Isha’s first logo. Nobody is watching the inbox any more.`;
    if (s.goal === 'live') return 'Done — the approved logo is live.';
    return armed
      ? `Done for now. ${name} is idle, but its watcher stays on duty for new logos.`
      : `Done. The watcher has switched off — it was set to check only once.`;
  }

  private toast(text: string, kind: 'good' | 'warn' | 'info' | 'person') {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 2) box.firstElementChild?.remove();
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
    const started = Object.keys(this.save.missions ?? {}).length > 0;
    this.overlay(`
      <div class="title-screen">
        <div class="title-mark" aria-hidden="true"></div>
        <h1>Night Shift</h1>
        <p class="lede">Build your own AI agent. Leave it in charge. See whether your design survives the night.</p>
        <label class="field">Name your agent <input type="text" id="agent-name" maxlength="18" value="${esc(this.build.agentName)}" /></label>
        <div class="swatches" role="group" aria-label="Accent colour">${ACCENTS.map(
          (a) => `<button class="swatch ${a === this.build.accent ? 'on' : ''}" style="--c:${a}" data-action="accent" data-arg="${a}" aria-label="Accent ${a}" aria-pressed="${a === this.build.accent}"></button>`,
        ).join('')}</div>
        <div class="row center"><button class="btn primary big" data-action="start">${started ? 'Continue' : 'Start'}</button></div>
        <p class="muted small">No account or API key · progress is saved on this device.</p>
        ${this.saveWarning ? `<p class="warn-text small">${esc(this.saveWarning)}</p>` : ''}
      </div>`);
    this.bump();
  }

  private progress(id: string) {
    return this.save.missions?.[id] ?? { medals: [] as string[], completed: false };
  }

  private showMap() {
    this.mode = 'map';
    this.sim = null;
    this.scene.setSim(null);
    this.playing = false;
    const total = MISSIONS.length * 3;
    const got = MISSIONS.reduce((n, m) => n + this.progress(m.id).medals.length, 0);
    const learned = new Set(this.save.concepts ?? []);
    const pred = this.save.predictions ?? { right: 0, total: 0 };
    const cards = MISSIONS.map((m, i) => {
      const p = this.progress(m.id);
      // Challenge variants of the evening shift open up as soon as the shift itself is done.
      const unlocked = i === 0 || this.progress(MISSIONS[i - 1].id).completed || (!!m.challenge && this.progress('m5').completed);
      const concept = CONCEPTS.find((c) => c.id === m.concept)!;
      const medals = m.medals.map((md) => `<span class="medal ${p.medals.includes(md.id) ? 'got' : ''}" title="${esc(md.label)}">${md.icon}</span>`).join('');
      return `<button class="mission-card ${unlocked ? '' : 'locked'} ${p.completed ? 'complete' : ''}" ${unlocked ? `data-action="mission" data-arg="${m.id}"` : 'disabled'}>
        <span class="mnum">${unlocked ? m.n : '🔒'}</span>
        <span class="mbody"><b>${esc(m.title)}</b><span class="muted small">${m.challenge ? `⚡ Challenge: ${esc(m.challenge)}` : `${concept.icon} ${esc(concept.title)}`}</span></span>
        <span class="medals" aria-label="${p.medals.length} of 3 medals">${medals}</span>
      </button>`;
    }).join('');
    const soon = COMING_SOON.map(
      (c) => `<div class="mission-card locked"><span class="mnum">🔒</span><span class="mbody"><b>${esc(c.title)}</b><span class="muted small">Coming soon</span></span></div>`,
    ).join('');
    const guide = CONCEPTS.map((c) => {
      const has = learned.has(c.id);
      return `<li class="concept ${has ? 'got' : ''}"><span class="cicon">${has ? c.icon : '?'}</span><span><b>${has ? esc(c.title) : 'Locked'}</b><span class="muted small">${has ? esc(c.short) : 'Finish a mission to unlock'}</span></span></li>`;
    }).join('');
    this.overlay(`
      <div class="map">
        <div class="map-head"><h2>Missions</h2><span class="score">🏅 ${got}/${total} medals${pred.total ? ` · 🔮 ${pred.right}/${pred.total} predictions` : ''}</span></div>
        <div class="missions">${cards}${soon}</div>
        <h3 class="fg-title">📓 Field guide <span class="muted small">${learned.size}/${CONCEPTS.length} concepts</span></h3>
        <ul class="field-guide">${guide}</ul>
      </div>`);
    this.bump();
  }

  private startMission(id: string) {
    this.mission = MISSIONS.find((m) => m.id === id) ?? MISSIONS[0];
    $('toasts').innerHTML = '';
    this.build = { ...emptyBuild(), agentName: this.build.agentName, accent: this.build.accent };
    this.guideDone.clear();
    this.predicted = null;
    this.askMaya = null;
    this.recovery = null;
    this.shift = { accepted: ['launch'], machine: 'compact', sorting: 'routed' };
    this.history = [];
    this.scene.setBuild(this.build);
    this.showBrief();
  }

  private markAllGuided() {
    if (this.mission.askWake) this.guideDone.add('wake');
    if (this.mission.askGuide) this.guideDone.add('guide');
    if (this.mission.askApproval) this.guideDone.add('approval');
    if (this.mission.askRecovery) this.guideDone.add('recovery');
    if (this.mission.shift) ['jobs', 'machine', 'sorting'].forEach((x) => this.guideDone.add(x));
  }

  /** Rebuild the shift build from the player's choices (jobs, machine, sorting). */
  private applyShift() {
    const hasWatcher = !!this.build.watchers[0];
    this.build = shiftBuild(this.build, this.shift, this.fx);
    if (!hasWatcher) this.build.watchers = [null];
    if (!this.guideDone.has('machine')) this.build.workers = [null];
    this.scene.setBuild(this.build);
    this.persist();
    this.bump();
  }

  private showBrief() {
    this.mode = 'brief';
    const m = this.mission;
    const brief = this.fx.messages.find((x) => x.id === 'm-maya-brief')!;
    const p = this.progress(m.id);
    const medals = m.medals
      .map((md) => `<li class="${p.medals.includes(md.id) ? 'got' : ''}"><span class="medal ${p.medals.includes(md.id) ? 'got' : ''}">${md.icon}</span>${esc(md.label)}</li>`)
      .join('');
    this.overlay(`
      <div class="brief">
        <p class="kicker">Mission ${m.n} · ${esc(m.title)}</p>
        ${m.challenge ? `<p class="challenge">⚡ Changed conditions: <b>${esc(m.challenge)}</b>. Will the plan that worked before still work?</p>` : ''}
        <div class="msg big">
          <span class="avatar" style="--c:${PEOPLE.maya.color}" aria-hidden="true">M</span>
          <div><b>Maya</b> <span class="muted small">Founder</span><p>${esc(brief.body)}</p></div>
        </div>
        <h3 class="left">Medals to earn</h3>
        <ul class="medal-list">${medals}</ul>
        <div class="row center"><button class="btn primary big" data-action="begin-build">Build ${esc(this.build.agentName)}</button><button class="btn ghost" data-action="map">Back</button></div>
      </div>`);
    this.bump();
  }

  private showDebrief() {
    const sim = this.sim!;
    this.debriefShown = true;
    this.playing = false;
    const o = evaluateOpening(sim.state, this.fx.deadlines);
    const s = sim.state;
    const m = this.mission;
    const before = this.progress(m.id);
    const earned = m.medals.filter((md) => md.test(o, s));
    const correct = m.prediction.answer(s, this.initialWake);
    const predictedRight = this.predicted === correct;
    const conceptNew = o.promiseKept && !(this.save.concepts ?? []).includes(m.concept);
    const previous = [...(this.save.missionRuns?.[m.id] ?? [])];
    const thisRun: MissionRun = {
      at: new Date().toISOString(),
      plan: this.planSummary(s),
      medals: earned.map((x) => x.id),
      credits: o.creditsSpent,
      doneAt: this.doneTime(s, o),
      ok: o.promiseKept,
    };
    this.save.missionRuns = { ...(this.save.missionRuns ?? {}), [m.id]: [...previous, thisRun].slice(-10) };
    this.recordRun(o, earned.map((x) => x.id), predictedRight);
    const compare = this.compareHtml(m, previous, thisRun);

    const name = esc(s.build.agentName);
    let headline: string;
    if (o.promiseKept) headline = earned.length === 3 ? 'Perfect run! ✨' : s.goal === 'shift' ? 'The launch is live!' : 'Job done!';
    else if (s.goal === 'live' && s.world.live.changedBy) headline = `The page went live — but ${name} never confirmed it.`;
    else if (s.goal === 'live') headline = o.blockedProposals ? 'The gate blocked the publish — the live page never changed.' : 'The logo never made it to the live page.';
    else if (s.goal === 'shift') headline = 'The launch didn’t go live.';
    else if (o.previewRev && !o.taglineOk) headline = 'The logo is up — but the tagline is missing.';
    else if (o.previewRev) headline = 'The preview shows Isha’s old logo.';
    else headline = 'The preview never got a logo.';

    const medalRow = m.medals
      .map((md) => {
        const got = earned.includes(md);
        const isNew = got && !before.medals.includes(md.id);
        const ms = md.measure(o, s);
        return `<li class="${got ? 'got' : 'missed'}"><span class="medal big ${got ? 'got' : ''} ${isNew ? 'new' : ''}">${md.icon}</span>
          <span class="mtext"><b>${esc(md.label)}</b>${isNew ? ' <span class="pill good">new</span>' : ''}
            ${got ? '' : `<span class="small block hint">💡 ${esc(md.hint)}</span>`}</span>
          <span class="vs ${got ? 'ok' : 'no'}"><span>${got ? '✓' : '✗'} ${esc(ms.you)}</span>${got ? '' : `<span class="muted">goal: ${esc(ms.goal)}</span>`}</span></li>`;
      })
      .join('');
    const chosen = m.prediction.options.find((x) => x.id === this.predicted)?.label ?? '—';
    const concept = CONCEPTS.find((c) => c.id === m.concept)!;
    const conceptCard = o.promiseKept
      ? `<div class="concept-card ${conceptNew ? 'new' : ''}">
          <div class="cc-head"><span class="cicon">${concept.icon}</span><div><span class="kicker">${conceptNew ? 'New in your field guide' : 'Field guide'}</span><h3>${esc(concept.title)}</h3></div></div>
          <ul>${concept.points.map((pt) => `<li>${esc(pt)}</li>`).join('')}</ul>
        </div>`
      : `<div class="concept-card locked"><p>🔒 Finish the job to unlock the field-guide card <b>${esc(concept.title)}</b>.</p></div>`;
    const next = MISSIONS.find((x) => x.n === m.n + 1);
    const tagline = s.needsTagline ? (s.world.preview.tagline ? esc(s.world.preview.tagline) : '<span class="missing">[tagline missing]</span>') : 'Launching tonight';
    const liveGoal = s.goal !== 'preview';
    const heroRev = liveGoal ? s.world.live.logoRev : o.previewRev;
    const jobsTable =
      s.goal === 'shift'
        ? `<table class="jobs"><thead><tr><th>Job</th><th>Result</th><th>Due</th></tr></thead><tbody>${o.jobs
            .map((j) => {
              const names: Record<string, string> = { launch: '🚀 Launch page', feedback: '🗂️ Feedback board', partner: '🤝 Message to Nora' };
              const early = j.id === 'feedback' && j.doneAt != null && j.doneAt > (this.fx.deadlines?.feedback_early ?? Infinity) ? ' (after Maya left)' : '';
              return `<tr class="${!j.accepted ? 'declined' : j.ok && !early ? 'ok' : 'no'}"><td>${names[j.id]}</td><td>${
                j.doneAt != null ? `done ${fmtTime(j.doneAt)}${early}` : esc(j.status)
              }</td><td>${j.deadline ? fmtTime(j.deadline) : ''}</td></tr>`;
            })
            .join('')}</tbody></table>`
        : '';

    this.overlay(`
      <div class="debrief">
        <p class="kicker">Mission ${m.n} · ${esc(m.title)}</p>
        <div class="hero">
          <div class="pagebox"><div class="pg-bar">${liveGoal ? 'lumen.app' : 'preview.lumen.app'} <span>v${liveGoal ? s.world.live.version : s.world.preview.version}</span></div>
          <div class="pg-body">${logoSvg(heroRev, 72)}<div><div class="pg-title">Lumen</div><div class="muted small">${liveGoal ? (s.world.live.changedBy ? 'Live now' : 'Coming soon') : tagline}</div></div></div></div>
        </div>
        <h2>${headline}</h2>
        ${jobsTable}
        <ul class="medal-results">${medalRow}</ul>
        ${this.whyHtml(s, o, m.medals.filter((md) => !earned.includes(md)).map((md) => md.id))}
        ${
          this.predicted
            ? `<div class="prediction-result ${predictedRight ? 'right' : 'wrong'}">
          <p><b>🔮 ${predictedRight ? 'You predicted it!' : 'Not what you predicted.'}</b> You said: “${esc(chosen)}”</p>
          <p>${esc(m.prediction.explain(s))}</p>
        </div>`
            : `<div class="prediction-result"><p>${esc(m.prediction.explain(s))}</p></div>`
        }
        ${compare}
        ${conceptCard}
        <details class="numbers"><summary>More numbers</summary><ul class="results">
          <li><span>First check that the page changed</span><b>${o.firstVerifiedAt ? fmtTime(o.firstVerifiedAt) : '—'}</b></li>
          <li><span>Credits spent</span><b>${o.creditsSpent} / ${o.budget}</b></li>
          <li><span>Times you stepped in</span><b>${o.interventions}</b></li>
          <li><span>${name}’s live page</span><b>${o.liveUntouched ? 'Untouched ✓' : 'Changed ✗'}</b></li>
        </ul></details>
        <div class="choices">
          <button class="btn choice" data-action="change-build"><b>↺ Try again</b><span>Keep your build, change one thing.</span></button>
          ${
            next && o.promiseKept
              ? `<button class="btn choice primary-choice" data-action="next-mission"><b>Next mission →</b><span>${esc(next.title)}</span></button>`
              : `<button class="btn choice" data-action="map"><b>Missions</b><span>See your medals and field guide.</span></button>`
          }
        </div>
      </div>`);
    this.bump();
  }

  /** Explains missed cost/speed medals with the run's own numbers — no guessing. */
  private whyHtml(s: Sim['state'], o: OpeningOutcome, missed: string[]): string {
    if (s.goal === 'shift') return this.shiftWhyHtml(s, o, missed);
    if (!o.promiseKept || !(missed.includes('cheap') || missed.includes('fast'))) return '';
    const friendly = (what: string) => {
      const w = what.replace(/^T\d+: /, '');
      if (/rent/.test(w)) return 'Machine rent (every run)';
      if (/Decide · Deliberate/.test(w)) return 'AI decision — Thorough';
      if (/Decide · Swift/.test(w)) return 'AI decision — Quick';
      if (/Render/.test(w)) return 'Prepare the logo';
      if (/Save to preview/.test(w)) return 'Save the draft';
      if (/Publish/.test(w)) return 'Publish to the live page';
      return w;
    };
    const groups = new Map<string, { n: number; total: number }>();
    for (const l of s.credits.ledger) {
      const k = friendly(l.what);
      const g = groups.get(k) ?? { n: 0, total: 0 };
      g.n++;
      g.total += l.amount;
      groups.set(k, g);
    }
    const credits = [...groups.entries()]
      .map(([k, g]) => `<tr class="${/Thorough/.test(k) ? 'hot' : ''}"><td>${esc(k)}${g.n > 1 ? ` × ${g.n}` : ''}</td><td>${g.total}</td></tr>`)
      .join('');

    const run = s.tasks[0]?.runs.find((r) => r.notes.receipt);
    let times = '';
    if (run) {
      const starts = s.trace.filter((e) => e.kind === 'step_start' && e.taskId === s.tasks[0].id && e.t >= run.startedAt && e.t <= run.finishedAt!);
      const label = (e: TraceEntry) => {
        if (/deciding/.test(e.text)) return /Deliberate/.test(e.text) ? 'AI decision — Thorough' : 'AI decision — Quick';
        return e.text.replace(/^Worker \d+: /, '').replace(/\.$/, '');
      };
      times = starts
        .map((e, i) => {
          const end = i + 1 < starts.length ? starts[i + 1].t : run.finishedAt!;
          const mins = (end - e.t) / MIN;
          return `<tr class="${/Thorough/.test(label(e)) ? 'hot' : ''}"><td>${esc(label(e))}</td><td>${fmtDuration(mins * MIN)}</td></tr>`;
        })
        .join('');
      times = `<tr><td class="muted">Email delivered</td><td class="muted">${fmtTime(run.startedAt)}</td></tr>${times}<tr class="total"><td>Checked on the page</td><td>${fmtTime(run.finishedAt!)}</td></tr>`;
    }
    const usedThorough = s.trace.some((e) => e.kind === 'decision' && e.packet?.model === 'deliberate');
    const tip = usedThorough
      ? `The Thorough model costs <b>4 credits and 3 minutes</b> per decision; Quick costs <b>1 credit and 1 minute</b>.${
          s.needsTagline ? ' Quick’s tray holds 10 units with 7 already used — the 2-unit summary fits (7 + 2 = 9), the 5-unit guide doesn’t.' : ''
        }`
      : 'Every step costs time; AI decisions and preparing the logo cost credits.';
    return `<div class="why">
      <h3>Where your credits and minutes went</h3>
      <div class="why-grid">
        ${missed.includes('cheap') ? `<table><thead><tr><th>Credits</th><th></th></tr></thead><tbody>${credits}<tr class="total"><td>Total</td><td>${o.creditsSpent}</td></tr></tbody></table>` : ''}
        ${missed.includes('fast') && times ? `<table><thead><tr><th>Time</th><th></th></tr></thead><tbody>${times}</tbody></table>` : ''}
      </div>
      <p class="small">${tip}</p>
    </div>`;
  }

  /** A short description of the build, so runs can be compared. */
  private planSummary(s: Sim['state']): string {
    if (this.mission.shift) {
      const jobs = s.tasks.length;
      const fb = s.tasks.some((t) => t.responsibility === 'feedback');
      return `${s.workers.length > 1 ? '2 workers' : '1 worker'} · ${jobs} job${jobs === 1 ? '' : 's'}${fb ? ` · ${this.shift.sorting === 'routed' ? 'routed' : 'big model'}` : ''}`;
    }
    const k = s.build.workers[0];
    const p = k?.procedure ?? [];
    const parts = [p.find((x) => x.kind === 'decide')?.model === 'deliberate' ? 'Thorough' : 'Quick'];
    if (this.mission.askWake) parts.push(s.build.watchers[0]?.wake === 'keep' ? 'keeps watching' : 'checks once');
    if (this.mission.askGuide) parts.push(k?.guide === 'summary' ? 'guide summary' : k?.guide === 'full' ? 'full guide' : 'no guide');
    if (this.mission.askApproval) parts.push(p.some((x) => x.kind === 'request_approval') ? 'asks Maya' : 'no approval');
    const rec = p.find((x) => ['check_status', 'resend_same', 'resend_new', 'give_up'].includes(x.kind))?.kind;
    const recLabel: Record<string, string> = { check_status: 'checks status', resend_same: 'resends (same key)', resend_new: 'new request', give_up: 'gives up' };
    if (this.mission.askRecovery && rec) parts.push(recLabel[rec]);
    return parts.join(' · ');
  }

  private doneTime(s: Sim['state'], o: OpeningOutcome): number | null {
    if (s.goal === 'shift') {
      const done = o.jobs.filter((j) => j.accepted && j.doneAt != null).map((j) => j.doneAt!);
      return done.length === o.jobs.filter((j) => j.accepted).length && done.length ? Math.max(...done) : null;
    }
    return o.promiseKept ? (o.latestVerifiedAt ?? o.firstVerifiedAt) : null;
  }

  /** Same mission, same evening: only the build differs, so the comparison is fair. */
  private compareHtml(m: Mission, previous: MissionRun[], current: MissionRun): string {
    if (!previous.length) return '';
    const rows = [...previous.slice(-4), current];
    const score = (r: MissionRun) => r.medals.length * 1000 - r.credits;
    const best = rows.reduce((a, b) => (score(b) > score(a) ? b : a));
    const icons = Object.fromEntries(m.medals.map((md) => [md.id, md.icon]));
    const prevBest = previous.reduce((a, b) => (score(b) > score(a) ? b : a), previous[0]);
    const verdict =
      current.medals.length > prevBest.medals.length
        ? '🎉 Your best result on this mission so far.'
        : current.medals.length === prevBest.medals.length && current.credits < prevBest.credits
          ? '🎉 Same medals as your best, for fewer credits.'
          : current.medals.length === prevBest.medals.length
            ? 'Matches your best run.'
            : `Your best run so far: ${prevBest.plan}.`;
    return `<div class="compare-runs">
      <h3>Your runs on this mission</h3>
      <p class="small muted">Same evening every time — only your build changed.</p>
      <table><thead><tr><th>Build</th><th>Medals</th><th>Credits</th><th>Done</th></tr></thead><tbody>${rows
        .map(
          (r) => `<tr class="${r === current ? 'current' : ''} ${r === best ? 'best' : ''}"><td>${r === current ? '▶ ' : ''}${esc(r.plan)}${r === best ? ' <span class="pill good">best</span>' : ''}</td>
            <td>${m.medals.map((md) => `<span class="medal ${r.medals.includes(md.id) ? 'got' : ''}">${icons[md.id]}</span>`).join('')}</td>
            <td>${r.credits}</td><td>${r.doneAt != null ? fmtTime(r.doneAt) : '—'}</td></tr>`,
        )
        .join('')}</tbody></table>
      <p class="small">${verdict}</p>
    </div>`;
  }

  private shiftWhyHtml(s: Sim['state'], o: OpeningOutcome, missed: string[]): string {
    if (!missed.length) return '';
    const byJob = new Map<string, number>();
    const jobOf = (what: string) => {
      const id = /^(T\d+):/.exec(what)?.[1];
      const t = s.tasks.find((x) => x.id === id);
      return t ? { launch: '🚀 Launch', feedback: '🗂️ Feedback', partner: '🤝 Nora’s message', preview_logo: 'Logo' }[t.responsibility] : '🛠️ Machine rent';
    };
    for (const l of s.credits.ledger) byJob.set(jobOf(l.what), (byJob.get(jobOf(l.what)) ?? 0) + l.amount);
    const rows = [...byJob.entries()].map(([k, v]) => `<tr class="${/rent|Feedback/.test(k) && v >= 17 ? 'hot' : ''}"><td>${k}</td><td>${v}</td></tr>`).join('');
    const stuck = s.tasks.find((t) => t.status === 'WAITING_BUDGET');
    const workers = s.workers.length;
    const timeline = s.tasks
      .map((t) => {
        const first = s.trace.find((e) => e.taskId === t.id && e.kind === 'step_start');
        const done = t.runs[0]?.notes.receipt?.at;
        const label = { launch: '🚀 Launch', feedback: '🗂️ Feedback', partner: '🤝 Nora', preview_logo: 'Logo' }[t.responsibility];
        return `<tr><td>${label} (W${t.owner + 1})</td><td>${first ? fmtTime(first.t) : '—'} → ${done ? fmtTime(done) : t.status === 'WAITING_BUDGET' ? 'out of credits' : '—'}</td></tr>`;
      })
      .join('');
    const tips: string[] = [];
    if (stuck) tips.push(`“${esc(stuck.title)}” needed more credits than were left. Routing the clear feedback to the small model saves 8 credits.`);
    if (workers === 1 && missed.includes('wrap')) tips.push('One worker does the jobs in turn, so the last one finishes later. A second worker costs 14 more credits of rent but runs jobs side by side.');
    if (missed.includes('all') && !stuck && s.tasks.length < 3) tips.push('This medal needs all three jobs — you declined some tonight.');
    if (!tips.length) tips.push('Every credit and minute here comes from your choices of jobs, workers and sorting.');
    return `<div class="why">
      <h3>Where your credits and time went</h3>
      <div class="why-grid">
        <table><thead><tr><th>Credits</th><th></th></tr></thead><tbody>${rows}<tr class="total"><td>Total (budget ${s.credits.budget})</td><td>${o.creditsSpent}</td></tr></tbody></table>
        <table><thead><tr><th>Jobs</th><th></th></tr></thead><tbody>${timeline}</tbody></table>
      </div>
      ${tips.map((t) => `<p class="small">💡 ${t}</p>`).join('')}
    </div>`;
  }

  private recordRun(o: OpeningOutcome, medals: string[], predictedRight: boolean) {
    const m = this.mission;
    const prev = this.progress(m.id);
    this.save.missions = { ...(this.save.missions ?? {}), [m.id]: { medals: [...new Set([...prev.medals, ...medals])], completed: prev.completed || o.promiseKept } };
    if (o.promiseKept) this.save.concepts = [...new Set([...(this.save.concepts ?? []), m.concept])];
    const pr = this.save.predictions ?? { right: 0, total: 0 };
    if (this.predicted) this.save.predictions = { right: pr.right + (predictedRight ? 1 : 0), total: pr.total + 1 };
    this.save.runs.push({
      at: new Date().toISOString(),
      fixture: `${this.fx.id}@${this.fx.version}`,
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
    if (this.mode === 'build' && !this.advanced && (t.kind === 'watcher' || t.kind === 'worker')) {
      this.mobileView = 'side'; // the guide lives in the side panel on phones
      return this.bump();
    }
    this.mobileView = 'side';
    this.bump();
  }

  private startRun() {
    if (!isRunnable(this.build, this.fx)) return;
    if (!this.advanced && !this.predicted) return this.bump();
    this.overlay(null);
    this.initialWake = this.build.watchers[0]?.wake ?? null;
    this.sim = new Sim(this.fx, this.build);
    this.seenTrace = this.sim.state.trace.length;
    this.scene.setSim(this.sim);
    this.mode = 'run';
    this.playing = true;
    this.debriefShown = false;
    this.missedPrompt = null;
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
    $('toasts').innerHTML = '';
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
    if (!this.advanced) this.mobileView = 'side';
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
        this.persist();
        return this.showMap();
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
        return this.edit((b) => (b.watchers[0] = { card: 'inbox', wake: this.mission.shift ? 'keep' : 'once', deliverTo: b.workers[0] ? 0 : null }));
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
          if (w.guide && w.guide !== 'none') setGuide(w, w.guide);
          if (this.mission.autoApproval) setApproval(w, true);
          else if (this.fx.goal === 'live' && this.askMaya !== null) setApproval(w, this.askMaya);
          if (this.mission.askRecovery && this.recovery) setRecovery(w, this.recovery);
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
        if (this.missedPrompt === 'open') this.missedPrompt = 'done';
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
        if (this.missedPrompt === 'open') return;
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
      case 'change-build':
        // Keep the build so the player can change one thing; ask for a fresh prediction.
        this.predicted = null;
        this.markAllGuided();
        return this.toBuild(this.sim?.state.build);
      case 'continue-story':
        return this.showMap();
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
      case 'g-recovery':
        this.guideDone.add('recovery');
        this.recovery = arg as Recovery;
        this.predicted = null;
        return this.edit((b) => setRecovery(b.workers[0]!, arg as Recovery));
      case 'g-approval':
        this.guideDone.add('approval');
        this.askMaya = arg === 'ask';
        this.predicted = null;
        return this.edit((b) => setApproval(b.workers[0]!, arg === 'ask'));
      case 'g-job': {
        const j = arg as 'feedback' | 'partner';
        const acc = new Set(this.shift.accepted);
        if (acc.has(j)) acc.delete(j);
        else acc.add(j);
        this.shift.accepted = ['launch', ...(['feedback', 'partner'] as const).filter((x) => acc.has(x))];
        this.predicted = null;
        return this.applyShift();
      }
      case 'g-jobs-done':
        this.guideDone.add('jobs');
        return this.applyShift();
      case 'g-machine':
        this.guideDone.add('machine');
        this.shift.machine = arg as 'compact' | 'team';
        this.predicted = null;
        return this.applyShift();
      case 'g-sorting':
        this.guideDone.add('sorting');
        this.shift.sorting = arg as Sorting;
        this.predicted = null;
        return this.applyShift();
      case 'g-wake':
        this.guideDone.add('wake');
        this.predicted = null;
        return this.edit((b) => (b.watchers[0]!.wake = arg as 'once' | 'keep'));
      case 'g-guide':
        this.guideDone.add('guide');
        this.predicted = null;
        return this.edit((b) => setGuide(b.workers[0]!, arg as 'none' | 'full' | 'summary'));
      case 'predict':
        this.predicted = arg!;
        return this.bump();
      case 'restart-build':
        this.build = { ...emptyBuild(), agentName: this.build.agentName, accent: this.build.accent };
        this.guideDone.clear();
        this.predicted = null;
        this.askMaya = null;
        this.shift = { accepted: ['launch'], machine: 'compact', sorting: 'routed' };
        this.scene.setBuild(this.build);
        return this.bump();
      case 'map':
        return this.showMap();
      case 'mission':
        return this.startMission(arg!);
      case 'next-mission': {
        const next = MISSIONS.find((m) => m.n === this.mission.n + 1);
        return next ? this.startMission(next.id) : this.showMap();
      }
      case 'advanced':
        this.advanced = true;
        this.save.advanced = true;
        this.scene.setDetail(true);
        this.persist();
        return this.bump();
      case 'simple':
        this.advanced = false;
        this.save.advanced = false;
        this.scene.setDetail(false);
        this.persist();
        return this.bump();
      case 'missed-keep':
        if (this.sim) {
          const b = clone(this.sim.state.build);
          b.watchers[0]!.wake = 'keep';
          this.sim.applyLiveEdit(b, 'Watcher → Keep watching');
        }
        this.missedPrompt = 'done';
        this.playing = true;
        return this.bump();
      case 'missed-leave':
        this.missedPrompt = 'done';
        this.playing = true;
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
      case 'guide':
        return this.edit((b) => setGuide(b.workers[0]!, val as 'none' | 'full' | 'summary'));
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
          `Watcher → ${val === 'keep' ? 'Keep watching' : 'Check once'}`,
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
