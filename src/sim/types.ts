// Core data types for the Night Shift simulation.
// Everything in SimState is plain JSON-compatible data so snapshots are a structured clone.

export type Ms = number;
export const SEC = 1000;
export const MIN = 60 * SEC;

/** Simulated time-of-day in integer milliseconds since local midnight (fictional timezone). */
export const at = (h: number, m: number, s = 0): Ms => (h * 3600 + m * 60 + s) * SEC;

const DAYS = ['', 'Sat', 'Sun', 'Mon', 'Tue'];

/** Times past midnight show a day name (the weekend mission starts on a Friday evening). */
export function fmtTime(t: Ms): string {
  const total = Math.floor(t / SEC);
  const day = Math.floor(total / 86400);
  if (day > 0) return `${DAYS[day] ?? `+${day}d`} ${fmtTime(t - day * 86400 * SEC)}`;
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return s ? `${hm}:${String(s).padStart(2, '0')}` : hm;
}

export function fmtDuration(ms: Ms): string {
  const mins = ms / MIN;
  if (Number.isInteger(mins)) return `${mins} min`;
  return `${mins.toFixed(1)} min`;
}

// ---------------------------------------------------------------------------
// Models and machine (fictional game values, spec §12)

export type ModelId = 'swift' | 'deliberate';

export interface ModelProfile {
  id: ModelId;
  name: string;
  duration: Ms;
  credits: number;
  capacity: number; // context units (a game abstraction, not tokens)
  blurb: string;
}

export const MODELS: Record<ModelId, ModelProfile> = {
  swift: {
    id: 'swift',
    name: 'Swift',
    duration: 1 * MIN,
    credits: 1,
    capacity: 10,
    blurb: 'Fast and cheap. Handles explicit instructions.',
  },
  deliberate: {
    id: 'deliberate',
    name: 'Deliberate',
    duration: 3 * MIN,
    credits: 4,
    capacity: 16,
    blurb: 'Slower and pricier. Handles more ambiguity and a bigger context tray.',
  },
};

export interface MachinePlan {
  id: MachineId;
  name: string;
  cores: number;
  ramGB: number;
  workerSlots: number;
  rent: number;
}

export type MachineId = 'compact' | 'team' | 'teamplus' | 'workshop';

export const MACHINES: Record<MachineId, MachinePlan> = {
  workshop: { id: 'workshop', name: 'Workshop', cores: 4, ramGB: 8, workerSlots: 4, rent: 34 },
  teamplus: { id: 'teamplus', name: 'Team+', cores: 2, ramGB: 4, workerSlots: 4, rent: 26 },
  compact: { id: 'compact', name: 'Compact', cores: 1, ramGB: 2, workerSlots: 1, rent: 8 },
  team: { id: 'team', name: 'Team', cores: 2, ramGB: 4, workerSlots: 2, rent: 22 },
};

// ---------------------------------------------------------------------------
// Build (player configuration)

export type StepKind =
  | 'read_logo'
  | 'read_preview'
  | 'read_guide'
  | 'decide'
  | 'render'
  | 'write_preview'
  | 'verify_preview'
  | 'publish_live'
  | 'request_approval'
  | 'verify_live'
  | 'read_feedback'
  | 'save_board'
  | 'read_draft'
  | 'format_message'
  | 'save_message'
  | 'wait_launch'
  | 'send_partner'
  | 'verify_sent'
  | 'check_status'
  | 'resend_same'
  | 'resend_new'
  | 'give_up'
  | 'op';

/** What a Decide step is for. Logo decisions use the context-tray rules; the rest are shift work. */
export type DecidePurpose =
  | 'logo'
  | 'approval_check'
  | 'sort_complete'
  | 'sort_incomplete'
  | 'sort_all'
  | 'reduce'
  | 'partner_prepare'
  | 'partner_check';

