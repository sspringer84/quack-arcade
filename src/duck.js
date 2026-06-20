// duck.js — the shared rubber-duck identity. Prefers a generated sprite
// (assets/duck.png, Flux Schnell, chroma-keyed to transparent) and falls back
// to canvas primitives if the image hasn't loaded (or fails). squash > 1 =
// stretched tall, < 1 = squashed flat (apparent volume roughly preserved).

const duckImg = typeof Image !== "undefined" ? new Image() : null;
let spriteReady = false;
if (duckImg) {
  duckImg.onload = () => {
    spriteReady = true;
  };
  duckImg.src = "assets/duck.png";
}

// height of the drawn sprite per unit of `size` (tuned to roughly match the
// footprint the old canvas duck had at the same call sites)
const SPRITE_K = 1.7;

export function drawDuck(ctx, x, y, size = 40, opts = {}) {
  const { squash = 1, rot = 0, flip = false } = opts;
  const sx = flip ? -1 : 1;
  const vy = squash;
  const vx = 1 / Math.sqrt(squash);

  if (spriteReady && duckImg.naturalHeight) {
    const h = size * SPRITE_K;
    const w = h * (duckImg.naturalWidth / duckImg.naturalHeight);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(sx * vx, vy);
    ctx.drawImage(duckImg, -w / 2, -h / 2, w, h);
    ctx.restore();
    return;
  }

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
