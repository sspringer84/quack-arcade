// main.js — boots the engine, wires audio unlock + mute, and routes between the
// hub menu and the games.

import { Engine } from "./engine.js";
import { drawDuck } from "./duck.js";
import * as audio from "./audio.js";
import { duckCover } from "./games/duckcover.js";

const canvas = document.getElementById("game");
const engine = new Engine(canvas);

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

const GAMES = [
  { key: "duckcover", title: "DUCK & COVER", sub: "Rubber-duck debugging climber", ready: true },
  { key: "quacklift", title: "QUACK LIFT", sub: "Wasserstand-Climber · bald", ready: false },
  { key: "quackoustic", title: "QUACKOUSTIC", sub: "Squeeze-to-tune · bald", ready: false },
];

function goHub() {
  engine.setScene(hubScene);
}

function launch(key) {
  if (key === "duckcover") engine.setScene(duckCover(engine, goHub));
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

engine.setScene(hubScene);
engine.start();
