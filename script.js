// -------------------- CONFIG --------------------
const iframe = document.getElementById("proxyIframe");
const iframeContainer = document.getElementById("iframe-container");
const loadingSpinner = document.getElementById("loadingSpinner");
const searchBox = document.getElementById("url");
const form = document.getElementById("proxyForm");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const debugLogs = document.getElementById("debugLogs");

const TRUSTED_RECAPTCHA_ORIGINS = [
  "https://recaptcha.uraverageopdoge.workers.dev",
  "https://cloud1.uraverageopdoge.workers.dev",
  "https://cloud2.rageinhaler.workers.dev",
  "https://cloud3.kevinthejordan.workers.dev",
  "https://cloud1.rageinhaler.workers.dev",
  "https://cloud2.uraverageopdoge.workers.dev",
  "https://cloud2.kevinthejordan.workers.dev",
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

function showSpinner(show = true) {
  loadingSpinner.style.display = show ? "block" : "none";
}

function logDebug(msg, type="info") {
  const li = document.createElement("li");
  li.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  li.style.color = type === "error" ? "red" : type === "warn" ? "orange" : "black";
  debugLogs.appendChild(li);
  debugLogs.scrollTop = debugLogs.scrollHeight;
  console.log(msg);
}

const topLog = logDebug;

// -------------------- MAIN FORM --------------------
form.addEventListener("submit", (e) => {
  e.preventDefault();

  let url = searchBox.value.trim();
  if (!isValidURL(url)) return alert("Invalid URL");

  if (!url.startsWith("http")) url = "https://" + url;

  iframeContainer.style.display = "block";
  showSpinner(true);

  // ✅ ALL sites use client-proxy.html
  topLog("Routing to client-proxy.html → " + url);
  iframe.src = "client-proxy.html#url=" + encodeURIComponent(url);
});

// -------------------- FULLSCREEN --------------------
fullscreenBtn.addEventListener("click", () => {
  if (!document.fullscreenElement) iframe.requestFullscreen();
  else document.exitFullscreen();
});

// -------------------- MESSAGE HANDLER --------------------
window.addEventListener("message", (event) => {
  const origin = event.origin || "";
  const d = event.data || {};

  if (d.type === "clientProxy:log") {
    const e = d.payload || {};
    topLog(`${e.ts} ${e.level.toUpperCase()}: ${e.message}`);
    return;
  }

  if (d.type === "clientProxy:attemptBackend") {
    topLog(`Trying backend: ${d.backend} → ${d.target}`);
    return;
  }

  if (d.type === "clientProxy:backendSuccess") {
    topLog(`Backend success: ${d.backend}`);
    showSpinner(false);
    return;
  }

  if (d.type === "clientProxy:backendFail") {
    topLog(`Backend fail: ${d.backend}`, "warn");
    return;
  }

  if (d.type === "clientProxy:hideLoading") {
    showSpinner(false);
    topLog("Overlay hidden");
    return;
  }

  if (d.type === "backendError") {
    topLog(`Backend returned error page`, "warn");
    showSpinner(false);
    return;
  }

  if (d.type === "recaptchaResult") {
    if (!TRUSTED_RECAPTCHA_ORIGINS.includes(origin)) {
      topLog(`Rejected recaptcha message from ${origin}`, "warn");
      return;
    }
    topLog(`Recaptcha verified=${d.payload.recaptchaVerified}`);
    showSpinner(false);
  }
});

// -------------------- INIT AUTOLOAD --------------------
window.addEventListener("load", () => {
  const target = new URLSearchParams(location.hash.slice(1)).get("url");
  if (target) {
    topLog("Auto-loading: " + target);
    iframe.src = "client-proxy.html#url=" + encodeURIComponent(target);
  }
});
