// client-proxy.js (updated)
// Upgrades: per-second overlay timer, smart rotation logging, captcha/blank detection,
// safer reinject, MutationObserver for dynamic SPA content, reliable hide overlay behavior.

// ------------------ GLOBALS ------------------
const proxyIframe = document.getElementById("proxyIframe");
const debugLogs = document.getElementById("debugLogs");
let loadTimer = null;
let overlayTimer = null;
let overlayElapsed = 0;

// ------------------ UTILS ------------------
function getTargetURL() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("url");
}

function logDebug(message, type = "info") {
  if (debugLogs) {
    const p = document.createElement("p");
    p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    p.style.color =
      type === "error" ? "red" :
      type === "warn" ? "orange" : "black";
    debugLogs.appendChild(p);
    debugLogs.scrollTop = debugLogs.scrollHeight;
  }
  console.log("[DEBUG]", message);
  try { window.parent.postMessage({ type: "debugLog", message, level: type }, "*"); } catch {}
}

// Detect obvious blank/captcha/ratelimit pages by content inspection
function isBlankOrCaptcha(html) {
  if (!html) return true;
  const low = html.toLowerCase();

  // Common indicators
  const indicators = [
    "cloudflare",
    "received 429",
    "rate limit",
    "too many requests",
    "our systems have detected unusual traffic",
    "i'm not a robot",
    "recaptcha",
    "please verify you are a human",
    "access denied",
    "site can't be reached"
  ];

  // extremely short pages are suspicious
  if (html.trim().length < 200) return true;

  for (const s of indicators) {
    if (low.includes(s)) return true;
  }
  return false;
}

// ------------------ HTML REWRITE ------------------
function rewriteHTML(html, baseURL) {
  logDebug("🔧 Starting HTML rewrite...");
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Relax CSP so injected page scripts can run inside our iframe
    const csp = doc.createElement("meta");
    csp.httpEquiv = "Content-Security-Policy";
    csp.content = "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *;";
    if (doc.head) doc.head.prepend(csp);

    // Add base element so relative URLs resolve correctly
    if (doc.head) {
      const base = doc.createElement("base");
      base.href = baseURL;
      doc.head.prepend(base);
    }

    // Rewrite anchors to route through proxy UI (hash-based)
    doc.querySelectorAll("a").forEach(a => {
      try {
        const href = a.getAttribute("href");
        if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
          const abs = new URL(href, baseURL).href;
          a.setAttribute("href", "#url=" + encodeURIComponent(abs));
          // prevent default while inside iframe (clicks will be handled by our UI)
          a.addEventListener("click", e => {
            e.preventDefault();
            loadProxiedSite(abs);
          });
        }
      } catch (e) {
        // ignore malformed hrefs
      }
    });

    // Intercept forms and forward them through the proxy
    doc.querySelectorAll("form").forEach(f => {
      f.addEventListener("submit", e => {
        e.preventDefault();
        const action = f.getAttribute("action") || baseURL;
        let abs;
        try {
          abs = new URL(action, baseURL).href;
        } catch {
          abs = baseURL;
        }
        const data = new FormData(f);
        const query = new URLSearchParams(data).toString();
        if (f.method?.toLowerCase() === "get") abs += (abs.includes("?") ? "&" : "?") + query;
        logDebug(`📝 Intercepted form → ${abs}`);
        loadProxiedSite(abs);
      });
    });

    // Fix static relative resources to absolute
    doc.querySelectorAll("link, script, img, iframe, source").forEach(tag => {
      const attr = tag.tagName.toLowerCase() === "link" ? "href" : "src";
      const val = tag.getAttribute(attr);
      try {
        if (val && !/^https?:|^data:|^\/\//i.test(val)) {
          tag.setAttribute(attr, new URL(val, baseURL).href);
        }
      } catch {}
    });

    logDebug("✅ HTML rewrite complete");
    return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  } catch (err) {
    logDebug("⚠️ rewriteHTML failed: " + err.message, "warn");
    return html;
  }
}

