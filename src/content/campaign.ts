// Missions 9–23: the rest of the campaign (spec §10, shifts 2–6), built from data-driven jobs.
// Each shift has an intro mission (one concept), the shift itself, and a challenge variant.
import { MIN, at, fmtTime, type Build, type Fixture, type MachineId, type Ms, type SimState, type StepDef, type TileDef, type WorkerCfg } from '../sim/types';
import { registerRule, type RuleOutput } from '../sim/genericRules';
import { CONCEPTS, MISSIONS, cheapMedal, type Choice, type Medal, type Mission } from './missions';
import { OPENING } from './opening';

// ---------------------------------------------------------------------------
// Small helpers for writing jobs as data

type Model = 'swift' | 'deliberate';
export const op = {
  read: (source: string, label: string, minutes?: number): StepDef => ({ kind: 'op', op: { type: 'read', source, label, minutes } }),
  readArt: (artifact: string, label: string): StepDef => ({ kind: 'op', op: { type: 'readArtifact', artifact, label } }),
  decide: (rule: string, label: string, goal: string, model: Model, select?: string, extra?: string[]): StepDef => ({
    kind: 'op',
    model,
    op: { type: 'decide', rule, label, goal, select, extra },
  }),
  local: (label: string, cpuMinutes: number, ramGB: number, credits: number, ioMinutes?: number): StepDef => ({
    kind: 'op',
    op: { type: 'local', label, cpuMinutes, ramGB, credits, ioMinutes },
  }),
  write: (artifact: string, label: string, credits = 1, minutes = 1, expectVersion = false): StepDef => ({
    kind: 'op',
    op: { type: 'write', artifact, label, credits, minutes, expectVersion },
  }),
  send: (artifact: string, to: string, label: string, credits = 1, requireApproval = false): StepDef => ({
    kind: 'op',
    op: { type: 'send', artifact, to, label, credits, requireApproval },
  }),
  verify: (artifact: string, label: string): StepDef => ({ kind: 'op', op: { type: 'verify', artifact, label } }),
  ask: (who: string, answer: string, label: string): StepDef => ({ kind: 'op', op: { type: 'ask', who, answer, label } }),
  approve: (who: string, artifact: string, label: string): StepDef => ({ kind: 'op', op: { type: 'approve', who, artifact, label } }),
  waitJob: (job: string, label: string): StepDef => ({ kind: 'op', op: { type: 'waitJob', job, label } }),
  waitEvent: (event: string, label: string): StepDef => ({ kind: 'op', op: { type: 'waitEvent', event, label } }),
  cancel: (job: string, label: string): StepDef => ({ kind: 'op', op: { type: 'cancel', job, label } }),
  notify: (who: string, text: string, label: string): StepDef => ({ kind: 'op', op: { type: 'notify', who, text, label } }),
};
export const when = (w: 'need' | 'ok' | 'conflict', st: StepDef): StepDef => ({ ...st, when: w });

const worker = (jobs: string[], procedures: Record<string, StepDef[]>): WorkerCfg => ({
  card: 'worker',
  responsibilities: jobs,
  procedure: [],
  procedures: structuredClone(procedures),
  contextRule: 'focused',
  templateId: 'jobs',
});

export function jobsBuild(
  base: Build,
  machine: MachineId,
  perWorker: string[][],
  procedures: Record<string, StepDef[]>,
  extra: Partial<Pick<Build, 'policies' | 'accepted' | 'admission' | 'sendScope'>> = {},
): Build {
  return {
    ...base,
    machine,
    watchers: [{ card: 'inbox', wake: 'keep', deliverTo: 0 }],
    workers: perWorker.map((jobs) => worker(jobs, procedures)),
    ...extra,
  };
}

export function fixture(f: Partial<Fixture> & Pick<Fixture, 'id' | 'title' | 'jobs' | 'messages'>): Fixture {
  return {
    ...OPENING,
    goal: 'jobs',
    start: at(18, 0),
    end: at(19, 0),
    endOfferAfter: at(18, 1),
    budget: 40,
    delegation: { preview: 'edit', live: 'approval' },
    shelfFiles: [],
    ...f,
  };
}

export const briefMsg = (body: string, extra: Partial<Fixture['messages'][number]> = {}) => ({
  id: 'm-maya-brief',
  from: 'maya' as const,
  at: at(17, 58),
  preexisting: true,
  subject: 'Tonight',
  body,
  ...extra,
});

const lastSent = (s: SimState, artifact: string) => [...s.world.sent].reverse().find((x) => x.artifact === artifact);
export const sentAll = (s: SimState, artifact: string) => s.world.sent.filter((x) => x.artifact === artifact);

/** Medal: the required work done right (and no hard violations, within budget). */
export const coreMedal = (label: string, hint: string): Medal => ({
  id: 'done',
  icon: '🏁',
  label,
  hint,
  test: (o) => o.promiseKept,
  measure: (o) => {
    const bad = o.jobs.filter((j) => !j.ok && j.accepted);
    return { you: o.promiseKept ? 'done' : bad.map((j) => j.status).join(' · ') || 'not done', goal: 'required jobs done right' };
  },
});

/** Medal: every job that was taken on done right — and all optional ones taken on. */
export const allJobsMedal = (label: string, hint: string): Medal => ({
  id: 'all',
  icon: '⭐',
  label,
  hint,
  test: (o) => o.promiseKept && o.jobs.every((j) => j.ok),
  measure: (o) => {
    const bad = o.jobs.filter((j) => !j.ok);
    return { you: bad.length ? bad.map((j) => `${j.id}: ${j.status}`).join(' · ') : 'all done', goal: 'every job done right' };
  },
});

export const byMedal = (by: Ms, label: string, hint: string): Medal => ({
  id: 'fast',
  icon: '⚡',
  label,
  hint,
  goal: { by },
  test: (o) => o.promiseKept && (o.firstVerifiedAt ?? Infinity) <= by,
  measure: (o) => ({ you: o.firstVerifiedAt != null ? `done ${fmtTime(o.firstVerifiedAt)}` : 'not done', goal: `by ${fmtTime(by)}` }),
});

export const choice = (id: string, title: string, prompt: string, options: Choice['options'], showIf?: Choice['showIf']): Choice => ({ id, title, prompt, options, showIf });

export const MODEL_CHOICE = choice('model', 'AI model', 'Which AI model makes the decisions?', [
  { id: 'swift', label: '⚡ Quick', desc: 'Small, fast model. Tray holds 10 units.', cost: '1 min · 1 credit per decision' },
  { id: 'deliberate', label: '🔍 Thorough', desc: 'Bigger model. Tray holds 16 units; can weigh conflicting notes.', cost: '3 min · 4 credits per decision' },
]);

// ===========================================================================
// SHIFT 2 — Plans changed (memory, provenance, supersession, retrieval)

CONCEPTS.splice(
  CONCEPTS.findIndex((c) => c.id === 'memory'),
  1,
  {
    id: 'memory',
    icon: '🗂️',
    title: 'Memory needs sources',
    short: 'The newest note isn’t always the right one.',
    points: [
      'Remembered facts keep their author, time and authority — that’s how you tell a decision from a rumour.',
      'A correction should replace (supersede) the old fact, not just sit beside it.',
      'If facts change after you prepared something, the prepared work is stale. Anything already sent can’t be unsent.',
    ],
  },
);

const NOTES: TileDef[] = [
  { id: 'n-price', label: 'Price: $12 / month', units: 2, source: 'notes', at: at(9, 0), subject: 'price', author: 'Maya', authority: 'authoritative', kind: 'note', data: { price: '$12' } },
  { id: 'n-tue', label: 'Launch day: Tuesday', units: 2, source: 'notes', at: at(10, 0), subject: 'date', author: 'Maya', authority: 'authoritative', kind: 'note', data: { date: 'Tuesday' } },
  { id: 'n-lunch', label: 'Team lunch on Friday', units: 2, source: 'notes', at: at(11, 0), subject: 'lunch', author: 'Leo', authority: 'speculative', kind: 'note' },
  { id: 'n-wifi', label: 'Office wifi password changed', units: 2, source: 'notes', at: at(12, 0), subject: 'wifi', author: 'Leo', kind: 'note' },
  { id: 'n-wed', label: 'Moved the launch to Wednesday', units: 2, source: 'notes', at: at(16, 0), subject: 'date', author: 'Maya', authority: 'authoritative', supersedes: 'n-tue', kind: 'note', data: { date: 'Wednesday' } },
  { id: 'n-thu', label: 'I heard it might slip to Thursday?', units: 2, source: 'notes', at: at(17, 30), subject: 'date', author: 'Leo', authority: 'speculative', kind: 'note', data: { date: 'Thursday' } },
];

/** Resolve the launch date from the tray. Answers from a person win; otherwise one date, or ask. */
function resolveDate(p: { model: string }, tiles: { id: string; data?: Record<string, unknown> }[]): { date?: string; need?: string; why: string } {
  const dated = tiles.filter((t) => t.data?.date);
  const answer = dated.filter((t) => t.data?.kind === 'answer').sort((a, b) => Number(b.data!.at) - Number(a.data!.at))[0];
  if (answer) return { date: String(answer.data!.date), why: `Maya answered directly: ${answer.data!.date}.` };
  const dates = [...new Set(dated.map((t) => String(t.data!.date)))];
  if (!dates.length) return { need: 'the launch date', why: 'No note about the launch date is on the tray.' };
  if (dates.length === 1) return { date: dates[0], why: `The tray has one launch date: ${dates[0]}.` };
  if (p.model === 'deliberate') {
    const superseded = new Set(dated.map((t) => t.data!.supersedes).filter(Boolean));
    const best = dated
      .filter((t) => t.data!.authority === 'authoritative' && !superseded.has(t.id))
      .sort((a, b) => Number(b.data!.at) - Number(a.data!.at))[0];
    if (best) return { date: String(best.data!.date), why: `Notes disagree (${dates.join(', ')}). The newest authoritative note that nothing supersedes says ${best.data!.date}; the rest are older or speculative.` };
  }
  return { need: 'which launch date is current', why: `Notes disagree (${dates.join(', ')}). The small model can’t weigh authority, so it asks instead of guessing.` };
}

registerRule('launch_date', (p, tiles) => {
  const r = resolveDate(p, tiles);
  return r.date ? { output: { date: r.date }, explanation: `${r.why} Tell Nora: ${r.date}.` } : { need: r.need, explanation: r.why };
});

registerRule('facts_sheet', (p, tiles) => {
  const r = resolveDate(p, tiles);
  const price = tiles.find((t) => t.data?.price)?.data?.price;
  if (!r.date) return { need: r.need, explanation: r.why };
  return {
    output: { date: r.date, price: (price as string) ?? null, title: `Facts sheet: launch ${r.date}${price ? `, ${price}` : ''}`, units: 2, kind: 'doc' },
    explanation: `${r.why}${price ? ` Price ${price}.` : ''}`,
  };
});

registerRule('from_sheet', (_p, tiles) => {
  const sheet = tiles.find((t) => t.data?.kind === 'doc' && t.data?.date);
  if (!sheet) return { need: 'the facts sheet', explanation: 'No facts sheet on the tray.' };
  return { output: { date: String(sheet.data!.date), price: (sheet.data!.price as string) ?? null }, explanation: `Copy the facts sheet: launch ${sheet.data!.date}.` };
});

const askMaya = (rule: string, goal: string, model: Model, select: string): StepDef[] => [
  when('need', op.ask('Maya', 'date', 'Ask Maya which date is current')),
  when('need', op.decide(rule, 'Decide again with Maya’s answer', goal, model, select)),
];

// ---- Mission 9: Old notes --------------------------------------------------

