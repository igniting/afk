import { MIN, MODELS, type StepDef, type StepKind } from './types';

export interface StepInfo {
  kind: StepKind;
  label: string;
  verb: string; // short present-tense description used on the board
  explain: string;
  duration: number; // wall ms for non-model steps; models use MODELS
  cpuMinutes: number; // local CPU work (1 core)
  ramGB: number;
  credits: number;
  remote: boolean;
}

export const STEP_INFO: Record<StepKind, StepInfo> = {
  read_logo: {
    kind: 'read_logo',
    label: 'Read attachment',
    verb: 'Reading the logo attachment',
    explain: 'Tool read: fetch the attachment metadata (and file) from the delivered message.',
    duration: 0.5 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 0,
    remote: false,
  },
  read_preview: {
    kind: 'read_preview',
    label: 'Read current preview',
    verb: 'Reading the current preview page',
    explain: 'Tool read: observe which logo revision the preview shows right now.',
    duration: 0.5 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 0,
    remote: false,
  },
  read_guide: {
    kind: 'read_guide',
    label: 'Read brand guide',
    verb: 'Reading the brand guide from the shelf',
    explain: 'Tool read: open a brand-guide file so it can be packed into the AI’s tray.',
    duration: 0.5 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 0,
    remote: false,
  },
  decide: {
    kind: 'decide',
    label: 'Decide',
    verb: 'Model is deciding',
    explain: 'Model call: the model receives only the context tray and proposes the next action.',
    duration: 0,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 0,
    remote: true,
  },
  render: {
    kind: 'render',
    label: 'Render artwork',
    verb: 'Rendering the logo for the preview',
    explain: 'Local job: 3 CPU-minutes and 1 GB RAM. Output is a temporary file.',
    duration: 0,
    cpuMinutes: 3,
    ramGB: 1,
    credits: 1,
    remote: false,
  },
  write_preview: {
    kind: 'write_preview',
    label: 'Save to preview',
    verb: 'Saving to the preview page',
    explain: 'Versioned write to the preview page. Rejected if someone else changed it first.',
    duration: 1 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 1,
    remote: false,
  },
  verify_preview: {
    kind: 'verify_preview',
    label: 'Verify preview',
    verb: 'Checking the live preview result',
    explain: 'World read: compare what the preview actually shows with what was intended. Produces a receipt.',
    duration: 0.5 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 0,
    remote: false,
  },
  request_approval: {
    kind: 'request_approval',
    label: 'Ask Maya to approve',
    verb: 'Sending Maya the draft to approve',
    explain: 'Asks a person for permission for this exact draft version. The worker is free while waiting.',
    duration: 0.5 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 0,
    remote: false,
  },
  verify_live: {
    kind: 'verify_live',
    label: 'Check the live page',
    verb: 'Checking the live page really changed',
    explain: 'World read: compare the live page with the approved draft. Produces a receipt.',
    duration: 0.5 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 0,
    remote: false,
  },
  read_feedback: {
    kind: 'read_feedback',
    label: 'Fetch feedback',
    verb: 'Fetching the 12 feedback items',
    explain: 'Tool read: fetch the feedback bundle and its thread_complete field.',
    duration: 0.5 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 0,
    remote: false,
  },
  save_board: {
    kind: 'save_board',
    label: 'Save feedback board',
    verb: 'Saving the feedback board for Maya',
    explain: 'Versioned write of the sorted board, read back to confirm.',
    duration: 1 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 1,
    remote: false,
  },
  read_draft: {
    kind: 'read_draft',
    label: 'Read release draft',
    verb: 'Reading the release draft for Nora’s message',
    explain: 'Tool read: current release facts from the draft.',
    duration: 0.5 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 0,
    remote: false,
  },
  format_message: {
    kind: 'format_message',
    label: 'Format message',
    verb: 'Formatting the partner message',
    explain: 'Local job: 2 CPU-minutes, 0.5 GB RAM.',
    duration: 0,
    cpuMinutes: 2,
    ramGB: 0.5,
    credits: 0,
    remote: false,
  },
  save_message: {
    kind: 'save_message',
    label: 'Save message draft',
    verb: 'Saving the partner message draft',
    explain: 'Saves the prepared message so it survives until it can be sent.',
    duration: 0.5 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 1,
    remote: false,
  },
  wait_launch: {
    kind: 'wait_launch',
    label: 'Wait for the launch',
    verb: 'Waiting until the launch page is live and checked',
    explain: 'A dependency wait: the message must quote the live page, so it waits for the launch receipt. No worker is held.',
    duration: 0,
    cpuMinutes: 0,
    ramGB: 0,
    credits: 0,
    remote: false,
  },
  send_partner: {
    kind: 'send_partner',
    label: 'Send to Nora',
    verb: 'Sending Nora the partner message',
    explain: 'External action, pre-approved for Nora and the template only.',
    duration: 0.5 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 1,
    remote: false,
  },
  verify_sent: {
    kind: 'verify_sent',
    label: 'Check it was sent',
    verb: 'Checking Nora received the right message',
    explain: 'World read: recipient and content match. Produces a receipt.',
    duration: 0.5 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 0,
    remote: false,
  },
  check_status: {
    kind: 'check_status',
    label: 'Check request status',
    verb: 'Asking the live-page service what happened to the request',
    explain: 'Status lookup with the saved request key. Free; finds out whether the publish really happened.',
    duration: 0.5 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 0,
    remote: false,
  },
  resend_same: {
    kind: 'resend_same',
    label: 'Resend (same key)',
    verb: 'Resending the publish with the same request key',
    explain: 'Sends the request again with the saved key. The service recognises it and returns the original result instead of publishing twice.',
    duration: 1 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 0,
    remote: false,
  },
  resend_new: {
    kind: 'resend_new',
    label: 'Send a new request',
    verb: 'Trying a brand-new publish request',
    explain: 'A fresh request for the same draft. The runtime blocks it while the first one is unresolved, to prevent duplicates.',
    duration: 0,
    cpuMinutes: 0,
    ramGB: 0,
    credits: 0,
    remote: false,
  },
  give_up: {
    kind: 'give_up',
    label: 'Report failure',
    verb: 'Telling Maya the publish failed',
    explain: 'Gives up on a timeout and reports failure without checking.',
    duration: 0,
    cpuMinutes: 0,
    ramGB: 0,
    credits: 0,
    remote: false,
  },
  op: {
    kind: 'op',
    label: 'Step',
    verb: 'Working',
    explain: 'A data-driven step; its label, time and cost come from the mission.',
    duration: 0.5 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 0,
    remote: false,
  },
  publish_live: {
    kind: 'publish_live',
    label: 'Publish to live page',
    verb: 'Proposing a live-page publish',
    explain: 'External action on the live page. The permission gate decides whether it may go out — not the model.',
    duration: 1 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 2,
    remote: false,
  },
};

