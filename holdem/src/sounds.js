// Sonidos sintetizados con Web Audio: sin archivos, cargan al instante.
let ctx;
const KEY = 'bj.sound';
export const soundOn = () => localStorage.getItem(KEY) !== 'off';
export const setSound = (on) => localStorage.setItem(KEY, on ? 'on' : 'off');

function ac() {
  ctx ||= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', vol = 0.18 } = {}) {
  const a = ac(), o = a.createOscillator(), g = a.createGain(), t = a.currentTime + start;
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

function swish(start) {
  const a = ac(), len = a.sampleRate * 0.12, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + start;
  f.type = 'bandpass'; f.frequency.value = 2400; g.gain.value = 0.25;
  src.buffer = buf; src.connect(f).connect(g).connect(a.destination); src.start(t);
}

const play = (fn) => (...args) => { if (soundOn()) try { fn(...args); } catch { /* sin audio */ } };

export const sfx = {
  chip: play(() => { tone(1800, 0, 0.05, { type: 'triangle', vol: 0.12 }); tone(2600, 0.02, 0.05, { type: 'triangle', vol: 0.08 }); }),
  deal: play((n = 1) => { for (let i = 0; i < n; i++) swish(i * 0.12); }),
  win: play(() => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.35, { type: 'triangle' }))),
  blackjack: play(() => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.08, 0.45, { type: 'triangle' }))),
  push: play(() => tone(440, 0, 0.25, { vol: 0.12 })),
  lose: play(() => { tone(330, 0, 0.3, { vol: 0.1 }); tone(262, 0.18, 0.4, { vol: 0.1 }); }),
};
