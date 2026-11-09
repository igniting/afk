import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/engine';
import { evaluateOpening } from '../src/sim/evaluate';
import { MISSIONS, setApproval, shiftBuild, type ShiftChoices } from '../src/content/missions';
import { emptyBuild, referenceBuild } from '../src/content/opening';
import { isRunnable } from '../src/sim/compiler';
import { at } from '../src/sim/types';

const m4 = MISSIONS.find((m) => m.id === 'm4')!;
const m5 = MISSIONS.find((m) => m.id === 'm5')!;

function runM4(tpl: 'quick' | 'general', ask: boolean) {
  const b = referenceBuild(tpl, 'once');
  setApproval(b.workers[0]!, ask);
  expect(isRunnable(b, m4.fixture)).toBe(true);
  const sim = new Sim(m4.fixture, b);
  sim.runToEnd();
  const o = evaluateOpening(sim.state, m4.fixture.deadlines);
  return { sim, o, medals: m4.medals.filter((md) => md.test(o, sim.state)).map((md) => md.id) };
}

function runM5(c: ShiftChoices) {
  const b = shiftBuild(emptyBuild(), c);
  expect(isRunnable(b, m5.fixture)).toBe(true);
  const sim = new Sim(m5.fixture, b);
  sim.runToEnd();
  const o = evaluateOpening(sim.state, m5.fixture.deadlines);
  return { sim, o, medals: m5.medals.filter((md) => md.test(o, sim.state)).map((md) => md.id) };
}

describe('Mission 4 — permissions & approvals', () => {
  it('asking first: Maya approves, the gate allows exactly that draft', () => {
    const { sim, o, medals } = runM4('quick', true);
    expect(sim.state.world.approvals).toHaveLength(1);
    expect(sim.state.world.live.logoRev).toBe(1);
    expect(o.liveApproved).toBe(true);
    expect(o.firstVerifiedAt).toBe(at(18, 11, 30));
    expect(o.creditsSpent).toBe(13);
    expect(medals).toEqual(['done', 'fast', 'cheap']);
    expect(m4.prediction.answer(sim.state, 'once')).toBe('live');
  });

  it('publishing straight away is blocked — no violation, no live change', () => {
    const { sim, o, medals } = runM4('quick', false);
    expect(sim.state.world.live.changedBy).toBeNull();
    expect(o.blockedProposals).toBe(1);
    expect(o.hardViolations).toEqual([]);
    expect(medals).toEqual([]);
    expect(m4.prediction.answer(sim.state, 'once')).toBe('blocked');
  });

  it('thorough model also passes, slower and dearer', () => {
    const { medals } = runM4('general', true);
    expect(medals).toEqual(['done']);
  });
});

describe('Mission 5 — the evening shift', () => {
  const all = ['launch', 'feedback', 'partner'] as const;

  it('Team + routed sorting: every job done by 18:30, within budget', () => {
    const { o, medals, sim } = runM5({ accepted: [...all], machine: 'team', sorting: 'routed' });
    expect(o.firstVerifiedAt).toBe(at(18, 20, 30));
    expect(o.jobs.map((j) => j.status)).toEqual(['done', 'done', 'done']);
    expect(o.feedbackEarly).toBe(true);
    expect(o.creditsSpent).toBe(44);
    expect(medals).toEqual(['done', 'all', 'wrap']);
    expect(sim.state.world.partnerMessage?.liveRev).toBe(1);
  });

  it('Team + careful sorting runs out of credits for the partner message', () => {
    const { o, medals } = runM5({ accepted: [...all], machine: 'team', sorting: 'careful' });
    expect(o.budgetStuck).toBe(true);
    expect(o.creditsSpent).toBeLessThanOrEqual(50);
    expect(o.jobs.find((j) => j.id === 'partner')!.status).toBe('ran out of credits');
    expect(medals).toEqual(['done']);
  });

  it('Compact: one worker fits everything in, switching jobs while the launch waits for Maya', () => {
    const { o, medals, sim } = runM5({ accepted: [...all], machine: 'compact', sorting: 'routed' });
    expect(o.jobs.every((j) => j.ok)).toBe(true);
    expect(o.feedbackEarly).toBe(true);
    expect(o.firstVerifiedAt).toBe(at(18, 21));
    expect(o.jobs.find((j) => j.id === 'feedback')!.doneAt).toBe(at(18, 33));
    expect(o.creditsSpent).toBe(30);
    expect(medals).toEqual(['done', 'all']);
    // While the launch waited for Maya, the single worker sorted feedback.
    const fbStart = sim.state.trace.find((e) => e.kind === 'step_start' && /feedback/.test(e.text))!.t;
    expect(fbStart).toBe(at(18, 16));
  });

  it('Launch only: quick, but no ambition medal', () => {
    const { medals } = runM5({ accepted: ['launch'], machine: 'compact', sorting: 'routed' });
    expect(medals).toEqual(['done', 'wrap']);
  });

  it('is deterministic at any step size', () => {
    const b = shiftBuild(emptyBuild(), { accepted: [...all], machine: 'team', sorting: 'routed' });
    const a = new Sim(m5.fixture, b);
    a.runToEnd();
    const c = new Sim(m5.fixture, b);
    for (let t = m5.fixture.start; !c.state.ended; t += 37_123) c.runUntil(t);
    expect(JSON.stringify(c.state.world)).toBe(JSON.stringify(a.state.world));
    expect(c.state.trace.map((e) => [e.t, e.text])).toEqual(a.state.trace.map((e) => [e.t, e.text]));
  });
});
