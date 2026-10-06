/*
 * Normalización: sugerencia de mapeo por sinónimos, fechas, unidades y validación de filas.
 * Navegador: window.DDO.normalize · Node: module.exports.
 */
(function (root, factory) {
  var csv = (typeof module === 'object' && module.exports) ? require('./parse-csv.js') : root.DDO.csv;
  var mod = factory(csv);
  if (typeof module === 'object' && module.exports) { module.exports = mod; }
  else { root.DDO = root.DDO || {}; root.DDO.normalize = mod; }
})(typeof self !== 'undefined' ? self : this, function (csv) {
  'use strict';

  var MAX_TEXT = 200;
  var PROHIBIDAS = ['__proto__', 'constructor', 'prototype'];

  function err(code, message, extra) { return csv.err(code, message, extra); }
  function trunc(s) { s = s === null || s === undefined ? '' : String(s); return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '…' : s; }

  /* ---------- Campos lógicos y unidades ---------- */

  var FIELDS = [
    { id: 'fechaHora', label: 'Fecha y hora', labelB: 'Inicio (fecha y hora)' },
    { id: 'fecha', label: 'Fecha (columna separada)' },
    { id: 'hora', label: 'Hora (columna separada)' },
    { id: 'fin', label: 'Fin (fecha y hora)', soloB: true },
    { id: 'lat', label: 'Latitud', soloA: true },
    { id: 'lon', label: 'Longitud', soloA: true },
    { id: 'alt', label: 'Altura', unidad: 'altura', soloA: true },
    { id: 'vel', label: 'Velocidad', unidad: 'velocidad', soloA: true },
    { id: 'area', label: 'Área', unidad: 'area' },
    { id: 'vol', label: 'Volumen', unidad: 'volumen' },
    { id: 'dur', label: 'Duración', unidad: 'duracion', soloB: true },
    { id: 'vuelo', label: 'ID de vuelo' },
    { id: 'dron', label: 'Dron' },
    { id: 'operador', label: 'Operador' }
  ];

  /* Factores a la unidad base: ha, L, s, m/s, m. */
  var UNITS = {
    area: { label: 'Área', base: 'ha', opciones: [['ha', 'ha', 1], ['m2', 'm²', 0.0001], ['acre', 'acres', 0.40468564224], ['mu', 'mu', 1 / 15]] },
    volumen: { label: 'Volumen', base: 'L', opciones: [['L', 'L', 1], ['mL', 'mL', 0.001], ['galUS', 'galón US', 3.785411784]] },
    duracion: { label: 'Duración', base: 's', opciones: [['s', 's', 1], ['min', 'min', 60], ['h', 'h', 3600]] },
    velocidad: { label: 'Velocidad', base: 'm/s', opciones: [['ms', 'm/s', 1], ['kmh', 'km/h', 1 / 3.6]] },
    altura: { label: 'Altura', base: 'm', opciones: [['m', 'm', 1], ['ft', 'pies', 0.3048]] }
  };

  function unitInfo(kind, unit) {
    var u = UNITS[kind];
    if (!u) { return null; }
    for (var i = 0; i < u.opciones.length; i++) { if (u.opciones[i][0] === unit) { return { id: unit, label: u.opciones[i][1], factor: u.opciones[i][2] }; } }
    return null;
  }

  /* Convierte a la unidad base. Devuelve null si no hay valor o unidad válida. */
  function convert(value, kind, unit) {
    var info = unitInfo(kind, unit);
    if (!info || typeof value !== 'number' || !isFinite(value)) { return null; }
    return value * info.factor;
  }

  /* ---------- Sugerencia de mapeo ---------- */

  function normName(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
  }

  var NEG_COMUN = /\b(max|maximo|maxima|minimo|minima|avg|mean|promedio|home|wind|viento|gimbal|rc|battery|bateria|voltage|voltaje|set|target|objetivo|rate|tasa|limit|limite)\b/;

  /* [regex, puntaje] por campo, sobre el nombre normalizado. */
  var RULES = {
    fechaHora: [[/^(datetime|date ?time|timestamp|fecha ?(y )?hora|hora ?fecha|fecha y hora)( utc| local| gmt)?$/, 10],
      [/\b(datetime|timestamp|fechahora)\b/, 7],
      [/\b(inicio|start|begin|despegue|takeoff|take off)\b/, 7],
      [/^(time|tiempo)( utc| local| gmt)?$/, 5]],
    fecha: [[/^(fecha|date|dia|day)( utc| local| gmt)?$/, 8], [/\b(fecha|date)\b/, 4]],
    hora: [[/^(hora|time|hour)( utc| local| gmt)?$/, 6], [/\b(hora|hour)\b/, 4]],
    fin: [[/\b(fin|end|final|finish|aterrizaje|landing)\b/, 8]],
    lat: [[/^(lat|latitude|latitud|gps lat|lat deg|latitude deg|y lat)$/, 10], [/\blat(itude|itud)?\b/, 6]],
    lon: [[/^(lon|lng|long|longitude|longitud|gps lon|gps lng|lon deg|longitude deg|x lon)$/, 10], [/\b(lon|lng|longitude|longitud)\b/, 6]],
    alt: [[/^(alt|altitude|altitud|altura|height|ele|elevation|elevacion)( m| meters| metros| ft| feet)?$/, 9], [/\b(alt|altitude|altitud|altura|height|elevation|elevacion)\b/, 6]],
    vel: [[/^(speed|velocidad|vel|rapidez|ground speed|velocidad de vuelo)( m s| km h| kmh| kph)?$/, 10], [/\b(speed|velocidad|vel|rapidez)\b/, 6]],
    area: [[/^(area|superficie|hectareas|hectares|ha|mu|acres)( ha| m2| mu| acres)?$/, 10], [/\b(area|superficie|hectareas?|hectares?|acres?)\b/, 6]],
    vol: [[/^(volume|volumen|volumen aplicado|liquid|liquido|litros|liters|litres)( l| ml| litros| liters| gal)?$/, 10],
      [/\b(volume|volumen|liquid|liquido|litros?|liters?|litres?|caudal total|spray amount|consumo|dosage|dosis aplicada)\b/, 6]],
    dur: [[/^(duration|duracion|tiempo de vuelo|flight time|flight duration|tiempo vuelo)( s| min| h| sec| seg)?$/, 10],
      [/\b(duration|duracion|flight time|tiempo de vuelo|tiempo vuelo|elapsed|transcurrido)\b/, 7]],
    vuelo: [[/\b(vuelo|flight|mision|mission|sortie|tarea|task)\b.*\b(id|n|no|num|numero|nro|code|codigo|#)\b|\b(id|n|no|num|numero|nro|#)\b.*\b(vuelo|flight|mision|mission|sortie|tarea|task)\b/, 9],
      [/^(vuelo|flight|mision|mission|sortie|tarea|task|flight id|id)$/, 7]],
    dron: [[/^(drone|dron|aircraft|aeronave|uav|uas|equipo|drone name|nombre dron|serial|numero de serie|sn)$/, 9], [/\b(drone|dron|aircraft|aeronave|uav|uas)\b/, 6]],
    operador: [[/^(operator|operador|pilot|piloto|piloto al mando|user|usuario)$/, 9], [/\b(operator|operador|pilot|piloto)\b/, 6]]
  };

  var NEG = {
    fechaHora: /\b(millisecond|milliseconds|ms|elapsed|transcurrido|duracion|duration|flight time|tiempo de vuelo|fin|end|final|landing|aterrizaje)\b/,
    hora: /\b(millisecond|ms|elapsed|duracion|duration|flight|vuelo|fin|end)\b/,
    fecha: /\b(fin|end|final)\b/,
    alt: /\b(ground|terreno|suelo|sonar|min|ascent)\b/,
    vel: /\b(min|x|y|z|vertical|ascenso|descenso|ascent|descent)\b/,
    area: /\b(por|per)\b/,
    vol: /\b(por|per|tanque|tank|capacidad|capacity|rate|caudal|flow)\b/,
    vuelo: /\b(time|tiempo|duracion|duration|fecha|date|distance|distancia|area|volumen|volume|speed|velocidad|hora)\b/,
    dron: /\b(battery|bateria)\b/
  };

  function scoreField(field, rawName) {
    var n = normName(rawName);
    if (!n || PROHIBIDAS.indexOf(String(rawName).trim()) !== -1 || PROHIBIDAS.indexOf(n) !== -1) { return 0; }
    if (NEG_COMUN.test(n)) { return 0; }
    if (NEG[field] && NEG[field].test(n)) { return 0; }
    if ((field === 'area' || field === 'vol') && /\/\s*(ha|mu|acre|min|h)\b/i.test(String(rawName))) { return 0; }
    var rules = RULES[field] || [], best = 0;
    for (var i = 0; i < rules.length; i++) { if (rules[i][0].test(n) && rules[i][1] > best) { best = rules[i][1]; } }
    return best;
  }

  /* Pista de unidad según el encabezado (solo se muestra; el usuario elige). */
  function unitHint(kind, rawName) {
    var s = ' ' + String(rawName || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + ' ';
    var tests = {
      velocidad: [[/m\/s|\bm s\b|mps/, 'ms'], [/km\/h|kmh|kph|km h/, 'kmh']],
      area: [[/m2|m²|metros cuadrados|sq m/, 'm2'], [/\bacres?\b/, 'acre'], [/\bmu\b/, 'mu'], [/\bha\b|hectar/, 'ha']],
      volumen: [[/\bml\b/, 'mL'], [/\bgal/, 'galUS'], [/\(l\)|\bl\b|litro|liter|litre/, 'L']],
      duracion: [[/\bmin|minutos|minutes/, 'min'], [/\(h\)|\bhoras?\b|\bhours?\b|\bh\b/, 'h'], [/\(s\)|\bs\b|\bsec|\bseg|segundos|seconds/, 's']],
      altura: [[/\bft\b|feet|pies/, 'ft'], [/\(m\)|\bm\b|meters|metros/, 'm']]
    };
    var t = tests[kind] || [];
    for (var i = 0; i < t.length; i++) { if (t[i][0].test(s)) { return t[i][1]; } }
    return null;
  }

  /* Sugerencia de mapeo: asignación voraz por puntaje; empates quedan sin asignar con aviso. */
  function suggestMapping(headers) {
    var mapping = {}, avisos = [], cands = [];
    FIELDS.forEach(function (f) { mapping[f.id] = null; });
    FIELDS.forEach(function (f) {
      for (var c = 0; c < headers.length; c++) {
        var s = scoreField(f.id, headers[c]);
        if (s >= 5) { cands.push({ f: f.id, c: c, s: s }); }
      }
    });
    cands.sort(function (a, b) { return b.s - a.s || a.c - b.c; });
    var usedCols = {}, doneFields = {};
    for (var i = 0; i < cands.length; i++) {
      var k = cands[i];
      if (doneFields[k.f] || usedCols[k.c]) { continue; }
      var empate = cands.filter(function (o) { return o.f === k.f && o.s === k.s && o.c !== k.c && !usedCols[o.c]; });
      doneFields[k.f] = true;
      if (empate.length) {
        var lbl = FIELDS.filter(function (f) { return f.id === k.f; })[0].label;
        avisos.push('Varias columnas podrían ser «' + lbl + '»; elige la correcta.');
        continue;
      }
      mapping[k.f] = k.c; usedCols[k.c] = true;
    }
    if (mapping.fecha !== null && mapping.hora !== null && mapping.fechaHora !== null) { mapping.fechaHora = null; }
    if (mapping.fechaHora === null && mapping.fecha === null && mapping.hora !== null) { mapping.fechaHora = mapping.hora; mapping.hora = null; }
    var units = {};
    FIELDS.forEach(function (f) { if (f.unidad && mapping[f.id] !== null) { units[f.id] = null; } });
    var hints = {};
    FIELDS.forEach(function (f) { if (f.unidad && mapping[f.id] !== null) { hints[f.id] = unitHint(f.unidad, headers[mapping[f.id]]); } });
    var tipo = (mapping.lat !== null && mapping.lon !== null) ? 'A' : 'B';
    var zona = 'archivo';
    if (mapping.fechaHora !== null && /utc|gmt/i.test(headers[mapping.fechaHora])) { zona = 'UTC'; }
    return { mapping: mapping, units: units, hints: hints, tipo: tipo, zona: zona, avisos: avisos };
  }

  /* ---------- Fechas ---------- */

  var AMPM = '([ap])\\.?\\s*m\\.?';
  var TIME = '(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:[.,](\\d{1,9}))?)?\\s*(?:' + AMPM + ')?';
  var ZONE = '(Z|UTC|GMT|[+-]\\d{2}(?::?\\d{2})?)?';
  var RE_ISO = new RegExp('^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})(?:(?:T|\\s+)' + TIME + ')?\\s*' + ZONE + '$', 'i');
  var RE_DMY = new RegExp('^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{4}|\\d{2})(?:(?:T|\\s+|,\\s*)' + TIME + ')?\\s*' + ZONE + '$', 'i');
  var RE_TIME = new RegExp('^' + TIME + '$', 'i');

  var EXCEL_EPOCH = Date.UTC(1899, 11, 30);

  /* Serie de Excel (sistema 1900, incluye el desfase del 29/02/1900 inexistente para series > 60). */
  function excelSerialToMs(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 20000 || n > 80000) {
      return err('SERIE_FUERA_RANGO', 'El número no está en el rango de fechas de Excel admitido (20000–80000).');
    }
    return { ok: true, t: EXCEL_EPOCH + Math.round(n * 86400) * 1000, off: null };
  }

  function to24(h, ap) {
    if (!ap) { return h; }
    if (h < 1 || h > 12) { return NaN; }
    ap = ap.toLowerCase();
    if (ap === 'a') { return h === 12 ? 0 : h; }
    return h === 12 ? 12 : h + 12;
  }

  function zoneMinutes(z) {
    if (!z) { return null; }
    if (/^(z|utc|gmt)$/i.test(z)) { return 0; }
    var m = /^([+-])(\d{2}):?(\d{2})?$/.exec(z);
    if (!m) { return NaN; }
    var v = Number(m[2]) * 60 + Number(m[3] || 0);
    return m[1] === '-' ? -v : v;
  }

  function build(y, mo, d, h, mi, s, frac, ap, z) {
    y = Number(y); mo = Number(mo); d = Number(d);
    h = h === undefined ? 0 : to24(Number(h), ap); mi = Number(mi || 0); s = Number(s || 0);
    var ms = frac ? Math.round(Number('0.' + frac) * 1000) : 0;
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h <= 23 && mi <= 59 && s <= 60)) {
      return err('FECHA_INVALIDA', 'Fecha u hora fuera de rango.');
    }
    var t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
    var chk = new Date(t);
    if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) {
      return err('FECHA_INVALIDA', 'La fecha no existe en el calendario.');
    }
    var off = zoneMinutes(z);
    if (off !== null && !isFinite(off)) { return err('FECHA_INVALIDA', 'Zona horaria no reconocida.'); }
    return { ok: true, t: off === null ? t : t - off * 60000, off: off };
  }

  /*
   * Interpreta una fecha-hora. order: 'dmy' | 'mdy' | null.
   * Devuelve { ok, t, off } donde off=null significa "tal como aparece en el archivo" (sin zona).
   */
  function parseDateTime(raw, order, opts) {
    opts = opts || {};
    if (typeof raw === 'number') { return excelSerialToMs(raw); }
    var s = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!s) { return err('FECHA_VACIA', 'Fecha vacía.'); }
    var n = csv.parseNumber(s, opts.decimal || '.');
    if (n !== null && /^[+-]?[\d.,]+$/.test(s)) { return excelSerialToMs(n); }
    var m = RE_ISO.exec(s);
    if (m) { return build(m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9]); }
    m = RE_DMY.exec(s);
    if (m) {
      var a = Number(m[1]), b = Number(m[2]), y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      var o = order;
      if (!o) {
        if (a > 12 && b <= 12) { o = 'dmy'; }
        else if (b > 12 && a <= 12) { o = 'mdy'; }
        else if (a > 12 && b > 12) { return err('FECHA_INVALIDA', 'La fecha no es válida.'); }
        else { return err('FECHA_AMBIGUA', 'La fecha «' + trunc(s) + '» puede ser día/mes o mes/día. Elige el formato.', { opciones: ['dmy', 'mdy'] }); }
      }
      return o === 'dmy' ? build(y, b, a, m[4], m[5], m[6], m[7], m[8], m[9]) : build(y, a, b, m[4], m[5], m[6], m[7], m[8], m[9]);
    }
    return err('FECHA_INVALIDA', 'Formato de fecha no reconocido: «' + trunc(s) + '».');
  }

  /* Hora sola (columna separada) → segundos del día. Admite fracción de día de Excel. */
  function parseTime(raw, decimal) {
    if (typeof raw === 'number') { return raw >= 0 && raw < 1 ? { ok: true, s: Math.round(raw * 86400) } : err('HORA_INVALIDA', 'Hora no válida.'); }
    var s = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!s) { return err('HORA_VACIA', 'Hora vacía.'); }
    var n = csv.parseNumber(s, decimal || '.');
    if (n !== null && n >= 0 && n < 1) { return { ok: true, s: Math.round(n * 86400) }; }
    var m = RE_TIME.exec(s);
    if (!m) { return err('HORA_INVALIDA', 'Hora no reconocida: «' + trunc(s) + '».'); }
    var h = to24(Number(m[1]), m[5]), mi = Number(m[2]), se = Number(m[3] || 0);
    if (!(h >= 0 && h <= 23 && mi <= 59 && se <= 60)) { return err('HORA_INVALIDA', 'Hora fuera de rango.'); }
    return { ok: true, s: h * 3600 + mi * 60 + se + (m[4] ? Number('0.' + m[4]) : 0) };
  }

  /* Formato de fechas en una columna: 'dmy' | 'mdy' | 'ambigua' | 'conflicto' | 'no-aplica'. */
  function detectDateOrder(values) {
    var dmy = false, mdy = false, any = false;
    for (var i = 0; i < values.length; i++) {
      var s = String(values[i] === null || values[i] === undefined ? '' : values[i]).trim();
      var m = RE_DMY.exec(s);
      if (!m) { continue; }
      any = true;
      var a = Number(m[1]), b = Number(m[2]);
      if (a > 12) { dmy = true; }
      if (b > 12) { mdy = true; }
    }
    if (!any) { return 'no-aplica'; }
    if (dmy && mdy) { return 'conflicto'; }
    return dmy ? 'dmy' : mdy ? 'mdy' : 'ambigua';
  }

  /* ---------- Validación de mapeo y conversión de filas ---------- */

  function colValues(rows, c) { var out = new Array(rows.length); for (var i = 0; i < rows.length; i++) { out[i] = rows[i][c]; } return out; }

  function isMapped(v) { return typeof v === 'number' && v >= 0; }

  /* ¿Latitud y longitud intercambiadas? (|lat| > 90 en la mayoría de filas numéricas). */
  function detectSwap(rows, cLat, cLon, decimal) {
    var tot = 0, sw = 0;
    for (var i = 0; i < rows.length; i++) {
      var la = csv.parseNumber(rows[i][cLat], decimal), lo = csv.parseNumber(rows[i][cLon], decimal);
      if (la === null || lo === null) { continue; }
      tot++;
      if (Math.abs(la) > 90 && Math.abs(lo) <= 90) { sw++; }
    }
    return tot > 0 && sw / tot > 0.5;
  }

  /*
   * Valida la configuración y prepara el contexto de conversión.
   * cfg: { tipo, mapping, units, decimal, dateOrder, swap, accum: {area, vol} }
   */
  function prepare(table, cfg) {
    var m = cfg.mapping || {}, errores = [], need = {};
    var tipo = cfg.tipo === 'B' ? 'B' : 'A';
    function lbl(id) { return FIELDS.filter(function (f) { return f.id === id; })[0].label; }
    var activos = FIELDS.filter(function (f) { return isMapped(m[f.id]) && !(tipo === 'A' && f.soloB) && !(tipo === 'B' && f.soloA); });
    var usados = {};
    activos.forEach(function (f) {
      if (m[f.id] >= table.headers.length) { errores.push('La columna asignada a «' + f.label + '» no existe.'); }
      if (usados[m[f.id]]) { errores.push('La columna «' + trunc(table.headers[m[f.id]]) + '» está asignada a más de un campo.'); }
      usados[m[f.id]] = true;
      if (f.unidad && !unitInfo(f.unidad, (cfg.units || {})[f.id])) { errores.push('Elige la unidad de «' + f.label + '».'); }
    });
    var has = function (id) { return activos.some(function (f) { return f.id === id; }); };
    if (has('fechaHora') && (has('fecha') || has('hora'))) { errores.push('Usa una columna de fecha y hora, o fecha y hora separadas, pero no ambas.'); }
    if (has('hora') && !has('fecha')) { errores.push('Asignaste la hora; falta la columna de fecha.'); }
    if (tipo === 'A') {
      if (!has('lat') || !has('lon')) { errores.push('Para telemetría asigna las columnas de latitud y longitud.'); }
      if (has('area') && !(cfg.accum && cfg.accum.area)) { errores.push('Indica cómo leer el área: acumulada en el vuelo o por fila.'); }
      if (has('vol') && !(cfg.accum && cfg.accum.vol)) { errores.push('Indica cómo leer el volumen: acumulado en el vuelo o por fila.'); }
    } else if (!has('fechaHora') && !has('fecha') && !has('dur') && !has('area') && !has('vol')) {
      errores.push('Para el resumen por vuelo asigna al menos inicio, duración, área o volumen.');
    }
    var dateCols = ['fechaHora', 'fecha', 'fin'].filter(has).map(function (id) { return m[id]; });
    var order = cfg.dateOrder || null;
    if (!order) {
      var dets = dateCols.map(function (c) { return detectDateOrder(colValues(table.rows, c)); });
      var fijo = dets.filter(function (d) { return d === 'dmy' || d === 'mdy'; });
      if (dets.indexOf('conflicto') !== -1 || fijo.some(function (d) { return d !== fijo[0]; })) {
        errores.push('Las fechas mezclan formatos día/mes y mes/día. Elige el formato.'); need.dateOrder = true;
      } else if (fijo.length) { order = fijo[0]; }
      else if (dets.indexOf('ambigua') !== -1) { errores.push('Las fechas pueden leerse como día/mes/año o mes/día/año. Elige el formato.'); need.dateOrder = true; }
    }
    if (errores.length) { return err('MAPEO', errores[0], { errores: errores, need: need }); }
    var u = {};
    activos.forEach(function (f) { if (f.unidad) { u[f.id] = unitInfo(f.unidad, cfg.units[f.id]).factor; } });
    var cols = {};
    activos.forEach(function (f) { cols[f.id] = m[f.id]; });
    return {
      ok: true, tipo: tipo, cols: cols, factors: u, decimal: cfg.decimal || table.decimal || '.',
      dateOrder: order, swap: !!cfg.swap, accum: cfg.accum || {}, hasTime: has('fechaHora') || has('fecha'),
      descartes: {}, avisos: { negativos: 0 }, futuros: 0
    };
  }

  function count(ctx, reason) { ctx.descartes[reason] = (ctx.descartes[reason] || 0) + 1; }

  function rowTime(row, ctx, which) {
    var c = ctx.cols;
    if (which === 'fin') { return isMapped(c.fin) ? parseDateTime(row[c.fin], ctx.dateOrder, { decimal: ctx.decimal }) : null; }
    if (isMapped(c.fechaHora)) { return parseDateTime(row[c.fechaHora], ctx.dateOrder, { decimal: ctx.decimal }); }
    if (isMapped(c.fecha)) {
      var d = parseDateTime(row[c.fecha], ctx.dateOrder, { decimal: ctx.decimal });
      if (!d.ok || !isMapped(c.hora)) { return d; }
      var h = parseTime(row[c.hora], ctx.decimal);
      if (!h.ok) { return h; }
      return { ok: true, t: d.t + Math.round(h.s * 1000), off: d.off };
    }
    return null;
  }

  function numField(row, ctx, id) {
    if (!isMapped(ctx.cols[id])) { return null; }
    var v = csv.parseNumber(row[ctx.cols[id]], ctx.decimal);
    if (v === null) { return null; }
    if (ctx.factors[id] !== undefined) { v = v * ctx.factors[id]; }
    if (v < 0 && (id === 'area' || id === 'vol' || id === 'dur' || id === 'vel')) { ctx.avisos.negativos++; return null; }
    return v;
  }

  function textField(row, ctx, id) {
    if (!isMapped(ctx.cols[id])) { return null; }
    var s = String(row[ctx.cols[id]] === undefined ? '' : row[ctx.cols[id]]).trim();
    return s ? trunc(s) : null;
  }

  /* Convierte una fila. Tipo A → punto; tipo B → vuelo. null si se descarta (motivo contado en ctx). */
  function convertRow(row, ctx) {
    var tm = rowTime(row, ctx), c = ctx.cols;
    if (ctx.tipo === 'A') {
      var lat = csv.parseNumber(row[c.lat], ctx.decimal), lon = csv.parseNumber(row[c.lon], ctx.decimal);
      if (ctx.swap) { var tmp = lat; lat = lon; lon = tmp; }
      if (lat === null || lon === null) { count(ctx, 'Coordenada vacía o no numérica'); return null; }
      if (lat === 0 && lon === 0) { count(ctx, 'Punto en (0, 0)'); return null; }
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { count(ctx, 'Coordenada fuera de rango'); return null; }
      if (tm && !tm.ok) { count(ctx, tm.code === 'FECHA_AMBIGUA' ? 'Fecha ambigua' : 'Fecha u hora no válida'); return null; }
      return {
        t: tm ? tm.t : null, off: tm ? tm.off : null, lat: lat, lon: lon,
        alt: numField(row, ctx, 'alt'), vel: numField(row, ctx, 'vel'), area: numField(row, ctx, 'area'), vol: numField(row, ctx, 'vol'),
        vuelo: textField(row, ctx, 'vuelo'), dron: textField(row, ctx, 'dron'), operador: textField(row, ctx, 'operador'), seg: 0
      };
    }
    var fin = rowTime(row, ctx, 'fin');
    var rec = {
      inicio: tm && tm.ok ? tm.t : null, fin: fin && fin.ok ? fin.t : null, off: tm && tm.ok ? tm.off : (fin && fin.ok ? fin.off : null),
      durCol: numField(row, ctx, 'dur'), area: numField(row, ctx, 'area'), vol: numField(row, ctx, 'vol'),
      vuelo: textField(row, ctx, 'vuelo'), dron: textField(row, ctx, 'dron'), operador: textField(row, ctx, 'operador')
    };
    if ((tm && !tm.ok) || (fin && !fin.ok)) { count(ctx, 'Fecha u hora no válida (campo vacío en el reporte)'); }
    if (rec.inicio === null && rec.fin === null && rec.durCol === null && rec.area === null && rec.vol === null) {
      count(ctx, 'Fila sin datos utilizables'); return null;
    }
    return rec;
  }

  /* Conversión completa síncrona (pruebas y archivos pequeños). */
  function buildRecords(table, cfg) {
    var ctx = prepare(table, cfg);
    if (!ctx.ok) { return ctx; }
    var out = [];
    for (var i = 0; i < table.rows.length; i++) { var r = convertRow(table.rows[i], ctx); if (r) { out.push(r); } }
    return { ok: true, ctx: ctx, records: out };
  }

  /* Puntos GPX/KML → mismos registros de telemetría. */
  function fromGeoPoints(points) {
    var ctx = { ok: true, tipo: 'A', descartes: {}, avisos: { negativos: 0 }, hasTime: false };
    var out = [], anyTime = false;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var lat = p.lat, lon = p.lon;
      if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) { count(ctx, 'Coordenada vacía o no numérica'); continue; }
      if (lat === 0 && lon === 0) { count(ctx, 'Punto en (0, 0)'); continue; }
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { count(ctx, 'Coordenada fuera de rango'); continue; }
      var t = null, off = null;
      if (p.time) {
        var d = parseDateTime(p.time, null);
        if (d.ok) { t = d.t; off = d.off; anyTime = true; }
      }
      out.push({ t: t, off: off, lat: lat, lon: lon, alt: p.alt, vel: null, area: null, vol: null, vuelo: null, dron: null, operador: null, seg: p.seg || 0 });
    }
    if (anyTime) {
      var before = out.length;
      out = out.filter(function (r) { return r.t !== null; });
      if (before > out.length) { ctx.descartes['Punto sin hora (el archivo tiene horas en otros puntos)'] = before - out.length; }
    }
    ctx.hasTime = anyTime;
    return { ok: true, ctx: ctx, records: out };
  }

  return {
    FIELDS: FIELDS, UNITS: UNITS, MAX_TEXT: MAX_TEXT, trunc: trunc, normName: normName, unitInfo: unitInfo, convert: convert,
    scoreField: scoreField, unitHint: unitHint, suggestMapping: suggestMapping,
    excelSerialToMs: excelSerialToMs, parseDateTime: parseDateTime, parseTime: parseTime, detectDateOrder: detectDateOrder,
    detectSwap: detectSwap, prepare: prepare, convertRow: convertRow, buildRecords: buildRecords, fromGeoPoints: fromGeoPoints,
    isMapped: isMapped
  };
});
