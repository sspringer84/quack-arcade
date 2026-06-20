// flyervariants.js — the shared pool of duck poses used by the ambient flyers
// (hub + DUCK & COVER desktop margins). Keep in sync with duck.js SPRITES.
// fly_* are dedicated side-view flying sprites; the rest are reused poses.
export const FLYER_VARIANTS = [
  "default",
  "wave",
  "surprised",
  "love",
  "fly_angel",
  "fly_balloon",
  "fly_cape",
  "fly_cool",
  "fly_jetpack",
  "fly_pilot",
  "fly_rainbow",
  "fly_rocket",
  "fly_shades",
  "fly_star",
];

// variant keys whose source art faces LEFT — the flyer inverts flip so the duck
// faces its travel direction. (Right-facing fly_* + the front-facing reused poses
// are not listed.)
export const FLYER_FACE_LEFT = [
  "fly_angel",
  "fly_balloon",
  "fly_cape",
  "fly_jetpack",
  "fly_pilot",
];
