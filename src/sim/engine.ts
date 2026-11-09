// Simulation core (spec §13). A deterministic discrete-event simulation with integer
// millisecond time. World state (what actually happened) is kept apart from agent state
// (what Relay observed and recorded). The decision engine only ever sees context packets.
import { packContext } from './context';
import { decide } from './rules';
import { STEP_INFO, stepCredits, stepDuration } from './steps';
import { MAYA_THANKS } from '../content/opening';
import {
  MACHINES,
  MIN,
  fmtTime,
  type Build,
  type Fixture,
  type FixtureMessage,
  type Ms,
  type QueuedEvent,
  type SimState,
  type Task,
  type TraceEntry,
} from './types';
import { stepLabel } from './steps';

// Stable phases for equal timestamps (spec §13.2).
export const PHASE = { external: 1, commit: 2, reply: 3, runtime: 4, verify: 5, evaluator: 6 } as const;

const clone = <T>(v: T): T => structuredClone(v);

function matchesWatcher(msg: FixtureMessage): boolean {
  // Inbox watcher filter: messages from Isha that carry a logo attachment.
  return msg.from === 'isha' && !!msg.attachment;
}

export class Sim {
  state: SimState;
  readonly fixture: Fixture;

  constructor(fixture: Fixture, build: Build, snapshot?: SimState) {
    this.fixture = fixture;
    if (snapshot) {
      this.state = clone(snapshot);
      return;
    }
    const machine = MACHINES[build.machine];
    this.state = {
      fixtureId: fixture.id,
      fixtureVersion: fixture.version,
      seed: fixture.seed,
      time: fixture.start,
      seq: 0,
      traceSeq: 0,
      queue: [],
      build: clone(build),
      configVersion: 1,
      interventions: [],
      world: {
        inbox: fixture.messages.filter((m) => m.preexisting).map((m) => ({ ...m, arrivedAt: m.at })),
        preview: { version: 1, logoRev: null, history: [{ version: 1, logoRev: null, at: fixture.start, writer: 'Maya' }] },
        live: { version: 1, changedBy: null },
        latestLogoRevSent: 0,
        mayaThanked: false,
      },
      watchers: [],
      workers: [],
      tasks: [],
      journal: [],
      shelf: [],
      agentKnown: { previewVersion: 1 },
      credits: { budget: fixture.budget, spent: 0, ledger: [] },
      ram: { totalGB: machine.ramGB, usedGB: 0 },
      cores: machine.cores,
      trace: [],
      violations: [],
      blockedProposals: 0,
      ended: false,
    };
    this.init();
  }

  // -------------------------------------------------------------------------
  // Setup

  private init() {
    const s = this.state;
    const f = this.fixture;
    const machine = MACHINES[s.build.machine];
    const start = this.trace({
      kind: 'shift',
      actor: 'relay',
      text: `${s.build.agentName} starts at ${fmtTime(f.start)} on the ${machine.name} machine.`,
      detail: `Budget ${f.budget} credits. Machine rent ${machine.rent} credits is charged up front.`,
    });
    this.charge(machine.rent, `${machine.name} machine rent`);

    s.build.workers.forEach((w, idx) => {
      if (!w) return;
      s.workers.push({ idx, active: null });
      if (w.responsibilities.includes('preview_logo')) {
        const task: Task = {
          id: `T${s.tasks.length + 1}`,
          title: 'Put Isha’s logo on the preview',
          responsibility: 'preview_logo',
          owner: idx,
          revision: 1,
          status: 'WAITING_EVENT',
          waitLabel: 'Waiting for Isha’s logo',
          stepIdx: 0,
          run: null,
          pendingLogoRev: null,
          lastCompletedRev: null,
          runs: [],
        };
        s.tasks.push(task);
        this.journal(`Responsibility recorded: ${task.title} (owner: Worker ${idx + 1}).`);
      }
    });

    s.build.watchers.forEach((w, idx) => {
      if (!w || !w.wake) return;
      s.watchers.push({ idx, armed: true, wake: w.wake, closedReason: null, delivered: [], configVersion: 1 });
      this.journal(
        `Watcher armed: inbox, messages from Isha with a logo. Wake rule: ${w.wake === 'once' ? 'Once' : 'Keep current'}.`,
      );
    });
    this.trace({ kind: 'watcher', actor: 'relay', text: 'Inbox watcher armed; worker idle. No model is running.', cause: start });

    for (const m of f.messages) if (!m.preexisting) this.enqueue({ t: m.at, phase: PHASE.external, kind: 'message', msgId: m.id });
    this.enqueue({ t: f.end, phase: PHASE.evaluator, kind: 'end' });
  }

