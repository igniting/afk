import { at, type Build, type Fixture, type StepDef, type WorkerCfg } from '../sim/types';

// Opening fixture — "Take one thing off my plate" (spec §8.1–8.2).
export const OPENING: Fixture = {
  id: 'opening',
  version: 1,
  seed: 1,
  title: 'Take one thing off my plate',
  start: at(18, 0),
  end: at(18, 30),
  endOfferAfter: at(18, 13),
  budget: 24,
  machine: 'compact',
  availability: {
    maya: { label: 'Maya reachable until 18:40', until: at(18, 40) },
    isha: { label: 'Isha online until her train at 18:45', until: at(18, 45) },
  },
  delegation: { preview: 'edit', live: 'none' },
  shelfFiles: [{ id: 'brand-guide', name: 'Brand guide.pdf', units: 5 }],
  messages: [
    {
      id: 'm-maya-brief',
      from: 'maya',
      at: at(17, 58),
      preexisting: true,
      subject: 'One thing off my plate',
      body: 'When Isha sends the logo, put it on the preview page. You can edit the preview freely. Please leave the live page alone.',
    },
    {
      id: 'm-isha-r1',
      from: 'isha',
      at: at(18, 2),
      subject: 'Final logo',
      body: 'Here’s the final logo for the preview!',
      attachment: { id: 'att-logo-r1', name: 'lumen-logo-r1.png', logoRev: 1 },
    },
    {
      id: 'm-isha-r2',
      from: 'isha',
      at: at(18, 12),
      subject: 'Re: Final logo — corrected',
      body: 'Oops, the mark was a shade off. Please use this one instead.',
      attachment: { id: 'att-logo-r2', name: 'lumen-logo-r2.png', logoRev: 2 },
    },
  ],
};

export const MAYA_THANKS = {
  subject: 'Re: One thing off my plate',
  body: 'That saved me a task. Can you handle the evening handoff too?',
};

// ---------------------------------------------------------------------------
// Procedure templates — editable starting points, not required answers.

export interface ProcedureTemplate {
  id: string;
  name: string;
  summary: string;
  procedure: StepDef[];
  contextRule: WorkerCfg['contextRule'];
}

export const TEMPLATES: ProcedureTemplate[] = [
  {
    id: 'quick',
    name: 'Quick update',
    summary: 'Small and cheap: read the attachment, a Swift decision, render, save, verify.',
    procedure: [
      { kind: 'read_logo' },
      { kind: 'decide', model: 'swift' },
      { kind: 'render' },
      { kind: 'write_preview' },
      { kind: 'verify_preview' },
    ],
    contextRule: 'focused',
  },
  {
    id: 'general',
    name: 'General-purpose',
    summary: 'Larger: also reads the current preview, then a Deliberate decision with the full artwork in context.',
    procedure: [
      { kind: 'read_logo' },
      { kind: 'read_preview' },
      { kind: 'decide', model: 'deliberate' },
      { kind: 'render' },
      { kind: 'write_preview' },
      { kind: 'verify_preview' },
    ],
    contextRule: 'full',
  },
];

export function emptyBuild(): Build {
  return {
    name: 'My first Relay',
    agentName: 'Relay',
    accent: '#5eead4',
    machine: 'compact',
    watchers: [null],
    workers: [null],
  };
}

export function newWorkerFromTemplate(templateId: string): WorkerCfg {
  const tpl = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  return {
    card: 'worker',
    responsibilities: ['preview_logo'],
    procedure: tpl.procedure.map((s) => ({ ...s })),
    contextRule: tpl.contextRule,
    templateId: tpl.id,
  };
}

/** A complete, valid build used by tests and as an example. */
export function referenceBuild(templateId: 'quick' | 'general', wake: 'once' | 'keep'): Build {
  const b = emptyBuild();
  b.watchers = [{ card: 'inbox', wake, deliverTo: 0 }];
  b.workers = [newWorkerFromTemplate(templateId)];
  return b;
}

/** Point a worker at a brand-guide file, inserting or removing the read step as needed. */
export function setGuide(w: WorkerCfg, guide: 'none' | 'full' | 'summary') {
  w.guide = guide;
  w.procedure = w.procedure.filter((s) => s.kind !== 'read_guide');
  if (guide !== 'none') {
    const at = w.procedure.findIndex((s) => s.kind === 'read_logo');
    w.procedure.splice(at + 1, 0, { kind: 'read_guide' });
  }
}
