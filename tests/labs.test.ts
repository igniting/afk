import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/engine';
import { evaluateOpening } from '../src/sim/evaluate';
import { LABS } from '../src/content/labs';
import { emptyBuild } from '../src/content/opening';
import { isRunnable } from '../src/sim/compiler';

function lab(id: string, picks: Record<string, string>) {
  const m = LABS.find((x) => x.id === id)!;
  const b = m.makeBuild!(emptyBuild(), picks);
  expect(isRunnable(b, m.fixture)).toBe(true);
  const sim = new Sim(m.fixture, b);
  sim.runToEnd();
  const o = evaluateOpening(sim.state, m.fixture.deadlines, m.fixture);
  return { s: sim.state, o, answer: m.prediction.answer(sim.state, null), explain: m.prediction.explain(sim.state) };
}

describe('Failure Labs', () => {
  it('No journal: a restart is survivable with a journal, silent loss without', () => {
    const on = lab('lab-journal', { journal: 'on' });
    expect(on.o.promiseKept).toBe(true);
    expect(on.answer).toBe('resumes');
    const off = lab('lab-journal', { journal: 'off' });
    expect(off.o.promiseKept).toBe(false);
    expect(off.answer).toBe('forgotten');
    expect(off.s.violations).toEqual([]);
  });

  it('Forgotten rule: tray guides, gate enforces, neither = violation', () => {
    const on = lab('lab-gate', { protect: 'on' });
    expect(on.answer).toBe('preview');
    expect(on.o.promiseKept).toBe(true);
    const gate = lab('lab-gate', { protect: 'gate' });
    expect(gate.answer).toBe('blocked');
    expect(gate.s.world.live.changedBy).toBeNull();
    const off = lab('lab-gate', { protect: 'off' });
    expect(off.answer).toBe('live');
    expect(off.s.violations.length).toBe(1);
  });

  it('Blind retry: duplicate check keeps it to one message', () => {
    const on = lab('lab-dedupe', { dedupe: 'on' });
    expect(on.answer).toBe('1');
    expect(on.o.promiseKept).toBe(true);
    const off = lab('lab-dedupe', { dedupe: 'off' });
    expect(off.answer).toBe('2');
    expect(off.o.promiseKept).toBe(false);
  });

  it('Memory overcommit: admission waits, no admission kills a job', () => {
    const on = lab('lab-ram', { admission: 'on' });
    expect(on.answer).toBe('wait');
    expect(on.o.promiseKept).toBe(true);
    const off = lab('lab-ram', { admission: 'off' });
    expect(off.answer).toBe('killed');
    expect(off.o.promiseKept).toBe(false);
    expect(off.s.ram.usedGB).toBeLessThanOrEqual(off.s.ram.totalGB);
  });

  it('Blind overwrite: version check keeps both changes; without it one is silently lost', () => {
    const on = lab('lab-version', { version: 'on' });
    expect(on.answer).toBe('both');
    expect(on.o.promiseKept).toBe(true);
    const off = lab('lab-version', { version: 'off' });
    expect(off.answer).toBe('one');
    expect(off.o.promiseKept).toBe(false);
    expect(off.explain).toMatch(/silently lost/);
  });
});
