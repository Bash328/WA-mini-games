(function () {
  "use strict";

  const S = globalThis.Skull;
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), modeSel = $("mode"), botsSel = $("bots"), chipsEl = $("chips"), resetBtn = $("reset-btn");
  const roomEl = $("ms-room"), boardEl = $("sk"), seatsEl = $("sk-seats"), bannerEl = $("sk-banner");
  const logEl = $("sk-log"), handLabelEl = $("sk-handlabel"), handEl = $("sk-hand");
  const controlsEl = $("sk-controls"), hintEl = $("sk-hint"), tauntsEl = $("ms-taunts");
  const store = Gamekit.storage("skull:");

  let diff = store.get("diff", "medium");
  if (!["easy", "medium", "hard"].includes(diff)) diff = "medium";
  let mode = store.get("mode", "computer");
  const params = new URLSearchParams(location.search);
  const invited = params.has("live");
  if (invited) mode = "live";
  if (mode !== "computer" && mode !== "live") mode = "computer";
  modeSel.value = mode;
  const savedBots = Number(store.get("bots", "2"));
  botsSel.value = savedBots >= 2 && savedBots <= 5 ? String(savedBots) : "2";

  // M = { kind: "local" | "online", phase, table: engine view | null, ... }
  let M = null;
  let Lc = null;                                  // the game against the computer: { st, cfg, events, timer }
  let bidQ = 1, bidKey = "", statusKey = "";

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  function button(text, cls, fn) {
    const b = el("button", "btn " + (cls || ""), text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  // A disc, drawn rather than typed: roses and skulls are inline SVG so no
  // phone turns a character into an emoji.
  const ROSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="6.2" r="3.2"/><circle cx="17.4" cy="9.8" r="3.2"/><circle cx="15.3" cy="16.3" r="3.2"/><circle cx="8.7" cy="16.3" r="3.2"/><circle cx="6.6" cy="9.8" r="3.2"/></g></svg>';
  const SKULL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M12 2a8 8 0 0 0-8 8c0 2.7 1.3 5 3.3 6.4V20a2 2 0 0 0 2 2h5.4a2 2 0 0 0 2-2v-3.6A7.9 7.9 0 0 0 20 10a8 8 0 0 0-8-8ZM8.8 12.4a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6Zm6.4 0a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6ZM9.6 14.2h4.8L12 17Z"/></svg>';
  function discNode(kind, opts) {
    const o = opts || {};
    const face = kind === "rose" || kind === "skull";
    const d = document.createElement(o.button ? "button" : "div");
    d.className = "sk-disc" + (face ? " up " + kind : " down") + (o.small ? " sm" : "") + (o.large ? " lg" : "") + (o.button ? " pick" : "");
    if (o.button) d.type = "button";
    if (face) {
      d.insertAdjacentHTML("afterbegin", kind === "rose" ? ROSE : SKULL);
      if (!o.button) d.setAttribute("role", "img");
      d.setAttribute("aria-label", (kind === "rose" ? "Rose" : "Skull") + (o.button ? ": tap to place" : ""));
    } else d.setAttribute("aria-hidden", "true");
    return d;
  }

  const youSeat = () => (M && M.table && M.table.you !== null && M.table.you !== undefined ? M.table.you : null);
  const seatName = (i) => (M && M.table && M.table.seats[i] ? M.table.seats[i].name : "Player " + (i + 1));
  const subj = (i) => (i === youSeat() ? "You" : seatName(i));
  const vb = (i, one, many) => (i === youSeat() ? one : many);   // "You win" / "Bot 1 wins"
  function idleLeft() {
    if (!M || M.kind !== "online" || !M.turnSince || !M.table) return null;
    const p = M.players && M.players.find((x) => x.seat === M.table.turn);
    if (!p || p.autoBot || !p.online) return null;
    return Math.max(0, Math.ceil((M.turnSince + M.idleMs - ms.nowMs()) / 1000));
  }

  /* ---------- the table ---------- */
  function eventText(e) {
    const you = youSeat();
    const n = (i) => (i === you ? "You" : seatName(i));
    const v = (i, one, many) => (i === you ? one : many);
    const kind = e.kind === "skull" ? "skull" : "rose";
    switch (e.e) {
      case "place": return n(e.seat) + " " + v(e.seat, "place", "places") + " a disc";
      case "bid": return n(e.seat) + " " + v(e.seat, "bid", "bids") + " " + e.q;
      case "pass": return n(e.seat) + " " + v(e.seat, "pass", "passes");
      case "challenge": return n(e.seat) + " " + v(e.seat, "must turn", "must turn") + " " + e.q;
      case "flip": return (e.seat === you ? "Your disc" : seatName(e.seat) + "'s disc") + " is a " + kind;
      case "lose": return n(e.seat) + " " + v(e.seat, "lose", "loses") + " a disc";
      case "out": return n(e.seat) + " " + v(e.seat, "are", "is") + " out";
      case "challenge-won": return n(e.seat) + " " + v(e.seat, "win", "wins") + " the challenge";
      case "win": return n(e.seat) + " " + v(e.seat, "win", "wins") + " the game";
      case "new-round": return "Round " + e.round + " begins";
      default: return "";
    }
  }

  function renderSeats() {
    const t = M.table, you = youSeat();
    seatsEl.innerHTML = "";
    t.seats.forEach((s, i) => {
      const card = el("div", "sk-seat" + (i === you ? " you" : "") + (t.phase !== "round_over" && t.phase !== "game_over" && t.turn === i ? " act" : "") + (s.status === "out" ? " gone" : "") + (t.phase === "game_over" && t.winner === i ? " win" : ""));
      const top = el("div", "sk-seat-top");
      top.append(el("span", "sk-nm", i === you ? "You" : s.name), el("span", "sk-pts", s.score + (s.score === 1 ? " pt" : " pts")));
      card.append(top);
      let meta = s.count + (s.count === 1 ? " disc" : " discs");
      if (s.status === "out") meta = "out of discs";
      else if (s.handCount) meta += i === you ? " · " + s.handCount + " in hand" : " · " + s.handCount + " hidden";
      card.append(el("div", "sk-meta", meta));
      const stack = el("div", "sk-stack");
      if (!s.stack.length) stack.append(el("span", "sk-none", s.status === "out" ? "out" : "none placed"));
      s.stack.forEach((d) => {
        const known = i === you || d.up ? d.kind : null;
        stack.append(discNode(known, { small: true }));
      });
      card.append(stack);
      let tag = " ";
      if (s.status === "out") tag = "out";
      else if (t.phase === "game_over" && t.winner === i) tag = "winner";
      else if (t.turn === i && t.phase !== "round_over" && t.phase !== "game_over") tag = "to act";
      else if (s.passed) tag = "passed";
      else if (s.first) tag = "first";
      card.append(el("div", "sk-tag", tag));
      card.setAttribute("role", "group");
      card.setAttribute("aria-label", (i === you ? "You" : s.name) + ": " + s.score + " points, " + s.count + " discs");
      seatsEl.append(card);
    });
  }

  function renderBanner() {
    const t = M.table, you = youSeat();
    bannerEl.className = "sk-banner";
    let text = "";
    if (t.phase === "game_over") {
      text = t.winner === you ? "You win!" : seatName(t.winner) + " wins";
      if (t.winner === you) bannerEl.classList.add("you");
    } else if (t.phase === "round_over") {
      const r = t.reveal;
      if (r && r.success) text = subj(r.seat) + " " + vb(r.seat, "win", "wins") + " the challenge · 1 point";
      else if (r) {
        text = "Skull! " + subj(r.seat) + " " + vb(r.seat, "lose", "loses") + " a disc";
        if (t.seats[r.seat] && t.seats[r.seat].status === "out") text += " and " + vb(r.seat, "are", "is") + " out";
      }
      if (r && r.seat === you) bannerEl.classList.add("you");
    } else if (t.phase === "reveal" && t.reveal) {
      const left = Math.max(0, t.reveal.q - t.reveal.flips.length);
      text = subj(t.reveal.seat) + " " + vb(t.reveal.seat, "turn", "turns") + " " + t.reveal.flips.length + " of " + t.reveal.q + " · " + left + " to go";
      if (t.reveal.seat === you) bannerEl.classList.add("you");
    } else if (t.phase === "bid" && t.bid) {
      text = subj(t.bid.seat) + " " + vb(t.bid.seat, "bid", "bids") + " " + t.bid.q + " · " + (t.turn === you ? "your call" : subj(t.turn) + " to act");
      if (t.turn === you) bannerEl.classList.add("you");
    } else if (t.phase === "place") {
      if (!t.anteDone) text = t.turn === you ? "Place your first disc" : subj(t.turn) + " places a disc";
      else text = t.turn === you ? (t.options.place ? "Your turn: place another disc or bid" : "Your turn: bid") : subj(t.turn) + " to act · " + t.totalPlaced + " discs on the table";
      if (t.turn === you) bannerEl.classList.add("you");
    }
    if (t.phase === "place" && t.anteDone && t.turn === you) bannerEl.classList.add("you");
    bannerEl.textContent = text;
  }

  function renderLog() {
    logEl.textContent = (M.lastEvents || []).map(eventText).filter(Boolean).slice(-2).join(" · ");
  }

  function renderHand() {
    const t = M.table, you = youSeat();
    handEl.innerHTML = "";
    if (you === null) {
      handLabelEl.textContent = "Your hand";
      handEl.append(el("span", "sk-note", "Watching the table."));
      return;
    }
    const s = t.seats[you];
    handLabelEl.textContent = "Your hand";
    if (s.status === "out") { handEl.append(el("span", "sk-note", "You are out of discs. Watching the rest.")); return; }
    if (!s.hand || !s.hand.length) {
      const mustBid = t.phase === "place" && t.turn === you && t.anteDone;
      handEl.append(el("span", "sk-note", mustBid ? "No discs in hand: you must bid." : "No discs in hand."));
      return;
    }
    const canPlace = !!t.options.place;
    s.hand.forEach((kind, i) => {
      const d = discNode(kind, { large: true, button: canPlace });
      if (canPlace) d.addEventListener("click", () => send({ t: "place", i }));
      handEl.append(d);
    });
  }

  function renderControls() {
    const t = M.table, you = youSeat();
    controlsEl.innerHTML = "";
    const mine = you !== null && t.turn === you;
    if (t.phase === "game_over") {
      if (M.kind === "local") {
        controlsEl.append(button("Play again", "primary", localStart));
        hintEl.textContent = "Game over.";
      } else hintEl.textContent = "";
      return;
    }
    if (t.phase === "round_over") {
      if (M.kind === "local") {
        controlsEl.append(button("Next round", "primary", localNextRound));
        hintEl.textContent = "Next round starts shortly, or tap now.";
      } else hintEl.textContent = "The next round starts by itself.";
      return;
    }
    if (t.phase === "reveal") {
      if (t.reveal && t.reveal.seat === you && t.options.canFlip) {
        const left = Math.max(0, t.reveal.q - t.reveal.flips.length);
        controlsEl.append(button("Flip a disc (" + left + " left)", "primary", () => send({ t: "flip" })));
        hintEl.textContent = "Turn one disc at a time. A skull ends it.";
      } else if (t.reveal) hintEl.textContent = "Waiting for " + subj(t.reveal.seat) + " to turn " + (t.reveal.q - t.reveal.flips.length) + " more.";
      return;
    }
    if (you === null) { hintEl.textContent = "You are watching this table."; return; }
    const me = t.seats[you];
    if (me.status === "out") { hintEl.textContent = "You are out. Watching the rest."; return; }
    if (!mine) {
      const left = idleLeft();
      hintEl.textContent = "Waiting for " + subj(t.turn) + (left !== null ? " (" + left + "s)" : "") + ".";
      return;
    }
    if (t.phase === "place" && !t.anteDone) {
      hintEl.textContent = "Tap a disc to place it. Everyone places one.";
      return;
    }
    const key = t.round + ":" + t.phase + ":" + t.turn + ":" + (t.bid ? t.bid.q + "@" + t.bid.seat : "open") + ":" + me.handCount + ":" + me.placed;
    if (key !== bidKey) { bidKey = key; bidQ = t.options.minBid; }
    const min = t.options.minBid, max = t.options.maxBid;
    if (bidQ < min) bidQ = min;
    if (bidQ > max) bidQ = max;
    const qty = el("div", "sk-qty");
    const minus = button("−", "sk-step", () => { if (bidQ > min) { bidQ--; renderControls(); } });
    const plus = button("+", "sk-step", () => { if (bidQ < max) { bidQ++; renderControls(); } });
    minus.disabled = bidQ <= min;
    plus.disabled = bidQ >= max;
    qty.append(minus, el("span", "n", String(bidQ)), plus);
    const row = el("div", "sk-actions");
    const go = button("Bid " + bidQ, "primary", () => send({ t: "bid", q: bidQ }));
    go.disabled = !t.options.bid || bidQ < min || bidQ > max;
    row.append(go);
    if (t.options.canPass) row.append(button("Pass", "ghost", () => send({ t: "pass" })));
    controlsEl.append(qty, row);
    if (t.phase === "place") hintEl.textContent = me.hand && me.hand.length ? "Tap a disc to place it, or bid." : "No discs in hand: you must bid.";
    else hintEl.textContent = "Raise the bid or pass.";
  }

  function setStatus() {
    const t = M && M.table;
    if (!t) { statusEl.textContent = ""; return; }
    if (t.phase === "game_over" && t.winner !== null) {
      const key = "over:" + t.winner + ":" + t.you + ":" + t.round;
      if (key !== statusKey) {
        statusKey = key;
        statusEl.textContent = t.winner === t.you ? "You win! " + Gamekit.taunt("win") : seatName(t.winner) + " wins. " + Gamekit.taunt("loss");
      }
    } else { statusKey = ""; statusEl.textContent = ""; }
  }

  function renderTable() {
    if (!M || !M.table || M.phase === "lobby" || M.phase === "landing" || M.phase === "closed") { boardEl.classList.remove("on"); return; }
    boardEl.classList.add("on");
    renderSeats(); renderBanner(); renderLog(); renderHand(); renderControls(); setStatus();
  }

  function send(action) {
    if (!M) return;
    if (M.kind === "local") return localAct(action);
    ms.send(action);
  }

  /* ============================================================
     vs computer: the same engine, running in the page
     ============================================================ */
  function localModel() {
    const st = Lc.st;
    const table = S.view(st, st.seats[0].status === "in" ? 0 : null);
    table.you = 0;
    return { kind: "local", phase: st.phase, table, players: null, you: { seat: 0, host: true }, lastEvents: Lc.events, config: Lc.cfg };
  }
  function localStart() {
    clearTimeout(Lc && Lc.timer);
    const n = Math.max(2, Math.min(5, Number(botsSel.value) || 2));
    const names = ["You"].concat(Array.from({ length: n }, (_, i) => "Bot " + (i + 1)));
    const bots = [null].concat(Array(n).fill(diff));
    Lc = { st: S.create({ names, bots, starter: 0 }, Math.random), cfg: { bots: n, level: diff }, events: [], timer: null };
    bidKey = ""; statusKey = "";
    localRender(); localSchedule();
  }
  function localRender() {
    M = localModel();
    renderAll();
  }
  function localAct(action) {
    const res = S.act(Lc.st, 0, action, Math.random);
    if (!res.ok) { hintEl.textContent = "That can't be done right now."; return; }
    Lc.events = res.events; localRender(); localSchedule();
  }
  function localNextRound() {
    if (!Lc || Lc.st.phase !== "round_over") return;
    clearTimeout(Lc.timer);
    S.nextRound(Lc.st, Math.random);
    Lc.events = [{ e: "new-round", round: Lc.st.round }];
    localRender(); localSchedule();
  }
  function localSchedule() {
    clearTimeout(Lc && Lc.timer);
    const st = Lc.st;
    if (st.phase === "round_over") { Lc.timer = setTimeout(localNextRound, S.PAUSE); return; }
    if (st.phase === "game_over" || st.turn === 0) return;
    Lc.timer = setTimeout(() => {
      const seat = st.turn;
      let res = S.act(st, seat, S.botAct(st, seat, st.seats[seat].bot || diff, Math.random), Math.random);
      if (!res.ok) res = S.act(st, seat, S.fallback(st, seat), Math.random);
      if (res.ok) Lc.events = res.events;
      localRender(); localSchedule();
    }, 800 + Math.random() * 500);
  }
  function renderLocalGameOver() {
    // The game-over card (gamekit.js) and the fixed Play again button in the
    // controls cover this: no extra panel above the table, so nothing moves.
    if (!M || M.kind !== "local") return;
    roomEl.innerHTML = "";
    roomEl.hidden = true;
  }

  /* ============================================================
     Online rooms: the shared screens (multiseat.js), our own table
     ============================================================ */
  const ms = MultiSeat.create({
    game: "skull", title: "Skull", roomEl, tauntsEl, store,
    tableSize: 6, fixedSeats: false,
    onModel: (m) => { M = m; renderAll(true); },
    onTick: () => { if (M && M.kind === "online" && M.table && (M.phase === "round_over" || M.phase === "playing")) renderBanner(); },
  });

  function renderAll(fromOnline) {
    if (!fromOnline) renderLocalGameOver();
    renderTable();
    if (M && M.kind === "online") {
      if (M.phase === "lobby") statusEl.textContent = "Waiting for players";
      else if (!(M.table && M.table.phase === "game_over")) statusEl.textContent = "";
    }
  }

  /* ---------- modes and controls ---------- */
  function applyMode() {
    const local = mode === "computer";
    chipsEl.hidden = !local; botsSel.hidden = !local; resetBtn.hidden = !local;
    if (local) {
      if (ms.active()) ms.stop();
      localStart();
    } else {
      clearTimeout(Lc && Lc.timer);
      Lc = null; M = null; bidKey = ""; statusKey = "";
      boardEl.classList.remove("on");
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
  resetBtn.addEventListener("click", () => {
    if (mode === "computer") return localStart();
    // The game-over card's "Play again" clicks this hidden button. Online, the
    // useful equivalent is the room's own Rematch button.
    if (mode === "live" && M && M.kind === "online" && M.phase === "game_over") {
      const again = Array.from(roomEl.querySelectorAll("button")).find((b) => /rematch/i.test(b.textContent));
      if (again && !again.disabled) again.click();
    }
  });

  if (typeof LiveShare !== "undefined") LiveShare.enable(modeSel, "skull", invited);
  applyMode();

  // A refresh keeps a game against the computer.
  function validState(st) {
    if (!st || st.v !== 1 || st.game !== "skull" || !Array.isArray(st.seats)) return false;
    if (st.seats.length < S.MIN_SEATS || st.seats.length > S.MAX_SEATS) return false;
    if (!["place", "bid", "reveal", "round_over"].includes(st.phase)) return false;
    if (!Number.isInteger(st.round) || st.round < 1 || !Number.isInteger(st.moves)) return false;
    if (!Number.isInteger(st.turn) || st.turn < 0 || st.turn >= st.seats.length) return false;
    if (!Number.isInteger(st.first) || st.first < 0 || st.first >= st.seats.length) return false;
    if (!Array.isArray(st.passed) || st.passed.length !== st.seats.length || !st.passed.every((p) => typeof p === "boolean")) return false;
    if (st.winner !== null && (!Number.isInteger(st.winner) || st.winner < 0 || st.winner >= st.seats.length)) return false;
    if (st.bid !== null && (!st.bid || !Number.isInteger(st.bid.seat) || st.bid.seat < 0 || st.bid.seat >= st.seats.length || !Number.isInteger(st.bid.q) || st.bid.q < 1)) return false;
    for (const s of st.seats) {
      if (!s || typeof s.name !== "string" || !Array.isArray(s.hand) || !Array.isArray(s.stack)) return false;
      if (!s.hand.every((k) => k === "rose" || k === "skull")) return false;
      if (!s.stack.every((d) => d && (d.kind === "rose" || d.kind === "skull") && typeof d.up === "boolean")) return false;
      if (s.hand.length + s.stack.length > S.DISCS) return false;
      if (!Number.isInteger(s.score) || s.score < 0 || s.score > S.TARGET) return false;
      if (!["in", "out"].includes(s.status)) return false;
      if (s.status === "out" && s.hand.length + s.stack.length !== 0) return false;
    }
    if (st.phase === "reveal" && (!st.reveal || !Number.isInteger(st.reveal.seat) || !Number.isInteger(st.reveal.q))) return false;
    return true;
  }
  const resumer = Gamekit.resume("skull", () => (mode !== "computer" || !Lc || Lc.st.phase === "game_over" || Lc.st.moves === 0) ? null : { st: Lc.st, cfg: Lc.cfg }, (s) => {
    const st = s && s.st;
    if (!validState(st)) return false;
    mode = "computer"; modeSel.value = "computer";
    chipsEl.hidden = false; botsSel.hidden = false; resetBtn.hidden = false;
    if (ms.active()) ms.stop();
    clearTimeout(Lc && Lc.timer);
    const lv = s.cfg && s.cfg.level;
    if (["easy", "medium", "hard"].includes(lv)) { diff = lv; chips.show(lv); }
    Lc = { st, cfg: s.cfg || { bots: st.seats.length - 1, level: diff }, events: [], timer: null };
    botsSel.value = String(Math.min(5, Math.max(2, st.seats.length - 1)));
    bidKey = ""; statusKey = "";
    localRender(); localSchedule();
    return true;
  });
  if (!invited && mode === "computer") resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("skull"));
})();
