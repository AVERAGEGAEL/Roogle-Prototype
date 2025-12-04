// -------------------- CONFIG / UI ELEMENTS --------------------
const iframe = document.getElementById("proxyIframe");
const iframeContainer = document.getElementById("iframe-container");
// REMOVED: const loadingSpinner... (We don't need it)
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

// --- UPDATED BACKEND LIST (CORRECTED) ---
const TRUSTED_RECAPTCHA_ORIGINS = [
  "https://cloud1.uraverageopdoge.workers.dev",
  "https://cloud2.rageinhaler.workers.dev",
  "https://cloud3.kevinthejordan.workers.dev",
  "https://cloud1.rageinhaler.workers.dev",
  "https://cloud2.uraverageopdoge.workers.dev",
  "https://cloud3.kevinthejordan.workers.dev",
  "https://cloud2.kevinthejordan.workers.dev"
];

// Note: This URL is used for fallback if specific worker logic isn't triggered
const BASE_WORKER_URL = "https://cloud1.uraverageopdoge.workers.dev/";

// -------------------- UTILITY FUNCTIONS --------------------

// REMOVED: function showSpinner(show) { ... } 

function topLog(message, level = "info") {
  if (enableDebugCheckbox && enableDebugCheckbox.checked) {
    const p = document.createElement("p");
    p.classList.add(level);
    p.textContent = message;
    debugLogs.prepend(p);
  }
}

function logDebug(message, level = "info") {
  if (enableDebugCheckbox && enableDebugCheckbox.checked) {
    const p = document.createElement("p");
    p.classList.add(level);
    p.textContent = message;
    debugLogs.prepend(p);
  }
}

function getBaseUrl(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    return u.hostname;
  } catch {
    return url;
  }
}

// FIX: Robust normalization to ensure https:// is always present
function normalizeUrl(url) {
  url = url.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  return url;
}

function isProxyRequired(url) {
  const normalizedUrl = getBaseUrl(url);

  // Check against sites explicitly listed as needing the client proxy (worker rotation)
  if (clientProxySites.some(site => normalizedUrl.includes(site))) {
    return true;
  }
  
  // Check against sites that are typically blocked or complex to proxy
  if (normalizedUrl.includes("discord.com") || normalizedUrl.includes("reddit.com")) {
      return true;
  }

  return false;
}

// Loads the URL using the Client Proxy Rotation (Slow but Reliable)
function loadClientProxy(url) {
  // Ensure URL is safe before loading
  const safeUrl = normalizeUrl(url);

  topLog(`Loading URL via Client Proxy: ${safeUrl}`);
  // REMOVED: showSpinner(true);
  searchBox.value = getBaseUrl(safeUrl);

  // CRITICAL FIX: Briefly reset src to force a reload. 
  iframe.src = "about:blank";
  
  setTimeout(() => {
     iframe.src = `./client-proxy.html#url=${encodeURIComponent(safeUrl)}`;
  }, 50);
}

// Loads the URL using a direct embed (Fast but potentially blocked)
function loadDirectEmbed(url) {
    const normalizedUrl = normalizeUrl(url);
    topLog(`Loading URL via Direct Embed: ${normalizedUrl}`, "warn");
    
    // Clear the current content and set the new src
    iframe.src = ''; 
    iframe.src = normalizedUrl;
    
    // REMOVED: showSpinner(false); 
    topLog("Direct embed attempted. Check console for X-Frame-Options or CSP blocks.", "warn");
}

function loadUrl(url) {
  if (!url) return;
  const safeUrl = normalizeUrl(url);
  
  if (isProxyRequired(safeUrl)) {
    loadClientProxy(safeUrl);
  } else {
    // If we have a single fallback worker and the site isn't special, try that first
    if (iframeFallback && !safeUrl.includes(BASE_WORKER_URL)) {
      loadClientProxy(`${BASE_WORKER_URL}?url=${encodeURIComponent(safeUrl)}`);
    } else {
      loadClientProxy(safeUrl);
    }
  }
}


// -------------------- EVENT LISTENERS --------------------

// Form submission handler
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const rawUrl = searchBox.value.trim();
  
  if (rawUrl) {
    // FIX: Normalize the input (add https:// if missing)
    const url = normalizeUrl(rawUrl);

    if (isProxyRequired(url)) {
      loadClientProxy(url);
    } else {
      loadClientProxy(url);
    }
  }
});

// Fullscreen button
fullscreenBtn.addEventListener("click", () => {
  if (iframeContainer.requestFullscreen) {
    iframeContainer.requestFullscreen();
  } else if (iframeContainer.webkitRequestFullscreen) { /* Safari */
    iframeContainer.webkitRequestFullscreen();
  } else if (iframeContainer.msRequestFullscreen) { /* IE11 */
    iframeContainer.msRequestFullscreen();
  }
});

// Sidebar open/close
hamburgerBtn.addEventListener("click", () => {
  sidebar.classList.add("sidebar-open");
});

closeSidebarBtn.addEventListener("click", () => {
  sidebar.classList.remove("sidebar-open");
});

// -------------------- QUICK LINK LISTENERS (UPDATED) --------------------

btnGoogle.addEventListener("click", () => {
  // FAST DIRECT EMBED with IGU=1 to bypass frame blocks
  loadDirectEmbed("https://www.google.com/webhp?igu=1");
});

btnHaha.addEventListener("click", () => {
  // FAST DIRECT EMBED
  loadDirectEmbed("https://www.hahagames.com");
});

// -------------------- MESSAGE LISTENER --------------------
window.addEventListener("message", (ev) => {
  const d = ev.data || {};

  // Ignore non-Roogle messages
  if (!d.type.startsWith("clientProxy:") && d.type !== "navigate" && d.type !== "debugLog") {
    return;
  }

  // Handle messages related to the proxy load process
  if (d.type === "clientProxy:backendTest") return topLog(`Testing backend ${d.backend} → ${d.target}`);
  if (d.type === "clientProxy:backendSuccess") return topLog(`Backend success: ${d.backend}`);
  if (d.type === "clientProxy:backendFail") return topLog(`Backend fail: ${d.backend} — ${d.info || d.error || d.status}`, "warn");
  if (d.type === "clientProxy:backendError" || d.type === "backendError") {
    topLog(`Backend returned HTML error/captcha: ${d.info || d.payload || 'unknown'}`, "warn");
    // REMOVED: showSpinner(false);
    return;
  }
  if (d.type === "clientProxy:iframeLoaded") {
    topLog("Iframe reports loaded");
    // REMOVED: showSpinner(false);
    return;
  }
  
  // Dismiss spinner when proxy says it's ready
  if (d.type === "clientProxy:hideLoading" || d.type === "loadingDismissed") {
    // REMOVED: showSpinner(false);
    topLog("Overlay hidden");
    return;
  }

  // ---------- Navigation command from iframe ----------
  if (d && d.type === "navigate" && d.url) {
    topLog(`Navigation requested by proxied page → ${d.url}`);
    loadClientProxy(d.url); 
    return;
  }

  // ---------- Default debug forwarding ----------
  if (d?.type === "debugLog") {
    logDebug(d.message, d.level);
  }
});

// -------------------- INIT --------------------
// Initial check for URL in the hash
if (window.location.hash) {
  const p = new URLSearchParams(window.location.hash.slice(1));
  const url = p.get("url");
  if (url) {
    loadUrl(url);
  }
}
