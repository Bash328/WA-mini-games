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
addEventListener("load", function () {
  if (LOCAL) return;
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=G-RFN70FPWB1";
  document.head.appendChild(s);
});
