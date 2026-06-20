// main.js — boots the engine, wires audio unlock + mute, and routes between the
// hub menu and the games.

import { Engine } from "./engine.js";
import { drawDuck } from "./duck.js";
import * as audio from "./audio.js";
import { duckCover } from "./games/duckcover.js";
import { createFlyers } from "./flyingducks.js";
import { FLYER_VARIANTS, FLYER_FACE_LEFT } from "./flyervariants.js";

const canvas = document.getElementById("game");
const engine = new Engine(canvas);

// test-only telemetry, opt-in via ?qa=1 so _verify/ can read jump + mic events
const QA =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("qa");
if (QA) window.__QA__ = { jumps: [], states: [] };
// mic calibration readout: open with ?cal=1 to see live floor/level/trigger
const CAL =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("cal");

// Unlock audio on the first user gesture anywhere (autoplay policy).
const unlockOnce = () => {
  audio.unlock();
  window.removeEventListener("pointerdown", unlockOnce);
  window.removeEventListener("keydown", unlockOnce);
};
window.addEventListener("pointerdown", unlockOnce);
window.addEventListener("keydown", unlockOnce);

const muteBtn = document.getElementById("mute");
muteBtn.addEventListener("click", () => {
  const m = audio.toggleMuted();
  muteBtn.textContent = m ? "🔇" : "🔊";
});

// --- mic (rubber-duck-squeak) controller UI ---
const micEl = document.getElementById("mic");
const micToggle = document.getElementById("mic-toggle");
const micCal = document.getElementById("mic-cal");
const micFill = document.getElementById("mic-fill");
const micTick = document.getElementById("mic-tick");
const micSens = document.getElementById("mic-sens");
const micStatus = document.getElementById("mic-status");
const MIC_LABEL = "🦆 Quietschen = Sprung";
const MIC_SUPPORTED = !!(
  navigator.mediaDevices && navigator.mediaDevices.getUserMedia
);

let activeMic = null;
let micPeak = 0; // decaying peak-hold of the input level, for the ?cal readout
let micHintDone = false;
try {
  micHintDone = !!localStorage.getItem("quack:micseen");
} catch (e) {
  /* ignore */
}

const setStatus = (t) => {
  if (micStatus) micStatus.textContent = t;
};

function renderMicState(st) {
  if (QA) window.__QA__.states.push(st);
  if (!micEl) return;
  const press = (v) => micToggle.setAttribute("aria-pressed", v);
  if (st !== "calibrating") micEl.classList.remove("pulse");
  switch (st) {
    case "unsupported":
      micEl.hidden = true;
      break;
    case "off":
      micToggle.textContent = MIC_LABEL;
      micToggle.disabled = false;
      press("false");
      micCal.hidden = true;
      break;
    case "requesting":
      micToggle.textContent = "… Mikro freigeben?";
      micToggle.disabled = true;
      break;
    case "calibrating":
      micToggle.textContent = "🦆 kalibriere Raum…";
      micToggle.disabled = false;
      press("true");
      micCal.hidden = false;
      micTick.hidden = true;
      micEl.classList.add("pulse");
      setStatus("Kurz still sein – ich höre den Raum ab…");
      break;
    case "ready":
      micToggle.textContent = "🦆 Ente aktiv";
      press("true");
      micCal.hidden = false;
      micTick.hidden = false;
      setStatus(
        micHintDone
          ? "Audio bleibt im Browser. Nichts wird gesendet."
          : "Drück die Ente vors Mikro – lauter = höher 🦆"
      );
      break;
    case "noisy":
      micToggle.textContent = "🦆 Ente aktiv";
      press("true");
      micCal.hidden = false;
      micTick.hidden = false;
      setStatus("Ganz schön laut hier – näher ans Mikro. Tippen geht immer.");
      break;
    case "denied":
      micToggle.textContent = "🔇 Mikro abgelehnt – tippen tut's auch";
      press("false");
      micCal.hidden = true;
      break;
    case "nomic":
      micToggle.textContent = "Kein Mikro – tippen zum Springen";
      press("false");
      micCal.hidden = true;
      break;
    case "ended":
      micToggle.textContent = MIC_LABEL;
      press("false");
      micCal.hidden = true;
      break;
    case "error":
    default:
      micToggle.textContent = "Mikro-Fehler – tippen zum Springen";
      press("false");
      micCal.hidden = true;
      break;
  }
}

function appendAgcDiag(s) {
  if (!micStatus || !s) return;
  if (s.autoGainControl === undefined && s.noiseSuppression === undefined)
    return;
  micStatus.textContent +=
    "  ·  AGC=" + s.autoGainControl + " NS=" + s.noiseSuppression;
}

