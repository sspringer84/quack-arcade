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

// Generated neon wall textures (Flux Schnell, chroma-keyed), tiled per segment.
// Each wall picks a THEME (colour + texture). Segment height becomes a TILE COUNT
// (mirror-flipped each row so vertical motifs self-tile without a visible seam),
// never a stretch, so a tall and a short segment share identical crisp pixels.
// The canvas fallback recolours the plain bar until/unless the PNG loads, so the
// geometry/collision never depend on an asset existing.
const TILE_H = 192; // on-screen height of one texture tile (asset shipped 58x192)
const THEME_DEFS = [
  { name: "magenta-conduit", color: "#ff4fa3", fill: "rgba(255,79,163,0.16)" },
  { name: "cyan-circuit", color: "#36e6ff", fill: "rgba(54,230,255,0.16)" },
  { name: "violet-laser", color: "#9b5cff", fill: "rgba(155,92,255,0.16)" },
  // gold-rail / emerald-reed generated + in the pool, held back (Sebastian's pick:
  // the three crispest beams). Re-add a {name,color,fill} line to bring one back.
];
const THEMES = THEME_DEFS.map((d) => {
  const th = { ...d, img: null, ready: false };
  if (typeof Image !== "undefined") {
    th.img = new Image();
    th.img.onload = () => (th.ready = true);
    th.img.src = "assets/walls/" + d.name + ".png";
  }
  return th;
});

const DUCK_R = 22;
const DUCK_RIDE = 14; // how far above the surface the duck floats
const WATER_RISE = 360; // px/s the surface climbs while held
const WATER_FALL = 300; // px/s it recedes while released (a touch slower = buoyant)
const SPRING = 70; // buoyancy stiffness pulling the duck to the surface (tightened from 48)
const DAMP = 14; // buoyancy damping (nearer critical -> crisp dips, less overshoot)
const KR = 11; // duckling pickup radius
const K_PROB = 0.8; // chance a wall also spawns a duckling
const K_OFF_MILD = 0.12; // mild offset from gap centre (fraction of band) — in-gap, collectible
const K_OFF_RISK = 0.17; // danger offset (fraction of band) — off the safe line, recover-or-die
const MULT_MAX = 9;
const WALL_W = 58; // neon wall thickness
const SCROLL0 = 140; // initial scroll speed (px/s)
const SCROLL_RAMP = 4; // +px/s of scroll per wall cleared
const GAP0 = 0.34; // initial gap height (fraction of playable band)
const GAP_MIN = 0.23; // gap shrinks toward this with score
const SPAWN_GAP = 300; // horizontal spacing between walls (px)
const STEP = SPAWN_GAP + WALL_W; // constant horizontal beat between walls (duck = phantom wall 0)

