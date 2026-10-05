/* ============================================================
   async-share.js — play-by-link for two-player games.

   There is no server: the whole game state rides in the URL as
   ?s=<lz-string>. After a move the player sends the new link on
   WhatsApp; the opponent opens it, moves, and sends one back.

   State envelope (every game):
     { game, version, id, turn, board, status, winner, moveCount, last, resigned }
     id        random, only used by this device to spot old links
     turn      player who moves next (after the game ends: the player
               who did NOT make the final move). commit()'s move.nextTurn
               can override the default "give it to the opponent" for
               rules where the same player goes again (a pass, an extra
               turn on a streak).
     status    "in_progress" | "won" | "draw"
     winner    null unless status is "won"
     last      game-specific index of the last move, for highlighting
     resigned  true when status "won" was reached by the loser hitting
               "Admit defeat" rather than playing it out; absent (not
               false) on every ordinary move, so it costs nothing in the
               link until it's actually used

   Exposes `window.AsyncShare`. Needs gamekit.js and
   vendor/lz-string.min.js loaded first.
   ============================================================ */
(function (global) {
  "use strict";

  const PARAM = "s";
  const STATUSES = ["in_progress", "won", "draw"];
  const MAX_REMEMBERED = 40;

  /* ---------- Encoding ----------
     Every byte in the URL costs WhatsApp preview real estate, so the
     envelope is shrunk to single-letter keys and status codes on the wire
     — purely a transport detail. encode() takes, and decode() returns, the
     full-key envelope described above; every caller (validate(), every
     game's board code) only ever sees that shape. */

  const WIRE_KEY = { game: "g", version: "v", id: "i", turn: "t", board: "b", status: "s", winner: "w", moveCount: "n", last: "l", resigned: "r" };
  const STATUS_CODE = { in_progress: "p", won: "w", draw: "d" };
  const STATUS_NAME = { p: "in_progress", w: "won", d: "draw" };

  // lz-string's URI alphabet is [A-Za-z0-9+-]. A "+" in a query string
  // decodes to a space and some apps mangle it, so swap it for "_" and
  // keep links to unreserved characters. decode() accepts all spellings.
  function encode(state) {
    const wire = {};
    for (const k in WIRE_KEY) wire[WIRE_KEY[k]] = k === "status" ? (STATUS_CODE[state[k]] || state[k]) : state[k];
    return LZString.compressToEncodedURIComponent(JSON.stringify(wire)).replace(/\+/g, "_");
  }

  function decode(str) {
    if (typeof str !== "string" || !str) return null;
    try {
      const json = LZString.decompressFromEncodedURIComponent(str.replace(/[_ ]/g, "+"));
      if (!json) return null;
      const wire = JSON.parse(json);
      if (!wire || typeof wire !== "object") return null;
      const state = {};
      for (const k in WIRE_KEY) state[k] = wire[WIRE_KEY[k]];
      state.status = STATUS_NAME[state.status] || state.status;
      return state;
    } catch (e) {
      return null;
    }
  }

  // Envelope checks shared by every game; opts.validateBoard covers the rest.
  function validate(s, opts) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return false;
    if (s.game !== opts.game || s.version !== opts.version) return false;
    if (typeof s.id !== "string" || !/^[a-z0-9]{4,16}$/.test(s.id)) return false;
    if (STATUSES.indexOf(s.status) === -1) return false;
    if (opts.players.indexOf(s.turn) === -1) return false;
    if (!Number.isInteger(s.moveCount) || s.moveCount < 1) return false;
    if (s.status === "won" ? opts.players.indexOf(s.winner) === -1 : s.winner !== null) return false;
    if (s.resigned !== undefined && (s.resigned !== true || s.status !== "won")) return false;
    try { return !!opts.validateBoard(s); } catch (e) { return false; }
  }

  /* ---------- What this device has seen ----------
     Links carry no identity, so each browser remembers the newest move
     it has seen per game id. That is how a re-opened old link is spotted,
     and how a refresh after moving shows "send it" instead of letting the
     same player move twice. */
  const store = Gamekit.storage("async:");

  function seenAll() {
    const all = store.getJSON("seen", {});
    return all && typeof all === "object" && !Array.isArray(all) ? all : {};
  }

  function recall(s) {
    const rec = seenAll()[s.game + ":" + s.id];
    return rec && Number.isInteger(rec.n) && typeof rec.s === "string" ? rec : null;
  }

  function remember(s, enc, sent, mover) {
    const all = seenAll();
    all[s.game + ":" + s.id] = { n: s.moveCount, s: enc, sent: sent, t: Date.now(), mover: mover };
    Object.keys(all)
      .sort((a, b) => (all[b].t || 0) - (all[a].t || 0))
      .slice(MAX_REMEMBERED)
      .forEach(k => delete all[k]);
    store.setJSON("seen", all);
  }

  function newId() {
    let id = "";
    while (id.length < 6) id += Gamekit.randomSeed().toString(36);
    return id.slice(0, 6);
  }

  /* ---------- Links + clipboard ---------- */

  function pageUrl() { return location.href.split(/[?#]/)[0]; }
  function linkFor(enc) { return pageUrl() + "?" + PARAM + "=" + enc; }

  function setParam(enc) {
    try { history.replaceState(null, "", enc ? "?" + PARAM + "=" + enc : location.pathname); } catch (e) {}
  }

  function legacyCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && global.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }

  /* ---------- Controller ----------
     opts = {
       game, version, title,       identifiers + name used in the message
       players: [first, second],   values stored in turn / winner
       label(player),              display name, e.g. "X" or "Red"
       validateBoard(state),       game-specific shape check
       onState(state, canMove),    render the board (state null = new game)
       detail(state, viewer),      optional extra line on the game-over screen
       ui, statusEl                containers for the share panel + status line
     } */
  function start(opts) {
    const ui = opts.ui;
    const statusEl = opts.statusEl;
    const label = opts.label || String;
    let view = null;   // { kind, state, enc, viewer, latest }

    // Resign gets its own row below the board, just above whatever "New
    // game" controls the page already has — keeps it out of the busier
    // wa-ui panel above the board. Every WhatsApp game has either
    // .toolbar (undo/new-game) or .controls (new-game/mode select), so
    // this needs no per-game markup.
    const resignRow = document.createElement("div");
    resignRow.className = "wa-actions wa-resign-row";
    resignRow.hidden = true;
    const bottomBar = document.querySelector(".toolbar, .controls");
    if (bottomBar && bottomBar.parentNode) {
      bottomBar.parentNode.insertBefore(resignRow, bottomBar);
    } else {
      ui.parentNode.insertBefore(resignRow, ui.nextSibling);
    }

    function other(p) { return p === opts.players[0] ? opts.players[1] : opts.players[0]; }

    function classify(raw) {
      if (raw === null) return { kind: "new", state: null, viewer: opts.players[0] };
      raw = raw.replace(/[+ ]/g, "_");
      const state = decode(raw);
      if (!validate(state, opts)) return { kind: "invalid", state: null };
      const rec = recall(state);
      if (rec && state.moveCount < rec.n) return { kind: "stale", state: state, latest: rec };
      if (rec && state.moveCount === rec.n && rec.sent) {
        // Normally the mover is whoever DIDN'T get `turn` next. But a move
        // that grants another turn (Othello's pass, an extra turn in
        // Mancala/Dots and Boxes) can leave `turn` pointing at the mover
        // themself — so prefer the mover recorded at commit time, and only
        // fall back to the old guess for records saved before this existed.
        return { kind: "sent", state: state, enc: raw, viewer: rec.mover !== undefined ? rec.mover : other(state.turn) };
      }
      remember(state, raw, false);
      return { kind: "received", state: state, enc: raw, viewer: state.turn };
    }

    function canMove() {
      if (!view) return false;
      if (view.state && view.state.status !== "in_progress") return false;
      // Normally only a freshly-opened link is playable. But a move that
      // granted another turn (see commit()'s nextTurn) can leave it still
      // this viewer's turn right after their own commit — let them keep
      // playing immediately instead of forcing a send-then-reopen round trip.
      return view.kind === "new" || view.kind === "received" ||
        (view.kind === "sent" && view.state.turn === view.viewer);
    }

    // move = { board, status, winner, last, nextTurn? } for the player whose
    // turn it is. nextTurn is optional and defaults to the opponent — pass
    // it explicitly when a rule grants another turn to the same player
    // (Othello's pass, an extra turn in Mancala or Dots and Boxes).
    function commit(move) {
      if (!canMove()) return;
      const prev = view.state;
      const mover = view.viewer;
      const enc = encode({
        game: opts.game,
        version: opts.version,
        id: prev ? prev.id : newId(),
        turn: move.nextTurn !== undefined ? move.nextTurn : other(mover),
        board: move.board,
        status: move.status,
        winner: move.winner === undefined ? null : move.winner,
        moveCount: (prev ? prev.moveCount : 0) + 1,
        last: move.last === undefined ? null : move.last,
        resigned: move.resigned === true ? true : undefined,
      });
      // Render from the decoded link so the sender sees exactly what the opponent will.
      const state = decode(enc);
      remember(state, enc, true, mover);
      setParam(enc);
      view = { kind: "sent", state: state, enc: enc, viewer: mover };
      paint();
    }

    // Forfeits on the spot, board unchanged, from whoever's turn it
    // currently is — commit() already requires that, so no separate check
    // here. Starting a brand-new game (view.state null) has nothing to
    // resign from, so the button for this is simply never shown then.
    function resign() {
      if (!view.state) return;
      if (!global.confirm("Admit defeat? Your opponent wins immediately — there's no undo.")) return;
      commit({
        board: view.state.board,
        status: "won",
        winner: other(view.viewer),
        last: view.state.last,
        resigned: true,
      });
    }

    function go(enc) {
      setParam(enc);
      view = classify(enc);
      paint();
    }

    function newGame() {
      setParam(null);
      view = classify(null);
      paint();
    }

    /* ----- DOM helpers ----- */
    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    }
    function banner(cls, text) { ui.appendChild(el("div", "banner" + (cls ? " " + cls : ""), text)); }
    function note(text) { ui.appendChild(el("p", "wa-note", text)); }
    function actions(...buttons) {
      const row = el("div", "wa-actions");
      buttons.forEach(b => row.appendChild(b));
      ui.appendChild(row);
    }
    function button(text, cls, onClick) {
      const b = el("button", "btn " + cls, text);
      b.type = "button";
      b.addEventListener("click", onClick);
      return b;
    }
    function setStatus(bold, rest) {
      statusEl.replaceChildren(el("strong", "", bold));
      if (rest) statusEl.appendChild(document.createTextNode(" · " + rest));
    }

    // A wa.me text link always shows the raw link a second time under the
    // preview card, because the whole message is one text string. Sharing
    // *only* the url via navigator.share — same as tapping Spotify's own
    // Share button, with no caption baked in by the app — avoids that:
    // confirmed on-device, the share sheet appears and WhatsApp shows just
    // the clean preview card.
    function canNativeShare() {
      return typeof navigator.share === "function";
    }

    // Link first, then a line break, then the caption — matches what was
    // asked for after seeing the actual WhatsApp message text. Used for
    // both the native share (as a single `text` field, no separate `url`
    // — the two-field version left the order up to WhatsApp, which put
    // the caption first) and the wa.me fallback, so the two paths produce
    // the same message shape.
    function waMessage(caption, url) {
      return url + "\n" + caption;
    }

    function waLink(caption, url) {
      const a = el("a", "btn wa-send", "");
      a.href = "https://wa.me/?text=" + encodeURIComponent(waMessage(caption, url));
      a.target = "_blank";
      a.rel = "noopener";
      return a;
    }

    function sendButton(enc, finished, moveCount, resigned) {
      const caption = resigned ? "I surrendered! 🏳️"
        : finished ? "Game over!"
        : moveCount === 1 ? "Let's play!"
        : "Your turn!";
      const url = linkFor(enc);
      const label = resigned ? "Share your shame" : finished ? "Send result on WhatsApp" : "Send on WhatsApp";

      if (canNativeShare()) {
        return button(label, "wa-send", () => {
          // AbortError just means the person backed out of the share
          // sheet — leave it alone. Anything else (the share sheet
          // rejecting the payload, no app handling it, ...) falls back
          // to the plain wa.me link rather than leaving the tap dead.
          navigator.share({ text: waMessage(caption, url) }).catch(err => {
            if (err && err.name === "AbortError") return;
            waLink(caption, url).click();
          });
        });
      }

      const a = waLink(caption, url);
      a.textContent = label;
      return a;
    }

    function copyButton(enc) {
      const b = button("Copy link", "ghost", () => {
        copyText(linkFor(enc)).then(ok => {
          b.textContent = ok ? "Copied!" : "Copy failed — use the address bar";
          setTimeout(() => { b.textContent = "Copy link"; }, 1800);
        });
      });
      return b;
    }

    function result(s, viewer) {
      if (s.status === "draw") return { cls: "", text: "It's a draw." };
      if (s.winner === viewer) return { cls: "win", text: s.resigned ? "They gave up — you won! 🎉" : "You won! 🎉" };
      return { cls: "bad", text: s.resigned ? "You admitted defeat." : "You lost." };
    }

    function paint() {
      const v = view;
      const s = v.state;
      opts.onState(s, canMove());
      ui.hidden = false;
      ui.replaceChildren();
      resignRow.hidden = true;
      resignRow.replaceChildren();

      if (v.kind === "invalid") {
        setStatus("Invalid link");
        banner("bad", "This link looks invalid or from an older version of the game — start a new game?");
        actions(button("Start new game", "primary", newGame));
        return;
      }

      if (v.kind === "stale") {
        setStatus("Old link");
        banner("bad", "This is an old link — the game has already moved on to move " + v.latest.n + ".");
        note("You're looking at move " + s.moveCount + ".");
        actions(
          button("Open latest move", "primary", () => go(v.latest.s)),
          button("New game", "ghost", newGame)
        );
        return;
      }

      if (v.kind === "new") {
        setStatus("Your move", "you're " + label(v.viewer));
        note("Make the first move, then send the link to a friend on WhatsApp.");
        return;
      }

      if (s.status === "in_progress") {
        // True even for kind "sent" when a rule (commit()'s nextTurn) just
        // granted the same player another turn — see canMove() above.
        if (v.kind === "received" || s.turn === v.viewer) {
          setStatus("Your move", "you're " + label(v.viewer));
          note(v.kind === "sent" ? "That move gets you another turn — keep going." : "Make your move, then send the new link back.");
          resignRow.hidden = false;
          resignRow.appendChild(button("Admit defeat (coward)", "ghost wa-small", resign));
          return;
        }
        setStatus("Waiting for " + label(s.turn));
        banner("", "Move made — now send the link. It's " + label(s.turn) + "'s turn.");
        actions(sendButton(v.enc, false, s.moveCount), copyButton(v.enc));
        actions(button("Opponent on this device? Play " + label(s.turn) + " here", "ghost wa-small", () => {
          view = { kind: "received", state: s, enc: v.enc, viewer: s.turn };
          paint();
        }));
        return;
      }

      const r = result(s, v.viewer);
      setStatus("Game over");
      banner(r.cls, r.text);
      if (s.status === "won" && s.winner !== v.viewer) note(Gamekit.taunt());
      const extra = opts.detail ? opts.detail(s, v.viewer) : "";
      if (extra) note(extra);
      if (v.kind === "sent") {
        note(s.resigned ? "Let them know you threw in the towel." : "Send the final board so your opponent sees how it ended.");
        actions(sendButton(v.enc, true, undefined, s.resigned), copyButton(v.enc));
      }
      actions(button("New game", v.kind === "sent" ? "ghost" : "primary", newGame));
    }

    return {
      show() {
        view = classify(new URLSearchParams(location.search).get(PARAM));
        paint();
      },
      hide() {
        ui.hidden = true;
        ui.replaceChildren();
        resignRow.hidden = true;
        resignRow.replaceChildren();
      },
      canMove: canMove,
      commit: commit,
      newGame: newGame,
    };
  }

  global.AsyncShare = { start: start, encode: encode, decode: decode, validate: validate };
})(window);
