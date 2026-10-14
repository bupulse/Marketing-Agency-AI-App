// BuPulse service worker: shows lead alerts sent with Web Push (lib/push) and opens the lead when one is tapped.
// No caching and no offline pages: it only handles push and notification clicks.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "BuPulse";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/icon.png",
      badge: "/icon.png",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      data: { url: typeof data.url === "string" ? data.url : "/dashboard/leads" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let url = "/dashboard/leads";
  try {
    const target = new URL(event.notification.data && event.notification.data.url, self.location.origin);
    if (target.protocol === "https:" || target.protocol === "http:") url = target.href;
  } catch {
    // keep the leads page
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url === url);
      if (open) return open.focus();
      return self.clients.openWindow(url);
    }),
  );
});
