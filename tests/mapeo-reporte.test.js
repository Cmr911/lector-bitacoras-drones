// Datos SINTÉTICOS. El encabezado de telemetría imita la estructura pública de una exportación CSV
// de un servicio de registros de vuelo (nombres de columna genéricos); las filas son inventadas.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/parse-csv.js');
const N = require('../js/normalize.js');
const M = require('../js/metrics.js');
const R = require('../js/report.js');

const HEAD_A = 'time(millisecond),datetime(utc),latitude,longitude,height_above_takeoff(meters),speed(m/s),distance(meters),max_speed(m/s),wind_speed,xSpeed(m/s),battery_percent';

test('Sugerencia de mapeo (telemetría): elige datetime/lat/lon/speed y no max_speed, wind_speed ni xSpeed', () => {
  const s = N.suggestMapping(HEAD_A.split(','));
  assert.equal(s.tipo, 'A');
  assert.equal(s.mapping.fechaHora, 1);
  assert.equal(s.mapping.lat, 2);
  assert.equal(s.mapping.lon, 3);
  assert.equal(s.mapping.vel, 5);
  assert.equal(s.mapping.alt, 4);
  assert.equal(s.hints.vel, 'ms');
  assert.equal(s.units.vel, null, 'la unidad nunca se asume');
  assert.equal(s.zona, 'UTC');
});

test('Sugerencia de mapeo (resumen): sinónimos genéricos en español, sin tildes ni mayúsculas', () => {
  const s = N.suggestMapping(['N.º de vuelo', 'Hora inicio', 'Hora fin', 'Área aplicada (mu)', 'Volumen (L)', 'Duración (min)', 'Piloto', 'Dron']);
  assert.equal(s.tipo, 'B');
  assert.equal(s.mapping.vuelo, 0);
  assert.equal(s.mapping.fechaHora, 1);
  assert.equal(s.mapping.fin, 2);
  assert.equal(s.mapping.area, 3);
  assert.equal(s.mapping.vol, 4);
  assert.equal(s.mapping.dur, 5);
  assert.equal(s.mapping.operador, 6);
  assert.equal(s.mapping.dron, 7);
  assert.equal(s.hints.area, 'mu');
  assert.equal(s.hints.dur, 'min');
});

test('Columnas de tasa (L/ha) no se sugieren como volumen ni área', () => {
  const s = N.suggestMapping(['Dosis (L/ha)', 'Fecha']);
  assert.equal(s.mapping.vol, null);
  assert.equal(s.mapping.area, null);
});

test('Empate entre columnas → sin asignar y con aviso', () => {
  const s = N.suggestMapping(['latitud', 'latitude', 'lon']);
  assert.equal(s.mapping.lat, null);
  assert.ok(s.avisos.length >= 1);
});

test('10. __proto__ como encabezado se ignora y no contamina prototipos', () => {
  const t = C.parseText('__proto__,lat,lon,constructor\n{"x":1},3.4,-76.5,y\n', {});
  const s = N.suggestMapping(t.headers);
  assert.equal(Object.values(s.mapping).includes(0), false);
  assert.equal(Object.values(s.mapping).includes(3), false);
  assert.equal(N.scoreField('fechaHora', '__proto__'), 0);
  assert.equal(({}).x, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('Flujo completo A con CSV sintético → vuelos, totales y CSV', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) { rows.push(`${i * 1000},2026-04-25 10:00:0${i},${3.4 + i * 0.00005},-76.5,5,${4 + i * 0.1},0,0,0,0,90`); }
  for (let i = 0; i < 3; i++) { rows.push(`0,2026-04-25 11:00:0${i},${3.41 + i * 0.00005},-76.5,5,5,0,0,0,0,80`); }
  const table = C.parseText(HEAD_A + '\n' + rows.join('\n'), {});
  const sug = N.suggestMapping(table.headers);
  const units = { alt: 'm', vel: 'ms' };
  const b = N.buildRecords(table, { tipo: 'A', mapping: sug.mapping, units, decimal: table.decimal });
  assert.equal(b.ok, true);
  const res = M.processTelemetry(b.records, { gapMin: 10 });
  assert.equal(res.flights.length, 2);
  assert.equal(res.flights[0].durS, 5);
  assert.equal(res.flights[0].velFuente, 'columna');
  assert.equal(res.totals.areaHa.value, null);
  const csv = R.toCsv(res);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.split('\r\n')[0].includes(';'));
  assert.ok(!/NaN|Infinity|undefined/.test(csv));
});

test('Flujo completo B con unidades convertidas (mu, galón US, min)', () => {
  const text = 'Vuelo;Inicio;Duración;Área;Volumen\n1;25/04/2026 08:00;10;30;10\n2;25/04/2026 09:00;20;15;5\n';
  const table = C.parseText(text, {});
  const b = N.buildRecords(table, { tipo: 'B', mapping: { vuelo: 0, fechaHora: 1, dur: 2, area: 3, vol: 4 }, units: { dur: 'min', area: 'mu', vol: 'galUS' } });
  assert.equal(b.ok, true);
  const res = M.processSummary(b.records);
  assert.ok(Math.abs(res.totals.areaHa.value - 3) < 1e-9);
  assert.ok(Math.abs(res.totals.volL.value - 15 * 3.785411784) < 1e-9);
  assert.equal(res.totals.durS.value, 1800);
});

test('10. CSV de salida neutraliza fórmulas: "=1+1", "+cmd", "@x", "-x", tab', () => {
  assert.equal(R.csvCell('=1+1'), "'=1+1");
  assert.equal(R.csvCell('+cmd'), "'+cmd");
  assert.equal(R.csvCell('@x'), "'@x");
  assert.equal(R.csvCell('-x'), "'-x");
  assert.equal(R.csvCell('\tx'), "'\tx");
  assert.equal(R.csvCell('a;b'), '"a;b"');
  const csv = R.toCsv({ flights: [{ n: 1, id: '=HYPERLINK("x")', dron: '+cmd', operador: '@x', distKm: -0 }], totals: {} });
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes("'+cmd"));
  assert.ok(csv.includes("'@x"));
});

test('11. SVG: un solo punto y extensión cero no producen NaN', () => {
  const uno = R.project([[[3.4, -76.5]]], 600, 400, 12);
  assert.equal(uno.viewBox, '0 0 600 400');
  assert.deepEqual(uno.tracks[0][0], [300, 200]);
  const cero = R.project([[[3.4, -76.5], [3.4, -76.5], [3.4, -76.5]]], 600, 400, 12);
  cero.tracks[0].forEach(p => p.forEach(v => assert.ok(Number.isFinite(v))));
  const linea = R.project([[[3.4, -76.5], [3.5, -76.5]]], 600, 400, 12);
  linea.tracks[0].forEach(p => p.forEach(v => assert.ok(Number.isFinite(v))));
  assert.equal(linea.tracks[0][0][0], 300);
  const vacio = R.project([], 600, 400, 12);
  assert.ok(!/NaN/.test(vacio.viewBox));
  assert.deepEqual(vacio.tracks, []);
  const polo = R.project([[[89.99999, 10], [89.99999, 11]]], 600, 400, 12);
  polo.tracks[0].forEach(p => p.forEach(v => assert.ok(Number.isFinite(v))));
});

test('Formato es-CO y guion para valores sin datos', () => {
  assert.equal(R.num(1234.567, 2), '1.234,57');
  assert.equal(R.num(NaN), '—');
  assert.equal(R.num(null), '—');
  assert.equal(R.duration(3725), '1 h 02 min');
  assert.equal(R.duration(null), '—');
  assert.equal(R.dateTime(null), '—');
});
