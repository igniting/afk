// Simulation core (spec §13). A deterministic discrete-event simulation with integer
// millisecond time. World state (what actually happened) is kept apart from agent state
// (what Relay observed and recorded). The decision engine only ever sees context packets.
import { packContext, shiftPacket } from './context';
import { decide, decideWork } from './rules';
import { STEP_INFO, opInfo, stepCredits, stepDuration } from './steps';
import { getRule, packGeneric } from './genericRules';
import { MAYA_THANKS } from '../content/opening';
import {
  MACHINES,
  MIN,
  fmtTime,
  type Build,
  type Fixture,
  type LabFlags,
  type FixtureMessage,
  type Ms,
  type QueuedEvent,
  type Responsibility,
  type SimState,
  type JobDef,
  type Task,
  type TileDef,
  type TraceEntry,
  type TriggerKind,
} from './types';
import { stepLabel } from './steps';

// Stable phases for equal timestamps (spec §13.2).
export const PHASE = { external: 1, commit: 2, reply: 3, runtime: 4, verify: 5, evaluator: 6 } as const;

const clone = <T>(v: T): T => structuredClone(v);

const PEOPLE_NAMES: Record<string, string> = { maya: 'Maya', isha: 'Isha', leo: 'Leo', nora: 'Nora' };

export function triggerOf(msg: FixtureMessage): TriggerKind | null {
  return msg.kind ?? (msg.from === 'isha' && msg.attachment ? 'logo' : null);
}

export function triggerFor(r: Responsibility): TriggerKind {
  return r === 'feedback' ? 'feedback' : r === 'partner' ? 'confirm' : 'logo';
}

const OPTIONAL: Responsibility[] = ['feedback', 'partner'];

export const TASK_TITLES: Record<Responsibility, string> = {
  preview_logo: 'Put Isha’s logo on the preview',
  launch: 'Publish the approved launch page',
  feedback: 'Prepare the feedback board',
  partner: 'Send Nora the partner message',
};

