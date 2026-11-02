/* ===================================================================
   methods.js — Fase 2: métodos de interpolación (lógica pura, sin DOM)
   Lagrange · Diferencias divididas de Newton · Matricial (Vandermonde)
   · Splines cúbicos naturales  (+ lineal por tramos como referencia).
   Cada método devuelve { value, lines } donde `lines` son los pasos
   con los números ya reemplazados (HTML listo para mostrar).
   Prueba con Node:  node tests/methods.test.js
   =================================================================== */
(function (root) {
  'use strict';

  const C = (typeof module === 'object' && module.exports) ? require('./core.js') : root.ECUCore;

  /* ---------- formato ---------- */
  const s = (x) => (Number.isInteger(x) ? String(x) : String(+x.toFixed(4)));
  const num = (x, d) => {
    d = d === undefined ? 4 : d;
    if (!isFinite(x)) return '—';
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e7 || a < 1e-3) return x.toExponential(3);
    return x.toFixed(d);
  };
  const par = (x) => (x < 0 ? '(' + s(x) + ')' : s(x));
  const parN = (x, d) => (x < 0 ? '(' + num(x, d) + ')' : num(x, d));
  const minus = (a, b) => '(' + s(a) + ' − ' + par(b) + ')';
  const pad = (str, w) => String(str).padStart(w, ' ');

  /* ---------- Lagrange ---------- */
  function lagrange(P, x) {
    const lines = [];
    const Ls = [];
    let value = 0;
    P.forEach((pi, i) => {
      let numv = 1; let denv = 1; let ns = ''; let ds = '';
      P.forEach((pj, j) => {
        if (j === i) return;
        numv *= (x - pj.n); denv *= (pi.n - pj.n);
        ns += minus(x, pj.n); ds += minus(pi.n, pj.n);
      });
      const L = numv / denv;
      Ls.push(L);
      value += pi.t * L;
      lines.push('L<sub>' + i + '</sub>(x) = ' + ns + ' / (' + ds + ') = ' + num(numv, 2) + ' / ' + num(denv, 2) +
        ' = <b>' + num(L, 6) + '</b>');
    });
    lines.push('P(x) = ' + P.map((p, i) => par(p.t) + '·' + parN(Ls[i], 6)).join(' + ') + ' = <b>' + num(value, 4) + ' °C</b>');
    return { value, lines, L: Ls };
  }

  /* ---------- Newton (diferencias divididas) ---------- */
  function newton(P, x) {
    const n = P.length;
    const dd = [P.map((p) => p.t)];
    for (let k = 1; k < n; k++) {
      const prev = dd[k - 1];
      const cur = [];
      for (let i = 0; i < n - k; i++) cur.push((prev[i + 1] - prev[i]) / (P[i + k].n - P[i].n));
      dd.push(cur);
    }
    const coef = dd.map((col) => col[0]);

    let table = pad('x<sub>i</sub>', 9);
    for (let k = 0; k < n; k++) table += pad('f[' + new Array(k + 1).fill('·').join(',') + ']', 13);
    table += '\n';
    for (let i = 0; i < n; i++) {
      table += pad(s(P[i].n), 6);
      for (let k = 0; k < n; k++) table += pad(i < n - k ? num(dd[k][i], 6) : '', 13);
      table += '\n';
    }

    let value = coef[0]; let prod = 1;
    const numeric = [];
    for (let k = 0; k < n; k++) {
      if (k > 0) { prod *= (x - P[k - 1].n); value += coef[k] * prod; }
      let fs = '';
      for (let m = 0; m < k; m++) fs += minus(x, P[m].n);
      numeric.push(k === 0 ? num(coef[0], 6) : parN(coef[k], 6) + '·' + fs);
    }
    const lines = [];
    lines.push('<pre class="mat">' + table.replace(/\n$/, '') + '</pre>');
    lines.push('Coeficientes (primera fila): ' + coef.map((c, k) => 'c<sub>' + k + '</sub> = ' + num(c, 6)).join(' · '));
    lines.push('P(x) = c<sub>0</sub> + c<sub>1</sub>(x − x<sub>0</sub>)' + (n > 2 ? ' + c<sub>2</sub>(x − x<sub>0</sub>)(x − x<sub>1</sub>)' : '') + (n > 3 ? ' + c<sub>3</sub>(x − x<sub>0</sub>)(x − x<sub>1</sub>)(x − x<sub>2</sub>)' : ''));
    lines.push('P(' + s(x) + ') = ' + numeric.join(' + ') + ' = <b>' + num(value, 4) + ' °C</b>');
    return { value, lines, coef, dd };
  }

  /* ---------- Matricial (Vandermonde) ---------- */
  function gauss(A0, b0) {
    const n = b0.length;
    const A = A0.map((r, i) => r.concat([b0[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-300) throw new Error('Matriz singular');
      if (p !== c) { const t = A[p]; A[p] = A[c]; A[c] = t; }
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let sum = A[r][n];
      for (let k = r + 1; k < n; k++) sum -= A[r][k] * x[k];
      x[r] = sum / A[r][r];
    }
    return x;
  }

  function matricial(P, x) {
    const n = P.length;
    const V = P.map((p) => { const row = []; for (let j = 0; j < n; j++) row.push(Math.pow(p.n, j)); return row; });
    const y = P.map((p) => p.t);
    const a = gauss(V, y);
    let value = 0;
    a.forEach((aj, j) => { value += aj * Math.pow(x, j); });
    let resid = 0;
    V.forEach((row, i) => {
      let r = -y[i];
      row.forEach((v, j) => { r += v * a[j]; });
      resid = Math.max(resid, Math.abs(r));
    });

    const cells = V.map((row) => row.map((v) => (Number.isInteger(v) ? String(v) : num(v, 2))));
    const w = Math.max.apply(null, cells.map((r) => Math.max.apply(null, r.map((c) => c.length)))) + 2;
    let sys = '';
    for (let i = 0; i < n; i++) {
      sys += '[' + cells[i].map((c) => pad(c, w)).join('') + ' ] [a' + i + ']' + (i === Math.floor(n / 2) ? ' = ' : '   ') + '[' + pad(s(y[i]), 4) + ']\n';
    }
    const lines = [];
    lines.push('Sistema V·a = y, con V<sub>ij</sub> = x<sub>i</sub><sup>j</sup> (matriz de Vandermonde):');
    lines.push('<pre class="mat">' + sys.replace(/\n$/, '') + '</pre>');
    lines.push('Se resuelve por eliminación gaussiana con pivoteo parcial: ' + a.map((aj, j) => 'a<sub>' + j + '</sub> = ' + num(aj, 6)).join(' · '));
    const poly = a.map((aj, j) => parN(aj, 6) + (j === 0 ? '' : j === 1 ? '·' + par(x) : '·' + par(x) + '<sup>' + j + '</sup>')).join(' + ');
    lines.push('P(' + s(x) + ') = ' + poly + ' = <b>' + num(value, 4) + ' °C</b>');
    lines.push('Verificación: máx |V·a − y| ' + (resid < 1e-9 ? '≈ 0' : '= ' + num(resid, 6)));
    return { value, lines, a, V, resid };
  }

  /* ---------- Splines cúbicos naturales ---------- */
  function spline(nodes, x) {
    const n = nodes.length;
    const X = nodes.map((p) => p.n);
    const Y = nodes.map((p) => p.t);
    const h = [];
    for (let i = 0; i < n - 1; i++) h.push(X[i + 1] - X[i]);
    const Mv = new Array(n).fill(0);
    if (n > 2) {
      const m = n - 2;
      const a = []; const b = []; const c = []; const d = [];
      for (let r = 0; r < m; r++) {
        const i = r + 1;
        a.push(h[i - 1]); b.push(2 * (h[i - 1] + h[i])); c.push(h[i]);
        d.push(6 * ((Y[i + 1] - Y[i]) / h[i] - (Y[i] - Y[i - 1]) / h[i - 1]));
      }
      for (let r = 1; r < m; r++) {                 // algoritmo de Thomas
        const w = a[r] / b[r - 1];
        b[r] -= w * c[r - 1]; d[r] -= w * d[r - 1];
      }
      const sol = new Array(m);
      sol[m - 1] = d[m - 1] / b[m - 1];
      for (let r = m - 2; r >= 0; r--) sol[r] = (d[r] - c[r] * sol[r + 1]) / b[r];
      for (let r = 0; r < m; r++) Mv[r + 1] = sol[r];
    }
    let k = n - 2;
    for (let i = 0; i < n - 1; i++) { if (x <= X[i + 1]) { k = i; break; } }
    const A0 = Y[k];
    const B0 = (Y[k + 1] - Y[k]) / h[k] - h[k] * (2 * Mv[k] + Mv[k + 1]) / 6;
    const C0 = Mv[k] / 2;
    const D0 = (Mv[k + 1] - Mv[k]) / (6 * h[k]);
    const t = x - X[k];
    const value = A0 + B0 * t + C0 * t * t + D0 * t * t * t;

    const lines = [];
    lines.push('Spline natural con los ' + n + ' nodos: cada tramo es un cúbico S<sub>k</sub>(x) y se exige continuidad de S, S′ y S″, con S″ = 0 en los extremos.');
    if (n > 2) lines.push('Se resuelve un sistema tridiagonal de ' + (n - 2) + '×' + (n - 2) + ' para las segundas derivadas M<sub>i</sub> (algoritmo de Thomas).');
    lines.push('N = ' + s(x) + ' cae en el tramo k = ' + k + ' [' + s(X[k]) + ', ' + s(X[k + 1]) + '], h = ' + s(h[k]) +
      ' · M<sub>' + k + '</sub> = ' + num(Mv[k], 6) + ', M<sub>' + (k + 1) + '</sub> = ' + num(Mv[k + 1], 6));
    lines.push('S<sub>k</sub>(x) = a + b·t + c·t² + d·t³, con t = x − x<sub>k</sub> = ' + s(x) + ' − ' + par(X[k]) + ' = ' + s(t));
    lines.push('a = ' + num(A0, 6) + ' · b = ' + num(B0, 6) + ' · c = ' + num(C0, 6) + ' · d = ' + num(D0, 8));
    lines.push('S(' + s(x) + ') = ' + num(A0, 6) + ' + ' + parN(B0, 6) + '·' + par(t) + ' + ' + parN(C0, 6) + '·' + par(t) + '² + ' +
      parN(D0, 8) + '·' + par(t) + '³ = <b>' + num(value, 4) + ' °C</b>');
    return { value, lines, M: Mv, k, coeffs: { a: A0, b: B0, c: C0, d: D0 } };
  }

  /* ---------- Lineal por tramos (referencia: lo que haría una ECU simple) ---------- */
  function linear(nodes, x) {
    const loc = C.locate(nodes, x);
    if (loc.status === 'exact') return { value: nodes[loc.index].t, lines: ['Coincide con un nodo: T = ' + s(nodes[loc.index].t) + ' °C'] };
    const p0 = nodes[loc.lower]; const p1 = nodes[loc.upper];
    const value = p0.t + (p1.t - p0.t) / (p1.n - p0.n) * (x - p0.n);
    return {
      value,
      lines: ['T = T<sub>0</sub> + (T<sub>1</sub> − T<sub>0</sub>)/(N<sub>1</sub> − N<sub>0</sub>)·(N − N<sub>0</sub>) = ' + s(p0.t) + ' + (' + s(p1.t) + ' − ' + s(p0.t) + ')/(' +
        s(p1.n) + ' − ' + s(p0.n) + ')·(' + s(x) + ' − ' + s(p0.n) + ') = <b>' + num(value, 4) + ' °C</b>']
    };
  }

  /* ---------- Todo junto ---------- */
  function compute(nodes, x, degree) {
    const deg = Math.max(1, Math.min(degree, nodes.length - 1));
    const idx = C.selectNodes(nodes, x, deg + 1);
    const P = idx.map((i) => nodes[i]);
    const res = {
      x, degree: deg, idx, P,
      lagrange: lagrange(P, x), newton: newton(P, x), matricial: matricial(P, x),
      spline: spline(nodes, x), linear: linear(nodes, x)
    };
    const v = [res.lagrange.value, res.newton.value, res.matricial.value];
    res.polyDiff = Math.max.apply(null, v) - Math.min.apply(null, v);
    return res;
  }

  const API = { lagrange, newton, matricial, spline, linear, compute, gauss, num, s, par };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else root.ECUMethods = API;
})(typeof self !== 'undefined' ? self : this);
