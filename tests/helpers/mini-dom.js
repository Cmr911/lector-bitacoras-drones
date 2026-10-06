/*
 * DOMParser mínimo SOLO para pruebas en Node (el navegador usa su DOMParser nativo).
 * Soporta elementos, atributos, texto, CDATA, comentarios, PI y entidades básicas.
 * Ante XML mal formado devuelve un documento con <parsererror>, como los navegadores.
 */
'use strict';

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, function (m, e) {
    if (e[0] === '#') { return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)); }
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}

function El(name, parent) {
  this.nodeType = 1;
  this.nodeName = name;
  this.localName = name.indexOf(':') === -1 ? name : name.slice(name.indexOf(':') + 1);
  this.parentNode = parent;
  this.attrs = Object.create(null);
  this.children = [];
  this.childNodes = [];
}
El.prototype.getAttribute = function (n) { return n in this.attrs ? this.attrs[n] : null; };
Object.defineProperty(El.prototype, 'textContent', {
  get: function () { return this.childNodes.map(function (c) { return typeof c === 'string' ? c : c.textContent; }).join(''); }
});
El.prototype.getElementsByTagName = function (name) {
  var out = [];
  (function rec(el) { el.children.forEach(function (c) { if (name === '*' || c.nodeName === name) { out.push(c); } rec(c); }); })(this);
  return out;
};

function Doc(rootEl) {
  this.nodeType = 9;
  this.documentElement = rootEl;
  this.children = rootEl ? [rootEl] : [];
}
Doc.prototype.getElementsByTagName = function (name) {
  if (!this.documentElement) { return []; }
  var out = (name === '*' || this.documentElement.nodeName === name) ? [this.documentElement] : [];
  return out.concat(this.documentElement.getElementsByTagName(name));
};

function errorDoc() { var e = new El('parsererror', null); e.childNodes.push('error'); return new Doc(e); }

function parse(text) {
  var i = 0, n = text.length, docNode = new El('#document', null), stack = [docNode], rootEl = null;
  var ATTR = /\s+([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
  while (i < n) {
    var lt = text.indexOf('<', i);
    var cur = stack[stack.length - 1];
    if (lt === -1) { if (text.slice(i).trim()) { return null; } break; }
    if (lt > i) {
      var txt = text.slice(i, lt);
      if (cur === docNode) { if (txt.trim()) { return null; } } else { cur.childNodes.push(decodeEntities(txt)); }
    }
    if (text.startsWith('<?', lt)) { var e1 = text.indexOf('?>', lt); if (e1 === -1) { return null; } i = e1 + 2; continue; }
    if (text.startsWith('<!--', lt)) { var e2 = text.indexOf('-->', lt); if (e2 === -1) { return null; } i = e2 + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) {
      var e3 = text.indexOf(']]>', lt); if (e3 === -1 || cur === docNode) { return null; }
      cur.childNodes.push(text.slice(lt + 9, e3)); i = e3 + 3; continue;
    }
    if (text.startsWith('<!', lt)) { var e4 = text.indexOf('>', lt); if (e4 === -1) { return null; } i = e4 + 1; continue; }
    if (text[lt + 1] === '/') {
      var gt = text.indexOf('>', lt); if (gt === -1) { return null; }
      var cname = text.slice(lt + 2, gt).trim();
      if (cur === docNode || cur.nodeName !== cname) { return null; }
      stack.pop(); i = gt + 1; continue;
    }
    var m = /^<([A-Za-z_][\w.:-]*)/.exec(text.slice(lt, lt + 256));
    if (!m) { return null; }
    var el = new El(m[1], cur === docNode ? null : cur);
    var j = lt + m[0].length, am;
    ATTR.lastIndex = j;
    while ((am = ATTR.exec(text))) { el.attrs[am[1]] = decodeEntities(am[2] !== undefined ? am[2] : am[3]); j = ATTR.lastIndex; }
    var rest = /^\s*(\/?)>/.exec(text.slice(j, j + 64));
    if (!rest) { return null; }
    i = j + rest[0].length;
    if (cur === docNode) { if (rootEl) { return null; } rootEl = el; } else { cur.children.push(el); cur.childNodes.push(el); }
    if (!rest[1]) { stack.push(el); }
  }
  if (stack.length !== 1 || !rootEl) { return null; }
  return new Doc(rootEl);
}

function MiniDOMParser() {}
MiniDOMParser.prototype.parseFromString = function (text) { return parse(text) || errorDoc(); };

module.exports = { DOMParser: MiniDOMParser };
