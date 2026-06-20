// main.js — boots the engine, wires audio unlock + mute, and routes between the
// hub menu and the games.

import { Engine } from "./engine.js";
import { drawDuck } from "./duck.js";
import * as audio from "./audio.js";
import { duckCover } from "./games/duckcover.js";
import { quackLift } from "./games/quacklift.js";

const canvas = document.getElementById("game");
const engine = new Engine(canvas);

// faint neon-arcade veil behind the hub (cover-fit, low opacity = watermark)
const hubBg = typeof Image !== "undefined" ? new Image() : null;
let hubBgReady = false;
if (hubBg) {
  hubBg.onload = () => (hubBgReady = true);
  hubBg.src = "assets/hub-bg.jpg";
}

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
  { key: "quacklift", title: "QUACK LIFT", sub: "1-Knopf Tide-Climber", ready: true },
  { key: "quackoustic", title: "QUACKOUSTIC", sub: "Squeeze-to-tune", ready: false },
];

function goHub() {
  if (activeMic) activeMic.disable(); // belt-and-suspenders; exit() also stops it
  engine.setScene(hubScene);
}

function launch(key) {
  if (key === "duckcover") engine.setScene(duckCover(engine, goHub, micUi));
  else if (key === "quacklift") engine.setScene(quackLift(engine, goHub));
  // quackoustic lands in a later phase
}

