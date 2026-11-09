// Missions: short, replayable lessons built on the same simulation. Each teaches one concept,
// asks the player to predict an outcome before running, and awards medals for real tradeoffs
// (getting the job done, spending less, finishing sooner, needing no help).
import { MIN, at, fmtTime, type Build, type Fixture, type MachineId, type Ms, type Responsibility, type SimState, type StepDef, type WorkerCfg } from '../sim/types';
import type { OpeningOutcome } from '../sim/evaluate';
import { OPENING } from './opening';

export const TAGLINE = 'Light up launch night.';

export type ConceptId = 'loop' | 'watchers' | 'context' | 'permissions' | 'memory' | 'parallel';

export interface Concept {
  id: ConceptId;
  icon: string;
  title: string;
  short: string;
  points: string[];
}

export const CONCEPTS: Concept[] = [
  {
    id: 'loop',
    icon: '🔁',
    title: 'The agent loop',
    short: 'An agent isn’t an AI that thinks all the time.',
    points: [
      'A watcher waits for something to happen — no AI runs while it waits.',
      'Then the agent reads, lets the AI model decide, acts, and checks the result.',
      'A bigger AI model isn’t automatically better: it costs more and takes longer.',
    ],
  },
  {
    id: 'watchers',
    icon: '📡',
    title: 'Watchers keep promises',
    short: '“Check once” finishes a job. “Keep watching” keeps it current.',
    points: [
      'Once a watcher switches off, new events reach the world but never reach the agent.',
      'The agent can’t react to something it was never told about — however smart its model.',
      'Ongoing responsibilities need ongoing observation.',
    ],
  },
  {
    id: 'context',
    icon: '🧺',
    title: 'The AI only sees its tray',
    short: 'A file on the shelf is not in the AI’s head.',
    points: [
      'Each AI call gets a limited tray (its context). Only what is read AND fits goes in.',
      'Missing facts aren’t invented — the work comes out incomplete instead.',
      'A short summary can beat a bigger, pricier model.',
    ],
  },
  {
    id: 'permissions',
    icon: '🔐',
    title: 'Permissions & approvals',
    short: 'The AI can propose anything; the gate decides what goes out.',
    points: [
      'Every outside action passes a permission gate that the AI can’t talk its way past.',
      'A blocked attempt isn’t a disaster — nothing is sent. It just doesn’t get the job done.',
      'An approval covers one exact version. Asking a person is legitimate: it only costs waiting time while they’re around.',
    ],
  },
  {
    id: 'parallel',
    icon: '🧑‍🤝‍🧑',
    title: 'Sharing the work',
    short: 'Two workers run jobs side by side — but cost rent.',
    points: [
      'Independent jobs can run at the same time on separate workers; one worker does them in turn.',
      'While a job waits for a person, its worker is free for other work.',
      'Routing clear cases to a small model and hard ones to a big model can be what makes a plan affordable.',
    ],
  },
  { id: 'memory', icon: '🗂️', title: 'Memory', short: 'Coming later.', points: [] },
];

export interface Medal {
  id: string;
  icon: string;
  label: string;
  hint: string;
  /** Numeric target, so the UI can compare an estimate or a result against it. */
  goal?: { credits?: number; by?: Ms };
  test(o: OpeningOutcome, s: SimState): boolean;
  /** What the player achieved vs. what the medal needed, in plain words. */
  measure(o: OpeningOutcome, s: SimState): { you: string; goal: string };
}

const jobState = (o: OpeningOutcome) =>
  o.promiseKept ? 'done' : o.previewRev && !o.taglineOk ? 'tagline missing' : o.previewRev && o.previewRev < o.latestSent ? 'old logo on the page' : o.previewRev ? 'not finished' : 'no logo on the page';

const doneMedal = (label: string, hint: string): Medal => ({
  id: 'done',
  icon: '🏁',
  label,
  hint,
  test: (o) => o.promiseKept,
  measure: (o) => ({ you: jobState(o), goal: 'job done' }),
});
const cheapMedal = (limit: number, hint: string): Medal => ({
  id: 'cheap',
  icon: '💰',
  label: `Spend ${limit} credits or less`,
  hint,
  goal: { credits: limit },
  test: (o) => o.promiseKept && o.creditsSpent <= limit,
  measure: (o) => ({ you: o.promiseKept ? `${o.creditsSpent} credits` : `job not done (${o.creditsSpent} credits)`, goal: `≤ ${limit} credits` }),
});
const fastMedal = (by: Ms, hint: string): Medal => ({
  id: 'fast',
  icon: '⚡',
  label: `Checked by ${fmtTime(by)}`,
  hint,
  goal: { by },
  test: (o) => o.promiseKept && (o.firstVerifiedAt ?? Infinity) <= by,
  measure: (o) => ({
    you: !o.promiseKept ? 'job not done' : o.firstVerifiedAt != null ? `checked at ${fmtTime(o.firstVerifiedAt)}` : 'never checked',
    goal: `by ${fmtTime(by)}`,
  }),
});
const autoMedal = (hint: string): Medal => ({
  id: 'auto',
  icon: '🤖',
  label: 'No help from you',
  hint,
  test: (o) => o.autonomous,
  measure: (o) => ({ you: o.interventions ? `you stepped in ${o.interventions}×` : o.promiseKept ? 'no help needed' : 'job not done', goal: 'job done, 0 help' }),
});

