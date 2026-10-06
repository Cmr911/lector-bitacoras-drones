/*
 * Lector XLSX mínimo sin dependencias: ZIP + DecompressionStream('deflate-raw') + XML de hojas.
 * Límites anti zip-bomb: ≤ 20 MB comprimido, ≤ 100 MB descomprimido, ≤ 200 entradas, sin rutas con "..".
 * Navegador: window.DDO.xlsx · Node: module.exports. Funciones asíncronas (devuelven Promise).
 */
(function (root, factory) {
  var csv = (typeof module === 'object' && module.exports) ? require('./parse-csv.js') : root.DDO.csv;
  var mod = factory(csv);
  if (typeof module === 'object' && module.exports) { module.exports = mod; }
  else { root.DDO = root.DDO || {}; root.DDO.xlsx = mod; }
})(typeof self !== 'undefined' ? self : this, function (csv) {
  'use strict';

  var MAX_ZIP = 20 * 1024 * 1024;
  var MAX_TOTAL = 100 * 1024 * 1024;
  var MAX_ENTRIES = 200;
  var MSG_CSV = 'Guarda el archivo como CSV desde Excel y cárgalo de nuevo.';

  function err(code, message) { return { ok: false, code: code, message: message }; }
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function rutaInsegura(name) {
    return !name || name.charAt(0) === '/' || name.indexOf('\\') !== -1 || /^[a-z]:/i.test(name) || name.split('/').indexOf('..') !== -1;
  }

  /* Lee el directorio central del ZIP (sin descomprimir). */
  function readDirectory(bytes) {
    if (!bytes || typeof bytes.length !== 'number') { return err('ENTRADA', 'No se recibió contenido.'); }
    if (bytes.length > MAX_ZIP) { return err('ARCHIVO_GRANDE', 'El archivo supera el límite de 20 MB.'); }
    if (bytes.length < 22 || u32(bytes, 0) !== 0x04034b50) { return err('NO_ZIP', 'El archivo no es un XLSX válido.'); }
    var eocd = -1, min = Math.max(0, bytes.length - 22 - 65535);
    for (var i = bytes.length - 22; i >= min; i--) { if (u32(bytes, i) === 0x06054b50) { eocd = i; break; } }
    if (eocd === -1) { return err('NO_ZIP', 'El archivo XLSX está dañado (sin directorio).'); }
    var total = u16(bytes, eocd + 10), cdSize = u32(bytes, eocd + 12), cdOff = u32(bytes, eocd + 16);
    if (total === 0xFFFF || cdOff === 0xFFFFFFFF) { return err('ZIP64', 'Formato ZIP no admitido. ' + MSG_CSV); }
    if (total > MAX_ENTRIES) { return err('ZIP_ENTRADAS', 'El XLSX tiene demasiadas partes internas (máximo ' + MAX_ENTRIES + ').'); }
    if (cdOff + cdSize > bytes.length) { return err('NO_ZIP', 'El archivo XLSX está dañado.'); }
    var dec = new TextDecoder('utf-8'), entries = new Map(), p = cdOff, declarado = 0;
    for (var k = 0; k < total; k++) {
      if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) { return err('NO_ZIP', 'El archivo XLSX está dañado.'); }
      var flags = u16(bytes, p + 8), method = u16(bytes, p + 10), comp = u32(bytes, p + 20), size = u32(bytes, p + 24);
      var nl = u16(bytes, p + 28), xl = u16(bytes, p + 30), cl = u16(bytes, p + 32), loc = u32(bytes, p + 42);
      var name = dec.decode(bytes.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (rutaInsegura(name)) { return err('ZIP_RUTA', 'El XLSX contiene rutas internas no permitidas.'); }
      if (flags & 1) { return err('ZIP_CIFRADO', 'El XLSX está protegido con contraseña. ' + MSG_CSV); }
      if (method !== 0 && method !== 8) { return err('ZIP_METODO', 'Compresión no admitida. ' + MSG_CSV); }
      declarado += size;
      if (declarado > MAX_TOTAL) { return err('ZIP_GRANDE', 'El XLSX descomprimido superaría 100 MB.'); }
      if (name.charAt(name.length - 1) !== '/') { entries.set(name, { name: name, method: method, comp: comp, size: size, loc: loc }); }
    }
    return { ok: true, entries: entries };
  }

  function entryData(bytes, e) {
    if (e.loc + 30 > bytes.length || u32(bytes, e.loc) !== 0x04034b50) { return null; }
    var start = e.loc + 30 + u16(bytes, e.loc + 26) + u16(bytes, e.loc + 28);
    if (start + e.comp > bytes.length) { return null; }
    return bytes.subarray(start, start + e.comp);
  }

  /* Descomprime una entrada cortando si supera el presupuesto restante. */
  function inflate(zip, name) {
    var e = zip.entries.get(name);
    if (!e) { return Promise.resolve(null); }
    var data = entryData(zip.bytes, e);
    if (!data) { return Promise.resolve(err('NO_ZIP', 'El archivo XLSX está dañado.')); }
    var budget = MAX_TOTAL - zip.used;
    if (e.method === 0) {
      if (data.length > budget) { return Promise.resolve(err('ZIP_GRANDE', 'El XLSX descomprimido superaría 100 MB.')); }
      zip.used += data.length;
      return Promise.resolve({ ok: true, text: new TextDecoder('utf-8').decode(data) });
    }
    if (typeof DecompressionStream === 'undefined' || typeof Blob === 'undefined') {
      return Promise.resolve(err('SIN_DESCOMPRESOR', 'Este navegador no puede descomprimir XLSX. ' + MSG_CSV));
    }
    var stream;
    try { stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
    catch (x) { return Promise.resolve(err('SIN_DESCOMPRESOR', 'Este navegador no puede descomprimir XLSX. ' + MSG_CSV)); }
    var reader = stream.getReader(), chunks = [], total = 0;
    function leer() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(total), o = 0;
          chunks.forEach(function (c) { out.set(c, o); o += c.length; });
          zip.used += total;
          return { ok: true, text: new TextDecoder('utf-8').decode(out) };
        }
        total += r.value.length;
        if (total > budget) {
          return reader.cancel().catch(function () {}).then(function () { return err('ZIP_GRANDE', 'El XLSX descomprimido superaría 100 MB.'); });
        }
        chunks.push(r.value);
        return leer();
      });
    }
    return leer().catch(function () { return err('ZIP_DANADO', 'No se pudo descomprimir el XLSX. ' + MSG_CSV); });
  }

  /* ---------- XML con expresiones regulares (sin DTD ni entidades externas) ---------- */
  var P = '(?:[A-Za-z_][\\w.-]*:)?';
  function decodeXml(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, function (m, e) {
      if (e.charAt(0) === '#') {
        var n = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : '';
      }
      return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
    }).replace(/_x([0-9A-Fa-f]{4})_/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
  }
  function attr(attrs, name) {
    var m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')').exec(attrs);
    return m ? decodeXml(m[1] !== undefined ? m[1] : m[2]) : null;
  }
  function textRuns(xml) {
    xml = xml.replace(new RegExp('<' + P + 'rPh\\b[\\s\\S]*?</' + P + 'rPh>', 'g'), '');
    var re = new RegExp('<' + P + 't\\b[^>]*>([\\s\\S]*?)</' + P + 't>', 'g'), m, out = '';
    while ((m = re.exec(xml))) { out += decodeXml(m[1]); }
    return out;
  }

  function sharedStrings(xml) {
    var out = [], re = new RegExp('<' + P + 'si\\b[^>]*?(?:/>|>([\\s\\S]*?)</' + P + 'si>)', 'g'), m;
    while ((m = re.exec(xml))) { out.push(m[1] ? textRuns(m[1]) : ''); }
    return out;
  }

  function colIndex(ref) {
    var m = /^([A-Z]{1,3})/.exec(ref || '');
    if (!m) { return -1; }
    var n = 0;
    for (var i = 0; i < m[1].length; i++) { n = n * 26 + (m[1].charCodeAt(i) - 64); }
    return n - 1;
  }

  /* Hojas del libro en orden, con su ruta interna. */
  function sheetList(zip, wbXml, relsXml) {
    var rels = {};
    if (relsXml) {
      var rr = new RegExp('<' + P + 'Relationship\\b([^>]*)/?>', 'g'), m;
      while ((m = rr.exec(relsXml))) {
        var id = attr(m[1], 'Id'), tg = attr(m[1], 'Target');
        if (id && tg) { rels[id] = tg.charAt(0) === '/' ? tg.slice(1) : 'xl/' + tg.replace(/^\.\//, ''); }
      }
    }
    var out = [];
    if (wbXml) {
      var rs = new RegExp('<' + P + 'sheet\\b([^>]*)/?>', 'g'), s;
      while ((s = rs.exec(wbXml))) {
        var rid = attr(s[1], '[A-Za-z_][\\w.-]*:id');
        var path = rid && rels[rid];
        if (path && zip.entries.has(path)) { out.push({ name: attr(s[1], 'name') || ('Hoja ' + (out.length + 1)), path: path }); }
      }
    }
    if (!out.length) {
      Array.from(zip.entries.keys()).filter(function (n) { return /^xl\/worksheets\/[^/]+\.xml$/.test(n); }).sort()
        .forEach(function (n, i) { out.push({ name: 'Hoja ' + (i + 1), path: n }); });
    }
    return out;
  }

  /* Abre el XLSX: valida el ZIP y lista las hojas. */
  function open(bytes) {
    var d;
    try { d = readDirectory(bytes); } catch (x) { d = err('NO_ZIP', 'El archivo XLSX está dañado.'); }
    if (!d.ok) { return Promise.resolve(d); }
    var zip = { ok: true, bytes: bytes, entries: d.entries, used: 0, shared: null, sheets: [] };
    return Promise.all([inflate(zip, 'xl/workbook.xml'), inflate(zip, 'xl/_rels/workbook.xml.rels')]).then(function (r) {
      for (var i = 0; i < r.length; i++) { if (r[i] && !r[i].ok) { return r[i]; } }
      zip.sheets = sheetList(zip, r[0] && r[0].text, r[1] && r[1].text);
      if (!zip.sheets.length) { return err('XLSX_SIN_HOJAS', 'El XLSX no tiene hojas legibles. ' + MSG_CSV); }
      return zip;
    }).catch(function () { return err('NO_ZIP', 'El archivo XLSX está dañado. ' + MSG_CSV); });
  }

  /* Lee una hoja como tabla { headers, rows } compatible con el lector CSV. */
  function readSheet(zip, idx) {
    var sh = zip.sheets[idx || 0];
    if (!sh) { return Promise.resolve(err('XLSX_HOJA', 'La hoja no existe.')); }
    var pShared = zip.shared ? Promise.resolve({ ok: true }) : inflate(zip, 'xl/sharedStrings.xml').then(function (r) {
      if (r && !r.ok) { return r; }
      zip.shared = r ? sharedStrings(r.text) : [];
      return { ok: true };
    });
    return pShared.then(function (s) {
      if (!s.ok) { return s; }
      return inflate(zip, sh.path).then(function (r) {
        if (!r) { return err('XLSX_HOJA', 'La hoja no existe.'); }
        if (!r.ok) { return r; }
        return parseSheetXml(r.text, zip.shared);
      });
    }).catch(function () { return err('XLSX_DANADO', 'No se pudo leer la hoja. ' + MSG_CSV); });
  }

  function parseSheetXml(xml, shared) {
    var raw = [], reRow = new RegExp('<' + P + 'row\\b[^>]*?(?:/>|>([\\s\\S]*?)</' + P + 'row>)', 'g'), m;
    var reCell = new RegExp('<' + P + 'c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</' + P + 'c>)', 'g');
    var reV = new RegExp('<' + P + 'v\\b[^>]*>([\\s\\S]*?)</' + P + 'v>');
    while ((m = reRow.exec(xml))) {
      if (!m[1]) { continue; }
      var row = [], c, next = 0, any = false;
      reCell.lastIndex = 0;
      while ((c = reCell.exec(m[1]))) {
        var at = c[1], body = c[2] || '';
        var col = colIndex(attr(at, 'r'));
        if (col < 0) { col = next; }
        next = col + 1;
        if (col >= 1000) { continue; }
        var t = attr(at, 't') || 'n', v = reV.exec(body), val = '';
        if (t === 's') { var k = v ? parseInt(v[1], 10) : -1; val = k >= 0 && k < shared.length ? shared[k] : ''; }
        else if (t === 'inlineStr') { val = textRuns(body); }
        else if (t === 'b') { val = v ? (v[1].trim() === '1' ? 'TRUE' : 'FALSE') : ''; }
        else if (t === 'e') { val = ''; }
        else { val = v ? decodeXml(v[1]).trim() : ''; }
        while (row.length < col) { row.push(''); }
        row[col] = val;
        if (val !== '') { any = true; }
      }
      if (!any) { continue; }
      raw.push(row);
      if (raw.length > csv.MAX_ROWS + 1) { return err('MUCHAS_FILAS', 'La hoja supera el límite de 200.000 filas.'); }
    }
    if (!raw.length) { return err('VACIO', 'La hoja está vacía.'); }
    var nc = raw[0].length;
    for (var i = 1; i < raw.length; i++) { while (raw[i].length < nc) { raw[i].push(''); } }
    return csv.buildTable(raw, { delimiter: null, decimal: '.', encoding: null });
  }

  return { open: open, readSheet: readSheet, readDirectory: readDirectory, parseSheetXml: parseSheetXml, sharedStrings: sharedStrings, colIndex: colIndex, MAX_TOTAL: MAX_TOTAL, MAX_ENTRIES: MAX_ENTRIES };
});
