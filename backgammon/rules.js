/* ============================================================
   backgammon/rules.js — the rules and the computer player of Backgammon, written once.

   A plain script that sets globalThis.BackgammonRules, so the page loads it with a
   <script> tag and the Worker (worker/rules/backgammon.mjs) and the tests import it
   for the same effect.

   Standard single games, no doubling cube. Two players, 15 checkers each: Red
   (player 1) and White (player 2). The board has 24 points, indexed 0..23. Red
   moves from index 23 down to 0 (its home board is 0..5); White moves from 0 up to
   23 (home 18..23). A turn is a roll of two dice, each die moving one checker
   (doubles: four moves). Rules enforced:
     - a point holding two or more enemy checkers is blocked; landing on a lone
       enemy checker hits it and sends it to the bar;
     - a player with a checker on the bar must enter it (a die d enters Red on
       index 24-d and White on d-1) before anything else moves;
     - bearing off needs all 15 checkers in the home board; a die may bear off from
       the exact point, or from the furthest-back point if the die is larger;
     - a player must use as many dice as possible; if only one die can be played it
       must be the larger one if either can.
   First to bear off all 15 wins. (No gammons or backgammons: a win is a win.)

   Wire board (33 characters): the 24 points (0 empty, a..o = 1..15 Red checkers,
   A..O = 1..15 White), the bar for Red then White and the off count for Red then
   White (one hex digit each), the two dice for the player to move (0 = not rolled),
   the two dice of the roll before (for display), and a flag: 1 if that earlier roll
   was a forced pass (the player had no legal move).
   Online, the SERVER rolls the dice and writes them into the board; over WhatsApp
   the player to move rolls their own (the board carries 00), as in Pig.
   ============================================================ */
