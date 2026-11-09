// Construction compiler (spec §16 module 3): validates a player build and explains problems
// before Run. It never executes arbitrary code — only the bounded step vocabulary.
import type { Build, StepDef } from './types';
import { MACHINES } from './types';
import { stepCredits, stepDuration } from './steps';

export interface Issue {
  level: 'error' | 'warn';
  where: 'watcher' | 'worker' | 'procedure' | 'machine';
  slot?: number;
  message: string;
}

export const MAX_STEPS = 6;

export function validateProcedure(proc: StepDef[]): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string) => issues.push({ level: 'error', where: 'procedure', message });
  const idx = (k: StepDef['kind']) => proc.findIndex((s) => s.kind === k);

  if (proc.length === 0) err('The procedure is empty. Start from a template or add steps.');
  if (proc.length > MAX_STEPS) err(`At most ${MAX_STEPS} steps are supported in this prototype.`);

  const read = idx('read_logo');
  const decide = idx('decide');
  const render = idx('render');
  const write = idx('write_preview');
  const verify = idx('verify_preview');

  for (const s of proc) if (s.kind === 'decide' && !s.model) err('Choose a model for the Decide step.');
  if (proc.filter((s) => s.kind === 'decide').length > 1) err('Use a single Decide step for this task.');

  if (decide < 0) err('Add a Decide step: something has to choose what to do with the logo.');
  else if (read < 0 || read > decide)
    err('Put “Read attachment” before Decide. The model only sees what a step has read — receiving an email does not open its file.');

  if (render < 0) err('Add “Render artwork”: the logo has to be prepared before it can go on the page.');
  else if (decide >= 0 && render < decide) err('“Render artwork” must come after Decide — it renders what the decision chose.');

  if (write < 0) err('Add “Save to preview”, or nothing will change on the page.');
  else if (render >= 0 && write < render) err('“Save to preview” must come after “Render artwork”.');

  if (verify < 0)
    err('Add “Verify preview”. Relay cannot call the task done without evidence that the page actually changed.');
  else if (write >= 0 && verify < write) err('“Verify preview” must come after “Save to preview”.');

  const rp = idx('read_preview');
  if (rp >= 0 && decide >= 0 && rp > decide)
    issues.push({
      level: 'warn',
      where: 'procedure',
      message: '“Read current preview” after Decide means the model never sees it. It will still cost time.',
    });

  if (proc.some((s) => s.kind === 'publish_live'))
    issues.push({
      level: 'warn',
      where: 'procedure',
      message:
        'Maya did not allow live-page changes. The permission gate will block “Publish to live page” at runtime — no harm, but it wastes time.',
    });
  return issues;
}

export function validateBuild(build: Build): Issue[] {
  const issues: Issue[] = [];
  const machine = MACHINES[build.machine];
  const watcher = build.watchers[0];
  const workers = build.workers;

  if (!watcher)
    issues.push({ level: 'error', where: 'watcher', slot: 0, message: 'Place a watcher so Relay notices when Isha’s email arrives.' });
  else {
    if (!watcher.wake) issues.push({ level: 'error', where: 'watcher', slot: 0, message: 'Choose the watcher’s wake rule.' });
    if (watcher.deliverTo == null || !workers[watcher.deliverTo])
      issues.push({ level: 'error', where: 'watcher', slot: 0, message: 'Connect the watcher to a worker.' });
  }

  if (workers.filter(Boolean).length === 0)
    issues.push({ level: 'error', where: 'worker', slot: 0, message: 'Place a worker on the workbench.' });
  if (workers.filter(Boolean).length > machine.workerSlots)
    issues.push({ level: 'error', where: 'machine', message: `The ${machine.name} plan has ${machine.workerSlots} worker slot.` });

  const owners = workers.map((w, i) => (w?.responsibilities.includes('preview_logo') ? i : -1)).filter((i) => i >= 0);
  if (workers.some(Boolean) && owners.length === 0)
    issues.push({ level: 'error', where: 'worker', slot: 0, message: 'Assign “Put the logo on the preview” to a worker.' });
  if (owners.length > 1)
    issues.push({ level: 'error', where: 'worker', message: 'Two workers claim the same task. Choose one owner.' });

  workers.forEach((w, i) => {
    if (!w) return;
    for (const iss of validateProcedure(w.procedure)) issues.push({ ...iss, slot: i });
  });
  return issues;
}

export function isRunnable(build: Build): boolean {
  return validateBuild(build).every((i) => i.level !== 'error');
}

/** Forecast for one logo revision through a procedure (no contention). */
export function forecastProcedure(proc: StepDef[], cores: number): { minutes: number; credits: number } {
  let ms = 0;
  let credits = 0;
  for (const s of proc) {
    ms += stepDuration(s, cores);
    if (s.kind !== 'publish_live') credits += stepCredits(s); // blocked proposals are never charged
  }
  return { minutes: ms / 60000, credits };
}
