/* ==================================================================
   ui.js — toasts and modals.

   The browser's own prompt()/confirm() are blocked in some embedded
   contexts and cannot be styled, so Relay ships its own promise-based
   pair. Both resolve exactly once; Escape always means "no".
   ================================================================== */
(function (R) {
  'use strict';

  const U = R.util, el = U.el;

  /* ---------------------------- toasts ---------------------------- */

  function toast(message, kind, ms) {
    const host = U.qs('#toasts');
    if (!host) return;
    const node = el('div.toast' + (kind ? '.' + kind : ''), { text: message });
    host.appendChild(node);
    const life = ms || (kind === 'err' ? 5200 : 2600);
    setTimeout(() => {
      node.style.transition = 'opacity .18s, transform .18s';
      node.style.opacity = '0';
      node.style.transform = 'translateY(6px)';
      setTimeout(() => node.remove(), 200);
    }, life);
    return node;
  }

  /* ---------------------------- modal ----------------------------- */

  let openModal = null;

  /**
   * modal({ title, body, buttons:[{label, value, primary, danger}],
   *         onMount(bodyNode), defaultValue })
   * Resolves with the chosen button's `value`, or null if dismissed.
   */
  function modal(opts) {
    close();
    return new Promise(resolve => {
      const root = U.qs('#modal-root');
      const body = el('div.modal-body');

      if (typeof opts.body === 'string') body.innerHTML = opts.body;
      else if (opts.body) body.appendChild(opts.body);

      const buttons = (opts.buttons || [{ label: 'OK', value: true, primary: true }]).map(spec =>
        el('button.btn' + (spec.primary ? '.primary' : '') + (spec.danger ? '.danger-ghost' : ''), {
          text: spec.label,
          onclick: () => finish(typeof spec.value === 'function' ? spec.value() : spec.value)
        })
      );

      const card = el('div.modal', { role: 'dialog', 'aria-modal': 'true' }, [
        el('div.modal-head', { text: opts.title || '' }),
        body,
        el('div.modal-foot', {}, buttons)
      ]);

      U.clear(root);
      root.appendChild(card);
      root.hidden = false;

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
        else if (e.key === 'Enter' && opts.submitOnEnter !== false &&
                 e.target.tagName !== 'TEXTAREA' && !e.shiftKey) {
          const primary = (opts.buttons || []).find(b => b.primary);
          if (primary) { e.preventDefault(); finish(typeof primary.value === 'function' ? primary.value() : primary.value); }
        }
      }

      function onBackdrop(e) { if (e.target === root) finish(null); }

      function finish(value) {
        document.removeEventListener('keydown', onKey, true);
        root.removeEventListener('mousedown', onBackdrop);
        root.hidden = true;
        U.clear(root);
        openModal = null;
        resolve(value);
      }

      document.addEventListener('keydown', onKey, true);
      root.addEventListener('mousedown', onBackdrop);
      openModal = finish;

      if (opts.onMount) opts.onMount(body);
      const focus = body.querySelector('input, textarea, select') || buttons[buttons.length - 1];
      if (focus) { focus.focus(); if (focus.select) focus.select(); }
    });
  }

  function close() { if (openModal) openModal(null); }

  /* ------------------------ prompt / confirm ---------------------- */

  function prompt(opts) {
    opts = opts || {};
    let input;
    const field = el('div.field', {}, [
      opts.label ? el('label', { text: opts.label }) : null,
      input = el('input.input', {
        type: 'text', value: opts.value || '', placeholder: opts.placeholder || '', spellcheck: false
      }),
      opts.hint ? el('div.hint', { text: opts.hint }) : null
    ]);

    return modal({
      title: opts.title || 'Enter a value',
      body: field,
      buttons: [
        { label: 'Cancel', value: null },
        { label: opts.confirmLabel || 'OK', value: () => input.value.trim() || null, primary: true }
      ]
    });
  }

  function confirm(opts) {
    opts = opts || {};
    return modal({
      title: opts.title || 'Are you sure?',
      body: el('p', { text: opts.message || '' }),
      buttons: [
        { label: 'Cancel', value: false },
        { label: opts.confirmLabel || 'Confirm', value: true, primary: !opts.danger, danger: !!opts.danger }
      ]
    }).then(v => v === true);
  }

  R.ui = { toast, modal, prompt, confirm, close };
})(Relay);
