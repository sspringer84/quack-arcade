// duckcover.js — DUCK & COVER (Phase 1).
// A vertical climber wearing a rubber-duck-debugging skin. Climb a column of
// code-bug ledges; landing on one "fixes" the bug (+1). The view creeps upward
// on its own — fall off the bottom and the run ends with the classic line:
// "Have you tried explaining it to the duck?"
//
// Controls:
//   Desktop: ◀ ▶ / A D move · Space / W / ↑ / click = jump (single jump)
//   Touch:   floating joystick (bottom-right) steers L/R · tap elsewhere = jump
//            (a rubber-duck squeak into the mic also jumps — see mic.js)
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
  "it works on my machine",
  "NaN",
  "Cannot read 'x' of undefined",
  "Maximum call stack",
  "SyntaxError",
  "Permission denied",
  "deadlock",
  "heisenbug",
  "flaky test",
  "git push --force",
  "DROP TABLE students",
  "0.1 + 0.2 !== 0.3",
  "callback hell",
  "tech debt",
  "prod is down",
  "works in dev",
  "cache invalidation",
  "this is undefined",
  "detached HEAD",
  "dependency hell",
  "N+1 query",
  "integer overflow",
  "tabs vs spaces",
  "unexpected token",
  "module not found",
  "circular import",
  "// FIXME",
  "wrong branch",
  "500 Internal Error",
  "connection refused",
  "timeout",
  "rate limited",
  "use after free",
  "kernel panic",
  "premature optimization",
];

const GRAV = 2600;
const JUMP = 1040; // tap / keyboard jump velocity (unchanged default)
const JUMP_MIN = 720; // mic: softest squeak — still clears one ledge gap
const JUMP_MAX = 1180; // mic: hardest squeeze — can skip a ledge
const JUMP_BUFFER_MS = 140; // a jump input this long before landing still fires
const SHAKE_LOUD = 1.1; // mic loudness over a max-height squeak that starts shake
const SHAKE_MAX = 15; // shake cap (px)
const MAX_JUMPS = 1; // single jump (column normalization made double-jump too easy)
const MOVE = 340; // horizontal speed at full tilt (keyboard or joystick)
const JOY_R = 52; // virtual joystick: knob travel for a full -1..+1 axis
const SPACING = 130; // vertical gap between ledges
const DUCK_R = 24;
const COL_MAX = 460; // virtual play-column width
const LABEL_PAD = 9; // px of box padding on each side of a bug label
const MARGIN = 14;
const RIPPLE_LIFE = 0.5; // seconds a landing soundwave ring stays alive

