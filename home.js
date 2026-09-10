/* OneBrain landing page: the hero's 3D particle brain, plus scroll reveals.
 *
 * Canvas 2D, no library, no CDN — the same constraint as the rest of the app.
 * The 3D is real: a point cloud generated in object space, rotated, and
 * perspective-projected by hand each frame. WebGL would be the obvious reach,
 * but three.js is ~600 KB to render a few hundred dots, and the CSP forbids
 * loading it from anywhere anyway.
 *
 * The subject matters. This is not a decorative sphere: points form a brain out
 * of two folded hemispheres, and the lines between them are near-neighbour
 * links — a graph of connected facts, which is what the product actually is.
 */

'use strict';

document.documentElement.classList.add('js');

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// ------------------------------------------------------------- the geometry

/** Deterministic PRNG. The cloud must be identical on every load and every
 *  resize — a brain that reshuffles when you turn your phone looks broken. */
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** The brain's side profile, as cubic beziers in a normalised box.
 *
 *  Built from the silhouette rather than from a deformed sphere. A sphere with
 *  ripples on it reads as a walnut from every angle; the thing that makes a
 *  brain recognisable is its OUTLINE — domed crown, tapered frontal lobe, the
 *  cerebellum bump at the lower back, the stem dropping under it. So the
 *  outline is the input, and depth is added to it.
 *
 *  Flattened to a polygon here rather than handed to Path2D, so the same code
 *  runs under Node for shape tests and needs no canvas to decide what is inside.
 */
const PROFILE = [
  // cerebrum, clockwise from the top of the frontal lobe. +x is forward.
  [[0.62, 0.74], [0.86, 0.70], [0.98, 0.44], [0.86, 0.24]],
  [[0.86, 0.24], [0.78, 0.06], [0.54, -0.04], [0.34, 0.00]],
  [[0.34, 0.00], [0.12, -0.12], [-0.18, -0.14], [-0.42, -0.06]],
  [[-0.42, -0.06], [-0.72, 0.02], [-0.94, 0.18], [-0.96, 0.42]],
  [[-0.96, 0.42], [-0.98, 0.66], [-0.80, 0.86], [-0.52, 0.90]],
  [[-0.52, 0.90], [-0.22, 0.96], [0.22, 0.96], [0.44, 0.88]],
  [[0.44, 0.88], [0.56, 0.84], [0.60, 0.80], [0.62, 0.74]],
];
const CEREBELLUM = [
  [[-0.50, 0.04], [-0.74, 0.00], [-0.92, -0.20], [-0.86, -0.40]],
  [[-0.86, -0.40], [-0.78, -0.58], [-0.50, -0.56], [-0.40, -0.38]],
  [[-0.40, -0.38], [-0.34, -0.24], [-0.40, -0.02], [-0.50, 0.04]],
];
const STEM = [
  [[-0.28, -0.08], [-0.20, -0.38], [-0.22, -0.70], [-0.32, -0.90]],
  [[-0.32, -0.90], [-0.44, -0.88], [-0.48, -0.60], [-0.48, -0.24]],
  [[-0.48, -0.24], [-0.46, -0.14], [-0.38, -0.08], [-0.28, -0.08]],
];

