// -------------------- CLIENT-PROXY.JS --------------------
const contentDiv = document.getElementById("content");

// Hardcoded build timestamp (updates only when you change it in GitHub)
const buildTimestamp = "September 12, 2025 at 2:30 PM";

// Show last updated (if element exists)
document.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("last-updated");
  if (el) el.textContent = buildTimestamp;
});

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
      const abs = new URL(action, baseURL).href;

      const data = new FormData(f);
      const query = new URLSearchParams(data).toString();

      let fullURL = abs;
      if (f.method.toLowerCase() === "get") {
        fullURL += (abs.includes("?") ? "&" : "?") + query;
      }

      loadProxiedSite(fullURL);
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

// Load site inside proxy
async function loadProxiedSite(url) {
  contentDiv.innerHTML = "🔄 Loading...";
  window.location.hash = "url=" + encodeURIComponent(url);

  try {
    // Pick CORS proxy (allorigins is fallback)
    const proxy = "https://corsproxy.io/?" + encodeURIComponent(url);
    const res = await fetch(proxy);
    if (!res.ok) throw new Error("Fetch failed with status " + res.status);

    let html = await res.text();
    html = rewriteHTML(html, url);

    contentDiv.innerHTML = html;
  } catch (err) {
    contentDiv.innerHTML = `⚠️ Error loading URL: ${err.message}`;
    console.error(err);
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
