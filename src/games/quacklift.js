// quacklift.js — QUACK LIFT (Phase 2).
// A one-button tide-climber. You don't move the duck — you move the WATER:
//   HOLD (tap-and-hold / Space) raises the water, RELEASE lets it fall.
// A rubber duck rides the surface by buoyancy. Thread the staggered gaps in the
// neon walls scrolling in from the right; touching a wall ends the run.
//
// Controls: hold anywhere (touch) or hold Space — that's it.

import { drawDuck } from "../duck.js";
import * as audio from "../audio.js";
import { wrapText } from "../engine.js";

// rescued-duckling sprite (Flux Schnell, chroma-keyed); canvas primitive is the
// fallback until it loads. Sebastian's pick: the little sitting duckling.
const duckImg = typeof Image !== "undefined" ? new Image() : null;
let duckImgReady = false;
if (duckImg) {
  duckImg.onload = () => (duckImgReady = true);
  duckImg.src = "assets/duckling.png";
}

const DUCK_R = 22;
const DUCK_RIDE = 14; // how far above the surface the duck floats
const WATER_RISE = 360; // px/s the surface climbs while held
const WATER_FALL = 300; // px/s it recedes while released (a touch slower = buoyant)
const SPRING = 70; // buoyancy stiffness pulling the duck to the surface (tightened from 48)
const DAMP = 14; // buoyancy damping (nearer critical -> crisp dips, less overshoot)
const KR = 11; // duckling pickup radius
const K_PROB = 0.8; // chance a wall also spawns a duckling
const K_OFF_MILD = 0.12; // mild offset from gap centre (fraction of band) — in-gap, collectible
const K_OFF_RISK = 0.2; // danger offset (fraction of band) — off the safe line, recover-or-die
const MULT_MAX = 9;
const WALL_W = 58; // neon wall thickness
const SCROLL0 = 140; // initial scroll speed (px/s)
const SCROLL_RAMP = 4; // +px/s of scroll per wall cleared
const GAP0 = 0.34; // initial gap height (fraction of playable band)
const GAP_MIN = 0.22; // gap shrinks toward this with score
const SPAWN_GAP = 300; // horizontal spacing between walls (px)
const STEP = SPAWN_GAP + WALL_W; // constant horizontal beat between walls (duck = phantom wall 0)