/** Flatten cubic beziers into a closed polygon. */
function flatten(curves, steps = 22) {
  const poly = [];
  for (const [p0, p1, p2, p3] of curves) {
    for (let i = 0; i < steps; i++) {
      const t = i / steps, m = 1 - t;
      poly.push([
        m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0],
        m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
  }
  return poly;
}

function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y)
        && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Distance from a point to the polygon boundary. Drives the thickness: points
 *  deep inside the outline get the full cross-section, points near the edge get
 *  almost none, which is what turns a flat cut-out into a solid. */
function edgeDistance(poly, x, y) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const dx = xj - xi, dy = yj - yi;
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((x - xi) * dx + (y - yi) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = xi + t * dx - x, ey = yi + t * dy - y;
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Build the 3D cloud: sample the silhouette, then give each point a depth.
 *
 *  Axes: +x forward, +y up, +z towards the viewer's right. */
function buildBrain(count) {
  const rnd = rng(20260809);
  const pts = [];
  const parts = [
    { poly: flatten(PROFILE),    share: 0.70, halfWidth: 0.62, kind: 0, fissure: true },
    { poly: flatten(CEREBELLUM), share: 0.19, halfWidth: 0.42, kind: 1, fissure: false },
    { poly: flatten(STEM),       share: 0.11, halfWidth: 0.17, kind: 2, fissure: false },
  ];

  for (const part of parts) {
    const want = Math.round(count * part.share);
    const xs = part.poly.map((q) => q[0]), ys = part.poly.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    // Reference depth: the deepest point of this outline, so thickness is
    // normalised per part rather than shared across parts of different size.
    let deepest = 0;
    for (let i = 0; i < 400; i++) {
      const tx = x0 + rnd() * (x1 - x0), ty = y0 + rnd() * (y1 - y0);
      if (!inside(part.poly, tx, ty)) continue;
      const d = edgeDistance(part.poly, tx, ty);
      if (d > deepest) deepest = d;
    }
    deepest = deepest || 0.2;

    let made = 0, guard = want * 300;
    while (made < want && guard-- > 0) {
      const x = x0 + rnd() * (x1 - x0);
      const y = y0 + rnd() * (y1 - y0);
      if (!inside(part.poly, x, y)) continue;

      // Half-thickness at this point: an elliptical cross-section, so the
      // surface curves away instead of ending in a wall.
      const near = Math.min(1, edgeDistance(part.poly, x, y) / deepest);
      const half = part.halfWidth * Math.sqrt(near);
      // Bias to the shell — a brain is a folded surface, not a filled solid.
      const u = (rnd() * 2 - 1);
      let z = Math.sign(u || 1) * half * (0.55 + 0.45 * Math.pow(Math.abs(u), 0.4));

      // Gyri: displace along the surface normal so the outline itself ripples.
      const fold = 0.030 * Math.sin(11 * x + 7 * y) + 0.020 * Math.sin(17 * y - 9 * x);
      const rx = x + fold * (1 - near);
      const ry = y + fold * 0.8 * (1 - near);

      // Sagittal fissure: the midline groove. Only the cerebrum has one, and it
      // is the feature that says "brain" the moment the cloud turns to face you.
      if (part.fissure && ry > 0.1) {
        const mid = Math.exp(-(z * z) / 0.012);
        z += Math.sign(z || 1) * mid * 0.07;
      }

      pts.push({ x: rx, y: ry, z, kind: part.kind,
        phase: rnd() * Math.PI * 2,
        speed: 0.25 + rnd() * 0.55,
        amp: 0.004 + rnd() * 0.010,
        spin: rnd() * Math.PI * 2,       // each glyph sits at its own angle
        tone: rnd() });
      made++;
    }
  }
  return pts;
}

/** Near-neighbour links, computed ONCE in object space.
 *
 *  The cloud is rigid, so which points are neighbours never changes — only
 *  where they land on screen does. Recomputing O(n²) distances every frame
 *  would burn the whole budget for a set of pairs that is already known.
 *
 *  Budgeted PER LOBE, which is the whole point. A single global cap is spent
 *  entirely by whichever part comes first in the array: the cerebrum took all
 *  1300 pairs and the cerebellum and stem got exactly zero, so they rendered as
 *  loose dots with no structure and read as detached from the mass.
 */
function buildLinks(pts, radius, maxPerPoint, cap) {
  const byKind = new Map();
  pts.forEach((p, i) => {
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(i);
  });

  const links = [];
  for (const group of byKind.values()) {
    // Each lobe's share of the budget matches its share of the points, so link
    // density is even across the whole cloud rather than front-loaded.
    const budget = Math.round(cap * (group.length / pts.length));
    const r2 = radius * radius;
    let made = 0;
    for (let gi = 0; gi < group.length && made < budget; gi++) {
      const a = pts[group[gi]];
      let mine = 0;
      for (let gj = gi + 1; gj < group.length && mine < maxPerPoint; gj++) {
        const b = pts[group[gj]];
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        links.push(group[gi], group[gj]);
        mine++; made++;
      }
    }
  }
  return Uint16Array.from(links);
}

// --------------------------------------------------------------- rendering

/* The reference's spectrum: violet, amber, teal, magenta, blue — saturated,
   never grey. Violet leads because it is the brand accent. */
const PALETTE = [[43, 89, 209], [43, 89, 209], [243, 122, 10],
                 [21, 132, 110], [160, 181, 235], [255, 148, 115]];

/** One outlined triangle, centred on (x, y) with circumradius r. */
function tri(ctx, x, y, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = rot + (i * 2 * Math.PI) / 3 - Math.PI / 2;
    const vx = x + Math.cos(a) * r, vy = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
}

/** The ambient field: scattered triangles drifting across the whole page,
 *  behind everything, at low opacity. Atmosphere, deliberately too quiet to
 *  compete with the constellation — the reference calls for depth, not noise. */
function startAmbient(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  const rnd = rng(77713);
  const dust = Array.from({ length: 90 }, () => ({
    x: rnd(), y: rnd(),                    // fractions of the viewport
    r: 3 + rnd() * 7,
    spin: rnd() * Math.PI * 2,
    drift: (0.1 + rnd() * 0.5) * (rnd() > 0.5 ? 1 : -1),
    rate: 0.05 + rnd() * 0.16,
    tone: rnd(),
    alpha: 0.10 + rnd() * 0.22,
  }));

  let W = 0, H = 0, dpr = 1;
  function layout() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frame(t) {
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1;
    for (const d of dust) {
      const c = PALETTE[(d.tone * PALETTE.length) | 0];
      // Wraps rather than respawning, so the field never thins out or clumps.
      const x = ((d.x + t * d.rate * 0.01 * d.drift) % 1 + 1) % 1;
      const y = ((d.y + t * d.rate * 0.004) % 1 + 1) % 1;
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${d.alpha})`;
      tri(ctx, x * W, y * H, d.r, d.spin + t * d.rate * 0.15);
      ctx.stroke();
    }
  }

  let raf = 0;
  function loop(t) { frame(t / 1000); raf = requestAnimationFrame(loop); }
  layout();
  frame(0);
  if (!reduced.matches) raf = requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf && !reduced.matches) raf = requestAnimationFrame(loop);
  });
  let timer;
  addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { layout(); frame(0); }, 150);
  });
}

function startBrain(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const N = matchMedia('(max-width: 760px)').matches ? 620 : 1250;
  const pts = buildBrain(N);
  const links = buildLinks(pts, 0.125, 3, 3400);

  // Projected positions, reused each frame so the loop allocates nothing.
  const px = new Float32Array(pts.length);
  const py = new Float32Array(pts.length);
  const pd = new Float32Array(pts.length);   // depth scale, 1 = nearest
  const order = new Uint16Array(pts.length);
  for (let i = 0; i < order.length; i++) order[i] = i;

  let W = 0, H = 0, dpr = 1, scale = 1, cx = 0, cy = 0;
  const TILT = -0.18;                        // a fixed nod, so it never reads flat
  const FOV = 3.1;

  // Pointer parallax: the cloud leans towards the cursor. Targets are eased
  // towards rather than set, so a fast flick glides instead of snapping.
  let tiltX = 0, tiltY = 0, aimX = 0, aimY = 0, lift = 0;
  addEventListener('pointermove', (e) => {
    aimX = (e.clientX / innerWidth - 0.5) * 0.34;
    aimY = (e.clientY / innerHeight - 0.5) * 0.20;
  }, { passive: true });
  addEventListener('scroll', () => {
    // Drifts upward as the hero leaves, so the page has depth on scroll.
    lift = Math.min(1, scrollY / Math.max(1, innerHeight)) * 0.22;
  }, { passive: true });

  function layout() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    dpr = Math.min(devicePixelRatio || 1, 2);   // 3x costs frames and buys nothing
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = Math.min(W * 0.44, H * 0.58);
    cx = W / 2;
    cy = H / 2 + scale * 0.12;   // the mass sits above the origin; drop it back
    return true;
  }

  function project(time, spin) {
    // A slow swell, well under a percent, so it is felt rather than seen.
    const puff = 1 + Math.sin(time * 0.42) * 0.012;
    tiltX += (aimX - tiltX) * 0.06;
    tiltY += (aimY - tiltY) * 0.06;
    const sinY = Math.sin(spin + tiltX), cosY = Math.cos(spin + tiltX);
    const tilt = TILT + tiltY;
    const sinT = Math.sin(tilt), cosT = Math.cos(tilt);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const wobble = Math.sin(time * p.speed + p.phase) * p.amp;
      const x0 = p.x + wobble, y0 = p.y + wobble * 0.7, z0 = p.z;

      // yaw about the vertical axis, then a fixed tilt about the horizontal
      const x1 = x0 * cosY + z0 * sinY;
      const z1 = z0 * cosY - x0 * sinY;
      const y2 = y0 * cosT - z1 * sinT;
      const z2 = z1 * cosT + y0 * sinT;

      const s = FOV / (FOV + z2);          // perspective divide
      px[i] = cx + x1 * s * scale * puff;
      py[i] = cy - y2 * s * scale * puff - lift * scale;
      pd[i] = s;
    }
    // Painter's algorithm: far points first, so near ones overlap them.
    // Insertion sort — the order barely changes between frames, so this is
    // near-linear in practice and beats a full sort every time.
    for (let i = 1; i < order.length; i++) {
      const v = order[i], key = pd[v];
      let j = i - 1;
      while (j >= 0 && pd[order[j]] > key) { order[j + 1] = order[j]; j--; }
      order[j + 1] = v;
    }
  }

  function frame(time, spin) {
    project(time, spin);
    ctx.clearRect(0, 0, W, H);

    // Links behind the points, faded by depth so the far side of the cloud
    // recedes instead of tangling with the near side.
    ctx.lineWidth = 0.55;
    for (let k = 0; k < links.length; k += 2) {
      const a = links[k], b = links[k + 1];
      const depth = (pd[a] + pd[b]) * 0.5;
      const alpha = Math.max(0, (depth - 0.72) * 1.0) * 0.6;
      if (alpha < 0.012) continue;
      ctx.strokeStyle = `rgba(121,119,118,${alpha.toFixed(3)})`;   // smoke wires
      ctx.beginPath();
      ctx.moveTo(px[a], py[a]);
      ctx.lineTo(px[b], py[b]);
      ctx.stroke();
    }

    // Signals in flight, drawn over the wires they run along.
    for (const q of sig) {
      const a = links[q.link], b = links[q.link + 1];
      if (a === undefined) continue;
      const t = q.t < 1 ? q.t : 1;
      const x = px[a] + (px[b] - px[a]) * t;
      const y = py[a] + (py[b] - py[a]) * t;
      const near = (pd[a] + pd[b]) * 0.5;
      if (near < 0.74) continue;                 // hidden round the back
      const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
      // Dark-core signals: a white core vanished the moment the canvas went
      // parchment. Lake blue reads on both.
      g.addColorStop(0, 'rgba(43,89,209,.95)');
      g.addColorStop(0.35, 'rgba(43,89,209,.45)');
      g.addColorStop(1, 'rgba(43,89,209,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Outlined triangles, 1px stroke — the reference is specific about the
    // glyph, and an outline reads as lighter than a disc at the same size, so
    // a dense cloud stays airy instead of turning into a solid mass.
    ctx.lineWidth = 1;
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      const depth = pd[i];
      const c = PALETTE[(pts[i].tone * PALETTE.length) | 0];
      const hot = flare[i];
      const alpha = Math.min(1, Math.max(0.1, (depth - 0.66) * 2.0) + hot * 0.9);
      const size = Math.max(1.4, depth * 3.4 - 1.1) * (1 + hot * 1.5);
      if (hot > 0.02) {
        // A node that just received a signal burns lake blue before settling
        // back to its own colour (white was for the black canvas).
        ctx.strokeStyle = `rgba(43,89,209,${(hot * 0.85).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        tri(ctx, px[i], py[i], size * 1.5, pts[i].spin);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`;
      tri(ctx, px[i], py[i], size, pts[i].spin + hot);
      ctx.stroke();
    }
  }

  /* Signals. Every so often a pulse sets off along a link and lands on the far
   * node, which flares and fades. This is the product, not an effect: a fact
   * being reached, then the ones connected to it. A cloud that only rotates
   * looks like an ornament; one that fires looks like it is thinking. */
  const SIGNALS = 22;
  const sig = Array.from({ length: SIGNALS }, (_, i) => ({
    link: (Math.floor(i * links.length / 2 / SIGNALS) * 2) % Math.max(2, links.length),
    t: i / SIGNALS,                       // spread over the cycle, never in step
    speed: 0.35 + (i % 7) * 0.09,
  }));
  const flare = new Float32Array(pts.length);   // per-node decay, 1 = just hit

  function stepSignals(dt) {
    if (!links.length) return;
    for (const q of sig) {
      q.t += dt * q.speed;
      if (q.t < 1) continue;
      q.t = 0;
      flare[links[q.link + 1]] = 1;             // the far end lights up
      // Continue through the node it landed on where possible, so a pulse
      // travels a path instead of blinking between unrelated pairs.
      const from = links[q.link + 1];
      let next = -1;
      for (let k = 0; k < links.length; k += 2) {
        if (links[k] === from && k !== q.link) { next = k; break; }
      }
      q.link = next >= 0 ? next
        : (Math.floor(q.t * 0 + ((q.link / 2 + 37) % (links.length / 2))) * 2);
      q.speed = 0.35 + ((q.link / 2) % 7) * 0.09;
    }
    for (let i = 0; i < flare.length; i++) {
      if (flare[i] > 0) flare[i] = Math.max(0, flare[i] - dt * 1.5);
    }
  }

  // Rotation is integrated from elapsed time rather than read off the clock,
  // so pausing and resuming does not jump the cloud to a new angle.
  let raf = 0, running = false, spin = 0.5, last = 0, breath = 0;

  function loop(t) {
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 0;
    last = t;
    /* Sweeps rather than spins. A full turn passes through angles where the
     * silhouette stops reading as a brain — head-on it is just a diamond. This
     * oscillates roughly +/-45 degrees either side of the profile, which is the
     * view that carries the shape, and eases at the extremes so it reads as
     * turning to look at something. */
    breath += dt;
    spin = 0.42 + Math.sin(breath * 0.16) * 0.78;
    stepSignals(dt);
    frame(t / 1000, spin);
    raf = requestAnimationFrame(loop);
  }
  function play() {
    if (running || reduced.matches) return;
    running = true; last = 0; raf = requestAnimationFrame(loop);
  }
  function pause() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* Hovering the call to action fires the whole cloud at once. The button and
   * the visual are the same claim — ask it something and the memory lights up
   * — so tying them costs one listener and makes the page feel wired together
   * rather than decorated. */
  const surge = () => {
    if (reduced.matches) return;
    for (let i = 0; i < flare.length; i += 3) flare[i] = 0.85;
  };
  for (const el of document.querySelectorAll('.herocta .btn.primary, .cta')) {
    el.addEventListener('pointerenter', surge);
    el.addEventListener('focus', surge);
  }

  if (!layout()) return;
  frame(0, spin);                  // a still frame even when motion is off
  play();

  // Animating a hero nobody is looking at is pure battery cost.
  new IntersectionObserver(([e]) => (e.isIntersecting ? play() : pause()),
                           { threshold: 0.01 }).observe(canvas);
  document.addEventListener('visibilitychange',
                            () => (document.hidden ? pause() : play()));
  reduced.addEventListener('change', () => { pause(); frame(0, spin); play(); });

  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (layout()) frame(0, spin); }, 150);
  });
}

// ------------------------------------------------------------ text motion

/** Wrap each line of the hero headline so it can rise from behind a mask.
 *
 *  Done in JS rather than markup because the split is presentational: the
 *  heading stays one clean sentence for a screen reader and a crawler, and if
 *  the script never runs the headline simply appears, unmasked. */
function splitHeadline() {
  const h = document.querySelector('.hero h1');
  if (!h || reduced.matches) return;
  const lines = h.innerHTML.split(/<br\s*\/?>/i);
  if (lines.length < 2) return;
  h.innerHTML = lines
    .map((line) => `<span class="lift"><span>${line.trim()}</span></span>`)
    .join('');
}

/** Wrap the words of a heading so they can arrive in sequence.
 *
 *  Whitespace is preserved with a plain space between spans — joining on ''
 *  would run the words together the moment the animation is disabled. */
function splitWords() {
  if (reduced.matches) return;
  for (const el of document.querySelectorAll('[data-words]')) {
    const words = el.textContent.trim().split(/\s+/);
    if (words.length > 40) continue;         // not worth 40 spans
    el.innerHTML = words
      .map((w, i) => `<span class="word" style="transition-delay:${i * 34}ms">${w}</span>`)
      .join(' ');
  }
}

// ---------------------------------------------------------------- reveals

function startReveals() {
  const items = [...document.querySelectorAll('.reveal, [data-words]')];
  if (!items.length) return;
  if (reduced.matches || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  const show = (el) => { el.classList.add('in'); io.unobserve(el); };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) show(e.target);   // once; re-animating on scroll-back nags
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
  items.forEach((el) => io.observe(el));

  // Anything already on screen at load is shown immediately: deep-linking to
  // #how lands past the fold, and a section that arrives already-in-view can
  // otherwise sit at opacity 0.
  requestAnimationFrame(() => {
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) show(el);
    }
  });

  // Last resort. An animation that fails leaves the page BLANK, which is far
  // worse than an animation that does not play, so everything reveals after a
  // few seconds no matter what the observer did.
  setTimeout(() => items.forEach((el) => el.classList.add('in')), 3000);
}

// ------------------------------------------------------------------- copy

/** Copy-to-clipboard on the install command.
 *
 *  The whole section's claim is that setup is one line — making that line
 *  something you have to select by hand undercuts it. Falls back silently
 *  where the Clipboard API is unavailable (it needs a secure context), because
 *  the command is still right there to select. */
function startCopy() {
  for (const btn of document.querySelectorAll('.copy')) {
    btn.addEventListener('click', async () => {
      // Copy whichever pane is showing, not a value frozen onto the button.
      const pane = btn.closest('.term')?.querySelector('.termpane:not([hidden])');
      const text = pane?.dataset.copy || btn.dataset.copy;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied';
        btn.dataset.done = '1';
        setTimeout(() => { btn.textContent = 'Copy'; btn.dataset.done = '0'; }, 1600);
      } catch (e) {
        btn.textContent = 'Select it';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
      }
    });
  }
}

/** Tabs on the setup block. Roving focus and arrow keys, because a tablist
 *  that only answers to the mouse is not a tablist. */
function startTermTabs() {
  for (const bar of document.querySelectorAll('[role="tablist"]')) {
    const tabs = [...bar.querySelectorAll('[role="tab"]')];
    if (!tabs.length) return;
    const select = (tab) => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      }
    };
    tabs.forEach((t, i) => {
      t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1;
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = tabs[(i + step + tabs.length) % tabs.length];
        select(next);
        next.focus();
      });
    });
  }
}

/** Reveal the sticky nav CTA only once the hero's has scrolled away.
 *
 *  Two identical calls to action on screen at once is a choice the reader
 *  should never have to make. Watches the hero button itself rather than a
 *  scroll offset, so it stays right at any viewport height. */
function startStickyCta() {
  const cta = document.querySelector('[data-reveal-cta]');
  const anchor = document.querySelector('.herocta .btn.primary');
  if (!cta) return;
  if (!anchor) { cta.classList.add('on'); return; }
  new IntersectionObserver(([e]) => {
    cta.classList.toggle('on', !e.isIntersecting);
  }, { threshold: 0 }).observe(anchor);
}

// ------------------------------------------------------------- scroll spy

/** Slide the nav indicator to the section currently being read.
 *
 *  Position is measured from the live element rather than hard-coded, so it
 *  stays correct when the labels change or the font falls back to a different
 *  metric. */
function startNavSpy() {
  const nav = document.querySelector('.navlinks');
  const pill = document.querySelector('.navpill');
  if (!nav || !pill) return;
  const links = [...nav.querySelectorAll('a[href^="#"]')];
  const sections = links
    .map((a) => ({ a, el: document.querySelector(a.getAttribute('href')) }))
    .filter((s) => s.el);
  if (!sections.length) return;

  let active = null;
  const move = (a) => {
    if (a === active) return;
    active = a;
    links.forEach((l) => l.removeAttribute('aria-current'));
    if (!a) { pill.classList.remove('on'); return; }
    a.setAttribute('aria-current', 'true');
    pill.style.width = `${a.offsetWidth}px`;
    pill.style.transform = `translateX(${a.offsetLeft - 5}px)`;
    pill.classList.add('on');
  };

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const hit = sections.find((s) => s.el === e.target);
      if (e.isIntersecting && hit) move(hit.a);
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => io.observe(s.el));

  // Above the first section there is nothing to highlight.
  addEventListener('scroll', () => {
    if (scrollY < innerHeight * 0.4) move(null);
  }, { passive: true });

  // A resize changes every offset the indicator was placed from.
  addEventListener('resize', () => { const a = active; active = null; move(a); });
}

// ------------------------------------------------------------------- boot

const canvas = document.getElementById('brain');
if (canvas) {
  try { startBrain(canvas); }
  catch (e) { canvas.remove(); }   // the page reads fine without it
}
const ambient = document.getElementById('ambient');
if (ambient) {
  try { startAmbient(ambient); }
  catch (e) { ambient.remove(); }
}
splitHeadline();
splitWords();
startReveals();
startNavSpy();
startCopy();
startTermTabs();
startStickyCta();

// Sign-in state and the "Open OneBrain" swap live in index.html's module script,
// next to the Supabase client that knows whether there is a session.
