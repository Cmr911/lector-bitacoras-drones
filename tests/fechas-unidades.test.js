// Datos SINTÉTICOS generados en la prueba.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../js/normalize.js');

function ymdhms(t) { return new Date(t).toISOString().slice(0, 19); }

test('3. "25/04/2026" → dd/mm sin ambigüedad', () => {
  assert.equal(N.detectDateOrder(['25/04/2026']), 'dmy');
  const r = N.parseDateTime('25/04/2026', null);
  assert.equal(r.ok, true);
  assert.equal(ymdhms(r.t), '2026-04-25T00:00:00');
});

test('3. "03/04/2026" solo → ambigua (error estructurado pidiendo elección)', () => {
  assert.equal(N.detectDateOrder(['03/04/2026']), 'ambigua');
  const r = N.parseDateTime('03/04/2026', null);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'FECHA_AMBIGUA');
  assert.deepEqual(r.opciones, ['dmy', 'mdy']);
  assert.equal(ymdhms(N.parseDateTime('03/04/2026', 'dmy').t), '2026-04-03T00:00:00');
  assert.equal(ymdhms(N.parseDateTime('03/04/2026', 'mdy').t), '2026-03-04T00:00:00');
});

test('3. Reloj 12 h: "02:30 p. m." → 14:30; variantes a. m./AM', () => {
  const h = N.parseTime('02:30 p. m.');
  assert.equal(h.s, 14 * 3600 + 30 * 60);
  assert.equal(N.parseTime('12:15 a. m.').s, 15 * 60);
  assert.equal(N.parseTime('12:00 PM').s, 12 * 3600);
  assert.equal(ymdhms(N.parseDateTime('25/04/2026 02:30 p. m.', null).t), '2026-04-25T14:30:00');
  assert.equal(ymdhms(N.parseDateTime('2026-04-25 2:30:15 pm', null).t), '2026-04-25T14:30:15');
});

test('3. ISO con offset se respeta; sin zona → "tal como aparece" (off = null)', () => {
  const r = N.parseDateTime('2026-04-25T10:00:00-05:00', null);
  assert.equal(r.off, -300);
  assert.equal(new Date(r.t).toISOString(), '2026-04-25T15:00:00.000Z');
  const z = N.parseDateTime('2026-04-25T10:00:00Z', null);
  assert.equal(z.off, 0);
  const sin = N.parseDateTime('2026-04-25 10:00:00', null);
  assert.equal(sin.off, null);
  assert.equal(ymdhms(sin.t), '2026-04-25T10:00:00');
  const R = require('../js/report.js');
  assert.equal(R.dateTime(r.t, r.off), '25/04/2026 10:00:00 UTC−05:00');
  assert.equal(R.dateTime(sin.t, sin.off), '25/04/2026 10:00:00');
});

test('3. Fechas inexistentes rechazadas sin lanzar excepción', () => {
  assert.equal(N.parseDateTime('31/02/2026', 'dmy').ok, false);
  assert.equal(N.parseDateTime('hola', null).ok, false);
  assert.equal(N.parseDateTime('', null).ok, false);
  assert.equal(N.parseDateTime(undefined, null).ok, false);
});

test('4. Serie Excel: 45000 → 2023-03-15; 45000,5 → 12:00; fuera de rango rechazada', () => {
  assert.equal(new Date(N.excelSerialToMs(45000).t).toISOString().slice(0, 10), '2023-03-15');
  assert.equal(ymdhms(N.parseDateTime('45000,5', null, { decimal: ',' }).t), '2023-03-15T12:00:00');
  assert.equal(ymdhms(N.parseDateTime(45000.5, null).t), '2023-03-15T12:00:00');
  const fuera = N.parseDateTime('123', null);
  assert.equal(fuera.ok, false);
  assert.equal(fuera.code, 'SERIE_FUERA_RANGO');
  assert.equal(N.excelSerialToMs(90000).ok, false);
});

test('5. Unidades: 30 mu → 2 ha; 5 m/s → 18 km/h; 1000 mL → 1 L; 10 gal US → 37,854 L', () => {
  assert.ok(Math.abs(N.convert(30, 'area', 'mu') - 2) < 1e-12);
  assert.ok(Math.abs(5 / N.convert(1, 'velocidad', 'kmh') - 18) < 1e-9);
  assert.equal(N.convert(1000, 'volumen', 'mL'), 1);
  assert.ok(Math.abs(N.convert(10, 'volumen', 'galUS') - 37.854) < 0.001);
  assert.equal(N.convert(1, 'duracion', 'h'), 3600);
  assert.equal(N.convert(1, 'area', 'ninguna'), null);
});

test('Fecha y hora en columnas separadas se combinan', () => {
  const table = { headers: ['Fecha', 'Hora', 'lat', 'lon'], rows: [['25/04/2026', '02:30 p. m.', '3,4', '-76,5']], decimal: ',' };
  const r = N.buildRecords(table, { tipo: 'A', mapping: { fecha: 0, hora: 1, lat: 2, lon: 3 }, units: {} });
  assert.equal(r.ok, true);
  assert.equal(ymdhms(r.records[0].t), '2026-04-25T14:30:00');
});

test('Mapeo con fechas ambiguas exige elegir formato', () => {
  const table = { headers: ['fecha', 'lat', 'lon'], rows: [['03/04/2026 10:00', '3.4', '-76.5']], decimal: '.' };
  const r = N.prepare(table, { tipo: 'A', mapping: { fechaHora: 0, lat: 1, lon: 2 }, units: {} });
  assert.equal(r.ok, false);
  assert.equal(r.need.dateOrder, true);
  assert.equal(N.prepare(table, { tipo: 'A', mapping: { fechaHora: 0, lat: 1, lon: 2 }, units: {}, dateOrder: 'dmy' }).ok, true);
});

test('Unidad obligatoria para columnas con unidad', () => {
  const table = { headers: ['inicio', 'area'], rows: [['2026-04-25 10:00', '5']], decimal: '.' };
  const sin = N.prepare(table, { tipo: 'B', mapping: { fechaHora: 0, area: 1 }, units: {} });
  assert.equal(sin.ok, false);
  assert.match(sin.message, /unidad/);
  assert.equal(N.prepare(table, { tipo: 'B', mapping: { fechaHora: 0, area: 1 }, units: { area: 'ha' } }).ok, true);
});
