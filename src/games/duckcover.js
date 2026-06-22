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
import { wrapText } from "../engine.js";

// the neon-arcade art fills the desktop side-margins (cover-fit, occluded by the
// play column → only the margins show; absent on mobile where there is no margin)
const sideBg = typeof Image !== "undefined" ? new Image() : null;
let sideBgReady = false;
if (sideBg) {
  sideBg.onload = () => (sideBgReady = true);
  sideBg.src = "assets/hub-bg.jpg";
}

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

// faint dev-code snippets scrolling behind the play column (rubber-duck-debugging
// flavour). Short lines, indentation baked in (monospace). Includes the game-over
// gag and Sebastian's coffee snippet. Paint-only background — never gameplay.
const CODE_BG = [
  "if (!coffee.Empty) {",
  "    keepCoding();",
  "} else {",
  "    // break + coffee",
  "}",
  "",
  "function fixBug(bug) {",
  "    duck.explain(bug);",
  "    return bug.solved;",
  "}",
  "",
  "// have you tried",
  "// explaining it",
  "// to the duck?",
  "rubberDuck.listen();",
  "",
  "while (stuck) {",
  "    quack();",
  "    rethink();",
  "}",
  "",
  "try { ship(); }",
  "catch (e) {",
  "    blame(cache);",
  "}",
  "",
  "const bugs = scan();",
  "bugs.map(duck.fix);",
  "",
  "git commit -m 'fix'",
  "git push --force //🙈",
  "",
];

const GRAV = 2600;
const JUMP = 1040; // tap / keyboard jump velocity (unchanged default)
const JUMP_MIN = 720; // mic: softest squeak — still clears one ledge gap
const JUMP_MAX = 1180; // mic: hardest squeeze — can skip a ledge
const JUMP_BUFFER_MS = 140; // a jump input this long before landing still fires
const SHAKE_LOUD = 1.1; // mic loudness over a max-height squeak that starts shake
const SHAKE_MAX = 15; // shake cap (px)
const ONBOARD_DUR = 4500; // first-run onboarding hint duration (ms of play)
const MAX_JUMPS = 1; // single jump (column normalization made double-jump too easy)
const MOVE = 340; // horizontal speed at full tilt (keyboard or joystick)
const JOY_R = 52; // virtual joystick: knob travel for a full -1..+1 axis
const SPACING = 130; // vertical gap between ledges
const DUCK_R = 24;
const COL_MAX = 460; // virtual play-column width
const LABEL_PAD = 9; // px of box padding on each side of a bug label
const MARGIN = 14;
const RIPPLE_LIFE = 0.5; // seconds a landing soundwave ring stays alive
const COMBO_WINDOW = 2.6; // s without a new fix before the chain breaks
const POINTS_PER_FIX = 100; // base points per bug at x1 -> human-readable "+100" popups
const PART_GRAV = 900; // px/s^2 particle gravity, lighter than world GRAV so shards float
const PART_CAP = 90; // hard ceiling on live particles (mobile canvas-2D budget)
const PART_COLORS = ["#3ad07a", "#9becff", "#ffd23f"]; // fixed-green, ripple-cyan, gold
const PART_GLYPHS = ["✓", "{}", "+", ";"]; // "bug squashed into clean code" theme
const LOVE_CAMEO_DUR = 0.7; // s the heart-eyes duck cameo shows per combo

const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// combo chain length -> integer score multiplier. Pure, total over c>=0. Cap x5.
const comboMult = (c) => (c >= 16 ? 5 : c >= 8 ? 4 : c >= 4 ? 3 : c >= 2 ? 2 : 1);

