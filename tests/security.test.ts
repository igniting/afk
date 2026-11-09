import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/engine';
import { evaluateOpening } from '../src/sim/evaluate';
import { MISSIONS } from '../src/content/all';
import { emptyBuild } from '../src/content/opening';
import { isRunnable } from '../src/sim/compiler';

function play(id: string, picks: Record<string, string>) {
  const m = MISSIONS.find((x) => x.id === id)!;
  const b = m.makeBuild!(emptyBuild(), picks);
  expect(isRunnable(b, m.fixture)).toBe(true);
  const sim = new Sim(m.fixture, b);
  sim.runToEnd();
  const o = evaluateOpening(sim.state, m.fixture.deadlines, m.fixture);
  return { s: sim.state, medals: m.medals.filter((md) => md.test(o, sim.state)).map((md) => md.id), predicted: m.prediction.answer(sim.state, null) };
}

describe('Shift 7 — untrusted input', () => {
  it('M24: an injected order leaks the price list when the email is pasted in and the tool can email anyone', () => {
    const r = play('m24', { model: 'swift', handling: 'mixed', scope: 'any' });
    expect(r.predicted).toBe('leaked');
    expect(r.s.violations).toHaveLength(1);
    expect(r.medals).toEqual([]);
  });
  it('M24: a narrow send tool blocks the fooled AI (safe, but Ben is unanswered)', () => {
    const r = play('m24', { model: 'swift', handling: 'mixed', scope: 'known' });
    expect(r.predicted).toBe('blocked');
    expect(r.s.violations).toEqual([]);
    expect(r.medals).toEqual([]);
  });
  it('M24: the bigger model is fooled too', () => {
    expect(play('m24', { model: 'deliberate', handling: 'mixed', scope: 'any' }).predicted).toBe('leaked');
  });
  it('M24: labelled outside data plus a narrow tool earns everything', () => {
    expect(play('m24', { model: 'swift', handling: 'quoted', scope: 'known' }).medals).toEqual(['done', 'scope', 'cheap']);
  });

  it('M25: a key on the tray leaks into a public recap', () => {
    const r = play('m25', { key: 'tray', recap: 'everything' });
    expect(r.predicted).toBe('yes');
    expect(r.s.violations[0]).toMatch(/credential/);
    expect(play('m25', { key: 'file', recap: 'everything' }).predicted).toBe('yes');
  });
  it('M25: a narrow recap avoids the leak, but the key was still on a tray', () => {
    expect(play('m25', { key: 'tray', recap: 'results' }).medals).toEqual(['done', 'fast']);
  });
  it('M25: the runtime holds the key — never on a tray', () => {
    expect(play('m25', { key: 'vault', recap: 'results' }).medals).toEqual(['done', 'vault', 'fast']);
    expect(play('m25', { key: 'vault', recap: 'everything' }).medals).toEqual(['done', 'vault']);
  });

  it('M26: granting a skill wide permission lets its hidden step leak data', () => {
    const r = play('m26', { skill: 'grant' });
    expect(r.predicted).toBe('sent');
    expect(r.medals).toEqual([]);
  });
  it('M26: a skill does not carry permissions — the gate blocks its hidden step', () => {
    const r = play('m26', { skill: 'keep' });
    expect(r.predicted).toBe('blocked');
    expect(r.medals).toEqual(['done', 'fast', 'cheap']);
  });
  it('M26: skipping the skill is safe but slower and pricier', () => {
    expect(play('m26', { skill: 'none' }).medals).toEqual(['done']);
  });
});
