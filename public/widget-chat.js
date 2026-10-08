/* BuPulse chat widget: the chat inside the iframe. Vanilla JS, no dependencies. */
(function () {
  "use strict";
  var cfg;
  try {
    cfg = JSON.parse(document.getElementById("bp-config").textContent);
  } catch {
    return;
  }
  var S = cfg.strings;
  var MAX = 1000;
  var embedded = cfg.mode === "embed";

  // ---- storage (Safari can block it in frames: fall back to memory) ----
  var memory = {};
  function get(k) {
    try { return window.localStorage.getItem(k); } catch { return memory[k] || null; }
  }
  function set(k, v) {
    try { window.localStorage.setItem(k, v); } catch { memory[k] = v; }
  }
  function rid() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  var visitorId = get("bp_vid");
  if (!visitorId || !/^[A-Za-z0-9_-]{8,64}$/.test(visitorId)) { visitorId = rid(); set("bp_vid", visitorId); }

  var STORE = "bp_chat_" + cfg.key;
  var state = { sessionId: null, messages: [], leadDone: false, ts: Date.now() };
  try {
    var saved = JSON.parse(get(STORE) || "null");
    if (saved && Date.now() - saved.ts < 12 * 3600 * 1000) state = saved;
  } catch {}
  function persist() {
    state.ts = Date.now();
    set(STORE, JSON.stringify({ sessionId: state.sessionId, messages: state.messages.slice(-60), leadDone: state.leadDone, ts: state.ts }));
  }

  // ---- DOM helpers ----
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var app = document.getElementById("app");
  var head = el("div", "head");
  if (cfg.logo) {
    var img = document.createElement("img");
    img.alt = "";
    img.className = "logo";
    img.src = cfg.logo;
    img.onerror = function () { img.replaceWith(initial()); };
    head.appendChild(img);
  } else {
    head.appendChild(initial());
  }
  function initial() { var d = el("div", "logo", (cfg.name || "?").trim().charAt(0).toUpperCase()); return d; }
  head.appendChild(el("div", "title", cfg.name));
  if (embedded) {
    var close = el("button", "x");
    close.type = "button";
    close.setAttribute("aria-label", S.close);
    close.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    close.onclick = function () { post({ type: "close" }); };
    head.appendChild(close);
  }
  var log = el("div", "log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  var composer = el("form", "composer");
  var input = el("input");
  input.type = "text";
  input.maxLength = MAX;
  input.placeholder = S.placeholder;
  input.setAttribute("aria-label", S.placeholder);
  input.setAttribute("enterkeyhint", "send");
  input.autocomplete = "off";
  var send = el("button", "send");
  send.type = "submit";
  send.setAttribute("aria-label", S.send);
  send.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.4-8.4a1 1 0 000-1.8L3.4 1.6a1 1 0 00-1.4 1.2L4 10l9 2-9 2-2 7.2a1 1 0 001.4 1.2z" transform="translate(1 0)"/></svg>';
  composer.appendChild(input);
  composer.appendChild(send);
  var foot = el("div", "foot");
  var pw = document.createElement("a");
  pw.href = "https://bupulse.com";
  pw.target = "_blank";
  pw.rel = "noopener";
  pw.textContent = "Powered by BuPulse";
  foot.appendChild(pw);
  var tsBox = el("div", "ts");
  var tsNote = el("p", null, S.verify);
  var tsTarget = el("div");
  tsBox.appendChild(tsNote);
  tsBox.appendChild(tsTarget);
  app.appendChild(head);
  app.appendChild(log);
  app.appendChild(composer);
  app.appendChild(foot);
  app.appendChild(tsBox);

  // ---- parent window (widget.js) ----
  function post(msg) {
    if (!embedded || window.parent === window) return;
    msg.source = "bupulse-widget";
    window.parent.postMessage(msg, "*");
  }
  function resize() {
    if (!embedded) return;
    var cardsH = 0;
    var h = head.offsetHeight + composer.offsetHeight + foot.offsetHeight + log.scrollHeight + cardsH;
    post({ type: "resize", height: Math.ceil(h) });
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") post({ type: "close" }); });
  window.addEventListener("message", function (e) {
    if (e.source === window.parent && e.data && e.data.source === "bupulse-host" && e.data.type === "focus") input.focus();
  });

  // ---- rendering ----
  var typing = null;
  var card = null;
  var dismissedAt = -99;
  function scroll() { log.scrollTop = log.scrollHeight; resize(); }
  function bubble(role, text) {
    var m = el("div", "msg " + role, text);
    log.insertBefore(m, typing && typing.parentNode ? typing : card && card.parentNode ? card : null);
    scroll();
  }
  function showTyping(on) {
    if (on && !typing) {
      typing = el("div", "dots");
      typing.setAttribute("role", "status");
      typing.setAttribute("aria-label", S.typing);
      typing.innerHTML = "<i></i><i></i><i></i>";
      log.appendChild(typing);
    } else if (!on && typing) {
      typing.remove();
      typing = null;
    }
    scroll();
  }
  function add(role, text) { state.messages.push({ role: role, text: text }); persist(); bubble(role, text); }

  // ---- contact card ----
  function field(type, ph, name, ac) {
    var i = el("input");
    i.type = type;
    i.placeholder = ph;
    i.name = name;
    i.maxLength = 200;
    i.setAttribute("aria-label", ph);
    if (ac) i.autocomplete = ac;
    return i;
  }
  function showCard(interest) {
    if (card && card.parentNode) return;
    if (state.leadDone) return;
    card = el("form", "card");
    card.noValidate = true;
    card.appendChild(el("h2", null, S.cardTitle));
    var n = field("text", S.name, "name", "name");
    var p = field("tel", S.phone, "phone", "tel");
    var m = field("email", S.email, "email", "email");
    var w = field("text", S.interest, "interest");
    if (interest) w.value = interest;
    var err = el("div", "err");
    err.setAttribute("role", "alert");
    var row = el("div", "row");
    var ok = el("button", "btn", S.submit);
    ok.type = "submit";
    var no = el("button", "btn ghost", S.skip);
    no.type = "button";
    no.onclick = function () { dismissedAt = visitorCount(); card.remove(); resize(); };
    row.appendChild(ok);
    row.appendChild(no);
    [n, p, m, w, err, row].forEach(function (x) { card.appendChild(x); });
    var c = card;
    card.onsubmit = function (e) {
      e.preventDefault();
      err.textContent = "";
      if (!p.value.trim() && !m.value.trim()) { err.textContent = S.need; return; }
      ok.disabled = true;
      api("/api/widget/lead", {
        key: cfg.key, visitorId: visitorId, sessionId: state.sessionId,
        name: n.value, phone: p.value, email: m.value, interest: w.value, origin: cfg.origin, page: cfg.page, lang: navigator.language
      }).then(function (r) {
        if (r.ok) {
          state.leadDone = true;
          c.remove();
          card = null;
          add("assistant", (r.data && r.data.message) || S.thanks);
        } else {
          ok.disabled = false;
          err.textContent = (r.data && r.data.message) || S.error;
        }
      });
    };
    log.insertBefore(card, typing);
    scroll();
    if (!window.matchMedia("(max-width:480px)").matches) n.focus();
  }
  function visitorCount() { return state.messages.filter(function (m) { return m.role === "visitor"; }).length; }

  // ---- network ----
  function api(path, body) {
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit" })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, status: res.status, data: data }; }); })
      .catch(function () { return { ok: false, status: 0, data: {} }; });
  }

  // ---- Turnstile (only when the server has keys) ----
  var tsReady = null;
  var tsWidget = null;
  var tsPending = null;
  function loadTurnstile() {
    if (!cfg.turnstileSiteKey) return Promise.resolve(null);
    if (tsReady) return tsReady;
    tsReady = new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = function () { resolve(window.turnstile || null); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
    return tsReady;
  }
  var tsTimer = null;
  function tsHide() { tsBox.className = "ts"; }
  function tsDone(v) {
    clearTimeout(tsTimer);
    tsHide();
    var f = tsPending;
    tsPending = null;
    if (f) f(v);
  }
  function token() {
    return loadTurnstile().then(function (t) {
      if (!t) return null;
      return new Promise(function (resolve) {
        tsPending = resolve;
        clearTimeout(tsTimer);
        tsTimer = setTimeout(function () { tsDone(null); }, 20000);
        if (tsWidget === null) {
          tsWidget = t.render(tsTarget, {
            sitekey: cfg.turnstileSiteKey,
            appearance: "interaction-only",
            execution: "execute",
            // A visible challenge (VPN, strict browsers) needs the visitor: show it above the composer.
            "before-interactive-callback": function () {
              clearTimeout(tsTimer);
              tsTimer = setTimeout(function () { tsDone(null); }, 120000);
              tsBox.className = "ts show";
            },
            "after-interactive-callback": tsHide,
            callback: function (v) { tsDone(v); },
            "error-callback": function () { tsDone(null); }
          });
        } else {
          t.reset(tsWidget);
        }
        t.execute(tsWidget);
      });
    });
  }

  // ---- sending ----
  var busy = false;
  function submit(text, tk, retried) {
    return api("/api/widget/chat", {
      key: cfg.key, visitorId: visitorId, sessionId: state.sessionId || undefined,
      message: text, page: cfg.page, origin: cfg.origin, lang: navigator.language, turnstileToken: tk || undefined
    }).then(function (r) {
      if (r.status === 403 && r.data && r.data.error === "challenge_required" && !tk && cfg.turnstileSiteKey) {
        return token().then(function (t) { return t ? submit(text, t) : r; });
      }
      // A saved chat the server no longer knows (another visitor id, cleaned up): start a new one once.
      if (r.status === 404 && r.data && r.data.error === "session_not_found" && state.sessionId && !retried) {
        state.sessionId = null;
        state.leadDone = false;
        persist();
        return submit(text, tk, true);
      }
      return r;
    });
  }
  composer.onsubmit = function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    send.disabled = true;
    input.value = "";
    add("visitor", text);
    showTyping(true);
    var started = Date.now();
    submit(text).then(function (r) {
      var wait = Math.max(0, 500 - (Date.now() - started));
      setTimeout(function () {
        showTyping(false);
        busy = false;
        send.disabled = false;
        if (r.ok && r.data && r.data.reply) {
          state.sessionId = r.data.sessionId;
          if (r.data.leadCaptured) state.leadDone = true;
          add("assistant", r.data.reply);
          var since = visitorCount() - dismissedAt;
          if (r.data.askContact && !state.leadDone && (since > 3 || r.data.limited)) showCard(r.data.interest);
        } else if (r.status === 429) {
          bubble("assistant", (r.data && r.data.message) || S.busy);
        } else {
          bubble("assistant", S.error);
        }
        if (matchMedia("(pointer:fine)").matches) input.focus();
        persist();
      }, wait);
    });
  };
  input.addEventListener("focus", function () { if (cfg.turnstileSiteKey) loadTurnstile(); }, { once: true });

  // ---- start ----
  if (state.messages.length === 0) state.messages.push({ role: "assistant", text: cfg.greeting });
  state.messages.forEach(function (m) { bubble(m.role, m.text); });
  if (state.sessionId && !state.leadDone && visitorCount() >= 3) { /* the card is offered again with the next reply */ }
  post({ type: "ready" });
  resize();
  window.addEventListener("resize", resize);
})();
