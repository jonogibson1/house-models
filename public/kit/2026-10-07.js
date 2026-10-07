/* House model builder, after arch-model-print-kit (github.com/jonogibson1/arch-model-print-kit).

   One white piece that fits the H2S plate and prints with supports off:
     building = union(solids) - union(voids), then + extras
     model    = building + plate + plinth band + labels + fences + site pads
   Everything is built in METRES, ground floor = plate top = z 0, then scaled to millimetres once at the end.
   Booleans run in manifold-3d (WASM), so every result is a closed, valid solid.

   Rules carried over from the kit:
   - largest standard scale where the model fits with 10 mm clear; one piece, no plates
   - recesses get a 45 degree soffit rising from the back wall; eaves get a 45 degree soffit from the wall line
   - fences and free-standing walls at least 1.6 mm, relief at least 0.4 mm deep, text cap height at least 3 mm
   - no trees or vegetation; planting beds as low raised pads; ground surfaces only where the plans show them */

let M = null;                       // the manifold module once loaded
const BED = { x: 340, y: 320, z: 340 }, MARGIN = 10;
const SCALES = [100, 150, 200, 250, 300];
const EPS = 0.2;                    // how far voids poke out past a face, metres

/* Bump with every change to this file, and save a copy as kit/<VERSION>.js (see KIT_VERSION in src/worker.js). */
export const VERSION = '2026-10-07';
export async function load(base) {
  if (M) return M;
  const mod = (await import((base || '') + '/vendor/manifold.js')).default;
  M = await mod({ locateFile: (f) => (base || '') + '/vendor/' + f });
  M.setup();
  return M;
}
export function ready() { return !!M; }
export function useModule(m) { M = m; M.setup(); }

/* ---------------------------------------------------------------- helpers */
function track(list, m) { list.push(m); return m; }
const mm = (v, S) => v * S / 1000;          // model millimetres to metres at scale S

function box(T, x0, y0, z0, x1, y1, z1) {
  const w = x1 - x0, d = y1 - y0, h = z1 - z0;
  if (w <= 1e-6 || d <= 1e-6 || h <= 1e-6) return null;
  return track(T, M.Manifold.cube([w, d, h]).translate([x0, y0, z0]));
}
function hull(T, pts) { return track(T, M.Manifold.hull(pts)); }
function unionAll(T, list) {
  const l = list.filter(Boolean);
  if (!l.length) return null;
  if (l.length === 1) return l[0];
  return track(T, M.Manifold.union(l));
}
function prism2d(T, polys, z0, z1) {
  const cs = track(T, new M.CrossSection(polys, 'NonZero'));
  if (cs.isEmpty()) return null;
  return track(T, cs.extrude(z1 - z0).translate([0, 0, z0]));
}
/* A straight wall or fence between two points, square ends, given thickness. */
function lineWall(T, x1, y1, x2, y2, t, z0, z1) {
  const L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.05) return null;
  const nx = -(y2 - y1) / L * t / 2, ny = (x2 - x1) / L * t / 2;
  return prism2d(T, [[[x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x2 - nx, y2 - ny], [x2 + nx, y2 + ny]]], z0, z1);
}

/* Cuts start this far in front of the wall face so they also pass through proud render panels. */
const FRONT = 0.07;
/* Facade frame: a face is (side, c) with c the face coordinate (y for n/s, x for e/w). Along-face u is x for n/s, y for e/w. */
function frame(side, c) {
  const ns = side === 'n' || side === 's';
  const n = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] }[side];
  return { pt: (u, t) => (ns ? [u + n[0] * t, c + n[1] * t] : [c + n[0] * t, u + n[1] * t]) };
}
/* Void cut into a face between a..b along it and z0..z1, with a 45 degree soffit rising from the back wall. */
function recess(T, side, c, a, b, z0, z1, depth) {
  const f = frame(side, c); depth = Math.min(depth, z1 - z0 - 0.05);
  const p = [];
  for (const s of [a, b]) {
    const fr = f.pt(s, FRONT), bk = f.pt(s, -depth);
    p.push([fr[0], fr[1], z0], [fr[0], fr[1], z1 + EPS], [bk[0], bk[1], z0], [bk[0], bk[1], z1 - depth]);
  }
  return hull(T, p);
}
/* Box on a face: u in [a,b], z in [z0,z1], offset t0..t1 along the outward normal (negative is into the wall). */
function faceBox(T, side, c, a, b, z0, z1, t0, t1) {
  const f = frame(side, c), q = [f.pt(a, t0), f.pt(b, t0), f.pt(b, t1), f.pt(a, t1)];
  return hull(T, q.flatMap((v) => [[v[0], v[1], z0], [v[0], v[1], z1]]));
}
/* Horizontal groove with a 45 degree top, for weatherboards. */
function hGroove(T, side, c, a, b, z, h, depth) {
  const f = frame(side, c), p = [];
  for (const s of [a, b]) {
    const fr = f.pt(s, FRONT), bk = f.pt(s, -depth);
    p.push([fr[0], fr[1], z], [fr[0], fr[1], z + h], [bk[0], bk[1], z], [bk[0], bk[1], z + h - depth]);
  }
  return hull(T, p);
}

