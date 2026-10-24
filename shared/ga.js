/* Google Analytics (gtag.js). The library itself is fetched on window load, not
   before: the standard snippet minus its async loader tag. gtag() calls queue
   in dataLayer and GA4 replays them once the library arrives, so no hits are
   lost, and a third-party DNS + TLS handshake stays off the critical path in
   the WhatsApp in-app browser, where most first paints happen. */
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
// Visits from this machine (localhost while developing or testing) are not real players: send nothing.
var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if (!LOCAL) {
  gtag("js", new Date());
  gtag("config", "G-RFN70FPWB1");
}
/* Events: window.track(name, params) sends one GA4 event, tagged with the game (its folder). Nothing personal is sent.
   Automatic ones: link_open (arrived by a shared ?s= / ?live= link), game_start (first tap on a game page),
   share (any navigator.share call), install, js_error (message + file:line, once per page load). */
var GAME = (location.pathname.split("/")[1] || "hub");
window.track = function (name, params) {
  if (LOCAL && !window.__gaTest) return;   // __gaTest: the regression check records events on localhost
  try { var p = { game: GAME }; for (var k in params) p[k] = params[k]; gtag("event", name, p); } catch (e) { /* analytics must never break a page */ }
};
if (/[?&](s|live)=/.test(location.search)) track("link_open", { kind: /[?&]live=/.test(location.search) ? "live" : "move" });
if (GAME !== "hub") addEventListener("pointerdown", function () { track("game_start"); }, { once: true, capture: true });
if (navigator.share) { var share0 = navigator.share.bind(navigator); navigator.share = function () { track("share"); return share0.apply(null, arguments); }; }
addEventListener("appinstalled", function () { track("install"); });
var errSent = false;
addEventListener("error", function (e) {
  if (errSent) return;
  errSent = true;
  track("js_error", { message: String(e.message || "").slice(0, 100), where: String(e.filename || "").split("/").pop().split("?")[0] + ":" + (e.lineno || 0) });
});
addEventListener("load", function () {
  if (LOCAL) return;
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=G-RFN70FPWB1";
  document.head.appendChild(s);
});