export interface Prediction {
  question: string;
  options: { id: string; label: string }[];
  /** The option that turned out to be true for this run. */
  answer(s: SimState, initialWake: 'once' | 'keep' | null): string;
  explain(s: SimState): string;
}

export interface Mission {
  id: string;
  n: number;
  title: string;
  goal: string;
  concept: ConceptId;
  fixture: Fixture;
  /** Extra guided build steps. */
  askWake: boolean;
  askGuide: boolean;
  askApproval?: boolean;
  /** Shift missions build from job/machine/sorting choices instead of a single procedure. */
  shift?: boolean;
  prediction: Prediction;
  medals: Medal[];
}

const baseMessages = OPENING.messages.filter((m) => m.id !== 'm-isha-r2');
const brief = (body: string) =>
  baseMessages.map((m) => (m.id === 'm-maya-brief' ? { ...m, body } : m));

const decideMinutes = (s: SimState) =>
  s.trace.filter((e) => e.kind === 'decision').length * (s.build.workers[0]?.procedure.find((x) => x.kind === 'decide')?.model === 'deliberate' ? 3 : 1);

const firstPacket = (s: SimState) => s.trace.find((e) => e.packet)?.packet ?? null;

export const MISSIONS: Mission[] = [
  {
    id: 'm1',
    n: 1,
    title: 'First job',
    goal: 'Put Isha’s logo on the preview',
    concept: 'loop',
    askWake: false,
    askGuide: false,
    fixture: {
      ...OPENING,
      id: 'm1-first-job',
      title: 'First job',
      end: at(18, 20),
      endOfferAfter: at(18, 3),
      messages: brief('When Isha sends the logo, put it on the preview page. You can edit the preview freely. Please leave the live page alone.'),
    },
    prediction: {
      question: 'Isha’s email is due around 18:02. Until it arrives, what is your agent’s AI model doing?',
      options: [
        { id: 'thinking', label: 'Thinking about the job the whole time' },
        { id: 'idle', label: 'Nothing — it’s off until the watcher wakes the agent' },
        { id: 'polling', label: 'Asking the inbox for news every second' },
      ],
      answer: () => 'idle',
      explain: (s) =>
        `The AI model ran for only ${decideMinutes(s)} minute${decideMinutes(s) === 1 ? '' : 's'} all evening. The watcher did the waiting; the AI was used only when there was something to decide.`,
    },
    medals: [
      doneMedal('Logo on the preview', 'Finish the build and run it.'),
      fastMedal(at(18, 9), 'A smaller AI model decides faster.'),
      cheapMedal(11, 'A smaller AI model costs less per decision.'),
    ],
  },
  {
    id: 'm2',
    n: 2,
    title: 'The correction',
    goal: 'Keep Isha’s latest logo on the preview',
    concept: 'watchers',
    askWake: true,
    askGuide: false,
    fixture: {
      ...OPENING,
      id: 'm2-correction',
      title: 'The correction',
      messages: OPENING.messages.map((m) =>
        m.id === 'm-maya-brief'
          ? { ...m, body: 'When Isha sends the logo, put it on the preview page. She sometimes sends fixes, so keep it up to date. Please leave the live page alone.' }
          : m,
      ),
    },
    prediction: {
      question: 'Isha might send a corrected logo later. With your setup, will your agent catch it on its own?',
      options: [
        { id: 'yes', label: 'Yes — it will notice and update the preview' },
        { id: 'no', label: 'No — it will miss the correction' },
      ],
      answer: (_s, wake) => (wake === 'keep' ? 'yes' : 'no'),
      explain: (s) =>
        s.watchers[0]?.delivered.includes('m-isha-r2') && s.interventions.length === 0
          ? 'Your watcher kept watching, so the correction was delivered the moment it arrived.'
          : 'A watcher set to “check once” switches off after the first email. The correction reached the inbox, but nobody told the agent.',
    },
    medals: [
      doneMedal('Latest logo on the preview', 'The preview must show Isha’s correction.'),
      autoMedal('Set the watcher before you run, so you never need to step in.'),
      cheapMedal(14, 'Two logos means two decisions — the small model is cheaper.'),
    ],
  },
  {
    id: 'm3',
    n: 3,
    title: 'What the AI sees',
    goal: 'Logo + brand tagline on the preview',
    concept: 'context',
    askWake: false,
    askGuide: true,
    fixture: {
      ...OPENING,
      id: 'm3-context',
      title: 'What the AI sees',
      end: at(18, 20),
      endOfferAfter: at(18, 3),
      needsTagline: true,
      shelfFiles: [
        { id: 'brand-guide', name: 'Brand guide.pdf', units: 5, kind: 'full', tagline: TAGLINE },
        { id: 'guide-summary', name: 'Brand guide summary.txt', units: 2, kind: 'summary', tagline: TAGLINE },
      ],
      messages: brief('When Isha sends the logo, put it on the preview page with our tagline — it’s in the brand guide on the shelf. Leave the live page alone.'),
    },
    prediction: {
      question: 'Will the AI model actually get to read the tagline?',
      options: [
        { id: 'yes', label: 'Yes — it will be on the AI’s tray' },
        { id: 'no', label: 'No — it won’t reach the AI' },
      ],
      answer: (s) => (firstPacket(s)?.tiles.some((t) => t.id === 'guide' && t.included) ? 'yes' : 'no'),
      explain: (s) => {
        const p = firstPacket(s);
        if (!p) return 'The AI never made a decision this run.';
        const g = p.tiles.find((t) => t.id === 'guide');
        if (!g) return 'No step read the brand guide, so it stayed on the shelf — existing on disk isn’t the same as being in the AI’s tray.';
        if (!g.included) return `The tray held ${p.capacity} units and already had ${p.used} in it. The ${g.units}-unit file didn’t fit, so the AI never saw the tagline.`;
        return `The ${g.units}-unit guide fit on the ${p.capacity}-unit tray (${p.used} used), so the AI could copy the tagline.`;
      },
    },
    medals: [
      doneMedal('Logo + tagline on the preview', 'The AI can’t use what doesn’t reach its tray.'),
      cheapMedal(11, 'The Quick model is cheaper — and the 2-unit summary fits its smaller tray.'),
      fastMedal(at(18, 9), 'The Quick model decides in 1 min instead of 3.'),
    ],
  },
];


