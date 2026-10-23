(function () {
  "use strict";

  const LC = globalThis.LostCities;
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), modeSel = $("mode"), chipsEl = $("chips"), resetBtn = $("reset-btn");
  const roomEl = $("ms-room"), boardEl = $("lc"), scoresEl = $("lc-scores"), headEl = $("lc-head"), rowsEl = $("lc-rows");
  const handEl = $("lc-hand"), actionsEl = $("lc-actions"), hintEl = $("lc-hint"), logEl = $("lc-log"), tauntsEl = $("ms-taunts");
  const store = Gamekit.storage("lost-cities:");

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
  let Lc = null;                              // the game against the computer: { st, cfg, events, timer }
  let selected = null;                        // the card lifted from the hand
  let statusKey = "", lastStatus = "";

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const COLOUR_HEX = { Y: "#e9b52a", B: "#4d86d8", W: "#e6dfc9", G: "#46a163", R: "#d05346" };
  const seatName = (i) => (M && M.table && M.table.seats[i] ? M.table.seats[i].name : "Player " + (i + 1));
  const youSeat = () => (M && M.table && M.table.you !== null && M.table.you !== undefined ? M.table.you : null);
  const nameOf = (i) => (i === youSeat() ? "You" : seatName(i));
  const cardName = (c) => (LC.isHandshake(c) ? "handshake" : LC.rankOf(c)) + " of " + LC.COLOUR_NAMES[LC.colourOf(c)];
  const shortCard = (c) => (LC.isHandshake(c) ? "a handshake" : LC.rankOf(c) + " " + LC.COLOUR_NAMES[LC.colourOf(c)]);
  const countText = (n) => n + (n === 1 ? " card" : " cards");

  const idleLeft = () => {
    if (!M || M.kind !== "online" || !M.table || !M.turnSince) return null;
    const p = M.players && M.players.find((x) => x.seat === M.table.turn);
    if (!p || p.autoBot || !p.online) return null;
    return Math.max(0, Math.ceil((M.turnSince + M.idleMs - ms.nowMs()) / 1000));
  };
  const isMyTurn = () => { const t = M && M.table; const you = youSeat(); return !!t && t.phase === "play" && you !== null && t.turn === you; };
  const canDrawDeck = () => isMyTurn() && M.table.stage === "draw" && M.table.deck > 0;
  const canDrawPile = (colour) => isMyTurn() && M.table.stage === "draw" && (M.table.options.draw || []).includes(colour);

  // ---------- a card ----------
  function cardNode(card, opts) {
    const o = opts || {};
    const mini = !!o.mini;
    const n = el(o.button ? "button" : "div", (mini ? "lc-mini" : "lc-card")
      + (LC.isHandshake(card) ? " h" : "")
      + (!LC.isHandshake(card) && LC.rankOf(card) === "10" ? " ten" : ""));
    if (o.button) n.type = "button";
    n.style.setProperty("--c", COLOUR_HEX[LC.colourOf(card)]);
    n.setAttribute("aria-label", cardName(card));
    const shown = mini && LC.isHandshake(card) ? "H" : (LC.isHandshake(card) ? "H" : LC.rankOf(card));
    n.append(el("i", "bar"), el("span", "rk", shown));
    if (!mini) {
      n.append(el("span", "sub", LC.isHandshake(card) ? "×2" : LC.colourOf(card)));
      if (o.selected) n.classList.add("sel");
      if (o.ok) n.classList.add("ok");
      if (o.no) n.classList.add("no");
      if (o.dim) n.classList.add("dim");
    }
    return n;
  }

  function whyNot(card) {
    const t = M && M.table, you = youSeat();
    if (!t || t.phase !== "play") return "The round isn't running.";
    if (you === null) return "You're watching this table.";
    if (t.turn !== you) return "It's not your turn yet.";
    if (t.stage === "draw") return "Draw a card first: tap the deck or a glowing discard pile.";
    const ci = LC.indexOf(LC.colourOf(card));
    const pile = t.seats[you].expeditions[ci];
    const colour = LC.COLOUR_NAMES[LC.colourOf(card)];
    if (LC.isHandshake(card)) {
      if (pile.some((c) => !LC.isHandshake(c))) return "A handshake has to go before the first number in " + colour + ".";
      return "";
    }
    if (!pile.length) return "";
    const top = pile[pile.length - 1];
    if (LC.isHandshake(top)) return "";
    if (LC.VALUE(card) <= LC.VALUE(top)) return "It has to be higher than the " + LC.rankOf(top) + " already in " + colour + ".";
    return "";
  }

  // ---------- the table ----------
  function renderScores() {
    const t = M.table, you = youSeat();
    scoresEl.innerHTML = "";
    const order = you === null ? [0, 1] : [1 - you, you];
    order.forEach((seat) => {
      const s = t.seats[seat];
      const win = t.phase === "game_over" && !t.draw && t.winner === seat;
      const box = el("div", "lc-score" + (seat === you ? " you" : "") + (t.phase === "play" && t.turn === seat ? " active" : "") + (win ? " win" : ""));
      box.append(el("span", "nm", seat === you ? "You" : s.name), el("b", "", String(s.score)));
      scoresEl.append(box);
    });
  }

  function renderHead() {
    const t = M.table, you = youSeat();
    const opp = you === null ? 0 : 1 - you;
    const mine = you === null ? 1 : you;
    headEl.innerHTML = "";
    const left = el("div", "lc-sidehead left" + (t.phase === "play" && t.turn === opp ? " on" : ""));
    left.append(el("b", "", seatName(opp)), el("span", "", countText(t.seats[opp].count)));
    const deck = el("button", "lc-deck" + (canDrawDeck() ? " can" : ""));
    deck.type = "button";
    deck.append(el("span", "lc-back"), el("span", "cnt", t.deck + " left"));
    deck.setAttribute("aria-label", "Deck: " + t.deck + " cards" + (canDrawDeck() ? ". Tap to draw." : "."));
    deck.addEventListener("click", () => {
      if (canDrawDeck()) return drawDeck();
      if (!isMyTurn()) { hintEl.textContent = "It's not your turn yet."; return; }
      if (M.table.stage === "action") { hintEl.textContent = "Play or discard a card first, then draw."; return; }
      hintEl.textContent = "The deck is empty.";
    });
    const right = el("div", "lc-sidehead right" + (t.phase === "play" && t.turn === mine ? " on" : ""));
    right.append(el("b", "", you === null ? seatName(mine) : "You"), el("span", "", countText(t.seats[mine].count)));
    headEl.append(el("span", "lc-headgap"), left, deck, right);
  }

  function pileEl(pile, label, side) {
    const box = el("div", "lc-pile" + (side ? " " + side : ""));
    const cards = el("div", "lc-cards");
    pile.forEach((c) => cards.append(cardNode(c, { mini: true })));
    box.append(cards);
    box.setAttribute("aria-label", label + ": " + (pile.length ? pile.map((c) => (LC.isHandshake(c) ? "handshake" : LC.rankOf(c))).join(", ") : "empty"));
    return box;
  }

  function discardEl(colour, ci) {
    const t = M.table, pile = t.discards[ci];
    const wrap = el("div", "lc-discard");
    if (!pile.length) { wrap.append(el("span", "lc-discard-empty")); return wrap; }
    const top = pile[pile.length - 1];
    const can = canDrawPile(colour);
    const b = el("button", "lc-discardbtn" + (can ? " can" : "") + (LC.isHandshake(top) ? " h" : "") + (!LC.isHandshake(top) && LC.rankOf(top) === "10" ? " ten" : ""));
    b.type = "button";
    b.style.setProperty("--c", COLOUR_HEX[colour]);
    b.append(el("i", "bar"), el("span", "rk", LC.isHandshake(top) ? "H" : LC.rankOf(top)), el("span", "ct", String(pile.length)));
    b.setAttribute("aria-label", LC.COLOUR_NAMES[colour] + " discard pile: " + pile.length + " card" + (pile.length === 1 ? "" : "s") + ", top " + cardName(top) + (can ? ". Tap to take it." : "."));
    b.addEventListener("click", () => drawPile(colour));
    wrap.append(b);
    return wrap;
  }

  function renderRows() {
    const t = M.table, you = youSeat();
    const opp = you === null ? 0 : 1 - you;
    const mine = you === null ? 1 : you;
    rowsEl.innerHTML = "";
    LC.COLOURS.forEach((colour, ci) => {
      const row = el("div", "lc-row");
      const badge = el("div", "lc-colour" + (colour === "Y" || colour === "W" ? " lite" : ""));
      badge.style.setProperty("--c", COLOUR_HEX[colour]);
      badge.append(el("b", "", colour));
      badge.setAttribute("aria-label", LC.COLOUR_NAMES[colour] + " expedition");
      row.append(badge);
      row.append(pileEl(t.seats[opp].expeditions[ci], seatName(opp) + "'s " + LC.COLOUR_NAMES[colour] + " expedition", "opp"));
      row.append(discardEl(colour, ci));
      row.append(pileEl(t.seats[mine].expeditions[ci], (you === null ? seatName(mine) : "Your") + " " + LC.COLOUR_NAMES[colour] + " expedition", "mine"));
      rowsEl.append(row);
    });
  }

  function renderHand() {
    const t = M.table, you = youSeat();
    handEl.innerHTML = "";
    if (you === null) { handEl.append(el("span", "lc-hint", "You're watching this table.")); return; }
    const hand = (t.seats[you].hand || []).slice();
    if (selected && !hand.includes(selected)) selected = null;
    if (selected && (t.turn !== you || t.stage !== "action")) selected = null;
    const mine = t.phase === "play" && t.turn === you;
    const action = mine && t.stage === "action";
    const legal = t.options.play || [];
    hand.forEach((c) => {
      const b = cardNode(c, { button: true, selected: c === selected });
      if (action) b.classList.add(legal.includes(c) ? "ok" : "no");
      if (mine && t.stage === "draw") b.classList.add("dim");
      b.addEventListener("click", () => onCard(c));
      handEl.append(b);
    });
  }

  function renderActions() {
    const t = M.table, you = youSeat();
    actionsEl.innerHTML = "";
    if (!t || t.phase !== "play" || you === null || t.turn !== you) return;
    if (t.stage === "draw") {
      const b = el("button", "btn primary", "Draw from deck");
      b.type = "button";
      b.disabled = t.deck <= 0;
      b.addEventListener("click", drawDeck);
      actionsEl.append(b);
      return;
    }
    const playable = !!selected && (t.options.play || []).includes(selected);
    const play = el("button", "btn primary", "Play");
    play.type = "button"; play.disabled = !playable;
    play.addEventListener("click", playSelected);
    const disc = el("button", "btn ghost", "Discard");
    disc.type = "button"; disc.disabled = !selected;
    disc.addEventListener("click", discardSelected);
    actionsEl.append(play, disc);
  }

  function renderHint() {
    const t = M.table, you = youSeat();
    let text = "";
    if (t.phase === "game_over") text = "";
    else if (you === null) text = "This table is full: you're watching.";
    else if (t.turn !== you) {
      text = t.stage === "draw" ? seatName(t.turn) + " is drawing a card." : seatName(t.turn) + " is playing.";
      if (M.kind === "online") { const left = idleLeft(); if (left !== null) text += " " + left + "s left."; }
    } else if (t.stage === "draw") text = "Tap the deck or a glowing discard pile to draw.";
    else if (!selected) text = (t.options.play || []).length ? "Tap a card, then Play or Discard." : "No card fits: tap one, then Discard.";
    else {
      const why = whyNot(selected);
      text = why || (LC.isHandshake(selected)
        ? "Handshake: it doubles this expedition's final score."
        : "It fits on your " + LC.COLOUR_NAMES[LC.colourOf(selected)] + " expedition.");
    }
    hintEl.textContent = text;
  }

  function eventText(e) {
    const t = M.table, you = t.you;
    const n = (i) => (i === you ? "You" : seatName(i));
    switch (e.e) {
      case "play": return n(e.seat) + " played " + shortCard(e.card) + " on " + LC.COLOUR_NAMES[e.colour];
      case "discard": return n(e.seat) + " discarded " + shortCard(e.card);
      case "draw": return e.from === "deck" ? n(e.seat) + " drew from the deck" : n(e.seat) + " took the " + LC.COLOUR_NAMES[e.from] + " discard";
      case "score": return "Scored " + e.scores[0] + " to " + e.scores[1];
      case "win": return e.draw ? "A draw" : n(e.seat) + " wins";
      default: return "";
    }
  }

  function renderLog() {
    const events = (M.lastEvents || []).map(eventText).filter(Boolean).slice(-2);
    logEl.textContent = events.join(" · ");
  }

  function setStatus() {
    const t = M.table;
    let text = "";
    if (t.phase === "game_over") {
      const you = youSeat();
      const key = "over:" + t.winner + ":" + t.draw + ":" + you;
      if (key === statusKey) {
        if (lastStatus === statusEl.textContent) return;
        text = lastStatus;
      } else {
        statusKey = key;
        if (t.draw) text = "Draw. " + Gamekit.taunt("draw");
        else if (you !== null && t.winner === you) text = "You win! " + Gamekit.taunt("win");
        else text = seatName(t.winner) + " wins. " + Gamekit.taunt("loss");
      }
    } else if (t.phase === "play") {
      statusKey = "";
      const you = youSeat();
      if (you === null) text = "Watching";
      else if (t.turn === you) text = t.stage === "draw" ? "Your turn: draw a card" : "Your turn: play or discard";
      else if (M.kind === "online") {
        const left = idleLeft();
        text = seatName(t.turn) + "'s turn" + (left !== null ? " · " + left + "s" : "");
      } else text = "Bot is thinking";
    }
    if (text !== lastStatus) { lastStatus = text; statusEl.textContent = text; }
  }

  function renderAll() {
    if (!M || !M.table || M.phase === "landing" || M.phase === "lobby" || M.phase === "closed") {
      boardEl.classList.remove("on");
      statusEl.textContent = "";
      lastStatus = ""; statusKey = "";
      return;
    }
    boardEl.classList.add("on");
    renderScores(); renderHead(); renderRows(); renderHand(); renderActions(); renderHint(); renderLog(); setStatus();
  }

  // ---------- playing ----------
  function onCard(card) {
    const t = M && M.table;
    if (!t) return;
    if (t.phase !== "play" || t.turn !== youSeat()) { hintEl.textContent = "It's not your turn yet."; return; }
    if (t.stage === "draw") { hintEl.textContent = "Draw a card first: tap the deck or a glowing discard pile."; return; }
    selected = selected === card ? null : card;
    renderHand(); renderActions(); renderHint();
  }
  function playSelected() {
    const t = M && M.table;
    if (!t || !selected) return;
    if (!(t.options.play || []).includes(selected)) { hintEl.textContent = whyNot(selected); return; }
    send({ t: "play", card: selected });
  }
  function discardSelected() {
    if (!M || !M.table || !selected) return;
    send({ t: "discard", card: selected });
  }
  function drawDeck() {
    if (!M || !M.table) return;
    if (!canDrawDeck()) { hintEl.textContent = isMyTurn() ? "Play or discard a card first, then draw." : "It's not your turn yet."; return; }
    send({ t: "draw", from: "deck" });
  }
  function drawPile(colour) {
    if (!M || !M.table) return;
    if (!canDrawPile(colour)) {
      hintEl.textContent = isMyTurn() ? "Play or discard a card first, then draw." : "It's not your turn yet.";
      return;
    }
    send({ t: "draw", from: colour });
  }
  function send(action) {
    selected = null;
    if (!M) return;
    if (M.kind === "local") return localAct(action);
    ms.send(action);
  }

  /* ============================================================
     vs computer: the same engine, running in the page
     ============================================================ */
  const localPhase = (st) => (st.phase === "play" ? "playing" : st.phase);
  function localModel() {
    const st = Lc.st;
    const table = LC.view(st, 0);
    table.you = 0;
    return { kind: "local", phase: localPhase(st), table, players: null, you: { seat: 0, host: true }, lastEvents: Lc.events, config: Lc.cfg };
  }
  function localStart() {
    clearTimeout(Lc && Lc.timer);
    const names = ["You", "Bot"];
    const bots = [null, diff];
    Lc = { st: LC.create({ names, bots }, Math.random), cfg: { level: diff }, events: [], timer: null };
    selected = null;
    localRender(); localSchedule();
  }
  function localRender() {
    M = localModel();
    renderAll();
  }
  function localAct(action) {
    const res = LC.act(Lc.st, 0, action, Math.random);
    if (!res.ok) { hintEl.textContent = "That can't be done right now."; return; }
    Lc.events = res.events;
    localRender(); localSchedule();
  }
  function localSchedule() {
    clearTimeout(Lc && Lc.timer);
    const st = Lc && Lc.st;
    if (!st || st.phase !== "play" || st.turn === 0) return;
    Lc.timer = setTimeout(() => {
      if (!Lc || Lc.st !== st || st.phase !== "play" || st.turn === 0) return;
      const seat = st.turn;
      let res = LC.act(st, seat, LC.botAct(st, seat, st.seats[seat].bot || diff, Math.random), Math.random);
      if (!res.ok) res = LC.act(st, seat, LC.fallback(st, seat), Math.random);
      if (res.ok) Lc.events = res.events;
      localRender(); localSchedule();
    }, 800 + Math.random() * 500);
  }

  /* ============================================================
     Online rooms: the shared screens (multiseat.js), our own table
     ============================================================ */
  const ms = MultiSeat.create({
    game: "lost-cities", title: "Lost Cities", roomEl, tauntsEl, store,
    tableSize: 2, fixedSeats: true, fillSeats: false,
    onModel: (m) => {
      if (m.phase === "playing" && M && M.phase !== "playing") selected = null;
      M = m;
      renderAll();
    },
    onTick: () => { if (M && M.table && M.kind === "online" && M.phase === "playing") { renderHint(); setStatus(); } },
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
      Lc = null; M = null; selected = null;
      boardEl.classList.remove("on");
      statusEl.textContent = ""; lastStatus = ""; statusKey = "";
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
    if (e.key === "Escape" && selected && !document.querySelector(".man-backdrop")) { selected = null; if (M && M.table) { renderHand(); renderActions(); renderHint(); } }
  });

  if (typeof LiveShare !== "undefined") LiveShare.enable(modeSel, "lost-cities", invited);
  applyMode();
  Gamekit.popFilled(scoresEl);

  // A refresh keeps a game against the computer.
  const resumer = Gamekit.resume("lost-cities", () => (mode !== "computer" || !Lc || Lc.st.phase === "game_over" || Lc.st.moves === 0) ? null : { st: Lc.st, cfg: Lc.cfg }, (s) => {
    const st = s && s.st;
    if (!st || st.v !== 1 || st.game !== "lost-cities") return false;
    if (!Array.isArray(st.seats) || st.seats.length !== 2 || st.phase !== "play" || st.winner !== null || st.final !== null) return false;
    if (!Array.isArray(st.deck) || !st.deck.length || !Array.isArray(st.discards) || st.discards.length !== 5) return false;
    if (st.turn !== 0 && st.turn !== 1) return false;
    if (st.stage !== "action" && st.stage !== "draw") return false;
    if (!st.seats.every((x) => Array.isArray(x.hand) && x.hand.length >= 7 && x.hand.length <= 8
      && Array.isArray(x.expeditions) && x.expeditions.length === 5 && x.expeditions.every(Array.isArray))) return false;
    if (st.stage === "draw" && st.seats[st.turn].hand.length !== 7) return false;
    if (st.stage === "action" && st.seats[st.turn].hand.length !== 8) return false;
    const validPile = (pile) => {
      let number = false, last = 0;
      for (const c of pile) {
        if (!LC.isCard(c)) return false;
        if (LC.isHandshake(c)) { if (number) return false; }
        else {
          const v = LC.VALUE(c);
          if (number && v <= last) return false;
          number = true; last = v;
        }
      }
      return true;
    };
    if (!st.seats.every((x) => x.expeditions.every(validPile))) return false;
    const all = st.seats.flatMap((x) => x.hand.concat(x.expeditions.flat())).concat(st.deck, st.discards.flat());
    if (all.length !== 60 || new Set(all).size !== 60 || !all.every(LC.isCard)) return false;
    mode = "computer"; modeSel.value = "computer"; chipsEl.hidden = false; resetBtn.hidden = false;
    const lv = s.cfg && s.cfg.level;
    if (["easy", "medium", "hard"].includes(lv)) { diff = lv; chips.show(lv); }
    if (ms.active()) ms.stop();
    Lc = { st, cfg: s.cfg || { level: diff }, events: [], timer: null };
    selected = null; lastStatus = ""; statusKey = "";
    localRender(); localSchedule();
    return true;
  });
  if (!invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("lost-cities"));
})();
