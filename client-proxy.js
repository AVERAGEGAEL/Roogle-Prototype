// -------------------- CLIENT-PROXY.JS --------------------
const contentDiv = document.getElementById("content");

// Utility: parse URL from hash
function getTargetURL() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("url");
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

  // Rewrite forms (so Google search works)
  doc.querySelectorAll("form").forEach(f => {
    f.addEventListener("submit", e => {
      e.preventDefault();
      const action = f.getAttribute("action") || baseURL;
      let abs = new URL(action, baseURL).href;

      const data = new FormData(f);
      const query = new URLSearchParams(data).toString();

      // Special handling for Google search
      if (abs.includes("google.")) {
        abs += (abs.includes("?") ? "&" : "?") + query;
      } else if (f.method.toLowerCase() === "get") {
        abs += (abs.includes("?") ? "&" : "?") + query;
      }

      loadProxiedSite(abs);
    });
  });

  // Rewrite assets (CSS, JS, images)
  doc.querySelectorAll("link, script, img").forEach(tag => {
    const attr = tag.tagName.toLowerCase() === "link" ? "href" : "src";
    const val = tag.getAttribute(attr);
    if (val && !val.startsWith("http") && !val.startsWith("data:")) {
      tag.setAttribute(attr, new URL(val, baseURL).href);
    }
  });

  return doc.documentElement.innerHTML;
}

// Re-inject <script> tags to execute JS
function reinjectScripts(container) {
  container.querySelectorAll("script").forEach(oldScript => {
    const newScript = document.createElement("script");
    if (oldScript.src) {
      newScript.src = oldScript.src;
      newScript.async = false; // preserve order
    } else {
      newScript.textContent = oldScript.textContent;
    }
    oldScript.replaceWith(newScript);
  });
}

// Show loading spinner
function showLoading(show = true) {
  contentDiv.innerHTML = show ? "🔄 Loading..." : "";
}

// Load site inside proxy
async function loadProxiedSite(url) {
  showLoading(true);
  window.location.hash = "url=" + encodeURIComponent(url);

  try {
    // Direct fetch (uses computer IP)
    const res = await fetch(url, { method: "GET", mode: "cors" });
    if (!res.ok) throw new Error("Fetch failed with status " + res.status);

    let html = await res.text();
    html = rewriteHTML(html, url);

    contentDiv.innerHTML = html;
    reinjectScripts(contentDiv);
    showLoading(false);
  } catch (err) {
    // Fallback: use CORS proxy if direct fetch fails
    try {
      const proxy = "https://corsproxy.io/?" + encodeURIComponent(url);
      const res2 = await fetch(proxy);
      if (!res2.ok) throw new Error("Proxy fetch failed with status " + res2.status);
      let html = await res2.text();
      html = rewriteHTML(html, url);
      contentDiv.innerHTML = html;
      reinjectScripts(contentDiv);
    } catch (err2) {
      contentDiv.innerHTML = `⚠️ Error loading URL: ${err.message}`;
      console.error(err, err2);
    }
  }
}

// Initial load
window.addEventListener("load", () => {
  const target = getTargetURL();
  if (target) loadProxiedSite(target);
});

// Handle hash change (back/forward buttons)
window.addEventListener("hashchange", () => {
  const target = getTargetURL();
  if (target) loadProxiedSite(target);
});
