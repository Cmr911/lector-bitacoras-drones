/*
 * Lectura de CSV: codificación, delimitador, separador decimal y RFC 4180.
 * Sin dependencias. Navegador: window.DDO.csv · Node: module.exports.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) { module.exports = mod; }
  else { root.DDO = root.DDO || {}; root.DDO.csv = mod; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_BYTES = 20 * 1024 * 1024;
  var MAX_ROWS = 200000;
  var MAX_COLS = 1000;
  var MAX_HEADER = 200;
  var MSG_FORMATO = 'Este formato no se puede leer aquí. Carga una exportación en CSV, GPX o KML (o XLSX).';

  function err(code, message, extra) {
    var e = { ok: false, code: code, message: message };
    if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) { e[k] = extra[k]; } } }
    return e;
  }

  function fmtMax(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  /* Heurística de binario: bytes nulos o demasiados caracteres de control en la muestra. */
  function looksBinary(bytes) {
    var n = Math.min(bytes.length, 8192), ctrl = 0;
    for (var i = 0; i < n; i++) {
      var b = bytes[i];
      if (b === 0) { return true; }
      if (b < 9 || (b > 13 && b < 32)) { ctrl++; }
    }
    return n > 0 && ctrl / n > 0.05;
  }

  /* Decodifica bytes: UTF-8 estricto; si falla, windows-1252. Quita BOM. */
  function decode(bytes) {
    if (!bytes || typeof bytes.length !== 'number') { return err('ENTRADA', 'No se recibió contenido para leer.'); }
    if (bytes.length > MAX_BYTES) { return err('ARCHIVO_GRANDE', 'El archivo supera el límite de 20 MB.'); }
    if (bytes.length === 0) { return err('VACIO', 'El archivo está vacío.'); }
    if (looksBinary(bytes)) { return err('BINARIO', MSG_FORMATO); }
    var text, encoding = 'utf-8';
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      try { text = new TextDecoder('windows-1252').decode(bytes); encoding = 'windows-1252'; }
      catch (e2) { return err('CODIFICACION', 'No se pudo interpretar la codificación del archivo.'); }
    }
    if (text.charCodeAt(0) === 0xFEFF) { text = text.slice(1); }
    if (text.indexOf('\u0000') !== -1) { return err('BINARIO', MSG_FORMATO); }
    return { ok: true, text: text, encoding: encoding };
  }

  /* Analizador por pasos (RFC 4180): permite ceder el hilo entre lotes. */
  function createParser(text, delimiter) {
    var dc = delimiter.charCodeAt(0);
    var n = text.length, i = 0, rows = [], row = [], field = '', inQ = false, atStart = true;
    var p = { rows: rows, done: false, tooMany: false };
    function endField() { row.push(field); field = ''; atStart = true; }
    function endRow() {
      endField();
      if (!(row.length === 1 && row[0] === '')) { rows.push(row); }
      row = [];
      if (rows.length > MAX_ROWS + 1) { p.tooMany = true; }
    }
    p.step = function (budget) {
      if (p.done) { return true; }
      var stop = Math.min(n, i + (budget || n));
      while (i < stop && !p.tooMany) {
        if (inQ) {
          var q = text.indexOf('"', i);
          if (q === -1) { field += text.slice(i); i = n; break; }
          field += text.slice(i, q);
          if (text.charCodeAt(q + 1) === 34) { field += '"'; i = q + 2; }
          else { inQ = false; i = q + 1; }
          continue;
        }
        var c = text.charCodeAt(i);
        if (c === 34 && atStart) { inQ = true; atStart = false; i++; continue; }
        if (c === dc) { endField(); i++; continue; }
        if (c === 10 || c === 13) {
          endRow();
          if (c === 13 && text.charCodeAt(i + 1) === 10) { i++; }
          i++;
          continue;
        }
        var j = i + 1;
        while (j < n) {
          var cj = text.charCodeAt(j);
          if (cj === dc || cj === 10 || cj === 13) { break; }
          j++;
        }
        field += text.slice(i, j);
        atStart = false;
        i = j;
      }
      if (p.tooMany) { p.done = true; return true; }
      if (i >= n) {
        if (field !== '' || row.length) { endRow(); }
        p.done = true;
      }
      return p.done;
    };
    p.progress = function () { return n ? Math.min(1, i / n) : 1; };
    return p;
  }

  /* Detecta el delimitador por consistencia del número de campos en una muestra. */
  function detectDelimiter(text) {
    var sample = text.slice(0, 65536);
    var cands = [',', ';', '\t'], best = ',', bestScore = 0;
    for (var k = 0; k < cands.length; k++) {
      var p = createParser(sample, cands[k]);
      p.step();
      var rows = p.rows.slice(0, 30);
      if (rows.length > 1 && sample.length === 65536) { rows.pop(); }
      var counts = {}, mode = 0, modeN = 0;
      for (var r = 0; r < rows.length; r++) {
        var len = rows[r].length;
        counts[len] = (counts[len] || 0) + 1;
        if (counts[len] > modeN || (counts[len] === modeN && len > mode)) { mode = len; modeN = counts[len]; }
      }
      var score = mode > 1 ? modeN * 1000 + mode : 0;
      if (score > bestScore) { bestScore = score; best = cands[k]; }
    }
    return best;
  }

  var RE_COMA = /^[+-]?(\d{1,3}(\.\d{3})+|\d+),\d+$/;
  var RE_PUNTO = /^[+-]?\d+\.\d+$/;

  /* Detecta el separador decimal sobre una muestra de celdas. */
  function detectDecimal(rows, delimiter) {
    if (delimiter === ',') { return '.'; }
    var comma = 0, dot = 0, lim = Math.min(rows.length, 500);
    for (var r = 0; r < lim; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        var v = String(rows[r][c]).trim();
        if (RE_COMA.test(v)) { comma++; } else if (RE_PUNTO.test(v)) { dot++; }
      }
    }
    return comma > dot ? ',' : '.';
  }

  /* Convierte texto a número según el separador decimal. Devuelve null si no es número. */
  function parseNumber(s, decimal) {
    if (typeof s === 'number') { return isFinite(s) ? s : null; }
    if (s === null || s === undefined) { return null; }
    s = String(s).trim().replace(/[\s  ]/g, '');
    if (!s) { return null; }
    if (decimal === ',') {
      if (s.indexOf(',') !== -1) { s = s.replace(/\./g, '').replace(',', '.'); }
    } else if (s.indexOf(',') !== -1) {
      if (s.indexOf('.') !== -1) { s = s.replace(/,/g, ''); } else { return null; }
    }
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) { return null; }
    var v = Number(s);
    return isFinite(v) ? v : null;
  }

  function cleanHeaders(raw) {
    var seen = [], out = [];
    for (var i = 0; i < raw.length; i++) {
      var h = String(raw[i] === undefined ? '' : raw[i]).replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, MAX_HEADER);
      if (!h) { h = 'Columna ' + (i + 1); }
      var base = h, k = 2;
      while (seen.indexOf(h) !== -1) { h = base + ' (' + k + ')'; k++; }
      seen.push(h); out.push(h);
    }
    return out;
  }

  /* Construye la tabla a partir de filas crudas: encabezado, filas válidas y omitidas. */
  function buildTable(rawRows, meta) {
    if (!rawRows.length) { return err('VACIO', 'El archivo no tiene filas.'); }
    if (rawRows.length > MAX_ROWS + 1) { return err('MUCHAS_FILAS', 'El archivo supera el límite de ' + fmtMax(MAX_ROWS) + ' filas.'); }
    var headers = cleanHeaders(rawRows[0]);
    var nc = headers.length;
    if (nc > MAX_COLS) { return err('MUCHAS_COLUMNAS', 'El archivo tiene demasiadas columnas (máximo ' + MAX_COLS + ').'); }
    var rows = [], skipped = 0;
    for (var r = 1; r < rawRows.length; r++) {
      var row = rawRows[r];
      if (row.length > nc) {
        var extraEmpty = true;
        for (var c = nc; c < row.length; c++) { if (String(row[c]).trim() !== '') { extraEmpty = false; break; } }
        if (extraEmpty) { row = row.slice(0, nc); }
      }
      if (row.length !== nc) { skipped++; continue; }
      rows.push(row);
    }
    var out = { ok: true, headers: headers, rows: rows, skipped: { columnas: skipped } };
    if (meta) { for (var k in meta) { if (Object.prototype.hasOwnProperty.call(meta, k)) { out[k] = meta[k]; } } }
    if (!out.decimal) { out.decimal = detectDecimal(rows, out.delimiter); }
    return out;
  }

  /* Lectura síncrona completa (pruebas y archivos pequeños). */
  function parseText(text, opts) {
    opts = opts || {};
    var delimiter = opts.delimiter || detectDelimiter(text);
    var p = createParser(text, delimiter);
    p.step();
    if (p.tooMany) { return err('MUCHAS_FILAS', 'El archivo supera el límite de ' + fmtMax(MAX_ROWS) + ' filas.'); }
    return buildTable(p.rows, { delimiter: delimiter, decimal: opts.decimal, encoding: opts.encoding });
  }

  function parseBytes(bytes, opts) {
    var d = decode(bytes);
    if (!d.ok) { return d; }
    opts = opts || {};
    return parseText(d.text, { delimiter: opts.delimiter, decimal: opts.decimal, encoding: d.encoding });
  }

  return {
    MAX_BYTES: MAX_BYTES, MAX_ROWS: MAX_ROWS, MSG_FORMATO: MSG_FORMATO,
    err: err, looksBinary: looksBinary, decode: decode, createParser: createParser,
    detectDelimiter: detectDelimiter, detectDecimal: detectDecimal, parseNumber: parseNumber,
    cleanHeaders: cleanHeaders, buildTable: buildTable, parseText: parseText, parseBytes: parseBytes
  };
});