const hubScene = {
  t: 0,
  cards: [],
  enter() {
    this.t = 0;
  },
  embers: null,
  update(e, dt) {
    this.t += dt;
    if (!this.embers) {
      // resolution-independent drifting neon dust (fractions of W/H)
      this.embers = [];
      for (let i = 0; i < 26; i++)
        this.embers.push({
          x: Math.random(),
          y: Math.random(),
          vy: 0.012 + Math.random() * 0.03,
          sway: Math.random() * Math.PI * 2,
          r: 1 + Math.random() * 2,
          c: EMBER_COLORS[i % EMBER_COLORS.length],
        });
    }
    for (const m of this.embers) {
      m.y -= m.vy * dt;
      if (m.y < -0.03) {
        m.y = 1.03;
        m.x = Math.random();
      }
    }
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

    // --- CRT arcade background: deep space + faint neon veil + magenta vignette ---
    ctx.fillStyle = "#06070f";
    ctx.fillRect(0, 0, W, H);
    if (hubBgReady) {
      const iw = hubBg.naturalWidth, ih = hubBg.naturalHeight;
      const s = Math.max(W / iw, H / ih); // cover-fit
      const dw = iw * s, dh = ih * s;
      ctx.drawImage(hubBg, (W - dw) / 2, (H - dh) / 2, dw, dh); // present background
      ctx.fillStyle = "rgba(6,7,15,0.34)"; // light scrim: keep neon + text readable
      ctx.fillRect(0, 0, W, H);
    }
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

    // --- drifting neon embers (atmosphere) ---
    if (this.embers) {
      ctx.save();
      for (const m of this.embers) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = m.c;
        ctx.shadowColor = m.c;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(m.x * W + Math.sin(t * 0.6 + m.sway) * 10, m.y * H, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // --- hero duck on a neon halo + Social-Club emblem ---
    const bob = Math.sin(t * 2) * 6;
    // ping-pong so no two adjacent poses are static: ...surprised -> sleep ->
    // surprised (a little wake-up beat) instead of looping sleep -> default
    const POSES = ["default", "hacker", "wave", "surprised", "sleep", "hacker", "wave"];
    const pose = POSES[Math.floor(t / 2.6) % POSES.length];
    const hx = W * 0.5,
      hy = H * 0.15 + bob,
      hs = Math.min(W * 0.13, 78);
    neonEmblem(ctx, hx, H * 0.15, hs * 1.55, t);
    const halo = ctx.createRadialGradient(hx, hy, 4, hx, hy, hs * 2.3);
    halo.addColorStop(0, "rgba(255,79,163,0.32)");
    halo.addColorStop(1, "rgba(255,79,163,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(hx - hs * 2.3, hy - hs * 2.3, hs * 4.6, hs * 4.6);
    drawDuck(ctx, hx, hy, hs, { squash: 1 + Math.sin(t * 2) * 0.05, pose });

    // --- neon marquee + tagline ---
    const flick = 0.8 + 0.2 * Math.abs(Math.sin(t * 31) * Math.sin(t * 6.3)); // CRT flicker
    neonTitle(ctx, "QUACK ARCADE", W / 2, H * 0.3, Math.min(W * 0.1, 56), 30 * flick);
    ctx.globalAlpha = 0.85;
    neonText(ctx, "3 GAMES · 1 RUBBER DUCK", W / 2, H * 0.3 + Math.min(W * 0.052, 32),
      Math.min(W * 0.034, 14), "#9fe9ff", "#36e6ff", 8);
    ctx.globalAlpha = 1;

    // --- game cabinets ---
    this.layout(e);
    for (const c of this.cards) {
      const ready = c.g.ready;
      const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3));
      // semi-solid dark panels so card text stays readable over the present bg
      ctx.fillStyle = ready ? "rgba(10,18,34,0.62)" : "rgba(8,10,18,0.55)";
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
        ctx.font = `bold ${Math.min(c.w * 0.05, 14)}px 'JetBrains Mono', ui-monospace, monospace`;
        ctx.fillText(hi > 0 ? "HI " + hi.toLocaleString() : "PLAY ▶", c.x + c.w - 16, c.y + c.h * 0.45);
      } else {
        ctx.fillStyle = "rgba(200,205,225,0.4)";
        ctx.font = `bold ${Math.min(c.w * 0.045, 13)}px 'JetBrains Mono', ui-monospace, monospace`;
        ctx.fillText("🔒 SOON", c.x + c.w - 16, c.y + c.h * 0.55);
      }
    }

    // --- blinking INSERT COIN ---
    if (Math.sin(t * 4) > -0.35)
      neonText(ctx, "▶ TAP TO PLAY", W / 2, H * 0.9, Math.min(W * 0.045, 18),
        "#ffe27a", "#ffd23f", 12);

    // --- neon marquee frame + corner brackets (cabinet edge) ---
    const pad = Math.max(8, Math.min(W, H) * 0.018);
    ctx.save();
    ctx.strokeStyle = "rgba(255,79,163,0.45)";
    ctx.shadowColor = "#ff4fa3";
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2;
    ctx.strokeRect(pad, pad, W - 2 * pad, H - 2 * pad);
    ctx.strokeStyle = "#36e6ff";
    ctx.shadowColor = "#36e6ff";
    ctx.lineWidth = 3;
    const cb = 24;
    for (const [cx, cy, sx, sy] of [
      [pad, pad, 1, 1],
      [W - pad, pad, -1, 1],
      [pad, H - pad, 1, -1],
      [W - pad, H - pad, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + sy * cb);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + sx * cb, cy);
      ctx.stroke();
    }
    // small neon status tag (top-left, clear of the mute button top-right)
    ctx.shadowBlur = 6;
    ctx.shadowColor = "#36e6ff";
    ctx.fillStyle = "#9fe9ff";
    ctx.font = "bold 11px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("■ ONLINE", pad + 16, pad + 16);
    ctx.restore();

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
  ctx.font = `700 ${size}px "Orbitron", system-ui, sans-serif`;
  ctx.shadowColor = glow;
  ctx.fillStyle = core;
  ctx.shadowBlur = blur;
  ctx.fillText(txt, x, y);
  ctx.shadowBlur = blur * 0.5;
  ctx.fillText(txt, x, y);
  ctx.restore();
}

const EMBER_COLORS = ["#ff4fa3", "#36e6ff", "#ffd23f"];

// the marquee title with a CRT chromatic (RGB-split) fringe + a magenta bloom.
function neonTitle(ctx, txt, x, y, size, blur) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${size}px "Orbitron", system-ui, sans-serif`;
  const sp = Math.max(2, size * 0.045); // chromatic offset scales with size
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#36e6ff";
  ctx.fillText(txt, x - sp, y);
  ctx.fillStyle = "#ff4fa3";
  ctx.fillText(txt, x + sp, y);
  ctx.globalAlpha = 1;
  ctx.shadowColor = "#ff4fa3";
  ctx.shadowBlur = blur;
  ctx.fillStyle = "#fff3c4";
  ctx.fillText(txt, x, y);
  ctx.shadowBlur = blur * 0.5;
  ctx.fillText(txt, x, y);
  ctx.restore();
}

// a glowing Social-Club-style emblem ring with slowly rotating tick marks.
function neonEmblem(ctx, x, y, r, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "#ffd23f";
  ctx.shadowColor = "#ffd23f";
  ctx.shadowBlur = 12;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.rotate(t * 0.25);
  ctx.fillStyle = "#36e6ff";
  ctx.shadowColor = "#36e6ff";
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    ctx.globalAlpha = 0.4;
    ctx.fillRect(r + 6, -1.5, 9, 3);
  }
  ctx.restore();
}

// iOS suspends the AudioContext in the background; resume on return (the first
// gesture afterwards also resumes — this just shortens the dead window).
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) audio.unlock();
});

engine.setScene(hubScene);
// canvas rasterizes text at fillText time and never reflows — first frame must
// already have the real families, else ledge widths measure the fallback. Gate
// the loop on the fonts (fallbacks in every ctx.font chain keep it playable).
(async () => {
  try {
    await Promise.all([
      document.fonts.load('700 22px "JetBrains Mono"'),
      document.fonts.load('400 13px "JetBrains Mono"'),
      document.fonts.load('800 40px "Orbitron"'),
      document.fonts.load('700 40px "Orbitron"'),
    ]);
    await document.fonts.ready;
  } catch (e) {
    /* ignore — fallback fonts keep the game playable */
  }
  engine.start();
})();
