// Core data types for the Night Shift simulation.
// Everything in SimState is plain JSON-compatible data so snapshots are a structured clone.

export type Ms = number;
export const SEC = 1000;
export const MIN = 60 * SEC;

/** Simulated time-of-day in integer milliseconds since local midnight (fictional timezone). */
export const at = (h: number, m: number, s = 0): Ms => (h * 3600 + m * 60 + s) * SEC;

export function fmtTime(t: Ms): string {
  const total = Math.floor(t / SEC);
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

export type MachineId = 'compact' | 'team';

export const MACHINES: Record<MachineId, MachinePlan> = {
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
  | 'verify_sent';

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
}

export type WakeRule = 'once' | 'keep';
export type ContextRule = 'focused' | 'full';
export type Responsibility = 'preview_logo' | 'launch' | 'feedback' | 'partner';

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

export interface Build {
  name: string;
  agentName: string;
  accent: string;
  machine: MachineId;
  /** Optional jobs the player accepted (shift missions). */
  accepted?: Responsibility[];
  watchers: (WatcherCfg | null)[];
  workers: (WorkerCfg | null)[];
}

// ---------------------------------------------------------------------------
// Fixture (content)

export type PersonId = 'maya' | 'isha' | 'leo' | 'nora';
export type TriggerKind = 'logo' | 'feedback' | 'confirm';

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
  goal?: 'preview' | 'live' | 'shift';
  /** Who can approve, until when, and how long a reply takes. */
  approver?: { who: PersonId; until: Ms; replyAfter: Ms };
  deadlines?: Partial<Record<Responsibility | 'feedback_early', Ms>>;
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
  data?: { logoRev?: number | null; tagline?: string | null; needsTagline?: boolean; version?: number | null };
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
  kind: 'message' | 'deliver' | 'watcher_sync' | 'step_done' | 'dispatch' | 'reaction' | 'approval' | 'end';
  taskId?: string;
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
  goal: 'preview' | 'live' | 'shift';
  blockedProposals: number;
  ended: boolean;
}
