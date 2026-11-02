/* Pruebas de la lógica pura:  node tests/core.test.js */
'use strict';
const assert = require('assert');
const C = require('../js/core.js');
const CFG = require('../js/config.js');
// Nodos de prueba (los 5 códigos del informe, con el emparejamiento del texto: N sube al enfriarse)
const FIXTURE = [[350, 40], [403, 35], [456, 30], [512, 25], [570, 20]];

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ✔', name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' esperado ' + b + ' ± ' + tol + ', obtenido ' + a);

console.log('core.js');

test('ADC: 2.34375 V → 480 y binario 0111100000', () => {
  assert.strictEqual(C.adcFromVoltage(2.34375), 480);
  assert.strictEqual(C.toBinary(480), '0111100000');
  assert.strictEqual(C.adcFromVoltage(0), 0);
  assert.strictEqual(C.adcFromVoltage(5), 1023);
  assert.strictEqual(C.adcFromVoltage(7), 1023);
  assert.strictEqual(C.adcFromVoltage(-1), 0);
  near(C.LSB * 1000, 4.8828, 0.001, 'LSB mV');
});

test('SAR reproduce exactamente N para los 1024 códigos', () => {
  for (let n = 0; n <= 1023; n++) {
    const r = C.sarSteps(n);
    assert.strictEqual(r.result, n);
    assert.strictEqual(r.steps.length, 10);
    assert.strictEqual(C.toBinary(r.result), C.toBinary(n));
  }
});

test('Divisor y ecuación Beta: a 25 °C Vout = 2.5 V → N = 512', () => {
  near(C.rNtc(25), 10000, 1e-6, 'R25');
  near(C.voutFromR(C.rNtc(25)), 2.5, 1e-9, 'Vout');
  assert.strictEqual(C.adcFromTemp(25), 512);
  near(C.tempFromAdcExact(512), 25, 0.01, 'T inversa');
});

test('Tabla Beta es estrictamente creciente en ADC', () => {
  [5, 10].forEach((step) => {
    const t = C.generateBetaTable(-20, 120, step);
    assert.ok(t.length >= 15);
    for (let i = 1; i < t.length; i++) assert.ok(t[i].n > t[i - 1].n, 'paso ' + step + ' idx ' + i);
  });
});

test('locate: exacto, entre nodos, fuera de rango', () => {
  const nodes = FIXTURE.map((p) => ({ n: p[0], t: p[1] }));
  assert.deepStrictEqual(C.locate(nodes, 456), { status: 'exact', index: 2, lower: 2, upper: 2 });
  assert.deepStrictEqual(C.locate(nodes, 480), { status: 'between', lower: 2, upper: 3 });
  assert.strictEqual(C.locate(nodes, 10).status, 'below');
  assert.strictEqual(C.locate(nodes, 900).status, 'above');
});

test('selectNodes: N = 480 elige 403, 456, 512', () => {
  const nodes = FIXTURE.map((p) => ({ n: p[0], t: p[1] }));
  const idx = C.selectNodes(nodes, 480, 3);
  assert.deepStrictEqual(idx.map((i) => nodes[i].n), [403, 456, 512]);
});

test('selectNodes: siempre incluye los dos nodos que encierran la lectura', () => {
  const nodes = [0, 1, 2, 100].map((n) => ({ n, t: n }));
  const idx = C.selectNodes(nodes, 60, 3);
  assert.ok(idx.includes(2) && idx.includes(3));
});

test('toNumber: formatos habituales', () => {
  assert.strictEqual(C.toNumber('3,5'), 3.5);
  assert.strictEqual(C.toNumber('1,234.5'), 1234.5);
  assert.strictEqual(C.toNumber(' 25 °C'), 25);
  assert.strictEqual(C.toNumber('2.5V'), 2.5);
  assert.ok(isNaN(C.toNumber('ADC')));
  assert.ok(isNaN(C.toNumber('V')));
  assert.ok(isNaN(C.toNumber('')));
  assert.ok(isNaN(C.toNumber(null)));
});

test('CSV con coma, punto y coma, tabulador y espacios', () => {
  const variants = [
    'ADC,Temp\n350,20\n403,25\n456,30',
    'ADC;Temp\n350;20\n403;25\n456;30',
    'ADC\tTemp\n350\t20\n403\t25\n456\t30',
    '350 20\n403 25\n456 30',
    '﻿"ADC","Temp"\r\n"350","20"\r\n"403","25"\r\n"456","30"'
  ];
  variants.forEach((v, i) => {
    const ex = C.extractPoints(C.parseDelimitedText(v));
    assert.strictEqual(ex.points.length, 3, 'variante ' + i);
    assert.deepStrictEqual(ex.points[1], { x: 403, y: 25 }, 'variante ' + i);
  });
});

