/* ==================================================================
   kv.js — the key/value editor used for query params, headers,
   url-encoded form fields and environment variables.

   Two behaviours make it feel like a real editor rather than a form:

   1. It never re-renders itself while you type. Keystrokes mutate the
      model in place and new blank rows are appended as DOM nodes, so
      the caret and focus survive. Full renders happen only when the
      owner hands it a different data set.

   2. Bulk edit swaps the table for a textarea of `key: value` lines —
      the fastest way to paste a pile of headers in. A leading `//`
      marks a row as disabled, matching what the checkbox does.
   ================================================================== */
(function (R) {
  'use strict';

  const U = R.util, el = U.el;

  function blank() { return { k: '', v: '', on: true }; }
  function isBlank(r) { return !r.k && !r.v; }

  function KVEditor(host, opts) {
    this.host = host;
    this.opts = Object.assign({
      keyPlaceholder: 'Key',
      valuePlaceholder: 'Value',
      hint: '',
      bulk: true,
      onChange: function () {}
    }, opts || {});
    this.rows = [blank()];
    this.bulkMode = false;
    this._render();
  }

  /* ---------------------------- public ---------------------------- */

  /** Replace the contents wholesale (external change → full render). */
  KVEditor.prototype.set = function (rows) {
    this.rows = (rows || []).map(r => ({ k: r.k || '', v: r.v || '', on: r.on !== false }));
    if (!this.rows.length || !isBlank(this.rows[this.rows.length - 1])) this.rows.push(blank());
    this._render();
  };

  /** The meaningful rows — the trailing blank is an editing affordance,
   *  not data, so it never leaves the widget. */
  KVEditor.prototype.get = function () {
    return this.rows.filter(r => !isBlank(r)).map(r => ({ k: r.k, v: r.v, on: r.on }));
  };

  KVEditor.prototype.count = function () {
    return this.rows.filter(r => !isBlank(r) && r.on).length;
  };

  /* ---------------------------- render ---------------------------- */

  KVEditor.prototype._render = function () {
    U.clear(this.host);
    this.host.classList.add('kv-wrap');

    if (this.bulkMode) {
      this.textarea = el('textarea.kv-bulk', {
        spellcheck: false,
        value: this._toBulk(),
        placeholder: 'Content-Type: application/json\n// commented rows are sent disabled',
        oninput: () => { this._fromBulk(this.textarea.value); this._emit(); }
      });
      this.host.appendChild(el('div.kv-scroll', {}, [this.textarea]));
    } else {
      this.tbody = el('tbody');
      this.rows.forEach(row => this.tbody.appendChild(this._rowNode(row)));
      this.host.appendChild(el('div.kv-scroll', {}, [
        el('table.kv-table', {}, [
          el('thead', {}, [el('tr', {}, [
            el('th.kv-col-on'),
            el('th', { text: this.opts.keyPlaceholder }),
            el('th', { text: this.opts.valuePlaceholder }),
            el('th.kv-col-act')
          ])]),
          this.tbody
        ])
      ]));
    }

    this.host.appendChild(el('div.kv-foot', {}, [
      el('span', { text: this.opts.hint || '' }),
      el('div.spacer'),
      this.opts.bulk && el('button.btn.btn-sm.ghost', {
        text: this.bulkMode ? 'Table edit' : 'Bulk edit',
        onclick: () => { this.bulkMode = !this.bulkMode; this._render(); }
      })
    ]));
  };

  KVEditor.prototype._rowNode = function (row) {
    const self = this;

    const toggle = el('input.kv-on', {
      type: 'checkbox', checked: row.on !== false, title: 'Include this row',
      onchange: function () {
        row.on = this.checked;
        tr.classList.toggle('is-off', !row.on);
        self._emit();
      }
    });

    function cell(field, placeholder) {
      const input = el('input', {
        type: 'text', value: row[field], placeholder: placeholder, spellcheck: false,
        oninput: function () {
          row[field] = this.value;
          self._grow(row);
          self._emit();
        }
      });
      return el('td.kv-cell', {}, [input]);
    }

    const del = el('button.kv-del', {
      type: 'button', title: 'Remove row', html: '&times;',
      onclick: () => self._remove(row, tr)
    });

    const tr = el('tr.kv-row', {}, [
      el('td.kv-col-on', {}, [toggle]),
      cell('k', this.opts.keyPlaceholder),
      cell('v', this.opts.valuePlaceholder),
      el('td.kv-col-act', {}, [del])
    ]);
    if (row.on === false) tr.classList.add('is-off');
    return tr;
  };

  /** Typing in the last row grows the table by one blank row. */
  KVEditor.prototype._grow = function (row) {
    const last = this.rows[this.rows.length - 1];
    if (row !== last || isBlank(row)) return;
    const fresh = blank();
    this.rows.push(fresh);
    this.tbody.appendChild(this._rowNode(fresh));
  };

  KVEditor.prototype._remove = function (row, tr) {
    const i = this.rows.indexOf(row);
    if (i < 0) return;
    this.rows.splice(i, 1);
    tr.parentNode.removeChild(tr);
    if (!this.rows.length) {
      const fresh = blank();
      this.rows.push(fresh);
      this.tbody.appendChild(this._rowNode(fresh));
    }
    this._emit();
  };

  KVEditor.prototype._emit = function () {
    this.opts.onChange(this.get());
  };

  /* --------------------------- bulk text -------------------------- */

  KVEditor.prototype._toBulk = function () {
    return this.rows.filter(r => !isBlank(r))
      .map(r => (r.on ? '' : '// ') + r.k + ': ' + r.v)
      .join('\n');
  };

  KVEditor.prototype._fromBulk = function (text) {
    this.rows = String(text).split('\n').map(line => {
      const off = /^\s*\/\//.test(line);
      const clean = line.replace(/^\s*\/\/\s?/, '');
      const i = clean.indexOf(':');
      if (!clean.trim()) return null;
      return i < 0
        ? { k: clean.trim(), v: '', on: !off }
        : { k: clean.slice(0, i).trim(), v: clean.slice(i + 1).trim(), on: !off };
    }).filter(Boolean);
    this.rows.push(blank());
  };

  R.KV = { mount: (host, opts) => new KVEditor(host, opts) };
})(Relay);
