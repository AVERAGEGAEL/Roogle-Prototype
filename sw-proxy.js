// sw-proxy.js — Hybrid Local Proxy (Plan C)
// Tries direct fetch, then public mirrors, with fake browser headers

self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.pathname === "/proxy" && url.searchParams.has("url")) {
    const target = url.searchParams.get("url");
    event.respondWith(proxyRequest(target));
  }
});

// Main proxy routine ----------------------------------------------------------
async function proxyRequest(target) {
  const attempts = [
    directFetch(target), // local browser fetch
    corsFetch(`https://corsproxy.io/?${encodeURIComponent(target)}`),
    corsFetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`)
  ];

  for (let i = 0; i < attempts.length; i++) {
    try {
      const res = await attempts[i];
      if (res && res.ok) {
        return res;
      }
    } catch (err) {
      // continue to next attempt
    }
  }

  return new Response("All proxy attempts failed.", {
    status: 500,
    headers: { "Content-Type": "text/plain" }
  });
}

// -----------------------------------------------------------------------------
// Attempt 1: Direct fetch with spoofed headers
async function directFetch(target) {
  try {
    const res = await fetch(target, {
      method: "GET",
      mode: "cors", // try true CORS first
      credentials: "omit",
      headers: {
        "User-Agent": navigator.userAgent,
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": target,
        "Origin": new URL(target).origin
      }
    });

    // Some opaque responses still have body access through res.body
    if (res.ok || res.type === "opaque") {
      return new Response(res.body, {
        status: 200,
        headers: {
          "Content-Type": res.headers.get("content-type") || "text/html",
          "X-Proxied-By": "LocalIP-SW"
        }
      });
    }
    throw new Error(`Status ${res.status}`);
  } catch (err) {
    return new Response(null, { status: 500 });
  }
}

// -----------------------------------------------------------------------------
// Attempt 2/3: Public mirror proxies
async function corsFetch(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit"
    });
    if (res.ok) return res;
    throw new Error(`Status ${res.status}`);
  } catch (err) {
    return new Response(null, { status: 500 });
  }
}
