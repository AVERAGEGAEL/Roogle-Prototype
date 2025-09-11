// Client-side proxy renderer

async function loadProxiedSite() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const target = params.get("url");
  if (!target) {
    document.getElementById("content").innerText = "❌ No URL provided";
    return;
  }

  try {
    const res = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(target));
    if (!res.ok) throw new Error("Fetch failed");

    let html = await res.text();

    // Basic rewrite: make relative links absolute
    html = html.replace(/(href|src)=["'](\/[^"']*)["']/g, (match, attr, path) => {
      return `${attr}="${new URL(path, target).href}"`;
    });

    // Inject into #content
    document.getElementById("content").innerHTML = html;

    // Rewire <a> tags so they reload through proxy
    document.querySelectorAll("a").forEach(a => {
      a.addEventListener("click", e => {
        e.preventDefault();
        const href = a.href;
        if (href) {
          window.location.hash = "url=" + encodeURIComponent(href);
          loadProxiedSite();
        }
      });
    });

  } catch (err) {
    document.getElementById("content").innerText = "⚠️ Error: " + err.message;
  }
}

window.addEventListener("load", loadProxiedSite);