  // -------------------------------------------------------------------------
  // Queue & bookkeeping

  private enqueue(e: Omit<QueuedEvent, 'seq'>) {
    const ev: QueuedEvent = { ...e, seq: this.state.seq++ };
    const q = this.state.queue;
    let i = q.length;
    while (i > 0 && cmp(q[i - 1], ev) > 0) i--;
    q.splice(i, 0, ev);
  }

  private trace(e: Omit<TraceEntry, 'id' | 't' | 'cause'> & { cause?: number | null }): number {
    const id = ++this.state.traceSeq;
    this.state.trace.push({ cause: null, ...e, id, t: this.state.time });
    return id;
  }

  private journal(text: string) {
    this.state.journal.push({ t: this.state.time, text });
  }

  private charge(amount: number, what: string) {
    if (!amount) return;
    this.state.credits.spent += amount;
    this.state.credits.ledger.push({ t: this.state.time, amount, what });
  }

  snapshot(): SimState {
    return clone(this.state);
  }

  nextEventTime(): Ms | null {
    const next = this.state.queue.find((e) => e.kind !== 'dispatch');
    return next ? next.t : null;
  }

  /** Process every event with time <= t, then advance the clock to t (bounded by the shift end). */
  runUntil(t: Ms) {
    const s = this.state;
    const target = Math.min(t, this.fixture.end);
    while (!s.ended && s.queue.length && s.queue[0].t <= target) {
      const ev = s.queue.shift()!;
      s.time = ev.t;
      this.handle(ev);
    }
    if (!s.ended) s.time = Math.max(s.time, target);
  }

  /** Advance to (and process) the next meaningful event. */
  advanceToNextEvent() {
    const t = this.nextEventTime();
    if (t != null) this.runUntil(t);
  }

  /** Ending early still processes every intervening event (spec §7.4). */
  runToEnd() {
    this.runUntil(this.fixture.end);
  }

  isIdle(): boolean {
    return this.state.workers.every((w) => !w.active) && this.state.tasks.every((t) => !t.run);
  }

  canOfferEnd(): boolean {
    return !this.state.ended && this.state.time >= this.fixture.endOfferAfter && this.isIdle();
  }

  // -------------------------------------------------------------------------
  // Event handling

  private handle(ev: QueuedEvent) {
    switch (ev.kind) {
      case 'message':
        return this.onMessage(ev.msgId!);
      case 'deliver':
        return this.onDeliver(ev.msgId!, ev.watcher!, ev.cause ?? null);
      case 'watcher_sync':
        return this.onWatcherSync(ev.watcher!, ev.cause ?? null);
      case 'dispatch':
        return this.onDispatch();
      case 'step_done':
        return this.onStepDone(ev.worker!);
      case 'reaction':
        return this.onReaction(ev.cause ?? null);
      case 'end':
        this.state.ended = true;
        this.trace({ kind: 'shift', actor: 'world', text: `The opening ends at ${fmtTime(this.state.time)}.` });
        return;
    }
  }

  private onMessage(msgId: string) {
    const s = this.state;
    const m = this.fixture.messages.find((x) => x.id === msgId)!;
    s.world.inbox.push({ ...m, arrivedAt: s.time });
    if (m.attachment) s.world.latestLogoRevSent = Math.max(s.world.latestLogoRevSent, m.attachment.logoRev);
    const id = this.trace({
      kind: 'world',
      actor: 'world',
      text: `Isha emails “${m.subject}” with ${m.attachment?.name ?? 'no attachment'}.`,
      detail: m.body,
      observerOnly: true,
    });
    if (!matchesWatcher(m)) return;
    const armed = s.watchers.filter((w) => w.armed);
    if (!armed.length) {
      this.trace({
        kind: 'watcher',
        actor: 'world',
        text: 'No armed watcher matches this message. Relay is not woken and does not know it arrived.',
        cause: id,
        observerOnly: true,
      });
      return;
    }
    for (const w of armed) this.enqueue({ t: s.time, phase: PHASE.reply, kind: 'deliver', msgId, watcher: w.idx, cause: id });
  }

