// sw-proxy.js — Local-IP Proxy with Real Browser Headers

self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Handle /proxy?url=
  if (url.pathname === "/proxy" && url.searchParams.has("url")) {
    const target = url.searchParams.get("url");
    event.respondWith(fetchThroughLocalIP(target));
  }
});

async function fetchThroughLocalIP(target) {
  try {
    // Try a no-cors fetch using the real IP of the user’s machine
    const res = await fetch(target, {
      method: "GET",
      mode: "no-cors",
      credentials: "omit",
      headers: {
        "User-Agent": navigator.userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": target,
        "Origin": new URL(target).origin
      }
    });

    // We can’t read opaque responses directly, but we’ll pass them through
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": "text/html",
        "X-Proxied-By": "LocalIP-SW"
      }
    });
  } catch (err) {
    return new Response("Proxy failed: " + err.message, {
      status: 500,
      headers: { "Content-Type": "text/plain" }
    });
  }
}