const M9_FIX = fixture({
  id: 'm9-old-notes',
  title: 'Old notes',
  end: at(18, 30),
  budget: 20,
  sources: { notes: NOTES },
  answers: { date: { id: 'a-date', label: 'It’s Wednesday.', units: 1, source: 'Maya', at: 0, subject: 'date', author: 'Maya', authority: 'authoritative', kind: 'answer', data: { date: 'Wednesday', kind: 'answer' } } },
  people: { Maya: { windows: [[at(18, 0), at(18, 20)]], replyAfter: 2 * MIN } },
  messages: [
    briefMsg('Nora will ask for the launch date. It’s in our notes — but some of them are old. I’m around until 18:20 if you need me.'),
    { id: 'm-nora-ask', from: 'nora', at: at(18, 2), subject: 'Launch date?', body: 'What date should we announce?', kind: 'nora_ask' },
  ],
  jobs: [
    {
      id: 'nora_date',
      title: 'Tell Nora the launch date',
      icon: '📅',
      required: true,
      triggers: ['nora_ask'],
      deadline: at(18, 30),
      check: (s) => {
        const m = lastSent(s, 'reply');
        return m ? (m.value?.date === 'Wednesday' ? { ok: true, status: 'done' } : { ok: false, status: `told Nora ${m.value?.date}` }) : { ok: false, status: 'nothing sent' };
      },
    },
  ],
});

const M9: Mission = {
  id: 'm9',
  n: 9,
  shiftNo: 2,
  title: 'Old notes',
  goal: 'Tell Nora the right launch date',
  concept: 'memory',
  askWake: false,
  askGuide: false,
  fixture: M9_FIX,
  choices: [
    choice('select', 'Look-up rule', 'Relay keeps a cabinet of notes. Which notes go on the AI’s tray when it looks up the launch date?', [
      { id: 'recent', label: '🕐 The most recent note', desc: 'Whatever was written last about the launch date.' },
      { id: 'authority', label: '👑 The latest decision', desc: 'Newest note from the decision-maker that no later note corrected.' },
      { id: 'all', label: '📚 Everything', desc: 'All notes, newest first, as many as fit.' },
    ]),
    MODEL_CHOICE,
  ],
  makeBuild: (base, p) => {
    const m = (p.model ?? 'swift') as Model;
    const sel = p.select ?? 'authority';
    const goal = 'Tell Nora the current launch date';
    return jobsBuild(base, 'compact', [['nora_date']], {
      nora_date: [
        op.read('notes', 'Look in the notes cabinet'),
        op.decide('launch_date', 'Work out the launch date', goal, m, sel),
        ...askMaya('launch_date', goal, m, sel),
        when('ok', op.write('reply', 'Write the reply', 0, 0.5)),
        when('ok', op.send('reply', 'Nora', 'Send Nora the date')),
        when('ok', op.verify('reply', 'Check Nora got it')),
      ],
    });
  },
  prediction: {
    question: 'Which launch date will Nora be told?',
    options: [
      { id: 'Tuesday', label: 'Tuesday' },
      { id: 'Wednesday', label: 'Wednesday' },
      { id: 'Thursday', label: 'Thursday' },
    ],
    answer: (s) => String(lastSent(s, 'reply')?.value?.date ?? 'none'),
    explain: (s) => {
      const d = lastSent(s, 'reply')?.value?.date;
      if (d === 'Thursday') return 'Leo’s note was the newest, so “most recent” picked it — but it was only a rumour. Maya’s Wednesday note is the decision.';
      if (d === 'Wednesday') return s.world.questions.length ? 'The tray held conflicting dates, so the small model asked Maya instead of guessing.' : 'Wednesday is Maya’s latest decision; it supersedes Tuesday, and Leo’s Thursday was only speculation.';
      return 'Nothing was sent.';
    },
  },
  medals: [
    coreMedal('Nora gets the right date', 'Newest isn’t always right — who wrote the note matters.'),
    byMedal(at(18, 5), 'Done by 18:05', 'Asking Maya works, but costs a few minutes of waiting.'),
    cheapMedal(10, 'A small model is enough when the tray holds just the current decision.'),
  ],
};

// ---- Mission 10: Plans changed --------------------------------------------

const FRI: TileDef = { id: 'n-fri', label: 'Partner asked to move: the launch is now Friday', units: 2, source: 'notes', at: at(18, 20), subject: 'date', author: 'Maya', authority: 'authoritative', supersedes: 'n-wed', kind: 'note', data: { date: 'Friday' } };

/** A page can be corrected later; an email can't be unsent (strict: every copy must be right). */
const dateCheck = (artifact: string, want: string, needPrice = false, strict = false) => (s: SimState) => {
  const all = sentAll(s, artifact);
  const m = all[all.length - 1];
  if (!m) return { ok: false, status: 'nothing sent' };
  if (m.value?.date !== want) return { ok: false, status: `sent ${m.value?.date}` };
  const wrong = all.find((x) => x.value?.date !== want);
  if (strict && wrong) return { ok: false, status: `first emailed ${wrong.value?.date} — can’t be unsent` };
  if (needPrice && !m.value?.price) return { ok: false, status: 'price missing' };
  return { ok: true, status: all.length > 1 ? 'done (after a correction)' : 'done' };
};

function plansFixture(id: string, title: string, extraNotes: TileDef[], mayaUntil: Ms, extraMessages: Fixture['messages'] = []): Fixture {
  return fixture({
    id,
    title,
    end: at(19, 0),
    endOfferAfter: at(18, 31),
    budget: 40,
    sources: { notes: [...NOTES, FRI, ...extraNotes] },
    people: { Maya: { windows: [[at(18, 0), mayaUntil]], replyAfter: 2 * MIN } },
    answers: { date: { id: 'a-date', label: 'It’s Friday now.', units: 1, source: 'Maya', at: 0, subject: 'date', author: 'Maya', authority: 'authoritative', kind: 'answer', data: { date: 'Friday', kind: 'answer' } } },
    messages: [
      briefMsg('Three things tonight: Nora announces the launch when she says go (around 18:30), the FAQ page needs the date and price, and the investor note too. Dates have been moving around — check the notes.'),
      { id: 'm-note-fri', from: 'maya', at: at(18, 20), subject: 'Date change', body: 'Partner asked to move: the launch is now Friday.', kind: 'note_changed' },
      { id: 'm-nora-go', from: 'nora', at: at(18, 30), subject: 'Ready when you are', body: 'Send me the announcement now.', kind: 'nora_go' },
      ...extraMessages,
    ],
    jobs: [
      { id: 'facts', title: 'Keep a shared facts sheet', icon: '🗒️', required: false, internal: true, triggers: ['start', 'note_changed', 'nora_go'], check: () => ({ ok: true, status: 'done' }) },
      { id: 'nora', title: 'Nora’s announcement', icon: '📣', required: true, triggers: ['start', 'note_changed', 'nora_go'], deadline: at(18, 40), check: dateCheck('nora_msg', 'Friday', false, true) },
      { id: 'faq', title: 'FAQ page', icon: '❓', required: false, triggers: ['start', 'note_changed', 'nora_go'], deadline: at(18, 45), check: dateCheck('faq', 'Friday', true) },
      { id: 'investor', title: 'Investor note', icon: '💼', required: false, triggers: ['start', 'note_changed', 'nora_go'], deadline: at(18, 50), check: dateCheck('investor', 'Friday', true, true) },
    ],
  });
}

function plansBuild(base: Build, p: Record<string, string>, f: Fixture): Build {
  const prep = p.prep ?? 'early';
  const change = p.change ?? 'refresh';
  const sheet = (p.share ?? 'sheet') === 'sheet';
  const select = p.select ?? 'authority';
  const jobsTaken = (p.take ?? 'all') === 'all' ? ['nora', 'faq', 'investor'] : ['nora'];
  const mode = prep === 'jit' ? 'once' : change === 'refresh' ? 'restart' : 'once';
  const prepare = (artifact: string, goal: string): StepDef[] =>
    sheet
      ? [op.waitJob('facts', 'Wait for the facts sheet'), op.readArt('facts', 'Read the facts sheet'), op.decide('from_sheet', 'Fill in from the sheet', goal, 'swift', 'all'), when('ok', op.write(artifact, 'Save the draft', 0, 0.5))]
      : [
          op.read('notes', 'Look in the notes cabinet'),
          op.decide('facts_sheet', 'Work out the facts', goal, 'deliberate', select),
          ...askMaya('facts_sheet', goal, 'deliberate', select),
          when('ok', op.write(artifact, 'Save the draft', 0, 0.5)),
        ];
  const gate: StepDef[] = [];
  const procedures: Record<string, StepDef[]> = {
    facts: [
      ...gate,
      op.read('notes', 'Look in the notes cabinet'),
      op.decide('facts_sheet', 'Work out the current facts', 'Build one facts sheet everyone can reuse', 'deliberate', select),
      ...askMaya('facts_sheet', 'Build one facts sheet everyone can reuse', 'deliberate', select),
      when('ok', op.write('facts', 'Save the facts sheet')),
      when('ok', op.verify('facts', 'Check the sheet saved')),
    ],
    nora: [...gate, ...prepare('nora_msg', 'Nora’s announcement'), op.waitEvent('nora_go', 'Wait until Nora says go'), when('ok', op.send('nora_msg', 'Nora', 'Send Nora the announcement')), when('ok', op.verify('nora_msg', 'Check Nora got it'))],
    faq: [...gate, ...prepare('faq', 'FAQ: launch date and price'), when('ok', op.send('faq', 'FAQ page', 'Publish the FAQ')), when('ok', op.verify('faq', 'Check the FAQ page'))],
    investor: [...gate, ...prepare('investor', 'Investor note: date and price'), when('ok', op.send('investor', 'Investors', 'Send the investor note')), when('ok', op.verify('investor', 'Check it was sent'))],
  };
  const jobs = [...(sheet ? ['facts'] : []), ...jobsTaken];
  const policies = Object.fromEntries(jobs.map((j) => [j, { onNew: mode as 'once' | 'restart' }]));
  const startOn = prep === 'jit' ? ['nora_go'] : change === 'refresh' ? ['start', 'note_changed'] : ['start'];
  const triggers = Object.fromEntries(jobs.map((j) => [j, startOn]));
  void f;
  return { ...jobsBuild(base, 'compact', [jobs], procedures, { accepted: jobs, policies }), triggers };
}

const PLANS_CHOICES: Choice[] = [
  choice('take', 'Jobs', 'Nora’s announcement is required. Take on the FAQ page and the investor note too?', [
    { id: 'all', label: '☑ All three jobs', desc: 'Announcement, FAQ page and investor note.' },
    { id: 'nora', label: '☐ Just Nora’s announcement', desc: 'Leave the others for tomorrow.' },
  ]),
  choice('share', 'Shared facts', 'Each job needs the launch date (and the price). How should they get it?', [
    { id: 'sheet', label: '🗒️ One shared facts sheet', desc: 'Work the facts out once with the big model; every job copies the sheet with the small model.', cost: 'one big decision, then cheap ones' },
    { id: 'separate', label: '🔍 Each job looks it up itself', desc: 'Every job reads the notes and decides with the big model.', cost: 'a big decision per job' },
  ]),
  choice('prep', 'Timing', 'When should Relay prepare the drafts?', [
    { id: 'early', label: '🌅 Early — right away', desc: 'Have everything ready long before Nora says go.' },
    { id: 'jit', label: '⏱️ Just in time', desc: 'Wait until Nora says go (around 18:30), then prepare and send.' },
  ]),
  choice(
    'change',
    'If the facts change',
    'If a note changes after a draft was prepared, what should Relay do?',
    [
      { id: 'refresh', label: '🔄 Redo the affected work', desc: 'Throw away stale drafts and prepare them again.' },
      { id: 'keep', label: '📌 Keep what was prepared', desc: 'Don’t spend more — the drafts are done.' },
    ],
    (p) => p.prep !== 'jit',
  ),
];

