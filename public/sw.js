// Simple PWA Service Worker to satisfy Chrome offline capabilities requirement
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass-through fetch mechanism allowing standard online-first operation
  event.respondWith(
    fetch(event.request).catch(() => {
      return new Response("Offline mode active.");
    })
  );
});
