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
  const ABOUT_OTHERS = /\b(opponents?|opponent's|rivals?|enem(y|ies)|friends?|they|them|their|theirs|humans?|mates?|everyone|group[- ]chat|your (side|team))\b/i;
  const recent = [];                 // the last few lines handed out, so the strip can find them
  const NO_TAUNT = global.NO_TAUNT || [];
  function taunt(category, game) {
    if (NO_TAUNT.indexOf(GAME_ID) !== -1) return "";    // this game gets no commentary (see BANTER.md)
    const all = global.TAUNT_LINES || {};
    const kind = modeKind();
    const computer = kind === "computer";
    const solo = kind === "solo";                 // nobody to play against: no line about an opponent, friends or the group chat
    if (category === "lastChance" && (kind === "link" || kind === "live") && $(".wa-resign-row")) {
      if (Math.random() < 0.5) category = "losingHint";
      if (Math.random() < 0.1) {
        document.body.dataset.wink = "1";
        setTimeout(() => { delete document.body.dataset.wink; }, 20000);
      }
    }
    const mine = all[game || GAME_ID] || {};
    const ok = (l) => computer === /\bcomputer\b/i.test(l) && !(solo && ABOUT_OTHERS.test(l));
    // the generic pool has a few lines that mention the computer: only the computer mode may use them
    const gen = (c) => (((computer ? all._computer : all._) || {})[c] || []).filter((l) => (computer || !/\bcomputer\b/i.test(l)) && !(solo && ABOUT_OTHERS.test(l)));
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
    if (document.getElementById("wa-ui") || GAME_ID === "2048" || document.querySelector("[data-reserve]")) slotEl.dataset.reserve = "1";
    const say = document.createElement("p");
    say.className = "gk-say";
    say.hidden = true;
    say.setAttribute("aria-live", "polite");
    const msg = document.createElement("div");
    msg.className = "gk-msg";
    msg.hidden = true;
    msg.setAttribute("role", "status");
    slotEl.append(say, msg);
    // The share panel now lives below the board (async-share parks it there),
    // so "after #wa-ui" would put the result strip below the board too and make
    // the page taller. Keep the strip above the board as it always was.
    let b = document.getElementById("board") || document.getElementById("bs-board") ||
      document.getElementById("ld-board") || document.querySelector("[data-board]");
    if (b) { while (b.parentNode && b.parentNode !== panel) b = b.parentNode; }
    if (b && b.parentNode === panel) panel.insertBefore(slotEl, b);
    else {
      const ref = document.getElementById("wa-ui");
      if (ref) ref.after(slotEl);
      else panel.appendChild(slotEl);
    }
    return slotEl;
  }

  const END_RE = /(\bwins?\b[.!]|\bwins the match|\byou win\b|\byou won\b|^draw\s*[.—:!-]|\bstalemate\b|\bcheckmate\b|\bcracked it\b|\bout of guesses\b|\bboom\b|\bsolved\b|\bit's a draw\b|\byou lose\b|^game over[.!:]\s+\S)/i;
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
    let text = "", head = "", tone = "", ended = null;
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
      if (END_RE.test(full) || /\bgame over\b/i.test(full)) ended = full;
    }
    // fun pages: the result and its taunt get their own card instead of the strip (Crazy 8 has its own)
    if (document.body.classList.contains("fun") && !document.getElementById("c8-over")) {
      if (ended) {
        // a page that animates its win first (a line drawn, a disc landing) says data-over-delay="ms": the card waits for it
        const wait = +document.body.dataset.overDelay || 0;
        if (!wait || overReady === ended) showOver(ended, tone);
        else if (overPending !== ended) { overPending = ended; setTimeout(() => { overReady = ended; queueScan(); }, wait); }
        text = ""; head = "";
      } else hideOver();
    }
    // "Yellow — taunt" / "Player 2: taunt": the name says who the line is FOR, but
    // reads as if they said it. Lift it out into a "For Yellow" label.
    let to = "";
    recent.forEach((l) => {
      const k = text.indexOf(l);
      const m = k > 0 && /(?:^|[.!?] )([^.!?—:]{1,24}?) (?:—|:) $/.exec(text.slice(0, k));
      if (m && !to) {
        to = m[1];
        const pre = text.slice(0, k - m[1].length - 3).trim();
        text = text.slice(k);
        if (pre) head = head ? head + " " + pre : pre;
      }
    });
    const key = head + "|" + to + "|" + text;
    if (msg.dataset.key !== key) {
      msg.dataset.key = key;
      msg.replaceChildren();
      if (head) { const h = mk("span", "gk-head"); h.textContent = head; msg.appendChild(h); }
      if (to) { const f = mk("span", "gk-to"); f.textContent = "For " + to; msg.appendChild(f); }
      if (text) { const t = mk("span", "gk-tail"); t.textContent = text; msg.appendChild(t); }
    }
    msg.hidden = !text;
    msg.className = "gk-msg" + (tone ? " " + tone : "");
    // the steady layout gives the message a fixed-height box: shrink a long taunt until it fits instead of cutting it off
    const tail = msg.querySelector(".gk-tail");
    if (tail && !msg.hidden) {
      tail.style.fontSize = "";
      const fit = () => { for (let em = 1.25; em > 0.7 && msg.scrollHeight > msg.clientHeight + 1; em -= 0.05) tail.style.fontSize = em.toFixed(2) + "em"; };
      const hd = msg.querySelector(".gk-head");
      if (hd) hd.style.display = "";
      fit();
      if (hd && msg.scrollHeight > msg.clientHeight + 1) { hd.style.display = "none"; tail.style.fontSize = ""; fit(); }   // still too long: drop the small line above
      const to = msg.querySelector(".gk-to");
      if (to) to.style.display = "";
      if (to && msg.scrollHeight > msg.clientHeight + 1) { to.style.display = "none"; tail.style.fontSize = ""; fit(); }   // and, last resort, the "For Player 1" label
    }
  }
  /* ---------- Game over card (fun pages) ---------- */
  let overEl = null, overKey = "", overPending = null, overReady = null;
  const ICON_TROPHY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V17h3v2H8v-2h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3zM6 7v1a2 2 0 0 0 1.5 1.9A5 5 0 0 1 7 8.3V7zm12 0h-1v1.3a5 5 0 0 1-.5 1.6A2 2 0 0 0 18 8z"/></svg>';
  const ICON_HOME = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z"/></svg>';
  // Wins in a "winlog" (a list of win times): today, the last 7 days, all time. Crazy 8's own card uses it too.
  function winCounts(log) {
    const now = new Date(), day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return { today: log.filter((x) => x >= day).length, week: log.filter((x) => x >= now.getTime() - 7 * 864e5).length, all: log.length };
  }
  function hideOver() { overKey = ""; overPending = overReady = null; if (overEl) { overEl.remove(); overEl = null; } }
  function showOver(full, tone) {
    if (overKey === full) return;                 // already shown (or dismissed) for this result
    overKey = full;
    if (overEl) overEl.remove();
    const m = /^(.*?[.!?])\s+([\s\S]*)$/.exec(full);
    const result = (m ? m[1] : full).replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, "").trim();
    const taunt = m ? m[2].replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, "").replace(/\s+/g, " ").trim() : "";
    const draw = /^draw/i.test(full);
    const st = storage(GAME_ID + ":");
    let log = st.getJSON("winlog", []);
    if (window.track) track("game_over", { result: tone === "win" ? "win" : draw ? "draw" : "loss" });
    if (tone === "win") { log = log.concat(Date.now()).slice(-1000); st.set("winlog", JSON.stringify(log)); }
    const c = winCounts(log), counts = [["Today", c.today], ["This week", c.week], ["All time", c.all]];
    overEl = mk("div", "gk-over " + (tone || (draw ? "draw" : "")));
    overEl.setAttribute("role", "dialog"); overEl.setAttribute("aria-label", "Game over");
    const card = mk("div", "card");
    const h = mk("h2"); h.textContent = tone === "win" ? "You won!" : draw ? "Draw" : "Game over";
    const big = mk("div", "big"); big.textContent = result;
    const norm = (t) => t.toLowerCase().replace(/[^a-z ]/g, "").trim();
    card.append(h);
    if (norm(result) !== norm(h.textContent)) card.append(big);        // "You won!" twice is noise
    if (taunt) { const q = mk("p", "taunt"); q.textContent = taunt; card.append(q); }
    const stats = mk("div", "stats");
    const h3 = mk("h3"); h3.textContent = "Your wins"; stats.append(h3);
    counts.forEach(([label, v], i) => {
      const row = mk("div", "row t" + (i + 1));
      row.innerHTML = ICON_TROPHY;
      const l = mk("span"); l.textContent = label; const n = mk("span", "v"); n.textContent = String(v);
      row.append(l, n); stats.append(row);
    });
    if (!document.body.hasAttribute("data-no-wins")) card.append(stats);
    const acts = mk("div", "acts");
    const home = mk("a", "home"); home.href = "../"; home.setAttribute("aria-label", "All games"); home.innerHTML = ICON_HOME;
    // puzzle pages say data-next="Next level": the card then offers the next puzzle (their New button) instead of a replay
    const nextLabel = document.body.dataset.next;
    const again = mk("button", "again"); again.type = "button"; again.textContent = nextLabel || "Play again";
    again.addEventListener("click", () => {
      hideOver();
      const n = (nextLabel && document.getElementById("new-btn")) || document.querySelector(".gk-new, #reset-btn, #new-btn, #reset");
      if (n) n.click();
    });
    acts.append(home, again);
    const view = mk("button", "view"); view.type = "button"; view.textContent = "View board";
    view.addEventListener("click", () => { if (overEl) { overEl.remove(); overEl = null; } });
    overEl.append(card, acts, view);
    // a win gets a burst of confetti and a pop on the headline
    if (tone === "win" && !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      const conf = mk("div", "confetti"), cols = ["#ffbf2e", "#ff5a52", "#2fe3b9", "#5b3df5", "#ff7ab8", "#fff"];
      for (let i = 0; i < 30; i++) {
        const dot = mk("i"), a = (i / 30) * Math.PI * 2 + Math.random() * 0.4, d = 110 + Math.random() * 170;
        dot.style.cssText = "--x:" + Math.round(Math.cos(a) * d) + "px;--y:" + Math.round(Math.sin(a) * d - 40) + "px;--c:" + cols[i % cols.length] + ";--d:" + Math.round(Math.random() * 160) + "ms";
        conf.appendChild(dot);
      }
      overEl.append(conf);
    }
    document.body.appendChild(overEl);
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
      place();
      mark();
    }
    // keep the open list on screen: slide it left if it would run past the right edge (or right, past the left),
    // so it can never push the page sideways
    function place() {
      list.style.left = "";
      const vw = document.documentElement.clientWidth, pad = 8;
      list.style.maxWidth = (vw - 2 * pad) + "px";
      const r = list.getBoundingClientRect();
      let shift = 0;
      if (r.right > vw - pad) shift = (vw - pad) - r.right;
      if (r.left + shift < pad) shift = pad - r.left;
      if (shift) list.style.left = shift + "px";
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
      b.textContent = m === "light" ? "\u2600\uFE0E" : m === "dark" ? "☾" : "◐";
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
    let sideSel = null;
    kids.forEach(({ k, tool }) => {
      if (k === mode) ctl.insertBefore(k, ctl.firstChild);
      else if (k.id === "side" && k.tagName === "SELECT") sideSel = k;          // "play as": right beside the mode menu
      else if (k.id === "new-btn" || k.id === "reset" || (k.id === "reset-btn" && /new/i.test(k.textContent))) newBtns.push(k);
      else if (tool || k.id in ACT_ORDER) { k.style.order = ACT_ORDER[k.id] || 9; acts.appendChild(k); }
      else opts.appendChild(k);
    });
    if (sideSel) ctl.insertBefore(sideSel, mode ? mode.nextSibling : ctl.firstChild);
    newBtns.forEach((b) => {
      b.classList.remove("primary");
      b.classList.add("btn", "ghost", "tool-btn", "gk-new");
      b.innerHTML = '<span class="glyph">↻</span> New game';
      ctl.appendChild(b);
    });
    const row = $(".row", panel) || null;
    // data-fun-zone pages: the menus live in a popover under the Options button, so opening them never moves the board
    const menu = "funZone" in body.dataset ? mk("div", "gk-menu") : null;
    if (menu) {
      menu.append(ctl, opts);
      const wrap = mk("div", "gk-optwrap");
      wrap.append(menu);
      if (row) row.after(wrap); else panel.prepend(wrap);
    } else if (row) row.after(ctl, opts); else panel.prepend(ctl, opts);
    kids.forEach(({ box }) => { if (box !== acts && !box.children.length) box.remove(); });
    if (!acts.isConnected) { const fn = $(".footer-note", panel); if (fn) fn.before(acts); else panel.appendChild(acts); }
    if (!acts.children.length) acts.hidden = true;
    if (!ctl.children.length) ctl.hidden = true;

    // Once you start playing (first tap on the board) the menus fold away; "Options" brings them back.
    if (ctl.children.length || opts.children.length) {
      const ob = mk("button", "btn ghost gk-optbtn");
      ob.type = "button";
      ob.setAttribute("aria-label", "Options");      // Hearts, Ludo and Battleship show only the gear: without this it has no name for a screen reader
      ob.innerHTML = '<svg class="gk-gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg><span>Options</span>';
      ob.addEventListener("click", () => body.classList.toggle("gk-play"));
      (menu || ctl).before(ob);
      if (menu) {
        body.classList.add("gk-play");     // closed to start with: the board is the first thing you see
        // choosing something from a dropdown in the popover (mode, level, play as...) is the end of that visit: fold it away
        menu.addEventListener("change", (e) => { if (e.target.tagName === "SELECT") body.classList.add("gk-play"); });
      }
      panel.addEventListener("click", (e) => {
        if (!e.target.closest(".gk-ctl, .gk-opts, .gk-acts, .gk-optbtn, .row, .wa-ui, [id$='-room'], select, input, a")) body.classList.add("gk-play");
      });
    }
  }

  // Anything that newly appears in a board square (a stone, a mark, a number, a piece) pops in. The board is watched,
  // so a game only has to call Gamekit.popFilled(boardElement) once: after every change the squares are compared with
  // the last look, and a square that was in the board's usual "empty" state and now is not gets a short pop. Highlights
  // (last move, selection, hints) do not count. Quiet on a restore or a rebuild: only a handful of squares may pop.
  const TRANSIENT = /\b(last|lastw|sel|selected|hint|dest|cap|selectable|focus|focused|peer|hl|highlight|hover|drag|bad|error|win|ghost|fade-in|merged|invalid|cand|active)\b/g;
  function popFilled(container, opts) {
    if (!container || typeof MutationObserver === "undefined" || !container.animate) return;
    let prev = null;
    const sigOf = (c) => String(c.className && c.className.baseVal !== undefined ? c.className.baseVal : c.className).replace(TRANSIENT, "").replace(/\s+/g, " ").trim() + "|" + (c.textContent || "").trim();
    let queued = false;
    const check = () => {
      queued = false;
      const kids = Array.from(container.children).filter((c) => c.tagName !== "svg" && !/^(ttt-line|zp-|bs-hull)/.test(String(c.className.baseVal !== undefined ? c.className.baseVal : c.className)));
      const sigs = kids.map(sigOf);
      const before = prev;
      prev = sigs;
      if (!before || before.length !== sigs.length) return;
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const split = (x) => { const i = x.indexOf("|"); return { cls: new Set(x.slice(0, i).split(" ").filter(Boolean)), text: x.slice(i + 1) }; };
      const fresh = [];
      for (let i = 0; i < sigs.length; i++) {
        if (sigs[i] === before[i]) continue;
        const now = split(sigs[i]), was = split(before[i]);
        // newly filled: it gained text, changed its text, or gained a class it did not have (a stone, a mark, a colour)
        if ((now.text && now.text !== was.text) || [...now.cls].some((t) => !was.cls.has(t))) fresh.push(i);
      }
      if (!fresh.length || fresh.length > 6) return;
      fresh.forEach((i) => {
        const target = (opts && opts.inner && kids[i].querySelector(opts.inner)) || kids[i];
        target.animate([{ transform: "scale(.5)", opacity: 0.2 }, { transform: "scale(1.16)", opacity: 1, offset: 0.55 }, { transform: "scale(1)", opacity: 1 }], { duration: 260, easing: "cubic-bezier(.2,.9,.3,1.2)" });
      });
    };
    new MutationObserver(() => { if (!queued) { queued = true; Promise.resolve().then(check); } }).observe(container, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    check();
  }

  // A piece that has moved glides from its old square to its new one. Pieces of one kind (their class) are compared
  // before and after each change of the board: when exactly one square of that kind was left and one was reached,
  // the piece that arrived travels from the one that was left. Anything bigger (a resize, a new game) is ignored.
  function glidePieces(container, sel) {
    if (!container || typeof MutationObserver === "undefined" || !container.animate) return;
    let prev = null, queued = false;
    const snap = () => {
      const m = new Map();
      container.querySelectorAll(sel).forEach((el) => {
        const r = el.getBoundingClientRect(), key = String(el.className.baseVal !== undefined ? el.className.baseVal : el.className).replace(/\s+/g, " ").trim();
        if (!r.width) return;
        if (!m.has(key)) m.set(key, []);
        m.get(key).push({ el: el, x: r.left + r.width / 2, y: r.top + r.height / 2 });
      });
      return m;
    };
    const near = (a, b) => Math.abs(a.x - b.x) < 3 && Math.abs(a.y - b.y) < 3;
    const check = () => {
      queued = false;
      const now = snap(), before = prev;
      prev = now;
      if (!before || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
      now.forEach((list, key) => {
        const old = before.get(key) || [];
        if (old.length !== list.length) return;
        const gone = old.filter((o) => !list.some((n) => near(o, n))), came = list.filter((n) => !old.some((o) => near(o, n)));
        if (gone.length !== 1 || came.length !== 1) return;
        const dx = gone[0].x - came[0].x, dy = gone[0].y - came[0].y;
        if (Math.hypot(dx, dy) < 4) return;
        came[0].el.animate([{ transform: "translate(" + dx + "px," + dy + "px) scale(1.1)", zIndex: 5 }, { transform: "translate(0,0) scale(1)", zIndex: 5 }], { duration: 300, easing: "cubic-bezier(.3,.7,.2,1)" });
      });
    };
    new MutationObserver(() => { if (!queued) { queued = true; Promise.resolve().then(check); } }).observe(container, { childList: true, subtree: true });
    // A piece dragged under the finger is already where it lands: glide from where it was let go, not from its old square
    // (Car Park's car jumped back to its start and then slid, so a drag seemed to lag).
    window.addEventListener("pointerup", () => {
      if (prev && Array.from(container.querySelectorAll(sel)).some((el) => el.style.transform)) prev = snap();
    }, true);
    window.addEventListener("resize", () => { prev = null; setTimeout(() => { prev = snap(); }, 50); });
    check();
  }

  // A dice roll, the same in every dice game: each die turns over once while its faces flick past, then lands on the
  // number rolled. dice = [{ el, v }]: el is the die itself (what turns), v the number it lands on; paint(el, n) draws
  // face n into el (the game's own drawing). Neighbouring dice turn opposite ways. A die rolled again restarts cleanly.
  // Resolves when every die has landed. Under reduced motion the dice are just painted.
  // Where the pips of each die face sit on a 3x3 grid (0 = top left, 8 = bottom right): every dice game draws from this.
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  // A die drawn as nine <i> cells: light the ones face v uses.
  function paintPips(el, v) {
    const on = new Set(PIPS[v] || []);
    el.querySelectorAll("i").forEach((p, j) => { p.className = on.has(j) ? "on" : ""; });
  }
  const ROLL_MS = 520, FLICK_MS = 90;
  function rollDice(dice, paint) {
    const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return Promise.all(dice.map((d, k) => new Promise((done) => {
      const el = d.el;
      clearInterval(el.__gkRoll);
      if (still || !el.animate) { paint(el, d.v); return done(); }
      el.getAnimations().forEach((a) => { if (a.id === "gk-roll") a.cancel(); });
      const turn = k % 2 ? -1 : 1;
      el.animate([
        { transform: "rotate(0deg) scale(.92)" },
        { transform: "rotate(" + turn * 200 + "deg) scale(1.12)", offset: 0.5 },
        { transform: "rotate(" + turn * 360 + "deg) scale(1)" },
      ], { duration: ROLL_MS, easing: "cubic-bezier(.25, .8, .3, 1)", id: "gk-roll" });
      let n = 0;
      paint(el, (d.v % 6) + 1);
      el.__gkRoll = setInterval(() => {
        if (++n < 5) return paint(el, ((d.v + n * 2 + k) % 6) + 1);
        clearInterval(el.__gkRoll); el.__gkRoll = null;
        paint(el, d.v);
        done();
      }, FLICK_MS);
    })));
  }

  // Every Undo button gets the same clean line icon (the one Mini Sudoku has) instead of a text arrow.
  const UNDO_ICON = '<svg class="gk-undo-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>';
  function undoIcons() {
    $$("#undo-btn, #undo").forEach((b) => {
      if (b.querySelector("svg")) return;
      const g = b.querySelector(".glyph");
      if (g) g.remove();
      b.insertAdjacentHTML("afterbegin", UNDO_ICON);
    });
  }

  // Chrome occasionally suppresses :active on a link once it starts its drag
  // gesture, so the back/Home buttons also get a pressed class from pointerdown.
  // The class drives exactly the same CSS as :active (see fun.css).
  function pressedFeedback() {
    document.addEventListener("pointerdown", (e) => {
      const t = e.target && e.target.closest && e.target.closest(".topbar .back, .gk-over .home");
      if (!t) return;
      t.classList.add("gk-pressed");
      const off = () => {
        t.classList.remove("gk-pressed");
        document.removeEventListener("pointerup", off, true);
        document.removeEventListener("pointercancel", off, true);
      };
      document.addEventListener("pointerup", off, true);
      document.addEventListener("pointercancel", off, true);
    }, true);
  }

  // Coming from the hub, Back/Home step back in history instead of loading the hub again: the browser
  // restores the page it kept (instant, scroll kept) rather than waiting on the network.
  function backIsHistory() {
    document.addEventListener("click", (e) => {
      const t = e.target && e.target.closest && e.target.closest(".topbar .back, .gk-over .home");
      if (!t || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
      let ref; try { ref = new URL(document.referrer); } catch (err) { return; }
      const to = new URL(t.getAttribute("href") || "", location.href);
      if (history.length < 2 || ref.origin !== location.origin || ref.pathname !== to.pathname || ref.search || to.search) return;
      e.preventDefault();
      history.back();
    });
  }

  // PC side panels (pages with data-desk-panels; the CSS is at the end of fun.css). While the window is wide and tall
  // enough, the status line and Options go to a left panel and the action buttons and hints to a right one; each moved
  // element leaves a comment marker so it goes back to exactly its place when the window shrinks.
  function deskPanels() {
    const panel = $(".panel");
    // on by default for every fun page; a page that cannot take the panels sets data-no-desk on the body
    if (document.body.classList.contains("fun") && !document.body.hasAttribute("data-no-desk")) document.body.setAttribute("data-desk-panels", "");
    if (!panel || !document.body.hasAttribute("data-desk-panels") || !global.matchMedia) return;
    const mq = global.matchMedia("(min-width: 1000px) and (min-height: 560px)");
    let moved = [], left = null, right = null;
    function park(el, side) {
      if (global.getComputedStyle(el).position === "fixed") return;      // a page that pins its gear in the header keeps it there
      const mark = document.createComment("gk-desk");
      el.before(mark); side.append(el); moved.push([el, mark]);
    }
    function apply() {
      if (mq.matches && !moved.length) {
        left = mk("div", "gk-side gk-side-l"); right = mk("div", "gk-side gk-side-r");
        $$(":scope > .turn, :scope > .row, :scope > .gk-slot, :scope > .gk-optwrap", panel).forEach((el) => park(el, left));
        $$(":scope > .gk-acts, :scope > .footer-note", panel).forEach((el) => park(el, right));
        panel.prepend(left, right); panel.classList.add("gk-desk");
      } else if (!mq.matches && moved.length) {
        moved.forEach(([el, mark]) => mark.replaceWith(el));
        moved = []; left.remove(); right.remove(); panel.classList.remove("gk-desk");
      }
    }
    // the turn pill and message strip are built after this runs: park them as they arrive
    new MutationObserver(() => { if (moved.length) $$(":scope > .turn, :scope > .gk-slot", panel).forEach((el) => park(el, left)); }).observe(panel, { childList: true });
    (mq.addEventListener ? mq.addEventListener("change", apply) : mq.addListener(apply));
    apply();
  }

  // Keep the pages and files in the phone's own storage (sw.js) so games open fast and single-player ones work offline.
  // Skipped under test automation (it would cache across checks) unless a test asks for it with localStorage "wa:sw".
  function keepOffline() {
    if (!("serviceWorker" in navigator) || !(location.protocol === "https:" || location.hostname === "localhost")) return;
    try { if (navigator.webdriver && !localStorage.getItem("wa:sw")) return; } catch (e) { /* storage blocked: register anyway */ }
    global.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
  }

  function init() {
    backIsHistory();
    keepOffline();
    undoIcons();
    layout();
    deskPanels();
    $$("select").forEach(enhanceSelect);
    watchPanel();
    pressedFeedback();
  }
  init();

  // A question card in the site's own look (the same card as the game over screen) instead of the browser's grey confirm box.
  // Gamekit.ask({ title, text, ok, cancel, danger }) -> a promise of true (the ok button) or false (cancel, Escape, a tap outside).
  // Focus starts on Cancel so a stray Enter or tap never does the risky thing.
  function ask(o) {
    o = o || {};
    if (!document.body) return Promise.resolve(window.confirm(o.text || o.title || ""));
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const wrap = document.createElement("div");
      wrap.className = "gk-ask";
      wrap.setAttribute("role", "alertdialog"); wrap.setAttribute("aria-modal", "true"); wrap.setAttribute("aria-label", o.title || "Are you sure?");
      const card = document.createElement("div"); card.className = "card";
      if (o.title) { const h = document.createElement("h2"); h.textContent = o.title; card.append(h); }
      if (o.text) { const p = document.createElement("p"); p.textContent = o.text; card.append(p); }
      const acts = document.createElement("div"); acts.className = "acts";
      const no = document.createElement("button"); no.type = "button"; no.className = "no"; no.textContent = o.cancel || "Cancel";
      const yes = document.createElement("button"); yes.type = "button"; yes.className = "yes" + (o.danger === false ? " safe" : ""); yes.textContent = o.ok || "OK";
      acts.append(no, yes); card.append(acts); wrap.append(card);
      const done = (v) => { document.removeEventListener("keydown", onKey, true); wrap.remove(); try { if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ } resolve(v); };
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); }
        else if (e.key === "Tab") { e.preventDefault(); (document.activeElement === no ? yes : no).focus(); }
      }
      no.addEventListener("click", () => done(false));
      yes.addEventListener("click", () => done(true));
      wrap.addEventListener("click", (e) => { if (e.target === wrap) done(false); });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(wrap);
      no.focus({ preventScroll: true });
    });
  }

  global.Gamekit = {
    ask,
    popFilled,
    glidePieces,
    rollDice,
    winCounts,
    ICON_TROPHY,
    ICON_HOME,
    PIPS,
    paintPips,
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
