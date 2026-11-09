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
  const preview = has('preview');
  if (preview) {
    if (preview.data?.logoRev === rev) {
      return {
        proposal: { kind: 'no_change', logoRev: rev },
        rule: 'already-current',
        explanation: `The packet shows the preview already has revision ${rev}. No render needed; verify and finish.`,
      };
    }
  }
  return {
    proposal: { kind: 'update_preview', logoRev: rev },
    rule: 'update-preview',
    explanation: `The packet contains Isha’s logo revision ${rev} and Maya’s permission to edit the preview. Rule “update preview” matches: render it and save it to the preview page.`,
  };
}
