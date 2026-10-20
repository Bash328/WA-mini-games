/* ============================================================
   multiseat.js — the online-room screens shared by the multi-seat games
   (Liar's Dice, Dominoes). Crazy 8 has its own copy of this inside crazy-8/game.js.

   MultiSeat.create({ game, title, roomEl, tauntsEl, store, onModel, modes })
   gives a controller that owns the WebSocket to /api/card/*, the landing / lobby /
   rematch screens (drawn into roomEl) and the little angel / devil taunt buttons.
   The page draws the table itself from the model it is handed:

     model = { kind: "online", phase: "landing" | "lobby" | "playing" | "round_over" | "game_over" | "closed",
               table: the engine's view for this person | null, players, you: { seat, host, pid }, code, config,
               lastEvents, turnSince, idleMs, takeoverMs, seatsWanted, host, closed }

   controller: enter(code | null), leave(), send(action), model(), active(), nowMs(), toast(text), landing()
   ============================================================ */
(function (global) {
  "use strict";

  const REJECT = {
    "not-host": "Only the host can do that.", "need-2": "You need at least 2 players. Add a computer player or wait for a friend.",
    full: "There are no free seats for that.", illegal: "That can't be done right now.", "not-your-turn": "It's not your turn.",
    "rate-limit": "Slow down a little.", "in-game": "You can't change that during a game.", "bad-config": "That setting isn't allowed.",
    "not-playing": "The game isn't running.", "not-seated": "You aren't seated in this game.",
  };
  const CLOSED = {
    started: "This game has already started, so nobody new can join. Ask the host to start a new room.",
    full: "This room is full.", expired: "That room doesn't exist any more. Start a new one.",
    disabled: "Online play is switched off right now.", "taken-over": "You opened this room somewhere else, so this tab was disconnected.",
    unreachable: "Couldn't reach the game server. Check your connection and try again.",
  };
  const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
  const MAX_SEATS = 4;

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function btn(text, cls, fn) { const b = el("button", "btn " + (cls || ""), text); b.type = "button"; b.addEventListener("click", fn); return b; }
  function copyText(text, done) {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); else done(false);
  }

  function create(opts) {
    const roomEl = opts.roomEl, tauntsEl = opts.tauntsEl, store = opts.store, game = opts.game;
    const modes = opts.modes || null;                            // [[value, label], ...] for a "game type" row, or null
    let M = null, ws = null, wantOpen = false, code = null, myPid = null, retries = 0, retryTimer = null, pingTimer = null, offset = 0, sawWelcome = false;
    const nowMs = () => Date.now() - offset;
    const myName = () => { try { const m = typeof Account !== "undefined" && Account.me(); return m ? m.name : ""; } catch (e) { return ""; } };

    // ---------- the toast ----------
    const toastEl = el("div", "ms-toast"); toastEl.hidden = true; toastEl.setAttribute("role", "status");
    document.body.append(toastEl);
    let toastTimer = null;
    function toast(text) { toastEl.textContent = text; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4200); }

    function changed() { render(); if (opts.onModel) opts.onModel(M); }

    // ---------- the connection ----------
    function socketPath() { return code ? "/api/card/ws?room=" + code : "/api/card/new?game=" + game; }
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
          lastEvents: v.lastEvents, turnSince: v.turnSince, idleMs: v.idleMs, takeoverMs: v.takeoverMs, now: v.now, seatsWanted: v.seatsWanted, host: v.host,
        };
        if (M.table) M.table.you = v.you.seat;
        changed();
      } else if (m.t === "notice") toast(m.text);
      else if (m.t === "taunt") onTaunt(m);
      else if (m.t === "reject") toast(REJECT[m.reason] || "That didn't work.");
      else if (m.t === "closed") closed(m.reason);
      else if (m.t === "left") leaveState();
    }
    function send(action) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "act", a: action })); else toast("Not connected. Reconnecting…"); }
    function sendRaw(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); else toast("Not connected. Reconnecting…"); }
    function closeSocket() {
      wantOpen = false; clearTimeout(retryTimer); clearInterval(pingTimer);
      if (ws) { const s = ws; ws = null; try { s.close(); } catch (e) { /* ignore */ } }
    }
    function closed(reason) {
      closeSocket();
      M = { kind: "online", phase: "closed", table: null, closed: CLOSED[reason] || "This room is no longer available." };
      changed();
    }
    function leaveState() { closeSocket(); code = null; M = null; sawWelcome = false; try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ } landing(); }
    function enter(c) {
      code = c || null; wantOpen = true; sawWelcome = false; retries = 0;
      M = { kind: "online", phase: "lobby", table: null, players: [], you: {}, config: { mode: "normal", bots: 0, level: "medium" }, connecting: true };
      changed();
      connect();
    }
    function landing() { M = { kind: "online", phase: "landing", table: null }; changed(); }
    function leave() { sendRaw({ t: "leave" }); setTimeout(leaveState, 300); }
    // reconnect when the tab comes back or the network returns
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && wantOpen && !ws) { retries = 0; connect(); } });
    window.addEventListener("online", () => { if (wantOpen && !ws) { retries = 0; connect(); } });

    // ---------- taunts ----------
    const lines = () => (window.TAUNT_LINES && window.TAUNT_LINES.online) || { angel: [], devil: [] };
    const sugg = { a: -1, d: -1 };
    let tauntCool = false;
    const muted = () => store.get("taunt-mute", "0") === "1";
    function suggest(k) { const l = k === "a" ? lines().angel : lines().devil; if (!l.length) return; let i; do { i = Math.floor(Math.random() * l.length); } while (l.length > 1 && i === sugg[k]); sugg[k] = i; }
    function renderTaunts() {
      if (!tauntsEl) return;
      tauntsEl.innerHTML = "";
      const on = M && M.kind === "online" && M.phase !== "lobby" && M.phase !== "landing" && M.phase !== "closed" && M.table;
      tauntsEl.hidden = !on || !lines().angel.length;
      if (tauntsEl.hidden) return;
      [["a", "angel"], ["d", "devil"]].forEach(([k, name]) => {
        if (sugg[k] < 0) suggest(k);
        const text = lines()[name][sugg[k]];
        const b = el("button", "btn ghost", text);
        b.type = "button"; b.disabled = tauntCool; b.style.borderColor = k === "a" ? "var(--teal)" : "var(--coral)";
        b.addEventListener("click", () => {
          if (tauntCool) return;
          sendRaw({ t: "taunt", k, i: sugg[k] });
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

    // ---------- the room screens ----------
    function seg(label, options, current, onPick, enabled) {
      const box = el("div", "");
      box.append(el("div", "lbl", label));
      const row = el("div", "ms-seg");
      options.forEach(([v, text]) => {
        const b = el("button", "btn ghost" + (String(v) === String(current) ? " active" : ""), text);
        b.type = "button"; b.disabled = !enabled || (typeof v === "number" && !enabled(v));
        b.addEventListener("click", () => onPick(v));
        row.append(b);
      });
      box.append(row);
      return box;
    }
    const inviteLink = () => location.origin + location.pathname + "?live=" + (M && M.code);
    const winnerName = () => { const t = M.table; return t.winner === t.you ? "You won!" : t.seats[t.winner].name + " won"; };

    function render() {
      roomEl.innerHTML = "";
      renderTaunts();
      if (!M) { roomEl.hidden = true; return; }
      roomEl.hidden = false;
      if (M.phase === "landing") {
        roomEl.append(el("h3", "", "Play " + opts.title + " online"));
        roomEl.append(el("p", "note", "Up to 4 players. Create a room and send the invite link, or join a friend's room with its code. The host can add computer players to fill seats."));
        const row = el("div", "ms-join");
        row.append(btn("Create a room", "primary", () => enter(null)));
        const input = el("input"); input.type = "text"; input.maxLength = 8; input.placeholder = "Room code"; input.autocomplete = "off"; input.spellcheck = false; input.setAttribute("aria-label", "Room code");
        const join = () => { const c = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); if (CODE_RE.test(c)) enter(c); else toast("Room codes are 6 letters and numbers."); };
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
        row.append(input, btn("Join", "ghost", join));
        roomEl.append(row);
        return;
      }
      if (M.phase === "closed") {
        roomEl.append(el("h3", "", "Room closed"), el("p", "note", M.closed), btn("Back", "primary", leaveState));
        return;
      }
      if (M.connecting && !M.code) { roomEl.append(el("p", "note", "Opening the room…")); return; }
      const isHost = M.you && M.you.host;
      if (M.phase === "lobby") {
        roomEl.append(el("h3", "", "Your room"));
        const codeBox = el("div", "ms-code");
        codeBox.append(el("span", "big", M.code.slice(0, 3) + " " + M.code.slice(3)));
        const cc = btn("Copy code", "ghost", () => copyText(M.code, (ok) => { cc.textContent = ok ? "Copied!" : "Select it and copy"; setTimeout(() => { cc.textContent = "Copy code"; }, 1500); }));
        const cl = btn("Copy link", "ghost", () => copyText(inviteLink(), (ok) => { cl.textContent = ok ? "Copied!" : "Copy failed"; setTimeout(() => { cl.textContent = "Copy link"; }, 1500); }));
        codeBox.append(cc, cl);
        if (navigator.share) codeBox.append(btn("Send invite", "primary", () => navigator.share({ text: inviteLink() + "\nJoin my " + opts.title + " game!" }).catch(() => {})));
        roomEl.append(codeBox);
        const seats = el("div", "ms-seats");
        M.players.forEach((p) => {
          const row = el("div", "ms-seat");
          row.append(el("span", "", p.name + (p.pid === M.you.pid ? " (you)" : "")));
          row.append(el("span", "tag", (p.host ? "host" : "") + (p.online ? "" : " · offline")));
          seats.append(row);
        });
        for (let i = 0; i < M.config.bots; i++) { const r = el("div", "ms-seat"); r.append(el("span", "", "Computer " + (i + 1)), el("span", "tag", M.config.level)); seats.append(r); }
        for (let i = M.players.length + M.config.bots; i < MAX_SEATS; i++) seats.append(el("div", "ms-seat empty", "Waiting for someone to join…"));
        roomEl.append(seats);
        const cfg = el("div", "ms-cfg");
        if (modes) cfg.append(seg("Game type", modes, M.config.mode, (v) => sendRaw({ t: "config", mode: v }), isHost ? () => true : null));
        cfg.append(seg("Computer players", [[0, "None"], [1, "1"], [2, "2"], [3, "3"]], M.config.bots, (v) => sendRaw({ t: "config", bots: v }), isHost ? (v) => M.players.length + v <= MAX_SEATS : null));
        cfg.append(seg("Computer level", [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], M.config.level, (v) => sendRaw({ t: "config", level: v }), isHost ? () => true : null));
        roomEl.append(cfg);
        if (isHost) {
          const go = btn("Start the game", "primary", () => sendRaw({ t: "start" }));
          go.disabled = M.seatsWanted < 2;
          roomEl.append(go);
          roomEl.append(el("p", "note", M.seatsWanted < 2 ? "You need at least 2 players: invite a friend or add a computer." : "It starts by itself when all 4 seats are full."));
        } else roomEl.append(el("p", "note", "Waiting for " + ((M.players.find((p) => p.host) || {}).name || "the host") + " to start. Only the host can change the settings."));
        if (typeof Account !== "undefined") {
          Account.status().then((st) => {
            if (!st.push || !roomEl.isConnected || !M || M.phase !== "lobby") return;
            const wrap = el("div", "ms-join");
            if (!Account.me()) { const a = el("a", "", "Pick a username on the home page to poke friends into a game."); a.href = "/#account"; a.style.fontSize = "13px"; wrap.append(a); }
            else {
              const input = el("input"); input.type = "text"; input.maxLength = 16; input.placeholder = "friend's username"; input.style.width = "12em"; input.style.textTransform = "none"; input.style.letterSpacing = "0"; input.setAttribute("aria-label", "Friend's username");
              const go = btn("Poke", "ghost", async () => { if (!input.value.trim()) return; go.disabled = true; const r = await Account.poke(input.value, game, M.code); toast(r.text); go.disabled = false; });
              wrap.append(input, go);
            }
            roomEl.append(wrap);
          });
        }
        roomEl.append(btn("Leave room", "ghost", leave));
        return;
      }
      if (M.phase === "game_over") {
        roomEl.append(el("h3", "", winnerName()));
        const seats = el("div", "ms-seats");
        M.players.forEach((p) => {
          const row = el("div", "ms-seat");
          row.append(el("span", "", p.name + (p.pid === M.you.pid ? " (you)" : "")));
          row.append(el("span", "win", p.wins + (p.wins === 1 ? " win" : " wins")));
          row.append(el("span", "tag", p.voted ? "ready for a rematch" : (p.online ? "" : "offline")));
          seats.append(row);
        });
        roomEl.append(seats);
        if (isHost) {
          const cfg = el("div", "ms-cfg");
          cfg.append(seg("Computer players", [[0, "None, just the people here"], [1, "1"], [2, "2"], [3, "3"]], M.config.bots, (v) => sendRaw({ t: "config", bots: v }), (v) => M.players.length + v <= MAX_SEATS));
          roomEl.append(cfg);
        } else roomEl.append(el("p", "note", "The host chooses the computer players for the rematch."));
        const mine = M.players.find((p) => p.pid === M.you.pid);
        const rm = btn(mine && mine.voted ? "Waiting for the others…" : "Rematch", "primary", () => sendRaw({ t: "vote" }));
        rm.disabled = !!(mine && mine.voted);
        roomEl.append(rm, btn("Leave room", "ghost", leave));
        return;
      }
      roomEl.hidden = true;                  // in a game: the table is the screen
    }

    // the little countdowns (offline / idle turn) tick once a second while online
    setInterval(() => { if (M && M.kind === "online" && M.table && M.phase === "playing" && opts.onTick) opts.onTick(M); }, 1000);

    return {
      enter, leave, send, landing, toast, nowMs, closeSocket,
      model: () => M, active: () => wantOpen || !!ws,
      stop() { closeSocket(); M = null; code = null; roomEl.innerHTML = ""; roomEl.hidden = true; if (tauntsEl) tauntsEl.hidden = true; },
    };
  }

  global.MultiSeat = { create };
})(window);
