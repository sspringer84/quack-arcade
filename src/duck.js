// duck.js — the shared rubber-duck identity, drawn from canvas primitives.
// No image assets, no licensing. squash > 1 = stretched tall, < 1 = squashed
// flat (area roughly preserved). This same duck appears in all three games.

export function drawDuck(ctx, x, y, size = 40, opts = {}) {
  const { squash = 1, rot = 0, flip = false } = opts;
  const sx = flip ? -1 : 1;
  // preserve apparent volume: taller => narrower and vice-versa
  const vy = squash;
  const vx = 1 / Math.sqrt(squash);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(sx * vx, vy);

  const s = size;

  // body
  ctx.fillStyle = "#ffd23f";
  ctx.beginPath();
  ctx.ellipse(0, s * 0.18, s * 0.62, s * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();

  // tail flick
  ctx.beginPath();
  ctx.moveTo(-s * 0.55, s * 0.02);
  ctx.lineTo(-s * 0.85, -s * 0.12);
  ctx.lineTo(-s * 0.5, s * 0.2);
  ctx.closePath();
  ctx.fill();

  // head
  ctx.beginPath();
  ctx.arc(s * 0.45, -s * 0.28, s * 0.3, 0, Math.PI * 2);
  ctx.fill();

  // beak
  ctx.fillStyle = "#ff9505";
  ctx.beginPath();
  ctx.moveTo(s * 0.68, -s * 0.34);
  ctx.lineTo(s * 1.06, -s * 0.24);
  ctx.lineTo(s * 0.68, -s * 0.12);
  ctx.closePath();
  ctx.fill();

  // eye
  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.arc(s * 0.52, -s * 0.34, s * 0.055, 0, Math.PI * 2);
  ctx.fill();

  // soft highlight on the belly
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.ellipse(-s * 0.12, s * 0.06, s * 0.2, s * 0.1, -0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
