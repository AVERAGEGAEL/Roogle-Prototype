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

  try {
    window.parent.postMessage({ type: "debugLog", message, level: type }, "*");
  } catch {}
}

// ------------------ REWRITERS ------------------

function rewriteHTML(html, baseURL) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Inject <base> to fix relative paths (important for Google)
  const base = doc.createElement("base");
  base.href = baseURL;
  doc.head.prepend(base);

  // Fix <a> elements
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

  // Fix forms
  doc.querySelectorAll("form").forEach(f => {
    f.addEventListener("submit", e => {
      e.preventDefault();
      const action = f.getAttribute("action") || baseURL;
      let abs = new URL(action, baseURL).href;

      const data = new FormData(f);
      const query = new URLSearchParams(data).toString();

      if (f.method?.toLowerCase() === "get") {
        abs += (abs.includes("?") ? "&" : "?") + query;
      }

      logDebug(`Form submit intercepted → ${abs}`);
      loadProxiedSite(abs);
    });
  });

  // Fix static assets
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
  attachDebugHooks();

  // Detect when iframe finishes loading
  proxyIframe.onload = () => {
    logDebug("✅ Iframe load complete — hiding overlay");
    hideLoading();
  };

  // Add fallback listener
  proxyIframe.addEventListener("load", () => {
    hideLoading();
  });
}

function reinjectScripts(doc) {
  const scripts = Array.from(doc.querySelectorAll("script"));
  scripts.forEach(oldScript => {
    const newScript = document.createElement("script");
    if (oldScript.src) {
      newScript.src = oldScript.src;
      newScript.async = false;
    } else {
      newScript.textContent = oldScript.textContent;
    }
    oldScript.replaceWith(newScript);
  });
  logDebug(`Reinjected ${scripts.length} script(s)`);
}

function attachDebugHooks() {
  const win = proxyIframe?.contentWindow;
  if (!win) return;

  // Prevent iframe console spam entirely
  ["log", "warn", "error"].forEach(level => {
    win.console[level] = () => {}; // Disable iframe logs completely
  });

  win.addEventListener("error", e => {
    logDebug(`[iframe error] ${e.message} at ${e.filename}:${e.lineno}`, "error");
  });

  win.addEventListener("DOMContentLoaded", () => {
    logDebug("✅ DOMContentLoaded detected — hiding overlay");
    hideLoading();
  });

  // Fallback: hide overlay after timeout
  setTimeout(() => {
    logDebug("⌛ Forcing overlay hide after 10s fallback");
    hideLoading();
  }, 10000);
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
    if (elapsed === 15) logDebug(`⏳ Still loading ${url}... (15s elapsed)`, "warn");
    if (elapsed === 30) {
      logDebug(`⚠️ Load taking too long (30s).`, "error");
      clearInterval(loadTimer);
    }
  }, 5000);
}

// ------------------ PROXY CORE ------------------

async function loadProxiedSite(url) {
  if (debugLogs) debugLogs.innerHTML = "";

  showLoading(true);
  logDebug(`Starting load: ${url}`);
  startLoadTimer(url);

  const sources = [
    `/proxy?url=${encodeURIComponent(url)}`, // local Service Worker proxy
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
    "https://corsproxy.io/?" + encodeURIComponent(url)
  ];

  for (let i = 0; i < sources.length; i++) {
    const targetURL = sources[i];
    logDebug(`Attempt ${i + 1}: ${targetURL}`);

    try {
      const res = await fetch(targetURL);
      if (!res.ok) throw new Error("Fetch failed with status " + res.status);
      logDebug(`Fetch success (attempt ${i + 1})`);

      let html = await res.text();
      html = rewriteHTML(html, url);
      setIframeContent(html);
      logDebug(`Finished loading: ${url}`);

      clearInterval(loadTimer);
      return;
    } catch (err) {
      logDebug(`Attempt ${i + 1} failed: ${err.message}`, "warn");
      if (i === sources.length - 1) {
        setIframeContent(`<p style="color:red;">⚠️ Error loading: ${err.message}</p>`);
        logDebug("All fetch attempts failed", "error");
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