const micUi = {
  show(mic) {
    activeMic = mic;
    if (!MIC_SUPPORTED || !micEl) {
      if (micEl) micEl.hidden = true;
      return;
    }
    micEl.hidden = false;
    micCal.hidden = true;
    micToggle.textContent = MIC_LABEL;
    micToggle.disabled = false;
    micToggle.setAttribute("aria-pressed", "false");
    micSens.value = mic.getSens();
    audio.onAudioOut((ms) => mic.noteAudioOut(ms));
  },
  hide() {
    if (micEl) micEl.hidden = true;
    audio.onAudioOut(null);
    activeMic = null;
  },
  meter({ level, trigger, hot, floor }) {
    if (!micFill) return;
    micFill.style.width = level * 100 + "%";
    micFill.classList.toggle("hot", !!hot);
    micTick.style.left = trigger * 100 + "%";
    if (hot && !micHintDone) {
      micHintDone = true;
      try {
        localStorage.setItem("quack:micseen", "1");
      } catch (e) {
        /* ignore */
      }
      setStatus("Audio bleibt im Browser. Nichts wird gesendet.");
    }
    if (CAL) {
      micPeak = Math.max(level, micPeak * 0.96); // slow-decay peak hold
      const pct = (x) => ((x || 0) * 100) | 0;
      setStatus(
        "floor " + pct(floor) + " · in " + pct(level) +
          " · trig " + pct(trigger) + " · peak " + pct(micPeak)
      );
    }
  },
  state: renderMicState,
};

if (micToggle) {
  micToggle.addEventListener("click", async () => {
    if (!activeMic) return;
    if (activeMic.isEnabled()) {
      activeMic.disable();
      return;
    }
    const settings = await activeMic.enable();
    if (settings) appendAgcDiag(settings);
  });
}
if (micSens) {
  micSens.addEventListener("input", (e) => {
    if (activeMic) activeMic.setSens(+e.target.value);
  });
}

const GAMES = [
  { key: "duckcover", title: "DUCK & COVER", sub: "Rubber-duck debugging climber", ready: true },
  { key: "quacklift", title: "QUACK LIFT", sub: "Wasserstand-Climber", ready: false },
  { key: "quackoustic", title: "QUACKOUSTIC", sub: "Squeeze-to-tune", ready: false },
];

function goHub() {
  if (activeMic) activeMic.disable(); // belt-and-suspenders; exit() also stops it
  engine.setScene(hubScene);
}

function launch(key) {
  if (key === "duckcover") engine.setScene(duckCover(engine, goHub, micUi));
  // quacklift / quackoustic land in later phases
}