(function (g) {
  "use strict";

  const other = (p) => (p === 1 ? 2 : 1);
  const START = (() => {
    const pt = new Int8Array(24);
    pt[23] = 2; pt[12] = 5; pt[7] = 3; pt[5] = 5;             // Red
    pt[0] = -2; pt[11] = -5; pt[16] = -3; pt[18] = -5;        // White
    return pt;
  })();

  /* ---------- the position ---------- */
  // S = { pt: Int8Array(24) (Red +, White -), bar: [r, w], off: [r, w], dice: [a, b], pd: [a, b], ps: 0|1 }
  function parse(str) {
    if (typeof str !== "string" || !/^[0a-oA-O]{24}[0-9a-f]{4}[0-6]{4}[01]$/.test(str)) return null;
    const pt = new Int8Array(24);
    for (let i = 0; i < 24; i++) {
      const c = str[i];
      pt[i] = c === "0" ? 0 : c >= "a" ? c.charCodeAt(0) - 96 : -(c.charCodeAt(0) - 64);
    }
    const hx = (i) => parseInt(str[i], 16);
    const S = { pt, bar: [hx(24), hx(25)], off: [hx(26), hx(27)], dice: [Number(str[28]), Number(str[29])], pd: [Number(str[30]), Number(str[31])], ps: Number(str[32]) };
    let r = S.bar[0] + S.off[0], w = S.bar[1] + S.off[1];
    for (let i = 0; i < 24; i++) { if (pt[i] > 0) r += pt[i]; else w -= pt[i]; }
    return r === 15 && w === 15 ? S : null;
  }
  function str(S) {
    let s = "";
    for (let i = 0; i < 24; i++) { const v = S.pt[i]; s += v === 0 ? "0" : v > 0 ? String.fromCharCode(96 + v) : String.fromCharCode(64 - v); }
    return s + S.bar[0].toString(16) + S.bar[1].toString(16) + S.off[0].toString(16) + S.off[1].toString(16) + S.dice[0] + S.dice[1] + S.pd[0] + S.pd[1] + S.ps;
  }
  const posKey = (S) => str(S).slice(0, 28);                    // everything but the dice
  const initial = () => str({ pt: START.slice(), bar: [0, 0], off: [0, 0], dice: [0, 0], pd: [0, 0], ps: 0 });
  const clone = (S) => ({ pt: S.pt.slice(), bar: S.bar.slice(), off: S.off.slice(), dice: S.dice.slice(), pd: S.pd.slice(), ps: S.ps });
  const sign = (p) => (p === 1 ? 1 : -1);
  const diceList = (d) => (d[0] === d[1] ? [d[0], d[0], d[0], d[0]] : [d[0], d[1]]);
  const roll = (rng) => [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];

  /* ---------- steps (one checker, one die) ---------- */
  // { from: 0..23 | -1 (the bar), to: 0..23 | -2 (borne off), die }
  function allHome(S, p) {
    if (S.bar[p - 1] > 0) return false;
    for (let i = 0; i < 24; i++) if (S.pt[i] * sign(p) > 0 && (p === 1 ? i > 5 : i < 18)) return false;
    return true;
  }
  function rawSteps(S, p, d) {
    const out = [], sg = sign(p), blocked = (i) => S.pt[i] * sg < -1;
    if (S.bar[p - 1] > 0) {
      const to = p === 1 ? 24 - d : d - 1;
      if (!blocked(to)) out.push({ from: -1, to, die: d });
      return out;
    }
    const home = allHome(S, p);
    for (let i = 0; i < 24; i++) {
      if (S.pt[i] * sg <= 0) continue;
      const to = p === 1 ? i - d : i + d;
      if (to >= 0 && to < 24) { if (!blocked(to)) out.push({ from: i, to, die: d }); continue; }
      if (!home) continue;
      const exact = p === 1 ? to === -1 : to === 24;
      if (exact) { out.push({ from: i, to: -2, die: d }); continue; }
      let behind = false;                                        // a checker further from home than this one?
      for (let j = 0; j < 24 && !behind; j++) if (S.pt[j] * sg > 0 && (p === 1 ? j > i : j < i)) behind = true;
      if (!behind) out.push({ from: i, to: -2, die: d });
    }
    return out;
  }
  // the position after one step (dice and display fields are left alone)
  function applyStep(S, p, st) {
    const N = clone(S), sg = sign(p);
    if (st.from === -1) N.bar[p - 1]--; else N.pt[st.from] -= sg;
    if (st.to === -2) N.off[p - 1]++;
    else {
      if (N.pt[st.to] * sg === -1) { N.pt[st.to] = 0; N.bar[2 - p]++; }       // a hit
      N.pt[st.to] += sg;
    }
    return N;
  }
  function withoutDie(dice, d) { const i = dice.indexOf(d); return dice.slice(0, i).concat(dice.slice(i + 1)); }

  // the most dice that can be played from here (the "play as many as you can" rule)
  function maxPlays(S, p, dice, memo) {
    if (!dice.length) return 0;
    memo = memo || new Map();
    const key = posKey(S) + p + dice.slice().sort().join("");
    if (memo.has(key)) return memo.get(key);
    let best = 0;
    for (const d of new Set(dice)) {
      for (const st of rawSteps(S, p, d)) {
        const v = 1 + maxPlays(applyStep(S, p, st), p, withoutDie(dice, d), memo);
        if (v > best) best = v;
        if (best === dice.length) break;
      }
      if (best === dice.length) break;
    }
    memo.set(key, best);
    return best;
  }
  // the steps the player may take now, given the dice still unplayed
  function legalSteps(S, p, dice) {
    const best = maxPlays(S, p, dice), out = [];
    if (!best) return out;
    const memo = new Map();
    for (const d of new Set(dice)) for (const st of rawSteps(S, p, d)) {
      if (1 + maxPlays(applyStep(S, p, st), p, withoutDie(dice, d), memo) === best) out.push(st);
    }
    if (best === 1 && dice.length === 2 && dice[0] !== dice[1]) {            // only one die can be used: it must be the larger
      const big = Math.max(dice[0], dice[1]);
      if (out.some((s) => s.die === big)) return out.filter((s) => s.die === big);
    }
    return out;
  }
  const winnerOf = (S) => (S.off[0] === 15 ? 1 : S.off[1] === 15 ? 2 : 0);

  // every position a full turn can end in -> one sequence of steps that gets there (capped, so a roll of doubles stays quick)
  function sequences(S, p, dice, cap) {
    const ends = new Map(), seen = new Set();
    let nodes = 0;
    (function walk(T, left, steps) {
      if (nodes++ > cap) return;
      const key = posKey(T) + left.slice().sort().join("");
      if (seen.has(key)) return;
      seen.add(key);
      const next = left.length ? legalSteps(T, p, left) : [];
      if (!next.length) { const k = posKey(T); if (!ends.has(k)) ends.set(k, { steps, S: T }); return; }
      for (const st of next) walk(applyStep(T, p, st), withoutDie(left, st.die), steps.concat([st]));
    })(S, dice, []);
    return ends;
  }

  /* ---------- online: the server's rolls and its check ---------- */
  function hashId(id) { let h = 2166136261 >>> 0; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // the very first roll: from the room's id, so both browsers and the server agree before any move exists
  function openingDice(id) { const h = hashId(String(id)); return [1 + (h % 6), 1 + ((h >>> 8) % 6)]; }

  function check(prev, next, mover) {
    const bad = { ok: false, reason: "illegal" };
    if (mover !== 1 && mover !== 2) return bad;
    const before = prev ? parse(prev.board) : parse(initial());
    const after = parse(next.board);
    if (!before || !after) return bad;
    const dice = prev ? before.dice : openingDice(next.id);
    if (!prev && mover !== 1) return bad;
    if (!dice[0] || !dice[1]) return bad;
    const ends = sequences(before, mover, diceList(dice), 6000);
    if (ends.size === 0) { if (posKey(after) !== posKey(before)) return bad; }       // no legal move: the position stays (the server normally passes these itself)
    else if (!ends.has(posKey(after))) return bad;
    const w = winnerOf(after);
    if (w) { if (w !== mover || next.status !== "won" || next.winner !== mover) return bad; }
    else if (next.status !== "in_progress" || next.winner !== null) return bad;
    if (!Number.isInteger(next.last) || next.last < 0 || next.last > 99) return bad;
    return { ok: true, nextTurn: other(mover) };
  }

  // After an accepted move the server rolls for whoever is next. A player with no legal move is passed
  // (and the roll shown) and the roller rolls again. Returns { board, turn }.
  function stamp(prev, next, mover, rng) {
    const S = parse(next.board), moved = prev ? parse(prev.board).dice : openingDice(next.id);
    let turn = other(mover), pd = moved, ps = 0;
    for (let guard = 0; guard < 12; guard++) {
      const dice = roll(rng);
      if (legalSteps(S, turn, diceList(dice)).length) { S.dice = dice; break; }
      pd = dice; ps = 1; turn = other(turn);
      S.dice = [0, 0];
    }
    S.pd = pd; S.ps = ps;
    return { board: str(S), turn };
  }

  /* ---------- the computer ---------- */
  const pips = (S, p) => {
    let n = S.bar[p - 1] * 25;
    for (let i = 0; i < 24; i++) { const c = S.pt[i] * sign(p); if (c > 0) n += c * (p === 1 ? i + 1 : 24 - i); }
    return n;
  };
  // how good the position is for p (higher is better): race, borne off, blots, made points, the bar
  function evaluate(S, p) {
    const sg = sign(p), q = other(p);
    let v = (pips(S, q) - pips(S, p)) * 0.9 + (S.off[p - 1] - S.off[q - 1]) * 6 + (S.bar[q - 1] - S.bar[p - 1]) * 13;
    let run = 0;
    for (let k = 0; k < 24; k++) {
      const i = p === 1 ? 23 - k : k, c = S.pt[i] * sg;                     // walk from p's far side to its home
      const home = p === 1 ? i <= 5 : i >= 18;
      if (c >= 2) { v += 3 + (home ? 2 : 0); run++; if (run >= 4) v += 3; } else run = 0;
      if (c === 1) {                                                         // a blot: worse the more enemy checkers are behind it
        let behind = 0;
        for (let j = 0; j < 24; j++) if (S.pt[j] * sg < 0 && (p === 1 ? j > i : j < i)) behind += -S.pt[j] * sg;
        if (S.bar[q - 1] > 0) behind += 3;
        v -= behind > 0 ? 5 + (home ? 3 : 0) : 0;
      }
    }
    return v;
  }
  const LEVELS = { easy: { top: 5, noise: 14 }, medium: { top: 1, noise: 2.5 }, hard: { top: 1, noise: 0, deep: 6 } };
  // the computer's whole turn as a list of steps ([] = no legal move)
  function bestTurn(str33, p, level, rng) {
    const S = parse(str33), lv = LEVELS[level] || LEVELS.medium;
    const ends = [...sequences(S, p, diceList(S.dice), 4000).values()];
    if (!ends.length) return [];
    for (const e of ends) e.v = (winnerOf(e.S) === p ? 1e6 : evaluate(e.S, p)) + rng() * lv.noise;
    ends.sort((a, b) => b.v - a.v);
    if (lv.deep) {                                                           // look at the opponent's reply to my best few, averaged over every roll
      const q = other(p);
      for (const e of ends.slice(0, lv.deep)) {
        if (winnerOf(e.S) === p) { e.v = 1e6; continue; }
        let sum = 0, weight = 0;
        for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) {
          const w = a === b ? 1 : 2;
          const T = clone(e.S); T.dice = [a, b];
          const replies = sequences(T, q, diceList(T.dice), 250);
          let worst = -Infinity;
          for (const r of replies.values()) worst = Math.max(worst, winnerOf(r.S) === q ? 1e6 : evaluate(r.S, q));
          sum += w * (replies.size ? worst : -evaluate(e.S, q)); weight += w;
        }
        e.v = -sum / weight;
      }
      ends.slice(0, lv.deep).sort((a, b) => b.v - a.v).forEach((e, i) => { ends[i] = e; });
    }
    const pick = ends[Math.floor(rng() * Math.min(lv.top, ends.length))];
    return pick.steps;
  }

  g.BackgammonRules = {
    START, other, parse, str, posKey, initial, clone, sign, diceList, roll, rawSteps, applyStep, maxPlays, legalSteps, winnerOf, sequences,
    openingDice, check, stamp, evaluate, pips, bestTurn, withoutDie, allHome,
  };
})(globalThis);
