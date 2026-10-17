(function () {
  "use strict";

  const D = globalThis.Dominoes;
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), modeSel = $("mode"), botsSel = $("bots"), chipsEl = $("chips"), resetBtn = $("reset-btn");
  const roomEl = $("ms-room"), tableEl = $("dm"), oppsEl = $("dm-opps"), infoEl = $("dm-info"), lineEl = $("dm-line"), bannerEl = $("dm-banner"), logEl = $("dm-log");
  const handEl = $("dm-hand"), actionsEl = $("dm-actions"), hintEl = $("dm-hint"), tauntsEl = $("ms-taunts");
  const store = Gamekit.storage("dominoes:");

  let diff = store.get("diff", "medium");
  if (!["easy", "medium", "hard"].includes(diff)) diff = "medium";
  let mode = store.get("mode", "computer");
  const params = new URLSearchParams(location.search);
  const invited = params.has("live");
  if (invited) mode = "live";
  if (mode !== "computer" && mode !== "live") mode = "computer";
  modeSel.value = mode;
  botsSel.value = store.get("bots", "1") || "1";

  // M = { kind: "local" | "online", phase, table: engine view | null, ... } (see multiseat.js)
  let M = null;
  let sel = null;                              // the tile lifted from the hand, as "a-b"

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const key = (t) => t[0] + "-" + t[1];
  const PIPS = { 0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function half(v) { const h = el("div", "h"); const on = new Set(PIPS[v]); for (let i = 0; i < 9; i++) h.append(el("i", on.has(i) ? "on" : "")); return h; }
  // a domino; tile: [a, b] shown left to right (or top to bottom if upright); null = a face-down one
  function domEl(tile, cls, upright) {
    const d = el("div", "dm" + (cls ? " " + cls : "") + (upright ? " v" : ""));
    if (!tile) { d.classList.add("back"); d.append(el("div", "h"), el("div", "h")); d.setAttribute("aria-hidden", "true"); return d; }
    d.append(half(tile[0]), half(tile[1]));
    d.setAttribute("aria-label", tile[0] + " and " + tile[1]);
    return d;
  }
  const seatName = (i) => M.table.seats[i].name;

  // ---------- the table ----------
  function eventText(e) {
    const t = M.table;
    const n = (i) => (t.you === i ? "You" : seatName(i));
    const v = (i, a, b) => (t.you === i ? a : b);
    switch (e.e) {
      case "play": return n(e.seat) + " " + v(e.seat, "play", "plays") + " " + e.tile[0] + "-" + e.tile[1] + (t.line.length > 1 ? " on the " + (e.end === "L" ? "left" : "right") : "");
      case "draw": return n(e.seat) + " " + v(e.seat, "draw", "draws") + " a tile";
      case "pass": return n(e.seat) + " " + v(e.seat, "pass", "passes");
      case "round": return e.winner === null ? "Blocked: a tie, nobody scores" : n(e.winner) + " " + v(e.winner, "win", "wins") + " the round: " + e.points + " point" + (e.points === 1 ? "" : "s") + (e.reason === "block" ? " (blocked)" : "");
      case "win": return n(e.seat) + " " + v(e.seat, "reach", "reaches") + " " + t.target;
      case "new-round": return "Round " + e.round + " begins";
      default: return "";
    }
  }
  function idleLeft() {
    if (!M || M.kind !== "online" || !M.turnSince) return null;
    const p = M.players.find((x) => x.seat === M.table.turn);
    if (!p || p.autoBot || !p.online) return null;
    return Math.max(0, Math.ceil((M.turnSince + M.idleMs - ms.nowMs()) / 1000));
  }

  function renderOpps() {
    const t = M.table;
    oppsEl.innerHTML = "";
    const reveal = t.reveal && M.phase !== "playing";
    t.seats.forEach((s, i) => {
      if (i === t.you) return;
      const box = el("div", "dm-opp" + (t.turn === i && M.phase === "playing" ? " act" : ""));
      box.append(el("div", "nm", s.name));
      let st = s.score + " pts" + (s.bot ? " · computer" : "");
      const p = M.players && M.players.find((x) => x.seat === i);
      let warn = false;
      if (p && !s.bot) {
        if (p.autoBot && !p.online) { st = s.score + " pts · offline: a computer is playing"; warn = true; }
        else if (!p.online) { st = s.score + " pts · offline: computer in " + Math.max(0, Math.ceil((p.offlineSince + M.takeoverMs - ms.nowMs()) / 1000)) + "s"; warn = true; }
      }
      box.append(el("div", "st" + (warn ? " warn" : ""), st));
      const row = el("div", "dm-row");
      if (reveal && s.hand) s.hand.forEach((x) => row.append(domEl(x, "sm")));
      else for (let k = 0; k < s.count; k++) row.append(domEl(null, "sm"));
      box.append(row);
      oppsEl.append(box);
    });
  }

  function renderInfo() {
    const t = M.table;
    infoEl.innerHTML = "";
    const me = t.you !== null ? t.seats[t.you] : null;
    [(me ? "You: " + me.score + " pts" : ""), "Round " + t.round, "Boneyard: " + t.boneyard, "First to " + t.target].filter(Boolean).forEach((x) => infoEl.append(el("span", "", x)));
  }

  function renderLine() {
    const t = M.table;
    lineEl.innerHTML = "";
    if (!t.line.length) { lineEl.append(el("span", "note", t.mustLead ? "The line starts with " + t.mustLead[0] + "-" + t.mustLead[1] + " (the highest tile)." : "The first tile starts the line.")); return; }
    t.line.forEach((x, i) => {
      const d = domEl(x, "md" + (i === 0 || i === t.line.length - 1 ? " end" : ""), x[0] === x[1]);
      lineEl.append(d);
    });
  }

  function renderBanner() {
    const t = M.table;
    bannerEl.className = "dm-banner";
    let text = "";
    const mine = t.turn === t.you && M.phase === "playing";
    if (M.phase === "game_over") text = t.winner === t.you ? "You won the game!" : seatName(t.winner) + " wins the game";
    else if (M.phase === "round_over") {
      const r = t.reveal;
      text = r.winner === null ? "Blocked: a tie, nobody scores" : (r.winner === t.you ? "You win" : seatName(r.winner) + " wins") + " the round, " + r.points + " point" + (r.points === 1 ? "" : "s") + (r.reason === "block" ? " (blocked)" : "");
    } else if (t.you === null) text = "Watching: " + seatName(t.turn) + "'s turn";
    else if (mine) { text = t.options.draw ? "Nothing fits: draw a tile" : t.options.pass ? "Nothing fits and the boneyard is empty: pass" : "Your turn"; bannerEl.classList.add("you"); }
    else { text = "Waiting for " + seatName(t.turn); const left = idleLeft(); if (left !== null) text += " (" + left + "s)"; }
    bannerEl.textContent = text;
  }

  function hintFor(tile) {
    const t = M.table;
    if (M.phase !== "playing") return "The round isn't running.";
    if (t.turn !== t.you) return "It's not your turn yet.";
    if (!t.line.length) return t.mustLead && key(t.mustLead) !== key(tile) ? "The round starts with " + t.mustLead[0] + "-" + t.mustLead[1] + "." : "";
    if (t.options.plays.some((p) => key(p.tile) === key(tile))) return "";
    return "It doesn't match either end (" + t.ends[0] + " or " + t.ends[1] + ")." + (t.options.draw ? " You have to draw." : "");
  }

  function renderHand() {
    const t = M.table;
    handEl.innerHTML = "";
    if (t.you === null) return;
    const hand = (t.seats[t.you].hand || []).slice().sort((a, b) => b[0] + b[1] - (a[0] + a[1]) || b[1] - a[1]);
    if (sel && !hand.some((x) => key(x) === sel)) sel = null;
    const plays = M.phase === "playing" && t.turn === t.you ? t.options.plays : [];
    hand.forEach((x) => {
      const b = el("button", "dm-tile" + (key(x) === sel ? " sel" : "") + (plays.length && !plays.some((p) => key(p.tile) === key(x)) ? " dim" : ""));
      b.type = "button"; b.append(domEl(x));
      b.setAttribute("aria-label", x[0] + " and " + x[1]);
      b.addEventListener("click", () => onTile(x));
      handEl.append(b);
    });
  }

  function renderActions() {
    const t = M.table;
    actionsEl.innerHTML = "";
    hintEl.textContent = "";
    const mine = t.turn === t.you && M.phase === "playing";
    if (M.kind === "local" && M.phase === "round_over") { const b = el("button", "btn primary", "Next round"); b.type = "button"; b.addEventListener("click", localNextRound); actionsEl.append(b); return; }
    if (M.phase === "round_over" && M.kind === "online") { hintEl.textContent = "Next round in " + Math.max(0, Math.ceil((M.turnSince + t.pause - ms.nowMs()) / 1000)) + "s"; return; }
    if (!mine) return;
    if (t.options.draw) { const b = el("button", "btn primary", "Draw a tile"); b.type = "button"; b.addEventListener("click", () => send({ t: "draw" })); actionsEl.append(b); return; }
    if (t.options.pass) { const b = el("button", "btn primary", "Pass"); b.type = "button"; b.addEventListener("click", () => send({ t: "pass" })); actionsEl.append(b); return; }
    const o = sel && t.options.plays.find((p) => key(p.tile) === sel);
    if (o) {
      o.ends.forEach((end) => {
        const num = end === "L" ? (t.ends ? t.ends[0] : "") : (t.ends ? t.ends[1] : "");
        const label = t.line.length ? (end === "L" ? "◀ Left (" + num + ")" : "Right (" + num + ") ▶") : "Play it";
        const b = el("button", "btn primary", label); b.type = "button";
        b.addEventListener("click", () => playSelected(end));
        actionsEl.append(b);
      });
      hintEl.textContent = o.ends.length === 1 ? "Tap the tile again to play it." : "Which end?";
    } else hintEl.textContent = t.line.length ? "Tap a tile to lift it." : "Tap your tile to start the line.";
  }

  function renderLog() { logEl.textContent = (M.lastEvents || []).map(eventText).filter(Boolean).slice(-3).join(" · "); }
  function renderTable() {
    if (!M || !M.table || M.phase === "lobby" || M.phase === "landing" || M.phase === "closed") { tableEl.classList.remove("on"); return; }
    tableEl.classList.add("on");
    renderOpps(); renderInfo(); renderLine(); renderBanner(); renderHand(); renderActions(); renderLog();
  }

  // ---------- playing ----------
  function onTile(x) {
    const t = M && M.table;
    if (!t) return;
    const why = hintFor(x);
    if (why) { hintEl.textContent = why; return; }
    const p = t.options.plays.find((q) => key(q.tile) === key(x));
    if (!p) return;
    if (sel === key(x) && p.ends.length === 1) return playSelected(p.ends[0]);
    sel = key(x);
    renderHand(); renderActions();
  }
  function playSelected(end) {
    if (!sel) return;
    const [a, b] = sel.split("-").map(Number);
    send({ t: "play", tile: [a, b], end });
  }
  function send(action) {
    sel = null;
    if (!M) return;
    if (M.kind === "local") return localAct(action);
    ms.send(action);
  }

  /* ============================================================
     vs computer: the same engine, running in the page
     ============================================================ */
  let Lc = null;
  const localPhase = (st) => (st.phase === "play" ? "playing" : st.phase);
  function localModel() {
    const st = Lc.st;
    const table = D.view(st, 0);
    table.you = 0;
    return { kind: "local", phase: localPhase(st), table, players: null, you: { seat: 0, host: true }, lastEvents: Lc.events, config: Lc.cfg };
  }
  function localStart() {
    clearTimeout(Lc && Lc.timer);
    const n = Number(botsSel.value);
    const names = ["You"].concat(Array.from({ length: n }, (_, i) => "Computer " + (i + 1)));
    const bots = [null].concat(Array(n).fill(diff));
    Lc = { st: D.create({ names, bots }, Math.random), cfg: { bots: n, level: diff }, events: [], timer: null };
    sel = null;
    localRender(); localSchedule();
  }
  function localRender() {
    M = localModel();
    renderAll();
    const st = Lc.st;
    if (st.phase === "game_over") statusEl.textContent = st.winner === 0 ? "You win! " + Gamekit.taunt("win") : st.seats[st.winner].name + " wins. " + Gamekit.taunt("loss");
    else statusEl.textContent = "";
  }
  function localAct(action) {
    const res = D.act(Lc.st, 0, action, Math.random);
    if (!res.ok) { ms.toast("That can't be done right now."); return; }
    Lc.events = res.events; localRender(); localSchedule();
  }
  function localNextRound() {
    const st = Lc.st;
    if (st.phase !== "round_over") return;
    clearTimeout(Lc.timer);
    D.nextRound(st, Math.random); Lc.events = [{ e: "new-round", round: st.round }]; sel = null; localRender(); localSchedule();
  }
  function localSchedule() {
    clearTimeout(Lc.timer);
    const st = Lc.st;
    if (st.phase === "round_over") { Lc.timer = setTimeout(localNextRound, 12000); return; }
    if (st.phase !== "play" || st.turn === 0) return;
    Lc.timer = setTimeout(() => {
      const seat = st.turn;
      let res = D.act(st, seat, D.botAct(st, seat, st.seats[seat].bot, Math.random), Math.random);
      if (!res.ok) res = D.act(st, seat, D.fallback(st, seat), Math.random);
      if (res.ok) Lc.events = res.events;
      localRender(); localSchedule();
    }, 900 + Math.random() * 600);
  }
  function renderLocalGameOver() {
    if (!M || M.kind !== "local") return;
    roomEl.innerHTML = "";
    if (M.phase !== "game_over") { roomEl.hidden = true; return; }
    roomEl.hidden = false;
    const t = M.table;
    roomEl.append(el("h3", "", t.winner === 0 ? "You won!" : seatName(t.winner) + " won"));
    const seats = el("div", "ms-seats");
    t.seats.forEach((s) => { const row = el("div", "ms-seat"); row.append(el("span", "", s.name), el("span", "win", s.score + " pts")); seats.append(row); });
    roomEl.append(seats);
    const b = el("button", "btn primary", "Play again"); b.type = "button"; b.addEventListener("click", localStart);
    roomEl.append(b);
  }

  /* ============================================================
     Online rooms: the shared screens (multiseat.js), our own table
     ============================================================ */
  const ms = MultiSeat.create({
    game: "dominoes", title: "Dominoes", roomEl, tauntsEl, store,
    onModel: (m) => { M = m; renderAll(true); },
    onTick: () => { if (tableEl.classList.contains("on") && M && M.kind === "online") { renderOpps(); renderBanner(); } },
  });
  // the round-over countdown ticks too
  setInterval(() => { if (M && M.kind === "online" && M.phase === "round_over" && tableEl.classList.contains("on")) renderActions(); }, 1000);

  function renderAll(fromOnline) {
    if (!fromOnline) renderLocalGameOver();
    renderTable();
    if (M && M.kind === "online") {
      if (M.phase === "playing" || M.phase === "round_over") statusEl.textContent = "";
      else if (M.phase === "lobby") statusEl.textContent = "Waiting for players";
      else if (M.phase === "game_over") statusEl.textContent = M.table.winner === M.table.you ? "You win! " + Gamekit.taunt("win") : seatName(M.table.winner) + " wins. " + Gamekit.taunt("loss");
      else statusEl.textContent = "";
    }
  }

  /* ---------- modes and controls ---------- */
  function applyMode() {
    const local = mode === "computer";
    chipsEl.hidden = !local; botsSel.hidden = !local;
    resetBtn.hidden = !local;
    if (local) {
      if (ms.active()) ms.stop();
      localStart();
    } else {
      if (Lc) clearTimeout(Lc.timer);
      Lc = null;
      const c = (params.get("live") || "").toUpperCase();
      if (invited && /^[A-HJ-NP-Z2-9]{6}$/.test(c) && !ms.active()) ms.enter(c);
      else if (!ms.active()) ms.landing();
      else renderAll(true);
    }
  }
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; if (mode === "computer") localStart(); },
  });
  diff = chips.get();
  modeSel.addEventListener("change", () => { mode = modeSel.value; if (mode !== "live") store.set("mode", mode); applyMode(); });
  botsSel.addEventListener("change", () => { store.set("bots", botsSel.value); if (mode === "computer") localStart(); });
  resetBtn.addEventListener("click", () => { if (mode === "computer") localStart(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sel && !document.querySelector(".man-backdrop")) { sel = null; if (M && M.table) { renderHand(); renderActions(); } } });

  if (typeof LiveShare !== "undefined") LiveShare.enable(modeSel, "dominoes", invited);
  applyMode();

  // A refresh keeps a game against the computer.
  const resumer = Gamekit.resume("dominoes", () => (mode !== "computer" || !Lc || Lc.st.phase === "game_over" || Lc.st.moves === 0) ? null : { st: Lc.st, cfg: Lc.cfg }, (s) => {
    const st = s.st;
    if (!st || st.v !== 1 || st.game !== "dominoes" || !Array.isArray(st.seats) || st.seats.length < 2 || st.seats.length > 4) return false;
    const tileOK = (t) => Array.isArray(t) && t.length === 2 && Number.isInteger(t[0]) && Number.isInteger(t[1]) && t[0] >= 0 && t[1] <= 6 && t[0] <= t[1];
    const all = st.seats.flatMap((x) => (Array.isArray(x.hand) ? x.hand : [])).concat(Array.isArray(st.boneyard) ? st.boneyard : [], Array.isArray(st.line) ? st.line.map((t) => [Math.min(t[0], t[1]), Math.max(t[0], t[1])]) : []);
    if (all.length !== 28 || !all.every(tileOK) || new Set(all.map(key)).size !== 28) return false;
    if (!["play", "round_over"].includes(st.phase) || !Number.isInteger(st.turn) || st.turn < 0 || st.turn >= st.seats.length) return false;
    if (!st.seats.every((x) => Number.isInteger(x.score))) return false;
    mode = "computer"; modeSel.value = "computer"; applyMode();
    clearTimeout(Lc.timer);
    Lc = { st, cfg: s.cfg || { bots: st.seats.length - 1, level: diff }, events: [], timer: null };
    botsSel.value = String(st.seats.length - 1); sel = null;
    localRender(); localSchedule();
    return true;
  });
  if (!invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("dominoes"));
})();
