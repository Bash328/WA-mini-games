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

  // Friendly trash talk, in any mode (solo vs computer, local 2-player, or
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
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // Who is on the other side, read from the page's mode menu so no game has
  // to say: "computer" | "local" (same device) | "live" | "link" (WhatsApp) | "solo".
  function modeKind() {
    const s = document.getElementById("mode");
    const v = s ? s.value : "";
    if (/^(ai|computer)/.test(v)) return "computer";
    if (v === "local") return "local";
    if (v === "live") return "live";
    if (v === "whatsapp") return "link";
    return "solo";
  }

  // The lines a taunt may use depend on the mode (see taunts.js): against the
  // computer the `_computer` pool replaces the generic one, and in every other
  // mode a line that mentions "the computer" is skipped, so a line can never
  // claim something the mode makes untrue. In a link or live game that has an
  // Admit defeat button, a "you're behind" taunt is sometimes the Admit defeat
  // nudge instead, and very rarely the button itself winks (shared.css).
  const recent = [];                 // the last few lines handed out, so the strip can find them
  function taunt(category, game) {
    const all = global.TAUNT_LINES || {};
    const kind = modeKind();
    const computer = kind === "computer";
    if (category === "lastChance" && (kind === "link" || kind === "live") && $(".wa-resign-row")) {
      if (Math.random() < 0.5) category = "losingHint";
      if (Math.random() < 0.1) {
        document.body.dataset.wink = "1";
        setTimeout(() => { delete document.body.dataset.wink; }, 20000);
      }
    }
    const mine = all[game || GAME_ID] || {};
    const ok = (l) => computer === /\bcomputer\b/i.test(l);
    // the generic pool has a few lines that mention the computer: only the computer mode may use them
    const gen = (c) => (((computer ? all._computer : all._) || {})[c] || []).filter((l) => computer || !/\bcomputer\b/i.test(l));
    // a category only the game defines (2048's "over-hard") has no generic pool and no mode filter
    const own = (c) => (mine[c] || []).filter((l) => ok(l) || !(all._ || {})[c]);
    const cat = gen(category).length || own(category).length ? category : "loss";
    const g = gen(cat), o = own(cat);
    const useOwn = o.length > 0 && (!g.length || Math.random() < 0.5);
    const pool = useOwn ? o : (g.length ? g : o);
    if (!pool.length) return "";
    const key = cat + ":" + (useOwn ? (game || GAME_ID) : computer ? "c" : "_");
    const seen = TAUNT_MEM.getJSON(key, []);
    const fresh = pool.filter((l) => seen.indexOf(l) === -1);
    const from = fresh.length ? fresh : pool;
    const line = from[Math.floor(Math.random() * from.length)];
    // forget the oldest once most of the pool has been used
    TAUNT_MEM.setJSON(key, seen.concat(line).slice(-Math.max(1, Math.floor(pool.length * 0.7))));
    recent.push(line);
    if (recent.length > 8) recent.shift();
    queueScan();
    return line;
  }

  // The big "whose move is it" pill (styled in shared.css). slot is 1 or 2
  // (the player's colour, --p1/--p2); pass a falsy slot to hide it. waiting
  // dims it for "it's the other side's move / the Computer is thinking". The
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

  /* ---------- The strip above the board: taunts, results, taunts from your opponent ----------
     Games put a taunt inside their small status line, which was easy to miss.
     Instead of editing every game, the strip watches the panel: when the
     status (or a share-panel note) contains a taunt Gamekit.taunt() handed out,
     or the status announces the result ("Red wins.", "Draw.", "Boom."), the
     text is shown big in this strip, right above the board, and the small
     original is hidden. The strip's space is reserved up front on the
     games that taunt, so nothing moves when a message arrives. */
  let slotEl = null, scanQueued = false;
  function ensureSlot() {
    if (slotEl && slotEl.isConnected) return slotEl;
    const panel = $(".panel");
    if (!panel || !/\bg-/.test(document.body.className)) return null;
    slotEl = document.createElement("div");
    slotEl.id = "gk-slot";
    slotEl.className = "gk-slot";
    if (document.getElementById("wa-ui") || GAME_ID === "2048") slotEl.dataset.reserve = "1";
    const say = document.createElement("p");
    say.className = "gk-say";
    say.hidden = true;
    say.setAttribute("aria-live", "polite");
    const msg = document.createElement("div");
    msg.className = "gk-msg";
    msg.hidden = true;
    msg.setAttribute("role", "status");
    slotEl.append(say, msg);
    const ref = document.getElementById("wa-ui");
    if (ref) ref.after(slotEl);
    else {
      let b = document.getElementById("board");
      if (b) { while (b.parentNode !== panel) b = b.parentNode; b.before(slotEl); } else panel.appendChild(slotEl);
    }
    return slotEl;
  }

  const END_RE = /(\bwins?\b[.!]|\bwins the match|\byou win\b|\byou won\b|^draw\s*[.—:!-]|\bstalemate\b|\bcheckmate\b|\bcracked it\b|\bout of guesses\b|\bboom\b|\bsolved\b|\bit's a draw\b|\byou lose\b)/i;
  const WIN_RE = /\b(you win|you won|cracked it|solved)\b/i;
  const BAD_RE = /\b(computer wins|you lose|boom|out of guesses|lost)\b/i;

  function scan() {
    scanQueued = false;
    const s = ensureSlot();
    if (!s) return;
    const msg = s.querySelector(".gk-msg");
    $$(".gk-moved").forEach((e) => e.classList.remove("gk-moved"));
    let src = null;
    if (recent.length) {
      src = $$("#over-msg, #status, .wa-note").find((e) => {
        const t = e.textContent;
        return t && recent.some((l) => t.indexOf(l) !== -1);
      }) || null;
    }
    if (!src) {
      const st = document.getElementById("status");
      const t = st ? st.textContent.trim() : "";
      if (t && t !== "Game over" && END_RE.test(t)) src = st;
    }
    let text = "", head = "", tone = "";
    if (src) {
      const full = src.textContent.replace(/^[\s·]+/, "").replace(/\s+/g, " ").trim();
      text = full;
      src.classList.add("gk-moved");
      // A taunt that follows an instruction ("Player 1: pick secretly. Player 1 —
      // taunt"): the taunt is the big text, the instruction stays small above it.
      // A result ("Red wins. Yellow — taunt") is kept whole.
      if (!END_RE.test(full)) {
        let at = -1;
        recent.forEach((l) => { const k = full.indexOf(l); if (k >= 0 && (at < 0 || k < at)) at = k; });
        const cut = Math.max(full.lastIndexOf(". ", at), full.lastIndexOf("! ", at), full.lastIndexOf("? ", at));
        if (at > 0 && cut >= 0) { head = full.slice(0, cut + 1); text = full.slice(cut + 2); }
      }
      tone = WIN_RE.test(full) ? "win" : BAD_RE.test(full) ? "bad" : "";
    }
    const key = head + "|" + text;
    if (msg.dataset.key !== key) {
      msg.dataset.key = key;
      msg.replaceChildren();
      if (head) { const h = mk("span", "gk-head"); h.textContent = head; msg.appendChild(h); }
      if (text) { const t = mk("span", "gk-tail"); t.textContent = text; msg.appendChild(t); }
    }
    msg.hidden = !text;
    msg.className = "gk-msg" + (tone ? " " + tone : "");
  }
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    (global.requestAnimationFrame || setTimeout)(scan);
  }
  function watchPanel() {
    const panel = $(".panel");
    if (!panel || typeof MutationObserver === "undefined") return;
    new MutationObserver((muts) => {
      if (muts.every((m) => slotEl && slotEl.contains(m.target))) return;
      queueScan();
    }).observe(panel, { childList: true, subtree: true, characterData: true });
    queueScan();
  }

  // A message FROM the opponent (online taunts): shown in the strip for a few seconds.
  let sayTimer = null;
  function say(text, kind) {
    const s = ensureSlot();
    if (!s) return;
    const p = s.querySelector(".gk-say");
    p.textContent = text;
    p.dataset.kind = kind || "";
    p.hidden = false;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { p.hidden = true; }, 6000);
  }

  /* ---------- Custom select ----------
     Replaces every native <select> with one styled, keyboard-accessible menu.
     The native element stays in the page (visually hidden) and stays the
     source of truth, so games keep reading and setting `.value`, listening
     for "change", toggling `hidden` on it or on its options. A value set
     from code is picked up by wrapping the element's own `value` property. */
  const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const SEL_VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  let selCount = 0;
  function enhanceSelect(sel) {
    if (sel.dataset.gk) return;
    sel.dataset.gk = "1";
    const id = "gk-sel-" + ++selCount;
    const wrap = mk("span", "gk-select");
    sel.before(wrap);
    wrap.appendChild(sel);
    sel.classList.add("gk-native");
    sel.tabIndex = -1;
    sel.setAttribute("aria-hidden", "true");
    const btn = mk("button", "gk-sel-btn");
    btn.type = "button";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", sel.getAttribute("aria-label") || "Choose");
    btn.innerHTML = '<span class="gk-t"></span><span class="gk-c" aria-hidden="true">▾</span>';
    const list = mk("ul", "gk-sel-list");
    list.id = id;
    list.setAttribute("role", "listbox");
    list.hidden = true;
    btn.setAttribute("aria-controls", id);
    wrap.append(btn, list);

    let items = [], active = 0;
    const text = (o) => (o.dataset.short || o.textContent).trim();
    function sync() {
      const o = sel.options[sel.selectedIndex];
      btn.firstChild.textContent = o ? text(o) : "";
      wrap.hidden = sel.hidden;
      btn.disabled = sel.disabled;
    }
    function mark() {
      Array.from(list.children).forEach((li, i) => {
        li.classList.toggle("on", i === active);
        li.setAttribute("aria-selected", items[i].value === sel.value ? "true" : "false");
      });
      const li = list.children[active];
      if (li && li.scrollIntoView) li.scrollIntoView({ block: "nearest" });
    }
    function open() {
      items = Array.from(sel.options).filter((o) => !o.hidden && !o.disabled);
      list.replaceChildren(...items.map((o) => {
        const li = mk("li");
        li.setAttribute("role", "option");
        li.textContent = o.textContent.trim();
        return li;
      }));
      active = Math.max(0, items.findIndex((o) => o.value === sel.value));
      list.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      mark();
    }
    function close(refocus) {
      list.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (refocus) btn.focus();
    }
    function choose(i) {
      const o = items[i];
      close(true);
      if (!o || o.value === sel.value) return;
      SEL_VALUE.set.call(sel, o.value);
      sync();
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    btn.addEventListener("click", () => (list.hidden ? open() : close(false)));
    btn.addEventListener("keydown", (e) => {
      if (list.hidden) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(); }
        return;
      }
      const n = items.length;
      if (e.key === "ArrowDown") active = (active + 1) % n;
      else if (e.key === "ArrowUp") active = (active + n - 1) % n;
      else if (e.key === "Home") active = 0;
      else if (e.key === "End") active = n - 1;
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); return choose(active); }
      else if (e.key === "Escape") { e.preventDefault(); return close(true); }
      else if (e.key === "Tab") return close(false);
      else return;
      e.preventDefault();
      mark();
    });
    list.addEventListener("click", (e) => {
      const li = e.target.closest("li");
      if (li) choose(Array.prototype.indexOf.call(list.children, li));
    });
    document.addEventListener("click", (e) => { if (!list.hidden && !wrap.contains(e.target)) close(false); });
    Object.defineProperty(sel, "value", {
      configurable: true,
      get() { return SEL_VALUE.get.call(sel); },
      set(v) { SEL_VALUE.set.call(sel, v); sync(); },
    });
    new MutationObserver(sync).observe(sel, { attributes: true, childList: true, subtree: true, characterData: true });
    sel.addEventListener("change", sync);
    sync();
  }

  /* ---------- One standard page layout ----------
     Every game page is rebuilt into the same shape on load, by MOVING its
     existing elements (so ids, listeners and the games' own code are
     untouched):
       top bar   ← all games · title ·······  theme · how to ?
       status row
       [ mode ▾ ][ Online ][ New game ]         (one line)
       difficulty / size / options              (chips, selects)
       share panel · taunt & result strip · the board
       undo · hint · flip · reset               (below the board) */
  const THEME_KEY = "games:theme";
  function themeButton() {
    const b = mk("button", "gk-theme");
    b.type = "button";
    const root = document.documentElement;
    const paint = () => {
      const m = root.getAttribute("data-theme");
      b.textContent = m === "light" ? "☀" : m === "dark" ? "☾" : "◐";
      b.setAttribute("aria-label", "Theme: " + (m || "system") + ". Tap to change.");
      b.title = "Theme: " + (m || "system");
    };
    b.addEventListener("click", () => {
      const cur = root.getAttribute("data-theme");
      const next = cur === "dark" ? "light" : cur === "light" ? null : "dark";
      if (next) root.setAttribute("data-theme", next); else root.removeAttribute("data-theme");
      try { next ? localStorage.setItem(THEME_KEY, next) : localStorage.removeItem(THEME_KEY); } catch (e) { /* ignore */ }
      paint();
    });
    paint();
    return b;
  }

  const ACT_ORDER = { undo: 1, "undo-btn": 1, "hint-btn": 2, flip: 3 };
  function layout() {
    const body = document.body, panel = $(".panel");
    if (!panel || !/\bg-/.test(body.className) || body.classList.contains("g-hub") || body.dataset.gkLayout) return;
    body.dataset.gkLayout = "1";

    const top = $(".topbar");
    if (top) {
      const how = $(".man-trigger", panel);
      const back = $(".back", top);
      if (back) {
        back.setAttribute("aria-label", "All games");
        back.innerHTML = '←<span class="gk-hide-sm">all games</span>';
        top.insertBefore(back, top.firstChild);
      }
      const right = mk("div", "gk-top-r");
      right.appendChild(themeButton());
      if (how) right.appendChild(how);
      top.appendChild(right);
    }

    const mode = $("#mode", panel);
    const kids = [];
    Array.from(panel.children).forEach((c) => {
      if (c.matches(".controls, .game-controls")) Array.from(c.children).forEach((k) => kids.push({ k: k, tool: false, box: c }));
      else if (c.matches(".toolbar")) Array.from(c.children).forEach((k) => kids.push({ k: k, tool: true, box: c }));
    });
    const ctl = mk("div", "gk-ctl");
    const opts = mk("div", "gk-opts");
    let acts = Array.from(panel.children).find((c) => c.matches(".toolbar"));
    if (!acts) acts = mk("div", "toolbar");
    acts.classList.add("gk-acts");
    const newBtns = [];
    kids.forEach(({ k, tool }) => {
      if (k === mode) ctl.insertBefore(k, ctl.firstChild);
      else if (k.id === "new-btn" || k.id === "reset" || (k.id === "reset-btn" && /new/i.test(k.textContent))) newBtns.push(k);
      else if (tool || k.id in ACT_ORDER) { k.style.order = ACT_ORDER[k.id] || 9; acts.appendChild(k); }
      else opts.appendChild(k);
    });
    newBtns.forEach((b) => {
      b.classList.remove("primary");
      b.classList.add("btn", "ghost", "tool-btn", "gk-new");
      b.innerHTML = '<span class="glyph">↻</span> New game';
      ctl.appendChild(b);
    });
    const row = $(".row", panel) || null;
    if (row) row.after(ctl, opts); else panel.prepend(ctl, opts);
    kids.forEach(({ box }) => { if (box !== acts && !box.children.length) box.remove(); });
    if (!acts.isConnected) { const fn = $(".footer-note", panel); if (fn) fn.before(acts); else panel.appendChild(acts); }
    if (!acts.children.length) acts.hidden = true;
    if (!ctl.children.length) ctl.hidden = true;
  }

  function init() {
    layout();
    $$("select").forEach(enhanceSelect);
    watchPanel();
  }
  init();

  global.Gamekit = {
    mulberry32,
    dailySeed,
    randomSeed,
    shuffle,
    storage,
    fmtTime,
    wireDifficultyChips,
    taunt,
    modeKind,
    say,
    turn,
    resume,
    notice,
  };
})(window);
