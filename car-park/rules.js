/* ============================================================
   car-park/rules.js — the board, the moves, the solver and the level set
   for Car Park, a 6x6 Rush Hour puzzle.

   A plain script that sets globalThis.CarPark: the page loads it with a
   <script> tag and the node test imports it for the same effect.

   A car is { id, r, c, len, dir }, where dir is "h" or "v"; id 0 is the
   red car. A car slides any distance along its own row or column and may
   never pass through another car. One slide — however far — is one move.
   The red car wins when its right end reaches the exit in row 2, column 5.

   The solver is a breadth-first search over the positions of the cars, so
   the first time it reaches a winning state it has the minimum number of
   slides. Every shipped level was verified by this search; the stored
   `best` is its exact minimum. The search is bounded only by the 6x6 board
   (never by a clock), so hints and results are deterministic.
   ============================================================ */
(function (g) {
  "use strict";

  const SIZE = 6;
  const EXIT_ROW = 2;
  const RED = 0;
  const DIRS = ["left", "right", "up", "down"];

  // [row, column, length, "h" | "v"], red car first. `best` is the BFS minimum.
  const LEVELS = [
  {"best":4,"cars":[[2,0,2,"h"],[3,0,2,"h"],[0,4,3,"v"],[1,2,2,"v"],[5,2,3,"h"],[1,0,2,"h"]]},
  {"best":4,"cars":[[2,0,2,"h"],[0,5,2,"v"],[0,3,3,"v"],[0,0,2,"v"],[5,2,3,"h"],[4,1,2,"v"]]},
  {"best":5,"cars":[[2,0,2,"h"],[5,0,2,"h"],[3,1,2,"v"],[0,4,3,"v"],[1,0,2,"h"],[3,2,3,"h"]]},
  {"best":5,"cars":[[2,0,2,"h"],[0,3,3,"v"],[1,4,2,"v"],[1,0,3,"h"],[5,2,2,"h"],[2,2,2,"v"]]},
  {"best":5,"cars":[[2,0,2,"h"],[5,0,2,"h"],[3,1,3,"h"],[1,5,2,"v"],[0,1,2,"v"],[1,4,2,"v"],[0,3,3,"v"]]},
  {"best":6,"cars":[[2,0,2,"h"],[3,0,3,"v"],[5,1,2,"h"],[5,3,2,"h"],[0,4,3,"v"],[0,2,2,"v"],[0,5,2,"v"]]},
  {"best":6,"cars":[[2,0,2,"h"],[1,2,2,"v"],[1,0,2,"h"],[4,1,3,"h"],[0,5,3,"v"],[0,3,3,"v"],[1,4,2,"v"]]},
  {"best":6,"cars":[[2,0,2,"h"],[2,4,2,"v"],[0,0,2,"v"],[4,3,2,"h"],[1,1,2,"h"],[3,2,2,"v"],[2,3,2,"v"],[0,1,3,"h"],[1,3,3,"h"]]},
  {"best":7,"cars":[[2,0,2,"h"],[1,3,2,"v"],[3,2,2,"h"],[0,4,2,"h"],[4,4,2,"h"],[1,5,3,"v"],[0,1,3,"h"],[0,0,2,"v"],[3,1,3,"v"]]},
  {"best":7,"cars":[[2,0,2,"h"],[4,1,3,"h"],[0,0,2,"v"],[3,1,3,"h"],[0,3,3,"v"],[2,5,2,"v"],[4,5,2,"v"],[1,4,2,"h"],[2,4,2,"v"]]},
  {"best":7,"cars":[[2,0,2,"h"],[1,4,2,"v"],[0,1,2,"v"],[3,1,2,"h"],[0,0,2,"v"],[4,0,3,"h"],[0,2,3,"v"],[1,5,2,"v"],[1,3,2,"v"]]},
  {"best":8,"cars":[[2,0,2,"h"],[0,0,2,"v"],[1,1,2,"h"],[2,2,3,"v"],[0,5,2,"v"],[4,3,3,"h"],[0,3,2,"v"],[2,5,2,"v"],[3,1,3,"v"],[0,1,2,"h"]]},
  {"best":8,"cars":[[2,0,2,"h"],[0,2,3,"v"],[4,2,2,"h"],[1,5,3,"v"],[0,3,2,"v"],[0,0,2,"h"],[5,0,3,"h"],[3,1,2,"v"],[0,4,2,"h"],[3,3,2,"h"]]},
  {"best":8,"cars":[[2,0,2,"h"],[5,0,2,"h"],[2,3,2,"v"],[0,0,2,"v"],[1,1,3,"h"],[3,4,2,"h"],[0,1,2,"h"],[0,4,2,"v"],[4,4,2,"h"],[3,1,2,"v"],[0,5,3,"v"]]},
  {"best":9,"cars":[[2,0,2,"h"],[0,0,2,"v"],[4,0,2,"h"],[0,3,3,"v"],[4,2,2,"h"],[0,2,2,"v"],[0,4,2,"h"],[3,2,2,"h"],[1,4,2,"h"],[5,2,2,"h"],[3,5,2,"v"]]},
  {"best":9,"cars":[[2,0,2,"h"],[0,2,3,"v"],[4,2,3,"h"],[3,1,2,"v"],[2,3,2,"v"],[5,3,3,"h"],[0,3,2,"h"],[0,0,2,"v"],[1,3,3,"h"],[4,0,2,"v"],[2,5,2,"v"]]},
  {"best":9,"cars":[[2,0,2,"h"],[3,0,2,"h"],[0,2,3,"v"],[0,3,2,"v"],[5,1,2,"h"],[4,1,3,"h"],[0,1,2,"v"],[3,5,2,"v"],[0,0,2,"v"],[4,0,2,"v"],[1,4,2,"h"]]},
  {"best":9,"cars":[[2,0,2,"h"],[3,1,3,"h"],[1,3,2,"v"],[0,2,2,"v"],[0,3,3,"h"],[1,5,2,"v"],[4,1,2,"h"],[0,1,2,"v"],[3,0,3,"v"],[3,5,2,"v"],[3,4,2,"v"],[5,1,2,"h"]]},
  {"best":10,"cars":[[2,0,2,"h"],[2,3,2,"v"],[3,1,2,"v"],[1,1,2,"h"],[0,0,2,"v"],[0,5,2,"v"],[2,2,2,"v"],[4,2,2,"h"],[4,4,2,"h"],[5,0,2,"h"],[5,2,3,"h"],[3,4,2,"h"]]},
  {"best":10,"cars":[[2,0,2,"h"],[2,2,2,"v"],[5,1,3,"h"],[0,0,2,"v"],[1,2,2,"h"],[0,5,3,"v"],[0,1,2,"v"],[3,0,2,"h"],[0,4,2,"v"],[2,3,3,"v"],[0,2,2,"h"],[4,0,2,"v"]]},
  {"best":10,"cars":[[2,0,2,"h"],[1,5,2,"v"],[4,4,2,"h"],[0,1,3,"h"],[1,2,3,"v"],[2,3,2,"v"],[2,4,2,"v"],[3,0,3,"v"],[5,1,2,"h"],[4,3,2,"v"],[1,3,2,"h"],[3,1,2,"v"]]},
  {"best":11,"cars":[[2,0,2,"h"],[1,0,3,"h"],[3,3,2,"h"],[2,5,2,"v"],[3,1,3,"v"],[1,4,2,"h"],[2,2,2,"v"],[4,2,3,"h"],[3,0,2,"v"],[4,5,2,"v"],[5,2,3,"h"],[0,4,2,"h"]]},
  {"best":11,"cars":[[2,0,2,"h"],[1,3,2,"v"],[2,2,3,"v"],[0,2,3,"h"],[1,1,2,"h"],[3,0,2,"h"],[4,0,2,"v"],[4,3,2,"h"],[5,2,2,"h"],[4,1,2,"v"],[5,4,2,"h"],[0,0,2,"h"]]},
  {"best":11,"cars":[[2,0,2,"h"],[0,0,2,"v"],[1,2,2,"h"],[2,2,3,"v"],[0,5,2,"v"],[4,3,3,"h"],[2,3,2,"v"],[2,5,2,"v"],[3,1,3,"v"],[0,2,2,"h"]]},
  {"best":12,"cars":[[2,0,2,"h"],[0,2,3,"v"],[4,2,2,"h"],[0,5,3,"v"],[1,3,2,"v"],[0,0,2,"h"],[5,0,3,"h"],[3,1,2,"v"],[0,3,2,"h"],[3,2,2,"h"]]},
  {"best":12,"cars":[[2,0,2,"h"],[2,4,2,"v"],[3,0,2,"v"],[4,1,2,"h"],[1,4,2,"h"],[2,2,2,"v"],[2,3,2,"v"],[0,0,3,"h"],[1,1,3,"h"]]},
  {"best":12,"cars":[[2,0,2,"h"],[5,0,2,"h"],[4,3,2,"v"],[0,0,2,"v"],[1,1,3,"h"],[3,2,2,"h"],[0,2,2,"h"],[1,4,2,"v"],[4,4,2,"h"],[3,1,2,"v"],[1,5,3,"v"]]},
  {"best":13,"cars":[[2,0,2,"h"],[4,3,2,"v"],[3,2,2,"h"],[0,4,2,"h"],[4,4,2,"h"],[1,5,3,"v"],[0,1,3,"h"],[0,0,2,"v"],[3,1,3,"v"]]},
  {"best":13,"cars":[[2,0,2,"h"],[3,1,3,"h"],[1,3,2,"v"],[1,2,2,"v"],[0,2,3,"h"],[0,5,2,"v"],[4,1,2,"h"],[0,1,2,"v"],[3,0,3,"v"],[2,5,2,"v"],[3,4,2,"v"],[5,1,2,"h"]]},
  {"best":13,"cars":[[2,0,2,"h"],[0,3,2,"v"],[3,1,2,"v"],[1,1,2,"h"],[0,0,2,"v"],[1,5,2,"v"],[2,2,2,"v"],[4,2,2,"h"],[4,4,2,"h"],[5,0,2,"h"],[5,2,3,"h"],[3,3,2,"h"]]},
  {"best":14,"cars":[[2,0,2,"h"],[3,1,3,"h"],[1,3,2,"v"],[1,2,2,"v"],[0,2,3,"h"],[0,5,2,"v"],[4,1,2,"h"],[0,1,2,"v"],[3,0,3,"v"],[2,5,2,"v"],[1,4,2,"v"],[5,1,2,"h"]]},
  {"best":14,"cars":[[2,0,2,"h"],[0,0,2,"v"],[1,3,2,"h"],[0,2,3,"v"],[1,5,2,"v"],[4,2,3,"h"],[2,3,2,"v"],[3,5,2,"v"],[3,1,3,"v"],[0,3,2,"h"]]},
  {"best":14,"cars":[[2,0,2,"h"],[0,2,3,"v"],[4,4,2,"h"],[0,5,3,"v"],[4,3,2,"v"],[0,0,2,"h"],[5,0,3,"h"],[3,1,2,"v"],[0,3,2,"h"],[3,2,2,"h"]]},
  {"best":15,"cars":[[2,0,2,"h"],[2,4,2,"v"],[3,0,2,"v"],[4,1,2,"h"],[1,3,2,"h"],[2,2,2,"v"],[3,3,2,"v"],[0,0,3,"h"],[1,0,3,"h"]]},
  {"best":15,"cars":[[2,0,2,"h"],[3,1,3,"h"],[1,3,2,"v"],[1,2,2,"v"],[0,2,3,"h"],[0,5,2,"v"],[4,2,2,"h"],[0,1,2,"v"],[3,0,3,"v"],[2,5,2,"v"],[1,4,2,"v"],[5,1,2,"h"]]},
  {"best":15,"cars":[[2,0,2,"h"],[0,0,2,"v"],[1,3,2,"h"],[0,2,3,"v"],[1,5,2,"v"],[4,2,3,"h"],[2,3,2,"v"],[3,5,2,"v"],[3,1,3,"v"],[0,4,2,"h"]]},
  {"best":16,"cars":[[2,0,2,"h"],[0,2,3,"v"],[4,4,2,"h"],[1,5,3,"v"],[4,3,2,"v"],[0,0,2,"h"],[5,0,3,"h"],[3,1,2,"v"],[0,4,2,"h"],[3,2,2,"h"]]},
  {"best":16,"cars":[[2,0,2,"h"],[3,4,2,"v"],[3,0,2,"v"],[4,1,2,"h"],[1,3,2,"h"],[2,2,2,"v"],[3,3,2,"v"],[0,0,3,"h"],[1,0,3,"h"]]},
  {"best":16,"cars":[[2,0,2,"h"],[3,1,3,"h"],[1,3,2,"v"],[4,2,2,"v"],[0,2,3,"h"],[0,5,2,"v"],[4,3,2,"h"],[0,1,2,"v"],[3,0,3,"v"],[2,5,2,"v"],[1,4,2,"v"],[5,3,2,"h"]]},
  {"best":17,"cars":[[2,0,2,"h"],[0,0,2,"v"],[1,4,2,"h"],[0,2,3,"v"],[2,5,2,"v"],[4,2,3,"h"],[0,3,2,"v"],[4,5,2,"v"],[3,1,3,"v"],[0,4,2,"h"]]},
  {"best":18,"cars":[[2,0,2,"h"],[3,1,3,"h"],[1,3,2,"v"],[4,2,2,"v"],[0,2,3,"h"],[0,5,2,"v"],[4,3,2,"h"],[0,1,2,"v"],[3,0,3,"v"],[2,5,2,"v"],[2,4,2,"v"],[5,4,2,"h"]]},
  {"best":19,"cars":[[2,0,2,"h"],[3,1,3,"h"],[1,3,2,"v"],[4,2,2,"v"],[0,2,3,"h"],[0,5,2,"v"],[4,4,2,"h"],[0,1,2,"v"],[3,0,3,"v"],[2,5,2,"v"],[2,4,2,"v"],[5,4,2,"h"]]}
  ];

  /* ---------- the board ---------- */

  function carsOf(level) {
    return level.cars.map(([r, c, len, dir], id) => ({ id: id, r: r, c: c, len: len, dir: dir }));
  }

  function cloneCars(cars) {
    return cars.map((v) => ({ id: v.id, r: v.r, c: v.c, len: v.len, dir: v.dir }));
  }

  function cellsOf(v) {
    const out = [];
    for (let k = 0; k < v.len; k++) out.push(v.dir === "h" ? [v.r, v.c + k] : [v.r + k, v.c]);
    return out;
  }

  // A cell map with (car id + 1) in every occupied cell, or null if a car is
  // out of bounds or two cars overlap.
  function occupancy(cars) {
    const occ = new Uint8Array(SIZE * SIZE);
    for (const v of cars) {
      for (const [r, c] of cellsOf(v)) {
        if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
        const i = r * SIZE + c;
        if (occ[i]) return null;
        occ[i] = v.id + 1;
      }
    }
    return occ;
  }

  function valid(cars) {
    if (!Array.isArray(cars) || !cars.length) return false;
    for (let i = 0; i < cars.length; i++) {
      const v = cars[i];
      if (!v || v.id !== i || (v.dir !== "h" && v.dir !== "v")) return false;
      if (v.len !== 2 && v.len !== 3) return false;
    }
    const red = cars[RED];
    if (red.dir !== "h" || red.len !== 2 || red.r !== EXIT_ROW) return false;
    return !!occupancy(cars);
  }

  function validLevel(level) {
    if (!level || !Array.isArray(level.cars) || !Number.isInteger(level.best) || level.best <= 0) return false;
    return valid(carsOf(level));
  }

  // Exact win: the red car's right end is on the right edge of the exit row.
  function isWin(cars) {
    const red = cars[RED];
    if (!red) return false;
    return red.dir === "h" && red.len === 2 && red.r === EXIT_ROW && red.c + red.len - 1 === SIZE - 1;
  }

  /* ---------- moves ---------- */

  // Every legal slide, one entry per distance, so the BFS can consider
  // stopping part-way as well as sliding all the way.
  function legalMoves(cars) {
    const occ = occupancy(cars);
    if (!occ) return [];
    const out = [];
    for (const v of cars) {
      if (v.dir === "h") {
        for (let d = 1; v.c - d >= 0 && !occ[v.r * SIZE + v.c - d]; d++) out.push({ id: v.id, dir: "left", steps: d });
        for (let d = 1; v.c + v.len - 1 + d < SIZE && !occ[v.r * SIZE + v.c + v.len - 1 + d]; d++) out.push({ id: v.id, dir: "right", steps: d });
      } else {
        for (let d = 1; v.r - d >= 0 && !occ[(v.r - d) * SIZE + v.c]; d++) out.push({ id: v.id, dir: "up", steps: d });
        for (let d = 1; v.r + v.len - 1 + d < SIZE && !occ[(v.r + v.len - 1 + d) * SIZE + v.c]; d++) out.push({ id: v.id, dir: "down", steps: d });
      }
    }
    return out;
  }

  // How far one car can slide in one direction: 0 when the direction is
  // wrong or something blocks it immediately.
  function maxSlide(cars, id, dir) {
    const occ = occupancy(cars);
    const v = cars[id];
    if (!occ || !v) return 0;
    let n = 0;
    if (v.dir === "h" && (dir === "left" || dir === "right")) {
      const step = dir === "left" ? -1 : 1;
      let c = dir === "left" ? v.c - 1 : v.c + v.len;
      while (c >= 0 && c < SIZE && !occ[v.r * SIZE + c]) { n++; c += step; }
    } else if (v.dir === "v" && (dir === "up" || dir === "down")) {
      const step = dir === "up" ? -1 : 1;
      let r = dir === "up" ? v.r - 1 : v.r + v.len;
      while (r >= 0 && r < SIZE && !occ[r * SIZE + v.c]) { n++; r += step; }
    }
    return n;
  }

  function applyMove(cars, move) {
    if (!move || !cars[move.id]) return null;
    const out = cloneCars(cars);
    const v = out[move.id];
    if (move.dir === "left") v.c -= move.steps;
    else if (move.dir === "right") v.c += move.steps;
    else if (move.dir === "up") v.r -= move.steps;
    else if (move.dir === "down") v.r += move.steps;
    else return null;
    return out;
  }

  /* ---------- the solver ---------- */

  function layoutOf(cars) {
    return cars.map((v) => ({
      id: v.id,
      len: v.len,
      dir: v.dir,
      fixed: v.dir === "h" ? v.r : v.c,
      pos: v.dir === "h" ? v.c : v.r,
    }));
  }

  function keyOf(st) {
    let s = "";
    for (let i = 0; i < st.length; i++) s += String.fromCharCode(48 + st[i]);
    return s;
  }

  function occFromState(lay, st) {
    const occ = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < lay.length; i++) {
      const v = lay[i], pos = st[i];
      if (v.dir === "h") {
        const base = v.fixed * SIZE + pos;
        for (let k = 0; k < v.len; k++) { if (occ[base + k]) return null; occ[base + k] = i + 1; }
      } else {
        const base = pos * SIZE + v.fixed;
        for (let k = 0; k < v.len; k++) { if (occ[base + k * SIZE]) return null; occ[base + k * SIZE] = i + 1; }
      }
    }
    return occ;
  }

  function movesFromState(lay, st, occ) {
    const out = [];
    for (let i = 0; i < lay.length; i++) {
      const v = lay[i], pos = st[i];
      if (v.dir === "h") {
        for (let d = 1; pos - d >= 0 && !occ[v.fixed * SIZE + pos - d]; d++) out.push({ id: i, dir: "left", steps: d });
        for (let d = 1; pos + v.len - 1 + d < SIZE && !occ[v.fixed * SIZE + pos + v.len - 1 + d]; d++) out.push({ id: i, dir: "right", steps: d });
      } else {
        for (let d = 1; pos - d >= 0 && !occ[(pos - d) * SIZE + v.fixed]; d++) out.push({ id: i, dir: "up", steps: d });
        for (let d = 1; pos + v.len - 1 + d < SIZE && !occ[(pos + v.len - 1 + d) * SIZE + v.fixed]; d++) out.push({ id: i, dir: "down", steps: d });
      }
    }
    return out;
  }

  function nextState(st, move) {
    const out = st.slice();
    out[move.id] += move.dir === "left" || move.dir === "up" ? -move.steps : move.steps;
    return out;
  }

  function winState(lay, st) {
    return lay.length > 0 && lay[0].fixed === EXIT_ROW && lay[0].len === 2 && st[0] === SIZE - lay[0].len;
  }

  function pathTo(parents, goalKey) {
    const path = [];
    let k = goalKey;
    while (parents.has(k)) {
      const p = parents.get(k);
      path.push(p.move);
      k = p.parent;
    }
    path.reverse();
    return path;
  }

  // Breadth-first search from this position. Returns { moves, path, states }
  // with the minimum number of slides and a legal path to the win, or null if
  // no route exists (shipped levels always have one).
  function solve(cars) {
    if (!valid(cars)) return null;
    const lay = layoutOf(cars);
    const start = Uint8Array.from(lay.map((v) => v.pos));
    const startKey = keyOf(start);
    if (winState(lay, start)) return { moves: 0, path: [], states: 1 };

    const queue = [start];
    const keys = [startKey];
    const parents = new Map();
    const seen = new Set([startKey]);
    let head = 0, depth = 0, layerEnd = 1;

    while (head < queue.length) {
      if (head === layerEnd) { depth++; layerEnd = queue.length; }
      const st = queue[head], sk = keys[head];
      head++;
      const occ = occFromState(lay, st);
      if (!occ) continue;
      for (const move of movesFromState(lay, st, occ)) {
        const ns = nextState(st, move);
        const nk = keyOf(ns);
        if (seen.has(nk)) continue;
        seen.add(nk);
        parents.set(nk, { parent: sk, move: move });
        if (winState(lay, ns)) return { moves: depth + 1, path: pathTo(parents, nk), states: seen.size };
        queue.push(ns);
        keys.push(nk);
      }
    }
    return null;
  }

  function minimumMoves(cars) {
    const res = solve(cars);
    return res ? res.moves : -1;
  }

  // The first move of a shortest solution from here: the page's Hint.
  function hint(cars) {
    const res = solve(cars);
    return res && res.path.length ? res.path[0] : null;
  }

  g.CarPark = {
    SIZE,
    EXIT_ROW,
    RED,
    DIRS,
    LEVELS,
    carsOf,
    cloneCars,
    occupancy,
    valid,
    validLevel,
    isWin,
    legalMoves,
    maxSlide,
    applyMove,
    solve,
    minimumMoves,
    hint,
  };
})(typeof window !== "undefined" ? window : globalThis);