  private onDeliver(msgId: string, wIdx: number, cause: number | null) {
    const s = this.state;
    const w = s.watchers.find((x) => x.idx === wIdx)!;
    if (!w.armed || w.delivered.includes(msgId)) return;
    const m = s.world.inbox.find((x) => x.id === msgId)!;
    w.delivered.push(msgId);
    const d = this.trace({
      kind: 'deliver',
      actor: 'relay',
      text: `Watcher delivers Isha’s message (${m.attachment!.name}) to Relay.`,
      detail: `Occurred ${fmtTime(m.arrivedAt)}, delivered ${fmtTime(s.time)}.`,
      cause,
    });
    this.journal(`Event recorded: ${m.attachment!.name} from Isha.`);
    if (w.wake === 'once') {
      w.armed = false;
      w.closedReason = `Wake rule “Once” satisfied at ${fmtTime(s.time)}; watcher closed.`;
      this.trace({ kind: 'watcher', actor: 'relay', text: w.closedReason, cause: d });
      this.journal('Watcher closed (Once rule).');
    }
    const target = s.build.watchers[wIdx]?.deliverTo;
    const task = s.tasks.find((t) => t.owner === target && t.responsibility === 'preview_logo');
    if (task) this.receiveLogo(task, m.attachment!.logoRev, m.attachment!.id, d);
  }

  private onWatcherSync(wIdx: number, cause: number | null) {
    const s = this.state;
    const w = s.watchers.find((x) => x.idx === wIdx);
    if (!w || !w.armed) return;
    const pending = s.world.inbox.filter((m) => matchesWatcher(m) && !w.delivered.includes(m.id));
    const id = this.trace({
      kind: 'watcher',
      actor: 'relay',
      text: pending.length
        ? `Watcher checks the inbox on activation and finds ${pending.length} undelivered message${pending.length > 1 ? 's' : ''}.`
        : 'Watcher checks the inbox on activation: nothing new.',
      cause,
    });
    for (const m of pending) this.enqueue({ t: s.time, phase: PHASE.reply, kind: 'deliver', msgId: m.id, watcher: wIdx, cause: id });
  }

  private receiveLogo(task: Task, rev: number, attachmentId: string, cause: number) {
    const s = this.state;
    const handled = Math.max(task.lastCompletedRev ?? 0, task.run?.logoRev ?? 0, task.pendingLogoRev?.rev ?? 0);
    if (rev <= handled) {
      this.trace({ kind: 'task', actor: 'relay', taskId: task.id, text: `Revision ${rev} is already handled or queued; ignored.`, cause });
      return;
    }
    if (task.run) {
      task.pendingLogoRev = { rev, attachmentId };
      task.revision++;
      this.trace({
        kind: 'task',
        actor: 'relay',
        taskId: task.id,
        text: `Logo revision ${rev} queued; it will be handled after the current run finishes.`,
        cause,
      });
      this.journal(`Queued logo revision ${rev} for ${task.id}.`);
      return;
    }
    this.startRun(task, rev, attachmentId, cause);
    this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
  }

  private startRun(task: Task, rev: number, attachmentId: string, cause: number | null) {
    const s = this.state;
    const cfg = s.build.workers[task.owner]!;
    task.revision++;
    task.run = {
      n: task.runs.length + 1,
      logoRev: rev,
      attachmentId,
      configVersion: s.configVersion,
      procedure: clone(cfg.procedure),
      contextRule: cfg.contextRule,
      startedAt: s.time,
      finishedAt: null,
      notes: {},
    };
    task.stepIdx = 0;
    task.status = 'READY';
    task.waitLabel = '';
    this.trace({
      kind: 'task',
      actor: 'relay',
      taskId: task.id,
      text: `${task.id} wakes for logo revision ${rev} (run #${task.run.n}).`,
      cause,
    });
    this.journal(`${task.id} run #${task.run.n} started for logo revision ${rev}.`);
  }

  private onDispatch() {
    const s = this.state;
    for (const w of s.workers) {
      if (w.active) continue;
      const task = s.tasks.find(
        (t) => t.owner === w.idx && t.run && (t.status === 'READY' || t.status === 'WAITING_RESOURCE' || t.status === 'WAITING_BUDGET'),
      );
      if (task) this.startStep(w.idx, task);
    }
  }

