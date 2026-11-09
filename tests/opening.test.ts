import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/engine';
import { evaluateOpening } from '../src/sim/evaluate';
import { validateBuild, isRunnable } from '../src/sim/compiler';
import { packContext } from '../src/sim/context';
import { OPENING, emptyBuild, referenceBuild } from '../src/content/opening';
import { at, MIN, type Build, type TaskRun } from '../src/sim/types';

function play(build: Build, stepMs?: number) {
  const sim = new Sim(OPENING, build);
  if (stepMs) {
    for (let t = OPENING.start; !sim.state.ended; t += stepMs) sim.runUntil(t);
  } else sim.runToEnd();
  return sim;
}

const semantic = (sim: Sim) =>
  JSON.stringify({
    world: sim.state.world,
    tasks: sim.state.tasks,
    credits: sim.state.credits,
    trace: sim.state.trace.map((e) => [e.t, e.kind, e.text]),
  });

describe('opening fixture', () => {
  it('quick template + keep current: first success at 18:08 and revision 2 verified', () => {
    const sim = play(referenceBuild('quick', 'keep'));
    const o = evaluateOpening(sim.state);
    // 18:02 deliver → read 0.5 → Swift 1 → render 3 → save 1 → verify 0.5 = 18:08:00
    expect(o.firstVerifiedAt).toBe(at(18, 8));
    expect(o.firstVerifiedRev).toBe(1);
    expect(o.latestSent).toBe(2);
    expect(o.previewRev).toBe(2);
    expect(o.latestVerifiedAt).toBe(at(18, 18));
    expect(o.promiseKept).toBe(true);
    expect(o.autonomous).toBe(true);
    // rent 8 + 2 × (Swift 1 + render 1 + save 1)
    expect(o.creditsSpent).toBe(14);
  });

  it('general-purpose template also passes (multiple valid builds)', () => {
    const o = evaluateOpening(play(referenceBuild('general', 'keep')).state);
    expect(o.promiseKept).toBe(true);
    // 18:02 + 0.5 + 0.5 + 3 + 3 + 1 + 0.5 = 18:10:30
    expect(o.firstVerifiedAt).toBe(at(18, 10, 30));
    expect(o.creditsSpent).toBe(8 + 2 * (4 + 1 + 1));
  });

  it('once watcher: first success, then revision 2 is never observed', () => {
    const sim = play(referenceBuild('quick', 'once'));
    const o = evaluateOpening(sim.state);
    expect(o.firstVerifiedAt).toBe(at(18, 8));
    expect(o.previewRev).toBe(1);
    expect(o.promiseKept).toBe(false);
    expect(sim.state.watchers[0].armed).toBe(false);
    expect(sim.state.watchers[0].delivered).toEqual(['m-isha-r1']);
    // The world has the message; the agent never had it delivered.
    expect(sim.state.world.inbox.some((m) => m.id === 'm-isha-r2')).toBe(true);
  });

  it('live edit from once to keep catches up via watcher activation check', () => {
    const sim = new Sim(OPENING, referenceBuild('quick', 'once'));
    sim.runUntil(at(18, 15));
    expect(sim.state.world.preview.logoRev).toBe(1);
    const next = structuredClone(sim.state.build);
    next.watchers[0]!.wake = 'keep';
    sim.applyLiveEdit(next, 'Watcher wake rule: Once → Keep current');
    sim.runToEnd();
    const o = evaluateOpening(sim.state);
    expect(o.previewRev).toBe(2);
    expect(o.promiseKept).toBe(true);
    expect(o.interventions).toBe(1);
    expect(o.autonomous).toBe(false);
  });

  it('is deterministic regardless of playback step size', () => {
    const b = referenceBuild('general', 'keep');
    const a = semantic(play(b));
    expect(semantic(play(b, 1000))).toBe(a);
    expect(semantic(play(b, 7 * MIN + 13))).toBe(a);
  });

  it('snapshot restores an identical simulation', () => {
    const sim = new Sim(OPENING, referenceBuild('quick', 'keep'));
    sim.runUntil(at(18, 5));
    const copy = new Sim(OPENING, sim.state.build, sim.snapshot());
    sim.runToEnd();
    copy.runToEnd();
    expect(semantic(copy)).toBe(semantic(sim));
  });

  it('permission gate blocks a live publish without a violation', () => {
    const b = referenceBuild('quick', 'keep');
    b.workers[0]!.procedure.splice(4, 0, { kind: 'publish_live' });
    expect(isRunnable(b)).toBe(true);
    const sim = play(b);
    const o = evaluateOpening(sim.state);
    expect(o.liveUntouched).toBe(true);
    expect(o.hardViolations).toEqual([]);
    expect(o.blockedProposals).toBe(2);
    expect(o.promiseKept).toBe(true);
  });

  it('compiler explains unsupported recipes before Run', () => {
    expect(isRunnable(emptyBuild())).toBe(false);
    const b = referenceBuild('quick', 'keep');
    b.workers[0]!.procedure = b.workers[0]!.procedure.filter((s) => s.kind !== 'verify_preview');
    const issues = validateBuild(b);
    expect(issues.some((i) => i.level === 'error' && /Verify/.test(i.message))).toBe(true);
    const c = referenceBuild('quick', 'keep');
    c.workers[0]!.procedure = c.workers[0]!.procedure.filter((s) => s.kind !== 'read_logo');
    expect(validateBuild(c).some((i) => /Read attachment/.test(i.message))).toBe(true);
  });

  it('context packing: excluded tiles stay visible with reasons; files are not auto-included', () => {
    const run: TaskRun = {
      n: 1,
      logoRev: 1,
      attachmentId: 'att-logo-r1',
      configVersion: 1,
      procedure: [],
      contextRule: 'full',
      guide: 'none',
      startedAt: 0,
      finishedAt: null,
      notes: { metadata: { attachmentId: 'att-logo-r1', name: 'lumen-logo-r1.png', logoRev: 1, from: 'isha' } },
    };
    const swift = packContext(run, OPENING, 'swift', 'full');
    const raw = swift.tiles.find((t) => t.id === 'raw')!;
    expect(raw.included).toBe(false);
    expect(raw.reason).toMatch(/Doesn’t fit/);
    expect(swift.used).toBeLessThanOrEqual(10);
    const guide = swift.tiles.find((t) => t.id === 'brand-guide')!;
    expect(guide.included).toBe(false);
    expect(guide.reason).toMatch(/not automatically in context/);
    const deliberate = packContext(run, OPENING, 'deliberate', 'full');
    expect(deliberate.tiles.find((t) => t.id === 'raw')!.included).toBe(true);
  });

  it('remote inference holds no CPU; render does', () => {
    const sim = new Sim(OPENING, referenceBuild('quick', 'keep'));
    sim.runUntil(at(18, 3));
    const a = sim.state.workers[0].active!;
    expect(a.step.kind).toBe('decide');
    expect(a.remote).toBe(true);
    expect(a.cpu).toBe(false);
    sim.runUntil(at(18, 4));
    expect(sim.state.workers[0].active!.cpu).toBe(true);
    expect(sim.state.ram.usedGB).toBe(1);
  });
});
