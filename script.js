// -------------------- CONFIG / UI ELEMENTS --------------------
const iframe = document.getElementById("proxyIframe");
const iframeContainer = document.getElementById("iframe-container");
const loadingSpinner = document.getElementById("loadingSpinner");
const searchBox = document.getElementById("url");
const form = document.getElementById("proxyForm");
const fullscreenBtn = document.getElementById("fullscreen-btn");

// Fix: index.html calls this "sidebarLogs", not "debugLogs"
const debugLogs = document.getElementById("sidebarLogs"); 

// --- NEW: SIDEBAR ELEMENTS ---
const sidebar = document.getElementById("sidebar");
const hamburgerBtn = document.getElementById("hamburger");
const closeSidebarBtn = document.getElementById("closeSidebar");
const btnGoogle = document.getElementById("btn-google");
const btnHaha = document.getElementById("btn-hahagames");
const enableDebugCheckbox = document.getElementById("enableDebug");

// -------------------- SITE BEHAVIOR CONFIG --------------------
const iframeFallback = "";
const clientProxySites = ["google.com", "youtube.com"];
const blockedSites = ["poki.com", "retrogames.cc", "coolmathgames.com"];
const TRUSTED_RECAPTCHA_ORIGINS = [
  "https://recaptcha.uraverageopdoge.workers.dev",
  "https://cloud1.uraverageopdoge.workers.dev",
  "https://cloud2.rageinhaler.workers.dev",
  "https://cloud3.kevinthejordan.workers.dev",
  "https://cloud1.rageinhaler.workers.dev",
  "https://cloud2.uraverageopdoge.workers.dev",
  "https://cloud3.kevinthejordan.workers.dev",
  "https://cloud2.kevinthejordan.workers.dev/",
];

// -------------------- SIDEBAR & UI LOGIC --------------------

// 1. Toggle Sidebar Open
if (hamburgerBtn) {
  hamburgerBtn.addEventListener("click", () => {
    sidebar.classList.add("sidebar-open");
    sidebar.setAttribute("aria-hidden", "false");
  });
}

// 2. Close Sidebar
if (closeSidebarBtn) {
  closeSidebarBtn.addEventListener("click", () => {
    sidebar.classList.remove("sidebar-open");
    sidebar.setAttribute("aria-hidden", "true");
  });
}

// 3. Quick Links
if (btnGoogle) {
  btnGoogle.addEventListener("click", () => {
    searchBox.value = "google.com";
    form.dispatchEvent(new Event("submit")); // Trigger the search
    sidebar.classList.remove("sidebar-open"); // Close menu
  });
}

if (btnHaha) {
  btnHaha.addEventListener("click", () => {
    searchBox.value = "hahagames.com";
    form.dispatchEvent(new Event("submit"));
    sidebar.classList.remove("sidebar-open");
  });
}

// 4. Toggle Debug Logs
if (enableDebugCheckbox) {
  enableDebugCheckbox.addEventListener("change", (e) => {
    if (debugLogs) {
      debugLogs.style.display = e.target.checked ? "block" : "none";
    }
  });
}

// -------------------- HELPERS --------------------
function isValidURL(str) {
  try {
    const url = new URL(str.startsWith("http") ? str : "https://" + str);
    return url.hostname.includes(".");
  } catch {
    return false;
  }
}

function needsClientProxy(url) {
  return clientProxySites.some(site => new URL(url).hostname.includes(site));
}

function needsBlockedHandling(url) {
  return blockedSites.some(site => new URL(url).hostname.includes(site));
}

function showSpinner(show = true) {
  loadingSpinner.style.display = show ? "block" : "none";
}

// --- unified log system ---
function logDebug(message, type = "info") {
  // Only log if the element exists
  if (!debugLogs) {
    console.log(message);
    return;
  }
  
  const p = document.createElement("p");
  p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  p.style.color = type === "error" ? "red" : type === "warn" ? "orange" : "black";
  
  debugLogs.appendChild(p);
  debugLogs.scrollTop = debugLogs.scrollHeight;
  console.log(message);
}
const topLog = logDebug; // alias for backward compatibility

