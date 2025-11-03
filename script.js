// -------------------- CONFIG / UI ELEMENTS --------------------
const iframe = document.getElementById("proxyIframe");
const iframeContainer = document.getElementById("iframe-container");
const loadingSpinner = document.getElementById("loadingSpinner");
const searchBox = document.getElementById("url");
const form = document.getElementById("proxyForm");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const debugLogs = document.getElementById("debugLogs");

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

function showSpinner(show = true) {
  loadingSpinner.style.display = show ? "block" : "none";
}

// --- unified log system ---
function logDebug(message, type = "info") {
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

  if (needsClientProxy(urlInput)) {
    loadClientProxy(urlInput);
    return;
  }

  if (needsBlockedHandling(urlInput)) {
    alert("This site cannot be proxied reliably.");
    showSpinner(false);
    return;
  }

  const proxyUrl = iframeFallback ? iframeFallback + encodeURIComponent(urlInput) : urlInput;
  iframe.src = proxyUrl;

  iframe.onload = () => showSpinner(false);
  iframe.onerror = () => {
    showSpinner(false);
    alert("Unable to load the site fully. Try opening in a normal browser.");
  };
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
  iframe.src = "client-proxy.html#url=" + encodeURIComponent(url);
  iframe.onload = () => showSpinner(false);
}

// -------------------- MESSAGE HANDLER (recaptcha + client-proxy) --------------------
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

  // ---------- reCAPTCHA result ----------
  if (d.type === "recaptchaResult" || d.recaptchaVerified !== undefined) {
    const payload = d.payload || d;
    // Basic origin check; allow if in TRUSTED_RECAPTCHA_ORIGINS
    if (TRUSTED_RECAPTCHA_ORIGINS.length && !TRUSTED_RECAPTCHA_ORIGINS.some(o => origin.startsWith(o))) {
      topLog(`Rejected reCAPTCHA message from untrusted origin: ${origin}`, "warn");
      return;
    }

    topLog(`reCAPTCHA result — verified: ${payload.recaptchaVerified} score: ${payload.score}`);
    if (payload.recaptchaVerified) {
      const target = payload.target;
      if (target) {
        topLog("reCAPTCHA success → reloading proxied site: " + target);
        iframe.src = "client-proxy.html#url=" + encodeURIComponent(target);
      } else {
        topLog("reCAPTCHA succeeded but missing target URL", "warn");
      }
      showSpinner(false);
    } else {
      topLog("reCAPTCHA failed — showing error to user", "warn");
      iframe.srcdoc = `<div style="font-family:sans-serif;padding:40px;text-align:center;">
        <h2>Verification failed</h2>
        <p>Human verification failed or low trust score. Try again.</p>
      </div>`;
      showSpinner(false);
    }
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
      iframe.src = target;
    }
  }
});
