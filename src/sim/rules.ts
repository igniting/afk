// Decision engine (spec §12.3): deterministic authored rules. They may inspect ONLY the
// context packet — never world state, future events, or the evaluator.
import type { ContextPacket, DecidePurpose, Proposal } from './types';

export interface Decision {
  proposal: Proposal;
  rule: string;
  explanation: string;
}

export function decide(packet: ContextPacket): Decision {
  const has = (id: string) => packet.tiles.find((t) => t.id === id && t.included);
  const meta = has('metadata');
  if (!meta) {
    return {
      proposal: { kind: 'need_evidence', what: 'logo attachment' },
      rule: 'required-evidence-absent',
      explanation: 'The packet has no attachment details, so there is nothing to place. The rule asks for a read first.',
    };
  }
  const rev = meta.data?.logoRev ?? 0;
  const needsTagline = !!has('goal')?.data?.needsTagline;
  const tagline = has('guide')?.data?.tagline ?? null;
  const preview = has('preview');
  if (preview) {
    if (preview.data?.logoRev === rev && (!needsTagline || (tagline && preview.data?.tagline === tagline))) {
      return {
        proposal: { kind: 'no_change', logoRev: rev },
        rule: 'already-current',
        explanation: `The packet shows the preview already has revision ${rev}. No render needed; verify and finish.`,
      };
    }
  }
  if (needsTagline && !tagline) {
    return {
      proposal: { kind: 'update_preview', logoRev: rev, tagline: null },
      rule: 'update-preview-tagline-missing',
      explanation: `The goal asks for the brand tagline, but no brand guide is in the packet. The rule never invents facts: place logo revision ${rev} and leave the tagline marked as missing.`,
    };
  }
  return {
    proposal: { kind: 'update_preview', logoRev: rev, tagline },
    rule: 'update-preview',
    explanation: `The packet contains Isha’s logo revision ${rev} and Maya’s permission to edit the preview. ${tagline ? ` The brand guide in the packet gives the tagline “${tagline}”.` : ''} Rule “update preview” matches: render it and save it to the preview page.`,
  };
}

const WORK_TEXT: Record<string, string> = {
  sort_complete: 'Each complete thread states its category explicitly; record Bug / Feature / Question.',
  sort_incomplete: 'Follow each linked source; where evidence conflicts, mark the thread “Needs follow-up” instead of guessing.',
  sort_all: 'Mixed batch: categorise complete threads, follow linked evidence for incomplete ones.',
  reduce: 'Combine the structured records into one board.',
  partner_prepare: 'Fill the pre-approved template with facts from the release draft.',
  partner_check: 'Message facts match the verified live page; recipient is Nora.',
};

/** Shift-work decisions. Like the logo rules, they read only the packet. */
export function decideWork(purpose: DecidePurpose, packet: ContextPacket): Decision {
  const has = (id: string) => packet.tiles.find((t) => t.id === id && t.included);
  if (purpose === 'approval_check') {
    const draft = has('draft');
    const approval = has('approval');
    if (!draft || !approval)
      return {
        proposal: { kind: 'need_evidence', what: 'a matching approval' },
        rule: 'approval-missing',
        explanation: 'The packet has no approval for the current draft, so the rule cannot propose publishing.',
      };
    if (draft.data?.version !== approval.data?.version)
      return {
        proposal: { kind: 'need_evidence', what: `approval for version ${draft.data?.version}` },
        rule: 'approval-stale',
        explanation: `Maya approved version ${approval.data?.version}, but the draft is version ${draft.data?.version}. An approval covers one exact version.`,
      };
    return {
      proposal: { kind: 'publish', version: Number(draft.data?.version) },
      rule: 'approval-matches',
      explanation: `The approval names draft version ${draft.data?.version}, which is the current draft. Propose publishing it with the saved operation key.`,
    };
  }
  const needed = purpose.startsWith('sort_') ? 'batch' : purpose === 'reduce' ? 'results' : purpose === 'partner_check' ? 'live' : 'facts';
  if (!has(needed))
    return { proposal: { kind: 'need_evidence', what: needed }, rule: 'required-evidence-absent', explanation: 'Required evidence is not in the packet.' };
  return { proposal: { kind: 'work', summary: WORK_TEXT[purpose] ?? '' }, rule: purpose, explanation: WORK_TEXT[purpose] ?? '' };
}
