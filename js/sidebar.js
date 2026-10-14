/* ==================================================================
   sidebar.js — history, saved requests and the environment editor.

   The history log is append-on-send and replay-on-click: every entry
   keeps the request as it stood, variables unresolved, so replaying an
   old call against a different environment does the sensible thing.
   ================================================================== */
(function (R) {
  'use strict';

  const U = R.util, S = R.state, el = U.el;

  const els = {};
  let envEditor = null;
  let suppressEnvSync = false;   // set while the KV editor is the one talking

  /* ----------------------------- boot ----------------------------- */

  function init() {
    [
      'history-list', 'history-search', 'btn-clear-history',
      'saved-list', 'saved-search', 'btn-save-current',
      'env-picker', 'env-select', 'env-vars',
      'btn-env-new', 'btn-env-rename', 'btn-env-dupe', 'btn-env-del',
      'sidebar', 'sidebar-toggle', 'sidebar-backdrop'
    ].forEach(id => { els[id] = U.qs('#' + id); });

    U.qsa('.side-tab').forEach(btn => {
      btn.addEventListener('click', () => showSide(btn.dataset.side));
    });

    els['history-search'].addEventListener('input', renderHistory);
    els['saved-search'].addEventListener('input', renderSaved);

    els['btn-clear-history'].addEventListener('click', () => {
      const n = S.raw().history.length;
      if (!n) { R.ui.toast('History is already empty'); return; }
      R.ui.confirm({
        title: 'Clear history',
        message: 'Delete all ' + n + ' entries? Saved requests and environments are untouched.',
        confirmLabel: 'Delete', danger: true
      }).then(yes => { if (yes) { S.clearHistory(); R.ui.toast('History cleared', 'ok'); } });
    });

    els['btn-save-current'].addEventListener('click', () => R.request.save());

    els['history-list'].addEventListener('click', onHistoryClick);
    els['saved-list'].addEventListener('click', onSavedClick);

    els['env-picker'].addEventListener('change', function () { S.setActiveEnv(this.value || null); });
    els['env-select'].addEventListener('change', function () { S.setActiveEnv(this.value || null); });

    els['btn-env-new'].addEventListener('click', newEnv);
    els['btn-env-rename'].addEventListener('click', renameEnv);
    els['btn-env-dupe'].addEventListener('click', dupeEnv);
    els['btn-env-del'].addEventListener('click', deleteEnv);

    envEditor = R.KV.mount(els['env-vars'], {
      keyPlaceholder: 'Variable', valuePlaceholder: 'Value', bulk: false,
      onChange: rows => {
        const env = S.activeEnv();
        if (!env) return;
        suppressEnvSync = true;
        S.setEnvVars(env.id, rows);
        suppressEnvSync = false;
      }
    });

    // Mobile drawer
    els['sidebar-toggle'].addEventListener('click', toggleDrawer);
    els['sidebar-backdrop'].addEventListener('click', () => toggleDrawer(false));

    S.on('history', renderHistory);
    S.on('saved', renderSaved);
    S.on('env', renderEnv);

    renderHistory();
    renderSaved();
    renderEnv();
  }

  function showSide(name) {
    U.qsa('.side-tab').forEach(b => b.classList.toggle('is-active', b.dataset.side === name));
    U.qsa('.side-panel').forEach(p => p.classList.toggle('is-active', p.id === 'side-' + name));
  }

  function toggleDrawer(force) {
    const open = force === undefined ? !els.sidebar.classList.contains('open') : !!force;
    els.sidebar.classList.toggle('open', open);
    els['sidebar-backdrop'].classList.toggle('open', open);
  }

  /* ---------------------------- history --------------------------- */

  function renderHistory() {
    const list = els['history-list'];
    const filter = els['history-search'].value.trim().toLowerCase();
    const all = S.raw().history;
    const rows = filter
      ? all.filter(h => (h.url + ' ' + h.method).toLowerCase().indexOf(filter) >= 0)
      : all;

    U.clear(list);

    if (!rows.length) {
      list.appendChild(el('li.list-empty', {
        html: all.length ? 'Nothing matches that filter.'
          : 'Requests you send are logged here.<br>Click one to load it back.'
      }));
      return;
    }

    rows.forEach(h => {
      const status = h.error ? 'ERR' : String(h.status || '—');
      list.appendChild(el('li.list-item', {
        'data-id': h.id,
        title: h.method + ' ' + h.url + '\n' + U.fmtStamp(h.ts) +
               (h.error ? '\n' + h.error : '\n' + status + ' · ' + U.fmtMs(h.time))
      }, [
        el('span.verb.m-' + h.method, { text: h.method }),
        el('span.label', { text: shortUrl(h.url) }),
        el('span.sub' + statusTone(h), { text: status }),
        el('span.sub', { text: U.fmtAgo(h.ts) }),
        el('button.row-del', { html: '&times;', title: 'Remove entry', 'data-del': h.id })
      ]));
    });
  }

  function statusTone(h) {
    if (h.error) return '.m-DELETE';
    const c = U.statusClass(h.status);
    return c === '2' ? '.m-GET' : c === '4' ? '.m-POST' : c === '5' ? '.m-DELETE' : '';
  }

  function shortUrl(url) {
    const s = String(url || '').replace(/^https?:\/\//, '');
    return U.truncate(s, 46);
  }

  function onHistoryClick(e) {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); S.deleteHistory(del.dataset.del); return; }

    const row = e.target.closest('[data-id]');
    if (!row) return;
    const entry = S.raw().history.find(h => h.id === row.dataset.id);
    if (!entry) return;
    R.request.load(entry.req, { reuse: false });
    closeDrawerOnMobile();
  }

  /* ----------------------------- saved ---------------------------- */

  function renderSaved() {
    const list = els['saved-list'];
    const filter = els['saved-search'].value.trim().toLowerCase();
    const all = S.saved();
    const rows = filter
      ? all.filter(s => (s.name + ' ' + s.req.url).toLowerCase().indexOf(filter) >= 0)
      : all;

    U.clear(list);

    if (!rows.length) {
      list.appendChild(el('li.list-empty', {
        html: all.length ? 'Nothing matches that filter.'
          : 'Save the request you are editing with <b>Ctrl+S</b> and it appears here.'
      }));
      return;
    }

    rows.forEach(s => {
      list.appendChild(el('li.list-item', {
        'data-id': s.id, title: s.req.method + ' ' + s.req.url
      }, [
        el('span.verb.m-' + s.req.method, { text: s.req.method }),
        el('span.label', { text: s.name }),
        el('button.row-del', { html: '&times;', title: 'Delete saved request', 'data-del': s.id })
      ]));
    });
  }

  function onSavedClick(e) {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const rec = S.saved().find(s => s.id === del.dataset.del);
      R.ui.confirm({
        title: 'Delete request',
        message: 'Delete "' + (rec ? rec.name : 'this request') + '"? This cannot be undone.',
        confirmLabel: 'Delete', danger: true
      }).then(yes => { if (yes) S.deleteSaved(del.dataset.del); });
      return;
    }

    const row = e.target.closest('[data-id]');
    if (!row) return;
    const rec = S.saved().find(s => s.id === row.dataset.id);
    if (!rec) return;

    // Already open? Just focus that tab.
    const open = S.tabs().find(t => t.savedId === rec.id);
    if (open) S.selectTab(open.id);
    else R.request.load(rec.req, { name: rec.name, savedId: rec.id });
    closeDrawerOnMobile();
  }

  function closeDrawerOnMobile() {
    if (window.matchMedia('(max-width: 900px)').matches) toggleDrawer(false);
  }

  /* -------------------------- environments ------------------------ */

  function renderEnv() {
    const envs = S.envs(), active = S.activeEnv();

    [els['env-picker'], els['env-select']].forEach(select => {
      U.clear(select);
      select.appendChild(el('option', { value: '', text: envs.length ? 'No environment' : 'No environments yet' }));
      envs.forEach(e => select.appendChild(el('option', { value: e.id, text: e.name })));
      select.value = active ? active.id : '';
    });

    els['btn-env-rename'].disabled = els['btn-env-dupe'].disabled = els['btn-env-del'].disabled = !active;

    if (!suppressEnvSync) envEditor.set(active ? active.vars : []);
    els['env-vars'].style.opacity = active ? '' : '.45';
    els['env-vars'].style.pointerEvents = active ? '' : 'none';
  }

  function newEnv() {
    R.ui.prompt({ title: 'New environment', label: 'Name', value: 'Environment ' + (S.envs().length + 1), confirmLabel: 'Create' })
      .then(name => {
        if (!name) return;
        S.addEnv(name, []);
        showSide('env');
        R.ui.toast('Environment "' + name + '" created', 'ok');
      });
  }

  function renameEnv() {
    const env = S.activeEnv();
    if (!env) return;
    R.ui.prompt({ title: 'Rename environment', label: 'Name', value: env.name, confirmLabel: 'Rename' })
      .then(name => { if (name) S.renameEnv(env.id, name); });
  }

  function dupeEnv() {
    const env = S.activeEnv();
    if (!env) return;
    S.addEnv(env.name + ' copy', U.clone(env.vars));
    R.ui.toast('Environment duplicated', 'ok');
  }

  function deleteEnv() {
    const env = S.activeEnv();
    if (!env) return;
    R.ui.confirm({
      title: 'Delete environment',
      message: 'Delete "' + env.name + '" and its ' + env.vars.length + ' variable(s)?',
      confirmLabel: 'Delete', danger: true
    }).then(yes => { if (yes) S.deleteEnv(env.id); });
  }

  R.sidebar = { init, showSide, toggleDrawer };
})(Relay);
