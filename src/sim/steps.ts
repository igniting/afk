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
  publish_live: {
    kind: 'publish_live',
    label: 'Publish to live page',
    verb: 'Proposing a live-page publish',
    explain: 'External action on the live page. Maya has not delegated this; the permission gate decides, not the model.',
    duration: 0.5 * MIN,
    cpuMinutes: 0,
    ramGB: 0.1,
    credits: 2,
    remote: false,
  },
};

export function stepDuration(step: StepDef, cores: number): number {
  if (step.kind === 'decide') return MODELS[step.model ?? 'swift'].duration;
  const info = STEP_INFO[step.kind];
  if (info.cpuMinutes > 0) return (info.cpuMinutes * MIN) / Math.min(1, cores);
  return info.duration;
}

export function stepCredits(step: StepDef): number {
  if (step.kind === 'decide') return MODELS[step.model ?? 'swift'].credits;
  return STEP_INFO[step.kind].credits;
}

export function stepLabel(step: StepDef): string {
  if (step.kind === 'decide') return `Decide · ${MODELS[step.model ?? 'swift'].name}`;
  return STEP_INFO[step.kind].label;
}

export const ADDABLE_STEPS: StepKind[] = [
  'read_logo',
  'read_preview',
  'decide',
  'render',
  'write_preview',
  'verify_preview',
  'publish_live',
];