// ------------------ IFRAME HELPERS ------------------
function setIframeContent(html) {
  try {
    const doc = proxyIframe.contentDocument || proxyIframe.contentWindow.document;
    // quick blank/captcha detection before writing
    if (isBlankOrCaptcha(html)) {
      logDebug("⚠️ Rewritten HTML appears blank or blocked (captcha/ratelimit) — aborting injected view", "warn");
      // show the raw html in debug area so user can see message
      setIframeContent(`<pre style="padding:20px;color:#b00">⚠️ Blocked or blank response from backend — check debug logs.</pre>`);
      hideLoading();
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();
    logDebug("🧩 Injected rewritten HTML into iframe");

    reinjectScripts(doc);
    attachDebugHooks(doc);

    // MutationObserver to catch SPA dynamic changes and new scripts/links
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          try {
            // new anchors
            node.querySelectorAll?.("a").forEach(a => {
              const href = a.getAttribute("href");
              if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
                const abs = new URL(href, doc.baseURI).href;
                a.setAttribute("href", "#url=" + encodeURIComponent(abs));
                a.addEventListener("click", e => {
                  e.preventDefault();
                  loadProxiedSite(abs);
                });
              }
            });

            // new scripts — reinject safely only once
            node.querySelectorAll?.("script").forEach(oldScript => {
              if (oldScript.dataset.reinjected) return;
              const newScript = document.createElement("script");
              if (oldScript.src) newScript.src = oldScript.src;
              else newScript.textContent = oldScript.textContent;
              newScript.async = false;
              oldScript.dataset.reinjected = "true";
              oldScript.replaceWith(newScript);
            });
          } catch (e) {
            // ignore per-node errors
          }
        }
      }
    });

    try {
      if (doc.body) observer.observe(doc.body, { childList: true, subtree: true });
      logDebug("👀 MutationObserver active for dynamic rewrites");
    } catch (e) {
      logDebug("⚠️ MutationObserver failed to start: " + e.message, "warn");
    }

    // After injecting, do a quick content sanity check (in case CSP or JS replaced body)
    setTimeout(() => {
      try {
        const bodyText = (doc.body && doc.body.innerText) ? doc.body.innerText.trim() : "";
        if (!bodyText || isBlankOrCaptcha(bodyText)) {
          logDebug("⚠️ Post-inject check flagged content as blank or captcha; will close overlay and show debug.", "warn");
          // keep iframe content so user can see any message, but hide overlay
          hideLoading();
        } else {
          hideLoading();
        }
      } catch {
        hideLoading();
      }
    }, 800);
  } catch (err) {
    logDebug("❌ setIframeContent failed: " + err.message, "error");
    hideLoading();
  }
}

function reinjectScripts(doc) {
  try {
    const scripts = Array.from(doc.querySelectorAll("script"));
    let count = 0;
    scripts.forEach(oldScript => {
      if (oldScript.dataset.reinjected) return;
      const newScript = document.createElement("script");
      if (oldScript.src) newScript.src = oldScript.src;
      else newScript.textContent = oldScript.textContent;
      newScript.async = false;
      oldScript.dataset.reinjected = "true";
      oldScript.replaceWith(newScript);
      count++;
    });
    logDebug(`🔁 Reinjected ${count} script(s)`);
  } catch (err) {
    logDebug("⚠️ reinjectScripts error: " + err.message, "warn");
  }
}

function attachDebugHooks(doc) {
  const win = proxyIframe?.contentWindow;
  if (!win) return;
  // Don't forward normal logs (they clutter the UI). Only surface errors/rejections.
  win.addEventListener("error", e => {
    try {
      const msg = e?.message || "Script error";
      logDebug(`[iframe error] ${msg}`, "error");
    } catch {}
  });

  win.addEventListener("unhandledrejection", e => {
    try {
      logDebug(`[iframe rejection] ${String(e?.reason)}`, "error");
    } catch {}
  });
}

// ------------------ OVERLAY TIMER ------------------
function startOverlayTimer() {
  clearInterval(overlayTimer);
  overlayElapsed = 0;
  const msg = document.getElementById("loadingMessage");
  const timeoutMsg = document.getElementById("timeoutMessage");
  const overlay = document.getElementById("loadingOverlay");
  timeoutMsg.style.display = "none";

  overlayTimer = setInterval(() => {
    overlayElapsed++;
    if (msg) msg.textContent = `🔄 Loading site... (${overlayElapsed}s)`;
    // show warning at 30s, but keep overlay visible until explicitly hidden
    if (overlayElapsed === 30) {
      if (timeoutMsg) timeoutMsg.style.display = "block";
      logDebug(`⌛ Load taking longer than expected (${overlayElapsed}s)`, "warn");
    }
    // safety: don't let overlay run forever — but fallback hide only after 120s
    if (overlayElapsed >= 120) {
      logDebug("⌛ Overlay fallback: forcing hide after 120s", "warn");
      hideLoading();
      clearInterval(overlayTimer);
    }
  }, 1000);
}

function stopOverlayTimer() {
  clearInterval(overlayTimer);
  overlayElapsed = 0;
  const msg = document.getElementById("loadingMessage");
  if (msg) msg.textContent = `🔄 Loading site... (0s)`;
}

