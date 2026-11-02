/* ===================================================================
   app.js — interfaz: tablero, entrada de datos, animación ADC, búsqueda
   en la tabla. (Fase 1: métodos numéricos, raíces y actuación ECU
   se añaden en las fases siguientes.)
   =================================================================== */
(function () {
  'use strict';

  const C = window.ECUCore;
  const CFG = window.ECU_CONFIG;
  const Gauge = window.ECUGauges.Gauge;
  const M = window.ECUMethods;
  const RT = window.ECURoots;
  const $ = (id) => document.getElementById(id);
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const T_MIN = CFG.temperatura.min;
  const T_MAX = CFG.temperatura.max;
  /* Tramos de temperatura de cada zona de la ECU, tomados de config.js */
  const ZONE_BANDS = (function () {
    const zs = CFG.zonasEcu;
    const out = [];
    let prev = T_MIN;
    zs.forEach((z, i) => {
      const edge = i === zs.length - 1 ? T_MAX : (z.lt !== undefined ? z.lt : z.lte);
      out.push({ from: prev, to: edge, color: z.color, zone: z });
      prev = edge;
    });
    return out;
  })();
  const V_FAULT_LO = CFG.adc.faultLow * C.LSB;
  const V_FAULT_HI = CFG.adc.faultHigh * C.LSB;
  const ADC_DIV = 100;                       // el medidor de ADC muestra N / 100

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* ------------------------------------------------------------------
     Estado
     ------------------------------------------------------------------ */
  const state = {
    n: 480,
    vin: C.voltageFromAdc(480),
    table: null,           // { nodes, label, source }
    user: null,            // datos del usuario: { points, headers, label, opts, nodes }
    token: 0,              // cancela animaciones en curso
    speed: 350,
    method: 'all',         // all | lagrange | newton | matricial | spline
    degree: 2,             // grado de los polinomios (2 o 3)
    rmethod: 'all',        // all | biseccion | newton | secante
    rp: Object.assign({}, RT.DEFAULTS),  // parámetros de los métodos de raíces
    estimate: null,        // temperatura estimada que muestra el tablero
    ecuHold: false,        // true mientras la animación aún no llega a la sección 06
    curve: null,           // curvas de la gráfica (se recalculan al cambiar la tabla)
    chart: null            // geometría de la gráfica, para el arrastre
  };

  /* ------------------------------------------------------------------
     Medidores
     ------------------------------------------------------------------ */
  const gAdc = new Gauge($('g-adc'), {
    min: 0, max: 10.25, major: 1, minor: 0.25, fontSize: 22, aria: 'Medidor del código ADC',
    bands: [{ from: 9, to: 10.25, color: '#ff3b30' }], bezel: '#a9b3bd'
  });
  const gVolt = new Gauge($('g-volt'), {
    min: 0, max: 5, major: 0.5, minor: 0.1, fontSize: 26, caption: 'V', aria: 'Voltímetro de la salida del divisor',
    label: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)),
    bands: [
      { from: 0, to: V_FAULT_LO, color: '#ff3b30' },
      { from: V_FAULT_HI, to: 5, color: '#ff3b30' }
    ]
  });
  const gTemp = new Gauge($('g-temp'), {
    min: T_MIN, max: T_MAX, major: 20, minor: 5, fontSize: 21, ends: ['C', 'H'],
    aria: 'Indicador de temperatura estimada', bezel: '#a9b3bd',
    bands: ZONE_BANDS.map((b) => ({ from: b.from, to: b.to, color: b.color }))
  });
  gTemp.set(T_MIN, 0);

  /* ------------------------------------------------------------------
     Luces testigo
     ------------------------------------------------------------------ */
  const TELLTALES = [
    {
      id: 'mil', label: 'MIL', cls: 'amber', title: 'Check engine / falla de sensor',
      svg: '<svg viewBox="0 0 32 24" fill="currentColor"><rect x="8" y="7" width="16" height="12" rx="2"/><rect x="12" y="3.5" width="8" height="3" rx="1"/><rect x="3" y="11" width="5" height="4" rx="1"/><rect x="24" y="9" width="3" height="8"/><rect x="27" y="11" width="3" height="4"/></svg>'
    },
    {
      id: 'ect', label: 'ECT', cls: 'red', title: 'Temperatura del refrigerante',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 14.5V5a2.5 2.5 0 0 1 5 0v9.5a4 4 0 1 1-5 0z"/><path d="M16 6.5c1.2-.8 2.3.8 3.5 0M16 10.5c1.2-.8 2.3.8 3.5 0"/></svg>'
    },
    {
      id: 'cold', label: 'FRÍO', cls: 'blue', title: 'Enriquecimiento en frío',
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/></svg>'
    },
    {
      id: 'fan', label: 'VENT.', cls: 'amber', title: 'Electroventilador',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2.2"/><path d="M12 9.8C11 6 12 3 15.2 3c1 3-.2 6-3.2 6.8z"/><path d="M12 9.8C11 6 12 3 15.2 3c1 3-.2 6-3.2 6.8z" transform="rotate(120 12 12)"/><path d="M12 9.8C11 6 12 3 15.2 3c1 3-.2 6-3.2 6.8z" transform="rotate(240 12 12)"/></svg>'
    }
  ];
  (function buildTelltales() {
    const html = (extra) => TELLTALES.map((t) =>
      '<div class="tt ' + t.cls + extra + '" data-id="' + t.id + '" title="' + esc(t.title) + '">' + t.svg + '<small>' + t.label + '</small></div>'
    ).join('');
    $('telltales').innerHTML = html('');
    $('tt-lg').innerHTML = html(' lg');
  })();
  const setTelltales = (on) => document.querySelectorAll('.tt').forEach((e) => e.classList.toggle('on', on));
  const setLights = (ids) => document.querySelectorAll('.tt').forEach((e) => e.classList.toggle('on', ids.indexOf(e.dataset.id) >= 0));

  /* ------------------------------------------------------------------
     Pantalla central (LCD) y lecturas
     ------------------------------------------------------------------ */
  function setLcd(o) {
    $('lcd-adc').textContent = o.adc;
    $('lcd-v').textContent = o.v.toFixed(3) + ' V';
    $('lcd-bin').textContent = o.bin;
    $('lcd-t').textContent = '--.- °C';        // Fase 2: temperatura estimada
    $('ro-adc').textContent = o.adc;
  }
  function renderCluster(ms) {
    gVolt.set(state.vin, ms);
    gAdc.set(state.n / ADC_DIV, ms);
    setLcd({ adc: state.n, v: state.vin, bin: C.toBinary(state.n) });
  }

  /* ------------------------------------------------------------------
     Panel 02: conversión A/D
     ------------------------------------------------------------------ */
  function buildBits() {
    const host = $('bits');
    host.innerHTML = '';
    for (let k = C.BITS - 1; k >= 0; k--) {
      const d = document.createElement('div');
      d.className = 'bit';
      d.innerHTML = '<span class="w">' + (1 << k) + '</span><span class="b">0</span><span class="idx">b' + k + '</span>';
      host.appendChild(d);
    }
  }
  function resetBits() {
    [...$('bits').children].forEach((d) => { d.className = 'bit'; d.querySelector('.b').textContent = '·'; });
  }
  function renderBitsStatic() {
    const bin = C.toBinary(state.n);
    [...$('bits').children].forEach((d, i) => {
      d.className = 'bit ' + (bin[i] === '1' ? 'is-on' : 'is-off');
      d.querySelector('.b').textContent = bin[i];
    });
  }
  const pct = (v) => (Math.min(C.VREF, Math.max(0, v)) / C.VREF * 100) + '%';

  function renderAdcResult() {
    const vq = C.voltageFromAdc(state.n);
    $('adc-vin').textContent = state.vin.toFixed(3) + ' V';
    $('adc-formula').innerHTML = 'N = ⌊' + state.vin.toFixed(3) + ' / ' + C.VREF + ' × ' + C.LEVELS + '⌋ = ' + state.n;
    $('adc-n').textContent = state.n;
    $('adc-bin').textContent = C.toBinary(state.n);
    $('adc-hex').textContent = '0x' + state.n.toString(16).toUpperCase().padStart(3, '0');
    $('adc-lsb').textContent = (C.LSB * 1000).toFixed(3) + ' mV';
    $('adc-err').textContent = ((state.vin - vq) * 1000).toFixed(2) + ' mV';
    $('m-vin').style.left = pct(state.vin);
    $('m-dac').style.left = pct(vq);
    $('adc-log').textContent = 'Resultado: N = ' + state.n + ' (' + C.toBinary(state.n) + ').';
  }

  /* ------------------------------------------------------------------
     Panel 03: búsqueda en la tabla
     ------------------------------------------------------------------ */
  function rowHtml(i, nd, cls, role) {
    return '<tr class="' + cls + '"><td>' + i + '</td><td>' + C.fmtN(nd.n) + '</td><td>' +
      C.voltageFromAdc(nd.n).toFixed(3) + '</td><td>' + C.fmtT(nd.t) + '</td><td>' + role + '</td></tr>';
  }
  const readingRow = () =>
    '<tr class="reading-row"><td>▶</td><td>' + state.n + '</td><td>' + state.vin.toFixed(3) +
    '</td><td>?</td><td>lectura · por interpolar</td></tr>';

  function lookupMessage(loc, nodes) {
    const n = state.n;
    const nd = (i) => 'N = <b>' + C.fmtN(nodes[i].n) + '</b> (' + C.fmtT(nodes[i].t) + ' °C)';
    const lo = C.fmtN(nodes[0].n);
    const hi = C.fmtN(nodes[nodes.length - 1].n);
    let kind; let html;
    if (loc.status === 'exact') {
      kind = 'exact';
      html = 'N = <b>' + n + '</b> coincide con un nodo de la tabla (' + C.fmtT(nodes[loc.index].t) +
        ' °C). La ECU puede leer el valor directo, <b>sin interpolar</b>.';
    } else if (loc.status === 'between') {
      kind = 'between';
      html = 'N = <b>' + n + '</b> no está en la tabla: cae entre ' + nd(loc.lower) + ' y ' + nd(loc.upper) +
        '. Hay que <b>interpolar</b>.';
    } else {
      kind = 'out';
      html = 'N = <b>' + n + '</b> queda fuera del rango calibrado (' + lo + '–' + hi + '). Aquí no se interpola: ' +
        'se extrapolaría; una ECU real limita el valor o declara falla del sensor.';
    }
    if (n <= CFG.adc.faultLow) html += '<span class="fault">⚠ Voltaje cercano a 0 V: posible cortocircuito del sensor a masa.</span>';
    if (n >= CFG.adc.faultHigh) html += '<span class="fault">⚠ Voltaje cercano a 5 V: posible circuito abierto del sensor.</span>';
    return { kind, html };
  }

  /* mode: 'final' | 'idle' | 'scan' */
  function renderLookup(mode, scanIdx) {
    const nodes = state.table.nodes;
    const n = state.n;
    const loc = C.locate(nodes, n);
    const sel = new Set(C.selectNodes(nodes, n, 3));
    const tbody = $('lookup-table').querySelector('tbody');
    const out = [];

    if (mode === 'idle') {
      nodes.forEach((nd, i) => out.push(rowHtml(i, nd, '', '')));
      $('lookup-status').className = 'lookup-status';
      $('lookup-status').textContent = 'Esperando la conversión A/D…';
    } else if (mode === 'scan') {
      nodes.forEach((nd, i) => {
        if (i > scanIdx) out.push(rowHtml(i, nd, '', ''));
        else if (i < scanIdx) out.push(rowHtml(i, nd, 'is-passed', C.fmtN(nd.n) + ' &lt; ' + n));
        else out.push(rowHtml(i, nd, 'is-scan', C.fmtN(nd.n) + (nd.n < n ? ' &lt; ' : nd.n > n ? ' &gt; ' : ' = ') + n));
      });
      $('lookup-status').className = 'lookup-status';
      $('lookup-status').textContent = 'Comparando N = ' + n + ' con los nodos de la tabla…';
    } else {
      const roleOf = (i) => {
        if (loc.status === 'exact' && i === loc.index) return 'Coincide';
        if (loc.status === 'between' && i === loc.lower) return 'Nodo inferior';
        if (loc.status === 'between' && i === loc.upper) return 'Nodo superior';
        if (loc.status === 'below' && i === 0) return 'Primer nodo';
        if (loc.status === 'above' && i === nodes.length - 1) return 'Último nodo';
        return sel.has(i) ? 'Vecino' : '';
      };
      if (loc.status === 'below') out.push(readingRow());
      nodes.forEach((nd, i) => {
        let cls = sel.has(i) ? 'is-sel' : '';
        if (loc.status === 'exact' && i === loc.index) cls = 'is-exact is-sel';
        else if (loc.status === 'between' && (i === loc.lower || i === loc.upper)) cls = 'is-hit is-sel';
        out.push(rowHtml(i, nd, cls, roleOf(i)));
        if (loc.status === 'between' && i === loc.lower) out.push(readingRow());
      });
      if (loc.status === 'above') out.push(readingRow());
      const msg = lookupMessage(loc, nodes);
      $('lookup-status').className = 'lookup-status ' + msg.kind;
      $('lookup-status').innerHTML = msg.html;
    }
    tbody.innerHTML = out.join('');
    renderStrip(mode === 'idle' ? null : loc, sel, mode === 'final');
  }

  /* franja con los nodos sobre el eje ADC y la marca de la lectura */
  function renderStrip(loc, sel, showMark) {
    const nodes = state.table.nodes;
    const n = state.n;
    const lo = Math.min(nodes[0].n, n);
    const hi = Math.max(nodes[nodes.length - 1].n, n);
    const pad = (hi - lo) * 0.06 || 10;
    const x = (v) => 40 + (v - (lo - pad)) / ((hi - lo) + 2 * pad) * 720;
    const showAll = nodes.length <= 14;
    let s = '<svg viewBox="0 0 800 100"><line class="axis" x1="30" y1="56" x2="770" y2="56"/>';
    if (loc && loc.status === 'between') {
      s += '<line class="span" x1="' + x(nodes[loc.lower].n) + '" y1="56" x2="' + x(nodes[loc.upper].n) + '" y2="56"/>';
    }
    nodes.forEach((nd, i) => {
      const isSel = loc && sel.has(i);
      s += '<circle class="node' + (isSel ? ' sel' : '') + '" cx="' + x(nd.n) + '" cy="56" r="' + (isSel ? 6 : 4.5) + '"/>';
      if (showAll || isSel) s += '<text x="' + x(nd.n) + '" y="82" text-anchor="middle">' + C.fmtN(nd.n) + '</text>';
    });
    if (showMark) {
      s += '<path class="mark" d="M' + (x(n) - 7) + ' 30 L' + (x(n) + 7) + ' 30 L' + x(n) + ' 46 Z"/>' +
        '<text class="mark-label" x="' + x(n) + '" y="20" text-anchor="middle">N = ' + n + '</text>';
    }
    $('lookup-strip').innerHTML = s + '</svg>';
  }

  /* ------------------------------------------------------------------
     Vista previa de la curva (panel 01)
     ------------------------------------------------------------------ */
  function renderCurve() {
    const nodes = state.table.nodes;
    const n = state.n;
    const W = 320; const H = 150; const L = 36; const R = 10; const T = 10; const B = 26;
    const lo = Math.min(nodes[0].n, n);
    const hi = Math.max(nodes[nodes.length - 1].n, n);
    const ts = nodes.map((p) => p.t);
    const tLo = Math.min.apply(null, ts);
    const tHi = Math.max.apply(null, ts);
    const px = (v) => L + (v - lo) / ((hi - lo) || 1) * (W - L - R);
    const py = (t) => H - B - (t - tLo) / ((tHi - tLo) || 1) * (H - B - T);
    const pts = nodes.map((p) => px(p.n).toFixed(1) + ',' + py(p.t).toFixed(1)).join(' ');
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '">' +
      '<line class="axis" x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '"/>' +
      '<line class="axis" x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '"/>' +
      '<polyline class="line" points="' + pts + '"/>';
    if (nodes.length <= 40) nodes.forEach((p) => { s += '<circle class="pt" cx="' + px(p.n).toFixed(1) + '" cy="' + py(p.t).toFixed(1) + '" r="2.6"/>'; });
    s += '<line class="cursor" x1="' + px(n) + '" y1="' + T + '" x2="' + px(n) + '" y2="' + (H - B) + '"/>' +
      '<text x="' + (L - 4) + '" y="' + (T + 8) + '" text-anchor="end">' + C.fmtT(tHi) + '</text>' +
      '<text x="' + (L - 4) + '" y="' + (H - B) + '" text-anchor="end">' + C.fmtT(tLo) + '</text>' +
      '<text x="' + L + '" y="' + (H - 8) + '">' + C.fmtN(lo) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end">' + C.fmtN(hi) + '</text>' +
      '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 8) + '" text-anchor="middle">ADC (N) → °C</text></svg>';
    $('curve-mini').innerHTML = s;
  }

  /* ------------------------------------------------------------------
     Tabla de calibración: ecuación Beta o archivo Excel
     ------------------------------------------------------------------ */
  const PRESET_NOTES = {
    beta10: 'Calculada con la ecuación Beta (NTC 10 kΩ, β = 3965 K, R fija 10 kΩ, 5 V, ADC de 10 bits) cada 10 °C, de −20 a 120 °C.',
    beta5: 'Misma ecuación Beta, pero con un nodo cada 5 °C (curva más fina).',
    custom: 'Tabla subida desde tu archivo Excel.'
  };

  function tableSummary(nodes, label, warnings) {
    const ts = nodes.map((p) => p.t);
    let h = '<p class="ok">✔ ' + esc(label) + ': <b>' + nodes.length + '</b> nodos · ADC ' + C.fmtN(nodes[0].n) + '–' +
      C.fmtN(nodes[nodes.length - 1].n) + ' · ' + C.fmtT(Math.min.apply(null, ts)) + ' a ' + C.fmtT(Math.max.apply(null, ts)) + ' °C</p>';
    (warnings || []).forEach((w) => { h += '<p class="warn">⚠ ' + esc(w) + '</p>'; });
    $('table-status').innerHTML = h;
  }

  function setTable(nodes, label, source, warnings) {
    state.table = { nodes, label, source };
    $('sel-preset').value = source;
    $('preset-note').textContent = PRESET_NOTES[source] || '';
    const custom = source === 'custom';
    $('sel-xunit').disabled = !custom;
    $('btn-swap').disabled = !custom;
    tableSummary(nodes, label, warnings);
    updateNow(true);
  }

  function loadPreset(id) {
    if (id === 'custom') {
      if (!state.user || !state.user.nodes) return;
      setTable(state.user.nodes, state.user.label, 'custom', state.user.warnings);
      return;
    }
    let nodes; let label;
    if (id === 'beta10') { nodes = C.generateBetaTable(T_MIN, T_MAX, 10); label = 'Ecuación Beta (10 °C)'; }
    else { nodes = C.generateBetaTable(T_MIN, T_MAX, 5); label = 'Ecuación Beta (5 °C)'; }
    setTable(nodes, label, id);
  }

  function showTableError(msgs) {
    $('table-status').innerHTML = msgs.map((m) => '<p class="err">✖ ' + esc(m) + '</p>').join('') +
      '<p class="note">Se mantiene la tabla anterior.</p>';
  }

  /* Reconstruye la tabla del usuario con las opciones actuales (unidad / columnas) */
  function rebuildUser() {
    const u = state.user;
    const res = C.buildTable(u.points, u.opts);
    if (res.errors.length) { showTableError(res.errors); return false; }
    u.nodes = res.nodes;
    u.warnings = res.warnings.slice();
    if (u.skipped) u.warnings.push(u.skipped + ' fila(s) no numérica(s) se ignoraron.');
    const opt = $('sel-preset').querySelector('option[value="custom"]');
    opt.disabled = false;
    opt.textContent = 'Mis datos · ' + u.label;
    setTable(u.nodes, u.label, 'custom', u.warnings);
    return true;
  }

  function applyRows(rows, label) {
    const ex = C.extractPoints(rows);
    if (ex.points.length < 3) {
      showTableError(['No encontré al menos 3 filas con dos números (columna 1: ADC, columna 2: °C). Revisa el archivo.']);
      return;
    }
    const lay = C.guessLayout(ex.headers);
    const prev = state.user;
    state.user = {
      points: ex.points, headers: ex.headers, skipped: ex.skipped, label,
      opts: { xUnit: lay.xUnit, swap: lay.swap }
    };
    $('sel-xunit').value = lay.xUnit;
    if (!rebuildUser()) state.user = prev;
  }

  async function handleFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (['xlsx', 'xls'].indexOf(ext) < 0) {
      showTableError(['Solo se admiten archivos de Excel (.xlsx o .xls). Guarda tu tabla como Excel y súbela de nuevo.']);
      return;
    }
    try {
      if (!window.XLSX) {
        showTableError(['No se pudo cargar la librería de Excel (js/vendor/xlsx.full.min.js). Revisa que la carpeta js/vendor esté en el proyecto.']);
        return;
      }
      const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      let rows = null;
      for (const name of wb.SheetNames) {                 // primera hoja con al menos 3 filas numéricas
        const r = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
        if (!rows) rows = r;
        if (C.extractPoints(r).points.length >= 3) { rows = r; break; }
      }
      applyRows(rows || [], file.name);
    } catch (err) {
      showTableError(['No se pudo leer el archivo: ' + (err && err.message ? err.message : err)]);
    }
  }

  /* ------------------------------------------------------------------
     Actualización inmediata (tiempo real) y animación completa
     ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------
     Panel 04: interpolación (Fase 2)
     ------------------------------------------------------------------ */
  const METHODS = [
    { id: 'lagrange', title: 'Lagrange', poly: true },
    { id: 'newton', title: 'Diferencias divididas de Newton', poly: true },
    { id: 'matricial', title: 'Método matricial (Vandermonde)', poly: true },
    { id: 'spline', title: 'Splines cúbicos naturales', poly: false }
  ];

  function interpolable() {
    const loc = C.locate(state.table.nodes, state.n);
    return loc.status === 'exact' || loc.status === 'between';
  }

  /* Temperatura estimada según el método elegido ('Todos' usa el spline) */
  function estimateFrom(res) {
    if (!res) return null;
    return (state.method === 'all' ? res.spline : res[state.method]).value;
  }

  function showEstimate(t, ms) {
    state.estimate = (t === null || !isFinite(t)) ? null : t;
    if (t === null || !isFinite(t)) {
      $('ro-temp').textContent = '--.-';
      $('lcd-t').textContent = '--.- °C';
      gTemp.set(T_MIN, ms === undefined ? 400 : ms);
      refreshEcu();
      return;
    }
    $('ro-temp').textContent = t.toFixed(1);
    $('lcd-t').textContent = t.toFixed(2) + ' °C';
    gTemp.set(t, ms === undefined ? 500 : ms);
    refreshEcu();
  }

  const nodeList = (P) => P.map((p) => '(' + C.fmtN(p.n) + ', ' + C.fmtT(p.t) + ')').join(' · ');

  function syncDegreeOptions() {
    const nodes = state.table.nodes.length;
    const opt3 = $('sel-degree').querySelector('option[value="3"]');
    opt3.disabled = nodes < 4;
    opt3.textContent = nodes < 4 ? 'Grado 3 · 4 nodos (la tabla tiene solo ' + nodes + ')' : 'Grado 3 · 4 nodos';
    if (nodes < 4 && state.degree === 3) state.degree = 2;
    $('sel-degree').value = String(state.degree);
  }

  function card(def, res, hidden) {
    const r = res[def.id];
    const nodes = def.poly
      ? 'Grado ' + res.degree + ' con ' + res.P.length + ' nodos: ' + nodeList(res.P)
      : 'Usa los ' + state.table.nodes.length + ' nodos de la tabla';
    return '<article class="mcard' + (hidden ? ' is-hidden' : '') + '" data-m="' + def.id + '"><header><h3>' + def.title +
      '</h3><span class="mres">' + r.value.toFixed(4) + ' °C</span></header><p class="mnodes">' + nodes + '</p>' +
      r.lines.map((l) => '<div class="ml">' + l + '</div>').join('') + '</article>';
  }

  function compareHtml(res) {
    const showBeta = state.table.source === 'beta10' || state.table.source === 'beta5';
    const exact = showBeta ? C.tempFromAdcExact(state.n) : NaN;
    const base = res.lagrange.value;
    const small = (x) => (Math.abs(x) < 1e-9 ? '≈ 0' : (x > 0 ? '+' : '') + x.toFixed(4));
    const picked = state.method === 'all' ? 'spline' : state.method;
    const rows = METHODS.map((def) => {
      const v = res[def.id].value;
      return '<tr' + (def.id === picked ? ' class="is-pick"' : '') + '><td>' + def.title + '</td><td>' +
        (def.poly ? 'grado ' + res.degree : 'toda la tabla') + '</td><td>' + v.toFixed(4) + '</td><td>' + small(v - base) + '</td>' +
        (showBeta ? '<td>' + small(v - exact) + '</td>' : '') + '</tr>';
    });
    rows.push('<tr class="is-ref"><td>Lineal por tramos (referencia)</td><td>2 nodos</td><td>' + res.linear.value.toFixed(4) + '</td><td>' +
      small(res.linear.value - base) + '</td>' + (showBeta ? '<td>' + small(res.linear.value - exact) + '</td>' : '') + '</tr>');
    if (showBeta) {
      rows.push('<tr class="is-ref"><td>Ecuación Beta (valor real)</td><td>exacta</td><td>' + exact.toFixed(4) + '</td><td>' +
        small(exact - base) + '</td><td>0</td></tr>');
    }
    const agree = res.polyDiff < 1e-9
      ? '✔ Lagrange, Newton y matricial dan <b>el mismo polinomio</b> (diferencia máxima ' + (res.polyDiff < 1e-12 ? '≈ 0' : res.polyDiff.toExponential(1)) +
        ' °C): son tres caminos para calcular un único polinomio de grado ' + res.degree + '. Los splines cúbicos sí pueden diferir.'
      : '⚠ Los tres polinomios difieren en ' + res.polyDiff.toExponential(2) + ' °C (error numérico: nodos muy separados).';
    return '<p class="agree">' + agree + '</p><div class="table-wrap"><table><thead><tr><th>Método</th><th>Nodos</th><th>T (°C)</th><th>Δ vs Lagrange</th>' +
      (showBeta ? '<th>Δ vs ecuación Beta</th>' : '') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  /* Dibuja la sección 04. opts.reveal = true deja las tarjetas ocultas (para animarlas).
     Devuelve { res, cards: [elementos], compare } */
  function renderMethods(opts) {
    const hidden = !!(opts && opts.reveal);
    syncDegreeOptions();
    const host = $('method-cards');
    const cmp = $('compare');
    const st = $('interp-status');
    document.querySelectorAll('#seg-methods button').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.m === state.method)));

    if (!interpolable()) {
      host.innerHTML = ''; cmp.innerHTML = '';
      st.className = 'lookup-status out';
      st.innerHTML = 'N = <b>' + state.n + '</b> está fuera del rango calibrado (' + C.fmtN(state.table.nodes[0].n) + '–' +
        C.fmtN(state.table.nodes[state.table.nodes.length - 1].n) + '): <b>no se interpola</b> ni se extrapola. La ECU debe limitar el valor o declarar falla del sensor.';
      return { res: null, cards: [], compare: cmp };
    }

    const res = M.compute(state.table.nodes, state.n, state.degree);
    const exact = C.locate(state.table.nodes, state.n).status === 'exact';
    st.className = 'lookup-status ' + (exact ? 'exact' : 'between');
    st.innerHTML = exact
      ? 'N = <b>' + state.n + '</b> coincide con un nodo: no hace falta interpolar, pero todos los métodos deben devolver ese valor (comprobación).'
      : 'Interpolando N = <b>' + state.n + '</b>. Polinomios de grado <b>' + res.degree + '</b> con los ' + res.P.length +
        ' nodos más cercanos; splines con toda la tabla.';

    const defs = state.method === 'all' ? METHODS : METHODS.filter((d) => d.id === state.method);
    host.className = 'mcards' + (defs.length === 1 ? ' single' : '');
    host.innerHTML = defs.map((d) => card(d, res, hidden)).join('');
    cmp.className = 'compare' + (hidden ? ' is-hidden' : '');
    cmp.innerHTML = compareHtml(res);
    return { res, cards: [].slice.call(host.children), compare: cmp };
  }

  function refreshMethods() {
    state.ecuHold = false;
    const out = renderMethods();
    showEstimate(estimateFrom(out.res));
  }

  /* ------------------------------------------------------------------
     Panel 05: raíces (Fase 3)
     ------------------------------------------------------------------ */
  const RMETHODS = [
    { id: 'biseccion', title: 'Bisección', color: '#ffb020', dash: '' },
    { id: 'newton', title: 'Newton-Raphson', color: '#35d07f', dash: '' },
    { id: 'secante', title: 'Secante', color: '#3d8bff', dash: '7 5' }
  ];
  const fe = (v) => (!isFinite(v) ? '—' : (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(3) : v.toFixed(6));
  const f6 = (v) => (isFinite(v) ? v.toFixed(6) : '—');
  const sgn = (x) => (Math.abs(x) < 1e-12 ? '≈ 0' : (x > 0 ? '+' : '') + x.toFixed(4));

  function itable(id, rows) {
    const heads = {
      biseccion: ['k', 'a', 'b', 'c = (a+b)/2', 'f(c)', 'error = (b−a)/2'],
      newton: ['k', 'x<sub>k</sub>', 'f(x<sub>k</sub>)', 'f′(x<sub>k</sub>)', 'x<sub>k+1</sub>', 'error |Δx|'],
      secante: ['k', 'x<sub>k−1</sub>', 'x<sub>k</sub>', 'f(x<sub>k−1</sub>)', 'f(x<sub>k</sub>)', 'x<sub>k+1</sub>', 'error |Δx|']
    }[id];
    const cells = (r) => ({
      biseccion: [r.k, f6(r.a), f6(r.b), f6(r.c), fe(r.fc), fe(r.err)],
      newton: [r.k, f6(r.x), fe(r.fx), fe(r.dfx), f6(r.xn), fe(r.err)],
      secante: [r.k, f6(r.x0), f6(r.x1), fe(r.f0), fe(r.f1), f6(r.xn), fe(r.err)]
    }[id]);
    return '<div class="itable-wrap"><table class="itable"><thead><tr>' + heads.map((h) => '<th>' + h + '</th>').join('') +
      '</tr></thead><tbody>' + rows.map((r, i) => '<tr' + (i === rows.length - 1 ? ' class="is-last"' : '') + '>' +
      cells(r).map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }

  function rootCard(def, r, p, hidden) {
    const formula = {
      biseccion: 'c = (a + b)/2 · se conserva el subintervalo donde f cambia de signo · error = (b − a)/2',
      newton: 'x<sub>k+1</sub> = x<sub>k</sub> − f(x<sub>k</sub>)/f′(x<sub>k</sub>), con f′(T) = ' + (C.ntcAbajo() ? '−' : '') + 'V<sub>cc</sub>·R<sub>f</sub>·R·β / [(T+273.15)²·(R+R<sub>f</sub>)²]',
      secante: 'x<sub>k+1</sub> = x<sub>k</sub> − f(x<sub>k</sub>)·(x<sub>k</sub> − x<sub>k−1</sub>) / (f(x<sub>k</sub>) − f(x<sub>k−1</sub>))  (sin derivada)'
    }[def.id];
    const init = {
      biseccion: 'Intervalo [' + p.a + ', ' + p.b + '] °C',
      newton: 'Valor inicial x₀ = ' + p.x0 + ' °C',
      secante: 'Valores iniciales x₀ = ' + p.s0 + ', x₁ = ' + p.s1 + ' °C'
    }[def.id];
    const stat = !r.ok ? '<span class="bad">✖ ' + esc(r.reason) + '</span>'
      : r.converged ? '<span class="good">✔ Convergió en ' + r.rows.length + ' iteraciones</span>'
        : '<span class="bad">⚠ ' + esc(r.reason) + '</span>';
    const shown = isFinite(r.root) && r.rows.length ? r.root.toFixed(4) + ' °C' : '—';
    return '<article class="mcard' + (hidden ? ' is-hidden' : '') + '" data-m="' + def.id + '"><header><h3>' + def.title +
      '</h3><span class="mres">' + shown + '</span></header><p class="mnodes">' + init + ' · tolerancia ' + p.tol + ' °C</p>' +
      '<div class="ml">' + formula + '</div><p class="mstat">' + stat + '</p>' +
      (r.rows.length ? itable(def.id, r.rows) : '') + '</article>';
  }

  function convChart(res, p, defs) {
    const series = defs.filter((d) => res[d.id].errs.length);
    if (!series.length) return '';
    const floor = 1e-16;
    const all = [];
    series.forEach((d) => res[d.id].errs.forEach((e) => all.push(Math.max(e, floor))));
    const lo = Math.floor(Math.log10(Math.min(Math.min.apply(null, all), p.tol)));
    const hi = Math.ceil(Math.log10(Math.max.apply(null, all)));
    const maxK = Math.max.apply(null, series.map((d) => res[d.id].errs.length));
    const W = 640; const H = 240; const L = 56; const R = 14; const T = 12; const B = 32;
    const px = (k) => L + (k - 1) / Math.max(maxK - 1, 1) * (W - L - R);
    const py = (v) => T + (hi - Math.log10(Math.max(v, floor))) / ((hi - lo) || 1) * (H - T - B);
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Error por iteración de cada método, en escala logarítmica">';
    for (let e = lo; e <= hi; e++) {
      s += '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + py(Math.pow(10, e)).toFixed(1) + '" y2="' + py(Math.pow(10, e)).toFixed(1) + '"/>' +
        '<text x="' + (L - 6) + '" y="' + (py(Math.pow(10, e)) + 4).toFixed(1) + '" text-anchor="end">1e' + e + '</text>';
    }
    const step = Math.max(1, Math.ceil(maxK / 12));
    for (let k = 1; k <= maxK; k += step) s += '<text x="' + px(k).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + k + '</text>';
    s += '<line class="ax" x1="' + L + '" x2="' + L + '" y1="' + T + '" y2="' + (H - B) + '"/><line class="ax" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>' +
      '<line class="tolline" x1="' + L + '" x2="' + (W - R) + '" y1="' + py(p.tol).toFixed(1) + '" y2="' + py(p.tol).toFixed(1) + '"/>' +
      '<text x="' + (L + 8) + '" y="' + (py(p.tol) - 5).toFixed(1) + '" style="fill:#ff3b30">tolerancia</text>' +
      '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 1) + '" text-anchor="middle">iteración k</text>';
    series.forEach((d) => {
      const pts = res[d.id].errs.map((e, i) => px(i + 1).toFixed(1) + ',' + py(e).toFixed(1));
      s += '<polyline fill="none" stroke="' + d.color + '" stroke-width="2.2"' + (d.dash ? ' stroke-dasharray="' + d.dash + '"' : '') + ' points="' + pts.join(' ') + '"/>';
      res[d.id].errs.forEach((e, i) => { s += '<circle cx="' + px(i + 1).toFixed(1) + '" cy="' + py(e).toFixed(1) + '" r="3" fill="' + d.color + '"/>'; });
    });
    s += '</svg><div class="legend">' + series.map((d) => '<span><i' + (d.dash ? ' class="dash"' : '') + ' style="border-color:' + d.color + '"></i>' + d.title + '</span>').join('') + '</div>';
    return '<div class="cv"><h4>Convergencia: error por iteración (escala logarítmica)</h4>' + s + '</div>';
  }

  function rootSummary(res, defs, p) {
    let spl = null;
    if (interpolable()) spl = M.compute(state.table.nodes, state.n, state.degree).spline.value;
    const rows = defs.map((d) => {
      const r = res[d.id];
      const okRoot = r.ok && r.rows.length && isFinite(r.root);
      return '<tr><td>' + d.title + '</td><td>' + (okRoot ? r.root.toFixed(4) : '—') + '</td><td>' + (r.ok ? r.rows.length : '—') + '</td><td>' +
        (okRoot && isFinite(res.exact) ? fe(Math.abs(r.root - res.exact)) : '—') + '</td><td>' + (okRoot && spl !== null ? sgn(r.root - spl) : '—') + '</td></tr>';
    });
    if (isFinite(res.exact)) {
      rows.push('<tr class="is-ref"><td>Despeje en forma cerrada (referencia)</td><td>' + res.exact.toFixed(4) + '</td><td>—</td><td>0</td><td>' +
        (spl !== null ? sgn(res.exact - spl) : '—') + '</td></tr>');
    }
    if (spl !== null) rows.push('<tr class="is-ref"><td>Interpolación: spline cúbico (tabla)</td><td>' + spl.toFixed(4) + '</td><td>—</td><td>—</td><td>0</td></tr>');
    return convChart(res, p, defs) + '<div class="table-wrap"><table><thead><tr><th>Método</th><th>T (°C)</th><th>Iteraciones</th><th>|T − forma cerrada|</th><th>Δ vs spline</th></tr></thead><tbody>' +
      rows.join('') + '</tbody></table></div><p class="hint">Las raíces resuelven el <b>modelo</b> Beta del divisor; la interpolación usa la <b>tabla</b> de calibración. Si la tabla subida no sigue la ecuación Beta de tu circuito, ambas temperaturas pueden diferir.</p>';
  }

  /* opts.reveal = true deja tarjetas y resumen ocultos para animarlos */
  function renderRoots(opts) {
    const hidden = !!(opts && opts.reveal);
    document.querySelectorAll('#seg-roots button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === state.rmethod)));
    const p = state.rp;
    const n = state.n;
    const res = RT.solve(n, p);
    const cir = CFG.circuito;
    const rExp = cir.r25 + '·e<sup>' + cir.beta + '·(1/(T+273.15) − 1/298.15)</sup>';
    $('root-eq').innerHTML = 'f(T) = ' + cir.vcc + '·' + (C.ntcAbajo() ? rExp : cir.rFija) + ' / ( ' + rExp + ' + ' + cir.rFija + ' ) − <b>' +
      res.V.toFixed(4) + '</b> = 0' +
      '<span class="note">V = N·LSB = ' + n + ' × ' + (C.LSB * 1000).toFixed(4) + ' mV = ' + res.V.toFixed(4) + ' V (lo único que la ECU conoce). ' +
      'Esta ecuación sí se puede despejar' + (isFinite(res.exact) ? ' (T = ' + res.exact.toFixed(4) + ' °C, solo como referencia)' : '') +
      ', pero los métodos de raíces sirven en general cuando no hay despeje cerrado.</span>';

    const st = $('root-status');
    const fault = n <= CFG.adc.faultLow || n >= CFG.adc.faultHigh;
    st.className = 'lookup-status' + (fault ? ' out' : '');
    st.innerHTML = 'Buscando la temperatura T tal que el modelo entregue V = <b>' + res.V.toFixed(4) + ' V</b> (N = ' + n + ').' +
      (fault ? '<span class="fault">⚠ Lectura en zona de falla del sensor: la temperatura sale del rango del intervalo y la bisección no tiene raíz garantizada.</span>' : '');

    const defs = state.rmethod === 'all' ? RMETHODS : RMETHODS.filter((d) => d.id === state.rmethod);
    const host = $('root-cards');
    host.className = 'mcards' + (defs.length === 1 ? ' single' : '');
    host.innerHTML = defs.map((d) => rootCard(d, res[d.id], p, hidden)).join('');
    const sum = $('root-summary');
    sum.className = 'compare' + (hidden ? ' is-hidden' : '');
    sum.innerHTML = rootSummary(res, defs, p);
    return { cards: [].slice.call(host.children), summary: sum };
  }

  function readRootParams() {
    const num = (id, def) => { const v = parseFloat($(id).value); return isFinite(v) ? v : def; };
    const d = RT.DEFAULTS;
    state.rp = Object.assign({}, d, {
      tol: parseFloat($('rt-tol').value) || d.tol,
      a: num('rt-a', d.a), b: num('rt-b', d.b), x0: num('rt-x0', d.x0), s0: num('rt-s0', d.s0), s1: num('rt-s1', d.s1)
    });
  }
  function refreshRoots() { renderRoots(); }

  /* ------------------------------------------------------------------
     Panel 06: curva de calibración y respuesta de la ECU (Fase 4)
     ------------------------------------------------------------------ */
  function niceTicks(a, b, count) {
    const raw = (b - a) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  function ecuSituation() {
    const n = state.n;
    const nodes = state.table.nodes;
    if (n <= CFG.adc.faultLow || n >= CFG.adc.faultHigh) {
      return { fault: true, zone: CFG.zonaFalla, t: null, low: n <= CFG.adc.faultLow, code: n <= CFG.adc.faultLow ? 'P0117' : 'P0118' };
    }
    if (state.estimate !== null && state.estimate !== undefined && isFinite(state.estimate)) {
      return { fault: false, zone: C.ecuZone(state.estimate), t: state.estimate, clamped: false };
    }
    const edge = n < nodes[0].n ? nodes[0] : nodes[nodes.length - 1];
    return { fault: false, zone: C.ecuZone(edge.t), t: edge.t, clamped: true };
  }

  function curveData() {
    if (state.curve && state.curve.table === state.table) return state.curve;
    const nodes = state.table.nodes;
    const lo = nodes[0].n;
    const hi = nodes[nodes.length - 1].n;
    const pad = (hi - lo) * 0.08 || 10;
    const x0 = Math.max(0, lo - pad);
    const x1 = Math.min(C.MAX_CODE, hi + pad);
    const K = 90;
    const sp = []; const beta = [];
    for (let i = 0; i <= K; i++) { const x = lo + (hi - lo) * i / K; sp.push([x, M.spline(nodes, x).value]); }
    for (let i = 0; i <= K; i++) {
      const x = Math.max(1, x0 + (x1 - x0) * i / K);
      const t = C.tempFromAdcExact(x);
      if (isFinite(t)) beta.push([x, t]);
    }
    state.curve = { table: state.table, x0, x1, sp, beta };
    return state.curve;
  }

  function renderEcuChart(s) {
    const nodes = state.table.nodes;
    const cd = curveData();
    const W = 640; const H = 340; const L = 54; const R = 16; const T = 18; const B = 46;
    const ts = nodes.map((p) => p.t);
    const tLo = Math.min.apply(null, ts);
    const tHi = Math.max.apply(null, ts);
    const span = (tHi - tLo) || 10;
    let beta = cd.beta.filter((p) => p[1] >= tLo - span * 0.6 && p[1] <= tHi + span * 0.6);
    // En una tabla subida, la curva Beta puede estar lejos: se incluye en el eje para que se vea la diferencia.
    // En las tablas Beta coincide con la curva, así que el eje se ajusta solo a la tabla.
    const custom = state.table.source === 'custom';
    let yMin = tLo; let yMax = tHi;
    (custom ? beta.concat(cd.sp) : cd.sp).forEach((p) => { yMin = Math.min(yMin, p[1]); yMax = Math.max(yMax, p[1]); });
    const padY = (yMax - yMin) * 0.08 || 1;
    yMin -= padY; yMax += padY;
    beta = beta.filter((p) => p[1] >= yMin && p[1] <= yMax);
    const px = (x) => L + (x - cd.x0) / ((cd.x1 - cd.x0) || 1) * (W - L - R);
    const py = (y) => T + (yMax - y) / ((yMax - yMin) || 1) * (H - T - B);
    const poly = (arr) => arr.map((p) => px(p[0]).toFixed(1) + ',' + py(p[1]).toFixed(1)).join(' ');

    state.chart = { W, L, R, x0: cd.x0, x1: cd.x1 };

    const band = (a, b, z) => {
      const lo = Math.max(a, yMin); const hi = Math.min(b, yMax);
      if (lo >= hi) return '';
      return '<rect x="' + L + '" y="' + py(hi).toFixed(1) + '" width="' + (W - L - R) + '" height="' + (py(lo) - py(hi)).toFixed(1) + '" fill="' + z.color + '" opacity=".11"/>' +
        '<text x="' + (L + 8) + '" y="' + (py(hi) + 14).toFixed(1) + '" text-anchor="start" style="fill:' + z.color + '">' + esc(z.nombre) + '</text>';
    };
    let svg = '<svg class="ec" viewBox="0 0 ' + W + ' ' + H + '" role="img">' +
      ZONE_BANDS.map((b, i) => band(i === 0 ? -1e9 : b.from, i === ZONE_BANDS.length - 1 ? 1e9 : b.to, b.zone)).join('');

    niceTicks(yMin, yMax, 5).forEach((v) => {
      svg += '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + py(v).toFixed(1) + '" y2="' + py(v).toFixed(1) + '"/>' +
        '<text x="' + (L - 7) + '" y="' + (py(v) + 4).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    });
    niceTicks(cd.x0, cd.x1, 6).forEach((v) => {
      svg += '<line class="gl" y1="' + T + '" y2="' + (H - B) + '" x1="' + px(v).toFixed(1) + '" x2="' + px(v).toFixed(1) + '"/>' +
        '<text x="' + px(v).toFixed(1) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + v + '</text>';
    });
    svg += '<line class="ax" x1="' + L + '" x2="' + L + '" y1="' + T + '" y2="' + (H - B) + '"/><line class="ax" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>' +
      '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">Código ADC (N)</text>' +
      '<text transform="translate(13 ' + ((T + H - B) / 2) + ') rotate(-90)" text-anchor="middle">Temperatura (°C)</text>';

    if (beta.length > 1) svg += '<polyline class="beta" points="' + poly(beta) + '"/>';
    svg += '<polyline class="curve" points="' + poly(cd.sp) + '"/>';
    if (nodes.length <= 40) nodes.forEach((p) => { svg += '<circle class="nd" cx="' + px(p.n).toFixed(1) + '" cy="' + py(p.t).toFixed(1) + '" r="4"/>'; });

    if (s.fault) {
      svg += '<text x="' + ((L + W - R) / 2) + '" y="' + (T + 18) + '" text-anchor="middle" style="fill:#ffb020;font-size:13px">N = ' + state.n + ': zona de falla del sensor, no se grafica</text>';
    } else {
      const x = px(C.clamp(state.n, cd.x0, cd.x1));
      const y = py(s.t);
      svg += '<line class="cross" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + y.toFixed(1) + '" y2="' + (H - B) + '"/>' +
        '<line class="cross" x1="' + L + '" x2="' + x.toFixed(1) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>' +
        '<circle class="pt' + (s.clamped ? ' out' : '') + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="7"/>';
      const right = x > W * 0.62;
      const label = s.clamped ? 'N = ' + state.n + ' · fuera de la tabla' : 'N = ' + state.n + ' · ' + s.t.toFixed(2) + ' °C';
      svg += '<text class="ptlabel" x="' + (right ? x - 12 : x + 12).toFixed(1) + '" y="' + Math.max(T + 12, y - 12).toFixed(1) + '" text-anchor="' + (right ? 'end' : 'start') + '">' + label + '</text>';
    }
    $('ecu-chart').innerHTML = svg + '</svg>';
  }

  function ecuWaiting() {
    state.ecuHold = true;
    setLights([]);
    $('ecu-grid').classList.add('is-hidden');
    $('ecu-state').style.setProperty('--zone', '#26323e');
    $('ecu-state').innerHTML = '<p class="ecu-wait">Esperando la temperatura estimada…</p>';
  }

  function refreshEcu() {
    if (state.ecuHold) return;
    const s = ecuSituation();
    const z = s.zone;
    setLights(z.luces);
    $('ecu-grid').classList.remove('is-hidden');

    let note = '';
    if (s.fault) {
      note = '<p class="znote">Lectura de ' + (s.low ? 'casi 0 V (sensor en cortocircuito a masa)' : 'casi 5 V (circuito abierto)') +
        ' · código típico <b>' + s.code + '</b> (circuito del sensor de temperatura del refrigerante, señal ' + (s.low ? 'baja' : 'alta') + ').</p>';
    } else if (s.clamped) {
      note = '<p class="znote">N = ' + state.n + ' queda fuera de la tabla: la ECU limita el valor al extremo de la calibración (' + C.fmtT(s.t) + ' °C).</p>';
    }
    const box = $('ecu-state');
    box.style.setProperty('--zone', z.color);
    box.innerHTML = '<p class="zname">' + esc(z.nombre) + '</p><p class="ztemp">' + (s.t === null ? '--.-' : s.t.toFixed(1)) +
      ' °C</p><p class="zact">' + esc(z.accion) + '</p>' + note;

    const o = z.salidas;
    $('ecu-out').innerHTML = [
      ['Inyección', o.inyeccion], ['Electroventilador', o.ventilador], ['Ralentí (IAC)', o.ralenti],
      ['Control de mezcla', o.lazo], ['Luz MIL', o.mil]
    ].map((r) => '<tr><th>' + r[0] + '</th><td>' + esc(r[1]) + '</td></tr>').join('');

    renderEcuChart(s);
  }

  function updateNow(keepFields) {
    state.token++;                                  // cancela cualquier animación
    state.n = C.adcFromVoltage(state.vin);
    if (!keepFields) syncFields();
    renderCluster(250);
    renderBitsStatic();
    renderAdcResult();
    renderLookup('final');
    renderCurve();
    refreshMethods();
    refreshRoots();
  }

  function syncFields(except) {
    if (except !== 'adc') $('in-adc').value = state.n;
    if (except !== 'volt') $('in-volt').value = state.vin.toFixed(3);
    $('in-slider').value = state.n;
  }

  const sleep = (ms, token) => new Promise((res) => {
    setTimeout(() => res(token === state.token), reduced ? Math.min(ms, 20) : ms);
  });
  const goTo = (id) => $(id).scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });

  async function runPipeline() {
    const token = ++state.token;
    const n = state.n;
    const vin = state.vin;
    const sp = state.speed;
    const sar = C.sarSteps(n);

    // — Etapa 1: muestreo y retención —
    goTo('adc');
    resetBits();
    $('adc-vin').textContent = vin.toFixed(3) + ' V';
    $('adc-log').textContent = 'Muestreando y reteniendo V_in = ' + vin.toFixed(3) + ' V…';
    $('m-vin').style.left = pct(vin);
    $('m-dac').style.left = '0%';
    renderLookup('idle');
    $('method-cards').innerHTML = '';
    $('compare').innerHTML = '';
    $('root-cards').innerHTML = '';
    $('root-summary').innerHTML = '';
    $('root-status').className = 'lookup-status';
    $('root-status').textContent = 'Esperando la interpolación…';
    $('interp-status').className = 'lookup-status';
    $('interp-status').textContent = 'Esperando la búsqueda en la tabla…';
    showEstimate(null, 300);
    ecuWaiting();
    gVolt.set(vin, 500);
    gAdc.set(0, 300);
    setLcd({ adc: 0, v: vin, bin: '0'.repeat(C.BITS) });
    if (!(await sleep(700, token))) return;

    // — Etapa 2: aproximaciones sucesivas, bit a bit —
    const cells = [...$('bits').children];
    for (let i = 0; i < sar.steps.length; i++) {
      const st = sar.steps[i];
      const cell = cells[i];
      cell.className = 'bit is-testing';
      cell.querySelector('.b').textContent = '1';
      $('m-dac').style.left = pct(st.vdac);
      gAdc.set(st.trial / ADC_DIV, 120);
      $('adc-log').innerHTML = 'Bit ' + st.bit + ' (peso ' + st.weight + '): V<sub>DAC</sub> = ' + st.vdac.toFixed(3) +
        ' V ' + (st.keep ? '≤' : '&gt;') + ' V<sub>in</sub> = ' + vin.toFixed(3) + ' V …';
      if (!(await sleep(sp * 0.6, token))) return;

      cell.className = 'bit ' + (st.keep ? 'is-on' : 'is-off');
      cell.querySelector('.b').textContent = st.keep ? '1' : '0';
      $('adc-log').innerHTML = 'Bit ' + st.bit + ' (peso ' + st.weight + '): V<sub>DAC</sub> = ' + st.vdac.toFixed(3) +
        ' V ' + (st.keep ? '≤' : '&gt;') + ' V<sub>in</sub> = ' + vin.toFixed(3) + ' V → ' +
        (st.keep ? 'se <b>conserva</b> (1)' : 'se <b>descarta</b> (0)');
      gAdc.set(st.acc / ADC_DIV, 120);
      setLcd({ adc: st.acc, v: vin, bin: C.toBinary(st.acc) });
      if (!(await sleep(sp * 0.4, token))) return;
    }
    renderAdcResult();
    $('m-dac').style.left = pct(C.voltageFromAdc(n));
    gAdc.set(n / ADC_DIV, 250);
    if (!(await sleep(600, token))) return;

    // — Etapa 3: comparación con la tabla —
    goTo('tabla');
    if (!(await sleep(500, token))) return;
    const nodes = state.table.nodes;
    for (let i = 0; i < nodes.length; i++) {
      renderLookup('scan', i);
      if (!(await sleep(Math.max(90, sp * 0.45), token))) return;
      if (nodes[i].n >= n) break;
    }
    renderLookup('final');

    // — Etapa 4: interpolación, método por método —
    if (!(await sleep(900, token))) return;
    goTo('metodos');
    if (!(await sleep(500, token))) return;
    const out = renderMethods({ reveal: true });
    for (let i = 0; i < out.cards.length; i++) {
      if (!(await sleep(Math.max(120, sp * 1.2), token))) return;
      out.cards[i].classList.remove('is-hidden');
    }
    if (out.cards.length) {
      if (!(await sleep(Math.max(120, sp * 1.2), token))) return;
      out.compare.classList.remove('is-hidden');
    }
    showEstimate(estimateFrom(out.res), 900);

    // — Etapa 5: búsqueda de raíces —
    if (!(await sleep(900, token))) return;
    goTo('raices');
    if (!(await sleep(500, token))) return;
    const rr = renderRoots({ reveal: true });
    for (let i = 0; i < rr.cards.length; i++) {
      if (!(await sleep(Math.max(120, sp * 1.5), token))) return;
      rr.cards[i].classList.remove('is-hidden');
    }
    if (!(await sleep(Math.max(120, sp * 1.5), token))) return;
    rr.summary.classList.remove('is-hidden');

    // — Etapa 6: respuesta de la ECU —
    if (!(await sleep(1100, token))) return;
    goTo('ecu');
    if (!(await sleep(600, token))) return;
    state.ecuHold = false;
    refreshEcu();
  }

  /* ------------------------------------------------------------------
     Eventos
     ------------------------------------------------------------------ */
  function setFromAdc(n) {
    state.vin = C.voltageFromAdc(n);
    updateNow(true);
  }

  $('in-slider').addEventListener('input', (e) => {
    state.vin = C.voltageFromAdc(+e.target.value);
    updateNow(false);
  });
  $('in-adc').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    if (isNaN(v)) return;
    setFromAdc(C.clamp(v, 0, C.MAX_CODE));
    syncFields('adc');
  });
  $('in-volt').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (isNaN(v)) return;
    state.vin = C.clamp(v, 0, C.VREF);
    updateNow(true);
    syncFields('volt');
  });
  $('in-adc').addEventListener('change', () => syncFields());
  $('in-volt').addEventListener('change', () => syncFields());

  /* Arrastrar sobre la curva cambia la lectura (el listener va en el contenedor,
     porque el SVG se redibuja en cada cambio) */
  const chartEl = $('ecu-chart');
  let dragging = false;
  function dragTo(ev) {
    const svg = chartEl.querySelector('svg');
    const g = state.chart;
    if (!svg || !g) return;
    const r = svg.getBoundingClientRect();
    const vx = (ev.clientX - r.left) / r.width * g.W;
    const frac = (vx - g.L) / (g.W - g.L - g.R);
    setFromAdc(C.clamp(Math.round(g.x0 + frac * (g.x1 - g.x0)), 0, C.MAX_CODE));
    syncFields();
  }
  chartEl.addEventListener('pointerdown', (ev) => { dragging = true; try { chartEl.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura */ } dragTo(ev); });
  chartEl.addEventListener('pointermove', (ev) => { if (dragging) dragTo(ev); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((n) => chartEl.addEventListener(n, () => { dragging = false; }));

  $('btn-run').addEventListener('click', runPipeline);
  $('btn-example').addEventListener('click', () => { setFromAdc(480); syncFields(); });
  $('btn-random').addEventListener('click', () => {
    const nodes = state.table.nodes;
    const lo = Math.ceil(nodes[0].n);
    const hi = Math.floor(nodes[nodes.length - 1].n);
    setFromAdc(lo + Math.floor(Math.random() * (hi - lo + 1)));
    syncFields();
  });
  $('sel-speed').addEventListener('change', (e) => { state.speed = +e.target.value; });

  ['rt-tol', 'rt-a', 'rt-b', 'rt-x0', 'rt-s0', 'rt-s1'].forEach((id) =>
    $(id).addEventListener('change', () => { state.token++; readRootParams(); refreshRoots(); }));
  $('btn-root-reset').addEventListener('click', () => {
    const d = RT.DEFAULTS;
    $('rt-tol').value = String(d.tol); $('rt-a').value = d.a; $('rt-b').value = d.b;
    $('rt-x0').value = d.x0; $('rt-s0').value = d.s0; $('rt-s1').value = d.s1;
    state.token++; readRootParams(); refreshRoots();
  });
  $('seg-roots').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]');
    if (!b) return;
    state.rmethod = b.dataset.m;
    state.token++;
    refreshRoots();
  });

  $('sel-degree').addEventListener('change', (e) => { state.degree = +e.target.value; state.token++; refreshMethods(); });
  $('seg-methods').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]');
    if (!b) return;
    state.method = b.dataset.m;
    state.token++;
    refreshMethods();
  });

  $('sel-preset').addEventListener('change', (e) => loadPreset(e.target.value));
  $('sel-xunit').addEventListener('change', (e) => {
    if (!state.user) return;
    state.user.opts.xUnit = e.target.value;
    rebuildUser();
  });
  $('btn-swap').addEventListener('click', () => {
    if (!state.user) return;
    state.user.opts.swap = !state.user.opts.swap;
    rebuildUser();
  });

  const dz = $('dropzone');
  dz.addEventListener('click', () => $('file-input').click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file-input').click(); } });
  $('file-input').addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

  /* ------------------------------------------------------------------
     Arranque
     ------------------------------------------------------------------ */
  async function selfTest() {                        // como el tablero al dar contacto
    if (reduced) return;
    setTelltales(true);
    await Promise.all([gAdc.set(10.25, 750), gVolt.set(5, 750), gTemp.set(T_MAX, 750)]);
    await Promise.all([gAdc.set(state.n / ADC_DIV, 700), gVolt.set(state.vin, 700),
      gTemp.set(state.estimate === null || state.estimate === undefined ? T_MIN : state.estimate, 700)]);
    refreshEcu();
  }

  function init() {
    $('hero-curso').textContent = CFG.proyecto.curso + ' · ' + CFG.proyecto.anio;
    $('foot-info').innerHTML = '<b>Curso:</b> ' + esc(CFG.proyecto.curso) + ' &nbsp;|&nbsp; <b>Docente:</b> ' +
      esc(CFG.proyecto.docente) + '<br><b>Integrantes:</b> ' + CFG.proyecto.integrantes.map(esc).join(' · ') +
      '<br>' + esc(CFG.proyecto.titulo) + ' — ' + CFG.proyecto.anio;
    $('sc-lo').textContent = C.ntcAbajo() ? '0 V · caliente' : '0 V · frío';
    $('sc-hi').textContent = C.ntcAbajo() ? '5 V · frío' : '5 V · caliente';
    buildBits();
    loadPreset('beta5');
    selfTest();
  }
  init();
})();
