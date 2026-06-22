// quackoustic.js — QUACKOUSTIC „Stimm die Ente" (Phase 3).
// A one-button theremin tuner. HOLD (tap-and-hold / Space) raises a synthesized
// pitch; RELEASE lets it fall. You HEAR your pitch (one sustained audio.tone())
// and SEE it as the duck's height on a vertical oscilloscope column. Target
// note-bands scroll in from the right; hold the duck inside a band as it crosses
// the now-line to LOCK it — each lock quacks its note, so a clean run composes a
// little melody. Drift out / miss a band = sad-quack, lose a life. 3 lives.
//
// Controls: hold anywhere (touch) or hold Space — that's it.
//
// This top section is PURE (no DOM/audio) and node-importable for headless tests
// (see _verify/pitchmaptest.mjs). The scene factory (DOM/audio) lands at the end.

import { drawDuck } from "../duck.js";
import * as audio from "../audio.js";
import { wrapText } from "../engine.js";
import { createPitchMic } from "../pitch.js";

// Play-state poses (Flux Schnell, chroma-keyed). The canvas drawDuck() is the
// fallback until they load, so geometry never depends on an asset.
function loadImg(src) {
  if (typeof Image === "undefined") return { img: null, ready: false };
  const o = { img: new Image(), ready: false };
  o.img.onload = () => (o.ready = true);
  o.img.src = src;
  return o;
}
const duckSing = loadImg("assets/duck-sing.png");   // default singing pose
const duckTuned = loadImg("assets/duck-tuned.png"); // brief flash on a PERFECT lock

// A-minor pentatonic ladder (Hz), ascending, spanning PITCH_LO..PITCH_HI. Notes
// are drawn from here so locks land on a consonant scale and compose a melody.
export const SCALE = [
  196.0,   // G3
  220.0,   // A3
  261.63,  // C4
  293.66,  // D4
  329.63,  // E4
  392.0,   // G4
  440.0,   // A4
  523.25,  // C5
  587.33,  // D5
  659.25,  // E5
  784.0,   // G5
];
export const PITCH_LO = SCALE[0];
export const PITCH_HI = SCALE[SCALE.length - 1];
export const PERFECT_FRAC = 0.34; // inner ±34% of a band = PERFECT

const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Map a pitch (Hz) to a Y on the column: PITCH_LO -> bot, PITCH_HI -> top.
export function pitchToY(pitch, top, bot) {
  const frac = clampN((pitch - PITCH_LO) / (PITCH_HI - PITCH_LO), 0, 1);
  return bot + frac * (top - bot); // top < bot, so higher pitch = smaller Y
}
// Inverse of pitchToY.
export function yToPitch(y, top, bot) {
  const frac = clampN((y - bot) / (top - bot), 0, 1);
  return PITCH_LO + frac * (PITCH_HI - PITCH_LO);
}

const nearestIdx = (hz) => {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < SCALE.length; i++) {
    const d = Math.abs(SCALE[i] - hz);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
};

// Next target note: a scale step from the previous note. The interval span grows
// with score (small early, larger late) for a rising skill ceiling. `rnd` is
// injectable so the generator is deterministic in tests.
export function nextNote(prevHz, score, rnd = Math.random) {
  const prevIdx = nearestIdx(prevHz);
  const maxStep = 1 + Math.floor(score / 6);
  const step = Math.floor(rnd() * (2 * maxStep + 1)) - maxStep; // [-maxStep, maxStep]
  let idx = clampN(prevIdx + step, 0, SCALE.length - 1);
  if (idx === prevIdx) idx = clampN(prevIdx + (prevIdx < SCALE.length - 1 ? 1 : -1), 0, SCALE.length - 1);
  return SCALE[idx];
}

// Is the duck's pitch inside a band {hz, tol}? Returns the hit/perfect verdict
// plus the raw Hz error (for juice + the ?dbg readout).
export function isPitchIn(duckPitch, band, perfectFrac = PERFECT_FRAC) {
  const err = Math.abs(duckPitch - band.hz);
  return { hit: err <= band.tol, perfect: err <= band.tol * perfectFrac, err };
}

