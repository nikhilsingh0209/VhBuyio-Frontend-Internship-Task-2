/* ==================================================================
   http.js — request assembly and execution.

   build()  turns the editor's model into exactly what fetch() will be
            given, after {{variable}} substitution. Nothing else in the
            app is allowed to guess at the final shape — the "Sent" tab
            renders this same object, so what you inspect is what went
            out.

   send()   runs it with timing, an abort signal, a timeout, and error
            classification that tells a CORS wall apart from a dead
            host — the single most common confusion when testing APIs
            from inside a browser tab.
   ================================================================== */
(function (R) {
  'use strict';

  const U = R.util;

  /** Headers the browser refuses to let a page set; it drops them
   *  silently, so we say so rather than let you chase a ghost. */
  const FORBIDDEN = /^(accept-(charset|encoding)|access-control-request-(headers|method)|connection|content-length|cookie2?|date|dnt|expect|host|keep-alive|origin|referer|set-cookie2?|te|trailer|transfer-encoding|upgrade|via|proxy-.*|sec-.*)$/i;

  const DEFAULT_CT = {
    json: 'application/json',
    raw: 'text/plain;charset=UTF-8',
    form: 'application/x-www-form-urlencoded;charset=UTF-8'
  };

  /* ---------------------------- build ----------------------------- */

  function normaliseUrl(url) {
    const u = String(url || '').trim();
    if (!u) return u;
    // A bare "api.example.com/x" is a host, not a relative path — and a
    // relative path is meaningless for a page served from file://.
    if (!/^[a-z][a-z0-9+.\-]*:\/\//i.test(u) && !/^\//.test(u)) return 'https://' + u;
    return u;
  }

  function build(req, env) {
    const warnings = [], missing = [];
    const note = list => list.forEach(m => { if (missing.indexOf(m) < 0) missing.push(m); });

    // Params are kept in sync with the URL as you type, so the table is
    // authoritative whenever it holds anything at all.
    const templated = (req.params && req.params.length)
      ? R.url.withParams(req.url, req.params)
      : req.url;

    const urlRes = R.env.resolve(templated, env);
    note(urlRes.missing);
    const url = normaliseUrl(urlRes.text);

    const hdrRes = R.env.resolveRows(req.headers, env);
    note(hdrRes.missing);
    const headers = hdrRes.rows.filter(h => h.k);
    headers.forEach(h => {
      if (FORBIDDEN.test(h.k)) {
        warnings.push('The browser will drop "' + h.k + '" — it is a forbidden header name.');
      }
    });

    const method = String(req.method || 'GET').toUpperCase();
    const body = buildBody(req, method, env, note, warnings);

    // Only default the content type when the user has not set one.
    if (body != null && body.contentType && !headers.some(h => h.k.toLowerCase() === 'content-type')) {
      headers.push({ k: 'Content-Type', v: body.contentType, implicit: true });
    }

    return {
      method: method,
      url: url,
      rawUrl: templated,
      headers: headers,
      body: body ? body.text : undefined,
      bodyMode: req.body ? req.body.mode : 'none',
      missing: missing,
      warnings: warnings
    };
  }

  function buildBody(req, method, env, note, warnings) {
    const b = req.body || { mode: 'none' };
    if (b.mode === 'none') return null;

    if (R.state.BODYLESS[method]) {
      warnings.push(method + ' requests cannot carry a body — it was not sent.');
      return null;
    }

    if (b.mode === 'form') {
      const res = R.env.resolveRows(b.form, env);
      note(res.missing);
      const parts = res.rows
        .filter(r => r.k)
        .map(r => encodeURIComponent(r.k) + '=' + encodeURIComponent(r.v));
      return { text: parts.join('&'), contentType: DEFAULT_CT.form };
    }

    const source = b.mode === 'json' ? b.json : b.raw;
    if (!String(source || '').length) return null;
    const res = R.env.resolve(source, env);
    note(res.missing);
    return { text: res.text, contentType: DEFAULT_CT[b.mode] };
  }

  /* -------------------------- validation -------------------------- */

  /**
   * JSON bodies are checked against the text as written and, if that
   * fails, against the text with {{vars}} stubbed out — an unquoted
   * placeholder is not valid JSON but is perfectly valid *input*.
   */
  function checkJSON(text) {
    if (!String(text || '').trim()) return { state: 'empty' };
    const direct = U.tryParseJSON(text);
    if (direct.ok) return { state: 'valid' };
    if (text.indexOf('{{') >= 0) {
      const stubbed = String(text).replace(R.env.VAR, '0');
      if (U.tryParseJSON(stubbed).ok) return { state: 'valid-with-vars' };
    }
    return { state: 'invalid', error: direct.error };
  }

  /* ----------------------------- send ----------------------------- */

  function applyProxy(url, settings) {
    if (!settings.proxyOn || !settings.proxy) return url;
    const p = settings.proxy;
    return p.indexOf('{url}') >= 0
      ? p.replace('{url}', encodeURIComponent(url))
      : p + encodeURIComponent(url);
  }

  /**
   * Returns a response record — it never rejects. Transport failures
   * come back as `error` so the inspector can render them like any
   * other outcome.
   */
  function send(req, opts) {
    opts = opts || {};
    const settings = R.state.settings();
    const built = build(req, opts.env);
    const controller = new AbortController();
    const timeout = opts.timeout || settings.timeout || 30000;

    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    if (opts.onStart) opts.onStart(controller, built);

    const headers = new Headers();
    built.headers.forEach(h => { try { headers.append(h.k, h.v); } catch (e) { /* dropped by the browser */ } });

    const target = applyProxy(built.url, settings);
    const started = performance.now();
    let latency = null;

    if (!built.url) {
      clearTimeout(timer);
      return Promise.resolve(fail(built, { kind: 'url', message: 'No URL — type one first.' }, 0));
    }

    return fetch(target, {
      method: built.method,
      headers: headers,
      body: built.body,
      mode: 'cors',
      credentials: settings.credentials ? 'include' : 'same-origin',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal
    }).then(response => {
      latency = Math.round(performance.now() - started);
      return response.text().then(text => ({ response: response, text: text }));
    }).then(pair => {
      clearTimeout(timer);
      const time = Math.round(performance.now() - started);
      const response = pair.response, text = pair.text;

      const headerRows = [];
      response.headers.forEach((v, k) => headerRows.push({ k: k, v: v }));
      headerRows.sort((a, b) => a.k.localeCompare(b.k));

      const contentType = response.headers.get('content-type') || '';
      const parsed = U.tryParseJSON(text);

      return {
        at: Date.now(),
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        time: time,
        latency: latency,
        size: U.byteLen(text),
        headers: headerRows,
        contentType: contentType,
        text: text,
        json: parsed.ok ? parsed.value : undefined,
        isJSON: parsed.ok && (U.looksJSON(contentType) || typeof parsed.value === 'object'),
        redirected: response.redirected,
        finalUrl: response.url || built.url,
        type: response.type,
        sent: built,
        proxied: target !== built.url,
        error: null
      };
    }).catch(err => {
      clearTimeout(timer);
      const time = Math.round(performance.now() - started);
      return fail(built, classify(err, timedOut, built, target !== built.url), time);
    });
  }

  function fail(built, error, time) {
    return {
      at: Date.now(), ok: false, status: 0, statusText: '', time: time,
      latency: null, size: 0, headers: [], contentType: '', text: '',
      json: undefined, isJSON: false, sent: built, error: error
    };
  }

  /* ------------------------ error taxonomy ------------------------ */

  function classify(err, timedOut, built, proxied) {
    if (timedOut) {
      return { kind: 'timeout', message: 'The request timed out.',
               detail: 'No response within the configured timeout. Raise it in Settings if the endpoint is simply slow.' };
    }
    if (err && (err.name === 'AbortError' || err.code === 20)) {
      return { kind: 'aborted', message: 'Request cancelled.' };
    }
    if (err instanceof TypeError || (err && /fetch/i.test(err.message || ''))) {
      return {
        kind: 'network',
        message: err.message || 'Failed to fetch',
        cors: true,
        detail: 'The browser blocked the response, or it never arrived.',
        url: built.url,
        proxied: proxied
      };
    }
    return { kind: 'unknown', message: (err && err.message) || String(err) };
  }

  /* ----------------------------- cURL ----------------------------- */

  function shellQuote(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
  }

  function toCurl(built) {
    const lines = ['curl -X ' + built.method + ' ' + shellQuote(built.url)];
    built.headers.forEach(h => lines.push('  -H ' + shellQuote(h.k + ': ' + h.v)));
    if (built.body != null && built.body !== '') lines.push('  --data-raw ' + shellQuote(built.body));
    return lines.join(' \\\n');
  }

  R.http = { build, send, toCurl, checkJSON, normaliseUrl, FORBIDDEN };
})(Relay);