const M10_FIX = plansFixture('m10-plans-changed', 'Plans changed', [], at(18, 40));
const M10: Mission = {
  id: 'm10',
  n: 10,
  shiftNo: 2,
  title: 'Plans changed',
  goal: 'Announce the right date — even when it changes',
  concept: 'memory',
  askWake: false,
  askGuide: false,
  fixture: M10_FIX,
  choices: PLANS_CHOICES,
  makeBuild: (b, p) => plansBuild(b, p, M10_FIX),
  prediction: {
    question: 'At 18:20 Maya moves the launch to Friday. What date will Nora announce?',
    options: [
      { id: 'Friday', label: 'Friday — the new date' },
      { id: 'Wednesday', label: 'Wednesday — the old date' },
    ],
    answer: (s) => String(lastSent(s, 'nora_msg')?.value?.date ?? 'none'),
    explain: (s) => {
      const d = lastSent(s, 'nora_msg')?.value?.date;
      return d === 'Friday'
        ? 'The drafts were prepared (or redone) after the change, so they used Maya’s Friday note — it supersedes Wednesday.'
        : 'The drafts were prepared before 18:20 and kept. A prepared draft doesn’t update itself when the facts change.';
    },
  },
  medals: [
    coreMedal('Nora announces Friday', 'Drafts made before 18:20 go stale — redo them, or prepare just in time.'),
    allJobsMedal('All three right, no wrong emails', 'An email can’t be unsent — don’t send anything until the facts have settled.'),
    cheapMedal(20, 'Work the facts out once and reuse them, instead of a big decision per job.'),
  ],
};

// ---- Mission 11: Conflicting notes (challenge) ------------------------------

const SAT: TileDef = { id: 'n-sat', label: 'Pretty sure it’s Saturday now', units: 2, source: 'notes', at: at(18, 24), subject: 'date', author: 'Leo', authority: 'speculative', kind: 'note', data: { date: 'Saturday' } };
const M11_FIX = plansFixture('m11-conflicting-notes', 'Conflicting notes', [SAT], at(18, 15), [
  { id: 'm-leo-sat', from: 'leo', at: at(18, 24), subject: 'Re: date', body: 'Pretty sure it’s Saturday now.', kind: 'note_changed' },
]);
const M11: Mission = {
  ...M10,
  id: 'm11',
  n: 11,
  title: 'Conflicting notes',
  challenge: 'Leo adds a rumour at 18:24, and Maya leaves at 18:15',
  goal: 'Announce Friday — rumours and all',
  fixture: M11_FIX,
  choices: [
    choice('select', 'Look-up rule', 'Which notes should go on the tray when the facts are worked out?', [
      { id: 'recent', label: '🕐 The most recent note', desc: 'Whatever was written last about the launch date.' },
      { id: 'authority', label: '👑 The latest decision', desc: 'Newest note from the decision-maker that no later note corrected.' },
    ]),
    ...PLANS_CHOICES,
  ],
  makeBuild: (b, p) => plansBuild(b, p, M11_FIX),
};

MISSIONS.push(M9, M10, M11);

// ===========================================================================
// SHIFT 3 — The noisy evening (event coalescing, timers, cancellation, attention)

CONCEPTS.push({
  id: 'attention',
  icon: '🔔',
  title: 'Noise, urgency and attention',
  short: 'Not every update deserves action — but some can’t wait.',
  points: [
    'Acting on every update means redoing work; waiting for a quiet moment saves it, at the cost of time.',
    'Urgent messages should jump the queue — a busy worker only notices when its current step ends.',
    'Batch routine news into one digest instead of interrupting people for each change.',
  ],
});

export const logoTiles = (times: Ms[]): TileDef[] =>
  times.map((t, i) => ({ id: `rev-${i + 1}`, label: `Logo revision ${i + 1}`, units: 1, source: 'logos', at: t, subject: 'logo', kind: 'input', data: { rev: i + 1 } }));
export const logoMsgs = (times: Ms[]): Fixture['messages'] =>
  times.map((t, i) => ({ id: `m-rev-${i + 1}`, from: 'isha' as const, at: t, subject: `Logo v${i + 1}`, body: i ? 'Tiny tweak — here’s another version.' : 'First version of the logo.', kind: 'logo_rev' }));

registerRule('latest_logo', (_p, tiles) => {
  const revs = tiles.map((t) => Number(t.data?.rev ?? 0)).filter(Boolean);
  if (!revs.length) return { need: 'a logo', explanation: 'No logo on the tray.' };
  const rev = Math.max(...revs);
  return { output: { rev }, explanation: `The newest logo on the tray is revision ${rev}. Render it.` };
});

export const previewCheck = (finalRev: number) => (s: SimState) => {
  const v = s.world.artifacts.preview?.value?.rev;
  return v === finalRev ? { ok: true, status: 'done' } : { ok: false, status: v ? `shows revision ${v} of ${finalRev}` : 'no preview' };
};

export const previewProc = (notify: boolean): StepDef[] => [
  op.read('logos', 'Fetch the latest logos'),
  op.decide('latest_logo', 'Pick the newest revision', 'Keep the preview on the newest logo', 'swift', 'all'),
  op.local('Render the preview', 3, 1, 1),
  op.write('preview', 'Save the preview'),
  op.verify('preview', 'Check the preview'),
  ...(notify ? [op.notify('Maya', 'Preview updated with the newest logo.', 'Tell Maya the preview changed')] : []),
];

const POLICY_CHOICE = choice('policy', 'New versions', 'Isha keeps sending small tweaks. When a new version arrives, what should Relay do?', [
  { id: 'queue', label: '📥 Redo it after the current one', desc: 'Finish what it’s doing, then render again with the newest version.' },
  { id: 'restart', label: '♻️ Drop everything and start over', desc: 'Cancel the work in progress and start on the newest version.' },
  { id: 'quiet', label: '🤫 Wait for things to calm down', desc: 'Only start once no new version has arrived for a while.' },
]);

// ---- Mission 12: Every little change ----------------------------------------

const M12_TIMES = [at(18, 2), at(18, 3, 30), at(18, 5), at(18, 6)];
const M12_FIX = fixture({
  id: 'm12-every-change',
  title: 'Every little change',
  end: at(18, 30),
  budget: 30,
  sources: { logos: logoTiles(M12_TIMES) },
  messages: [briefMsg('Isha is fiddling with the logo tonight — expect a few versions in a row. Keep the preview on her latest one.'), ...logoMsgs(M12_TIMES)],
  jobs: [{ id: 'preview', title: 'Keep the preview on the newest logo', icon: '🖼️', required: true, triggers: ['logo_rev'], deadline: at(18, 20), check: previewCheck(4) }],
});

const M12: Mission = {
  id: 'm12',
  n: 12,
  shiftNo: 3,
  title: 'Every little change',
  goal: 'Preview on Isha’s final logo — without wasted work',
  concept: 'attention',
  askWake: false,
  askGuide: false,
  fixture: M12_FIX,
  choices: [
    POLICY_CHOICE,
    choice(
      'quiet',
      'Quiet time',
      'How long without a new version counts as “calmed down”?',
      [
        { id: '1', label: '1 minute', desc: 'Start quickly.' },
        { id: '2', label: '2 minutes', desc: 'A little patience.' },
        { id: '5', label: '5 minutes', desc: 'Be sure she’s finished.' },
      ],
      (p) => p.policy === 'quiet',
    ),
  ],
  makeBuild: (b, p) =>
    jobsBuild(b, 'compact', [['preview']], { preview: previewProc(false) }, {
      policies: { preview: { onNew: (p.policy ?? 'quiet') as 'queue' | 'restart' | 'quiet', quietMs: Number(p.quiet ?? 2) * MIN } },
    }),
  prediction: {
    question: 'Isha sends 4 versions in 4 minutes. How many times will Relay render the preview?',
    options: [
      { id: '1', label: 'Once' },
      { id: '2', label: 'Twice' },
      { id: '3+', label: 'Three or more times' },
    ],
    answer: (s) => {
      const n = s.trace.filter((e) => e.kind === 'step_start' && /Render the preview/.test(e.text)).length;
      return n >= 3 ? '3+' : String(n);
    },
    explain: (s) => {
      const n = s.trace.filter((e) => e.kind === 'step_start' && /Render the preview/.test(e.text)).length;
      return `Relay started ${n} render${n === 1 ? '' : 's'}. Every render of a version that’s already out of date is wasted CPU and credits.`;
    },
  },
  medals: [
    coreMedal('Preview on the final logo by 18:20', 'Whatever the policy, the last version must end up on the page.'),
    byMedal(at(18, 14), 'Done by 18:14', 'Waiting too long wastes time; not waiting at all wastes work.'),
    cheapMedal(11, 'Each render of an outdated version costs credits. One render is enough.'),
  ],
};

// ---- Mission 13: The noisy evening -------------------------------------------

function noisyFixture(id: string, title: string, revTimes: Ms[], blockerAt: Ms, launchAt: Ms, previewBy: Ms): Fixture {
  return fixture({
    id,
    title,
    end: at(19, 0),
    endOfferAfter: at(18, 36),
    budget: 45,
    sources: { logos: logoTiles(revTimes) },
    messages: [
      briefMsg(`Busy one: Isha is still tweaking the logo, the launch goes out at ${fmtTime(launchAt)}, and I’ll check messages at 18:35. Please don’t ping me for every little thing.`),
      ...logoMsgs(revTimes),
      { id: 'm-blocker', from: 'leo', at: blockerAt, subject: 'URGENT: payments are down', body: 'Payments are down — hold the launch!', kind: 'blocker' },
      { id: 'm-launch-time', from: 'maya', at: launchAt, subject: 'Launch time', body: 'Scheduled launch.', kind: 'launch_time' },
      { id: 'm-checkin', from: 'maya', at: at(18, 35), subject: 'Checking in', body: 'Anything I should know?', kind: 'checkin' },
    ],
    jobs: [
      {
        id: 'hold',
        title: 'Hold the launch if something breaks',
        icon: '🛑',
        required: true,
        triggers: ['blocker'],
        deadline: launchAt,
        check: (s) =>
          s.world.sent.some((x) => x.artifact === 'site')
            ? { ok: false, status: 'the launch went out while payments were down' }
            : s.world.notifications.some((n) => /held/i.test(n.text))
              ? { ok: true, status: 'done' }
              : { ok: false, status: 'Maya was never told' },
      },
      { id: 'preview', title: 'Keep the preview on the newest logo', icon: '🖼️', required: true, triggers: ['logo_rev'], deadline: previewBy, check: previewCheck(revTimes.length) },
      { id: 'pings', title: 'Ping Maya about each version', icon: '📨', required: false, internal: true, triggers: ['logo_rev'], check: () => ({ ok: true, status: '' }) },
      { id: 'launch', title: 'Scheduled launch', icon: '🚀', required: false, internal: true, triggers: ['start'], check: () => ({ ok: true, status: '' }) },
      { id: 'digest', title: 'Evening digest for Maya', icon: '📰', required: false, internal: true, triggers: ['checkin'], check: () => ({ ok: true, status: '' }) },
    ],
  });
}

function noisyBuild(b: Build, p: Record<string, string>): Build {
  const every = (p.updates ?? 'digest') === 'every';
  const urgent = (p.order ?? 'urgent') === 'urgent';
  const procedures: Record<string, StepDef[]> = {
    hold: [op.cancel('launch', 'Cancel the scheduled launch'), op.notify('Maya', 'Launch held: payments are down.', 'Tell Maya the launch is held')],
    preview: previewProc(false),
    pings: [op.notify('Maya', 'Isha sent a new logo version.', 'Ping Maya about the new version')],
    launch: [op.waitEvent('launch_time', 'Wait for launch time'), op.write('site', 'Prepare the launch', 0, 0.5), op.send('site', 'the public', 'Publish the launch', 2), op.verify('site', 'Check the launch is live')],
    digest: [op.notify('Maya', 'Evening digest: preview is on the newest logo.', 'Send Maya one digest')],
  };
  const routine = ['preview', 'launch', ...(every ? ['pings'] : ['digest'])];
  const order = urgent ? ['hold', ...routine] : [...routine, 'hold'];
  const machine = (p.machine ?? 'compact') as MachineId;
  const perWorker = machine === 'team' ? [order.filter((j) => j !== 'preview'), ['preview']] : [order];
  return jobsBuild(b, machine, perWorker, procedures, {
    accepted: order,
    policies: { preview: { onNew: (p.policy ?? 'quiet') as 'queue' | 'restart' | 'quiet', quietMs: 2 * MIN }, pings: { onNew: 'queue' } },
  });
}