// Did a leftward-scrolling band's center cross the now-line this frame? Uses the
// swept segment [prevX -> curX] so a fast band that jumps clean past the line in
// one frame is still detected (no tunnelling), not just an exact-frame match.
export function crossedNow(prevX, curX, nowX) {
  return prevX >= nowX && curX < nowX;
}

// --- run logic (pure, headless-testable) ----------------------------------
// The whole second-to-second game state advances here, with NO canvas/audio.
// The scene below layers rendering + sound on top of the events this returns,
// and the node test (quackousticstatetest.mjs) drives it directly. Every tunable
// has a default here and an optional override via the P object so the scene can
// inject the live window.__* hooks and the test can pin clean timing.
export const DEFAULTS = {
  PITCH_RISE: 520,   // Hz/s the pitch climbs while held
  PITCH_FALL: 380,   // Hz/s it falls while released (slightly gentler settle)
  SCROLL0: 150,      // px/s base band scroll
  SCROLL_RAMP: 1.4,  // +px/s of scroll per resolved band
  SCROLL_CAP: 360,   // px/s ceiling (keeps a band's window-dwell >= HOLD_MS)
  HOLD_MS: 480,      // ms in-band to fill the lock meter
  TOL0: 64,          // ±Hz band half-height at the start
  TOL_MIN: 26,       // ±Hz floor the band shrinks toward
  TOL_RAMP: 1.4,     // Hz the band tightens per resolved band
  HIT_HALF: 110,     // px half-width of the now-window around nowX
  SPACING: 300,      // px between consecutive bands
  MULT_MAX: 9,       // combo multiplier cap
  BASE: 100,         // base points per lock (×mult)
  PERFECT_BONUS: 50, // extra points for a PERFECT-center lock
};

// Build a logical run. `P` overrides any DEFAULT plus the layout
// {W, nowX, top, bot} and an injectable `rnd`. Returns { S, step, cfg }.
export function createRun(P = {}) {
  const cfg = { ...DEFAULTS, ...P };
  const W = P.W != null ? P.W : 430;
  const nowX = P.nowX != null ? P.nowX : 130;
  const rnd = P.rnd || Math.random;

  const S = {
    pitch: (PITCH_LO + PITCH_HI) / 2,
    bands: [],
    lives: 3, pts: 0, combo: 0, mult: 1,
    locks: 0, misses: 0, score: 0,
    over: false,
    lastHz: SCALE[Math.floor(SCALE.length / 2)],
  };

  const tol = () => Math.max(cfg.TOL_MIN, cfg.TOL0 - S.score * cfg.TOL_RAMP);

  function spawnIfNeeded() {
    const rightmost = S.bands.length ? Math.max(...S.bands.map((b) => b.x)) : -Infinity;
    if (S.bands.length === 0 || rightmost <= W - cfg.SPACING) {
      // first band sits one beat ahead of the DUCK (nowX), not at the right screen
      // edge — so the run-up is a device-consistent ~2s instead of ~9s on desktop.
      const base = S.bands.length ? rightmost : nowX;
      const hz = cfg.noteForce != null ? cfg.noteForce : nextNote(S.lastHz, S.score, rnd);
      S.lastHz = hz;
      S.bands.push({ hz, tol: tol(), x: base + cfg.SPACING, locked: false, missed: false, lockMs: 0, perfect: false });
    }
  }

  // Advance one frame. `pitchOverride` (test-only) pins the duck's pitch instead
  // of integrating from `holding`; the scene always passes it null/undefined.
  function step(dt, holding, pitchOverride) {
    const ev = [];
    if (S.over) return ev;

    if (pitchOverride != null) S.pitch = clampN(pitchOverride, PITCH_LO, PITCH_HI);
    else S.pitch = clampN(S.pitch + (holding ? cfg.PITCH_RISE : -cfg.PITCH_FALL) * dt, PITCH_LO, PITCH_HI);

    const scroll = Math.min(cfg.SCROLL_CAP, cfg.SCROLL0 + S.score * cfg.SCROLL_RAMP);
    spawnIfNeeded();

    for (const b of S.bands) {
      b.x -= scroll * dt;
      if (b.locked || b.missed) continue;
      const inWindow = Math.abs(b.x - nowX) <= cfg.HIT_HALF;
      const j = isPitchIn(S.pitch, b);
      if (inWindow && j.hit) {
        b.lockMs += dt * 1000;
        if (b.lockMs >= cfg.HOLD_MS) {
          b.locked = true;
          b.perfect = j.perfect;
          S.locks++;
          S.combo++;
          S.mult = clampN(1 + S.combo, 1, cfg.MULT_MAX);
          S.pts += cfg.BASE * S.mult + (j.perfect ? cfg.PERFECT_BONUS : 0);
          S.score++;
          ev.push({ type: "lock", perfect: j.perfect, hz: b.hz, mult: S.mult });
        }
      } else if (inWindow) {
        b.lockMs = 0; // drifted out of the band mid-fill — reset the meter
      }
      if (!b.locked && !b.missed && b.x < nowX - cfg.HIT_HALF) {
        b.missed = true;
        S.misses++;
        S.combo = 0;
        S.mult = 1;
        S.lives--;
        S.score++;
        ev.push({ type: "miss", hz: b.hz });
        if (S.lives <= 0) {
          S.over = true;
          ev.push({ type: "over" });
        }
      }
    }
    S.bands = S.bands.filter((b) => b.x > -cfg.HIT_HALF * 2);
    return ev;
  }

  return { S, step, cfg, nowX };
}

