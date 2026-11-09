// Decision engine (spec §12.3): deterministic authored rules. They may inspect ONLY the
// context packet — never world state, future events, or the evaluator.
import type { ContextPacket, Proposal } from './types';

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
