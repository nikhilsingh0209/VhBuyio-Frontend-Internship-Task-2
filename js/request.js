/* ==================================================================
   request.js — the request editor: tab strip, URL bar, params,
   headers, body, and the send/cancel cycle.

   The interesting part is the two-way binding between the URL text
   and the params table. Editing either one rewrites the other, and
   both routes go through env.js so `{{tokens}}` survive encoding.
   Disabled rows are kept out of the URL but never thrown away.
   ================================================================== */
(function (R) {
  'use strict';

  const U = R.util, S = R.state, el = U.el;

  const els = {};
  const editors = {};
  const inflight = new Map();     // tabId -> AbortController

  /* ----------------------------- boot ----------------------------- */

  function init() {
    [
      'tabstrip', 'btn-newtab', 'method-select', 'url-input', 'url-preview',
      'btn-send', 'btn-save', 'btn-copy-curl', 'req-subtabs',
      'params-host', 'headers-host', 'form-host',
      'body-modes', 'body-json', 'body-raw', 'json-status', 'btn-format-json',
      'count-params', 'count-headers', 'count-body'
    ].forEach(id => { els[id] = U.qs('#' + id); });

    els.bodyWarn = el('span.json-status.err');
    U.qs('.body-modes-right').insertBefore(els.bodyWarn, els['json-status']);

    mountEditors();
    wire();

    S.on('tabs', () => { renderTabstrip(); renderRequest(); });
    S.on('req', e => { if (!e || !e.silent) renderRequest(); renderTabstrip(); });
    S.on('res', () => renderSendButton());
    S.on('env', () => renderUrlPreview());
    S.on('saved', () => renderTabstrip());

    renderTabstrip();
    renderRequest();
  }

  /* --------------------------- editors ---------------------------- */

  function mountEditors() {
    editors.params = R.KV.mount(els['params-host'], {
      keyPlaceholder: 'Parameter', valuePlaceholder: 'Value',
      hint: 'Query parameters are written straight into the URL.',
      onChange: rows => {
        S.editRequest(req => {
          req.params = rows;
          req.url = R.url.withParams(req.url, rows);
        }, true);
        els['url-input'].value = S.activeTab().req.url;
        renderUrlPreview();
        updateCounts();
      }
    });

    editors.headers = R.KV.mount(els['headers-host'], {
      keyPlaceholder: 'Header', valuePlaceholder: 'Value',
      hint: 'Content-Type is added automatically when a body needs one.',
      onChange: rows => {
        S.editRequest(req => { req.headers = rows; }, true);
        updateCounts();
      }
    });

    editors.form = R.KV.mount(els['form-host'], {
      keyPlaceholder: 'Field', valuePlaceholder: 'Value',
      hint: 'Sent as application/x-www-form-urlencoded.',
      onChange: rows => {
        S.editRequest(req => { req.body.form = rows; }, true);
        updateCounts();
      }
    });
  }

  /* ---------------------------- wiring ---------------------------- */

  function wire() {
    els['btn-newtab'].addEventListener('click', () => S.openTab());

    els['method-select'].addEventListener('change', function () {
      S.editRequest(req => { req.method = this.value; }, true);
      renderTabstrip();
      updateBodyAvailability();
    });

    els['url-input'].addEventListener('input', function () {
      const value = this.value;
      S.editRequest(req => {
        req.url = value;
        req.params = R.url.paramsFromUrl(value, req.params);
      }, true);
      editors.params.set(S.activeTab().req.params);
      renderUrlPreview();
      updateCounts();
    });

    els['url-input'].addEventListener('focus', renderUrlPreview);
    els['url-input'].addEventListener('blur', () => setTimeout(() => { els['url-preview'].hidden = true; }, 120));
    els['url-input'].addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); sendActive(); }
    });

    els['btn-send'].addEventListener('click', sendActive);
    els['btn-save'].addEventListener('click', saveActive);
    els['btn-copy-curl'].addEventListener('click', copyCurl);

    // Request sub-tabs
    els['req-subtabs'].addEventListener('click', e => {
      const btn = e.target.closest('[data-reqtab]');
      if (btn) showReqTab(btn.dataset.reqtab);
    });

    // Body mode
    els['body-modes'].addEventListener('change', e => {
      if (e.target.name !== 'bodymode') return;
      const mode = e.target.value;
      S.editRequest(req => { req.body.mode = mode; }, true);
      showBodyEditor(mode);
      updateCounts();
    });

    els['body-json'].addEventListener('input', function () {
      const value = this.value;
      S.editRequest(req => { req.body.json = value; }, true);
      validateJSON();
      updateCounts();
    });

    els['body-raw'].addEventListener('input', function () {
      const value = this.value;
      S.editRequest(req => { req.body.raw = value; }, true);
      updateCounts();
    });

    els['btn-format-json'].addEventListener('click', () => {
      const text = els['body-json'].value;
      const parsed = U.tryParseJSON(text);
      if (!parsed.ok) { R.ui.toast('Cannot format: ' + parsed.error, 'err'); return; }
      const pretty = U.prettyJSON(parsed.value);
      els['body-json'].value = pretty;
      S.editRequest(req => { req.body.json = pretty; }, true);
      validateJSON();
    });

    // Tab strip clicks (select / close)
    els.tabstrip.addEventListener('click', e => {
      const close = e.target.closest('.close');
      const tab = e.target.closest('.rtab');
      if (!tab) return;
      if (close) { e.stopPropagation(); closeTab(tab.dataset.id); }
      else S.selectTab(tab.dataset.id);
    });

    // Middle-click closes, like a browser
    els.tabstrip.addEventListener('auxclick', e => {
      if (e.button !== 1) return;
      const tab = e.target.closest('.rtab');
      if (tab) { e.preventDefault(); closeTab(tab.dataset.id); }
    });
  }

  /* ---------------------------- render ---------------------------- */

  function renderTabstrip() {
    const active = S.activeTab();
    U.clear(els.tabstrip);
    S.tabs().forEach(tab => {
      const node = el('button.rtab' + (tab.id === active.id ? '.is-active' : ''), {
        'data-id': tab.id, role: 'tab', title: tab.req.url || S.label(tab)
      }, [
        el('span.verb.m-' + tab.req.method, { text: tab.req.method }),
        el('span.name', { text: S.label(tab) }),
        tab.dirty ? el('span.dot', { title: 'Unsaved changes' }) : null,
        el('span.close', { html: '&times;', title: 'Close tab', role: 'button' })
      ]);
      els.tabstrip.appendChild(node);
    });
    const activeNode = els.tabstrip.querySelector('.is-active');
    if (activeNode && activeNode.scrollIntoView) activeNode.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderRequest() {
    const tab = S.activeTab(), req = tab.req;

    els['method-select'].value = req.method;
    els['method-select'].className = 'select method m-' + req.method;
    els['url-input'].value = req.url;

    editors.params.set(req.params);
    editors.headers.set(req.headers);
    editors.form.set(req.body.form);

    U.qsa('input[name="bodymode"]').forEach(r => { r.checked = r.value === req.body.mode; });
    els['body-json'].value = req.body.json;
    els['body-raw'].value = req.body.raw;

    showBodyEditor(req.body.mode);
    validateJSON();
    updateBodyAvailability();
    updateCounts();
    renderUrlPreview();
    renderSendButton();
  }

  function renderSendButton() {
    const tab = S.activeTab();
    els['btn-send'].textContent = tab.sending ? 'Cancel' : 'Send';
    els['btn-send'].classList.toggle('sending', !!tab.sending);
  }

  function renderUrlPreview() {
    const req = S.activeTab().req;
    const full = (req.params && req.params.length) ? R.url.withParams(req.url, req.params) : req.url;
    const focused = document.activeElement === els['url-input'];

    if (!full || full.indexOf('{{') < 0 || !focused) {
      els['url-preview'].hidden = true;
      return;
    }
    els['url-preview'].innerHTML =
      '<span class="lbl">sends to</span>' + R.env.markup(full);
    els['url-preview'].hidden = false;
  }

  function updateCounts() {
    const req = S.activeTab().req;
    const on = rows => (rows || []).filter(r => r.on && (r.k || r.v)).length;

    els['count-params'].textContent = on(req.params) ? '(' + on(req.params) + ')' : '';
    els['count-headers'].textContent = on(req.headers) ? '(' + on(req.headers) + ')' : '';

    const b = req.body;
    let badge = '';
    if (b.mode === 'form') badge = on(b.form) ? '(' + on(b.form) + ')' : '';
    else if (b.mode === 'json' || b.mode === 'raw') {
      const len = (b.mode === 'json' ? b.json : b.raw).length;
      badge = len ? '(' + U.fmtBytes(len) + ')' : '';
    }
    els['count-body'].textContent = badge;
  }

  function updateBodyAvailability() {
    const req = S.activeTab().req;
    const bodyless = !!S.BODYLESS[req.method] && req.body.mode !== 'none';
    els.bodyWarn.textContent = bodyless ? req.method + ' sends no body' : '';
  }

  function validateJSON() {
    const req = S.activeTab().req;
    const node = els['json-status'];
    els['btn-format-json'].hidden = req.body.mode !== 'json';
    if (req.body.mode !== 'json') { node.textContent = ''; node.className = 'json-status'; return; }

    const check = R.http.checkJSON(req.body.json);
    if (check.state === 'empty') { node.textContent = ''; node.className = 'json-status'; }
    else if (check.state === 'valid') { node.textContent = 'valid JSON'; node.className = 'json-status ok'; }
    else if (check.state === 'valid-with-vars') { node.textContent = 'valid once variables resolve'; node.className = 'json-status ok'; }
    else { node.textContent = check.error; node.className = 'json-status err'; }
  }

  function showReqTab(name) {
    U.qsa('[data-reqtab]').forEach(b => b.classList.toggle('is-active', b.dataset.reqtab === name));
    U.qsa('.reqtab').forEach(p => p.classList.toggle('is-active', p.id === 'reqtab-' + name));
  }

  function showBodyEditor(mode) {
    const map = { none: 'body-none', json: 'body-json-wrap', raw: 'body-raw-wrap', form: 'body-form-wrap' };
    U.qsa('.body-editor').forEach(node => node.classList.toggle('is-active', node.id === map[mode]));
    validateJSON();
    updateBodyAvailability();
  }

  /* ---------------------------- actions --------------------------- */

  function closeTab(id) {
    const ctrl = inflight.get(id);
    if (ctrl) { ctrl.abort(); inflight.delete(id); }
    S.closeTab(id);
  }

  function sendActive() {
    const tab = S.activeTab();

    if (tab.sending) {                      // second click cancels
      const ctrl = inflight.get(tab.id);
      if (ctrl) ctrl.abort();
      return;
    }
    if (!tab.req.url.trim()) { R.ui.toast('Enter a URL first', 'warn'); els['url-input'].focus(); return; }

    const tabId = tab.id;
    S.setSending(tabId, true);
    R.response.pending(tabId);

    R.http.send(tab.req, {
      onStart: ctrl => inflight.set(tabId, ctrl)
    }).then(res => {
      inflight.delete(tabId);
      S.setSending(tabId, false);
      S.setResponse(tabId, res);

      S.pushHistory({
        method: res.sent.method,
        url: res.sent.url,
        status: res.status,
        ok: res.ok,
        time: res.time,
        size: res.size,
        error: res.error ? res.error.kind : null,
        req: U.clone(S.tabById(tabId) ? S.tabById(tabId).req : tab.req)
      });

      if (res.error && res.error.kind !== 'aborted') R.ui.toast(res.error.message, 'err');
      if (res.sent.warnings.length) res.sent.warnings.forEach(w => R.ui.toast(w, 'warn'));
      if (res.sent.missing.length) {
        R.ui.toast('Unresolved variable' + (res.sent.missing.length > 1 ? 's' : '') + ': ' +
                   res.sent.missing.join(', '), 'warn');
      }
    });
  }

  function saveActive() {
    const tab = S.activeTab();
    const existing = tab.savedId ? S.saved().find(s => s.id === tab.savedId) : null;

    if (existing) {
      S.saveRequest(existing.name, tab.req, existing.id);
      tab.dirty = false;
      S.emit('tabs');
      R.ui.toast('Saved "' + existing.name + '"', 'ok');
      return;
    }

    R.ui.prompt({
      title: 'Save request',
      label: 'Name',
      value: S.label(tab),
      confirmLabel: 'Save'
    }).then(name => {
      if (!name) return;
      const rec = S.saveRequest(name, tab.req);
      tab.savedId = rec.id;
      tab.name = name;
      tab.dirty = false;
      S.emit('tabs');
      R.ui.toast('Saved "' + name + '"', 'ok');
    });
  }

  function copyCurl() {
    const built = R.http.build(S.activeTab().req);
    U.copy(R.http.toCurl(built)).then(ok => {
      R.ui.toast(ok ? 'cURL command copied' : 'Could not reach the clipboard', ok ? 'ok' : 'err');
    });
  }

  /**
   * Bring a request's URL and its params table into agreement. The
   * table wins when it has rows (that is how saved and imported
   * requests carry their query), otherwise the URL is parsed into it.
   */
  function reconcile(req) {
    if (req.params && req.params.length) req.url = R.url.withParams(req.url, req.params);
    else req.params = R.url.paramsFromUrl(req.url, req.params);
    return req;
  }

  /** Load a request into the active tab (history replay / saved click). */
  function load(req, opts) {
    opts = opts || {};
    const tab = S.activeTab();
    const empty = !tab.req.url && !tab.savedId && !tab.res;
    const fresh = reconcile(S.normaliseRequest(req));

    if (empty || opts.reuse) {
      tab.req = fresh;
      tab.savedId = opts.savedId || null;
      tab.name = opts.name || null;
      tab.dirty = false;
      tab.res = null;
      S.emit('tabs');
    } else {
      S.openTab(fresh, { name: opts.name, savedId: opts.savedId });
    }
  }

  R.request = {
    init, load, reconcile,
    send: sendActive, save: saveActive, showReqTab,
    focusUrl: () => els['url-input'].select()
  };
})(Relay);
