// mic.js — the rubber-duck-squeak controller for DUCK & COVER.
// A real rubber duck squeezed near the microphone = the jump button; louder
// squeeze = higher jump ("peak = height"). 100% additive and opt-in: tap /
// keyboard always work, every failure path falls back to tap, the game never
// breaks. Analyser-only — no recording, no network.
//
// Design synthesized from a 3-way design panel + adversarial review. Key points:
//   - getUserMedia with echoCancellation/noiseSuppression/autoGainControl OFF
//     (NS would attenuate the ~800Hz squeak 20-40dB; AGC would flatten "louder").
//   - bandpass 300-2000Hz raises squeak SNR vs hiss/keyboard.
//   - adaptive ambient floor (median seed + asymmetric, frame-rate-independent
//     EMA, frozen while a squeak is hot) so the slider stays pure preference.
//   - fire-on-fall with peak-hold for true peak->height, 2-frame attack-confirm
//     to reject key-clack, refractory so one squeeze = one jump.
//   - software self-mute window (noteAudioOut) so the game's own quack — which
//     re-enters the mic because AEC is off — cannot self-trigger.

import { clamp, lerp } from "./engine.js";
import { unlock } from "./audio.js";

// localStorage that never throws (private mode / Node / disabled storage)
const lsGet = (k) => {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(k) : null;
  } catch (e) {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(k, v);
  } catch (e) {
    /* ignore */
  }
};

