/* <exploded-view> v2: an exploded product view in CSS 2.5D.
 *
 * No WebGL, no 3D library. Each layer is a flat <img>; the script only writes transforms.
 *   mode="tilt"  straight-on layers in one CSS 3D context (perspective + preserve-3d), camera turns.
 *   mode="iso"   layers rendered from one fixed 3/4 camera; parts slide in 2D, no CSS 3D (anatomy's way).
 *   trigger="scroll"  a pinned scroll story.   trigger="hover"  hover/tap opens it, idle tour plays.
 *
 * Motion follows the anatomy skill (MIT, see NOTICE): one spring per part, staggered open
 * (outside first) and reversed close, a reversal reschedules only what changes, the transform is
 * removed at rest, one lit part with the rest stepped down, a live readout, labels that end on a dot,
 * and a loop that sleeps when settled or offscreen. Reduced motion jumps to the targets.
 */
(() => {
  if (customElements.get("exploded-view")) return;

  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  // Quintic easing reaches each scroll beat with zero velocity and acceleration.
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };
  // Exact critically damped spring: no bounce, consistent at any refresh rate. Keeping velocity
  // when a target changes lets a reversal decelerate naturally instead of snapping direction.
  const spring = (state, target, dt, omega, calm, key = "x", velocity = "v") => {
    if (calm) { state[key] = target; state[velocity] = 0; return false; }
    const offset = state[key] - target;
    const c = state[velocity] + omega * offset, decay = Math.exp(-omega * dt);
    state[key] = target + (offset + c * dt) * decay;
    state[velocity] = (state[velocity] - omega * c * dt) * decay;
    if (Math.abs(state[key] - target) < 2e-4 && Math.abs(state[velocity]) < 2e-4) {
      state[key] = target; state[velocity] = 0; return false;
    }
    return true;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad2 = (i) => String(i + 1).padStart(2, "0");
  const RAD = Math.PI / 180;

  const PERSP = 3600;
  // Camera presets (rx, ry, rz in degrees). The layers only ever move along z; the camera decides how that reads.
  const CAMERAS = {
    fan: (t, s) => [9 * t, (-40 + 14 * s) * t, 0],
    stack: (t, s) => [56 * t, 0, (-34 + 10 * s) * t],
  };
  // Scroll beats, as fractions of the pinned section.
  const BEATS = {
    tilt: { turn: [0.02, 0.16], open: 0.14, stagger: 0.035, span: 0.2, sweep: [0.48, 0.72], close: 0.74, rest: [0.9, 1] },
    iso: { open: 0.06, stagger: 0.04, span: 0.24, close: 0.72 },
  };
  const SPRING = { hover: { omega: 8, camera: 9, stagger: 0.045 }, scroll: { omega: 11, camera: 12 } };
  const HIT = { width: 160, strong: 90, weak: 18 };
  const TOUR = { first: 1.4, resume: 3.6, apartAt: 0.5, listAt: 1.5, step: 1.4, hold: 2 };

  // Shared by the builder and embeds. Use ingredient/part names, then the visible layer layout;
  // canvas aspect alone is not evidence (all exports may have the same padded artboard).
  const suggestMotion = (scene) => {
    const layers = scene.layers || [];
    const words = [scene.product, ...layers.flatMap((l) => [l.label, l.name, l.file])]
      .filter(Boolean).join(" ").toLowerCase().replace(/[^a-z]+/g, " ").split(/\s+/);
    const tokens = new Set(words);
    const any = (names) => names.split(" ").some((name) => tokens.has(name));
    const foodParts = "bun brioche sauce tomato lettuce patty beef cheese avocado bacon onion frosting sponge".split(" ").filter((name) => tokens.has(name));
    if (any("burger hamburger sandwich cake bagel pizza taco pastry") || foodParts.length >= 2)
      return { kind: "vertical", reason: "Food ingredients detected — lift the layers vertically." };
    if (any("phone smartphone iphone tablet laptop watch camera battery oled motherboard screen display"))
      return { kind: "sideways", reason: "Device parts detected — use a sideways reveal." };
    const height = scene.canvas?.[1];
    const parts = layers.filter((l) => Array.isArray(l.bounds) && l.bounds.length === 4 && l.bounds[3] > l.bounds[1]);
    if (height > 0 && parts.length >= 3) {
      const centers = parts.map((l) => l.center?.[1] ?? (l.bounds[1] + l.bounds[3]) / 2);
      const flat = parts.filter((l) => (l.bounds[2] - l.bounds[0]) / (l.bounds[3] - l.bounds[1]) > 1.6).length / parts.length;
      const span = (Math.max(...centers) - Math.min(...centers)) / height;
      const ordered = centers.slice(1).filter((y, i) => y >= centers[i] - height * 0.025).length / (centers.length - 1);
      if (flat >= 0.65 && span > 0.18 && ordered >= 0.75)
        return { kind: "vertical", reason: "Wide layers stacked from top to bottom — use a vertical lift." };
    }
    return { kind: "sideways", reason: "No clear vertical stack detected — use a sideways reveal. You can override it." };
  };

  // Four-corner homography: unit square (0,0)(1,0)(1,1)(0,1) -> screen quad. Used to hit-test a projected layer.
  const homography = (q) => {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    let g = 0, h = 0;
    if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
      const den = dx1 * dy2 - dx2 * dy1;
      g = (dx3 * dy2 - dx2 * dy3) / den;
      h = (dx1 * dy3 - dx3 * dy1) / den;
    }
    return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
  };
  const invert = (m) => {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (!det || !Number.isFinite(det)) return null;
    return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map((v) => v / det);
  };

  // Capture the script URL while evaluating; portable exports provide a data: stylesheet.
  const STYLE_URL = document.currentScript?.getAttribute('data-render-css') || new URL('explode.css', document.currentScript?.src || document.baseURI).href;

  class ExplodedView extends HTMLElement {
    static suggestMotion(scene) { return suggestMotion(scene); }

    connectedCallback() {
      if (this.root) { this.wire(); return; }
      const src = this.getAttribute("src");
      if (src) {
        fetch(new URL(src, document.baseURI)).then((r) => r.json()).then((s) => this.init(s))
          .catch((e) => console.error("<exploded-view>: could not load the scene", e));
        return;
      }
      const tag = this.querySelector('script[type="application/json"]');
      try { this.init(JSON.parse(tag ? tag.textContent : this.getAttribute("scene-json") || "{}")); }
      catch (e) { console.error("<exploded-view>: the scene JSON is not valid", e); }
    }

    disconnectedCallback() {
      (this.off || []).forEach((f) => f());
      this.off = [];
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      clearTimeout(this.leaveTimer);
      clearTimeout(this.idleTimer);
    }

    init(scene) {
      if (this.root || !this.isConnected) return;
      if (!Array.isArray(scene.layers) || !scene.layers.length || !Array.isArray(scene.canvas)) {
        console.error("<exploded-view>: the scene needs `canvas: [w, h]` and a non-empty `layers` list");
        return;
      }
      const opt = (name, def, ok) => { const v = this.getAttribute(name) || scene[name] || def; return ok.includes(v) ? v : def; };
      const requestedMotion = opt("motion", "auto", ["auto", "sideways", "vertical", "custom"]);
      // Existing authored axes, per-part moves and camera presets remain authoritative in auto mode.
      const authored = scene.axis || scene.preset || scene.layers.some((l) => l.move);
      this.motion = requestedMotion === "auto" ? (authored ? "custom" : suggestMotion(scene).kind) : requestedMotion;
      this.mode = opt("mode", "tilt", ["tilt", "iso"]);
      if (this.motion === "vertical") {
        this.mode = "iso";
        scene = { ...scene, axis: [0, -1], gap: scene.gap ?? Math.round(scene.canvas[1] * 0.1467) };
      } else if (this.motion === "sideways" && requestedMotion === "sideways") {
        scene = { ...scene, axis: scene.axis || [-0.67, -0.2], preset: scene.preset || "fan" };
      }
      this.scene = scene;
      this.trigger = opt("trigger", "scroll", ["scroll", "hover"]);
      this.theme = opt("theme", "dark", ["dark", "light"]);
      this.hover = this.trigger === "hover";
      this.iso = this.mode === "iso";
      this.setAttribute("data-mode", this.mode);
      this.setAttribute("data-motion", this.motion);
      this.setAttribute("data-trigger", this.trigger);
      this.setAttribute("data-theme", this.theme);
      if (this.getAttribute("accent")) this.style.setProperty("--accent", this.getAttribute("accent"));
      if (!this.hover) this.style.setProperty("--length", this.getAttribute("length") || scene.length || "420vh");
      this.root = this.attachShadow({ mode: "open" });
      this.still = matchMedia("(prefers-reduced-motion: reduce)");
      this.narrow = matchMedia("(max-width: 720px)");
      this.coarse = matchMedia("(hover: none)");
      this.build();
      this.wire();
    }

    build() {
      const S = this.scene;
      const base = new URL(S.base || "./", document.baseURI);
      const [cw, ch] = S.canvas;
      const n = (this.n = S.layers.length);
      const mid = (n - 1) / 2;
      const gap = S.gap ?? 300;
      const axis = S.axis || [-0.53, -0.35];
      this.order = Array.isArray(S.order) ? S.order : [...Array(n).keys()];
      this.root.innerHTML = `<link rel="stylesheet" href="${esc(STYLE_URL)}">
        <div class="sticky"><figure class="card">
          <span class="corner tl">${esc(S.fig || "Fig 1")}</span>
          <span class="corner tr">${esc(S.product)}</span>
          <div class="stage" tabindex="0" role="group" aria-label="${esc(S.product)}, exploded view. ${this.hover ? "Hover or tap to take it apart" : "Scroll to take it apart"}; arrow keys pick a part, Escape clears.">
            <div class="halo"></div>
            <div class="scene"><div class="rig"></div></div>
            <svg class="leaders" aria-hidden="true"></svg>
            <div class="labels"></div>
          </div>
          <ol class="legend"></ol>
          <span class="corner bl"></span>
          <span class="corner br" aria-hidden="true"></span>
          <div class="sr" aria-live="polite"></div>
        </figure>${S.caption ? `<p class="caption">${esc(S.caption)}</p>` : ""}</div>`;
      const $ = (sel) => this.root.querySelector(sel);
      this.cssReady = false;
      $('link[rel="stylesheet"]').addEventListener('load', () => { this.cssReady = true; this.measure(); this.run(); });
      $('link[rel="stylesheet"]').addEventListener('error', () => console.error('<exploded-view>: could not load explode.css'));
      this.sticky = $(".sticky"); this.card = $(".card"); this.stage = $(".stage"); this.sceneEl = $(".scene");
      this.rig = $(".rig"); this.halo = $(".halo"); this.svg = $("svg.leaders"); this.readout = $(".br");
      this.hint = $(".bl"); this.live = $(".sr");

      this.layers = S.layers.map((L, i) => {
        const el = document.createElement("div");
        el.className = "layer";
        const src = new URL(L.file, base).href;
        // Tilt mode fakes thickness: a few darkened copies just behind the face read as the edge once it turns.
        const edges = this.iso ? "" : Array.from({ length: Math.min(L.thickness ?? 3, 8) }, (_, k) =>
          `<img class="edge" alt="" decoding="async" data-src="${esc(src)}" style="transform:translateZ(${(-(k + 1) * 1.6).toFixed(1)}px)">`).join("");
        el.innerHTML = `${edges}<img class="face" alt="" decoding="async" data-src="${esc(src)}">`;
        const zfull = (mid - i) * gap;
        let m, rest = 0, spread = 0;
        if (this.iso) {
          // The move vector is the part's z along the product axis, projected by the render camera.
          m = L.move ? [L.move[0], L.move[1], 0] : [axis[0] * zfull, axis[1] * zfull, 0];
        } else {
          // Assembled, layers sit a hair apart in z (true stacking order); apart, they spread about the middle.
          rest = (mid - i) * (S.restGap ?? 2);
          m = L.move ? [L.move[0], L.move[1], L.move[2] - rest] : [0, 0, zfull - rest];
          // Perspective packs the far layers together; the fan adds a little sideways spread to even it out.
          spread = (i - mid) * gap * (S.fanSpread ?? 0.3);
        }
        return { el, L, i, src, rest, m, spread, x: 0, v: 0, target: 0, pending: null, off: [0, 0, 0], shown: "", hit: null,
          anchor: Array.isArray(L.anchor) ? L.anchor : null };
      });
      // Back layer first: coplanar layers at rest are then painted in the right order with no transform at all.
      for (let i = n - 1; i >= 0; i--) this.rig.appendChild(this.layers[i].el);

      const withAnchor = this.layers.filter((l) => l.anchor);
      this.svg.innerHTML = withAnchor.map((l) => `<g data-i="${l.i}" opacity="0"><line/><circle r="2.6"/></g>`).join("");
      $(".labels").innerHTML = withAnchor.map((l) => `<span class="label" data-i="${l.i}" style="opacity:0"><b>${pad2(l.i)}</b>${esc(l.L.label)}</span>`).join("");
      $(".legend").innerHTML = this.layers.map((l) => `<li><button type="button" data-i="${l.i}" aria-pressed="false"><b>${pad2(l.i)}</b>${esc(l.L.label)}</button></li>`).join("");
      for (const l of this.layers) {
        l.line = this.svg.querySelector(`g[data-i="${l.i}"]`);
        l.tag = this.root.querySelector(`.label[data-i="${l.i}"]`);
        l.button = this.root.querySelector(`.legend button[data-i="${l.i}"]`);
      }
      this.cam = { t: 0, sweep: 0, tVelocity: 0, sweepVelocity: 0 };
      this.pose = { fit: 1, cx: 1, sx: 0, cy: 1, sy: 0, cz: 1, sz: 0 };
      this.selected = null; this.clock = 0; this.apart = false; this.avgX = 0; this.moving = false;
      this.phase = null; this.hitStarted = false;
      this.hintText();
    }

    hintText() {
      const S = this.scene;
      const text = S.hint || (this.hover ? (this.coarse.matches ? "Tap to take it apart" : "Hover to take it apart")
        : (this.coarse.matches ? "Scroll to take it apart · tap a part" : "Scroll to take it apart · hover a part"));
      if (this.hint.textContent !== text) this.hint.textContent = text;
    }

    wire() {
      const off = (this.off = []);
      const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); off.push(() => target.removeEventListener(type, fn, opts)); };
      const watch = (obs) => off.push(() => obs.disconnect());
      // Load the art well before the section arrives; run the loop only while it is on screen.
      const loader = new IntersectionObserver((e) => { if (e[e.length - 1].isIntersecting) { this.loadAll(); this.buildHit(); } }, { rootMargin: "150% 0px" });
      loader.observe(this); watch(loader);
      const seen = new IntersectionObserver((e) => { this.visible = e[e.length - 1].isIntersecting; if (this.visible) this.run(); }, { rootMargin: "120px 0px" });
      seen.observe(this); watch(seen);
      if (!this.hover) on(window, "scroll", () => this.run(), { passive: true });
      const size = new ResizeObserver(() => { this.measure(); this.run(); });
      size.observe(this.stage); watch(size);
      on(this.narrow, "change", () => { this.measure(); this.run(); });
      on(this.coarse, "change", () => this.hintText());

      const card = this.card;
      const index = (e) => { const t = e.target.closest && e.target.closest("[data-i]"); return t ? Number(t.dataset.i) : null; };
      on(card, "pointermove", (e) => {
        if (e.pointerType === "touch") return;
        this.inside = true;
        clearTimeout(this.leaveTimer);
        this.engage();
        const i = index(e);
        if (i !== null) this.select(i);
        else if (this.stage.contains(e.target)) this.select(this.avgX > 0.5 ? this.partAt(e.clientX, e.clientY) : null);
      });
      on(card, "pointerleave", () => { this.inside = false; this.leave(); });
      on(card, "pointerdown", (e) => {
        if (e.pointerType !== "touch") return;
        this.quietTour();
        let i = index(e);
        if (i === null && this.stage.contains(e.target) && this.avgX > 0.5) i = this.partAt(e.clientX, e.clientY);
        if (this.hover) {
          if (!this.apart) { this.setApart(true); this.select(i); }
          else if (i === null) { this.select(null); this.setApart(false); }
          else this.select(i);
        } else this.select(i);
      });
      on(card, "click", (e) => { const i = index(e); if (i !== null) { this.engage(); this.select(i); } });
      on(card, "focusin", (e) => {
        this.focused = true;
        const t = e.target.closest && e.target.closest(".legend [data-i]");
        if (t) { this.engage(); this.select(Number(t.dataset.i)); }
      });
      on(card, "focusout", (e) => { if (!card.contains(e.relatedTarget)) { this.focused = false; this.leave(); } });
      on(this.stage, "keydown", (e) => this.key(e));

      this.touring = this.hover && !this.still.matches;
      this.tourClock = -TOUR.first;
      this.measure();
      this.run();
    }

    loadAll() {
      this.root.querySelectorAll("img[data-src]").forEach((img) => { img.src = img.dataset.src; img.removeAttribute("data-src"); });
    }

    // Per-layer alpha maps for hover-picking. Reading pixels needs a same-origin file (or CORS); otherwise
    // picking is simply off and the labels, legend and keyboard still select.
    buildHit() {
      if (this.hitStarted || location.protocol === "file:") return; // file:// pages can never read pixels
      this.hitStarted = true;
      const [cw, ch] = this.scene.canvas;
      const w = HIT.width, h = Math.max(1, Math.round((w * ch) / cw));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      for (const l of this.layers) {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => {
          try {
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(im, 0, 0, w, h);
            const d = ctx.getImageData(0, 0, w, h).data;
            const a = new Uint8Array(w * h);
            for (let k = 0; k < a.length; k++) a[k] = d[k * 4 + 3];
            l.hit = { w, h, a };
          } catch { /* tainted canvas: picking stays off */ }
        };
        im.src = l.src;
      }
    }

    measure() {
      if (!this.root) return;
      const [cw, ch] = this.scene.canvas;
      const box = this.stage.getBoundingClientRect();
      this.W = box.width; this.H = box.height;
      let h;
      if (this.iso) {
        // Fit by the apart pose: the union of the assembled bounds and every layer's travel.
        const b = this.scene.bounds || [cw * 0.1, ch * 0.1, cw * 0.9, ch * 0.9];
        let x0 = b[0], y0 = b[1], x1 = b[2], y1 = b[3];
        for (const l of this.layers) { x0 = Math.min(x0, b[0] + l.m[0]); x1 = Math.max(x1, b[2] + l.m[0]); y0 = Math.min(y0, b[1] + l.m[1]); y1 = Math.max(y1, b[3] + l.m[1]); }
        const fh = (b[3] - b[1]) / ch, fw = (b[2] - b[0]) / cw;
        h = Math.min((this.H * 0.56) / fh, (this.W * 0.5 * ch) / (cw * fw));
        const k = h / ch;
        this.fitApart = Math.min(1, (this.W * 0.74) / ((x1 - x0) * k), (this.H * 0.6) / ((y1 - y0) * k));
        this.halo.style.setProperty("--hy", `${((b[3] / ch - 0.5) * h + 0.03 * h).toFixed(1)}px`);
        this.stack = false;
      } else {
        this.stack = this.narrow.matches || this.scene.preset === "stack";
        // Fit the assembled product to the card; the apart pose is fitted by scaling the rig down as it opens.
        h = Math.min(this.H * (this.stack ? 0.5 : 0.62), (this.W * (this.stack ? 0.5 : 0.36) * ch) / cw);
      }
      // Labels go in side columns for a stacked or wide iso view, in top and bottom rows otherwise.
      this.cols = this.stack || (this.iso && (!this.narrow.matches || this.motion === "vertical"));
      this.bh = h; this.bw = (h * cw) / ch; this.k = h / ch;
      for (const el of [this.sceneEl, this.halo]) { el.style.setProperty("--bh", `${h.toFixed(1)}px`); el.style.setProperty("--bw", `${this.bw.toFixed(1)}px`); }
      for (const l of this.layers) {
        l.size = 0;
        if (l.anchor) l.local = [(l.anchor[0] / cw - 0.5) * this.bw, (l.anchor[1] / ch - 0.5) * this.bh];
      }
      this.pin = this.hover ? 0 : this.sticky.offsetHeight;
      this.hintText();
    }

    progress() {
      const r = this.getBoundingClientRect();
      const range = Math.max(1, r.height - this.pin), distance = -r.top;
      // Scroll positions are pixel-rounded while layout can be fractional. Snap the last
      // pixel at either end so a tiny residual camera turn doesn't prevent exact assembly.
      if (distance <= 1) return 0;
      if (range - distance <= 1) return 1;
      return clamp(distance / range);
    }

    // Layer-local point (px, centred on the scene box) -> stage px, through the same chain the CSS applies:
    // rig scale, camera rotations, the layer's own offset, then the scene's perspective.
    project(l, x, y) {
      const r = this.pose;
      let px = x + l.off[0], py = y + l.off[1], pz = l.off[2], t;
      t = px * r.cz - py * r.sz; py = px * r.sz + py * r.cz; px = t;
      t = px * r.cy + pz * r.sy; pz = -px * r.sy + pz * r.cy; px = t;
      t = py * r.cx - pz * r.sx; pz = py * r.sx + pz * r.cx; py = t;
      px *= r.fit; py *= r.fit; // CSS scale(s) is 2D: z is not scaled
      const s = this.iso ? 1 : PERSP / (PERSP - pz);
      return [this.W / 2 + px * s, this.H / 2 - 0.05 * this.bh + (py + 0.05 * this.bh) * s, this.iso ? this.n - l.i : pz];
    }

    quad(l) {
      const hw = this.bw / 2, hh = this.bh / 2;
      return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => this.project(l, x, y));
    }

    // Which part is under this pointer: the front-most layer whose pixel there is opaque enough.
    // A glass layer that is only faintly there loses to anything solid behind it.
    partAt(clientX, clientY) {
      const b = this.stage.getBoundingClientRect();
      const sx = clientX - b.left, sy = clientY - b.top;
      let best = null, bestZ = -Infinity, strong = false;
      for (const l of this.layers) {
        if (!l.hit) continue;
        const m = invert(homography(this.quad(l)));
        if (!m) continue;
        const w = m[6] * sx + m[7] * sy + m[8];
        if (!w) continue;
        const u = (m[0] * sx + m[1] * sy + m[2]) / w, v = (m[3] * sx + m[4] * sy + m[5]) / w;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const a = l.hit.a[Math.min(l.hit.h - 1, (v * l.hit.h) | 0) * l.hit.w + Math.min(l.hit.w - 1, (u * l.hit.w) | 0)];
        if (a < HIT.weak) continue;
        const isStrong = a >= HIT.strong;
        const z = this.project(l, (u - 0.5) * this.bw, (v - 0.5) * this.bh)[2];
        if ((isStrong && !strong) || (isStrong === strong && z > bestZ)) { best = l.i; bestZ = z; strong = isStrong; }
      }
      return best;
    }

    select(i) {
      if (this.selected === i) return;
      this.selected = i;
      for (const l of this.layers) {
        const on = l.i === i;
        for (const el of [l.el, l.line, l.tag, l.button]) if (el) el.toggleAttribute("data-on", on);
        l.button.setAttribute("aria-pressed", String(on));
      }
      this.stage.toggleAttribute("data-focus", i !== null);
      if (i !== null) this.announce(this.layers[i].L.label);
      this.run();
    }

    announce(text) { if (this.live.textContent !== text) this.live.textContent = text; }

    // Hover trigger: one pending target per layer, staggered. On a reversal only the layers whose target
    // changes are rescheduled (by their index in that shorter list), so the last one out is the first one home.
    setApart(on) {
      if (!this.hover || this.apart === on) return;
      this.apart = on;
      const goal = on ? 1 : 0;
      const stagger = this.still.matches ? 0 : SPRING.hover.stagger;
      let k = 0;
      for (const i of on ? this.order : [...this.order].reverse()) {
        const l = this.layers[i];
        if (!l) continue;
        if (l.target === goal) l.pending = null;
        else l.pending = { value: goal, at: this.clock + k++ * stagger };
      }
      this.run();
    }

    engage() { this.quietTour(); this.setApart(true); }

    leave() {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = setTimeout(() => {
        if (this.inside || this.focused) return;
        this.select(null);
        this.setApart(false);
      }, 260);
    }

    // The idle tour stops on any interaction and resumes a few seconds after the last one.
    quietTour() {
      if (!this.hover) return;
      this.touring = false;
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        if (this.inside || this.focused) return this.quietTour();
        this.touring = !this.still.matches;
        this.tourClock = -0.6;
        this.run();
      }, TOUR.resume * 1000);
    }

    tourAt(t) {
      const list = TOUR.listAt + this.n * TOUR.step;
      if (t < TOUR.apartAt) return { apart: false, part: null };
      if (t < TOUR.listAt) return { apart: true, part: null };
      if (t < list) return { apart: true, part: this.order[Math.floor((t - TOUR.listAt) / TOUR.step)] };
      return { apart: false, part: null };
    }

    key(e) {
      const n = this.n, s = this.selected;
      let next;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = s === null ? 0 : (s + 1) % n;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = s === null ? n - 1 : (s + n - 1) % n;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = n - 1;
      else if (e.key === "Escape") { this.quietTour(); this.select(null); this.setApart(false); e.preventDefault(); return; }
      else if (this.hover && (e.key === " " || e.key === "Enter")) {
        this.quietTour(); this.setApart(!this.apart); if (!this.apart) this.select(null); e.preventDefault(); return;
      } else return;
      e.preventDefault();
      this.quietTour();
      this.setApart(true);
      this.select(next);
    }

    run() {
      if (!this.frame && this.visible && this.root) { this.last = 0; this.frame = requestAnimationFrame((t) => this.tick(t)); }
    }

    tick(now) {
      // Allow slower frames to catch up; cap long tab/suspension gaps to avoid a visible leap.
      const dt = this.last ? clamp((now - this.last) / 1000, 0, 1 / 15) : 1 / 60;
      this.last = now;
      this.clock += dt;
      const calm = this.still.matches;
      const n = this.n;
      const hover = this.hover;

      if (hover && this.touring && !calm) {
        this.tourClock += dt;
        const total = TOUR.listAt + n * TOUR.step + TOUR.hold;
        if (this.tourClock >= total) this.tourClock -= total;
        const step = this.tourAt(this.tourClock);
        this.setApart(step.apart);
        this.select(step.part);
      }

      const p = hover ? 0 : this.progress();
      const B = BEATS[this.mode];
      const sp = hover ? SPRING.hover : SPRING.scroll;
      let moving = false;
      for (const l of this.layers) {
        let layerDt = dt;
        if (hover) {
          if (l.pending && this.clock >= l.pending.at) {
            // Split the frame at the stagger deadline, so a slower display doesn't start a part early.
            const before = clamp(l.pending.at - (this.clock - dt), 0, dt);
            spring(l, l.target, before, sp.omega, calm);
            layerDt -= before;
            l.target = l.pending.value; l.pending = null;
          }
        } else {
          // Open outside-first, close in reverse so the last one out is the first one home.
          const o = B.open + l.i * B.stagger, c = B.close + (n - 1 - l.i) * B.stagger * 0.6;
          l.target = smooth(o, o + B.span, p) * (1 - smooth(c, c + B.span * 0.5, p));
        }
        if (spring(l, l.target, layerDt, sp.omega, calm) || l.pending) moving = true;
      }

      // Camera (tilt only): turn in, sweep while apart, return to face-on at the very end.
      let turning = false;
      if (!this.iso) {
        const turn = hover ? (this.apart ? 1 : 0) : smooth(B.turn[0], B.turn[1], p) * (1 - smooth(B.rest[0], B.rest[1], p));
        const sweep = hover ? (this.apart ? 0.55 : 0) : smooth(B.sweep[0], B.sweep[1], p);
        for (const [key, goal] of [["t", turn], ["sweep", sweep]]) {
          if (spring(this.cam, goal, dt, sp.camera, calm, key, `${key}Velocity`)) turning = true;
        }
      }

      const avg = this.layers.reduce((a, l) => a + clamp(l.x, 0, 1.2), 0) / n;
      this.avgX = avg;
      const fit = this.iso ? 1 - (1 - this.fitApart) * clamp(avg, 0, 1) : 1 - (this.stack ? 0.32 : 0.12) * avg;
      const [rx, ry, rz] = this.iso ? [0, 0, 0] : (this.stack ? CAMERAS.stack : CAMERAS.fan)(this.cam.t, this.cam.sweep);
      const pose = this.pose;
      pose.fit = fit; pose.cx = Math.cos(rx * RAD); pose.sx = Math.sin(rx * RAD);
      pose.cy = Math.cos(ry * RAD); pose.sy = Math.sin(ry * RAD); pose.cz = Math.cos(rz * RAD); pose.sz = Math.sin(rz * RAD);
      // At rest and face-on there is no transform at all: the assembled view is exactly the supplied art.
      const rigText = fit === 1 && !rx && !ry && !rz ? ""
        : this.iso ? `scale(${fit.toFixed(4)})`
        : `scale(${fit.toFixed(4)}) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`;
      if (rigText !== this.rigShown) { this.rigShown = rigText; this.rig.style.transform = rigText; }
      if (!this.iso) {
        this.rig.toggleAttribute("data-flat", this.cam.t < 0.002);
        const edge = smooth(0, 0.25, this.cam.t).toFixed(3);
        if (edge !== this.edgeShown) { this.edgeShown = edge; this.rig.style.setProperty("--edge", edge); }
      }
      this.halo.style.transform = this.iso
        ? `scale(${(fit * (1 + 0.5 * avg)).toFixed(3)}, 1)`
        : `scale(${(fit * (1 + (this.stack ? 0.4 : 1.1) * avg)).toFixed(3)}, ${(1 + 0.6 * this.cam.t).toFixed(3)})`;

      const k = this.k, restRamp = smooth(0, 0.3, this.cam.t);
      for (const l of this.layers) {
        let text, off;
        if (this.iso) {
          off = [l.m[0] * l.x * k, l.m[1] * l.x * k, 0];
          text = l.x === 0 ? "" : `translate3d(${off[0].toFixed(2)}px, ${off[1].toFixed(2)}px, 0)`;
        } else {
          off = [(l.m[0] + (this.stack ? 0 : l.spread)) * l.x * k, l.m[1] * l.x * k, (l.rest * restRamp + l.m[2] * l.x) * k];
          text = l.x === 0 && off[2] === 0 ? "" : `translate3d(${off[0].toFixed(2)}px, ${off[1].toFixed(2)}px, ${off[2].toFixed(2)}px)`;
        }
        l.off = off;
        if (text !== l.shown) { l.shown = text; l.el.style.transform = text; }
      }
      this.moving = moving;
      this.placeLabels();
      this.say(p);
      const settled = !moving && !turning;
      const phase = settled && avg < 0.01 ? "assembled" : settled && avg > 0.99 ? "apart" : null;
      if (phase && phase !== this.phase) { if (this.phase) this.announce(phase === "apart" ? `Apart, ${n} layers` : "Assembled"); this.phase = phase; }

      this.frame = this.visible && (moving || turning || (hover && this.touring && !calm)) ? requestAnimationFrame((t) => this.tick(t)) : 0;
    }

    placeLabels() {
      const W = this.W, H = this.H;
      const rows = new Map();
      for (const l of this.layers) {
        if (!l.anchor) continue;
        const [ax, ay] = this.project(l, l.local[0], l.local[1]);
        l.ax = ax; l.ay = ay;
        l.show = smooth(0.82, 0.98, l.x);
        // Labels sit in two rows (tilt fan) or two columns (stack and iso); each leader ends on a dot on its part.
        const cols = this.cols;
        const left = this.iso ? ax < W / 2 : l.i % 2 === 1;
        if (!l.size) l.size = cols ? l.tag.offsetHeight : l.tag.offsetWidth;
        if (cols) { l.lx = left ? W * 0.17 : W * 0.83; l.ly = ay; l.row = left ? 1 : 0; }
        else { l.lx = clamp(ax, l.size / 2 + 10, W - l.size / 2 - 10); l.ly = l.i % 2 ? H * 0.82 : H * 0.13; l.row = l.i % 2; }
        const row = rows.get(l.row) || [];
        row.push(l); rows.set(l.row, row);
      }
      // Push labels in a row apart so they never overlap, keeping the row centred where it wanted to be.
      const axis = this.cols ? "ly" : "lx";
      for (const row of rows.values()) {
        row.sort((a, b) => a[axis] - b[axis]);
        const before = row.reduce((s, l) => s + l[axis], 0);
        for (let j = 1; j < row.length; j++) row[j][axis] = Math.max(row[j][axis], row[j - 1][axis] + (row[j - 1].size + row[j].size) / 2 + 10);
        const shift = (row.reduce((s, l) => s + l[axis], 0) - before) / row.length;
        for (const l of row) l[axis] -= shift;
        // ...and never let the row leave the card.
        const first = row[0], last = row[row.length - 1], limit = this.cols ? H : W;
        const over = last[axis] + last.size / 2 - (limit - 10);
        if (over > 0) { const room = Math.max(0, first[axis] - first.size / 2 - 10); for (const l of row) l[axis] -= Math.min(over, room); }
        const under = 10 - (first[axis] - first.size / 2);
        if (under > 0) for (const l of row) l[axis] += under;
      }
      for (const l of this.layers) {
        if (!l.anchor) continue;
        const { ax, ay, lx, ly, show } = l;
        const ex = ax + (lx - ax) * show, ey = ay + (ly - ay) * show;
        const line = l.line.firstChild, dot = l.line.lastChild;
        line.setAttribute("x1", ax.toFixed(1)); line.setAttribute("y1", ay.toFixed(1));
        line.setAttribute("x2", ex.toFixed(1)); line.setAttribute("y2", ey.toFixed(1));
        dot.setAttribute("cx", ax.toFixed(1)); dot.setAttribute("cy", ay.toFixed(1));
        l.line.setAttribute("opacity", show.toFixed(3));
        l.tag.style.opacity = smooth(0.6, 1, show).toFixed(3);
        l.tag.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) translate(-50%, -50%)`;
        l.tag.style.pointerEvents = show > 0.5 ? "auto" : "none";
      }
    }

    say(p) {
      const n = this.n;
      const avgT = this.layers.reduce((a, l) => a + l.target, 0) / n;
      let text;
      if (this.selected !== null) text = this.layers[this.selected].L.say || this.layers[this.selected].L.label;
      else if (this.avgX < 0.01 && !this.moving) text = `assembled · ${n} layers`;
      else if (this.avgX > 0.99 && !this.moving) text = `apart · ${n} layers`;
      else if (this.moving) text = avgT >= this.avgX ? "taking apart" : "closing up";
      else text = (this.hover ? this.apart : p < 0.5) ? "taking apart" : "closing up"; // parked mid-way
      if (this.readout.textContent !== text) this.readout.textContent = text;
    }
  }

  customElements.define("exploded-view", ExplodedView);
})();
