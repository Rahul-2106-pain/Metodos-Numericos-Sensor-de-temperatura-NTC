/* ===================================================================
   core.js — lógica pura (sin DOM): ADC, ecuación Beta, lectura de tablas
   y búsqueda en la Look-Up Table. Se puede probar con Node:
       node tests/core.test.js
   =================================================================== */
(function (root) {
  'use strict';

  const CFG = (typeof module === 'object' && module.exports)
    ? require('./config.js')
    : root.ECU_CONFIG;

  /* ---------- Constantes del conversor ---------- */
  const BITS = CFG.adc.bits;               // 10
  const LEVELS = Math.pow(2, BITS);        // 1024 niveles
  const MAX_CODE = LEVELS - 1;             // 1023
  const VREF = CFG.adc.vref;               // 5 V
  const LSB = VREF / LEVELS;               // 4.8828 mV por cuenta

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  /* ---------- Conversión analógico → digital ---------- */
  // N = ⌊ Vin / Vref · 1024 ⌋ limitado a [0, 1023]  (así lo hace analogRead)
  function adcFromVoltage(v) {
    if (!isFinite(v)) return 0;
    return clamp(Math.floor(v / VREF * LEVELS + 1e-9), 0, MAX_CODE);
  }
  const voltageFromAdc = (n) => n * LSB;
  const toBinary = (n, bits) => n.toString(2).padStart(bits || BITS, '0');

  /* Aproximaciones sucesivas (SAR): prueba bit a bit desde el MSB.
     Cada paso compara el voltaje del DAC interno con Vin. */
  function sarSteps(n, bits) {
    const nb = bits || BITS;
    const steps = [];
    let acc = 0;
    for (let k = nb - 1; k >= 0; k--) {
      const weight = 1 << k;
      const trial = acc + weight;
      const keep = trial <= n;           // V_DAC ≤ Vin ⇔ trial ≤ N
      if (keep) acc = trial;
      steps.push({ bit: k, weight, trial, vdac: trial * LSB, keep, acc });
    }
    return { steps, result: acc };
  }

  /* ---------- Sensor NTC y divisor (NTC arriba, R fija abajo) ---------- */
  const T0 = 298.15; // 25 °C en kelvin
  function rNtc(tC) {
    return CFG.circuito.r25 * Math.exp(CFG.circuito.beta * (1 / (tC + 273.15) - 1 / T0));
  }
  /* ¿El NTC está conectado a tierra? (ver config.js: circuito.ntcPosicion) */
  const ntcAbajo = () => CFG.circuito.ntcPosicion === 'abajo';

  // Vout del divisor: con el NTC arriba se mide sobre R fija; con el NTC abajo, sobre el NTC
  function voutFromR(r) {
    const rf = CFG.circuito.rFija;
    return CFG.circuito.vcc * (ntcAbajo() ? r : rf) / (r + rf);
  }
  const adcFromTemp = (tC) => adcFromVoltage(voutFromR(rNtc(tC)));

  // Temperatura "real" según la ecuación Beta para un código ADC (referencia)
  function tempFromAdcExact(n) {
    const v = n * LSB;
    if (v <= 0 || v >= CFG.circuito.vcc) return NaN;
    const vcc = CFG.circuito.vcc;
    const r = ntcAbajo() ? CFG.circuito.rFija * v / (vcc - v) : CFG.circuito.rFija * (vcc / v - 1);
    return 1 / (1 / T0 + Math.log(r / CFG.circuito.r25) / CFG.circuito.beta) - 273.15;
  }

  function generateBetaTable(tMin, tMax, step) {
    const nodes = [];
    for (let t = tMin; t <= tMax + 1e-9; t += step) {
      const n = adcFromTemp(t);
      if (!nodes.length || n !== nodes[nodes.length - 1].n) nodes.push({ n, t: Math.round(t * 100) / 100 });
    }
    nodes.sort((a, b) => a.n - b.n);      // con el NTC abajo, N baja al subir T: se ordena por ADC
    return nodes;
  }

  /* ---------- Lectura de archivos / texto ---------- */
  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v === null || v === undefined) return NaN;
    let s = String(v).trim().replace(/\s+/g, '');
    if (s === '') return NaN;
    const m = s.match(/^(-?[\d.,]+(?:e-?\d+)?)(?:°?c|v)$/i);   // "25°C", "2.5V"
    if (m) s = m[1];
    if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');   // 1,234.5
    else s = s.replace(',', '.');                                      // 3,5 → 3.5
    const x = Number(s);
    return isFinite(x) ? x : NaN;
  }

  const stripQuotes = (s) => s.replace(/^\s*"(.*)"\s*$/, '$1').trim();

  function detectDelimiter(lines) {
    const sample = lines.slice(0, 12);
    if (sample.some((l) => l.includes(';'))) return ';';
    if (sample.some((l) => l.includes('\t'))) return '\t';
    if (sample.some((l) => l.includes(','))) {
      // "2,5 20" → coma decimal con espacio como separador
      const spaced = sample.some((l) => /^\s*-?\d+,\d+\s+-?\d/.test(l) && !l.includes(', '));
      return spaced ? ' ' : ',';
    }
    return ' ';
  }

  function parseDelimitedText(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r\n|\n|\r/)
      .map((l) => l.trim()).filter((l) => l.length);
    if (!lines.length) return [];
    const d = detectDelimiter(lines);
    return lines.map((l) => (d === ' ' ? l.split(/\s+/) : l.split(d)).map((c) => stripQuotes(c.trim())));
  }

  /* Toma las dos primeras columnas numéricas; la primera fila no numérica es el encabezado */
  function extractPoints(rows) {
    const points = [];
    let headers = null;
    let skipped = 0;
    (rows || []).forEach((r) => {
      if (!r || r.length < 2) {
        if (r && r.some((c) => String(c === null || c === undefined ? '' : c).trim() !== '')) skipped++;
        return;
      }
      const a = toNumber(r[0]);
      const b = toNumber(r[1]);
      if (isFinite(a) && isFinite(b)) points.push({ x: a, y: b });
      else if (!points.length && !headers) {
        headers = [String(r[0] === null || r[0] === undefined ? '' : r[0]).trim(),
          String(r[1] === null || r[1] === undefined ? '' : r[1]).trim()];
      } else skipped++;
    });
    return { points, headers, skipped };
  }

  /* Adivina el orden de columnas y la unidad a partir de los encabezados */
  function guessLayout(headers) {
    if (!headers) return { swap: false, xUnit: 'adc' };
    const a = headers[0].toLowerCase();
    const b = headers[1].toLowerCase();
    const isTemp = (s) => /temp|°|celsius|grados|\bt\b|\(c\)/.test(s);
    const isAdc = (s) => /adc|c[oó]d|bits?|\bn\b|raw|cuenta|lectura/.test(s);
    const isVolt = (s) => /volt|\bv\b|vout|\(v\)|tensi[oó]n/.test(s);
    const swap = isTemp(a) && (isAdc(b) || isVolt(b)) && !(isAdc(a) || isVolt(a));
    const xs = swap ? b : a;
    const xUnit = (isVolt(xs) && !isAdc(xs)) ? 'volt' : 'adc';
    return { swap, xUnit };
  }

  /* Valida y ordena los nodos. Devuelve { nodes, warnings, errors } */
  function buildTable(points, opts) {
    const o = Object.assign({ xUnit: 'adc', swap: false }, opts || {});
    const warnings = [];
    const errors = [];
    const nodes = points.map((p) => {
      const x = o.swap ? p.y : p.x;
      const y = o.swap ? p.x : p.y;
      return { n: o.xUnit === 'volt' ? x / VREF * LEVELS : x, t: y };
    });

    if (nodes.length < 3) {
      errors.push('Se necesitan al menos 3 nodos numéricos; se leyeron ' + nodes.length + '.');
      return { nodes, warnings, errors };
    }
    nodes.sort((a, b) => a.n - b.n);
    for (let i = 1; i < nodes.length; i++) {
      if (Math.abs(nodes[i].n - nodes[i - 1].n) < 1e-9) {
        errors.push('El valor ' + fmtN(nodes[i].n) + ' de la primera columna está repetido; cada nodo debe tener un ADC distinto.');
        break;
      }
    }
    if (nodes.some((p) => p.n < 0 || p.n > MAX_CODE)) {
      warnings.push('Hay códigos fuera de 0–' + MAX_CODE + ': revisa si la columna 1 es Voltaje en lugar de ADC.');
    }
    let up = true;
    let down = true;
    for (let i = 1; i < nodes.length; i++) {
      if (nodes[i].t <= nodes[i - 1].t) up = false;
      if (nodes[i].t >= nodes[i - 1].t) down = false;
    }
    if (!up && !down) warnings.push('La temperatura no es monótona respecto al ADC; la curva de un NTC debería serlo.');
    return { nodes, warnings, errors };
  }

  /* ---------- Búsqueda en la tabla ---------- */
  function locate(nodes, n) {
    const last = nodes.length - 1;
    for (let i = 0; i <= last; i++) {
      if (Math.abs(nodes[i].n - n) < 1e-9) return { status: 'exact', index: i, lower: i, upper: i };
    }
    if (n < nodes[0].n) return { status: 'below', lower: null, upper: 0 };
    if (n > nodes[last].n) return { status: 'above', lower: last, upper: null };
    for (let i = 0; i < last; i++) {
      if (n > nodes[i].n && n < nodes[i + 1].n) return { status: 'between', lower: i, upper: i + 1 };
    }
    return null;
  }

  /* Los k nodos más cercanos, garantizando que entren los dos que encierran la lectura */
  function selectNodes(nodes, n, k) {
    const want = Math.min(k || 3, nodes.length);
    const loc = locate(nodes, n);
    const chosen = new Set();
    if (loc.status === 'between') { chosen.add(loc.lower); chosen.add(loc.upper); }
    else if (loc.status === 'exact') chosen.add(loc.index);
    else if (loc.status === 'below') chosen.add(0);
    else chosen.add(nodes.length - 1);

    nodes
      .map((p, i) => ({ i, d: Math.abs(p.n - n) }))
      .filter((o) => !chosen.has(o.i))
      .sort((a, b) => a.d - b.d)
      .forEach((o) => { if (chosen.size < want) chosen.add(o.i); });
    return Array.from(chosen).sort((a, b) => a - b);
  }

  /* ---------- Zonas de la ECU ---------- */
  function ecuZone(t) {
    const zs = CFG.zonasEcu;
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      if (z.lt !== undefined && t < z.lt) return z;
      if (z.lte !== undefined && t <= z.lte) return z;
    }
    return zs[zs.length - 1];
  }

  /* ---------- Formato ---------- */
  const fmtN = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
  const fmtT = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(2));

  const API = {
    BITS, LEVELS, MAX_CODE, VREF, LSB, ntcAbajo,
    clamp, adcFromVoltage, voltageFromAdc, toBinary, sarSteps,
    rNtc, voutFromR, adcFromTemp, tempFromAdcExact, generateBetaTable,
    toNumber, parseDelimitedText, extractPoints, guessLayout, buildTable,
    locate, selectNodes, ecuZone, fmtN, fmtT
  };

  if (typeof module === 'object' && module.exports) module.exports = API;
  else root.ECUCore = API;
})(typeof self !== 'undefined' ? self : this);
