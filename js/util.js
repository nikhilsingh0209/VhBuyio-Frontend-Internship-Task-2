/* ==================================================================
   util.js — small, dependency-free helpers shared by every module.

   Nothing here knows anything about requests: formatting, escaping,
   DOM construction and the JSON highlighter live here so the feature
   modules stay readable.
   ================================================================== */
var Relay = window.Relay || (window.Relay = {});

(function (R) {
  'use strict';

  /* ------------------------------ ids ---------------------------- */

  let _seq = 0;
  function uid(prefix) {
    _seq = (_seq + 1) % 1e6;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' +
           _seq.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* --------------------------- escaping -------------------------- */

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** Full escape — safe for attributes and text nodes alike. */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC_MAP[c]);
  }

  /** Escapes only the three characters that can open a tag, leaving
   *  quotes intact so a tokeniser can still see JSON string bounds. */
  function escText(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, c => ESC_MAP[c]);
  }

  /* ----------------------------- DOM ----------------------------- */

  const qs  = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /**
   * el('button.btn', { title: 'x', onclick: fn }, ['label'])
   * Tag may carry `.class` suffixes and a `#id`.
   */
  function el(tag, attrs, kids) {
    const parts = String(tag).split(/(?=[.#])/);
    const node = document.createElement(parts.shift() || 'div');
    parts.forEach(p => {
      if (p[0] === '.') node.classList.add(p.slice(1));
      else if (p[0] === '#') node.id = p.slice(1);
    });
    Object.keys(attrs || {}).forEach(k => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className += (node.className ? ' ' : '') + v;
      else if (k in node && k !== 'list' && k !== 'type' && k !== 'size') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach(k => {
      if (k == null || k === false) return;
      node.appendChild(typeof k === 'string' || typeof k === 'number'
        ? document.createTextNode(String(k)) : k);
    });
    return node;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  /* --------------------------- timing ---------------------------- */

  function debounce(fn, ms) {
    let t = 0;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), ms);
    };
  }

  /* -------------------------- formatting ------------------------- */

  function byteLen(str) {
    if (str == null) return 0;
    try { return new TextEncoder().encode(str).length; }
    catch (e) { return unescape(encodeURIComponent(str)).length; }
  }

  function fmtBytes(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 2 : 1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  function fmtMs(ms) {
    if (ms == null) return '—';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
  }

  function fmtAgo(ts) {
    const d = Date.now() - ts;
    if (d < 45000) return 'just now';
    if (d < 3600000) return Math.round(d / 60000) + 'm ago';
    if (d < 86400000) return Math.round(d / 3600000) + 'h ago';
    if (d < 604800000) return Math.round(d / 86400000) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  function fmtStamp(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
  }

  /* ---------------------------- JSON ----------------------------- */

  function prettyJSON(value) {
    try { return JSON.stringify(value, null, 2); }
    catch (e) { return String(value); }
  }

  /** Parse, returning { ok, value, error }. Never throws. */
  function tryParseJSON(text) {
    try { return { ok: true, value: JSON.parse(text) }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  /**
   * Colourises an already pretty-printed JSON string.
   * Tag-opening characters are escaped first; quotes survive so the
   * tokeniser can still tell strings from keys.
   */
  const TOKENS = /("(?:\\.|[^"\\])*"\s*:?)|(\btrue\b|\bfalse\b)|(\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

  function highlightJSON(text) {
    return escText(text).replace(TOKENS, (m, str, bool, nul, num) => {
      let cls;
      if (str) cls = /:\s*$/.test(str) ? 'tok-key' : 'tok-str';
      else if (bool) cls = 'tok-bool';
      else if (nul) cls = 'tok-null';
      else cls = 'tok-num';
      return '<span class="' + cls + '">' + m + '</span>';
    });
  }

  /* -------------------------- HTTP bits -------------------------- */

  /** '2' for 2xx … 'x' for a transport failure with no status. */
  function statusClass(code) {
    if (!code || code < 100) return 'x';
    return String(Math.floor(code / 100));
  }

  /** 'application/json; charset=utf-8' -> 'application/json' */
  function baseType(contentType) {
    return String(contentType || '').split(';')[0].trim().toLowerCase();
  }

  function looksJSON(contentType) {
    const t = baseType(contentType);
    return t === 'application/json' || t === 'text/json' || /\+json$/.test(t);
  }

  function looksHTML(contentType) {
    const t = baseType(contentType);
    return t === 'text/html' || t === 'application/xhtml+xml' || t === 'image/svg+xml';
  }

  function looksImage(contentType) {
    return baseType(contentType).slice(0, 6) === 'image/';
  }

  /* -------------------------- clipboard -------------------------- */

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    // file:// pages and insecure origins have no async clipboard API.
    try {
      const ta = el('textarea', { value: text, style: 'position:fixed;top:-1000px;opacity:0' });
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* -------------------------- downloads -------------------------- */

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ---------------------------- misc ----------------------------- */

  function clone(o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  }

  function truncate(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  R.util = {
    uid, esc, escText, qs, qsa, el, clear, debounce,
    byteLen, fmtBytes, fmtMs, fmtAgo, fmtStamp,
    prettyJSON, tryParseJSON, highlightJSON,
    statusClass, baseType, looksJSON, looksHTML, looksImage,
    copy, download, clone, truncate
  };
})(Relay);