/* ---------------------------------------------------------------- text
   Text comes in as filled pixel runs from a canvas (browser) or the built-in block font (anywhere else),
   turned into one 2D region and extruded. Cap height in metres. Returns polygons in metres, centred on (cx, cy). */
const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31], M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17], Y: [17, 17, 17, 10, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31], 0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14],
  9: [14, 17, 17, 15, 1, 2, 12], ',': [0, 0, 0, 0, 12, 4, 8], '.': [0, 0, 0, 0, 0, 12, 12], ':': [0, 12, 12, 0, 12, 12, 0], '-': [0, 0, 0, 31, 0, 0, 0],
  '/': [1, 1, 2, 4, 8, 16, 16], "'": [12, 4, 8, 0, 0, 0, 0], '&': [12, 18, 20, 8, 21, 18, 13], '#': [10, 10, 31, 10, 31, 10, 10], '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8] };
function blockRuns(s) {
  const rows = [], W = s.length * 6;
  for (let r = 0; r < 7; r++) {
    const runs = [];
    [...String(s).toUpperCase()].forEach((ch, i) => { const g = FONT[ch]; if (!g) return; for (let c = 0; c < 5; c++) if (g[r] & (16 >> c)) runs.push([i * 6 + c, i * 6 + c + 1]); });
    rows.push(runs);
  }
  return { rows, w: W - 1, h: 7, cap: 7 };
}
let canvasRuns = null;               // set by the page: (text) => { rows: [[x0,x1],...] per row top first, w, h, cap }
export function setTextRaster(fn) { canvasRuns = fn; }
function textPolys(s, cap, cx, cy, maxW) {
  const r = (canvasRuns && canvasRuns(s)) || blockRuns(s);
  let k = cap / r.cap;
  if (maxW && r.w * k > maxW) k = maxW / r.w;
  const polys = [], x0 = cx - r.w * k / 2, y0 = cy - r.h * k / 2;
  r.rows.forEach((runs, i) => {
    const yt = y0 + (r.h - i) * k, yb = yt - k;
    // each run grows a little so pixels that only touch at a corner overlap and merge cleanly
    const g = k * 0.06;
    runs.forEach(([a, b]) => { const xa = x0 + a * k - g, xb = x0 + b * k + g; polys.push([[xa, yb - g], [xb, yb - g], [xb, yt + g], [xa, yt + g]]); });
  });
  return { polys, w: r.w * k, h: r.h * k };
}

/* ---------------------------------------------------------------- scale */
function extentOf(params, withSite) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of params.blocks) { const e = +b.eave || 0; x0 = Math.min(x0, b.x - e); y0 = Math.min(y0, b.y - e); x1 = Math.max(x1, b.x + b.w + e); y1 = Math.max(y1, b.y + b.d + e); }
  return { x0, y0, x1, y1 };
}
/* Largest standard scale where the house, a little ground round it and the plinth band fit with 10 mm clear. */
export function pickScale(params, ornament) {
  const e = extentOf(params);
  if (ornament) {
    for (const S of [200, 250, 300, 350, 400, 450, 500, 600, 750, 1000]) if (Math.max(e.x1 - e.x0, e.y1 - e.y0) * 1000 / S <= 75) return S;
    return 1000;
  }
  const X = BED.x - 2 * MARGIN, Y = BED.y - 2 * MARGIN;
  for (const S of SCALES) {
    const w = (e.x1 - e.x0 + 2) * 1000 / S, d = (e.y1 - e.y0 + 2) * 1000 / S + BAND_MM;
    if ((w <= X && d <= Y) || (w <= Y && d <= X)) return S;
  }
  return 300;
}
const BAND_MM = 26, PLATE_MM = 3;

