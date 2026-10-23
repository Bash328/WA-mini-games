(function () {
  "use strict";

  const L = globalThis.LiarsDice;
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), modeSel = $("mode"), botsSel = $("bots"), chipsEl = $("chips"), resetBtn = $("reset-btn");
  const roomEl = $("ms-room"), tableEl = $("ld"), oppsEl = $("ld-opps"), bidEl = $("ld-bid"), bannerEl = $("ld-banner"), logEl = $("ld-log");
  const mineEl = $("ld-mine"), boxEl = $("ld-bidbox"), hintEl = $("ld-hint"), tauntsEl = $("ms-taunts");
  const store = Gamekit.storage("liars-dice:");

  let diff = store.get("diff", "medium");
  if (!["easy", "medium", "hard"].includes(diff)) diff = "medium";
  let mode = store.get("mode", "computer");
  const params = new URLSearchParams(location.search);
  const invited = params.has("live");
  if (invited) mode = "live";
  if (mode !== "computer" && mode !== "live") mode = "computer";
  modeSel.value = mode;
  botsSel.value = store.get("bots", "2") || "2";

  // ---------- one model for the screen, local or online ----------
  // M = { kind: "local" | "online", phase: "landing"|"lobby"|"playing"|"round_over"|"game_over"|"closed", table: engine view | null, ... }
  let M = null;
  let bq = 1, bf = 2, bidKey = "";             // the bid being set up: quantity, face; and which turn it was set up for

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const PIPS = Gamekit.PIPS;             // the shared pip layout
  function dieEl(v, cls) {
    const d = el("div", "ld-die" + (cls ? " " + cls : ""));
    if (!v) { d.classList.add("back"); d.setAttribute("aria-hidden", "true"); return d; }
    const on = new Set(PIPS[v]);
    for (let i = 0; i < 9; i++) d.append(el("i", on.has(i) ? "on" : ""));
    if (v === 1) d.classList.add("wild");
    d.setAttribute("aria-label", v + (v === 1 ? " (wild)" : ""));
    return d;
  }
  const faceWord = (f, q) => (q === 1 ? ["", "one", "two", "three", "four", "five", "six"][f] : ["", "ones", "twos", "threes", "fours", "fives", "sixes"][f]);
  const bidText = (b) => b.q + " × " + (b.f === 1 ? "1s" : b.f + "s");
  const seatName = (i) => M.table.seats[i].name;

  // ---------- the table ----------
  function eventText(e) {
    const t = M.table;
    const n = (i) => (t.you === i ? "You" : seatName(i));
    const v = (i, a, b) => (t.you === i ? a : b);
    switch (e.e) {
      case "bid": return n(e.seat) + " " + v(e.seat, "bid", "bids") + " " + bidText(e);
      case "dudo": return n(e.seat) + " " + v(e.seat, "call", "calls") + " dudo on " + (t.you === e.bidder ? "you" : seatName(e.bidder));
      case "count": return "There " + (e.count === 1 ? "is " : "are ") + e.count + " " + (e.f === 1 ? "1s" : e.f + "s") + " (with the wild ones): " + (e.good ? "the bid was good" : "it was a lie");
      case "lose": return n(e.seat) + " " + v(e.seat, "lose", "loses") + " a die";
      case "out": return n(e.seat) + " " + v(e.seat, "are", "is") + " out";
      case "win": return n(e.seat) + " " + v(e.seat, "win", "wins");
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
      const box = el("div", "ld-opp" + (t.turn === i && M.phase === "playing" ? " act" : "") + (s.status === "out" ? " gone" : ""));
      box.append(el("div", "nm", s.name));
      let st = s.bot ? "computer" : "";
      const p = M.players && M.players.find((x) => x.seat === i);
      if (p && !s.bot) {
        if (p.autoBot && !p.online) st = "offline: a bot is playing";
        else if (!p.online) st = "offline: computer in " + Math.max(0, Math.ceil((p.offlineSince + M.takeoverMs - ms.nowMs()) / 1000)) + "s";
      }
      if (s.status === "out") st = "out";
      box.append(el("div", "st" + (p && !p.online ? " warn" : ""), st || " "));
      const dice = el("div", "ld-dice");
      if (reveal && s.hand) s.hand.forEach((v) => dice.append(dieEl(v, "sm" + (hits(v) ? " hit" : ""))));
      else for (let k = 0; k < s.count; k++) dice.append(dieEl(0, "sm"));
      box.append(dice);
      oppsEl.append(box);
    });
  }
  // does this die count towards the bid that was just challenged?
  const hits = (v) => { const r = M.table.reveal; return !!r && (v === r.f || (r.f !== 1 && v === 1)); };

  function renderBid() {
    const t = M.table;
    bidEl.innerHTML = "";
    if (!t.bid) { bidEl.append(el("span", "by", M.phase === "playing" && t.turn === t.you ? "You open the bidding" : "No bid yet: " + seatName(t.turn) + " opens")); return; }
    bidEl.append(el("span", "q", String(t.bid.q) + " ×"), dieEl(t.bid.f, "lg"));
    bidEl.append(el("span", "by", (t.bid.seat === t.you ? "Your" : seatName(t.bid.seat) + "'s") + " bid: at least " + t.bid.q + " " + faceWord(t.bid.f, t.bid.q) + (t.bid.f === 1 ? "" : " (ones count too)")));
  }

  function renderBanner() {
    const t = M.table;
    bannerEl.className = "ld-banner";
    let text = "";
    const mine = t.turn === t.you && M.phase === "playing";
    if (M.phase === "game_over") text = t.winner === t.you ? "You won!" : seatName(t.winner) + " wins";
    else if (M.phase === "round_over") {
      const r = t.reveal;
      text = (r.good ? "The bid was good. " : "It was a lie. ") + (r.loser === t.you ? "You lose" : seatName(r.loser) + " loses") + " a die";
    } else if (t.you === null || t.seats[t.you].status === "out") text = "You're out. Watching: " + seatName(t.turn) + "'s turn";
    else if (mine) { text = t.bid ? "Your turn: raise the bid or call dudo" : "Your turn: make the opening bid"; bannerEl.classList.add("you"); }
    else { text = "Waiting for " + seatName(t.turn); const left = idleLeft(); if (left !== null) text += " (" + left + "s)"; }
    bannerEl.textContent = text;
  }

  function renderMine() {
    const t = M.table;
    mineEl.innerHTML = "";
    if (t.you === null) return;
    const s = t.seats[t.you];
    const reveal = t.reveal && M.phase !== "playing";
    const hand = reveal && s.hand ? s.hand : s.hand || [];
    const sorted = hand.slice().sort((a, b) => a - b);
    sorted.forEach((v) => mineEl.append(dieEl(v, "lg" + (reveal && hits(v) ? " hit" : ""))));
    // a new round's hand is rolled in (the shared dice roll), once per round
    const key = t.round + ":" + sorted.join("");
    if (M.phase === "playing" && sorted.length && key !== handKey) {
      handKey = key;
      Gamekit.rollDice([...mineEl.children].map((d, i) => ({ el: d, v: sorted[i] })), paintDie);
    }
  }
  let handKey = "";
  function paintDie(d, v) { Gamekit.paintPips(d, v); d.classList.toggle("wild", v === 1); }

  function renderControls() {
    const t = M.table;
    boxEl.innerHTML = "";
    const mine = t.turn === t.you && M.phase === "playing";
    if (!mine) { hintEl.textContent = M.phase === "round_over" ? nextRoundText() : ""; if (M.kind === "local" && M.phase === "round_over") addContinue(); return; }
    const minQ = t.options.minQ, total = t.total;
    const key = t.round + ":" + (t.bid ? t.bid.q + "x" + t.bid.f + "s" + t.bid.seat : "open");
    if (key !== bidKey) {                                   // a new turn: start from the smallest sensible raise
      bidKey = key;
      if (t.bid) { bf = t.bid.f; bq = t.bid.q + 1; } else { bf = 2; bq = 1; }
      fixBid(minQ, total);
    }
    // quantity
    const qty = el("div", "ld-qty");
    const minus = el("button", "btn ld-step", "−"); minus.type = "button";
    const plus = el("button", "btn ld-step", "+"); plus.type = "button";
    const n = el("span", "n", String(bq));
    minus.disabled = !(minQ[bf] !== null && bq > minQ[bf]);
    plus.disabled = bq >= total;
    minus.addEventListener("click", () => { bq--; renderControls(); });
    plus.addEventListener("click", () => { bq++; renderControls(); });
    qty.append(minus, n, plus);
    // faces
    const faces = el("div", "ld-faces");
    for (let f = 1; f <= 6; f++) {
      const b = el("button", "ld-face" + (f === bf ? " sel" : "")); b.type = "button";
      b.append(dieEl(f, "sm"), el("span", "", f === 1 ? "wild" : String(f)));
      b.disabled = minQ[f] === null;
      b.addEventListener("click", () => { bf = f; fixBid(minQ, total); renderControls(); });
      b.setAttribute("aria-label", "bid on " + f + "s");
      faces.append(b);
    }
    const acts = el("div", "ld-actions");
    const go = el("button", "btn primary", "Bid " + bq + " × " + (bf === 1 ? "1s" : bf + "s")); go.type = "button";
    go.disabled = !L.legal(t.bid, bq, bf, total);
    go.addEventListener("click", () => send({ t: "bid", q: bq, f: bf }));
    const dudo = el("button", "btn", "Dudo!"); dudo.type = "button"; dudo.disabled = !t.options.dudo;
    dudo.addEventListener("click", () => send({ t: "dudo" }));
    acts.append(go, dudo);
    boxEl.append(qty, faces, acts);
    hintEl.textContent = L.legal(t.bid, bq, bf, total) ? "" : "That bid isn't high enough: raise the number or pick a higher face.";
  }
  // make the quantity at least the least legal one for the chosen face
  function fixBid(minQ, total) {
    if (minQ[bf] === null) { const f = [2, 3, 4, 5, 6, 1].find((x) => minQ[x] !== null); if (f) bf = f; }
    if (minQ[bf] !== null && bq < minQ[bf]) bq = minQ[bf];
    if (bq > total) bq = total;
  }
  const nextRoundText = () => (M.kind === "online" ? "Next round in " + Math.max(0, Math.ceil((M.table.reveal ? (M.turnSince + M.table.pause - ms.nowMs()) / 1000 : 0))) + "s" : "");
  function addContinue() {
    const b = el("button", "btn primary", "Next round"); b.type = "button";
    b.addEventListener("click", localNextRound);
    boxEl.append(b);
  }

  function renderLog() {
    logEl.textContent = (M.lastEvents || []).map(eventText).filter(Boolean).slice(-3).join(" · ");
  }
  function renderTable() {
    if (!M || !M.table || M.phase === "lobby" || M.phase === "landing" || M.phase === "closed") { tableEl.classList.remove("on"); return; }
    tableEl.classList.add("on");
    renderOpps(); renderBid(); renderBanner(); renderMine(); renderControls(); renderLog();
  }

  function send(action) {
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
    const table = L.view(st, st.seats[0].status === "in" ? 0 : null);
    table.you = 0;
    return { kind: "local", phase: localPhase(st), table, players: null, you: { seat: 0, host: true }, lastEvents: Lc.events, config: Lc.cfg };
  }
  function localStart() {
    clearTimeout(Lc && Lc.timer);
    const n = Number(botsSel.value);
    const names = ["You"].concat(Array.from({ length: n }, (_, i) => "Bot " + (i + 1)));
    const bots = [null].concat(Array(n).fill(diff));
    Lc = { st: L.create({ names, bots, starter: 0 }, Math.random), cfg: { bots: n, level: diff }, events: [], timer: null };
    bidKey = "";
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
    const res = L.act(Lc.st, 0, action, Math.random);
    if (!res.ok) { ms.toast("That can't be done right now."); return; }
    Lc.events = res.events; localRender(); localSchedule();
  }
  function localNextRound() {
    const st = Lc.st;
    if (st.phase !== "round_over") return;
    clearTimeout(Lc.timer);
    L.nextRound(st, Math.random); Lc.events = [{ e: "new-round", round: st.round }]; localRender(); localSchedule();
  }
  function localSchedule() {
    clearTimeout(Lc.timer);
    const st = Lc.st;
    if (st.phase === "round_over") { Lc.timer = setTimeout(localNextRound, 9000); return; }
    if (st.phase !== "play" || st.turn === 0) return;
    Lc.timer = setTimeout(() => {
      const seat = st.turn;
      let res = L.act(st, seat, L.botAct(st, seat, st.seats[seat].bot, Math.random), Math.random);
      if (!res.ok) res = L.act(st, seat, L.fallback(st, seat), Math.random);
      if (res.ok) Lc.events = res.events;
      localRender(); localSchedule();
    }, 1000 + Math.random() * 700);
  }
  function renderLocalGameOver() {
    if (!M || M.kind !== "local") { return; }
    roomEl.innerHTML = "";
    if (M.phase !== "game_over") { roomEl.hidden = true; return; }
    roomEl.hidden = false;
    const t = M.table;
    roomEl.append(el("h3", "", t.winner === 0 ? "You won!" : seatName(t.winner) + " won"));
    const b = el("button", "btn primary", "Play again"); b.type = "button"; b.addEventListener("click", localStart);
    roomEl.append(b);
  }

  /* ============================================================
     Online rooms: the shared screens (multiseat.js), our own table
     ============================================================ */
  const ms = MultiSeat.create({
    game: "liars-dice", title: "Liar's Dice", roomEl, tauntsEl, store,
    onModel: (m) => { M = m; renderAll(true); },
    onTick: () => { if (tableEl.classList.contains("on") && M && M.kind === "online") { renderOpps(); renderBanner(); if (M.phase === "round_over") hintEl.textContent = nextRoundText(); } },
  });

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

  if (typeof LiveShare !== "undefined") LiveShare.enable(modeSel, "liars-dice", invited);
  applyMode();

  // A refresh keeps a game against the computer.
  const resumer = Gamekit.resume("liars-dice", () => (mode !== "computer" || !Lc || Lc.st.phase === "game_over" || Lc.st.moves === 0) ? null : { st: Lc.st, cfg: Lc.cfg }, (s) => {
    const st = s.st;
    if (!st || st.v !== 1 || st.game !== "liars-dice" || !Array.isArray(st.seats) || st.seats.length < 2 || st.seats.length > 4) return false;
    if (!st.seats.every((x) => x && Number.isInteger(x.dice) && x.dice >= 0 && x.dice <= 5 && Array.isArray(x.hand) && x.hand.every((d) => d >= 1 && d <= 6))) return false;
    if (!["play", "round_over"].includes(st.phase) || !Number.isInteger(st.turn) || st.turn < 0 || st.turn >= st.seats.length) return false;
    mode = "computer"; modeSel.value = "computer"; applyMode();
    clearTimeout(Lc.timer);
    Lc = { st, cfg: s.cfg || { bots: st.seats.length - 1, level: diff }, events: [], timer: null };
    botsSel.value = String(st.seats.length - 1); bidKey = "";
    localRender(); localSchedule();
    return true;
  });
  if (!invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("liars-dice"));
})();
