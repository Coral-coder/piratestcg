// Tiny synthesized sound effects (no audio files).
import { getSettings } from './settings';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function ac(): AudioContext | null {
  if (!getSettings().sound) return null;
  try {
    if (!ctx) {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new C();
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function burst(freq: number, dur: number, gain: number, type: BiquadFilterType = 'lowpass') {
  const a = ac();
  if (!a || !noise) return;
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start();
  src.stop(a.currentTime + dur);
}

function tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slide = 1) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(freq * slide, a.currentTime + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

export const sfx = {
  unlock: () => void ac(),
  cannon: () => {
    burst(420, 0.6, 0.9);
    tone(70, 0.35, 0.5, 'sine', 0.5);
  },
  splash: () => burst(1800, 0.45, 0.25, 'bandpass'),
  hit: () => {
    burst(900, 0.25, 0.6);
    tone(140, 0.15, 0.3, 'square', 0.6);
  },
  snap: () => {
    tone(1400, 0.05, 0.25, 'square', 0.5);
    tone(700, 0.08, 0.2, 'triangle', 0.8);
  },
  coin: () => {
    tone(1320, 0.12, 0.15, 'triangle');
    setTimeout(() => tone(1760, 0.18, 0.12, 'triangle'), 70);
  },
  dice: () => burst(3000, 0.08, 0.2, 'highpass'),
  crack: () => {
    burst(600, 0.5, 0.5);
    tone(90, 0.4, 0.3, 'sawtooth', 0.4);
  },
  bell: () => {
    tone(880, 0.6, 0.12, 'sine');
    tone(1320, 0.5, 0.06, 'sine');
  },
};