// ---------------------------------------------------------------------------
// Mission 4 — Hands off (permissions & approvals)

/** Turn a preview procedure into a live-page procedure, with or without asking Maya first. */
export function setApproval(w: WorkerCfg, ask: boolean) {
  const drop = new Set(['verify_preview', 'request_approval', 'publish_live', 'verify_live']);
  w.procedure = w.procedure.filter((s) => !drop.has(s.kind));
  if (ask) w.procedure.push({ kind: 'request_approval' });
  w.procedure.push({ kind: 'publish_live' }, { kind: 'verify_live' });
}

const asksFirst = (s: SimState) => {
  const p = s.build.workers[0]?.procedure ?? [];
  const r = p.findIndex((x) => x.kind === 'request_approval');
  return r >= 0 && r < p.findIndex((x) => x.kind === 'publish_live');
};

const M4: Mission = {
  id: 'm4',
  n: 4,
  title: 'Hands off',
  goal: 'Put Isha’s logo on the LIVE page — with Maya’s OK',
  concept: 'permissions',
  askWake: false,
  askGuide: false,
  askApproval: true,
  fixture: {
    ...OPENING,
    id: 'm4-hands-off',
    title: 'Hands off',
    goal: 'live',
    end: at(18, 30),
    endOfferAfter: at(18, 3),
    delegation: { preview: 'edit', live: 'approval' },
    approver: { who: 'maya', until: at(18, 20), replyAfter: 2 * MIN },
    messages: brief('When Isha sends the logo, put it on the live page — but only after I’ve approved that exact version. I’m around until 18:20.'),
  },
  prediction: {
    question: 'When your agent reaches the “publish to the live page” step, what will happen?',
    options: [
      { id: 'live', label: 'It goes live' },
      { id: 'blocked', label: 'The permission gate blocks it — nothing is sent' },
    ],
    answer: (s) => (asksFirst(s) ? 'live' : 'blocked'),
    explain: (s) =>
      asksFirst(s)
        ? `Maya approved draft v${s.world.approvals[0]?.version ?? '?'} at ${s.world.approvals[0] ? fmtTime(s.world.approvals[0].at) : '—'}, so the gate let exactly that version through.`
        : 'Without Maya’s approval for that exact draft, the gate refused. No harm was done — nothing went out — but the live page never changed.',
  },
  medals: [
    doneMedal('Logo live, with Maya’s OK', 'Ask Maya before publishing — the gate needs her approval.'),
    fastMedal(at(18, 12), 'Maya replies in 2 minutes; a quick AI model gets the draft to her sooner.'),
    cheapMedal(13, 'The Quick model is enough for a clear instruction like this.'),
  ],
};

