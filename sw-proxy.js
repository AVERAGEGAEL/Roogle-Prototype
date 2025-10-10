// sw-proxy.js — Local-first proxy with corsproxy.io fallback
// Tries a real CORS fetch first (readable), sanitizes headers, falls back to corsproxy.io

self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.pathname === "/proxy" && url.searchParams.has("url")) {
    const target = url.searchParams.get("url");
    event.respondWith(proxyRequest(target));
  }
});

async function proxyRequest(target) {
  // Attempt direct fetch first; then fallback to corsproxy.io only
  try {
    const direct = await directFetch(target);
    if (direct && direct.ok) return direct;
  } catch (err) {
    // fall through to fallback
  }

  // Fallback to corsproxy.io
  try {
    const fallbackUrl = `https://corsproxy.io/?${encodeURIComponent(target)}`;
    const res = await fetch(fallbackUrl, { method: "GET", mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error("Fallback failed: " + res.status);
    const text = await res.text();
    const headers = new Headers(res.headers);
    // sanitize headers
    ["content-security-policy", "x-frame-options", "cross-origin-embedder-policy", "cross-origin-opener-policy"]
      .forEach(h => headers.delete(h));
    headers.set("X-Proxied-By", "SW-fallback-corsproxy");
    headers.set("Content-Type", headers.get("content-type") || "text/html; charset=utf-8");
    return new Response(text, { status: 200, statusText: "OK", headers });
  } catch (err) {
    return new Response("All proxy attempts failed: " + err.message, {
      status: 500,
      headers: { "Content-Type": "text/plain" }
    });
  }
}

// Attempt a direct fetch that we can read & sanitize.
// If the response is opaque (res.type === "opaque") we throw so fallback is used.
async function directFetch(target) {
  try {
    const res = await fetch(target, {
      method: "GET",
      mode: "cors", // try proper CORS first (so we can read body)
      credentials: "omit",
      headers: {
        "User-Agent": navigator.userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": target,
        "Origin": new URL(target).origin
      }
    });

    // If opaque, we cannot read body — signal fallback
    if (res.type === "opaque") {
      throw new Error("Opaque response (CORS blocked) — fallback required");
    }

    // If not ok (e.g. 403/500) throw
    if (!res.ok) {
      throw new Error("Status " + res.status);
    }

    const text = await res.text();

    // Clone and sanitize headers to remove blocking directives
    const newHeaders = new Headers(res.headers);
    ["content-security-policy", "x-frame-options", "cross-origin-embedder-policy", "cross-origin-opener-policy"]
      .forEach(h => newHeaders.delete(h));

    newHeaders.set("X-Proxied-By", "LocalIP-SW");
    newHeaders.set("Content-Type", newHeaders.get("content-type") || "text/html; charset=utf-8");

    return new Response(text, { status: 200, statusText: "OK", headers: newHeaders });
  } catch (err) {
    // bubble up error to trigger fallback
    throw err;
  }
}
