// audio.js — shared WebAudio "quack" synth. No audio files; everything is
// synthesized from oscillators. The AudioContext must be created/resumed from
// a user gesture (browser autoplay policy), so call unlock() on first input.

let ctx = null;
let muted = false;

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function ready() {
  return !!ctx;
}
export function setMuted(m) {
  muted = !!m;
}
export function isMuted() {
  return muted;
}
export function toggleMuted() {
  muted = !muted;
  return muted;
}

// One-shot squeaky quack. `freq` sets the character (higher = cuter/smaller).
export function quack(freq = 320, dur = 0.18) {
  if (muted || !ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq * 0.8, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 1.7, t + dur * 0.35);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.95, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

// Descending "sad" quack for misses / game-over.
export function sadQuack() {
  if (muted || !ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(300, t);
  osc.frequency.exponentialRampToValueAtTime(110, t + 0.4);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.2, t + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.5);
}

// Sustained, pitch-bendable tone — for the tuning game (Quackoustic).
// Returns a handle; remember to stop() it.
export function tone(freq = 300) {
  if (!ctx) return null;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(muted ? 0 : 0.12, ctx.currentTime);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  return {
    setFreq: (f) => osc.frequency.setTargetAtTime(f, ctx.currentTime, 0.02),
    setGain: (g) =>
      gain.gain.setTargetAtTime(muted ? 0 : g, ctx.currentTime, 0.02),
    stop: () => {
      try {
        osc.stop();
      } catch (e) {
        /* already stopped */
      }
    },
  };
}