export function duckCover(engine, goHub, micUi) {
  const isTouch =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(pointer: coarse)").matches;

  // test-only telemetry sink (set by main.js when ?qa=1); inert otherwise
  const QA = typeof window !== "undefined" ? window.__QA__ : null;
  if (QA) QA.comboMult = comboMult; // expose pure fn for the headless unit assert
  // test-only autopilot (?qa=1&bot=1): frame-accurate climb so the headless
  // combo test drives the real fix path deterministically. Pause via
  // window.__BOT_OFF__ to verify the chain-window expiry. Never on in prod.
  const BOT =
    !!QA &&
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).has("bot");
  let botAxis = 0;
  let botTarget = null;

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
  // juice-2: combo chain + multiplied points + fix particles / "+N" popups
  let combo = 0; // current chain length
  let comboTimer = 0; // s remaining in the current window
  let lastMult = 1; // last tier reached this chain (tier-up flash detection)
  let points = 0; // the chased score / highscore metric
  let maxMult = 1; // peak multiplier this run
  let parts = []; // particle shards (world-space)
  let pops = []; // floating "+N" popups + tier-up flash (world-space)
  let loveCameo = 0; // s remaining on the heart-eyes duck combo cameo (HUD-space)
  // jump buffer: an input fired while airborne, remembered for touchdown
  let jumpBuf = 0;
  let jumpBufStrength;
  let jumpBufLoud;
  // first-run onboarding hint (shown once, then persisted off)
  const ONBOARD_KEY = "quack:dc-seen";
  let onboard = 0;
  let onboardSeen = false;
  try {
    onboardSeen = !!localStorage.getItem(ONBOARD_KEY);
  } catch (e) {
    /* ignore */
  }

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
    ctx.font = "13px 'JetBrains Mono', ui-monospace, monospace";
    return Math.ceil(ctx.measureText(bug || "main()").width) + 2 * LABEL_PAD;
  }

  function reset() {
    const W = engine.width;
    const H = engine.height;
    const { cw, ox } = col(W);
    state = "ready";
    score = 0;
    best = engine.highscore("duckcover-pts");
    cam = 0;
    autoScroll = 20;
    facing = 1;
    joyId = null;
    joyAxis = 0;
    ripples = [];
    shake = 0;
    combo = 0;
    comboTimer = 0;
    lastMult = 1;
    points = 0;
    maxMult = 1;
    parts = [];
    pops = [];
    loveCameo = 0;
    jumpBuf = 0;
    onboard = onboardSeen ? 0 : ONBOARD_DUR;
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

  // bug-fix juice: a burst of code-shard particles + a floating "+N" popup.
  // World-space coords (stored at the ledge) so they scroll + shake with the world.
  function spawnFixFx(x, y, chain, mult, gained) {
    const n = 8 + Math.min(chain, 6) * 2; // 8 at chain 1 -> capped 20 at chain >=6
    if (parts.length + n > PART_CAP)
      parts.splice(0, parts.length + n - PART_CAP); // trim oldest
    const hot = mult >= 3;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1; // up cone
      const sp = 120 + Math.random() * 200; // 120-320 px/s
      const glyph = Math.random() < 0.45; // ~45% glyphs, ~55% cheap rects
      parts.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60, // extra upward kick
        t: 0,
        life: 0.45 + Math.random() * 0.25, // 0.45-0.70 s
        c: hot
          ? "#ffd23f"
          : PART_COLORS[(Math.random() * PART_COLORS.length) | 0],
        g: glyph ? PART_GLYPHS[(Math.random() * PART_GLYPHS.length) | 0] : null,
        sz: 9 + ((Math.random() * 5) | 0),
      });
    }
    if (pops.length > 10) pops.shift();
    pops.push({
      x,
      y: y - 8,
      t: 0,
      life: 0.85,
      txt: mult > 1 ? "+" + gained + " x" + mult : "+" + gained,
      c: mult > 1 ? "#ffd23f" : "#3ad07a",
      big: false,
    });
  }

  // strength undefined = tap/keyboard (byte-identical to the old fixed jump);
  // 0..1 = mic squeak, louder squeeze -> higher jump ("peak = height").
  function jump(strength, loud) {
    if (state === "over") {
      reset();
      return;
    }
    if (state === "ready") {
      state = "play";
      if (!onboardSeen) {
        onboardSeen = true;
        try {
          localStorage.setItem(ONBOARD_KEY, "1");
        } catch (e) {
          /* ignore */
        }
      }
    }
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
    if (QA) QA.state = state; // every frame (incl. ready/over) for the headless test
    // bot: kickstart / auto-restart from ready+over (unless paused for the idle test)
    if (BOT && !window.__BOT_OFF__ && state !== "play") jump();
    if (state !== "play") return;
    const W = e.width;
    const H = e.height;
    const { cw, ox } = col(W);
    const left = ox + MARGIN + DUCK_R;
    const right = ox + cw - MARGIN - DUCK_R;
    if (jumpBuf > 0) jumpBuf = Math.max(0, jumpBuf - dt * 1000);
    if (onboard > 0) onboard = Math.max(0, onboard - dt * 1000);
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) {
        combo = 0;
        lastMult = 1;
        if (QA) QA.comboResets = (QA.comboResets || 0) + 1;
      }
    }
    if (loveCameo > 0) loveCameo = Math.max(0, loveCameo - dt);

    // horizontal: keyboard direction, else the joystick axis (analog -1..+1).
    // velocity model = smooth accel toward the target speed + a short coast.
    if (BOT) {
      // active (not paused): latch the nearest unfixed ledge above as THIS jump's
      // target, then launch. Latching avoids retargeting to the next-but-one ledge
      // mid-flight (out of reach), which would steer the duck off the reachable one.
      if (duck.grounded && !window.__BOT_OFF__) {
        let nl = null;
        for (const p of plats)
          if (!p.fixed && p.y < duck.y - 1 && (!nl || p.y > nl.y)) nl = p;
        botTarget = nl;
        jump();
      }
      // steer toward the latched target whether active or paused, so a paused duck
      // lands and parks (grounded) instead of drifting off — lets the chain-window
      // expiry fire cleanly for the anti-camp test.
      const t = botTarget;
      const dxb = t ? t.x + t.w / 2 - duck.x : 0;
      botAxis = dxb < -6 ? -1 : dxb > 6 ? 1 : 0;
    }
    const d = keyDir(e);
    const axis = BOT ? botAxis : d !== 0 ? d : joyId !== null ? joyAxis : 0;
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
      QA.duck = { x: duck.x, vx: duck.vx, vy: duck.vy, grounded: duck.grounded, buf: jumpBuf, onboard };

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
            score++; // UNCHANGED: raw bug count -> difficulty ramp
            combo++;
            comboTimer = COMBO_WINDOW;
            const mult = comboMult(combo);
            if (mult > maxMult) maxMult = mult;
            const gained = mult * POINTS_PER_FIX;
            points += gained;
            spawnFixFx(duck.x, p.y, combo, mult, gained);
            if (mult >= 2) {
              loveCameo = LOVE_CAMEO_DUR; // heart-eyes duck pops in on every combo
              if (QA) QA.loveCameos = (QA.loveCameos || 0) + 1;
            }
            if (mult > lastMult) {
              if (pops.length > 10) pops.shift();
              pops.push({
                x: duck.x,
                y: p.y - 26,
                t: 0,
                life: 1.1,
                txt: "COMBO x" + mult + "!",
                c: "#ffd23f",
                big: true,
              });
            }
            lastMult = mult;
            audio.quack(440 + (mult - 1) * 40 + Math.random() * 80);
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
    for (const q of parts) {
      q.vy += PART_GRAV * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.t += dt;
    }
    parts = parts.filter((q) => q.t < q.life);
    for (const u of pops) {
      u.t += dt;
      u.y -= 34 * dt;
    }
    pops = pops.filter((u) => u.t < u.life);
    if (QA) {
      QA.fx = QA.fx || {
        shakePeak: 0,
        ripplesSeen: 0,
        particlesSeen: 0,
        popsSeen: 0,
      };
      if (shake > QA.fx.shakePeak) QA.fx.shakePeak = shake;
      if (ripples.length > QA.fx.ripplesSeen) QA.fx.ripplesSeen = ripples.length;
      if (parts.length > QA.fx.particlesSeen)
        QA.fx.particlesSeen = parts.length;
      if (pops.length > QA.fx.popsSeen) QA.fx.popsSeen = pops.length;
      QA.combo = combo;
      QA.maxCombo = Math.max(QA.maxCombo || 0, combo);
      QA.maxMult = Math.max(QA.maxMult || 1, maxMult); // persistent peak (survives reset)
      QA.points = points;
      QA.score = score;
      // nearest unfixed ledge above the duck — lets the headless test autopilot
      // steer toward a real chain instead of blind-sweeping. Test-only.
      let nl = null;
      for (const p of plats)
        if (!p.fixed && p.y < duck.y - 1 && (!nl || p.y > nl.y)) nl = p;
      QA.nextLedge = nl ? { x: nl.x + nl.w / 2, y: nl.y } : null;
    }

    cam = Math.min(cam, duck.y - H * 0.45);
    cam -= autoScroll * dt;
    autoScroll = 20 + score * 1.5;
    if (QA) QA.autoScroll = autoScroll;

    while (topY > cam - H * 0.3) addPlatformUp();
    plats = plats.filter((p) => p.y < cam + H + 80);

    if (duck.y - cam > H + DUCK_R) {
      state = "over";
      best = engine.highscore("duckcover-pts", points);
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
    // desktop: neon-arcade art fills the side-margins (the opaque column below
    // covers the centre, so it only shows left/right; on mobile there's no margin)
    if (W - cw > 140 && sideBgReady) {
      const iw = sideBg.naturalWidth, ih = sideBg.naturalHeight;
      const s = Math.max(W / iw, H / ih) * 1.04; // cover-fit + shake safety overflow
      const dw = iw * s, dh = ih * s;
      ctx.drawImage(sideBg, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.fillStyle = "rgba(8,10,16,0.3)"; // light scrim
      ctx.fillRect(-16, -16, W + 32, H + 32);
    }
    const colG = ctx.createLinearGradient(ox, 0, ox, H);
    colG.addColorStop(0, "#0d1322"); // top: faint cyan-black (matches QL dusk)
    colG.addColorStop(1, "#08090f"); // bottom: near-black
    ctx.fillStyle = colG;
    ctx.fillRect(ox, 0, cw, H);
    ctx.strokeStyle = "rgba(120,140,180,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox + 0.5, 0);
    ctx.lineTo(ox + 0.5, H);
    ctx.moveTo(ox + cw - 0.5, 0);
    ctx.lineTo(ox + cw - 0.5, H);
    ctx.stroke();
    // verticals (cyan, matches QL grid) + cam-scrolled, depth-faded horizontal rungs
    ctx.strokeStyle = "rgba(54,230,255,0.05)";
    for (let gx = ox + 40; gx < ox + cw; gx += 80) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, H);
      ctx.stroke();
    }
    const RUNG = 80;
    const roff = (((-cam) % RUNG) + RUNG) % RUNG; // seamless scroll from cam, no state
    for (let gy = -roff; gy < H; gy += RUNG) {
      ctx.strokeStyle = `rgba(54,230,255,${(0.015 + (gy / H) * 0.05).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(ox, gy + 0.5);
      ctx.lineTo(ox + cw, gy + 0.5);
      ctx.stroke();
    }
    // faint scrolling dev-code behind the column — fits the rubber-duck-debugging
    // theme. Paint-only, cam-parallax (slower than the world = depth), clipped to
    // the column so it never bleeds into the desktop side-art, very low alpha so it
    // never fights the ledge labels. Stays subtle on mobile (full-width column).
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, 0, cw, H);
    ctx.clip();
    ctx.font = "12px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const cbA = (typeof window !== "undefined" && window.__CODEBG_ALPHA__) || 0.2;
    ctx.fillStyle = "rgba(120,205,230," + cbA + ")";
    const CLH = 20; // code line height
    const CN = CODE_BG.length, cBlock = CN * CLH;
    const coff = ((((-cam) * 0.3) % cBlock) + cBlock) % cBlock; // slow parallax scroll
    let cli = Math.floor(coff / CLH);
    let cy = cli * CLH - coff;
    while (cy < H) {
      const ln = CODE_BG[((cli % CN) + CN) % CN];
      if (ln) ctx.fillText(ln, ox + 18, cy + CLH * 0.5);
      cy += CLH;
      cli++;
    }
    ctx.restore();
    if (QA) QA.codeBg = true;

    // ambient data-motes — 3 parallax layers, cam-driven, no per-mote state
    ctx.save();
    ctx.fillStyle = "#36e6ff";
    for (let i = 0; i < 14; i++) {
      const seedX = (i * 53.13) % 1;
      const speed = 0.25 + (i % 3) * 0.18;
      const mx = ox + 8 + seedX * (cw - 16);
      const my = (((-cam * speed + i * 90) % (H + 40)) + (H + 40)) % (H + 40) - 20;
      ctx.globalAlpha = 0.05 + (i % 3) * 0.03;
      ctx.fillRect(mx, my, 2, 2);
    }
    ctx.restore();

    ctx.save();
    ctx.translate(0, -cam);
    ctx.font = "13px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const p of plats) {
      ctx.fillStyle = p.fixed ? "#1b3a2a" : "#2a2030";
      ctx.fillRect(p.x, p.y, p.w, 22);
      // neon lit top edge (double-line fake-glow, no shadowBlur) — marks the landing lip
      const lit = p.fixed ? "#3ad07a" : "#ff7b9c";
      ctx.strokeStyle = lit;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + 0.5);
      ctx.lineTo(p.x + p.w, p.y + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + 0.5);
      ctx.lineTo(p.x + p.w, p.y + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
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

    // bug-fix shards (mixed glyphs + cheap rects), world-space
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const q of parts) {
      ctx.globalAlpha = clampN(1 - q.t / q.life, 0, 1);
      ctx.fillStyle = q.c;
      if (q.g) {
        ctx.font = q.sz + "px 'JetBrains Mono', ui-monospace, monospace";
        ctx.fillText(q.g, q.x, q.y);
      } else ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
    }
    // floating "+N" popups + COMBO tier-up flash
    for (const u of pops) {
      ctx.globalAlpha = clampN(1 - u.t / u.life, 0, 1);
      ctx.fillStyle = u.c;
      ctx.font = "bold " + (u.big ? 22 : 15) + "px 'JetBrains Mono', ui-monospace, monospace";
      ctx.fillText(u.txt, u.x, u.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle"; // restore for the ledge-label loop next frame

    drawDuck(ctx, duck.x, duck.y, DUCK_R * 1.5, {
      squash: duck.squash,
      flip: facing < 0,
      pose: duck.grounded ? "default" : "jump",
    });
    ctx.restore();
    ctx.restore(); // end screen-shake (HUD below stays steady)

    // desktop only: a glowing neon bezel framing the play column like a cabinet
    // screen (no-op on mobile, where the column fills the canvas).
    if (W - cw > 140) {
      ctx.save();
      ctx.shadowColor = "#36e6ff";
      ctx.shadowBlur = 16;
      ctx.strokeStyle = "rgba(54,230,255,0.5)";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox - 1, 1, cw + 2, H - 2);
      ctx.restore();
    }

    // clean top strip: fade out ledges scrolling past so they don't clash
    // with the score/best/hub HUD drawn on top of it.
    const tg = ctx.createLinearGradient(0, 0, 0, 78);
    tg.addColorStop(0, "rgba(11,13,18,0.95)");
    tg.addColorStop(0.7, "rgba(11,13,18,0.7)");
    tg.addColorStop(1, "rgba(11,13,18,0)");
    ctx.fillStyle = tg;
    ctx.fillRect(ox, 0, cw, 78);

    // safe-area aware; right column clamps left of the fixed mute button
    const st = e.safe.top, sl = e.safe.left;
    const hudR = Math.min(ox + cw - 14, W - 64 - e.safe.right);
    ctx.fillStyle = "#dfe6f3";
    ctx.font = "bold 22px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("bugs fixed: " + score, ox + 14 + sl, 12 + st);
    // hub link top-LEFT, below the counter — same corner as Quack Lift, and clear
    // of the fixed mute/music buttons in the top-right.
    ctx.fillStyle = "rgba(223,230,243,0.55)";
    ctx.font = "13px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillText("‹ hub", ox + 14 + sl, 44 + st);
    // right column: the points score + the points record ("best"). best pairs with
    // score (both points-scale) — never under the raw bug count.
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffd23f";
    ctx.font = "bold 15px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillText("score " + points.toLocaleString(), hudR, 14 + st);
    ctx.fillStyle = "rgba(223,230,243,0.5)";
    ctx.font = "13px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillText("best " + best.toLocaleString(), hudR, 36 + st);
    ctx.textAlign = "left";
    // combo chip + draining timer bar — only while a chain is live
    if (combo >= 2) {
      const m = comboMult(combo);
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#ffd23f";
      ctx.font = "bold 14px 'JetBrains Mono', ui-monospace, monospace";
      ctx.fillText("combo x" + m + "  (" + combo + ")", ox + 14, 64);
      const bw = 120;
      const frac = clampN(comboTimer / COMBO_WINDOW, 0, 1);
      ctx.fillStyle = "rgba(255,210,63,0.25)";
      ctx.fillRect(ox + 14, 70, bw, 3);
      ctx.fillStyle = "#ffd23f";
      ctx.fillRect(ox + 14, 70, bw * frac, 3);
      ctx.textBaseline = "top";
    }

    // heart-eyes duck cameo — pops in from the right edge on every combo fix
    if (loveCameo > 0 && state === "play") {
      const p = 1 - loveCameo / LOVE_CAMEO_DUR; // 0..1 over its life
      const grow = clampN(p / 0.22, 0, 1);
      const scale = Math.sin((grow * Math.PI) / 2); // easeOutSine 0->1 pop-in
      const alpha = clampN((1 - p) / 0.35, 0, 1); // fade out over the last 35%
      const sz = Math.min(W * 0.13, 80) * (0.6 + 0.4 * scale);
      // drawDuck height = sz*1.7 (square sprite -> half-width ~ sz*0.85); anchor so
      // it hugs the right edge fully on-screen and grows leftward as it pops in.
      ctx.save();
      ctx.globalAlpha = alpha;
      drawDuck(ctx, W - sz * 0.85 - 10, H * 0.5, sz, { pose: "love" });
      ctx.restore();
    }

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
        points.toLocaleString() + " Punkte",
        "Have you tried explaining it to the duck?",
        "#ff7b9c",
        score + " bugs · max x" + maxMult + " · Tippen für nochmal"
      );
      drawDuck(ctx, W / 2, H * 0.375, Math.min(W * 0.1, 58), { pose: "sad" });
    }

    if (onboard > 0 && state === "play") drawOnboard(ctx, W, H);

    if (isTouch && (state === "play" || state === "ready"))
      drawJoystick(ctx, W, H);
  }

  // first-run hint that teaches the squeak hook; fades out over its last 0.7s
  function drawOnboard(ctx, W, H) {
    const a = clampN(onboard / 700, 0, 1);
    const cy = H * 0.2;
    const pw = Math.min(W * 0.92, 400);
    const innerW = pw - 28;
    const tSize = Math.min(W * 0.05, 19);
    const sSize = Math.min(W * 0.034, 13);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // wrap both lines first so the panel can size to fit on a narrow phone
    ctx.font = `bold ${tSize}px system-ui, sans-serif`;
    const tLines = wrapText(ctx, "🦆 Echte Gummiente quietschen = Sprung", innerW);
    ctx.font = `${sSize}px system-ui, sans-serif`;
    const sLines = wrapText(
      ctx,
      isTouch
        ? "Mikro unten aktivieren · sonst tippen · Joystick lenkt"
        : "Mikro aktivieren · sonst Leertaste · ◀ ▶ lenken",
      innerW
    );
    const tlh = tSize * 1.3,
      slh = sSize * 1.4;
    const ph = 20 + tLines.length * tlh + sLines.length * slh;
    const top = cy - ph / 2;
    ctx.fillStyle = "rgba(8,10,16,0.82)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(W / 2 - pw / 2, top, pw, ph, 14);
    else ctx.rect(W / 2 - pw / 2, top, pw, ph);
    ctx.fill();
    let y = top + 12 + tlh / 2;
    ctx.fillStyle = "#ffd23f";
    ctx.font = `bold ${tSize}px system-ui, sans-serif`;
    tLines.forEach((ln) => {
      ctx.fillText(ln, W / 2, y);
      y += tlh;
    });
    ctx.fillStyle = "rgba(223,230,243,0.85)";
    ctx.font = `${sSize}px system-ui, sans-serif`;
    sLines.forEach((ln) => {
      ctx.fillText(ln, W / 2, y);
      y += slh;
    });
    ctx.restore();
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
    ctx.textBaseline = "middle";
    const maxW = W * 0.86;
    // title (wrapped, big)
    const tSize = Math.min(W * 0.085, 40);
    ctx.fillStyle = color;
    ctx.font = `400 ${tSize}px "Audiowide", system-ui, sans-serif`;
    const tLines = wrapText(ctx, title, maxW);
    tLines.forEach((ln, i) =>
      ctx.fillText(ln, W / 2, H * 0.43 + (i - (tLines.length - 1) / 2) * tSize * 1.15)
    );
    // sub (wrapped, smaller) — stacked below the title block
    const sSize = Math.min(W * 0.038, 16);
    ctx.fillStyle = "#cfd6e6";
    ctx.font = `${sSize}px 'JetBrains Mono', ui-monospace, monospace`;
    const sLines = wrapText(ctx, sub, maxW);
    const sy = H * 0.52;
    sLines.forEach((ln, i) => ctx.fillText(ln, W / 2, sy + i * sSize * 1.4));
    if (foot) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      let fy = sy + sLines.length * sSize * 1.4 + sSize * 0.4;
      wrapText(ctx, foot, maxW).forEach((ln, i) =>
        ctx.fillText(ln, W / 2, fy + i * sSize * 1.4)
      );
    }
  }

  function onPress(e, ev) {
    const { cw, ox } = col(e.width);
    const p = e.input.pointer;
    // top-LEFT "hub" tap returns to the menu — same corner + hitbox as Quack Lift,
    // clear of the top-right mute buttons. Generous box covers the "‹ hub" label + slop.
    if (ev && ev.clientX !== undefined && p.x < ox + 84 && p.y < 60) {
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
      audio.startMusic(); // DC has the bed too; it ducks automatically while the mic is live
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
