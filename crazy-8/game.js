(function () {
  "use strict";

  const C = globalThis.Crazy8;
  const SYM = { S: "♠", H: "♥", D: "♦", C: "♣" };
  const SUIT_NAME = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
  const RANK_NAME = { A: "Ace", J: "Jack", Q: "Queen", K: "King", X: "Joker" };
  const ORDER_R = { A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, X: 14 };
  const ORDER_S = { S: 0, H: 1, D: 2, C: 3 };

  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), modeSel = $("mode"), botsSel = $("bots"), gmodeSel = $("gmode"), chipsEl = $("chips");
  const roomEl = $("c8-room"), tableEl = $("c8"), oppsEl = $("c8-opps"), drawEl = $("c8-draw"), topEl = $("c8-top"), drawnEl = $("c8-drawn");
  const infoEl = $("c8-info"), bannerEl = $("c8-banner"), logEl = $("c8-log"), hintEl = $("c8-hint"), handEl = $("c8-hand");
  const playBtn = $("play-btn"), drawBtn = $("draw-btn"), passBtn = $("pass-btn"), lastBtn = $("last-btn"), resetBtn = $("reset-btn");
  const suitPick = $("c8-suitpick"), suitsEl = $("c8-suits"), toastEl = $("c8-toast"), tauntsEl = $("c8-taunts");
  const store = Gamekit.storage("crazy-8:");

  let diff = store.get("diff", "medium");
  if (!["easy", "medium", "hard"].includes(diff)) diff = "medium";
  let mode = store.get("mode", "computer");
  const params = new URLSearchParams(location.search);
  const invited = params.has("live");
  if (invited) mode = "live";
  if (mode !== "computer" && mode !== "live") mode = "computer";
  modeSel.value = mode;
  botsSel.value = store.get("bots", "2") || "2";
  gmodeSel.value = store.get("gmode", "normal") === "tournament" ? "tournament" : "normal";

  // ---------- one model for the screen, whether the game is local or online ----------
  // M = { kind, phase: "landing"|"lobby"|"playing"|"round_over"|"game_over"|"closed", table: engine view | null,
  //       players, you: { seat, host, pid }, code, config, closed: text }
  let M = null;
  let selected = null, lastArmed = false, pendingPlay = null;

  /* ---------- cards on screen ---------- */
  function cardName(c) {
    if (C.isJoker(c)) return "Joker";
    const r = C.rankOf(c);
    return (RANK_NAME[r] || r) + " of " + SUIT_NAME[C.suitOf(c)];
  }
  const short = (c) => (C.isJoker(c) ? "Joker" : C.rankOf(c) + SYM[C.suitOf(c)]);
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function cardEl(c, o) {
    o = o || {};
    const e = document.createElement(o.button ? "button" : "div");
    if (o.button) e.type = "button";
    e.className = "c8-card" + (o.cls ? " " + o.cls : "");
    if (!c) { e.classList.add("back"); e.setAttribute("aria-hidden", "true"); return e; }
    if (C.isJoker(c)) { e.classList.add("joker"); e.append(el("span", "r", "JOKER"), el("span", "m", "★"), el("span", "s", "★")); }
    else {
      const s = C.suitOf(c);
      if (s === "H" || s === "D") e.classList.add("red");
      e.append(el("span", "r", C.rankOf(c)), el("span", "m", SYM[s]), el("span", "s", SYM[s]));
    }
    e.setAttribute("aria-label", cardName(c));
    return e;
  }
  const sortHand = (hand) => hand.slice().sort((a, b) => {
    const ja = C.isJoker(a), jb = C.isJoker(b);
    if (ja || jb) return ja === jb ? a.localeCompare(b) : ja ? 1 : -1;
    return ORDER_S[C.suitOf(a)] - ORDER_S[C.suitOf(b)] || ORDER_R[C.rankOf(a)] - ORDER_R[C.rankOf(b)];
  });

  /* ---------- what each card does (the hint when you tap one) ---------- */
  const SPECIAL = {
    "2": "Pick up 2: the next player must pick up 2. They can chain another 2 or a joker, or block with an Ace.",
    X: "Joker: the next player must pick up 5. It chains with 2s and jokers, and an Ace blocks it. A joker can be played on any card, and after it the next player can play anything.",
    A: "Ace: blocks a pick-up. Play it on a pending pick-up to cancel the whole pile. After an Ace the next player can play any card.",
    J: "Jack: jump. The next player misses their turn (with only two players left, you play again).",
    "7": "7: reverses the direction of play (with only two players left, you play again).",
    "8": "8: you name any suit for the next player to follow. An 8 goes on a card of its own suit, or on another 8, and it can't dodge a pick-up.",
  };
  function consText(cons) {
    if (!cons || cons.any) return "any card";
    const bits = [SYM[cons.suit] + " " + SUIT_NAME[cons.suit]];
    if (cons.rank === "8") return bits[0] + " (or an 8)";
    if (cons.rank) bits.push("a " + cons.rank);
    return bits.join(" or ");
  }
  // Why a card can't be played right now (or "" when it can)
  function whyNot(card) {
    const t = M && M.table;
    if (!t || (M.phase !== "playing")) return "The game isn't running.";
    if (t.turn !== t.you) return "It's not your turn yet. You can still read what cards do.";
    if (t.options.plays.includes(card)) return "";
    if (t.drawn) return "You picked up a card this turn. You can only play that card (" + short(t.drawn) + "), or keep it and pass.";
    if (t.pending > 0) return "A pick-up of " + t.pending + " is waiting. Only a 2, a joker or an Ace can answer it. Otherwise pick up.";
    if (C.rankOf(card) === "8") return "An 8 only goes on " + SYM[t.cons.suit] + " " + SUIT_NAME[t.cons.suit] + " or on another 8 right now.";
    return "It doesn't match. Play " + consText(t.cons) + ".";
  }
  function showHint(card, tried) {
    const r = C.isJoker(card) ? "X" : C.rankOf(card);
    const why = tried && whyNot(card);
    if (!SPECIAL[r] && !why) return idleHint();
    hintEl.classList.remove("idle");
    hintEl.innerHTML = "";
    if (SPECIAL[r]) hintEl.append(el("b", "", cardName(card)), el("span", "", SPECIAL[r]));
    if (why) hintEl.append(el("span", "why", why));
  }
  function idleHint() {
    hintEl.classList.add("idle");
    hintEl.textContent = "Tap a card to lift it. Special cards tell you what they do. Tap it again to play it.";
  }

  /* ---------- the table ---------- */
  function seatName(i) { return M.table.seats[i].name; }
  function eventText(e) {
    const n = (i) => (M.table.you === i ? "You" : seatName(i));
    const verb = (i, a, b) => (M.table.you === i ? a : b);
    switch (e.e) {
      case "play": return n(e.seat) + " " + verb(e.seat, "play", "plays") + " " + short(e.card) + (e.suit ? " and " + verb(e.seat, "call", "calls") + " " + SYM[e.suit] : "");
      case "draw": return n(e.seat) + " " + verb(e.seat, "pick up", "picks up") + " a card";
      case "pickup": return n(e.seat) + " " + verb(e.seat, "pick up", "picks up") + " " + e.n + " card" + (e.n === 1 ? "" : "s");
      case "pass": return n(e.seat) + " " + verb(e.seat, "keep", "keeps") + " the card";
      case "blocked": return n(e.seat) + " " + verb(e.seat, "block", "blocks") + " the pick-up of " + e.total + " with an Ace";
      case "skip": return seatName(e.seat) + " is skipped";
      case "reverse": return "Direction reversed";
      case "last-missed": return n(e.seat) + " " + verb(e.seat, "forgot", "forgot") + " to call last card and " + verb(e.seat, "pick up", "picks up") + " 2";
      case "out-of-cards": return n(e.seat) + " " + verb(e.seat, "are", "is") + " out of cards";
      case "eliminated": return n(e.seat) + " " + verb(e.seat, "are", "is") + " out of the tournament";
      case "reshuffle": return "The pile was shuffled back in";
      case "new-round": return "Round " + e.round + " begins";
      default: return "";
    }
  }

  function renderOpps() {
    const t = M.table;
    oppsEl.innerHTML = "";
    t.seats.forEach((s, i) => {
      if (i === t.you) return;
      const box = el("div", "c8-opp" + (t.turn === i && M.phase === "playing" ? " turn" : "") + (s.status === "out" ? " gone" : ""));
      box.append(el("div", "nm", s.name));
      let st = s.bot ? "computer" : "";
      const p = M.players && M.players.find((x) => x.seat === i);
      if (p && !s.bot) {
        if (p.autoBot && !p.online) st = "offline: a computer is playing";
        else if (!p.online) {
          const left = Math.max(0, Math.ceil((p.offlineSince + M.takeoverMs - nowMs()) / 1000));
          st = "offline: computer in " + left + "s";
        } else st = "";
      }
      if (s.status === "out") st = "out of the tournament";
      else if (s.status === "safe") st = "safe this round";
      const stEl = el("div", "st" + (p && !p.online ? " warn" : ""), st || " ");
      box.append(stEl);
      const fan = el("div", "fan");
      for (let k = 0; k < Math.min(8, s.count); k++) fan.append(cardEl(null, { cls: "sm" }));
      fan.append(el("span", "n", String(s.count)));
      box.append(fan);
      oppsEl.append(box);
    });
  }

  function renderMid() {
    const t = M.table;
    drawEl.innerHTML = ""; topEl.innerHTML = "";
    const back = cardEl(null, { cls: "lg" });
    if (t.options.draw && M.phase === "playing") { back.style.cursor = "pointer"; back.addEventListener("click", doDraw); back.title = "Pick up"; }
    drawEl.append(back);
    drawnEl.textContent = t.drawCount + " left";
    if (t.top) topEl.append(cardEl(t.top, { cls: "lg" }));
    infoEl.innerHTML = "";
    const must = el("span", "c8-chip");
    if (t.cons.any) must.textContent = "Play any card";
    else {
      must.append("Match ");
      const sp = el("span", t.cons.suit === "H" || t.cons.suit === "D" ? "red" : "", SYM[t.cons.suit]);
      must.append(sp, t.cons.rank === "8" ? " or an 8" : " or " + t.cons.rank);
    }
    infoEl.append(must);
    if (t.pending > 0) infoEl.append(el("span", "c8-chip hot", "Pick up " + t.pending));
    infoEl.append(el("span", "c8-chip", t.dir === 1 ? "↻ clockwise" : "↺ reversed"));
  }

  function renderBanner() {
    const t = M.table;
    bannerEl.className = "c8-banner";
    let text = "";
    const mine = t.turn === t.you && M.phase === "playing";
    if (M.phase === "game_over") {
      text = t.winner === t.you ? "You won!" : seatName(t.winner) + " wins";
      if (t.winner === t.you) bannerEl.classList.add("you");
    } else if (M.phase === "round_over") {
      text = (t.eliminated === t.you ? "You're out." : seatName(t.eliminated) + " is out.") + " The next round starts in a moment.";
    } else if (t.you === null || t.seats[t.you].status === "out") {
      text = "You're out. Watching: " + seatName(t.turn) + "'s turn";
    } else if (t.seats[t.you].status === "safe") {
      text = "You're safe this round. Watching the rest.";
    } else if (mine && t.drawn) {
      text = "You picked up " + short(t.drawn) + ". Play it, or keep it and pass.";
      bannerEl.classList.add("you");
    } else if (mine && t.pending > 0) {
      text = "Pick up " + t.pending + ", chain a 2 or joker, or block with an Ace";
      bannerEl.classList.add("alert");
    } else if (mine) {
      text = "Your turn";
      bannerEl.classList.add("you");
    } else {
      text = "Waiting for " + seatName(t.turn);
      const left = idleLeft();
      if (left !== null) text += " (" + left + "s)";
    }
    bannerEl.textContent = text;
  }
  // seconds left on the current person's turn, online only
  function idleLeft() {
    if (!M || M.kind !== "online" || !M.turnSince) return null;
    const p = M.players.find((x) => x.seat === M.table.turn);
    if (!p || p.autoBot || !p.online) return null;
    return Math.max(0, Math.ceil((M.turnSince + M.idleMs - nowMs()) / 1000));
  }

  function renderHand() {
    const t = M.table;
    handEl.innerHTML = "";
    const youOut = t.you === null || t.seats[t.you].status === "out";
    if (youOut) { handEl.append(el("span", "note", "")); return; }
    const hand = sortHand(t.seats[t.you].hand || []);
    if (selected && !hand.includes(selected)) selected = null;
    hand.forEach((c) => {
      const b = cardEl(c, { button: true, cls: c === selected ? "sel" : "" });
      b.addEventListener("click", () => onCard(c));
      handEl.append(b);
    });
  }

  function renderActions() {
    const t = M.table;
    const mine = t.turn === t.you && M.phase === "playing";
    const o = t.options;
    drawBtn.disabled = !(mine && o.draw);
    drawBtn.textContent = t.pending > 0 ? "Pick up " + t.pending + " cards" : "Pick up a card";
    passBtn.hidden = !(mine && o.pass);
    playBtn.disabled = !(mine && selected);
    const two = t.you !== null && t.seats[t.you].hand && t.seats[t.you].hand.length === 2;
    lastBtn.hidden = !(two && mine);
    lastBtn.classList.toggle("on", lastArmed);
    lastBtn.textContent = lastArmed ? "Last card! (called)" : "Last card!";
    if (!two || !mine) lastArmed = false;
  }

  function renderLog() {
    const ev = (M.lastEvents || []).map(eventText).filter(Boolean).slice(-3);
    logEl.textContent = ev.join(" · ");
  }

  function renderTable() {
    if (!M || !M.table || M.phase === "lobby") { tableEl.classList.remove("on"); return; }
    tableEl.classList.add("on");
    renderOpps(); renderMid(); renderBanner(); renderHand(); renderActions(); renderLog();
    renderTaunts();
    if (selected) showHint(selected); else idleHint();
  }

  /* ---------- playing ---------- */
  function onCard(c) {
    if (selected === c) return playSelected();
    selected = c;
    renderHand(); renderActions(); showHint(c);
  }
  function playSelected() {
    const t = M && M.table;
    if (!t || !selected) return;
    if (whyNot(selected)) { showHint(selected, true); return; }
    if (C.rankOf(selected) === "8") return askSuit(selected);
    send({ t: "play", card: selected, last: lastArmed });
  }
  function askSuit(card) {
    pendingPlay = card;
    suitsEl.innerHTML = "";
    ["S", "H", "D", "C"].forEach((s) => {
      const b = el("button", s === "H" || s === "D" ? "red" : "", SYM[s]);
      b.type = "button"; b.setAttribute("aria-label", SUIT_NAME[s]);
      b.addEventListener("click", () => { suitPick.classList.remove("on"); const c = pendingPlay; pendingPlay = null; send({ t: "play", card: c, suit: s, last: lastArmed }); });
      suitsEl.append(b);
    });
    suitPick.classList.add("on");
  }
  suitPick.addEventListener("click", (e) => { if (e.target === suitPick) { suitPick.classList.remove("on"); pendingPlay = null; } });
  function doDraw() { if (M && M.table && M.table.options.draw) send({ t: "draw" }); }
  playBtn.addEventListener("click", playSelected);
  drawBtn.addEventListener("click", doDraw);
  passBtn.addEventListener("click", () => send({ t: "pass" }));
  lastBtn.addEventListener("click", () => { lastArmed = !lastArmed; renderActions(); if (selected) showHint(selected); });

  // an action goes to the local game or to the room
  function send(action) {
    selected = null; lastArmed = false; hintEl.classList.add("idle");
    if (!M) return;
    if (M.kind === "local") return localAct(action);
    onlineSend({ t: "act", a: action });
  }

  let toastTimer = null;
  function toast(text) {
    toastEl.textContent = text; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4200);
  }

  /* ============================================================
     vs computer: the same engine, running in the page
     ============================================================ */
  let L = null;
  function localPhase(st) { return st.phase === "play" ? "playing" : st.phase; }
  function localModel() {
    const st = L.st;
    const youOut = st.seats[0].status === "out";
    const table = C.view(st, youOut ? null : 0);
    table.you = 0;
    return { kind: "local", phase: localPhase(st), table, players: null, you: { seat: 0, host: true }, lastEvents: L.events, config: L.cfg };
  }
  function localStart() {
    clearTimeout(L && L.timer);
    const n = Number(botsSel.value);
    const cfg = { bots: n, level: diff, mode: gmodeSel.value };
    const names = ["You"].concat(Array.from({ length: n }, (_, i) => "Computer " + (i + 1)));
    const bots = [null].concat(Array(n).fill(diff));
    L = { st: C.create({ names, bots, mode: cfg.mode, starter: 0 }, Math.random), cfg, events: [], timer: null };
    selected = null; lastArmed = false;
    localRender(); localSchedule();
  }
  function localRender() {
    M = localModel();
    renderAll();
    const st = L.st;
    if (st.phase === "game_over") {
      const mine = st.winner === 0;
      setStatus(mine ? "You win! " + Gamekit.taunt("win") : seatNameOf(st, st.winner) + " wins. " + Gamekit.taunt("loss"));
    } else setStatus("");
  }
  const seatNameOf = (st, i) => st.seats[i].name;
  function localAct(action) {
    const res = C.act(L.st, 0, action, Math.random);
    if (!res.ok) { toast("That can't be done right now."); return; }
    L.events = res.events; localRender(); localSchedule();
  }
  function localSchedule() {
    clearTimeout(L.timer);
    const st = L.st;
    if (st.phase === "round_over") {
      L.timer = setTimeout(() => { C.nextRound(st, Math.random); L.events = [{ e: "new-round", round: st.round }]; localRender(); localSchedule(); }, 3500);
      return;
    }
    if (st.phase !== "play" || st.turn === 0) return;
    L.timer = setTimeout(() => {
      const seat = st.turn;
      const a = C.botAct(st, seat, st.seats[seat].bot, Math.random);
      let res = C.act(st, seat, a, Math.random);
      if (!res.ok) res = C.act(st, seat, { t: "draw" }, Math.random);
      if (res.ok) L.events = res.events;
      localRender(); localSchedule();
    }, 900 + Math.random() * 600);
  }

  /* ============================================================
     Online rooms
     ============================================================ */
  const REJECT = {
    "not-host": "Only the host can do that.", "need-2": "You need at least 2 players. Add a computer player or wait for a friend.",
    full: "There are no free seats for that.", illegal: "That can't be played right now.", "not-your-turn": "It's not your turn.",
    "rate-limit": "Slow down a little.", "in-game": "You can't change that during a game.", "bad-config": "That setting isn't allowed.",
    "not-playing": "The game isn't running.", "not-seated": "You aren't seated in this game.",
  };
  const CLOSED = {
    started: "This game has already started, so nobody new can join. Ask the host to start a new room.",
    full: "This room is full.", expired: "That room doesn't exist any more. Start a new one.",
    disabled: "Online play is switched off right now.", "taken-over": "You opened this room somewhere else, so this tab was disconnected.",
    unreachable: "Couldn't reach the game server. Check your connection and try again.",
  };
  let ws = null, wantOpen = false, code = null, myPid = null, retries = 0, retryTimer = null, pingTimer = null, offset = 0;
  let sawWelcome = false;
  const nowMs = () => Date.now() - offset;
  const myName = () => { try { const m = typeof Account !== "undefined" && Account.me(); return m ? m.name : ""; } catch (e) { return ""; } };

  function socketPath() { return code ? "/api/card/ws?room=" + code : "/api/card/new"; }
  function connect() {
    clearTimeout(retryTimer);
    let sock;
    try { sock = new WebSocket((location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + socketPath()); }
    catch (e) { return closed("unreachable"); }
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      const token = code ? store.get("seat:" + code, null) : null;
      sock.send(JSON.stringify({ t: "hello", token: token || undefined, name: myName() }));
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { if (ws && ws.readyState === 1) ws.send("ping"); }, 25000);
    };
    sock.onmessage = (e) => { if (ws === sock && e.data !== "pong") onMessage(e.data); };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null; clearInterval(pingTimer);
      if (!wantOpen) return;
      if (!sawWelcome && retries >= 3) return closed("unreachable");
      retries++;
      retryTimer = setTimeout(() => { if (wantOpen && !ws) connect(); }, Math.min(10000, 800 * Math.pow(2, retries)));
      if (M && M.kind === "online") toast("Connection lost. Reconnecting…");
    };
    sock.onerror = () => { /* onclose follows */ };
  }
  function onMessage(data) {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m.t === "welcome") {
      sawWelcome = true; retries = 0; myPid = m.pid;
      if (m.code && m.code !== code) { code = m.code; try { history.replaceState(null, "", "?live=" + code); } catch (e) { /* ignore */ } }
      store.set("seat:" + code, m.token);
    } else if (m.t === "room") {
      const v = m.v;
      offset = Date.now() - v.now;
      const prevPhase = M && M.phase, prevTurn = M && M.table ? M.table.turn : null;
      M = {
        kind: "online", phase: v.phase, table: v.table, players: v.players, you: v.you, code: v.code, config: v.config,
        lastEvents: v.lastEvents, turnSince: v.turnSince, idleMs: v.idleMs, takeoverMs: v.takeoverMs, now: v.now, seatsWanted: v.seatsWanted,
        host: v.host,
      };
      if (M.table) M.table.you = v.you.seat;
      if (prevPhase !== M.phase || (M.table && prevTurn !== M.table.turn)) { lastArmed = false; }
      renderAll();
    } else if (m.t === "notice") toast(m.text);
    else if (m.t === "taunt") onTaunt(m);
    else if (m.t === "reject") toast(REJECT[m.reason] || "That didn't work.");
    else if (m.t === "closed") closed(m.reason);
    else if (m.t === "left") { leaveLocalState(); }
  }
  function onlineSend(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); else toast("Not connected. Reconnecting…"); }
  function closed(reason) {
    wantOpen = false; clearTimeout(retryTimer); clearInterval(pingTimer);
    if (ws) { const s = ws; ws = null; try { s.close(); } catch (e) { /* ignore */ } }
    M = { kind: "online", phase: "closed", table: null, closed: CLOSED[reason] || "This room is no longer available." };
    renderAll();
  }
  function leaveLocalState() {
    wantOpen = false; clearTimeout(retryTimer); clearInterval(pingTimer);
    if (ws) { const s = ws; ws = null; try { s.close(); } catch (e) { /* ignore */ } }
    code = null; M = null; sawWelcome = false;
    try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ }
    showLanding();
  }
  function enterRoom(c) {
    code = c || null; wantOpen = true; sawWelcome = false; retries = 0;
    M = { kind: "online", phase: "lobby", table: null, players: [], you: {}, config: { mode: "normal", bots: 0, level: "medium" }, connecting: true };
    renderAll();
    connect();
  }
  function showLanding() {
    M = { kind: "online", phase: "landing", table: null };
    renderAll();
  }

  /* ---------- online taunts ---------- */
  const lines = () => (window.TAUNT_LINES && window.TAUNT_LINES.online) || { angel: [], devil: [] };
  const sugg = { a: -1, d: -1 };
  let tauntCool = false;
  const muted = () => store.get("taunt-mute", "0") === "1";
  function suggest(k) { const l = k === "a" ? lines().angel : lines().devil; if (!l.length) return; let i; do { i = Math.floor(Math.random() * l.length); } while (l.length > 1 && i === sugg[k]); sugg[k] = i; }
  function renderTaunts() {
    tauntsEl.innerHTML = "";
    const online = M && M.kind === "online" && M.phase !== "lobby" && M.table;
    tauntsEl.hidden = !online || !lines().angel.length;
    if (tauntsEl.hidden) return;
    [["a", "angel"], ["d", "devil"]].forEach(([k, name]) => {
      if (sugg[k] < 0) suggest(k);
      const text = lines()[name][sugg[k]];
      const b = el("button", "btn ghost", text);
      b.type = "button"; b.disabled = tauntCool; b.style.borderColor = k === "a" ? "var(--teal)" : "var(--coral)";
      b.addEventListener("click", () => {
        if (tauntCool) return;
        onlineSend({ t: "taunt", k, i: sugg[k] });
        toast("You: " + text); suggest(k); tauntCool = true;
        setTimeout(() => { tauntCool = false; renderTaunts(); }, 3000);
        renderTaunts();
      });
      tauntsEl.append(b);
    });
  }
  function onTaunt(m) {
    if (muted()) return;
    const l = m.k === "a" ? lines().angel : lines().devil;
    const p = M && M.players && M.players.find((x) => x.pid === m.from);
    if (l && l[m.i]) toast((p ? p.name : "Someone") + ": " + l[m.i]);
  }

  /* ---------- the room screens ---------- */
  function btn(text, cls, fn) { const b = el("button", "btn " + (cls || ""), text); b.type = "button"; b.addEventListener("click", fn); return b; }
  function seg(label, options, current, onPick, enabled) {
    const box = el("div", "");
    box.append(el("div", "lbl", label));
    const row = el("div", "c8-seg");
    options.forEach(([v, text]) => {
      const b = el("button", "btn ghost" + (String(v) === String(current) ? " active" : ""), text);
      b.type = "button"; b.disabled = !enabled || (typeof v === "number" && !enabled(v));
      b.addEventListener("click", () => onPick(v));
      row.append(b);
    });
    box.append(row);
    return box;
  }
  function copyText(text, done) {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); else done(false);
  }
  const inviteLink = () => location.origin + "/crazy-8/?live=" + (M && M.code);

  function renderRoom() {
    roomEl.innerHTML = "";
    if (!M || M.kind === "local") { roomEl.hidden = true; return; }
    roomEl.hidden = false;
    if (M.phase === "landing") {
      roomEl.append(el("h3", "", "Play Crazy 8 online"));
      roomEl.append(el("p", "note", "Up to 4 players. Create a room and send the invite link, or join a friend's room with its code. The host can add computer players to fill seats."));
      const row = el("div", "c8-join");
      row.append(btn("Create a room", "primary", () => enterRoom(null)));
      const input = el("input"); input.type = "text"; input.maxLength = 8; input.placeholder = "Room code"; input.autocomplete = "off"; input.spellcheck = false; input.setAttribute("aria-label", "Room code");
      const join = () => { const c = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); if (/^[A-HJ-NP-Z2-9]{6}$/.test(c)) enterRoom(c); else toast("Room codes are 6 letters and numbers."); };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
      row.append(input, btn("Join", "ghost", join));
      roomEl.append(row);
      return;
    }
    if (M.phase === "closed") {
      roomEl.append(el("h3", "", "Room closed"));
      roomEl.append(el("p", "note", M.closed));
      roomEl.append(btn("Back", "primary", leaveLocalState));
      return;
    }
    if (M.connecting && !M.code) { roomEl.append(el("p", "note", "Opening the room…")); return; }
    const isHost = M.you && M.you.host;
    if (M.phase === "lobby") {
      roomEl.append(el("h3", "", "Your room"));
      const codeBox = el("div", "c8-code");
      codeBox.append(el("span", "big", M.code.slice(0, 3) + " " + M.code.slice(3)));
      const cc = btn("Copy code", "ghost", () => copyText(M.code, (ok) => { cc.textContent = ok ? "Copied!" : "Select it and copy"; setTimeout(() => { cc.textContent = "Copy code"; }, 1500); }));
      const cl = btn("Copy link", "ghost", () => copyText(inviteLink(), (ok) => { cl.textContent = ok ? "Copied!" : "Copy failed"; setTimeout(() => { cl.textContent = "Copy link"; }, 1500); }));
      codeBox.append(cc, cl);
      if (navigator.share) codeBox.append(btn("Send invite", "primary", () => navigator.share({ text: inviteLink() + "\nJoin my Crazy 8 game!" }).catch(() => {})));
      roomEl.append(codeBox);
      // seats
      const seats = el("div", "c8-seats");
      M.players.forEach((p) => {
        const row = el("div", "c8-seat");
        row.append(el("span", "", p.name + (p.pid === M.you.pid ? " (you)" : "")));
        row.append(el("span", "tag", (p.host ? "host" : "") + (p.online ? "" : " · offline")));
        seats.append(row);
      });
      for (let i = 0; i < M.config.bots; i++) { const r = el("div", "c8-seat"); r.append(el("span", "", "Computer " + (i + 1)), el("span", "tag", M.config.level)); seats.append(r); }
      for (let i = M.players.length + M.config.bots; i < 4; i++) seats.append(el("div", "c8-seat empty", "Waiting for someone to join…"));
      roomEl.append(seats);
      // settings
      const cfg = el("div", "c8-cfg");
      cfg.append(seg("Game type", [["normal", "Normal: first out wins"], ["tournament", "Tournament"]], M.config.mode, (v) => onlineSend({ t: "config", mode: v }), isHost ? () => true : null));
      cfg.append(seg("Computer players", [[0, "None"], [1, "1"], [2, "2"], [3, "3"]], M.config.bots, (v) => onlineSend({ t: "config", bots: v }), isHost ? (v) => M.players.length + v <= 4 : null));
      cfg.append(seg("Computer level", [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], M.config.level, (v) => onlineSend({ t: "config", level: v }), isHost ? () => true : null));
      roomEl.append(cfg);
      if (isHost) {
        const go = btn("Start the game", "primary", () => onlineSend({ t: "start" }));
        go.disabled = M.seatsWanted < 2;
        roomEl.append(go);
        roomEl.append(el("p", "note", M.seatsWanted < 2 ? "You need at least 2 players: invite a friend or add a computer." : "It starts by itself when all 4 seats are full."));
      } else roomEl.append(el("p", "note", "Waiting for " + ((M.players.find((p) => p.host) || {}).name || "the host") + " to start. Only the host can change the settings."));
      // poke a friend
      if (typeof Account !== "undefined") {
        Account.status().then((st) => {
          if (!st.push || !roomEl.isConnected || !M || M.phase !== "lobby") return;
          const wrap = el("div", "c8-join");
          if (!Account.me()) { const a = el("a", "", "Pick a username on the home page to poke friends into a game."); a.href = "/#account"; a.style.fontSize = "13px"; wrap.append(a); }
          else {
            const input = el("input"); input.type = "text"; input.maxLength = 16; input.placeholder = "friend's username"; input.style.width = "12em"; input.style.textTransform = "none"; input.style.letterSpacing = "0"; input.setAttribute("aria-label", "Friend's username");
            const go = btn("Poke", "ghost", async () => { if (!input.value.trim()) return; go.disabled = true; const r = await Account.poke(input.value, "crazy-8", M.code); toast(r.text); go.disabled = false; });
            wrap.append(input, go);
          }
          roomEl.append(wrap);
        });
      }
      roomEl.append(btn("Leave room", "ghost", () => { onlineSend({ t: "leave" }); setTimeout(leaveLocalState, 300); }));
      return;
    }
    if (M.phase === "game_over") {
      const t = M.table;
      roomEl.append(el("h3", "", t.winner === t.you ? "You won!" : seatName(t.winner) + " won"));
      const seats = el("div", "c8-seats");
      M.players.forEach((p) => {
        const row = el("div", "c8-seat");
        row.append(el("span", "", p.name + (p.pid === M.you.pid ? " (you)" : "")));
        row.append(el("span", "win", p.wins + (p.wins === 1 ? " win" : " wins")));
        row.append(el("span", "tag", p.voted ? "ready for a rematch" : (p.online ? "" : "offline")));
        seats.append(row);
      });
      roomEl.append(seats);
      if (isHost) {
        const cfg = el("div", "c8-cfg");
        cfg.append(seg("Game type", [["normal", "Normal"], ["tournament", "Tournament"]], M.config.mode, (v) => onlineSend({ t: "config", mode: v }), () => true));
        cfg.append(seg("Computer players", [[0, "None, just the people here"], [1, "1"], [2, "2"], [3, "3"]], M.config.bots, (v) => onlineSend({ t: "config", bots: v }), (v) => M.players.length + v <= 4));
        roomEl.append(cfg);
      } else roomEl.append(el("p", "note", "The host chooses the game type and the computer players for the rematch."));
      const mine = M.players.find((p) => p.pid === M.you.pid);
      const rm = btn(mine && mine.voted ? "Waiting for the others…" : "Rematch", "primary", () => onlineSend({ t: "vote" }));
      rm.disabled = !!(mine && mine.voted);
      roomEl.append(rm, btn("Leave room", "ghost", () => { onlineSend({ t: "leave" }); setTimeout(leaveLocalState, 300); }));
      return;
    }
    roomEl.hidden = true;                  // in a game: the table is the screen
  }

  function renderLocalGameOver() {
    if (!M || M.kind !== "local" || M.phase !== "game_over") return;
    roomEl.hidden = false;
    roomEl.innerHTML = "";
    const t = M.table;
    roomEl.append(el("h3", "", t.winner === 0 ? "You won!" : seatName(t.winner) + " won"));
    roomEl.append(btn("Play again", "primary", localStart));
  }

  function setStatus(text) { statusEl.textContent = text; }

  /* ---------- put it all on screen ---------- */
  function renderAll() {
    renderRoom();
    renderLocalGameOver();
    renderTable();
    if (M && M.kind === "online") {
      if (M.phase === "playing" || M.phase === "round_over") setStatus("");
      else if (M.phase === "lobby") setStatus("Waiting for players");
      else if (M.phase === "game_over") setStatus(M.table.winner === M.table.you ? "You win! " + Gamekit.taunt("win") : seatName(M.table.winner) + " wins. " + Gamekit.taunt("loss"));
      else setStatus("");
    }
  }
  // tick the little countdowns (offline / idle turn) once a second while online
  setInterval(() => { if (M && M.kind === "online" && M.table && (M.phase === "playing") && tableEl.classList.contains("on")) { renderOpps(); renderBanner(); } }, 1000);

  /* ---------- modes and controls ---------- */
  function applyMode() {
    const local = mode === "computer";
    chipsEl.hidden = !local; botsSel.hidden = !local; gmodeSel.hidden = !local;
    resetBtn.hidden = !local;
    if (local) {
      if (wantOpen || ws) { wantOpen = false; if (ws) { try { ws.close(); } catch (e) { /* ignore */ } ws = null; } }
      localStart();
    } else {
      if (L) clearTimeout(L.timer);
      L = null; selected = null;
      const c = (params.get("live") || "").toUpperCase();
      if (invited && /^[A-HJ-NP-Z2-9]{6}$/.test(c) && !wantOpen) enterRoom(c);
      else if (!wantOpen) showLanding();
      else renderAll();
    }
  }
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; if (mode === "computer") localStart(); },
  });
  diff = chips.get();
  modeSel.addEventListener("change", () => { mode = modeSel.value; if (mode !== "live") store.set("mode", mode); applyMode(); });
  botsSel.addEventListener("change", () => { store.set("bots", botsSel.value); if (mode === "computer") localStart(); });
  gmodeSel.addEventListener("change", () => { store.set("gmode", gmodeSel.value); if (mode === "computer") localStart(); });
  resetBtn.addEventListener("click", () => { if (mode === "computer") localStart(); });
  document.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input,select,textarea") || document.querySelector(".man-backdrop")) return;
    if (e.key === "Escape") { suitPick.classList.remove("on"); selected = null; if (M && M.table) { renderHand(); renderActions(); idleHint(); } }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && wantOpen && !ws) { retries = 0; connect(); } });
  window.addEventListener("online", () => { if (wantOpen && !ws) { retries = 0; connect(); } });

  if (typeof LiveShare !== "undefined") LiveShare.enable(modeSel, "crazy-8", invited);
  applyMode();

  // A refresh keeps a game against the computer.
  const resumer = Gamekit.resume("crazy-8", () => (mode !== "computer" || !L || L.st.phase === "game_over" || L.st.moves === 0) ? null : { st: L.st, cfg: L.cfg }, (s) => {
    const st = s.st;
    if (!st || st.v !== 1 || !Array.isArray(st.seats) || st.seats.length < 2 || st.seats.length > 4 || !Array.isArray(st.draw) || !Array.isArray(st.discard)) return false;
    const all = st.seats.flatMap((x) => x.hand).concat(st.draw, st.discard);
    if (all.length !== 54 || new Set(all).size !== 54 || !all.every(C.isCard)) return false;
    mode = "computer"; modeSel.value = "computer"; applyMode();
    clearTimeout(L.timer);
    L = { st, cfg: s.cfg || { bots: st.seats.length - 1, level: diff, mode: st.mode }, events: [], timer: null };
    botsSel.value = String(st.seats.length - 1); gmodeSel.value = st.mode;
    localRender(); localSchedule();
    return true;
  });
  if (!invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("crazy-8"));
})();
