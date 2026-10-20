/* ============================================================
   sliding-puzzle/puzzle.js — the puzzles and the rules of the Sliding Puzzle.

   A plain script that sets globalThis.SlidingPuzzle (the page loads it with a
   <script> tag, the test imports it for the same effect).

   An n x n tray holds the numbers 1 .. n*n-1 and one gap (0). Slide a tile next to
   the gap into it (or a whole row or column of tiles towards the gap) until the
   numbers read 1, 2, 3 ... left to right, top to bottom, with the gap in the last
   square.

   A puzzle is the solved tray shuffled by a seeded random walk of legal moves, so it
   is always solvable and the same seed gives the same puzzle on every device
   (nothing here reads the clock).
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

  // size and how long the random walk is
  const LEVELS = { easy: { n: 3, steps: 90 }, medium: { n: 4, steps: 240 }, hard: { n: 5, steps: 520 } };

  const solvedTray = (n) => Array.from({ length: n * n }, (_, i) => (i === n * n - 1 ? 0 : i + 1));
  const isSolved = (t) => t.every((v, i) => v === (i === t.length - 1 ? 0 : i + 1));

  // every square next to the gap
  function neighbours(t, n) {
    const z = t.indexOf(0), r = Math.floor(z / n), c = z % n, out = [];
    if (r > 0) out.push(z - n);
    if (r < n - 1) out.push(z + n);
    if (c > 0) out.push(z - 1);
    if (c < n - 1) out.push(z + 1);
    return out;
  }

  // Tap the tile at i: it and every tile between it and the gap slide one square towards the gap.
  // Returns the new tray and how many tiles moved, or null when i isn't in the gap's row or column.
  function slide(t, n, i) {
    const z = t.indexOf(0);
    if (i === z) return null;
    const ri = Math.floor(i / n), ci = i % n, rz = Math.floor(z / n), cz = z % n;
    if (ri !== rz && ci !== cz) return null;
    const step = ri === rz ? (ci < cz ? 1 : -1) : (ri < rz ? n : -n);
    const out = t.slice();
    let k = z, moved = 0;
    while (k !== i) { out[k] = out[k - step]; k -= step; moved++; }
    out[i] = 0;
    return { tray: out, moved };
  }

  // a shuffled tray from a seed and a level
  function generate(seed, level) {
    const lv = LEVELS[level] || LEVELS.medium, n = lv.n, rng = mulberry32(seed);
    let t = solvedTray(n), prevGap = -1;
    for (let k = 0; k < lv.steps || isSolved(t); k++) {
      const gap = t.indexOf(0);
      const opts = neighbours(t, n).filter((i) => i !== prevGap);           // never just undo the last move
      const i = opts[Math.floor(rng() * opts.length)];
      prevGap = gap;
      t = slide(t, n, i).tray;
    }
    return { n, tray: t };
  }

  // can this tray be solved at all? (used to check a saved game)
  function solvable(t, n) {
    const flat = t.filter((v) => v);
    let inv = 0;
    for (let i = 0; i < flat.length; i++) for (let j = i + 1; j < flat.length; j++) if (flat[i] > flat[j]) inv++;
    if (n % 2 === 1) return inv % 2 === 0;
    const rowFromBottom = n - Math.floor(t.indexOf(0) / n);
    return (inv + rowFromBottom) % 2 === 1;
  }

  g.SlidingPuzzle = { LEVELS, solvedTray, isSolved, neighbours, slide, generate, solvable, mulberry32 };
})(globalThis);