  private startStep(wIdx: number, task: Task) {
    const s = this.state;
    const run = task.run!;
    const worker = s.workers.find((w) => w.idx === wIdx)!;

    // Skip steps that are no longer needed or finish the run.
    while (task.stepIdx < run.procedure.length) {
      const st = run.procedure[task.stepIdx];
      const skip =
        run.notes.proposal?.kind === 'no_change' && (st.kind === 'render' || st.kind === 'write_preview');
      if (!skip) break;
      this.trace({ kind: 'step_done', actor: 'relay', taskId: task.id, worker: wIdx, text: `Skipped “${stepLabel(st)}”: preview already current.` });
      task.stepIdx++;
    }
    if (task.stepIdx >= run.procedure.length) return this.finishRun(task);

    const step = run.procedure[task.stepIdx];
    const info = STEP_INFO[step.kind];

    // Preconditions grounded in recorded progress, never in world state.
    const missing =
      (step.kind === 'render' && run.notes.proposal?.kind !== 'update_preview' && 'a decision to update the preview') ||
      (step.kind === 'write_preview' && !run.notes.rendered && 'a rendered logo') ||
      (step.kind === 'verify_preview' && !run.notes.written && run.notes.proposal?.kind !== 'no_change' && 'a saved preview');
    if (missing) {
      task.status = 'FAILED';
      task.waitLabel = `Unsupported state: “${info.label}” needs ${missing}.`;
      this.trace({ kind: 'task', actor: 'relay', taskId: task.id, worker: wIdx, text: task.waitLabel });
      task.runs.push({ ...run, finishedAt: s.time });
      task.run = null;
      return;
    }

    if (step.kind === 'publish_live' && this.fixture.delegation.live === 'none') {
      s.blockedProposals++;
      (run.notes.blocked ??= []).push('publish_live');
      this.trace({
        kind: 'permission',
        actor: 'relay',
        taskId: task.id,
        worker: wIdx,
        text: 'Permission gate blocks “Publish to live page”: Maya did not delegate live changes. Nothing was sent.',
        detail: 'A blocked proposal is not a violation. It costs the time spent forming it, but no credits and no world effect.',
      });
    }

    const credits = step.kind === 'publish_live' ? 0 : stepCredits(step);
    if (s.credits.spent + credits > s.credits.budget) {
      if (task.status !== 'WAITING_BUDGET')
        this.trace({ kind: 'budget', actor: 'relay', taskId: task.id, text: `Not enough credits for “${stepLabel(step)}” (${credits}). Waiting for budget.` });
      task.status = 'WAITING_BUDGET';
      task.waitLabel = 'Waiting for budget';
      return;
    }
    if (s.ram.usedGB + info.ramGB > s.ram.totalGB + 1e-9) {
      task.status = 'WAITING_RESOURCE';
      task.waitLabel = 'Waiting for RAM';
      return;
    }

    this.charge(credits, `${task.id}: ${stepLabel(step)}`);
    s.ram.usedGB = round1(s.ram.usedGB + info.ramGB);
    const dur = stepDuration(step, s.cores);
    const packet = step.kind === 'decide' ? packContext(run, this.fixture, step.model ?? 'swift', run.contextRule) : undefined;
    const traceId = this.trace({
      kind: 'step_start',
      actor: 'relay',
      taskId: task.id,
      worker: wIdx,
      text: `Worker ${wIdx + 1}: ${info.verb}${step.kind === 'decide' ? ` (${stepLabel(step)})` : ''}.`,
      detail: info.explain,
      packet,
    });
    worker.active = {
      taskId: task.id,
      stepIdx: task.stepIdx,
      step: clone(step),
      start: s.time,
      end: s.time + dur,
      ramGB: info.ramGB,
      cpu: info.cpuMinutes > 0,
      remote: info.remote,
      credits,
      packet,
      traceId,
    };
    task.status = 'RUNNING';
    task.waitLabel = '';
    this.enqueue({
      t: s.time + dur,
      phase: step.kind === 'verify_preview' ? PHASE.verify : PHASE.reply,
      kind: 'step_done',
      worker: wIdx,
    });
  }

