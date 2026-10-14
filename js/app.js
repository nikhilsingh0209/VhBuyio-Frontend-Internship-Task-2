(function (R) {
  'use strict';

  const U = R.util, S = R.state, el = U.el;
  function boot() {
    S.load();
    S.tabs().forEach(t => R.request.reconcile(t.req));
    applyTheme(S.settings().theme);
    applySplit(S.settings().split);
    R.request.init();
    R.response.init();
    R.sidebar.init();
    wireTopbar();
    wireSplitter();
    wireKeys();
    wireDropImport();
    S.on('*', scheduleStatus);
    S.on('storage:error', err => {
      R.ui.toast(err.quota ? 'Storage is full — older history was dropped to make room.' : 'Could not save to localStorage: ' + (err.error || 'unknown error'), 'err');
    });

    updateStatus();
    if (!R.store.available) {
      R.ui.toast('localStorage is unavailable — this session will not be remembered.', 'warn', 6000);
    }
  }

  function wireTopbar() {
    U.qs('#theme-toggle').addEventListener('click', () => {
      const next = S.settings().theme === 'dark' ? 'light' : 'dark';
      S.setSetting('theme', next);
      applyTheme(next);
    });

    U.qs('#btn-export').addEventListener('click', R.portability.exportDialog);
    U.qs('#btn-import').addEventListener('click', R.portability.pickFile);
    U.qs('#btn-settings').addEventListener('click', openSettings);

    const file = U.qs('#file-import');
    file.addEventListener('change', function () {
      R.portability.onFile(this.files && this.files[0]);
      this.value = '';
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = U.qs('#theme-toggle');
    if (btn) btn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  }

  function applySplit(ratio) {
    const panes = U.qs('#panes');
    const r = Math.min(0.85, Math.max(0.15, ratio || 0.5));
    panes.style.gridTemplateRows = r.toFixed(3) + 'fr 5px ' + (1 - r).toFixed(3) + 'fr';
  }

  function wireSplitter() {
    const splitter = U.qs('#splitter'), panes = U.qs('#panes');
    let dragging = false;

    function move(e) {
      if (!dragging) return;
      const box = panes.getBoundingClientRect();
      const y = (e.touches ? e.touches[0].clientY : e.clientY) - box.top;
      applySplit(y / box.height);
    }

    function stop() {
      if (!dragging) return;
      dragging = false;
      splitter.classList.remove('dragging');
      document.body.style.userSelect = '';
      const rows = panes.style.gridTemplateRows.split(' ');
      S.setSetting('split', parseFloat(rows[0]) || 0.5);
    }

    splitter.addEventListener('mousedown', e => {
      e.preventDefault();
      dragging = true;
      splitter.classList.add('dragging');
      document.body.style.userSelect = 'none';
    });
    splitter.addEventListener('touchstart', () => { dragging = true; }, { passive: true });

    document.addEventListener('mousemove', move);
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('mouseup', stop);
    document.addEventListener('touchend', stop);

    splitter.addEventListener('dblclick', () => { applySplit(0.5); S.setSetting('split', 0.5); });
    splitter.addEventListener('keydown', e => {
      const rows = panes.style.gridTemplateRows.split(' ');
      const current = parseFloat(rows[0]) || 0.5;
      if (e.key === 'ArrowUp') { applySplit(current - 0.05); S.setSetting('split', current - 0.05); }
      else if (e.key === 'ArrowDown') { applySplit(current + 0.05); S.setSetting('split', current + 0.05); }
    });
  }

  function wireKeys() {
    document.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'Enter') { e.preventDefault(); R.request.send(); }
      else if (e.key.toLowerCase() === 's' && !e.altKey) { e.preventDefault(); R.request.save(); }
      else if (e.altKey && e.key.toLowerCase() === 't') { e.preventDefault(); S.openTab(); }
      else if (e.altKey && e.key.toLowerCase() === 'w') { e.preventDefault(); S.closeTab(S.activeTab().id); }
      else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const tabs = S.tabs();
        const i = tabs.findIndex(t => t.id === S.activeTab().id);
        const next = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        S.selectTab(tabs[next].id);
      }
    });
  }

  function wireDropImport() {
    const isFileDrag = e => {
      const types = e.dataTransfer && e.dataTransfer.types;
      return !!types && Array.prototype.indexOf.call(types, 'Files') >= 0;
    };

    ['dragenter', 'dragover'].forEach(type =>
      document.addEventListener(type, e => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }));

    document.addEventListener('drop', e => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) R.portability.onFile(file);
    });
  }

  function openSettings() {
    const s = S.settings();
    const fields = {};

    function field(label, node, hint) {
      return el('div.field', {}, [
        el('label', { text: label }), node,
        hint ? el('div.hint', { html: hint }) : null
      ]);
    }

    fields.timeout = el('input.input', { type: 'number', min: 1, max: 600, value: Math.round(s.timeout / 1000) });
    fields.history = el('input.input', { type: 'number', min: 10, max: 1000, value: s.historyLimit });
    fields.proxy = el('input.input', { type: 'text', value: s.proxy, placeholder: 'https://my-proxy.example.com/?url={url}', spellcheck: false });
    fields.proxyOn = el('input', { type: 'checkbox', checked: s.proxyOn });
    fields.credentials = el('input', { type: 'checkbox', checked: s.credentials });

    const body = el('div', {}, [
      field('Request timeout (seconds)', fields.timeout),
      field('History entries to keep', fields.history),
      field('CORS proxy', fields.proxy,
        'Optional. <code>{url}</code> is replaced with the encoded target; without it the target is appended. ' +
        'Requests are relayed through whatever you put here, so only use a proxy you trust — never for credentials ' +
        'or production data.'),
      el('div.field', {}, [
        el('label.check', {}, [fields.proxyOn, el('span', { text: 'Send requests through the proxy' })])
      ]),
      el('div.field', {}, [
        el('label.check', {}, [fields.credentials, el('span', { text: 'Send cookies with cross-origin requests' })]),
        el('div.hint', { html: 'Sets <code>credentials: "include"</code>. The server must answer with ' +
          '<code>Access-Control-Allow-Credentials</code> and a specific origin, or the response is blocked.' })
      ]),
      el('div.field', {}, [
        el('label', { text: 'Stored data' }),
        el('div.hint', { text: R.store.available
          ? 'Using ' + U.fmtBytes(R.store.usage()) + ' of this browser’s localStorage.'
          : 'localStorage is unavailable; nothing is being saved.' }),
        el('button.btn.btn-sm.danger-ghost', {
          text: 'Delete everything and start over',
          style: 'margin-top:8px',
          onclick: () => {
            R.ui.confirm({
              title: 'Delete all Relay data',
              message: 'Saved requests, environments, history and settings are removed from this browser. This cannot be undone.',
              confirmLabel: 'Delete everything', danger: true
            }).then(yes => {
              if (!yes) return;
              R.store.remove('workspace');
              location.reload();
            });
          }
        })
      ])
    ]);

    R.ui.modal({
      title: 'Settings',
      body: body,
      buttons: [
        { label: 'Cancel', value: null },
        { label: 'Save', value: 'save', primary: true }
      ]
    }).then(answer => {
      if (answer !== 'save') return;
      const seconds = Math.min(600, Math.max(1, parseInt(fields.timeout.value, 10) || 30));
      S.setSetting('timeout', seconds * 1000);
      S.setSetting('historyLimit', Math.min(1000, Math.max(10, parseInt(fields.history.value, 10) || 100)));
      S.setSetting('proxy', fields.proxy.value.trim());
      S.setSetting('proxyOn', fields.proxyOn.checked && !!fields.proxy.value.trim());
      S.setSetting('credentials', fields.credentials.checked);
      R.ui.toast('Settings saved', 'ok');
      updateStatus();
    });
  }

  /* --------------------------- status bar ------------------------- */

  function updateStatus() {
    const env = S.activeEnv();
    const s = S.settings();

    U.qs('#sb-storage').textContent = R.store.available
      ? 'localStorage · ' + U.fmtBytes(R.store.usage())
      : 'memory only — not persisted';

    const bits = [env ? env.name + ' · ' + env.vars.filter(v => v.on && v.k).length + ' vars' : 'no environment'];
    if (s.proxyOn && s.proxy) bits.push('proxy on');
    if (s.credentials) bits.push('cookies on');
    U.qs('#sb-env').textContent = bits.join(' · ');
  }

  const scheduleStatus = U.debounce(updateStatus, 250);

  R.app = { boot, openSettings, applyTheme, applySplit, updateStatus };

  document.addEventListener('DOMContentLoaded', boot);
})(Relay);