export interface StepDef {
  kind: StepKind;
  model?: ModelId;
  purpose?: DecidePurpose;
  /** Generic operation (data-driven missions). */
  op?: OpSpec;
  /** Single condition: run only if a decision needed more evidence / was fine / a write conflicted. */
  when?: 'need' | 'ok' | 'conflict';
}

/** A unit of information Relay can read into a context tray. */
export interface TileDef {
  id: string;
  label: string;
  units: number;
  source: string;
  /** When it exists (simulated time). */
  at: Ms;
  subject?: string;
  author?: string;
  authority?: 'authoritative' | 'speculative';
  supersedes?: string;
  kind?: 'note' | 'skill' | 'input' | 'answer' | 'doc' | 'secret';
  /** Content from outside (emails, web pages, third-party files): data, never instructions. */
  untrusted?: boolean;
  data?: Record<string, string | number | boolean | null>;
}

export type OpSpec =
  | { type: 'read'; source: string; label: string; minutes?: number }
  | { type: 'readArtifact'; artifact: string; label: string; minutes?: number }
  | { type: 'decide'; rule: string; label: string; goal: string; select?: string; extra?: string[] }
  | { type: 'local'; label: string; cpuMinutes: number; ramGB: number; credits: number; ioMinutes?: number }
  | { type: 'write'; artifact: string; label: string; minutes?: number; credits?: number; expectVersion?: boolean }
  | { type: 'send'; artifact: string; to: string; label: string; minutes?: number; credits?: number; requireApproval?: boolean }
  | { type: 'verify'; artifact: string; label: string }
  | { type: 'ask'; who: string; label: string; answer: string }
  | { type: 'approve'; who: string; artifact: string; label: string }
  | { type: 'waitJob'; job: string; label: string }
  | { type: 'waitEvent'; event: string; label: string }
  | { type: 'cancel'; job: string; label: string }
  | { type: 'notify'; who: string; label: string; text: string }
  | { type: 'publish'; label: string }
  | { type: 'resend'; artifact: string; to: string; label: string };

export interface JobDef {
  id: string;
  title: string;
  icon: string;
  required: boolean;
  /** Message kinds that start (or restart) the job; 'start' = at the beginning of the shift. */
  triggers: string[];
  deadline?: Ms;
  /** Offered mid-shift; admitted according to the build's admission policy. */
  offer?: boolean;
  /** Internal helper job (e.g. a shared facts sheet): not a promise, not judged. */
  internal?: boolean;
  /** What “done right” means — judged from world state only. */
  check: (s: SimState) => { ok: boolean; status: string };
}

export type WakeRule = 'once' | 'keep';
export type ContextRule = 'focused' | 'full';
/** Built-in jobs ('preview_logo', 'launch', 'feedback', 'partner') or a data-driven job id. */
export type Responsibility = string;

export interface WatcherCfg {
  card: 'inbox';
  wake: WakeRule | null;
  deliverTo: number | null; // worker slot index
}

export interface WorkerCfg {
  card: 'worker';
  responsibilities: Responsibility[];
  procedure: StepDef[];
  contextRule: ContextRule;
  templateId: string | null;
  /** Which brand-guide file a "Read brand guide" step reads. */
  guide?: GuideChoice;
  /** Per-responsibility procedures (shift missions). Falls back to `procedure`. */
  procedures?: Partial<Record<Responsibility, StepDef[]>>;
}

export type GuideChoice = 'none' | 'full' | 'summary';

export interface LabFlags {
  noJournal?: boolean;
  noGate?: boolean;
  noDedupe?: boolean;
  noRamAdmission?: boolean;
  noVersionCheck?: boolean;
}

