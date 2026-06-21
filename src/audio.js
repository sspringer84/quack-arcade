// audio.js — shared WebAudio "quack" synth. No audio files; everything is
// synthesized from oscillators. The AudioContext must be created/resumed from
// a user gesture (browser autoplay policy), so call unlock() on first input.

let ctx = null;
let muted = false;
// Optional sink notified whenever the game emits sound, so the mic controller
// can open a self-mute window (AEC is off, so our own quack re-enters the mic).
let onOut = null;
export function onAudioOut(cb) {
  onOut = cb;
}

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
  applyMusicMute();
}
export function isMuted() {
  return muted;
}
export function toggleMuted() {
  muted = !muted;
  applyMusicMute();
  return muted;
}

// One-shot squeaky quack. `freq` sets the character (higher = cuter/smaller).
export function quack(freq = 320, dur = 0.18) {
  if (muted || !ctx) return;
  if (onOut) onOut(dur * 1000);
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
  if (onOut) onOut(450);
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

// Short descending noise "whoosh" — a skillful near-miss in Quack Lift.
export function whoosh() {
  if (muted || !ctx) return;
  if (onOut) onOut(180);
  const t = ctx.currentTime;
  const dur = 0.18;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(1800, t);
  bp.frequency.exponentialRampToValueAtTime(480, t + dur);
  bp.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// --- looping chiptune bed (arcade ambience) ----------------------------------
// A subtle 8-bit arpeggio + bass loop, all synthesized. Plays in the hub and
// Quack Lift; stays OFF in DUCK & COVER (the mic squeak detector runs there with
// AEC off, so a continuous tone would poison it). Follows the global mute.
let musicMaster = null;
let musicOn = false;
let musicTimer = null;
let musicStep = 0;
let musicNextTime = 0;
const MUSIC_VOL = 0.07; // master level for the whole bed — keep it a background wash
// A-minor flavoured: a bright square arp over a rounder triangle bass.
const MUSIC_ARP = [
  440, 523.25, 659.25, 523.25, 587.33, 659.25, 880, 659.25,
  440, 523.25, 659.25, 523.25, 392, 493.88, 587.33, 493.88,
];
const MUSIC_BASS = [110.0, 146.83, 130.81, 164.81];

function applyMusicMute() {
  if (musicMaster && ctx)
    musicMaster.gain.setTargetAtTime(muted ? 0 : MUSIC_VOL, ctx.currentTime, 0.03);
}

function musicNote(time, freq, dur, type, vol) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, time);
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(vol, time + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  o.connect(g).connect(musicMaster);
  o.start(time);
  o.stop(time + dur + 0.02);
}

// look-ahead scheduler (precise ctx-clock note times, fired from a coarse timer)
function musicScheduler(stepDur) {
  if (!musicOn || !ctx) return;
  while (musicNextTime < ctx.currentTime + 0.12) {
    const s = musicStep % MUSIC_ARP.length;
    musicNote(musicNextTime, MUSIC_ARP[s], stepDur * 0.9, "square", 0.4);
    if (s % 4 === 0)
      musicNote(musicNextTime, MUSIC_BASS[(s / 4) % MUSIC_BASS.length], stepDur * 3.6, "triangle", 0.85);
    musicNextTime += stepDur;
    musicStep++;
  }
  musicTimer = setTimeout(() => musicScheduler(stepDur), 25);
}

export function startMusic() {
  if (!ctx || musicOn) return; // needs an unlocked context; idempotent
  musicOn = true;
  musicMaster = ctx.createGain();
  musicMaster.gain.value = muted ? 0 : MUSIC_VOL;
  musicMaster.connect(ctx.destination);
  musicStep = 0;
  musicNextTime = ctx.currentTime + 0.06;
  const stepDur = 60 / 128 / 2; // eighth notes @ 128 bpm
  musicScheduler(stepDur);
}

export function stopMusic() {
  musicOn = false;
  if (musicTimer) {
    clearTimeout(musicTimer);
    musicTimer = null;
  }
  if (musicMaster) {
    const m = musicMaster;
    musicMaster = null;
    try {
      m.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    } catch (e) {
      /* context gone */
    }
    setTimeout(() => {
      try {
        m.disconnect();
      } catch (e) {
        /* already gone */
      }
    }, 300);
  }
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
