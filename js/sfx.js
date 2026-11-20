// Short sound effects that fit a movement: a whoosh for what flies, bubbles for what swims, a boing for a jump.
// Made on the device with Web Audio, nothing is downloaded. The choice "with sound / without" is kept per device.

const KEY = 'tz-sound';
let ctx = null;

export function soundOn() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setSound(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: the choice lasts for this visit */ }
  if (!on) stopAll();
}

function audio() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

const live = new Set();
function track(node, end) {
  live.add(node);
  node.onended = () => live.delete(node);
  node.start(ctx.currentTime);
  node.stop(ctx.currentTime + end);
}
export function stopAll() {
  for (const n of live) { try { n.stop(); } catch { /* already over */ } }
  live.clear();
}

function noise(seconds) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 1;
  for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  const n = ctx.createBufferSource();
  n.buffer = b;
  return n;
}

function env(at, peak, attack, release) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
  g.connect(ctx.destination);
  return g;
}

function tone(type, from, to, at, len, peak = 0.18) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, ctx.currentTime + at);
  o.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + at + len);
  o.connect(env(ctx.currentTime + at, peak, Math.min(0.03, len / 4), len));
  live.add(o);
  o.onended = () => live.delete(o);
  o.start(ctx.currentTime + at);
  o.stop(ctx.currentTime + at + len + 0.05);
}

function whoosh(at, len, lo, hi, peak = 0.35) {
  const n = noise(len + 0.1);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.2;
  const t = ctx.currentTime + at;
  f.frequency.setValueAtTime(lo, t);
  f.frequency.exponentialRampToValueAtTime(hi, t + len * 0.5);
  f.frequency.exponentialRampToValueAtTime(lo, t + len);
  n.connect(f).connect(env(t, peak, len * 0.4, len * 0.6));
  live.add(n);
  n.onended = () => live.delete(n);
  n.start(t);
  n.stop(t + len + 0.1);
}

const SOUNDS = {
  fly: () => { whoosh(0, 0.7, 500, 1800, 0.25); whoosh(2.5, 0.7, 500, 1800, 0.2); },
  glide: () => whoosh(0, 1.4, 300, 1200, 0.3),
  rise: () => whoosh(0, 1.6, 200, 2400, 0.3),
  swim: () => { for (let i = 0; i < 6; i++) tone('sine', 300 + i * 70, 700 + i * 90, i * 0.14, 0.07, 0.14); },
  float: () => { for (let i = 0; i < 4; i++) tone('sine', 260 + i * 50, 520 + i * 60, i * 0.3, 0.09, 0.1); },
  drive: () => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 62;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = env(ctx.currentTime, 0.12, 0.15, 1.6);
    o.connect(lp).connect(g);
    track(o, 1.8);
    tone('square', 660, 660, 2.2, 0.12, 0.06); tone('square', 520, 520, 2.38, 0.16, 0.06); // beep beep
  },
  walk: () => { for (let i = 0; i < 6; i++) tone('sine', 150, 60, i * 0.32, 0.09, 0.22); },
  jump: () => { for (let i = 0; i < 4; i++) { tone('sine', 180, 620, i * 1.25, 0.18, 0.16); tone('sine', 620, 300, i * 1.25 + 0.18, 0.2, 0.12); } },
  sway: () => whoosh(0, 2.2, 250, 700, 0.18),
  spin: () => { tone('triangle', 900, 1800, 0, 0.9, 0.08); },
  twinkle: () => { for (const [f, at] of [[1320, 0], [1760, 0.15], [2640, 0.3], [1980, 1.25], [2640, 1.4]]) tone('sine', f, f * 0.98, at, 0.9, 0.07); },
  fall: () => { for (let i = 0; i < 10; i++) tone('sine', 1800 - i * 60, 1200 - i * 40, i * 0.23 + (i % 3) * 0.04, 0.04, 0.05); },
};

/** Play the sound of one loop of a movement (a loop is 5 seconds). Nothing happens when sound is off. */
export function playFx(motion) {
  if (!soundOn() || !SOUNDS[motion]) return;
  try { if (audio()) SOUNDS[motion](); } catch { /* no sound on this device */ }
}

/** Movements that have a sound. */
export const FX = Object.keys(SOUNDS);