const WAIT_LABELS: Record<TriggerKind, string> = {
  logo: 'Waiting for Isha’s logo',
  feedback: 'Waiting for the feedback bundle',
  confirm: 'Waiting for Nora to confirm',
};

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
        preview: { version: 1, logoRev: null, tagline: null, history: [{ version: 1, logoRev: null, tagline: null, at: fixture.start, writer: 'Maya' }] },
        live: { version: 1, changedBy: null, logoRev: null, approvedVersion: null, at: null },
        approvals: [],
        board: null,
        partnerMessage: null,
        publishRequests: 0,
        artifacts: {},
        sent: [],
        notifications: [],
        questions: [],
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
      needsTagline: !!fixture.needsTagline,
      goal: fixture.goal ?? 'preview',
      agentEvents: {},
      tokenSeq: 0,
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
      for (const r of w.responsibilities) {
        const job = this.job(r);
        if (job ? job.offer || (!job.required && !s.build.accepted?.includes(r)) : OPTIONAL.includes(r) && !s.build.accepted?.includes(r)) continue;
        const task: Task = {
          id: `T${s.tasks.length + 1}`,
          title: job ? job.title : TASK_TITLES[r],
          responsibility: r,
          owner: idx,
          revision: 1,
          status: 'WAITING_EVENT',
          waitLabel: job ? 'Waiting for its trigger' : WAIT_LABELS[triggerFor(r)],
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
      this.journal(`Watcher armed: inbox, messages for accepted jobs. Wake rule: ${w.wake === 'once' ? 'Check once' : 'Keep watching'}.`);
    });
    this.trace({ kind: 'watcher', actor: 'relay', text: 'Inbox watcher armed; worker idle. No model is running.', cause: start });

    for (const [k, v] of Object.entries(f.artifacts ?? {}))
      s.world.artifacts[k] = { value: { ...v }, version: 1, writer: 'Maya', at: f.start, history: [{ version: 1, at: f.start, writer: 'Maya', value: { ...v } }] };
    // Data-driven jobs that start with the shift.
    for (const t of s.tasks)
      if (this.job(t.responsibility) && this.triggersOf(t.responsibility).includes('start')) {
        this.startRun(t, 0, 'start', start);
        this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
      }
    for (const m of f.messages) if (!m.preexisting) this.enqueue({ t: m.at, phase: PHASE.external, kind: 'message', msgId: m.id });
    for (const r of f.restarts ?? []) this.enqueue({ t: r, phase: PHASE.external, kind: 'restart' });
    this.enqueue({ t: f.end, phase: PHASE.evaluator, kind: 'end' });
  }

  job(id: string): JobDef | undefined {
    return this.fixture.jobs?.find((j) => j.id === id);
  }

  /** Message kinds that wake a responsibility. */
  triggersOf(r: string): string[] {
    const j = this.job(r);
    return j ? (this.state.build.triggers?.[r] ?? j.triggers) : [triggerFor(r)];
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

  /** Nothing can progress any more: no worker busy, nothing runnable, and no future events except the end. */
  canOfferEnd(): boolean {
    const s = this.state;
    if (s.ended || s.time < this.fixture.endOfferAfter) return false;
    if (s.workers.some((w) => w.active)) return false;
    if (s.tasks.some((t) => t.run && t.status === 'READY')) return false;
    return s.queue.every((e) => e.kind === 'end' || e.kind === 'dispatch');
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
        return this.onStepDone(ev.worker!, ev.token);
      case 'reaction':
        return this.onReaction(ev.cause ?? null);
      case 'approval':
        return this.onApproval(ev.taskId!, ev.cause ?? null);
      case 'commit':
        return this.onCommit(ev.taskId!, ev.cause ?? null);
      case 'answer':
        return this.onAnswer(ev.taskId!, ev.ref!, ev.cause ?? null);
      case 'restart':
        return this.onRestart();
      case 'quiet':
        return this.onQuiet(ev.taskId!, ev.token!, ev.msgId!, ev.cause ?? null);
      case 'end':
        this.state.ended = true;
        this.trace({ kind: 'shift', actor: 'world', text: `The evening ends at ${fmtTime(this.state.time)}.` });
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
      text: `${PEOPLE_NAMES[m.from]} emails “${m.subject}”${m.attachment ? ` with ${m.attachment.name}` : ''}.`,
      detail: m.body,
      observerOnly: true,
    });
    const kind = triggerOf(m);
    const relevant =
      !!kind &&
      (s.tasks.some((t) => this.triggersOf(t.responsibility).includes(kind)) ||
        (this.fixture.jobs ?? []).some((j) => j.offer && j.triggers.includes(kind)) ||
        (s.goal === 'jobs' && this.waitsFor(kind)));
    if (!relevant) {
      if (kind)
        this.trace({ kind: 'watcher', actor: 'world', text: 'No accepted job needs this message, so the watcher ignores it.', cause: id, observerOnly: true });
      return;
    }
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
    const what = m.attachment ? m.attachment.name : `“${m.subject}”`;
    const d = this.trace({
      kind: 'deliver',
      actor: 'relay',
      text: `Watcher delivers ${PEOPLE_NAMES[m.from]}’s message (${what}) to ${s.build.agentName}.`,
      detail: `Occurred ${fmtTime(m.arrivedAt)}, delivered ${fmtTime(s.time)}.`,
      cause,
    });
    this.journal(`Event recorded: ${what} from ${PEOPLE_NAMES[m.from]}.`);
    if (w.wake === 'once') {
      w.armed = false;
      w.closedReason = `“Check once” rule satisfied at ${fmtTime(s.time)}; watcher closed.`;
      this.trace({ kind: 'watcher', actor: 'relay', text: w.closedReason, cause: d });
      this.journal('Watcher closed (Check once rule).');
    }
    const kind = triggerOf(m)!;
    s.agentEvents[kind] = s.time;
    this.wakeEventWaiters(kind);
    for (const task of s.tasks.filter((t) => this.triggersOf(t.responsibility).includes(kind))) {
      if (task.responsibility === 'preview_logo') this.receiveLogo(task, m.attachment!.logoRev, m.attachment!.id, d);
      else if (this.job(task.responsibility)) this.receiveGeneric(task, m.id, d);
      else this.receiveWork(task, m.attachment?.logoRev ?? 0, m.attachment?.id ?? m.id, d);
    }
    for (const j of (this.fixture.jobs ?? []).filter((x) => x.offer && x.triggers.includes(kind) && !s.tasks.some((t) => t.responsibility === x.id)))
      this.admit(j, m.id, d);
  }

  /** One-shot jobs (launch, feedback, partner): start once when their trigger arrives. */
  private receiveWork(task: Task, rev: number, ref: string, cause: number) {
    if (task.run || task.runs.length) return;
    this.startRun(task, rev, ref, cause);
    this.enqueue({ t: this.state.time, phase: PHASE.runtime, kind: 'dispatch' });
  }

  private onWatcherSync(wIdx: number, cause: number | null) {
    const s = this.state;
    const w = s.watchers.find((x) => x.idx === wIdx);
    if (!w || !w.armed) return;
    const pending = s.world.inbox.filter((m) => {
      const k = triggerOf(m);
      return k && s.tasks.some((t) => this.triggersOf(t.responsibility).includes(k)) && !w.delivered.includes(m.id);
    });
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
      procedure: clone(cfg.procedures?.[task.responsibility] ?? cfg.procedure),
      contextRule: cfg.contextRule,
      guide: cfg.guide ?? 'none',
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
      text: task.responsibility === 'preview_logo' ? `${task.id} wakes for logo revision ${rev} (run #${task.run.n}).` : `${task.id} wakes: ${task.title}.`,
      cause,
    });
    this.journal(`${task.id} run #${task.run.n} started${task.responsibility === 'preview_logo' ? ` for logo revision ${rev}` : ''}.`);
  }

  private onDispatch() {
    const s = this.state;
    for (const w of s.workers) {
      // A job may stop at a wait without occupying the worker; then try the next ready job.
      const tried = new Set<string>();
      while (!w.active) {
        const task = s.tasks.find(
          (t) => !tried.has(t.id) && t.owner === w.idx && t.run && (t.status === 'READY' || t.status === 'WAITING_RESOURCE' || t.status === 'WAITING_BUDGET'),
        );
        if (!task) break;
        tried.add(task.id);
        this.startStep(w.idx, task);
      }
    }
  }

  private startStep(wIdx: number, task: Task) {
    const s = this.state;
    const run = task.run!;
    const worker = s.workers.find((w) => w.idx === wIdx)!;

    // Skip steps that are no longer needed or finish the run.
    while (task.stepIdx < run.procedure.length) {
      const st = run.procedure[task.stepIdx];
      if (st.when === 'need' && !run.notes.need) {
        task.stepIdx++;
        continue;
      }
      if (st.when === 'ok' && run.notes.need) {
        task.stepIdx++;
        continue;
      }
      if (st.when === 'conflict' && !run.notes.conflict) {
        task.stepIdx++;
        continue;
      }
      if (st.kind === 'op' && (st.op!.type === 'waitJob' || st.op!.type === 'waitEvent')) {
        const op = st.op!;
        const ok = op.type === 'waitJob' ? s.tasks.some((t) => t.responsibility === op.job && t.status === 'DONE') : !!s.agentEvents[op.event];
        const jobGone = op.type === 'waitJob' && !s.tasks.some((t) => t.responsibility === op.job);
        if (ok || jobGone) {
          task.stepIdx++;
          continue;
        }
        task.status = 'WAITING_EVENT';
        task.waitLabel = op.label;
        return;
      }
      if (st.kind === 'op' && st.op!.type === 'cancel') {
        this.cancelJob(st.op!.job, task);
        task.stepIdx++;
        continue;
      }
      if (st.kind === 'wait_launch') {
        if (this.launchDone()) {
          this.trace({ kind: 'step_done', actor: 'relay', taskId: task.id, worker: wIdx, text: 'The launch page is live and checked — continue.' });
          task.stepIdx++;
          continue;
        }
        task.status = 'WAITING_EVENT';
        task.waitLabel = 'Waiting for the launch page to go live';
        this.trace({ kind: 'task', actor: 'relay', taskId: task.id, text: `${task.id} waits for the launch receipt. The worker is free meanwhile.` });
        return;
      }
      const recovery = st.kind === 'check_status' || st.kind === 'resend_same' || st.kind === 'resend_new' || st.kind === 'give_up';
      if (recovery && !run.notes.unknownOutcome) {
        task.stepIdx++;
        continue;
      }
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

    if (step.kind === 'resend_new' || step.kind === 'give_up') {
      const newReq = step.kind === 'resend_new';
      if (newReq) s.blockedProposals++;
      task.status = 'FAILED';
      task.waitLabel = newReq
        ? 'Blocked: a publish for this draft is still unresolved, so a new request would risk a duplicate'
        : 'Reported failure to Maya without checking';
      this.trace({
        kind: newReq ? 'permission' : 'task',
        actor: 'relay',
        taskId: task.id,
        worker: wIdx,
        text: newReq
          ? 'Runtime blocks a brand-new publish request: the first one (same draft) is still unresolved. Nothing was sent.'
          : `${s.build.agentName} tells Maya the publish failed — without checking what actually happened.`,
        detail: newReq ? 'The existing-operation check prevents blind duplicate publishing. Checking status or reusing the same key would resolve it.' : undefined,
      });
      task.runs.push({ ...run, finishedAt: s.time });
      task.run = null;
      this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
      return;
    }

    if (step.kind === 'op' && step.op!.type === 'send' && step.op!.requireApproval) {
      const op = step.op;
      const n = run.notes;
      if (n.approvals?.[op.artifact] == null || n.approvals[op.artifact] !== n.wrote?.[op.artifact]) {
        s.blockedProposals++;
        task.status = 'FAILED';
        task.waitLabel = 'Blocked: no approval for this exact version';
        this.trace({ kind: 'permission', actor: 'relay', taskId: task.id, worker: wIdx, text: `Permission gate blocks “${op.label}”: no approval for this exact version. Nothing was sent.` });
        task.runs.push({ ...run, finishedAt: s.time });
        task.run = null;
        return;
      }
      this.trace({ kind: 'permission', actor: 'relay', taskId: task.id, worker: wIdx, text: `Permission gate allows “${op.label}”: the approved version is the one being sent.` });
    }

    let publishAllowed = false;
    if (step.kind === 'publish_live') {
      const n = run.notes;
      publishAllowed = this.fixture.delegation.live === 'approval' && !!n.approval && !!n.written && n.approval.version === n.written.version;
      if (!publishAllowed) {
        s.blockedProposals++;
        (n.blocked ??= []).push('publish_live');
        this.trace({
          kind: 'permission',
          actor: 'relay',
          taskId: task.id,
          worker: wIdx,
          text:
            this.fixture.delegation.live === 'none'
              ? 'Permission gate blocks “Publish to live page”: Maya did not delegate live changes. Nothing was sent.'
              : `Permission gate blocks “Publish to live page”: no approval from Maya for this exact draft${n.approval ? ` (approved v${n.approval.version}, draft is v${n.written?.version})` : ''}. Nothing was sent.`,
          detail: 'A blocked proposal is not a violation. It costs the time spent forming it, but no credits and no world effect.',
        });
      } else
        this.trace({
          kind: 'permission',
          actor: 'relay',
          taskId: task.id,
          worker: wIdx,
          text: `Permission gate allows the publish: Maya approved draft v${n.approval!.version}, which is the draft being published.`,
        });
    }

    const credits = step.kind === 'publish_live' && !publishAllowed ? 0 : stepCredits(step);
    if (s.credits.spent + credits > s.credits.budget) {
      if (task.status !== 'WAITING_BUDGET')
        this.trace({ kind: 'budget', actor: 'relay', taskId: task.id, text: `Not enough credits for “${stepLabel(step)}” (${credits}). Waiting for budget.` });
      task.status = 'WAITING_BUDGET';
      task.waitLabel = 'Waiting for budget';
      return;
    }
    const oi = step.kind === 'op' ? opInfo(step) : null;
    const ramNeed = oi ? oi.ramGB : info.ramGB;
    if (s.ram.usedGB + ramNeed > s.ram.totalGB + 1e-9 && !this.lab.noRamAdmission) {
      if (task.status !== 'WAITING_RESOURCE')
        this.trace({ kind: 'task', actor: 'relay', taskId: task.id, worker: wIdx, text: `${task.id} waits for RAM: needs ${ramNeed} GB, ${round1(s.ram.totalGB - s.ram.usedGB)} GB free.` });
      task.status = 'WAITING_RESOURCE';
      task.waitLabel = 'Waiting for RAM';
      return;
    }

    this.charge(credits, `${task.id}: ${stepLabel(step)}`);
    s.ram.usedGB = round1(s.ram.usedGB + ramNeed);
    const overcommitted = s.ram.usedGB > s.ram.totalGB + 1e-9;
    const pub = this.fixture.publication;
    const loseReply = step.kind === 'publish_live' && publishAllowed && !!pub?.loseFirstReply && s.world.publishRequests === 0;
    const dur = step.kind === 'publish_live' && !publishAllowed ? 0.5 * MIN : loseReply ? pub!.timeoutAfter : stepDuration(step, s.cores);
    if (step.kind === 'publish_live' && publishAllowed) {
      s.world.publishRequests++;
      run.notes.requests = (run.notes.requests ?? 0) + 1;
    }
    if (step.kind === 'resend_same') {
      s.world.publishRequests++;
      run.notes.requests = (run.notes.requests ?? 0) + 1;
    }
    const purpose = step.purpose ?? 'logo';
    const packet =
      step.kind === 'op' && step.op!.type === 'decide'
        ? packGeneric(this.decisionTiles(run.notes.tiles ?? [], step.op.extra), step.op.select ?? 'all', step.op.goal, step.model ?? 'swift')
        : step.kind === 'decide'
          ? purpose === 'logo'
            ? packContext(run, this.fixture, step.model ?? 'swift', run.contextRule)
            : shiftPacket(run, purpose, step.model ?? 'swift')
          : undefined;
    const traceId = this.trace({
      kind: 'step_start',
      actor: 'relay',
      taskId: task.id,
      worker: wIdx,
      text: oi ? `Worker ${wIdx + 1}: ${step.op!.label}${step.op!.type === 'decide' ? ` (${stepLabel(step).split(' · ').pop()})` : ''}.` : `Worker ${wIdx + 1}: ${info.verb}${step.kind === 'decide' ? ` (${stepLabel(step)})` : ''}.`,
      detail: oi ? undefined : info.explain,
      packet,
    });
    const cpuMin = oi ? oi.cpuMinutes : info.cpuMinutes;
    const wall = oi ? (oi.minutes + (cpuMin ? 0 : oi.ioMinutes)) * MIN : dur;
    worker.active = {
      taskId: task.id,
      stepIdx: task.stepIdx,
      step: clone(step),
      start: s.time,
      end: s.time + (cpuMin ? cpuMin * MIN + (oi?.ioMinutes ?? 0) * MIN : wall),
      ramGB: ramNeed,
      cpu: cpuMin > 0,
      remote: oi ? oi.remote : info.remote,
      credits,
      packet,
      traceId,
      token: ++s.tokenSeq,
      runN: run.n,
    };
    task.status = 'RUNNING';
    task.waitLabel = '';
    if (overcommitted) this.outOfMemory(wIdx);
    if (!worker.active) return;
    if (cpuMin > 0) {
      // Local CPU work shares cores fairly; completion times are rescheduled as load changes.
      Object.assign(worker.active, { cpuWork: cpuMin * MIN, rate: 0, lastAt: s.time, ioMs: (oi?.ioMinutes ?? 0) * MIN });
      this.reflowCpu();
      return;
    }
    if (oi) {
      this.enqueue({ t: s.time + wall, phase: step.op!.type === 'verify' ? PHASE.verify : PHASE.reply, kind: 'step_done', worker: wIdx, token: worker.active.token });
      return;
    }
    if (loseReply) this.enqueue({ t: s.time + pub!.commitAfter, phase: PHASE.commit, kind: 'commit', taskId: task.id, cause: traceId });
    this.enqueue({
      t: s.time + dur,
      phase: step.kind.startsWith('verify') ? PHASE.verify : PHASE.reply,
      kind: 'step_done',
      worker: wIdx,
      token: worker.active.token,
    });
  }

  private onStepDone(wIdx: number, token?: number) {
    const s = this.state;
    const worker = s.workers.find((w) => w.idx === wIdx)!;
    const a = worker.active;
    if (!a) return;
    if (token != null && a.token !== token) return; // rescheduled by CPU sharing
    if (a.cpu && a.ioMs) {
      // CPU part done; the job now waits on I/O, still holding its RAM but no core.
      a.cpu = false;
      a.cpuWork = 0;
      a.token = ++s.tokenSeq;
      a.end = s.time + a.ioMs;
      this.enqueue({ t: a.end, phase: PHASE.reply, kind: 'step_done', worker: wIdx, token: a.token });
      a.ioMs = 0;
      this.reflowCpu();
      return;
    }
    worker.active = null;
    s.ram.usedGB = round1(Math.max(0, s.ram.usedGB - a.ramGB));
    if (a.cpu) this.reflowCpu();
    const task = s.tasks.find((t) => t.id === a.taskId)!;
    if (!task.run || task.run.notes.cancelled || (a.runN != null && task.run.n !== a.runN)) {
      // The job was cancelled while this step ran: its result is discarded.
      this.trace({ kind: 'step_done', actor: 'relay', taskId: task.id, worker: wIdx, text: `Discarded “${stepLabel(a.step)}” — that work was cancelled or replaced.` });
      this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
      return;
    }
    const run = task.run!;
    const n = run.notes;
    const cause = a.traceId;

    if (a.step.kind === 'op') {
      const stop = this.finishOp(task, a, wIdx, cause);
      if (stop) return;
      task.stepIdx++;
      if (task.stepIdx >= run.procedure.length) this.finishRun(task);
      else task.status = 'READY';
      this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
      return;
    }

    switch (a.step.kind) {
      case 'read_logo': {
        const m = s.world.inbox.find((x) => x.attachment?.id === run.attachmentId)!;
        n.metadata = { attachmentId: m.attachment!.id, name: m.attachment!.name, logoRev: m.attachment!.logoRev, from: m.from };
        n.rawArtworkRead = true;
        this.trace({ kind: 'step_done', actor: 'relay', taskId: task.id, worker: wIdx, text: `Read ${m.attachment!.name} (revision ${m.attachment!.logoRev}).`, cause });
        break;
      }
      case 'read_preview': {
        n.previewState = { version: s.world.preview.version, logoRev: s.world.preview.logoRev, tagline: s.world.preview.tagline, observedAt: s.time };
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
      case 'read_guide': {
        const want = run.guide === 'summary' ? 'summary' : 'full';
        const f = this.fixture.shelfFiles.find((x) => (x.kind ?? 'full') === want) ?? this.fixture.shelfFiles[0];
        if (f) n.guide = { fileId: f.id, name: f.name, units: f.units, tagline: f.tagline ?? null };
        this.trace({
          kind: 'step_done',
          actor: 'relay',
          taskId: task.id,
          worker: wIdx,
          text: f ? `Read ${f.name} (${f.units} units).` : 'No brand guide on the shelf.',
          cause,
        });
        break;
      }
      case 'decide': {
        const purpose = a.step.purpose ?? 'logo';
        if (purpose !== 'logo') {
          const d = decideWork(purpose, a.packet!);
          this.trace({
            kind: 'decision',
            actor: 'relay',
            taskId: task.id,
            worker: wIdx,
            text:
              d.proposal.kind === 'publish'
                ? `Decision: Maya’s approval matches draft v${d.proposal.version} — publish it.`
                : d.proposal.kind === 'need_evidence'
                  ? `Decision: can’t continue — needs ${d.proposal.what}.`
                  : `Decision (${stepLabel(a.step)}): ${d.explanation}`,
            detail: `Simulation explanation — rule “${d.rule}”: ${d.explanation}`,
            packet: a.packet,
            cause,
          });
          if (d.proposal.kind === 'need_evidence') {
            task.status = 'FAILED';
            task.waitLabel = `Needs ${d.proposal.what}`;
            task.runs.push({ ...run, finishedAt: s.time });
            task.run = null;
            return this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
          }
          const so = (n.sorted ??= { complete: 0, incomplete: 0, reduced: false });
          const fb = this.feedbackLoad();
          if (purpose === 'sort_complete') so.complete = Math.min(fb.complete, so.complete + 3);
          if (purpose === 'sort_incomplete') so.incomplete = fb.incomplete;
          if (purpose === 'sort_all') {
            // Mixed batches of 4: complete threads first, then the incomplete ones.
            let take = 4;
            const c = Math.min(take, fb.complete - so.complete);
            so.complete += c;
            take -= c;
            so.incomplete += Math.min(take, fb.incomplete - so.incomplete);
          }
          if (purpose === 'reduce') so.reduced = true;
          break;
        }
        const d = decide(a.packet!);
        n.proposal = d.proposal;
        const text =
          d.proposal.kind === 'update_preview'
            ? `Decision: render logo revision ${d.proposal.logoRev}${s.needsTagline ? (d.proposal.tagline ? ' with the tagline' : ' — tagline missing, no guide in the tray') : ''} and save it to the preview.`
            : d.proposal.kind === 'no_change'
              ? `Decision: preview already shows revision ${d.proposal.logoRev}; just verify.`
              : `Decision: required evidence missing (${d.proposal.kind === 'need_evidence' ? d.proposal.what : ''}).`;
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
        const prop = n.proposal as { logoRev: number; tagline: string | null };
        const rev = prop.logoRev;
        n.rendered = { logoRev: rev, tagline: prop.tagline ?? null, storage: 'temporary' };
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
        const tagline = n.rendered!.tagline;
        const version = s.world.preview.version + 1;
        s.world.preview.version = version;
        s.world.preview.logoRev = rev;
        s.world.preview.tagline = tagline;
        s.world.preview.history.push({ version, logoRev: rev, tagline, at: s.time, writer: s.build.agentName });
        this.state.agentKnown.previewVersion = version;
        n.written = { version, logoRev: rev, tagline };
        s.shelf.push({ artifact: 'preview', version, logoRev: rev, writer: `Worker ${wIdx + 1}`, at: s.time, storage: 'shared' });
        const w = this.trace({
          kind: 'write',
          actor: 'relay',
          taskId: task.id,
          worker: wIdx,
          text: `Preview page saved: version ${version} with logo revision ${rev}.`,
          cause,
        });
        if (!s.world.mayaThanked && s.goal === 'preview') {
          s.world.mayaThanked = true;
          this.enqueue({ t: s.time + 1 * MIN, phase: PHASE.external, kind: 'reaction', cause: w });
        }
        break;
      }
      case 'verify_preview': {
        const want = n.written?.logoRev ?? (n.proposal as { logoRev: number }).logoRev;
        if (s.world.preview.logoRev === want) {
          n.receipt = { version: s.world.preview.version, logoRev: want, at: s.time };
          const missingTagline = s.needsTagline && !s.world.preview.tagline;
          this.trace({
            kind: 'verify',
            actor: 'relay',
            taskId: task.id,
            worker: wIdx,
            text: missingTagline
              ? `Verified: the preview shows logo revision ${want}, but the tagline is missing. Receipt stored honestly.`
              : `Verified: the preview page shows logo revision ${want}${s.needsTagline ? ' with the tagline' : ''}. Receipt stored.`,
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
      case 'publish_live': {
        if (a.credits > 0 && n.written && n.approval && s.world.live.changedBy && s.world.live.approvedVersion === n.approval.version && this.fixture.publication?.loseFirstReply && (n.requests ?? 0) === 1) {
          // The commit already happened (see onCommit) but the reply never came back.
          n.unknownOutcome = true;
          this.trace({
            kind: 'task',
            actor: 'relay',
            taskId: task.id,
            worker: wIdx,
            text: `No reply from the live-page service after ${Math.round((a.end - a.start) / MIN)} minutes. Outcome unknown — did it publish or not?`,
            detail: 'A timeout is not the same as a failure: the request may have succeeded after the reply was lost.',
            cause,
          });
          break;
        }
        if (a.credits > 0 && n.written && n.approval) {
          s.world.live = {
            version: s.world.live.version + 1,
            changedBy: s.build.agentName,
            logoRev: n.written.logoRev,
            approvedVersion: n.approval.version,
            at: s.time,
          };
          this.trace({
            kind: 'write',
            actor: 'relay',
            taskId: task.id,
            worker: wIdx,
            text: `Live page published: draft v${n.written.version} (one logical operation, key op-${task.id}-publish).`,
            cause,
          });
        }
        break;
      }
      case 'request_approval': {
        const ap = this.fixture.approver;
        n.approvalRequestedAt = s.time;
        const v = n.written?.version ?? 0;
        if (ap && s.time <= ap.until) {
          this.trace({ kind: 'task', actor: 'relay', taskId: task.id, worker: wIdx, text: `Asked Maya to approve draft v${v}. Worker is free while she looks.`, cause });
          this.enqueue({ t: s.time + ap.replyAfter, phase: PHASE.reply, kind: 'approval', taskId: task.id, cause });
          task.waitLabel = `Waiting for Maya’s OK on draft v${v}`;
        } else {
          this.trace({
            kind: 'task',
            actor: 'relay',
            taskId: task.id,
            worker: wIdx,
            text: `Maya left at ${ap ? fmtTime(ap.until) : '—'}. The approval request will wait until she is back.`,
            cause,
          });
          task.waitLabel = 'Waiting for Maya — she has left';
        }
        task.stepIdx++;
        task.status = 'WAITING_APPROVAL';
        this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
        return;
      }
      case 'verify_live': {
        if (n.written && s.world.live.logoRev === n.written.logoRev && s.world.live.changedBy) {
          n.receipt = { version: s.world.live.version, logoRev: n.written.logoRev, at: s.time };
          this.trace({ kind: 'verify', actor: 'relay', taskId: task.id, worker: wIdx, text: `Verified: the live page shows the approved draft. Receipt stored.`, cause });
        } else
          this.trace({ kind: 'verify', actor: 'relay', taskId: task.id, worker: wIdx, text: 'Verification failed: the live page did not change.', cause });
        break;
      }
      case 'check_status':
        n.reconciled = !!s.world.live.changedBy;
        this.trace({
          kind: 'verify',
          actor: 'relay',
          taskId: task.id,
          worker: wIdx,
          text: s.world.live.changedBy
            ? `Status lookup: request op-${task.id}-publish was committed at ${fmtTime(s.world.live.at!)}. It did publish — only the reply was lost.`
            : 'Status lookup: the request was never committed.',
          cause,
        });
        break;
      case 'resend_same':
        n.reconciled = !!s.world.live.changedBy;
        this.trace({
          kind: 'task',
          actor: 'relay',
          taskId: task.id,
          worker: wIdx,
          text: `Resent with the same key op-${task.id}-publish. The service recognised it and returned the original result — no second publish, no extra charge.`,
          cause,
        });
        break;
      case 'read_feedback': {
        n.feedbackRead = true;
        const fb = this.feedbackLoad();
        this.trace({
          kind: 'step_done',
          actor: 'relay',
          taskId: task.id,
          worker: wIdx,
          text: `Fetched ${fb.complete + fb.incomplete} feedback items: ${fb.complete} complete thread${fb.complete === 1 ? '' : 's'}${fb.incomplete ? `, ${fb.incomplete} incomplete` : ''}.`,
          cause,
        });
        break;
      }
        break;
      case 'save_board': {
        const so = n.sorted ?? { complete: 0, incomplete: 0, reduced: false };
        const items = so.complete + so.incomplete;
        s.world.board = { items, at: s.time };
        const total = this.feedbackLoad().complete + this.feedbackLoad().incomplete;
        if (items >= total && so.reduced) {
          n.receipt = { version: 1, logoRev: 0, at: s.time };
          this.trace({ kind: 'write', actor: 'relay', taskId: task.id, worker: wIdx, text: `Feedback board saved: all ${total} items sorted. Receipt stored.`, cause });
        } else this.trace({ kind: 'write', actor: 'relay', taskId: task.id, worker: wIdx, text: `Feedback board saved with only ${items}/${total} items sorted.`, cause });
        break;
      }
      case 'read_draft':
        n.draftRead = true;
        this.trace({ kind: 'step_done', actor: 'relay', taskId: task.id, worker: wIdx, text: 'Read the release facts from the draft.', cause });
        break;
      case 'format_message':
        (n.message ??= { formatted: false, saved: false, sent: false }).formatted = true;
        this.trace({ kind: 'step_done', actor: 'relay', taskId: task.id, worker: wIdx, text: 'Partner message formatted.', cause });
        break;
      case 'save_message':
        (n.message ??= { formatted: false, saved: false, sent: false }).saved = true;
        this.trace({ kind: 'step_done', actor: 'relay', taskId: task.id, worker: wIdx, text: 'Partner message draft saved — it waits until the launch is live.', cause });
        break;
      case 'send_partner':
        (n.message ??= { formatted: false, saved: false, sent: false }).sent = true;
        s.world.partnerMessage = { at: s.time, liveRev: s.world.live.logoRev };
        this.trace({ kind: 'write', actor: 'relay', taskId: task.id, worker: wIdx, text: 'Sent Nora the announcement with the live link (pre-approved template).', cause });
        break;
      case 'verify_sent':
        if (s.world.partnerMessage) {
          n.receipt = { version: 1, logoRev: s.world.partnerMessage.liveRev ?? 0, at: s.time };
          this.trace({ kind: 'verify', actor: 'relay', taskId: task.id, worker: wIdx, text: 'Verified: Nora received the right message. Receipt stored.', cause });
        }
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
      task.waitLabel = run.notes.need ? `Still unresolved: ${run.notes.need}` : 'Finished without a verification receipt';
      if (this.job(task.responsibility)) this.wakeJobWaiters(task.responsibility);
      this.trace({ kind: 'task', actor: 'relay', taskId: task.id, text: `${task.id} cannot be marked done: no verification receipt.` });
      return;
    }
    if (this.job(task.responsibility)) {
      task.status = 'DONE';
      task.waitLabel = '';
      this.journal(`${task.id} done: ${task.title}.`);
      this.trace({ kind: 'task', actor: 'relay', taskId: task.id, text: `${task.id} done: ${task.title}.` });
      this.wakeJobWaiters(task.responsibility);
      if (task.pendingRef) {
        const ref = task.pendingRef;
        task.pendingRef = null;
        this.startRun(task, 0, ref, null);
      }
      return;
    }
    if (task.responsibility !== 'preview_logo') {
      task.status = 'DONE';
      task.waitLabel = '';
      this.journal(`${task.id} done: ${task.title}.`);
      this.trace({ kind: 'task', actor: 'relay', taskId: task.id, text: `${task.id} done: ${task.title}.` });
      if (task.responsibility === 'launch')
        for (const t of s.tasks)
          if (t.run && t.status === 'WAITING_EVENT' && t.run.procedure[t.stepIdx]?.kind === 'wait_launch') {
            t.status = 'READY';
            t.waitLabel = '';
          }
      return;
    }
    task.lastCompletedRev = run.logoRev;
    this.journal(`${task.id} run #${run.n} done: ${s.goal === 'live' ? 'live page' : 'preview'} verified with logo revision ${run.logoRev}.`);
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

  // -------------------------------------------------------------------------
  // Data-driven jobs

  private waitsFor(kind: string): boolean {
    return this.state.tasks.some((t) => t.run?.procedure.some((p) => p.op?.type === 'waitEvent' && p.op.event === kind));
  }

  private wakeEventWaiters(kind: string) {
    for (const t of this.state.tasks) {
      const st = t.run?.procedure[t.stepIdx];
      if (t.run && t.status === 'WAITING_EVENT' && st?.op?.type === 'waitEvent' && st.op.event === kind) {
        t.status = 'READY';
        t.waitLabel = '';
        this.enqueue({ t: this.state.time, phase: PHASE.runtime, kind: 'dispatch' });
      }
    }
  }

  private wakeJobWaiters(job: string) {
    for (const t of this.state.tasks) {
      const st = t.run?.procedure[t.stepIdx];
      if (t.run && t.status === 'WAITING_EVENT' && st?.op?.type === 'waitJob' && st.op.job === job) {
        t.status = 'READY';
        t.waitLabel = '';
        this.enqueue({ t: this.state.time, phase: PHASE.runtime, kind: 'dispatch' });
      }
    }
  }

  /** Tiles a decision can draw on: what the run has read, plus declared extras (e.g. installed skills). */
  private decisionTiles(read: TileDef[], extra?: string[]): TileDef[] {
    if (!extra?.length) return read;
    const all = Object.values(this.fixture.sources ?? {}).flat();
    const add = extra.map((id) => all.find((t) => t.id === id)).filter((t): t is TileDef => !!t);
    return [...read, ...add.filter((t) => !read.some((r) => r.id === t.id))];
  }

  /** A new trigger for a data-driven job, handled by the build's policy for that job. */
  private receiveGeneric(task: Task, ref: string, cause: number) {
    const s = this.state;
    const policy = s.build.policies?.[task.responsibility]?.onNew ?? 'once';
    const busy = !!task.run;
    if (policy === 'once') {
      if (busy || task.runs.length) return;
      this.startRun(task, 0, ref, cause);
    } else if (policy === 'ignore') {
      if (busy || task.runs.length) {
        this.trace({ kind: 'task', actor: 'relay', taskId: task.id, text: `${task.id} ignores the update (policy: keep what was prepared).`, cause });
        return;
      }
      this.startRun(task, 0, ref, cause);
    } else if (policy === 'quiet') {
      const q = s.build.policies?.[task.responsibility]?.quietMs ?? 2 * MIN;
      task.quietToken = ++s.tokenSeq;
      this.enqueue({ t: s.time + q, phase: PHASE.runtime, kind: 'quiet', taskId: task.id, token: task.quietToken, msgId: ref, cause });
      this.trace({ kind: 'task', actor: 'relay', taskId: task.id, text: `${task.id}: update noted — waiting for ${Math.round(q / MIN)} quiet minute${q === MIN ? '' : 's'} before acting.`, cause });
      task.status = busy ? task.status : 'WAITING_EVENT';
      if (!busy) task.waitLabel = 'Waiting for things to settle';
      return;
    } else if (policy === 'queue') {
      if (busy) {
        task.pendingRef = ref;
        this.trace({ kind: 'task', actor: 'relay', taskId: task.id, text: `${task.id}: update queued — it will redo the work after the current run.`, cause });
        return;
      }
      this.startRun(task, 0, ref, cause);
    } else if (policy === 'restart') {
      if (busy) {
        task.run!.notes.cancelled = true;
        task.runs.push({ ...task.run!, finishedAt: s.time });
        task.run = null;
        this.trace({ kind: 'task', actor: 'relay', taskId: task.id, text: `${task.id}: update arrived — cancelling the current run and starting over (anything already in flight is wasted).`, cause });
      }
      this.startRun(task, 0, ref, cause);
    }
    this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
  }

  private onQuiet(taskId: string, token: number, ref: string, cause: number | null) {
    const task = this.state.tasks.find((t) => t.id === taskId);
    if (!task || task.quietToken !== token) return; // a newer update reset the timer
    if (task.run) {
      task.pendingRef = ref;
      return;
    }
    this.trace({ kind: 'task', actor: 'relay', taskId, text: `${taskId}: quiet for long enough — acting on the latest update.`, cause });
    this.startRun(task, 0, ref, cause);
    this.enqueue({ t: this.state.time, phase: PHASE.runtime, kind: 'dispatch' });
  }

  private cancelJob(job: string, by: Task) {
    const t = this.state.tasks.find((x) => x.responsibility === job);
    if (!t || t.status === 'DONE' || t.status === 'CANCELLED') {
      this.trace({ kind: 'task', actor: 'relay', taskId: by.id, text: t?.status === 'DONE' ? `Too late to cancel “${t.title}” — it has already happened.` : 'Nothing to cancel.' });
      return;
    }
    if (t.run) {
      t.run.notes.cancelled = true;
      t.runs.push({ ...t.run, finishedAt: this.state.time });
      t.run = null;
    }
    t.status = 'CANCELLED';
    t.waitLabel = `Cancelled by ${by.id}`;
    this.trace({ kind: 'task', actor: 'relay', taskId: by.id, text: `Cancelled “${t.title}” before it went out.` });
  }

  /** Mid-shift opportunity: the precommitted admission policy decides — no player needed. */
  private admit(job: JobDef, ref: string, cause: number) {
    const s = this.state;
    const policy = s.build.admission ?? 'decline';
    const owner = s.build.workers.findIndex((w) => w?.responsibilities.includes(job.id));
    const proc = s.build.workers[Math.max(0, owner)]?.procedures?.[job.id] ?? [];
    const cost = proc.reduce((n, st) => n + stepCredits(st), 0);
    const work = proc.reduce((n, st) => n + stepDuration(st, s.cores), 0);
    // Conservative estimate from declared costs: reserve what accepted work still needs.
    const reserved = s.tasks.reduce((n, t) => {
      const p = t.run?.procedure ?? (t.status === 'WAITING_EVENT' && !t.runs.length ? (s.build.workers[t.owner]?.procedures?.[t.responsibility] ?? []) : []);
      return n + p.slice(t.run ? t.stepIdx : 0).reduce((m, st) => m + stepCredits(st), 0);
    }, 0);
    const free = s.credits.budget - s.credits.spent - reserved;
    const ownerIdx = Math.max(0, owner);
    const queued = s.tasks
      .filter((t) => t.owner === ownerIdx && t.run)
      .reduce((n, t) => n + t.run!.procedure.slice(t.stepIdx).reduce((m, st) => m + (st.op?.type === 'waitEvent' || st.op?.type === 'waitJob' ? 0 : stepDuration(st, s.cores)), 0), 0);
    const finish = s.time + queued + work;
    const fits = cost <= free && (job.deadline == null || finish <= job.deadline);
    const accept = policy === 'always' || (policy === 'fits' && fits);
    const why = `cost ${cost} credits vs ${free} free after reserving ${reserved}; estimated finish ${fmtTime(finish)}${job.deadline ? ` vs due ${fmtTime(job.deadline)}` : ''}`;
    this.trace({
      kind: 'task',
      actor: 'relay',
      text: accept
        ? `Admission (${policy === 'always' ? 'always accept' : 'accept if it fits'}): accepted “${job.title}” — ${why}.`
        : `Admission (${policy === 'decline' ? 'decline new work' : 'accept if it fits'}): declined “${job.title}”${policy === 'fits' ? ` — ${why}` : ''}.`,
      cause,
    });
    if (!accept) return;
    const task: Task = {
      id: `T${s.tasks.length + 1}`,
      title: job.title,
      responsibility: job.id,
      owner: ownerIdx,
      revision: 1,
      status: 'WAITING_EVENT',
      waitLabel: '',
      stepIdx: 0,
      run: null,
      pendingLogoRev: null,
      lastCompletedRev: null,
      runs: [],
    };
    s.tasks.push(task);
    this.startRun(task, 0, ref, cause);
    this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
  }

  /** Fair CPU sharing: when the set of running local jobs changes, every job's finish time moves. */
  private reflowCpu() {
    const s = this.state;
    const jobs = s.workers.filter((w) => w.active?.cpu && (w.active.cpuWork ?? 0) > 0);
    const rate = jobs.length ? Math.min(1, s.cores / jobs.length) : 1;
    for (const w of jobs) {
      const a = w.active!;
      a.cpuWork = Math.max(0, a.cpuWork! - (s.time - a.lastAt!) * a.rate!);
      a.lastAt = s.time;
      a.rate = rate;
      const cpuEnd = s.time + Math.ceil(a.cpuWork / rate);
      a.end = cpuEnd + (a.ioMs ?? 0);
      a.token = ++s.tokenSeq;
      this.enqueue({ t: cpuEnd, phase: PHASE.reply, kind: 'step_done', worker: w.idx, token: a.token });
    }
  }

  /** Failure Lab: memory overcommitted — the system kills the oldest running local job. */
  private get lab(): LabFlags {
    return { ...this.fixture.lab, ...this.state.build.lab };
  }

  private outOfMemory(newcomer: number) {
    const s = this.state;
    const victims = s.workers.filter((w) => w.active && w.idx !== newcomer && w.active.ramGB >= 0.5).sort((a, b) => a.active!.start - b.active!.start);
    const v = victims[0] ?? s.workers.find((w) => w.idx === newcomer)!;
    const a = v.active!;
    const task = s.tasks.find((t) => t.id === a.taskId)!;
    v.active = null;
    s.ram.usedGB = round1(Math.max(0, s.ram.usedGB - a.ramGB));
    task.status = 'FAILED';
    task.waitLabel = 'Killed: out of memory';
    if (task.run) task.runs.push({ ...task.run, finishedAt: s.time });
    task.run = null;
    this.trace({
      kind: 'task',
      actor: 'world',
      taskId: task.id,
      worker: v.idx,
      text: `No memory admission (lab): ${round1(s.ram.usedGB + a.ramGB)} GB needed on a ${s.ram.totalGB} GB machine — out of memory! The system killed “${stepLabel(a.step)}”; its work is lost.`,
    });
    this.reflowCpu();
    this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
  }

  /** A worker restart: running computations are lost. The journal decides whether promises survive. */
  private onRestart() {
    const s = this.state;
    const lost = s.workers.filter((w) => w.active);
    for (const w of lost) {
      const a = w.active!;
      w.active = null;
      s.ram.usedGB = round1(Math.max(0, s.ram.usedGB - a.ramGB));
      this.trace({ kind: 'task', actor: 'world', worker: w.idx, taskId: a.taskId, text: `Worker ${w.idx + 1} restarted: unfinished “${stepLabel(a.step)}” is lost (its credits were already spent).` });
    }
    if (this.lab.noJournal) {
      for (const t of s.tasks) {
        if (t.status === 'DONE') continue;
        t.status = 'CANCELLED';
        t.waitLabel = 'Forgotten — there was no journal to remember it';
        t.run = null;
      }
      for (const w of s.watchers) {
        w.armed = false;
        w.closedReason = 'Forgotten in the restart (no journal)';
      }
      this.trace({ kind: 'task', actor: 'world', text: 'No journal (lab): after the restart Relay has no record of its promises or watchers. It sits idle — nothing reminds it.' });
      return;
    }
    for (const t of s.tasks) if (t.run && t.status === 'RUNNING') t.status = 'READY';
    this.trace({ kind: 'task', actor: 'relay', text: 'Back from the restart: the journal still lists every promise, wait and step done — work resumes, redoing only the step that was interrupted.' });
    this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
  }

  private nextWindow(who: string): Ms | null {
    const p = this.fixture.people?.[who];
    if (!p) return null;
    const now = this.state.time;
    for (const [from, to] of p.windows) {
      if (now >= from && now <= to) return now;
      if (from > now) return from;
    }
    return null;
  }

  private onAnswer(taskId: string, ref: string, cause: number | null) {
    const s = this.state;
    const task = s.tasks.find((t) => t.id === taskId);
    if (!task?.run) return;
    const n = task.run.notes;
    if (ref.startsWith('approve:')) {
      const artifact = ref.slice(8);
      const v = n.wrote?.[artifact] ?? 0;
      (n.approvals ??= {})[artifact] = v;
      s.world.approvals.push({ version: v, at: s.time, requestedAt: n.approvalRequestedAt ?? s.time });
      this.trace({ kind: 'reaction', actor: 'world', taskId, text: `Maya approves ${artifact} v${v}: “Looks right — go ahead.”`, cause });
    } else {
      const tile = this.fixture.answers?.[ref];
      if (tile) (n.tiles ??= []).push({ ...tile, at: s.time });
      this.trace({ kind: 'reaction', actor: 'world', taskId, text: `${tile?.author ?? 'They'} replies: “${tile?.label ?? '…'}”`, cause });
    }
    task.status = 'READY';
    task.waitLabel = '';
    this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
  }

  /** Effects of a finished generic operation. Returns true if the run stopped (wait, failure). */
  private finishOp(task: Task, a: NonNullable<Sim['state']['workers'][number]['active']>, wIdx: number, cause: number): boolean {
    const s = this.state;
    const run = task.run!;
    const n = run.notes;
    const op = a.step.op!;
    const tr = (text: string, kind: TraceEntry['kind'] = 'step_done') => this.trace({ kind, actor: 'relay', taskId: task.id, worker: wIdx, text, cause });
    switch (op.type) {
      case 'read': {
        const tiles = (this.fixture.sources?.[op.source] ?? []).filter((t) => t.at <= s.time);
        const have = (n.tiles ??= []);
        for (const t of tiles) if (!have.some((h) => h.id === t.id)) have.push(t);
        tr(`${op.label}: ${tiles.length} item${tiles.length === 1 ? '' : 's'} read.`);
        break;
      }
      case 'readArtifact': {
        const art = s.world.artifacts[op.artifact];
        (n.readVersions ??= {})[op.artifact] = art?.version ?? 0;
        (n.readValues ??= {})[op.artifact] = { ...(art?.value ?? {}) };
        if (art?.value) {
          // What was read can go on a tray: a document, or a saved skill.
          const v = art.value;
          const tile: TileDef = {
            id: String(v.tileId ?? `art:${op.artifact}`),
            label: String(v.title ?? `${op.artifact} v${art.version}`),
            units: Number(v.units ?? 2),
            source: op.artifact,
            at: s.time,
            kind: v.kind === 'skill' ? 'skill' : 'doc',
            data: { ...v },
          };
          const tiles = (n.tiles ??= []);
          const i = tiles.findIndex((t) => t.id === tile.id);
          if (i >= 0) tiles[i] = tile;
          else tiles.push(tile);
        }
        tr(`${op.label}: version ${art?.version ?? 0}.`);
        break;
      }
      case 'decide': {
        const r = getRule(op.rule)(a.packet!, a.packet!.tiles.filter((t) => t.included));
        n.need = r.need;
        if (r.output) n.output = { ...(n.output ?? {}), ...r.output };
        this.trace({
          kind: 'decision',
          actor: 'relay',
          taskId: task.id,
          worker: wIdx,
          text: r.need ? `Decision: can’t settle it from the tray — needs ${r.need}.` : `Decision: ${r.explanation}`,
          detail: `Simulation explanation — rule “${op.rule}”: ${r.explanation}`,
          packet: a.packet,
          cause,
        });
        break;
      }
      case 'local':
        tr(`${op.label}: done.`);
        break;
      case 'write': {
        const art = (s.world.artifacts[op.artifact] ??= { value: null, version: 0, writer: null, at: null, history: [] });
        const expected = n.readVersions?.[op.artifact];
        if (op.expectVersion && expected != null && art.version !== expected && this.lab.noVersionCheck)
          tr(`No version check (lab): saving over version ${art.version} with work based on version ${expected} — the other change is silently lost.`, 'write');
        else if (op.expectVersion && expected != null && art.version !== expected) {
          n.conflict = true;
          tr(`Write rejected: ${op.artifact} is at version ${art.version}, this work was based on version ${expected}. Nothing was overwritten.`, 'write');
          break;
        }
        // A write builds on the version this run read (or the current one if it never read it).
        const value = { ...(n.readValues?.[op.artifact] ?? art.value ?? {}), ...(n.output ?? {}) };
        art.version++;
        art.value = value;
        art.writer = `Worker ${wIdx + 1}`;
        art.at = s.time;
        art.history.push({ version: art.version, at: s.time, writer: art.writer, value });
        (n.wrote ??= {})[op.artifact] = art.version;
        n.conflict = false;
        tr(`${op.label}: ${op.artifact} saved as version ${art.version}.`, 'write');
        break;
      }
      case 'send': {
        const art = s.world.artifacts[op.artifact];
        const value = art?.value ?? n.output ?? null;
        const to = op.to === '$out' ? String(n.output?.to ?? '') : op.to;
        const allowed = this.fixture.recipients;
        if (allowed && !allowed.includes(to)) {
          if (s.build.sendScope !== 'any') {
            s.blockedProposals++;
            this.trace({ kind: 'permission', actor: 'relay', taskId: task.id, worker: wIdx, text: `Permission gate blocks “${op.label}” to ${to}: not a recipient Maya approved. Nothing was sent.`, cause });
            break;
          }
          s.violations.push(`Sent “${op.artifact}” to ${to} — not a recipient Maya approved`);
          this.trace({ kind: 'write', actor: 'relay', taskId: task.id, worker: wIdx, text: `${op.label}: sent to ${to}. The send tool was allowed to email anyone, so nothing stopped it. A hard violation.`, cause });
        }
        if (value?.secret && this.fixture.publicChannels?.includes(to)) {
          s.violations.push(`Exposed a protected credential in ${to}`);
          this.trace({ kind: 'write', actor: 'relay', taskId: task.id, worker: wIdx, text: `${op.label}: the message to ${to} contains the API key — anyone in a public channel can now use it. A hard violation.`, cause });
        }
        s.world.sent.push({ artifact: op.artifact, to, at: s.time, value: value ? { ...value } : null });
        if (allowed && !allowed.includes(to)) break;
        if (this.fixture.flakySend === op.artifact && s.world.sent.filter((x) => x.artifact === op.artifact).length === 1) {
          n.unknownOutcome = true;
          tr(`${op.label}: the message went out — but no reply came back. Did it arrive?`, 'task');
        } else tr(`${op.label}: sent to ${to}.`, 'write');
        break;
      }
      case 'resend': {
        n.receipt = { version: 1, logoRev: 0, at: s.time };
        if (!n.unknownOutcome) break;
        if (this.lab.noDedupe) {
          const art = s.world.artifacts[op.artifact];
          s.world.sent.push({ artifact: op.artifact, to: op.to, at: s.time, value: art?.value ? { ...art.value } : null });
          tr(`No duplicate check (lab): sent the message again — ${op.to} now has ${s.world.sent.filter((x) => x.artifact === op.artifact).length} copies.`, 'write');
        } else {
          s.blockedProposals++;
          tr(`Runtime blocks a second send of the same message while the first is unresolved; a status check shows it was delivered.`, 'permission');
        }
        n.unknownOutcome = false;
        break;
      }
      case 'publish': {
        const target = String(n.output?.target ?? 'preview');
        if (target === 'live' && this.fixture.delegation.live !== 'approval') {
          if (!this.lab.noGate) {
            s.blockedProposals++;
            this.trace({ kind: 'permission', actor: 'relay', taskId: task.id, worker: wIdx, text: 'Permission gate blocks publishing to the live page: Maya didn’t allow it. Nothing changed.', cause });
            break;
          }
          s.world.live = { version: s.world.live.version + 1, changedBy: s.build.agentName, logoRev: 1, approvedVersion: null, at: s.time };
          s.violations.push('Changed the live page without permission');
          this.trace({ kind: 'write', actor: 'relay', taskId: task.id, worker: wIdx, text: 'No permission gate (lab): the live page was changed without permission. A hard violation.', cause });
          n.receipt = { version: 1, logoRev: 0, at: s.time };
          break;
        }
        const art = (s.world.artifacts.preview ??= { value: null, version: 0, writer: null, at: null, history: [] });
        art.version++;
        art.value = { logo: 'new logo' };
        art.writer = `Worker ${wIdx + 1}`;
        art.at = s.time;
        art.history.push({ version: art.version, at: s.time, writer: art.writer, value: art.value });
        n.receipt = { version: art.version, logoRev: 0, at: s.time };
        tr(`${op.label}: the preview page now shows the logo.`, 'write');
        break;
      }
      case 'verify': {
        const art = s.world.artifacts[op.artifact];
        const sent = s.world.sent.some((x) => x.artifact === op.artifact && x.at >= run.startedAt);
        if ((art && n.wrote?.[op.artifact] === art.version) || sent) {
          n.receipt = { version: art?.version ?? 1, logoRev: 0, at: s.time };
          tr(`${op.label}: confirmed. Receipt stored.`, 'verify');
        } else tr(`${op.label}: the result isn’t there (or someone changed it since).`, 'verify');
        break;
      }
      case 'notify':
        s.world.notifications.push({ who: op.who, at: s.time, text: op.text });
        n.receipt = { version: 1, logoRev: 0, at: s.time }; // delivery confirmed
        tr(`${op.label}.`);
        break;
      case 'ask':
      case 'approve': {
        const when = this.nextWindow(op.who);
        const p = this.fixture.people?.[op.who];
        s.world.questions.push({ who: op.who, at: s.time });
        if (op.type === 'approve') n.approvalRequestedAt = s.time;
        task.stepIdx++;
        task.status = 'WAITING_PERSON';
        if (when == null || !p) {
          task.waitLabel = `Waiting for ${op.who} — not reachable again before the deadline`;
          tr(`${op.label}: ${op.who} isn’t reachable again. The question waits.`);
        } else {
          const at = when + p.replyAfter;
          task.waitLabel = `Waiting for ${op.who}’s ${op.type === 'approve' ? 'OK' : 'answer'}${when > s.time ? ` (back ${fmtTime(when)})` : ''}`;
          tr(`${op.label}${when > s.time ? ` — ${op.who} is away until ${fmtTime(when)}; the question waits durably` : ''}. The worker is free meanwhile.`);
          this.enqueue({ t: at, phase: PHASE.reply, kind: 'answer', taskId: task.id, ref: op.type === 'approve' ? `approve:${op.artifact}` : op.answer, cause });
        }
        this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
        return true;
      }
      default:
        break;
    }
    return false;
  }

  feedbackLoad(): { complete: number; incomplete: number } {
    return this.fixture.feedback ?? { complete: 9, incomplete: 3 };
  }

  /** The external service commits the publish even though its reply will be lost. */
  private onCommit(taskId: string, cause: number | null) {
    const s = this.state;
    const n = s.tasks.find((t) => t.id === taskId)?.run?.notes;
    if (!n?.written || !n.approval) return;
    s.world.live = { version: s.world.live.version + 1, changedBy: s.build.agentName, logoRev: n.written.logoRev, approvedVersion: n.approval.version, at: s.time };
    this.trace({
      kind: 'write',
      actor: 'world',
      taskId,
      text: `Live page published: draft v${n.written.version} (key op-${taskId}-publish). The service’s reply is lost on the way back.`,
      detail: `${s.build.agentName} has not observed this: it is still waiting for a reply.`,
      observerOnly: true,
      cause,
    });
  }

  private launchDone(): boolean {
    return this.state.tasks.some((t) => t.responsibility === 'launch' && t.status === 'DONE');
  }

  private onApproval(taskId: string, cause: number | null) {
    const s = this.state;
    const task = s.tasks.find((t) => t.id === taskId);
    if (!task?.run) return;
    const n = task.run.notes;
    const v = n.written?.version ?? 0;
    n.approval = { version: v, at: s.time };
    s.world.approvals.push({ version: v, at: s.time, requestedAt: n.approvalRequestedAt ?? s.time });
    this.trace({ kind: 'reaction', actor: 'world', taskId, text: `Maya approves draft v${v}: “Looks right — go ahead.”`, cause });
    this.journal(`Approval recorded: Maya approved draft v${v}.`);
    task.status = 'READY';
    task.waitLabel = '';
    this.enqueue({ t: s.time, phase: PHASE.runtime, kind: 'dispatch' });
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
          this.trace({ kind: 'watcher', actor: 'relay', text: 'Watcher re-armed with “Keep watching”. It checks the inbox once on activation.', cause: id });
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
