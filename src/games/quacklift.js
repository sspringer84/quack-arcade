// quacklift.js — QUACK LIFT (Phase 2).
// A one-button tide-climber. You don't move the duck — you move the WATER:
//   HOLD (tap-and-hold / Space) raises the water, RELEASE lets it fall.
// A rubber duck rides the surface by buoyancy. Thread the staggered gaps in the
// neon walls scrolling in from the right; touching a wall ends the run.
//
// Controls: hold anywhere (touch) or hold Space — that's it.

import { drawDuck } from "../duck.js";
import * as audio from "../audio.js";

const DUCK_R = 22;
const DUCK_RIDE = 14; // how far above the surface the duck floats
const WATER_RISE = 360; // px/s the surface climbs while held
const WATER_FALL = 300; // px/s it recedes while released (a touch slower = buoyant)
const SPRING = 48; // buoyancy stiffness pulling the duck to the surface
const DAMP = 11; // buoyancy damping (slightly under critical -> a little bob)
const WALL_W = 58; // neon wall thickness
const SCROLL0 = 140; // initial scroll speed (px/s)
const SCROLL_RAMP = 4; // +px/s of scroll per wall cleared
const GAP0 = 0.34; // initial gap height (fraction of playable band)
const GAP_MIN = 0.22; // gap shrinks toward this with score
const SPAWN_GAP = 300; // horizontal spacing between walls (px)

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

  // playable vertical band (water clamps here; gaps spawn within it)
  function band(H) {
    return { top: H * 0.12, bot: H * 0.9 };
  }

  function reset() {
    const H = engine.height;
    const { top, bot } = band(H);
    state = "ready";
    score = 0;
    best = engine.highscore("quacklift");
    water = (top + bot) / 2;
    duck = { y: water - DUCK_RIDE, vy: 0 };
    walls = [];
    scroll = SCROLL0;
    holding = false;
    t = 0;
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
    let gapY = top + gh / 2 + Math.random() * (bot - top - gh);
    // keep consecutive gaps reachable: limit vertical jump between walls
    if (prev) {
      const maxStep = (bot - top) * 0.26;
      gapY = clampN(gapY, prev.gapY - maxStep, prev.gapY + maxStep);
    }
    walls.push({ x: W + WALL_W, gapY, gh, passed: false });
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
        const target = next ? next.gapY : (top + bot) / 2;
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
          best = engine.highscore("quacklift", score);
          audio.sadQuack();
        }
      }
      if (!wl.passed && wl.x + WALL_W < dx - DUCK_R) {
        wl.passed = true;
        score++;
        audio.quack(420 + Math.random() * 80);
      }
    }

    if (QA) {
      QA.state = state;
      QA.water = water;
      QA.duck = { y: duck.y, vy: duck.vy };
      QA.score = score;
      QA.holding = holding;
      QA.maxScore = Math.max(QA.maxScore || 0, score);
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
    wg.addColorStop(1, "rgba(20,80,180,0.22)");
    ctx.fillStyle = wg;
    ctx.fill();
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

    // --- the duck riding the surface ---
    const squash = clampN(1 + duck.vy * 0.0008, 0.82, 1.2);
    drawDuck(ctx, dx, duck.y, DUCK_R * 1.5, { squash, pose: "default" });

    // --- HUD ---
    ctx.fillStyle = "#dfe6f3";
    ctx.font = "bold 22px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("lift: " + score, 16, 12);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffd23f";
    ctx.font = "bold 15px ui-monospace, monospace";
    ctx.fillText("score " + (score * 100).toLocaleString(), W - 14, 14);
    ctx.fillStyle = "rgba(223,230,243,0.5)";
    ctx.font = "13px ui-monospace, monospace";
    ctx.fillText("best " + (best * 100).toLocaleString(), W - 14, 36);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(223,230,243,0.55)";
    ctx.fillText("‹ hub", 16, 44);

    if (state === "ready")
      banner(ctx, W, H, "QUACK LIFT", isTouch ? "Halten = Wasser hoch · loslassen = runter" : "Leertaste halten = Wasser hoch · loslassen = runter", "#36e6ff");
    else if (state === "over") {
      banner(ctx, W, H, (score * 100).toLocaleString() + " Punkte", "Glub glub. Die Ente ist abgesoffen.", "#ff7b9c", "Tippen für nochmal");
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
