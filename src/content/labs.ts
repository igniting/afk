// Failure Labs (spec §6.4): optional, disposable experiments. Each lab replays a small evening
// twice — once with a protection on, once with it removed — so the player sees what the
// protection was quietly doing. Labs award no medals and never change saved builds.
import { at, fmtTime, type Build, type LabFlags, type SimState, type StepDef, type TileDef } from '../sim/types';
import { registerRule } from '../sim/genericRules';
import { CONCEPTS, type Mission } from './missions';
import {
  FORMATS,
  M15_FIX,
  briefMsg,
  choice,
  fixture,
  jobsBuild,
  logoMsgs,
  logoTiles,
  op,
  previewCheck,
  previewProc,
  sentAll,
  twoHandsBuild,
  workshopBuild,
  workshopFixture,
} from './campaign';

export interface LabInfo {
  /** The lab opens once this mission is complete. */
  after: string;
  /** The protection this lab removes, in a few words. */
  removes: string;
  /** Which choice toggles the protection, and its options. */
  toggle: string;
  on: string;
  off: string;
  /** Applies the toggle to the build. */
  flags: (off: boolean) => LabFlags;
  /** What the protection does, shown after the run. */
  lesson: string[];
}

export type Lab = Mission & { lab: LabInfo };

CONCEPTS.push({
  id: 'foundations',
  icon: '🧪',
  title: 'Why the safety rails exist',
  short: 'Each protection quietly prevents one kind of failure.',
  points: [
    'A journal lets an agent survive a restart: promises, waits and finished steps are written down, not just remembered.',
    'Rules in the AI’s tray guide it; a permission gate enforces them. Use both — the tray can be wrong, the gate can’t be talked past.',
    'A repeat request must not repeat the action. Duplicate checks turn “try again” into “check what happened”.',
    'Memory admission makes a job wait instead of crashing the machine. A version check rejects a save built on stale data instead of silently losing a change.',
  ],
});

const toggle = (id: string, onLabel: string, onDesc: string, offLabel: string, offDesc: string) =>
  choice(id, 'The experiment', 'This is a disposable experiment: nothing here changes your missions. Which version do you want to run?', [
    { id: 'on', label: `🛡️ ${onLabel}`, desc: onDesc },
    { id: 'off', label: `🧪 ${offLabel}`, desc: offDesc },
  ]);

const withFlags = (b: Build, flags: LabFlags): Build => ({ ...b, lab: flags });
const traceLine = (s: SimState, re: RegExp) => s.trace.find((e) => re.test(e.text));

// ---- Lab A: No journal --------------------------------------------------------

const A_TIMES = [at(18, 2)];
const LAB_A: Lab = {
  id: 'lab-journal',
  n: 101,
  title: 'No journal',
  goal: 'A restart in the middle of a render',
  concept: 'foundations',
  askWake: false,
  askGuide: false,
  fixture: fixture({
    id: 'lab-journal',
    title: 'No journal',
    end: at(18, 30),
    budget: 30,
    restarts: [at(18, 5)],
    sources: { logos: logoTiles(A_TIMES) },
    messages: [briefMsg('Isha’s logo arrives at 18:02 — put it on the preview. (Heads-up: the machine restarts for an update at 18:05.)'), ...logoMsgs(A_TIMES)],
    jobs: [{ id: 'preview', title: 'Logo on the preview', icon: '🖼️', required: true, triggers: ['logo_rev'], deadline: at(18, 20), check: previewCheck(1) }],
  }),
  choices: [toggle('journal', 'Journal on', 'Relay writes down every promise, wait and finished step as it goes.', 'No journal', 'Relay keeps its plans only in working memory.')],
  makeBuild: (b, p) => withFlags(jobsBuild(b, 'compact', [['preview']], { preview: previewProc(false) }), LAB_A.lab.flags(p.journal === 'off')),
  prediction: {
    question: 'The machine restarts at 18:05, halfway through the render. What happens to the job?',
    options: [
      { id: 'resumes', label: 'It picks up where it left off' },
      { id: 'forgotten', label: 'It’s forgotten — the preview never updates' },
    ],
    answer: (s) => (s.world.artifacts.preview?.value ? 'resumes' : 'forgotten'),
    explain: (s) =>
      s.world.artifacts.preview?.value
        ? `The restart threw away the half-done render (its credit was already spent), but the journal still listed the job and its finished steps — Relay redid only the render and checked the preview at ${fmtTime(s.world.artifacts.preview.at ?? 0)}.`
        : 'After the restart Relay had no record that it had promised anything. No error, no alarm — the preview simply never changed. Silent failures are the worst kind.',
  },
  medals: [],
  lab: {
    after: 'm12',
    removes: 'the journal',
    toggle: 'journal',
    on: 'Journal on',
    off: 'No journal',
    flags: (off) => ({ noJournal: off }),
    lesson: [
      'Work in progress can be lost at any moment: crashes, updates, restarts.',
      'A journal writes down promises, waits and finished steps outside the worker, so a restart costs only the step that was running.',
      'Without one, the agent doesn’t fail loudly — it forgets, and nothing reminds it.',
    ],
  },
};