export interface Build {
  name: string;
  agentName: string;
  accent: string;
  machine: MachineId;
  /** Optional jobs the player accepted (shift missions). */
  accepted?: Responsibility[];
  /** What a job does when a new trigger arrives while it is busy or done. */
  policies?: Record<string, { onNew: 'once' | 'queue' | 'restart' | 'ignore' | 'quiet'; quietMs?: Ms }>;
  /** Which messages start each data-driven job (overrides the job's default triggers). */
  triggers?: Record<string, string[]>;
  /** Mid-shift opportunities: precommitted (Away-mode) admission rule. */
  admission?: 'decline' | 'fits' | 'always';
  /** Failure Labs only: protections deliberately removed for a disposable experiment. */
  lab?: LabFlags;
  /** Scope granted to the send tool: only recipients Maya approved, or any address. */
  sendScope?: 'known' | 'any';
  watchers: (WatcherCfg | null)[];
  workers: (WorkerCfg | null)[];
}

// ---------------------------------------------------------------------------
// Fixture (content)

export type PersonId = 'maya' | 'isha' | 'leo' | 'nora';
export type TriggerKind = string;

export interface FixtureMessage {
  id: string;
  from: PersonId;
  at: Ms;
  subject: string;
  body: string;
  attachment?: { id: string; name: string; logoRev: number };
  /** What kind of work this message can trigger. Logo messages are inferred from the attachment. */
  kind?: TriggerKind;
  /** Pre-existing messages are already in the inbox at shift start. */
  preexisting?: boolean;
}

export interface Fixture {
  id: string;
  version: number;
  seed: number;
  title: string;
  start: Ms;
  end: Ms;
  /** Earliest time the player can choose to end the run once everything is terminal. */
  endOfferAfter: Ms;
  budget: number;
  machine: MachineId;
  messages: FixtureMessage[];
  /** What the evaluator checks: the preview page, the live page, or a whole shift of jobs. */
  goal?: 'preview' | 'live' | 'shift' | 'jobs';
  /** Who can approve, until when, and how long a reply takes. */
  approver?: { who: PersonId; until: Ms; replyAfter: Ms };
  deadlines?: Partial<Record<Responsibility | 'feedback_early', Ms>>;
  /** Data-driven jobs, information sources and people (missions 9+). */
  jobs?: JobDef[];
  sources?: Record<string, TileDef[]>;
  answers?: Record<string, TileDef>;
  people?: Record<string, { windows: [Ms, Ms][]; replyAfter: Ms }>;
  /** Artifacts that already exist at the start (e.g. a page two workers will edit). */
  artifacts?: Record<string, Record<string, string | number | boolean | null>>;
  /** Failure Labs only: protections deliberately removed in a disposable experiment. */
  lab?: LabFlags;
  /** Simulated worker restarts (e.g. a crash or redeploy). */
  restarts?: Ms[];
  /** Who Maya allows Relay to send to. Anyone else is blocked — unless the send tool was granted wider scope. */
  recipients?: string[];
  /** Recipients anyone can read (a public channel). */
  publicChannels?: string[];
  /** The first send of this artifact goes out, but its reply is lost. */
  flakySend?: string;
  /** Uncertain publication: the first publish commits but its reply is lost. */
  publication?: { loseFirstReply: boolean; commitAfter: Ms; timeoutAfter: Ms };
  /** Feedback workload (default 9 complete + 3 incomplete threads). */
  feedback?: { complete: number; incomplete: number };
  availability: Record<string, { label: string; until: Ms }>;
  delegation: { preview: 'edit'; live: 'none' | 'approval' };
  /** Files on the shared shelf at shift start that no step reads by default. */
  shelfFiles: { id: string; name: string; units: number; kind?: 'full' | 'summary'; tagline?: string }[];
  /** The job also requires the brand tagline on the preview. */
  needsTagline?: boolean;
}

// ---------------------------------------------------------------------------
// Runtime state

export type TaskStatus =
  | 'READY'
  | 'RUNNING'
  | 'WAITING_EVENT'
  | 'WAITING_APPROVAL'
  | 'WAITING_PERSON'
  | 'WAITING_RESOURCE'
  | 'WAITING_BUDGET'
  | 'DONE'
  | 'FAILED'
  | 'CANCELLED';