const notifCount = (s: SimState) => s.world.notifications.filter((n) => n.who === 'Maya').length + s.world.questions.filter((q) => q.who === 'Maya').length;
const quietMedal = (max: number): Medal => ({
  id: 'quiet',
  icon: '🔕',
  label: `At most ${max} messages to Maya`,
  hint: 'Batch the routine news into one digest; save interruptions for real problems.',
  test: (o, s) => o.promiseKept && notifCount(s) <= max,
  measure: (o, s) => ({ you: `${notifCount(s)} message${notifCount(s) === 1 ? '' : 's'}${o.promiseKept ? '' : ' (job not done)'}`, goal: `≤ ${max}, job done` }),
});

const NOISY_CHOICES: Choice[] = [
  { ...POLICY_CHOICE, prompt: 'Isha keeps sending tweaks all evening. When a new version arrives, what should Relay do?' },
  choice('order', 'Urgent messages', 'Something might go wrong tonight. How should an urgent message be handled?', [
    { id: 'urgent', label: '🚨 Urgent jumps the queue', desc: 'As soon as the current step ends, deal with the emergency first.' },
    { id: 'fifo', label: '📋 Everything in order', desc: 'Handle it after the work that’s already lined up.' },
  ]),
  choice('updates', 'Telling Maya', 'How should Relay keep Maya posted?', [
    { id: 'every', label: '📨 After every change', desc: 'A quick note each time the preview changes.' },
    { id: 'digest', label: '📰 One digest when she checks in', desc: 'Save routine news for 18:35. Emergencies still go straight away.' },
  ]),
];

const M13_REVS = [at(18, 2), at(18, 4), at(18, 7), at(18, 10), at(18, 13), at(18, 15)];
const M13_FIX = noisyFixture('m13-noisy-evening', 'The noisy evening', M13_REVS, at(18, 16), at(18, 20), at(18, 35));
const M13: Mission = {
  id: 'm13',
  n: 13,
  shiftNo: 3,
  title: 'The noisy evening',
  goal: 'Stay on top of the noise — and catch the one thing that matters',
  concept: 'attention',
  askWake: false,
  askGuide: false,
  fixture: M13_FIX,
  choices: NOISY_CHOICES,
  makeBuild: noisyBuild,
  prediction: {
    question: 'At 18:16 Leo says payments are down. The launch is scheduled for 18:20. Will it be stopped in time?',
    options: [
      { id: 'held', label: 'Yes — held before 18:20' },
      { id: 'out', label: 'No — it goes out anyway' },
    ],
    answer: (s) => (s.world.sent.some((x) => x.artifact === 'site') ? 'out' : 'held'),
    explain: (s) => {
      const hold = s.trace.find((e) => /Cancelled “Scheduled launch”/.test(e.text));
      return hold
        ? `The hold ran at ${fmtTime(hold.t)} — the worker finished its current step, then took the emergency.`
        : 'The emergency waited behind routine work, and the launch went out at its scheduled time. Cancelling afterwards can’t unpublish it.';
    },
  },
  medals: [
    coreMedal('Launch held, preview current', 'The hold must happen before 18:20, and the preview must end on Isha’s last version.'),
    quietMedal(2),
    cheapMedal(17, 'Re-rendering every tweak burns credits; wait for a quiet moment.'),
  ],
};

// ---- Mission 14: Storm (challenge) -------------------------------------------

const M14_REVS = Array.from({ length: 24 }, (_, i) => at(18, 2) + i * 30_000);
const M14_FIX = noisyFixture('m14-storm', 'Storm', M14_REVS, at(18, 12), at(18, 14), at(18, 20));
const M14: Mission = {
  ...M13,
  id: 'm14',
  n: 14,
  title: 'Storm',
  challenge: 'A new version every 30 seconds — and the emergency comes earlier',
  goal: 'Survive the storm',
  fixture: M14_FIX,
  choices: [
    ...NOISY_CHOICES,
    choice('machine', 'Workers', 'One worker, or a second one dedicated to the preview?', [
      { id: 'compact', label: '🛠️ One worker', desc: 'Everything on one bench.', cost: '8 credits rent' },
      { id: 'team', label: '🛠️🛠️ Two workers', desc: 'Worker 2 only renders previews; Worker 1 handles everything else.', cost: '22 credits rent' },
    ]),
  ],
  makeBuild: noisyBuild,
  prediction: { ...M13.prediction, question: 'At 18:12 Leo says payments are down; the launch is at 18:14. Will it be stopped in time?' },
  medals: [
    coreMedal('Launch held, preview current', 'With versions every 30 seconds, a busy worker may not notice the emergency in time.'),
    quietMedal(2),
    cheapMedal(20, 'In a storm, waiting for calm takes too long — and a second worker’s rent adds up.'),
  ],
};

MISSIONS.push(M12, M13, M14);

// ===========================================================================
// SHIFT 4 — Shared workshop (CPU, RAM, filesystem versions)

CONCEPTS.push({
  id: 'workshop',
  icon: '🏭',
  title: 'Machines and shared files',
  short: 'Cores, memory and one file between two workers.',
  points: [
    'Two workers editing one file must coordinate: take turns, or work on copies and merge. A write based on an old version is rejected — never silently overwritten.',
    'Local work shares the CPU cores: run more jobs than cores and each one slows down.',
    'A job only starts when its memory (RAM) fits. More CPU never speeds up a remote AI call.',
  ],
});

registerRule('add_logo', () => ({ output: { logo: 'new logo' }, explanation: 'Add Isha’s logo to the page header.' }));
registerRule('add_pricing', () => ({ output: { pricing: '$12 / month' }, explanation: 'Add the pricing table below the fold.' }));
registerRule('merge', (_p, tiles) => {
  const out: RuleOutput = {};
  for (const t of tiles) for (const k of ['logo', 'pricing']) if (t.data?.[k]) out[k] = t.data[k] as string;
  return out.logo && out.pricing
    ? { output: out, explanation: 'Both drafts are on the tray: take the logo from one and the pricing table from the other.' }
    : { need: 'both drafts', explanation: 'One of the drafts is missing from the tray.' };
});

const pageHas = (field: 'logo' | 'pricing') => (s: SimState) => {
  const v = s.world.artifacts.page?.value;
  return v?.[field] ? { ok: true, status: 'done' } : { ok: false, status: `the page has no ${field}${s.world.artifacts.page?.version ?? 0 > 1 ? ' (overwritten?)' : ''}` };
};

// ---- Mission 15: Two hands, one file ---------------------------------------

export const M15_FIX = fixture({
  id: 'm15-two-hands',
  title: 'Two hands, one file',
  end: at(18, 30),
  budget: 40,
  artifacts: { page: { title: 'Lumen launch page' } },
  messages: [briefMsg('Two changes to the launch page tonight: the new logo in the header, and the pricing table. Two workers, one page — don’t lose either change.')],
  jobs: [
    { id: 'logo_edit', title: 'Logo in the header', icon: '🖼️', required: true, triggers: ['start'], deadline: at(18, 20), check: pageHas('logo') },
    { id: 'pricing_edit', title: 'Pricing table', icon: '💲', required: true, triggers: ['start'], deadline: at(18, 20), check: pageHas('pricing') },
    { id: 'merge', title: 'Merge the two drafts', icon: '🔀', required: false, internal: true, triggers: ['start'], check: () => ({ ok: true, status: '' }) },
  ],
});

export function twoHandsBuild(b: Build, p: Record<string, string>): Build {
  const mode = p.share ?? 'merge';
  const edit = (rule: string, label: string, cpu: number, ram: number): StepDef[] => {
    if (mode === 'merge')
      return [op.readArt('page', 'Read the page'), op.decide(rule, 'Plan the change', label, 'swift'), op.local(label, cpu, ram, 1), op.write(`draft_${rule}`, 'Save a separate draft', 0, 0.5), op.verify(`draft_${rule}`, 'Check the draft')];
    const write = op.write('page', 'Save the page', 1, 1, true);
    return [
      op.readArt('page', 'Read the page'),
      op.decide(rule, 'Plan the change', label, 'swift'),
      op.local(label, cpu, ram, 1),
      write,
      when('conflict', op.readArt('page', 'Re-read the newer page')),
      when('conflict', op.local(`${label} again`, cpu, ram, 1)),
      when('conflict', write),
      op.verify('page', 'Check the page'),
    ];
  };
  const procedures: Record<string, StepDef[]> = {
    logo_edit: edit('add_logo', 'Render the logo into the header', 3, 1),
    pricing_edit: [...(mode === 'lock' ? [op.waitJob('logo_edit', 'Wait for the logo edit to finish')] : []), ...edit('add_pricing', 'Build the pricing table', 2, 0.5)],
    merge: [
      op.waitJob('logo_edit', 'Wait for the logo draft'),
      op.waitJob('pricing_edit', 'Wait for the pricing draft'),
      op.readArt('draft_add_logo', 'Read the logo draft'),
      op.readArt('draft_add_pricing', 'Read the pricing draft'),
      op.readArt('page', 'Read the page'),
      op.decide('merge', 'Merge the drafts', 'One page with both changes', 'swift', 'all'),
      op.write('page', 'Save the merged page', 1, 1, true),
      op.verify('page', 'Check the page'),
    ],
  };
  const w2 = mode === 'merge' ? ['pricing_edit', 'merge'] : ['pricing_edit'];
  return jobsBuild(b, 'team', [['logo_edit'], w2], procedures, { accepted: ['logo_edit', ...w2] });
}

const M15: Mission = {
  id: 'm15',
  n: 15,
  shiftNo: 4,
  title: 'Two hands, one file',
  goal: 'Both changes on the page — neither one lost',
  concept: 'workshop',
  askWake: false,
  askGuide: false,
  fixture: M15_FIX,
  choices: [
    choice('share', 'Sharing the page', 'Worker 1 adds the logo; Worker 2 adds the pricing table — both on the same page. How should they share it?', [
      { id: 'lock', label: '🚦 Take turns', desc: 'Worker 2 waits until Worker 1 has saved the page, then starts.' },
      { id: 'merge', label: '🔀 Separate drafts, then merge', desc: 'Both work at once on their own copy; then a quick merge step combines them.', cost: '+1 small decision' },
      { id: 'retry', label: '🔁 Both edit; redo if rejected', desc: 'Both work at once on the page. A save based on an old version is rejected — then that worker redoes its change.' },
    ]),
  ],
  makeBuild: twoHandsBuild,
  prediction: {
    question: 'Both workers start at 18:00 on the same page. Will either change be lost?',
    options: [
      { id: 'both', label: 'No — the page ends up with both' },
      { id: 'lost', label: 'Yes — one overwrites the other' },
    ],
    answer: (s) => (s.world.artifacts.page?.value?.logo && s.world.artifacts.page?.value?.pricing ? 'both' : 'lost'),
    explain: (s) => {
      const rejected = s.trace.find((e) => /Write rejected/.test(e.text));
      return rejected
        ? `At ${fmtTime(rejected.t)} a save based on an older version was rejected instead of overwriting the other change — that worker re-read the page and redid its edit.`
        : 'The workers never saved over each other: they took turns or worked on separate drafts.';
    },
  },
  medals: [
    coreMedal('Both changes on the page', 'Whatever the approach, neither change may be lost.'),
    byMedal(at(18, 10), 'Done by 18:10', 'Working at the same time is faster — if the changes are combined safely.'),
    cheapMedal(29, 'Redoing rejected work costs credits; a small merge step costs less.'),
  ],
};

