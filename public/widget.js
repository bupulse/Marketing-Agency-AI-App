/* BuPulse chat widget loader. Add: <script src="https://bupulse.com/widget.js" data-key="YOUR_KEY" async></script> */
(function () {
  try {
    if (window.__bupulseWidget) return;
    var script = document.currentScript || document.querySelector('script[data-key][src*="widget.js"]');
    var key = script && script.getAttribute("data-key");
    if (!key || !script.src) return;
    window.__bupulseWidget = true;
    var base = new URL(script.src).origin;
    // A page opened by double-clicking the file has no hostname. "local-file" lets the owner test that
    // way while BuPulse runs on their own computer; the live service refuses it.
    var isFile = location.protocol === "file:";
    var host = location.hostname || (isFile ? "local-file" : "");

    function warn(msg) { try { console.warn("[BuPulse chat] " + msg); } catch {} }
    if (!host) return warn("Not shown: this page has no web address.");

    fetch(base + "/api/widget/config?key=" + encodeURIComponent(key) + "&origin=" + encodeURIComponent(host), { credentials: "omit" })
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (cfg && cfg.enabled) return ready(function () { mount(cfg); });
        var why = cfg && cfg.reason;
        if (why === "not_allowed" && isFile) warn("Not shown: pages opened as a file only work while testing BuPulse on this computer. Put the page on your website to use it.");
        else if (why === "not_allowed") warn("Not shown: " + host + " is not in this chat's allowed websites. Add it in BuPulse → Website chat.");
        else if (why === "disabled") warn("Not shown: the chat is switched off in BuPulse → Website chat.");
        else if (why === "unknown_key") warn("Not shown: the data-key in the script tag is wrong. Copy the snippet again from BuPulse → Website chat.");
      })
      .catch(function () { warn("Not shown: could not reach " + base + "."); });

    function ready(fn) {
      if (document.body) fn();
      else document.addEventListener("DOMContentLoaded", function () { try { fn(); } catch {} });
    }

    function mount(cfg) {
      try {
        var side = cfg.position === "left" ? "left" : "right";
        var holder = document.createElement("div");
        holder.id = "bupulse-widget";
        holder.style.cssText = "all:initial!important;position:fixed!important;bottom:0!important;" + side + ":0!important;width:0!important;height:0!important;z-index:2147483000!important;";
        var root = holder.attachShadow ? holder.attachShadow({ mode: "closed" }) : holder;
        var accent = /^#[0-9a-f]{6}$/i.test(cfg.accent) ? cfg.accent : "#2F6BFF";
        var text = /^#[0-9a-f]{6}$/i.test(cfg.accentText) ? cfg.accentText : "#ffffff";
        var style = document.createElement("style");
        style.textContent =
          ".b{position:fixed;bottom:20px;" + side + ":20px;width:60px;height:60px;border-radius:50%;border:0;padding:0;background:" + accent + ";color:" + text + ";cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.25);transition:transform .2s ease;-webkit-tap-highlight-color:transparent}" +
          ".b:hover{transform:scale(1.06)}.b:focus-visible{outline:3px solid " + accent + ";outline-offset:3px}" +
          ".b svg{width:28px;height:28px;transition:transform .2s ease,opacity .2s ease;position:absolute}.b .c{opacity:0;transform:rotate(-45deg)}" +
          ".b.o .m{opacity:0;transform:rotate(45deg)}.b.o .c{opacity:1;transform:none}" +
          ".f{position:fixed;bottom:92px;" + side + ":20px;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 112px);max-height:calc(100dvh - 112px);border:0;border-radius:16px;background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.28);opacity:0;visibility:hidden;transform:translateY(14px) scale(.97);transform-origin:bottom " + side + ";transition:opacity .2s ease,transform .2s ease,visibility 0s linear .2s,height .2s ease;color-scheme:light}" +
          ".f.o{opacity:1;visibility:visible;transform:none;transition-delay:0s}" +
          "@media (max-width:480px){.f{inset:0!important;width:100%!important;max-width:none!important;height:100%!important;max-height:none!important;border-radius:0}.b.o{display:none}}" +
          "@media (prefers-reduced-motion:reduce){.b,.b svg,.f{transition:none!important}}";
        var btn = document.createElement("button");
        btn.className = "b";
        btn.type = "button";
        btn.setAttribute("aria-label", cfg.label || "Open chat");
        btn.setAttribute("aria-expanded", "false");
        btn.innerHTML =
          '<svg class="m" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.5 2 2 6 2 11c0 2.4 1.1 4.6 2.9 6.2-.2 1.4-.8 2.7-1.6 3.7a.6.6 0 00.6.9c2-.2 3.6-1 4.8-1.9 1 .3 2.2.4 3.3.4 5.5 0 10-4 10-9s-4.5-9-10-9z"/></svg>' +
          '<svg class="c" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
        root.appendChild(style);
        root.appendChild(btn);

        var frame = null;
        var frameReady = false;
        var isOpen = false;
        var origin = base;
        function maxH() { return Math.max(320, (window.innerHeight || 700) - 112); }
        function mobile() { return window.matchMedia && matchMedia("(max-width:480px)").matches; }

        function open() {
          if (!frame) {
            frame = document.createElement("iframe");
            frame.className = "f";
            frame.title = cfg.label || "Chat";
            frame.setAttribute("allow", "");
            frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
            frame.src = base + "/widget/" + encodeURIComponent(key) + "?mode=embed&origin=" + encodeURIComponent(host) + "&page=" + encodeURIComponent(isFile ? "" : (location.origin + location.pathname).slice(0, 400));
            root.appendChild(frame);
            void frame.offsetWidth;
          }
          isOpen = true;
          frame.classList.add("o");
          btn.classList.add("o");
          btn.setAttribute("aria-expanded", "true");
          // Only once the chat page has loaded: before that the frame still has the host page's origin.
          if (frameReady) try { frame.contentWindow.postMessage({ source: "bupulse-host", type: "focus" }, origin); } catch {}
        }
        function close() {
          isOpen = false;
          if (frame) frame.classList.remove("o");
          btn.classList.remove("o");
          btn.setAttribute("aria-expanded", "false");
          try { btn.focus(); } catch {}
        }
        btn.addEventListener("click", function () { if (isOpen) close(); else open(); });

        window.addEventListener("message", function (e) {
          try {
            if (!frame || e.source !== frame.contentWindow || e.origin !== origin) return;
            var d = e.data;
            if (!d || d.source !== "bupulse-widget") return;
            if (d.type === "ready") frameReady = true;
            else if (d.type === "close") close();
            else if (d.type === "resize" && typeof d.height === "number" && !mobile()) {
              frame.style.height = Math.min(maxH(), Math.max(360, d.height)) + "px";
            } else if (d.type === "resize" && mobile()) frame.style.height = "";
          } catch {}
        });

        window.BuPulse = { open: open, close: close, toggle: function () { if (isOpen) close(); else open(); } };
        document.body.appendChild(holder);
      } catch {}
    }
  } catch {}
})();
