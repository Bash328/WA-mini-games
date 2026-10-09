/* ============================================================
   gamekit.js — tiny shared helpers for the new games.
   Exposes `window.Gamekit`.
   ============================================================ */
(function (global) {
  "use strict";

  // Deterministic 32-bit PRNG (Mulberry32)
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // FNV-1a style 32-bit string hash
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    s = String(s);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function todayISO() {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + da;
  }

  function dailySeed(game, difficulty) {
    return hashStr(todayISO() + "|" + difficulty + "|" + game);
  }

  function randomSeed() {
    return (Math.random() * 0x100000000) >>> 0;
  }

  // Shuffle in-place (Fisher-Yates) with a given rng
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // Minimal localStorage wrapper that never throws
  function storage(prefix) {
    prefix = prefix || "";
    return {
      get: function (key, fallback) {
        try { const v = localStorage.getItem(prefix + key); return v === null ? fallback : v; }
        catch (e) { return fallback; }
      },
      set: function (key, value) {
        try { localStorage.setItem(prefix + key, String(value)); } catch (e) {}
      },
      getInt: function (key, fallback) {
        const v = this.get(key, null);
        if (v === null || v === undefined) return fallback;
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : fallback;
      },
      getJSON: function (key, fallback) {
        const v = this.get(key, null);
        if (v === null) return fallback;
        try { return JSON.parse(v); } catch (e) { return fallback; }
      },
      setJSON: function (key, obj) {
        try { this.set(key, JSON.stringify(obj)); } catch (e) {}
      },
      remove: function (key) {
        try { localStorage.removeItem(prefix + key); } catch (e) {}
      },
    };
  }

  function fmtTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  // Wire the standard difficulty-chip pattern. opts = { el, difficulties, initial, onChange, storage, storageKey }
  function wireDifficultyChips(opts) {
    const el = opts.el;
    const diffs = opts.difficulties;
    const store = opts.storage;
    const key   = opts.storageKey || "diff";
    let current = opts.initial;
    if (store) {
      const saved = store.get(key, null);
      if (saved && diffs.indexOf(saved) !== -1) current = saved;
    }
    function apply(d, fire) {
      current = d;
      el.querySelectorAll(".chip").forEach(c => {
        const on = c.getAttribute("data-diff") === current;
        c.classList.toggle("active", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
      });
      if (store) store.set(key, current);
      if (fire && opts.onChange) opts.onChange(current);
    }
    el.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      const d = btn.getAttribute("data-diff");
      if (!d || !diffs.includes(d) || d === current) return;
      apply(d, true);
    });
    apply(current, false);
    return {
      get: () => current,
      set: (d) => { if (diffs.includes(d)) apply(d, true); },
    };
  }

  // Long-press helper — calls onLong if the user presses for > ms without moving much.
  // Returns a detach() fn.
  function onLongPress(el, ms, onLong) {
    let timer = null;
    let sx = 0, sy = 0;
    const CANCEL = 8;
    function start(x, y) {
      sx = x; sy = y;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onLong();
      }, ms);
    }
    function cancel() { clearTimeout(timer); timer = null; }
    function move(x, y) {
      if (!timer) return;
      if (Math.abs(x - sx) > CANCEL || Math.abs(y - sy) > CANCEL) cancel();
    }
    const td = (e) => start(e.touches[0].clientX, e.touches[0].clientY);
    const tm = (e) => move(e.touches[0].clientX, e.touches[0].clientY);
    const tu = () => cancel();
    const md = (e) => start(e.clientX, e.clientY);
    const mm = (e) => move(e.clientX, e.clientY);
    const mu = () => cancel();
    el.addEventListener("touchstart", td, { passive: true });
    el.addEventListener("touchmove",  tm, { passive: true });
    el.addEventListener("touchend",   tu);
    el.addEventListener("touchcancel",tu);
    el.addEventListener("mousedown",  md);
    el.addEventListener("mousemove",  mm);
    el.addEventListener("mouseup",    mu);
    el.addEventListener("mouseleave", mu);
    return function detach() {
      el.removeEventListener("touchstart", td);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", tu);
      el.removeEventListener("touchcancel", tu);
      el.removeEventListener("mousedown", md);
      el.removeEventListener("mousemove", mm);
      el.removeEventListener("mouseup", mu);
      el.removeEventListener("mouseleave", mu);
    };
  }

  // Friendly trash talk, in any mode (solo vs AI, local 2-player, or
  // WhatsApp). Picked at render time, not stored anywhere — nothing here
  // rides along in a shared link, so two players can see different lines
  // for the same result with no desync risk.
  //
  // The lines live in taunts.js (see the header there for the categories
  // and how to add a game's own flavour). The game is read from the page URL
  // (".../chess/" -> "chess"), so callers just say Gamekit.taunt("loss");
  // pass a second argument only to override. A game with its own lines
  // gets them ~half the time, the generic pool the rest (a category that
  // only the game defines uses just the game's lines). Lines aren't
  // repeated until most of the pool has been seen (remembered per
  // category across visits).
  //
  // Callers that want `reversal` instead of `loss` track "did I get a
  // confidence line earlier this game" themselves — Gamekit has no game
  // state to know it from.
  const TAUNT_MEM = storage("taunt:");
  const GAME_ID = (location.pathname.match(/([^/]+)\/(?:index\.html)?$/) || [])[1] || "";
  function taunt(category, game) {
    const all = global.TAUNT_LINES || {};
    const generic = all._ || {};
    const mine = all[game || GAME_ID] || {};
    // a category only a game defines (e.g. 2048's "over-hard") has no generic pool
    const cat = generic[category] || mine[category] ? category : "loss";
    const own = mine[cat];
    const useOwn = own && own.length && (!generic[cat] || Math.random() < 0.5);
    const pool = useOwn ? own : (generic[cat] || []);
    if (!pool.length) return "";
    const key = cat + ":" + (useOwn ? (game || GAME_ID) : "_");
    const seen = TAUNT_MEM.getJSON(key, []);
    const fresh = pool.filter(l => seen.indexOf(l) === -1);
    const from = fresh.length ? fresh : pool;
    const line = from[Math.floor(Math.random() * from.length)];
    // forget the oldest once most of the pool has been used
    TAUNT_MEM.setJSON(key, seen.concat(line).slice(-Math.max(1, Math.floor(pool.length * 0.7))));
    return line;
  }

  // The big "whose move is it" pill (styled in soft.css). slot is 1 or 2
  // (the player's colour, --p1/--p2); pass a falsy slot to hide it. waiting
  // dims it for "it's the other side's move / the AI is thinking". The
  // element is created on first use, right under the status row.
  function turn(slot, text, waiting) {
    let el = document.getElementById("turn-badge");
    if (!slot) { if (el) el.hidden = true; return; }
    if (!el) {
      el = document.createElement("div");
      el.id = "turn-badge";
      el.className = "turn";
      el.appendChild(document.createElement("span")).className = "turn-dot";
      el.appendChild(document.createElement("span")).className = "turn-text";
      const row = document.querySelector(".panel > .row");
      if (row) row.parentNode.insertBefore(el, row.nextSibling);
      else { const panel = document.querySelector(".panel"); if (panel) panel.insertBefore(el, panel.firstChild); }
    }
    el.hidden = false;
    el.dataset.p = String(slot);
    el.classList.toggle("wait", !!waiting);
    el.lastChild.textContent = text;
  }

  global.Gamekit = {
    mulberry32,
    hashStr,
    todayISO,
    dailySeed,
    randomSeed,
    shuffle,
    storage,
    fmtTime,
    wireDifficultyChips,
    onLongPress,
    taunt,
    turn,
  };
})(window);
