/* BuPulse first-party page-view tracker. No cookies; sends nothing if the visitor opted out (GPC / Do Not Track). */
/* Each page view gets a random id; when the page is hidden or left, a beacon sends that id and how long the page was
   actually visible (time in a background tab does not count). */
(function () {
  try {
    var n = navigator;
    if (n.globalPrivacyControl || n.doNotTrack === "1" || window.doNotTrack === "1") return;
    var hex = function (size) {
      var b = new Uint8Array(size);
      crypto.getRandomValues(b);
      return Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    };
    var sid;
    try {
      sid = sessionStorage.getItem("bp_sid");
      if (!sid) {
        sid = hex(12);
        sessionStorage.setItem("bp_sid", sid);
      }
    } catch {}
    function send(payload) {
      var data = JSON.stringify(payload);
      if (!(n.sendBeacon && n.sendBeacon("/api/collect", new Blob([data], { type: "text/plain" })))) {
        fetch("/api/collect", { method: "POST", body: data, headers: { "content-type": "text/plain" }, keepalive: true }).catch(function () {});
      }
    }
    var hidden = function () { return document.visibilityState === "hidden"; };
    var last = "";
    var view = null; // this page view's id
    var shown = 0; // visible milliseconds counted so far
    var since = 0; // when the page last became visible; 0 while hidden
    var sent = 0; // the total last sent
    function pause() {
      if (since) shown += Date.now() - since;
      since = 0;
    }
    function flush() {
      if (!view || shown - sent < 1000) return;
      sent = shown;
      send({ v: view, e: shown });
    }
    function hit() {
      var path = location.pathname;
      if (path === last) return;
      // A client-side navigation ends the page before it: send its time first.
      pause();
      flush();
      last = path;
      view = hex(16);
      shown = 0;
      sent = 0;
      since = hidden() ? 0 : Date.now();
      send({
        p: path,
        r: document.referrer || undefined,
        q: location.search || undefined,
        w: screen.width,
        h: screen.height,
        l: (n.language || "").split("-")[0] || undefined,
        v: view,
        s: sid,
        d: n.webdriver === true,
      });
    }
    hit();
    document.addEventListener("visibilitychange", function () {
      if (hidden()) {
        pause();
        flush();
      } else if (!since) {
        since = Date.now();
      }
    });
    window.addEventListener("pagehide", function () { pause(); flush(); });
    // Coming back with the browser's back button can restore the page as it was: keep counting the same view.
    window.addEventListener("pageshow", function (e) { if (e.persisted && !since && !hidden()) since = Date.now(); });
    // Client-side navigations (Next's router) change the URL without a page load.
    var push = history.pushState;
    history.pushState = function () { var r = push.apply(this, arguments); setTimeout(hit, 0); return r; };
    window.addEventListener("popstate", function () { setTimeout(hit, 0); });
  } catch {}
})();
