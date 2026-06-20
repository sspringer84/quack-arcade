// duckcover.js — DUCK & COVER (Phase 1).
// A vertical climber wearing a rubber-duck-debugging skin. You steer the duck
// left/right and jump (with a mid-air double jump) up a column of code-bug
// ledges; landing on one "fixes" the bug (+1). The view creeps upward on its
// own — fall off the bottom and the run ends with the classic line:
// "Have you tried explaining it to the duck?"
// Controls: ◀ ▶ / A D move · Space / W / ↑ / tap = jump (×2). Touch: bottom
// corners move, tap elsewhere to jump.

import { drawDuck } from "../duck.js";
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

// physics (px / s). One jump clears a gap comfortably; the double jump is for
// recovery and reaching offset ledges.
const GRAV = 2600;
const JUMP = 1040;
const MAX_JUMPS = 2;
const MOVE = 340; // horizontal top speed
const SPACING = 120; // vertical gap between ledges
const PLAT_W = 150;
const DUCK_R = 26;

export function duckCover(engine, goHub) {
  const isTouch =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(pointer: coarse)").matches;

  let state, duck, plats, cam, score, best, topY, autoScroll, touchDir, facing;

  function reset() {
    const W = engine.width;
    const H = engine.height;
    state = "ready";
    score = 0;
    best = engine.highscore("duckcover");
    cam = 0;
    autoScroll = 18;
    touchDir = 0;
    facing = 1;
    plats = [
      { x: W / 2 - PLAT_W / 2, y: H - 120, w: PLAT_W, bug: null, fixed: true },
    ];
    duck = {
      x: W / 2,
      y: H - 120 - DUCK_R,
      vx: 0,
      vy: 0,
      grounded: true,
      jumps: MAX_JUMPS,
      squash: 1,
    };
    topY = plats[0].y;
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
    if (duck.jumps > 0) {
      duck.vy = -JUMP;
      duck.jumps--;
      duck.grounded = false;
      duck.squash = 1.35;
      audio.quack(340 + (MAX_JUMPS - duck.jumps) * 60 + Math.random() * 40);
    }
  }

  function moveInput(e) {
    let dir = 0;
    const k = e.input.keys;
    if (k.has("ArrowLeft") || k.has("KeyA")) dir -= 1;
    if (k.has("ArrowRight") || k.has("KeyD")) dir += 1;
    if (dir === 0) dir = touchDir;
    return dir;
  }

  function update(e, dt) {
    if (state !== "play") return;
    const W = e.width;
    const H = e.height;

    // horizontal: full air + ground control, smoothed
    const dir = moveInput(e);
    if (dir !== 0) facing = dir;
    const targetVx = dir * MOVE;
    duck.vx += (targetVx - duck.vx) * Math.min(1, dt * 16);
    duck.x += duck.vx * dt;
    if (duck.x < 16 + DUCK_R) {
      duck.x = 16 + DUCK_R;
      duck.vx = 0;
    } else if (duck.x > W - 16 - DUCK_R) {
      duck.x = W - 16 - DUCK_R;
      duck.vx = 0;
    }

    // gravity
    const prevFeet = duck.y + DUCK_R;
    duck.vy += GRAV * dt;
    duck.y += duck.vy * dt;
    const feet = duck.y + DUCK_R;

    // landing only while falling, feet crossing a ledge top within its x-span
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
          duck.jumps = MAX_JUMPS;
          duck.squash = 0.7;
          if (!p.fixed) {
            p.fixed = true;
            score++;
            audio.quack(440 + Math.random() * 80);
          }
          break;
        }
      }
    }

    duck.squash += (1 - duck.squash) * Math.min(1, dt * 12);

    // camera follows up + always creeps up; meaner with score
    cam = Math.min(cam, duck.y - H * 0.45);
    cam -= autoScroll * dt;
    autoScroll = 18 + score * 1.5;

    while (topY > cam - H * 0.3) addPlatformUp();
    plats = plats.filter((p) => p.y < cam + H + 80);

    if (duck.y - cam > H + DUCK_R) {
      state = "over";
      best = engine.highscore("duckcover", score);
      audio.sadQuack();
    }
  }

  function render(e, ctx) {
    const W = e.width;
    const H = e.height;

    ctx.fillStyle = "#11141c";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(120,140,180,0.06)";
    ctx.lineWidth = 1;
    for (let gx = 40; gx < W; gx += 80) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, H);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(0, -cam);

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
        const tw = ctx.measureText(label).width;
        ctx.strokeStyle = "#3ad07a";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x + 8, p.y + 11);
        ctx.lineTo(p.x + 8 + tw, p.y + 11);
        ctx.stroke();
      }
    }

    drawDuck(ctx, duck.x, duck.y, DUCK_R * 1.5, {
      squash: duck.squash,
      flip: facing < 0,
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
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(223,230,243,0.55)";
    ctx.fillText("‹ hub", W - 14, 14);

    if (isTouch && state === "play") drawTouchControls(ctx, W, H);

    if (state === "ready") {
      const hint = isTouch
        ? "Ecken unten = bewegen · tippen = Sprung (×2)"
        : "◀ ▶ / A D bewegen · Leertaste = Sprung (×2)";
      banner(ctx, W, H, "DUCK & COVER", hint, "#ffd23f");
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

  function drawTouchControls(ctx, W, H) {
    const r = 34;
    const y = H - 54;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(48, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(W - 48, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#dfe6f3";
    ctx.font = "26px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("◀", 48, y);
    ctx.fillText("▶", W - 48, y);
    ctx.globalAlpha = 1;
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
    ctx.font = `${Math.min(W * 0.038, 16)}px ui-monospace, monospace`;
    ctx.fillText(sub, W / 2, H * 0.52);
    if (foot) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(foot, W / 2, H * 0.59);
    }
  }

  function zoneAt(e, ev) {
    // returns 'left' | 'right' | null for touch move zones (bottom corners)
    if (!isTouch || state !== "play") return null;
    const p = e.input.pointer;
    const y = e.height - 54;
    if (p.y > y - 50) {
      if (p.x < e.width * 0.4) return "left";
      if (p.x > e.width * 0.6) return "right";
    }
    return null;
  }

  function onPress(e, ev) {
    // top-right "hub" tap returns to menu
    const p = e.input.pointer;
    if (ev && ev.clientX !== undefined && p.x > e.width - 70 && p.y < 40) {
      goHub();
      return;
    }
    const z = zoneAt(e, ev);
    if (z) {
      touchDir = z === "left" ? -1 : 1;
      return;
    }
    jump();
  }

  function onRelease() {
    touchDir = 0;
  }

  return {
    enter() {
      reset();
    },
    onResize() {
      if (state === "ready") reset();
    },
    update,
    render,
    onPress,
    onRelease,
  };
}
