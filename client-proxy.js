// ------------------ GLOBALS ------------------

const proxyIframe = document.getElementById("proxyIframe");
const debugLogs = document.getElementById("debugLogs"); // local hidden; main UI shows logs
let loadTimer = null;

// ------------------ UTILS ------------------

function getTargetURL() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("url");
}

function nowTs() {
  return new Date().toLocaleTimeString();
}

function sendParent(msg) {
  // Always send structured objects to parent window for central logging/actions.
  try { parent.postMessage(msg, "*"); } catch (e) { /* ignore */ }
}

function logDebug(message, type = "info") {
  const entry = { ts: nowTs(), level: type, message };
  // local hidden logs (kept for debugging if needed)
  if (debugLogs) {
    const p = document.createElement("p");
    p.textContent = `[${entry.ts}] ${entry.message}`;
    p.style.color = type === "error" ? "red" : type === "warn" ? "orange" : "black";
    debugLogs.appendChild(p);
    debugLogs.scrollTop = debugLogs.scrollHeight;
  }
  console.log(`[${entry.ts}] [${type.toUpperCase()}] ${message}`);
  // forward to parent UI for display
  sendParent({ type: "clientProxy:log", payload: entry });
}

// ------------------ REWRITERS ------------------

function rewriteHTML(html, baseURL) {
  logDebug("🔧 Starting HTML rewrite...", "info");
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // inject permissive CSP meta so injected page scripts can run
  const csp = doc.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *;";
  doc.head.prepend(csp);

  // inject <base> so relative URLs resolve
  const base = doc.createElement("base");
  base.href = baseURL;
  doc.head.prepend(base);

  // inject navigation-protection script so the page cannot navigate away directly
  const navProtectScript = doc.createElement("script");
  navProtectScript.textContent = `
    (function(){
      // Convert relative -> absolute
      function abs(href) {
        try { return new URL(href, location.href).href; } catch(e){ return href; }
      }

      // Post message to parent (client-proxy) asking it to navigate via proxy
      function askNavigate(url) {
        try { window.parent.postMessage({ type:'navigate', url: url }, '*'); } catch(e) {}
      }

      // anchor clicks
      document.addEventListener('click', function(e){
        let a = e.target;
        while(a && a.tagName !== 'A') a = a.parentElement;
        if (!a) return;
        const href = a.getAttribute('href');
        if (!href) return;
        // ignore hash-only and javascript:
        if (href.startsWith('#') || href.startsWith('javascript:')) return;
        e.preventDefault();
        askNavigate(abs(href));
      }, true);

      // forms
      document.addEventListener('submit', function(e){
        try {
          e.preventDefault();
          const f = e.target;
          let action = f.getAttribute('action') || location.href;
          action = abs(action);
          const m = (f.method||'get').toLowerCase();
          if (m === 'get') {
            const data = new FormData(f);
            const q = new URLSearchParams(data).toString();
            const url = action + (action.includes('?') ? '&' : '?') + q;
            askNavigate(url);
          } else {
            // For POST, create a temporary URL carrying the body as query string param '__post_data'
            // Client-proxy will perform a real POST if you implement it; for now send target and let backend try GET fallback.
            askNavigate(action);
          }
        } catch(err){}
      }, true);

      // history API interception
      (function(history){
        const push = history.pushState;
        const replace = history.replaceState;
        history.pushState = function(state, title, url) {
          if (url) {
            try { window.parent.postMessage({ type:'navigate', url: abs(url) }, '*'); } catch(e){}
          } else {
            push.apply(history, arguments);
          }
        };
        history.replaceState = function(state, title, url) {
          if (url) {
            try { window.parent.postMessage({ type:'navigate', url: abs(url) }, '*'); } catch(e){}
          } else {
            replace.apply(history, arguments);
          }
        };
      })(window.history);

      // override location changes
      const _assign = window.location.assign;
      const _replace = window.location.replace;
      window.location.assign = function(url){ try { window.parent.postMessage({ type:'navigate', url: abs(url) }, '*'); } catch(e){ _assign.call(window.location, url); } };
      window.location.replace = function(url){ try { window.parent.postMessage({ type:'navigate', url: abs(url) }, '*'); } catch(e){ _replace.call(window.location, url); } };

      // override window.open to route via proxy
      const _open = window.open;
      window.open = function(url, name, specs){ try { window.parent.postMessage({ type:'navigate', url: abs(url) }, '*'); return null; } catch(e){ return _open.apply(window, arguments); } };

      // Provide a small debug helper available inside page
      window.__roogle_proxy = { proxied: true };
    })();
  `;
  doc.head.prepend(navProtectScript);

  // rewrite anchors -> routed back to proxy (fallback)
  doc.querySelectorAll("a").forEach(a => {
    const href = a.getAttribute("href");
    if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
      const abs = new URL(href, baseURL).href;
      a.setAttribute("href", "#url=" + encodeURIComponent(abs));
      a.addEventListener("click", e => {
        e.preventDefault();
        loadProxiedSite(abs);
      });
    }
  });

  // intercept forms (double layer: for static form elements)
  doc.querySelectorAll("form").forEach(f => {
    f.addEventListener("submit", e => {
      e.preventDefault();
      const action = f.getAttribute("action") || baseURL;
      let abs = new URL(action, baseURL).href;
      const data = new FormData(f);
      const query = new URLSearchParams(data).toString();
      if (f.method?.toLowerCase() === "get") abs += (abs.includes("?") ? "&" : "?") + query;
      logDebug(`📝 Intercepted form → ${abs}`);
      loadProxiedSite(abs);
    });
  });

  // fix static asset paths
  doc.querySelectorAll("link, script, img, iframe, source").forEach(tag => {
    const attr = tag.tagName.toLowerCase() === "link" ? "href" : "src";
    const val = tag.getAttribute(attr);
    if (val && !/^https?:|^data:|^\/\//i.test(val)) {
      tag.setAttribute(attr, new URL(val, baseURL).href);
    }
  });

  logDebug("✅ HTML rewrite complete", "info");
  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

