/*
 * Lectura de GPX y KML (telemetría). Recibe un Document (DOMParser) o lo crea en el navegador.
 * KML usa orden lon,lat[,alt]. Navegador: window.DDO.geo · Node: module.exports.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) { module.exports = mod; }
  else { root.DDO = root.DDO || {}; root.DDO.geo = mod; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_DEPTH = 64;
  var MAX_POINTS = 200000;

  function err(code, message) { return { ok: false, code: code, message: message }; }

  function localName(el) {
    var n = el.localName || el.nodeName || '';
    var k = n.indexOf(':');
    return (k === -1 ? n : n.slice(k + 1)).toLowerCase();
  }

  function kids(el) {
    var out = [], ch = el.children || [];
    for (var i = 0; i < ch.length; i++) { out.push(ch[i]); }
    return out;
  }

  function childText(el, name) {
    var ch = kids(el);
    for (var i = 0; i < ch.length; i++) { if (localName(ch[i]) === name) { return String(ch[i].textContent || '').trim(); } }
    return null;
  }

  /* Recorre elementos con límite de profundidad. fn(el, depth) puede devolver false para no descender. */
  function walk(root, fn) {
    var stack = [[root, 0]];
    while (stack.length) {
      var it = stack.pop(), el = it[0], d = it[1];
      if (d > MAX_DEPTH) { return false; }
      if (fn(el, d) === false) { continue; }
      var ch = kids(el);
      for (var i = ch.length - 1; i >= 0; i--) { stack.push([ch[i], d + 1]); }
    }
    return true;
  }

  function parseXml(text, DOMParserImpl) {
    if (typeof text !== 'string' || !text.trim()) { return err('VACIO', 'El archivo está vacío.'); }
    if (/<!DOCTYPE|<!ENTITY/i.test(text.slice(0, 4096)) || /<!ENTITY/i.test(text)) {
      return err('XML_DTD', 'El archivo XML incluye declaraciones DTD/ENTITY, que no se aceptan por seguridad.');
    }
    var P = DOMParserImpl || (typeof DOMParser !== 'undefined' ? DOMParser : null);
    if (!P) { return err('SIN_PARSER', 'No hay un lector XML disponible.'); }
    var doc;
    try { doc = new P().parseFromString(text, 'application/xml'); }
    catch (e) { return err('XML_INVALIDO', 'El archivo XML está mal formado.'); }
    if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length) {
      return err('XML_INVALIDO', 'El archivo XML está mal formado.');
    }
    return { ok: true, doc: doc };
  }

  function num(s) {
    if (s === null || s === undefined) { return null; }
    s = String(s).trim();
    if (!s || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) { return null; }
    var v = Number(s);
    return isFinite(v) ? v : null;
  }

  function pushPoint(out, lat, lon, alt, time, seg) {
    out.push({ lat: lat, lon: lon, alt: alt, time: time || null, seg: seg });
  }

  /* GPX: trkpt (o rtept si no hay trkpt) con atributos lat/lon y <time>/<ele>. */
  function fromGpxDoc(doc) {
    var rootEl = doc.documentElement;
    if (localName(rootEl) !== 'gpx') { return err('NO_GPX', 'El archivo no parece un GPX válido.'); }
    var pts = [], seg = -1, rte = [];
    var ok = walk(rootEl, function (el) {
      var n = localName(el);
      if (n === 'trkseg' || n === 'rte') { seg++; }
      if (n === 'trkpt' || n === 'rtept') {
        var target = n === 'trkpt' ? pts : rte;
        pushPoint(target, num(el.getAttribute('lat')), num(el.getAttribute('lon')), num(childText(el, 'ele')), childText(el, 'time'), Math.max(seg, 0));
        return false;
      }
      return true;
    });
    if (!ok) { return err('XML_PROFUNDO', 'El archivo XML tiene demasiados niveles anidados.'); }
    if (pts.length + rte.length > MAX_POINTS) { return err('MUCHAS_FILAS', 'El archivo supera el límite de 200.000 puntos.'); }
    var out = pts.length ? pts : rte;
    if (!out.length) { return err('SIN_PUNTOS', 'El GPX no contiene puntos de trayectoria (trkpt).'); }
    return { ok: true, formato: 'GPX', points: out };
  }

  /* Tupla KML "lon,lat[,alt]" (gx:coord usa espacios: "lon lat alt"). */
  function kmlTuple(s, sep) {
    var p = s.split(sep);
    if (p.length < 2) { return null; }
    return { lon: num(p[0]), lat: num(p[1]), alt: p.length > 2 ? num(p[2]) : null };
  }

  function fromKmlDoc(doc) {
    var rootEl = doc.documentElement;
    if (localName(rootEl) !== 'kml') { return err('NO_KML', 'El archivo no parece un KML válido.'); }
    var pts = [], seg = -1, tooMany = false, whenOf = new Map();
    function add(t, time) {
      if (!t) { return; }
      pushPoint(pts, t.lat, t.lon, t.alt, time, Math.max(seg, 0));
      if (pts.length > MAX_POINTS) { tooMany = true; }
    }
    var ok = walk(rootEl, function (el) {
      if (tooMany) { return false; }
      var n = localName(el);
      if (n === 'placemark') {
        var when = null;
        walk(el, function (e2) {
          var n2 = localName(e2);
          if (n2 === 'timestamp') { when = childText(e2, 'when'); return false; }
          if (n2 === 'timespan') { when = childText(e2, 'begin'); return false; }
          return true;
        });
        whenOf.set(el, when);
        return true;
      }
      if (n === 'linestring' || n === 'point' || n === 'linearring') {
        var coords = childText(el, 'coordinates') || '';
        var tuples = coords.split(/\s+/).filter(Boolean);
        var ownerWhen = null, p = el.parentNode;
        while (p && p.nodeType === 1) { if (localName(p) === 'placemark') { ownerWhen = whenOf.get(p) || null; break; } p = p.parentNode; }
        seg++;
        for (var i = 0; i < tuples.length && !tooMany; i++) {
          add(kmlTuple(tuples[i], ','), n === 'point' ? ownerWhen : null);
        }
        return false;
      }
      if (n === 'track') {
        var whens = [], coordsT = [];
        kids(el).forEach(function (c) {
          var cn = localName(c);
          if (cn === 'when') { whens.push(String(c.textContent || '').trim()); }
          else if (cn === 'coord') { coordsT.push(String(c.textContent || '').trim()); }
        });
        seg++;
        for (var k = 0; k < coordsT.length && !tooMany; k++) {
          add(kmlTuple(coordsT[k], /\s+/), whens.length === coordsT.length ? whens[k] : null);
        }
        return false;
      }
      return true;
    });
    if (!ok) { return err('XML_PROFUNDO', 'El archivo XML tiene demasiados niveles anidados.'); }
    if (tooMany) { return err('MUCHAS_FILAS', 'El archivo supera el límite de 200.000 puntos.'); }
    if (!pts.length) { return err('SIN_PUNTOS', 'El KML no contiene coordenadas (LineString, Point o gx:Track).'); }
    return { ok: true, formato: 'KML', points: pts };
  }

  function parse(text, kind, DOMParserImpl) {
    var x = parseXml(text, DOMParserImpl);
    if (!x.ok) { return x; }
    var rn = localName(x.doc.documentElement);
    if (kind === 'gpx' || (!kind && rn === 'gpx')) { return fromGpxDoc(x.doc); }
    if (kind === 'kml' || (!kind && rn === 'kml')) { return fromKmlDoc(x.doc); }
    return err('XML_DESCONOCIDO', 'El XML no es GPX ni KML.');
  }

  return { parse: parse, parseXml: parseXml, fromGpxDoc: fromGpxDoc, fromKmlDoc: fromKmlDoc, localName: localName, walk: walk, kids: kids, childText: childText, MAX_DEPTH: MAX_DEPTH };
});
