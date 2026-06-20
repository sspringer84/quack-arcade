// duckcover.js — DUCK & COVER (Phase 1 MVP).
// A vertical climber wearing a rubber-duck-debugging skin. The duck auto-drifts
// left/right and bounces off the walls; a single input (tap / Space / later: a
// real squeak into the mic) makes it jump. Land on a code-bug ledge to "fix"
// the bug (+1). The view creeps upward on its own — fall off the bottom and the
// run ends with the classic line: "Have you tried explaining it to the duck?"

import { drawDuck } from "../duck.js";
import { clamp } from "../engine.js";
import * as audio from "../audio.js";

const BUGS = [
  "// TODO: fix later",
  "NullPointerException",
  "off-by-one",
  "undefined is not a function",
  "race condition",
  "== vs ===",
  "memory leak",
  "infinite loop",
  "unhandled promise",
  "missing semicolon",
  "CORS error",
  "stack overflow",
  "404 not found",
  "segfault",
  "merge conflict",
];

// physics constants (px / s) — tuned so a jump comfortably clears one gap
const GRAV = 2600;
const JUMP = 1120;
const DRIFT = 170;
const SPACING = 132; // vertical gap between ledges
const PLAT_W = 150;
const DUCK_R = 26;

export function duckCover(engine, goHub) {
  let state, duck, plats, cam, score, best, topY, autoScroll, shake;

  function reset() {
    const W = engine.width;
    const H = engine.height;
    state = "ready"; // ready -> play -> over
    score = 0;
    best = engine.highscore("duckcover");
    cam = 0;
    autoScroll = 24;
    shake = 0;
    // base ledge under the duck
    plats = [{ x: W / 2 - PLAT_W / 2, y: H - 120, w: PLAT_W, bug: null, fixed: true }];
    duck = { x: W / 2, y: H - 120 - DUCK_R, vx: DRIFT, vy: 0, grounded: true, squash: 1 };
    topY = plats[0].y;
    // pre-fill the column upward
    while (topY > -H) addPlatformUp();
  }

  function addPlatformUp() {
    const W = engine.width;
    topY -= SPACING;
    const x = 16 + Math.random() * (W - 32 - PLAT_W);
    plats.push({
      x,
      y: topY,
      w: PLAT_W,
      bug: BUGS[(Math.random() * BUGS.length) | 0],
      fixed: false,
    });
  }

  function jump() {
    if (state === "over") {
      reset();
      return;
    }
    if (state === "ready") state = "play";
    if (duck.grounded) {
      duck.vy = -JUMP;
      duck.grounded = false;
      duck.squash = 1.35;
      audio.quack(340 + Math.random() * 60);
    }
  }

  function update(e, dt) {
    if (state !== "play") return;
    const W = e.width;
    const H = e.height;

    // horizontal auto-drift + wall bounce
    duck.x += duck.vx * dt;
    if (duck.x < 16 + DUCK_R) {
      duck.x = 16 + DUCK_R;
      duck.vx = Math.abs(duck.vx);
    } else if (duck.x > W - 16 - DUCK_R) {
      duck.x = W - 16 - DUCK_R;
      duck.vx = -Math.abs(duck.vx);
    }

    // gravity
    const prevFeet = duck.y + DUCK_R;
    duck.vy += GRAV * dt;
    duck.y += duck.vy * dt;
    const feet = duck.y + DUCK_R;

    // landing: only while falling, when feet cross a ledge top within its x-span
    duck.grounded = false;
    if (duck.vy > 0) {
      for (const p of plats) {
        if (
          prevFeet <= p.y + 6 &&
          feet >= p.y &&
          duck.x > p.x - 4 &&
          duck.x < p.x + p.w + 4
        ) {
          duck.y = p.y - DUCK_R;
          duck.vy = 0;
          duck.grounded = true;
          duck.squash = 0.7;
          if (!p.fixed) {
            p.fixed = true;
            score++;
            audio.quack(420 + Math.random() * 80);
          }
          break;
        }
      }
    }

    // squash easing back to 1
    duck.squash += (1 - duck.squash) * Math.min(1, dt * 12);

    // camera: follow the duck up, and always creep upward (smaller y = up)
    cam = Math.min(cam, duck.y - H * 0.45);
    cam -= autoScroll * dt;
    autoScroll = 24 + score * 1.6; // gets meaner as you climb

    // spawn above / cull below
    while (topY > cam - H * 0.3) addPlatformUp();
    plats = plats.filter((p) => p.y < cam + H + 80);

    if (shake > 0) shake = Math.max(0, shake - dt * 4);

    // fell off the bottom
    if (duck.y - cam > H + DUCK_R) {
      state = "over";
      best = engine.highscore("duckcover", score);
      audio.sadQuack();
    }
  }

  function render(e, ctx) {
    const W = e.width;
    const H = e.height;

    // IDE background
    ctx.fillStyle = "#11141c";
    ctx.fillRect(0, 0, W, H);
    // faint code gutter lines
    ctx.strokeStyle = "rgba(120,140,180,0.06)";
    ctx.lineWidth = 1;
    const gutter = 40;
    for (let gx = gutter; gx < W; gx += 80) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, H);
      ctx.stroke();
    }

    const sx = shake > 0 ? (Math.random() - 0.5) * 10 * shake : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * 10 * shake : 0;
    ctx.save();
    ctx.translate(sx, sy - cam); // world transform (cam in world space)

    // platforms = code-bug ledges
    ctx.font = "13px ui-monospace, Menlo, Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const p of plats) {
      ctx.fillStyle = p.fixed ? "#1b3a2a" : "#2a2030";
      ctx.fillRect(p.x, p.y, p.w, 22);
      ctx.fillStyle = p.fixed ? "#3ad07a" : "#ff7b9c";
      const label = p.bug || "main()";
      ctx.fillText(label, p.x + 8, p.y + 11);
      if (p.fixed && p.bug) {
        // strike-through a fixed bug
        const tw = ctx.measureText(label).width;
        ctx.strokeStyle = "#3ad07a";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x + 8, p.y + 11);
        ctx.lineTo(p.x + 8 + tw, p.y + 11);
        ctx.stroke();
      }
    }

    // duck
    drawDuck(ctx, duck.x, duck.y, DUCK_R * 1.5, {
      squash: duck.squash,
      flip: duck.vx < 0,
    });

    ctx.restore();

    // HUD
    ctx.fillStyle = "#dfe6f3";
    ctx.font = "bold 22px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("bugs fixed: " + score, 14, 12);
    ctx.fillStyle = "rgba(223,230,243,0.5)";
    ctx.font = "13px ui-monospace, monospace";
    ctx.fillText("best: " + best, 14, 40);

    // back to hub
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(223,230,243,0.55)";
    ctx.fillText("‹ hub", W - 14, 14);

    if (state === "ready") {
      banner(ctx, W, H, "DUCK & COVER", "Tippen / Leertaste = Sprung", "#ffd23f");
    } else if (state === "over") {
      banner(
        ctx,
        W,
        H,
        score + " bugs gefixt",
        "Have you tried explaining it to the duck?",
        "#ff7b9c",
        "Tippen für nochmal"
      );
    }
  }

  function banner(ctx, W, H, title, sub, color, foot) {
    ctx.fillStyle = "rgba(8,10,16,0.72)";
    ctx.fillRect(0, H * 0.32, W, H * 0.36);
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.min(W * 0.085, 40)}px ui-monospace, monospace`;
    ctx.textBaseline = "middle";
    ctx.fillText(title, W / 2, H * 0.43);
    ctx.fillStyle = "#cfd6e6";
    ctx.font = `${Math.min(W * 0.04, 17)}px ui-monospace, monospace`;
    ctx.fillText(sub, W / 2, H * 0.52);
    if (foot) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(foot, W / 2, H * 0.59);
    }
  }

  function onPress(e, ev) {
    // top-right "hub" tap returns to the menu
    const p = e.input.pointer;
    if (ev && ev.clientX !== undefined && p.x > e.width - 70 && p.y < 40) {
      goHub();
      return;
    }
    jump();
  }

  return {
    enter() {
      reset();
    },
    onResize() {
      // keep play sane on resize: only hard-reset before play starts
      if (state === "ready") reset();
    },
    update,
    render,
    onPress,
  };
}
