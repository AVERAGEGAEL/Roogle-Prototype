// -------------------- CONFIG / UI ELEMENTS --------------------
const iframe = document.getElementById("proxyIframe");
const iframeContainer = document.getElementById("iframe-container");
const searchBox = document.getElementById("url");
const form = document.getElementById("proxyForm");
const fullscreenBtn = document.getElementById("fullscreen-btn");

const hamburger = document.getElementById("hamburger");
const sidebar = document.getElementById("sidebar");
const closeSidebar = document.getElementById("closeSidebar");
const btnGoogle = document.getElementById("btn-google");
const btnHahagames = document.getElementById("btn-hahagames");
const enableDebug = document.getElementById("enableDebug");
const sidebarLogs = document.getElementById("sidebarLogs");

// -------------------- SITE BEHAVIOR CONFIG --------------------
const iframeFallback = ""; // not used now, we route through client-proxy by default
const clientProxySites = ["google.com", "youtube.com"];
const blockedSites = ["poki.com", "retrogames.cc", "coolmathgames.com"];

// Trusted origins for reCAPTCHA messages (exact matches)
const TRUSTED_RECAPTCHA_ORIGINS = [
  "https://recaptcha.uraverageopdoge.workers.dev",
  "https://cloud1.uraverageopdoge.workers.dev",
  "https://cloud2.rageinhaler.workers.dev",
  "https://cloud3.kevinthejordan.workers.dev",
  "https://cloud1.rageinhaler.workers.dev",
  "https://cloud2.uraverageopdoge.workers.dev",
  "https://cloud3.kevinthejordan.workers.dev",
];

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

function appendSidebarLog(message, level = "info") {
  if (!sidebarLogs) return;
  const p = document.createElement("div");
  p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  p.style.color = level === "error" ? "red" : level === "warn" ? "orange" : "black";
  p.style.padding = "4px 0";
  sidebarLogs.appendChild(p);
  sidebarLogs.scrollTop = sidebarLogs.scrollHeight;
}

// unified log — respects debug toggle
function logDebug(message, type = "info") {
  console.log(message);
  if (enableDebug && enableDebug.checked) {
    appendSidebarLog(message, type);
  }
}

// -------------------- SIDEBAR TOGGLING --------------------
function openSidebar() {
  sidebar.classList.add("sidebar-open");
  sidebar.classList.remove("sidebar-closed");
  sidebar.setAttribute("aria-hidden", "false");
}
function closeSidebarFn() {
  sidebar.classList.remove("sidebar-open");
  sidebar.classList.add("sidebar-closed");
  sidebar.setAttribute("aria-hidden", "true");
}
hamburger.addEventListener("click", openSidebar);
closeSidebar.addEventListener("click", closeSidebarFn);

// -------------------- QUICK LINKS --------------------
btnGoogle.addEventListener("click", () => {
  // Load Google directly in top iframe (bypass client-proxy)
  const url = "https://www.google.com/webhp?igu=1";
  logDebug("Quick link: Google → " + url);
  iframe.src = url;
});
btnHahagames.addEventListener("click", () => {
  const url = "https://www.hahagames.com";
  logDebug("Quick link: Hahagames → " + url);
  iframe.src = url;
});

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

  // blocked sites
  if (needsBlockedHandling(urlInput)) {
    alert("This site cannot be proxied reliably.");
    return;
  }

  // If site is in clientProxySites (google, youtube), use client-proxy loader.
  if (needsClientProxy(urlInput)) {
    logDebug("Routing to client-proxy.html → " + urlInput);
    iframe.src = "client-proxy.html#url=" + encodeURIComponent(urlInput);
    return;
  }

  // For other sites: load via client-proxy as unified behavior (ensures XFO/CSP bypass)
  logDebug("Routing to client-proxy.html for: " + urlInput);
  iframe.src = "client-proxy.html#url=" + encodeURIComponent(urlInput);
});

// -------------------- FULLSCREEN --------------------
fullscreenBtn.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    iframe.requestFullscreen().catch(err => alert(`Error enabling fullscreen: ${err.message}`));
  } else {
    document.exitFullscreen();
  }
});

// -------------------- MESSAGE HANDLER (recaptcha + client-proxy) --------------------
window.addEventListener("message", (event) => {
  const origin = event.origin || "";
  const d = event.data || {};

  // Structured logs from client-proxy (forwarded)
  if (d.type === "clientProxy:log") {
    const e = d.payload || {};
    logDebug(`${e.ts} ${e.level.toUpperCase()}: ${e.message}`, e.level === "error" ? "error" : "info");
    return;
  }

  if (d.type === "clientProxy:attemptBackend") {
    logDebug(`Attempting backend ${d.backend} → ${d.target}`);
    return;
  }
  if (d.type === "clientProxy:backendSuccess") {
    logDebug(`Backend success: ${d.backend}`);
    return;
  }
  if (d.type === "clientProxy:backendFail") {
    logDebug(`Backend fail: ${d.backend} — ${d.info || d.error || d.status}`, "warn");
    return;
  }
  if (d.type === "clientProxy:backendError") {
    logDebug(`Backend returned HTML error/captcha: ${d.info || d.payload || 'unknown'}`, "warn");
    return;
  }
  if (d.type === "clientProxy:iframeLoaded") {
    logDebug("Iframe reports loaded");
    return;
  }
  if (d.type === "clientProxy:hideLoading" || d.type === "loadingDismissed") {
    logDebug("Overlay hidden");
    return;
  }

  // reCAPTCHA result from trusted worker: { recaptchaVerified, score, target }
  if (typeof d.recaptchaVerified !== "undefined") {
    // Strict origin check
    if (!TRUSTED_RECAPTCHA_ORIGINS.includes(origin)) {
      logDebug(`Rejected reCAPTCHA message from untrusted origin: ${origin}`, "warn");
      return;
    }
    logDebug(`reCAPTCHA result — verified: ${d.recaptchaVerified} score: ${d.score}`);
    if (d.recaptchaVerified) {
      if (d.target) {
        logDebug("reCAPTCHA success → reloading proxied site: " + d.target);
        iframe.src = "client-proxy.html#url=" + encodeURIComponent(d.target);
      } else {
        logDebug("reCAPTCHA succeeded but missing target URL", "warn");
      }
    } else {
      logDebug("reCAPTCHA failed — showing error to user", "warn");
      iframe.srcdoc = `<div style="font-family:sans-serif;padding:40px;text-align:center;">
        <h2>Verification failed</h2>
        <p>Human verification failed or low trust score. Try again.</p>
      </div>`;
    }
    return;
  }
});