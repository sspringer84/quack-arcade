// main.js — boots the engine, wires audio unlock + mute, and routes between the
// hub menu and the games.

import { Engine } from "./engine.js";
import { drawDuck } from "./duck.js";
import * as audio from "./audio.js";
import { duckCover } from "./games/duckcover.js";

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
  { key: "quacklift", title: "QUACK LIFT", sub: "Wasserstand-Climber · bald", ready: false },
  { key: "quackoustic", title: "QUACKOUSTIC", sub: "Squeeze-to-tune · bald", ready: false },
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
  enter() {
    this.t = 0;
  },
  update(_e, dt) {
    this.t += dt;
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
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1b2a4a");
    g.addColorStop(1, "#0f1830");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // title + bobbing duck
    const bob = Math.sin(this.t * 2) * 6;
    const POSES = ["default", "wave", "surprised", "sleep"];
    const pose = POSES[Math.floor(this.t / 2.6) % POSES.length];
    drawDuck(ctx, W * 0.5, H * 0.14 + bob, Math.min(W * 0.13, 76), {
      squash: 1 + Math.sin(this.t * 2) * 0.05,
      pose,
    });
    ctx.fillStyle = "#ffd23f";
    ctx.font = `bold ${Math.min(W * 0.085, 52)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("QUACK ARCADE", W / 2, H * 0.26);

    this.layout(e);
    for (const c of this.cards) {
      ctx.fillStyle = c.g.ready ? "rgba(255,210,63,0.14)" : "rgba(255,255,255,0.05)";
      roundRect(ctx, c.x, c.y, c.w, c.h, 14);
      ctx.fill();
      ctx.strokeStyle = c.g.ready ? "rgba(255,210,63,0.5)" : "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.textAlign = "left";
      ctx.fillStyle = c.g.ready ? "#ffd23f" : "rgba(255,255,255,0.4)";
      ctx.font = `bold ${Math.min(c.w * 0.07, 24)}px system-ui, sans-serif`;
      ctx.fillText(c.g.title, c.x + 20, c.y + c.h * 0.38);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = `${Math.min(c.w * 0.045, 15)}px system-ui, sans-serif`;
      ctx.fillText(c.g.sub, c.x + 20, c.y + c.h * 0.68);
    }
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

// iOS suspends the AudioContext in the background; resume on return (the first
// gesture afterwards also resumes — this just shortens the dead window).
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) audio.unlock();
});

engine.setScene(hubScene);
engine.start();
