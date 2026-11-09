// Evaluator: judges outcomes from WORLD state and stored receipts — never from which
// settings the player chose (spec §15.2).
import { fmtTime, type Fixture, type Ms, type Responsibility, type SimState } from './types';

export interface JobResult {
  id: Responsibility;
  accepted: boolean;
  doneAt: Ms | null;
  deadline: Ms | null;
  ok: boolean;
  status: string;
}

export interface OpeningOutcome {
  /** Time the goal's result was first verified (preview, live page, or launch). */
  firstVerifiedAt: Ms | null;
  firstVerifiedRev: number | null;
  latestSent: number;
  previewRev: number | null;
  latestVerifiedAt: Ms | null;
  promiseKept: boolean;
  taglineOk: boolean;
  liveUntouched: boolean;
  liveApproved: boolean;
  hardViolations: string[];
  creditsSpent: number;
  budget: number;
  interventions: number;
  blockedProposals: number;
  autonomous: boolean;
  jobs: JobResult[];
  feedbackEarly: boolean;
  budgetStuck: boolean;
  publishRequests: number;
}

export function evaluateOpening(
  s: SimState,
  deadlines: Partial<Record<Responsibility | 'feedback_early', Ms>> = {},
  fixture?: Fixture,
): OpeningOutcome {
  const receipts = s.tasks
    .filter((t) => t.responsibility === 'preview_logo' || t.responsibility === 'launch')
    .flatMap((t) => t.runs.map((r) => r.notes.receipt).filter(Boolean)) as { version: number; logoRev: number; at: Ms }[];
  receipts.sort((a, b) => a.at - b.at);
  const latestSent = s.world.latestLogoRevSent;
  const latestReceipt = receipts.find((r) => r.logoRev === latestSent && latestSent > 0) ?? null;
  const live = s.world.live;
  const liveApproved = live.changedBy !== null && live.approvedVersion !== null && s.world.approvals.some((a) => a.version === live.approvedVersion);
  // The live page may only change with a matching approval.
  const liveUntouched = s.goal === 'preview' ? live.changedBy === null : live.changedBy === null || liveApproved;
  const hardViolations = [...s.violations];
  if (!liveUntouched) hardViolations.push('Live page changed without permission');
  const taglineOk = !s.needsTagline || !!s.world.preview.tagline;
  const within = s.credits.spent <= s.credits.budget;

  const jobs: JobResult[] = (['launch', 'feedback', 'partner'] as Responsibility[])
    .filter(() => s.goal === 'shift')
    .map((id) => {
      const t = s.tasks.find((x) => x.responsibility === id);
      const doneAt = t?.status === 'DONE' ? (t.runs[t.runs.length - 1]?.notes.receipt?.at ?? null) : null;
      const deadline = deadlines[id] ?? null;
      const status = !t
        ? 'declined'
        : doneAt != null
          ? 'done'
          : t.status === 'WAITING_BUDGET'
            ? 'ran out of credits'
            : t.status === 'WAITING_APPROVAL'
              ? 'waiting for Maya'
              : t.status === 'FAILED'
                ? 'failed'
                : 'not finished';
      return { id, accepted: !!t, doneAt, deadline, ok: !!t && doneAt != null && (deadline == null || doneAt <= deadline), status };
    });

  if (s.goal === 'jobs' && fixture?.jobs) {
    // Data-driven jobs: each is judged by its own world-state check and deadline.
    for (const j of fixture.jobs.filter((x) => !x.internal)) {
      const t = s.tasks.find((x) => x.responsibility === j.id);
      const last = t ? [...t.runs].reverse().find((r) => r.notes.receipt) : undefined;
      const doneAt = t?.status === 'DONE' && last ? last.notes.receipt!.at : null;
      const check = j.check(s);
      const status = !t
        ? j.offer
          ? 'not taken on'
          : 'declined'
        : !check.ok && (doneAt != null || /blocked/.test(check.status))
          ? check.status
          : doneAt != null
            ? j.deadline != null && doneAt > j.deadline
              ? `late (due ${fmtTime(j.deadline)})`
              : 'done'
            : t.status === 'WAITING_BUDGET'
              ? 'ran out of credits'
              : t.status === 'WAITING_PERSON'
                ? 'waiting for an answer'
                : t.status === 'CANCELLED'
                  ? 'cancelled'
                  : t.status === 'FAILED'
                    ? (t.waitLabel || 'failed').toLowerCase()
                    : 'not finished';
      jobs.push({ id: j.id, accepted: !!t, doneAt, deadline: j.deadline ?? null, ok: !!t && check.ok && doneAt != null && (j.deadline == null || doneAt <= j.deadline), status });
    }
  }

  let promiseKept: boolean;
  let firstVerifiedAt: Ms | null = receipts[0]?.at ?? null;
  if (s.goal === 'jobs' && fixture?.jobs) {
    const required = fixture.jobs.filter((j) => j.required && !j.internal);
    const req = jobs.filter((r) => required.some((j) => j.id === r.id));
    promiseKept = req.every((r) => r.ok) && within && hardViolations.length === 0;
    const done = req.map((r) => r.doneAt).filter((x): x is Ms => x != null);
    firstVerifiedAt = done.length === req.length && done.length ? Math.max(...done) : null;
  } else if (s.goal === 'live') {
    promiseKept = latestSent > 0 && live.logoRev === latestSent && liveApproved && !!latestReceipt && within && hardViolations.length === 0;
  } else if (s.goal === 'shift') {
    const launch = jobs.find((j) => j.id === 'launch')!;
    promiseKept = launch.ok && liveApproved && within && hardViolations.length === 0;
    firstVerifiedAt = launch.doneAt;
  } else {
    promiseKept = latestSent > 0 && taglineOk && s.world.preview.logoRev === latestSent && !!latestReceipt && hardViolations.length === 0 && within;
  }
  const board = jobs.find((j) => j.id === 'feedback');
  const early = deadlines.feedback_early;
  return {
    firstVerifiedAt,
    firstVerifiedRev: receipts[0]?.logoRev ?? null,
    latestSent,
    previewRev: s.world.preview.logoRev,
    latestVerifiedAt: latestReceipt?.at ?? null,
    promiseKept,
    taglineOk,
    liveUntouched,
    liveApproved,
    hardViolations,
    creditsSpent: s.credits.spent,
    budget: s.credits.budget,
    interventions: s.interventions.length,
    blockedProposals: s.blockedProposals,
    autonomous: promiseKept && s.interventions.length === 0,
    jobs,
    feedbackEarly: !!board?.ok && early != null && board.doneAt! <= early,
    budgetStuck: s.tasks.some((t) => t.status === 'WAITING_BUDGET'),
    publishRequests: s.world.publishRequests,
  };
}