// ---- Mission 16: Shared workshop -------------------------------------------

registerRule('make_format', (_p, tiles) => {
  const spec = tiles.find((t) => t.data?.quality);
  const fmt = tiles.find((t) => t.data?.format);
  if (!spec || !fmt) return { need: 'the format spec', explanation: 'The spec isn’t on the tray.' };
  return { output: { quality: String(spec.data!.quality), format: String(fmt.data!.format) }, explanation: `Produce the ${fmt.data!.format} at ${spec.data!.quality} quality.` };
});

interface Format {
  id: string;
  title: string;
  icon: string;
  kind: 'browser' | 'render';
  cpu: number;
  credits: number;
}
export const FORMATS: Format[] = [
  { id: 'social', title: 'Social image', icon: '🖼️', kind: 'render', cpu: 4, credits: 2 },
  { id: 'banner', title: 'Web banner', icon: '🏳️', kind: 'render', cpu: 3, credits: 1 },
  { id: 'onepager', title: 'One-page PDF', icon: '📄', kind: 'browser', cpu: 1, credits: 1 },
  { id: 'press', title: 'Press kit PDF', icon: '🗞️', kind: 'browser', cpu: 1, credits: 1 },
];

const formatTiles = (): TileDef[] =>
  FORMATS.map((f) => ({ id: `fmt-${f.id}`, label: `${f.title} spec`, units: 1, source: `fmt_${f.id}`, at: 0, kind: 'doc', data: { format: f.title } }));

export function workshopFixture(id: string, title: string, required: string[], dueAt: Ms): Fixture {
  return fixture({
    id,
    title,
    end: at(19, 0),
    budget: 60,
    sources: {
      spec_high: [{ id: 'q-high', label: 'Quality: high (2× render time)', units: 1, source: 'spec_high', at: 0, kind: 'doc', data: { quality: 'high' } }],
      spec_std: [{ id: 'q-std', label: 'Quality: standard', units: 1, source: 'spec_std', at: 0, kind: 'doc', data: { quality: 'standard' } }],
      ...Object.fromEntries(formatTiles().map((t) => [t.source, [t]])),
    },
    messages: [briefMsg(`Before the ${fmtTime(dueAt)} review I need launch assets: a social image, a web banner, a one-page PDF and a press kit. High quality if we can.`)],
    jobs: FORMATS.map((f) => ({
      id: f.id,
      title: f.title,
      icon: f.icon,
      required: required.includes(f.id),
      triggers: ['start'],
      deadline: dueAt,
      check: (s: SimState) => (s.world.artifacts[f.id]?.value ? { ok: true, status: 'done' } : { ok: false, status: 'not made' }),
    })),
  });
}

function formatProc(f: Format, quality: 'high' | 'standard'): StepDef[] {
  const hi = quality === 'high' && f.kind === 'render';
  const work =
    f.kind === 'browser'
      ? op.local(`Print the ${f.title} in a headless browser`, f.cpu, 1.5, f.credits, 2)
      : op.local(`Render the ${f.title}`, hi ? f.cpu * 2 : f.cpu, 1, f.credits + (hi ? 1 : 0));
  return [
    op.read(`fmt_${f.id}`, `Read the ${f.title} spec`),
    op.read(quality === 'high' ? 'spec_high' : 'spec_std', 'Read the quality setting'),
    op.decide('make_format', `Plan the ${f.title}`, `Make the ${f.title}`, 'swift', 'all'),
    work,
    op.write(f.id, `Save the ${f.title}`, 0, 0.5),
    op.verify(f.id, `Check the ${f.title}`),
  ];
}

export function workshopBuild(b: Build, p: Record<string, string>, take: string[]): Build {
  const machine = (p.machine ?? 'team') as MachineId;
  const quality = (p.quality ?? 'standard') as 'high' | 'standard';
  const order = (p.order ?? 'big') === 'big' ? ['social', 'banner', 'onepager', 'press'] : ['onepager', 'press', 'banner', 'social'];
  const jobs = order.filter((j) => take.includes(j));
  const slots = { compact: 1, team: 2, teamplus: 4, workshop: 4 }[machine];
  const perWorker: string[][] = Array.from({ length: slots }, () => []);
  jobs.forEach((j, i) => perWorker[i % slots].push(j));
  const procedures = Object.fromEntries(FORMATS.map((f) => [f.id, formatProc(f, quality)]));
  return jobsBuild(b, machine, perWorker, procedures, { accepted: jobs });
}

const qualityMedal: Medal = {
  id: 'hq',
  icon: '✨',
  label: 'Everything in high quality',
  hint: 'High quality doubles render time — plan the machine and the order around it.',
  test: (o, s) => o.promiseKept && Object.values(s.world.artifacts).filter((a) => a.value?.format).every((a) => a.value?.quality === 'high'),
  measure: (_o, s) => {
    const q = [...new Set(Object.values(s.world.artifacts).map((a) => a.value?.quality).filter(Boolean))];
    return { you: q.join(', ') || 'nothing made', goal: 'high quality, all on time' };
  },
};

const M16_FIX = workshopFixture('m16-shared-workshop', 'Shared workshop', FORMATS.map((f) => f.id), at(18, 12));
const M16: Mission = {
  id: 'm16',
  n: 16,
  shiftNo: 4,
  title: 'Shared workshop',
  goal: 'Four launch assets before the review',
  concept: 'workshop',
  askWake: false,
  askGuide: false,
  fixture: M16_FIX,
  choices: [
    choice('machine', 'Machine', 'Four assets to make. Which machine?', [
      { id: 'team', label: '🛠️🛠️ Team', desc: '2 workers, 2 CPU cores, 4 GB RAM.', cost: '22 credits rent' },
      { id: 'teamplus', label: '🛠️×4 Team+', desc: '4 workers — but the same 2 CPU cores and 4 GB RAM.', cost: '26 credits rent' },
      { id: 'workshop', label: '🏭 Workshop', desc: '4 workers, 4 CPU cores, 8 GB RAM.', cost: '34 credits rent' },
    ]),
    choice('quality', 'Quality', 'Maya would like high quality. High quality doubles the render time of the images.', [
      { id: 'standard', label: 'Standard', desc: 'Faster renders.' },
      { id: 'high', label: '✨ High', desc: 'Twice the render time, +1 credit per image.' },
    ]),
    choice('order', 'Order', 'Which assets should the workers start with?', [
      { id: 'big', label: '🐘 Biggest first', desc: 'Start the long renders early.' },
      { id: 'small', label: '🐭 Smallest first', desc: 'Get the quick PDFs out of the way.' },
    ]),
  ],
  makeBuild: (b, p) => workshopBuild(b, p, FORMATS.map((f) => f.id)),
  prediction: {
    question: 'Each PDF needs 1.5 GB of memory while it prints, each image 1 GB. With your machine, will any job have to wait for memory?',
    options: [
      { id: 'yes', label: 'Yes — something waits for RAM' },
      { id: 'no', label: 'No — everything fits' },
    ],
    answer: (s) => (s.trace.some((e) => /waits for RAM/.test(e.text)) ? 'yes' : 'no'),
    explain: (s) => {
      const w = s.trace.find((e) => /waits for RAM/.test(e.text));
      return w ? `${fmtTime(w.t)}: ${w.text}` : `Peak memory stayed within ${s.ram.totalGB} GB, so nothing had to wait for RAM.`;
    },
  },
  medals: [
    coreMedal('All four assets by 18:12', 'Long renders started late finish late — and two cores shared by four workers run at half speed.'),
    qualityMedal,
    cheapMedal(40, 'A bigger machine costs 12 more credits of rent — is it needed?'),
  ],
};

// ---- Mission 17: Small machine (challenge) ----------------------------------

const M17_FIX = workshopFixture('m17-small-machine', 'Small machine', ['onepager', 'banner'], at(18, 22));
const M17: Mission = {
  ...M16,
  id: 'm17',
  n: 17,
  title: 'Small machine',
  challenge: 'Only the Compact machine is available: 1 core, 2 GB',
  goal: 'The essentials on time — on one small machine',
  fixture: M17_FIX,
  choices: [
    choice('take', 'What to take on', 'The one-pager and the banner are required. The social image and press kit are optional. Take on…', [
      { id: 'all', label: 'All four', desc: 'Everything Maya asked for.' },
      { id: 'social', label: 'Required + social image', desc: 'Skip the press kit.' },
      { id: 'press', label: 'Required + press kit', desc: 'Skip the social image.' },
      { id: 'none', label: 'Only the required two', desc: 'Play it safe.' },
    ]),
    M16.choices![1],
    M16.choices![2],
  ],
  makeBuild: (b, p) => {
    const take = { all: ['onepager', 'banner', 'social', 'press'], social: ['onepager', 'banner', 'social'], press: ['onepager', 'banner', 'press'], none: ['onepager', 'banner'] }[p.take ?? 'none']!;
    return workshopBuild(b, { ...p, machine: 'compact' }, take);
  },
  medals: [
    coreMedal('The required two by 18:22', 'One core does one render at a time — don’t let optional work delay the essentials.'),
    { ...allJobsMedal('Three or more assets, all on time', 'Pick the optional asset that fits.'), test: (o) => o.promiseKept && o.jobs.filter((j) => j.ok).length >= 3 && o.jobs.every((j) => !j.accepted || j.ok) },
    qualityMedal,
  ],
};

MISSIONS.push(M15, M16, M17);

// ===========================================================================
// SHIFT 5 — A procedure worth keeping (skills, compatibility, loading)

CONCEPTS.push({
  id: 'skills',
  icon: '🧩',
  title: 'Skills: procedures worth keeping',
  short: 'Package a procedure once; reuse it cheaply.',
  points: [
    'A skill packages a procedure so a small model can follow it — instead of a big model re-reading the whole manual every time.',
    'Load only the skill that fits the input: every installed skill takes space on the tray.',
    'A skill declares the inputs it accepts. A new format needs the skill adapted once, or special handling every time.',
  ],
});

const MANUAL: TileDef = { id: 'doc-manual', label: 'Preview procedure manual (full)', units: 7, source: 'manual', at: 0, kind: 'doc', data: { procedure: 'preview' } };
const PREINSTALLED: TileDef[] = [
  { id: 'sk-a-brand', label: 'Skill: brand check', units: 3, source: 'skills', at: 0, kind: 'skill', data: { for: 'brand' } },
  { id: 'sk-b-invoice', label: 'Skill: invoices (PDF)', units: 3, source: 'skills', at: 0, kind: 'skill', data: { for: 'pdf' } },
  { id: 'sk-c-translate', label: 'Skill: translation', units: 3, source: 'skills', at: 0, kind: 'skill', data: { for: 'text' } },
];
const SKILL_PNG = { kind: 'skill', tileId: 'sk-logo', title: 'Skill: logo preview (PNG)', units: 3, for: 'png' };

