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
  const drawBtn = $("draw-btn"), passBtn = $("pass-btn"), resetBtn = $("reset-btn");
  const suitPick = $("c8-suitpick"), suitsEl = $("c8-suits"), toastEl = $("c8-toast"), tauntsEl = $("c8-taunts");
  const store = Gamekit.storage("crazy-8:");
  const stageEl = $("c8-stage"), youEl = $("c8-you"), overEl = $("c8-over"), feltEl = $("c8-felt"), glowEl = $("c8-glow"), drawnBox = $("c8-drawnbox"), dcardEl = $("c8-dcard"), keepBtn = $("keep-btn"), playDrawnBtn = $("playdrawn-btn");

  let diff = store.get("diff", "medium");
  if (!["easy", "medium", "hard"].includes(diff)) diff = "medium";
  let mode = store.get("mode", "computer");
  const params = new URLSearchParams(location.search);
  const invited = params.has("live");
  if (invited) mode = "live";
  if (mode !== "computer" && mode !== "live") mode = "computer";
  modeSel.value = mode;
  botsSel.value = store.get("bots", "2") || "2";
  const themeSel = $("ctheme");
  themeSel.value = ["classic", "halloween"].includes(store.get("theme", "auto")) ? store.get("theme") : "auto";
  themeSel.addEventListener("change", () => { store.set("theme", themeSel.value); document.documentElement.setAttribute("data-c8theme", window.c8Theme(themeSel.value)); });
  gmodeSel.value = store.get("gmode", "normal") === "tournament" ? "tournament" : "normal";

  // ---------- one model for the screen, whether the game is local or online ----------
  // M = { kind, phase: "landing"|"lobby"|"playing"|"round_over"|"game_over"|"closed", table: engine view | null,
  //       players, you: { seat, host, pid }, code, config, closed: text }
  let M = null;
  let selected = null, pendingPlay = null;

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
      case "out-of-cards": return n(e.seat) + " " + verb(e.seat, "are", "is") + " out of cards";
      case "eliminated": return n(e.seat) + " " + verb(e.seat, "are", "is") + " out of the tournament";
      case "reshuffle": return "The pile was shuffled back in";
      case "new-round": return "Round " + e.round + " begins";
      default: return "";
    }
  }

  // where the other players sit: one across, two either side, three left / across / right
  const POS = { 1: ["top"], 2: ["left", "right"], 3: ["left", "top", "right"] };
  function renderOpps() {
    const t = M.table, n = t.seats.length;
    oppsEl.innerHTML = "";
    const order = [];
    const from = t.you === null ? -1 : t.you;
    for (let k = 1; k <= n; k++) { const i = (from + k + n) % n; if (i !== t.you) order.push(i); }
    const pos = POS[Math.min(3, order.length)] || [];
    stageEl.classList.toggle("no-top", !pos.includes("top"));
    seatPosOf = {};
    order.slice(0, 3).forEach((i, k) => { seatPosOf[i] = pos[k]; });
    if (t.you !== null) seatPosOf[t.you] = "you";
    order.slice(0, 3).forEach((i, k) => {
      const s = t.seats[i];
      const box = el("div", "c8-opp pos-" + pos[k] + (t.turn === i && M.phase === "playing" ? " on-turn" : "") + (s.status === "out" ? " gone" : ""));
      box.style.setProperty("--pc", seatCol(i));
      const nm = el("div", "nm", s.name);
      nm.append(el("span", "ct", String(s.count)));
      box.append(nm);
      let st = "";
      const p = M.players && M.players.find((x) => x.seat === i);
      if (p && !s.bot) {
        if (p.autoBot && !p.online) st = "offline: a computer is playing";
        else if (!p.online) {
          const left = Math.max(0, Math.ceil((p.offlineSince + M.takeoverMs - nowMs()) / 1000));
          st = "offline: computer in " + left + "s";
        }
      }
      if (s.status === "out") st = "out of the tournament";
      else if (s.status === "safe") st = "safe this round";
      if (st) box.append(el("div", "st" + (p && !p.online ? " warn" : ""), st));
      const fan = el("div", "fan");
      for (let c = 0; c < Math.min(10, s.count); c++) fan.append(cardEl(null, { cls: "sm" }));
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
    (t.prev || []).forEach((c) => topEl.append(cardEl(c, { cls: "lg peek" })));
    if (t.top) topEl.append(cardEl(t.top, { cls: "lg top" }));
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
    stageEl.classList.toggle("rev", t.dir !== 1);
  }

  const SEAT_COL = ["#4aa3ff", "#ff6b6b", "#46c46f", "#f5b83d"];
  const seatCol = (i) => SEAT_COL[i % SEAT_COL.length];
  function renderBanner() {
    const t = M.table;
    bannerEl.className = "c8-banner";
    const col = M.phase === "playing" && t.turn !== null && t.turn !== undefined ? seatCol(t.turn) : "";
    if (col) bannerEl.style.setProperty("--pc", col); else bannerEl.style.removeProperty("--pc");
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
      text = "You picked up " + short(t.drawn) + ". Play it or keep it.";
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

  let handRects = new Map();           // card -> where it was on screen (relative to the table) before the last redraw
  function renderHand() {
    const t = M.table;
    const before = new Map();
    const tr = tableEl.getBoundingClientRect();
    Array.from(handEl.children).forEach((e) => { if (e.dataset.c) { const r = e.getBoundingClientRect(); before.set(e.dataset.c, { x: r.left - tr.left, y: r.top - tr.top, w: r.width, h: r.height }); } });
    handRects = before;
    handEl.innerHTML = "";
    if (t.you !== null) handEl.style.setProperty("--pc", seatCol(t.you));
    const youOut = t.you === null || t.seats[t.you].status === "out";
    if (youOut) { handEl.append(el("span", "note", "")); return; }
    const holding = t.turn === t.you && M.phase === "playing" && t.drawn;
    const hand = sortHand(t.seats[t.you].hand || []).filter((c) => !(holding && c === t.drawn));
    handEl.style.setProperty("--n", Math.max(2, hand.length));
    if (selected && !hand.includes(selected)) selected = null;
    const fresh = [];
    hand.forEach((c) => {
      const b = cardEl(c, { button: true, cls: c === selected ? "sel" : "" });
      b.dataset.c = c;
      b.addEventListener("click", () => onCard(c));
      handEl.append(b);
      fresh.push(b);
    });
    // FLIP: from where each card used to be to where it is now
    if (before.size && !reduceMotion()) {
      fresh.forEach((b) => {
        const o = before.get(b.dataset.c);
        if (!o) return;
        const r = b.getBoundingClientRect(), dx = o.x - (r.left - tr.left), dy = o.y - (r.top - tr.top);
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) b.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "translate(0,0)" }], { duration: 280, easing: "cubic-bezier(.22,.9,.3,1)" });
      });
    }
  }

  function renderActions() {
    const t = M.table;
    const mine = t.turn === t.you && M.phase === "playing";
    const o = t.options;
    drawBtn.disabled = !(mine && o.draw);
    drawBtn.textContent = t.pending > 0 ? "Pick up " + t.pending : "Draw";
    youEl.classList.toggle("on-turn", mine);
    if (t.you !== null) youEl.style.setProperty("--pc", seatCol(t.you));
    passBtn.hidden = true;
    const holding = mine && t.drawn;
    drawnBox.hidden = !holding;
    if (holding) {
      dcardEl.innerHTML = ""; dcardEl.append(cardEl(t.drawn, { cls: "lg" }));
      playDrawnBtn.disabled = !o.plays.includes(t.drawn);
    }
  }

  function renderLog() {
    const ev = (M.lastEvents || []).map(eventText).filter(Boolean).slice(-3);
    logEl.textContent = ev.join(" · ");
  }

  /* ---------- the moving parts: cards fly, pick-ups pop, skips are crossed out ---------- */
  const reduceMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const ANG = { top: 0, right: 90, you: 180, left: 270 };
  let seatPosOf = {}, animSig = null;
  const relRect = (e) => { const a = tableEl.getBoundingClientRect(), b = e.getBoundingClientRect(); return { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height }; };
  function seatRect(i) {
    const p = seatPosOf[i];
    const e = p === "you" ? handEl : oppsEl.querySelector(".c8-opp.pos-" + p + " .fan");
    return e ? relRect(e) : null;
  }
  // a card (or a card back) slides from one place to another, then is gone
  function fly(card, from, to, o) {
    o = o || {};
    const c = cardEl(card, { cls: "lg" });
    c.classList.add("c8-fly");
    tableEl.append(c);
    const w = c.offsetWidth, h = c.offsetHeight;
    const tx = to.x + to.w / 2 - w / 2, ty = to.y + to.h / 2 - h / 2;
    c.style.left = tx + "px"; c.style.top = ty + "px";
    const dx = from.x + from.w / 2 - w / 2 - tx, dy = from.y + from.h / 2 - h / 2 - ty;
    const a = c.animate([
      { transform: "translate(" + dx + "px," + dy + "px) scale(.8) rotate(" + (o.fromRot || 0) + "deg)", opacity: 1 },
      { transform: "translate(0,0) scale(1) rotate(" + (o.rot || 0) + "deg)", opacity: 1 },
    ], { duration: o.fade ? 380 : 460, delay: o.delay || 0, easing: "cubic-bezier(.22,.9,.3,1)", fill: "both" });
    a.onfinish = () => { c.remove(); if (o.done) o.done(); };
    return a;
  }
  const slashColor = (evs) => {
    const p = evs.filter((e) => e.e === "play" && e.card && !C.isJoker(e.card)).pop();
    return p && (C.suitOf(p.card) === "H" || C.suitOf(p.card) === "D") ? "#ff5a4f" : "#5bb4ff";
  };
  const SLASH_AT = { top: [50, 46], left: [10, 88], right: [90, 88], you: [50, 126] };
  function slash(seat, delay, color) {
    const p = seatPosOf[seat];
    const at = SLASH_AT[p] || [50, 88];
    const d = el("div", "c8-slash");
    d.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>';
    d.style.color = color; d.style.left = at[0] + "%"; d.style.top = at[1] + "cqw"; d.style.animationDelay = delay + "ms";
    stageEl.append(d);
    setTimeout(() => d.remove(), 1400 + delay);
  }
  function plus(n, seat, delay) {
    const p = seatPosOf[seat];
    const box = el("div", "c8-plus");
    box.style.animationDelay = delay + "ms";
    box.append("+" + n);
    box.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(' + (ANG[p] || 0) + 'deg)"><path d="M12 2 4 12h5v10h6V12h5z"/></svg>');
    setTimeout(() => { feltEl.classList.add("dark"); feltEl.append(box); }, delay);
    setTimeout(() => { feltEl.classList.remove("dark"); box.remove(); }, delay + 1400);
  }
  let glowAng = null;
  function moveGlow(pos) {
    if (!pos) { glowEl.style.opacity = "0"; return; }
    const target = ANG[pos];
    const R = feltEl.offsetWidth / 2;
    const pt = (deg) => { const r = deg * Math.PI / 180; return "translate(" + (R * Math.sin(r)).toFixed(1) + "px," + (-R * Math.cos(r)).toFixed(1) + "px)"; };
    glowEl.style.opacity = "1";
    if (glowAng === target) return;
    const from = glowAng === null ? target : glowAng;
    let diff = ((target - from + 540) % 360) - 180;          // the short way round
    if (diff === -180) diff = 180;
    glowEl.style.transform = pt(target);
    glowAng = target;
    if (diff === 0 || reduceMotion() || !glowEl.animate) return;
    const steps = Math.max(2, Math.ceil(Math.abs(diff) / 15)), frames = [];
    for (let k = 0; k <= steps; k++) frames.push({ transform: pt(from + diff * k / steps) });
    glowEl.animate(frames, { duration: 650, easing: "cubic-bezier(.4,0,.2,1)" });
  }
  function animateEvents() {
    const t = M && M.table;
    if (!t) return;
    const evs = M.lastEvents || [];
    const sig = (M.turnSince || "") + "|" + JSON.stringify(evs);
    if (sig === animSig) return;
    const first = animSig === null;
    animSig = sig;
    if (first || reduceMotion() || !tableEl.classList.contains("on")) return;
    const pile = drawEl.firstChild ? relRect(drawEl.firstChild) : null;
    const topCard = topEl.querySelector(".c8-card.top");
    let d = 0;
    evs.forEach((e) => {
      if (e.e === "play") {
        const from = seatRect(e.seat), tc = topEl.querySelector(".c8-card.top");
        if (from && tc) {
          const to = relRect(tc);
          tc.style.opacity = "0";
          fly(e.card, e.seat === t.you && handRects.get(e.card) || from, to, { delay: d, rot: 4, fromRot: e.seat === t.you ? 0 : -20, done: () => { tc.style.opacity = ""; } });
          d += 160;
        }
      } else if (e.e === "draw" || e.e === "pickup") {
        const toSlot = e.e === "draw" && e.seat === t.you && !drawnBox.hidden;
        const n = e.e === "draw" ? 1 : Math.min(e.n, 6), to = toSlot ? relRect(dcardEl) : seatRect(e.seat);
        if (toSlot) dcardEl.style.opacity = "0";
        if (pile && to) for (let k = 0; k < n; k++) fly(null, pile, to, { delay: d + k * 90, fade: true, done: toSlot ? () => { dcardEl.style.opacity = ""; } : null });
        if (e.e === "pickup" && e.n >= 2) plus(e.n, e.seat, d);
        d += 140;
      } else if (e.e === "skip") slash(e.seat, d, slashColor(evs));
      else if (e.e === "blocked") slash(e.seat, d, "#5bd17a");
      else if (e.e === "reverse") { stageEl.classList.add("spin"); setTimeout(() => stageEl.classList.remove("spin"), 900); }
    });
  }

  const t0turn = (t) => t.turn !== null && t.turn !== undefined;
  function renderTable() {
    if (!M || !M.table || M.phase === "lobby") { tableEl.classList.remove("on"); return; }
    tableEl.classList.add("on");
    renderOpps(); renderMid(); renderBanner(); renderHand(); renderActions(); renderLog();
    moveGlow(M.phase === "playing" && t0turn(M.table) ? seatPosOf[M.table.turn] : null);
    animateEvents();
    renderTaunts();
    if (selected) showHint(selected); else idleHint();
  }

  /* ---------- playing ---------- */
  function onCard(c) {
    if (selected === c) return playSelected();
    selected = c;
    // flip the class on the cards already there: rebuilding the hand would restart them and skip the lift
    Array.from(handEl.children).forEach((e) => e.classList.toggle("sel", e.dataset.c === c));
    renderActions(); showHint(c);
  }
  function playSelected() {
    const t = M && M.table;
    if (!t || !selected) return;
    if (whyNot(selected)) { showHint(selected, true); return; }
    if (C.rankOf(selected) === "8") return askSuit(selected);
    send({ t: "play", card: selected });
  }
  function askSuit(card) {
    pendingPlay = card;
    suitsEl.innerHTML = "";
    ["S", "H", "D", "C"].forEach((s) => {
      const b = el("button", s === "H" || s === "D" ? "red" : "", SYM[s]);
      b.type = "button"; b.setAttribute("aria-label", SUIT_NAME[s]);
      b.addEventListener("click", () => { suitPick.classList.remove("on"); const c = pendingPlay; pendingPlay = null; send({ t: "play", card: c, suit: s }); });
      suitsEl.append(b);
    });
    suitPick.classList.add("on");
  }
  suitPick.addEventListener("click", (e) => { if (e.target === suitPick) { suitPick.classList.remove("on"); pendingPlay = null; } });
  function doDraw() { if (M && M.table && M.table.options.draw) send({ t: "draw" }); }
  drawBtn.addEventListener("click", doDraw);
  passBtn.addEventListener("click", () => send({ t: "pass" }));
  keepBtn.addEventListener("click", () => send({ t: "pass" }));
  playDrawnBtn.addEventListener("click", () => { if (M && M.table && M.table.drawn) { selected = M.table.drawn; playSelected(); } });

  // an action goes to the local game or to the room
  function send(action) {
    selected = null; hintEl.classList.add("idle");
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
    const names = ["You"].concat(Array.from({ length: n }, (_, i) => "Bot " + (i + 1)));
    const bots = [null].concat(Array(n).fill(diff));
    L = { st: C.create({ names, bots, mode: cfg.mode, starter: 0 }, Math.random), cfg, events: [], timer: null };
    selected = null;
    document.body.classList.add("gk-play");
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
    }, 2800 + Math.random() * 600);
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
      M = {
        kind: "online", phase: v.phase, table: v.table, players: v.players, you: v.you, code: v.code, config: v.config,
        lastEvents: v.lastEvents, turnSince: v.turnSince, idleMs: v.idleMs, takeoverMs: v.takeoverMs, now: v.now, seatsWanted: v.seatsWanted,
        host: v.host,
      };
      if (M.table) M.table.you = v.you.seat;
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
  const lines = () => (window.TAUNT_LINES && window.TAUNT_LINES.online) || { hype: [], heckle: [] };
  const sugg = { h: -1, k: -1 };
  let tauntCool = false;
  const muted = () => store.get("taunt-mute", "0") === "1";
  function suggest(k) { const l = k === "h" ? lines().hype : lines().heckle; if (!l.length) return; let i; do { i = Math.floor(Math.random() * l.length); } while (l.length > 1 && i === sugg[k]); sugg[k] = i; }
  function renderTaunts() {
    tauntsEl.innerHTML = "";
    const online = M && M.kind === "online" && M.phase !== "lobby" && M.table;
    tauntsEl.hidden = !online || !lines().hype.length;
    if (tauntsEl.hidden) return;
    [["h", "hype"], ["k", "heckle"]].forEach(([k, name]) => {
      if (sugg[k] < 0) suggest(k);
      const text = lines()[name][sugg[k]];
      const b = el("button", "btn ghost", text);
      b.type = "button"; b.disabled = tauntCool; b.style.borderColor = k === "h" ? "var(--teal)" : "var(--coral)";
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
    const l = m.k === "h" ? lines().hype : lines().heckle;
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
    if (M.phase === "game_over") { roomEl.hidden = true; return; }
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
      for (let i = 0; i < M.config.bots; i++) { const r = el("div", "c8-seat"); r.append(el("span", "", "Bot " + (i + 1)), el("span", "tag", M.config.level)); seats.append(r); }
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

  /* ---------- game over: a card with your win counts (kept on this device) ---------- */
  const ICON_TROPHY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V17h3v2H8v-2h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3zM6 7v1a2 2 0 0 0 1.5 1.9A5 5 0 0 1 7 8.3V7zm12 0h-1v1.3a5 5 0 0 1-.5 1.6A2 2 0 0 0 18 8z"/></svg>';
  const ICON_HOME = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z"/></svg>';
  let overSeen = false;
  function winCounts() {
    const w = store.getJSON("winlog", []), now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return { today: w.filter((x) => x >= day).length, week: w.filter((x) => x >= now.getTime() - 7 * 864e5).length, all: w.length };
  }
  function renderOver() {
    const show = !!(M && M.phase === "game_over" && M.table);
    overEl.classList.toggle("on", show);
    if (!show) { overSeen = false; overEl.innerHTML = ""; return; }
    const t = M.table, won = t.winner === t.you;
    if (!overSeen) { overSeen = true; if (won) store.setJSON("winlog", store.getJSON("winlog", []).concat(Date.now()).slice(-1000)); }
    const c = winCounts();
    overEl.innerHTML = "";
    const card = el("div", "card");
    card.append(el("h2", "", won ? "You won!" : "Game over"), el("div", "who", "Winner"), el("div", "big", won ? "You" : seatName(t.winner)));
    const stats = el("div", "stats");
    stats.append(el("h3", "", "Your wins"));
    [["t1", "Today", c.today], ["t2", "This week", c.week], ["t3", "All time", c.all]].forEach(([cls, label, v]) => {
      const row = el("div", "row " + cls);
      row.innerHTML = ICON_TROPHY;
      row.append(el("span", "", label), el("span", "v", String(v)));
      stats.append(row);
    });
    card.append(stats);
    overEl.append(card);
    if (M.kind === "online" && M.you && M.you.host) {
      const cfg = el("div", "c8-cfg");
      cfg.append(seg("Game type", [["normal", "Normal"], ["tournament", "Tournament"]], M.config.mode, (v) => onlineSend({ t: "config", mode: v }), () => true));
      cfg.append(seg("Computer players", [[0, "None"], [1, "1"], [2, "2"], [3, "3"]], M.config.bots, (v) => onlineSend({ t: "config", bots: v }), (v) => M.players.length + v <= 4));
      overEl.append(cfg);
    }
    const acts = el("div", "acts");
    const home = el("a", "home"); home.href = "../"; home.setAttribute("aria-label", "All games"); home.innerHTML = ICON_HOME;
    acts.append(home);
    if (M.kind === "local") {
      const again = el("button", "again", "Play again"); again.type = "button";
      again.addEventListener("click", localStart);
      acts.append(again);
    } else {
      const mine = M.players.find((p) => p.pid === M.you.pid);
      const rm = el("button", "again", mine && mine.voted ? "Waiting" : "Rematch"); rm.type = "button";
      rm.disabled = !!(mine && mine.voted);
      rm.addEventListener("click", () => onlineSend({ t: "vote" }));
      const lv = el("button", "leave", "Leave"); lv.type = "button";
      lv.addEventListener("click", () => { onlineSend({ t: "leave" }); setTimeout(leaveLocalState, 300); });
      acts.append(rm, lv);
    }
    overEl.append(acts);
  }

  function setStatus(text) { statusEl.textContent = text; }

  /* ---------- put it all on screen ---------- */
  function renderAll() {
    renderRoom();
    renderTable();
    renderOver();
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