const hubScene = {
  t: 0,
  cards: [],
  flyers: createFlyers({ variants: FLYER_VARIANTS, faceLeft: FLYER_FACE_LEFT }),
  enter() {
    this.t = 0;
  },
  update(e, dt) {
    this.t += dt;
    if (e.width >= 720) this.flyers.update(dt, e.width, e.height, 9); // desktop ambient
  },
  layout(e) {
    const W = e.width;
    const H = e.height;
    const cw = Math.min(W * 0.86, 460);
    const ch = Math.min(H * 0.12, 92);
    const gap = ch * 0.28;
    const startY = H * 0.36; // top-anchored below the title (no overlap)
    this.cards = GAMES.map((g, i) => ({
      g,
      x: (W - cw) / 2,
      y: startY + i * (ch + gap),
      w: cw,
      h: ch,
    }));
  },
  render(e, ctx) {
    const W = e.width;
    const H = e.height;
    const t = this.t;

    // --- CRT arcade background: deep space + magenta vignette ---
    ctx.fillStyle = "#06070f";
    ctx.fillRect(0, 0, W, H);
    const vg = ctx.createRadialGradient(W / 2, H * 0.42, H * 0.04, W / 2, H * 0.5, H * 0.82);
    vg.addColorStop(0, "rgba(46,22,78,0.55)");
    vg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    // synthwave floor lines receding to the bottom
    ctx.strokeStyle = "rgba(54,230,255,0.10)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 7; i++) {
      const y = H * 0.64 + i * i * 4;
      if (y > H) break;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
    }

    // --- ambient flyers drifting across (desktop), behind title + cards ---
    if (W >= 720) this.flyers.render(ctx);

    // --- hero duck on a neon halo ---
    const bob = Math.sin(t * 2) * 6;
    // ping-pong so no two adjacent poses are static: ...surprised -> sleep ->
    // surprised (a little wake-up beat) instead of looping sleep -> default
    const POSES = ["default", "wave", "surprised", "sleep", "surprised", "wave"];
    const pose = POSES[Math.floor(t / 2.6) % POSES.length];
    const hx = W * 0.5,
      hy = H * 0.15 + bob,
      hs = Math.min(W * 0.13, 78);
    const halo = ctx.createRadialGradient(hx, hy, 4, hx, hy, hs * 2.3);
    halo.addColorStop(0, "rgba(255,79,163,0.32)");
    halo.addColorStop(1, "rgba(255,79,163,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(hx - hs * 2.3, hy - hs * 2.3, hs * 4.6, hs * 4.6);
    drawDuck(ctx, hx, hy, hs, { squash: 1 + Math.sin(t * 2) * 0.05, pose });

    // --- neon marquee + tagline ---
    const flick = 0.8 + 0.2 * Math.abs(Math.sin(t * 31) * Math.sin(t * 6.3)); // CRT flicker
    neonText(ctx, "QUACK ARCADE", W / 2, H * 0.3, Math.min(W * 0.1, 56),
      "#fff3c4", "#ff4fa3", 26 * flick);
    ctx.globalAlpha = 0.85;
    neonText(ctx, "3 GAMES · 1 RUBBER DUCK", W / 2, H * 0.3 + Math.min(W * 0.052, 32),
      Math.min(W * 0.034, 14), "#9fe9ff", "#36e6ff", 8);
    ctx.globalAlpha = 1;

    // --- game cabinets ---
    this.layout(e);
    for (const c of this.cards) {
      const ready = c.g.ready;
      const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3));
      ctx.fillStyle = ready ? "rgba(54,230,255,0.07)" : "rgba(255,255,255,0.025)";
      roundRect(ctx, c.x, c.y, c.w, c.h, 12);
      ctx.fill();
      ctx.save();
      if (ready) {
        ctx.shadowColor = "#36e6ff";
        ctx.shadowBlur = 16 * pulse;
      }
      ctx.strokeStyle = ready ? "#36e6ff" : "rgba(150,160,190,0.35)";
      ctx.lineWidth = ready ? 2 : 1.2;
      roundRect(ctx, c.x, c.y, c.w, c.h, 12);
      ctx.stroke();
      ctx.restore();

      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.save();
      if (ready) {
        ctx.shadowColor = "#36e6ff";
        ctx.shadowBlur = 8;
      }
      ctx.fillStyle = ready ? "#dafbff" : "rgba(200,205,225,0.4)";
      ctx.font = `bold ${Math.min(c.w * 0.07, 23)}px system-ui, sans-serif`;
      ctx.fillText((ready ? "▸ " : "") + c.g.title, c.x + 18, c.y + c.h * 0.45);
      ctx.restore();
      ctx.fillStyle = ready ? "rgba(159,233,255,0.7)" : "rgba(200,205,225,0.35)";
      ctx.font = `${Math.min(c.w * 0.045, 14)}px system-ui, sans-serif`;
      ctx.fillText(c.g.sub, c.x + 18, c.y + c.h * 0.73);

      ctx.textAlign = "right";
      if (ready) {
        const hi = engine.highscore(c.g.key + "-pts");
        ctx.fillStyle = "#ffd23f";
        ctx.font = `bold ${Math.min(c.w * 0.05, 14)}px ui-monospace, monospace`;
        ctx.fillText(hi > 0 ? "HI " + hi.toLocaleString() : "PLAY ▶", c.x + c.w - 16, c.y + c.h * 0.45);
      } else {
        ctx.fillStyle = "rgba(200,205,225,0.4)";
        ctx.font = `bold ${Math.min(c.w * 0.045, 13)}px ui-monospace, monospace`;
        ctx.fillText("🔒 SOON", c.x + c.w - 16, c.y + c.h * 0.55);
      }
    }

    // --- blinking INSERT COIN ---
    if (Math.sin(t * 4) > -0.35)
      neonText(ctx, "▶ TAP TO PLAY", W / 2, H * 0.9, Math.min(W * 0.045, 18),
        "#ffe27a", "#ffd23f", 12);

    // --- CRT scanlines over everything ---
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "#000";
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1.5);
    ctx.restore();
  },
  onPress(e) {
    const p = e.input.pointer;
    for (const c of this.cards) {
      if (
        c.g.ready &&
        p.x >= c.x &&
        p.x <= c.x + c.w &&
        p.y >= c.y &&
        p.y <= c.y + c.h
      ) {
        audio.unlock();
        audio.quack(360);
        launch(c.g.key);
        return;
      }
    }
  },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// centered glowing neon text: a colored shadow-blur halo behind a bright core,
// drawn twice for intensity. Self-contained save/restore (alpha-safe).
function neonText(ctx, txt, x, y, size, core, glow, blur) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.shadowColor = glow;
  ctx.fillStyle = core;
  ctx.shadowBlur = blur;
  ctx.fillText(txt, x, y);
  ctx.shadowBlur = blur * 0.5;
  ctx.fillText(txt, x, y);
  ctx.restore();
}

// iOS suspends the AudioContext in the background; resume on return (the first
// gesture afterwards also resumes — this just shortens the dead window).
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) audio.unlock();
});

engine.setScene(hubScene);
engine.start();
