/* BuPulse first-party page-view tracker. No cookies; sends nothing if the visitor opted out (GPC / Do Not Track). */
(function () {
  try {
    var n = navigator;
    if (n.globalPrivacyControl || n.doNotTrack === "1" || window.doNotTrack === "1") return;
    var sid;
    try {
      sid = sessionStorage.getItem("bp_sid");
      if (!sid) {
        var b = new Uint8Array(12);
        crypto.getRandomValues(b);
        sid = Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
        sessionStorage.setItem("bp_sid", sid);
      }
    } catch {}
    var last = "";
    function hit() {
      var path = location.pathname;
      if (path === last) return;
      last = path;
      var data = JSON.stringify({ p: path, r: document.referrer || undefined, q: location.search || undefined, w: screen.width, s: sid, d: n.webdriver === true });
      if (!(n.sendBeacon && n.sendBeacon("/api/collect", new Blob([data], { type: "text/plain" })))) {
        fetch("/api/collect", { method: "POST", body: data, headers: { "content-type": "text/plain" }, keepalive: true }).catch(function () {});
      }
    }
    hit();
    // Client-side navigations (Next's router) change the URL without a page load.
    var push = history.pushState;
    history.pushState = function () { var r = push.apply(this, arguments); setTimeout(hit, 0); return r; };
    window.addEventListener("popstate", function () { setTimeout(hit, 0); });
  } catch {}
})();
