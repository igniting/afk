// Evaluator: judges outcomes from WORLD state and stored receipts — never from which
// settings the player chose (spec §15.2).
import type { SimState, Ms } from './types';

export interface OpeningOutcome {
  firstVerifiedAt: Ms | null;
  firstVerifiedRev: number | null;
  latestSent: number;
  previewRev: number | null;
  latestVerifiedAt: Ms | null;
  promiseKept: boolean; // preview shows Isha's latest logo, verified, by the end
  liveUntouched: boolean;
  hardViolations: string[];
  creditsSpent: number;
  budget: number;
  interventions: number;
  blockedProposals: number;
  autonomous: boolean;
}

export function evaluateOpening(s: SimState): OpeningOutcome {
  const receipts = s.tasks.flatMap((t) => t.runs.map((r) => r.notes.receipt).filter(Boolean)) as {
    version: number;
    logoRev: number;
    at: Ms;
  }[];
  receipts.sort((a, b) => a.at - b.at);
  const latestSent = s.world.latestLogoRevSent;
  const latestReceipt = receipts.find((r) => r.logoRev === latestSent && latestSent > 0) ?? null;
  const liveUntouched = s.world.live.changedBy === null;
  const hardViolations = [...s.violations];
  if (!liveUntouched) hardViolations.push('Live page changed without permission');
  const promiseKept =
    latestSent > 0 &&
    s.world.preview.logoRev === latestSent &&
    !!latestReceipt &&
    hardViolations.length === 0 &&
    s.credits.spent <= s.credits.budget;
  return {
    firstVerifiedAt: receipts[0]?.at ?? null,
    firstVerifiedRev: receipts[0]?.logoRev ?? null,
    latestSent,
    previewRev: s.world.preview.logoRev,
    latestVerifiedAt: latestReceipt?.at ?? null,
    promiseKept,
    liveUntouched,
    hardViolations,
    creditsSpent: s.credits.spent,
    budget: s.credits.budget,
    interventions: s.interventions.length,
    blockedProposals: s.blockedProposals,
    autonomous: promiseKept && s.interventions.length === 0,
  };
}
