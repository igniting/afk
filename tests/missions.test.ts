import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/engine';
import { evaluateOpening } from '../src/sim/evaluate';
import { MISSIONS } from '../src/content/missions';
import { referenceBuild, setGuide } from '../src/content/opening';
import { isRunnable } from '../src/sim/compiler';

function medals(missionId: string, tpl: 'quick' | 'general', wake: 'once' | 'keep', guide: 'none' | 'full' | 'summary' = 'none') {
  const m = MISSIONS.find((x) => x.id === missionId)!;
  const b = referenceBuild(tpl, wake);
  setGuide(b.workers[0]!, guide);
  expect(isRunnable(b)).toBe(true);
  const sim = new Sim(m.fixture, b);
  sim.runToEnd();
  const o = evaluateOpening(sim.state);
  return { earned: m.medals.filter((md) => md.test(o, sim.state)).map((md) => md.id), sim, m };
}

describe('mission medals reward real tradeoffs', () => {
  it('M1: quick earns all three; thorough only finishes', () => {
    expect(medals('m1', 'quick', 'once').earned).toEqual(['done', 'fast', 'cheap']);
    expect(medals('m1', 'general', 'once').earned).toEqual(['done']);
  });

  it('M1 prediction: the model is idle while waiting', () => {
    const { sim, m } = medals('m1', 'quick', 'once');
    expect(m.prediction.answer(sim.state, 'once')).toBe('idle');
    expect(m.prediction.explain(sim.state)).toMatch(/only 1 minute/);
  });

  it('M2: keep watching earns medals; check once misses the correction', () => {
    expect(medals('m2', 'quick', 'keep').earned).toEqual(['done', 'auto', 'cheap']);
    expect(medals('m2', 'quick', 'once').earned).toEqual([]);
    expect(medals('m2', 'general', 'keep').earned).toEqual(['done', 'auto']);
  });

  it('M3: the guide must be read AND fit on the tray', () => {
    expect(medals('m3', 'quick', 'once', 'none').earned).toEqual([]);
    const full = medals('m3', 'quick', 'once', 'full');
    expect(full.earned).toEqual([]); // 5-unit guide does not fit a 10-unit tray with 7 used
    expect(full.m.prediction.answer(full.sim.state, 'once')).toBe('no');
    expect(full.sim.state.world.preview.logoRev).toBe(1);
    expect(full.sim.state.world.preview.tagline).toBeNull();
    expect(medals('m3', 'quick', 'once', 'summary').earned).toEqual(['done', 'cheap', 'fast']);
    const thorough = medals('m3', 'general', 'once', 'full');
    expect(thorough.earned).toEqual(['done']);
    expect(thorough.m.prediction.answer(thorough.sim.state, 'once')).toBe('yes');
  });
});
