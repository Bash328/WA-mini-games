/* ============================================================
   live-share.js — play a friend in real time, over a WebSocket room.

   The sibling of async-share.js: same controller surface (show / hide /
   commit / newGame / canMove) and the same state envelope, so a game
   adds live mode by pointing its existing link code at this controller
   instead. Nothing in WhatsApp mode depends on this file.

   How it works: one Durable Object per room (worker/live-room.mjs) holds
   the authoritative state and validates every move. This client never
   applies its own move optimistically — it waits for the server's echo,
   so the two screens can't drift. On every (re)connect the server sends
   the whole state, so a backgrounded tab or a dropped connection simply
   catches up.

   Needs gamekit.js and async-share.js (for AsyncShare.validate) loaded
   first.
   ============================================================ */
(function (global) {
  "use strict";

  const API = "/api/live";
  const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
  const store = Gamekit.storage("live:");

  const CLOSED = {
    "full": "This room already has two players.",
    "expired": "That room doesn't exist any more. Start a new one.",
    "disabled": "Live play is switched off right now. Use WhatsApp mode instead.",
    "taken-over": "You opened this game somewhere else, so this tab was disconnected.",
    "unreachable": "Couldn't reach the game server. Check your connection and try again.",
    "unsupported": "Live play isn't available in this browser. Use WhatsApp mode instead.",
    "out-of-sync": "The game got out of sync. Rejoin with the same link to continue.",
  };
  const REJECTED = {
    "stale": "That move was out of date. The board has been refreshed.",
    "not-your-turn": "It's not your turn.",
    "illegal": "That move isn't allowed.",
    "over": "The game is already over.",
    "waiting": "Waiting for your opponent to join.",
    "rate-limit": "Slow down a little.",
  };

  function start(opts) {
    const ui = opts.ui;
    const statusEl = opts.statusEl;
    const players = opts.players;
    const label = opts.label || String;
    const other = (p) => (p === players[0] ? players[1] : players[0]);
    const slotOf = (p) => players.indexOf(p) + 1;

    let phase = "idle";            // idle | lobby | connecting | room | closed
    let ws = null, wantOpen = false, everWelcomed = false;
    let code = null, seat = 0, order = null, me = null, gameId = null, state = null;
    let seated = { 1: false, 2: false }, online = { 1: false, 2: false }, rematch = { 1: false, 2: false };
    let pending = false, pendingTimer = null;
    let retries = 0, retryTimer = null, pingTimer = null, pongTimer = null;
    let closedReason = "", note = "", lobbyError = "";

    /* ---------- small helpers ---------- */

    function valid(s) {
      return AsyncShare.validate(s, {
        game: opts.game, version: opts.version, players: players, validateBoard: opts.validateBoard,
      });
    }
    function inviteLink() { return location.origin + location.pathname + "?live=" + code; }
    function setParam(c) {
      try { history.replaceState(null, "", c ? "?live=" + c : location.pathname); } catch (e) { /* ignore */ }
    }
    function send(obj) {
      if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
      return false;
    }
    const bothSeated = () => seated[1] && seated[2];

    function canMove() {
      if (phase !== "room" || pending || !me || !bothSeated()) return false;
      if (!state) return me === players[0];
      return state.status === "in_progress" && state.turn === me;
    }

    /* ---------- connection ---------- */

    function connect() {
      clearTimeout(retryTimer);
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      let sock;
      try {
        sock = new WebSocket(proto + "//" + location.host + API + "/ws?room=" + code);
      } catch (e) {
        return close("unsupported");
      }
      ws = sock;
      sock.onopen = () => {
        if (ws !== sock) return;
        const token = store.get("seat:" + code, null);
        send(token ? { t: "hello", token: token } : { t: "hello" });
        startPing();
      };
      sock.onmessage = (e) => { if (ws === sock) onMessage(e.data); };
      sock.onclose = () => {
        if (ws !== sock) return;
        ws = null;
        stopPing();
        online = { 1: false, 2: false };
        if (wantOpen) scheduleRetry();
      };
      sock.onerror = () => { /* onclose follows */ };
    }

    function scheduleRetry() {
      // A room that has never answered is probably gone or unreachable.
      if (!everWelcomed && retries >= 4) return close("unreachable");
      const delay = Math.min(15000, 1000 * Math.pow(2, retries++));
      note = "Connection lost. Reconnecting…";
      if (phase === "room") paint();
      retryTimer = setTimeout(() => { if (wantOpen && !ws) connect(); }, delay);
    }

    function startPing() {
      stopPing();
      pingTimer = setInterval(() => { if (ws && ws.readyState === 1) ws.send("ping"); }, 25000);
    }
    function stopPing() { clearInterval(pingTimer); clearTimeout(pongTimer); }

    // After the tab was hidden / the phone slept the socket may be dead
    // without anyone having told us. Ask it; if it doesn't answer, redial.
    function probe() {
      if (!wantOpen) return;
      if (!ws) { retries = 0; connect(); return; }
      if (ws.readyState !== 1) return;
      ws.send("ping");
      clearTimeout(pongTimer);
      pongTimer = setTimeout(() => {
        const dead = ws;
        ws = null;
        try { dead.close(); } catch (e) { /* ignore */ }
        retries = 0;
        connect();
      }, 2500);
    }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") probe(); });
    global.addEventListener("online", probe);

    function close(reason) {
      wantOpen = false;
      clearTimeout(retryTimer); clearTimeout(pendingTimer); stopPing();
      if (ws) { const s = ws; ws = null; try { s.close(); } catch (e) { /* ignore */ } }
      phase = "closed";
      closedReason = reason;
      pending = false;
      paint();
    }

    /* ---------- messages ---------- */

    function onMessage(data) {
      if (data === "pong") { clearTimeout(pongTimer); return; }
      let m;
      try { m = JSON.parse(data); } catch (e) { return; }
      if (!m || typeof m.t !== "string") return;

      if (m.t === "welcome") {
        if (m.state && !valid(m.state)) return close("out-of-sync");
        everWelcomed = true; retries = 0; note = "";
        seat = m.seat; order = m.order; me = order[seat]; gameId = m.id; state = m.state || null;
        seated = m.seated; online = m.online || online; rematch = m.rematch || rematch;
        store.set("seat:" + code, m.token);
        phase = "room";
        pending = false;
        return paint();
      }
      if (m.t === "state") {
        if (!valid(m.s)) return close("out-of-sync");
        state = m.s; pending = false; clearTimeout(pendingTimer); note = "";
        return paint();
      }
      if (m.t === "presence") {
        online = m.online; seated = m.seated;
        return paint();
      }
      if (m.t === "reject") {
        pending = false; clearTimeout(pendingTimer);
        if (m.state !== undefined && (m.state === null || valid(m.state))) state = m.state;
        note = REJECTED[m.reason] || "That didn't work.";
        return paint();
      }
      if (m.t === "rematch") { rematch = m.rematch; return paint(); }
      if (m.t === "rematch-start") {
        order = m.order; me = order[seat]; gameId = m.id; state = null;
        rematch = { 1: false, 2: false }; pending = false; note = "";
        return paint();
      }
      if (m.t === "closed") return close(m.reason);
    }

    /* ---------- lobby actions ---------- */

    async function create() {
      lobbyError = "";
      phase = "connecting";
      paint();
      let res;
      try {
        res = await fetch(API + "/create", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ game: opts.game }),
        });
      } catch (e) {
        phase = "lobby"; lobbyError = "Couldn't reach the server."; return paint();
      }
      if (res.status === 429) { phase = "lobby"; lobbyError = "Too many new rooms right now. Try again in a minute."; return paint(); }
      if (!res.ok) { phase = "lobby"; lobbyError = "Live play is unavailable right now."; return paint(); }
      const body = await res.json();
      enter(body.room);
    }

    // verify: a code someone typed or a link they followed may be stale; ask
    // first so the answer is immediate instead of a few failed reconnects.
    async function enter(c, verify) {
      if (verify) {
        phase = "connecting";
        paint();
        try {
          const r = await fetch(API + "/exists?room=" + c);
          const j = await r.json();
          if (!j.exists) { code = c; return close("expired"); }
        } catch (e) { /* let the socket try; it will report if unreachable */ }
      }
      code = c;
      setParam(code);
      wantOpen = true; everWelcomed = false; retries = 0; note = "";
      state = null; seat = 0; me = null; seated = { 1: false, 2: false }; online = { 1: false, 2: false };
      phase = "connecting";
      paint();
      connect();
    }

    function joinTyped(raw) {
      const c = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!CODE_RE.test(c)) { lobbyError = "Room codes are 6 letters and numbers."; return paint(); }
      lobbyError = "";
      enter(c, true);
    }

    function leave() {
      wantOpen = false;
      clearTimeout(retryTimer); clearTimeout(pendingTimer); stopPing();
      if (ws) { const s = ws; ws = null; try { s.close(); } catch (e) { /* ignore */ } }
      code = null; state = null; me = null; note = ""; lobbyError = "";
      setParam(null);
      phase = "lobby";
      paint();
    }

    /* ---------- DOM ---------- */

    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    }
    function banner(cls, text) { ui.appendChild(el("div", "banner" + (cls ? " " + cls : ""), text)); }
    function noteP(text) { ui.appendChild(el("p", "wa-note", text)); }
    function button(text, cls, onClick) {
      const b = el("button", "btn " + cls, text);
      b.type = "button";
      b.addEventListener("click", onClick);
      return b;
    }
    function actions(...buttons) {
      const row = el("div", "wa-actions");
      buttons.forEach((b) => row.appendChild(b));
      ui.appendChild(row);
    }
    function setStatus(bold, rest) {
      statusEl.replaceChildren(el("strong", "", bold));
      if (rest) statusEl.appendChild(document.createTextNode(" · " + rest));
    }

    function shareButton() {
      const caption = "Join my live game!";
      const msg = inviteLink() + "\n" + caption;
      if (typeof navigator.share === "function") {
        return button("Send on WhatsApp", "wa-send", () => {
          navigator.share({ text: msg }).catch((err) => {
            if (err && err.name === "AbortError") return;
            window.open("https://wa.me/?text=" + encodeURIComponent(msg), "_blank", "noopener");
          });
        });
      }
      const a = el("a", "btn wa-send", "Send on WhatsApp");
      a.href = "https://wa.me/?text=" + encodeURIComponent(msg);
      a.target = "_blank";
      a.rel = "noopener";
      return a;
    }
    function copyButton() {
      const b = button("Copy link", "ghost", () => {
        const done = (ok) => {
          b.textContent = ok ? "Copied!" : "Copy failed — use the address bar";
          setTimeout(() => { b.textContent = "Copy link"; }, 1800);
        };
        if (navigator.clipboard && global.isSecureContext) {
          navigator.clipboard.writeText(inviteLink()).then(() => done(true), () => done(false));
        } else done(false);
      });
      return b;
    }

    function result() {
      if (state.status === "draw") return { cls: "", text: "It's a draw." };
      if (state.winner === me) return { cls: "win", text: state.resigned ? "They gave up — you won! 🎉" : "You won! 🎉" };
      return { cls: "bad", text: state.resigned ? "You admitted defeat." : "You lost." };
    }

    function paint() {
      // Always bring the game's own board in line first.
      opts.onState(phase === "room" ? state : null, phase === "room" && canMove());
      ui.hidden = false;
      ui.replaceChildren();
      Gamekit.turn(null);

      if (phase === "lobby") return paintLobby();
      if (phase === "connecting") {
        setStatus("Connecting…");
        return noteP("Opening the room…");
      }
      if (phase === "closed") {
        setStatus("Room closed");
        banner("bad", CLOSED[closedReason] || "This room is no longer available.");
        return actions(button("Back to live play", "primary", leave));
      }
      paintRoom();
    }

    function paintLobby() {
      setStatus("Live online", "play in real time");
      noteP("Create a room and send the link to a friend, or join one with its code. Moves show up instantly — no link-passing.");
      actions(button("Create a live room", "primary", create));

      const row = el("div", "wa-actions");
      const input = el("input");
      input.type = "text";
      input.maxLength = 8;
      input.placeholder = "Room code";
      input.autocapitalize = "characters";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.setAttribute("aria-label", "Room code");
      input.style.cssText = "background:var(--panel-2);color:var(--fg);border:1px solid var(--border-hi);" +
        "border-radius:10px;padding:8px 12px;font:inherit;font-size:16px;min-height:44px;width:9em;" +
        "text-transform:uppercase;letter-spacing:0.15em;text-align:center";
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") joinTyped(input.value); });
      row.appendChild(input);
      row.appendChild(button("Join", "ghost", () => joinTyped(input.value)));
      ui.appendChild(row);
      if (lobbyError) noteP(lobbyError);
    }

    function paintRoom() {
      const finished = !!state && state.status !== "in_progress";

      if (!bothSeated()) {
        setStatus("Waiting for your opponent", "room " + code);
        Gamekit.turn(slotOf(me), "Waiting for your opponent", true);
        banner("", "Room " + code + " is open. The game starts the moment your friend joins.");
        actions(shareButton(), copyButton());
        if (note) noteP(note);
        return actions(button("Leave room", "ghost wa-small", leave));
      }

      if (finished) {
        const r = result();
        setStatus("Game over");
        banner(r.cls, r.text);
        noteP(Gamekit.taunt(state.status === "draw" ? "draw" : state.winner !== me ? "loss" : state.resigned ? "forfeit" : "win"));
        const oppSeat = seat === 1 ? 2 : 1;
        let rm;
        if (rematch[seat]) { rm = button("Waiting for them…", "ghost", () => {}); rm.disabled = true; }
        else rm = button(rematch[oppSeat] ? "Accept rematch" : "Rematch", "primary", () => send({ t: "rematch" }));
        actions(rm, button("Leave room", "ghost", leave));
        if (!online[oppSeat]) noteP("Your opponent has left the room.");
        return;
      }

      const myTurn = canMove();
      const oppSeat = seat === 1 ? 2 : 1;
      if (myTurn) {
        setStatus("Your move", "you're " + label(me));
        Gamekit.turn(slotOf(me), "Your move · you're " + label(me));
      } else {
        setStatus("Waiting for " + label(other(me)));
        Gamekit.turn(slotOf(other(me)), "Waiting for " + label(other(me)), true);
      }
      if (!online[oppSeat]) noteP("Your opponent is offline. They can rejoin with the same link.");
      if (note) noteP(note);
      if (state && myTurn) {
        actions(button("Admit defeat (coward)", "ghost wa-small", () => {
          if (!global.confirm("Admit defeat? Your opponent wins immediately — there's no undo.")) return;
          commit({ board: state.board, status: "won", winner: other(me), last: state.last, resigned: true });
        }));
      }
    }

    /* ---------- controller surface (same shape as AsyncShare) ---------- */

    function commit(move) {
      if (!canMove()) return;
      const prevCount = state ? state.moveCount : 0;
      const env = {
        game: opts.game, version: opts.version, id: gameId,
        turn: move.nextTurn !== undefined ? move.nextTurn : other(me),
        board: move.board, status: move.status,
        winner: move.winner === undefined ? null : move.winner,
        moveCount: prevCount + 1,
        last: move.last === undefined ? null : move.last,
      };
      if (move.resigned === true) env.resigned = true;
      if (!send({ t: "move", n: prevCount, s: env })) {
        note = "Not connected. Reconnecting…";
        return paint();
      }
      pending = true;
      note = "";
      // No echo in 8s: assume the socket is stale and redial for the true state.
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => { pending = false; probe(); paint(); }, 8000);
      paint();
    }

    return {
      show() {
        const param = new URLSearchParams(location.search).get("live");
        // Only offer the room if live play is actually switched on.
        phase = "connecting";
        paint();
        fetch(API + "/status").then((r) => r.json()).then((s) => {
          if (!s.enabled) return close("disabled");
          if (param && CODE_RE.test(param.toUpperCase())) enter(param.toUpperCase(), true);
          else { phase = "lobby"; paint(); }
        }).catch(() => close("unreachable"));
      },
      hide() {
        wantOpen = false;
        clearTimeout(retryTimer); clearTimeout(pendingTimer); stopPing();
        if (ws) { const s = ws; ws = null; try { s.close(); } catch (e) { /* ignore */ } }
        phase = "idle";
        Gamekit.turn(null);
        ui.hidden = true;
        ui.replaceChildren();
      },
      canMove: canMove,
      commit: commit,
      newGame: leave,
    };
  }

  global.LiveShare = { start: start };
})(window);
