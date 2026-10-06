/*
 * Métricas puras: distancias, segmentación en vuelos, totales y derivados.
 * Nunca devuelve NaN/Infinity: los valores sin datos son null con su motivo.
 * Navegador: window.DDO.metrics · Node: module.exports.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) { module.exports = mod; }
  else { root.DDO = root.DDO || {}; root.DDO.metrics = mod; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var R_KM = 6371;
  var SALTO_MAX_MS = 100;      // m/s entre puntos consecutivos
  var VEL_AVISO_MS = 30;       // m/s
  var VUELO_CORTO_S = 60;

  function rad(d) { return d * Math.PI / 180; }

  /* Distancia haversine en km. */
  function haversine(lat1, lon1, lat2, lon2) {
    var dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    var d = R_KM * c;
    return isFinite(d) ? d : 0;
  }

  function pathKm(points) {
    var d = 0;
    for (var i = 1; i < points.length; i++) { d += haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon); }
    return d;
  }

  function fin(v) { return typeof v === 'number' && isFinite(v); }

  /* Valor derivado: { value, motivo } (value null si no se puede calcular). */
  function val(v, motivo) { return fin(v) ? { value: v, motivo: null } : { value: null, motivo: motivo || 'Sin datos' }; }

  /* L/ha y ha/h solo con datos presentes; sin división por cero. */
  function derived(areaHa, volL, durS) {
    var lha, hah;
    if (!fin(volL) && !fin(areaHa)) { lha = val(null, 'El archivo no trae área ni volumen'); }
    else if (!fin(areaHa)) { lha = val(null, 'El archivo no trae área'); }
    else if (!fin(volL)) { lha = val(null, 'El archivo no trae volumen'); }
    else if (areaHa <= 0) { lha = val(null, 'Área total igual a 0'); }
    else { lha = val(volL / areaHa); }
    if (!fin(areaHa)) { hah = val(null, 'El archivo no trae área'); }
    else if (!fin(durS)) { hah = val(null, 'Sin tiempo de vuelo'); }
    else if (durS <= 0) { hah = val(null, 'Tiempo de vuelo igual a 0'); }
    else { hah = val(areaHa / (durS / 3600)); }
    return { lha: lha, hah: hah };
  }

  function addCount(obj, k, n) { if (n > 0) { obj[k] = (obj[k] || 0) + n; } }

  function uniqueText(list, key) {
    var seen = [];
    for (var i = 0; i < list.length; i++) { var v = list[i][key]; if (v && seen.indexOf(v) === -1) { seen.push(v); if (seen.length > 5) { break; } } }
    return seen.length ? (seen.length > 5 ? seen.slice(0, 5).join(', ') + '…' : seen.join(', ')) : null;
  }

  function aggregate(values, mode) {
    var have = values.filter(fin);
    if (!have.length || !mode) { return null; }
    if (mode === 'acumulado') { return have.reduce(function (a, b) { return a > b ? a : b; }); }
    return have.reduce(function (a, b) { return a + b; }, 0);
  }

  /*
   * Telemetría (tipo A). points: [{t, off, lat, lon, alt, vel, area, vol, vuelo, dron, operador, seg}]
   * opts: { gapMin (1–120), useFlightId, hasTime, hasVel, accum: {area, vol}, now }
   */
  function processTelemetry(points, opts) {
    opts = opts || {};
    var gapMin = fin(opts.gapMin) ? Math.min(120, Math.max(1, opts.gapMin)) : 10;
    var descartes = {}, avisos = [];
    var hasTime = points.some(function (p) { return p.t !== null && p.t !== undefined; });

    // 1) Duplicados exactos
    var seen = new Set(), pts = [];
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var key = p.t + '|' + p.lat + '|' + p.lon + '|' + p.alt + '|' + (p.vuelo || '');
      if (seen.has(key)) { addCount(descartes, 'Duplicado exacto', 1); continue; }
      seen.add(key); pts.push(p);
    }
    // 2) Orden por tiempo (estable)
    if (hasTime) { pts.sort(function (a, b) { return a.t - b.t; }); }

    // 3) Agrupación: id de vuelo, brecha de tiempo o segmento del archivo
    var groups = [];
    if (opts.useFlightId) {
      var idx = new Map();
      pts.forEach(function (p) {
        var k = p.vuelo || '(sin id)';
        if (!idx.has(k)) { idx.set(k, groups.length); groups.push({ id: k, pts: [] }); }
        groups[idx.get(k)].pts.push(p);
      });
    } else if (hasTime) {
      var cur = null;
      pts.forEach(function (p) {
        if (!cur || (p.t - cur.pts[cur.pts.length - 1].t) > gapMin * 60000) { cur = { id: null, pts: [] }; groups.push(cur); }
        cur.pts.push(p);
      });
    } else {
      var bySeg = new Map();
      pts.forEach(function (p) {
        var k = p.seg || 0;
        if (!bySeg.has(k)) { bySeg.set(k, groups.length); groups.push({ id: null, pts: [] }); }
        groups[bySeg.get(k)].pts.push(p);
      });
    }

    // 4) Saltos imposibles (> 100 m/s) dentro de cada vuelo
    var saltos = 0;
    if (hasTime) {
      groups.forEach(function (g) {
        var kept = [];
        g.pts.forEach(function (p) {
          if (kept.length) {
            var q = kept[kept.length - 1];
            var dm = haversine(q.lat, q.lon, p.lat, p.lon) * 1000;
            var dt = (p.t - q.t) / 1000;
            if (dm / Math.max(dt, 1) > SALTO_MAX_MS) { saltos++; return; }
          }
          kept.push(p);
        });
        g.pts = kept;
      });
    }
    addCount(descartes, 'Salto de posición imposible (> 100 m/s)', saltos);

    // 5) Métricas por vuelo
    var accum = opts.accum || {};
    var flights = groups.filter(function (g) { return g.pts.length; }).map(function (g, n) {
      var ps = g.pts, first = ps[0], last = ps[ps.length - 1];
      var dist = pathKm(ps);
      var dur = hasTime ? (last.t - first.t) / 1000 : null;
      var velCol = ps.map(function (p) { return p.vel; }).filter(fin);
      var avg = null, max = null, fuente = null;
      if (velCol.length) {
        avg = velCol.reduce(function (a, b) { return a + b; }, 0) / velCol.length;
        max = velCol.reduce(function (a, b) { return a > b ? a : b; });
        fuente = 'columna';
      } else if (hasTime) {
        avg = dur > 0 ? (dist * 1000) / dur : null;
        for (var k = 1; k < ps.length; k++) {
          var dt = (ps[k].t - ps[k - 1].t) / 1000;
          if (dt > 0) { var s = haversine(ps[k - 1].lat, ps[k - 1].lon, ps[k].lat, ps[k].lon) * 1000 / dt; if (max === null || s > max) { max = s; } }
        }
        fuente = 'calculada';
      }
      var bbox = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity };
      var altMax = null;
      ps.forEach(function (p) {
        if (p.lat < bbox.minLat) { bbox.minLat = p.lat; } if (p.lat > bbox.maxLat) { bbox.maxLat = p.lat; }
        if (p.lon < bbox.minLon) { bbox.minLon = p.lon; } if (p.lon > bbox.maxLon) { bbox.maxLon = p.lon; }
        if (fin(p.alt) && (altMax === null || p.alt > altMax)) { altMax = p.alt; }
      });
      return {
        n: n + 1, id: g.id, inicio: hasTime ? first.t : null, fin: hasTime ? last.t : null, off: first.off,
        durS: fin(dur) ? dur : null, distKm: dist, velMedia: fin(avg) ? avg : null, velMax: fin(max) ? max : null, velFuente: fuente,
        puntos: ps.length, bbox: bbox, altMax: altMax,
        area: aggregate(ps.map(function (p) { return p.area; }), accum.area),
        vol: aggregate(ps.map(function (p) { return p.vol; }), accum.vol),
        dron: uniqueText(ps, 'dron'), operador: uniqueText(ps, 'operador'),
        trayectoria: ps.map(function (p) { return [p.lat, p.lon]; })
      };
    });

    var totals = totalsOf(flights, true);
    avisosComunes(flights, totals, avisos, opts.now);
    var totalPts = flights.reduce(function (a, f) { return a + f.puntos; }, 0);
    if (totalPts > 1 && totals.distKm.value === 0) { avisos.push('La distancia total es 0 aunque hay más de un punto: revisa las coordenadas.'); }
    if (!hasTime) { avisos.push('El archivo no trae hora: no se calculan duraciones ni velocidades.'); }
    return { ok: true, tipo: 'A', flights: flights, totals: totals, descartes: descartes, avisos: avisos, hasTime: hasTime };
  }

  /* Resumen por vuelo (tipo B). records: [{inicio, fin, off, durCol (s), area (ha), vol (L), vuelo, dron, operador}] */
  function processSummary(records, opts) {
    opts = opts || {};
    var avisos = [], descartes = {};
    var flights = records.map(function (r, i) {
      var dur = null;
      if (fin(r.inicio) && fin(r.fin)) {
        if (r.fin >= r.inicio) { dur = (r.fin - r.inicio) / 1000; }
        else { avisos.push('Vuelo ' + (i + 1) + ': el fin es anterior al inicio; se usa la columna de duración si existe.'); }
      }
      if (dur === null && fin(r.durCol)) { dur = r.durCol; }
      return {
        n: i + 1, id: r.vuelo || null, inicio: fin(r.inicio) ? r.inicio : null, fin: fin(r.fin) ? r.fin : (fin(r.inicio) && fin(dur) ? r.inicio + dur * 1000 : null),
        off: r.off, durS: dur, distKm: null, velMedia: null, velMax: null, velFuente: null, puntos: null, bbox: null, altMax: null,
        area: fin(r.area) ? r.area : null, vol: fin(r.vol) ? r.vol : null, dron: r.dron || null, operador: r.operador || null, trayectoria: null
      };
    });
    var totals = totalsOf(flights, false);
    avisosComunes(flights, totals, avisos, opts.now);
    return { ok: true, tipo: 'B', flights: flights, totals: totals, descartes: descartes, avisos: avisos, hasTime: flights.some(function (f) { return f.inicio !== null; }) };
  }

  function sumOf(flights, key) {
    var have = flights.filter(function (f) { return fin(f[key]); });
    return have.length ? have.reduce(function (a, f) { return a + f[key]; }, 0) : null;
  }

  function totalsOf(flights, conTrayectoria) {
    var dur = sumOf(flights, 'durS'), area = sumOf(flights, 'area'), vol = sumOf(flights, 'vol');
    var sinDur = flights.filter(function (f) { return !fin(f.durS); }).length;
    var d = derived(area, vol, dur);
    return {
      vuelos: flights.length,
      durS: val(dur, 'Sin tiempo de vuelo'),
      vuelosSinDuracion: sinDur,
      distKm: conTrayectoria ? val(sumOf(flights, 'distKm'), 'Sin trayectoria') : val(null, 'El resumen por vuelo no trae trayectoria'),
      areaHa: val(area, 'El archivo no trae área (no se estima a partir de la trayectoria)'),
      volL: val(vol, 'El archivo no trae volumen'),
      lha: d.lha, hah: d.hah
    };
  }

  function avisosComunes(flights, totals, avisos, now) {
    var limite = (fin(now) ? now : Date.now()) + 24 * 3600 * 1000;
    var cortos = flights.filter(function (f) { return fin(f.durS) && f.durS < VUELO_CORTO_S; }).map(function (f) { return f.n; });
    if (cortos.length) { avisos.push('Vuelos de menos de 1 minuto: ' + lista(cortos) + '.'); }
    var rapidos = flights.filter(function (f) { return fin(f.velMax) && f.velMax > VEL_AVISO_MS; }).map(function (f) { return f.n; });
    if (rapidos.length) { avisos.push('Velocidad mayor a 30 m/s en los vuelos: ' + lista(rapidos) + '. Revisa la unidad de velocidad o los datos.'); }
    var futuros = flights.filter(function (f) { return (fin(f.inicio) && f.inicio > limite) || (fin(f.fin) && f.fin > limite); }).map(function (f) { return f.n; });
    if (futuros.length) { avisos.push('Fechas en el futuro en los vuelos: ' + lista(futuros) + '. Revisa el formato de fecha.'); }
  }

  function lista(ns) { return ns.length > 10 ? ns.slice(0, 10).join(', ') + '… (' + ns.length + ' en total)' : ns.join(', '); }

  return {
    R_KM: R_KM, haversine: haversine, pathKm: pathKm, derived: derived,
    processTelemetry: processTelemetry, processSummary: processSummary, totalsOf: totalsOf
  };
});
