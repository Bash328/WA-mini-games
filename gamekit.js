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

  const todayISO = () => new Date().toISOString().slice(0, 10); // UTC

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
      // highlight d (and remember it) WITHOUT calling onChange: for restoring a saved game
      show: (d) => { if (diffs.includes(d)) apply(d, false); },
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

  // The big "whose move is it" pill (styled in shared.css). slot is 1 or 2
  // (the player's colour, --p1/--p2); pass a falsy slot to hide it. waiting
  // dims it for "it's the other side's move / the AI is thinking". The
  // element is created on first use, right under the status row.
  function turn(slot, text, waiting) {
    let el = document.getElementById("turn-badge");
    if (!slot) { if (el) el.hidden = true; syncStatus(); return; }
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
    watchStatus();
    syncStatus();
  }

  // The turn badge and the small #status line often said the same thing
  // ("Red to move." under a pill reading "Red to move"). Whenever every word
  // of the status already appears in the badge, hide the status; if it says
  // more (a taunt, an instruction, a score), it stays. Re-checked whenever
  // the badge changes or the status text does, so no game has to remember.
  const words = (t) => String(t).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
  function syncStatus() {
    const st = document.getElementById("status");
    if (!st) return;
    const badge = document.getElementById("turn-badge");
    let dup = false;
    if (badge && !badge.hidden) {
      const have = new Set(words(badge.textContent));
      const w = words(st.textContent);
      dup = w.length > 0 && w.every((x) => have.has(x));
    }
    st.classList.toggle("dup", dup);
  }
  let statusWatcher = null;
  function watchStatus() {
    if (statusWatcher || typeof MutationObserver === "undefined") return;
    const st = document.getElementById("status");
    if (!st) return;
    statusWatcher = new MutationObserver(syncStatus);
    statusWatcher.observe(st, { childList: true, characterData: true, subtree: true });
  }

  /* ---------- Resume after an accidental refresh ----------
     Solo, vs-computer and same-device games keep their whole state in memory,
     so a refresh (or the phone killing a background tab) lost the game.
     resume(id, get, set) fixes that for a game with two small functions:
       get()  -> a JSON-safe snapshot of the game in progress, or null when
                 there is nothing worth keeping (a fresh or finished game)
       set(s) -> rebuild the game from a snapshot; return true if it took
     The snapshot is saved when the page is hidden or unloaded (that is what
     a refresh does), and thrown away after 12 hours. Link and live games do
     not use this: they already live in the URL or in the server's room. */
  const RESUME = storage("resume:");
  const RESUME_TTL = 12 * 60 * 60 * 1000;
  function resume(id, get, set) {
    function save() {
      try {
        const snap = get();
        if (snap) RESUME.setJSON(id, { t: Date.now(), s: snap }); else RESUME.remove(id);
      } catch (e) { /* never let saving break a game */ }
    }
    global.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save(); });
    return {
      save: save,
      clear: () => RESUME.remove(id),
      // Call once the game has started up. Returns true if a saved game was put back.
      restore() {
        const rec = RESUME.getJSON(id, null);
        if (!rec || !rec.s || Date.now() - rec.t > RESUME_TTL) { RESUME.remove(id); return false; }
        let ok = false;
        try { ok = !!set(rec.s); } catch (e) { ok = false; }
        if (ok) notice("Picked up where you left off.");
        else RESUME.remove(id);
        return ok;
      },
    };
  }

  // A short-lived line at the top of the game panel ("Picked up where you left off.").
  function notice(text) {
    const panel = document.querySelector(".panel");
    if (!panel) return;
    const el = document.createElement("div");
    el.className = "game-notice";
    el.setAttribute("role", "status");
    el.textContent = text;
    panel.insertBefore(el, panel.firstChild);
    setTimeout(() => { el.classList.add("fade"); setTimeout(() => el.remove(), 600); }, 3500);
  }

  global.Gamekit = {
    mulberry32,
    dailySeed,
    randomSeed,
    shuffle,
    storage,
    fmtTime,
    wireDifficultyChips,
    taunt,
    turn,
    resume,
    notice,
  };
})(window);