export function createMic({ onJump, onMeter, onState } = {}) {
  // --- tunables (see concrete_params) ---
  const HP = 300, LP = 2000, FFT = 1024;
  const CALIB_MS = 300, FLOOR_MIN = 0.004, FLOOR_MAX = 0.03;
  const TAU_UP = 3.0, TAU_DOWN = 0.4; // floor rise slow, fall fast (seconds)
  const ABS_MIN_LEVEL = 0.1, ATTACK_FRAMES = 2;
  const PEAK_WINDOW_MS = 120, REFRACTORY_MS = 120; // shorter -> faster re-fire
  const GAMMA = 0.7;
  // jump HEIGHT is decoupled from the activation threshold: it scales with how
  // far the squeak rose ABOVE the ambient floor, over this span. So lowering
  // the trigger (easier to jump) does not inflate every jump to max height.
  const STR_SPAN = 0.42;

  const toLevel = (x) => clamp((20 * Math.log10(x + 1e-7) + 70) / 70, 0, 1);
  const clampSens = (v) => {
    // null/undefined/"" (no stored pref) -> 0.5 default; Number(null) is 0, so
    // an explicit empty check is required or first-time users get sens=0.
    if (v === null || v === undefined || v === "") return 0.6;
    const n = Number(v);
    return isFinite(n) ? clamp(n, 0, 1) : 0.5;
  };

  // --- audio graph ---
  let stream = null, src = null, hp = null, lp = null, analyser = null;
  let buf = null, ctx = null;

  // --- detector state ---
  let enabled = false;
  let sens = clampSens(lsGet("quack:micsens"));
  let floor = FLOOR_MIN;
  let calibMs = 0, calibSamples = [];
  let phase = "idle", risingN = 0, peakLevel = 0, activeMs = 0;
  let refractoryMs = 0, selfMuteMs = 0, sawValidFrame = false;

  function setSens(s) {
    sens = clamp(s, 0, 1);
    lsSet("quack:micsens", String(sens));
  }
  function noteAudioOut(durMs) {
    // pad past the tail so the game's own quack can't self-trigger
    selfMuteMs = Math.max(selfMuteMs, (durMs || 180) + 60);
  }
  function mapErr(e) {
    const n = e && e.name;
    if (n === "NotAllowedError" || n === "SecurityError") return "denied";
    if (n === "NotFoundError") return "nomic";
    return "error";
  }

  async function enable() {
    if (enabled) return null;
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      onState && onState("unsupported");
      return null;
    }
    onState && onState("requesting");
    ctx = unlock(); // share + resume the ONE AudioContext, inside the gesture
    if (!ctx) {
      onState && onState("unsupported");
      return null;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
    } catch (err) {
      if (err && err.name === "OverconstrainedError") {
        // some platforms can't disable AGC and reject the constraint object;
        // reopen degraded rather than dropping to tap-only.
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
        } catch (e2) {
          onState && onState(mapErr(e2));
          return null;
        }
      } else {
        onState && onState(mapErr(err));
        return null;
      }
    }
    const track = stream.getAudioTracks()[0];
    track.addEventListener("ended", () => {
      onState && onState("ended");
      disable();
    });
    src = ctx.createMediaStreamSource(stream);
    hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = HP;
    hp.Q.value = 0.707;
    lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = LP;
    lp.Q.value = 0.707;
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT;
    analyser.smoothingTimeConstant = 0;
    src.connect(hp).connect(lp).connect(analyser); // NEVER -> destination (feedback)
    buf = new Float32Array(analyser.fftSize);

    // reset detector for a fresh room
    floor = FLOOR_MIN;
    phase = "idle";
    risingN = 0;
    peakLevel = 0;
    activeMs = 0;
    refractoryMs = 0;
    selfMuteMs = 0;
    calibMs = 0;
    calibSamples = [];
    sawValidFrame = false;
    enabled = true;
    onState && onState("calibrating");
    return track.getSettings ? track.getSettings() : null;
  }

  function disable() {
    enabled = false;
    phase = "idle";
    try {
      stream && stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      /* ignore */
    }
    try {
      src && src.disconnect();
      hp && hp.disconnect();
      lp && lp.disconnect();
      analyser && analyser.disconnect();
    } catch (e) {
      /* ignore */
    }
    stream = src = hp = lp = analyser = buf = null;
    onState && onState("off");
  }

  // Call ONCE per frame from duckcover.update(e,dt), BEFORE the state guard,
  // so a squeak can also START / RESTART the run.
  function tick(dt) {
    if (!enabled || !analyser) return;
    if (ctx && ctx.state === "suspended") return; // wait for a gesture to resume
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const s = buf[i];
      sum += s * s;
    }
    let rms = Math.sqrt(sum / buf.length);
    if (!isFinite(rms)) rms = 0;
    _process(rms, dt);
  }

  // Pure detector step on an already-measured rms. Shared by tick() and the
  // test seam below — keeps the algorithm headless-verifiable.
  function _process(rms, dt) {
    if (!isFinite(rms)) rms = 0;
    const dtMs = dt * 1000;
    if (selfMuteMs > 0) selfMuteMs -= dtMs;
    if (refractoryMs > 0) refractoryMs -= dtMs;
    if (rms > 0) sawValidFrame = true;
    const level = toLevel(rms);

    if (calibMs < CALIB_MS) {
      calibMs += dtMs;
      calibSamples.push(rms);
      if (calibMs >= CALIB_MS) {
        calibSamples.sort((a, b) => a - b);
        floor = clamp(
          calibSamples[calibSamples.length >> 1] || FLOOR_MIN,
          FLOOR_MIN,
          FLOOR_MAX
        );
        onState && onState(floor > 0.022 ? "noisy" : "ready");
      }
      onMeter && onMeter({ level, trigger: 0, hot: false, floor: 0 });
      return;
    }

    const floorLevel = toLevel(floor);
    // margin above the ambient floor. Calibrated to a real device (floor~0.31,
    // squeak peak~0.70): at mid-slider trig sits ~0.08 over floor (~+6dB) — well
    // under a real squeak, clear of ambient. At max sensitivity ~0.02 over floor.
    const margin = lerp(0.13, 0.02, sens);
    const triggerLevel = Math.max(floorLevel + margin, ABS_MIN_LEVEL);
    const releaseLevel = floorLevel + margin * 0.5; // hysteresis
    const hotNow = level > triggerLevel && selfMuteMs <= 0 && sawValidFrame;

    // adaptive floor: rise slow, fall fast, frozen while a real squeak is hot
    const aUp = 1 - Math.exp(-dt / TAU_UP);
    const aDown = 1 - Math.exp(-dt / TAU_DOWN);
    if (!(rms > floor && hotNow))
      floor += (rms - floor) * (rms > floor ? aUp : aDown);
    floor = clamp(floor, FLOOR_MIN, FLOOR_MAX);

    if (phase === "idle") {
      if (refractoryMs <= 0 && hotNow) {
        phase = "rising";
        risingN = 1;
        peakLevel = level;
        activeMs = dtMs;
      }
    } else if (phase === "rising") {
      if (hotNow) {
        risingN++;
        peakLevel = Math.max(peakLevel, level);
        activeMs += dtMs;
        if (risingN >= ATTACK_FRAMES) phase = "active";
      } else {
        phase = "idle"; // single-frame transient (key clack) — reject
      }
    } else if (phase === "active") {
      peakLevel = Math.max(peakLevel, level);
      activeMs += dtMs;
      if (level < releaseLevel || activeMs >= PEAK_WINDOW_MS) {
        fire(floorLevel);
        phase = "cooldown";
        refractoryMs = REFRACTORY_MS;
      }
    } else if (phase === "cooldown") {
      if (level < releaseLevel && refractoryMs <= 0) phase = "idle";
    }
    onMeter && onMeter({ level, trigger: triggerLevel, hot: hotNow, floor: floorLevel });
  }

  function fire(floorLevel) {
    const above = Math.max(peakLevel - floorLevel, 0); // rise over ambient
    const raw = above / STR_SPAN; // UNCAPPED: 1.0 == a max-height squeak; the
    // height clamps to [0,1] but screen-shake uses the headroom above 1.0.
    let strength = clamp(raw, 0, 1);
    strength = Math.pow(strength, GAMMA); // gamma<1: generous mid-high
    onJump && onJump(strength, raw);
  }

  return {
    enable,
    disable,
    tick,
    setSens,
    getSens: () => sens,
    isEnabled: () => enabled,
    noteAudioOut,
    // test-only seam: drive the detector with synthetic rms frames (no mic).
    // Used by _verify/mictest-node.mjs; inert in production.
    _feedTest: (rms, dt) => _process(rms, dt),
  };
}