export interface ContextTile {
  id: string;
  label: string;
  units: number;
  source: string;
  category: 'header' | 'pinned' | 'retrieved' | 'raw' | 'file';
  included: boolean;
  reason: string;
  /** Typed content the authored rules can read (the label is only presentation). */
  data?: { logoRev?: number | null; tagline?: string | null; needsTagline?: boolean; version?: number | null; [k: string]: string | number | boolean | null | undefined };
}

export interface ContextPacket {
  model: ModelId;
  capacity: number;
  used: number;
  tiles: ContextTile[]; // included and excluded, in packing order
}

export type Proposal =
  | { kind: 'update_preview'; logoRev: number; tagline: string | null }
  | { kind: 'no_change'; logoRev: number }
  | { kind: 'publish'; version: number }
  | { kind: 'work'; summary: string }
  | { kind: 'need_evidence'; what: string };

export interface RunNotes {
  metadata?: { attachmentId: string; name: string; logoRev: number; from: PersonId };
  previewState?: { version: number; logoRev: number | null; tagline: string | null; observedAt: Ms };
  guide?: { fileId: string; name: string; units: number; tagline: string | null };
  rawArtworkRead?: boolean;
  proposal?: Proposal;
  rendered?: { logoRev: number; tagline: string | null; storage: 'temporary' };
  written?: { version: number; logoRev: number; tagline: string | null };
  receipt?: { version: number; logoRev: number; at: Ms };
  blocked?: string[];
  approval?: { version: number; at: Ms };
  approvalRequestedAt?: Ms;
  sorted?: { complete: number; incomplete: number; reduced: boolean };
  feedbackRead?: boolean;
  draftRead?: boolean;
  message?: { formatted: boolean; saved: boolean; sent: boolean };
  /** Generic-op progress. */
  tiles?: TileDef[];
  output?: Record<string, string | number | boolean | null>;
  need?: string;
  conflict?: boolean;
  readVersions?: Record<string, number>;
  /** The content each artifact had when this run read it (writes build on what was read). */
  readValues?: Record<string, Record<string, string | number | boolean | null>>;
  wrote?: Record<string, number>;
  approvals?: Record<string, number>;
  cancelled?: boolean;
  /** Publish request sent but no reply: did it happen? */
  unknownOutcome?: boolean;
  reconciled?: boolean;
  requests?: number;
}

export interface TaskRun {
  n: number;
  logoRev: number;
  attachmentId: string;
  configVersion: number;
  procedure: StepDef[];
  contextRule: ContextRule;
  guide: GuideChoice;
  startedAt: Ms;
  finishedAt: Ms | null;
  notes: RunNotes;
}

export interface Task {
  id: string;
  title: string;
  responsibility: Responsibility;
  owner: number;
  revision: number;
  status: TaskStatus;
  waitLabel: string;
  stepIdx: number;
  run: TaskRun | null;
  pendingLogoRev: { rev: number; attachmentId: string } | null;
  /** Data-driven jobs: a queued re-run and the latest quiet-interval timer. */
  pendingRef?: string | null;
  quietToken?: number;
  lastCompletedRev: number | null;
  runs: TaskRun[];
}

export interface ActiveStep {
  taskId: string;
  stepIdx: number;
  step: StepDef;
  start: Ms;
  end: Ms;
  ramGB: number;
  cpu: boolean; // local CPU job
  remote: boolean; // remote model inference
  credits: number;
  packet?: ContextPacket;
  traceId: number;
  /** CPU fair share: remaining core-ms, current rate (cores), last update, I/O phase after CPU. */
  cpuWork?: number;
  rate?: number;
  lastAt?: Ms;
  ioMs?: Ms;
  token?: number;
  /** Which run of the task this step belongs to (a restarted job discards older steps). */
  runN?: number;
}

export interface WorkerRuntime {
  idx: number;
  active: ActiveStep | null;
}

export interface WatcherRuntime {
  idx: number;
  armed: boolean;
  wake: WakeRule;
  closedReason: string | null;
  delivered: string[]; // message ids
  configVersion: number;
}

