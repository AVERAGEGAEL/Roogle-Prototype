self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

const backends = [
  "https://cloud1.uraverageopdoge.workers.dev",
  "https://cloud2.uraverageopdoge.workers.dev",
  "https://cloud3.uraverageopdoge.workers.dev"
];

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.pathname === "/proxy" && url.searchParams.has("url")) {
    const target = url.searchParams.get("url");
    const backend = backends[Math.floor(Math.random() * backends.length)];
    const worker = `${backend}/proxy?url=${encodeURIComponent(target)}`;
    event.respondWith(fetch(worker));
  }
});
