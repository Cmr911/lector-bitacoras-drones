// Datos SINTÉTICOS generados en la prueba (no provienen de ningún operador real).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/metrics.js');

const T0 = Date.UTC(2026, 3, 25, 8, 0, 0);
function pt(min, lat, lon, extra) { return Object.assign({ t: T0 + min * 60000, off: null, lat, lon, alt: null, vel: null, area: null, vol: null, vuelo: null, dron: null, operador: null, seg: 0 }, extra || {}); }

test('1. Haversine (0,0)→(0,1) = 111,195 km ± 0,01', () => {
  assert.ok(Math.abs(M.haversine(0, 0, 0, 1) - 111.195) <= 0.01);
});

test('1. Distancia total = suma de tramos', () => {
  const pts = [{ lat: 3.4, lon: -76.5 }, { lat: 3.401, lon: -76.5 }, { lat: 3.401, lon: -76.499 }];
  const suma = M.haversine(3.4, -76.5, 3.401, -76.5) + M.haversine(3.401, -76.5, 3.401, -76.499);
  assert.equal(M.pathKm(pts), suma);
});

test('2. Segmentación por brecha: 30 min con umbral 10 → 3 vuelos; umbral 60 → 1', () => {
  const pts = [pt(0, 3.4, -76.5), pt(30, 3.4001, -76.5), pt(60, 3.4002, -76.5)];
  assert.equal(M.processTelemetry(pts, { gapMin: 10 }).flights.length, 3);
  const r = M.processTelemetry(pts, { gapMin: 60 });
  assert.equal(r.flights.length, 1);
  const f = r.flights[0];
  assert.equal(f.durS, (f.fin - f.inicio) / 1000);
  assert.equal(f.durS, 3600);
});

test('2. Segmentación por id de vuelo', () => {
  const pts = [pt(0, 3.4, -76.5, { vuelo: 'A' }), pt(1, 3.4001, -76.5, { vuelo: 'B' }), pt(2, 3.4002, -76.5, { vuelo: 'A' })];
  const r = M.processTelemetry(pts, { useFlightId: true });
  assert.equal(r.flights.length, 2);
  assert.equal(r.flights[0].id, 'A');
  assert.equal(r.flights[0].puntos, 2);
});

test('8. Salto > 100 m/s descartado y reportado', () => {
  const t = T0;
  const pts = [
    { t: t, lat: 3.4, lon: -76.5 }, { t: t + 1000, lat: 3.4001, lon: -76.5 },
    { t: t + 2000, lat: 3.5, lon: -76.5 }, // ~11 km en 1 s
    { t: t + 3000, lat: 3.4002, lon: -76.5 }
  ].map(p => Object.assign({ off: null, alt: null, vel: null, area: null, vol: null, vuelo: null, seg: 0 }, p));
  const r = M.processTelemetry(pts, {});
  assert.equal(r.flights[0].puntos, 3);
  assert.equal(r.descartes['Salto de posición imposible (> 100 m/s)'], 1);
});

test('Duplicados exactos eliminados', () => {
  const pts = [pt(0, 3.4, -76.5), pt(0, 3.4, -76.5), pt(1, 3.4001, -76.5)];
  const r = M.processTelemetry(pts, {});
  assert.equal(r.descartes['Duplicado exacto'], 1);
  assert.equal(r.flights[0].puntos, 2);
});

test('Área/volumen: acumulado (máximo) vs por fila (suma); sin elección no se calcula', () => {
  const pts = [pt(0, 3.4, -76.5, { area: 1, vol: 10 }), pt(1, 3.4001, -76.5, { area: 2, vol: 20 }), pt(2, 3.4002, -76.5, { area: 3, vol: 30 })];
  assert.equal(M.processTelemetry(pts, { accum: { area: 'acumulado', vol: 'acumulado' } }).flights[0].area, 3);
  assert.equal(M.processTelemetry(pts, { accum: { area: 'fila', vol: 'fila' } }).flights[0].vol, 60);
  const sin = M.processTelemetry(pts, {});
  assert.equal(sin.flights[0].area, null);
  assert.equal(sin.totals.areaHa.value, null);
});

