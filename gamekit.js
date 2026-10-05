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
  // for the same result with no desync risk, and a game using this
  // doesn't need to touch its board-encoding at all.
  //
  //   loss        — the generic "you lost" line, any game, any mode.
  //   reversal    — for a player who got a `confidence` line earlier in
  //                 THIS game and then lost anyway. Callers track that
  //                 themselves (a simple per-game flag reset on new game)
  //                 and pick this category instead of `loss` when it
  //                 applies — Gamekit has no game state to track it from.
  //   confidence  — ironic encouragement for whoever's clearly ahead
  //                 mid-game, setting up a `reversal` line if they
  //                 blow it.
  //   lastChance  — near-defeat taunt for a generic "down to the wire"
  //                 moment (low material, one life left, etc). Games
  //                 whose losing moment has its own flavor (hangman's
  //                 noose) should keep a local pool instead of this one.
  const TAUNTS = {
    loss: [
      "Tough loss. Really tough.",
      "That's gonna leave a mark.",
      "Skill issue.",
      "Well, that happened.",
      "Painful to watch, honestly.",
      "Not your best game, champ.",
      "L + ratio.",
      "Your opponent is already bragging about this.",
      "Maybe try a different game. Or a different hobby.",
      "Better luck next time — you'll need it.",
      "Someone call it. Time of defeat: now.",
      "That was almost impressive. Almost.",
      "Was that... on purpose?",
      "A valiant effort. A losing one, but valiant.",
      "This is going straight in the group chat.",
      "Congratulations, you played yourself.",
      "Bold strategy. Didn't work though.",
      "Legends say they're still laughing.",
      "Put that one in the lowlight reel.",
      "History will remember this. Unkindly.",
      "Rebuilding the brand after this one.",
      "The scoreboard remembers.",
      "That's a screenshot for later.",
      "Someone's getting roasted in the group chat.",
      "Respectfully, that was rough.",
      "Not the comeback story you were hoping for.",
      "They really thought they had it.",
      "Defeat looks great on you, somehow.",
      "The algorithm predicted this.",
      "Certified L.",
      "Even the AI felt bad for a second. A second.",
      "That's one for the blooper reel.",
      "Someone update the leaderboard. Downward.",
      "A real character-building moment, that one.",
      "No notes. Just losses.",
      "The streak is dead. Long live the streak-ender.",
      "You brought a spoon to a sword fight.",
      "Somewhere, a trophy just cried.",
      "That was a choice. Not a good one.",
      "Filed under: things that didn't work.",
    ],
    reversal: [
      "Ouuu, spoke too soon.",
      "“You've got this in the bag,” they said.",
      "Famous last words.",
      "That confidence aged like milk.",
      "Counting chickens before they hatch, huh?",
      "Should've knocked on wood.",
      "Turns out the bag had a hole in it.",
      "Premature celebration detected.",
      "That escalated quickly.",
      "Plot twist nobody asked for.",
      "The bag. It had legs. It ran.",
      "Hubris: a cautionary tale.",
      "The overconfidence tax has been collected.",
      "Should've stayed humble. Too late now.",
      "That prediction aged in dog years.",
      "Victory was declared a bit early there.",
      "The universe has a sense of humor.",
      "Jinxed. Thoroughly jinxed.",
    ],
    confidence: [
      "You've got this in the bag.",
      "This one's basically over.",
      "Victory lap incoming?",
      "Looking pretty comfortable over there.",
      "Hard to see how this doesn't go your way.",
      "They might want to just forfeit now.",
      "Don't get too comfortable... actually, go ahead.",
      "This is looking like a blowout.",
      "Someone's about to update their bio to \"undefeated.\"",
      "Start drafting the victory speech.",
      "This might be the easiest win of the day.",
      "They're already celebrating. A little early, maybe.",
      "At this rate, it's basically a formality.",
      "The other side might want to tap out.",
      "Smooth sailing from here. Probably.",
      "This is what domination looks like.",
    ],
    lastChance: [
      "This is the part where you panic, right?",
      "One more slip and it's over.",
      "Living dangerously, huh?",
      "Still time to run.",
      "Hope you've got a backup plan. You don't. But hope anyway.",
      "This is fine. (It is not fine.)",
      "Down bad.",
      "It's not looking good — and it's about to look worse.",
      "The walls are closing in.",
      "Every move counts now. Every single one.",
      "This is the nervous part.",
      "No pressure. (So much pressure.)",
      "One wrong step and it's over.",
      "The margin for error just hit zero.",
      "Nowhere left to hide.",
      "Last call.",
    ],
  };
  function taunt(category, rng) {
    const pool = TAUNTS[category] || TAUNTS.loss;
    const pick = rng ? rng() : Math.random();
    return pool[Math.floor(pick * pool.length)];
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
  };
})(window);
