/* ============================================================
   word-search/puzzle.js — the Word Search grid generator and checks.

   A plain script (no modules) that sets globalThis.WordSearchPuzzle. The page
   loads it with a <script> tag after words.js; the test imports both for the
   same effect.

   A puzzle is { level, seed, n, grid, words }:
     grid   n rows of n lowercase letters, grid[row][col]
     words  [{ word, row, col, dr, dc }] where (row, col) is the first letter
            and (dr, dc) is one step along the word. dr/dc are -1, 0 or 1,
            never both 0. A word may run any of the eight ways, forwards or
            backwards.

   Generation is driven only by the seed: the same seed and level always make
   the same puzzle, on every device, so the daily puzzle is shared. Nothing
   reads the clock except dailySeed(), which uses the UTC date.

   Placement:
     - the chosen words are placed longest first, each in a random free line;
       a new word may cross an old one only where the letters already agree;
     - the empty cells are filled with random letters;
     - every target word is then scanned for. The one at its stored position
       is wanted; any other occurrence is erased by changing a free letter in
       it. If an accidental word is made entirely of placed letters the whole
       layout is thrown away and tried again. So a puzzle never has a target
       word hiding in a second place, which would make a swipe ambiguous.
   ============================================================ */
(function (g) {
  "use strict";

  const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
  const DIRS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
  const ATTEMPTS = 60;
  const REPAIR_STEPS = 120;

  const LEVELS = {
    easy:   { n: 8,  words: 6,  minLen: 4, maxLen: 5 },
    medium: { n: 10, words: 8,  minLen: 4, maxLen: 6 },
    hard:   { n: 12, words: 10, minLen: 5, maxLen: 7 },
  };

  // ---------- deterministic randomness ----------
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

  function hashStr(s) {
    let h = 2166136261 >>> 0;
    s = String(s);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  // ---------- the word pool ----------
  function allWords() {
    const w = g.WordSearchWords;
    return w && Array.isArray(w.ALL) ? w.ALL : [];
  }

  const reverse = (w) => w.split("").reverse().join("");
  const isPalindrome = (w) => w === reverse(w);

  // Pick the words for a puzzle. A word that sits inside another chosen word
  // ("rain" and "rainbow", "port" and "airport") is skipped, because the
  // longer word would then contain a second copy of the shorter target. The
  // same goes for the reverse of a word: "rose" sits inside "resort" written
  // backwards, so that pair is skipped too.
  function pickWords(rng, conf) {
    const pool = allWords().filter((w) =>
      typeof w === "string" &&
      w.length >= conf.minLen && w.length <= conf.maxLen &&
      /^[a-z]+$/.test(w) && !isPalindrome(w)
    );
    if (pool.length < conf.words) return null;
    const picked = [];
    const badPair = (a, b) => {
      const ra = reverse(a), rb = reverse(b);
      return a.indexOf(b) !== -1 || ra.indexOf(b) !== -1 || b.indexOf(a) !== -1 || rb.indexOf(a) !== -1;
    };
    for (const w of shuffle(pool, rng)) {
      if (picked.some((p) => badPair(w, p))) continue;
      picked.push(w);
      if (picked.length === conf.words) break;
    }
    return picked.length === conf.words ? picked : null;
  }

  // ---------- reading the grid ----------
  // null when the word would run off the board
  function readGrid(grid, word, row, col, dr, dc) {
    const n = grid.length;
    let out = "";
    for (let i = 0; i < word.length; i++) {
      const r = row + dr * i, c = col + dc * i;
      if (r < 0 || r >= n || c < 0 || c >= n) return null;
      out += grid[r][c];
    }
    return out;
  }

  function readAt(p, item) {
    return readGrid(p.grid, item.word, item.row, item.col, item.dr, item.dc);
  }

  // ---------- placing the words ----------
  const blank = (n) => Array.from({ length: n }, () => Array(n).fill(""));

  function placeWords(order, n, rng) {
    const grid = blank(n);
    const protectedCell = Array.from({ length: n }, () => Array(n).fill(false));
    const items = [];
    for (const word of order) {
      const candidates = [];
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          for (const [dr, dc] of DIRS) {
            const er = row + dr * (word.length - 1), ec = col + dc * (word.length - 1);
            if (er < 0 || er >= n || ec < 0 || ec >= n) continue;
            let ok = true;
            for (let i = 0; i < word.length; i++) {
              const here = grid[row + dr * i][col + dc * i];
              if (here && here !== word[i]) { ok = false; break; }
            }
            if (ok) candidates.push([row, col, dr, dc]);
          }
        }
      }
      if (!candidates.length) return null;
      const [row, col, dr, dc] = candidates[Math.floor(rng() * candidates.length)];
      for (let i = 0; i < word.length; i++) {
        grid[row + dr * i][col + dc * i] = word[i];
        protectedCell[row + dr * i][col + dc * i] = true;
      }
      items.push({ word: word, row: row, col: col, dr: dr, dc: dc });
    }
    return { grid: grid, items: items, protectedCell: protectedCell };
  }

  function fill(grid, rng) {
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (!grid[r][c]) grid[r][c] = ALPHABET[Math.floor(rng() * ALPHABET.length)];
      }
    }
  }

  // The first target word found somewhere other than its stored position.
  function extraHit(p) {
    for (const item of p.words) {
      for (let row = 0; row < p.n; row++) {
        for (let col = 0; col < p.n; col++) {
          for (const [dr, dc] of DIRS) {
            if (readGrid(p.grid, item.word, row, col, dr, dc) !== item.word) continue;
            if (row === item.row && col === item.col && dr === item.dr && dc === item.dc) continue;
            return { word: item.word, row: row, col: col, dr: dr, dc: dc };
          }
        }
      }
    }
    return null;
  }

  // Break accidental copies by changing a letter inside the copy that no
  // placed word owns. Returns false when the copy is made only of placed
  // letters: that layout cannot be repaired and the caller has to place the
  // words again.
  function repair(p, rng, protectedCell) {
    for (let step = 0; step < REPAIR_STEPS; step++) {
      const hit = extraHit(p);
      if (!hit) return true;
      const free = [];
      for (let i = 0; i < hit.word.length; i++) {
        const row = hit.row + hit.dr * i, col = hit.col + hit.dc * i;
        if (!protectedCell[row][col]) free.push([row, col]);
      }
      if (!free.length) return false;
      const [row, col] = free[Math.floor(rng() * free.length)];
      const old = p.grid[row][col];
      let ch = old;
      while (ch === old) ch = ALPHABET[Math.floor(rng() * ALPHABET.length)];
      p.grid[row][col] = ch;
    }
    return false;
  }

  // A good puzzle has at least one across, one down, one diagonal and one
  // word written backwards. Only a preference: a valid layout without all
  // four is still used if nothing better turns up.
  function hasVariety(items) {
    let across = false, down = false, diagonal = false, backwards = false;
    for (const item of items) {
      if (item.dr === 0) across = true;
      if (item.dc === 0) down = true;
      if (item.dr !== 0 && item.dc !== 0) diagonal = true;
      if (item.dr < 0 || (item.dr === 0 && item.dc < 0)) backwards = true;
    }
    return across && down && diagonal && backwards;
  }

  // ---------- the puzzle ----------
  function generate(seed, level) {
    seed = (Number(seed) >>> 0) || 0;
    const key = LEVELS[level] ? level : "medium";
    const conf = LEVELS[key];
    const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    const chosen = pickWords(rng, conf);
    if (!chosen) return null;

    let firstValid = null;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const order = shuffle(chosen, rng);
      order.sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
      const layout = placeWords(order, conf.n, rng);
      if (!layout) continue;
      const p = { level: key, seed: seed, n: conf.n, grid: layout.grid, words: layout.items };
      fill(p.grid, rng);
      if (!repair(p, rng, layout.protectedCell)) continue;
      if (!check(p)) continue;
      if (hasVariety(p.words)) return p;
      if (!firstValid) firstValid = p;
    }
    if (firstValid) return firstValid;

    // A safety net, never expected in practice: words in separate rows with
    // random offsets and directions, which always fits (10 words in 12 rows).
    const rng2 = mulberry32((seed ^ 0x51ed270b) >>> 0);
    for (let attempt = 0; attempt < 200; attempt++) {
      const grid = blank(conf.n);
      const protectedCell = Array.from({ length: conf.n }, () => Array(conf.n).fill(false));
      const items = [];
      let ok = true;
      for (const word of chosen) {
        let placed = false;
        for (let tries = 0; tries < 60 && !placed; tries++) {
          const row = Math.floor(rng2() * conf.n);
          const span = conf.n - word.length;
          if (span < 0) { ok = false; break; }
          const offset = Math.floor(rng2() * (span + 1));
          const dir = rng2() < 0.5 ? 1 : -1;
          const col = dir === 1 ? offset : offset + word.length - 1;
          let fits = true;
          for (let i = 0; i < word.length; i++) {
            if (grid[row][col + dir * i] && grid[row][col + dir * i] !== word[i]) { fits = false; break; }
          }
          if (!fits) continue;
          for (let i = 0; i < word.length; i++) {
            grid[row][col + dir * i] = word[i];
            protectedCell[row][col + dir * i] = true;
          }
          items.push({ word: word, row: row, col: col, dr: 0, dc: dir });
          placed = true;
        }
        if (!placed) { ok = false; break; }
      }
      if (!ok) continue;
      const p = { level: key, seed: seed, n: conf.n, grid: grid, words: items };
      fill(p.grid, rng2);
      if (!repair(p, rng2, protectedCell)) continue;
      if (check(p)) return p;
    }
    return null;
  }

  // ---------- daily puzzles ----------
  const dateString = (date) => (date instanceof Date ? date : new Date(date === undefined ? Date.now() : date)).toISOString().slice(0, 10);

  // The same formula gamekit.js uses for its dailies: date | level | game.
  function dailySeed(level, date) {
    const day = date === undefined ? dateString() : date instanceof Date ? dateString(date) : String(date);
    const key = LEVELS[level] ? level : "medium";
    return hashStr(day + "|" + key + "|word-search");
  }

  function generateDaily(level, date) {
    return generate(dailySeed(level, date), level);
  }

  // ---------- checks used by the page and the test ----------
  function check(p) {
    if (!p || !LEVELS[p.level] || p.n !== LEVELS[p.level].n) return false;
    if (!Array.isArray(p.grid) || p.grid.length !== p.n) return false;
    if (!Array.isArray(p.words) || p.words.length !== LEVELS[p.level].words) return false;
    for (const row of p.grid) {
      if (!Array.isArray(row) || row.length !== p.n) return false;
      if (!row.every((ch) => typeof ch === "string" && /^[a-z]$/.test(ch))) return false;
    }
    const seen = new Set();
    for (const item of p.words) {
      if (!item || typeof item.word !== "string" || !/^[a-z]{4,7}$/.test(item.word)) return false;
      if (!Number.isInteger(item.row) || !Number.isInteger(item.col)) return false;
      if (seen.has(item.word)) return false;
      seen.add(item.word);
      if (![1, 0, -1].includes(item.dr) || ![1, 0, -1].includes(item.dc)) return false;
      if (item.dr === 0 && item.dc === 0) return false;
      if (readAt(p, item) !== item.word) return false;
    }
    return true;
  }

  // Every target word, and where it can be read in the finished grid. Each
  // word should have exactly one hit, the stored one.
  function scan(p) {
    const out = {};
    if (!p || !Array.isArray(p.grid) || !Array.isArray(p.words)) return out;
    for (const item of p.words) {
      const hits = [];
      for (let row = 0; row < p.n; row++) {
        for (let col = 0; col < p.n; col++) {
          for (const [dr, dc] of DIRS) {
            if (readGrid(p.grid, item.word, row, col, dr, dc) === item.word) hits.push({ row: row, col: col, dr: dr, dc: dc });
          }
        }
      }
      out[item.word] = hits;
    }
    return out;
  }

  g.WordSearchPuzzle = {
    LEVELS: LEVELS,
    DIRS: DIRS,
    generate: generate,
    generateDaily: generateDaily,
    dailySeed: dailySeed,
    check: check,
    scan: scan,
    readAt: readAt,
    mulberry32: mulberry32,
    hashStr: hashStr,
  };
})(globalThis);
