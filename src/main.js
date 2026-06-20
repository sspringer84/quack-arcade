// main.js — boots the engine, wires audio unlock + mute, and shows the hub.
// Phase 0: the hub is a placeholder that renders the canvas-drawn duck and
// quacks on tap. Game cards get wired in as each game lands.

import { Engine } from "./engine.js";
import { drawDuck } from "./duck.js";
import * as audio from "./audio.js";

const canvas = document.getElementById("game");
const engine = new Engine(canvas);

// Unlock audio on the very first user gesture anywhere (autoplay policy).
const unlockOnce = () => {
  audio.unlock();
  window.removeEventListener("pointerdown", unlockOnce);
  window.removeEventListener("keydown", unlockOnce);
};
window.addEventListener("pointerdown", unlockOnce);
window.addEventListener("keydown", unlockOnce);

// Mute toggle.
const muteBtn = document.getElementById("mute");
muteBtn.addEventListener("click", () => {
  const m = audio.toggleMuted();
  muteBtn.textContent = m ? "🔇" : "🔊";
});

// Placeholder hub scene.
const hubScene = {
  t: 0,
  enter() {
    this.t = 0;
  },
  onPress() {
    audio.unlock();
    audio.quack(300 + Math.random() * 90);
  },
  update(_e, dt) {
    this.t += dt;
  },
  render(e, ctx) {
    const w = e.width;
    const h = e.height;

    // background
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#1b2a4a");
    g.addColorStop(1, "#0f1830");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // title
    ctx.fillStyle = "#ffd23f";
    ctx.font = `bold ${Math.min(w * 0.1, 64)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("QUACK ARCADE", w / 2, h * 0.27);

    // bobbing duck
    const bob = Math.sin(this.t * 2) * 8;
    const squash = 1 + Math.sin(this.t * 2) * 0.05;
    drawDuck(ctx, w / 2, h * 0.52 + bob, Math.min(w * 0.13, 96), { squash });

    // hint
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `${Math.min(w * 0.045, 22)}px system-ui, sans-serif`;
    ctx.fillText("Tippen zum Quaken · Spiele folgen", w / 2, h * 0.76);
  },
};

engine.setScene(hubScene);
engine.start();
