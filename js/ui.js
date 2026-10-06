/*
 * Interfaz: carga → confirmación de mapeo → reporte. Solo textContent/createElement con datos del archivo.
 * Nada se guarda entre sesiones ni se envía a ningún servidor.
 */
(function (root) {
  'use strict';
  var DDO = root.DDO || {};
  var C = DDO.csv, G = DDO.geo, N = DDO.normalize, M = DDO.metrics, R = DDO.report, CFG = DDO.config || {};
  var doc = root.document;

  var LOTE_CHARS = 1000000;
  var LOTE_FILAS = 20000;
  var ZONAS = { archivo: 'Tal como aparece en el archivo', UTC: 'UTC', COT: 'Hora de Colombia (UTC−05:00)' };
  var TIPOS = { A: 'Telemetría (puntos con hora y coordenadas)', B: 'Resumen por vuelo (una fila por vuelo)' };

  var S = null;
  function estadoNuevo() {
    return { file: null, kind: null, table: null, xlsx: null, geo: null, sug: null, cfg: null, result: null, ctx: null, ocupado: false, swapDetectado: false };
  }
  S = estadoNuevo();

  /* ---------- utilidades DOM ---------- */
  function $(id) { return doc.getElementById(id); }
  function trunc(s) { return N.trunc(s); }
  function el(tag, attrs, kids) {
    var e = doc.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) { return; }
        if (k === 'text') { e.textContent = String(v); }
        else if (k === 'className') { e.className = v; }
        else { e.setAttribute(k, v === true ? '' : String(v)); }
      });
    }
    (kids || []).forEach(function (c) { if (c === null || c === undefined) { return; } e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
    return e;
  }
  function clear(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }
  function yieldUI() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function alerta(tipo, msg, lista) {
    var box = $('alertas');
    clear(box);
    if (!msg) { return; }
    var cont = el('div', { className: 'alerta alerta-' + tipo, role: tipo === 'error' ? 'alert' : 'status' });
    var p = el('p', { text: msg });
    cont.appendChild(p);
    if (lista && lista.length > 1) {
      var ul = el('ul');
      lista.forEach(function (x) { ul.appendChild(el('li', { text: x })); });
      cont.appendChild(ul);
    }
    var x = el('button', { type: 'button', className: 'btn cerrar', 'aria-label': 'Cerrar aviso', text: '×' });
    x.addEventListener('click', function () { clear(box); });
    cont.appendChild(x);
    box.appendChild(cont);
  }

  function progreso(pct, texto) {
    var box = $('progreso');
    if (pct === null) { box.hidden = true; return; }
    box.hidden = false;
    $('barra-progreso').value = Math.max(0, Math.min(100, Math.round(pct)));
    if (texto) { $('progreso-texto').textContent = texto; }
  }

  function setStep(n) {
    [1, 2, 3].forEach(function (i) {
      $('paso' + i).hidden = i !== n;
      var ind = $('ind-' + i);
      if (i === n) { ind.setAttribute('aria-current', 'step'); } else { ind.removeAttribute('aria-current'); }
    });
    var h = n === 1 ? $('t-paso1') : n === 2 ? $('t-paso2') : $('t-paso3');
    if (n !== 1 && h) { h.focus(); }
    root.scrollTo(0, 0);
  }

  function urlValida(u) { return typeof u === 'string' && u !== 'TODO_CONFIGURAR' && /^(https:\/\/|mailto:)/i.test(u); }
  function feedbackHref(base, msg) {
    if (!urlValida(base)) { return null; }
    var m = encodeURIComponent(msg || '');
    if (/^mailto:/i.test(base)) { return base + (base.indexOf('?') === -1 ? '?' : '&') + 'subject=' + encodeURIComponent('Lector de bitácoras de vuelo') + '&body=' + m; }
    if (/wa\.me|whatsapp/i.test(base)) { return base + (base.indexOf('?') === -1 ? '?' : '&') + 'text=' + m; }
    return base;
  }

  /* ---------- paso 1: carga ---------- */
  function extOf(name) { var m = /\.([a-z0-9]{1,6})$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function esZip(b) { return b.length > 3 && b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04; }

  function fallo(msg) { progreso(null); S.ocupado = false; alerta('error', msg); }

  function cargar(file) {
    if (!file || S.ocupado) { return; }
    S = estadoNuevo();
    S.ocupado = true;
    alerta(null);
    var ext = extOf(file.name);
    S.file = { name: trunc(file.name), ext: ext, size: file.size };
    if (file.size > C.MAX_BYTES) { return fallo('El archivo supera el límite de 20 MB.'); }
    if (['txt', 'dat', 'bin', 'log'].indexOf(ext) !== -1) { return fallo(C.MSG_FORMATO); }
    if (ext === 'kmz') { return fallo('Los KMZ son KML comprimidos: descomprímelo (es un .zip) y carga el archivo .kml que contiene.'); }
    progreso(5, 'Leyendo archivo…');
    file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      if (esZip(bytes)) {
        if (ext !== 'xlsx' && ext !== '') { return fallo(C.MSG_FORMATO); }
        return cargarXlsx(bytes);
      }
      if (ext === 'xlsx') { return fallo('El archivo no es un XLSX válido.'); }
      var d = C.decode(bytes);
      if (!d.ok) { return fallo(d.message); }
      var inicio = d.text.slice(0, 512).replace(/^\s+/, '');
      if (ext === 'gpx' || ext === 'kml' || inicio.charAt(0) === '<') { return cargarGeo(d.text, ext); }
      return cargarCsv(d.text, d.encoding);
    }).catch(function () { fallo('No se pudo leer el archivo.'); });
  }

  function cargarGeo(text, ext) {
    progreso(40, 'Interpretando GPX/KML…');
    return yieldUI().then(function () {
      var r = G.parse(text, ext === 'gpx' || ext === 'kml' ? ext : null);
      if (!r.ok) { return fallo(r.message); }
      S.kind = 'geo';
      S.geo = r;
      S.cfg = { tipo: 'A', gapMin: 10, zona: 'archivo' };
      progreso(null); S.ocupado = false;
      renderPaso2Geo();
      setStep(2);
    });
  }

  function cargarCsv(text, encoding) {
    var delim = C.detectDelimiter(text);
    var p = C.createParser(text, delim);
    function paso() {
      if (p.step(LOTE_CHARS)) {
        if (p.tooMany) { return fallo('El archivo supera el límite de 200.000 filas.'); }
        var t = C.buildTable(p.rows, { delimiter: delim, encoding: encoding });
        if (!t.ok) { return fallo(t.message); }
        S.kind = 'csv';
        listoTabla(t);
        return;
      }
      progreso(10 + p.progress() * 80, 'Leyendo filas… ' + Math.round(p.progress() * 100) + ' %');
      setTimeout(paso, 0);
    }
    paso();
  }

  function cargarXlsx(bytes) {
    if (!DDO.xlsx) { return fallo('Este navegador no puede leer XLSX aquí. Guarda el archivo como CSV desde Excel y cárgalo de nuevo.'); }
    progreso(20, 'Descomprimiendo XLSX…');
    return DDO.xlsx.open(bytes).then(function (z) {
      if (!z.ok) { return fallo(z.message); }
      S.xlsx = { zip: z, idx: 0 };
      return leerHoja(0);
    }).catch(function () { fallo('No se pudo leer el XLSX. Guárdalo como CSV desde Excel y cárgalo de nuevo.'); });
  }

  function leerHoja(idx) {
    S.ocupado = true;
    progreso(50, 'Leyendo hoja…');
    return DDO.xlsx.readSheet(S.xlsx.zip, idx).then(function (t) {
      if (t.ok && !t.rows.length) { t = { ok: false, message: 'La hoja no tiene filas de datos después del encabezado.' }; }
      if (!t.ok) { var hs = $('cfg-hoja'); if (hs) { hs.value = String(S.xlsx.idx); } return fallo(t.message); }
      S.xlsx.idx = idx;
      S.kind = 'xlsx';
      listoTabla(t);
    }).catch(function () { fallo('No se pudo leer la hoja. Guárdala como CSV desde Excel y cárgala de nuevo.'); });
  }

  function listoTabla(t) {
    if (!t.rows.length) { return fallo('El archivo no tiene filas de datos después del encabezado.'); }
    S.table = t;
    S.sug = N.suggestMapping(t.headers);
    var m = {};
    Object.keys(S.sug.mapping).forEach(function (k) { m[k] = S.sug.mapping[k]; });
    S.cfg = { tipo: S.sug.tipo, mapping: m, units: {}, decimal: t.decimal, dateOrder: null, swap: false, accum: {}, gapMin: 10, zona: S.sug.zona };
    progreso(null); S.ocupado = false;
    renderPaso2Tabla();
    setStep(2);
    if (t.skipped && t.skipped.columnas) {
      alerta('info', t.skipped.columnas + ' fila(s) con un número de columnas distinto al encabezado se omitieron.');
    }
  }

  /* ---------- paso 2 ---------- */
  function campo(id, labelText, control, ayuda) {
    var c = el('div', { className: 'campo', id: 'wrap-' + id });
    c.appendChild(el('label', { for: control.id, text: labelText }));
    c.appendChild(control);
    if (ayuda) { c.appendChild(el('p', { className: 'ayuda', id: control.id + '-ayuda', text: ayuda })); control.setAttribute('aria-describedby', control.id + '-ayuda'); }
    return c;
  }

  function selectDe(id, opciones, valor) {
    var s = el('select', { id: id });
    opciones.forEach(function (o) {
      var op = el('option', { value: o[0], text: o[1] });
      if (String(o[0]) === String(valor)) { op.selected = true; }
      s.appendChild(op);
    });
    return s;
  }

  function opcionesZona(valor) { return selectDe('cfg-zona', Object.keys(ZONAS).map(function (k) { return [k, ZONAS[k]]; }), valor); }

  function infoArchivo(partes) {
    return el('p', { className: 'sutil info-archivo', text: partes.filter(Boolean).join(' · ') });
  }

  function renderPaso2Geo() {
    var cont = $('paso2-contenido');
    clear(cont);
    var pts = S.geo.points, conHora = pts.some(function (p) { return !!p.time; });
    cont.appendChild(infoArchivo(['Archivo: ' + S.file.name, S.geo.formato, fmtInt(pts.length) + ' puntos', conHora ? 'con hora' : 'sin hora']));
    cont.appendChild(el('p', { text: 'Los archivos ' + S.geo.formato + ' se leen como telemetría (trayectoria). No traen área ni volumen aplicados.' }));
    var sec = el('div', { className: 'panel' });
    var gap = el('input', { id: 'cfg-gap', type: 'number', min: '1', max: '120', step: '1', value: String(S.cfg.gapMin), inputmode: 'numeric' });
    sec.appendChild(campo('gap', 'Separar vuelos cuando pasen más de (minutos) sin datos', gap, conHora ? 'Entre 1 y 120. Por defecto 10.' : 'El archivo no trae hora: se usa un vuelo por cada trazo del archivo.'));
    if (!conHora) { gap.disabled = true; }
    sec.appendChild(campo('zona', 'Zona horaria del reporte', opcionesZona(S.cfg.zona), 'Solo etiqueta el reporte; no convierte horas. Si las fechas traen zona (p. ej. «Z» o «-05:00»), se respeta.'));
    cont.appendChild(sec);
    cont.appendChild(el('div', { id: 'errores-mapeo', className: 'errores-resumen', 'aria-live': 'polite' }));
    cont.appendChild(botonesPaso2());
  }

  function botonesPaso2() {
    var acc = el('div', { className: 'acciones' });
    var gen = el('button', { type: 'button', className: 'btn primario', id: 'btn-generar', text: 'Generar reporte' });
    gen.addEventListener('click', generar);
    var otro = el('button', { type: 'button', className: 'btn', text: 'Cargar otro archivo' });
    otro.addEventListener('click', limpiar);
    acc.appendChild(gen); acc.appendChild(otro);
    return acc;
  }

  function fmtInt(n) { return R.num(n, 0); }

  function renderPaso2Tabla() {
    var t = S.table, cfg = S.cfg, cont = $('paso2-contenido');
    clear(cont);
    var delimNom = { ',': 'coma', ';': 'punto y coma', '\t': 'tabulador' }[t.delimiter];
    cont.appendChild(infoArchivo(['Archivo: ' + S.file.name, fmtInt(t.rows.length) + ' filas', fmtInt(t.headers.length) + ' columnas',
      delimNom ? 'separador: ' + delimNom : null, t.encoding ? 'codificación: ' + t.encoding : null]));

    if (S.kind === 'xlsx' && S.xlsx.zip.sheets.length > 1) {
      var hs = selectDe('cfg-hoja', S.xlsx.zip.sheets.map(function (h, i) { return [i, trunc(h.name)]; }), S.xlsx.idx);
      hs.addEventListener('change', function () { leerHoja(Number(hs.value)); });
      cont.appendChild(campo('hoja', 'Hoja del libro', hs));
    }

    // Vista previa
    var wrap = el('div', { className: 'tabla-scroll', tabindex: '0', role: 'region', 'aria-label': 'Vista previa de las primeras 5 filas' });
    var tabla = el('table', { className: 'vista-previa' });
    tabla.appendChild(el('caption', { text: 'Vista previa (primeras 5 filas)' }));
    var thead = el('thead'), trh = el('tr');
    t.headers.forEach(function (h) { trh.appendChild(el('th', { scope: 'col', text: trunc(h) })); });
    thead.appendChild(trh); tabla.appendChild(thead);
    var tb = el('tbody');
    t.rows.slice(0, 5).forEach(function (r) {
      var tr = el('tr');
      r.forEach(function (c) { tr.appendChild(el('td', { text: trunc(c) })); });
      tb.appendChild(tr);
    });
    tabla.appendChild(tb); wrap.appendChild(tabla); cont.appendChild(wrap);

    // Tipo
    var fsTipo = el('fieldset', { className: 'panel' }, [el('legend', { text: 'Tipo de archivo' })]);
    ['A', 'B'].forEach(function (k) {
      var rid = 'cfg-tipo-' + k;
      var inp = el('input', { type: 'radio', name: 'cfg-tipo', id: rid, value: k });
      if (cfg.tipo === k) { inp.checked = true; }
      inp.addEventListener('change', function () { cfg.tipo = k; actualizar(); });
      fsTipo.appendChild(el('div', { className: 'casilla' }, [inp, el('label', { for: rid, text: TIPOS[k] + (S.sug.tipo === k ? ' (sugerido)' : '') })]));
    });
    cont.appendChild(fsTipo);

    if (S.sug.avisos.length) {
      var av = el('div', { className: 'advertencias' }, [el('p', { className: 'advertencias-titulo', text: 'Revisa el mapeo' })]);
      var ul = el('ul');
      S.sug.avisos.forEach(function (a) { ul.appendChild(el('li', { text: a })); });
      av.appendChild(ul); cont.appendChild(av);
    }

    // Columnas
    var fsCol = el('fieldset', { className: 'panel' }, [el('legend', { text: 'Columnas y unidades' }),
      el('p', { className: 'ayuda', text: 'Sugerimos el mapeo por el nombre de cada columna. Confírmalo o corrígelo. Las unidades no se asumen: elígelas.' })]);
    var opcionesCol = [['', '— Sin asignar —']].concat(t.headers.map(function (h, i) { return [i, trunc(h)]; }));
    var rej = el('div', { className: 'rejilla' });
    N.FIELDS.forEach(function (f) {
      var sel = selectDe('map-' + f.id, opcionesCol, cfg.mapping[f.id] === null ? '' : cfg.mapping[f.id]);
      sel.addEventListener('change', function () { cfg.mapping[f.id] = sel.value === '' ? null : Number(sel.value); actualizar(); });
      var c = campo('map-' + f.id, f.label, sel, S.kind === 'xlsx' && (f.id === 'fechaHora' || f.id === 'fecha' || f.id === 'fin') ? 'En Excel las fechas pueden verse como números (serie de Excel); se convierten al calcular.' : null);
      c.setAttribute('data-campo', f.id);
      if (f.unidad) {
        var u = N.UNITS[f.unidad];
        var hint = S.sug.hints[f.id];
        var us = selectDe('unit-' + f.id, [['', 'Elige la unidad…']].concat(u.opciones.map(function (o) { return [o[0], o[1]]; })), cfg.units[f.id] || '');
        us.addEventListener('change', function () { cfg.units[f.id] = us.value || null; });
        var uw = el('div', { className: 'campo campo-unidad', id: 'wrap-unit-' + f.id }, [el('label', { for: us.id, text: 'Unidad de ' + f.label.toLowerCase() }), us]);
        if (hint) {
          var hl = N.unitInfo(f.unidad, hint);
          uw.appendChild(el('p', { className: 'ayuda', id: 'hint-' + f.id, text: 'El encabezado parece indicar: ' + (hl ? hl.label : hint) }));
        }
        c.appendChild(uw);
      }
      rej.appendChild(c);
    });
    fsCol.appendChild(rej);
    cont.appendChild(fsCol);

    // Formato
    var fsFmt = el('fieldset', { className: 'panel' }, [el('legend', { text: 'Formato y vuelos' })]);
    var rej2 = el('div', { className: 'rejilla' });
    if (S.kind === 'csv') {
      var ds = selectDe('cfg-decimal', [[',', 'Coma (3,5)'], ['.', 'Punto (3.5)']], cfg.decimal);
      ds.addEventListener('change', function () { cfg.decimal = ds.value; actualizar(); });
      rej2.appendChild(campo('decimal', 'Separador decimal', ds, 'Detectado automáticamente; corrígelo si ves números mal leídos.'));
    }
    var os = selectDe('cfg-orden', [['', 'Detectar (pide elegir si hay duda)'], ['dmy', 'día/mes/año'], ['mdy', 'mes/día/año']], cfg.dateOrder || '');
    os.addEventListener('change', function () { cfg.dateOrder = os.value || null; });
    rej2.appendChild(campo('orden', 'Formato de fechas', os));
    var zs = opcionesZona(cfg.zona);
    zs.addEventListener('change', function () { cfg.zona = zs.value; });
    rej2.appendChild(campo('zona', 'Zona horaria del reporte', zs, 'Solo etiqueta el reporte; no convierte horas. Si las fechas traen zona, se respeta.'));
    var gap = el('input', { id: 'cfg-gap', type: 'number', min: '1', max: '120', step: '1', value: String(cfg.gapMin), inputmode: 'numeric' });
    var gw = campo('gap', 'Separar vuelos tras (minutos) sin datos', gap, 'Entre 1 y 120. Se ignora si asignas «ID de vuelo».');
    gw.setAttribute('data-solo', 'A');
    rej2.appendChild(gw);
    ['area', 'vol'].forEach(function (k) {
      var nom = k === 'area' ? 'el área' : 'el volumen';
      var as = selectDe('cfg-accum-' + k, [['', 'Elige…'], ['acumulado', 'Acumulado en el vuelo (se toma el valor final/máximo)'], ['fila', 'Por fila (se suman los valores)']], cfg.accum[k] || '');
      as.addEventListener('change', function () { cfg.accum[k] = as.value || null; });
      var aw = campo('accum-' + k, '¿Cómo viene ' + nom + ' en cada fila?', as);
      aw.setAttribute('data-solo', 'A');
      aw.classList.add('campo-ancho');
      rej2.appendChild(aw);
    });
    fsFmt.appendChild(rej2);
    var swc = el('div', { className: 'casilla aviso-swap', id: 'wrap-swap', hidden: true });
    var sw = el('input', { type: 'checkbox', id: 'cfg-swap' });
    sw.addEventListener('change', function () { cfg.swap = sw.checked; });
    swc.appendChild(sw);
    swc.appendChild(el('label', { for: 'cfg-swap', text: 'Parece que la latitud y la longitud están intercambiadas. Intercambiarlas.' }));
    fsFmt.appendChild(swc);
    cont.appendChild(fsFmt);

    cont.appendChild(el('div', { id: 'errores-mapeo', className: 'errores-resumen', 'aria-live': 'polite' }));
    cont.appendChild(botonesPaso2());
    actualizar();
  }

  /* Visibilidad según tipo y columnas asignadas. */
  function actualizar() {
    var cfg = S.cfg, t = S.table;
    N.FIELDS.forEach(function (f) {
      var w = $('wrap-map-' + f.id);
      if (!w) { return; }
      var oculto = (cfg.tipo === 'A' && f.soloB) || (cfg.tipo === 'B' && f.soloA);
      w.hidden = oculto;
      var lab = w.querySelector('label');
      if (lab) { lab.textContent = f.id === 'fechaHora' && cfg.tipo === 'B' ? f.labelB : f.label; }
      var uw = $('wrap-unit-' + f.id);
      if (uw) { uw.hidden = cfg.mapping[f.id] === null; }
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-solo="A"]'), function (n) { n.hidden = cfg.tipo !== 'A'; });
    var aa = $('wrap-accum-area'), av = $('wrap-accum-vol');
    if (aa) { aa.hidden = cfg.tipo !== 'A' || cfg.mapping.area === null; }
    if (av) { av.hidden = cfg.tipo !== 'A' || cfg.mapping.vol === null; }
    var g = $('cfg-gap');
    if (g) { g.disabled = cfg.mapping.vuelo !== null; }
    var swc = $('wrap-swap');
    if (swc) {
      S.swapDetectado = cfg.tipo === 'A' && cfg.mapping.lat !== null && cfg.mapping.lon !== null && N.detectSwap(t.rows.slice(0, 5000), cfg.mapping.lat, cfg.mapping.lon, cfg.decimal);
      swc.hidden = !S.swapDetectado;
      if (!S.swapDetectado) { $('cfg-swap').checked = false; cfg.swap = false; }
    }
  }

  function mostrarErrores(lista) {
    var box = $('errores-mapeo');
    clear(box);
    if (!lista || !lista.length) { return; }
    var ul = el('ul');
    lista.forEach(function (e) { ul.appendChild(el('li', { text: e })); });
    box.appendChild(ul);
  }

  function leerGap() {
    var g = $('cfg-gap');
    var v = g ? Number(g.value) : 10;
    if (!isFinite(v) || v < 1 || v > 120) { return null; }
    return Math.round(v);
  }

  /* ---------- generar ---------- */
  function generar() {
    if (S.ocupado) { return; }
    var cfg = S.cfg;
    var zs = $('cfg-zona'); if (zs) { cfg.zona = zs.value; }
    var gap = leerGap();
    if (gap === null && !(cfg.mapping && cfg.mapping.vuelo !== null) && !($('cfg-gap') && $('cfg-gap').disabled)) {
      mostrarErrores(['La separación entre vuelos debe estar entre 1 y 120 minutos.']);
      alerta('error', 'Revisa la separación entre vuelos (1 a 120 minutos).');
      $('cfg-gap').focus();
      return;
    }
    cfg.gapMin = gap || 10;
    mostrarErrores([]);
    if (S.kind === 'geo') {
      var g = N.fromGeoPoints(S.geo.points);
      return terminar(g.records, g.ctx, { useFlightId: false });
    }
    var ctx = N.prepare(S.table, cfg);
    if (!ctx.ok) {
      mostrarErrores(ctx.errores || [ctx.message]);
      alerta('error', ctx.message, ctx.errores);
      if (ctx.need && ctx.need.dateOrder) { $('cfg-orden').focus(); }
      return;
    }
    S.ocupado = true;
    var rows = S.table.rows, recs = [], i = 0;
    function lote() {
      var fin = Math.min(rows.length, i + LOTE_FILAS);
      for (; i < fin; i++) { var r = N.convertRow(rows[i], ctx); if (r) { recs.push(r); } }
      if (i < rows.length) { progreso(i / rows.length * 100, 'Procesando filas… ' + Math.round(i / rows.length * 100) + ' %'); setTimeout(lote, 0); return; }
      progreso(null);
      S.ocupado = false;
      terminar(recs, ctx, { useFlightId: ctx.cols.vuelo !== undefined });
    }
    lote();
  }

  function terminar(recs, ctx, extra) {
    var cfg = S.cfg;
    if (!recs.length) {
      var motivos = Object.keys(ctx.descartes).map(function (k) { return k + ': ' + fmtInt(ctx.descartes[k]); });
      alerta('error', 'No quedaron datos válidos para el reporte. Revisa el mapeo.', motivos);
      mostrarErrores(motivos);
      return;
    }
    var res = cfg.tipo === 'B' && S.kind !== 'geo'
      ? M.processSummary(recs, {})
      : M.processTelemetry(recs, { gapMin: cfg.gapMin, useFlightId: extra.useFlightId, accum: ctx.accum || {} });
    S.result = res; S.ctx = ctx;
    alerta(null);
    renderReporte();
    setStep(3);
  }

  /* ---------- paso 3: reporte ---------- */
  function fila(th, td) { return el('tr', null, [el('th', { scope: 'row', text: th }), el('td', null, [td])]); }
  function valor(o, fmt, unidad) {
    if (o && o.value !== null && o.value !== undefined) {
      var tx = doc.createTextNode(fmt(o.value) + (unidad ? ' ' + unidad : ''));
      return o.motivo ? el('span', null, [tx, el('span', { className: 'motivo', text: ' (' + o.motivo + ')' })]) : tx;
    }
    return el('span', null, [R.DASH + ' ', el('span', { className: 'motivo', text: '(' + (o && o.motivo ? o.motivo : 'Sin datos') + ')' })]);
  }

  function nombreCol(i) { return i === null || i === undefined ? null : '«' + trunc(S.table.headers[i]) + '»'; }

  function zonaTexto() {
    var r = S.result;
    var conOff = r.flights.some(function (f) { return f.off !== null && f.off !== undefined; });
    if (conOff) { return 'Según la zona indicada en las fechas del archivo'; }
    return ZONAS[S.cfg.zona] || ZONAS.archivo;
  }

  function avisosReporte() {
    var r = S.result, ctx = S.ctx, out = [];
    r.avisos.forEach(function (a) { out.push(a); });
    if (ctx && ctx.avisos && ctx.avisos.negativos) { out.push(fmtInt(ctx.avisos.negativos) + ' valor(es) negativos de área, volumen, duración o velocidad se descartaron.'); }
    if (S.table && S.table.skipped && S.table.skipped.columnas) { out.push(fmtInt(S.table.skipped.columnas) + ' fila(s) omitidas por tener un número de columnas distinto al encabezado.'); }
    var desc = {};
    [ctx ? ctx.descartes : {}, r.descartes].forEach(function (d) { Object.keys(d || {}).forEach(function (k) { desc[k] = (desc[k] || 0) + d[k]; }); });
    Object.keys(desc).forEach(function (k) { out.push(k + ': ' + fmtInt(desc[k]) + (r.tipo === 'A' ? ' punto(s)/fila(s) descartados.' : ' fila(s).')); });
    if (r.tipo === 'A' && r.totals.areaHa.value === null) { out.push('El archivo no trae área aplicada. Este lector no la estima a partir de la trayectoria porque el traslape de pasadas la sobreestima.'); }
    return out;
  }

  function supuestos() {
    var r = S.result, cfg = S.cfg, out = [];
    out.push('Tipo de archivo: ' + (r.tipo === 'A' ? 'A — ' + TIPOS.A : 'B — ' + TIPOS.B) + '.');
    out.push('Zona horaria: ' + zonaTexto() + '.');
    if (S.kind === 'geo') {
      out.push('Formato: ' + S.geo.formato + ' (coordenadas leídas del archivo; en KML el orden es longitud, latitud).');
    } else {
      N.FIELDS.forEach(function (f) {
        var c = S.ctx.cols[f.id];
        if (c === undefined) { return; }
        var u = f.unidad ? N.unitInfo(f.unidad, cfg.units[f.id]) : null;
        out.push((f.id === 'fechaHora' && r.tipo === 'B' ? f.labelB : f.label) + ' ← columna ' + nombreCol(c) + (u ? ' (' + u.label + ')' : '') + '.');
      });
      if (S.ctx.dateOrder) { out.push('Formato de fecha: ' + (S.ctx.dateOrder === 'dmy' ? 'día/mes/año' : 'mes/día/año') + '.'); }
      if (cfg.swap) { out.push('Latitud y longitud intercambiadas por el usuario.'); }
      if (S.kind === 'csv') { out.push('Separador decimal: ' + (S.ctx.decimal === ',' ? 'coma' : 'punto') + '.'); }
      if (r.tipo === 'A' && S.ctx.cols.area !== undefined) { out.push('Área: ' + (cfg.accum.area === 'fila' ? 'suma por fila' : 'valor acumulado (máximo) por vuelo') + '.'); }
      if (r.tipo === 'A' && S.ctx.cols.vol !== undefined) { out.push('Volumen: ' + (cfg.accum.vol === 'fila' ? 'suma por fila' : 'valor acumulado (máximo) por vuelo') + '.'); }
    }
    if (r.tipo === 'A') {
      out.push(S.ctx && S.ctx.cols && S.ctx.cols.vuelo !== undefined ? 'Vuelos separados por la columna de ID de vuelo.' : (r.hasTime ? 'Vuelos separados cuando pasan más de ' + cfg.gapMin + ' min sin datos.' : 'Sin hora: un vuelo por cada trazo del archivo.'));
      out.push('Distancia: suma de tramos entre puntos (haversine, radio terrestre 6.371 km). Se descartan saltos mayores a 100 m/s.');
      var fuente = r.flights.some(function (f) { return f.velFuente === 'columna'; }) ? 'tomada de la columna del archivo' : 'calculada a partir de distancia y tiempo';
      out.push('Velocidad ' + fuente + '.');
    }
    return out;
  }

  function renderReporte() {
    var r = S.result, art = $('reporte');
    clear(art);
    var conTray = r.tipo === 'A';
    var ahora = new Date();
    var gen = ('0' + ahora.getDate()).slice(-2) + '/' + ('0' + (ahora.getMonth() + 1)).slice(-2) + '/' + ahora.getFullYear() + ' ' + ('0' + ahora.getHours()).slice(-2) + ':' + ('0' + ahora.getMinutes()).slice(-2);

    var cab = el('header', { className: 'r-cab' }, [
      el('p', { className: 'r-marca', text: CFG.marca || 'Datos de Occidente' }),
      el('h2', { className: 'r-titulo', text: 'Reporte de vuelos' }),
      el('p', { className: 'r-meta', text: 'Archivo: ' + S.file.name }),
      el('p', { className: 'r-meta', text: 'Generado: ' + gen + ' · Tipo: ' + (r.tipo === 'A' ? 'A — Telemetría' : 'B — Resumen por vuelo') + ' · Zona horaria: ' + zonaTexto() })
    ]);
    art.appendChild(cab);

    var ident = [['Cliente', $('h-cliente').value], ['Predio / lote', $('h-predio').value], ['Empresa / operador', $('h-empresa').value]]
      .filter(function (x) { return x[1] && x[1].trim(); });
    if (ident.length) {
      var ti = el('table', { className: 'r-tabla r-ident' }), tbi = el('tbody');
      ident.forEach(function (x) { tbi.appendChild(fila(x[0], doc.createTextNode(trunc(x[1].trim())))); });
      ti.appendChild(tbi); art.appendChild(ti);
    }

    // Totales
    var t = r.totals;
    art.appendChild(el('h3', { text: 'Totales' }));
    var tt = el('table', { className: 'r-tabla r-totales' }), tbt = el('tbody');
    tbt.appendChild(fila('Vuelos', doc.createTextNode(fmtInt(t.vuelos))));
    var durNode = valor(t.durS, R.duration);
    if (t.durS.value !== null && t.vuelosSinDuracion) { durNode = el('span', null, [durNode, el('span', { className: 'motivo', text: ' (' + t.vuelosSinDuracion + ' vuelo(s) sin duración)' })]); }
    tbt.appendChild(fila('Tiempo total de vuelo', durNode));
    tbt.appendChild(fila('Distancia total', valor(t.distKm, function (v) { return R.num(v, 2); }, 'km')));
    tbt.appendChild(fila('Área total', valor(t.areaHa, function (v) { return R.num(v, 2); }, 'ha')));
    tbt.appendChild(fila('Volumen total', valor(t.volL, function (v) { return R.num(v, 1); }, 'L')));
    tbt.appendChild(fila('Volumen por hectárea', valor(t.lha, function (v) { return R.num(v, 1); }, 'L/ha')));
    tbt.appendChild(fila('Rendimiento', valor(t.hah, function (v) { return R.num(v, 2); }, 'ha/h')));
    tt.appendChild(tbt); art.appendChild(tt);

    // Trayectoria
    if (conTray && $('op-tray').checked) {
      var fig = el('figure', { className: 'r-figura' });
      fig.appendChild(R.buildSvg(doc, r.flights, { width: 640, height: 400 }));
      var cap = el('figcaption', { className: 'sutil', text: 'Trayectoria sin mapa base, escala aproximada. Círculo: inicio · cuadrado: fin.' });
      fig.appendChild(cap);
      if (r.flights.length > 1 && r.flights.length <= R.COLORES.length) {
        var ley = el('ul', { className: 'leyenda' });
        r.flights.forEach(function (f, i) {
          ley.appendChild(el('li', null, [el('span', { className: 'muestra c' + i, 'aria-hidden': 'true' }), 'Vuelo ' + f.n + (f.id ? ' (' + trunc(f.id) + ')' : '')]));
        });
        fig.appendChild(ley);
      } else if (r.flights.length > R.COLORES.length) {
        fig.appendChild(el('p', { className: 'sutil', text: 'Los colores se repiten cada ' + R.COLORES.length + ' vuelos.' }));
      }
      art.appendChild(fig);
    }
    if (conTray && $('op-coords').checked) {
      art.appendChild(el('h3', { text: 'Coordenadas de inicio y fin' }));
      var tc = el('table', { className: 'r-tabla r-vuelos' });
      tc.appendChild(el('thead', null, [el('tr', null, [el('th', { scope: 'col', text: 'Vuelo' }), el('th', { scope: 'col', text: 'Inicio (lat, lon)' }), el('th', { scope: 'col', text: 'Fin (lat, lon)' })])]));
      var tbc = el('tbody');
      r.flights.forEach(function (f) {
        var a = f.trayectoria[0], b = f.trayectoria[f.trayectoria.length - 1];
        tbc.appendChild(el('tr', null, [el('td', { text: String(f.n) }), el('td', { className: 'coord', text: a[0].toFixed(6) + ', ' + a[1].toFixed(6) }), el('td', { className: 'coord', text: b[0].toFixed(6) + ', ' + b[1].toFixed(6) })]));
      });
      tc.appendChild(tbc); art.appendChild(tc);
    }

    // Tabla de vuelos
    art.appendChild(el('h3', { text: 'Vuelos' }));
    var hayId = r.flights.some(function (f) { return f.id; }), hayDron = r.flights.some(function (f) { return f.dron; }), hayOp = r.flights.some(function (f) { return f.operador; });
    var hayArea = r.flights.some(function (f) { return f.area !== null; }), hayVol = r.flights.some(function (f) { return f.vol !== null; });
    var hayAlt = r.flights.some(function (f) { return f.altMax !== null; });
    var cols = [['#', function (f) { return String(f.n); }, true]];
    if (hayId) { cols.push(['ID', function (f) { return trunc(f.id || R.DASH); }]); }
    cols.push(['Inicio', function (f) { return R.dateTime(f.inicio, f.off); }], ['Fin', function (f) { return R.dateTime(f.fin, f.off); }], ['Duración', function (f) { return R.duration(f.durS); }, true]);
    if (conTray) {
      cols.push(['Distancia (km)', function (f) { return R.num(f.distKm, 2); }, true], ['Vel. media (m/s)', function (f) { return R.num(f.velMedia, 1); }, true],
        ['Vel. máx. (m/s)', function (f) { return R.num(f.velMax, 1); }, true], ['Puntos', function (f) { return fmtInt(f.puntos); }, true]);
      if (hayAlt) { cols.push(['Altura máx. (m)', function (f) { return R.num(f.altMax, 1); }, true]); }
    }
    if (hayArea) { cols.push(['Área (ha)', function (f) { return R.num(f.area, 2); }, true]); }
    if (hayVol) { cols.push(['Volumen (L)', function (f) { return R.num(f.vol, 1); }, true]); }
    if (hayArea && hayVol) { cols.push(['L/ha', function (f) { return f.area > 0 && f.vol !== null ? R.num(f.vol / f.area, 1) : R.DASH; }, true]); }
    if (hayDron) { cols.push(['Dron', function (f) { return trunc(f.dron || R.DASH); }]); }
    if (hayOp) { cols.push(['Operador', function (f) { return trunc(f.operador || R.DASH); }]); }
    var wrapV = el('div', { className: 'tabla-scroll', tabindex: '0', role: 'region', 'aria-label': 'Tabla de vuelos' });
    var tv = el('table', { className: 'r-tabla r-vuelos' });
    tv.appendChild(el('thead', null, [el('tr', null, cols.map(function (c) { return el('th', { scope: 'col', className: c[2] ? 'cifra' : null, text: c[0] }); }))]));
    var tbv = el('tbody');
    r.flights.forEach(function (f) { tbv.appendChild(el('tr', null, cols.map(function (c) { return el('td', { className: c[2] ? 'cifra' : null, text: c[1](f) }); }))); });
    tv.appendChild(tbv); wrapV.appendChild(tv); art.appendChild(wrapV);

    var obs = $('h-obs').value.trim();
    if (obs) { art.appendChild(el('h3', { text: 'Observaciones' })); art.appendChild(el('p', { className: 'r-obs', text: obs.slice(0, 1000) })); }

    var avs = avisosReporte();
    if (avs.length) {
      art.appendChild(el('h3', { text: 'Advertencias y datos omitidos' }));
      var ula = el('ul', { className: 'r-lista' });
      avs.forEach(function (a) { ula.appendChild(el('li', { text: a })); });
      art.appendChild(ula);
    }
    art.appendChild(el('h3', { text: 'Datos y supuestos' }));
    var uls = el('ul', { className: 'r-lista' });
    supuestos().forEach(function (a) { uls.appendChild(el('li', { text: a })); });
    art.appendChild(uls);
    art.appendChild(el('footer', { className: 'r-pie' }, [
      el('p', { text: R.PIE_LEGAL }),
      el('p', { text: 'Generado con ' + (CFG.nombreHerramienta || 'Lector de bitácoras de vuelo') + ' de ' + (CFG.marca || 'Datos de Occidente') + ' · código abierto (MIT).' })
    ]));
    $('op-tray').disabled = !conTray; $('op-coords').disabled = !conTray;
  }

  /* ---------- acciones ---------- */
  function exportarCsv() {
    if (!S.result) { return; }
    var blob = new Blob([R.toCsv(S.result)], { type: 'text/csv;charset=utf-8' });
    var base = (S.file.name || 'archivo').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').slice(0, 60) || 'archivo';
    var a = el('a', { href: URL.createObjectURL(blob), download: 'reporte-vuelos-' + base + '.csv' });
    doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    alerta('ok', 'Se descargó el resumen de vuelos en CSV.');
  }

  function limpiar() {
    S = estadoNuevo();
    $('archivo').value = '';
    ['h-cliente', 'h-predio', 'h-empresa', 'h-obs'].forEach(function (id) { $(id).value = ''; });
    $('op-tray').checked = true; $('op-coords').checked = false;
    clear($('paso2-contenido')); clear($('reporte'));
    progreso(null);
    setStep(1);
    alerta('info', 'Se borraron los datos de esta sesión.');
    $('archivo').focus();
  }

  var tRender = null;
  function rerender() { if (!S.result) { return; } clearTimeout(tRender); tRender = setTimeout(renderReporte, 200); }

  function enlaces() {
    var fb = feedbackHref(CFG.urlFeedback, (CFG.mensajes || {}).general);
    var b = $('btn-feedback');
    if (fb) { b.href = fb; b.hidden = false; } else { b.hidden = true; b.removeAttribute('href'); }
    var map = [['enlace-calculadora', CFG.urlCalculadora], ['enlace-registro', CFG.urlRegistro], ['enlace-repo', CFG.urlRepositorio], ['enlace-marca', CFG.urlMarca], ['enlace-registro-cta', CFG.urlRegistro]];
    map.forEach(function (x) {
      var a = $(x[0]);
      if (urlValida(x[1])) { a.href = x[1]; a.hidden = false; } else { a.removeAttribute('href'); a.hidden = true; }
    });
    var reg = feedbackHref(CFG.urlFeedback, (CFG.mensajes || {}).registro);
    var cta = $('cta-registro');
    if (reg && urlValida(CFG.urlRegistro)) { $('btn-registro-interes').href = reg; cta.hidden = false; } else { cta.hidden = true; }
  }

  function init() {
    if (!C || !G || !N || !M || !R) { alerta('error', 'No se pudieron cargar los componentes de la aplicación.'); return; }
    enlaces();
    var input = $('archivo'), zona = $('zona');
    input.addEventListener('change', function () { if (input.files && input.files[0]) { cargar(input.files[0]); } });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add('activa'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) { zona.addEventListener(ev, function () { zona.classList.remove('activa'); }); });
    zona.addEventListener('drop', function (e) {
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { cargar(f); }
    });
    root.addEventListener('dragover', function (e) { e.preventDefault(); });
    root.addEventListener('drop', function (e) { e.preventDefault(); });
    $('btn-imprimir').addEventListener('click', function () { root.print(); });
    $('btn-csv').addEventListener('click', exportarCsv);
    $('btn-limpiar').addEventListener('click', limpiar);
    $('btn-ajustar').addEventListener('click', function () { setStep(2); });
    ['h-cliente', 'h-predio', 'h-empresa', 'h-obs'].forEach(function (id) { $(id).addEventListener('input', rerender); });
    ['op-tray', 'op-coords'].forEach(function (id) { $(id).addEventListener('change', renderReporte); });
  }

  if (doc.readyState === 'loading') { doc.addEventListener('DOMContentLoaded', init); } else { init(); }
})(typeof self !== 'undefined' ? self : this);
