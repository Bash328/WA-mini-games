/* account-ui.js — the "Your name" panel on the home page (needs account.js).
   Pick a username, turn on notifications, mute or block, install the app. */
(function () {
  "use strict";
  const root = document.getElementById("acct-box");
  if (!root || typeof Account === "undefined") return;

  const h = Account.h;

  // The two symbols Safari uses: the Share button (a box with an arrow leaving it) and Add to Home Screen (a square with a plus).
  const SVG = (inner, label) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="' + label + '">' + inner + "</svg>";
  const ico = (inner, label) => { const e = h("span", { class: "acct-ico" }); e.innerHTML = SVG(inner, label); return e; };
  const shareIco = () => ico('<path d="M12 3.5v11M8.5 7 12 3.5 15.5 7M8.5 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1.5"/>', "Share");
  const addIco = () => ico('<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/>', "Add to Home Screen");

  let profile = null;          // { name, push, muted, blocked } once the server has answered
  let pushAvailable = false;
  let msg = "";

  /* ---------- pieces ---------- */

  function pickName() {
    const input = h("input", {
      type: "text", id: "acct-name", maxlength: "16", placeholder: "username", autocomplete: "off",
      autocapitalize: "off", spellcheck: "false", "aria-label": "Username",
    });
    const note = h("p", { class: "acct-msg", "aria-live": "polite" });
    const btn = h("button", { type: "submit", class: "acct-primary" }, "Pick name");
    let timer = null, seq = 0;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const v = input.value.trim();
      note.className = "acct-msg";
      if (!v) { note.textContent = ""; return; }
      timer = setTimeout(async () => {
        const mine = ++seq;
        const r = await Account.check(v);
        if (mine !== seq) return;
        if (r.available) { note.textContent = "✓ " + v + " is free."; note.className = "acct-msg ok"; }
        else { note.textContent = Account.REASONS[r.reason] || "Can't use that name."; note.className = "acct-msg bad"; }
      }, 350);
    });
    const form = h("form", { class: "acct-row", onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      const r = await Account.claim(input.value);
      btn.disabled = false;
      if (r.status === 200) { msg = ""; await load(); return; }
      note.textContent = Account.REASONS[r.reason] || (r.status === 0 ? "Couldn't reach the server." : "That didn't work.");
      note.className = "acct-msg bad";
    } }, input, btn);
    return [
      h("p", { class: "acct-head" }, "Pick a username"),
      h("p", { class: "acct-note" }, "Friends can poke you into a live game by name. No password, no email: the name lives in this browser."),
      form, note,
    ];
  }

  function signedIn() {
    const out = [h("p", { class: "acct-who" }, "Playing as", h("b", {}, profile.name))];

    if (pushAvailable && Account.pushSupported()) {
      const on = profile.push;
      out.push(h("div", { class: "acct-row" },
        h("button", { type: "button", class: on ? "" : "acct-teal", onclick: async (e) => {
          e.target.disabled = true;
          if (on) { await Account.disableNotifications(); msg = ""; }
          else {
            const r = await Account.enableNotifications();
            msg = r.ok ? "" : r.reason === "denied" ? "Notifications are blocked for this site in your browser settings."
              : r.reason === "unsupported" ? "This browser can't do notifications." : "Couldn't turn notifications on. Try again.";
          }
          await load();
        } }, on ? "Turn off notifications" : "Turn on notifications"),
        h("span", { class: "acct-hint" }, on ? "A friend's poke shows up as a notification." : "So friends can poke you into a game."),
      ));
      out.push(h("label", { class: "acct-check" },
        h("input", { type: "checkbox", checked: profile.muted, onchange: async (e) => { await Account.settings({ muted: e.target.checked }); await load(); } }),
        " Mute pokes (don't notify me)"));
    } else if (!pushAvailable) {
      out.push(h("p", { class: "acct-hint" }, "Poke notifications aren't switched on for this site yet."));
    } else {
      out.push(Account.needsIOSHint()
        ? h("p", { class: "acct-hint" }, "On iPhone, notifications work from the installed app: tap Share ", shareIco(), ", then Add to Home Screen ", addIco(), ", and open it from there.")
        : h("p", { class: "acct-hint" }, "This browser can't do notifications."));
    }

    const blockInput = h("input", { type: "text", maxlength: "16", placeholder: "block a name", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Name to block" });
    out.push(h("form", { class: "acct-row", onsubmit: async (e) => {
      e.preventDefault();
      if (!blockInput.value.trim()) return;
      await Account.settings({ block: blockInput.value });
      await load();
    } }, blockInput, h("button", { type: "submit", class: "acct-coral" }, "Block")));
    if (profile.blocked.length) {
      out.push(h("p", { class: "acct-blocked" }, "Blocked: ", profile.blocked.map((n) =>
        h("button", { type: "button", class: "acct-chip", title: "Unblock " + n, onclick: async () => { await Account.settings({ unblock: n }); await load(); } }, n + " ✕"))));
    }

    out.push(h("p", { class: "acct-hint" }, "Your name is tied to this browser. If you clear its site data you lose the name."));
    out.push(h("button", { type: "button", class: "acct-link", onclick: async () => {
      if (!confirm("Release the name " + profile.name + "? Anyone can take it after that.")) return;
      await Account.release();
      profile = null; msg = "";
      render();
    } }, "Release this name"));
    return out;
  }

  // A Share button just above the install instructions. The share sheet is also where a phone offers
  // "Add to Home Screen", so one tap gets people there; without a share sheet it copies the link.
  function shareRow() {
    const url = location.origin + "/";
    const canShare = typeof navigator.share === "function";
    const ios = Account.needsIOSHint();
    const label = "Share";
    const b = h("button", { type: "button", class: "acct-primary", onclick: async () => {
      try {
        // the link only: with a title and text as well, iOS skips the link's own preview and shows a plain compass instead of the site icon
        if (canShare) await navigator.share({ url: url });
        else { await navigator.clipboard.writeText(url); b.textContent = "Link copied"; setTimeout(() => { b.textContent = label; }, 1800); }
      } catch (e) { /* the person closed the share sheet */ }
    } }, label);
    // on an iPhone the share sheet a page opens has no Add to Home Screen, so point at Safari's own Share button with its real symbol
    const hint = ios
      ? h("span", { class: "acct-hint" }, "To install, tap Share ", shareIco(), ", then Add to Home Screen ", addIco())
      : h("span", { class: "acct-hint" }, canShare ? "Sends the link to a friend." : "Copies the link so you can send it or bookmark it.");
    return h("div", { class: "acct-install acct-share" }, b, hint);
  }

  function installRow() {
    if (Account.standalone()) return null;
    if (Account.canInstall()) {
      return h("div", { class: "acct-install" },
        h("button", { type: "button", class: "acct-amber", onclick: () => Account.install() }, "Install the app"),
        h("span", { class: "acct-hint" }, "Add it to your home screen. It opens full screen, like an app."));
    }
    return null;
  }

  function render() {
    root.replaceChildren(...(Account.me() && profile ? signedIn() : pickName()));
    if (msg) root.appendChild(h("p", { class: "acct-msg bad", role: "alert" }, msg));
    root.appendChild(shareRow());
    const inst = installRow();
    if (inst) root.appendChild(inst);
  }

  async function load() {
    const st = await Account.status();
    pushAvailable = !!st.push;
    if (Account.me()) {
      const r = await Account.ping();
      if (r.status === 200) profile = r;
      else if (r.status === 401) { profile = null; msg = "Your name isn't registered any more (it may have expired). Pick it again."; localStorage.removeItem("user:name"); localStorage.removeItem("user:token"); }
      else profile = { name: Account.me().name, push: false, muted: false, blocked: [] };   // offline: show what we know
    } else profile = null;
    render();
  }

  Account.onInstallChange(render);
  Account.registerWorker();
  load();
})();
