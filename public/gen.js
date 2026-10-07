/* House generator: plan numbers in, support-free printable parts out.
   Every part prints flat side down and every surface rises at 45 degrees or steeper, so nothing needs support. */
(function (root) {
  'use strict';
  var BED = { x: 340, y: 320, z: 340 };
  var K = { strip: 26, edge: 6, letter: 0.8, fascia: 0.8, clear: 0.2, socket: 5.4, peg: 5.0, flat: 2.0, hole: 3.2, ornament: 75, reveal: 1.0, step: 0.25, margin: 10,
    panel: 0.6, skin: 1.2, groove: 0.3, gh: 0.5, gw: 0.4, base: 2.4, inlay: 0.6, tile: 3.0, tileH: 0.3, rib: 2.0, ribH: 0.3 };
  var WALLS = ['brick', 'render', 'weatherboard', 'vertical', 'stone'];
  function q(v) { return Math.round(v * 1e4) / 1e4; }

  function toBlocks(p) {
    var S = p.scale;
    function f(m) { return q(m * 1000 / S); }
    var bl = p.blocks.map(function (b, i) {
      var x0 = f(+b.x || 0), y0 = f(+b.y || 0);
      var x1 = q(x0 + f(Math.max(0.5, +b.w || 0))), y1 = q(y0 + f(Math.max(0.5, +b.d || 0)));
      var e = f(Math.max(0, +b.eave || 0));
      var st = Math.max(1, Math.min(4, Math.round(+b.storeys || 1)));
      return {
        i: i, name: b.name || ('Block ' + (i + 1)), x0: x0, y0: y0, x1: x1, y1: y1, e: e,
        H: f(st * Math.max(2, +b.storeyH || 2.7)),
        rx0: q(x0 - e), ry0: q(y0 - e), rx1: q(x1 + e), ry1: q(y1 + e),
        roof: b.roof || 'hip', tan: Math.tan(Math.max(0, Math.min(60, +b.pitch || 0)) * Math.PI / 180),
        ridge: b.ridge || 'auto', high: b.high || 'n',
        sH: f(Math.max(2, +b.storeyH || 2.7)), st: st, open: !!b.open && !p.plain, post: f(+b.post || 0.1),
        wall: WALLS.indexOf(b.wall) >= 0 ? b.wall : 'render', roofMat: b.roofMat === 'tile' || b.roofMat === 'metal' ? b.roofMat : '',
        ops: (Array.isArray(b.openings) ? b.openings : []).map(function (o) {
          return { side: o.side, at: f(+o.at || 0), w: f(+o.w || 0), sill: f(+o.sill || 0), head: f(+o.head || 0), kind: o.kind || 'window', storey: Math.max(1, Math.min(st, Math.round(+o.storey || 1))) };
        }),
        zones: (Array.isArray(b.cladding) ? b.cladding : []).filter(function (z) { return WALLS.indexOf(z.kind) >= 0; }).map(function (z) {
          var pitch = z.kind === 'weatherboard' ? Math.max(1.2, f(+z.board || 0.18)) : Math.max(1.0, f(+z.board || 0.15));
          return { side: z.side, at: f(+z.at || 0), w: f(z.w == null ? 99 : +z.w), z0: f(+z.z0 || 0), z1: f(z.z1 == null ? 99 : +z.z1), mat: z.kind, pitch: pitch };
        })
      };
    });
    if (p.plain) bl = bl.filter(function (b) { return !b.open; });
    var mx = Infinity, my = Infinity;
    bl.forEach(function (b) { mx = Math.min(mx, b.rx0); my = Math.min(my, b.ry0); });
    bl.forEach(function (b) {
      ['x0', 'x1', 'rx0', 'rx1'].forEach(function (k) { b[k] = q(b[k] - mx); });
      ['y0', 'y1', 'ry0', 'ry1'].forEach(function (k) { b[k] = q(b[k] - my); });
    });
    bl.offset = [mx, my];
    return bl;
  }

  function ridgeAlongX(b) {
    return b.ridge === 'ew' || (b.ridge !== 'ns' && (b.rx1 - b.rx0) >= (b.ry1 - b.ry0));
  }

  function roofH(b, x, y) {
    var dx = Math.min(x - b.rx0, b.rx1 - x), dy = Math.min(y - b.ry0, b.ry1 - y), t;
    if (b.roof === 'hip') t = Math.min(dx, dy);
    else if (b.roof === 'gable') t = ridgeAlongX(b) ? dy : dx;
    else if (b.roof === 'skillion') {
      t = b.high === 'n' ? y - b.ry0 : b.high === 's' ? b.ry1 - y : b.high === 'e' ? x - b.rx0 : b.rx1 - x;
    } else return K.flat;
    var h = K.fascia + b.tan * Math.max(0, t);
    /* Roof texture, heightfield only so it adds no overhang: tile courses step parallel to the eaves, metal ribs run down the slope. */
    if (b.tex === 'tile') h += K.tileH * (1 - ((Math.max(0, t) / K.tile) % 1));
    else if (b.tex === 'metal') {
      var a = b.roof === 'hip' ? (dx < dy ? y : x) : b.roof === 'gable' ? (ridgeAlongX(b) ? x : y) : (b.high === 'n' || b.high === 's' ? x : y);
      var u = Math.abs(((a / K.rib) % 1) - 0.5) * 2;
      h += K.ribH * Math.max(0, 1 - u * K.rib / 0.6);
    }
    return h;
  }

  function inRect(cx, cy, x0, y0, x1, y1) { return cx > x0 && cx < x1 && cy > y0 && cy < y1; }

  /* Roof surface height for level L at (x,y), judged for the cell whose centre is (cx,cy). -1 = no roof here. */
  function roofTop(bl, L, x, y, cx, cy) {
    var h = -1, k, b, v;
    for (k = 0; k < bl.length; k++) {
      b = bl[k];
      if (b.H !== L) continue;
      if (inRect(cx, cy, b.rx0, b.ry0, b.rx1, b.ry1)) { v = roofH(b, x, y); if (v > h) h = v; }
    }
    if (h < 0) return -1;
    for (k = 0; k < bl.length; k++) {
      b = bl[k];
      if (b.H <= L) continue;
      if (inRect(cx, cy, b.x0 - K.clear, b.y0 - K.clear, b.x1 + K.clear, b.y1 + K.clear)) return -1;
      if (inRect(cx, cy, b.rx0, b.ry0, b.rx1, b.ry1)) {
        var cap = b.H - L - K.clear;
        if (cap < 0.4) return -1;
        if (h > cap) h = cap;
      }
    }
    return q(h);
  }

  function findPegs(bl) {
    var out = [], s = K.socket / 2;
    bl.forEach(function (b) {
      if (b.open || b.x1 - b.x0 < 9 || b.y1 - b.y0 < 9) return;
      var cx = q((b.x0 + b.x1) / 2), cy = q((b.y0 + b.y1) / 2), hmin = Infinity, ok = true;
      [[-s, -s], [s, -s], [s, s], [-s, s], [0, 0]].forEach(function (d) {
        var t = roofTop(bl, b.H, cx + d[0], cy + d[1], cx + d[0] * 0.99, cy + d[1] * 0.99);
        if (t < 0) ok = false; else hmin = Math.min(hmin, t);
      });
      if (!ok) return;
      for (var k = 0; k < bl.length; k++) {
        var o = bl[k];
        if (o.H > b.H && cx + s > o.x0 - 1 && cx - s < o.x1 + 1 && cy + s > o.y0 - 1 && cy - s < o.y1 + 1) return;
      }
      var depth = Math.floor(Math.min(1.6, hmin - 1.0) / 0.2 + 1e-9) * 0.2;
      if (depth < 0.8) return;
      out.push({ cx: cx, cy: cy, H: b.H, depth: q(depth), height: q(depth - 0.2), block: b.i });
    });
    return out;
  }

  function axis(vals, res, lo, hi) {
    var set = {}, arr = [];
    vals.forEach(function (v) {
      v = q(v);
      if (v < lo - 1e-9 || v > hi + 1e-9) return;
      if (!set[v]) { set[v] = 1; arr.push(v); }
    });
    arr.sort(function (a, b) { return a - b; });
    var out = [arr[0]];
    for (var k = 1; k < arr.length; k++) {
      var a = arr[k - 1], b = arr[k];
      var n = res ? Math.max(1, Math.ceil((b - a) / res - 1e-9)) : 1;
      for (var s = 1; s <= n; s++) out.push(s === n ? b : q(a + (b - a) * s / n));
    }
    return out;
  }

  /* Mesh a cell field. topAt(x,y,cx,cy) gives the top height or -1; botAt(cx,cy) the flat underside.
     Walls are stitched node by node so every edge is shared by exactly two triangles. */
  function meshField(xs, ys, topAt, botAt) {
    var nx = xs.length - 1, ny = ys.length - 1, NX = nx + 1;
    var solid = new Uint8Array(nx * ny), bot = new Float64Array(nx * ny), top = new Float64Array(nx * ny * 4);
    var diag = new Uint8Array(nx * ny);
    var i, j, c, k;
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      var x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1], cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      var t0 = topAt(x0, y0, cx, cy);
      if (t0 < 0) continue;
      var t1 = topAt(x1, y0, cx, cy), t2 = topAt(x1, y1, cx, cy), t3 = topAt(x0, y1, cx, cy);
      if (t1 < 0 || t2 < 0 || t3 < 0) continue;
      c = j * nx + i;
      var b = botAt ? botAt(cx, cy) : 0;
      if (Math.min(t0, t1, t2, t3) < b + 0.6) b = 0;
      solid[c] = 1; bot[c] = b;
      top[c * 4] = t0; top[c * 4 + 1] = t1; top[c * 4 + 2] = t2; top[c * 4 + 3] = t3;
      var hc = topAt(cx, cy, cx, cy);
      diag[c] = Math.abs((t0 + t2) / 2 - hc) <= Math.abs((t1 + t3) / 2 - hc) ? 0 : 1;
    }
    var lv = new Array(NX * (ny + 1));
    function addLevel(n, z) { var a = lv[n]; if (!a) a = lv[n] = []; if (a.indexOf(z) < 0) a.push(z); }
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      c = j * nx + i; if (!solid[c]) continue;
      var n0 = j * NX + i, ns = [n0, n0 + 1, n0 + NX + 1, n0 + NX];
      for (k = 0; k < 4; k++) { addLevel(ns[k], top[c * 4 + k]); addLevel(ns[k], bot[c]); }
    }
    for (k = 0; k < lv.length; k++) if (lv[k]) lv[k].sort(function (a, b) { return a - b; });

    var T = [];
    function tri(ax, ay, az, bx, by, bz, cx, cy, cz) { T.push(ax, ay, az, bx, by, bz, cx, cy, cz); }
    function chain(n, za, zb) {
      if (za === zb) return [za];
      var a = lv[n], out = [za], m;
      if (za < zb) { for (m = 0; m < a.length; m++) if (a[m] > za && a[m] < zb) out.push(a[m]); }
      else { for (m = a.length - 1; m >= 0; m--) if (a[m] < za && a[m] > zb) out.push(a[m]); }
      out.push(zb); return out;
    }
    function wall(nU, nV, aU, aV, bU, bV) {
      if (aU === bU && aV === bV) return;
      var L = chain(nU, aU, bU), R = chain(nV, aV, bV);
      var ux = xs[nU % NX], uy = ys[(nU / NX) | 0], vx = xs[nV % NX], vy = ys[(nV / NX) | 0];
      var a = 0, b = 0, m = L.length - 1, n = R.length - 1;
      while (a < m || b < n) {
        var advL = b >= n || (a < m && (a + 1) * n <= (b + 1) * m);
        if (advL) { tri(vx, vy, R[b], ux, uy, L[a], ux, uy, L[a + 1]); a++; }
        else { tri(vx, vy, R[b], ux, uy, L[a], vx, vy, R[b + 1]); b++; }
      }
    }
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      c = j * nx + i; if (!solid[c]) continue;
      var X0 = xs[i], X1 = xs[i + 1], Y0 = ys[j], Y1 = ys[j + 1];
      var h0 = top[c * 4], h1 = top[c * 4 + 1], h2 = top[c * 4 + 2], h3 = top[c * 4 + 3], bb = bot[c];
      if (!diag[c]) { tri(X0, Y0, h0, X1, Y0, h1, X1, Y1, h2); tri(X0, Y0, h0, X1, Y1, h2, X0, Y1, h3); }
      else { tri(X0, Y0, h0, X1, Y0, h1, X0, Y1, h3); tri(X1, Y0, h1, X1, Y1, h2, X0, Y1, h3); }
      tri(X0, Y0, bb, X1, Y1, bb, X1, Y0, bb); tri(X0, Y0, bb, X0, Y1, bb, X1, Y1, bb);
      var m0 = j * NX + i, m1 = m0 + 1, m2 = m0 + NX + 1, m3 = m0 + NX, d;
      if (j === 0 || !solid[c - nx]) wall(m0, m1, h0, h1, bb, bb);
      if (i === 0 || !solid[c - 1]) wall(m3, m0, h3, h0, bb, bb);
      if (i === nx - 1 || !solid[c + 1]) wall(m1, m2, h1, h2, bb, bb);
      else { d = c + 1; wall(m1, m2, h1, h2, top[d * 4], top[d * 4 + 3]); wall(m2, m1, bb, bb, bot[d], bot[d]); }
      if (j === ny - 1 || !solid[c + nx]) wall(m2, m3, h2, h3, bb, bb);
      else { d = c + nx; wall(m2, m3, h2, h3, top[d * 4 + 1], top[d * 4]); wall(m3, m2, bb, bb, bot[d], bot[d]); }
    }
    return new Float32Array(T);
  }

  function stats(t) {
    var vol = 0, area = 0, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (var k = 0; k < t.length; k += 9) {
      var ax = t[k], ay = t[k + 1], az = t[k + 2], bx = t[k + 3], by = t[k + 4], bz = t[k + 5], cx = t[k + 6], cy = t[k + 7], cz = t[k + 8];
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      var ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
      for (var m = 0; m < 9; m++) { var a = m % 3; if (t[k + m] < mn[a]) mn[a] = t[k + m]; if (t[k + m] > mx[a]) mx[a] = t[k + m]; }
    }
    if (!t.length) mn = mx = [0, 0, 0];
    return { vol: vol, area: area, min: mn, max: mx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
  }

  function grams(st) {
    var shell = Math.min(st.vol, st.area * 0.9);
    return 1.24e-3 * (shell + 0.12 * (st.vol - shell));
  }

  /* 1:100 unless the house is too big for the plate, then the next standard scale down. 10 mm clear all round. */
  function pickScale(p) {
    var opts = [100, 150, 200, 250, 300], best = 300, X = BED.x - 2 * K.margin, Y = BED.y - 2 * K.margin;
    for (var k = 0; k < opts.length; k++) {
      var bl = toBlocks({ scale: opts[k], blocks: p.blocks }), w = 0, d = 0;
      bl.forEach(function (b) { w = Math.max(w, b.rx1); d = Math.max(d, b.ry1); });
      if ((w <= X && d <= Y) || (w <= Y && d <= X)) { best = opts[k]; break; }
    }
    return best;
  }
  /* Christmas tree version: the smallest standard scale that keeps the longest side under about 75 mm. */
  function ornamentScale(p) {
    var opts = [200, 250, 300, 350, 400, 450, 500, 600, 750, 1000];
    for (var k = 0; k < opts.length; k++) {
      var bl = toBlocks({ scale: opts[k], blocks: p.blocks }), w = 0, d = 0;
      bl.forEach(function (b) { w = Math.max(w, b.rx1); d = Math.max(d, b.ry1); });
      if (Math.max(w, d) <= K.ornament) return opts[k];
    }
    return 1000;
  }
  /* Where the hanging hole goes: the area-weighted middle of the plan, moved to the middle of the biggest block if it lands outside the walls. */
  function holeAt(bl) {
    var a = 0, sx = 0, sy = 0, big = bl[0], m = K.hole / 2 + 1.2;
    bl.forEach(function (b) { var ar = (b.x1 - b.x0) * (b.y1 - b.y0); a += ar; sx += ar * (b.x0 + b.x1) / 2; sy += ar * (b.y0 + b.y1) / 2; if (ar > (big.x1 - big.x0) * (big.y1 - big.y0)) big = b; });
    var cx = q(sx / a), cy = q(sy / a);
    var inside = bl.some(function (b) { return cx > b.x0 + m && cx < b.x1 - m && cy > b.y0 + m && cy < b.y1 - m; });
    if (!inside) { cx = q((big.x0 + big.x1) / 2); cy = q((big.y0 + big.y1) / 2); }
    return { cx: cx, cy: cy, x0: q(cx - K.hole / 2), x1: q(cx + K.hole / 2), y0: q(cy - K.hole / 2), y1: q(cy + K.hole / 2) };
  }

  /* ---------- walls ---------- */
  function closedAt(bl, x, y) { return bl.some(function (b) { return !b.open && x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1; }); }
  /* Is this stretch of a block's wall face on the outside of the house? Checked at both ends and the middle. */
  function faceOutside(bl, b, side, a0, a1) {
    var e = 0.05, o1 = K.reveal + 0.3, pts = [a0 + e, (a0 + a1) / 2, a1 - e];
    return !pts.some(function (a) {
      return side === 's' ? closedAt(bl, b.x0 + a, b.y0 - o1) : side === 'n' ? closedAt(bl, b.x0 + a, b.y1 + o1)
        : side === 'w' ? closedAt(bl, b.x0 - o1, b.y0 + a) : closedAt(bl, b.x1 + o1, b.y0 + a);
    });
  }
  function region(b, side, a0, a1) {
    var horiz = side === 's' || side === 'n';
    return { side: side, x: horiz ? [b.x0 + a0, b.x0 + a1] : null, y: horiz ? null : [b.y0 + a0, b.y0 + a1],
      plane: side === 's' ? b.y0 : side === 'n' ? b.y1 : side === 'w' ? b.x0 : b.x1 };
  }
  function sideLen(b, side) { return side === 's' || side === 'n' ? b.x1 - b.x0 : b.y1 - b.y0; }

  /* Openings become recesses cut K.reveal deep into the wall face, with a 45 degree stepped head so they print without
     support. Behind each recess sits a thin panel in its own part (glass or door), so it can print in another colour. */
  function openingBoxes(bl) {
    var out = [];
    bl.forEach(function (b) {
      if (b.open) return;
      b.ops.forEach(function (o) {
        if (['s', 'n', 'e', 'w'].indexOf(o.side) < 0) return;
        var len = sideLen(b, o.side), a0 = q(Math.max(0.8, o.at)), a1 = q(Math.min(len - 0.8, o.at + o.w));
        if (a1 - a0 < 1.2) return;
        var base = (o.storey - 1) * b.sH, top = o.storey * b.sH - 0.8;
        var z0 = q(base + (o.kind === 'window' ? Math.max(0.6, o.sill) : 0)), z1 = q(Math.min(top, base + o.head));
        if (z1 - z0 < 1.5 || !faceOutside(bl, b, o.side, a0, a1)) return;
        var r = region(b, o.side, a0, a1); r.kind = o.kind; r.z0 = z0; r.z1 = z1; r.mat = o.kind === 'window' ? 'glass' : 'door';
        out.push(r);
      });
    });
    return out;
  }
  /* Wall finishes as a skin K.skin deep: the block's main finish on every outside face, then each drawn zone on top. */
  function skinZones(bl) {
    var out = [];
    bl.forEach(function (b) {
      if (b.open) return;
      ['s', 'n', 'e', 'w'].forEach(function (side) {
        var r = region(b, side, 0, sideLen(b, side)); r.z0 = 0; r.z1 = b.H; r.mat = b.wall; out.push(r);
      });
      b.zones.forEach(function (z) {
        if (['s', 'n', 'e', 'w'].indexOf(z.side) < 0) return;
        var len = sideLen(b, z.side), a0 = q(Math.max(0, z.at)), a1 = q(Math.min(len, z.at + z.w));
        if (a1 - a0 < 1) return;
        var r = region(b, z.side, a0, a1); r.z0 = q(Math.max(0, z.z0)); r.z1 = q(Math.min(b.H, z.z1)); r.mat = z.mat;
        if (r.z1 - r.z0 > 1) out.push(r);
      });
    });
    return out;
  }
  function inward(r, cx, cy) { return r.side === 's' ? cy - r.plane : r.side === 'n' ? r.plane - cy : r.side === 'w' ? cx - r.plane : r.plane - cx; }
  function along(r, cx, cy) { return r.x ? cx > r.x[0] && cx < r.x[1] : cy > r.y[0] && cy < r.y[1]; }

  /* Mesh a material grid. S holds a material code per cell (0 empty, CUT and TEX are cut-away cells).
     Each material comes out as its own closed part, because every boundary face is a whole grid face. */
  var CUT = 254, TEX = 253;
  function meshGrid(xs, ys, zs, S, names) {
    var nx = xs.length - 1, ny = ys.length - 1, nz = zs.length - 1, out = {}, detail = [];
    function id(i, j, l) { return (l * ny + j) * nx + i; }
    function nb(i, j, l) { return i < 0 || j < 0 || l < 0 || i >= nx || j >= ny || l >= nz ? 0 : S[id(i, j, l)]; }
    function quad(arr, a, b, c, d) { arr.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]); }
    for (var l = 0; l < nz; l++) for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var m = S[id(i, j, l)];
      if (!m || m >= TEX) continue;
      var T = out[m] || (out[m] = []);
      var x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1], z0 = zs[l], z1 = zs[l + 1], n, f;
      var faces = [
        [nb(i + 1, j, l), [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
        [nb(i - 1, j, l), [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
        [nb(i, j + 1, l), [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
        [nb(i, j - 1, l), [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
        [nb(i, j, l + 1), [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
        [nb(i, j, l - 1), [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]];
      for (f = 0; f < 6; f++) {
        n = faces[f][0];
        if (n === m) continue;
        quad(T, faces[f][1], faces[f][2], faces[f][3], faces[f][4]);
        if (n === CUT) quad(detail, faces[f][1], faces[f][2], faces[f][3], faces[f][4]);
      }
    }
    var parts = [];
    Object.keys(out).forEach(function (m) { parts.push({ mat: names[m - 1], tris: new Float32Array(out[m]) }); });
    return { parts: parts, detail: new Float32Array(detail) };
  }

  function bodyGrid(bl, pegs, hole, ops, zones, W, D, fine) {
    var bx = [0, W], by = [0, D], bz = [0], n, k, mats = [];
    function code(m) { var i = mats.indexOf(m); if (i < 0) { mats.push(m); i = mats.length - 1; } return i + 1; }
    var posts = [];
    bl.forEach(function (b) {
      if (!b.open) { bx.push(b.x0, b.x1); by.push(b.y0, b.y1); bz.push(b.H); return; }
      /* An open block (alfresco, porch, carport) stands on a post at each corner that is not inside the house. */
      var s = Math.max(1.6, b.post);
      [[b.x0, b.y0], [b.x1 - s, b.y0], [b.x1 - s, b.y1 - s], [b.x0, b.y1 - s]].forEach(function (c) {
        if (closedAt(bl, c[0] + s / 2, c[1] + s / 2)) return;
        posts.push({ x0: q(c[0]), y0: q(c[1]), x1: q(c[0] + s), y1: q(c[1] + s), H: b.H });
        bx.push(c[0], c[0] + s); by.push(c[1], c[1] + s); bz.push(b.H);
      });
    });
    pegs.forEach(function (g) {
      for (n = 0; n * 0.2 <= g.height + 1e-9; n++) { var h = K.peg / 2 - n * 0.2; bx.push(g.cx - h, g.cx + h); by.push(g.cy - h, g.cy + h); bz.push(g.H + n * 0.2); }
    });
    if (hole) { bx.push(hole.x0, hole.x1); by.push(hole.y0, hole.y1); }
    function depthLines(r, ds) {
      if (r.x) { bx.push(r.x[0], r.x[1]); ds.forEach(function (d) { by.push(r.side === 's' ? r.plane + d : r.plane - d); }); }
      else { by.push(r.y[0], r.y[1]); ds.forEach(function (d) { bx.push(r.side === 'w' ? r.plane + d : r.plane - d); }); }
    }
    var rev = []; for (n = 1; n * K.step <= K.reveal + 1e-9; n++) rev.push(n * K.step);
    ops.forEach(function (o) {
      bz.push(o.z0, o.z1);
      for (n = 1; n * K.step < K.reveal + 1e-9; n++) bz.push(o.z1 - n * K.step);
      depthLines(o, rev.concat([K.reveal + K.panel]));
    });
    zones.forEach(function (z) {
      bz.push(z.z0, z.z1);
      depthLines(z, [K.skin].concat(fine && z.mat === 'weatherboard' ? [K.groove / 2, K.groove] : []));
      if (fine && z.mat === 'weatherboard') {
        for (var zb = z.z0 + z.pitch; zb + K.gh < z.z1; zb += z.pitch) bz.push(zb, zb + K.gh / 2, zb + K.gh);
      }
      if (fine && z.mat === 'vertical') {
        var a0 = z.x ? z.x[0] : z.y[0], a1 = z.x ? z.x[1] : z.y[1];
        for (var ab = a0 + z.pitch; ab + K.gw < a1; ab += z.pitch) { if (z.x) bx.push(ab, ab + K.gw); else by.push(ab, ab + K.gw); }
      }
    });
    var Hmax = 0; bl.forEach(function (b) { Hmax = Math.max(Hmax, b.H); }); pegs.forEach(function (g) { Hmax = Math.max(Hmax, g.H + g.height); });
    var xs = axis(bx, 0, 0, W), ys = axis(by, 0, 0, D), zs = axis(bz, 0, 0, Hmax);
    var nx = xs.length - 1, ny = ys.length - 1, nz = zs.length - 1, S = new Uint8Array(nx * ny * nz);
    var core = code(bl.filter(function (b) { return !b.open; }).map(function (b) { return b.wall; })[0] || 'render');
    var zoneCodes = zones.map(function (z) { return code(z.mat); }), opCodes = ops.map(function (o) { return code(o.mat); }), postCode = posts.length ? code('post') : 0;
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2, top = -1, isPost = false;
      if (hole && cx > hole.x0 && cx < hole.x1 && cy > hole.y0 && cy < hole.y1) continue;
      for (k = 0; k < bl.length; k++) { var b = bl[k]; if (!b.open && cx > b.x0 && cx < b.x1 && cy > b.y0 && cy < b.y1 && b.H > top) top = b.H; }
      if (top < 0) for (k = 0; k < posts.length; k++) { var p = posts[k]; if (cx > p.x0 && cx < p.x1 && cy > p.y0 && cy < p.y1) { top = p.H; isPost = true; } }
      if (top < 0) continue;
      var peg = null;
      for (k = 0; k < pegs.length; k++) if (pegs[k].H === top && Math.abs(cx - pegs[k].cx) < K.peg / 2 && Math.abs(cy - pegs[k].cy) < K.peg / 2) peg = pegs[k];
      var myOps = [], myZones = [];
      for (k = 0; k < ops.length; k++) { var dd0 = inward(ops[k], cx, cy); if (along(ops[k], cx, cy) && dd0 > 0 && dd0 < K.reveal + K.panel) myOps.push(k); }
      for (k = 0; k < zones.length; k++) { var dz = inward(zones[k], cx, cy); if (along(zones[k], cx, cy) && dz > 0 && dz < K.skin) myZones.push(k); }
      for (var l = 0; l < nz; l++) {
        var cz = (zs[l] + zs[l + 1]) / 2, v = 0, a;
        if (cz < top) v = isPost ? postCode : core;
        else if (peg && cz < top + peg.height) { var dd = Math.max(Math.abs(cx - peg.cx), Math.abs(cy - peg.cy)); if (dd < K.peg / 2 - (cz - top) - 0.1) v = core; }
        if (v && !isPost && cz < top) {
          for (a = 0; a < myZones.length; a++) {
            var z = zones[myZones[a]];
            if (cz <= z.z0 || cz >= z.z1) continue;
            v = zoneCodes[myZones[a]];
            if (fine && z.mat === 'weatherboard') {
              var d1 = inward(z, cx, cy), lz = (cz - z.z0) % z.pitch;
              if (cz - z.z0 > z.pitch * 0.5 && d1 < K.groove && lz < K.gh && d1 < K.gh - lz) v = TEX;
            } else if (fine && z.mat === 'vertical') {
              var d2 = inward(z, cx, cy), aa = ((z.x ? cx - z.x[0] : cy - z.y[0]) % z.pitch);
              if (d2 < K.groove && aa < K.gw && (z.x ? cx - z.x[0] : cy - z.y[0]) > z.pitch * 0.5) v = TEX;
            }
          }
          for (a = 0; a < myOps.length; a++) {
            var o = ops[myOps[a]];
            if (cz <= o.z0 || cz >= o.z1) continue;
            var d = inward(o, cx, cy);
            if (d < K.reveal && d < o.z1 - cz) { v = CUT; break; }
            if (d >= K.reveal && cz < o.z1 - K.reveal) { v = opCodes[myOps[a]]; break; }
          }
        }
        S[(l * ny + j) * nx + i] = v;
      }
    }
    return meshGrid(xs, ys, zs, S, mats);
  }

  /* ---------- the lot ---------- */
  function boxTris(x0, y0, z0, x1, y1, z1) {
    var a = [x0, y0, z0], b = [x1, y0, z0], c = [x1, y1, z0], d = [x0, y1, z0], e = [x0, y0, z1], f = [x1, y0, z1], g = [x1, y1, z1], h = [x0, y1, z1], T = [];
    function quad(p, q2, r, s) { T.push(p[0], p[1], p[2], q2[0], q2[1], q2[2], r[0], r[1], r[2], p[0], p[1], p[2], r[0], r[1], r[2], s[0], s[1], s[2]); }
    quad(a, d, c, b); quad(e, f, g, h); quad(a, b, f, e); quad(b, c, g, f); quad(c, d, h, g); quad(d, a, e, h);
    return T;
  }
  /* A wall-like strip between two points, any angle: a closed box turned onto the line. */
  function stripTris(x1, y1, x2, y2, t, z0, z1) {
    var L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.5) return [];
    var ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy * t / 2, ny = ux * t / 2;
    var P = [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]], T = [];
    function v(i, z) { return [P[i][0], P[i][1], z]; }
    function quad(p, q2, r, s) { T.push(p[0], p[1], p[2], q2[0], q2[1], q2[2], r[0], r[1], r[2], p[0], p[1], p[2], r[0], r[1], r[2], s[0], s[1], s[2]); }
    quad(v(0, z0), v(3, z0), v(2, z0), v(1, z0)); quad(v(0, z1), v(1, z1), v(2, z1), v(3, z1));
    for (var i = 0; i < 4; i++) { var k = (i + 1) % 4; quad(v(i, z0), v(k, z0), v(k, z1), v(i, z1)); }
    return T;
  }
  /* Trees print as cones no flatter than 45 degrees, so nothing overhangs. */
  function coneTris(cx, cy, r, h, z0) {
    var n = 20, T = [], top = [cx, cy, z0 + h], mid = [cx, cy, z0];
    for (var i = 0; i < n; i++) {
      var a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      var p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0), z0], p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1), z0];
      T.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], top[0], top[1], top[2]);
      T.push(mid[0], mid[1], mid[2], p1[0], p1[1], p1[2], p0[0], p0[1], p0[2]);
    }
    return T;
  }
  /* Clip an axis-aligned fence line so it stops where the house walls are. Diagonal fences are kept whole. */
  function fenceRuns(bl, f) {
    if (Math.abs(f.x1 - f.x2) > 0.01 && Math.abs(f.y1 - f.y2) > 0.01) return [[f.x1, f.y1, f.x2, f.y2]];
    var horiz = Math.abs(f.y1 - f.y2) <= 0.01, a = horiz ? Math.min(f.x1, f.x2) : Math.min(f.y1, f.y2), b = horiz ? Math.max(f.x1, f.x2) : Math.max(f.y1, f.y2), c = horiz ? f.y1 : f.x1;
    var runs = [], start = null, step = 0.5;
    for (var t = a; t <= b + 1e-9; t += step) {
      var tt = Math.min(t, b), inside = horiz ? closedAt(bl, tt, c) : closedAt(bl, c, tt);
      if (!inside && start === null) start = tt;
      if ((inside || tt >= b) && start !== null) { var e = inside ? tt - step : tt; if (e - start > 0.8) runs.push(horiz ? [start, c, e, c] : [c, start, c, e]); start = null; }
    }
    return runs;
  }
  /* Make a closed shell face outwards: if its volume comes out negative, every triangle is wound the wrong way round. */
  function outward(T) {
    var v = 0, k;
    for (k = 0; k < T.length; k += 9) v += T[k] * (T[k + 4] * T[k + 8] - T[k + 5] * T[k + 7]) - T[k + 1] * (T[k + 3] * T[k + 8] - T[k + 5] * T[k + 6]) + T[k + 2] * (T[k + 3] * T[k + 7] - T[k + 4] * T[k + 6]);
    if (v < 0) for (k = 0; k < T.length; k += 9) for (var m = 0; m < 3; m++) { var t = T[k + 3 + m]; T[k + 3 + m] = T[k + 6 + m]; T[k + 6 + m] = t; }
    return T;
  }
  var SURFACES = ['turf', 'garden', 'mulch', 'pebbles', 'concrete', 'driveway', 'path', 'paving', 'deck', 'pool', 'gravel', 'sand'];
  function siteParts(site, bl, fine) {
    var W = site.x1 - site.x0, D = site.y1 - site.y0, xsv = [site.x0, site.x1], ysv = [site.y0, site.y1], areas = [], mats = [];
    function code(m) { var i = mats.indexOf(m); if (i < 0) { mats.push(m); i = mats.length - 1; } return i + 1; }
    site.items.forEach(function (it) {
      if (SURFACES.indexOf(it.kind) < 0) return;
      var r = { x0: Math.max(site.x0, it.x), y0: Math.max(site.y0, it.y), x1: Math.min(site.x1, it.x + it.w), y1: Math.min(site.y1, it.y + it.d), mat: it.kind };
      if (r.x1 - r.x0 < 0.5 || r.y1 - r.y0 < 0.5) return;
      areas.push(r); xsv.push(r.x0, r.x1); ysv.push(r.y0, r.y1);
    });
    var xs = axis(xsv, 0, site.x0, site.x1), ys = axis(ysv, 0, site.y0, site.y1), zs = [0, K.base - K.inlay, K.base];
    var nx = xs.length - 1, ny = ys.length - 1, S = new Uint8Array(nx * ny * 2), baseC = code('base'), cover = code(site.cover);
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2, m = cover;
      for (var k = 0; k < areas.length; k++) { var a = areas[k]; if (cx > a.x0 && cx < a.x1 && cy > a.y0 && cy < a.y1) m = code(a.mat); }
      if (closedAt(bl, cx, cy)) m = baseC;
      S[j * nx + i] = baseC; S[(ny + j) * nx + i] = m;
    }
    var g = meshGrid(xs, ys, zs, S, mats), parts = g.parts.map(function (p) { return { kind: 'base', mat: p.mat, tris: p.tris }; });
    var fence = [], trees = [], fix = [];
    site.items.forEach(function (it) {
      if (it.kind === 'fence' || it.kind === 'retaining' || it.kind === 'wall') {
        fenceRuns(bl, it).forEach(function (r) {
          var x1 = Math.max(site.x0, Math.min(site.x1, r[0])), y1 = Math.max(site.y0, Math.min(site.y1, r[1])), x2 = Math.max(site.x0, Math.min(site.x1, r[2])), y2 = Math.max(site.y0, Math.min(site.y1, r[3]));
          var t = Math.max(1.6, it.t), dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, inx = 0, iny = 0;
          /* keep boundary fences inside the base */
          if (Math.abs(dy) < 0.01) iny = y1 <= site.y0 + t ? t / 2 : y1 >= site.y1 - t ? -t / 2 : 0;
          if (Math.abs(dx) < 0.01) inx = x1 <= site.x0 + t ? t / 2 : x1 >= site.x1 - t ? -t / 2 : 0;
          var T = outward(stripTris(x1 + inx, y1 + iny, x2 + inx, y2 + iny, t, K.base, K.base + Math.max(1.5, it.h)));
          (it.kind === 'fence' ? fence : fix).push.apply(it.kind === 'fence' ? fence : fix, T);
        });
      } else if (it.kind === 'tree' || it.kind === 'shrub') {
        var r = Math.max(it.kind === 'tree' ? 2.5 : 1.5, it.r), h = Math.max(r * 1.15, it.h);
        if (it.x - r < site.x0 || it.x + r > site.x1 || it.y - r < site.y0 || it.y + r > site.y1) return;
        trees.push.apply(trees, outward(coneTris(it.x, it.y, r, h, K.base)));
      } else if (it.kind === 'box') {
        var bw = Math.max(1.2, it.w), bd = Math.max(1.2, it.d);
        if (it.x < site.x0 || it.y < site.y0 || it.x + bw > site.x1 || it.y + bd > site.y1) return;
        fix.push.apply(fix, outward(boxTris(it.x, it.y, K.base, it.x + bw, it.y + bd, K.base + Math.max(1.2, it.h))));
      }
    });
    if (fence.length) parts.push({ kind: 'site', mat: 'fence', tris: new Float32Array(fence) });
    if (trees.length) parts.push({ kind: 'site', mat: 'tree', tris: new Float32Array(trees) });
    if (fix.length) parts.push({ kind: 'site', mat: 'fixture', tris: new Float32Array(fix) });
    return parts;
  }

  /* 5 x 7 block letters, one number per row, top row first. Built from square pixels on the grid, so they print as raised blocks with no overhang. */
  var FONT = {
    A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31],
    F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12],
    K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31], M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
    P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
    U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17], Y: [17, 17, 17, 10, 4, 4, 4],
    Z: [31, 1, 2, 4, 8, 16, 31], 0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
    4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14],
    9: [14, 17, 17, 15, 1, 2, 12], ',': [0, 0, 0, 0, 12, 4, 8], '.': [0, 0, 0, 0, 0, 12, 12], ':': [0, 12, 12, 0, 12, 12, 0], '-': [0, 0, 0, 31, 0, 0, 0],
    '/': [1, 1, 2, 4, 8, 16, 16], "'": [12, 4, 8, 0, 0, 0, 0], '&': [12, 18, 20, 8, 21, 18, 13], '#': [10, 10, 31, 10, 31, 10, 10], '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8] };
  /* Raised text: each line is { text, x, y, px } with (x, y) the bottom-left corner of the line and px the pixel size in mm. */
  function textTris(lines, z0, h) {
    var bx = [], by = [], cells = [];
    lines.forEach(function (ln) {
      String(ln.text).toUpperCase().split('').forEach(function (ch, ci) {
        var g = FONT[ch]; if (!g) return;
        for (var r = 0; r < 7; r++) for (var c = 0; c < 5; c++) if (g[r] & (16 >> c)) {
          var x0 = q(ln.x + (ci * 6 + c) * ln.px), y0 = q(ln.y + (6 - r) * ln.px);
          cells.push([x0, y0, q(x0 + ln.px), q(y0 + ln.px)]); bx.push(x0, q(x0 + ln.px)); by.push(y0, q(y0 + ln.px));
        }
      });
    });
    if (!cells.length) return null;
    var xs = axis(bx, 0, -1e9, 1e9), ys = axis(by, 0, -1e9, 1e9), nx = xs.length - 1, ny = ys.length - 1, S = new Uint8Array(nx * ny);
    var xi = {}, yi = {}; xs.forEach(function (v, i) { xi[v] = i; }); ys.forEach(function (v, i) { yi[v] = i; });
    cells.forEach(function (c) { for (var i = xi[c[0]]; i < xi[c[2]]; i++) for (var j = yi[c[1]]; j < yi[c[3]]; j++) S[j * nx + i] = 1; });
    return meshGrid(xs, ys, [z0, q(z0 + h)], S, ['lettering']).parts[0].tris;
  }
  function textWidth(t, px) { return String(t).length * 6 * px - px; }
  /* North point: an arrow turned to true north, as a closed prism. */
  function arrowTris(cx, cy, len, deg, z0, h) {
    var a = deg * Math.PI / 180, ux = Math.sin(a), uy = Math.cos(a), vx = uy, vy = -ux, w = len * 0.38;
    var P = [[cx + ux * len / 2, cy + uy * len / 2], [cx - ux * len / 2 + vx * w, cy - uy * len / 2 + vy * w], [cx - ux * len * 0.25, cy - uy * len * 0.25], [cx - ux * len / 2 - vx * w, cy - uy * len / 2 - vy * w]];
    var T = [], n = P.length, k;
    function v(i, z) { return [P[i][0], P[i][1], z]; }
    function tri(p1, p2, p3) { T.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]); }
    /* the arrow is not convex at its notch, so it is split into two triangles each side of the centre line */
    var top = z0 + h;
    [[0, 1, 2], [0, 2, 3]].forEach(function (t3) { tri(v(t3[0], top), v(t3[1], top), v(t3[2], top)); tri(v(t3[0], z0), v(t3[2], z0), v(t3[1], z0)); });
    for (k = 0; k < n; k++) { var m = (k + 1) % n; tri(v(k, z0), v(m, z0), v(m, top)); tri(v(k, z0), v(m, top), v(k, top)); }
    return outward(T);
  }

  var LABEL = { lettering: 'Lettering and north point', plinth: 'Plinth', brick: 'Walls, brick', render: 'Walls, render', weatherboard: 'Walls, weatherboard', vertical: 'Walls, vertical boards', stone: 'Walls, stone',
    glass: 'Windows', door: 'Doors', post: 'Posts', base: 'Base', fence: 'Fences', tree: 'Trees and shrubs', fixture: 'Retaining walls and fixtures' };
  function labelOf(m) { return LABEL[m] || (m.charAt(0).toUpperCase() + m.slice(1)); }

  function build(p, res) {
    var orn = !!p.ornament, fine = !orn && res < 2;
    var scale = orn ? ornamentScale(p) : p.scale === 'auto' || !p.scale ? pickScale(p) : +p.scale;
    var bl = toBlocks({ scale: scale, blocks: p.blocks, plain: orn });
    function f(m) { return q(m * 1000 / scale); }
    var W = 0, D = 0;
    bl.forEach(function (b) { W = Math.max(W, b.rx1); D = Math.max(D, b.ry1); });

    /* The lot: placed from the house's south-west corner, then cropped to the printer plate around the house.
       Without a site plan the base is the house footprint plus a margin. A plinth strip along the south edge carries the lettering. */
    var site = null, ox = 0, oy = 0, strip = orn ? 0 : K.strip;
    if (!orn) {
      var hasSite = !!(p.site && +p.site.w > 0 && +p.site.d > 0), s = hasSite ? p.site : null, hx = bl.offset[0], hy = bl.offset[1];
      var lx0, ly0, lx1, ly1;
      if (hasSite) { lx0 = f(-(+s.houseX || 0)) - hx; ly0 = f(-(+s.houseY || 0)) - hy; lx1 = lx0 + f(+s.w); ly1 = ly0 + f(+s.d); }
      else { lx0 = -K.edge; ly0 = -K.edge; lx1 = W + K.edge; ly1 = D + K.edge; }
      var X = BED.x - 2 * K.margin, Y = BED.y - 2 * K.margin - strip;
      if (lx1 - lx0 > X) { var mid = W / 2; lx0 = Math.max(lx0, Math.min(mid - X / 2, lx1 - X)); lx1 = lx0 + X; }
      if (ly1 - ly0 > Y) { var mdy = D / 2; ly0 = Math.max(ly0, Math.min(mdy - Y / 2, ly1 - Y)); ly1 = ly0 + Y; }
      lx0 = Math.min(lx0, 0); ly0 = Math.min(ly0, 0); lx1 = Math.max(lx1, W); ly1 = Math.max(ly1, D);
      ox = -lx0; oy = -ly0 + strip;
      bl.forEach(function (b) { ['x0', 'x1', 'rx0', 'rx1'].forEach(function (k) { b[k] = q(b[k] + ox); }); ['y0', 'y1', 'ry0', 'ry1'].forEach(function (k) { b[k] = q(b[k] + oy); }); });
      var tx = function (m) { return q(f(m - (+s.houseX || 0)) - hx + ox); }, ty = function (m) { return q(f(m - (+s.houseY || 0)) - hy + oy); };
      site = { x0: 0, y0: strip, x1: q(lx1 + ox), y1: q(ly1 + oy), cover: hasSite ? (s.cover || 'turf') : 'base', north: hasSite ? (+s.north || 0) : (+p.north || 0), lot: hasSite,
        items: hasSite ? (s.items || []).map(function (it) {
          return { kind: it.kind, x: tx(+it.x || 0), y: ty(+it.y || 0), w: f(+it.w || 0), d: f(+it.d || 0), x1: tx(+it.x1 || 0), y1: ty(+it.y1 || 0), x2: tx(+it.x2 || 0), y2: ty(+it.y2 || 0),
            h: f(+it.h || 0), r: f(+it.r || 0), t: f(+it.t || 0.1) };
        }) : [] };
      W = Math.max(W + ox, site.x1); D = Math.max(D + oy, site.y1);
    }
    var lift = site ? K.base : 0;
    bl.forEach(function (b) { b.tex = fine ? b.roofMat : ''; });
    var hole = orn ? holeAt(bl) : null;
    if (orn && res > 0.4 && res <= 1) res = Math.max(0.4, res / 2);
    var pegs = orn ? [] : findPegs(bl), flags = [], parts = [];
    var levels = [];
    bl.forEach(function (b) { if (levels.indexOf(b.H) < 0) levels.push(b.H); });
    levels.sort(function (a, b) { return a - b; });

    // the lot base and what stands on it
    if (site) siteParts(site, bl, fine).forEach(function (pt) {
      var st = stats(pt.tris);
      parts.push({ kind: pt.kind, mat: pt.mat, name: (pt.kind === 'base' ? 'base-' : 'site-') + pt.mat, label: pt.kind === 'base' ? 'Base, ' + pt.mat : labelOf(pt.mat), z0: 0, plate: 1, tris: pt.tris, st: st, grams: grams(st) });
    });
    // the plinth strip, with the address, the scale and a north point in raised letters
    if (site && strip) {
      var pl = outward(boxTris(0, 0, 0, site.x1, strip, K.base)), pst = stats(new Float32Array(pl));
      parts.push({ kind: 'base', mat: 'base', name: 'plinth', label: 'Plinth', z0: 0, plate: 1, tris: new Float32Array(pl), st: pst, grams: grams(pst) });
      var title = String(p.title || '').replace(/\s+/g, ' ').trim(), sc = 'SCALE 1:' + scale, avail = site.x1 - 2 * K.edge - K.strip;
      var px1 = Math.min(1.1, avail / Math.max(1, textWidth(title, 1))), px2 = Math.min(0.85, px1);
      if (px1 < 0.55 && title) { title = title.slice(0, Math.floor((avail / 0.55 + 0.55) / 6)); px1 = 0.55; }
      var lines = [];
      if (title) lines.push({ text: title, x: K.edge, y: strip - 3 - 7 * px1, px: px1 });
      lines.push({ text: sc, x: K.edge, y: 3, px: px2 });
      var lt = textTris(lines, K.base, K.letter) || [], ar = arrowTris(site.x1 - K.strip / 2, strip / 2 - 1.5, strip * 0.55, site.north, K.base, K.letter);
      var nt = textTris([{ text: 'N', x: site.x1 - K.strip / 2 - 2.2 * 0.8, y: strip - 3 - 5.6, px: 0.8 }], K.base, K.letter) || [];
      var all = new Float32Array(lt.length + ar.length + nt.length); all.set(lt, 0); all.set(ar, lt.length); all.set(nt, lt.length + ar.length);
      var lst = stats(all);
      parts.push({ kind: 'site', mat: 'lettering', name: 'lettering', label: 'Address, scale and north point', z0: 0, plate: 1, tris: all, st: lst, grams: grams(lst) });
    }
    // walls, with openings and finishes cut in when building at preview or print detail
    var ops = fine ? openingBoxes(bl) : [], zones = fine ? skinZones(bl) : [];
    var Wb = 0, Db = 0; bl.forEach(function (b) { Wb = Math.max(Wb, b.rx1); Db = Math.max(Db, b.ry1); });
    var body = bodyGrid(bl, pegs, hole, ops, zones, Math.max(W, Wb), Math.max(D, Db), fine);
    body.parts.forEach(function (pt, i) {
      var st = stats(pt.tris);
      parts.push({ kind: 'body', mat: pt.mat, name: 'walls-' + pt.mat, label: labelOf(pt.mat), z0: lift, plate: 1, tris: pt.tris, detail: i === 0 ? body.detail : null, st: st, grams: grams(st) });
    });

    // one roof piece per eave level
    var trimmed = false;
    levels.forEach(function (L, li) {
      var g = bl.filter(function (b) { return b.H === L; });
      var lo = [Infinity, Infinity], hi = [-Infinity, -Infinity], rx = [], ry = [];
      g.forEach(function (b) {
        lo[0] = Math.min(lo[0], b.rx0); lo[1] = Math.min(lo[1], b.ry0); hi[0] = Math.max(hi[0], b.rx1); hi[1] = Math.max(hi[1], b.ry1);
        rx.push(b.rx0, b.rx1); ry.push(b.ry0, b.ry1);
        var w = b.rx1 - b.rx0, d = b.ry1 - b.ry0, m = Math.min(w, d) / 2;
        if (b.roof === 'hip') { rx.push(b.rx0 + m, b.rx1 - m); ry.push(b.ry0 + m, b.ry1 - m); }
        if (b.roof === 'gable') { if (ridgeAlongX(b)) ry.push(b.ry0 + d / 2); else rx.push(b.rx0 + w / 2); }
      });
      bl.forEach(function (b) {
        if (b.H <= L) return;
        if (b.rx1 > lo[0] && b.rx0 < hi[0] && b.ry1 > lo[1] && b.ry0 < hi[1]) trimmed = true;
        rx.push(b.x0 - K.clear, b.x1 + K.clear, b.rx0, b.rx1); ry.push(b.y0 - K.clear, b.y1 + K.clear, b.ry0, b.ry1);
      });
      var sock = pegs.filter(function (s) { return s.H === L; });
      sock.forEach(function (s) { for (var u = -K.socket / 2; u <= K.socket / 2 + 1e-9; u += K.socket / 12) { rx.push(s.cx + u); ry.push(s.cy + u); } });
      if (hole) { rx.push(hole.x0, hole.x1); ry.push(hole.y0, hole.y1); }
      var t = meshField(axis(rx, res, lo[0], hi[0]), axis(ry, res, lo[1], hi[1]),
        function (x, y, cx, cy) { return hole && cx > hole.x0 && cx < hole.x1 && cy > hole.y0 && cy < hole.y1 ? -1 : roofTop(bl, L, x, y, cx, cy); },
        function (cx, cy) {
          for (var k = 0; k < sock.length; k++) {
            var dd = Math.max(Math.abs(cx - sock[k].cx), Math.abs(cy - sock[k].cy));
            if (dd < K.socket / 2) return q(Math.max(0, Math.min(sock[k].depth, K.socket / 2 - dd + 0.2)));
          }
          return 0;
        });
      if (!t.length) return;
      var st = stats(t), nm = levels.length > 1 ? 'roof-level-' + (li + 1) : 'roof';
      parts.push({ kind: 'roof', mat: g[0].roofMat || 'roof', name: nm, label: levels.length > 1 ? 'Roof, level ' + (li + 1) : 'Roof', z0: L + lift, plate: 2 + li, tris: t, st: st, grams: grams(st) });
    });

    var H = 0, gsum = 0, Wr = 0, Dr = 0;
    parts.forEach(function (pt) { H = Math.max(H, pt.z0 + pt.st.max[2]); gsum += pt.grams; Wr = Math.max(Wr, pt.st.max[0]); Dr = Math.max(Dr, pt.st.max[1]); });
    W = Math.max(W, Wr); D = Math.max(D, Dr);
    var fits = (W <= BED.x && D <= BED.y) || (W <= BED.y && D <= BED.x);
    var minEave = Infinity, minSide = Infinity, nOpen = 0;
    bl.forEach(function (b) { if (b.e > 0) minEave = Math.min(minEave, b.e); if (!b.open) minSide = Math.min(minSide, b.x1 - b.x0, b.y1 - b.y0); if (b.open) nOpen++; });
    if (ops.length) flags.push({ lvl: 'ok', text: ops.length + ' windows and doors cut ' + K.reveal + ' mm into the walls with 45 degree heads, each backed by a glass or door panel in its own part.' });
    if (zones.length) {
      var fm = {}; zones.forEach(function (z) { fm[z.mat] = 1; });
      flags.push({ lvl: 'ok', text: 'Wall finishes as their own parts: ' + Object.keys(fm).join(', ') + '. Weatherboard and board cladding have 45 degree grooves.' });
    }
    if (fine && bl.some(function (b) { return b.roofMat === 'tile' || b.roofMat === 'metal'; })) flags.push({ lvl: 'ok', text: 'Roof surface textured as ' + bl.map(function (b) { return b.roofMat; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).join(' and ') + '.' });
    if (nOpen) flags.push({ lvl: 'ok', text: nOpen + ' open structure' + (nOpen > 1 ? 's' : '') + ' (alfresco, porch or carport) standing on corner posts under the roof.' });
    if (site) flags.push({ lvl: 'ok', text: (site.lot ? 'Lot base ' : 'Base ') + Math.round(site.x1) + ' x ' + Math.round(site.y1) + ' mm' + (site.lot ? ' with ' + site.items.length + ' site items' : '') + ', and a plinth strip with the address, scale and north point in raised letters. Base, walls and site items print together as one multi-colour plate.' });
    flags.push(fits ? { lvl: 'ok', text: 'Fits the H2S bed (340 x 320 mm).' } : { lvl: 'bad', text: 'Too big for the H2S bed at 1:' + scale + '. Pick a smaller scale.' });
    flags.push({ lvl: 'ok', text: 'No supports needed. Every part prints flat side down, and every surface, including peg sockets, opening heads and grooves, rises at 45 degrees or steeper.' });
    if (levels.length > 1) flags.push({ lvl: 'warn', text: levels.length + ' roof pieces, one per storey level. Each prints flat.' });
    if (trimmed) flags.push({ lvl: 'warn', text: 'The lower roof is trimmed where it meets the taller walls, with 0.2 mm clearance.' });
    if (orn) flags.push({ lvl: 'ok', text: 'Christmas tree version at 1:' + scale + ', ' + Math.round(Math.max(W, D)) + ' mm across. A ' + K.hole + ' mm hole runs down through roof and walls: thread a ribbon through both and knot it under the walls.' });
    else if (pegs.length < bl.length - nOpen) flags.push({ lvl: 'warn', text: 'Locating pegs on ' + pegs.length + ' of ' + (bl.length - nOpen) + ' blocks. The rest sit loose or need a dab of glue.' });
    else flags.push({ lvl: 'ok', text: 'Locating peg under every roof block, so the roof drops into place.' });
    if (orn && levels.length > 1) flags.push({ lvl: 'warn', text: 'More than one roof level. Only parts the hole passes through are held by the ribbon; glue the rest.' });
    if (minEave < 0.8 && !orn) flags.push({ lvl: 'warn', text: 'Eaves are ' + minEave.toFixed(1) + ' mm at this scale and will read as a fine edge.' });
    if (minSide < 6) flags.push({ lvl: 'warn', text: 'One block is under 6 mm wide at this scale. Check it against the plans.' });
    if (H > BED.z) flags.push({ lvl: 'bad', text: 'Taller than the printer allows.' });
    return {
      scale: scale, ornament: orn, hole: hole, parts: parts, size: [W, D, H], grams: gsum, hours: gsum / 16 + 0.2 * parts.length,
      fits: fits, flags: flags, openings: ops.length, site: !!site, pegs: pegs.length, blocks: bl.length,
      tris: parts.reduce(function (a, pt) { return a + pt.tris.length / 9; }, 0)
    };
  }

  /* Binary STL. origin: subtract this point (an assembly shares one origin); default is the part's own minimum corner. */
  function stl(t, origin) {
    var n = t.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf), o = 84, k, m;
    var mn = origin || [Infinity, Infinity, Infinity];
    if (!origin) for (k = 0; k < t.length; k++) if (t[k] < mn[k % 3]) mn[k % 3] = t[k];
    dv.setUint32(80, n, true);
    for (k = 0; k < t.length; k += 9) {
      var ux = t[k + 3] - t[k], uy = t[k + 4] - t[k + 1], uz = t[k + 5] - t[k + 2];
      var vx = t[k + 6] - t[k], vy = t[k + 7] - t[k + 1], vz = t[k + 8] - t[k + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true); o += 12;
      for (m = 0; m < 9; m++) { dv.setFloat32(o, t[k + m] - mn[m % 3], true); o += 4; }
      o += 2;
    }
    return new Uint8Array(buf);
  }

  var crcT = null;
  function crc32(u8) {
    if (!crcT) { crcT = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) crc = crcT[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  /* Minimal stored (uncompressed) zip. files: [{name, data: Uint8Array}] */
  function zip(files) {
    var enc = function (s) { var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0x7F; return a; };
    var size = 22, metas = files.map(function (f) { var nm = enc(f.name); size += 30 + nm.length + f.data.length + 46 + nm.length; return { nm: nm, crc: crc32(f.data), data: f.data }; });
    var out = new Uint8Array(size), dv = new DataView(out.buffer), o = 0, offs = [];
    metas.forEach(function (m) {
      offs.push(o);
      dv.setUint32(o, 0x04034b50, true); dv.setUint16(o + 4, 20, true); dv.setUint16(o + 6, 0, true); dv.setUint16(o + 8, 0, true);
      dv.setUint16(o + 10, 0, true); dv.setUint16(o + 12, 0x21, true);
      dv.setUint32(o + 14, m.crc, true); dv.setUint32(o + 18, m.data.length, true); dv.setUint32(o + 22, m.data.length, true);
      dv.setUint16(o + 26, m.nm.length, true); dv.setUint16(o + 28, 0, true);
      out.set(m.nm, o + 30); out.set(m.data, o + 30 + m.nm.length); o += 30 + m.nm.length + m.data.length;
    });
    var cd = o;
    metas.forEach(function (m, i) {
      dv.setUint32(o, 0x02014b50, true); dv.setUint16(o + 4, 20, true); dv.setUint16(o + 6, 20, true); dv.setUint16(o + 8, 0, true); dv.setUint16(o + 10, 0, true);
      dv.setUint16(o + 12, 0, true); dv.setUint16(o + 14, 0x21, true);
      dv.setUint32(o + 16, m.crc, true); dv.setUint32(o + 20, m.data.length, true); dv.setUint32(o + 24, m.data.length, true);
      dv.setUint16(o + 28, m.nm.length, true); dv.setUint16(o + 30, 0, true); dv.setUint16(o + 32, 0, true); dv.setUint16(o + 34, 0, true);
      dv.setUint16(o + 36, 0, true); dv.setUint32(o + 38, 0, true); dv.setUint32(o + 42, offs[i], true);
      out.set(m.nm, o + 46); o += 46 + m.nm.length;
    });
    dv.setUint32(o, 0x06054b50, true); dv.setUint16(o + 4, 0, true); dv.setUint16(o + 6, 0, true);
    dv.setUint16(o + 8, metas.length, true); dv.setUint16(o + 10, metas.length, true);
    dv.setUint32(o + 12, o - cd, true); dv.setUint32(o + 16, cd, true); dv.setUint16(o + 20, 0, true);
    return out;
  }

  root.HouseGen = { build: build, stl: stl, zip: zip, pickScale: pickScale, BED: BED };
})(typeof window !== 'undefined' ? window : globalThis);
