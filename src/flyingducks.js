// flyingducks.js — ambient rubber ducks that drift in from the left/right edges
// in assorted variants. Used by the hub (full width) and by DUCK & COVER's
// desktop side-margins (drawn behind the opaque play column so they only show in
// the margins — and are fully occluded on mobile, where there is no margin).
// Pure decoration: never touches gameplay or input.

import { drawDuck } from "./duck.js";

const DEFAULT_VARIANTS = ["default", "wave", "surprised", "love"];

export function createFlyers(opts = {}) {
  const variants = opts.variants && opts.variants.length ? opts.variants : DEFAULT_VARIANTS;
  // sprite keys whose art faces LEFT — flip is inverted so they face travel dir
  const faceLeft = new Set(opts.faceLeft || []);
  let flyers = [];
  let t = 0;
  let spawnCd = 0;
  let seeded = false;

  function spawn(W, H, spread) {
    const fromLeft = Math.random() < 0.5;
    const size = 24 + Math.random() * 30;
    const speed = 32 + Math.random() * 52; // px/s
    flyers.push({
      // spread = start somewhere on-screen (initial seed); else enter from an edge
      x: spread ? Math.random() * W : fromLeft ? -size * 2 : W + size * 2,
      baseY: H * (0.1 + Math.random() * 0.8),
      vx: fromLeft ? speed : -speed,
      size,
      variant: variants[(Math.random() * variants.length) | 0],
      bobAmp: 6 + Math.random() * 16,
      bobFreq: 0.5 + Math.random() * 1.3,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.55 + Math.random() * 0.4,
      tilt: (Math.random() - 0.5) * 0.25,
    });
  }

  return {
    update(dt, W, H, max = 5) {
      t += dt;
      if (!seeded) {
        seeded = true;
        for (let i = 0; i < Math.max(2, max - 1); i++) spawn(W, H, true);
      }
      spawnCd -= dt;
      if (flyers.length < max && spawnCd <= 0) {
        spawn(W, H);
        spawnCd = 0.4 + Math.random() * 1.7;
      }
      for (const f of flyers) f.x += f.vx * dt;
      flyers = flyers.filter((f) => f.x > -f.size * 3 && f.x < W + f.size * 3);
    },
    render(ctx) {
      for (const f of flyers) {
        const wob = Math.sin(t * f.bobFreq + f.phase);
        const movingLeft = f.vx < 0;
        const flip = faceLeft.has(f.variant) ? !movingLeft : movingLeft;
        ctx.save();
        ctx.globalAlpha = f.alpha;
        drawDuck(ctx, f.x, f.baseY + wob * f.bobAmp, f.size, {
          pose: f.variant,
          flip,
          rot: wob * 0.07 + f.tilt,
        });
        ctx.restore();
      }
    },
    count() {
      return flyers.length;
    },
  };
}