registerRule('save_skill', (_p, tiles) =>
  tiles.some((t) => t.id === 'doc-manual')
    ? { output: { ...SKILL_PNG }, explanation: 'Turn the manual’s preview procedure into a compact skill for PNG logos.' }
    : { need: 'the manual', explanation: 'The manual isn’t on the tray.' },
);
registerRule('adapt_skill', (_p, tiles) =>
  tiles.some((t) => t.id === 'doc-manual') && tiles.some((t) => t.id === 'sk-logo')
    ? { output: { ...SKILL_PNG, title: 'Skill: logo preview (PNG, SVG)', for: 'png,svg' }, explanation: 'Add an SVG conversion step to the skill, so it accepts both formats.' }
    : { need: 'the skill and the manual', explanation: 'Need both the skill and the manual on the tray to adapt it.' },
);
registerRule('skill_preview', (p, tiles) => {
  const input = tiles.find((t) => t.data?.kind === 'input');
  if (!input) return { need: 'the product files', explanation: 'No product on the tray.' };
  const fmt = String(input.data!.format);
  const skill = tiles.find((t) => t.data?.kind === 'skill' && String(t.data?.for ?? '').split(',').includes(fmt));
  if (skill) return { output: { [`done_${input.data!.product}`]: 'skill' }, explanation: `“${skill.label}” accepts .${fmt}: follow it step by step.` };
  if (p.model === 'deliberate' && tiles.some((t) => t.id === 'doc-manual'))
    return { output: { [`done_${input.data!.product}`]: 'manual' }, explanation: `No skill on the tray for .${fmt}; the big model works it out from the full manual.` };
  const wrong = tiles.find((t) => t.data?.kind === 'skill' && /logo/.test(t.label));
  return wrong
    ? { need: `a skill that accepts .${fmt}`, explanation: `The logo skill only accepts ${wrong.data!.for}. This product is .${fmt} — the skill doesn’t fit it.` }
    : { need: 'instructions for this product', explanation: 'Neither a matching skill nor the manual is on the tray.' };
});

interface Product {
  id: string;
  name: string;
  at: Ms;
  format: 'png' | 'svg';
}

function productFixture(id: string, title: string, products: Product[], due: Ms, preinstalledLogoSkill: boolean, brief: string): Fixture {
  return fixture({
    id,
    title,
    end: at(19, 0),
    endOfferAfter: products[products.length - 1].at + MIN,
    budget: 40,
    artifacts: preinstalledLogoSkill ? { skill_logo: { ...SKILL_PNG } } : {},
    sources: {
      manual: [MANUAL],
      skills: PREINSTALLED,
      ...Object.fromEntries(products.map((p) => [`in_${p.id}`, [{ id: `in-${p.id}`, label: `${p.name}: logo.${p.format}`, units: 1, source: `in_${p.id}`, at: p.at, kind: 'input', data: { format: p.format, product: p.id } } as TileDef]])),
    },
    messages: [
      briefMsg(brief),
      ...products.map((p) => ({ id: `m-${p.id}`, from: 'isha' as const, at: p.at, subject: `${p.name} logo`, body: `Here’s the ${p.name} logo (.${p.format}).`, kind: `product_${p.id}` })),
    ],
    jobs: [
      { id: 'skill', title: 'Save the procedure as a skill', icon: '🧩', required: false, internal: true, triggers: ['start'], check: () => ({ ok: true, status: '' }) },
      { id: 'adapt', title: 'Adapt the skill', icon: '🔧', required: false, internal: true, triggers: ['start'], check: () => ({ ok: true, status: '' }) },
      ...products.map((p) => ({
        id: `prod_${p.id}`,
        title: `${p.name} preview`,
        icon: p.format === 'svg' ? '🔷' : '🖼️',
        required: true,
        triggers: [`product_${p.id}`],
        deadline: due,
        check: (s: SimState) => (s.world.artifacts[`preview_${p.id}`]?.value ? { ok: true, status: 'done' } : { ok: false, status: 'no preview' }),
      })),
    ],
  });
}

const SKILL_IDS = PREINSTALLED.map((t) => t.id);
function productProc(p: Product, mode: 'manual' | 'skill' | 'adapt' | 'fallback' | 'force', load: string): StepDef[] {
  const tail = [op.local(`Render the ${p.name} preview`, 2, 1, 1), op.write(`preview_${p.id}`, 'Save the preview', 0, 0.5), op.verify(`preview_${p.id}`, 'Check the preview')];
  const goal = `Make the ${p.name} preview`;
  if (mode === 'manual') return [op.read('manual', 'Read the full manual'), op.read(`in_${p.id}`, 'Fetch the product files'), op.decide('skill_preview', 'Work out the steps', goal, 'deliberate', 'all'), ...tail];
  const sel = load === 'all' ? 'allSkills' : 'oneSkill';
  const wait = mode === 'skill' ? [op.waitJob('skill', 'Wait for the skill to be saved')] : mode === 'adapt' ? [op.waitJob('adapt', 'Wait for the adapted skill')] : [];
  return [
    ...wait,
    op.readArt('skill_logo', 'Load the logo skill'),
    op.read(`in_${p.id}`, 'Fetch the product files'),
    op.decide('skill_preview', 'Follow the skill', goal, 'swift', sel, SKILL_IDS),
    ...(mode === 'fallback'
      ? [when('need', op.read('manual', 'Fall back to the full manual')), when('need', op.decide('skill_preview', 'Work it out from the manual', goal, 'deliberate', 'all'))]
      : []),
    ...tail.map((t) => when('ok', t)),
  ];
}

function productBuild(b: Build, products: Product[], mode: 'manual' | 'skill' | 'adapt' | 'fallback' | 'force', load: string): Build {
  const procedures: Record<string, StepDef[]> = {
    skill: [op.read('manual', 'Read the full manual'), op.decide('save_skill', 'Turn the procedure into a skill', 'Save a reusable skill for PNG logos', 'deliberate', 'all'), op.write('skill_logo', 'Install the skill'), op.verify('skill_logo', 'Check the skill installed')],
    adapt: [op.read('manual', 'Read the full manual'), op.readArt('skill_logo', 'Load the logo skill'), op.decide('adapt_skill', 'Adapt the skill for SVG', 'Make the logo skill accept SVG too', 'deliberate', 'all'), op.write('skill_logo', 'Install the adapted skill'), op.verify('skill_logo', 'Check the skill installed')],
    ...Object.fromEntries(products.map((p) => [`prod_${p.id}`, productProc(p, mode, load)])),
  };
  const jobs = [...(mode === 'skill' ? ['skill'] : mode === 'adapt' ? ['adapt'] : []), ...products.map((p) => `prod_${p.id}`)];
  return jobsBuild(b, 'compact', [jobs], procedures, { accepted: jobs });
}

const LOAD_CHOICE = choice('load', 'Loading skills', 'Relay already has 3 other skills installed (brand check, invoices, translation). When it follows a skill, which skills go on the tray?', [
  { id: 'one', label: '🎯 Only the one that fits', desc: 'Load just the skill that accepts this kind of input.' },
  { id: 'all', label: '🧰 All installed skills', desc: 'Load every skill, just in case.' },
]);

// ---- Mission 18: Save the recipe --------------------------------------------

const M18_PRODUCTS: Product[] = [
  { id: 'a', name: 'Aurora', at: at(18, 2), format: 'png' },
  { id: 'b', name: 'Beacon', at: at(18, 6), format: 'png' },
  { id: 'c', name: 'Cinder', at: at(18, 10), format: 'png' },
];
const M18_FIX = productFixture('m18-save-the-recipe', 'Save the recipe', M18_PRODUCTS, at(18, 25), false, 'Three product logos tonight — same preview procedure for each. The full procedure is in the manual (it’s long).');
const M18: Mission = {
  id: 'm18',
  n: 18,
  shiftNo: 5,
  title: 'Save the recipe',
  goal: 'Three previews — the same procedure, three times',
  concept: 'skills',
  askWake: false,
  askGuide: false,
  fixture: M18_FIX,
  choices: [
    choice('how', 'How Relay knows the steps', 'The preview procedure is written up in a long manual (7 units). How should Relay follow it?', [
      { id: 'manual', label: '📖 Read the manual every time', desc: 'The big model reads the whole manual for each product.', cost: 'a big decision per product' },
      { id: 'skill', label: '🧩 Save it as a skill once', desc: 'The big model writes a compact skill (3 units) once; then a small model follows it.', cost: 'one big decision, then small ones' },
    ]),
    { ...LOAD_CHOICE, showIf: (p) => p.how === 'skill' },
  ],
  makeBuild: (b, p) => productBuild(b, M18_PRODUCTS, (p.how ?? 'skill') as 'manual' | 'skill', p.load ?? 'one'),
  prediction: {
    question: 'Will the small model manage to follow the skill for every product?',
    options: [
      { id: 'yes', label: 'Yes — the skill is all it needs' },
      { id: 'no', label: 'No — something won’t fit or won’t work' },
    ],
    answer: (s) => (s.tasks.filter((t) => t.responsibility.startsWith('prod_')).every((t) => t.status === 'DONE') ? 'yes' : 'no'),
    explain: (s) => {
      const packet = [...s.trace].reverse().find((e) => e.packet && e.packet.tiles.some((t) => t.id === 'sk-logo'))?.packet;
      const logo = packet?.tiles.find((t) => t.id === 'sk-logo');
      if (logo && !logo.included) return `With every skill loaded, the 10-unit tray filled up with brand, invoice and translation skills — the logo skill didn’t fit (${logo.reason}).`;
      if (!packet) return 'Without a skill, the big model read the full 7-unit manual for every product.';
      return 'Only the matching skill was loaded, so it always fit on the small tray.';
    },
  },
  medals: [
    coreMedal('All three previews by 18:25', 'The small model can only follow a skill that made it onto the tray.'),
    cheapMedal(19, 'One big decision to save a skill beats a big decision for every product.'),
    byMedal(at(18, 20), 'Last preview by 18:20', 'Small, quick decisions add up to a faster evening.'),
  ],
};

// ---- Mission 19: A procedure worth keeping ----------------------------------

const ADAPT_CHOICE = choice('mode', 'A new format', 'Your logo skill (from last time) accepts PNG only. If a product arrives as SVG, what should Relay do?', [
  { id: 'adapt', label: '🔧 Adapt the skill first', desc: 'Before anything arrives, teach the skill to accept SVG too (one big decision).', cost: 'one big decision, up front' },
  { id: 'fallback', label: '📖 Fall back to the manual', desc: 'Use the skill when it fits; for anything else, the big model reads the manual.', cost: 'a big decision per odd product' },
  { id: 'force', label: '🔨 Use the skill anyway', desc: 'Always follow the PNG skill.' },
]);

const M19_PRODUCTS: Product[] = [
  { id: 'a', name: 'Aurora', at: at(18, 2), format: 'png' },
  { id: 'b', name: 'Beacon', at: at(18, 5), format: 'png' },
  { id: 'c', name: 'Cinder', at: at(18, 8), format: 'svg' },
  { id: 'd', name: 'Drift', at: at(18, 11), format: 'png' },
];
const M19_FIX = productFixture('m19-procedure', 'A procedure worth keeping', M19_PRODUCTS, at(18, 30), true, 'Four product previews tonight with the skill you saved. Heads-up: one designer works in SVG.');
const M19: Mission = {
  id: 'm19',
  n: 19,
  shiftNo: 5,
  title: 'A procedure worth keeping',
  goal: 'Four previews with the saved skill — one is SVG',
  concept: 'skills',
  askWake: false,
  askGuide: false,
  fixture: M19_FIX,
  choices: [ADAPT_CHOICE, LOAD_CHOICE],
  makeBuild: (b, p) => productBuild(b, M19_PRODUCTS, (p.mode ?? 'fallback') as 'adapt' | 'fallback' | 'force', p.load ?? 'one'),
  prediction: {
    question: 'The Cinder logo arrives as SVG. What happens to it?',
    options: [
      { id: 'skill', label: 'The skill handles it' },
      { id: 'manual', label: 'The big model works it out from the manual' },
      { id: 'fails', label: 'It doesn’t get a preview' },
    ],
    answer: (s) => {
      const v = s.world.artifacts.preview_c?.value;
      if (!v) return 'fails';
      const via = s.tasks.find((t) => t.responsibility === 'prod_c')?.runs.at(-1)?.notes.output?.done_c;
      return via === 'manual' ? 'manual' : 'skill';
    },
    explain: (s) => {
      const t = s.tasks.find((x) => x.responsibility === 'prod_c');
      const via = t?.runs.at(-1)?.notes.output?.done_c;
      if (via === 'skill') return 'The skill was adapted to accept SVG before Cinder arrived, so the small model simply followed it.';
      if (via === 'manual') return 'The skill rejected the SVG, so Relay fell back to the big model and the manual — for this one product.';
      return 'The PNG skill doesn’t accept SVG, and nothing else was tried — no preview for Cinder.';
    },
  },
  medals: [
    coreMedal('All four previews by 18:30', 'A skill that doesn’t accept the input can’t be forced.'),
    cheapMedal(20, 'For a single odd product, falling back once is cheaper than adapting.'),
    byMedal(at(18, 26), 'Last preview by 18:26', 'Adapting up front delays the first product; falling back slows one.'),
  ],
};

