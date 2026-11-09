import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/engine';
import { evaluateOpening } from '../src/sim/evaluate';
import { MISSIONS } from '../src/content/campaign';
import { emptyBuild } from '../src/content/opening';
import { isRunnable } from '../src/sim/compiler';

export function play(id: string, picks: Record<string, string>) {
  const m = MISSIONS.find((x) => x.id === id)!;
  const b = m.makeBuild!(emptyBuild(), picks);
  expect(isRunnable(b, m.fixture)).toBe(true);
  const sim = new Sim(m.fixture, b);
  sim.runToEnd();
  const o = evaluateOpening(sim.state, m.fixture.deadlines, m.fixture);
  return { sim, o, m, medals: m.medals.filter((md) => md.test(o, sim.state)).map((md) => md.id), predicted: m.prediction.answer(sim.state, null) };
}

describe('Shift 2 — memory', () => {
  it('M9: the latest decision with a small model is right, quick and cheap', () => {
    expect(play('m9', { select: 'authority', model: 'swift' }).medals).toEqual(['done', 'fast', 'cheap']);
  });
  it('M9: “most recent” passes on a rumour', () => {
    const r = play('m9', { select: 'recent', model: 'swift' });
    expect(r.predicted).toBe('Thursday');
    expect(r.medals).toEqual([]);
  });
  it('M9: everything on a small tray → conflicting dates → asks Maya', () => {
    const r = play('m9', { select: 'all', model: 'swift' });
    expect(r.sim.state.world.questions).toHaveLength(1);
    expect(r.predicted).toBe('Wednesday');
    expect(r.medals).toEqual(['done']);
  });
  it('M9: the big model weighs authority itself, at a price', () => {
    expect(play('m9', { select: 'all', model: 'deliberate' }).medals).toEqual(['done']);
  });

  it('M10: a shared sheet, prepared just in time, gets everything right cheaply', () => {
    const r = play('m10', { take: 'all', share: 'sheet', prep: 'jit' });
    expect(r.medals).toEqual(['done', 'all', 'cheap']);
    expect(r.o.creditsSpent).toBe(19);
  });
  it('M10: preparing early and keeping drafts sends the old date', () => {
    const r = play('m10', { take: 'all', share: 'sheet', prep: 'early', change: 'keep' });
    expect(r.predicted).toBe('Wednesday');
    expect(r.medals).toEqual([]);
  });
  it('M10: redoing on change fixes Nora, but the investors already got the old date', () => {
    const r = play('m10', { take: 'all', share: 'sheet', prep: 'early', change: 'refresh' });
    expect(r.medals).toEqual(['done']);
    expect(r.o.jobs.find((j) => j.id === 'investor')!.status).toMatch(/can’t be unsent/);
  });
  it('M11: “most recent” lets Leo’s Saturday rumour out', () => {
    const r = play('m11', { select: 'recent', take: 'all', share: 'sheet', prep: 'jit' });
    expect(r.medals).toEqual([]);
  });
  it('M11: the latest decision ignores the rumour', () => {
    expect(play('m11', { select: 'authority', take: 'all', share: 'sheet', prep: 'jit' }).medals).toEqual(['done', 'all', 'cheap']);
  });
});

describe('Shift 3 — noise, urgency, attention', () => {
  it('M12: waiting 2 quiet minutes renders once, on time', () => {
    const r = play('m12', { policy: 'quiet', quiet: '2' });
    expect(r.predicted).toBe('1');
    expect(r.medals).toEqual(['done', 'fast', 'cheap']);
  });
  it('M12: redoing every version wastes a render', () => {
    const r = play('m12', { policy: 'queue' });
    expect(r.predicted).toBe('2');
    expect(r.medals).toEqual(['done', 'fast']);
  });
  it('M12: too little patience also re-renders; too much is slow', () => {
    expect(play('m12', { policy: 'quiet', quiet: '1' }).medals).toEqual(['done']);
    expect(play('m12', { policy: 'quiet', quiet: '5' }).medals).toEqual(['done', 'cheap']);
  });
  it('M13: handled in order, the emergency waits and the launch goes out', () => {
    const r = play('m13', { policy: 'quiet', order: 'fifo', updates: 'digest' });
    expect(r.predicted).toBe('out');
    expect(r.medals).toEqual([]);
  });
  it('M13: urgent first, a quiet preview and one digest', () => {
    const r = play('m13', { policy: 'quiet', order: 'urgent', updates: 'digest' });
    expect(r.medals).toEqual(['done', 'quiet', 'cheap']);
  });
  it('M13: a ping for every version is too many messages', () => {
    expect(play('m13', { policy: 'quiet', order: 'urgent', updates: 'every' }).medals).toEqual(['done', 'cheap']);
  });
  it('M14: in a storm, waiting for calm is too slow', () => {
    const r = play('m14', { policy: 'quiet', order: 'urgent', updates: 'digest', machine: 'compact' });
    expect(r.o.jobs.find((j) => j.id === 'preview')!.status).toMatch(/late/);
  });
  it('M14: starting over on the newest version keeps up, cheaply', () => {
    expect(play('m14', { policy: 'restart', order: 'urgent', updates: 'digest', machine: 'compact' }).medals).toEqual(['done', 'quiet', 'cheap']);
  });
  it('M14: a second worker catches the emergency even in order — at a price', () => {
    expect(play('m14', { policy: 'restart', order: 'fifo', updates: 'digest', machine: 'team' }).medals).toEqual(['done', 'quiet']);
  });
});

