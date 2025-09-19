const proxyIframe = document.getElementById("proxyIframe");
const debugLogs = document.getElementById("debugLogs");

// ------------------ UTILS ------------------

function getTargetURL() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("url");
}

// Log message to debug panel
function logDebug(message, type = "info") {
  if (!debugLogs) return;
  const li = document.createElement("li");
  li.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  li.style.color =
    type === "error" ? "red" :
    type === "warn" ? "orange" : "black";
  debugLogs.appendChild(li);
  debugLogs.scrollTop = debugLogs.scrollHeight;
  console.log(message);
}

// ------------------ REWRITERS ------------------

function rewriteHTML(html, baseURL) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Rewrite <a> tags
  doc.querySelectorAll("a").forEach(a => {
    const href = a.getAttribute("href");
    if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
      const abs = new URL(href, baseURL).href;
      a.setAttribute("href", "#" + "url=" + encodeURIComponent(abs));
      a.addEventListener("click", e => {
        e.preventDefault();
        loadProxiedSite(abs);
      });
    }
  });

  // Rewrite forms
  doc.querySelectorAll("form").forEach(f => {
    f.addEventListener("submit", e => {
      e.preventDefault();
      const action = f.getAttribute("action") || baseURL;
      let abs = new URL(action, baseURL).href;

      const data = new FormData(f);
      const query = new URLSearchParams(data).toString();

      if (f.method.toLowerCase() === "get") {
        abs += (abs.includes("?") ? "&" : "?") + query;
      }

      logDebug(`Form submit intercepted → ${abs}`);
      loadProxiedSite(abs);
    });
  });

  // Rewrite assets (link/script/img)
  doc.querySelectorAll("link, script, img").forEach(tag => {
    const attr = tag.tagName.toLowerCase() === "link" ? "href" : "src";
    const val = tag.getAttribute(attr);
    if (val && !val.startsWith("http") && !val.startsWith("data:")) {
      tag.setAttribute(attr, new URL(val, baseURL).href);
    }
  });

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

// ------------------ IFRAME HELPERS ------------------

function setIframeContent(html) {
  const doc = proxyIframe.contentDocument || proxyIframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  reinjectScripts(doc);
  attachDebugHooks();
}

function reinjectScripts(doc) {
  const scripts = doc.querySelectorAll("script");
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

// Attach debug listeners inside iframe
function attachDebugHooks() {
  const win = proxyIframe.contentWindow;
  if (!win) return;

  // Forward console logs
  ["log", "warn", "error"].forEach(level => {
    const orig = win.console[level];
    win.console[level] = (...args) => {
      logDebug(`[iframe ${level}] ${args.join(" ")}`, level === "warn" ? "warn" : (level === "error" ? "error" : "info"));
      orig.apply(win.console, args);
    };
  });

  // Catch runtime errors
  win.addEventListener("error", e => {
    logDebug(`[iframe error] ${e.message} at ${e.filename}:${e.lineno}`, "error");
  });

  // Catch unhandled promise rejections
  win.addEventListener("unhandledrejection", e => {
    logDebug(`[iframe rejection] ${e.reason}`, "error");
  });

  logDebug("Debug hooks attached to iframe");
}

// ------------------ LOADING ------------------

function showLoading(show = true) {
  if (show) {
    setIframeContent("<p style='font-family: sans-serif;'>🔄 Loading...</p>");
  }
}

async function loadProxiedSite(url) {
  showLoading(true);
  logDebug(`Starting load: ${url}`);

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
      return;
    } catch (err) {
      logDebug(`Attempt ${i + 1} failed: ${err.message}`, "warn");
      if (i === proxies.length - 1) {
        setIframeContent(`<p style="color:red;">⚠️ Error loading URL: ${err.message}</p>`);
        logDebug(`All fetch attempts failed`, "error");
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