  private onStepDone(wIdx: number) {
    const s = this.state;
    const worker = s.workers.find((w) => w.idx === wIdx)!;
    const a = worker.active;
    if (!a) return;
    worker.active = null;
    s.ram.usedGB = round1(Math.max(0, s.ram.usedGB - a.ramGB));
    const task = s.tasks.find((t) => t.id === a.taskId)!;
    const run = task.run!;
    const n = run.notes;
    const cause = a.traceId;

    switch (a.step.kind) {
      case 'read_logo': {
        const m = s.world.inbox.find((x) => x.attachment?.id === run.attachmentId)!;
        n.metadata = { attachmentId: m.attachment!.id, name: m.attachment!.name, logoRev: m.attachment!.logoRev, from: m.from };
        n.rawArtworkRead = true;
        this.trace({ kind: 'step_done', actor: 'relay', taskId: task.id, worker: wIdx, text: `Read ${m.attachment!.name} (revision ${m.attachment!.logoRev}).`, cause });
        break;
      }
      case 'read_preview': {
        n.previewState = { version: s.world.preview.version, logoRev: s.world.preview.logoRev, observedAt: s.time };
        this.state.agentKnown.previewVersion = s.world.preview.version;
        this.trace({
          kind: 'step_done',
          actor: 'relay',
          taskId: task.id,
          worker: wIdx,
          text: `Preview currently shows ${s.world.preview.logoRev ? `logo revision ${s.world.preview.logoRev}` : 'no logo'} (version ${s.world.preview.version}).`,
          cause,
        });
        break;
      }
      case 'decide': {
        const d = decide(a.packet!);
        n.proposal = d.proposal;
        const text =
          d.proposal.kind === 'update_preview'
            ? `Decision: render logo revision ${d.proposal.logoRev} and save it to the preview.`
            : d.proposal.kind === 'no_change'
              ? `Decision: preview already shows revision ${d.proposal.logoRev}; just verify.`
              : `Decision: required evidence missing (${d.proposal.what}).`;
        this.trace({
          kind: 'decision',
          actor: 'relay',
          taskId: task.id,
          worker: wIdx,
          text,
          detail: `Simulation explanation — rule “${d.rule}”: ${d.explanation}`,
          packet: a.packet,
          cause,
        });
        if (d.proposal.kind === 'need_evidence') {
          task.status = 'FAILED';
          task.waitLabel = 'Needs evidence the procedure never reads';
          task.runs.push({ ...run, finishedAt: s.time });
          task.run = null;
          return this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
        }
        break;
      }
      case 'render': {
        const rev = (n.proposal as { logoRev: number }).logoRev;
        n.rendered = { logoRev: rev, storage: 'temporary' };
        s.shelf.push({ artifact: 'render', version: s.shelf.filter((v) => v.artifact === 'render').length + 1, logoRev: rev, writer: `Worker ${wIdx + 1}`, at: s.time, storage: 'temporary' });
        this.trace({ kind: 'step_done', actor: 'relay', taskId: task.id, worker: wIdx, text: `Rendered logo revision ${rev} (temporary file).`, cause });
        break;
      }
      case 'write_preview': {
        const expected = this.state.agentKnown.previewVersion;
        if (s.world.preview.version !== expected) {
          this.trace({
            kind: 'write',
            actor: 'relay',
            taskId: task.id,
            worker: wIdx,
            text: `Write rejected: preview is at version ${s.world.preview.version}, Relay expected ${expected}.`,
            cause,
          });
          task.status = 'FAILED';
          task.waitLabel = 'Stale write rejected';
          task.runs.push({ ...run, finishedAt: s.time });
          task.run = null;
          return;
        }
        const rev = n.rendered!.logoRev;
        const version = s.world.preview.version + 1;
        s.world.preview.version = version;
        s.world.preview.logoRev = rev;
        s.world.preview.history.push({ version, logoRev: rev, at: s.time, writer: s.build.agentName });
        this.state.agentKnown.previewVersion = version;
        n.written = { version, logoRev: rev };
        s.shelf.push({ artifact: 'preview', version, logoRev: rev, writer: `Worker ${wIdx + 1}`, at: s.time, storage: 'shared' });
        const w = this.trace({
          kind: 'write',
          actor: 'relay',
          taskId: task.id,
          worker: wIdx,
          text: `Preview page saved: version ${version} with logo revision ${rev}.`,
          cause,
        });
        if (!s.world.mayaThanked) {
          s.world.mayaThanked = true;
          this.enqueue({ t: s.time + 1 * MIN, phase: PHASE.external, kind: 'reaction', cause: w });
        }
        break;
      }
      case 'verify_preview': {
        const want = n.written?.logoRev ?? (n.proposal as { logoRev: number }).logoRev;
        if (s.world.preview.logoRev === want) {
          n.receipt = { version: s.world.preview.version, logoRev: want, at: s.time };
          this.trace({
            kind: 'verify',
            actor: 'relay',
            taskId: task.id,
            worker: wIdx,
            text: `Verified: the preview page shows logo revision ${want}. Receipt stored.`,
            cause,
          });
        } else {
          this.trace({
            kind: 'verify',
            actor: 'relay',
            taskId: task.id,
            worker: wIdx,
            text: `Verification failed: preview shows ${s.world.preview.logoRev ?? 'no logo'}, expected revision ${want}.`,
            cause,
          });
        }
        break;
      }
      case 'publish_live':
        break;
    }

    task.stepIdx++;
    if (task.stepIdx >= run.procedure.length) this.finishRun(task);
    else task.status = 'READY';
    this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
  }