// ---------------------------------------------------------------------------
// Mission 5 — The evening shift (several jobs, one or two workers, routing, budget)

export type Sorting = 'careful' | 'routed';
export interface ShiftChoices {
  accepted: Responsibility[];
  machine: MachineId;
  sorting: Sorting;
}

const LAUNCH: StepDef[] = [
  { kind: 'read_logo' },
  { kind: 'decide', model: 'deliberate', purpose: 'logo' },
  { kind: 'render' },
  { kind: 'write_preview' },
  { kind: 'request_approval' },
  { kind: 'decide', model: 'swift', purpose: 'approval_check' },
  { kind: 'publish_live' },
  { kind: 'verify_live' },
];
const FEEDBACK: Record<Sorting, StepDef[]> = {
  careful: [
    { kind: 'read_feedback' },
    { kind: 'decide', model: 'deliberate', purpose: 'sort_all' },
    { kind: 'decide', model: 'deliberate', purpose: 'sort_all' },
    { kind: 'decide', model: 'deliberate', purpose: 'sort_all' },
    { kind: 'decide', model: 'deliberate', purpose: 'reduce' },
    { kind: 'save_board' },
  ],
  routed: [
    { kind: 'read_feedback' },
    { kind: 'decide', model: 'swift', purpose: 'sort_complete' },
    { kind: 'decide', model: 'swift', purpose: 'sort_complete' },
    { kind: 'decide', model: 'swift', purpose: 'sort_complete' },
    { kind: 'decide', model: 'deliberate', purpose: 'sort_incomplete' },
    { kind: 'decide', model: 'swift', purpose: 'reduce' },
    { kind: 'save_board' },
  ],
};
const PARTNER: StepDef[] = [
  { kind: 'read_draft' },
  { kind: 'decide', model: 'swift', purpose: 'partner_prepare' },
  { kind: 'format_message' },
  { kind: 'save_message' },
  { kind: 'wait_launch' },
  { kind: 'decide', model: 'swift', purpose: 'partner_check' },
  { kind: 'send_partner' },
  { kind: 'verify_sent' },
];

export function shiftBuild(base: Build, c: ShiftChoices): Build {
  const procedures = { launch: LAUNCH, feedback: FEEDBACK[c.sorting], partner: PARTNER };
  const worker = (responsibilities: Responsibility[]): WorkerCfg => ({
    card: 'worker',
    responsibilities,
    procedure: [],
    procedures: structuredClone(procedures),
    contextRule: 'focused',
    templateId: 'shift',
  });
  return {
    ...base,
    machine: c.machine,
    accepted: [...c.accepted],
    watchers: [{ card: 'inbox', wake: 'keep', deliverTo: 0 }],
    workers: c.machine === 'team' ? [worker(['launch']), worker(['feedback', 'partner'])] : [worker(['launch', 'partner', 'feedback'])],
  };
}

const allJobsOk = (o: OpeningOutcome) => o.jobs.length === 3 && o.jobs.every((j) => j.ok) && o.feedbackEarly;

