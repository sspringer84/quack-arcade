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
import { createMic } from "../mic.js";

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
const JUMP = 1040; // tap / keyboard jump velocity (unchanged default)
const JUMP_MIN = 720; // mic: softest squeak — still clears one ledge gap
const JUMP_MAX = 1180; // mic: hardest squeeze — can skip a ledge
const MAX_JUMPS = 1; // single jump (column normalization made double-jump too easy)
const MOVE = 340; // keyboard horizontal speed (held)
const TOUCH_SPEED = 380; // touch: per-tap horizontal flick velocity
const TOUCH_DEAD = 22; // touch: tap within this of the duck = straight jump
const TOUCH_COAST = 3.5; // touch: how fast a flick decays back to 0 (low = glides)
const SPACING = 130; // vertical gap between ledges
const DUCK_R = 24;
const COL_MAX = 460; // virtual play-column width
const PLAT_FRAC = 0.28; // ledge width as fraction of the column
const MARGIN = 14;

const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function duckCover(engine, goHub, micUi) {
  const isTouch =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(pointer: coarse)").matches;

  // test-only telemetry sink (set by main.js when ?qa=1); inert otherwise
  const QA = typeof window !== "undefined" ? window.__QA__ : null;

  let state, duck, plats, cam, score, best, topY, autoScroll, facing;
  // touch: a one-shot horizontal flick velocity set on tap, consumed next frame
  let touchKick = 0;

  // the rubber-duck-squeak controller: a squeak calls jump(strength).
  const mic = createMic({
    onJump: (s) => jump(s),
    onMeter: (m) => micUi && micUi.meter(m),
    onState: (st) => micUi && micUi.state(st),
  });

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
    touchKick = 0;
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
    const span = cw - 2 * MARGIN - pw;
    const prev = plats[plats.length - 1];
    const minOffset = span * 0.4; // force a lateral move between consecutive ledges
    let x = ox + MARGIN + Math.random() * span;
    for (let t = 0; t < 8 && prev && Math.abs(x - prev.x) < minOffset; t++) {
      x = ox + MARGIN + Math.random() * span;
    }
    plats.push({
      x,
      y: topY,
      w: pw,
      bug: BUGS[(Math.random() * BUGS.length) | 0],
      fixed: false,
    });
  }

  // strength undefined = tap/keyboard (byte-identical to the old fixed jump);
  // 0..1 = mic squeak, louder squeeze -> higher jump ("peak = height").
  function jump(strength) {
    if (state === "over") {
      reset();
      return;
    }
    if (state === "ready") state = "play";
    if (duck.jumps > 0) {
      const t = strength === undefined ? null : clampN(strength, 0, 1);
      const v = t === null ? JUMP : JUMP_MIN + (JUMP_MAX - JUMP_MIN) * t;
      duck.vy = -v;
      duck.jumps--;
      duck.grounded = false;
      duck.squash = t === null ? 1.35 : 1.2 + 0.25 * t;
      audio.quack(340 + (t === null ? 0.5 : t) * 180 + Math.random() * 40);
      if (QA) QA.jumps.push({ strength: t === null ? undefined : t, v });
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
    mic.tick(dt); // before the guard: a squeak can start / restart the run
    if (state !== "play") return;
    const W = e.width;
    const H = e.height;
    const { cw, ox } = col(W);
    const left = ox + MARGIN + DUCK_R;
    const right = ox + cw - MARGIN - DUCK_R;

    // horizontal: keyboard holds a direction; a touch tap injects a one-shot
    // flick velocity that then coasts. No homing-to-finger — that pulled the
    // duck onto the fingertip like a black hole and felt way too hard.
    const d = keyDir(e);
    if (touchKick !== 0) {
      duck.vx = touchKick;
      touchKick = 0;
    }
    if (d !== 0) {
      facing = d;
      duck.vx += (d * MOVE - duck.vx) * Math.min(1, dt * 16);
    } else {
      // no key held: coast and decay (carries the touch flick, eases keyboard)
      duck.vx += (0 - duck.vx) * Math.min(1, dt * TOUCH_COAST);
      if (Math.abs(duck.vx) > 5) facing = duck.vx < 0 ? -1 : 1;
    }
    duck.x += duck.vx * dt;
    if (duck.x < left) {
      duck.x = left;
      duck.vx = 0;
    } else if (duck.x > right) {
      duck.x = right;
      duck.vx = 0;
    }
    if (QA) QA.duck = { x: duck.x, vx: duck.vx };

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
      pose: duck.grounded ? "default" : "jump",
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
        ? "Tippen = Sprung · Seite antippen lenkt dorthin"
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
      drawDuck(ctx, W / 2, H * 0.375, Math.min(W * 0.1, 58), { pose: "sad" });
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
      // tap = jump + a flick toward the side of the duck you tapped (no homing)
      const dx = relX(e, ev) - duck.x;
      touchKick =
        Math.abs(dx) < TOUCH_DEAD ? 0 : (dx < 0 ? -1 : 1) * TOUCH_SPEED;
      jump();
      return;
    }
    // mouse / pen / keyboard
    jump();
  }

  return {
    enter() {
      reset();
      micUi && micUi.show(mic);
    },
    exit() {
      mic.disable(); // stop the mic track (OS indicator off) on leaving the game
      micUi && micUi.hide();
    },
    onResize() {
      if (state === "ready") reset();
    },
    update,
    render,
    onPress,
  };
}