/* ---------------------------------------------------------------- build */
export function build(params, opts) {
  if (!M) throw new Error('model library not loaded');
  opts = opts || {};
  const T = [], orn = !!params.ornament;
  const S = orn ? pickScale(params, true) : (params.scale && params.scale !== 'auto' ? +params.scale : pickScale(params));
  const k = (v) => mm(v, S);                      // millimetres on the print to metres
  const blocks = params.blocks.filter((b) => b && b.w > 0 && b.d > 0 && !(orn && b.open));
  const solids = [], voids = [], extras = [], flags = [];
  const closed = blocks.filter((b) => !b.open);
  const inside = (x, y) => closed.some((b) => x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.d);

  // a porch or entry whose roof is the continuation of a house block's roof: that block's roof spans both
  const byName = (n) => closed.find((c) => c.name === n);
  const covered = (x, y) => inside(x, y) || blocks.some((o) => o.open && x > o.x - 1e-6 && x < o.x + o.w + 1e-6 && y > o.y - 1e-6 && y < o.y + o.d + 1e-6);
  for (const b of blocks) {
    b._roof = { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.d, own: true };
    delete b._under;
  }
  const touches = (a, o) => a.x <= o.x + o.w + 0.05 && o.x <= a.x + a.w + 0.05 && a.y <= o.y + o.d + 0.05 && o.y <= a.y + a.d + 0.05;
  for (const o of blocks) {
    if (!o.open || !o.roofWith) continue;
    // the named block first, then any block it adjoins: the first whose roof can widen over the porch without roofing open ground
    const named = byName(o.roofWith), cands = [named, ...closed.filter((c) => c !== named && touches(c, o)).sort((p, q) => p.w * p.d - q.w * q.d)].filter(Boolean);
    for (const h of cands) {
      const r = h._roof, R = { x0: Math.min(r.x0, o.x), y0: Math.min(r.y0, o.y), x1: Math.max(r.x1, o.x + o.w), y1: Math.max(r.y1, o.y + o.d), own: true };
      let ok = true;
      for (let i = 0; i <= 16 && ok; i++) for (let j = 0; j <= 16 && ok; j++) {
        const x = R.x0 + 0.02 + (R.x1 - R.x0 - 0.04) * i / 16, y = R.y0 + 0.02 + (R.y1 - R.y0 - 0.04) * j / 16;
        if (!covered(x, y)) ok = false;
      }
      if (ok) { h._roof = R; o._under = true; break; }
    }
  }

  // ---------- massing: walls and roofs
  for (const b of blocks) {
    const st = Math.max(1, Math.min(3, Math.round(+b.storeys || 1))), sH = Math.max(2, +b.storeyH || 2.7), H = st * sH;
    const e = Math.max(0, +b.eave || 0), f = Math.max(k(0.8), 0.15), tan = Math.tan(Math.max(0, Math.min(60, +b.pitch || 22.5)) * Math.PI / 180);
    const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.d;
    const R = b._roof, rx0 = R.x0, ry0 = R.y0, rx1 = R.x1, ry1 = R.y1;
    const ex0 = rx0 - e, ey0 = ry0 - e, ex1 = rx1 + e, ey1 = ry1 + e, W = ex1 - ex0, D = ey1 - ey0;
    b._H = H; b._sH = sH;
    if (!b.open) solids.push(box(T, x0, y0, -0.05, x1, y1, H));
    else {
      // open alfresco, porch or carport: a post at each corner that is not inside the house
      // posts and piers where the plans draw them, otherwise one at each free corner
      const p = Math.max(k(1.8), +b.post || 0.1), ps = Array.isArray(b.posts) ? b.posts.filter((q) => q && +q.w > 0 && +q.d > 0) : [];
      const list = ps.length ? ps.map((q) => [+q.x, +q.y, Math.max(k(1.8), +q.w), Math.max(k(1.8), +q.d)]) : [[x0, y0, p, p], [x1 - p, y0, p, p], [x1 - p, y1 - p, p, p], [x0, y1 - p, p, p]];
      for (const [px, py, pw, pd] of list) if (!inside(px + pw / 2, py + pd / 2)) solids.push(box(T, px, py, -0.05, px + pw, py + pd, H + 0.02));
      if (b._under) continue;   // roofed by the house block it belongs to
    }
    // roof as a convex hull: eave outline, fascia, ridge; closed blocks also carry a 45 degree soffit from the wall line
    const pts = [];
    const ring = (z, a0, b0, a1, b1) => { pts.push([a0, b0, z], [a1, b0, z], [a1, b1, z], [a0, b1, z]); };
    const soffit = b.open ? 0 : Math.min(e, H - 0.3);
    if (soffit > 0) ring(H - soffit, rx0, ry0, rx1, ry1);
    ring(H, ex0, ey0, ex1, ey1); ring(H + f, ex0, ey0, ex1, ey1);
    const roof = b.roof || 'hip', top = H + f;
    if (roof === 'hip') {
      const m = Math.min(W, D) / 2, z = top + tan * m;
      if (W >= D) pts.push([ex0 + m, ey0 + m, z], [ex1 - m, ey0 + m, z]); else pts.push([ex0 + m, ey0 + m, z], [ex0 + m, ey1 - m, z]);
    } else if (roof === 'gable') {
      const ew = b.ridge === 'ew' || (b.ridge !== 'ns' && W >= D);
      if (ew) { const z = top + tan * D / 2; pts.push([ex0, ey0 + D / 2, z], [ex1, ey0 + D / 2, z]); }
      else { const z = top + tan * W / 2; pts.push([ex0 + W / 2, ey0, z], [ex0 + W / 2, ey1, z]); }
    } else if (roof === 'skillion') {
      const hi = b.high || 'n', span = hi === 'n' || hi === 's' ? D : W, z = top + tan * span;
      if (hi === 'n') pts.push([ex0, ey1, z], [ex1, ey1, z]); else if (hi === 's') pts.push([ex0, ey0, z], [ex1, ey0, z]);
      else if (hi === 'e') pts.push([ex1, ey0, z], [ex1, ey1, z]); else pts.push([ex0, ey0, z], [ex0, ey1, z]);
    }
    solids.push(hull(T, pts));
  }

  // ---------- facades: openings, frames and cladding
  let nOpen = 0, nGroove = 0;
  const panels = [];
  const faceOut = (b, side, a, bb) => {
    // a and bb run along the wall from the block's corner; test in house coordinates
    const o = EPS + 0.1, u0 = side === 's' || side === 'n' ? b.x : b.y, test = [u0 + a + 0.05, u0 + (a + bb) / 2, u0 + bb - 0.05];
    return !test.some((u) => side === 's' ? inside(u, b.y - o) : side === 'n' ? inside(u, b.y + b.d + o) : side === 'w' ? inside(b.x - o, u) : inside(b.x + b.w + o, u));
  };
  const faceC = (b, side) => (side === 's' ? b.y : side === 'n' ? b.y + b.d : side === 'w' ? b.x : b.x + b.w);
  const along0 = (b, side) => (side === 's' || side === 'n' ? b.x : b.y);
  const sideLen = (b, side) => (side === 's' || side === 'n' ? b.w : b.d);
  if (!orn) for (const b of closed) {
    for (const o of b.openings || []) {
      if (!['n', 's', 'e', 'w'].includes(o.side)) continue;
      const len = sideLen(b, o.side), a = Math.max(0.15, +o.at || 0), bb = Math.min(len - 0.15, (+o.at || 0) + (+o.w || 0));
      if (bb - a < 0.3) continue;
      const base = ((Math.round(+o.storey || 1)) - 1) * b._sH, z0 = base + (o.kind === 'window' ? Math.max(0.3, +o.sill || 0) : 0.02), z1 = Math.min(base + b._sH - 0.15, base + (+o.head || 2.1));
      if (z1 - z0 < 0.4 || !faceOut(b, o.side, a, bb)) continue;
      const c = faceC(b, o.side), u0 = along0(b, o.side) + a, u1 = along0(b, o.side) + bb;
      const depth = Math.max(k(1.6), o.kind === 'garage' ? 0.15 : 0.22);
      voids.push(recess(T, o.side, c, u0, u1, z0, z1, depth));
      const fr = Math.max(k(1.0), 0.08), proud = Math.max(k(0.6), 0.06);
      if (o.kind === 'window') {
        // a proud frame round the window: jambs, head and sill
        extras.push(faceBox(T, o.side, c, u0 - fr, u0, z0 - fr, z1 + fr, -0.02, proud), faceBox(T, o.side, c, u1, u1 + fr, z0 - fr, z1 + fr, -0.02, proud),
          faceBox(T, o.side, c, u0 - fr, u1 + fr, z1, z1 + fr, -0.02, proud), faceBox(T, o.side, c, u0 - fr, u1 + fr, z0 - fr, z0, -0.02, proud * 1.5));
      } else if (o.kind === 'door') {
        if (bb - a > 1.6) extras.push(faceBox(T, o.side, c, (u0 + u1) / 2 - Math.max(k(1), 0.06), (u0 + u1) / 2 + Math.max(k(1), 0.06), z0, z1, -depth - 0.02, 0));   // sliding door mullion
        extras.push(faceBox(T, o.side, c, u0 - fr, u1 + fr, z1, z1 + fr, -0.02, proud));
      } else {
        // garage door: panel lines as shallow horizontal grooves at the back of the recess
        for (let z = z0 + 0.5; z < z1 - 0.2; z += 0.5) voids.push(hGroove(T, o.side, faceC(b, o.side) + 0, u0 + 0.1, u1 - 0.1, z, Math.max(k(0.8), 0.06), depth + Math.max(k(0.4), 0.04)));
      }
      nOpen++;
    }
    // board areas on each face, so a render panel listed over a whole wall leaves them showing
    const boards = {};
    for (const z of b.cladding || []) {
      if (!['weatherboard', 'vertical'].includes(z.kind) || !['n', 's', 'e', 'w'].includes(z.side)) continue;
      const len = sideLen(b, z.side), a = Math.max(0, +z.at || 0), bb = Math.min(len, (+z.at || 0) + (z.w == null ? 99 : +z.w));
      if (bb - a < 0.3) continue;
      (boards[z.side] = boards[z.side] || []).push(faceBox(T, z.side, faceC(b, z.side), along0(b, z.side) + a, along0(b, z.side) + bb, Math.max(0, +z.z0 || 0), Math.min(b._H, z.z1 == null ? 99 : +z.z1), -0.01, 0.2));
    }
    for (const z of b.cladding || []) {
      if (!['n', 's', 'e', 'w'].includes(z.side)) continue;
      const len = sideLen(b, z.side), a = Math.max(0, +z.at || 0), bb = Math.min(len, (+z.at || 0) + (z.w == null ? 99 : +z.w));
      if (bb - a < 0.3 || !faceOut(b, z.side, a, bb)) continue;
      const c = faceC(b, z.side), u0 = along0(b, z.side) + a, u1 = along0(b, z.side) + bb;
      const z0 = Math.max(0, +z.z0 || 0), z1 = Math.min(b._H, z.z1 == null ? 99 : +z.z1);
      const gd = Math.max(k(0.4), 0.04);
      if (z.kind === 'weatherboard') {
        const pitch = Math.max(k(2.0), +z.board || 0.18), gh = Math.max(k(0.6), 0.05);
        for (let zz = z0 + pitch; zz + gh < z1; zz += pitch) { voids.push(hGroove(T, z.side, c, u0, u1, zz, gh, gd)); nGroove++; }
      } else if (z.kind === 'vertical') {
        const pitch = Math.max(k(1.6), +z.board || 0.15), gw = Math.max(k(0.5), 0.05);
        for (let u = u0 + pitch / 2; u + gw < u1; u += pitch) { voids.push(faceBox(T, z.side, c, u, u + gw, z0, z1, -gd, EPS)); nGroove++; }
      } else if (z.kind === 'render' || z.kind === 'stone') {
        // a render or stone panel stands slightly proud of the brickwork so it reads in white
        let panel = faceBox(T, z.side, c, u0, u1, z0, z1, -0.02, Math.max(k(0.4), 0.04));
        const cut = boards[z.side] ? unionAll(T, boards[z.side]) : null;
        if (cut) panel = track(T, panel.subtract(cut));
        panels.push(panel);
      }
    }
  }

  // ---------- the building
  let building = unionAll(T, solids.concat(panels));
  const vu = unionAll(T, voids);
  if (vu) building = track(T, building.subtract(vu));
  const xu = unionAll(T, extras);
  if (xu) building = track(T, building.add(xu));

  // ---------- Christmas tree version: ribbon hole, no plate
  if (orn) {
    const e = extentOf({ blocks: closed });
    let cx = 0, cy = 0, A = 0;
    for (const b of closed) { const a = b.w * b.d; A += a; cx += a * (b.x + b.w / 2); cy += a * (b.y + b.d / 2); }
    cx /= A; cy /= A;
    if (!inside(cx, cy)) { const big = closed.slice().sort((p, q) => q.w * q.d - p.w * p.d)[0]; cx = big.x + big.w / 2; cy = big.y + big.d / 2; }
    const r = k(1.6);
    const hole = box(T, cx - r, cy - r, -1, cx + r, cy + r, 100);
    building = track(T, building.subtract(hole));
    flags.push({ lvl: 'ok', text: 'Christmas tree version at 1:' + S + ', with a 3.2 mm hole down through roof and walls for a ribbon knotted underneath.' });
    return finish(T, building, S, flags, { openings: 0, site: false, ornament: true, extent: e });
  }

  // ---------- site: plate, plinth band, kerb, pads, fences, fixtures
  const site = params.site && +params.site.w > 0 && +params.site.d > 0 ? params.site : null;
  const hx = site ? +site.houseX || 0 : 0, hy = site ? +site.houseY || 0 : 0;   // house frame to lot frame
  const ext = extentOf({ blocks });
  const X = (BED.x - 2 * MARGIN) * S / 1000, Y = (BED.y - 2 * MARGIN) * S / 1000, band = k(BAND_MM);
  // plate rectangle in house-frame metres
  let px0, py0, px1, py1;
  if (site) { px0 = -hx; py0 = -hy; px1 = px0 + +site.w; py1 = py0 + +site.d; }
  else { px0 = ext.x0 - 1; py0 = ext.y0 - 1; px1 = ext.x1 + 1; py1 = ext.y1 + 1; }
  px0 = Math.min(px0, ext.x0 - 0.3); py0 = Math.min(py0, ext.y0 - 0.3); px1 = Math.max(px1, ext.x1 + 0.3); py1 = Math.max(py1, ext.y1 + 0.3);
  const fitW = X, fitD = Y - band;                // the band runs along the south edge
  if (px1 - px0 > fitW) { const mid = (ext.x0 + ext.x1) / 2; px0 = Math.max(px0, Math.min(mid - fitW / 2, px1 - fitW)); px1 = px0 + fitW; }
  if (py1 - py0 > fitD) { const mid = (ext.y0 + ext.y1) / 2; py0 = Math.max(py0, Math.min(mid - fitD / 2, py1 - fitD)); py1 = py0 + fitD; }
  const cropped = site && (px0 > -hx + 0.01 || py0 > -hy + 0.01 || px1 < -hx + +site.w - 0.01 || py1 < -hy + +site.d - 0.01);
  const plate = k(PLATE_MM), surf = [];
  surf.push(box(T, px0, py0 - band, -plate, px1, py1, 0));
  const lot = (x, y) => [x - hx, y - hy];        // lot frame to house frame
  const OV = 0.013;   // overlap so touching pieces merge into one solid instead of meeting along a shared face
  const clipRect = (x0, y0, x1, y1) => [Math.max(px0 + OV, x0 - OV), Math.max(py0 + OV, y0 - OV), Math.min(px1 - OV, x1 + OV), Math.min(py1 - OV, y1 + OV)];
  let nItems = 0;
  if (site) {
    // boundary kerb
    const kb = Math.max(k(1.2), 0.12), kh = Math.max(k(0.6), 0.06), L0 = lot(0, 0), L1 = lot(+site.w, +site.d);
    for (const [a, b2, c, d] of [[L0[0], L0[1], L1[0], L0[1]], [L1[0], L0[1], L1[0], L1[1]], [L1[0], L1[1], L0[0], L1[1]], [L0[0], L1[1], L0[0], L0[1]]]) {
      const r = clipRect(Math.min(a, c) - kb / 2, Math.min(b2, d) - kb / 2, Math.max(a, c) + kb / 2, Math.max(b2, d) + kb / 2);
      if (r[2] - r[0] > 0.05 && r[3] - r[1] > 0.05 && (Math.abs(a - c) < 1e-6 ? a >= px0 - 1e-6 && a <= px1 + 1e-6 : b2 >= py0 - 1e-6 && b2 <= py1 + 1e-6)) surf.push(box(T, r[0], r[1], -0.01, r[2], r[3], kh));
    }
    const PAD = { driveway: 0.05, path: 0.05, concrete: 0.05, paving: 0.05, pebbles: 0.05, gravel: 0.05, deck: 0.1, garden: 0.1, mulch: 0.1 };
    const fenceT = Math.max(k(1.6), 0.1);
    for (const it of site.items || []) {
      if (it.kind in PAD) {
        const p0 = lot(+it.x, +it.y), r = clipRect(p0[0], p0[1], p0[0] + +it.w, p0[1] + +it.d);
        if (r[2] - r[0] > 0.2 && r[3] - r[1] > 0.2) { surf.push(box(T, r[0], r[1], -0.01, r[2], r[3], Math.max(k(0.4), PAD[it.kind]))); nItems++; }
      } else if (it.kind === 'pool') {
        const p0 = lot(+it.x, +it.y), r = clipRect(p0[0], p0[1], p0[0] + +it.w, p0[1] + +it.d);
        if (r[2] - r[0] > 0.3 && r[3] - r[1] > 0.3) { it._cut = box(T, r[0], r[1], -Math.min(plate * 0.6, 0.15), r[2], r[3], 0.5); nItems++; }
      } else if (it.kind === 'fence' || it.kind === 'retaining' || it.kind === 'wall') {
        const a = lot(+it.x1, +it.y1), c = lot(+it.x2, +it.y2);
        const g2 = fenceT / 2 + 0.037, cl = (p) => [Math.max(px0 + g2, Math.min(px1 - g2, p[0])), Math.max(py0 + g2, Math.min(py1 - g2, p[1]))];
        const A2 = cl(a), C2 = cl(c), L = Math.hypot(C2[0] - A2[0], C2[1] - A2[1]) || 1, ex = (fenceT / 2) / L;
        const A3 = [A2[0] - (C2[0] - A2[0]) * ex, A2[1] - (C2[1] - A2[1]) * ex], C3 = [C2[0] + (C2[0] - A2[0]) * ex, C2[1] + (C2[1] - A2[1]) * ex];
        surf.push(lineWall(T, A3[0], A3[1], C3[0], C3[1], Math.max(fenceT, +it.t || 0), -0.05, Math.max(k(1.5), +it.h || 1.8))); nItems++;
      } else if (it.kind === 'box') {
        const p0 = lot(+it.x, +it.y), w = Math.max(k(1.6), +it.w || 0.5), d = Math.max(k(1.6), +it.d || 0.5);
        if (p0[0] >= px0 && p0[1] >= py0 && p0[0] + w <= px1 && p0[1] + d <= py1) { surf.push(box(T, p0[0], p0[1], -0.01, p0[0] + w, p0[1] + d, Math.max(k(1.6), +it.h || 1))); nItems++; }
      }
    }
  }

  // ---------- plinth band: address, scale and a north point, embossed to read from the south edge
  const emb = Math.max(k(0.6), 0.05), bcy = py0 - band / 2, title = String(params.title || '').replace(/\s+/g, ' ').trim().toUpperCase();
  const arrowR = band * 0.32, ax = px1 - band * 0.55, textW = (px1 - px0) - band * 1.4;
  const tx = px0 + band * 0.2 + textW / 2, lines = [];
  if (title) lines.push(textPolys(title, k(6), tx, bcy + band * 0.17, textW));
  lines.push(textPolys('SCALE 1:' + S + (site ? '   LOT ' + (+site.w).toFixed(1) + ' X ' + (+site.d).toFixed(1) + ' M' : ''), k(4), tx, title ? bcy - band * 0.24 : bcy, textW));
  const tpolys = lines.flatMap((l) => l.polys);
  if (tpolys.length) surf.push(prism2d(T, tpolys, -0.01, emb));
  const nd = (+(site ? site.north : params.north) || 0) * Math.PI / 180, ux = Math.sin(nd), uy = Math.cos(nd), vx = uy, vy = -ux;
  const P = (s, t) => [ax + ux * s * arrowR + vx * t * arrowR, bcy + uy * s * arrowR + vy * t * arrowR];
  surf.push(prism2d(T, [[P(1, 0), P(-0.75, 0.55), P(-0.35, 0), P(-0.75, -0.55)]], -0.01, emb));
  const ring = [], ring2 = [], R1 = arrowR * 1.35, R2 = arrowR * 1.35 - Math.max(k(0.8), 0.06);
  for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; ring.push([ax + R1 * Math.cos(a), bcy + R1 * Math.sin(a)]); ring2.unshift([ax + R2 * Math.cos(a), bcy + R2 * Math.sin(a)]); }
  surf.push(prism2d(T, [ring, ring2], -0.01, emb));
  // the N sits just outside the ring, upright
  surf.push(prism2d(T, textPolys('N', k(3.2), ax - R1 - k(2.6), bcy, null).polys, -0.01, emb));

  let model = unionAll(T, [building, ...surf.filter(Boolean)]);
  for (const it of (site && site.items) || []) if (it._cut) { model = track(T, model.subtract(it._cut)); delete it._cut; }

  if (site) flags.push({ lvl: 'ok', text: 'Lot ' + (+site.w).toFixed(1) + ' x ' + (+site.d).toFixed(1) + ' m on a 3 mm plate' + (cropped ? ', cropped to fit the printer' : '') + ', with ' + nItems + ' site items from the plans.' });
  if (nOpen) flags.push({ lvl: 'ok', text: nOpen + ' windows and doors as recesses with 45 degree soffits; windows have proud frames.' });
  if (nGroove) flags.push({ lvl: 'ok', text: 'Cladding drawn as ' + nGroove + ' grooves, 0.4 mm deep or more.' });
  flags.push({ lvl: 'ok', text: 'Eaves have a 45 degree soffit from the wall line, so the roof prints on the walls in one piece.' });
  flags.push({ lvl: 'ok', text: 'Plinth band with the address, scale and a north point, embossed.' });
  return finish(T, model, S, flags, { openings: nOpen, site: !!site, ornament: false });
}