// -------------------- MAIN HANDLER --------------------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  e.stopPropagation();

  let urlInput = searchBox.value.trim();
  if (!urlInput) return alert("Please enter a URL.");
  if (!isValidURL(urlInput)) return alert("Invalid URL. Use example.com or https://example.com.");

  if (!urlInput.startsWith("http://") && !urlInput.startsWith("https://")) {
    urlInput = "https://" + urlInput;
  }

  iframeContainer.style.display = "block";
  showSpinner(true);

  // Use client-proxy.html for sites that need proxying (special handling)
  if (needsClientProxy(urlInput)) {
    loadClientProxy(urlInput);
    return;
  }

  if (needsBlockedHandling(urlInput)) {
    alert("This site cannot be proxied reliably.");
    showSpinner(false);
    return;
  }

  // For everything else, route through client-proxy as well (keeps behavior consistent)
  // If you want direct iframe bypass for certain sites add them to a whitelist and set iframe.src directly.
  loadClientProxy(urlInput);
});

// -------------------- FULLSCREEN --------------------
fullscreenBtn.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    iframe.requestFullscreen().catch(err => {
      alert(`Error enabling fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
});

// -------------------- CLIENT PROXY LOADING --------------------
function loadClientProxy(url) {
  showSpinner(true);
  // Use client-proxy.html which itself loads the backend worker in an inner iframe
  iframe.src = "client-proxy.html#url=" + encodeURIComponent(url);
  iframe.onload = () => showSpinner(false);
}

// -------------------- MESSAGE HANDLER (client-proxy) --------------------
window.addEventListener("message", (event) => {
  const origin = event.origin || "";
  const d = event.data || {};

  // ---------- Structured logs from client-proxy ----------
  if (d.type === "clientProxy:log") {
    const e = d.payload || {};
    topLog(`${e.ts} ${e.level.toUpperCase()}: ${e.message}`, e.level === "error" ? "error" : "info");
    return;
  }

  if (d.type === "clientProxy:attemptBackend") return topLog(`Attempting backend ${d.backend} → ${d.target}`);
  if (d.type === "clientProxy:backendSuccess") return topLog(`Backend success: ${d.backend}`);
  if (d.type === "clientProxy:backendFail") return topLog(`Backend fail: ${d.backend} — ${d.info || d.error || d.status}`, "warn");
  if (d.type === "clientProxy:backendError" || d.type === "backendError") {
    topLog(`Backend returned HTML error/captcha: ${d.info || d.payload || 'unknown'}`, "warn");
    showSpinner(false);
    return;
  }
  if (d.type === "clientProxy:iframeLoaded") {
    topLog("Iframe reports loaded");
    showSpinner(false);
    return;
  }
  if (d.type === "clientProxy:hideLoading" || d.type === "loadingDismissed") {
    showSpinner(false);
    topLog("Overlay hidden");
    return;
  }

  // ---------- Navigation command from iframe (if inner page posts a 'navigate' message) ----------
  if (d && d.type === "navigate" && d.url) {
    topLog(`Navigation requested by proxied page → ${d.url}`);
    // route through client-proxy
    loadClientProxy(d.url);
    return;
  }

  // ---------- Default debug forwarding ----------
  if (d?.type === "debugLog") {
    logDebug(d.message, d.level);
  }
});

// -------------------- INIT --------------------
window.addEventListener("load", () => {
  const target = (new URLSearchParams(window.location.hash.replace(/^#/, ""))).get("url");
  if (target) {
    logDebug("Auto-loading URL from hash: " + target);
    if (clientProxySites.some(s => new URL(target).hostname.includes(s))) {
      loadClientProxy(target);
    } else {
      loadClientProxy(target);
    }
  }
});
