/* ==================================================================
   portability.js — export and import.

   Export writes Relay's own JSON: readable, diffable, and complete
   enough to move a workspace between machines. Import accepts that
   format, a bare request object, and the two Postman shapes people
   most often have lying around (collection v2.x and an environment
   export), so there is a path in from the tool this one imitates.
   ================================================================== */
(function (R) {
  'use strict';

  const U = R.util, S = R.state, el = U.el;

  const FORMAT = 1;

  /* ---------------------------- export ---------------------------- */

  function exportDialog() {
    const data = S.raw();
    const opts = {
      saved: { label: 'Saved requests', count: data.saved.length, on: true },
      envs: { label: 'Environments', count: data.envs.length, on: true },
      history: { label: 'History', count: data.history.length, on: false },
      tabs: { label: 'Open tabs', count: data.tabs.length, on: false },
      settings: { label: 'Settings', count: null, on: false }
    };

    const body = el('div');
    body.appendChild(el('p', { text: 'Choose what to write into the file.' }));
    Object.keys(opts).forEach(key => {
      const o = opts[key];
      const box = el('input', { type: 'checkbox', checked: o.on, onchange: function () { o.on = this.checked; } });
      body.appendChild(el('div.field', {}, [
        el('label.check', {}, [box, el('span', { text: o.label + (o.count != null ? ' (' + o.count + ')' : '') })])
      ]));
    });

    R.ui.modal({
      title: 'Export workspace',
      body: body,
      buttons: [
        { label: 'Cancel', value: null },
        { label: 'Download JSON', value: 'go', primary: true }
      ]
    }).then(answer => {
      if (answer !== 'go') return;
      const picked = {};
      Object.keys(opts).forEach(k => { picked[k] = opts[k].on; });
      download(picked);
    });
  }

  function build(picked) {
    const data = S.raw();
    const out = { relay: FORMAT, exportedAt: new Date().toISOString() };

    if (picked.saved) out.saved = U.clone(data.saved);
    if (picked.envs) out.environments = U.clone(data.envs);
    if (picked.history) out.history = U.clone(data.history);
    if (picked.tabs) out.tabs = data.tabs.map(t => ({ name: t.name, savedId: t.savedId, req: U.clone(t.req) }));
    if (picked.settings) {
      out.settings = U.clone(data.settings);
      delete out.settings.split;      // a pane ratio is not worth carrying between machines
    }
    return out;
  }

  function download(picked) {
    const payload = build(picked);
    const stamp = new Date().toISOString().slice(0, 10);
    U.download('relay-workspace-' + stamp + '.json', JSON.stringify(payload, null, 2), 'application/json');
    R.ui.toast('Workspace exported', 'ok');
  }

  /** Export one request on its own — used from the tab context. */
  function exportRequest(name, req) {
    U.download('relay-' + slug(name) + '.json',
      JSON.stringify({ relay: FORMAT, exportedAt: new Date().toISOString(), saved: [{ name: name, req: req }] }, null, 2),
      'application/json');
  }

  function slug(s) {
    return String(s || 'request').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'request';
  }

  /* ---------------------------- import ---------------------------- */

  function pickFile() { U.qs('#file-import').click(); }

  function onFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => R.ui.toast('Could not read that file', 'err');
    reader.onload = () => {
      const parsed = U.tryParseJSON(reader.result);
      if (!parsed.ok) { R.ui.toast('Not valid JSON: ' + parsed.error, 'err'); return; }
      ingest(parsed.value, file.name);
    };
    reader.readAsText(file);
  }

  /** Work out what we were handed, then confirm before touching anything. */
  function ingest(doc, filename) {
    const parcel = detect(doc);
    if (!parcel) {
      R.ui.toast('Unrecognised file — expected a Relay export, a request, or a Postman collection', 'err');
      return;
    }

    const lines = [];
    if (parcel.saved.length) lines.push(parcel.saved.length + ' request' + (parcel.saved.length > 1 ? 's' : ''));
    if (parcel.envs.length) lines.push(parcel.envs.length + ' environment' + (parcel.envs.length > 1 ? 's' : ''));
    if (parcel.history.length) lines.push(parcel.history.length + ' history entries');

    if (!lines.length) { R.ui.toast('Nothing importable in that file', 'warn'); return; }

    R.ui.modal({
      title: 'Import ' + parcel.kind,
      body: el('div', {}, [
        el('p', { text: filename + ' contains ' + lines.join(', ') + '.' }),
        el('p', { text: 'Merge keeps what you already have. Replace discards the current workspace, including open tabs.' })
      ]),
      buttons: [
        { label: 'Cancel', value: null },
        { label: 'Replace', value: 'replace', danger: true },
        { label: 'Merge', value: 'merge', primary: true }
      ]
    }).then(mode => {
      if (mode === 'merge') merge(parcel);
      else if (mode === 'replace') replace(parcel);
    });
  }

  function detect(doc) {
    if (!doc || typeof doc !== 'object') return null;

    // Relay's own export
    if (doc.relay || doc.saved || doc.environments) {
      return {
        kind: 'workspace',
        saved: (doc.saved || []).map(s => ({ name: s.name || 'Untitled', req: S.normaliseRequest(s.req) })),
        envs: (doc.environments || doc.envs || []).map(e => ({ name: e.name || 'Environment', vars: S.normaliseRows(e.vars) })),
        history: (doc.history || []).map(h => Object.assign({}, h, { req: S.normaliseRequest(h.req) })),
        settings: doc.settings || null
      };
    }

    // Postman collection v2.x
    if (doc.info && Array.isArray(doc.item)) {
      return { kind: 'Postman collection', saved: flattenPostman(doc.item, ''), envs: [], history: [] };
    }

    // Postman environment export
    if (Array.isArray(doc.values) && doc.name) {
      return {
        kind: 'Postman environment',
        saved: [], history: [],
        envs: [{
          name: doc.name,
          vars: doc.values.map(v => ({ k: v.key, v: v.value, on: v.enabled !== false }))
        }]
      };
    }

    // A single bare request
    if (doc.method || doc.url) {
      return { kind: 'request', saved: [{ name: doc.name || 'Imported request', req: S.normaliseRequest(doc) }], envs: [], history: [] };
    }

    return null;
  }

  /* ------------------------ Postman mapping ----------------------- */

  function flattenPostman(items, prefix) {
    const out = [];
    (items || []).forEach(item => {
      if (Array.isArray(item.item)) {
        out.push.apply(out, flattenPostman(item.item, prefix + (item.name || 'folder') + ' / '));
      } else if (item.request) {
        out.push({ name: prefix + (item.name || 'Untitled'), req: fromPostman(item.request) });
      }
    });
    return out;
  }

  function fromPostman(pr) {
    const url = typeof pr.url === 'string' ? pr.url
      : (pr.url && (pr.url.raw || joinPostmanUrl(pr.url))) || '';

    const req = {
      method: pr.method || 'GET',
      url: postmanVars(url),
      params: ((pr.url && pr.url.query) || []).map(q => ({
        k: postmanVars(q.key), v: postmanVars(q.value), on: q.disabled !== true
      })),
      headers: (pr.header || []).map(h => ({
        k: postmanVars(h.key), v: postmanVars(h.value), on: h.disabled !== true
      })),
      body: { mode: 'none', raw: '', json: '', form: [] }
    };

    const b = pr.body;
    if (b && b.mode === 'raw' && b.raw) {
      const isJSON = (b.options && b.options.raw && b.options.raw.language === 'json') || U.tryParseJSON(b.raw).ok;
      req.body.mode = isJSON ? 'json' : 'raw';
      req.body[isJSON ? 'json' : 'raw'] = postmanVars(b.raw);
    } else if (b && b.mode === 'urlencoded') {
      req.body.mode = 'form';
      req.body.form = (b.urlencoded || []).map(f => ({
        k: postmanVars(f.key), v: postmanVars(f.value), on: f.disabled !== true
      }));
    }
    return S.normaliseRequest(req);
  }

  function joinPostmanUrl(u) {
    const host = Array.isArray(u.host) ? u.host.join('.') : (u.host || '');
    const path = Array.isArray(u.path) ? u.path.join('/') : (u.path || '');
    return (u.protocol ? u.protocol + '://' : '') + host + (path ? '/' + path : '');
  }

  /** Postman and Relay happen to share {{var}} syntax — nothing to do. */
  function postmanVars(s) { return s == null ? '' : String(s); }

  /* --------------------------- applying --------------------------- */

  function merge(parcel) {
    parcel.saved.forEach(s => S.saveRequest(s.name, s.req));
    parcel.envs.forEach(e => S.addEnv(e.name, e.vars));
    parcel.history.slice().reverse().forEach(h => S.pushHistory({
      method: h.method, url: h.url, status: h.status, ok: h.ok,
      time: h.time, size: h.size, error: h.error || null, req: h.req
    }));
    R.ui.toast('Imported into the current workspace', 'ok');
  }

  function replace(parcel) {
    const settings = Object.assign(S.defaults(), parcel.settings || {}, { split: S.settings().split, theme: S.settings().theme });
    const envs = parcel.envs.map(e => ({ id: U.uid('env'), name: e.name, vars: e.vars }));
    const saved = parcel.saved.map(s => ({ id: U.uid('sv'), name: s.name, req: s.req }));
    const first = saved.length ? U.clone(saved[0].req) : S.blankRequest();
    const tab = {
      id: U.uid('tab'), name: saved.length ? saved[0].name : null,
      savedId: saved.length ? saved[0].id : null,
      dirty: false, req: first, res: null, sending: false
    };

    S.replaceAll({
      format: FORMAT,
      tabs: [tab],
      activeTabId: tab.id,
      saved: saved,
      history: parcel.history.map(h => Object.assign({ id: U.uid('h'), ts: h.ts || Date.now() }, h)),
      envs: envs,
      activeEnvId: envs.length ? envs[0].id : null,
      settings: settings
    });
    R.ui.toast('Workspace replaced', 'ok');
  }

  R.portability = { exportDialog, exportRequest, pickFile, onFile, ingest, build };
})(Relay);
