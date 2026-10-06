/* House generator: plan numbers in, support-free printable parts out.
   Every part is a heightfield on a flat base, so nothing overhangs. */
(function (root) {
  'use strict';
  var BED = { x: 340, y: 320, z: 340 };
  var K = { fascia: 0.8, clear: 0.2, socket: 5.4, peg: 5.0, flat: 2.0, hole: 3.2, ornament: 75, reveal: 1.0, step: 0.25, margin: 10 };
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
        sH: f(Math.max(2, +b.storeyH || 2.7)), st: st,
        ops: (Array.isArray(b.openings) ? b.openings : []).map(function (o) {
          return { side: o.side, at: f(+o.at || 0), w: f(+o.w || 0), sill: f(+o.sill || 0), head: f(+o.head || 0), kind: o.kind || 'window', storey: Math.max(1, Math.min(st, Math.round(+o.storey || 1))) };
        })
      };
    });
    var mx = Infinity, my = Infinity;
    bl.forEach(function (b) { mx = Math.min(mx, b.rx0); my = Math.min(my, b.ry0); });
    bl.forEach(function (b) {
      ['x0', 'x1', 'rx0', 'rx1'].forEach(function (k) { b[k] = q(b[k] - mx); });
      ['y0', 'y1', 'ry0', 'ry1'].forEach(function (k) { b[k] = q(b[k] - my); });
    });
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
    return K.fascia + b.tan * Math.max(0, t);
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
      if (b.x1 - b.x0 < 9 || b.y1 - b.y0 < 9) return;
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

  /* Openings become recesses cut K.reveal deep into the wall face. The head of each recess steps back at 45 degrees,
     so it prints without support. Openings on a face that is covered by another block are skipped. */
  function openingBoxes(bl) {
    var out = [];
    function covered(x, y) { return bl.some(function (b) { return x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1; }); }
    bl.forEach(function (b) {
      b.ops.forEach(function (o) {
        var horiz = o.side === 's' || o.side === 'n', len = horiz ? b.x1 - b.x0 : b.y1 - b.y0;
        var a0 = q(Math.max(0.8, o.at)), a1 = q(Math.min(len - 0.8, o.at + o.w));
        if (!(o.side === 's' || o.side === 'n' || o.side === 'e' || o.side === 'w') || a1 - a0 < 1.2) return;
        var base = (o.storey - 1) * b.sH, top = o.storey * b.sH - 0.8;
        var z0 = q(base + (o.kind === 'window' ? Math.max(0.6, o.sill) : 0)), z1 = q(Math.min(top, base + o.head));
        if (z1 - z0 < 1.5) return;
        var e = 0.05, pts = [a0 + e, (a0 + a1) / 2, a1 - e], o1 = K.reveal + 0.3;
        var bad = pts.some(function (a) {
          return o.side === 's' ? covered(b.x0 + a, b.y0 - o1) : o.side === 'n' ? covered(b.x0 + a, b.y1 + o1)
            : o.side === 'w' ? covered(b.x0 - o1, b.y0 + a) : covered(b.x1 + o1, b.y0 + a);
        });
        if (bad) return;
        var bx = horiz ? [b.x0 + a0, b.x0 + a1] : null, by = horiz ? null : [b.y0 + a0, b.y0 + a1];
        out.push({ side: o.side, kind: o.kind, z0: z0, z1: z1, x: bx, y: by,
          plane: o.side === 's' ? b.y0 : o.side === 'n' ? b.y1 : o.side === 'w' ? b.x0 : b.x1 });
      });
    });
    return out;
  }

  /* Walls as a solid on a rectilinear grid. Every boundary face is a whole grid face, so the mesh is closed by construction.
     cell states: 0 outside, 1 solid, 2 cut away for an opening (faces next to these are detail faces). */
  function bodyGrid(bl, pegs, hole, ops, W, D) {
    var bx = [0, W], by = [0, D], bz = [0], st = K.step, n, k;
    bl.forEach(function (b) { bx.push(b.x0, b.x1); by.push(b.y0, b.y1); bz.push(b.H); });
    pegs.forEach(function (g) {
      for (n = 0; n * 0.2 <= g.height + 1e-9; n++) { var h = K.peg / 2 - n * 0.2; bx.push(g.cx - h, g.cx + h); by.push(g.cy - h, g.cy + h); bz.push(g.H + n * 0.2); }
    });
    if (hole) { bx.push(hole.x0, hole.x1); by.push(hole.y0, hole.y1); }
    ops.forEach(function (o) {
      bz.push(o.z0, o.z1);
      for (n = 1; n * st < K.reveal + 1e-9; n++) bz.push(o.z1 - n * st);
      var ins = [];
      for (n = 1; n * st <= K.reveal + 1e-9; n++) ins.push(n * st);
      if (o.x) { bx.push(o.x[0], o.x[1]); ins.forEach(function (d) { by.push(o.side === 's' ? o.plane + d : o.plane - d); }); }
      else { by.push(o.y[0], o.y[1]); ins.forEach(function (d) { bx.push(o.side === 'w' ? o.plane + d : o.plane - d); }); }
    });
    var Hmax = 0; bl.forEach(function (b) { Hmax = Math.max(Hmax, b.H); }); pegs.forEach(function (g) { Hmax = Math.max(Hmax, g.H + g.height); });
    var xs = axis(bx, 0, 0, W), ys = axis(by, 0, 0, D), zs = axis(bz, 0, 0, Hmax);
    var nx = xs.length - 1, ny = ys.length - 1, nz = zs.length - 1, S = new Uint8Array(nx * ny * nz);
    function id(i, j, l) { return (l * ny + j) * nx + i; }
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2, top = -1;
      if (hole && cx > hole.x0 && cx < hole.x1 && cy > hole.y0 && cy < hole.y1) continue;
      for (k = 0; k < bl.length; k++) { var b = bl[k]; if (cx > b.x0 && cx < b.x1 && cy > b.y0 && cy < b.y1 && b.H > top) top = b.H; }
      if (top < 0) continue;
      var peg = null;
      for (k = 0; k < pegs.length; k++) if (pegs[k].H === top && Math.abs(cx - pegs[k].cx) < K.peg / 2 && Math.abs(cy - pegs[k].cy) < K.peg / 2) peg = pegs[k];
      var mine = ops.filter(function (o) { return o.x ? cx > o.x[0] && cx < o.x[1] : cy > o.y[0] && cy < o.y[1]; });
      for (var l = 0; l < nz; l++) {
        var cz = (zs[l] + zs[l + 1]) / 2, v = 0;
        if (cz < top) v = 1;
        else if (peg && cz < top + peg.height) { var dd = Math.max(Math.abs(cx - peg.cx), Math.abs(cy - peg.cy)); if (dd < K.peg / 2 - (cz - top) - 0.1) v = 1; }
        if (v === 1) for (k = 0; k < mine.length; k++) {
          var o = mine[k];
          if (cz <= o.z0 || cz >= o.z1) continue;
          var d = o.side === 's' ? cy - o.plane : o.side === 'n' ? o.plane - cy : o.side === 'w' ? cx - o.plane : o.plane - cx;
          if (d > 0 && d < K.reveal && d < o.z1 - cz) { v = 2; break; }
        }
        S[id(i, j, l)] = v;
      }
    }
    var T = [], Dt = [];
    function quad(arr, a, b, c, d) { arr.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]); }
    function nb(i, j, l) { return i < 0 || j < 0 || l < 0 || i >= nx || j >= ny || l >= nz ? 0 : S[id(i, j, l)]; }
    for (var l2 = 0; l2 < nz; l2++) for (var j2 = 0; j2 < ny; j2++) for (var i2 = 0; i2 < nx; i2++) {
      if (S[id(i2, j2, l2)] !== 1) continue;
      var x0 = xs[i2], x1 = xs[i2 + 1], y0 = ys[j2], y1 = ys[j2 + 1], z0 = zs[l2], z1 = zs[l2 + 1], m;
      m = nb(i2 + 1, j2, l2); if (m !== 1) { quad(T, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); if (m === 2) quad(Dt, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); }
      m = nb(i2 - 1, j2, l2); if (m !== 1) { quad(T, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); if (m === 2) quad(Dt, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); }
      m = nb(i2, j2 + 1, l2); if (m !== 1) { quad(T, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]); if (m === 2) quad(Dt, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]); }
      m = nb(i2, j2 - 1, l2); if (m !== 1) { quad(T, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); if (m === 2) quad(Dt, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); }
      m = nb(i2, j2, l2 + 1); if (m !== 1) { quad(T, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); if (m === 2) quad(Dt, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); }
      m = nb(i2, j2, l2 - 1); if (m !== 1) { quad(T, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]); if (m === 2) quad(Dt, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]); }
    }
    return { tris: new Float32Array(T), detail: new Float32Array(Dt) };
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

  function build(p, res) {
    var orn = !!p.ornament;
    var scale = orn ? ornamentScale(p) : p.scale === 'auto' || !p.scale ? pickScale(p) : +p.scale;
    var bl = toBlocks({ scale: scale, blocks: p.blocks });
    var W = 0, D = 0;
    bl.forEach(function (b) { W = Math.max(W, b.rx1); D = Math.max(D, b.ry1); });
    var hole = orn ? holeAt(bl) : null;
    function inHole(cx, cy) { return hole && cx > hole.x0 && cx < hole.x1 && cy > hole.y0 && cy < hole.y1; }
    if (orn && res > 0.4 && res <= 1) res = Math.max(0.4, res / 2);   // finer roof detail for the small version; coarse estimates stay coarse
    var pegs = orn ? [] : findPegs(bl), flags = [], parts = [];
    var levels = [];
    bl.forEach(function (b) { if (levels.indexOf(b.H) < 0) levels.push(b.H); });
    levels.sort(function (a, b) { return a - b; });

    // walls, with openings cut in when building at preview or print detail
    var ops = orn || res >= 2 ? [] : openingBoxes(bl);
    var body = bodyGrid(bl, pegs, hole, ops, W, D), bodyT = body.tris;
    var bs = stats(bodyT);
    parts.push({ kind: 'body', name: 'body', label: 'Walls', z0: 0, tris: bodyT, detail: body.detail, st: bs, grams: grams(bs) });

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
        function (x, y, cx, cy) { return inHole(cx, cy) ? -1 : roofTop(bl, L, x, y, cx, cy); },
        function (cx, cy) {
          for (var k = 0; k < sock.length; k++) {
            var dd = Math.max(Math.abs(cx - sock[k].cx), Math.abs(cy - sock[k].cy));
            if (dd < K.socket / 2) return q(Math.max(0, Math.min(sock[k].depth, K.socket / 2 - dd + 0.2)));
          }
          return 0;
        });
      if (!t.length) return;
      var st = stats(t), nm = levels.length > 1 ? 'roof-level-' + (li + 1) : 'roof';
      parts.push({ kind: 'roof', name: nm, label: levels.length > 1 ? 'Roof, level ' + (li + 1) : 'Roof', z0: L, tris: t, st: st, grams: grams(st) });
    });

    var H = 0, g = 0;
    parts.forEach(function (pt) { H = Math.max(H, pt.z0 + pt.st.max[2]); g += pt.grams; });
    var fits = (W <= BED.x && D <= BED.y) || (W <= BED.y && D <= BED.x);
    var minEave = Infinity, minSide = Infinity;
    bl.forEach(function (b) { if (b.e > 0) minEave = Math.min(minEave, b.e); minSide = Math.min(minSide, b.x1 - b.x0, b.y1 - b.y0); });
    if (ops.length) flags.push({ lvl: 'ok', text: ops.length + ' windows and doors cut ' + K.reveal + ' mm deep into the walls, with 45 degree heads so they print without support.' });
    flags.push(fits ? { lvl: 'ok', text: 'Fits the H2S bed (340 x 320 mm) in one piece per part.' }
      : { lvl: 'bad', text: 'Too big for the H2S bed at 1:' + scale + '. Pick a smaller scale.' });
    flags.push({ lvl: 'ok', text: 'No supports needed. Every part prints flat side down, and every surface, including the peg sockets, rises at 45 degrees or steeper.' });
    if (parts.length > 2) flags.push({ lvl: 'warn', text: (parts.length - 1) + ' roof pieces, one per storey level. Each prints flat.' });
    if (trimmed) flags.push({ lvl: 'warn', text: 'The lower roof is trimmed where it meets the taller walls, with 0.2 mm clearance.' });
    if (orn) flags.push({ lvl: 'ok', text: 'Christmas tree version at 1:' + scale + ', ' + Math.round(Math.max(W, D)) + ' mm across. A ' + K.hole + ' mm hole runs down through roof and walls: thread a ribbon through both and knot it under the walls.' });
    else if (pegs.length < bl.length) flags.push({ lvl: 'warn', text: 'Locating pegs on ' + pegs.length + ' of ' + bl.length + ' blocks. The rest sit loose or need a dab of glue.' });
    else flags.push({ lvl: 'ok', text: 'Locating peg under every roof block, so the roof drops into place.' });
    if (orn && levels.length > 1) flags.push({ lvl: 'warn', text: 'More than one roof level. Only parts the hole passes through are held by the ribbon; glue the rest.' });
    if (minEave < 0.8 && !orn) flags.push({ lvl: 'warn', text: 'Eaves are ' + minEave.toFixed(1) + ' mm at this scale and will read as a fine edge.' });
    if (minSide < 6) flags.push({ lvl: 'warn', text: 'One block is under 6 mm wide at this scale. Check it against the plans.' });
    if (H > BED.z) flags.push({ lvl: 'bad', text: 'Taller than the printer allows.' });
    return {
      scale: scale, ornament: orn, hole: hole, parts: parts, size: [W, D, H], grams: g, hours: g / 16 + 0.2 * parts.length,
      fits: fits, flags: flags, openings: ops.length, pegs: pegs.length, blocks: bl.length,
      tris: parts.reduce(function (a, pt) { return a + pt.tris.length / 9; }, 0)
    };
  }

  function stl(t) {
    var n = t.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf), o = 84, k, m;
    var mn = [Infinity, Infinity, Infinity];
    for (k = 0; k < t.length; k++) if (t[k] < mn[k % 3]) mn[k % 3] = t[k];
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
