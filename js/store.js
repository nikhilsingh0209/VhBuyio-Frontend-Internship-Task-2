/* ==================================================================
   store.js — the localStorage boundary.

   Everything durable goes through here so the rest of the app never
   has to care that storage can be missing (private mode), full
   (quota), or holding data written by an older build.
   ================================================================== */
(function (R) {
  'use strict';

  const PREFIX = 'relay:';

  const backend = (function probe() {
    try {
      const k = PREFIX + 'probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return { available: true, kind: 'localStorage' };
    } catch (e) {
      return { available: false, kind: 'memory', reason: e && e.message };
    }
  })();

  // Stand-in used when localStorage is unavailable: the session still
  // works end to end, it just forgets everything on reload.
  const memory = new Map();

  function read(key) {
    const full = PREFIX + key;
    try {
      const raw = backend.available ? localStorage.getItem(full) : memory.get(full);
      return raw == null ? null : JSON.parse(raw);
    } catch (e) {
      console.warn('[relay] unreadable record dropped:', key, e);
      return null;
    }
  }

  function write(key, value) {
    const full = PREFIX + key;
    let raw;
    try { raw = JSON.stringify(value); }
    catch (e) { return { ok: false, error: 'not serialisable: ' + e.message }; }

    if (!backend.available) { memory.set(full, raw); return { ok: true, volatile: true }; }

    try {
      localStorage.setItem(full, raw);
      return { ok: true, bytes: raw.length };
    } catch (e) {
      const quota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
      return { ok: false, quota: quota, error: e && e.message };
    }
  }

  function remove(key) {
    const full = PREFIX + key;
    if (backend.available) { try { localStorage.removeItem(full); } catch (e) { /* ignore */ } }
    memory.delete(full);
  }

  /** Rough footprint of everything Relay owns, for the status bar. */
  function usage() {
    if (!backend.available) return 0;
    let total = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.slice(0, PREFIX.length) === PREFIX) {
          total += k.length + (localStorage.getItem(k) || '').length;
        }
      }
    } catch (e) { /* ignore */ }
    return total;
  }

  R.store = { read, write, remove, usage, available: backend.available, kind: backend.kind };
})(Relay);
