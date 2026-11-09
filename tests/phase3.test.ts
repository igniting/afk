import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/engine';
import { evaluateOpening } from '../src/sim/evaluate';
import { MISSIONS, setApproval, setRecovery, shiftBuild, type Recovery, type ShiftChoices } from '../src/content/missions';
import { emptyBuild, referenceBuild } from '../src/content/opening';
import { isRunnable } from '../src/sim/compiler';
import { at } from '../src/sim/types';

const get = (id: string) => MISSIONS.find((m) => m.id === id)!;

function runM6(tpl: 'quick' | 'general', r: Recovery) {
  const m = get('m6');
  const b = referenceBuild(tpl, 'once');
  setApproval(b.workers[0]!, true);
  setRecovery(b.workers[0]!, r);
  expect(isRunnable(b, m.fixture)).toBe(true);
  const sim = new Sim(m.fixture, b);
  sim.runToEnd();
  const o = evaluateOpening(sim.state, m.fixture.deadlines);
  return { sim, o, medals: m.medals.filter((md) => md.test(o, sim.state)).map((md) => md.id) };
}

function runShift(id: string, c: ShiftChoices) {
  const m = get(id);
  const sim = new Sim(m.fixture, shiftBuild(emptyBuild(), c, m.fixture));
  sim.runToEnd();
  const o = evaluateOpening(sim.state, m.fixture.deadlines);
  return { sim, o, medals: m.medals.filter((md) => md.test(o, sim.state)).map((md) => md.id) };
}

const all = ['launch', 'feedback', 'partner'] as const;

describe('Mission 6 — lost reply', () => {
  it('the page goes live before the timeout; a status check confirms it with one request', () => {
    const { sim, o, medals } = runM6('quick', 'check_status');
    expect(sim.state.world.live.at).toBe(at(18, 11));
    const timeout = sim.state.trace.find((e) => /Outcome unknown/.test(e.text))!;
    expect(timeout.t).toBe(at(18, 12));
    expect(o.publishRequests).toBe(1);
    expect(o.firstVerifiedAt).toBe(at(18, 13));
    expect(medals).toEqual(['done', 'fast', 'once']);
  });

  it('resending with the same key is safe but sends a second request', () => {
    const { sim, o, medals } = runM6('quick', 'resend_same');
    expect(sim.state.world.live.version).toBe(2); // published once
    expect(o.publishRequests).toBe(2);
    expect(o.creditsSpent).toBe(13); // no second publish charge
    expect(medals).toEqual(['done']);
  });

  it('a brand-new request is blocked by the runtime: no duplicate, job not verified', () => {
    const { sim, o, medals } = runM6('quick', 'resend_new');
    expect(sim.state.world.live.version).toBe(2);
    expect(o.blockedProposals).toBe(1);
    expect(o.hardViolations).toEqual([]);
    expect(medals).toEqual([]);
  });

  it('giving up reports failure even though the page is live', () => {
    const { sim, medals } = runM6('quick', 'give_up');
    expect(sim.state.world.live.changedBy).not.toBeNull();
    expect(sim.state.tasks[0].status).toBe('FAILED');
    expect(medals).toEqual([]);
  });

  it('the thorough model also works, just slower', () => {
    expect(runM6('general', 'check_status').medals).toEqual(['done', 'once']);
  });
});

describe('Mission 7 — early departure (Maya leaves 18:24)', () => {
  it('two workers with routing get the board to Maya in time', () => {
    const { o, medals } = runShift('m7', { accepted: [...all], machine: 'team', sorting: 'routed' });
    expect(o.feedbackEarly).toBe(true);
    expect(medals).toEqual(['done', 'all', 'wrap']);
  });
  it('one worker finishes the board just after she leaves', () => {
    const { o, medals } = runShift('m7', { accepted: [...all], machine: 'compact', sorting: 'routed' });
    expect(o.jobs.find((j) => j.id === 'feedback')!.doneAt).toBe(at(18, 33));
    expect(o.feedbackEarly).toBe(false);
    expect(medals).toEqual(['done']);
  });
});

describe('Mission 8 — quiet evening (3 easy threads)', () => {
  it('one worker with routing does everything cheaply', () => {
    const { o, medals } = runShift('m8', { accepted: [...all], machine: 'compact', sorting: 'routed' });
    expect(o.creditsSpent).toBe(24);
    expect(medals).toEqual(['done', 'all', 'cheap']);
  });
  it('a second worker mostly costs rent', () => {
    const { o, medals } = runShift('m8', { accepted: [...all], machine: 'team', sorting: 'routed' });
    expect(o.creditsSpent).toBe(38);
    expect(medals).toEqual(['done', 'all']);
  });
  it('the big model for everything costs more even when quiet', () => {
    const { o } = runShift('m8', { accepted: [...all], machine: 'compact', sorting: 'careful' });
    expect(o.creditsSpent).toBe(30);
  });
});