/* Scale to millimetres, put the minimum corner at the origin, measure, and free the WASM objects. */
function finish(T, m, S, flags, info) {
  const s = 1000 / S;
  const scaled = m.scale([s, s, s]);
  const bb = scaled.boundingBox();
  const out = scaled.translate([-bb.min[0], -bb.min[1], -bb.min[2]]);
  const mesh = out.getMesh(), n = mesh.numProp, vp = mesh.vertProperties, tv = mesh.triVerts;
  const tris = new Float32Array(tv.length * 3);
  for (let i = 0; i < tv.length; i++) { const v = tv[i] * n; tris[i * 3] = vp[v]; tris[i * 3 + 1] = vp[v + 1]; tris[i * 3 + 2] = vp[v + 2]; }
  const vol = out.volume(), area = out.surfaceArea(), status = out.status();
  const size = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
  for (const x of T) { try { x.delete(); } catch (e) { /* already freed */ } }
  scaled.delete(); out.delete();
  const shell = Math.min(vol, area * 0.9), grams = 1.24e-3 * (shell + 0.12 * (vol - shell));
  const X = BED.x - 2 * MARGIN + 0.5, Y = BED.y - 2 * MARGIN + 0.5;
  const fits = ((size[0] <= X && size[1] <= Y) || (size[0] <= Y && size[1] <= X)) && size[2] <= BED.z;
  flags.unshift(fits ? { lvl: 'ok', text: 'One piece, ' + size.map((v) => Math.round(v)).join(' x ') + ' mm, fits the H2S plate with 10 mm clear.' } : { lvl: 'bad', text: 'Does not fit the H2S plate at 1:' + S + '.' });
  flags.push({ lvl: 'ok', text: 'Print with supports off. Every downward face is 45 degrees or steeper, apart from short flat bridges.' });
  return { scale: S, size, grams, hours: grams / 14 + 1, fits, flags, status: String(status), tris: tris.length / 9,
    parts: [{ kind: 'model', mat: 'white', name: info.ornament ? 'tree-model' : 'model', label: 'Model', z0: 0, tris, st: { min: [0, 0, 0], max: size }, grams }], ...info };
}