/** Time, credits, RAM and remoteness of a generic operation. */
export function opInfo(step: StepDef): { minutes: number; cpuMinutes: number; ioMinutes: number; credits: number; ramGB: number; remote: boolean; label: string } {
  const op = step.op!;
  const base = { minutes: 0.5, cpuMinutes: 0, ioMinutes: 0, credits: 0, ramGB: 0.1, remote: false, label: op.label };
  switch (op.type) {
    case 'read':
    case 'readArtifact':
      return { ...base, minutes: op.minutes ?? 0.5 };
    case 'decide': {
      const m = MODELS[step.model ?? 'swift'];
      return { ...base, minutes: m.duration / MIN, credits: m.credits, remote: true };
    }
    case 'local':
      return { ...base, minutes: 0, cpuMinutes: op.cpuMinutes, ioMinutes: op.ioMinutes ?? 0, credits: op.credits, ramGB: op.ramGB };
    case 'write':
      return { ...base, minutes: op.minutes ?? 1, credits: op.credits ?? 1 };
    case 'send':
      return { ...base, minutes: op.minutes ?? 0.5, credits: op.credits ?? 1 };
    case 'publish':
      return { ...base, minutes: 1, credits: 1 };
    case 'resend':
      return { ...base, minutes: 0.5, credits: 1 };
    case 'cancel':
    case 'waitJob':
    case 'waitEvent':
      return { ...base, minutes: 0, ramGB: 0 };
    default:
      return base;
  }
}

export function stepDuration(step: StepDef, cores: number): number {
  if (step.kind === 'op') {
    const i = opInfo(step);
    return (i.cpuMinutes * MIN) / Math.min(1, cores) + (i.minutes + i.ioMinutes) * MIN;
  }
  if (step.kind === 'decide') return MODELS[step.model ?? 'swift'].duration;
  const info = STEP_INFO[step.kind];
  if (info.cpuMinutes > 0) return (info.cpuMinutes * MIN) / Math.min(1, cores);
  return info.duration;
}

export function stepCredits(step: StepDef): number {
  if (step.kind === 'op') return opInfo(step).credits;
  if (step.kind === 'decide') return MODELS[step.model ?? 'swift'].credits;
  return STEP_INFO[step.kind].credits;
}

export const PURPOSE_LABEL: Record<string, string> = {
  logo: 'Decide',
  approval_check: 'Check approval',
  sort_complete: 'Sort clear feedback',
  sort_incomplete: 'Sort tricky feedback',
  sort_all: 'Sort feedback',
  reduce: 'Summarise board',
  partner_prepare: 'Draft partner message',
  partner_check: 'Check message facts',
};

export function stepLabel(step: StepDef): string {
  if (step.kind === 'op') return step.op!.label + (step.op!.type === 'decide' ? ` · ${MODELS[step.model ?? 'swift'].name}` : '');
  if (step.kind === 'decide')
    return `${step.purpose && step.purpose !== 'logo' ? PURPOSE_LABEL[step.purpose] : 'Decide'} · ${MODELS[step.model ?? 'swift'].name}`;
  return STEP_INFO[step.kind].label;
}

export const ADDABLE_STEPS: StepKind[] = [
  'read_logo',
  'read_preview',
  'read_guide',
  'decide',
  'render',
  'write_preview',
  'verify_preview',
  'publish_live',
];
