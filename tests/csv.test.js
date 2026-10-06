// Datos SINTÉTICOS generados en la prueba.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/parse-csv.js');

const enc = s => new TextEncoder().encode(s);

test('7. Delimitador ";" con decimal coma', () => {
  const t = C.parseBytes(enc('lat;lon;area\n3,5;-76,25;1,5\n3,6;-76,3;2\n'));
  assert.equal(t.ok, true);
  assert.equal(t.delimiter, ';');
  assert.equal(t.decimal, ',');
  assert.equal(C.parseNumber(t.rows[0][0], t.decimal), 3.5);
  assert.equal(C.parseNumber('1.234,5', ','), 1234.5);
  assert.equal(C.parseNumber('abc', ','), null);
});

test('7. Delimitador "," y tabulador', () => {
  assert.equal(C.parseBytes(enc('a,b,c\n1.5,2,3\n')).delimiter, ',');
  assert.equal(C.parseBytes(enc('a\tb\tc\n1\t2\t3\n')).delimiter, '\t');
});

test('7. Comillas RFC 4180 con saltos de línea y comillas dobles', () => {
  const t = C.parseBytes(enc('id,nota\n1,"linea 1\nlinea 2, con coma"\n2,"dice ""hola"""\r\n'));
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0][1], 'linea 1\nlinea 2, con coma');
  assert.equal(t.rows[1][1], 'dice "hola"');
});

test('7. BOM UTF-8 se elimina', () => {
  const bytes = new Uint8Array([0xEF, 0xBB, 0xBF, ...enc('fecha,lat\n1,2\n')]);
  const t = C.parseBytes(bytes);
  assert.equal(t.headers[0], 'fecha');
  assert.equal(t.encoding, 'utf-8');
});

test('7. windows-1252 con tildes', () => {
  const bytes = Buffer.from('operación;piloto\nAplicación;Peña\n', 'latin1');
  const t = C.parseBytes(new Uint8Array(bytes));
  assert.equal(t.encoding, 'windows-1252');
  assert.equal(t.headers[0], 'operación');
  assert.equal(t.rows[0][1], 'Peña');
});

test('7. Fila con columnas de más se omite y se cuenta', () => {
  const t = C.parseBytes(enc('a,b\n1,2\n1,2,3\n4,5\n'));
  assert.equal(t.rows.length, 2);
  assert.equal(t.skipped.columnas, 1);
});

test('10. Archivo > 20 MB rechazado', () => {
  const big = new Uint8Array(C.MAX_BYTES + 1).fill(0x61);
  const r = C.decode(big);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ARCHIVO_GRANDE');
});

test('10. Más de 200.000 filas rechazado', () => {
  const text = 'a\n' + '1\n'.repeat(C.MAX_ROWS + 1);
  const r = C.parseText(text, {});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MUCHAS_FILAS');
  assert.equal(C.parseText('a\n' + '1\n'.repeat(C.MAX_ROWS), {}).ok, true);
});

test('10. Binario rechazado con mensaje claro', () => {
  const bin = new Uint8Array([0x00, 0x01, 0x02, 0xFF, 0x10, 0x00, 0x7F, 0x03]);
  const r = C.decode(bin);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BINARIO');
  assert.equal(r.message, 'Este formato no se puede leer aquí. Carga una exportación en CSV, GPX o KML (o XLSX).');
});

test('Encabezados vacíos y duplicados se nombran; nada lanza excepción', () => {
  const t = C.parseBytes(enc('lat,,lat\n1,2,3\n'));
  assert.deepEqual(t.headers, ['lat', 'Columna 2', 'lat (2)']);
  assert.equal(C.decode(null).ok, false);
  assert.equal(C.decode(new Uint8Array(0)).ok, false);
});

test('Parser por lotes produce el mismo resultado que el síncrono', () => {
  const text = 'a;b\n' + Array.from({ length: 500 }, (_, i) => `${i};"x\n${i}"`).join('\n');
  const p = C.createParser(text, ';');
  while (!p.step(97)) { /* lotes pequeños */ }
  const t = C.buildTable(p.rows, { delimiter: ';' });
  assert.equal(t.rows.length, 500);
  assert.equal(t.rows[499][1], 'x\n499');
});
