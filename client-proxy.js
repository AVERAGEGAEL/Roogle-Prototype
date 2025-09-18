const proxyIframe = document.getElementById("proxyIframe");
const debugLogs = document.getElementById("debugLogs");

// Utility: parse URL from hash
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

// Rewrite HTML: fix links, forms, assets
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

  // Rewrite assets
  doc.querySelectorAll("link, script, img").forEach(tag => {
    const attr = tag.tagName.toLowerCase() === "link" ? "href" : "src";
    const val = tag.getAttribute(attr);
    if (val && !val.startsWith("http") && !val.startsWith("data:")) {
      tag.setAttribute(attr, new URL(val, baseURL).href);
    }
  });

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

// Inject HTML into iframe
function setIframeContent(html) {
  const doc = proxyIframe.contentDocument || proxyIframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
}

// Show loading spinner
function showLoading(show = true) {
  if (show) {
    setIframeContent("<p style='font-family: sans-serif;'>🔄 Loading...</p>");
  }
}

// Load site inside proxy
async function loadProxiedSite(url) {
  showLoading(true);
  logDebug(`Starting load: ${url}`);

  const proxies = [
    null, // direct fetch
    "https://api.allorigins.win/raw?url=",
    "https://corsproxy.io/?"
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

// Initial load
window.addEventListener("load", () => {
  const target = getTargetURL();
  if (target) loadProxiedSite(target);
});

// Handle hash change
window.addEventListener("hashchange", () => {
  const target = getTargetURL();
  if (target) loadProxiedSite(target);
});