const M5: Mission = {
  id: 'm5',
  n: 5,
  title: 'The evening shift',
  goal: 'Launch tonight — and take on what you can finish',
  concept: 'parallel',
  askWake: false,
  askGuide: false,
  shift: true,
  fixture: {
    ...OPENING,
    id: 'm5-evening-shift',
    title: 'The evening shift',
    goal: 'shift',
    start: at(18, 0),
    end: at(19, 30),
    endOfferAfter: at(18, 23),
    budget: 50,
    delegation: { preview: 'edit', live: 'approval' },
    approver: { who: 'maya', until: at(18, 40), replyAfter: 2 * MIN },
    deadlines: { launch: at(19, 0), partner: at(19, 20), feedback: at(19, 30), feedback_early: at(18, 40) },
    availability: {
      maya: { label: 'Maya reviews drafts until 18:40', until: at(18, 40) },
      isha: { label: 'Isha online until 18:45', until: at(18, 45) },
    },
    messages: [
      {
        id: 'm-maya-brief',
        from: 'maya',
        at: at(17, 58),
        preexisting: true,
        subject: 'Tonight',
        body: 'Please launch the approved page tonight. Nora would also like a partner message, and I’d love a summary of the feedback before I leave. I can review drafts until 18:40. Take on what you can finish.',
      },
      {
        id: 'm-isha-final',
        from: 'isha',
        at: at(18, 8),
        subject: 'Final launch artwork',
        body: 'Final artwork for the launch page.',
        attachment: { id: 'att-launch', name: 'launch-artwork.png', logoRev: 1 },
      },
      { id: 'm-leo-feedback', from: 'leo', at: at(18, 12), subject: 'Feedback bundle (12 items)', body: '12 beta-feedback threads. 9 are complete; 3 still need follow-up.', kind: 'feedback' },
      { id: 'm-nora-confirm', from: 'nora', at: at(18, 22), subject: 'Partner announcement — confirmed', body: 'We’re good to go with the announcement once your page is live.', kind: 'confirm' },
    ],
  },
  prediction: {
    question: 'Will every job you accepted be finished in time — and within the 50-credit budget?',
    options: [
      { id: 'yes', label: 'Yes — everything I took on gets done' },
      { id: 'no', label: 'No — something will be late or run out of credits' },
    ],
    answer: (s) => {
      const accepted = s.tasks.map((t) => t.responsibility);
      const ok = s.tasks.every((t) => t.status === 'DONE');
      const fb = s.tasks.find((t) => t.responsibility === 'feedback');
      const early = !fb || (fb.runs[0]?.notes.receipt?.at ?? Infinity) <= at(18, 40);
      return ok && early && accepted.length > 0 ? 'yes' : 'no';
    },
    explain: (s) => {
      const stuck = s.tasks.find((t) => t.status === 'WAITING_BUDGET');
      if (stuck) return `“${stuck.title}” stopped: the next step would have taken spending past ${s.credits.budget} credits. The budget is a hard limit — no overdraft.`;
      const fb = s.tasks.find((t) => t.responsibility === 'feedback');
      const fbAt = fb?.runs[0]?.notes.receipt?.at;
      if (fb && fbAt && fbAt > at(18, 40)) return `The feedback board was ready at ${fmtTime(fbAt)} — after Maya left at 18:40.`;
      const workers = s.workers.length;
      return workers > 1
        ? 'Two workers ran the launch and the other jobs side by side, and the approval wait didn’t hold anyone up.'
        : 'One worker did everything in turn; while the launch waited for Maya’s OK, the worker picked up other jobs.';
    },
  },
  medals: [
    {
      id: 'done',
      icon: '🏁',
      label: 'Launch page live, with Maya’s OK',
      hint: 'The launch is the one job you must finish.',
      test: (o) => o.promiseKept,
      measure: (o) => ({ you: o.promiseKept ? 'live' : (o.jobs.find((j) => j.id === 'launch')?.status ?? 'not live'), goal: 'live by 19:00' }),
    },
    {
      id: 'all',
      icon: '⭐',
      label: 'All three jobs done (board before 18:40)',
      hint: 'Take on every job, keep within budget, and get the board to Maya before she leaves.',
      test: (o) => o.promiseKept && allJobsOk(o),
      measure: (o) => {
        const missing = o.jobs.filter((j) => !j.ok).map((j) => `${j.id}: ${j.status}`);
        if (!missing.length && !o.feedbackEarly) return { you: 'board after 18:40', goal: 'all done, board ≤ 18:40' };
        return { you: missing.length ? missing.join(' · ') : 'all done', goal: 'all done, board ≤ 18:40' };
      },
    },
    {
      id: 'wrap',
      icon: '⏱️',
      label: 'Everything you took on done by 18:30',
      hint: 'One worker does jobs in turn; a second worker runs them side by side.',
      goal: { by: at(18, 30) },
      test: (o) => o.promiseKept && o.jobs.every((j) => !j.accepted || (j.doneAt != null && j.doneAt <= at(18, 30))),
      measure: (o) => {
        const accepted = o.jobs.filter((j) => j.accepted);
        if (accepted.some((j) => j.doneAt == null)) return { you: 'not everything finished', goal: 'all by 18:30' };
        const last = Math.max(...accepted.map((j) => j.doneAt!));
        return { you: `last job done ${fmtTime(last)}`, goal: 'all by 18:30' };
      },
    },
  ],
};

MISSIONS.push(M4, M5);

export const COMING_SOON = [{ n: 6, title: 'Plans changed', concept: 'memory' as ConceptId }];