const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function duckCover(engine, goHub, micUi) {
  const isTouch =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(pointer: coarse)").matches;

  // test-only telemetry sink (set by main.js when ?qa=1); inert otherwise
  const QA = typeof window !== "undefined" ? window.__QA__ : null;

  let state, duck, plats, cam, score, best, topY, autoScroll, facing;
  // floating virtual joystick (touch): grabbed in the bottom-left, steers L/R.
  // joyId = the pointer that owns it (null = released); joyAxis in -1..+1.
  let joyId = null,
    joyCx = 0,
    joyCy = 0,
    joyAxis = 0;
  // juice: landing soundwave rings + screen-shake on a loud squeak
  let ripples = [];
  let shake = 0;
  // jump buffer: an input fired while airborne, remembered for touchdown
  let jumpBuf = 0;
  let jumpBufStrength;
  let jumpBufLoud;

  // the rubber-duck-squeak controller: a squeak calls jump(strength).
  const mic = createMic({
    onJump: (s, loud) => jump(s, loud),
    onMeter: (m) => micUi && micUi.meter(m),
    onState: (st) => micUi && micUi.state(st),
  });

  function col(W) {
    const cw = Math.min(W, COL_MAX);
    return { cw, ox: (W - cw) / 2 };
  }

  // ledge box sized to its bug label so the duck lands on exactly what it reads
  function ledgeWidth(bug) {
    const ctx = engine.ctx;
    ctx.font = "13px ui-monospace, Menlo, Consolas, monospace";
    return Math.ceil(ctx.measureText(bug || "main()").width) + 2 * LABEL_PAD;
  }

  function reset() {
    const W = engine.width;
    const H = engine.height;
    const { cw, ox } = col(W);
    state = "ready";
    score = 0;
    best = engine.highscore("duckcover");
    cam = 0;
    autoScroll = 20;
    facing = 1;
    joyId = null;
    joyAxis = 0;
    ripples = [];
    shake = 0;
    jumpBuf = 0;
    const bw = ledgeWidth(null);
    plats = [
      { x: ox + cw / 2 - bw / 2, y: H - 120, w: bw, bug: null, fixed: true },
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
    const { cw, ox } = col(engine.width);
    topY -= SPACING;
    const bug = BUGS[(Math.random() * BUGS.length) | 0];
    const w = ledgeWidth(bug);
    const span = Math.max(0, cw - 2 * MARGIN - w);
    const prev = plats[plats.length - 1];
    const minOffset = span * 0.4; // force a lateral move between consecutive ledges
    let x = ox + MARGIN + Math.random() * span;
    for (let t = 0; t < 8 && prev && Math.abs(x - prev.x) < minOffset; t++) {
      x = ox + MARGIN + Math.random() * span;
    }
    plats.push({ x, y: topY, w, bug, fixed: false });
  }

  // strength undefined = tap/keyboard (byte-identical to the old fixed jump);
  // 0..1 = mic squeak, louder squeeze -> higher jump ("peak = height").
  function jump(strength, loud) {
    if (state === "over") {
      reset();
      return;
    }
    if (state === "ready") state = "play";
    if (duck.jumps > 0) {
      doJump(strength, loud);
    } else {
      // airborne: buffer it so an input just before landing still fires
      jumpBuf = JUMP_BUFFER_MS;
      jumpBufStrength = strength;
      jumpBufLoud = loud;
    }
  }

  function doJump(strength, loud) {
    const t = strength === undefined ? null : clampN(strength, 0, 1);
    const v = t === null ? JUMP : JUMP_MIN + (JUMP_MAX - JUMP_MIN) * t;
    duck.vy = -v;
    duck.jumps--;
    duck.grounded = false;
    duck.squash = t === null ? 1.35 : 1.2 + 0.25 * t;
    audio.quack(340 + (t === null ? 0.5 : t) * 180 + Math.random() * 40);
    // screen-shake only on a squeak clearly LOUDER than a max-height one
    // (loud is uncapped; tap/keyboard pass none, so they never shake)
    if (loud !== undefined && loud > SHAKE_LOUD)
      shake = Math.max(shake, Math.min(SHAKE_MAX, 5 + (loud - SHAKE_LOUD) * 16));
    if (QA) QA.jumps.push({ strength: t === null ? undefined : t, v, loud });
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

  function relY(e, ev) {
    const r = e.canvas.getBoundingClientRect();
    return ev.clientY - r.top;
  }

  function update(e, dt) {
    mic.tick(dt); // before the guard: a squeak can start / restart the run
    if (shake > 0) shake = Math.max(0, shake - dt * 38); // decay even on game-over
    if (state !== "play") return;
    const W = e.width;
    const H = e.height;
    const { cw, ox } = col(W);
    const left = ox + MARGIN + DUCK_R;
    const right = ox + cw - MARGIN - DUCK_R;
    if (jumpBuf > 0) jumpBuf = Math.max(0, jumpBuf - dt * 1000);

    // horizontal: keyboard direction, else the joystick axis (analog -1..+1).
    // velocity model = smooth accel toward the target speed + a short coast.
    const d = keyDir(e);
    const axis = d !== 0 ? d : joyId !== null ? joyAxis : 0;
    if (axis !== 0) facing = axis < 0 ? -1 : 1;
    duck.vx += (axis * MOVE - duck.vx) * Math.min(1, dt * 16);
    duck.x += duck.vx * dt;
    if (duck.x < left) {
      duck.x = left;
      duck.vx = 0;
    } else if (duck.x > right) {
      duck.x = right;
      duck.vx = 0;
    }
    if (QA)
      QA.duck = { x: duck.x, vx: duck.vx, vy: duck.vy, grounded: duck.grounded, buf: jumpBuf };

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
          // soundwave ring on a real landing (not the per-frame resting touch)
          if (duck.vy > 220)
            ripples.push({
              x: duck.x,
              y: p.y,
              t: 0,
              mag: clampN(duck.vy / 1100, 0.4, 1),
            });
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

    // a buffered jump (input arrived just before landing) fires on touchdown
    if (duck.grounded && jumpBuf > 0) {
      jumpBuf = 0;
      doJump(jumpBufStrength, jumpBufLoud);
    }

    duck.squash += (1 - duck.squash) * Math.min(1, dt * 12);

    for (const r of ripples) r.t += dt;
    ripples = ripples.filter((r) => r.t < RIPPLE_LIFE);
    if (QA) {
      QA.fx = QA.fx || { shakePeak: 0, ripplesSeen: 0 };
      if (shake > QA.fx.shakePeak) QA.fx.shakePeak = shake;
      if (ripples.length > QA.fx.ripplesSeen) QA.fx.ripplesSeen = ripples.length;
    }

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

    // screen-shake offset on a loud squeak. World + bg shake; HUD stays put.
    const sx = shake > 0.4 ? (Math.random() * 2 - 1) * shake : 0;
    const sy = shake > 0.4 ? (Math.random() * 2 - 1) * shake : 0;
    ctx.save();
    ctx.translate(sx, sy);

    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(-16, -16, W + 32, H + 32); // margin so shake doesn't bare an edge
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
      ctx.fillText(label, p.x + LABEL_PAD, p.y + 11);
      if (p.fixed && p.bug) {
        const tw = ctx.measureText(label).width;
        ctx.strokeStyle = "#3ad07a";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x + LABEL_PAD, p.y + 11);
        ctx.lineTo(p.x + LABEL_PAD + tw, p.y + 11);
        ctx.stroke();
      }
    }
    // soundwave rings from landings (world space, scroll with the ledges)
    for (const r of ripples) {
      const k = r.t / RIPPLE_LIFE;
      ctx.strokeStyle = "#9becff";
      for (let ring = 0; ring < 2; ring++) {
        const kk = k - ring * 0.16;
        if (kk < 0) continue;
        ctx.globalAlpha = (1 - kk) * 0.7 * r.mag;
        ctx.lineWidth = 2.5 - ring;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 5 + kk * (26 + r.mag * 22), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    drawDuck(ctx, duck.x, duck.y, DUCK_R * 1.5, {
      squash: duck.squash,
      flip: facing < 0,
      pose: duck.grounded ? "default" : "jump",
    });
    ctx.restore();
    ctx.restore(); // end screen-shake (HUD below stays steady)

    // clean top strip: fade out ledges scrolling past so they don't clash
    // with the score/best/hub HUD drawn on top of it.
    const tg = ctx.createLinearGradient(0, 0, 0, 78);
    tg.addColorStop(0, "rgba(11,13,18,0.95)");
    tg.addColorStop(0.7, "rgba(11,13,18,0.7)");
    tg.addColorStop(1, "rgba(11,13,18,0)");
    ctx.fillStyle = tg;
    ctx.fillRect(0, 0, W, 78);

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
        ? "Joystick unten rechts lenkt · Tippen = Sprung"
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

    if (isTouch && (state === "play" || state === "ready"))
      drawJoystick(ctx, W, H);
  }

  // floating thumb-stick, bottom-right. Faint at rest, brighter while grabbed.
  function drawJoystick(ctx, W, H) {
    const active = joyId !== null;
    const cx = active ? joyCx : W - 84;
    const cy = active ? joyCy : H - 96;
    ctx.save();
    ctx.globalAlpha = active ? 0.62 : 0.3;
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, JOY_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const kx = cx + (active ? joyAxis * JOY_R : 0);
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.arc(kx, cy, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = "15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("‹ ›", kx, cy);
    ctx.restore();
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
    // during play, a touch starting in the bottom-right grabs the floating
    // joystick (steers); every other touch — and any tap — is a jump.
    if (ev && ev.pointerType === "touch" && state === "play") {
      const rx = relX(e, ev);
      const ry = relY(e, ev);
      if (rx > e.width * 0.5 && ry > e.height * 0.45) {
        joyId = ev.pointerId;
        joyCx = rx;
        joyCy = ry;
        joyAxis = 0;
        return; // steering, not a jump
      }
    }
    jump(); // tap (or a mic squeak) = jump
  }

  function onMove(e, ev) {
    if (joyId === null || ev.pointerId !== joyId) return;
    joyAxis = clampN((relX(e, ev) - joyCx) / JOY_R, -1, 1);
  }

  function onRelease(e, ev) {
    if (joyId === null) return;
    // ignore a different finger lifting; release on our pointer or on cancel ({})
    if (ev && ev.pointerId !== undefined && ev.pointerId !== joyId) return;
    joyId = null;
    joyAxis = 0;
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
    onMove,
    onRelease,
  };
}
