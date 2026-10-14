/* ==================================================================
   env.js — {{variable}} resolution, plus the URL/query helpers.

   The two live together on purpose: the only thing subtle about the
   query-string helpers is that they must round-trip `{{tokens}}`
   without percent-encoding the braces, so a URL stays editable as a
   template right up until the moment it is sent.
   ================================================================== */
(function (R) {
  'use strict';

  const U = R.util;
  const VAR = /\{\{\s*([A-Za-z0-9_.\-$]+)\s*\}\}/g;
  const MAX_PASSES = 5;   // lets a variable reference another, without looping forever

  /* --------------------------- resolution ------------------------- */

  /** Enabled vars of an environment as a plain lookup table. */
  function table(env) {
    const map = Object.create(null);
    if (env && Array.isArray(env.vars)) {
      env.vars.forEach(v => { if (v.on && v.k) map[v.k] = v.v == null ? '' : String(v.v); });
    }
    return map;
  }

  /**
   * Substitutes every {{name}} it can. Returns the rewritten text plus
   * the names it could not resolve, so callers can warn instead of
   * silently shipping a literal "{{token}}" to the server.
   */
  function resolve(text, env) {
    const src = text == null ? '' : String(text);
    if (src.indexOf('{{') < 0) return { text: src, missing: [] };

    const map = table(env === undefined ? R.state.activeEnv() : env);
    const missing = [];
    let out = src;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let hit = false;
      out = out.replace(VAR, (whole, name) => {
        if (name in map) { hit = true; return map[name]; }
        if (missing.indexOf(name) < 0) missing.push(name);
        return whole;
      });
      if (!hit || out.indexOf('{{') < 0) break;
    }
    return { text: out, missing: missing };
  }

  /** Resolve a list of {k,v,on} rows, keeping only the enabled ones. */
  function resolveRows(rows, env) {
    const out = [], missing = [];
    (rows || []).forEach(row => {
      if (!row.on || !row.k) return;
      const k = resolve(row.k, env), v = resolve(row.v, env);
      k.missing.concat(v.missing).forEach(m => { if (missing.indexOf(m) < 0) missing.push(m); });
      out.push({ k: k.text, v: v.text });
    });
    return { rows: out, missing: missing };
  }

  /** Marks up {{tokens}} as resolved / unresolved for the URL preview. */
  function markup(text, env) {
    const map = table(env === undefined ? R.state.activeEnv() : env);
    return U.escText(text == null ? '' : String(text)).replace(VAR, (whole, name) => {
      const known = name in map;
      return '<span class="' + (known ? 'var-ok' : 'var-bad') + '" title="' +
             (known ? U.esc(map[name]) : 'not defined in this environment') + '">' + whole + '</span>';
    });
  }

  /** Every variable name referenced anywhere in a request. */
  function used(req) {
    const found = [];
    const eat = s => String(s || '').replace(VAR, (m, n) => { if (found.indexOf(n) < 0) found.push(n); return m; });
    eat(req.url);
    (req.params || []).forEach(p => { eat(p.k); eat(p.v); });
    (req.headers || []).forEach(h => { eat(h.k); eat(h.v); });
    if (req.body) { eat(req.body.raw); eat(req.body.json); (req.body.form || []).forEach(f => { eat(f.k); eat(f.v); }); }
    return found;
  }

  R.env = { resolve, resolveRows, markup, used, table, VAR };

  /* ----------------------------- URLs ----------------------------- */

  /**
   * encodeURIComponent, minus two kinds of over-eagerness: {{tokens}}
   * keep their braces, and the characters that are legal in a query
   * value unescaped (/ : , @) are left readable. Everything that would
   * actually change the parse — & = # + space — is still encoded.
   */
  function encodePart(s) {
    return encodeURIComponent(s == null ? '' : String(s))
      .replace(/%7B%7B/gi, '{{')
      .replace(/%7D%7D/gi, '}}')
      .replace(/%2F/gi, '/')
      .replace(/%3A/gi, ':')
      .replace(/%2C/gi, ',')
      .replace(/%40/gi, '@');
  }

  function decodePart(s) {
    try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); }
    catch (e) { return String(s); }   // malformed %-escapes stay verbatim
  }

  /** 'http://x/y?a=1#f' -> { base:'http://x/y', query:'a=1', hash:'#f' } */
  function split(url) {
    const s = String(url || '');
    const h = s.indexOf('#');
    const hash = h >= 0 ? s.slice(h) : '';
    const rest = h >= 0 ? s.slice(0, h) : s;
    const q = rest.indexOf('?');
    return {
      base: q >= 0 ? rest.slice(0, q) : rest,
      query: q >= 0 ? rest.slice(q + 1) : '',
      hash: hash
    };
  }

  function parseQuery(query) {
    if (!query) return [];
    return query.split('&').filter(Boolean).map(pair => {
      const i = pair.indexOf('=');
      return i < 0
        ? { k: decodePart(pair), v: '', on: true }
        : { k: decodePart(pair.slice(0, i)), v: decodePart(pair.slice(i + 1)), on: true };
    });
  }

  function buildQuery(rows) {
    return (rows || [])
      .filter(r => r.on && (r.k || r.v))
      .map(r => encodePart(r.k) + '=' + encodePart(r.v))
      .join('&');
  }

  /** Rewrites a URL's query section from the params table. */
  function withParams(url, rows) {
    const p = split(url);
    const q = buildQuery(rows);
    return p.base + (q ? '?' + q : '') + p.hash;
  }

  /**
   * Reconciles a hand-typed URL with the params table: enabled rows are
   * replaced by what the URL now says, while rows the user switched off
   * are preserved (they are not in the URL by definition).
   */
  function paramsFromUrl(url, previousRows) {
    const parsed = parseQuery(split(url).query);
    const disabled = (previousRows || []).filter(r => !r.on);
    return parsed.concat(disabled);
  }

  R.url = { encodePart, decodePart, split, parseQuery, buildQuery, withParams, paramsFromUrl };
})(Relay);