test('Coma decimal con ";" y con espacio', () => {
  let ex = C.extractPoints(C.parseDelimitedText('1,5;20\n2,5;25\n3,5;30'));
  assert.deepStrictEqual(ex.points[0], { x: 1.5, y: 20 });
  ex = C.extractPoints(C.parseDelimitedText('1,5 20\n2,5 25\n3,5 30'));
  assert.deepStrictEqual(ex.points[2], { x: 3.5, y: 30 });
});

test('guessLayout detecta orden y unidad por los encabezados', () => {
  assert.deepStrictEqual(C.guessLayout(['ADC', 'Temperatura (°C)']), { swap: false, xUnit: 'adc' });
  assert.deepStrictEqual(C.guessLayout(['Temperatura', 'Código ADC']), { swap: true, xUnit: 'adc' });
  assert.deepStrictEqual(C.guessLayout(['Voltaje (V)', 'Temp']), { swap: false, xUnit: 'volt' });
  assert.deepStrictEqual(C.guessLayout(['Temp °C', 'Vout (V)']), { swap: true, xUnit: 'volt' });
  assert.deepStrictEqual(C.guessLayout(null), { swap: false, xUnit: 'adc' });
});

test('buildTable: ordena, convierte voltaje y valida', () => {
  let r = C.buildTable([{ x: 456, y: 30 }, { x: 350, y: 20 }, { x: 403, y: 25 }]);
  assert.deepStrictEqual(r.nodes.map((p) => p.n), [350, 403, 456]);
  assert.strictEqual(r.errors.length, 0);

  r = C.buildTable([{ x: 2.5, y: 25 }, { x: 1, y: 10 }, { x: 4, y: 60 }], { xUnit: 'volt' });
  assert.deepStrictEqual(r.nodes.map((p) => p.n), [204.8, 512, 819.2]);

  r = C.buildTable([{ x: 20, y: 350 }, { x: 25, y: 403 }, { x: 30, y: 456 }], { swap: true });
  assert.deepStrictEqual(r.nodes.map((p) => p.n), [350, 403, 456]);

  assert.ok(C.buildTable([{ x: 1, y: 1 }, { x: 2, y: 2 }]).errors.length > 0);
  assert.ok(C.buildTable([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 3, y: 3 }]).errors.length > 0);
  assert.ok(C.buildTable([{ x: 100, y: 10 }, { x: 200, y: 5 }, { x: 300, y: 20 }]).warnings.length > 0);
  assert.ok(C.buildTable([{ x: 100, y: 10 }, { x: 2000, y: 20 }, { x: 3000, y: 30 }]).warnings.length > 0);
});

test('Zonas de la ECU según los umbrales configurados (70 / 100 / 110 °C)', () => {
  assert.strictEqual(C.ecuZone(-20).id, 'calentamiento');
  assert.strictEqual(C.ecuZone(69.99).id, 'calentamiento');
  assert.strictEqual(C.ecuZone(70).id, 'normal');
  assert.strictEqual(C.ecuZone(99.99).id, 'normal');
  assert.strictEqual(C.ecuZone(100).id, 'ventilador');
  assert.strictEqual(C.ecuZone(109.99).id, 'ventilador');
  assert.strictEqual(C.ecuZone(110).id, 'sobrecalentamiento');
  assert.strictEqual(C.ecuZone(150).id, 'sobrecalentamiento');
});

test('Cada zona define luces y salidas completas', () => {
  CFG.zonasEcu.concat([CFG.zonaFalla]).forEach((z) => {
    assert.ok(Array.isArray(z.luces) && z.accion && z.nombre && z.color, z.id);
    ['inyeccion', 'ventilador', 'ralenti', 'lazo', 'mil'].forEach((k) => assert.ok(z.salidas[k], z.id + '.' + k));
  });
});

test('NTC abajo: Vout baja al calentarse, la tabla Beta sigue ordenada por ADC y la inversa cuadra', () => {
  const prev = CFG.circuito.ntcPosicion;
  try {
    CFG.circuito.ntcPosicion = 'abajo';
    assert.ok(C.adcFromTemp(40) < C.adcFromTemp(20));
    assert.strictEqual(C.adcFromTemp(25), 512);
    const t = C.generateBetaTable(-20, 120, 10);
    for (let i = 1; i < t.length; i++) { assert.ok(t[i].n > t[i - 1].n); assert.ok(t[i].t < t[i - 1].t); }
    near(C.tempFromAdcExact(480), 27.83, 0.01, 'T con N=480 y NTC abajo');
    [100, 300, 512, 800].forEach((n) => near(C.adcFromTemp(C.tempFromAdcExact(n)), n, 1, 'ida y vuelta N=' + n));
  } finally { CFG.circuito.ntcPosicion = prev; }
  near(C.tempFromAdcExact(480), 22.22, 0.01, 'T con N=480 y NTC arriba');
});

console.log('\n' + passed + ' pruebas correctas');
