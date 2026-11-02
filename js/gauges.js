/* ===================================================================
   gauges.js — medidores de aguja en SVG (estilo tablero de automóvil)
   =================================================================== */
(function (root) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const reduced = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(e);
    return e;
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  // ángulo en grados, 0 = arriba, positivo = sentido horario
  const polar = (cx, cy, r, deg) => {
    const a = deg * Math.PI / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  };
  function arc(cx, cy, r, d0, d1) {
    const p0 = polar(cx, cy, r, d0);
    const p1 = polar(cx, cy, r, d1);
    return 'M' + r2(p0[0]) + ' ' + r2(p0[1]) + ' A' + r + ' ' + r + ' 0 ' + ((d1 - d0) > 180 ? 1 : 0) + ' 1 ' + r2(p1[0]) + ' ' + r2(p1[1]);
  }

  class Gauge {
    constructor(host, options) {
      const o = this.o = Object.assign({
        min: 0, max: 10, start: -135, end: 135,
        major: 1, minor: 0.2,
        bands: [],                 // [{from, to, color, ticks:true}]
        bezel: '#e9edf0',
        tickColor: '#e9edf0',
        label: (v) => String(v),
        caption: '', ends: null,   // ends: ['C', 'H']
        fontSize: 24, height: 372
      }, options);

      this.cx = 200; this.cy = 200;
      this.angle = o.start;
      this._raf = null; this._resolve = null;

      const svg = el('svg', {
        viewBox: '0 0 400 ' + o.height, role: 'img',
        'aria-label': o.aria || 'Medidor', preserveAspectRatio: 'xMidYMid meet'
      });
      this.svg = svg;

      const R = 186;
      // arco base (bisel)
      el('path', { d: arc(this.cx, this.cy, R, o.start, o.end), fill: 'none', stroke: o.bezel, 'stroke-width': 5, 'stroke-linecap': 'butt', opacity: 0.9 }, svg);
      // bandas de color sobre el bisel
      o.bands.forEach((b) => {
        el('path', {
          d: arc(this.cx, this.cy, R, this.toAngle(b.from), this.toAngle(b.to)),
          fill: 'none', stroke: b.color, 'stroke-width': 7
        }, svg);
      });

      // marcas y números
      const count = Math.round((o.max - o.min) / o.minor);
      for (let i = 0; i <= count; i++) {
        const v = o.min + i * o.minor;
        const ratio = (v - o.min) / o.major;
        const isMajor = Math.abs(ratio - Math.round(ratio)) < 1e-6;
        const ang = this.toAngle(v);
        const band = o.bands.filter((b) => b.ticks !== false && v >= b.from - 1e-9 && v <= b.to + 1e-9).pop();
        const col = band ? band.color : o.tickColor;
        const p0 = polar(this.cx, this.cy, 172, ang);
        const p1 = polar(this.cx, this.cy, isMajor ? 150 : 162, ang);
        el('line', {
          x1: r2(p0[0]), y1: r2(p0[1]), x2: r2(p1[0]), y2: r2(p1[1]),
          stroke: col, 'stroke-width': isMajor ? 3.2 : 1.6, 'stroke-linecap': 'round'
        }, svg);
        if (isMajor) {
          const pl = polar(this.cx, this.cy, 124, ang);
          const t = el('text', {
            x: r2(pl[0]), y: r2(pl[1]), 'text-anchor': 'middle', dy: '.35em',
            'font-size': o.fontSize, fill: band ? band.color : '#f1f4f7', class: 'g-num'
          }, svg);
          t.textContent = o.label(Math.round(v * 1000) / 1000);
        }
      }

      if (o.caption) {
        const t = el('text', {
          x: 200, y: 142, 'text-anchor': 'middle', 'font-size': 17, fill: '#8693a1', class: 'g-cap', 'letter-spacing': '1.5'
        }, svg);
        t.textContent = o.caption;
      }
      if (o.ends) {
        [[o.start - 14, o.ends[0]], [o.end + 14, o.ends[1]]].forEach((e) => {
          const p = polar(this.cx, this.cy, 168, e[0]);
          const t = el('text', { x: r2(p[0]), y: r2(p[1]), 'text-anchor': 'middle', dy: '.35em', 'font-size': 24, fill: '#f1f4f7', class: 'g-num' }, svg);
          t.textContent = e[1];
        });
      }

      // aguja
      this.needle = el('g', { class: 'needle' }, svg);
      el('polygon', { points: '196.5,228 203.5,228 201,56 199,56', fill: '#ff4a2b' }, this.needle);
      el('circle', { cx: 200, cy: 200, r: 13, fill: '#0b1015', stroke: '#2a3541', 'stroke-width': 3 }, svg);
      el('circle', { cx: 200, cy: 200, r: 4.5, fill: '#ff4a2b' }, svg);

      host.innerHTML = '';
      host.appendChild(svg);
      this.apply(o.start);
    }

    toAngle(v) {
      const o = this.o;
      const r = (Math.min(o.max, Math.max(o.min, v)) - o.min) / (o.max - o.min);
      return o.start + r * (o.end - o.start);
    }

    apply(angle) {
      this.angle = angle;
      this.needle.setAttribute('transform', 'rotate(' + r2(angle) + ' ' + this.cx + ' ' + this.cy + ')');
    }

    /* Mueve la aguja con una animación suave. Devuelve una promesa que se resuelve al terminar. */
    set(value, ms) {
      const target = this.toAngle(value);
      if (this._raf) cancelAnimationFrame(this._raf);
      if (this._resolve) { this._resolve(); this._resolve = null; }
      const dur = (ms === undefined ? 500 : ms);
      if (dur <= 0 || reduced()) { this.apply(target); return Promise.resolve(); }
      const from = this.angle;
      const t0 = performance.now();
      return new Promise((resolve) => {
        this._resolve = resolve;
        const tick = (now) => {
          const p = Math.min(1, (now - t0) / dur);
          const e = 1 - Math.pow(1 - p, 3);          // ease-out cúbico
          this.apply(from + (target - from) * e);
          if (p < 1) this._raf = requestAnimationFrame(tick);
          else { this._resolve = null; resolve(); }
        };
        this._raf = requestAnimationFrame(tick);
      });
    }
  }

  root.ECUGauges = { Gauge };
})(typeof self !== 'undefined' ? self : this);