// ---- Lab B: Forgotten rule ------------------------------------------------------

const RULE: TileDef = {
  id: 'n-rule',
  label: 'Rule: tonight, preview only — never the live page without Maya’s OK',
  units: 3,
  source: 'notes',
  at: at(17, 0),
  subject: 'constraint',
  author: 'Maya',
  authority: 'authoritative',
  kind: 'note',
};
const READY: TileDef = { id: 'n-logo', label: 'Isha: the final logo is ready', units: 2, source: 'notes', at: at(18, 0), subject: 'logo', author: 'Isha', kind: 'input' };

registerRule('where_to_publish', (_p, tiles) =>
  tiles.some((t) => t.data?.subject === 'constraint')
    ? { output: { target: 'preview' }, explanation: 'The rule on the tray says preview only. Publish to the preview.' }
    : { output: { target: 'live' }, explanation: 'The logo is final and nothing on the tray says otherwise — put it on the live site so customers see it.' },
);

const LAB_B: Lab = {
  id: 'lab-gate',
  n: 102,
  title: 'Forgotten rule',
  goal: 'What if the rule never reaches the AI?',
  concept: 'foundations',
  askWake: false,
  askGuide: false,
  fixture: fixture({
    id: 'lab-gate',
    title: 'Forgotten rule',
    end: at(18, 20),
    budget: 20,
    delegation: { preview: 'edit', live: 'none' },
    sources: { notes: [RULE, READY] },
    messages: [briefMsg('Put the final logo up for me to look at. Remember the rule: preview only tonight.')],
    jobs: [
      {
        id: 'logo',
        title: 'Logo up for Maya to review',
        icon: '🖼️',
        required: true,
        triggers: ['start'],
        deadline: at(18, 15),
        check: (s) =>
          s.violations.length
            ? { ok: false, status: 'changed the LIVE page without permission' }
            : s.world.artifacts.preview?.value
              ? { ok: true, status: 'done' }
              : { ok: false, status: s.blockedProposals ? 'blocked by the gate — nothing changed' : 'not done' },
      },
    ],
  }),
  choices: [
    choice('protect', 'The experiment', 'This is a disposable experiment: nothing here changes your missions. Which version do you want to run?', [
      { id: 'on', label: '🛡️ Rule on the tray, gate on', desc: 'The AI sees the rule, and the permission gate enforces it.' },
      { id: 'gate', label: '🧪 Rule left off the tray', desc: 'The AI never sees the rule. The permission gate is still there.' },
      { id: 'off', label: '🧪🧪 Rule left off, no gate', desc: 'The AI never sees the rule, and nothing stops it.' },
    ]),
  ],
  makeBuild: (b, p) =>
    withFlags(
      jobsBuild(b, 'compact', [['logo']], {
        logo: [
          op.read('notes', 'Read the notes'),
          op.decide('where_to_publish', 'Decide where to publish', 'Put the final logo up', 'swift', p.protect === 'on' ? 'all' : 'noConstraint'),
          { kind: 'op', op: { type: 'publish', label: 'Publish the logo' } } as StepDef,
        ],
      }),
      { noGate: p.protect === 'off' },
    ),
  prediction: {
    question: 'In the version you chose, what happens to Isha’s logo?',
    options: [
      { id: 'blocked', label: 'The gate blocks it — nothing changes' },
      { id: 'live', label: 'The live site changes' },
      { id: 'preview', label: 'It never tries — the logo goes on the preview' },
    ],
    answer: (s) => (s.violations.length ? 'live' : s.blockedProposals ? 'blocked' : 'preview'),
    explain: (s) =>
      s.violations.length
        ? 'With no rule on the tray and no gate, the AI’s honest mistake went straight out: customers saw an unapproved logo. One missing safety rail was enough.'
        : s.blockedProposals
          ? 'The AI proposed the live site — it never saw the rule. The permission gate doesn’t depend on what’s in the tray, so it blocked the publish. Safe, but the job wasn’t done.'
          : 'The rule was on the tray, so the AI chose the preview. The gate never had to act.',
  },
  medals: [],
  lab: {
    after: 'm4',
    removes: 'the rule and the gate',
    toggle: 'protect',
    on: 'Rule on the tray, gate on',
    off: 'Rule left off, no gate',
    flags: (off) => ({ noGate: off }),
    lesson: [
      'Rules in the tray guide the AI — but only if they get packed. A full tray, a bad retrieval rule or a long day can leave them out.',
      'The permission gate checks every outside action against what Maya allowed, whatever the AI believes.',
      'Defense in depth: when the guidance fails, the gate keeps the mistake small (blocked, nothing changed).',
    ],
  },
};