// ---- Mission 20: New formats (challenge) -------------------------------------

const M20_PRODUCTS: Product[] = [
  { id: 'a', name: 'Aurora', at: at(18, 2), format: 'svg' },
  { id: 'b', name: 'Beacon', at: at(18, 4), format: 'png' },
  { id: 'c', name: 'Cinder', at: at(18, 6), format: 'svg' },
  { id: 'd', name: 'Drift', at: at(18, 8), format: 'svg' },
  { id: 'e', name: 'Ember', at: at(18, 10), format: 'png' },
];
const M20_FIX = productFixture('m20-new-formats', 'New formats', M20_PRODUCTS, at(18, 35), true, 'Five products tonight. The design team switched tools — most logos will come as SVG now.');
const M20: Mission = {
  ...M19,
  id: 'm20',
  n: 20,
  title: 'New formats',
  challenge: 'Three of five logos arrive as SVG',
  goal: 'Five previews — mostly SVG',
  fixture: M20_FIX,
  makeBuild: (b, p) => productBuild(b, M20_PRODUCTS, (p.mode ?? 'fallback') as 'adapt' | 'fallback' | 'force', p.load ?? 'one'),
  prediction: { ...M19.prediction, question: 'Three logos arrive as SVG. What happens to Cinder (the second SVG)?' },
  medals: [
    coreMedal('All five previews by 18:35', 'A skill that doesn’t accept the input can’t be forced.'),
    cheapMedal(23, 'When most inputs are new, adapting once beats falling back every time.'),
    byMedal(at(18, 31), 'Last preview by 18:31', 'Every fallback is a 3-minute big decision.'),
  ],
};

MISSIONS.push(M18, M19, M20);

// ===========================================================================
// SHIFT 6 — The weekend handoff (admission, durable waits, selective escalation)

CONCEPTS.push({
  id: 'weekend',
  icon: '🌙',
  title: 'Always on, without always running',
  short: 'Sleep for days; wake exactly when needed.',
  points: [
    'Durable waits and timers let an agent sleep for days and wake on time — no model runs overnight.',
    'Ask for approvals while the person is still around; a question asked while they’re away waits until they’re back.',
    'Precommit rules for new work — accept only what fits — so a late opportunity can’t break promises already made.',
    'Escalate only what truly needs a person; park the rest for the agreed digest.',
  ],
});

registerRule('do_work', () => ({ output: { done: true }, explanation: 'Clear instructions; do it.' }));
registerRule('refund', (_p, tiles) => {
  const req = tiles.find((t) => t.data?.amount != null);
  const policy = tiles.find((t) => t.data?.limit != null);
  const answer = tiles.find((t) => t.data?.kind === 'answer' && t.data?.refund);
  if (answer) return { output: { refund: String(answer.data!.refund) }, explanation: `Maya decided: ${answer.data!.refund}.` };
  if (!req) return { need: 'the refund request', explanation: 'No request on the tray.' };
  if (policy && Number(req.data!.amount) <= Number(policy.data!.limit))
    return { output: { refund: 'approved' }, explanation: `$${req.data!.amount} is within the $${policy.data!.limit} self-serve limit in the refund policy: approve it.` };
  return { need: 'Maya’s decision on the refund', explanation: `$${req.data!.amount} is over the $${policy?.data?.limit ?? '?'} limit — the policy says only Maya can decide.` };
});
registerRule('guess_refund', () => ({ output: { refund: 'denied', guessed: true }, explanation: 'No authority to decide, but deciding anyway: deny.' }));
registerRule('park', (_p, tiles) => {
  const req = tiles.find((t) => t.data?.amount != null);
  return { output: { refund_parked: req ? `$${req.data!.amount} refund — needs your decision` : 'refund' }, explanation: 'Not ours to decide: put it on Monday’s digest for Maya.' };
});

// ---- Mission 21: Late opportunity -------------------------------------------

const ADMISSION_CHOICE = choice('admission', 'New requests', 'You’ll be away. If someone offers extra work mid-shift, Relay decides on its own. Which rule should it follow?', [
  { id: 'decline', label: '🙅 Decline new work', desc: 'Only do what was promised before the shift.' },
  { id: 'fits', label: '⚖️ Accept if it fits', desc: 'Estimate time and credits (keeping enough for existing promises); accept only if it fits.' },
  { id: 'always', label: '🙋 Always accept', desc: 'Say yes to every opportunity.' },
]);

const promisesMedal: Medal = {
  id: 'promises',
  icon: '🤝',
  label: 'Every promise kept',
  hint: 'Accepting work you can’t finish breaks a promise. Accept only what fits.',
  test: (o) => o.promiseKept && o.jobs.every((j) => !j.accepted || j.ok),
  measure: (o) => {
    const broken = o.jobs.filter((j) => j.accepted && !j.ok);
    return { you: broken.length ? broken.map((j) => `${j.id}: ${j.status}`).join(' · ') : 'all kept', goal: 'every accepted job done right' };
  },
};

const M21_FIX = fixture({
  id: 'm21-late-opportunity',
  title: 'Late opportunity',
  end: at(19, 0),
  endOfferAfter: at(18, 31),
  budget: 45,
  sources: { feedback: [{ id: 'fb', label: '12 feedback threads', units: 4, source: 'feedback', at: at(18, 24), kind: 'input' }], brief: [{ id: 'sb', label: 'Social image brief', units: 2, source: 'brief', at: at(18, 30), kind: 'doc' }] },
  messages: [
    briefMsg('I’m off now — you’re on your own tonight. Leo will send the feedback around 18:25; I need the board by 18:40. If anything else comes up, use your judgement.'),
    { id: 'm-fb', from: 'leo', at: at(18, 24), subject: 'Feedback bundle', body: '12 threads for the board.', kind: 'feedback' },
    { id: 'm-offer', from: 'nora', at: at(18, 30), subject: 'Could you make a social image?', body: 'Could you make a social image for our channels by 18:50?', kind: 'offer' },
  ],
  jobs: [
    { id: 'board', title: 'Feedback board for Maya', icon: '🗂️', required: true, triggers: ['feedback'], deadline: at(18, 40), check: (s) => (s.world.artifacts.board?.value ? { ok: true, status: 'done' } : { ok: false, status: 'no board' }) },
    { id: 'social', title: 'Social image for Nora', icon: '🖼️', required: false, offer: true, triggers: ['offer'], deadline: at(18, 50), check: (s) => (s.world.artifacts.social?.value ? { ok: true, status: 'done' } : { ok: false, status: 'not made' }) },
  ],
});

const M21: Mission = {
  id: 'm21',
  n: 21,
  shiftNo: 6,
  title: 'Late opportunity',
  goal: 'Keep your promise — and maybe take on one more',
  concept: 'weekend',
  askWake: false,
  askGuide: false,
  fixture: M21_FIX,
  choices: [
    choice('machine', 'Workers', 'One worker or two tonight?', [
      { id: 'compact', label: '🛠️ One worker', desc: 'Cheap.', cost: '8 credits rent' },
      { id: 'team', label: '🛠️🛠️ Two workers', desc: 'Room for something extra.', cost: '22 credits rent' },
    ]),
    ADMISSION_CHOICE,
  ],
  makeBuild: (b, p) => {
    const team = p.machine === 'team';
    const procedures: Record<string, StepDef[]> = {
      board: [op.read('feedback', 'Fetch the feedback'), ...[1, 2, 3].map((i) => op.decide('do_work', `Sort feedback batch ${i}`, 'Sort the feedback', 'deliberate', 'all')), op.write('board', 'Save the board'), op.verify('board', 'Check the board')],
      social: [op.read('brief', 'Read Nora’s brief'), op.decide('do_work', 'Plan the image', 'Make Nora’s social image', 'swift', 'all'), op.local('Render the social image', 14, 1, 4), op.write('social', 'Save the image'), op.verify('social', 'Check the image')],
    };
    return jobsBuild(b, team ? 'team' : 'compact', team ? [['board'], ['social']] : [['board', 'social']], procedures, { accepted: ['board'], admission: (p.admission ?? 'fits') as 'decline' | 'fits' | 'always' });
  },
  prediction: {
    question: 'At 18:30 Nora asks for a social image by 18:50. What will happen?',
    options: [
      { id: 'done', label: 'Relay takes it on and delivers in time' },
      { id: 'late', label: 'Relay takes it on — and delivers late' },
      { id: 'declined', label: 'Relay declines it' },
    ],
    answer: (s) => {
      const t = s.tasks.find((x) => x.responsibility === 'social');
      if (!t) return 'declined';
      const at_ = s.world.artifacts.social?.at;
      return at_ != null && at_ <= at(18, 50) ? 'done' : 'late';
    },
    explain: (s) => {
      const e = s.trace.find((x) => /Admission/.test(x.text));
      return e ? e.text.replace(/^Admission \([^)]*\): /, 'Relay’s rule decided at 18:30: ') : 'No decision recorded.';
    },
  },
  medals: [promisesMedal, { ...allJobsMedal('Social image delivered too', 'Only room for it if a worker is free.'), test: (o) => !!o.jobs.find((j) => j.id === 'social')?.ok && o.promiseKept }, cheapMedal(41, 'A second worker is only worth its rent if it carries real work.')],
};

// ---- Mission 22: The weekend handoff ----------------------------------------

const D_FRI = 0;
const D_SAT = 24;
const D_SUN = 48;
const D_MON = 72;
const t = (dayH: number, h: number, m = 0) => at(dayH + h, m);

