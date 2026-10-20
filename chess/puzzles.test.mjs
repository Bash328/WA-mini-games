/* Run: node chess/puzzles.test.mjs
   Plays every bundled puzzle against the Chess page's OWN move generator (the engine half of chess/game.js, loaded
   as-is): the position parses, every move of the solution is legal, mate puzzles have the right length and end in
   checkmate, nothing needs an under-promotion (the page only promotes to a queen). Also checks the daily pick. */
import fs from "node:fs";
import "./puzzles.js";

const src = fs.readFileSync(new URL("./game.js", import.meta.url), "utf8");
globalThis.Gamekit = { taunt: () => "" };
const E = new Function(src.slice(0, src.indexOf("// ---------- UI ----------")) + ";return {stateFromFEN,uciToMove,allLegal,makeMove,outcome,inCheck};")();
const P = globalThis.CHESS_PUZZLES;

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }

console.log("chess puzzles:");
check("about 200 puzzles, all with an id, a FEN, moves, a rating and a theme", P.length >= 150 && P.length <= 260 && P.every((p) => p.length === 5 && typeof p[0] === "string" && typeof p[1] === "string" && typeof p[2] === "string" && Number.isInteger(p[3]) && typeof p[4] === "string"), P.length);
check("every id is different", new Set(P.map((p) => p[0])).size === P.length);
check("they span easy to medium (about 500 to 1500)", Math.min(...P.map((p) => p[3])) >= 450 && Math.max(...P.map((p) => p[3])) <= 1550);
const themes = {};
P.forEach((p) => { themes[p[4]] = (themes[p[4]] || 0) + 1; });
check("there are mates in 1, 2 and 3 and several other tactics", themes.mateIn1 >= 20 && themes.mateIn2 >= 40 && themes.mateIn3 >= 8 && Object.keys(themes).length >= 8, JSON.stringify(themes));

let bad = 0;
P.forEach(([id, fen, moves, rating, theme]) => {
  let why = null;
  const s = E.stateFromFEN(fen), mv = moves.split(" ");
  if (mv.some((m) => !/^[a-h][1-8][a-h][1-8][q]?$/.test(m))) why = "a move is not plain UCI (or under-promotes)";
  for (let i = 0; !why && i < mv.length; i++) {
    const m = E.uciToMove(s, mv[i]);
    if (!m) why = "move " + (i + 1) + " (" + mv[i] + ") is not legal";
    else E.makeMove(s, m);
  }
  if (!why && /^mateIn\d$/.test(theme)) {
    if (mv.length !== 2 * Number(theme[6])) why = "wrong length for " + theme;
    else if (E.outcome(s).status !== "won") why = "does not end in checkmate";
  }
  if (!why && mv.length % 2 !== 0) why = "the solution should end on the solver's move";
  if (why) { bad++; console.log("   " + id + ": " + why); }
});
check("every puzzle plays out legally against the page's move generator (mates end in mate)", bad === 0, bad + " bad");

// the solver's side: the one NOT moving in the FEN (the opponent makes the first move)
{
  const bothSides = new Set(P.map(([id, fen]) => E.stateFromFEN(fen).turn));
  check("puzzles for both White and Black are in the set", bothSides.size === 2);
}
// a mate puzzle is checkmate-proof: after the stored moves, the side to move has no legal move and is in check
{
  const m1 = P.find((p) => p[4] === "mateIn1");
  const s = E.stateFromFEN(m1[1]); const mv = m1[2].split(" ");
  mv.forEach((m) => E.makeMove(s, E.uciToMove(s, m)));
  check("a mate in 1 ends with the mated side in check and without a move", E.inCheck(s, s.turn) && E.allLegal(s, s.turn).length === 0);
}
// the daily pick: the same index all day, spread over the set across days
{
  const hashStr = (str) => { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const pick = (date) => hashStr(date + "|daily|chess-puzzle") % P.length;
  const days = Array.from({ length: 60 }, (_, d) => pick(new Date(Date.UTC(2026, 9, 1 + d)).toISOString().slice(0, 10)));
  check("the daily pick is stable and varies from day to day", pick("2026-10-17") === pick("2026-10-17") && new Set(days).size > 40, new Set(days).size);
}

console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\n${pass} passed`);
process.exit(fail ? 1 : 0);
