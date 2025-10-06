// sw-proxy.js — Local-IP Proxy via Service Worker

self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Only intercept /proxy?url=...
  if (url.pathname === "/proxy" && url.searchParams.has("url")) {
    const targetURL = url.searchParams.get("url");
    event.respondWith(proxyRequest(targetURL));
  }
});

async function proxyRequest(target) {
  try {
    const res = await fetch(target, {
      mode: "cors",
      credentials: "omit",
      headers: { "User-Agent": navigator.userAgent }
    });

    const raw = await res.text();

    // clone headers, strip CSP / XFO / COEP etc.
    const newHeaders = new Headers(res.headers);
    ["content-security-policy", "x-frame-options", "cross-origin-embedder-policy", "cross-origin-opener-policy"]
      .forEach(h => newHeaders.delete(h));

    return new Response(raw, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders
    });
  } catch (err) {
    return new Response("Proxy failed: " + err.message, {
      status: 500,
      headers: { "Content-Type": "text/plain" }
    });
  }
}
