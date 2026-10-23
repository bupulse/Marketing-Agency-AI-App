// BuPulse Support service worker: makes the support app installable and shows chat alerts sent with Web Push, opening
// the chat when one is tapped. Registered by the support app only, with its scope ("/" on support.bupulse.com,
// "/support/" elsewhere), so it never controls the client dashboard. No caching: chats never stay on a device.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
// An installable app needs a fetch handler; this one lets the network answer everything.
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "BuPulse Support";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/icons/icon-192.png",
      badge: "/icon.png",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      data: { url: typeof data.url === "string" ? data.url : self.registration.scope },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let url = self.registration.scope;
  try {
    const target = new URL(event.notification.data && event.notification.data.url, self.location.origin);
    // Only pages of this app, on this host.
    if (target.origin === self.location.origin && target.href.startsWith(self.registration.scope)) url = target.href;
  } catch {
    // keep the app's start page
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.registration.scope));
      if (open) return open.navigate(url).then((w) => (w || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
