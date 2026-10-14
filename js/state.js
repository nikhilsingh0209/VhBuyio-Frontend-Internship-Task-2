/* ==================================================================
   state.js — the single source of truth.

   One plain object holds the whole workspace: open tabs, saved
   requests, history, environments and settings. Modules never poke
   each other; they mutate through the functions here and re-render
   when the matching topic fires.

   Topics: tabs · req · res · history · saved · env · settings
   ================================================================== */
(function (R) {
  'use strict';

  const U = R.util, store = R.store;
  const KEY = 'workspace';
  const FORMAT = 1;

  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const BODYLESS = { GET: true, HEAD: true };

  /* --------------------------- factories -------------------------- */

  function blankBody() { return { mode: 'none', raw: '', json: '', form: [] }; }

  function blankRequest() {
    return { method: 'GET', url: '', params: [], headers: [], body: blankBody() };
  }

  function blankTab(req, name) {
    return {
      id: U.uid('tab'),
      name: name || null,          // null = label derived from the URL
      savedId: null,
      dirty: false,
      req: req || blankRequest(),
      res: null,
      sending: false
    };
  }

  /** Defensive normaliser — also the gate every import passes through. */
  function normaliseRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(r => r && (r.k != null || r.key != null))
      .map(r => ({
        k: String(r.k != null ? r.k : r.key),
        v: String(r.v != null ? r.v : (r.value != null ? r.value : '')),
        on: r.on === undefined ? (r.enabled === undefined ? true : !!r.enabled) : !!r.on
      }));
  }

  function normaliseRequest(r) {
    r = r || {};
    const b = r.body || {};
    const method = String(r.method || 'GET').toUpperCase();
    return {
      method: METHODS.indexOf(method) >= 0 ? method : 'GET',
      url: String(r.url || ''),
      params: normaliseRows(r.params),
      headers: normaliseRows(r.headers),
      body: {
        mode: ['none', 'raw', 'json', 'form'].indexOf(b.mode) >= 0 ? b.mode : 'none',
        raw: String(b.raw || ''),
        json: String(b.json || ''),
        form: normaliseRows(b.form)
      }
    };
  }

  /* ------------------------- first-run seed ----------------------- */

  function seed() {
    const env = {
      id: U.uid('env'),
      name: 'JSONPlaceholder',
      vars: [
        { k: 'baseUrl', v: 'https://jsonplaceholder.typicode.com', on: true },
        { k: 'userId', v: '1', on: true }
      ]
    };

    const saved = [
      {
        id: U.uid('sv'), name: 'List posts',
        req: normaliseRequest({
          method: 'GET', url: '{{baseUrl}}/posts',
          params: [{ k: '_limit', v: '5', on: true }]
        })
      },
      {
        id: U.uid('sv'), name: 'Single post',
        req: normaliseRequest({ method: 'GET', url: '{{baseUrl}}/posts/1' })
      },
      {
        id: U.uid('sv'), name: 'Create post',
        req: normaliseRequest({
          method: 'POST', url: '{{baseUrl}}/posts',
          headers: [{ k: 'Content-Type', v: 'application/json', on: true }],
          body: {
            mode: 'json',
            json: '{\n  "title": "sent from Relay",\n  "body": "hello world",\n  "userId": {{userId}}\n}'
          }
        })
      }
    ];

    const first = blankTab(normaliseRequest({ method: 'GET', url: '{{baseUrl}}/posts/1' }));

    return {
      format: FORMAT,
      tabs: [first],
      activeTabId: first.id,
      saved: saved,
      history: [],
      envs: [env],
      activeEnvId: env.id,
      settings: defaults()
    };
  }

  function defaults() {
    return {
      theme: 'dark',
      split: 0.5,            // request pane share of the vertical split
      timeout: 30000,
      historyLimit: 100,
      proxy: '',
      proxyOn: false,
      credentials: false,    // send cookies cross-origin
      wrap: false
    };
  }

  /* ----------------------------- bus ------------------------------ */

  const handlers = new Map();

  function on(topic, fn) {
    if (!handlers.has(topic)) handlers.set(topic, new Set());
    handlers.get(topic).add(fn);
    return () => handlers.get(topic).delete(fn);
  }

  /** Notify listeners without asking for a save — the save path itself
   *  reports through here, and must not schedule another one. */
  function dispatch(topic, payload) {
    const set = handlers.get(topic);
    if (set) set.forEach(fn => {
      try { fn(payload); } catch (e) { console.error('[relay] handler failed on "' + topic + '"', e); }
    });
    const all = handlers.get('*');
    if (all) all.forEach(fn => fn(topic, payload));
  }

  function emit(topic, payload) {
    dispatch(topic, payload);
    schedulePersist();
  }

  /* -------------------------- persistence ------------------------- */

  let data = null;

  function snapshot() {
    // Responses are deliberately not persisted: they are large, often
    // binary-ish, and stale the moment the page reloads.
    return {
      format: FORMAT,
      tabs: data.tabs.map(t => ({
        id: t.id, name: t.name, savedId: t.savedId, dirty: t.dirty, req: t.req
      })),
      activeTabId: data.activeTabId,
      saved: data.saved,
      history: data.history,
      envs: data.envs,
      activeEnvId: data.activeEnvId,
      settings: data.settings
    };
  }

  function persist() {
    let result = store.write(KEY, snapshot());
    if (!result.ok && result.quota && data.history.length) {
      // Trade the oldest half of the log for a working save.
      data.history = data.history.slice(0, Math.floor(data.history.length / 2));
      result = store.write(KEY, snapshot());
      dispatch('history');
    }
    if (!result.ok) dispatch('storage:error', result);
    return result;
  }

  const schedulePersist = U.debounce(persist, 400);

  function load() {
    const raw = store.read(KEY);
    if (!raw || !Array.isArray(raw.tabs) || !raw.tabs.length) { data = seed(); persist(); return data; }

    data = {
      format: FORMAT,
      tabs: raw.tabs.map(t => ({
        id: t.id || U.uid('tab'),
        name: t.name || null,
        savedId: t.savedId || null,
        dirty: !!t.dirty,
        req: normaliseRequest(t.req),
        res: null,
        sending: false
      })),
      activeTabId: raw.activeTabId,
      saved: (raw.saved || []).map(s => ({
        id: s.id || U.uid('sv'), name: s.name || 'Untitled', req: normaliseRequest(s.req)
      })),
      history: (raw.history || []).map(h => ({
        id: h.id || U.uid('h'), ts: h.ts || Date.now(), method: h.method || 'GET',
        url: h.url || '', status: h.status, ok: !!h.ok, time: h.time, size: h.size,
        error: h.error || null, req: normaliseRequest(h.req)
      })),
      envs: (raw.envs || []).map(e => ({
        id: e.id || U.uid('env'), name: e.name || 'Environment', vars: normaliseRows(e.vars)
      })),
      activeEnvId: raw.activeEnvId || null,
      settings: Object.assign(defaults(), raw.settings || {})
    };

    if (!data.tabs.some(t => t.id === data.activeTabId)) data.activeTabId = data.tabs[0].id;
    if (!data.envs.some(e => e.id === data.activeEnvId)) data.activeEnvId = data.envs.length ? data.envs[0].id : null;
    return data;
  }

  /* ---------------------------- tabs ------------------------------ */

  function tabs() { return data.tabs; }
  function activeTab() { return data.tabs.find(t => t.id === data.activeTabId) || data.tabs[0]; }
  function tabById(id) { return data.tabs.find(t => t.id === id) || null; }

  function openTab(req, opts) {
    opts = opts || {};
    const tab = blankTab(normaliseRequest(req), opts.name);
    tab.savedId = opts.savedId || null;
    data.tabs.push(tab);
    data.activeTabId = tab.id;
    emit('tabs');
    return tab;
  }

  function selectTab(id) {
    if (!tabById(id) || data.activeTabId === id) return;
    data.activeTabId = id;
    emit('tabs');
  }

  function closeTab(id) {
    const i = data.tabs.findIndex(t => t.id === id);
    if (i < 0) return;
    data.tabs.splice(i, 1);
    if (!data.tabs.length) data.tabs.push(blankTab());
    if (data.activeTabId === id) data.activeTabId = data.tabs[Math.min(i, data.tabs.length - 1)].id;
    emit('tabs');
  }

  /** Mutate the active request; `silent` skips the re-render round trip
   *  for edits that came from the widget already showing them. */
  function editRequest(mutator, silent) {
    const tab = activeTab();
    mutator(tab.req, tab);
    if (tab.savedId) tab.dirty = true;
    emit('req', { tab: tab, silent: !!silent });
  }

  function setResponse(tabId, res) {
    const tab = tabById(tabId);
    if (!tab) return;
    tab.res = res;
    emit('res', { tab: tab });
  }

  function setSending(tabId, sending) {
    const tab = tabById(tabId);
    if (!tab) return;
    tab.sending = sending;
    emit('res', { tab: tab });
  }

  /** A short, human label for a tab or list row. */
  function label(tab) {
    if (tab.name) return tab.name;
    const url = (tab.req && tab.req.url || '').trim();
    if (!url) return 'Untitled request';
    const noQuery = url.split('?')[0].replace(/\/+$/, '');
    const seg = noQuery.split('/').filter(Boolean).pop();
    return seg && seg.indexOf('{{') !== 0 ? seg : noQuery || 'Untitled request';
  }

  /* --------------------------- history ---------------------------- */

  function pushHistory(entry) {
    data.history.unshift(Object.assign({ id: U.uid('h'), ts: Date.now() }, entry));
    const limit = data.settings.historyLimit || 100;
    if (data.history.length > limit) data.history.length = limit;
    emit('history');
  }

  function deleteHistory(id) {
    const i = data.history.findIndex(h => h.id === id);
    if (i >= 0) { data.history.splice(i, 1); emit('history'); }
  }

  function clearHistory() { data.history = []; emit('history'); }

  /* ------------------------ saved requests ------------------------ */

  function saveRequest(name, req, existingId) {
    if (existingId) {
      const rec = data.saved.find(s => s.id === existingId);
      if (rec) {
        rec.name = name || rec.name;
        rec.req = U.clone(normaliseRequest(req));
        emit('saved');
        return rec;
      }
    }
    const rec = { id: U.uid('sv'), name: name || 'Untitled', req: U.clone(normaliseRequest(req)) };
    data.saved.push(rec);
    emit('saved');
    return rec;
  }

  function deleteSaved(id) {
    const i = data.saved.findIndex(s => s.id === id);
    if (i < 0) return;
    data.saved.splice(i, 1);
    data.tabs.forEach(t => { if (t.savedId === id) { t.savedId = null; t.dirty = false; } });
    emit('saved');
    emit('tabs');
  }

  /* ------------------------- environments ------------------------- */

  function envs() { return data.envs; }
  function activeEnv() { return data.envs.find(e => e.id === data.activeEnvId) || null; }
  function envById(id) { return data.envs.find(e => e.id === id) || null; }

  function setActiveEnv(id) {
    data.activeEnvId = id || null;
    emit('env');
  }

  function addEnv(name, vars) {
    const env = { id: U.uid('env'), name: name || 'New environment', vars: normaliseRows(vars) };
    data.envs.push(env);
    data.activeEnvId = env.id;
    emit('env');
    return env;
  }

  function renameEnv(id, name) {
    const env = envById(id);
    if (env && name) { env.name = name; emit('env'); }
  }

  function deleteEnv(id) {
    const i = data.envs.findIndex(e => e.id === id);
    if (i < 0) return;
    data.envs.splice(i, 1);
    if (data.activeEnvId === id) data.activeEnvId = data.envs.length ? data.envs[0].id : null;
    emit('env');
  }

  function setEnvVars(id, vars) {
    const env = envById(id);
    if (!env) return;
    env.vars = normaliseRows(vars);
    emit('env');
  }

  /* --------------------------- settings --------------------------- */

  function settings() { return data.settings; }

  function setSetting(key, value) {
    data.settings[key] = value;
    emit('settings', { key: key, value: value });
  }

  /* -------------------- wholesale replacement --------------------- */

  /** Used by import. `next` must already be normalised. */
  function replaceAll(next) {
    data = next;
    if (!data.tabs.length) data.tabs.push(blankTab());
    if (!data.tabs.some(t => t.id === data.activeTabId)) data.activeTabId = data.tabs[0].id;
    emit('tabs'); emit('saved'); emit('history'); emit('env'); emit('settings');
  }

  function raw() { return data; }

  R.state = {
    METHODS, BODYLESS,
    blankRequest, blankBody, normaliseRequest, normaliseRows, defaults,
    load, persist, raw, replaceAll,
    on, emit,
    tabs, activeTab, tabById, openTab, selectTab, closeTab, editRequest,
    setResponse, setSending, label,
    pushHistory, deleteHistory, clearHistory,
    saved: () => data.saved, saveRequest, deleteSaved,
    envs, activeEnv, envById, setActiveEnv, addEnv, renameEnv, deleteEnv, setEnvVars,
    settings, setSetting
  };
})(Relay);
