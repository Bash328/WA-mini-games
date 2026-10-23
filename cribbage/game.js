(function () {
  "use strict";

  const C = globalThis.Cribbage;
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), modeSel = $("mode"), chipsEl = $("chips"), resetBtn = $("reset-btn");
  const roomEl = $("ms-room"), root = $("cb"), scoresEl = $("cb-scores");
  const playEl = $("cb-play"), reviewEl = $("cb-review"), oppBandEl = $("cb-oppband");
  const oppNameEl = $("cb-oppname"), oppMetaEl = $("cb-oppmeta"), oppBacksEl = $("cb-oppbacks");
  const cribEl = $("cb-crib"), starterEl = $("cb-starter"), midTitleEl = $("cb-midtitle"), midSubEl = $("cb-midsub");
  const countEl = $("cb-count"), lineEl = $("cb-line"), noteEl = $("cb-note"), meBandEl = $("cb-meband");
  const handEl = $("cb-hand"), actionsEl = $("cb-actions"), hintEl = $("cb-hint"), tauntsEl = $("ms-taunts");
  const store = Gamekit.storage("cribbage:");

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
  let sel = new Set();                            // cards chosen for the crib
  let statusKey = "";

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
  const shortCard = (c) => rankOf(c) + SUIT_CH[suitOf(c)];
  const cardCount = (n) => n + (n === 1 ? " card" : " cards");

  const idleLeft = () => {
    if (!M || M.kind !== "online" || !M.table || !M.turnSince) return null;
    const p = M.players && M.players.find((x) => x.seat === M.table.turn);
    if (!p || p.autoBot || !p.online) return null;
    return Math.max(0, Math.ceil((M.turnSince + M.idleMs - ms.nowMs()) / 1000));
  };

  // ---------- a card ----------
  function cardNode(card, opts) {
    const o = opts || {};
    if (!card) {
      const b = el("div", "cb-back");
      b.setAttribute("aria-hidden", "true");
      return b;
    }
    const b = el(o.button ? "button" : "div", "cb-card"
      + (red(card) ? " red" : "")
      + (o.small ? " sm" : "")
      + (o.starter ? " startercard" : "")
      + (rankOf(card) === "10" ? " ten" : ""));
    if (o.button) b.type = "button";
    b.setAttribute("aria-label", cardLabel(card));
    if (o.card) b.dataset.card = card;
    b.append(el("span", "r", rankOf(card)), el("span", "s", SUIT_CH[suitOf(card)]), el("span", "big", SUIT_CH[suitOf(card)]));
    return b;
  }

  // ---------- the board ----------
  function renderScores() {
    const t = M.table, you = youSeat();
    scoresEl.innerHTML = "";
    [1 - you, you].forEach((seat) => {
      const s = t.seats[seat];
      const active = (t.phase === "discard" || t.phase === "pegging") && t.turn === seat;
      const win = t.phase === "game_over" && t.winner === seat;
      const box = el("div", "cb-score" + (seat === you ? " you" : "") + (active ? " turn" : "") + (win ? " win" : ""));
      box.append(el("span", "nm", seat === you ? "You" : s.name), el("span", "sc", String(s.score)));
      if (s.dealer) box.append(el("span", "tag", "dealer"));
      scoresEl.append(box);
    });
  }

  function renderOpp() {
    const t = M.table, you = youSeat(), opp = 1 - you, s = t.seats[opp];
    oppNameEl.textContent = s.name;
    oppMetaEl.textContent = cardCount(s.count) + (s.dealer ? " · dealer" : " · non-dealer");
    oppBandEl.classList.toggle("cb-oppnow", (t.phase === "discard" || t.phase === "pegging") && t.turn === opp);
    oppBacksEl.innerHTML = "";
    const shown = Math.min(6, s.count);
    for (let i = 0; i < shown; i++) oppBacksEl.append(cardNode(null));
  }

  function renderMe() {
    const t = M.table, s = t.seats[youSeat()];
    meBandEl.innerHTML = "";
    meBandEl.append(el("b", "", "You"), el("span", "", cardCount(s.count) + (s.dealer ? " · dealer" : " · non-dealer")));
    meBandEl.setAttribute("aria-label", "You, " + cardCount(s.count) + (s.dealer ? ", dealer" : ", non-dealer"));
  }

  function renderCrib() {
    const t = M.table, you = youSeat();
    cribEl.innerHTML = "";
    const shown = Math.min(4, t.cribCount);
    for (let i = 0; i < shown; i++) cribEl.append(cardNode(null));
    const lbl = el("span", "lbl");
    lbl.append(document.createTextNode("crib"), el("b", "", String(t.cribCount)));
    cribEl.append(lbl);
    cribEl.classList.toggle("ours", t.dealer === you);
    cribEl.setAttribute("aria-label", "Crib, " + t.cribCount + " face-down cards" + (t.dealer === you ? ", yours" : ""));
  }

  function renderStarter() {
    const t = M.table;
    starterEl.innerHTML = "";
    if (t.starter) starterEl.append(cardNode(t.starter, { starter: true }));
    else starterEl.append(el("span", "cb-emptycard"));
    starterEl.append(el("span", "cap", "starter"));
  }

  function renderMid() {
    const t = M.table, you = youSeat();
    countEl.textContent = String(t.pegging.count);
    lineEl.innerHTML = "";
    (t.pegging.line || []).forEach((p) => {
      const n = cardNode(p.card, { small: true });
      n.setAttribute("aria-label", nameOf(p.seat) + " played " + cardLabel(p.card));
      lineEl.append(n);
    });

    if (t.phase === "discard") {
      midTitleEl.textContent = t.turn === you ? "Throw two cards" : "Crib";
      midSubEl.textContent = t.turn === you ? "to the dealer's crib" : nameOf(t.turn) + " is choosing";
    } else if (t.phase === "pegging") {
      midTitleEl.textContent = "Pegging";
      midSubEl.textContent = nameOf(t.leader) + " leads · 15s, pairs and runs score";
    } else {
      midTitleEl.textContent = "";
      midSubEl.textContent = "";
    }

    let note = "";
    if (t.phase === "discard") note = "Dealer: " + nameOf(t.dealer) + " · " + cardCount(t.cribCount) + " in the crib";
    else if (t.phase === "pegging") {
      if (t.pegging.last) note = nameOf(t.pegging.last.seat) + " played " + shortCard(t.pegging.last.card) + " · count " + t.pegging.count;
      else if (t.heels) note = "Starter Jack · " + nameOf(t.dealer) + " scored 2 for heels";
      else note = "Count " + t.pegging.count;
      if (t.pegging.go[0] || t.pegging.go[1]) note += " · go";
    } else if (t.phase === "game_over" && t.winner !== null) note = nameOf(t.winner) + " wins";
    noteEl.textContent = note;
  }

  function bitsFor(s) {
    return "15s " + s.fifteens + " · pairs " + s.pairs + " · runs " + s.runs + " · flush " + s.flush + " · nobs " + s.nobs;
  }

  function renderReview() {
    const t = M.table;
    reviewEl.innerHTML = "";
    if (!t.reveal) { playEl.hidden = false; reviewEl.hidden = true; return; }
    playEl.hidden = true;
    reviewEl.hidden = false;
    const head = el("div", "cb-reviewhead");
    const title = t.phase === "game_over" ? "Final count" : t.phase === "round_over" ? "Hand counted" : "Counting hands";
    head.append(el("span", "t", title));
    const st = el("span", "startermini");
    if (t.starter) st.append(cardNode(t.starter, { small: true }), document.createTextNode("starter"));
    head.append(st);
    reviewEl.append(head);

    const order = [1 - t.dealer, t.dealer];
    order.forEach((seat) => {
      const hand = t.reveal.hands[seat];
      reviewEl.append(scoreRow(nameOf(seat) + (seat === t.dealer ? " · dealer" : ""), "hand", hand, false));
    });
    reviewEl.append(scoreRow(nameOf(t.dealer) + " · crib", "dealer's crib", t.reveal.crib, true));
  }

  function scoreRow(who, kind, s, crib) {
    const row = el("div", "cb-srow" + (crib ? " cribrow" : ""));
    const w = el("div", "who");
    w.append(el("b", "", who), el("span", "", kind));
    const cards = el("div", "scards");
    s.cards.forEach((c) => cards.append(cardNode(c, { small: true })));
    const pts = el("div", "pts", String(s.total));
    const bits = el("div", "bits", bitsFor(s));
    row.append(w, cards, pts, bits);
    row.setAttribute("aria-label", who + ", " + kind + ", " + s.total + " points: " + bitsFor(s));
    return row;
  }

  function renderPlay() {
    const t = M.table;
    if (t.reveal && (t.phase === "scoring" || t.phase === "round_over" || t.phase === "game_over")) {
      renderReview();
      return;
    }
    playEl.hidden = false;
    reviewEl.hidden = true;
    renderOpp(); renderMe(); renderCrib(); renderStarter(); renderMid();
  }

  function renderHand() {
    const t = M.table, you = youSeat();
    handEl.innerHTML = "";
    if (you === null || you === undefined) { hintEl.textContent = "You're watching this table."; return; }
    const hand = (t.seats[you].hand || []).slice();
    sel.forEach((c) => { if (!hand.includes(c)) sel.delete(c); });
    const discarding = t.phase === "discard" && t.options.discard.length > 0 && t.turn === you;
    const pegging = t.phase === "pegging" && t.turn === you;
    const legal = pegging ? (t.options.play || []) : [];
    hand.forEach((c) => {
      const b = cardNode(c, { button: true, card: true });
      if (discarding) {
        b.classList.add("play");
        if (sel.has(c)) b.classList.add("pick");
      } else if (pegging) {
        b.classList.add(legal.includes(c) ? "play" : "dim");
      } else {
        b.classList.add("dim");
      }
      b.addEventListener("click", () => onCard(c));
      handEl.append(b);
    });
    if (!hand.length) handEl.append(el("span", "cb-hint", "No cards left."));
  }

  function renderActions() {
    const t = M.table, you = youSeat();
    actionsEl.innerHTML = "";
    if (you === null) return;
    if (t.phase === "discard" && t.turn === you && t.options.discard.length) {
      const b = el("button", "btn primary", "Send 2 to crib");
      b.type = "button";
      b.disabled = sel.size !== 2;
      b.addEventListener("click", sendDiscard);
      actionsEl.append(b);
      return;
    }
    if (t.phase === "pegging" && t.turn === you && t.options.go) {
      const b = el("button", "btn primary", "Go");
      b.type = "button";
      b.addEventListener("click", () => send({ t: "go" }));
      actionsEl.append(b);
      return;
    }
    if (t.phase === "scoring" && t.turn === you && t.options.score) {
      const b = el("button", "btn primary", "Score hands");
      b.type = "button";
      b.addEventListener("click", () => send({ t: "score" }));
      actionsEl.append(b);
      return;
    }
    if (t.phase === "round_over" && M.kind === "local") {
      const b = el("button", "btn primary", "Next deal");
      b.type = "button";
      b.addEventListener("click", localNextDeal);
      actionsEl.append(b);
    }
  }

  function whyNot(card) {
    const t = M.table, you = youSeat();
    if (!t) return "The game isn't running.";
    if (t.phase === "discard") return "Choose two cards for the crib.";
    if (t.phase !== "pegging") return "The cards are being counted.";
    if (t.turn !== you) return "It's not your turn.";
    if (cardValue(card) + t.pegging.count > 31) return "That would take the count past 31.";
    return "That card can't be played now.";
  }
  const cardValue = (c) => C.cardValue(c);

  function renderHint() {
    const t = M.table, you = youSeat();
    let text = "";
    if (!t || t.phase === "game_over") text = "";
    else if (you === null) text = "This table is full: you're watching.";
    else if (t.phase === "round_over") {
      if (M.kind === "online" && M.turnSince) {
        const left = Math.max(0, Math.ceil((M.turnSince + (C.PAUSE || 5000) - ms.nowMs()) / 1000));
        text = left > 0 ? "Next deal in " + left + "s." : "The next deal is starting.";
      } else text = "Tap Next deal when you're ready.";
    } else if (t.phase === "scoring") {
      text = t.turn === you ? "Tap Score hands to count both hands and the crib." : "Waiting for " + nameOf(t.turn) + " to count the hands.";
    } else if (t.phase === "discard") {
      if (t.turn !== you) text = "Waiting for " + nameOf(t.turn) + " to choose 2 for the crib.";
      else if (sel.size < 2) text = "Tap 2 cards for the dealer's crib.";
      else text = "Ready — send your 2 cards.";
    } else if (t.phase === "pegging") {
      if (t.turn !== you) {
        text = "Waiting for " + nameOf(t.turn) + ".";
        if (M.kind === "online") { const left = idleLeft(); if (left !== null) text += " " + left + "s left."; }
      } else if (t.options.go) text = "Nothing fits under 31. Tap Go.";
      else text = "Tap a highlighted card. Count " + t.pegging.count + ".";
    }
    hintEl.textContent = text;
  }

  function setStatus() {
    const t = M.table;
    if (t.phase === "game_over" && t.winner !== null) {
      const key = "over:" + t.winner + ":" + t.you;
      if (key !== statusKey) {
        statusKey = key;
        const you = youSeat();
        const taunt = you !== null && t.winner === you ? Gamekit.taunt("win") : Gamekit.taunt("loss");
        statusEl.textContent = (((you !== null && t.winner === you) ? "You win! " : seatName(t.winner) + " wins. ") + (taunt || "")).trim();
      }
    } else {
      statusKey = "";
      statusEl.textContent = "";
    }
  }

  function renderAll() {
    if (!M || !M.table || M.phase === "landing" || M.phase === "lobby" || M.phase === "closed") {
      root.classList.remove("on");
      statusEl.textContent = "";
      statusKey = "";
      return;
    }
    root.classList.add("on");
    renderScores(); renderPlay(); renderHand(); renderActions(); renderHint(); setStatus();
  }

  // ---------- playing ----------
  function onCard(card) {
    const t = M && M.table;
    if (!t) return;
    if (t.phase === "discard") {
      if (t.turn !== youSeat()) { hintEl.textContent = "It's not your turn to choose."; return; }
      if (!(t.options.discard || []).includes(card)) { hintEl.textContent = "Choose a card from your hand."; return; }
      if (sel.has(card)) sel.delete(card);
      else {
        if (sel.size >= 2) sel.delete(sel.values().next().value);
        sel.add(card);
      }
      renderHand(); renderActions(); renderHint();
      return;
    }
    if (t.phase !== "pegging") return;
    if (t.turn !== youSeat()) { hintEl.textContent = "It's not your turn."; return; }
    if (!(t.options.play || []).includes(card)) { hintEl.textContent = whyNot(card); return; }
    send({ t: "play", card });
  }

  function sendDiscard() {
    if (sel.size !== 2) return;
    send({ t: "discard", cards: Array.from(sel) });
  }

  function send(action) {
    sel.clear();
    if (!M) return;
    if (M.kind === "local") return localAct(action);
    ms.send(action);
  }

  /* ============================================================
     vs computer: the same engine, running in the page
     ============================================================ */
  function localModel() {
    const st = Lc.st;
    const table = C.view(st, 0);
    table.you = 0;
    return { kind: "local", phase: st.phase, table, players: null, you: { seat: 0, host: true }, lastEvents: Lc.events, config: Lc.cfg };
  }
  function localStart() {
    clearTimeout(Lc && Lc.timer);
    const names = ["You", "Bot"];
    const bots = [null, diff];
    Lc = { st: C.create({ names, bots }, Math.random), cfg: { level: diff }, events: [], timer: null };
    sel.clear(); statusKey = "";
    localRender(); localSchedule();
  }
  function localRender() {
    M = localModel();
    renderAll();
  }
  function localAct(action) {
    const res = C.act(Lc.st, 0, action, Math.random);
    if (!res.ok) { hintEl.textContent = "That can't be done right now."; return; }
    Lc.events = res.events;
    localRender(); localSchedule();
  }
  function localNextDeal() {
    if (!Lc || Lc.st.phase !== "round_over") return;
    clearTimeout(Lc.timer);
    C.nextRound(Lc.st, Math.random);
    Lc.events = [];
    sel.clear();
    localRender(); localSchedule();
  }
  function localSchedule() {
    clearTimeout(Lc && Lc.timer);
    const st = Lc && Lc.st;
    if (!st || !["discard", "pegging", "scoring"].includes(st.phase) || st.turn === 0) return;
    Lc.timer = setTimeout(() => {
      if (!Lc || Lc.st !== st || !["discard", "pegging", "scoring"].includes(st.phase) || st.turn === 0) return;
      const seat = st.turn;
      let a = C.botAct(st, seat, st.seats[seat].bot || diff, Math.random);
      let res = a ? C.act(st, seat, a, Math.random) : { ok: false };
      if (!res.ok) res = C.act(st, seat, C.fallback(st, seat), Math.random);
      if (res.ok) Lc.events = res.events;
      sel.clear();
      localRender(); localSchedule();
    }, 800 + Math.random() * 500);
  }

  /* ============================================================
     Online rooms: the shared screens (multiseat.js), our own table
     ============================================================ */
  const ms = MultiSeat.create({
    game: "cribbage", title: "Cribbage", roomEl, tauntsEl, store,
    tableSize: 2, fixedSeats: true, fillSeats: false,
    onModel: (m) => {
      if (m.phase === "playing" && M && (M.phase === "game_over" || M.phase === "round_over")) {
        sel.clear(); statusKey = "";
      }
      M = m;
      renderAll();
    },
    onTick: () => { if (M && M.table && M.kind === "online" && M.phase === "playing") { renderHint(); renderActions(); } },
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
      Lc = null; M = null; sel.clear(); statusKey = "";
      root.classList.remove("on");
      statusEl.textContent = "";
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
  document.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input,select,textarea")) return;
    if (e.key === "Escape" && sel.size && !document.querySelector(".man-backdrop")) { sel.clear(); if (M && M.table) renderAll(); }
  });

  if (typeof LiveShare !== "undefined") LiveShare.enable(modeSel, "cribbage", invited);
  applyMode();
  Gamekit.popFilled(scoresEl);

  // A refresh keeps a game against the computer.
  function validSaved(st) {
    if (!st || st.v !== 1 || st.game !== "cribbage") return false;
    if (!Array.isArray(st.seats) || st.seats.length !== 2) return false;
    if (!["discard", "pegging", "scoring", "round_over"].includes(st.phase)) return false;
    if (!st.seats.every((s) => Array.isArray(s.hand) && Number.isInteger(s.score) && s.score >= 0)) return false;
    if (!Array.isArray(st.crib) || !Array.isArray(st.deck) || !Array.isArray(st.discarded)) return false;
    if (!st.pegging || !Array.isArray(st.pegging.line) || !Array.isArray(st.pegging.go) || !Array.isArray(st.pegging.points)) return false;
    if (st.winner !== null) return false;
    if (st.turn !== 0 && st.turn !== 1) return false;
    if (st.dealer !== 0 && st.dealer !== 1) return false;
    if (st.leader !== 0 && st.leader !== 1) return false;
    if (!Number.isInteger(st.round) || !Number.isInteger(st.moves)) return false;
    if (st.phase === "discard") {
      if (st.starter !== null || st.deck.length !== 40 || st.crib.length % 2 !== 0) return false;
    } else {
      if (!C.isCard(st.starter) || st.deck.length !== 39 || st.crib.length !== 4) return false;
    }
    if ((st.phase === "scoring" || st.phase === "round_over") && !st.reveal) return false;
    const played = st.pegging.log && Array.isArray(st.pegging.log) ? st.pegging.log.map((p) => p && p.card) : [];
    const cards = st.seats.flatMap((s) => s.hand).concat(st.crib, st.deck, st.starter ? [st.starter] : [], played);
    if (cards.length !== 52 || new Set(cards).size !== 52 || !cards.every(C.isCard)) return false;
    return true;
  }
  const resumer = Gamekit.resume("cribbage", () => (mode !== "computer" || !Lc || Lc.st.phase === "game_over" || Lc.st.moves === 0) ? null : { st: Lc.st, cfg: Lc.cfg }, (s) => {
    const st = s && s.st;
    if (!validSaved(st)) return false;
    mode = "computer"; modeSel.value = "computer"; chipsEl.hidden = false; resetBtn.hidden = false;
    const lv = s.cfg && s.cfg.level;
    if (["easy", "medium", "hard"].includes(lv)) { diff = lv; chips.show(lv); }
    if (ms.active()) ms.stop();
    clearTimeout(Lc && Lc.timer);
    Lc = { st, cfg: s.cfg || { level: diff }, events: [], timer: null };
    sel.clear(); statusKey = "";
    localRender(); localSchedule();
    return true;
  });
  if (!invited && mode === "computer") resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("cribbage"));
})();