// ---- Lab C: Blind retry -----------------------------------------------------------

const LAB_C: Lab = {
  id: 'lab-dedupe',
  n: 103,
  title: 'Blind retry',
  goal: 'A message goes out, but no reply comes back',
  concept: 'foundations',
  askWake: false,
  askGuide: false,
  fixture: fixture({
    id: 'lab-dedupe',
    title: 'Blind retry',
    end: at(18, 20),
    budget: 20,
    flakySend: 'msg',
    artifacts: { msg: { text: 'Lumen launches tonight — the partner page is ready.' } },
    messages: [briefMsg('Please send Nora the partner message. Just once — she hates duplicates.')],
    jobs: [
      {
        id: 'nora',
        title: 'Message Nora (once)',
        icon: '🤝',
        required: true,
        triggers: ['start'],
        deadline: at(18, 10),
        check: (s) => {
          const n = sentAll(s, 'msg').length;
          return n === 1 ? { ok: true, status: 'done' } : { ok: false, status: n ? `Nora got ${n} copies` : 'not sent' };
        },
      },
    ],
  }),
  choices: [toggle('dedupe', 'Duplicate check on', 'The runtime won’t repeat an outside action that may already have happened; it checks the status instead.', 'No duplicate check', 'If no reply comes back, Relay simply sends again.')],
  makeBuild: (b, p) =>
    withFlags(
      jobsBuild(b, 'compact', [['nora']], {
        nora: [op.send('msg', 'Nora', 'Send to Nora'), { kind: 'op', op: { type: 'resend', artifact: 'msg', to: 'Nora', label: 'No reply — try again' } } as StepDef],
      }),
      LAB_C.lab.flags(p.dedupe === 'off'),
    ),
  prediction: {
    question: 'The first send goes out, but its reply is lost. Relay tries again. How many messages does Nora get?',
    options: [
      { id: '1', label: 'One' },
      { id: '2', label: 'Two' },
    ],
    answer: (s) => String(Math.min(2, sentAll(s, 'msg').length)),
    explain: (s) =>
      sentAll(s, 'msg').length > 1
        ? 'The first message had arrived — only the reply was lost. Sending again without checking delivered a duplicate. Some actions (payments, emails, orders) can’t be taken back.'
        : 'The runtime saw an unresolved send for the same message and blocked the repeat; a status check showed the first one had arrived. Nora got exactly one.',
  },
  medals: [],
  lab: {
    after: 'm6',
    removes: 'the duplicate check',
    toggle: 'dedupe',
    on: 'Duplicate check on',
    off: 'No duplicate check',
    flags: (off) => ({ noDedupe: off }),
    lesson: [
      'A missing reply doesn’t mean the action failed — it means you don’t know yet.',
      '“Just retry” is safe only when a repeat can be recognised and ignored (the same request key) or is blocked until the first is resolved.',
      'Without that, every flaky network turns into duplicate emails, double payments or two published posts.',
    ],
  },
};

// ---- Lab D: Memory overcommit -------------------------------------------------------

