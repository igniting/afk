// Tiny synthesised sound effects (no audio files). Off until the player's first click; can be muted.
let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.06) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = ctx.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export type Sfx = 'click' | 'mail' | 'done' | 'block' | 'alarm' | 'win' | 'lose' | 'ring' | 'medal';

export function play(name: Sfx) {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    return;
  }
  switch (name) {
    case 'click':
      return tone(520, 0, 0.05, 'triangle', 0.03);
    case 'mail':
      tone(880, 0, 0.09, 'sine', 0.04);
      return tone(1175, 0.08, 0.12, 'sine', 0.04);
    case 'done':
      tone(660, 0, 0.1, 'triangle', 0.05);
      return tone(990, 0.09, 0.18, 'triangle', 0.05);
    case 'block':
      return tone(150, 0, 0.22, 'square', 0.04);
    case 'alarm':
      tone(220, 0, 0.18, 'sawtooth', 0.05);
      return tone(165, 0.18, 0.3, 'sawtooth', 0.05);
    case 'ring':
      for (let i = 0; i < 2; i++) {
        tone(1320, i * 0.28, 0.1, 'sine', 0.05);
        tone(1660, i * 0.28 + 0.1, 0.1, 'sine', 0.05);
      }
      return;
    case 'medal':
      return tone(1320, 0, 0.25, 'triangle', 0.05);
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.3, 'triangle', 0.06));
      return;
    case 'lose':
      tone(392, 0, 0.25, 'triangle', 0.05);
      return tone(294, 0.2, 0.45, 'triangle', 0.05);
  }
}
