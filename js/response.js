/* ==================================================================
   response.js — the response inspector.

   Renders one of four states: empty, in-flight, a transport failure
   (with a diagnosis, because "Failed to fetch" on its own teaches
   nobody anything), or a real response with its status, timing, size,
   headers and a highlighted body.
   ================================================================== */
(function (R) {
  'use strict';

  const U = R.util, S = R.state, el = U.el;

  const HIGHLIGHT_LIMIT = 300000;   // characters; past this, colouring costs more than it gives
  const els = {};
  let view = 'pretty';

  /* ----------------------------- boot ----------------------------- */

  function init() {
    [
      'res-subtabs', 'res-meta', 'res-status', 'res-time', 'res-size',
      'res-toolbar', 'res-body', 'res-headers', 'res-request', 'res-ctype',
      'count-res-headers', 'chk-wrap', 'btn-copy-res', 'btn-save-res'
    ].forEach(id => { els[id] = U.qs('#' + id); });

    els['res-subtabs'].addEventListener('click', e => {
      const btn = e.target.closest('[data-restab]');
      if (btn) showResTab(btn.dataset.restab);
    });

    els['res-toolbar'].addEventListener('click', e => {
      const btn = e.target.closest('[data-resview]');
      if (!btn) return;
      view = btn.dataset.resview;
      U.qsa('[data-resview]').forEach(b => b.classList.toggle('is-active', b === btn));
      render();
    });

    els['chk-wrap'].checked = !!S.settings().wrap;
    els['chk-wrap'].addEventListener('change', function () {
      S.setSetting('wrap', this.checked);
      U.qsa('.res-pre').forEach(p => p.classList.toggle('wrap', this.checked));
    });

    els['btn-copy-res'].addEventListener('click', () => {
      const res = current();
      if (!res) return;
      U.copy(res.text).then(ok => R.ui.toast(ok ? 'Response copied' : 'Could not reach the clipboard', ok ? 'ok' : 'err'));
    });

    els['btn-save-res'].addEventListener('click', () => {
      const res = current();
      if (!res) return;
      const ext = U.looksJSON(res.contentType) ? 'json' : U.looksHTML(res.contentType) ? 'html' : 'txt';
      U.download('response-' + new Date(res.at).toISOString().replace(/[:.]/g, '-') + '.' + ext,
                 res.text, res.contentType || 'text/plain');
    });

    S.on('res', render);
    S.on('tabs', render);
    render();
  }

  function current() { const t = S.activeTab(); return t && t.res; }

  function showResTab(name) {
    U.qsa('[data-restab]').forEach(b => b.classList.toggle('is-active', b.dataset.restab === name));
    U.qsa('.restab').forEach(p => p.classList.toggle('is-active', p.id === 'restab-' + name));
  }

  /* --------------------------- lifecycle -------------------------- */

  function pending(tabId) {
    const tab = S.activeTab();
    if (!tab || tab.id !== tabId) return;
    els['res-meta'].hidden = true;
    els['res-toolbar'].hidden = true;
    U.clear(els['res-body']);
    els['res-body'].appendChild(el('div.res-empty', {}, [
      el('div.spinner'),
      el('p', { text: 'Waiting for the server…' })
    ]));
    showResTab('body');
  }

  /* ---------------------------- render ---------------------------- */

  function render() {
    const tab = S.activeTab();
    const res = tab && tab.res;

    if (tab && tab.sending) { pending(tab.id); return; }

    if (!res) {
      els['res-meta'].hidden = true;
      els['res-toolbar'].hidden = true;
      els['count-res-headers'].textContent = '';
      U.clear(els['res-headers']);
      U.clear(els['res-request']);
      U.clear(els['res-body']);
      els['res-body'].appendChild(emptyState());
      return;
    }

    renderMeta(res);
    renderBody(res);
    renderHeaders(res);
    renderSent(res);
  }

  function emptyState() {
    return el('div.res-empty', {}, [
      el('div.big', { text: '⇄' }),
      el('p', {
        html: 'No response yet. Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> or hit <b>Send</b>.<br>' +
              'Try <code>https://jsonplaceholder.typicode.com/posts/1</code> — it allows cross-origin calls.'
      })
    ]);
  }

  function renderMeta(res) {
    const meta = els['res-meta'];
    meta.hidden = false;

    const badge = els['res-status'];
    if (res.error) {
      badge.className = 'status-badge s-x';
      badge.textContent = res.error.kind === 'aborted' ? 'Cancelled'
        : res.error.kind === 'timeout' ? 'Timed out' : 'Failed';
    } else {
      badge.className = 'status-badge s-' + U.statusClass(res.status);
      badge.textContent = res.status + (res.statusText ? ' ' + res.statusText : '');
    }

    els['res-time'].textContent = U.fmtMs(res.time);
    els['res-time'].className = 'meta-chip' + (res.time > 1500 ? ' slow' : '');
    els['res-size'].textContent = U.fmtBytes(res.size);
    els['res-size'].hidden = !!res.error;
  }

  function renderBody(res) {
    const host = els['res-body'];
    U.clear(host);

    if (res.error) {
      els['res-toolbar'].hidden = true;
      host.appendChild(diagnose(res));
      return;
    }

    els['res-toolbar'].hidden = false;
    els['res-ctype'].textContent = U.baseType(res.contentType) || 'unknown type';

    if (!res.text.length) {
      host.appendChild(el('div.res-empty', {}, [
        el('p', { text: 'Empty body — ' + res.status + ' ' + (res.statusText || '') + ' with no content.' })
      ]));
      return;
    }

    if (view === 'preview') { host.appendChild(preview(res)); return; }

    const pre = el('pre.res-pre' + (S.settings().wrap ? '.wrap' : ''));

    if (view === 'raw') {
      pre.textContent = res.text;
    } else if (res.json !== undefined && res.text.length <= HIGHLIGHT_LIMIT) {
      pre.innerHTML = U.highlightJSON(U.prettyJSON(res.json));
    } else if (res.json !== undefined) {
      pre.textContent = U.prettyJSON(res.json);
      host.appendChild(el('div.kv-foot', { text: 'Body over ' + U.fmtBytes(HIGHLIGHT_LIMIT) + ' — syntax colouring skipped to keep scrolling smooth.' }));
    } else {
      pre.textContent = res.text;
    }

    host.insertBefore(pre, host.firstChild);
  }

  function preview(res) {
    if (U.looksHTML(res.contentType)) {
      // Sandboxed with no allow-* tokens: the document renders, scripts
      // and forms inside it do not run.
      return el('iframe.preview-frame', { sandbox: '', srcdoc: res.text, title: 'Response preview' });
    }
    if (U.looksImage(res.contentType)) {
      return el('div', {}, [
        el('img.preview-img', { src: res.finalUrl, alt: 'Response image' }),
        el('div.kv-foot', { text: 'Images are re-fetched by the browser for display; the body above is the decoded text form.' })
      ]);
    }
    const pre = el('pre.res-pre' + (S.settings().wrap ? '.wrap' : ''));
    if (res.json !== undefined) pre.innerHTML = U.highlightJSON(U.prettyJSON(res.json));
    else pre.textContent = res.text;
    return pre;
  }

  function renderHeaders(res) {
    const host = els['res-headers'];
    U.clear(host);
    els['count-res-headers'].textContent = res.headers.length ? '(' + res.headers.length + ')' : '';

    if (!res.headers.length) {
      host.appendChild(el('div.res-empty', {}, [
        el('p', {
          html: res.error ? 'No headers — the request never completed.'
            : 'No readable headers. A cross-origin response only exposes the ' +
              '<a href="https://developer.mozilla.org/docs/Glossary/CORS-safelisted_response_header" target="_blank" rel="noopener">safelisted</a> ' +
              'ones unless the server sends <code>Access-Control-Expose-Headers</code>.'
        })
      ]));
      return;
    }
    host.appendChild(table(res.headers));
  }

  function table(rows, keyLabel) {
    return el('table.hdr-table', {}, [
      el('thead', {}, [el('tr', {}, [el('th', { text: keyLabel || 'Header' }), el('th', { text: 'Value' })])]),
      el('tbody', {}, rows.map(h => el('tr', {}, [
        el('td.k', { text: h.k }), el('td.v', { text: h.v })
      ])))
    ]);
  }

  function renderSent(res) {
    const host = els['res-request'];
    const sent = res.sent;
    U.clear(host);
    if (!sent) return;

    const rows = [{ k: 'Method', v: sent.method }, { k: 'URL', v: sent.url }];
    if (res.finalUrl && res.finalUrl !== sent.url) rows.push({ k: 'Final URL', v: res.finalUrl });
    if (res.redirected) rows.push({ k: 'Redirected', v: 'yes' });
    if (res.proxied) rows.push({ k: 'Via proxy', v: S.settings().proxy });
    if (res.latency != null) rows.push({ k: 'Headers after', v: U.fmtMs(res.latency) });
    if (res.time != null) rows.push({ k: 'Body complete', v: U.fmtMs(res.time) });
    if (sent.missing.length) rows.push({ k: 'Unresolved', v: sent.missing.map(m => '{{' + m + '}}').join(' ') });

    host.appendChild(table(rows, 'Field'));

    if (sent.headers.length) {
      host.appendChild(el('div.kv-foot', { text: 'Request headers' }));
      host.appendChild(table(sent.headers.map(h => ({
        k: h.k + (h.implicit ? ' (added)' : ''), v: h.v
      }))));
    }

    if (sent.body != null && sent.body !== '') {
      host.appendChild(el('div.kv-foot', { text: 'Request body (' + U.fmtBytes(U.byteLen(sent.body)) + ')' }));
      host.appendChild(el('pre.res-pre.wrap', { text: sent.body }));
    }

    sent.warnings.forEach(w => host.appendChild(el('div.kv-foot', { text: '⚠ ' + w })));

    host.appendChild(el('div.kv-foot', {}, [
      el('button.btn.btn-sm.ghost', {
        text: 'Copy as cURL',
        onclick: () => U.copy(R.http.toCurl(sent)).then(ok => R.ui.toast(ok ? 'cURL command copied' : 'Clipboard unavailable', ok ? 'ok' : 'err'))
      })
    ]));
  }

  /* -------------------------- diagnostics ------------------------- */

  function diagnose(res) {
    const e = res.error;

    if (e.kind === 'network') {
      const node = el('div.diag', {}, [
        el('h3', { text: 'Could not reach ' + hostOf(e.url) }),
        el('p', {
          html: '<code>' + U.esc(e.message) + '</code> — the browser stopped this before any response reached the page. ' +
                'From inside a tab there is no way to tell a blocked cross-origin reply from a host that never answered, ' +
                'so both look like this.'
        }),
        el('p', { text: 'Usual causes, most likely first:' }),
        el('ul', {}, [
          el('li', { html: 'The server did not return an <code>Access-Control-Allow-Origin</code> header that covers this page. Its response may have arrived perfectly well and still been discarded — check the Network tab of devtools.' }),
          el('li', { html: 'A non-simple request (custom headers, <code>PUT</code>/<code>PATCH</code>/<code>DELETE</code>, a JSON content type) needs a preflight <code>OPTIONS</code> the server did not answer.' }),
          el('li', { text: 'The host is unreachable, the DNS name is wrong, or the certificate is rejected.' }),
          el('li', { html: 'A page served over <code>https://</code> cannot call an <code>http://</code> endpoint — mixed content is blocked outright.' })
        ]),
        el('p', { text: 'Ways round it:' }),
        el('ul', {}, [
          el('li', { html: 'Test against an API that opts in to cross-origin calls — <code>jsonplaceholder.typicode.com</code>, <code>reqres.in</code>, <code>httpbin.org</code>.' }),
          el('li', { text: 'Add your origin to the API’s allowed list, if it is yours to configure.' }),
          el('li', { text: 'Run a small CORS proxy and point Relay at it below — the request then leaves from a server, where the same-origin rule does not apply.' }),
          el('li', { text: 'A browser extension that relaxes CORS works for local poking about; leave it off for ordinary browsing.' })
        ])
      ]);

      node.appendChild(el('div', { style: 'display:flex;gap:8px;margin-top:10px' }, [
        el('button.btn.btn-sm', { text: 'Proxy settings', onclick: () => R.app.openSettings() }),
        el('button.btn.btn-sm', {
          text: 'Copy as cURL',
          onclick: () => U.copy(R.http.toCurl(res.sent)).then(ok =>
            R.ui.toast(ok ? 'Copied — run it in a terminal, where CORS does not apply' : 'Clipboard unavailable', ok ? 'ok' : 'err'))
        })
      ]));
      return node;
    }

    if (e.kind === 'timeout') {
      return el('div.diag', {}, [
        el('h3', { text: 'Timed out' }),
        el('p', { text: e.detail }),
        el('button.btn.btn-sm', { text: 'Settings', onclick: () => R.app.openSettings() })
      ]);
    }

    if (e.kind === 'aborted') {
      return el('div.diag', {}, [
        el('h3', { text: 'Cancelled' }),
        el('p', { text: 'You stopped this request before it finished.' })
      ]);
    }

    return el('div.diag', {}, [
      el('h3', { text: 'Request failed' }),
      el('p', { text: e.message })
    ]);
  }

  function hostOf(url) {
    try { return new URL(url).host; }
    catch (e) { return url || 'the server'; }
  }

  R.response = { init, render, pending, showResTab };
})(Relay);
