/* ============================================================
   letter-boxed/puzzle.js — the word list, the puzzles and the rules of Letter Boxed.

   A plain script that sets globalThis.LetterBoxed (the page loads it with a
   <script> tag; the test imports it for the same effect).

   THE GAME: twelve letters sit on the four sides of a box, three to a side.
   Spell words by moving from letter to letter; two letters in a row may never
   come from the same side. Each word must start with the last letter of the
   one before. Words are at least 3 letters and can't be used twice. Use all
   twelve letters to win, in as few words as you can.

   words.txt: the dictionary, one word per line, sorted. Each line is
   <tier><n><rest>: tier 0 (common) to 2 (rare), n = how many leading letters
   it shares with the line above (one base-36 digit), then the rest of the word.

   Generation uses only the seed and step counts (never the clock), so the
   daily puzzle is identical on every device and a bad seed can't hang a page.
   ============================================================ */
(function (g) {
  "use strict";

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

  const bitsOf = (w) => { let m = 0; for (let i = 0; i < w.length; i++) m |= 1 << (w.charCodeAt(i) - 97); return m; };

  // decode words.txt into { list: [word], tier: Map word -> 0..2, mask: [each word's letters as a 26-bit set] }
  function parseWords(text) {
    const list = [], tier = new Map(), mask = [];
    let prev = "";
    for (const line of text.split("\n")) {
      if (line.length < 2) continue;
      const w = prev.slice(0, parseInt(line[1], 36)) + line.slice(2);
      list.push(w); tier.set(w, line.charCodeAt(0) - 48); mask.push(bitsOf(w));
      prev = w;
    }
    return { list, tier, mask };
  }

  // does the word obey the box? sideOf: letter -> side 0..3
  function fits(word, sideOf) {
    let last = -1;
    for (let i = 0; i < word.length; i++) {
      const s = sideOf[word[i]];
      if (s === undefined || s === last) return false;
      last = s;
    }
    return true;
  }

  // a shuffled copy (Fisher-Yates with our own rng, so every browser gives the same order)
  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // split 12 letters into 4 sides of 3 so that no two letters that follow each other in a solution word share a side
  function assignSides(letters, edges, rng, cap) {
    const order = shuffled(letters, rng);
    const side = {}, size = [0, 0, 0, 0];
    let steps = 0;
    function place(k) {
      if (k === 12) return true;
      if (++steps > cap) return false;
      const l = order[k];
      for (let s = 0; s < 4; s++) {
        if (size[s] >= 3) continue;
        if ((edges[l] || []).some((m) => side[m] === s)) continue;
        side[l] = s; size[s]++;
        if (place(k + 1)) return true;
        delete side[l]; size[s]--;
      }
      return false;
    }
    return place(0) ? side : null;
  }

  // per level: which dictionary tiers the solution words come from (hard: at least one rare word), and how many words the box should accept
  const LEVELS = { easy: { tier: 0, min: 500, max: 1e9 }, medium: { tier: 1, min: 250, max: 500 }, hard: { tier: 2, min: 150, max: 380, rare: true } };

  // a puzzle from a seed: { sides: ["abc", ...], solution: [w1, w2], valid: [every word the box accepts] } (or null if the seed is hopeless)
  function generate(dict, seed, level) {
    const lv = LEVELS[level] || LEVELS.medium, rng = mulberry32(seed);
    const pool = dict.list.filter((w) => w.length >= 5 && w.length <= 9 && dict.tier.get(w) <= lv.tier && !/(.)\1/.test(w) && new Set(w).size >= 5);
    const byFirst = {};
    for (const w of pool) (byFirst[w[0]] = byFirst[w[0]] || []).push(w);
    let best = null;
    for (let attempt = 0; attempt < 240; attempt++) {
      const w1 = pool[Math.floor(rng() * pool.length)];
      const nexts = byFirst[w1[w1.length - 1]] || [];
      if (!nexts.length) continue;
      let w2 = null;
      for (let k = 0; k < 120 && !w2; k++) {
        const c = nexts[Math.floor(rng() * nexts.length)];
        if (c !== w1 && new Set(w1 + c).size === 12) w2 = c;
      }
      if (!w2) continue;
      if (lv.rare && dict.tier.get(w1) < 2 && dict.tier.get(w2) < 2) continue;
      const edges = {};
      for (const w of [w1, w2]) for (let i = 1; i < w.length; i++) {
        (edges[w[i - 1]] = edges[w[i - 1]] || []).push(w[i]);
        (edges[w[i]] = edges[w[i]] || []).push(w[i - 1]);
      }
      const side = assignSides(Array.from(new Set(w1 + w2)), edges, rng, 4000);
      if (!side) continue;
      const box = bitsOf(w1 + w2), valid = [];
      for (let i = 0; i < dict.list.length; i++) if ((dict.mask[i] & ~box) === 0 && fits(dict.list[i], side)) valid.push(dict.list[i]);
      const p = { sides: [0, 1, 2, 3].map((s) => shuffled(Object.keys(side).filter((l) => side[l] === s), rng).join("")), solution: [w1, w2], valid };
      if (valid.length >= lv.min && valid.length <= lv.max) return p;
      // keep the closest miss in case no attempt lands in range
      const miss = valid.length < lv.min ? lv.min - valid.length : valid.length - lv.max;
      if (!best || miss < best.miss) best = { miss, p };
    }
    return best ? best.p : null;
  }

  // a word the player typed: "ok" or why not
  function check(p, validSet, word, usedWords, lastLetter) {
    if (word.length < 3) return "Words need at least 3 letters.";
    if (lastLetter && word[0] !== lastLetter) return "Start with " + lastLetter.toUpperCase() + ".";
    if (usedWords.includes(word)) return "You already used that word.";
    if (!validSet.has(word)) return "Not in the word list.";
    return "ok";
  }

  g.LetterBoxed = { parseWords, generate, fits, check, LEVELS, mulberry32 };
})(globalThis);