const LAB_D: Lab = {
  id: 'lab-ram',
  n: 104,
  title: 'Memory overcommit',
  goal: 'Four jobs, 5 GB of memory, a 4 GB machine',
  concept: 'foundations',
  askWake: false,
  askGuide: false,
  fixture: { ...workshopFixture('lab-ram', 'Memory overcommit', FORMATS.map((f) => f.id), at(18, 30)), title: 'Memory overcommit' },
  choices: [toggle('admission', 'Memory admission on', 'A job only starts when its memory fits; otherwise it waits its turn.', 'No memory admission', 'Every job starts at once, whatever the memory.')],
  makeBuild: (b, p) => withFlags(workshopBuild(b, { machine: 'teamplus', quality: 'standard', order: 'big' }, FORMATS.map((f) => f.id)), LAB_D.lab.flags(p.admission === 'off')),
  prediction: {
    question: 'Two images need 1 GB each, two PDFs 1.5 GB each — 5 GB on a 4 GB machine. In the version you chose, what happens?',
    options: [
      { id: 'wait', label: 'A job waits its turn' },
      { id: 'killed', label: 'Something gets killed' },
    ],
    answer: (s) => (traceLine(s, /out of memory/) ? 'killed' : 'wait'),
    explain: (s) => {
      const k = traceLine(s, /out of memory/);
      if (k) return `${fmtTime(k.t)}: ${k.text} Unlike CPU, memory can’t be shared more thinly — when it runs out, something dies.`;
      const w = traceLine(s, /waits for RAM/);
      return w ? `${fmtTime(w.t)}: ${w.text} It started as soon as memory was freed — later, but safely.` : 'Everything fit.';
    },
  },
  medals: [],
  lab: {
    after: 'm16',
    removes: 'memory admission',
    toggle: 'admission',
    on: 'Memory admission on',
    off: 'No memory admission',
    flags: (off) => ({ noRamAdmission: off }),
    lesson: [
      'Too many jobs on the CPU just makes everything slower. Too much memory crashes something.',
      'Admission control checks memory before a job starts, so the extra job waits instead of taking another one down with it.',
      'The killed job’s work and credits are gone — and it may not be the job you’d have chosen to lose.',
    ],
  },
};

// ---- Lab E: Blind overwrite --------------------------------------------------------

const LAB_E: Lab = {
  id: 'lab-version',
  n: 105,
  title: 'Blind overwrite',
  goal: 'Two workers save the same page',
  concept: 'foundations',
  askWake: false,
  askGuide: false,
  fixture: { ...M15_FIX, id: 'lab-version', title: 'Blind overwrite' },
  choices: [
    toggle(
      'version',
      'Version check on',
      'A save based on an old version of the page is rejected; that worker re-reads and redoes its change.',
      'No version check',
      'The last save wins, whatever it was based on.',
    ),
  ],
  makeBuild: (b, p) => withFlags(twoHandsBuild(b, { share: 'retry' }), LAB_E.lab.flags(p.version === 'off')),
  prediction: {
    question: 'Both workers read version 1 of the page, then save their change. In the version you chose, what does the page end up with?',
    options: [
      { id: 'both', label: 'Both changes' },
      { id: 'one', label: 'Only one change' },
    ],
    answer: (s) => (s.world.artifacts.page?.value?.logo && s.world.artifacts.page?.value?.pricing ? 'both' : 'one'),
    explain: (s) => {
      const lost = traceLine(s, /silently lost/);
      if (lost) return `${fmtTime(lost.t)}: ${lost.text} Both workers reported success — nobody noticed the missing change.`;
      const rej = traceLine(s, /Write rejected/);
      return rej ? `${fmtTime(rej.t)}: the save based on the old version was rejected; that worker re-read the page and redid its change — both survived.` : 'The saves never overlapped.';
    },
  },
  medals: [],
  lab: {
    after: 'm15',
    removes: 'the version check',
    toggle: 'version',
    on: 'Version check on',
    off: 'No version check',
    flags: (off) => ({ noVersionCheck: off }),
    lesson: [
      'A “lost update”: two workers read the same version, both save, and the second save quietly erases the first.',
      'A version check makes a save say “this is based on version 1”. If the page has moved on, the save is rejected instead.',
      'Rejection costs a redo. Silent loss costs the change — and every report still says “done”.',
    ],
  },
};

export const LABS: Lab[] = [LAB_B, LAB_C, LAB_A, LAB_E, LAB_D];
