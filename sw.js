// Service worker — הצגת התראות Push (גם כשהאתר סגור) ופתיחת האתר בלחיצה
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { p = { data: { body: e.data?.text() } }; }
  const d = p.data || {};
  const n = p.notification || {};
  const title = n.title || d.title || "בקרת מנופים";
  e.waitUntil(self.registration.showNotification(title, {
    body: n.body || d.body || "",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: d.level === "critical",
    dir: "rtl",
    lang: "he",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    data: { link: d.link || "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = e.notification.data?.link || "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const c = list.find((w) => "focus" in w);
      return c ? c.focus() : self.clients.openWindow(link);
    }),
  );
});