const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function quackLift(engine, goHub) {
  const isTouch =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(pointer: coarse)").matches;

  const QA = typeof window !== "undefined" ? window.__QA__ : null;
  const BOT =
    !!QA &&
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).has("bot");

  let state, duck, water, walls, scroll, score, best, holding, t;
  // second axis: ducklings + greed combo (reset only on death)
  let kueken, mult, pts, collected, particles, popups, flash;

  // playable vertical band (water clamps here; gaps spawn within it)
  function band(H) {
    return { top: H * 0.12, bot: H * 0.9 };
  }

  function reset() {
    const H = engine.height;
    const { top, bot } = band(H);
    state = "ready";
    score = 0;
    best = engine.highscore("quacklift-pts");
    water = (top + bot) / 2;
    duck = { y: water - DUCK_RIDE, vy: 0 };
    walls = [];
    scroll = SCROLL0;
    holding = false;
    t = 0;
    kueken = [];
    mult = 1;
    pts = 0;
    collected = 0;
    particles = [];
    popups = [];
    flash = 0;
  }

  function gapH(H) {
    const { top, bot } = band(H);
    const frac = Math.max(GAP_MIN, GAP0 - score * 0.004);
    return (bot - top) * frac;
  }

  function spawnWall(W, H) {
    const { top, bot } = band(H);
    const gh = gapH(H);
    const prev = walls.length ? walls[walls.length - 1] : null;
    let gapY;
    if (prev) {
      gapY = top + gh / 2 + Math.random() * (bot - top - gh);
      // keep consecutive gaps reachable: limit vertical jump between walls
      const maxStep = (bot - top) * 0.26;
      gapY = clampN(gapY, prev.gapY - maxStep, prev.gapY + maxStep);
    } else {
      gapY = (top + bot) / 2; // gentle opener: first gap centred where the duck rests
    }
    // The first wall sits one beat ahead of the DUCK (not at the right screen edge),
    // so the run-up is the same ~2.5s on phone and desktop instead of ~8s on a wide
    // screen. Treats the duck as a phantom wall zero; later walls keep the same beat.
    const x = (prev ? prev.x : duckX(W)) + STEP;
    const wall = { x, gapY, gh, passed: false };
    walls.push(wall);
    if (QA && prev === null) QA.lead = x - duckX(W);
    if (Math.random() < K_PROB) spawnDuckling(W, H, wall);
  }

  // A duckling rides in the open lane *before* its wall (never walled-in), offset
  // from the gap centre. Mild ones stay inside the gap (a small detour); danger
  // ones sit off the safe line — grab them and recover before the wall arrives.
  function spawnDuckling(W, H, wall) {
    const { top, bot } = band(H);
    const danger = Math.random() < 0.34;
    const mag = (danger ? K_OFF_RISK : K_OFF_MILD) * (bot - top);
    const sign = Math.random() < 0.5 ? -1 : 1;
    const ky = clampN(wall.gapY + sign * mag, top + KR, bot - KR);
    kueken.push({ x: wall.x - SPAWN_GAP * 0.33, y: ky, got: false, bob: Math.random() * 6.28 });
  }

  function spawnSparkle(x, y) {
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * 6.28;
      const sp = 40 + Math.random() * 90;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: 0.5 + Math.random() * 0.2 });
    }
  }

  function duckX(W) {
    return Math.min(W * 0.3, 170);
  }

  function update(e, dt) {
    const W = e.width;
    const H = e.height;
    const { top, bot } = band(H);
    t += dt;

    // bot: start/restart, then hold while the duck sits below the next gap
    // centre and release above it (deadzone to damp jitter)
    if (BOT && !window.__BOT_OFF__) {
      if (state === "ready") state = "play";
      else if (state === "over") reset();
      if (state === "play") {
        const dx = duckX(W);
        let next = null;
        for (const wl of walls)
          if (wl.x + WALL_W > dx - DUCK_R && (!next || wl.x < next.x)) next = wl;
        let target = next ? next.gapY : (top + bot) / 2;
        // detour for an uncollected duckling that's still inside the upcoming gap
        // (safe to grab while threading); skip the risky off-line ones
        if (next) {
          let kt = null;
          for (const k of kueken)
            if (!k.got && k.x + KR > dx - DUCK_R && k.x < next.x &&
                Math.abs(k.y - next.gapY) < next.gh / 2 - DUCK_R &&
                (!kt || k.x < kt.x)) kt = k;
          if (kt) target = kt.y;
        }
        if (duck.y > target + 5) holding = true;
        else if (duck.y < target - 5) holding = false;
      }
    }

    if (QA) QA.state = state; // every frame (incl. ready/over) for the headless test
    if (state !== "play") return;

    // water surface: rises while held, falls while released
    water += (holding ? -WATER_RISE : WATER_FALL) * dt;
    water = clampN(water, top, bot);

    // duck rides the surface by a damped buoyancy spring
    const targetY = water - DUCK_RIDE;
    duck.vy += (targetY - duck.y) * SPRING * dt;
    duck.vy -= duck.vy * Math.min(1, DAMP * dt);
    duck.y += duck.vy * dt;

    // walls scroll left; spawn a new one once the rightmost has moved far enough
    scroll = SCROLL0 + score * SCROLL_RAMP;
    for (const wl of walls) wl.x -= scroll * dt;
    const rightmost = walls.length ? Math.max(...walls.map((wl) => wl.x)) : -Infinity;
    if (walls.length === 0 || rightmost <= W - SPAWN_GAP) spawnWall(W, H);
    walls = walls.filter((wl) => wl.x > -WALL_W * 2);

    const dx = duckX(W);
    for (const wl of walls) {
      // horizontal overlap with the duck column
      if (wl.x < dx + DUCK_R && wl.x + WALL_W > dx - DUCK_R) {
        const gapTop = wl.gapY - wl.gh / 2;
        const gapBot = wl.gapY + wl.gh / 2;
        if (duck.y - DUCK_R < gapTop || duck.y + DUCK_R > gapBot) {
          state = "over";
          engine.highscore("quacklift", score); // legacy key (walls) untouched
          best = engine.highscore("quacklift-pts", pts);
          audio.sadQuack();
        }
      }
      if (!wl.passed && wl.x + WALL_W < dx - DUCK_R) {
        wl.passed = true;
        score++;
        pts += 100; // baseline wall bonus — keeps a duckling-free run identical to before
        audio.quack(420 + Math.random() * 80);
      }
    }

    // --- ducklings: scroll, collect (greed combo), cull ---
    for (const k of kueken) {
      k.x -= scroll * dt;
      if (!k.got && Math.abs(k.x - dx) < DUCK_R + KR && Math.abs(k.y - duck.y) < DUCK_R + KR) {
        k.got = true;
        collected++;
        const prevMult = mult;
        mult = clampN(1 + collected, 1, MULT_MAX);
        const gain = 50 * mult;
        pts += gain;
        if (mult > prevMult) flash = 0.28;
        popups.push({ x: dx + DUCK_R, y: duck.y, txt: "+" + gain, life: 0.8 });
        spawnSparkle(k.x, k.y);
        audio.quack(520 + mult * 45);
      }
    }
    kueken = kueken.filter((k) => k.x > -40 && !(k.got && k.x < dx));

    // --- transient fx ---
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const pp of popups) {
      pp.y -= 36 * dt;
      pp.life -= dt;
    }
    popups = popups.filter((pp) => pp.life > 0);
    if (flash > 0) flash = Math.max(0, flash - dt);

    if (QA) {
      QA.state = state;
      QA.water = water;
      QA.duck = { y: duck.y, vy: duck.vy };
      QA.score = score;
      QA.holding = holding;
      QA.maxScore = Math.max(QA.maxScore || 0, score);
      QA.mult = mult;
      QA.pts = pts;
      QA.collected = collected;
      QA.kueken = kueken.length;
      let next = null;
      for (const wl of walls)
        if (wl.x + WALL_W > dx - DUCK_R && (!next || wl.x < next.x)) next = wl;
      QA.nextGapY = next ? next.gapY : null;
    }
  }

  function render(e, ctx) {
    const W = e.width;
    const H = e.height;
    const { top, bot } = band(H);
    const dx = duckX(W);

    // --- neon dusk background + faint grid ---
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a1224");
    bg.addColorStop(1, "#06070f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(54,230,255,0.06)";
    ctx.lineWidth = 1;
    for (let gx = (t * 18) % 64; gx < W; gx += 64) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, H);
      ctx.stroke();
    }
    for (let gy = (t * 9) % 64; gy < H; gy += 64) {
      ctx.beginPath();
      ctx.moveTo(0, gy + 0.5);
      ctx.lineTo(W, gy + 0.5);
      ctx.stroke();
    }

    // --- neon walls (top + bottom of each gap) ---
    for (const wl of walls) {
      const gapTop = wl.gapY - wl.gh / 2;
      const gapBot = wl.gapY + wl.gh / 2;
      ctx.save();
      ctx.shadowColor = "#ff4fa3";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "rgba(255,79,163,0.16)";
      ctx.strokeStyle = "#ff4fa3";
      ctx.lineWidth = 2;
      ctx.fillRect(wl.x, -4, WALL_W, gapTop + 4);
      ctx.strokeRect(wl.x + 0.5, -4, WALL_W - 1, gapTop + 4);
      ctx.fillRect(wl.x, gapBot, WALL_W, H - gapBot + 4);
      ctx.strokeRect(wl.x + 0.5, gapBot, WALL_W - 1, H - gapBot + 4);
      ctx.restore();
      // glowing gap edges (the "safe" lane)
      ctx.strokeStyle = "rgba(54,230,255,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wl.x, gapTop);
      ctx.lineTo(wl.x + WALL_W, gapTop);
      ctx.moveTo(wl.x, gapBot);
      ctx.lineTo(wl.x + WALL_W, gapBot);
      ctx.stroke();
    }

    // --- water body with an animated wavy surface + glowing surface line ---
    const surf = water;
    ctx.beginPath();
    ctx.moveTo(0, surf);
    for (let x = 0; x <= W; x += 16) {
      ctx.lineTo(x, surf + Math.sin(x * 0.03 + t * 3) * 4 + Math.sin(x * 0.07 - t * 2) * 2);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    const wg = ctx.createLinearGradient(0, surf, 0, H);
    wg.addColorStop(0, "rgba(54,230,255,0.34)");
    wg.addColorStop(1, "rgba(10,40,120,0.30)"); // deeper bottom so caustics read
    ctx.fillStyle = wg;
    ctx.fill();
    // caustic shimmer under the surface (cheap polylines, no shadow)
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = "#9becff";
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const cy = surf + 30 + i * 46 + Math.sin(t * 1.3 + i) * 8;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 24)
        ctx.lineTo(x, cy + Math.sin(x * 0.02 + t * 2 + i) * 6);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.shadowColor = "#36e6ff";
    ctx.shadowBlur = 14;
    ctx.strokeStyle = "rgba(160,240,255,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, surf);
    for (let x = 0; x <= W; x += 16)
      ctx.lineTo(x, surf + Math.sin(x * 0.03 + t * 3) * 4 + Math.sin(x * 0.07 - t * 2) * 2);
    ctx.stroke();
    ctx.restore();

    // --- ducklings (drawn behind the duck): generated sprite, primitive fallback ---
    for (const k of kueken) {
      if (k.got) continue;
      const by = k.y + Math.sin(t * 3 + k.bob) * 3;
      if (duckImgReady) {
        const h = KR * 2.8; // render height (px) — body roughly fills the pickup radius
        const w = h * (duckImg.naturalWidth / duckImg.naturalHeight);
        ctx.save();
        ctx.shadowColor = "#ffe66b";
        ctx.shadowBlur = 10;
        ctx.drawImage(duckImg, k.x - w / 2, by - h / 2, w, h);
        ctx.restore();
        continue;
      }
      ctx.save();
      ctx.shadowColor = "#ffe66b";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath();
      ctx.arc(k.x, by, KR, 0, Math.PI * 2); // body
      ctx.fill();
      ctx.beginPath();
      ctx.arc(k.x + KR * 0.5, by - KR * 0.7, KR * 0.62, 0, Math.PI * 2); // head
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#ff9505";
      ctx.beginPath(); // beak
      ctx.moveTo(k.x + KR * 0.95, by - KR * 0.8);
      ctx.lineTo(k.x + KR * 1.5, by - KR * 0.6);
      ctx.lineTo(k.x + KR * 0.95, by - KR * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath(); // eye
      ctx.arc(k.x + KR * 0.65, by - KR * 0.8, KR * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- the duck riding the surface ---
    const squash = clampN(1 + duck.vy * 0.0008, 0.82, 1.2);
    drawDuck(ctx, dx, duck.y, DUCK_R * 1.5, { squash, pose: "default" });

    // --- sparkle particles + score popups (in front of the duck) ---
    for (const p of particles) {
      ctx.globalAlpha = clampN(p.life * 2, 0, 1);
      ctx.fillStyle = "#9becff";
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    ctx.font = "bold 16px 'JetBrains Mono', ui-monospace, monospace";
    for (const pp of popups) {
      ctx.globalAlpha = clampN(pp.life * 1.4, 0, 1);
      ctx.fillStyle = "#ffd23f";
      ctx.fillText(pp.txt, pp.x, pp.y);
    }
    ctx.globalAlpha = 1;

    // --- HUD ---
    ctx.fillStyle = "#dfe6f3";
    ctx.font = "bold 22px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("lift: " + score, 16, 12);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffd23f";
    ctx.font = "bold 15px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillText("score " + pts.toLocaleString(), W - 14, 14);
    ctx.fillStyle = "rgba(223,230,243,0.5)";
    ctx.font = "13px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillText("best " + best.toLocaleString(), W - 14, 36);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(223,230,243,0.55)";
    ctx.fillText("‹ hub", 16, 44);

    // combo multiplier chip (centre top) — flares on tier-up
    if (mult > 1) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const sc = 1 + flash * 0.3; // gentle tier-up pop (toned down — was too much)
      ctx.shadowColor = "#36e6ff";
      ctx.shadowBlur = 9 + flash * 12;
      ctx.fillStyle = flash > 0 ? "#9fe9ff" : "#36e6ff"; // soft tint, not a white blast
      ctx.font = `400 ${Math.round(24 * sc)}px "Audiowide", system-ui, sans-serif`;
      ctx.fillText("x" + mult, W / 2, 26);
      ctx.restore();
    }

    if (state === "ready")
      banner(ctx, W, H, "QUACK LIFT", isTouch ? "Halten = hoch · loslassen = runter · 🐤 = Combo" : "Leertaste halten = hoch · loslassen = runter · 🐤 = Combo", "#36e6ff");
    else if (state === "over") {
      banner(ctx, W, H, pts.toLocaleString() + " Punkte", collected > 0 ? collected + " Küken gerettet · Glub glub." : "Glub glub. Die Ente ist abgesoffen.", "#ff7b9c", "Tippen für nochmal");
    }
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

  function press() {
    if (state === "over") {
      reset();
      return;
    }
    if (state === "ready") state = "play";
    holding = true;
  }
  function release() {
    holding = false;
  }

  function onPress(e, ev) {
    // top-left hub tap returns to the menu
    const p = e.input.pointer;
    if (ev && ev.clientX !== undefined && p.x < 70 && p.y < 60) {
      goHub();
      return;
    }
    press();
  }

  return {
    enter() {
      reset();
      audio.startMusic(); // arcade bed (idempotent; needs an unlocked context)
    },
    exit() {},
    onResize() {
      if (state === "ready") reset();
    },
    update,
    render,
    onPress,
    onRelease: release,
  };
}