// --- scene (DOM + audio) ---------------------------------------------------
const DUCK_R = 20;

export function quackoustic(engine, goHub, micUi) {
  const isTouch =
    typeof window !== "undefined" && window.matchMedia &&
    window.matchMedia("(pointer: coarse)").matches;
  const QA = typeof window !== "undefined" ? window.__QA__ : null;
  const BOT = !!QA && typeof location !== "undefined" &&
    new URLSearchParams(location.search).has("bot");
  const DBG = typeof location !== "undefined" && new URLSearchParams(location.search).has("dbg");
  if (typeof window !== "undefined" && typeof location !== "undefined" &&
      new URLSearchParams(location.search).has("hb")) window.__HB__ = true;

  const winNum = (k, d) => (typeof window !== "undefined" && window[k] != null ? window[k] : d);

  let state, run, best, holding, t, toneHandle;
  let particles, popups, rings, flash, shake, lockGlow, perfectT;
  // voice (SingStar) control — the PRIMARY input; hold is the no-mic fallback.
  // The duck has a SMOOTH physical position (voiceDuckPitch): the sung frequency
  // sets a target it eases toward, loudness nudges it up a little, SILENCE lets it
  // drift gently DOWN (so the unreachable low end is reached by going quiet, not by
  // singing impossibly low), and an ASSIST magnet pulls it toward the active band's
  // centre — so the player can "einpegeln" very forgivingly.
  let pitchMic, micReady, micState, voiceDuckPitch, lastVoiceMs, rawVoiceHz, voiceLevel;

  // map the player's COMFORTABLE sung range to the game's pitch axis. The low end
  // of the column is owned by gravity (silence), so this only needs to cover the
  // range the player can actually sing. Tunable on-device via ?dbg=1 readout.
  const VOICE_LO = () => winNum("__VOICE_LO__", 165);
  const VOICE_HI = () => winNum("__VOICE_HI__", 480);
  function voiceToGame(hz) {
    const frac = clampN((hz - VOICE_LO()) / (VOICE_HI() - VOICE_LO()), 0, 1);
    return PITCH_LO + frac * (PITCH_HI - PITCH_LO);
  }
  // the unresolved band closest to / at the now-line (what the assist helps with)
  function activeBand() {
    let n = null;
    for (const b of run.S.bands)
      if (!b.locked && !b.missed && b.x > run.nowX - run.cfg.HIT_HALF && b.x < run.nowX + run.cfg.HIT_HALF * 1.8 && (!n || b.x < n.x)) n = b;
    return n;
  }
  // advance the duck's smooth pitch one frame from the voice + gravity + assist
  function voiceStep(dt) {
    const voiced = lastVoiceMs < winNum("__VOICE_GRACE__", 160);
    if (voiced) {
      const target = clampN(voiceToGame(rawVoiceHz) + winNum("__VOICE_LOUD__", 30) * voiceLevel, PITCH_LO, PITCH_HI);
      voiceDuckPitch += (target - voiceDuckPitch) * winNum("__VOICE_EASE__", 7) * dt; // gentle glide, no overshoot
    } else {
      voiceDuckPitch -= winNum("__VOICE_GRAV__", 180) * dt; // quiet -> drift down
    }
    // assist magnet: gently centre the duck on the active band (user-friendly)
    const ab = activeBand();
    if (ab) {
      const range = ab.tol * winNum("__VOICE_ASSIST_K__", 2.6);
      if (Math.abs(voiceDuckPitch - ab.hz) < range)
        voiceDuckPitch += (ab.hz - voiceDuckPitch) * winNum("__VOICE_ASSIST__", 5) * dt;
    }
    voiceDuckPitch = clampN(voiceDuckPitch, PITCH_LO, PITCH_HI);
    return voiceDuckPitch;
  }

  function column(H) { return { top: H * 0.14, bot: H * 0.86 }; }

  function runParams(W) {
    const nowX = Math.min(W * 0.3, 140);
    const p = { W, nowX };
    const ov = {
      PITCH_RISE: winNum("__PITCH_RISE__"), PITCH_FALL: winNum("__PITCH_FALL__"),
      TOL0: winNum("__TOL__"), SCROLL0: winNum("__SCROLL__"),
      SCROLL_CAP: winNum("__SCROLL_CAP__"), noteForce: winNum("__NOTE_FORCE__"),
    };
    for (const k in ov) if (ov[k] != null) p[k] = ov[k];
    return p;
  }

  function reset() {
    const W = engine.width;
    run = createRun(runParams(W));
    state = "ready";
    best = engine.highscore("quackoustic-pts");
    holding = false;
    t = 0;
    particles = [];
    popups = [];
    rings = [];
    flash = 0;
    shake = 0;
    lockGlow = 0;
    perfectT = 0;
    voiceDuckPitch = (PITCH_LO + PITCH_HI) / 2; // duck starts centered until the player sings
    lastVoiceMs = 9999;
    rawVoiceHz = 0;
    voiceLevel = 0;
  }

  const TONE_GAIN = () => winNum("__TONE_GAIN__", 0.09);

  function spawnSpark(x, y, col) {
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * 6.28, sp = 70 + Math.random() * 130;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.35 + Math.random() * 0.25, col: col || "#36e6ff" });
    }
  }

  function handleEvent(ev, W, H) {
    const { top, bot } = column(H);
    if (ev.type === "lock") {
      audio.quack(ev.hz, ev.perfect ? 0.22 : 0.18); // play the note -> a melody forms
      if (ev.perfect) audio.quack(ev.hz * 2, 0.12); // bright harmonic on a perfect
      const y = pitchToY(ev.hz, top, bot);
      spawnSpark(run.nowX, y, ev.perfect ? "#ffe66b" : "#36e6ff");
      rings.push({ x: run.nowX, y, r: DUCK_R, vr: 110, life: 0.5, col: ev.perfect ? "#ffe66b" : "#9becff" });
      const gain = run.cfg.BASE * ev.mult + (ev.perfect ? run.cfg.PERFECT_BONUS : 0);
      popups.push({ x: run.nowX + DUCK_R, y, txt: (ev.perfect ? "PERFEKT " : "") + "+" + gain, life: 0.9, col: ev.perfect ? "#ffe66b" : "#dafbff" });
      flash = ev.perfect ? 0.32 : 0.18;
      lockGlow = 0.4;
      if (ev.perfect) perfectT = 0.5; // brief blissful-pose flash
    } else if (ev.type === "miss") {
      audio.sadQuack();
      shake = 0.4;
    } else if (ev.type === "over") {
      state = "over";
      best = engine.highscore("quackoustic-pts", run.S.pts);
    }
  }

  function stepFx(dt) {
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 160 * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const r of rings) { r.r += r.vr * dt; r.life -= dt; }
    rings = rings.filter((r) => r.life > 0);
    for (const pp of popups) { pp.y -= 34 * dt; pp.life -= dt; }
    popups = popups.filter((pp) => pp.life > 0);
    if (flash > 0) flash = Math.max(0, flash - dt * 1.6);
    if (shake > 0) shake = Math.max(0, shake - dt * 1.8);
    if (lockGlow > 0) lockGlow = Math.max(0, lockGlow - dt * 1.4);
    if (perfectT > 0) perfectT = Math.max(0, perfectT - dt);
  }

  function update(e, dt) {
    const W = e.width, H = e.height;
    t += dt;

    if (BOT && typeof window !== "undefined" && !window.__BOT_OFF__) {
      if (state === "ready") state = "play";
      else if (state === "over") reset();
      if (state === "play") {
        let next = null;
        for (const b of run.S.bands)
          if (!b.locked && !b.missed && b.x > run.nowX - run.cfg.HIT_HALF && (!next || b.x < next.x)) next = b;
        if (next) {
          if (run.S.pitch < next.hz - 4) holding = true;
          else if (run.S.pitch > next.hz + 4) holding = false;
        }
      }
    }

    lastVoiceMs += dt * 1000;
    const voiceActive = micReady; // mic granted & streaming -> the voice drives pitch
    if (state === "play") {
      // VOICE mode: a smooth physical pitch driven by sung frequency + loudness,
      // gravity on silence, and an assist magnet (voiceStep). HOLD is the fallback.
      const ev = voiceActive ? run.step(dt, false, voiceStep(dt)) : run.step(dt, holding);
      for (const e2 of ev) handleEvent(e2, W, H);
      // self-tone ONLY in the hold fallback — in voice mode a continuous tone
      // would feed the AEC-off mic and poison pitch detection.
      if (toneHandle) {
        if (voiceActive) toneHandle.setGain(0);
        else { toneHandle.setFreq(run.S.pitch); toneHandle.setGain(audio.isMuted() ? 0 : TONE_GAIN()); }
      }
      stepFx(dt);
    } else {
      if (toneHandle) toneHandle.setGain(0);
      stepFx(dt);
    }
    writeQA(W, H);
  }

  function writeQA(W, H) {
    if (!QA) return;
    const S = run.S;
    QA.state = state;
    QA.pitch = S.pitch; QA.lives = S.lives; QA.score = S.score;
    QA.combo = S.combo; QA.mult = S.mult; QA.locks = S.locks; QA.misses = S.misses; QA.pts = S.pts;
    let next = null;
    for (const b of S.bands)
      if (!b.locked && !b.missed && b.x > run.nowX - run.cfg.HIT_HALF && (!next || b.x < next.x)) next = b;
    QA.nextBandHz = next ? next.hz : null;
    QA.nextBandTol = next ? next.tol : null;
    QA.voice = !!micReady; QA.micState = micState;
    QA.voicePitch = voiceDuckPitch; QA.rawVoiceHz = rawVoiceHz; QA.voiceLevel = voiceLevel;
    QA.W = W; QA.H = H;
  }

  function render(e, ctx) {
    const W = e.width, H = e.height;
    const { top, bot } = column(H);
    const nowX = run.nowX;
    const sx = shake > 0 ? (Math.random() - 0.5) * shake * 14 : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * shake * 14 : 0;
    ctx.save();
    ctx.translate(sx, sy);

    // backdrop: deep gradient + faint oscilloscope grid
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a0e1a");
    bg.addColorStop(1, "#0c1430");
    ctx.fillStyle = bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.strokeStyle = "rgba(54,230,255,0.06)";
    ctx.lineWidth = 1;
    for (let gy = top; gy <= bot; gy += (bot - top) / 8) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

    // scale guide ticks (faint) — where the consonant notes sit
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#9fe9ff";
    ctx.setLineDash([2, 8]);
    for (const hz of SCALE) { const y = pitchToY(hz, top, bot); ctx.beginPath(); ctx.moveTo(nowX, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.restore();

    // scrolling note-bands
    const HH = run.cfg.HIT_HALF;
    for (const b of run.S.bands) {
      const yc = pitchToY(b.hz, top, bot);
      const yTop = pitchToY(b.hz + b.tol, top, bot);
      const yBot = pitchToY(b.hz - b.tol, top, bot);
      const x = b.x - HH;
      let col = "rgba(54,230,255,0.30)", edge = "#36e6ff";
      if (b.locked) { col = "rgba(255,214,63,0.34)"; edge = "#ffe66b"; }
      else if (b.missed) { col = "rgba(255,90,120,0.18)"; edge = "rgba(255,90,120,0.5)"; }
      else if (Math.abs(b.x - nowX) <= HH && isPitchIn(run.S.pitch, b).hit) { col = "rgba(54,230,255,0.55)"; }
      roundRect(ctx, x, yTop, HH * 2, Math.max(8, yBot - yTop), 8);
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.stroke();
      // lock-meter fill (left-to-right) while charging
      if (!b.locked && !b.missed && b.lockMs > 0) {
        const f = Math.min(1, b.lockMs / run.cfg.HOLD_MS);
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fillRect(x, yc - 2, HH * 2 * f, 4);
      }
      // note label
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "10px 'JetBrains Mono', ui-monospace, monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(Math.round(b.hz) + "", b.x, yc);
    }

    // the now-line (judge column)
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.shadowColor = "#36e6ff"; ctx.shadowBlur = 10 + lockGlow * 30;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(nowX, top - 10); ctx.lineTo(nowX, bot + 10); ctx.stroke();
    ctx.restore();

    // pickup rings + particles
    for (const r of rings) {
      ctx.globalAlpha = clampN(r.life * 2, 0, 1) * 0.7;
      ctx.strokeStyle = r.col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const p of particles) {
      ctx.globalAlpha = clampN(p.life * 2.5, 0, 1);
      ctx.fillStyle = p.col; ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // the duck riding its own pitch on the now-line: a chroma-keyed sprite (sing
    // pose, or the blissful pose right after a PERFECT lock), canvas fallback.
    const dy = pitchToY(run.S.pitch, top, bot);
    const squash = clampN(1 + (holding ? 0.12 : -0.06) + flash * 0.3, 0.82, 1.3);
    const sprite = state !== "over" && perfectT > 0 && duckTuned.ready ? duckTuned
      : state !== "over" && duckSing.ready ? duckSing : null;
    if (sprite) {
      const h = DUCK_R * 1.5 * 1.7 * squash;
      const w = h * (sprite.img.naturalWidth / sprite.img.naturalHeight);
      ctx.save();
      if (perfectT > 0) { ctx.shadowColor = "#ffe66b"; ctx.shadowBlur = 16; }
      ctx.drawImage(sprite.img, nowX - w / 2, dy - h / 2, w, h);
      ctx.restore();
    } else {
      drawDuck(ctx, nowX, dy, DUCK_R * 1.5, { squash, pose: state === "over" ? "sad" : "default" });
    }

    // popups
    ctx.textAlign = "center";
    ctx.font = "bold 15px 'JetBrains Mono', ui-monospace, monospace";
    for (const pp of popups) {
      ctx.globalAlpha = clampN(pp.life * 1.4, 0, 1);
      ctx.fillStyle = pp.col || "#dafbff";
      ctx.fillText(pp.txt, pp.x, pp.y);
    }
    ctx.globalAlpha = 1;

    // lock flash
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${clampN(flash, 0, 0.3)})`; ctx.fillRect(0, 0, W, H); }

    ctx.restore(); // shake

    // --- HUD (safe-area aware) ---
    const st = e.safe.top, sl = e.safe.left;
    const hudR = W - 64 - e.safe.right;
    ctx.fillStyle = "#dfe6f3";
    ctx.font = "bold 22px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText("♪ " + run.S.pts.toLocaleString(), 16 + sl, 12 + st);
    // lives as little hearts
    ctx.textAlign = "right";
    ctx.fillStyle = "#ff6b8a";
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText("♥".repeat(Math.max(0, run.S.lives)) || "—", hudR, 14 + st);
    ctx.fillStyle = "rgba(223,230,243,0.5)";
    ctx.font = "13px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillText("best " + best.toLocaleString(), hudR, 36 + st);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(223,230,243,0.55)";
    ctx.fillText("‹ hub", 16 + sl, 40 + st);

    // combo chip
    if (run.S.mult > 1) {
      ctx.save();
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.shadowColor = "#36e6ff"; ctx.shadowBlur = 9 + flash * 14;
      ctx.fillStyle = flash > 0 ? "#9fe9ff" : "#36e6ff";
      ctx.font = `400 ${Math.round(24 * (1 + flash * 0.3))}px "Audiowide", system-ui, sans-serif`;
      ctx.fillText("x" + run.S.mult, W / 2, 26 + st);
      ctx.restore();
    }

    // ?dbg readout
    if (DBG) {
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(8, H - 80, 270, 72);
      ctx.fillStyle = "#9fe9ff"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
      const nb = (() => { let n = null; for (const b of run.S.bands) if (!b.locked && !b.missed && b.x > nowX - HH && (!n || b.x < n.x)) n = b; return n; })();
      // voice readout: raw sung Hz -> mapped game pitch, the mic state, and the
      // current voice range so VOICE_LO/HI can be calibrated on a real phone.
      const voiced = lastVoiceMs < winNum("__VOICE_GRACE__", 160);
      ctx.fillStyle = micReady ? (voiced ? "#7CFF9B" : "#ffd27a") : "#ffb27a";
      ctx.fillText("voice " + (rawVoiceHz ? rawVoiceHz.toFixed(0) + "Hz" : "—") + " lvl " + (voiceLevel || 0).toFixed(2) + (voiced ? " ●" : " ·") + " [" + micState + "] range " + VOICE_LO() + "-" + VOICE_HI(), 14, H - 76);
      ctx.fillStyle = "#9fe9ff";
      ctx.fillText("duck " + run.S.pitch.toFixed(0) + "Hz", 14, H - 60);
      ctx.fillText("target " + (nb ? nb.hz.toFixed(0) + "±" + nb.tol.toFixed(0) : "—"), 14, H - 46);
      ctx.fillText("scroll " + Math.min(run.cfg.SCROLL_CAP, run.cfg.SCROLL0 + run.S.score * run.cfg.SCROLL_RAMP).toFixed(0) + " · gain " + TONE_GAIN(), 14, H - 32);
    }

    // voice guidance while playing (until the mic is confirmed active)
    if (state === "play" && !micReady) {
      ctx.save();
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.font = "13px 'JetBrains Mono', ui-monospace, monospace";
      const denied = micState === "denied" || micState === "nomic" || micState === "unsupported" || micState === "error";
      ctx.fillStyle = denied ? "rgba(255,170,120,0.9)" : "rgba(255,255,255,0.7)";
      const msg = micState === "requesting" ? "🎤 Mikro freigeben…"
        : denied ? "kein Mikro – halten = höher, loslassen = tiefer"
        : "🎤 erlaube das Mikro und SING";
      ctx.fillText(msg, W / 2, 54 + st);
      ctx.restore();
    }

    if (state === "ready")
      banner(ctx, W, H, "QUACKOUSTIC",
        "Tippen, dann ins Mikro SINGEN 🦆🎤 — tief = runter, hoch = hoch, halten = stehen. Triff die Töne!", "#36e6ff",
        "kein Mikro? Halten/Loslassen tut's auch");
    else if (state === "over")
      banner(ctx, W, H, run.S.pts.toLocaleString() + " Punkte",
        run.S.locks + " Töne getroffen. " + (run.S.locks > 8 ? "Goldkehlchen! 🦆" : "Hast du's aus- und wieder eingeschaltet?"),
        "#ff7b9c", "Tippen für nochmal");
  }

  function banner(ctx, W, H, title, sub, color, foot) {
    ctx.fillStyle = "rgba(8,10,16,0.74)";
    ctx.fillRect(0, H * 0.32, W, H * 0.36);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const maxW = W * 0.86;
    const tSize = Math.min(W * 0.085, 40);
    ctx.fillStyle = color;
    ctx.font = `400 ${tSize}px "Audiowide", system-ui, sans-serif`;
    const tLines = wrapText(ctx, title, maxW);
    tLines.forEach((ln, i) => ctx.fillText(ln, W / 2, H * 0.43 + (i - (tLines.length - 1) / 2) * tSize * 1.15));
    const sSize = Math.min(W * 0.038, 16);
    ctx.fillStyle = "#cfd6e6";
    ctx.font = `${sSize}px 'JetBrains Mono', ui-monospace, monospace`;
    const sLines = wrapText(ctx, sub, maxW);
    const syy = H * 0.52;
    sLines.forEach((ln, i) => ctx.fillText(ln, W / 2, syy + i * sSize * 1.4));
    if (foot) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      let fy = syy + sLines.length * sSize * 1.4 + sSize * 0.4;
      wrapText(ctx, foot, maxW).forEach((ln, i) => ctx.fillText(ln, W / 2, fy + i * sSize * 1.4));
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // request the mic on a user gesture; on grant the voice drives the duck, on any
  // failure the hold fallback silently takes over.
  function tryEnableVoice() {
    if (pitchMic) return;
    pitchMic = createPitchMic({
      onPitch: (hz, clarity, sm, level) => {
        voiceLevel = level || 0;
        // a frame counts as "voiced" only with a real pitch AND enough loudness,
        // so breathing/room tone lets the duck fall instead of jittering.
        if (hz > 0 && sm > 0 && voiceLevel > winNum("__VOICE_GATE__", 0.12)) { rawVoiceHz = sm; lastVoiceMs = 0; }
      },
      onState: (s) => {
        micState = s;
        if (s === "ready" || s === "requesting") { micReady = s === "ready"; audio.setMicSuspend(true); }
        else { micReady = false; audio.setMicSuspend(false); }
      },
    });
    pitchMic.enable(audio.unlock());
  }
  function press() {
    if (state === "over") { reset(); return; }
    if (state === "ready") { state = "play"; tryEnableVoice(); }
    holding = true;
  }
  function release() { holding = false; }
  function onPress(e, ev) {
    const p = e.input.pointer;
    if (ev && ev.clientX !== undefined && p.x < 84 && p.y < 60) { goHub(); return; }
    press();
  }

  return {
    enter() {
      reset();
      pitchMic = null; micReady = false; micState = "idle";
      audio.startMusic();
      toneHandle = audio.tone(run.S.pitch);
      if (toneHandle) toneHandle.setGain(0);
    },
    exit() {
      if (toneHandle) { toneHandle.stop(); toneHandle = null; }
      if (pitchMic) { pitchMic.disable(); pitchMic = null; }
      micReady = false;
      audio.setMicSuspend(false);
    },
    onResize() { if (state === "ready") reset(); },
    update,
    render,
    onPress,
    onRelease: release,
  };
}