// --- polish tuning knobs ---
const LEAN_K = 0.0011, LEAN_MAX = 0.26; // duck tilt from vertical speed (feel)
const NEAR_MISS_PX = 16; // clearance to a gap edge that counts as a skillful near-miss
const TRAIL_MULT = 4; // combo at which the duck grows a cyan greed-trail
const DEATH_DUR = 0.55; // s of sink animation before the game-over banner
const DRIFT_SCORE = 8; // walls may start drifting their gap only after this many cleared
const DRIFT_SPD = 1.6; // rad/s of the gap-drift oscillation

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

  let state, duck, water, walls, scroll, score, best, holding, t, wallCount;
  // second axis: ducklings + greed combo (reset only on death)
  let kueken, mult, pts, collected, particles, popups, flash;
  // polish fx state
  let wakes, bubbles, rings, trail, deathT, deathFlash, deathRot, popT, wakeAcc, bubbleAcc;

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
    wallCount = 0;
    kueken = [];
    mult = 1;
    pts = 0;
    collected = 0;
    particles = [];
    popups = [];
    flash = 0;
    wakes = [];
    bubbles = [];
    rings = [];
    trail = [];
    deathT = 0;
    deathFlash = 0;
    deathRot = 0;
    popT = 0;
    wakeAcc = 0;
    bubbleAcc = 0;
  }

  function gapH(H) {
    const { top, bot } = band(H);
    const frac = Math.max(GAP_MIN, GAP0 - score * 0.004);
    return (bot - top) * frac;
  }

  // wall visual style — bars dominate early, stalactite/gate get likelier with
  // score. The opener (no prev) is always a plain bar so the first gate reads clean.
  function chooseStyle(prev) {
    if (!prev) return "bar";
    // __STYLE_FORCE__ is a headless-test hook (dead in prod) to exercise variety
    const force = typeof window !== "undefined" && window.__STYLE_FORCE__;
    const variety = force ? 0.9 : clampN(score * 0.02, 0, 0.55);
    const r = Math.random();
    if (r < variety * 0.5) return "stalactite";
    if (r < variety) return "gate";
    return "bar";
  }

  // wall SKIN (colour + texture) — orthogonal to style. Blooms EARLY (from wall 2)
  // so a run shows several neon colours fast, while SHAPE stays score-gated/calm.
  // Opener is theme 0 (its fallback is the original magenta bar). Never repeats the
  // previous theme, and the first few post-opener walls stay in the two calmest
  // colours before the full set opens up. __THEME_FORCE__/__THEME_ALL__ are
  // headless-test hooks (dead in prod).
  function chooseTheme(prev, count) {
    if (typeof window !== "undefined" && window.__THEME_FORCE__ != null)
      return window.__THEME_FORCE__;
    if (!prev) return 0;
    const n = THEMES.length;
    if (typeof window !== "undefined" && window.__THEME_ALL__) return count % n;
    const pool = count < 4 ? Math.min(2, n) : n; // calm colours first, full set by ~wall 5
    return (prev.theme + 1 + Math.floor(Math.random() * (pool - 1))) % pool;
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
    const wall = {
      x, gapY, gh, passed: false,
      style: chooseStyle(prev),
      theme: chooseTheme(prev, wallCount++),
      baseGapY: gapY, driftAmp: 0, driftPhase: 0,
      nearGlow: 0, minMargin: undefined,
    };
    // drifting gap: only past a score threshold, only when the gap is roomy.
    // __DRIFT_SCORE__/__DRIFT_FORCE__ are headless-test hooks (dead in prod).
    const driftScore =
      typeof window !== "undefined" && window.__DRIFT_SCORE__ != null
        ? window.__DRIFT_SCORE__ : DRIFT_SCORE;
    const driftForce = typeof window !== "undefined" && window.__DRIFT_FORCE__;
    if (score >= driftScore && (driftForce || Math.random() < 0.45)) {
      const room = (bot - top - gh) * 0.5;
      wall.driftAmp = Math.min(room * 0.5, (bot - top) * 0.08);
      wall.driftPhase = Math.random() * 6.28;
      if (QA) {
        QA.driftWalls = (QA.driftWalls || 0) + 1;
        if (QA.firstDriftScore === undefined) QA.firstDriftScore = score;
      }
    }
    walls.push(wall);
    if (QA) {
      QA.lead = prev === null ? x - duckX(W) : QA.lead;
      QA.wallStyles = QA.wallStyles || {};
      QA.wallStyles[wall.style] = true;
      QA.wallThemes = QA.wallThemes || {};
      QA.wallThemes[wall.theme] = true;
      if (QA.firstTheme === undefined) QA.firstTheme = wall.theme;
      QA.themeSeq = QA.themeSeq || [];
      if (QA.themeSeq.length < 300) QA.themeSeq.push(wall.theme);
    }
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
  function spawnSpray(x, y) {
    for (let i = 0; i < 5; i++) {
      const a = -1.2 - Math.random() * 0.8; // up-ish fan
      const sp = 60 + Math.random() * 70;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.35 + Math.random() * 0.2 });
    }
  }
  function spawnSpark(x, y) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * 6.28;
      const sp = 70 + Math.random() * 120;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3 + Math.random() * 0.2 });
    }
  }
  function spawnSplash(x, y) {
    for (let i = 0; i < 16; i++) {
      const a = -Math.random() * Math.PI; // upward burst
      const sp = 80 + Math.random() * 170;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.5 + Math.random() * 0.3 });
    }
  }
  function spawnRing(x, y, col) {
    rings.push({ x, y, r: KR, vr: 90, life: 0.5, col: col || "#9becff" });
  }

  function duckX(W) {
    return Math.min(W * 0.3, 170);
  }

  // step transient fx (particles/rings/wakes/bubbles/popups/timers). Shared by the
  // play loop and the death sink so the splash keeps animating after the hit.
  function stepFx(dt) {
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const r of rings) {
      r.r += r.vr * dt;
      r.life -= dt;
    }
    rings = rings.filter((r) => r.life > 0);
    for (const w of wakes) {
      w.r += 26 * dt;
      w.life -= dt;
    }
    wakes = wakes.filter((w) => w.life > 0);
    for (const b of bubbles) {
      b.y -= b.vy * dt;
      b.life -= dt;
    }
    bubbles = bubbles.filter((b) => b.life > 0 && b.y > water);
    for (const tr of trail) tr.life -= dt;
    trail = trail.filter((tr) => tr.life > 0);
    for (const pp of popups) {
      pp.y -= 36 * dt;
      pp.life -= dt;
    }
    popups = popups.filter((pp) => pp.life > 0);
    if (flash > 0) flash = Math.max(0, flash - dt);
    if (popT > 0) popT = Math.max(0, popT - dt);
  }

  function update(e, dt) {
    const W = e.width;
    const H = e.height;
    const { top, bot } = band(H);
    t += dt;

    // bot: start/restart, then hold while the duck sits below the next gap
    // centre and release above it (deadzone to damp jitter). __BOT_EDGE__ makes
    // it hug an edge instead of centring — used by the polish test to fire a near-miss.
    if (BOT && !window.__BOT_OFF__) {
      if (state === "ready") state = "play";
      else if (state === "over") reset();
      if (state === "play") {
        const dx = duckX(W);
        let next = null;
        for (const wl of walls)
          if (wl.x + WALL_W > dx - DUCK_R && (!next || wl.x < next.x)) next = wl;
        let target = next ? next.gapY : (top + bot) / 2;
        if (next && window.__BOT_EDGE__) {
          target = next.gapY + (next.gh / 2 - DUCK_R - 10); // hug the lower edge (near-miss, not a hit)
        } else if (next) {
          // detour for an uncollected duckling still inside the upcoming gap
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

    // death sink: the duck drops + spins, the splash animates, then the banner.
    if (state === "dying") {
      deathT += dt;
      deathFlash = Math.max(0, deathFlash - dt * 2);
      duck.vy += 700 * dt;
      duck.y += duck.vy * dt;
      deathRot += dt * 4;
      stepFx(dt);
      if (deathT >= DEATH_DUR) state = "over";
      if (QA) QA.state = state;
      return;
    }

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
    for (const wl of walls) {
      wl.x -= scroll * dt;
      if (wl.driftAmp > 0)
        wl.gapY = clampN(wl.baseGapY + Math.sin(t * DRIFT_SPD + wl.driftPhase) * wl.driftAmp,
          top + wl.gh / 2, bot - wl.gh / 2);
      if (wl.nearGlow > 0) wl.nearGlow = Math.max(0, wl.nearGlow - dt * 1.5);
    }
    const rightmost = walls.length ? Math.max(...walls.map((wl) => wl.x)) : -Infinity;
    if (walls.length === 0 || rightmost <= W - SPAWN_GAP) spawnWall(W, H);
    walls = walls.filter((wl) => wl.x > -WALL_W * 2);

    const dx = duckX(W);
    for (const wl of walls) {
      const gapTop = wl.gapY - wl.gh / 2;
      const gapBot = wl.gapY + wl.gh / 2;
      // horizontal overlap with the duck column
      if (wl.x < dx + DUCK_R && wl.x + WALL_W > dx - DUCK_R) {
        if (duck.y - DUCK_R < gapTop || duck.y + DUCK_R > gapBot) {
          // hit -> death sink sequence (highscore banked now, so best survives)
          state = "dying";
          deathT = 0;
          deathFlash = 0.45;
          deathRot = 0;
          duck.vy = Math.max(duck.vy, 240);
          engine.highscore("quacklift", score); // legacy key (walls) untouched
          best = engine.highscore("quacklift-pts", pts);
          audio.sadQuack();
          spawnSplash(dx, duck.y);
          if (QA) { QA.deathSeq = true; QA.state = state; }
          return;
        }
        // track closest clearance to a gap edge for the near-miss check at pass
        const clr = Math.min(duck.y - DUCK_R - gapTop, gapBot - (duck.y + DUCK_R));
        wl.minMargin = wl.minMargin === undefined ? clr : Math.min(wl.minMargin, clr);
      }
      if (!wl.passed && wl.x + WALL_W < dx - DUCK_R) {
        wl.passed = true;
        score++;
        pts += 100; // baseline wall bonus — keeps a duckling-free run identical to before
        audio.quack(420 + Math.random() * 80);
        popT = 0.18; // surface pop on a clean pass
        spawnSpray(dx, water);
        // near-miss: threaded close to an edge -> reward with spark + whoosh.
        // __NEAR_MISS_PX__ widens the threshold for the headless test (dead in prod).
        const nearPx =
          typeof window !== "undefined" && window.__NEAR_MISS_PX__ != null
            ? window.__NEAR_MISS_PX__ : NEAR_MISS_PX;
        if (wl.minMargin !== undefined && wl.minMargin < nearPx) {
          const edgeY = duck.y < wl.gapY ? gapTop : gapBot;
          spawnSpark(wl.x + WALL_W, edgeY);
          wl.nearGlow = 0.5;
          audio.whoosh();
          if (QA) QA.nearMiss = (QA.nearMiss || 0) + 1;
        }
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
        spawnRing(k.x, k.y, "#ffe66b");
        audio.quack(520 + mult * 45);
      }
    }
    kueken = kueken.filter((k) => k.x > -40 && !(k.got && k.x < dx));

    // --- ambient + feel fx ---
    wakeAcc += dt;
    if (wakeAcc > 0.18) { wakeAcc = 0; wakes.push({ x: dx, y: water, r: 6, life: 0.6 }); }
    bubbleAcc += dt;
    if (bubbleAcc > 0.5) {
      bubbleAcc = 0;
      bubbles.push({ x: Math.random() * W, y: bot, vy: 28 + Math.random() * 40, r: 2 + Math.random() * 3, life: 4 });
    }
    if (mult >= TRAIL_MULT) trail.push({ x: dx, y: duck.y, life: 0.35 });
    if (QA) QA.bubbles = bubbles.length;

    stepFx(dt);

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

  // Fill a wall segment [y0,y1] by vertically tiling a texture, clipped to the exact
  // segment bounds (no pixel spills past the gap edge — collision + visuals share one
  // source of truth). Every other tile is mirror-flipped so a continuous vertical motif
  // self-tiles without a seam. Anchored at the gap edge so the texture stays locked to
  // the gap as it drifts. Width is locked to WALL_W (never stretched).
  function fillTiledSeg(ctx, img, x, y0, y1, bottomAnchor) {
    if (y1 - y0 <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y0, WALL_W, y1 - y0);
    ctx.clip();
    ctx.shadowBlur = 0; // the texture doesn't glow; the edge stroke carries the neon
    if (bottomAnchor) {
      for (let i = 0, yy = y0; yy < y1; yy += TILE_H, i++) drawTile(ctx, img, x, yy, i & 1);
    } else {
      for (let i = 0, yy = y1; yy > y0; yy -= TILE_H, i++) drawTile(ctx, img, x, yy - TILE_H, i & 1);
    }
    ctx.restore();
  }
  function drawTile(ctx, img, x, y, flip) {
    if (flip) {
      ctx.save();
      ctx.translate(0, y + TILE_H);
      ctx.scale(1, -1);
      ctx.drawImage(img, x, 0, WALL_W, TILE_H);
      ctx.restore();
    } else {
      ctx.drawImage(img, x, y, WALL_W, TILE_H);
    }
  }

  // --- one wall, drawn per visual style + theme. Gap geometry is identical across all. ---
  function drawWall(ctx, wl, H) {
    const gapTop = wl.gapY - wl.gh / 2;
    const gapBot = wl.gapY + wl.gh / 2;
    const x = wl.x;
    const th = THEMES[wl.theme] || THEMES[0];
    ctx.save();
    ctx.shadowColor = th.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = th.fill;
    ctx.strokeStyle = th.color;
    ctx.lineWidth = 2;
    if (wl.style === "stalactite") {
      // each half tapers to a point at its gap edge (themed colour; no texture)
      ctx.beginPath();
      ctx.moveTo(x, -4);
      ctx.lineTo(x + WALL_W, -4);
      ctx.lineTo(x + WALL_W, gapTop - 20);
      ctx.lineTo(x + WALL_W / 2, gapTop);
      ctx.lineTo(x, gapTop - 20);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, H + 4);
      ctx.lineTo(x + WALL_W, H + 4);
      ctx.lineTo(x + WALL_W, gapBot + 20);
      ctx.lineTo(x + WALL_W / 2, gapBot);
      ctx.lineTo(x, gapBot + 20);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (th.ready) {
      // generated neon body, tiled into each segment; themed neon edge drawn over it
      fillTiledSeg(ctx, th.img, x, -4, gapTop, false);
      fillTiledSeg(ctx, th.img, x, gapBot, H + 4, true);
      ctx.strokeRect(x + 0.5, -4, WALL_W - 1, gapTop + 4);
      ctx.strokeRect(x + 0.5, gapBot, WALL_W - 1, H - gapBot + 4);
    } else {
      // fallback: recoloured plain bar (covers the frames before the sprite loads)
      ctx.fillRect(x, -4, WALL_W, gapTop + 4);
      ctx.strokeRect(x + 0.5, -4, WALL_W - 1, gapTop + 4);
      ctx.fillRect(x, gapBot, WALL_W, H - gapBot + 4);
      ctx.strokeRect(x + 0.5, gapBot, WALL_W - 1, H - gapBot + 4);
    }
    ctx.restore();
    // glowing gap edges (the "safe" lane). Gate = brighter rounded frame.
    const baseGlow = wl.style === "gate" ? 0.9 : 0.5;
    const glow = Math.max(baseGlow, wl.nearGlow || 0);
    ctx.save();
    if (wl.style === "gate" || wl.nearGlow > 0) {
      ctx.shadowColor = "#36e6ff";
      ctx.shadowBlur = (wl.style === "gate" ? 8 : 0) + (wl.nearGlow || 0) * 22;
    }
    ctx.strokeStyle = `rgba(54,230,255,${glow})`;
    ctx.lineWidth = wl.style === "gate" ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(x, gapTop);
    ctx.lineTo(x + WALL_W, gapTop);
    ctx.moveTo(x, gapBot);
    ctx.lineTo(x + WALL_W, gapBot);
    ctx.stroke();
    ctx.restore();
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

    // --- neon walls (per style) ---
    for (const wl of walls) drawWall(ctx, wl, H);

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
    // rising bubbles (depth; paint-only, capped)
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "rgba(160,240,255,0.7)";
    ctx.lineWidth = 1;
    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
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
    // wake ripples the duck leaves on the surface
    ctx.save();
    ctx.strokeStyle = "rgba(160,240,255,0.5)";
    ctx.lineWidth = 1.5;
    for (const w of wakes) {
      ctx.globalAlpha = clampN(w.life, 0, 1) * 0.6;
      ctx.beginPath();
      ctx.ellipse(w.x, w.y, w.r, w.r * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
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

    // --- greed trail behind the duck (high combo) ---
    if (trail.length) {
      ctx.save();
      for (const tr of trail) {
        ctx.globalAlpha = clampN(tr.life / 0.35, 0, 1) * 0.4;
        ctx.fillStyle = "#36e6ff";
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, DUCK_R * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // --- the duck riding the surface (leans into vertical motion; spins on death) ---
    const squash = clampN(1 + duck.vy * 0.0008 + popT * 0.5, 0.82, 1.4);
    const rot = state === "dying" ? deathRot : clampN(duck.vy * LEAN_K, -LEAN_MAX, LEAN_MAX);
    drawDuck(ctx, dx, duck.y, DUCK_R * 1.5, { squash, rot, pose: "default" });

    // --- pickup rings + sparkle particles + score popups (in front of the duck) ---
    for (const r of rings) {
      ctx.globalAlpha = clampN(r.life * 2, 0, 1) * 0.7;
      ctx.strokeStyle = r.col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
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

    // --- combo greed vignette (intensifies with the multiplier) ---
    if (mult >= TRAIL_MULT) {
      const tint = clampN((mult - TRAIL_MULT + 1) / (MULT_MAX - TRAIL_MULT + 1), 0, 1) * 0.22;
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72);
      vg.addColorStop(0, "rgba(54,230,255,0)");
      vg.addColorStop(1, `rgba(54,230,255,${tint})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
    // --- death flash ---
    if (deathFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${clampN(deathFlash, 0, 0.45)})`;
      ctx.fillRect(0, 0, W, H);
    }

    // --- HUD --- (safe-area aware; right column clears the fixed mute button)
    const st = e.safe.top, sl = e.safe.left;
    const hudR = W - 64 - e.safe.right;
    ctx.fillStyle = "#dfe6f3";
    ctx.font = "bold 22px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("lift: " + score, 16 + sl, 12 + st);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffd23f";
    ctx.font = "bold 15px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillText("score " + pts.toLocaleString(), hudR, 14 + st);
    ctx.fillStyle = "rgba(223,230,243,0.5)";
    ctx.font = "13px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillText("best " + best.toLocaleString(), hudR, 36 + st);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(223,230,243,0.55)";
    ctx.fillText("‹ hub", 16 + sl, 44 + st);

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
      ctx.fillText("x" + mult, W / 2, 26 + st);
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
    if (state === "dying") return; // can't restart mid-sink
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
