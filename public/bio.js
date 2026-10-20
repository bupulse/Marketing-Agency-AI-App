// Link-in-bio page counter (app/b/[slug]/hit): one visit when the page opens, one tap per WhatsApp or Call button.
// sendBeacon goes out even while the phone is leaving for WhatsApp. No cookies, nothing stored on the phone.
(function () {
  if (!navigator.sendBeacon) return;
  var url = location.pathname.replace(/\/+$/, "") + "/hit";
  var send = function (kind) {
    try {
      navigator.sendBeacon(url, kind);
    } catch (e) {}
  };
  send("view");
  document.addEventListener("click", function (e) {
    var link = e.target && e.target.closest ? e.target.closest("a[data-t]") : null;
    if (link) send(link.getAttribute("data-t"));
  });
})();
