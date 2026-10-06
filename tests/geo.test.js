// Datos SINTÉTICOS generados en la prueba (coordenadas ficticias).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/parse-geo.js');
const N = require('../js/normalize.js');
const { DOMParser } = require('./helpers/mini-dom.js');

test('6. KML "-76.5,3.4,0" → lon −76,5 y lat 3,4', () => {
  const kml = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString><coordinates>\n -76.5,3.4,0 -76.501,3.401,0\n</coordinates></LineString></Placemark></Document></kml>';
  const r = G.parse(kml, 'kml', DOMParser);
  assert.equal(r.ok, true);
  assert.equal(r.points[0].lon, -76.5);
  assert.equal(r.points[0].lat, 3.4);
  assert.equal(r.points[0].alt, 0);
  assert.equal(r.points.length, 2);
});

test('6. KML Point con TimeStamp y gx:Track con when/coord', () => {
  const kml = '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>' +
    '<Placemark><TimeStamp><when>2026-04-25T10:00:00Z</when></TimeStamp><Point><coordinates>-76.5,3.4</coordinates></Point></Placemark>' +
    '<Placemark><gx:Track><when>2026-04-25T11:00:00Z</when><when>2026-04-25T11:00:05Z</when>' +
    '<gx:coord>-76.6 3.5 10</gx:coord><gx:coord>-76.6001 3.5001 11</gx:coord></gx:Track></Placemark></Document></kml>';
  const r = G.parse(kml, 'kml', DOMParser);
  assert.equal(r.ok, true);
  assert.equal(r.points.length, 3);
  assert.equal(r.points[0].time, '2026-04-25T10:00:00Z');
  assert.equal(r.points[1].lon, -76.6);
  assert.equal(r.points[1].lat, 3.5);
  assert.equal(r.points[2].time, '2026-04-25T11:00:05Z');
});

test('6. GPX trkpt con lat/lon y time', () => {
  const gpx = '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="sintetico" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>' +
    '<trkpt lat="3.4" lon="-76.5"><ele>1000</ele><time>2026-04-25T10:00:00Z</time></trkpt>' +
    '<trkpt lat="3.4001" lon="-76.5"><time>2026-04-25T10:00:05Z</time></trkpt></trkseg></trk></gpx>';
  const r = G.parse(gpx, 'gpx', DOMParser);
  assert.equal(r.ok, true);
  assert.equal(r.points[0].lat, 3.4);
  assert.equal(r.points[0].lon, -76.5);
  assert.equal(r.points[0].alt, 1000);
  assert.equal(r.points[1].time, '2026-04-25T10:00:05Z');
  const rec = N.fromGeoPoints(r.points);
  assert.equal(rec.ctx.hasTime, true);
  assert.equal(rec.records[1].t - rec.records[0].t, 5000);
});

test('6. XML mal formado → error', () => {
  const r = G.parse('<gpx><trk><trkseg><trkpt lat="1" lon="2"></trk></gpx>', 'gpx', DOMParser);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'XML_INVALIDO');
});

test('XML con DTD/ENTITY rechazado; anidamiento excesivo rechazado', () => {
  assert.equal(G.parse('<!DOCTYPE x [<!ENTITY a "b">]><kml></kml>', 'kml', DOMParser).code, 'XML_DTD');
  const deep = '<kml>' + '<Folder>'.repeat(80) + '</Folder>'.repeat(80) + '</kml>';
  assert.equal(G.parse(deep, 'kml', DOMParser).code, 'XML_PROFUNDO');
});

test('8. Validación geo: (0,0) descartado, lat 200 descartada', () => {
  const table = { headers: ['lat', 'lon'], rows: [['0', '0'], ['200', '-76.5'], ['3.4', '-76.5'], ['', '-76.5']], decimal: '.' };
  const r = N.buildRecords(table, { tipo: 'A', mapping: { lat: 0, lon: 1 }, units: {} });
  assert.equal(r.records.length, 1);
  assert.equal(r.ctx.descartes['Punto en (0, 0)'], 1);
  assert.equal(r.ctx.descartes['Coordenada fuera de rango'], 1);
  assert.equal(r.ctx.descartes['Coordenada vacía o no numérica'], 1);
});

test('8. Latitud/longitud intercambiadas detectadas y corregibles', () => {
  const rows = [['-99.1', '19.4'], ['-99.11', '19.41'], ['-99.12', '19.42']];
  assert.equal(N.detectSwap(rows, 0, 1, '.'), true);
  assert.equal(N.detectSwap([['19.4', '-99.1']], 0, 1, '.'), false);
  const r = N.buildRecords({ headers: ['lat', 'lon'], rows, decimal: '.' }, { tipo: 'A', mapping: { lat: 0, lon: 1 }, units: {}, swap: true });
  assert.equal(r.records.length, 3);
  assert.equal(r.records[0].lat, 19.4);
});

test('Área o volumen negativos se descartan y se cuentan', () => {
  const table = { headers: ['lat', 'lon', 'area'], rows: [['3.4', '-76.5', '-2'], ['3.41', '-76.5', '1']], decimal: '.' };
  const r = N.buildRecords(table, { tipo: 'A', mapping: { lat: 0, lon: 1, area: 2 }, units: { area: 'ha' }, accum: { area: 'fila' } });
  assert.equal(r.records[0].area, null);
  assert.equal(r.ctx.avisos.negativos, 1);
});
