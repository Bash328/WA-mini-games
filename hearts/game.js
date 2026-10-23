(function () {
  "use strict";

  const H = globalThis.Hearts;
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), modeSel = $("mode"), chipsEl = $("chips"), resetBtn = $("reset-btn");
  const roomEl = $("ms-room"), root = $("ht"), scoresEl = $("ht-scores"), stageEl = $("ht-stage");
  const opEl = $("ht-op"), olEl = $("ht-ol"), orEl = $("ht-or"), meEl = $("ht-me");
  const trickEl = $("ht-trick"), noteEl = $("ht-note"), handEl = $("ht-hand"), actionsEl = $("ht-actions"), hintEl = $("ht-hint"), tauntsEl = $("ms-taunts");
  const store = Gamekit.storage("hearts:");

  let diff = store.get("diff", "medium");
  if (!["easy", "medium", "hard"].includes(diff)) diff = "medium";
  let mode = store.get("mode", "computer");
  const params = new URLSearchParams(location.search);
  const invited = params.has("live");
  if (invited) mode = "live";
  if (mode !== "computer" && mode !== "live") mode = "computer";
  modeSel.value = mode;

  // M = { kind: "local" | "online", phase, table: engine view | null, ... } (see multiseat.js)
  let M = null;
  let Lc = null;                                  // the game against the computer: { st, cfg, events, timer }
  let sel = new Set();                            // cards chosen for the pass
  let lastTrick = null;                           // { cards, winner, pts } kept up for a moment
  let trickTimer = null;
  let eventKey = "", statusKey = "";

  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const youSeat = () => (M && M.table && M.table.you !== null && M.table.you !== undefined ? M.table.you : 0);
  const seatName = (i) => (M && M.table && M.table.seats[i] ? M.table.seats[i].name : "Player " + (i + 1));
  const nameOf = (i) => (i === youSeat() ? "You" : seatName(i));
  const suitOf = (c) => c.slice(-1);
  const rankOf = (c) => c.slice(0, -1);
  const red = (c) => { const s = suitOf(c); return s === "H" || s === "D"; };
  const SUIT_CH = { S: "\u2660\uFE0E", H: "\u2665\uFE0E", C: "\u2663\uFE0E", D: "\u2666\uFE0E" };
  const SUIT_WORD = { S: "spades", H: "hearts", C: "clubs", D: "diamonds" };
  const RANK_WORD = { A: "Ace", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten", J: "Jack", Q: "Queen", K: "King" };
  const cardLabel = (c) => RANK_WORD[rankOf(c)] + " of " + SUIT_WORD[suitOf(c)];
  const DIR_TEXT = { left: "Pass 3 cards to the left", right: "Pass 3 cards to the right", across: "Pass 3 cards across the table", hold: "No passing this hand" };
  const DIR_SHORT = { left: "left", right: "right", across: "across", hold: "" };

  // ---------- a card ----------
  function cardNode(card, opts) {
    const o = opts || {};
    if (!card) {
      const b = el("div", "ht-card back" + (o.small ? " sm" : ""));
      b.setAttribute("aria-hidden", "true");
      return b;
    }
    const b = el(o.button ? "button" : "div", "ht-card" + (red(card) ? " red" : "") + (o.small ? " sm" : "") + (rankOf(card) === "10" ? " ten" : ""));
    if (o.button) b.type = "button";
    b.setAttribute("aria-label", cardLabel(card));
    if (o.card) b.dataset.card = card;
    b.append(el("span", "r", rankOf(card)), el("span", "s", SUIT_CH[suitOf(card)]), el("span", "big", SUIT_CH[suitOf(card)]));
    return b;
  }

  function idleLeft() {
    if (!M || M.kind !== "online" || !M.table || !M.turnSince) return null;
    const p = M.players && M.players.find((x) => x.seat === M.table.turn);
    if (!p || p.autoBot || !p.online) return null;
    return Math.max(0, Math.ceil((M.turnSince + M.idleMs - ms.nowMs()) / 1000));
  }

  // ---------- the board ----------
  function renderScores() {
    const t = M.table, you = youSeat();
    scoresEl.innerHTML = "";
    t.seats.forEach((s, i) => {
      const box = el("div", "ht-score" + (i === you ? " you" : "") + (t.phase === "play" && t.turn === i ? " turn" : "") + (t.phase === "game_over" && t.winner === i ? " win" : ""));
      box.append(el("span", "nm", i === you ? "You" : s.name));
      const line = el("span", "sc", String(s.score));
      box.append(line);
      if (t.reveal && (t.phase === "round_over" || t.phase === "game_over") && t.reveal.gained && t.reveal.gained[i]) {
        box.append(el("span", "gain", "+" + t.reveal.gained[i]));
      }
      scoresEl.append(box);
    });
  }

  function opponentBox(box, seat) {
    const t = M.table, s = t.seats[seat], you = youSeat();
    box.innerHTML = "";
    const now = t.phase === "play" && t.turn === seat;
    box.classList.toggle("now", now);
    const nm = el("div", "nm");
    nm.append(el("b", "", s.name), el("i", "sc", String(s.score)));
    const fan = el("div", "fan");
    const shown = Math.min(13, s.count);
    for (let k = 0; k < shown; k++) fan.append(cardNode(null, { small: true }));
    if (!shown) fan.append(el("span", "st", "no cards"));
    box.append(nm, fan);
    let st = s.count + (s.count === 1 ? " card" : " cards") + " · " + s.taken + (s.taken === 1 ? " trick" : " tricks");
    const p = M.players && M.players.find((x) => x.seat === seat);
    if (p && !s.bot) {
      if (p.autoBot && !p.online) st = s.count + " cards · bot is playing";
      else if (!p.online) st = s.count + " cards · offline: computer in " + Math.max(0, Math.ceil((p.offlineSince + M.takeoverMs - ms.nowMs()) / 1000)) + "s";
    } else if (s.bot) st = s.count + " cards · bot";
    box.append(el("div", "st", st));
    box.hidden = seat === you;
  }

  function renderSeats() {
    const t = M.table, you = youSeat();
    // relative seats: 1 = left, 2 = across (top), 3 = right
    const boxes = { 1: olEl, 2: opEl, 3: orEl };
    [1, 2, 3].forEach((rel) => opponentBox(boxes[rel], (you + rel) % 4));
    const s = t.seats[you];
    meEl.innerHTML = "";
    meEl.classList.toggle("now", t.phase === "play" && t.turn === you);
    meEl.append(document.createTextNode("You"), el("i", "sc", String(s.score)));
    meEl.append(el("span", "", "· " + s.count + (s.count === 1 ? " card" : " cards")));
  }

  function showTrick(ev) {
    lastTrick = { cards: ev.cards.slice(), winner: ev.winner, pts: ev.pts || 0 };
    clearTimeout(trickTimer);
    trickTimer = setTimeout(() => {
      lastTrick = null;
      if (M && M.table) { renderTrick(); renderNote(); }
    }, reduceMotion ? 500 : 1600);
  }

  function renderTrick() {
    const t = M.table, you = youSeat();
    trickEl.innerHTML = "";
    const plays = lastTrick ? lastTrick.cards : t.plays;
    if (!plays || !plays.length) {
      trickEl.append(el("div", "ht-empty", t.phase === "pass" ? "Pass" : "Round " + t.round));
      return;
    }
    const pos = ["me", "l", "t", "r"];
    plays.forEach((p) => {
      const rel = (p.seat - you + 4) % 4;
      const wrap = el("div", "ht-play pos-" + pos[rel]);
      if (lastTrick && lastTrick.winner === p.seat) wrap.classList.add("took");
      wrap.append(cardNode(p.card));
      trickEl.append(wrap);
    });
  }

  function renderNote() {
    const t = M.table;
    let text = "";
    if (t.phase === "pass") text = DIR_TEXT[t.passDir] || "Pass three cards";
    else if (t.phase === "round_over") {
      text = t.reveal && t.reveal.shot !== null && t.reveal.shot !== undefined
        ? nameOf(t.reveal.shot) + " shot the moon"
        : "Hand " + t.round + " scored";
    } else if (t.phase === "game_over") text = nameOf(t.winner) + " wins with the lowest score";
    else if (lastTrick) text = nameOf(lastTrick.winner) + " took " + lastTrick.pts + (lastTrick.pts === 1 ? " point" : " points");
    else if (t.heartsBroken) text = "Hearts are broken";
    else text = "Round " + t.round + " · trick " + t.trickNo;
    noteEl.textContent = text;
  }

  function whyNot(card) {
    const t = M.table;
    if (t.phase !== "play") return "The hand isn't running.";
    if (t.turn !== t.you) return "It's not your turn yet.";
    if (t.trickNo === 1 && !t.plays.length) return "The holder of the two of clubs leads the first trick.";
    if (!t.plays.length) {
      const hand = t.seats[t.you].hand || [];
      if (suitOf(card) === "H" && !t.heartsBroken && hand.some((c) => suitOf(c) !== "H")) return "You can't lead a heart until one has been played.";
    } else {
      const lead = suitOf(t.plays[0].card);
      const hand = t.seats[t.you].hand || [];
      if (suitOf(card) !== lead && hand.some((c) => suitOf(c) === lead)) return "You must follow " + SUIT_WORD[lead] + ".";
    }
    if (t.trickNo === 1 && H.pointCard(card) > 0) return "No points on the first trick if you can avoid them.";
    return "That card can't be played now.";
  }

  function renderHand() {
    const t = M.table;
    handEl.innerHTML = "";
    const you = t.you;
    if (you === null || you === undefined) { hintEl.textContent = "You're watching this table."; return; }
    const hand = (t.seats[you].hand || []).slice();
    // forget selections that are no longer in hand
    sel.forEach((c) => { if (!hand.includes(c)) sel.delete(c); });
    const pass = t.options.pass || 0;
    const legal = t.options.plays || [];
    const myTurn = t.phase === "play" && t.turn === you;
    hand.forEach((c) => {
      const b = cardNode(c, { button: true, card: true });
      if (pass > 0) {
        if (sel.has(c)) b.classList.add("pick");
      } else if (myTurn) {
        b.classList.add(legal.includes(c) ? "play" : "dim");
      } else b.classList.add("dim");
      b.addEventListener("click", () => onCard(c));
      handEl.append(b);
    });
    if (!hand.length) handEl.append(el("div", "ht-hint", "Hand over."));
  }

  function renderActions() {
    const t = M.table;
    actionsEl.innerHTML = "";
    if (t.phase === "pass" && t.options.pass > 0) {
      const b = el("button", "btn primary", "Pass " + (DIR_SHORT[t.passDir] || "three") + " · " + sel.size + "/3");
      b.type = "button";
      b.disabled = sel.size !== 3;
      b.addEventListener("click", sendPass);
      actionsEl.append(b);
    } else if (t.phase === "round_over" && M.kind === "local") {
      const b = el("button", "btn primary", "Next hand");
      b.type = "button";
      b.addEventListener("click", localNextRound);
      actionsEl.append(b);
    }
  }

  function renderHint() {
    const t = M.table;
    if (t.phase === "pass") {
      if (t.options.pass > 0) hintEl.textContent = sel.size < 3 ? "Tap " + (3 - sel.size) + " more card" + (3 - sel.size === 1 ? "" : "s") + " to pass." : "Ready — tap Pass.";
      else hintEl.textContent = "Waiting for the other players to pass.";
      return;
    }
    if (t.phase === "round_over") {
      if (M.kind === "online") hintEl.textContent = "Next hand in " + Math.max(0, Math.ceil((M.turnSince + 5000 - ms.nowMs()) / 1000)) + "s.";
      else hintEl.textContent = "Tap Next hand when you're ready.";
      return;
    }
    if (t.phase === "game_over") { hintEl.textContent = ""; return; }
    if (t.turn === t.you) hintEl.textContent = t.plays.length ? "Tap a highlighted card." : "You lead this trick.";
    else {
      const left = idleLeft();
      hintEl.textContent = "Waiting for " + seatName(t.turn) + (left !== null ? " (" + left + "s)" : "") + ".";
    }
  }

  function setStatus() {
    const t = M.table;
    if (M.phase === "game_over" || t.phase === "game_over") {
      const key = "over:" + t.winner + ":" + t.you;
      if (key !== statusKey) {
        statusKey = key;
        statusEl.textContent = t.winner === t.you ? "You win! " + Gamekit.taunt("win") : seatName(t.winner) + " wins. " + Gamekit.taunt("loss");
      }
    } else { statusKey = ""; statusEl.textContent = ""; }
  }

  function renderAll() {
    if (!M || !M.table || M.phase === "landing" || M.phase === "lobby" || M.phase === "closed") {
      root.classList.remove("on");
      statusEl.textContent = "";
      return;
    }
    root.classList.add("on");
    renderScores(); renderSeats(); renderTrick(); renderNote(); renderHand(); renderActions(); renderHint(); setStatus();
  }

  // ---------- playing ----------
  function onCard(card) {
    const t = M && M.table;
    if (!t) return;
    if (t.phase === "pass") {
      if (t.options.pass <= 0) { hintEl.textContent = "Waiting for the other players to pass."; return; }
      if (sel.has(card)) sel.delete(card);
      else {
        if (sel.size >= 3) sel.delete(sel.values().next().value);
        sel.add(card);
      }
      renderHand(); renderActions(); renderHint();
      return;
    }
    if (t.phase !== "play") return;
    if (t.turn !== t.you) { hintEl.textContent = "It's not your turn yet."; return; }
    if (!(t.options.plays || []).includes(card)) { hintEl.textContent = whyNot(card); return; }
    send({ t: "play", card });
  }

  function sendPass() {
    if (sel.size !== 3) return;
    const cards = Array.from(sel);
    send({ t: "pass", cards });
  }

  function send(action) {
    sel.clear();
    if (!M) return;
    if (M.kind === "local") return localAct(action);
    ms.send(action);
  }

  function handleEvents(events) {
    let trick = null;
    (events || []).forEach((e) => { if (e.e === "trick") trick = e; });
    if (trick) showTrick(trick);
  }

  /* ============================================================
     vs computer: the same engine, running in the page
     ============================================================ */
  function localModel() {
    const st = Lc.st;
    const table = H.view(st, 0);
    table.you = 0;
    return { kind: "local", phase: st.phase, table, players: null, you: { seat: 0, host: true }, lastEvents: Lc.events, config: Lc.cfg };
  }
  function localStart() {
    clearTimeout(Lc && Lc.timer);
    const names = ["You", "Bot 1", "Bot 2", "Bot 3"];
    const bots = [null, diff, diff, diff];
    Lc = { st: H.create({ names, bots }, Math.random), cfg: { level: diff }, events: [], timer: null };
    sel.clear(); lastTrick = null; eventKey = ""; clearTimeout(trickTimer);
    localRender(); localSchedule();
  }
  function localRender() {
    M = localModel();
    renderAll();
  }
  function localAct(action) {
    const res = H.act(Lc.st, 0, action, Math.random);
    if (!res.ok) { hintEl.textContent = "That can't be done right now."; return; }
    Lc.events = res.events;
    handleEvents(res.events);
    localRender(); localSchedule();
  }
  function localNextRound() {
    if (Lc.st.phase !== "round_over") return;
    clearTimeout(Lc.timer);
    H.nextRound(Lc.st, Math.random);
    Lc.events = [];
    sel.clear(); lastTrick = null; clearTimeout(trickTimer);
    localRender(); localSchedule();
  }
  function localSchedule() {
    clearTimeout(Lc.timer);
    const st = Lc.st;
    if (st.phase !== "play" || st.turn === 0) return;
    Lc.timer = setTimeout(() => {
      const seat = st.turn;
      let res = H.act(st, seat, H.botAct(st, seat, st.seats[seat].bot, Math.random), Math.random);
      if (!res.ok) res = H.act(st, seat, H.fallback(st, seat), Math.random);
      if (res.ok) { Lc.events = res.events; handleEvents(res.events); }
      localRender(); localSchedule();
    }, 900 + Math.random() * 400);
  }

  /* ============================================================
     Online rooms: the shared screens (multiseat.js), our own table
     ============================================================ */
  const ms = MultiSeat.create({
    game: "hearts", title: "Hearts", roomEl, tauntsEl, store,
    tableSize: 4, fixedSeats: true,
    onModel: (m) => {
      if (m.phase === "playing" && M && (M.phase === "lobby" || M.phase === "game_over")) {
        sel.clear(); lastTrick = null; clearTimeout(trickTimer);
      }
      M = m;
      if (m.table) {
        const key = JSON.stringify(m.lastEvents || []);
        if (key !== eventKey) { eventKey = key; handleEvents(m.lastEvents); }
      }
      renderAll();
    },
    onTick: () => { if (M && M.table && M.kind === "online" && M.phase === "playing") { renderSeats(); renderHint(); renderActions(); } },
  });

  /* ---------- modes and controls ---------- */
  function applyMode() {
    const local = mode === "computer";
    chipsEl.hidden = !local;
    resetBtn.hidden = !local;
    if (local) {
      if (ms.active()) ms.stop();
      localStart();
    } else {
      clearTimeout(Lc && Lc.timer);
      Lc = null; M = null; sel.clear(); lastTrick = null; eventKey = ""; clearTimeout(trickTimer);
      root.classList.remove("on");
      const c = (params.get("live") || "").toUpperCase();
      if (invited && /^[A-HJ-NP-Z2-9]{6}$/.test(c) && !ms.active()) ms.enter(c);
      else if (!ms.active()) ms.landing();
      else renderAll();
    }
  }
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; if (mode === "computer") localStart(); },
  });
  diff = chips.get();
  modeSel.addEventListener("change", () => { mode = modeSel.value; if (mode !== "live") store.set("mode", mode); applyMode(); });
  resetBtn.addEventListener("click", () => { if (mode === "computer") localStart(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sel.size && !document.querySelector(".man-backdrop")) { sel.clear(); if (M && M.table) renderAll(); } });

  if (typeof LiveShare !== "undefined") LiveShare.enable(modeSel, "hearts", invited);
  applyMode();

  // A refresh keeps a game against the computer.
  const resumer = Gamekit.resume("hearts", () => (mode !== "computer" || !Lc || Lc.st.phase === "game_over" || Lc.st.moves === 0) ? null : { st: Lc.st, cfg: Lc.cfg }, (s) => {
    const st = s.st;
    if (!st || st.v !== 1 || st.game !== "hearts" || !Array.isArray(st.seats) || st.seats.length !== 4) return false;
    if (!["pass", "play", "round_over"].includes(st.phase)) return false;
    if (!st.seats.every((x) => Array.isArray(x.hand) && Array.isArray(x.taken) && Number.isInteger(x.score))) return false;
    if (!Array.isArray(st.plays) || st.plays.length > 3 || !Array.isArray(st.passed) || st.passed.length !== 4) return false;
    if (!Number.isInteger(st.turn) || st.turn < 0 || st.turn >= 4 || !Number.isInteger(st.round)) return false;
    const cards = st.seats.flatMap((x) => x.hand).concat(st.plays.map((p) => p && p.card), st.seats.flatMap((x) => x.taken.flatMap((t) => (Array.isArray(t) ? t : []))));
    if (cards.length !== 52 || new Set(cards).size !== 52 || !cards.every(H.isCard)) return false;
    if (!st.passed.every((p) => p === null || (Array.isArray(p) && p.length === 3 && p.every(H.isCard)))) return false;
    mode = "computer"; modeSel.value = "computer"; chipsEl.hidden = false; resetBtn.hidden = false;
    const lv = s.cfg && s.cfg.level;
    if (["easy", "medium", "hard"].includes(lv)) chips.show(lv);
    if (ms.active()) ms.stop();
    Lc = { st, cfg: s.cfg || { level: diff }, events: [], timer: null };
    sel.clear(); lastTrick = null; eventKey = ""; clearTimeout(trickTimer);
    localRender(); localSchedule();
    return true;
  });
  if (!invited && mode === "computer") resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("hearts"));
})();