  private finishRun(task: Task) {
    const s = this.state;
    const run = task.run!;
    run.finishedAt = s.time;
    task.runs.push(run);
    task.run = null;
    if (!run.notes.receipt) {
      task.status = 'FAILED';
      task.waitLabel = 'Finished without a verification receipt';
      this.trace({ kind: 'task', actor: 'relay', taskId: task.id, text: `${task.id} cannot be marked done: no verification receipt.` });
      return;
    }
    task.lastCompletedRev = run.logoRev;
    this.journal(`${task.id} run #${run.n} done: preview verified with logo revision ${run.logoRev}.`);
    if (task.pendingLogoRev) {
      const p = task.pendingLogoRev;
      task.pendingLogoRev = null;
      this.startRun(task, p.rev, p.attachmentId, null);
      return;
    }
    const keeping = s.watchers.some((w) => w.armed && s.build.watchers[w.idx]?.deliverTo === task.owner);
    if (keeping) {
      task.status = 'WAITING_EVENT';
      task.waitLabel = 'Keeping current: waiting for a newer logo from Isha';
      this.trace({ kind: 'task', actor: 'relay', taskId: task.id, text: `${task.id} done for revision ${run.logoRev}; still watching for newer logos. Worker idle.` });
    } else {
      task.status = 'DONE';
      task.waitLabel = '';
      this.trace({ kind: 'task', actor: 'relay', taskId: task.id, text: `${task.id} done for revision ${run.logoRev}. No watcher remains armed for it.` });
    }
  }

  private onReaction(cause: number | null) {
    const s = this.state;
    s.world.inbox.push({
      id: 'm-maya-thanks',
      from: 'maya',
      at: s.time,
      arrivedAt: s.time,
      subject: MAYA_THANKS.subject,
      body: MAYA_THANKS.body,
    });
    this.trace({ kind: 'reaction', actor: 'world', text: `Maya sees the preview: “${MAYA_THANKS.body}”`, cause });
  }

  // -------------------------------------------------------------------------
  // Player interventions (Practice mode). In-flight work keeps its original binding.

  applyLiveEdit(next: Build, description: string) {
    const s = this.state;
    const prev = s.build;
    s.build = clone(next);
    s.configVersion++;
    s.interventions.push({ t: s.time, text: description });
    const id = this.trace({
      kind: 'config',
      actor: 'player',
      text: `Live edit (config v${s.configVersion}): ${description}`,
      detail: 'In-flight steps keep their original configuration. New runs use the new one.',
    });
    this.journal(`Configuration v${s.configVersion}: ${description}`);

    next.watchers.forEach((wc, idx) => {
      const rt = s.watchers.find((w) => w.idx === idx);
      if (!wc || !wc.wake || !rt) return;
      if (wc.wake !== prev.watchers[idx]?.wake) {
        rt.wake = wc.wake;
        rt.configVersion = s.configVersion;
        if (wc.wake === 'keep' && !rt.armed) {
          rt.armed = true;
          rt.closedReason = null;
          this.trace({ kind: 'watcher', actor: 'relay', text: 'Watcher re-armed with “Keep current”. It will check the inbox once on activation.', cause: id });
          this.enqueue({ t: s.time + 0.5 * MIN, phase: PHASE.reply, kind: 'watcher_sync', watcher: idx, cause: id });
          for (const t of s.tasks)
            if (t.status === 'DONE' && t.owner === wc.deliverTo) {
              t.status = 'WAITING_EVENT';
              t.waitLabel = 'Keeping current: waiting for a newer logo from Isha';
            }
        }
      }
    });
  }
}

function cmp(a: QueuedEvent, b: QueuedEvent): number {
  return a.t - b.t || a.phase - b.phase || a.seq - b.seq;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