// ------------------ IFRAME HELPERS ------------------

function setIframeContent(html) {
  const doc = proxyIframe.contentDocument || proxyIframe.contentWindow.document;
  try {
    doc.open();
    doc.write(html);
    doc.close();
  } catch (e) {
    logDebug("Failed to write iframe document: " + e.message, "error");
    sendParent({ type: "clientProxy:backendError", info: "Write to iframe failed: " + e.message });
    return;
  }

  logDebug("🧩 Injected rewritten HTML into iframe");
  reinjectScripts(doc);
  attachDebugHooks(doc);

  // quick heuristic check for recaptcha/429 pages in injected HTML
  try {
    const bodyText = doc.body ? doc.body.innerText || "" : "";
    const test = bodyText.toLowerCase();
    if (test.includes("cloudflare worker received") || test.includes("rate-limiting") || test.includes("our systems have detected unusual traffic") || test.includes("captcha")) {
      logDebug("⚠️ Injected page looks like a captcha or rate-limit page", "warn");
      sendParent({ type: "clientProxy:backendError", info: bodyText.split("\n").slice(0,4).join(" ") });
    }
  } catch (e) {
    // likely cross-origin for some assets — ignore
  }

  // MutationObserver for dynamic sites (Google, YouTube)
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;

        // Handle new links
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

        // Handle new scripts
        node.querySelectorAll?.("script").forEach(oldScript => {
          if (oldScript.dataset.reinjected) return;
          const newScript = document.createElement("script");
          if (oldScript.src) {
            newScript.src = oldScript.src;
            newScript.async = false;
          } else {
            newScript.textContent = oldScript.textContent;
          }
          oldScript.dataset.reinjected = "true";
          oldScript.replaceWith(newScript);
        });
      }
    }
  });

  try {
    if (doc.body) observer.observe(doc.body, { childList: true, subtree: true });
    logDebug("👀 MutationObserver active for dynamic rewrites");
  } catch (e) {
    logDebug("⚠️ MutationObserver failed: " + e.message, "warn");
  }

  proxyIframe.onload = () => {
    logDebug("✅ Iframe load complete — hiding overlay", "info");
    // Notify the client-proxy.html to hide overlay
    window.postMessage({ type: "clientProxy:hideLoading" }, "*");
    // Also notify top-level parent to update its UI
    sendParent({ type: "clientProxy:iframeLoaded" });
  };

  // Fallback timeout (1 MINUTE) — hide overlay anyway so user can interact / see errors
  setTimeout(() => {
    logDebug("⌛ Forcing overlay hide after 60s fallback", "warn");
    window.postMessage({ type: "clientProxy:hideLoading" }, "*");
    sendParent({ type: "clientProxy:hideLoadingTimeout" });
  }, 60000);
}

function reinjectScripts(doc) {
  const scripts = Array.from(doc.querySelectorAll("script"));
  scripts.forEach(oldScript => {
    const newScript = document.createElement("script");
    if (oldScript.src) newScript.src = oldScript.src;
    else newScript.textContent = oldScript.textContent;
    oldScript.replaceWith(newScript);
  });
  logDebug(`🔁 Reinjected ${scripts.length} script(s)`);
}

function attachDebugHooks(doc) {
  const win = proxyIframe?.contentWindow;
  if (!win) return;
  // capture runtime errors inside iframe and forward them to parent
  win.addEventListener("error", e => {
    logDebug(`[iframe error] ${e.message} at ${e.filename}:${e.lineno}`, "error");
    sendParent({ type: "clientProxy:iframeError", message: e.message, filename: e.filename, lineno: e.lineno });
  });
  win.addEventListener("unhandledrejection", e => {
    logDebug(`[iframe rejection] ${e.reason}`, "error");
    sendParent({ type: "clientProxy:iframeRejection", reason: e.reason });
  });

  // Also listen to postMessage events coming from the page inside iframe
  // (for recaptcha worker we expect something like { recaptchaVerified: true/false, score, target })
  window.addEventListener("message", (ev) => {
    const d = ev.data || {};
    // recaptcha results
    if (typeof d.recaptchaVerified !== "undefined") {
      logDebug(`🔐 Recaptcha result received inside client-proxy: verified=${d.recaptchaVerified} score=${d.score}`, d.recaptchaVerified ? "info" : "warn");
      // Forward to top-level UI
      sendParent({ type: "recaptchaResult", payload: d });
      // Also notify client-proxy.html so it can hide overlay
      window.postMessage(d, "*");
      return;
    }

    // navigate request from injected page
    if (d && d.type === "navigate" && d.url) {
      logDebug(`↪️ Injected page requested navigation → ${d.url}`, "info");
      // attempt to load via our proxy rotation function
      loadProxiedSite(d.url);
      return;
    }
  });
}

