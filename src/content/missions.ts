// Missions: short, replayable lessons built on the same simulation. Each teaches one concept,
// asks the player to predict an outcome before running, and awards medals for real tradeoffs
// (getting the job done, spending less, finishing sooner, needing no help).
import { at, fmtTime, type Fixture, type Ms, type SimState } from '../sim/types';
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
    short: 'Coming in the next missions.',
    points: [],
  },
  { id: 'memory', icon: '🗂️', title: 'Memory', short: 'Coming later.', points: [] },
  { id: 'parallel', icon: '🧑‍🤝‍🧑', title: 'Two workers', short: 'Coming later.', points: [] },
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

export const COMING_SOON = [
  { n: 4, title: 'Hands off', concept: 'permissions' as ConceptId },
  { n: 5, title: 'The evening shift', concept: 'parallel' as ConceptId },
];
