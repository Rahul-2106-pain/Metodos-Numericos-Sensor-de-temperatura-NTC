/* ===================================================================
   roots.js — Fase 3: búsqueda de raíces (lógica pura, sin DOM)
   Bisección · Newton-Raphson · Secante

   Ecuación a resolver: el voltaje que predice el modelo Beta del divisor
   debe igualar el voltaje medido por el ADC:

       f(T) = Vcc · Rf / ( R25 · exp[ β (1/(T+273.15) − 1/298.15) ] + Rf ) − V = 0

   con V = N · LSB (lo único que la ECU conoce). Prueba con Node:
       node tests/roots.test.js
   =================================================================== */
(function (root) {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const C = isNode ? require('./core.js') : root.ECUCore;
  const CFG = isNode ? require('./config.js') : root.ECU_CONFIG;

  const K0 = 273.15;
  const T0 = 298.15;
  const cir = CFG.circuito;

  const DEFAULTS = { tol: 1e-4, maxIter: 50, a: -40, b: 150, x0: 25, s0: 0, s1: 50 };

  /* ---------- modelo ---------- */
  const rNtc = (T) => cir.r25 * Math.exp(cir.beta * (1 / (T + K0) - 1 / T0));
  /* Con el NTC arriba (a +Vcc) Vout sube con T (f′ > 0); con el NTC abajo (a tierra) baja (f′ < 0).
     La posición se lee en cada llamada desde config.js (circuito.ntcPosicion). */
  const abajo = () => cir.ntcPosicion === 'abajo';
  const vModel = (T) => {
    if (T + K0 <= 1e-6) return NaN;
    const R = rNtc(T);
    return cir.vcc * (abajo() ? R : cir.rFija) / (R + cir.rFija);
  };
  function dvModel(T) {                                   // f′(T)
    if (T + K0 <= 1e-6) return NaN;
    const R = rNtc(T);
    const dR = R * (-cir.beta / ((T + K0) * (T + K0)));
    const d = cir.vcc * cir.rFija * dR / Math.pow(R + cir.rFija, 2);
    return abajo() ? d : -d;
  }
  const makeF = (V) => (T) => vModel(T) - V;

  /* ---------- Bisección ---------- */
  function bisection(f, a, b, tol, maxIter) {
    const out = { method: 'biseccion', ok: true, converged: false, root: NaN, rows: [], errs: [], reason: '' };
    if (!(a < b)) { out.ok = false; out.reason = 'El extremo a debe ser menor que b.'; return out; }
    let fa = f(a);
    const fb = f(b);
    if (!isFinite(fa) || !isFinite(fb)) { out.ok = false; out.reason = 'f no está definida en los extremos del intervalo.'; return out; }
    if (fa * fb > 0) {
      out.ok = false;
      out.reason = 'f(a) y f(b) tienen el mismo signo (' + fa.toExponential(2) + ' y ' + fb.toExponential(2) + '): no hay raíz garantizada en [' + a + ', ' + b + '].';
      return out;
    }
    let lo = a; let hi = b;
    for (let k = 1; k <= maxIter; k++) {
      const c = (lo + hi) / 2;
      const fc = f(c);
      const err = (hi - lo) / 2;
      out.rows.push({ k, a: lo, b: hi, c, fc, err });
      out.errs.push(err);
      out.root = c;
      if (fc === 0 || err < tol) { out.converged = true; break; }
      if (fa * fc < 0) hi = c; else { lo = c; fa = fc; }
    }
    if (!out.converged) out.reason = 'No alcanzó la tolerancia en ' + maxIter + ' iteraciones.';
    return out;
  }

  /* ---------- Newton-Raphson ---------- */
  function newton(f, df, x0, tol, maxIter) {
    const out = { method: 'newton', ok: true, converged: false, root: NaN, rows: [], errs: [], reason: '' };
    let x = x0;
    for (let k = 1; k <= maxIter; k++) {
      const fx = f(x);
      const d = df(x);
      if (!isFinite(fx) || !isFinite(d) || d === 0) { out.ok = false; out.reason = 'En x = ' + x.toFixed(4) + ' la derivada no es válida (f′ = ' + d + '). Prueba otro valor inicial.'; return out; }
      const xn = x - fx / d;
      const err = Math.abs(xn - x);
      out.rows.push({ k, x, fx, dfx: d, xn, err });
      out.errs.push(err);
      x = xn;
      out.root = x;
      if (!isFinite(x) || Math.abs(x) > 1e4) { out.ok = false; out.reason = 'El método diverge (x = ' + x + '). Prueba otro valor inicial.'; return out; }
      if (err < tol || fx === 0) { out.converged = true; break; }
    }
    if (!out.converged && out.ok) out.reason = 'No alcanzó la tolerancia en ' + maxIter + ' iteraciones.';
    return out;
  }

  /* ---------- Secante ---------- */
  function secant(f, x0, x1, tol, maxIter) {
    const out = { method: 'secante', ok: true, converged: false, root: NaN, rows: [], errs: [], reason: '' };
    let xa = x0; let xb = x1;
    let fa = f(xa); let fb = f(xb);
    for (let k = 1; k <= maxIter; k++) {
      if (!isFinite(fa) || !isFinite(fb) || fb === fa) {
        out.ok = false; out.reason = 'f(x₀) = f(x₁): la recta secante es horizontal. Prueba otros valores iniciales.'; return out;
      }
      const xn = xb - fb * (xb - xa) / (fb - fa);
      const err = Math.abs(xn - xb);
      out.rows.push({ k, x0: xa, x1: xb, f0: fa, f1: fb, xn, err });
      out.errs.push(err);
      out.root = xn;
      if (!isFinite(xn) || Math.abs(xn) > 1e4) { out.ok = false; out.reason = 'El método diverge (x = ' + xn + '). Prueba otros valores iniciales.'; return out; }
      if (err < tol || fb === 0) { out.converged = true; break; }
      xa = xb; fa = fb; xb = xn; fb = f(xb);
    }
    if (!out.converged && out.ok) out.reason = 'No alcanzó la tolerancia en ' + maxIter + ' iteraciones.';
    return out;
  }

  /* ---------- Todo junto, para un código ADC ---------- */
  function solve(n, params) {
    const p = Object.assign({}, DEFAULTS, params || {});
    const V = C.voltageFromAdc(n);
    const f = makeF(V);
    const exact = C.tempFromAdcExact(n);      // despeje en forma cerrada (solo como referencia)
    return {
      n, V, params: p, exact,
      biseccion: bisection(f, p.a, p.b, p.tol, p.maxIter),
      newton: newton(f, dvModel, p.x0, p.tol, p.maxIter),
      secante: secant(f, p.s0, p.s1, p.tol, p.maxIter)
    };
  }

  const API = { DEFAULTS, rNtc, vModel, dvModel, makeF, bisection, newton, secant, solve };
  if (isNode) module.exports = API;
  else root.ECURoots = API;
})(typeof self !== 'undefined' ? self : this);