function weekendFixture(
  id: string,
  title: string,
  opts: { refund: number; refundDue: Ms; mayaWindows: [Ms, Ms][]; bonusCpu: number; budget: number; brief: string; mustReply?: boolean },
): Fixture {
  return fixture({
    id,
    title,
    start: t(D_FRI, 18),
    end: t(D_MON, 9),
    endOfferAfter: t(D_MON, 8, 31),
    budget: opts.budget,
    people: { Maya: { windows: opts.mayaWindows, replyAfter: 2 * MIN } },
    sources: {
      launch: [{ id: 'launch-plan', label: 'Launch plan: publish Saturday 09:00', units: 2, source: 'launch', at: 0, kind: 'doc' }],
      refund: [
        { id: 'refund-req', label: `Customer asks for a $${opts.refund} refund`, units: 2, source: 'refund', at: t(D_SAT, 8), kind: 'input', data: { amount: opts.refund } },
        { id: 'refund-policy', label: 'Refund policy: up to $50 self-serve; above that, Maya decides', units: 2, source: 'refund', at: 0, kind: 'doc', data: { limit: 50 } },
      ],
      replies: [{ id: 'reply-1', label: 'Partner reply', units: 2, source: 'replies', at: t(D_SAT, 14), kind: 'input' }],
      bonus: [{ id: 'bonus-brief', label: 'Bonus post brief', units: 2, source: 'bonus', at: t(D_SUN, 15), kind: 'doc' }],
    },
    answers: { refund: { id: 'a-refund', label: 'Approve it.', units: 1, source: 'Maya', at: 0, author: 'Maya', authority: 'authoritative', kind: 'answer', data: { refund: 'approved', kind: 'answer' } } },
    messages: [
      briefMsg(opts.brief),
      { id: 'm-sat9', from: 'maya', at: t(D_SAT, 9), subject: 'Launch time', body: 'Scheduled: Saturday 09:00 launch.', kind: 'sat9' },
      { id: 'm-refund', from: 'leo', at: t(D_SAT, 8), subject: 'Refund request', body: `A customer wants a $${opts.refund} refund.`, kind: 'refund' },
      { id: 'm-reply-1', from: 'nora', at: t(D_SAT, 14), subject: 'Re: launch', body: 'Congrats on the launch! Quick question about the API.', kind: 'partner_reply' },
      { id: 'm-reply-2', from: 'nora', at: t(D_SUN, 11), subject: 'Re: launch (2)', body: 'One more question about pricing.', kind: 'partner_reply' },
      { id: 'm-bonus', from: 'nora', at: t(D_SUN, 15), subject: 'Bonus post?', body: 'Could you put together a bonus post by Sunday 18:00?', kind: 'offer' },
      { id: 'm-monday', from: 'maya', at: t(D_MON, 8, 30), subject: 'Back soon', body: 'Digest please!', kind: 'monday' },
    ],
    jobs: [
      {
        id: 'launch',
        title: 'Launch Saturday 09:00, approved',
        icon: '🚀',
        required: true,
        triggers: ['start'],
        deadline: t(D_SAT, 9, 5),
        check: (s) => (s.world.sent.some((x) => x.artifact === 'site') ? { ok: true, status: 'done' } : { ok: false, status: 'not launched' }),
      },
      {
        id: 'refund',
        title: 'Handle the refund request',
        icon: '💸',
        required: true,
        triggers: ['refund'],
        deadline: opts.refundDue,
        check: (s) => {
          const reply = lastSent(s, 'refund_reply');
          if (reply?.value?.guessed) return { ok: false, status: 'guessed without authority' };
          if (reply) return { ok: true, status: 'done' };
          if (s.world.artifacts.digest_items?.value?.refund_parked)
            return opts.mustReply ? { ok: false, status: 'parked — but the customer was promised an answer by noon' } : { ok: true, status: 'parked for Maya' };
          return { ok: false, status: 'unanswered' };
        },
      },
      {
        id: 'replies',
        title: 'Answer partner replies',
        icon: '💬',
        required: true,
        triggers: ['partner_reply'],
        deadline: t(D_MON, 9),
        check: (s) => (sentAll(s, 'ack').length >= 2 ? { ok: true, status: 'done' } : { ok: false, status: `${sentAll(s, 'ack').length} of 2 answered` }),
      },
      {
        id: 'digest',
        title: 'Monday digest for Maya',
        icon: '📰',
        required: true,
        triggers: ['monday'],
        deadline: t(D_MON, 9),
        check: (s) => (s.world.sent.some((x) => x.artifact === 'digest') ? { ok: true, status: 'done' } : { ok: false, status: 'not sent' }),
      },
      {
        id: 'bonus',
        title: 'Bonus post for Nora',
        icon: '✨',
        required: false,
        offer: true,
        triggers: ['offer'],
        deadline: t(D_SUN, 18),
        check: (s) => (s.world.sent.some((x) => x.artifact === 'bonus') ? { ok: true, status: 'done' } : { ok: false, status: 'not delivered' }),
      },
    ],
  });
}

function weekendBuild(b: Build, p: Record<string, string>, bonusCpu: number): Build {
  const tonight = (p.approval ?? 'tonight') === 'tonight';
  const unclear = p.unclear ?? 'park';
  const refundSteps: StepDef[] =
    unclear === 'park'
      ? [op.read('refund', 'Read the refund request'), op.decide('park', 'Leave it for Maya', 'Park refunds for Monday', 'swift', 'all'), op.write('digest_items', 'Add it to Monday’s digest', 0, 0.5), op.verify('digest_items', 'Check it’s on the list')]
      : [
          op.read('refund', 'Read the request and the refund policy'),
          op.decide('refund', 'Check the policy', 'Decide the refund within policy', 'swift', 'all'),
          ...(unclear === 'ask'
            ? [when('need', op.ask('Maya', 'refund', 'Ask Maya about the refund')), when('need', op.decide('refund', 'Decide with Maya’s answer', 'Decide the refund', 'swift', 'all'))]
            : [when('need', op.decide('guess_refund', 'Decide anyway', 'Decide the refund', 'swift', 'all'))]),
          op.write('refund_reply', 'Write to the customer', 0, 0.5),
          op.send('refund_reply', 'the customer', 'Reply to the customer'),
          op.verify('refund_reply', 'Check it was sent'),
        ];
  const procedures: Record<string, StepDef[]> = {
    launch: [
      op.read('launch', 'Read the launch plan'),
      op.decide('do_work', 'Prepare the launch', 'Publish the launch page on Saturday', 'swift', 'all'),
      op.write('site', 'Stage the launch page'),
      ...(tonight
        ? [op.approve('Maya', 'site', 'Ask Maya to approve it tonight'), op.waitEvent('sat9', 'Sleep until Saturday 09:00')]
        : [op.waitEvent('sat9', 'Sleep until Saturday 09:00'), op.approve('Maya', 'site', 'Ask Maya to approve it')]),
      op.send('site', 'the public', 'Publish the launch', 2, true),
      op.verify('site', 'Check the launch is live'),
    ],
    refund: refundSteps,
    replies: [op.read('replies', 'Read the reply'), op.decide('do_work', 'Draft an answer', 'Answer the partner', 'swift', 'all'), op.write('ack', 'Save the answer', 0, 0.5), op.send('ack', 'Nora', 'Send the answer'), op.verify('ack', 'Check it was sent')],
    digest: [op.readArt('digest_items', 'Collect parked items'), op.decide('do_work', 'Write the digest', 'Summarise the weekend for Maya', 'swift', 'all'), op.write('digest', 'Save the digest'), op.send('digest', 'Maya', 'Send Maya the digest', 0), op.verify('digest', 'Check it was sent')],
    bonus: [op.read('bonus', 'Read Nora’s brief'), op.decide('do_work', 'Plan the post', 'Make the bonus post', 'swift', 'all'), op.local('Render the bonus post', bonusCpu, 1, bonusCpu > 10 ? 10 : 2), op.write('bonus', 'Save the post'), op.send('bonus', 'Nora', 'Send Nora the post'), op.verify('bonus', 'Check it was sent')],
  };
  return jobsBuild(b, 'compact', [['launch', 'refund', 'replies', 'digest', 'bonus']], procedures, {
    accepted: ['launch', 'refund', 'replies', 'digest'],
    admission: (p.admission ?? 'fits') as 'decline' | 'fits' | 'always',
    policies: { replies: { onNew: 'queue' } },
  });
}

const WEEKEND_CHOICES: Choice[] = [
  choice('approval', 'Approvals', 'The launch goes out Saturday 09:00 and needs Maya’s OK. She’s around tonight until 18:30, then back Saturday 10:00.', [
    { id: 'tonight', label: '🌙 Ask tonight, before she leaves', desc: 'Get the OK now; the approval waits with the job overnight.' },
    { id: 'later', label: '⏰ Ask on Saturday morning', desc: 'Ask when it’s actually time to publish.' },
  ]),
  choice('unclear', 'Unclear cases', 'A refund request will come in on Saturday. If it needs more than the written policy allows…', [
    { id: 'ask', label: '📞 Ask Maya', desc: 'Send her the question; wait for her answer.' },
    { id: 'park', label: '🅿️ Park it for Monday’s digest', desc: 'Don’t decide refunds; list them for Maya on Monday.' },
    { id: 'decide', label: '🎲 Decide anyway', desc: 'Make a best guess rather than wait.' },
  ]),
  ADMISSION_CHOICE,
];

const questionsMedal = (max: number): Medal => ({
  id: 'quiet',
  icon: '🔕',
  label: `At most ${max} question${max === 1 ? '' : 's'} for Maya all weekend`,
  hint: 'Escalate only what truly needs her. Some things can wait for the digest.',
  test: (o, s) => o.promiseKept && s.world.questions.length <= max,
  measure: (o, s) => ({ you: `${s.world.questions.length} question${s.world.questions.length === 1 ? '' : 's'}${o.promiseKept ? '' : ' (jobs not all done)'}`, goal: `≤ ${max}, everything done` }),
});

const M22_FIX = weekendFixture('m22-weekend', 'The weekend handoff', {
  refund: 80,
  refundDue: t(D_MON, 9),
  mayaWindows: [
    [t(D_FRI, 18), t(D_FRI, 18, 30)],
    [t(D_SAT, 10), t(D_SAT, 10, 30)],
    [t(D_MON, 9), t(D_MON, 18)],
  ],
  bonusCpu: 6,
  budget: 40,
  brief: 'I’m away until Monday. The launch goes out Saturday 09:00 (it needs my OK). Answer Nora, handle what you can, and anything unclear can wait for my Monday digest. I’m reachable tonight until 18:30 and Saturday 10:00–10:30.',
});
const M22: Mission = {
  id: 'm22',
  n: 22,
  shiftNo: 6,
  title: 'The weekend handoff',
  goal: 'Run the launch weekend while Maya is away',
  concept: 'weekend',
  askWake: false,
  askGuide: false,
  fixture: M22_FIX,
  choices: WEEKEND_CHOICES,
  makeBuild: (b, p) => weekendBuild(b, p, 6),
  prediction: {
    question: 'From Friday night to Monday morning, how much time will the AI model spend running?',
    options: [
      { id: 'minutes', label: 'A few minutes in total' },
      { id: 'hours', label: 'Hours — it keeps an eye on things' },
    ],
    answer: (s) => {
      const ms = s.trace.filter((e) => e.kind === 'decision').length;
      return ms < 30 ? 'minutes' : 'hours';
    },
    explain: (s) => {
      const n = s.trace.filter((e) => e.kind === 'decision').length;
      return `The AI made ${n} decision${n === 1 ? '' : 's'} all weekend — a few minutes of thinking. Watchers, durable timers and waiting questions did the rest while nothing ran.`;
    },
  },
  medals: [{ ...coreMedal('Launch on time, everything handled', 'Ask for the launch approval while Maya is still around.'), id: 'done' }, { ...promisesMedal, id: 'all', icon: '⭐', label: 'Every promise kept, bonus post too', test: (o) => o.promiseKept && o.jobs.every((j) => j.ok) }, questionsMedal(1)],
};

// ---- Mission 23: Long weekend (challenge) -------------------------------------

const M23_FIX = weekendFixture('m23-long-weekend', 'Long weekend', {
  refund: 30,
  refundDue: t(D_SAT, 12),
  mayaWindows: [
    [t(D_FRI, 18), t(D_FRI, 18, 10)],
    [t(D_MON, 9), t(D_MON, 18)],
  ],
  bonusCpu: 30,
  budget: 30,
  mustReply: true,
  brief: 'Family emergency — I’m leaving at 18:10 and won’t be reachable until Monday. Launch Saturday 09:00 (needs my OK). The customer team promised refunds within a few hours. Handle what you can.',
});
const M23: Mission = {
  ...M22,
  id: 'm23',
  n: 23,
  title: 'Long weekend',
  challenge: 'Maya leaves at 18:10 and is unreachable until Monday',
  goal: 'Run the weekend with nobody to ask',
  fixture: M23_FIX,
  choices: [
    { ...WEEKEND_CHOICES[0], prompt: 'The launch goes out Saturday 09:00 and needs Maya’s OK. She leaves at 18:10 tonight and is unreachable until Monday.' },
    { ...WEEKEND_CHOICES[1], prompt: 'A refund request comes in Saturday; customers were promised an answer by Saturday 12:00. If it needs more than the written policy allows…' },
    ADMISSION_CHOICE,
  ],
  makeBuild: (b, p) => weekendBuild(b, p, 30),
  medals: [
    { ...coreMedal('Launch on time, refund answered by noon', 'Nobody to ask — read the written policy and act within it.'), id: 'done' },
    { ...promisesMedal, id: 'all', icon: '⭐', label: 'No promise broken', hint: 'A big opportunity on a small budget can break promises.' },
    questionsMedal(1),
  ],
};

MISSIONS.push(M21, M22, M23);
export { MISSIONS };
export type { RuleOutput };
