// -------------------- CONFIG / UI ELEMENTS --------------------
const iframe = document.getElementById("proxyIframe");
const iframeContainer = document.getElementById("iframe-container");
const loadingSpinner = document.getElementById("loadingSpinner");
const searchBox = document.getElementById("url");
const form = document.getElementById("proxyForm");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const debugLogs = document.getElementById("debugLogs");

// -------------------- SITE BEHAVIOR CONFIG --------------------
const clientProxySites = ["google.com", "youtube.com"];
const blockedSites = ["poki.com", "retrogames.cc", "coolmathgames.com"];
const TRUSTED_RECAPTCHA_ORIGINS = [
  "https://recaptcha.uraverageopdoge.workers.dev",
  "https://cloud1.uraverageopdoge.workers.dev",
  "https://cloud2.rageinhaler.workers.dev",
  "https://cloud3.kevinthejordan.workers.dev",
  "https://cloud1.rageinhaler.workers.dev",
  "https://cloud2.uraverageopdoge.workers.dev",
  "https://cloud3.kevinthejordan.workers.dev"
];

// -------------------- HELPERS --------------------
function isValidURL(str) {
  try {
    const u = new URL(str.startsWith("http") ? str : "https://" + str);
    return u.hostname.includes(".");
  } catch { return false; }
}

function needsClientProxy(url) {
  return clientProxySites.some(x => new URL(url).hostname.includes(x));
}

function needsBlockedHandling(url) {
  return blockedSites.some(x => new URL(url).hostname.includes(x));
}

function showSpinner() { loadingSpinner.style.display = "block"; }
function hideSpinner() { loadingSpinner.style.display = "none"; }

function log(message, type="info") {
  const li = document.createElement("li");
  li.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  li.style.color = type === "error" ? "red" : type === "warn" ? "orange" : "black";
  debugLogs.appendChild(li);
  debugLogs.scrollTop = debugLogs.scrollHeight;
  console.log(message);
}

// -------------------- FORM HANDLER --------------------
form.addEventListener("submit", e => {
  e.preventDefault();
  e.stopPropagation();

  let url = searchBox.value.trim();
  if (!url) return alert("Enter a URL");
  if (!isValidURL(url)) return alert("Invalid URL");

  if (!url.startsWith("http")) url = "https://" + url;

  iframeContainer.style.display = "block";
  showSpinner();

  // special sites → client proxy
  if (needsClientProxy(url)) {
    log("Routing to client-proxy.html");
    iframe.src = "client-proxy.html#url=" + encodeURIComponent(url);
    return;
  }

  // blocked sites
  if (needsBlockedHandling(url)) {
    hideSpinner();
    return alert("This site cannot be proxied reliably.");
  }

  // normal iframe load
  iframe.src = url;
  iframe.onload = () => hideSpinner();
  iframe.onerror = () => {
    hideSpinner();
    alert("The site cannot load in iframe.");
  };
});

// -------------------- FULLSCREEN --------------------
fullscreenBtn.addEventListener("click", () => {
  if (!document.fullscreenElement) iframe.requestFullscreen().catch(()=>{});
  else document.exitFullscreen();
});

// -------------------- MESSAGES FROM client-proxy --------------------
window.addEventListener("message", event => {
  const origin = event.origin || "";
  const d = event.data || {};

  // structured logs
  if (d.type === "clientProxy:log") {
    const m = d.payload;
    log(`${m.ts} ${m.level.toUpperCase()}: ${m.message}`);
    return;
  }

  if (d.type === "clientProxy:attemptBackend") return log(`Attempting backend ${d.backend}`);
  if (d.type === "clientProxy:backendSuccess") {
    log(`Backend success: ${d.backend}`);
    hideSpinner();
    return;
  }
  if (d.type === "clientProxy:backendFail") return log(`Backend fail: ${d.backend}`, "warn");

  if (d.type === "clientProxy:hideLoading") {
    hideSpinner();
    log("Overlay hidden");
    return;
  }

  // recaptcha result
  if (d.type === "recaptchaResult" || d.recaptchaVerified !== undefined) {
    const payload = d.payload || d;

    // require safe origin
    if (!TRUSTED_RECAPTCHA_ORIGINS.some(o => origin.startsWith(o))) {
      log("Rejected recaptcha origin: " + origin, "warn");
      return;
    }

    log(`Recaptcha → verified=${payload.recaptchaVerified} score=${payload.score}`);

    if (payload.recaptchaVerified) {
      iframe.src = "client-proxy.html#url=" + encodeURIComponent(payload.target);
    } else {
      iframe.srcdoc = `
        <h2>Verification failed</h2>
        <p>Try again.</p>`;
    }

    hideSpinner();
    return;
  }

  // navigation from injected page
  if (d.type === "navigate" && d.url) {
    log("Navigation requested: " + d.url);
    iframe.src = "client-proxy.html#url=" + encodeURIComponent(d.url);
  }
});

// -------------------- INIT (load from hash) --------------------
window.addEventListener("load", () => {
  const target = new URLSearchParams(location.hash.slice(1)).get("url");
  if (target) {
    log("Auto-load: " + target);
    iframe.src = "client-proxy.html#url=" + encodeURIComponent(target);
  }
});
