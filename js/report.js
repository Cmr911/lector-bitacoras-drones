/*
 * Reporte: formato es-CO, CSV seguro y trayectoria SVG (sin mapa base).
 * Navegador: window.DDO.report · Node: module.exports.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) { module.exports = mod; }
  else { root.DDO = root.DDO || {}; root.DDO.report = mod; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var DASH = '—';
  var PIE_LEGAL = 'Reporte informativo generado a partir de un archivo cargado por el usuario. No ha sido verificado, no constituye certificación, informe oficial ni acto administrativo.';
  var COLORES = ['#1f6b3a', '#0b57d0', '#a4161a', '#7a4b00', '#6a1b9a', '#00796b', '#c2185b', '#455a64'];

  function fin(v) { return typeof v === 'number' && isFinite(v); }

  var nfCache = {};
  function num(v, dec) {
    if (!fin(v)) { return DASH; }
    dec = dec === undefined ? 2 : dec;
    var k = String(dec);
    if (!nfCache[k]) { nfCache[k] = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: dec }); }
    return nfCache[k].format(v);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function offsetText(off) {
    if (!fin(off)) { return ''; }
    if (off === 0) { return 'UTC'; }
    var a = Math.abs(off);
    return 'UTC' + (off < 0 ? '−' : '+') + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
  }

  /* Fecha-hora: se muestra en la zona del archivo (offset) o tal como aparece (sin zona). */
  function dateTime(t, off) {
    if (!fin(t)) { return DASH; }
    var d = new Date(t + (fin(off) ? off * 60000 : 0));
    if (!fin(d.getTime())) { return DASH; }
    var s = pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' ' +
      pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
    return fin(off) ? s + ' ' + offsetText(off) : s;
  }

  function duration(s) {
    if (!fin(s) || s < 0) { return DASH; }
    var t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
    if (h) { return h + ' h ' + pad2(m) + ' min'; }
    if (m) { return m + ' min ' + pad2(x) + ' s'; }
    return x + ' s';
  }

  /* Celda CSV: neutraliza fórmulas en texto y cita si hace falta. */
  function csvCell(v, isNumber) {
    if (v === null || v === undefined) { return ''; }
    var s = String(v);
    if (!isNumber && /^[=+\-@\t\r]/.test(s)) { s = "'" + s; }
    if (/[;"\r\n]/.test(s)) { s = '"' + s.replace(/"/g, '""') + '"'; }
    return s;
  }

  function csvNum(v, dec) { return fin(v) ? v.toFixed(dec).replace('.', ',') : ''; }

  /* CSV del resumen de vuelos: UTF-8 con BOM, separador ';', decimal coma. */
  function toCsv(result) {
    var head = ['Vuelo', 'ID de vuelo', 'Inicio', 'Fin', 'Duración (min)', 'Distancia (km)', 'Vel. media (m/s)', 'Vel. máx. (m/s)', 'Puntos', 'Área (ha)', 'Volumen (L)', 'L/ha', 'Dron', 'Operador'];
    var lines = [head.map(function (h) { return csvCell(h); }).join(';')];
    (result.flights || []).forEach(function (f) {
      var lha = fin(f.area) && fin(f.vol) && f.area > 0 ? f.vol / f.area : null;
      lines.push([
        csvCell(String(f.n), true), csvCell(f.id), csvCell(fin(f.inicio) ? dateTime(f.inicio, f.off) : ''), csvCell(fin(f.fin) ? dateTime(f.fin, f.off) : ''),
        csvNum(fin(f.durS) ? f.durS / 60 : null, 2), csvNum(f.distKm, 3), csvNum(f.velMedia, 2), csvNum(f.velMax, 2),
        fin(f.puntos) ? String(f.puntos) : '', csvNum(f.area, 4), csvNum(f.vol, 3), csvNum(lha, 2), csvCell(f.dron), csvCell(f.operador)
      ].join(';'));
    });
    var t = result.totals || {};
    var g = function (o) { return o && fin(o.value) ? o.value : null; };
    lines.push([csvCell('Total'), '', '', '', csvNum(g(t.durS) !== null ? g(t.durS) / 60 : null, 2), csvNum(g(t.distKm), 3), '', '', '',
      csvNum(g(t.areaHa), 4), csvNum(g(t.volL), 3), csvNum(g(t.lha), 2), '', ''].join(';'));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /*
   * Proyección equirectangular con corrección cos(latitud media), ajustada al contenedor.
   * tracks: [[ [lat, lon], ... ], ...]. Nunca produce NaN (punto único / extensión cero → centro).
   */
  function project(tracks, w, h, pad) {
    w = fin(w) && w > 0 ? w : 600; h = fin(h) && h > 0 ? h : 400; pad = fin(pad) && pad >= 0 ? pad : 12;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, sumLat = 0, n = 0;
    tracks.forEach(function (tr) { tr.forEach(function (p) { if (fin(p[0]) && fin(p[1])) { sumLat += p[0]; n++; } }); });
    var out = { viewBox: '0 0 ' + w + ' ' + h, width: w, height: h, tracks: [] };
    if (!n) { return out; }
    var k = Math.cos(sumLat / n * Math.PI / 180);
    if (!fin(k) || k < 0.01) { k = 0.01; }
    tracks.forEach(function (tr) {
      tr.forEach(function (p) {
        if (!fin(p[0]) || !fin(p[1])) { return; }
        var x = p[1] * k, y = p[0];
        if (x < minX) { minX = x; } if (x > maxX) { maxX = x; } if (y < minY) { minY = y; } if (y > maxY) { maxY = y; }
      });
    });
    var spanX = maxX - minX, spanY = maxY - minY, aw = Math.max(1, w - 2 * pad), ah = Math.max(1, h - 2 * pad);
    var sx = spanX > 0 ? aw / spanX : Infinity, sy = spanY > 0 ? ah / spanY : Infinity;
    var s = Math.min(sx, sy);
    if (!fin(s)) { s = 0; }
    var ox = (w - spanX * s) / 2, oy = (h - spanY * s) / 2;
    out.tracks = tracks.map(function (tr) {
      return tr.filter(function (p) { return fin(p[0]) && fin(p[1]); }).map(function (p) {
        var x = ox + (p[1] * k - minX) * s, y = oy + (maxY - p[0]) * s;
        return [fin(x) ? Math.round(x * 10) / 10 : w / 2, fin(y) ? Math.round(y * 10) / 10 : h / 2];
      });
    });
    return out;
  }

  /* Reduce puntos para dibujar (conserva primero y último). */
  function thin(tr, max) {
    if (tr.length <= max) { return tr; }
    var step = tr.length / max, out = [];
    for (var i = 0; i < max - 1; i++) { out.push(tr[Math.floor(i * step)]); }
    out.push(tr[tr.length - 1]);
    return out;
  }

  /* SVG con createElementNS; sin teselas ni mapa base. */
  function buildSvg(doc, flights, opts) {
    opts = opts || {};
    var w = opts.width || 640, h = opts.height || 400;
    var tracks = flights.map(function (f) { return thin(f.trayectoria || [], 4000); });
    var pr = project(tracks, w, h, 16);
    var svg = doc.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', pr.viewBox);
    svg.setAttribute('class', 'trayectoria');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-labelledby', 'svg-titulo');
    var title = doc.createElementNS(SVGNS, 'title');
    title.setAttribute('id', 'svg-titulo');
    title.textContent = 'Trayectoria de ' + flights.length + (flights.length === 1 ? ' vuelo' : ' vuelos') + ' (sin mapa base, escala aproximada)';
    svg.appendChild(title);
    var bg = doc.createElementNS(SVGNS, 'rect');
    bg.setAttribute('x', '0'); bg.setAttribute('y', '0'); bg.setAttribute('width', String(w)); bg.setAttribute('height', String(h));
    bg.setAttribute('class', 'tray-fondo');
    svg.appendChild(bg);
    pr.tracks.forEach(function (pts, i) {
      if (!pts.length) { return; }
      var color = COLORES[i % COLORES.length];
      if (pts.length > 1) {
        var pl = doc.createElementNS(SVGNS, 'polyline');
        pl.setAttribute('points', pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' '));
        pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', color); pl.setAttribute('stroke-width', '2');
        pl.setAttribute('stroke-linejoin', 'round'); pl.setAttribute('stroke-linecap', 'round');
        svg.appendChild(pl);
      }
      var a = pts[0], b = pts[pts.length - 1];
      var c = doc.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', String(a[0])); c.setAttribute('cy', String(a[1])); c.setAttribute('r', '5');
      c.setAttribute('fill', '#ffffff'); c.setAttribute('stroke', color); c.setAttribute('stroke-width', '2.5');
      svg.appendChild(c);
      if (pts.length > 1) {
        var r = doc.createElementNS(SVGNS, 'rect');
        r.setAttribute('x', String(b[0] - 4)); r.setAttribute('y', String(b[1] - 4)); r.setAttribute('width', '8'); r.setAttribute('height', '8');
        r.setAttribute('fill', color);
        svg.appendChild(r);
      }
    });
    return svg;
  }

  return {
    DASH: DASH, PIE_LEGAL: PIE_LEGAL, COLORES: COLORES, num: num, dateTime: dateTime, duration: duration, offsetText: offsetText,
    csvCell: csvCell, toCsv: toCsv, project: project, thin: thin, buildSvg: buildSvg
  };
});