describe('Shift 4 — machines and shared files', () => {
  it('M15: separate drafts merged — fast, cheap, nothing lost', () => {
    expect(play('m15', { share: 'merge' }).medals).toEqual(['done', 'fast', 'cheap']);
  });
  it('M15: taking turns is safe but slower', () => {
    expect(play('m15', { share: 'lock' }).medals).toEqual(['done', 'cheap']);
  });
  it('M15: a stale save is rejected, then redone — nothing is overwritten', () => {
    const r = play('m15', { share: 'retry' });
    expect(r.sim.state.trace.some((e) => /Write rejected/.test(e.text))).toBe(true);
    expect(r.predicted).toBe('both');
    expect(r.medals).toEqual(['done']);
  });
  it('M16: two workers on two cores are too slow for the review', () => {
    expect(play('m16', { machine: 'team', quality: 'standard', order: 'big' }).medals).toEqual([]);
  });
  it('M16: four workers sharing two cores wait for RAM and CPU, yet finish in time when big jobs start first', () => {
    const r = play('m16', { machine: 'teamplus', quality: 'high', order: 'big' });
    expect(r.predicted).toBe('yes');
    expect(r.medals).toEqual(['done', 'hq', 'cheap']);
    expect(play('m16', { machine: 'teamplus', quality: 'high', order: 'small' }).medals).toEqual([]);
  });
  it('M16: the Workshop is fast but its rent busts the budget medal', () => {
    expect(play('m16', { machine: 'workshop', quality: 'high', order: 'big' }).medals).toEqual(['done', 'hq']);
  });
  it('M17: on one core, the optional asset that fits is the press kit', () => {
    expect(play('m17', { take: 'press', quality: 'high', order: 'big' }).medals).toEqual(['done', 'all', 'hq']);
    expect(play('m17', { take: 'all', quality: 'high', order: 'big' }).medals).toEqual([]);
  });
});

describe('Shift 5 — skills', () => {
  it('M18: a saved skill, loaded on its own, beats re-reading the manual', () => {
    expect(play('m18', { how: 'skill', load: 'one' }).medals).toEqual(['done', 'cheap', 'fast']);
    expect(play('m18', { how: 'manual' }).medals).toEqual(['done']);
  });
  it('M18: loading every skill crowds the logo skill off the small tray', () => {
    const r = play('m18', { how: 'skill', load: 'all' });
    expect(r.predicted).toBe('no');
    expect(r.medals).toEqual([]);
  });
  it('M19: one odd format — fall back once', () => {
    const r = play('m19', { mode: 'fallback', load: 'one' });
    expect(r.predicted).toBe('manual');
    expect(r.medals).toEqual(['done', 'cheap', 'fast']);
    expect(play('m19', { mode: 'adapt', load: 'one' }).medals).toEqual(['done', 'fast']);
  });
  it('M19: forcing the PNG skill on an SVG fails that product', () => {
    expect(play('m19', { mode: 'force', load: 'one' }).predicted).toBe('fails');
  });
  it('M20: mostly new formats — adapting once pays off', () => {
    expect(play('m20', { mode: 'adapt', load: 'one' }).medals).toEqual(['done', 'cheap', 'fast']);
    expect(play('m20', { mode: 'fallback', load: 'one' }).medals).toEqual([]);
  });
});

describe('Shift 6 — the weekend', () => {
  it('M21: with a free worker, “accept if it fits” takes the opportunity and keeps every promise', () => {
    const r = play('m21', { machine: 'team', admission: 'fits' });
    expect(r.predicted).toBe('done');
    expect(r.medals).toEqual(['promises', 'all', 'cheap']);
  });
  it('M21: on one busy worker the same rule declines — and “always accept” breaks a promise', () => {
    expect(play('m21', { machine: 'compact', admission: 'fits' }).predicted).toBe('declined');
    const r = play('m21', { machine: 'compact', admission: 'always' });
    expect(r.predicted).toBe('late');
    expect(r.medals).toEqual(['cheap']);
  });
  it('M22: approve tonight, park the unclear refund, accept what fits', () => {
    const r = play('m22', { approval: 'tonight', unclear: 'park', admission: 'fits' });
    expect(r.medals).toEqual(['done', 'all', 'quiet']);
    expect(r.predicted).toBe('minutes');
    expect(r.sim.state.trace.filter((e) => e.kind === 'decision').length).toBeLessThan(15);
  });
  it('M22: asking on Saturday morning misses the 09:00 launch', () => {
    const r = play('m22', { approval: 'later', unclear: 'park', admission: 'fits' });
    expect(r.o.jobs.find((j) => j.id === 'launch')!.status).toMatch(/late/);
  });
  it('M22: guessing a refund without authority fails; asking costs a second question', () => {
    expect(play('m22', { approval: 'tonight', unclear: 'decide', admission: 'fits' }).medals).toEqual([]);
    expect(play('m22', { approval: 'tonight', unclear: 'ask', admission: 'fits' }).medals).toEqual(['done', 'all']);
  });
  it('M23: nobody to ask — the written policy settles the refund; parking misses the noon promise', () => {
    expect(play('m23', { approval: 'tonight', unclear: 'ask', admission: 'fits' }).medals).toEqual(['done', 'all', 'quiet']);
    expect(play('m23', { approval: 'tonight', unclear: 'park', admission: 'fits' }).medals).toEqual([]);
  });
  it('M23: always accepting a big opportunity on a small budget starves the Monday digest', () => {
    const r = play('m23', { approval: 'tonight', unclear: 'ask', admission: 'always' });
    expect(r.o.jobs.find((j) => j.id === 'digest')!.status).toBe('ran out of credits');
  });
});
