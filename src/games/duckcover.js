// duckcover.js — DUCK & COVER (Phase 1).
// A vertical climber wearing a rubber-duck-debugging skin. Climb a column of
// code-bug ledges; landing on one "fixes" the bug (+1). The view creeps upward
// on its own — fall off the bottom and the run ends with the classic line:
// "Have you tried explaining it to the duck?"
//
// Controls:
//   Desktop: ◀ ▶ / A D move · Space / W / ↑ / click = jump (single jump)
//   Touch:   tap = jump and steer toward the tapped side of the screen
//
// Play happens inside a fixed-width virtual column (<= COL_MAX) centred on the
// canvas, so difficulty is identical on a phone and a wide desktop.

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

const GRAV = 2600;
const JUMP = 1040;
const MAX_JUMPS = 1; // single jump (column normalization made double-jump too easy)
const MOVE = 340;
const SPACING = 118; // vertical gap between ledges
const DUCK_R = 24;
const COL_MAX = 460; // virtual play-column width
const PLAT_FRAC = 0.28; // ledge width as fraction of the column
const MARGIN = 14;

const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function duckCover(engine, goHub) {
  const isTouch =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(pointer: coarse)").matches;

  let state, duck, plats, cam, score, best, topY, autoScroll, facing;
  // touch: last-tapped x the duck drifts toward (tap also jumps)
  let touchTargetX;

  function col(W) {
    const cw = Math.min(W, COL_MAX);
    return { cw, ox: (W - cw) / 2, pw: Math.round(cw * PLAT_FRAC) };
  }

  function reset() {
    const W = engine.width;
    const H = engine.height;
    const { cw, ox, pw } = col(W);
    state = "ready";
    score = 0;
    best = engine.highscore("duckcover");
    cam = 0;
    autoScroll = 20;
    facing = 1;
    touchTargetX = null;
    plats = [
      { x: ox + cw / 2 - pw / 2, y: H - 120, w: pw, bug: null, fixed: true },
    ];
    duck = {
      x: ox + cw / 2,
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
    const { cw, ox, pw } = col(engine.width);
    topY -= SPACING;
    const x = ox + MARGIN + Math.random() * (cw - 2 * MARGIN - pw);
    plats.push({
      x,
      y: topY,
      w: pw,
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

  function keyDir(e) {
    let d = 0;
    const k = e.input.keys;
    if (k.has("ArrowLeft") || k.has("KeyA")) d -= 1;
    if (k.has("ArrowRight") || k.has("KeyD")) d += 1;
    return d;
  }

  function relX(e, ev) {
    const r = e.canvas.getBoundingClientRect();
    return ev.clientX - r.left;
  }

  function update(e, dt) {
    if (state !== "play") return;
    const W = e.width;
    const H = e.height;
    const { cw, ox } = col(W);
    const left = ox + MARGIN + DUCK_R;
    const right = ox + cw - MARGIN - DUCK_R;

    if (touchTargetX !== null) {
      // touch: drift toward where you last tapped (the tap also jumped)
      const tx = clampN(touchTargetX, left, right);
      if (tx < duck.x - 1) facing = -1;
      else if (tx > duck.x + 1) facing = 1;
      duck.x += (tx - duck.x) * Math.min(1, dt * 12);
      duck.vx = 0;
    } else {
      // keyboard: velocity model with full air control
      const d = keyDir(e);
      if (d !== 0) facing = d;
      duck.vx += (d * MOVE - duck.vx) * Math.min(1, dt * 16);
      duck.x += duck.vx * dt;
    }
    if (duck.x < left) {
      duck.x = left;
      duck.vx = 0;
    } else if (duck.x > right) {
      duck.x = right;
      duck.vx = 0;
    }

    const prevFeet = duck.y + DUCK_R;
    duck.vy += GRAV * dt;
    duck.y += duck.vy * dt;
    const feet = duck.y + DUCK_R;

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

    cam = Math.min(cam, duck.y - H * 0.45);
    cam -= autoScroll * dt;
    autoScroll = 20 + score * 1.5;

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
    const { cw, ox } = col(W);

    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#11141c";
    ctx.fillRect(ox, 0, cw, H);
    ctx.strokeStyle = "rgba(120,140,180,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox + 0.5, 0);
    ctx.lineTo(ox + 0.5, H);
    ctx.moveTo(ox + cw - 0.5, 0);
    ctx.lineTo(ox + cw - 0.5, H);
    ctx.stroke();
    ctx.strokeStyle = "rgba(120,140,180,0.05)";
    for (let gx = ox + 40; gx < ox + cw; gx += 80) {
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

    ctx.fillStyle = "#dfe6f3";
    ctx.font = "bold 22px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("bugs fixed: " + score, ox + 14, 12);
    ctx.fillStyle = "rgba(223,230,243,0.5)";
    ctx.font = "13px ui-monospace, monospace";
    ctx.fillText("best: " + best, ox + 14, 40);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(223,230,243,0.55)";
    ctx.fillText("‹ hub", ox + cw - 14, 14);

    if (state === "ready") {
      const hint = isTouch
        ? "Tippen = Sprung + dorthin lenken"
        : "◀ ▶ / A D bewegen · Leertaste = Sprung";
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

  function onPress(e, ev) {
    const { cw, ox } = col(e.width);
    const p = e.input.pointer;
    // top-right "hub" tap returns to the menu
    if (ev && ev.clientX !== undefined && p.x > ox + cw - 70 && p.y < 40) {
      goHub();
      return;
    }
    if (ev && ev.pointerType === "touch") {
      // tap = jump + steer toward the tapped x
      touchTargetX = relX(e, ev);
      jump();
      return;
    }
    // mouse / pen / keyboard
    jump();
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
  };
}
