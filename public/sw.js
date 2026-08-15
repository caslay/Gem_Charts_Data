// Simple PWA Service Worker to satisfy Chrome offline capabilities requirement
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. Bypass API endpoints, Next.js internal chunks/HMR, and non-GET requests
  if (
    event.request.method !== "GET" ||
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/_next")
  ) {
    return;
  }

  // 2. Pass-through fetch with explicit error status for static/navigation requests
  event.respondWith(
    fetch(event.request).catch(() => {
      return new Response("Offline mode active.", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "Content-Type": "text/plain" },
      });
    })
  );
});

