/* Pruebas de los métodos de raíces:  node tests/roots.test.js */
'use strict';
const assert = require('assert');
const C = require('../js/core.js');
const R = require('../js/roots.js');
const CFG = require('../js/config.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ✔', name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' esperado ' + b + ' ± ' + tol + ', obtenido ' + a);

console.log('roots.js');

test('El modelo reproduce el divisor: 25 °C → 2.5 V y f′ > 0 (NTC arriba)', () => {
  near(R.vModel(25), 2.5, 1e-9);
  for (let t = -40; t <= 150; t += 10) assert.ok(R.dvModel(t) > 0, 'f′ en ' + t);
});

test('f′ analítica coincide con la derivada numérica', () => {
  [-30, 0, 25, 60, 120].forEach((t) => {
    const h = 1e-5;
    near(R.dvModel(t), (R.vModel(t + h) - R.vModel(t - h)) / (2 * h), 1e-7, 'T=' + t);
  });
});

test('N = 480: los tres métodos encuentran 22.2201 °C', () => {
  const r = R.solve(480);
  near(r.exact, 22.220066, 1e-5, 'forma cerrada');
  ['biseccion', 'newton', 'secante'].forEach((m) => {
    assert.ok(r[m].ok && r[m].converged, m);
    near(r[m].root, r.exact, 1e-4, m);
  });
});

test('Bisección: el error baja a la mitad en cada paso y para en ⌈log2((b−a)/tol)⌉', () => {
  const r = R.solve(480, { tol: 1e-6 });
  const e = r.biseccion.errs;
  for (let i = 1; i < e.length; i++) near(e[i] / e[i - 1], 0.5, 1e-12);
  // error tras k pasos = 190 / 2^k  →  se necesitan ⌈log2(190 / tol)⌉ iteraciones
  assert.strictEqual(e.length, Math.ceil(Math.log2(190 / 1e-6)));
});

test('Newton converge cuadráticamente (el error se eleva al cuadrado)', () => {
  const r = R.solve(300, { tol: 1e-12, x0: 60 });
  const e = r.newton.errs;
  assert.ok(r.newton.converged && e.length <= 10);
  // cuando el error ya es pequeño, e_{k+1} ≈ C·e_k²
  for (let i = 1; i < e.length - 1; i++) if (e[i] < 1e-2 && e[i] > 1e-9) assert.ok(e[i + 1] < 5 * e[i] * e[i] + 1e-14, 'paso ' + i);
});

test('Barrido ADC 25–1003: Newton y secante convergen y coinciden con la forma cerrada', () => {
  let worst = 0;
  for (let n = 25; n <= 1003; n++) {
    const r = R.solve(n, { tol: 1e-8 });
    ['biseccion', 'newton', 'secante'].forEach((m) => {
      assert.ok(r[m].ok && r[m].converged, m + ' N=' + n + ' ' + r[m].reason);
      worst = Math.max(worst, Math.abs(r[m].root - r.exact));
    });
  }
  assert.ok(worst < 1e-6, 'peor error ' + worst);
});

test('Bisección avisa cuando no hay cambio de signo (falla del sensor)', () => {
  const lo = R.solve(5);       // casi 0 V → temperatura muy por debajo de −40 °C
  assert.strictEqual(lo.biseccion.ok, false);
  assert.ok(/mismo signo/.test(lo.biseccion.reason));
  const hi = R.solve(1020);    // casi 5 V
  assert.strictEqual(hi.biseccion.ok, false);
});

test('Newton: derivada inválida o divergencia se reportan sin romper', () => {
  const r = R.newton((x) => x * x + 1, (x) => 2 * x, 0, 1e-6, 20);
  assert.strictEqual(r.ok, false);
  assert.ok(/derivada/.test(r.reason));
});

test('Secante: f(x₀) = f(x₁) se reporta', () => {
  const r = R.secant((x) => 5, 1, 2, 1e-6, 20);
  assert.strictEqual(r.ok, false);
});

test('Tolerancia más estricta pide más iteraciones', () => {
  const a = R.solve(480, { tol: 1e-2 });
  const b = R.solve(480, { tol: 1e-8 });
  ['biseccion', 'newton', 'secante'].forEach((m) => assert.ok(b[m].rows.length >= a[m].rows.length, m));
});

test('maxIter corto: converged = false con mensaje', () => {
  const r = R.solve(480, { maxIter: 3, tol: 1e-10 });
  assert.strictEqual(r.biseccion.converged, false);
  assert.ok(/iteraciones/.test(r.biseccion.reason));
});

test('NTC abajo: f′ < 0 y los tres métodos siguen convergiendo a la forma cerrada', () => {
  const prev = CFG.circuito.ntcPosicion;
  try {
    CFG.circuito.ntcPosicion = 'abajo';
    near(R.vModel(25), 2.5, 1e-9);
    for (let t = -40; t <= 150; t += 10) assert.ok(R.dvModel(t) < 0, 'f′ en ' + t);
    [-5, 40, 90].forEach((t) => near(R.dvModel(t), (R.vModel(t + 1e-5) - R.vModel(t - 1e-5)) / 2e-5, 1e-7));
    for (let n = 40; n <= 990; n += 25) {
      const r = R.solve(n, { tol: 1e-8 });
      ['biseccion', 'newton', 'secante'].forEach((m) => {
        assert.ok(r[m].ok && r[m].converged, m + ' N=' + n + ' ' + r[m].reason);
        near(r[m].root, r.exact, 1e-6, m + ' N=' + n);
      });
    }
  } finally { CFG.circuito.ntcPosicion = prev; }
});

console.log('\n' + passed + ' pruebas correctas');
