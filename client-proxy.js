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
  logDebug("🔧 Starting HTML rewrite...");
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const csp = doc.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *;";
  doc.head.prepend(csp);

  const base = doc.createElement("base");
  base.href = baseURL;
  doc.head.prepend(base);

  // rewrite links
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
      logDebug(`📝 Intercepted form → ${abs}`);
      loadProxiedSite(abs);
    });
  });

  // fix relative paths
  doc.querySelectorAll("link, script, img, iframe, source").forEach(tag => {
    const attr = tag.tagName.toLowerCase() === "link" ? "href" : "src";
    const val = tag.getAttribute(attr);
    if (val && !/^https?:|^data:|^\/\//i.test(val)) {
      tag.setAttribute(attr, new URL(val, baseURL).href);
    }
  });

  logDebug("✅ HTML rewrite complete");
  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

// ------------------ IFRAME HANDLING ------------------

function setIframeContent(html) {
  const doc = proxyIframe.contentDocument || proxyIframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  logDebug("🧩 Injected rewritten HTML into iframe");
  reinjectScripts(doc);
  attachDebugHooks(doc);

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;

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
    logDebug("✅ Iframe load complete — hiding overlay");
    hideLoading();
  };

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
  logDebug(`🔁 Reinjected ${scripts.length} script(s)`);
}

function attachDebugHooks(doc) {
  const win = proxyIframe?.contentWindow;
  if (!win) return;
  win.addEventListener("error", e => logDebug(`[iframe error] ${e.message}`, "error"));
  win.addEventListener("unhandledrejection", e => logDebug(`[iframe rejection] ${e.reason}`, "error"));
}

// ------------------ LOAD HANDLING ------------------

function showLoading(show = true) {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.style.display = show ? "flex" : "none";
}
function hideLoading() { showLoading(false); }

function startLoadTimer(url) {
  clearInterval(loadTimer);
  let elapsed = 0;
  loadTimer = setInterval(() => {
    elapsed += 5;
    if (elapsed % 15 === 0) logDebug(`⏳ Still loading ${url}... (${elapsed}s elapsed)`, "warn");
  }, 5000);
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
    "https://cloud3.kevinthejordan.workers.dev"
  ];

  const captchaWorker = "https://captcha.uraverageopdoge.workers.dev";

  const shuffled = backends.sort(() => Math.random() - 0.5);
  let success = false;

  for (const backend of shuffled) {
    const targetURL = `${backend}/proxy?url=${encodeURIComponent(url)}`;
    logDebug(`🌐 Trying backend: ${backend}`);
    try {
      const res = await fetch(targetURL);
      if (res.status === 403 || res.status === 429) {
        logDebug(`⚠️ ${backend} returned ${res.status}, switching to Recaptcha Worker`, "warn");
        await routeToRecaptcha(url, captchaWorker);
        success = true;
        break;
      }
      if (!res.ok) throw new Error("Fetch failed with status " + res.status);

      let html = await res.text();
      logDebug(`✅ ${backend} returned success`);
      html = rewriteHTML(html, url);
      setIframeContent(html);
      logDebug(`🏁 Finished loading ${url}`);
      success = true;
      break;
    } catch (err) {
      logDebug(`❌ Backend ${backend} failed: ${err.message}`, "warn");
    }
  }

  if (!success) {
    setIframeContent(`<p style="color:red;">⚠️ All Cloudflare backends failed — site unreachable.</p>`);
    logDebug("All proxy backends failed", "error");
  }

  clearInterval(loadTimer);
}

async function routeToRecaptcha(url, worker) {
  logDebug(`🔒 Sending to Recaptcha Worker: ${worker}`);
  try {
    const res = await fetch(`${worker}?url=${encodeURIComponent(url)}`);
    const html = await res.text();
    setIframeContent(html);
    logDebug("✅ Recaptcha worker handled request successfully");
  } catch (err) {
    logDebug("❌ Recaptcha worker failed: " + err.message, "error");
  }
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