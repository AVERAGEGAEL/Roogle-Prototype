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

  console.log(message);

  try {
    window.parent.postMessage({ type: "debugLog", message, level: type }, "*");
  } catch (e) {
    console.warn("Failed to postMessage log:", e);
  }
}

// ------------------ REWRITERS ------------------

function rewriteHTML(html, baseURL) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

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

  doc.querySelectorAll("link, script, img").forEach(tag => {
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
  const doc = proxyIframe
    ? proxyIframe.contentDocument || proxyIframe.contentWindow.document
    : document;

  doc.open();
  doc.write(html);
  doc.close();
  logDebug("Content injected into iframe");

  reinjectScripts(doc);
  attachDebugHooks();
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
  const win = proxyIframe ? proxyIframe.contentWindow : window;
  if (!win) return;

  ["log", "warn", "error"].forEach(level => {
    const orig = win.console[level];
    win.console[level] = (...args) => {
      logDebug(`[iframe ${level}] ${args.join(" ")}`,
        level === "warn" ? "warn" : (level === "error" ? "error" : "info"));
      orig.apply(win.console, args);
    };
  });

  win.addEventListener("error", e => {
    logDebug(`[iframe error] ${e.message} at ${e.filename}:${e.lineno}`, "error");
  });

  win.addEventListener("unhandledrejection", e => {
    logDebug(`[iframe rejection] ${e.reason}`, "error");
  });

  logDebug("Debug hooks attached to iframe");
}

// ------------------ LOADING ------------------

function showLoading(show = true) {
  const msg = document.getElementById("loadingMessage");
  const spinner = document.getElementById("loadingSpinner");
  if (msg && spinner) {
    msg.textContent = "🔄 Loading site... (0s)";
    spinner.style.display = show ? "block" : "none";
  }
}

function startLoadTimer(url) {
  clearInterval(loadTimer);
  let elapsed = 0;
  loadTimer = setInterval(() => {
    elapsed += 5;
    if (elapsed === 15) {
      logDebug(`⏳ Still loading ${url}... (15s elapsed)`, "warn");
    }
    if (elapsed === 30) {
      logDebug(`⚠️ Load taking too long (30s). You may retry.`, "error");
      clearInterval(loadTimer);
    }
  }, 5000);
}

async function loadProxiedSite(url) {
  // 🔹 Clear debug logs for each new load
  if (debugLogs) debugLogs.innerHTML = "";

  showLoading(true);
  logDebug(`Starting load: ${url}`);
  startLoadTimer(url);

  const proxies = [
    "https://api.allorigins.win/raw?url=",
    "https://corsproxy.io/?",
    null
  ];

  for (let i = 0; i < proxies.length; i++) {
    const targetURL = proxies[i] ? proxies[i] + encodeURIComponent(url) : url;
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
      if (i === proxies.length - 1) {
        setIframeContent(`<p style="color:red;">⚠️ Error loading URL: ${err.message}</p>`);
        logDebug(`All fetch attempts failed`, "error");
        clearInterval(loadTimer);
      }
    }
  }
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