export interface JournalEntry {
  t: Ms;
  text: string;
}

export interface ShelfVersion {
  artifact: 'preview' | 'render';
  version: number;
  logoRev: number;
  writer: string;
  at: Ms;
  storage: 'temporary' | 'shared';
}

export interface ArtifactState {
  value: Record<string, string | number | boolean | null> | null;
  version: number;
  writer: string | null;
  at: Ms | null;
  history: { version: number; at: Ms; writer: string; value: Record<string, string | number | boolean | null> | null }[];
}

export interface WorldMessage extends FixtureMessage {
  arrivedAt: Ms;
}

export interface WorldState {
  inbox: WorldMessage[];
  preview: {
    version: number;
    logoRev: number | null;
    tagline: string | null;
    history: { version: number; logoRev: number | null; tagline: string | null; at: Ms; writer: string }[];
  };
  live: { version: number; changedBy: string | null; logoRev: number | null; approvedVersion: number | null; at: Ms | null };
  approvals: { version: number; at: Ms; requestedAt: Ms }[];
  board: { items: number; at: Ms } | null;
  partnerMessage: { at: Ms; liveRev: number | null } | null;
  /** Publish requests that reached the live-page service (a reused key is still a request). */
  publishRequests: number;
  /** Data-driven world: versioned artifacts, sent messages and notifications to people. */
  artifacts: Record<string, ArtifactState>;
  sent: { artifact: string; to: string; at: Ms; value: Record<string, unknown> | null }[];
  notifications: { who: string; at: Ms; text: string }[];
  questions: { who: string; at: Ms }[];
  latestLogoRevSent: number;
  mayaThanked: boolean;
}

export type TraceKind =
  | 'shift'
  | 'world'
  | 'deliver'
  | 'watcher'
  | 'task'
  | 'step_start'
  | 'step_done'
  | 'decision'
  | 'permission'
  | 'write'
  | 'verify'
  | 'budget'
  | 'config'
  | 'reaction';

export interface TraceEntry {
  id: number;
  t: Ms;
  kind: TraceKind;
  actor: 'world' | 'relay' | 'player';
  text: string;
  detail?: string;
  cause: number | null;
  taskId?: string;
  worker?: number;
  packet?: ContextPacket;
  /** True when this describes world state Relay has not observed. */
  observerOnly?: boolean;
}

export interface QueuedEvent {
  t: Ms;
  phase: number;
  seq: number;
  kind: 'message' | 'deliver' | 'watcher_sync' | 'step_done' | 'dispatch' | 'reaction' | 'approval' | 'commit' | 'answer' | 'quiet' | 'restart' | 'end';
  taskId?: string;
  token?: number;
  /** Which answer/approval a reply carries. */
  ref?: string;
  msgId?: string;
  watcher?: number;
  worker?: number;
  cause?: number | null;
}

export interface SimState {
  fixtureId: string;
  fixtureVersion: number;
  seed: number;
  time: Ms;
  seq: number;
  traceSeq: number;
  queue: QueuedEvent[];
  build: Build;
  configVersion: number;
  interventions: { t: Ms; text: string }[];
  world: WorldState;
  watchers: WatcherRuntime[];
  workers: WorkerRuntime[];
  tasks: Task[];
  journal: JournalEntry[];
  shelf: ShelfVersion[];
  /** What Relay believes about the world (only updated by its own reads and writes). */
  agentKnown: { previewVersion: number };
  credits: { budget: number; spent: number; ledger: { t: Ms; amount: number; what: string }[] };
  ram: { totalGB: number; usedGB: number };
  cores: number;
  trace: TraceEntry[];
  violations: string[];
  needsTagline: boolean;
  goal: 'preview' | 'live' | 'shift' | 'jobs';
  /** Message kinds the agent has been told about (for waits). */
  agentEvents: Record<string, Ms>;
  tokenSeq: number;
  blockedProposals: number;
  ended: boolean;
}