test('9. Derivados: 20 ha y 300 L → 15 L/ha; sin área → motivo; área 0 sin división por cero; ha/h solo con horas > 0', () => {
  assert.equal(M.derived(20, 300, 3600).lha.value, 15);
  assert.equal(M.derived(20, 300, 7200).hah.value, 10);
  const sinArea = M.derived(null, 300, 3600);
  assert.equal(sinArea.lha.value, null);
  assert.ok(sinArea.lha.motivo);
  const cero = M.derived(0, 300, 3600);
  assert.equal(cero.lha.value, null);
  assert.equal(cero.lha.motivo, 'Área total igual a 0');
  assert.equal(M.derived(20, 300, 0).hah.value, null);
  assert.equal(M.derived(20, 300, null).hah.value, null);
});

test('Resumen (B): duración desde fin − inicio o columna; totales y L/ha', () => {
  const recs = [
    { inicio: T0, fin: T0 + 600000, off: null, durCol: null, area: 10, vol: 150 },
    { inicio: null, fin: null, off: null, durCol: 1200, area: 10, vol: 150 }
  ];
  const r = M.processSummary(recs);
  assert.equal(r.flights[0].durS, 600);
  assert.equal(r.flights[1].durS, 1200);
  assert.equal(r.totals.durS.value, 1800);
  assert.equal(r.totals.lha.value, 15);
  assert.equal(r.totals.distKm.value, null);
});

test('Avisos: vuelo corto, velocidad > 30 m/s, fecha futura', () => {
  const pts = [pt(0, 3.4, -76.5, { vel: 35 }), pt(0.5, 3.4001, -76.5, { vel: 5 })];
  const r = M.processTelemetry(pts, { now: Date.UTC(2020, 0, 1) });
  const txt = r.avisos.join(' | ');
  assert.match(txt, /menos de 1 minuto/);
  assert.match(txt, /30 m\/s/);
  assert.match(txt, /futuro/);
});

test('Distancia 0 con más de un punto genera aviso; ninguna métrica es NaN', () => {
  const pts = [pt(0, 3.4, -76.5), pt(1, 3.4, -76.5, { alt: 1 })];
  const r = M.processTelemetry(pts, {});
  assert.ok(r.avisos.some(a => /distancia total es 0/.test(a)));
  const f = r.flights[0];
  for (const k of ['durS', 'distKm', 'velMedia', 'velMax']) { assert.ok(f[k] === null || Number.isFinite(f[k]), k); }
});

test('Sin hora: un solo vuelo por segmento, sin duración', () => {
  const pts = [{ t: null, lat: 3.4, lon: -76.5, seg: 0 }, { t: null, lat: 3.41, lon: -76.5, seg: 0 }, { t: null, lat: 3.42, lon: -76.5, seg: 1 }];
  const r = M.processTelemetry(pts, {});
  assert.equal(r.flights.length, 2);
  assert.equal(r.flights[0].durS, null);
  assert.equal(r.totals.durS.value, null);
});

test('9. L/ha y ha/h totales usan solo vuelos con ambos datos', () => {
  const r = M.processSummary([
    { inicio: T0, fin: T0 + 3600000, area: 10, vol: 100 },
    { inicio: T0, fin: T0 + 3600000, area: null, vol: 500 },
    { inicio: null, fin: null, durCol: null, area: 10, vol: null }
  ]);
  assert.equal(r.totals.lha.value, 10);
  assert.match(r.totals.lha.motivo, /1 de 3/);
  assert.equal(r.totals.hah.value, 10);
  const sinPar = M.processSummary([{ inicio: null, fin: null, area: 5, vol: null }, { inicio: null, fin: null, area: null, vol: 50 }]);
  assert.equal(sinPar.totals.lha.value, null);
});
