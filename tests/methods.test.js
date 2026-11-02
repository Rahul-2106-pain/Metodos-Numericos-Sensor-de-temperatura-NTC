/* Pruebas de los métodos de interpolación:  node tests/methods.test.js */
'use strict';
const assert = require('assert');
const C = require('../js/core.js');
const M = require('../js/methods.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ✔', name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' esperado ' + b + ' ± ' + tol + ', obtenido ' + a);
// Nodos de prueba con N creciente y T creciente (curva suave y monótona)
const informe = [[350, 20], [403, 25], [456, 30], [512, 35], [570, 40]].map((p) => ({ n: p[0], t: p[1] }));

console.log('methods.js');

test('Informe, N = 480, grado 2: Lagrange = Newton = matricial', () => {
  const r = M.compute(informe, 480, 2);
  assert.deepStrictEqual(r.P.map((p) => p.n), [403, 456, 512]);
  near(r.lagrange.value, r.newton.value, 1e-9, 'L vs N');
  near(r.lagrange.value, r.matricial.value, 1e-8, 'L vs M');
  assert.ok(r.polyDiff < 1e-8);
  // a mano: 25·(−768/5777) + 30·(2464/2968) + 35·(1848/6104) = 32.1785
  near(r.lagrange.value, 25 * (-768 / 5777) + 30 * (2464 / 2968) + 35 * (1848 / 6104), 1e-9, 'valor a mano');
  near(r.lagrange.value, 32.1785, 5e-4, 'valor');
  near(r.linear.value, 30 + 5 * (480 - 456) / 56, 1e-9, 'lineal por tramos (tramo 456–512)');
});

test('Polinomio de grado 2 reproduce exactamente una parábola', () => {
  const f = (x) => 0.0004 * x * x - 0.1 * x + 20;
  const nodes = [100, 220, 330, 470, 600].map((n) => ({ n, t: f(n) }));
  const r = M.compute(nodes, 400, 2);
  near(r.lagrange.value, f(400), 1e-9);
  near(r.newton.value, f(400), 1e-9);
  near(r.matricial.value, f(400), 1e-7);
});

test('Grado 3 reproduce exactamente una cúbica', () => {
  const f = (x) => 1e-7 * x * x * x - 2e-4 * x * x + 0.05 * x + 3;
  const nodes = [50, 180, 300, 420, 600, 800].map((n) => ({ n, t: f(n) }));
  const r = M.compute(nodes, 350, 3);
  assert.strictEqual(r.P.length, 4);
  near(r.lagrange.value, f(350), 1e-9);
  near(r.newton.value, f(350), 1e-9);
  near(r.matricial.value, f(350), 1e-6);
});

test('Todos los métodos devuelven el valor del nodo en un nodo', () => {
  [350, 403, 456, 512, 570].forEach((n, i) => {
    const r = M.compute(informe, n, 2);
    const y = informe[i].t;
    near(r.lagrange.value, y, 1e-9);
    near(r.newton.value, y, 1e-9);
    near(r.matricial.value, y, 1e-8);
    near(r.spline.value, y, 1e-9);
    near(r.linear.value, y, 1e-12);
  });
});

test('Spline natural reproduce una recta exactamente', () => {
  const nodes = [100, 200, 350, 500, 800].map((n) => ({ n, t: 0.03 * n + 4 }));
  near(M.spline(nodes, 420).value, 0.03 * 420 + 4, 1e-9);
  near(M.spline(nodes, 101.5).value, 0.03 * 101.5 + 4, 1e-9);
});

test('Spline: continuidad en los nodos interiores (S, S′, S″)', () => {
  const nodes = C.generateBetaTable(-20, 120, 10);
  const eps = 1e-6;
  for (let i = 1; i < nodes.length - 1; i++) {
    const x = nodes[i].n;
    const l = M.spline(nodes, x - eps).value;
    const r = M.spline(nodes, x + eps).value;
    near(l, r, 1e-4, 'continuidad en ' + x);
    near(M.spline(nodes, x).value, nodes[i].t, 1e-9);
  }
  const sp = M.spline(nodes, nodes[3].n + 3);
  near(sp.M[0], 0, 0, 'M0');
  near(sp.M[nodes.length - 1], 0, 0, 'Mn');
});

test('Spline con tabla del informe (3+ nodos) está entre los vecinos', () => {
  const v = M.spline(informe, 480).value;
  assert.ok(v > 30 && v < 35, 'valor ' + v);
});

test('Tabla Beta: los métodos recuperan la temperatura real con error pequeño', () => {
  const nodes = C.generateBetaTable(-20, 120, 5);
  [300, 480, 600, 700].forEach((n) => {
    const exact = C.tempFromAdcExact(n);
    const sp = M.spline(nodes, n).value;
    near(sp, exact, 0.2, 'spline N=' + n);
    const r = M.compute(nodes, n, 3);
    near(r.lagrange.value, exact, 0.3, 'lagrange N=' + n);
  });
});

test('Gauss resuelve un sistema conocido', () => {
  const x = M.gauss([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], [8, -11, -3]);
  near(x[0], 2, 1e-12); near(x[1], 3, 1e-12); near(x[2], -1, 1e-12);
});

test('compute limita el grado cuando hay pocos nodos', () => {
  const r = M.compute(informe.slice(0, 3), 380, 3);
  assert.strictEqual(r.degree, 2);
  assert.strictEqual(r.P.length, 3);
});

test('Los pasos se generan como texto no vacío', () => {
  const r = M.compute(informe, 480, 2);
  ['lagrange', 'newton', 'matricial', 'spline', 'linear'].forEach((k) => {
    assert.ok(r[k].lines.length >= 1, k);
    assert.ok(r[k].lines.join('').includes('°C'), k + ' sin resultado en °C');
  });
});

console.log('\n' + passed + ' pruebas correctas');