// ------------------ LOADING ------------------

function showLoading(show = true) {
  // notify the wrapper to show/hide
  window.postMessage({ type: "clientProxy:showLoading" }, "*");
  sendParent({ type: "clientProxy:showLoading" });
}

function hideLoading() {
  window.postMessage({ type: "clientProxy:hideLoading" }, "*");
  sendParent({ type: "clientProxy:hideLoading" });
}

function startLoadTimer(url) {
  clearInterval(loadTimer);
  let elapsedLocal = 0;
  loadTimer = setInterval(() => {
    elapsedLocal += 1;
    if (elapsedLocal % 15 === 0) {
      logDebug(`⏳ Still loading ${url}... (${elapsedLocal}s elapsed)`, "warn");
      sendParent({ type: "clientProxy:updateLoading", message: `Still loading ${url}... (${elapsedLocal}s)` });
    } else {
      sendParent({ type: "clientProxy:updateLoading", message: `Loading ${url}` });
    }
  }, 1000);
}

// ------------------ PROXY CORE (Smart Rotation + Recaptcha Routing) ------------------

async function loadProxiedSite(url) {
  if (debugLogs) debugLogs.innerHTML = "";

  showLoading(true);
  logDebug(`🚀 Starting load: ${url}`);
  startLoadTimer(url);
  logDebug("🌀 Smart rotation system active");

  const backends = [
    "https://cloud1.uraverageopdoge.workers.dev",
    "https://cloud2.rageinhaler.workers.dev",
    "https://cloud3.rageinhaler.workers.dev/",
    "https://cloud1.rageinhaler.workers.dev/",
    "https://cloud2.uraverageopdoge.workers.dev/",
    "https://cloud3.kevinthejordan.workers.dev"
  ];

  // randomize order
  const shuffled = backends.sort(() => Math.random() - 0.5);
  let success = false;

  for (const backend of shuffled) {
    const targetURL = `${backend}/proxy?url=${encodeURIComponent(url)}`;
    logDebug(`🌐 Trying backend: ${backend}`);
    sendParent({ type: "clientProxy:attemptBackend", backend, target: url });

    try {
      const res = await fetch(targetURL);
      if (res.status === 429 || res.status === 403) {
        // Tell parent we hit rate limit — parent may choose different backend or route to recaptcha
        const info = `Backend ${backend} returned ${res.status}`;
        logDebug(`⚠️ ${info}`, "warn");
        sendParent({ type: "clientProxy:backendFail", backend, status: res.status, info });
        // if worker returned body (captcha/throttle page) inject into iframe so user can solve.
        try {
          const txt = await res.text();
          if (txt && txt.length > 0) {
            logDebug("Injecting backend returned page into iframe for user to act on (captcha/throttle page)");
            setIframeContent(txt);
            // stop the rotation — let user solve the recaptcha page inside the iframe
            success = true;
            break;
          }
        } catch (e) {
          logDebug("Failed to read backend body: " + e.message, "warn");
        }
        // continue to next backend
        continue;
      }

      if (!res.ok) {
        const err = `Fetch failed with status ${res.status}`;
        logDebug(`❌ ${err}`, "warn");
        sendParent({ type: "clientProxy:backendFail", backend, status: res.status, info: err });
        continue;
      }

      // success — read HTML and inject
      let html = await res.text();
      logDebug(`✅ ${backend} returned success`);
      sendParent({ type: "clientProxy:backendSuccess", backend, target: url });

      html = rewriteHTML(html, url);
      setIframeContent(html);
      logDebug(`🏁 Finished loading ${url}`);
      success = true;
      break;
    } catch (err) {
      logDebug(`❌ Backend ${backend} failed: ${err.message}`, "warn");
      sendParent({ type: "clientProxy:backendFail", backend, error: err.message });
    }
  }

  if (!success) {
    // Nothing worked — show a friendly error page inside the iframe
    const errHtml = `<div style="font-family:sans-serif;padding:24px;text-align:center;">
      <h3>⚠️ All Cloudflare backends failed.</h3>
      <p>Try again or switch workers.</p>
    </div>`;
    setIframeContent(errHtml);
    sendParent({ type: "clientProxy:allBackendsFailed" });
    logDebug("All proxy backends failed", "error");
  }

  clearInterval(loadTimer);
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
