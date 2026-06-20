// engine.js — shared core for Quack Arcade.
// One canvas, a scene stack, normalized input (keyboard + pointer/touch),
// a fixed-ish rAF loop with dt clamping, and a tiny localStorage highscore helper.
// Games are plain scene objects: { enter, exit, update(e,dt), render(e,ctx),
// onPress(e,ev), onRelease(e,ev), onResize(e) } — all optional.

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.scene = null;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.input = {
      held: false,
      justPressed: false,
      justReleased: false,
      pointer: { x: 0, y: 0 },
      keys: new Set(),
    };
    this._last = 0;
    this._raf = null;
    this._bindEvents();
    this._resize();
  }

  _isActionKey(code) {
    return code === "Space" || code === "Enter" || code === "ArrowUp";
  }

  _bindEvents() {
    window.addEventListener("resize", () => this._resize());

    window.addEventListener("keydown", (e) => {
      this.input.keys.add(e.code);
      if (e.repeat) return;
      if (this._isActionKey(e.code)) {
        e.preventDefault();
        this._press(e);
      }
    });
    window.addEventListener("keyup", (e) => {
      this.input.keys.delete(e.code);
      if (this._isActionKey(e.code)) {
        e.preventDefault();
        this._release(e);
      }
    });

    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture && c.setPointerCapture(e.pointerId);
      this._updatePointer(e);
      this._press(e);
    });
    c.addEventListener("pointerup", (e) => {
      this._updatePointer(e);
      this._release(e);
    });
    c.addEventListener("pointercancel", () => this._release({}));
    c.addEventListener("pointermove", (e) => this._updatePointer(e));
    c.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  _press(ev) {
    if (!this.input.held) {
      this.input.held = true;
      this.input.justPressed = true;
    }
    this.scene && this.scene.onPress && this.scene.onPress(this, ev);
  }

  _release(ev) {
    if (this.input.held) {
      this.input.held = false;
      this.input.justReleased = true;
    }
    this.scene && this.scene.onRelease && this.scene.onRelease(this, ev);
  }

  _updatePointer(e) {
    const r = this.canvas.getBoundingClientRect();
    this.input.pointer.x = e.clientX - r.left;
    this.input.pointer.y = e.clientY - r.top;
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = dpr;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scene && this.scene.onResize && this.scene.onResize(this);
  }

  setScene(scene) {
    this.scene && this.scene.exit && this.scene.exit(this);
    this.scene = scene;
    scene && scene.enter && scene.enter(this);
    this._resize();
  }

  start() {
    if (this._raf) return;
    this._last = performance.now();
    const loop = (t) => {
      let dt = (t - this._last) / 1000;
      this._last = t;
      if (dt > 0.05) dt = 0.05; // clamp tab-switch / hitch gaps
      const s = this.scene;
      if (s) {
        s.update && s.update(this, dt);
        s.render && s.render(this, this.ctx);
      }
      this.input.justPressed = false;
      this.input.justReleased = false;
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  // localStorage best-score helper. Call highscore(key) to read,
  // highscore(key, value) to submit a new score (keeps the max).
  highscore(key, value) {
    const k = "quack-arcade:hs:" + key;
    const cur = Number(localStorage.getItem(k) || 0);
    if (value === undefined) return cur;
    if (value > cur) {
      localStorage.setItem(k, String(value));
      return value;
    }
    return cur;
  }
}

// --- small shared helpers ---
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// frame-rate-independent damping toward a target
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
