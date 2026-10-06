// Fixtures XLSX SINTÉTICOS generados en la prueba con zlib.deflateRawSync (solo en pruebas).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const X = require('../js/parse-xlsx.js');
const N = require('../js/normalize.js');

/* ZIP mínimo: [{ name, data(Buffer|string), method(0|8), declaredSize?, flags? }] */
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const method = f.method === undefined ? 8 : f.method;
    const comp = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const size = f.declaredSize === undefined ? raw.length : f.declaredSize;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(f.flags || 0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(0, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(size, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(f.flags || 0, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(0, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(size, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const WB = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${NS}><sheets><sheet name="Vuelos" sheetId="1" r:id="rId1"/><sheet name="Otra &amp; más" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const RELS = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet2.xml"/></Relationships>';
const SST = `<sst ${NS} count="5"><si><t>Inicio</t></si><si><t>Área (mu)</t></si><si><r><t>Volu</t></r><r><t>men (L)</t></r></si><si><t>Piloto</t></si><si><t xml:space="preserve">Peña &lt;1&gt;</t><rPh><t>x</t></rPh></si></sst>`;
const SHEET1 = `<worksheet ${NS}><sheetData>` +
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
  '<row r="2"><c r="A2" s="1"><v>45000.5</v></c><c r="B2"><v>30</v></c><c r="C2"><v>150.25</v></c><c r="D2" t="s"><v>4</v></c></row>' +
  '<row r="3"><c r="A3"><v>45000.75</v></c><c r="C3"><v>100</v></c><c r="D3" t="inlineStr"><is><t>Otro</t></is></c></row>' +
  '<row r="5"/>' +
  '</sheetData></worksheet>';
const SHEET2 = `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>lat</t></is></c><c r="B1" t="inlineStr"><is><t>lon</t></is></c></row><row r="2"><c r="A2"><v>3.4</v></c><c r="B2"><v>-76.5</v></c></row></sheetData></worksheet>`;

function libro(extra) {
  return makeZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'xl/workbook.xml', data: WB },
    { name: 'xl/_rels/workbook.xml.rels', data: RELS },
    { name: 'xl/sharedStrings.xml', data: SST },
    { name: 'xl/worksheets/sheet1.xml', data: SHEET1 },
    { name: 'xl/worksheets/sheet2.xml', data: SHEET2, method: 0 }
  ].concat(extra || []));
}

test('XLSX: hojas, cadenas compartidas, inline, celdas vacías y números', async () => {
  const z = await X.open(libro());
  assert.equal(z.ok, true);
  assert.deepEqual(z.sheets.map(s => s.name), ['Vuelos', 'Otra & más']);
  const t = await X.readSheet(z, 0);
  assert.equal(t.ok, true);
  assert.deepEqual(t.headers, ['Inicio', 'Área (mu)', 'Volumen (L)', 'Piloto']);
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[0], ['45000.5', '30', '150.25', 'Peña <1>']);
  assert.deepEqual(t.rows[1], ['45000.75', '', '100', 'Otro']);
});

test('XLSX: selector de hoja (entrada almacenada sin compresión)', async () => {
  const z = await X.open(libro());
  const t = await X.readSheet(z, 1);
  assert.deepEqual(t.headers, ['lat', 'lon']);
  assert.deepEqual(t.rows[0], ['3.4', '-76.5']);
});

test('XLSX: fechas como serie de Excel al mapear fecha-hora', async () => {
  const z = await X.open(libro());
  const t = await X.readSheet(z, 0);
  const r = N.buildRecords(t, { tipo: 'B', mapping: { fechaHora: 0, area: 1, vol: 2, operador: 3 }, units: { area: 'mu', vol: 'L' } });
  assert.equal(r.ok, true);
  assert.equal(new Date(r.records[0].inicio).toISOString(), '2023-03-15T12:00:00.000Z');
  assert.equal(r.records[0].area, 2);
});

test('XLSX: rutas con ".." rechazadas', async () => {
  const r = await X.open(libro([{ name: 'xl/../../evil.xml', data: 'x' }]));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ZIP_RUTA');
});

test('XLSX: más de 200 entradas rechazado', async () => {
  const extra = Array.from({ length: 200 }, (_, i) => ({ name: `xl/media/f${i}.txt`, data: 'x', method: 0 }));
  const r = await X.open(libro(extra));
  assert.equal(r.code, 'ZIP_ENTRADAS');
});

test('XLSX: tamaño declarado > 100 MB rechazado', async () => {
  const r = await X.open(libro([{ name: 'xl/media/big.bin', data: 'x', method: 0, declaredSize: 101 * 1024 * 1024 }]));
  assert.equal(r.code, 'ZIP_GRANDE');
});

test('XLSX: zip-bomb que miente sobre su tamaño se corta al descomprimir', async () => {
  const bomb = Buffer.alloc(101 * 1024 * 1024, 0x20);
  const files = [
    { name: 'xl/workbook.xml', data: WB }, { name: 'xl/_rels/workbook.xml.rels', data: RELS },
    { name: 'xl/sharedStrings.xml', data: bomb, declaredSize: 10 },
    { name: 'xl/worksheets/sheet1.xml', data: SHEET1 }, { name: 'xl/worksheets/sheet2.xml', data: SHEET2 }
  ];
  const z = await X.open(makeZip(files));
  assert.equal(z.ok, true);
  const t = await X.readSheet(z, 0);
  assert.equal(t.ok, false);
  assert.equal(t.code, 'ZIP_GRANDE');
});

test('XLSX: cifrado y archivos que no son ZIP rechazados sin excepciones', async () => {
  const enc = await X.open(libro([{ name: 'xl/x.bin', data: 'x', flags: 1, method: 0 }]));
  assert.equal(enc.code, 'ZIP_CIFRADO');
  assert.equal((await X.open(new Uint8Array([1, 2, 3]))).ok, false);
  assert.equal((await X.open(null)).ok, false);
  assert.equal((await X.open(new Uint8Array(20 * 1024 * 1024 + 1))).code, 'ARCHIVO_GRANDE');
});

test('XLSX: columnas por referencia', () => {
  assert.equal(X.colIndex('A1'), 0);
  assert.equal(X.colIndex('Z9'), 25);
  assert.equal(X.colIndex('AA10'), 26);
});