// ------------------ LOADING TIMER ------------------
function startLoadTimer(url) {
  clearInterval(loadTimer);
  let elapsed = 0;
  loadTimer = setInterval(() => {
    elapsed += 5;
    if (elapsed % 15 === 0) logDebug(`⏳ Still loading ${url}... (${elapsed}s elapsed)`, "warn");
  }, 5000);
}

function stopLoadTimer() {
  clearInterval(loadTimer);
  loadTimer = null;
}

// ------------------ RECAPTCHA HANDLER ------------------
async function routeToRecaptcha(url, workerUrl) {
  logDebug(`🔒 Routing to recaptcha worker: ${workerUrl}`);
  try {
    const res = await fetch(`${workerUrl}?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error("Recaptcha worker returned " + res.status);
    const html = await res.text();
    // If the recaptcha worker returns an HTML page with a widget, inject it
    setIframeContent(html);
    logDebug("✅ Recaptcha worker delivered UI");
  } catch (err) {
    logDebug("❌ Recaptcha worker failed: " + err.message, "error");
    setIframeContent(`<p style="color:red;">⚠️ Recaptcha worker failed: ${err.message}</p>`);
  }
}

// ------------------ PROXY CORE (Smart Rotation) ------------------
async function loadProxiedSite(url) {
  if (debugLogs) debugLogs.innerHTML = "";

  showLoading(true);
  startOverlayTimer();
  startLoadTimer(url);
  logDebug(`🚀 Starting load: ${url}`);
  logDebug("🌀 Smart rotation system active");

  // backends list (rotate through)
  const backends = [
    "https://cloud1.uraverageopdoge.workers.dev",
    "https://cloud2.rageinhaler.workers.dev",
    "https://cloud3.kevinthejordan.workers.dev"
  ];

  // optional separate captcha worker (should present recaptcha UI)
  const captchaWorker = "https://captcha.uraverageopdoge.workers.dev";

  // shuffle copy
  const shuffled = backends.slice().sort(() => Math.random() - 0.5);
  let success = false;

  for (const backend of shuffled) {
    const targetURL = `${backend}/proxy?url=${encodeURIComponent(url)}`;
    logDebug(`🌐 Trying backend: ${backend}`);
    try {
      const start = performance.now();
      const res = await fetch(targetURL, { method: "GET" });
      const took = (performance.now() - start).toFixed(0);

      // Record response special header debug if present
      const debugHeader = res.headers.get("x-debug-status");
      if (debugHeader) logDebug(`🔎 Backend debug header: ${debugHeader}`);

      if (res.status === 429 || res.status === 403) {
        logDebug(`⚠️ ${backend} returned ${res.status} (${res.statusText}) — rate-limited or blocked`, "warn");

        // try routing to recaptcha worker if configured
        if (captchaWorker) {
          logDebug("🔁 Attempting recaptcha worker to recover...");
          await routeToRecaptcha(url, captchaWorker);
          success = true;
          break;
        } else {
          continue;
        }
      }

      if (!res.ok) throw new Error("Fetch failed with status " + res.status);

      let html = await res.text();

      // quick detection of blank/blocked page
      if (isBlankOrCaptcha(html)) {
        logDebug(`⚠️ ${backend} delivered blank/blocked content (detected). Trying next backend. (took ${took}ms)`, "warn");
        continue;
      }

      logDebug(`✅ ${backend} returned usable HTML (took ${took}ms)`);
      html = rewriteHTML(html, url);
      setIframeContent(html);
      logDebug(`🏁 Finished loading ${url} via ${backend}`);
      success = true;
      break;
    } catch (err) {
      logDebug(`❌ Backend ${backend} failed: ${err.message}`, "warn");
      // try next backend
    }
  }

  if (!success) {
    logDebug("⛔ All backends failed — showing fallback message", "error");
    setIframeContent(`<div style="padding:24px;color:#b00">⚠️ All Cloudflare backends failed or returned blocked pages. Try again later or switch workers.</div>`);
  }

  stopLoadTimer();
  stopOverlayTimer();
  // keep overlay hidden now
  hideLoading();
}

// ------------------ SERVICE WORKER REGISTRATION ------------------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw-proxy.js")
    .then(() => logDebug("✅ Service Worker registered and running"))
    .catch(err => logDebug("⚠️ SW registration failed: " + err.message, "error"));
}

// ------------------ INIT ------------------
window.addEventListener("load", () => {
  logDebug("🚧 Client Proxy initialized");
  const target = getTargetURL();
  if (target) loadProxiedSite(target);
});

window.addEventListener("hashchange", () => {
  const target = getTargetURL();
  if (target) loadProxiedSite(target);
});