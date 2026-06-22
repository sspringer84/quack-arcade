// pitch.js — voice pitch detection for QUACKOUSTIC (SingStar-style control).
// detectPitch() is PURE (YIN, node-testable). createPitchMic() opens its OWN
// getUserMedia stream + analyser and reports the sung fundamental each frame.
//
// This is a DEDICATED path: it does NOT touch mic.js (the DUCK & COVER loudness
// detector), so that game can never regress. Same hardened constraints
// (echoCancellation/noiseSuppression/autoGainControl OFF) — NS would eat the
// voice, AGC would fight the pitch's amplitude. Analyser-only: no recording.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// YIN pitch detector. `buf` = time-domain samples in [-1,1]. Returns the
// fundamental in Hz and a clarity in [0,1] (1 = a clean, confident tone).
// Returns {hz:0, clarity:0} for silence / no confident pitch.
export function detectPitch(buf, sampleRate, opts = {}) {
  const SIZE = buf.length;
  const minF = opts.minF != null ? opts.minF : 70;
  const maxF = opts.maxF != null ? opts.maxF : 1100;
  const threshold = opts.threshold != null ? opts.threshold : 0.15;
  const rmsGate = opts.rmsGate != null ? opts.rmsGate : 0.01;

  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (!isFinite(rms) || rms < rmsGate) return { hz: 0, clarity: 0 };

  const tauMax = Math.min(Math.floor(sampleRate / minF), SIZE >> 1);
  const tauMin = Math.max(2, Math.floor(sampleRate / maxF));
  if (tauMax <= tauMin) return { hz: 0, clarity: 0 };

  // difference function d(tau) over the usable window
  const W = SIZE - tauMax;
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) { const delta = buf[i] - buf[i + tau]; sum += delta * delta; }
    d[tau] = sum;
  }
  // cumulative mean normalized difference d'(tau)
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
  }
  // absolute threshold: first tau in range dipping below it, walk to its local min
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) {
    // no clear dip — take the global minimum in range as a best guess (low clarity)
    let best = tauMin, bv = Infinity;
    for (let t = tauMin; t <= tauMax; t++) if (cmnd[t] < bv) { bv = cmnd[t]; best = t; }
    tau = best;
  }
  // parabolic interpolation around tau for sub-sample accuracy
  let betterTau = tau;
  if (tau > tauMin && tau < tauMax) {
    const s0 = cmnd[tau - 1], s1 = cmnd[tau], s2 = cmnd[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tau + (s2 - s0) / denom;
  }
  const hz = sampleRate / betterTau;
  if (hz < minF || hz > maxF) return { hz: 0, clarity: 0 };
  return { hz, clarity: clamp(1 - cmnd[tau], 0, 1) };
}

// Median-of-N smoother + octave-jump guard, so a single bad frame doesn't make
// the duck twitch. Stateful helper used by createPitchMic.
export function makePitchSmoother(n = 5) {
  const buf = [];
  let last = 0;
  return (hz, clarity, minClarity = 0.55) => {
    if (hz <= 0 || clarity < minClarity) return last; // hold last good on a weak frame
    // guard against a sudden octave flip: if ~half/double of last, nudge toward last
    if (last > 0) {
      if (Math.abs(hz - last / 2) < last * 0.06) hz *= 2;
      else if (Math.abs(hz - last * 2) < last * 0.12) hz /= 2;
    }
    buf.push(hz);
    if (buf.length > n) buf.shift();
    const s = [...buf].sort((a, b) => a - b);
    last = s[s.length >> 1];
    return last;
  };
}

// Opens a mic, runs detectPitch each frame, calls onPitch(hz, clarity, smoothed).
// onState reports lifecycle like mic.js. Fully additive; tap/keyboard fallback in
// the scene covers any failure path (denied/nomic/unsupported).
export function createPitchMic({ onPitch, onState } = {}) {
  let stream = null, src = null, hp = null, analyser = null, buf = null, ctx = null;
  let enabled = false, raf = 0;
  const smooth = makePitchSmoother(5);

  function mapErr(e) {
    const n = e && e.name;
    if (n === "NotAllowedError" || n === "SecurityError") return "denied";
    if (n === "NotFoundError") return "nomic";
    return "error";
  }

  async function enable(sharedCtx) {
    if (enabled) return true;
    if (!(typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      onState && onState("unsupported");
      return false;
    }
    onState && onState("requesting");
    ctx = sharedCtx || null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        video: false,
      });
    } catch (err) {
      if (err && err.name === "OverconstrainedError") {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
        catch (e2) { onState && onState(mapErr(e2)); return false; }
      } else { onState && onState(mapErr(err)); return false; }
    }
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") { try { await ctx.resume(); } catch (e) { /* ignore */ } }
    const track = stream.getAudioTracks()[0];
    track.addEventListener("ended", () => { onState && onState("ended"); disable(); });
    src = ctx.createMediaStreamSource(stream);
    hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 60; hp.Q.value = 0.707; // drop rumble/DC, keep voice fundamental
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    src.connect(hp).connect(analyser); // NEVER to destination (feedback)
    buf = new Float32Array(analyser.fftSize);
    enabled = true;
    onState && onState("ready");
    const loop = () => {
      if (!enabled || !analyser) return;
      analyser.getFloatTimeDomainData(buf);
      // loudness (0..1) — a secondary control factor + the voiced gate
      let ms = 0;
      for (let i = 0; i < buf.length; i++) ms += buf[i] * buf[i];
      const rms = Math.sqrt(ms / buf.length);
      const level = clamp((20 * Math.log10(rms + 1e-7) + 70) / 70, 0, 1);
      const { hz, clarity } = detectPitch(buf, ctx.sampleRate);
      const sm = smooth(hz, clarity);
      onPitch && onPitch(hz, clarity, sm, level);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return true;
  }

  function disable() {
    enabled = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ }
    try { src && src.disconnect(); hp && hp.disconnect(); analyser && analyser.disconnect(); } catch (e) { /* ignore */ }
    stream = src = hp = analyser = buf = null;
    onState && onState("off");
  }

  return { enable, disable, isEnabled: () => enabled };
}
