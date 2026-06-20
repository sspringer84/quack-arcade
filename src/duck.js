// duck.js — the shared rubber-duck identity. Prefers generated sprites
// (assets/duck*.png, Flux Schnell, chroma-keyed) and falls back to canvas
// primitives if an image hasn't loaded. Poses: "default" (classic), "jump"
// (airborne), "sad" (game over). squash > 1 = stretched tall, < 1 = flat.

const SPRITES = {
  default: "assets/duck.png",
  jump: "assets/duck-jump.png",
  sad: "assets/duck-sad.png",
  wave: "assets/duck-wave.png",
  surprised: "assets/duck-surprised.png",
  sleep: "assets/duck-sleep.png",
  love: "assets/duck-love.png", // heart-eyes — flashed as a combo cameo
  // ambient flyer fleet (side-view variants drifting across hub + desktop margins)
  fly_angel: "assets/fly_angel.png",
  fly_balloon: "assets/fly_balloon.png",
  fly_cape: "assets/fly_cape.png",
  fly_cool: "assets/fly_cool.png",
  fly_jetpack: "assets/fly_jetpack.png",
  fly_pilot: "assets/fly_pilot.png",
  fly_rainbow: "assets/fly_rainbow.png",
  fly_rocket: "assets/fly_rocket.png",
  fly_shades: "assets/fly_shades.png",
  fly_star: "assets/fly_star.png",
};

const imgs = {};
const ready = {};
if (typeof Image !== "undefined") {
  for (const [key, src] of Object.entries(SPRITES)) {
    const im = new Image();
    im.onload = () => (ready[key] = true);
    im.src = src;
    imgs[key] = im;
  }
}

const SPRITE_K = 1.7; // sprite height per unit of `size`
// sprites whose source art faces LEFT (opposite the classic) — flip is inverted
const SPRITE_FLIP_INVERT = new Set(["jump"]);

export function drawDuck(ctx, x, y, size = 40, opts = {}) {
  const { squash = 1, rot = 0, flip = false, pose = "default" } = opts;
  const vy = squash;
  const vx = 1 / Math.sqrt(squash);

  const key = ready[pose] ? pose : ready.default ? "default" : null;
  if (key) {
    const im = imgs[key];
    const sprFlip = SPRITE_FLIP_INVERT.has(key) ? !flip : flip;
    const sx = sprFlip ? -1 : 1;
    const h = size * SPRITE_K;
    const w = h * (im.naturalWidth / im.naturalHeight);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(sx * vx, vy);
    ctx.drawImage(im, -w / 2, -h / 2, w, h);
    ctx.restore();
    return;
  }

  const sx = flip ? -1 : 1;

  // --- canvas fallback ---
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(sx * vx, vy);
  const s = size;

  ctx.fillStyle = "#ffd23f";
  ctx.beginPath();
  ctx.ellipse(0, s * 0.18, s * 0.62, s * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-s * 0.55, s * 0.02);
  ctx.lineTo(-s * 0.85, -s * 0.12);
  ctx.lineTo(-s * 0.5, s * 0.2);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(s * 0.45, -s * 0.28, s * 0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ff9505";
  ctx.beginPath();
  ctx.moveTo(s * 0.68, -s * 0.34);
  ctx.lineTo(s * 1.06, -s * 0.24);
  ctx.lineTo(s * 0.68, -s * 0.12);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.arc(s * 0.52, -s * 0.34, s * 0.055, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.ellipse(-s * 0.12, s * 0.06, s * 0.2, s * 0.1, -0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
