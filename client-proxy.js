// ------------------ GLOBALS ------------------

const proxyIframe = document.getElementById("proxyIframe");
const debugLogs = document.getElementById("debugLogs");
let loadTimer = null;

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

// ------------------ REWRITERS ------------------

function rewriteHTML(html, baseURL) {
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

  // rewrite anchors -> routed back to proxy
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

  // intercept forms
  doc.querySelectorAll("form").forEach(f => {
    f.addEventListener("submit", e => {
      e.preventDefault();
      const action = f.getAttribute("action") || baseURL;
      let abs = new URL(action, baseURL).href;
      const data = new FormData(f);
      const query = new URLSearchParams(data).toString();
      if (f.method?.toLowerCase() === "get") abs += (abs.includes("?") ? "&" : "?") + query;
      logDebug(`Form submit intercepted → ${abs}`);
      loadProxiedSite(abs);
    });
  });

  // fix static asset relative paths
  doc.querySelectorAll("link, script, img, iframe, source").forEach(tag => {
    const attr = tag.tagName.toLowerCase() === "link" ? "href" : "src";
    const val = tag.getAttribute(attr);
    if (val && !/^https?:|^data:|^\/\//i.test(val)) {
      tag.setAttribute(attr, new URL(val, baseURL).href);
    }
  });

  logDebug("HTML rewrite complete");
  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

// ------------------ IFRAME HELPERS ------------------

function setIframeContent(html) {
  const doc = proxyIframe.contentDocument || proxyIframe.contentWindow.document;

  doc.open();
  doc.write(html);
  doc.close();
  logDebug("Content injected into iframe");

  reinjectScripts(doc);
  attachDebugHooks(doc);

  // MutationObserver: handle dynamic <a> and <script> additions
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;

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

        // new scripts — reinject safely (mark originals to avoid loops)
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

  // watch body (if present)
  try {
    if (doc.body) observer.observe(doc.body, { childList: true, subtree: true });
    logDebug("MutationObserver active for dynamic rewrites");
  } catch (e) {
    logDebug("MutationObserver failed to start: " + e.message, "warn");
  }

  // load events
  proxyIframe.onload = () => {
    logDebug("✅ Iframe load complete — hiding overlay");
    hideLoading();
  };

  // fallback hide (60s)
  setTimeout(() => {
    logDebug("⌛ Forcing overlay hide after 60s fallback");
    hideLoading();
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
  logDebug(`Reinjected ${scripts.length} script(s)`);
}

// Prevent iframe console pollution and capture runtime errors
function attachDebugHooks(doc) {
  const win = proxyIframe?.contentWindow;
  if (!win) return;

  // silence iframe console
  ["log", "warn", "error"].forEach(level => (win.console[level] = () => {}));

  win.addEventListener("error", e => {
    logDebug(`[iframe error] ${e.message}`, "error");
  });

  win.addEventListener("unhandledrejection", e => {
    logDebug(`[iframe rejection] ${e.reason}`, "error");
  });
}

// ------------------ LOADING ------------------

function showLoading(show = true) {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.style.display = show ? "flex" : "none";
}

function hideLoading() {
  showLoading(false);
}

function startLoadTimer(url) {
  clearInterval(loadTimer);
  let elapsed = 0;
  loadTimer = setInterval(() => {
    elapsed += 5;
    if (elapsed % 15 === 0)
      logDebug(`⏳ Still loading ${url}... (${elapsed}s elapsed)`, "warn");
  }, 5000);
}

// ------------------ PROXY CORE ------------------

async function loadProxiedSite(url) {
  if (debugLogs) debugLogs.innerHTML = "";

  showLoading(true);
  logDebug(`Starting load: ${url}`);
  startLoadTimer(url);

  const sources = [
    { label: "Direct (ServiceWorker)", url: `/proxy?url=${encodeURIComponent(url)}` },
    { label: "Mirror (corsproxy.io)", url: `https://corsproxy.io/?${encodeURIComponent(url)}` }
  ];

  for (let i = 0; i < sources.length; i++) {
    const { label, url: targetURL } = sources[i];
    logDebug(`Attempt ${i + 1} via ${label}: ${targetURL}`);

    try {
      const res = await fetch(targetURL);
      if (!res.ok) throw new Error("Fetch failed with status " + res.status);
      logDebug(`✅ Success using ${label}`);

      let html = await res.text();
      html = rewriteHTML(html, url);
      setIframeContent(html);
      logDebug(`Finished loading: ${url}`);

      clearInterval(loadTimer);
      return;
    } catch (err) {
      logDebug(`Attempt ${i + 1} (${label}) failed: ${err.message}`, "warn");
      if (i === sources.length - 1) {
        setIframeContent(`<p style="color:red;">⚠️ Error loading: ${err.message}</p>`);
        logDebug("All proxy attempts failed", "error");
        clearInterval(loadTimer);
      }
    }
  }
}

// ------------------ SERVICE WORKER REG ------------------

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw-proxy.js")
    .then(() => logDebug("✅ Service Worker registered"))
    .catch(err => logDebug("⚠️ SW registration failed: " + err.message, "error"));
}

// ------------------ INIT ------------------

window.addEventListener("load", () => {
  const target = getTargetURL();
  if (target) loadProxiedSite(target);
});

window.addEventListener("hashchange", () => {
  const target = getTargetURL();
  if (target) loadProxiedSite(target);
});
