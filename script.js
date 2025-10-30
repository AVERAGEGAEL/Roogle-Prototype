// -------------------- CONFIG / UI ELEMENTS --------------------
const iframe = document.getElementById("proxyIframe");
const iframeContainer = document.getElementById("iframe-container");
const loadingSpinner = document.getElementById("loadingSpinner");
const searchBox = document.getElementById("url");
const form = document.getElementById("proxyForm");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const debugLogs = document.getElementById("debugLogs");

// Lightweight iframe fallback URL
const iframeFallback = '';
// Sites that require special handling
const clientProxySites = ["google.com", "youtube.com"];
const blockedSites = ["poki.com", "retrogames.cc", "coolmathgames.com"];

// Trusted origins that can send recaptcha messages (extend if needed)
const TRUSTED_RECAPTCHA_ORIGINS = [
  "https://recaptcha.uraverageopdoge.workers.dev",
  "https://cloud1.uraverageopdoge.workers.dev",
  "https://cloud2.rageinhaler.workers.dev",
  "https://cloud3.kevinthejordan.workers.dev",
  // add any other trusted worker domains you use
];

// -------------------- UTILITIES --------------------
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

function logDebug(message, type = "info") {
  if (!debugLogs) return;
  const p = document.createElement("p");
  p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  p.style.color = type === "error" ? "red" : type === "warn" ? "orange" : "black";
  debugLogs.appendChild(p);
  debugLogs.scrollTop = debugLogs.scrollHeight;
  console.log(message);
}

// -------------------- MAIN (form handling) --------------------
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

  let proxyUrl = iframeFallback ? iframeFallback + encodeURIComponent(urlInput) : urlInput;
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
      alert(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
});

// -------------------- CLIENT PROXY HANDLER --------------------
function loadClientProxy(url) {
  showSpinner(true);
  iframe.src = "client-proxy.html#url=" + encodeURIComponent(url);
  iframe.onload = () => showSpinner(false);
}

// -------------------- MESSAGE HANDLER (including recaptcha) --------------------
// Forward debugLog messages from client-proxy iframe are already handled below.
// This adds recaptcha handling: when a trusted origin posts { recaptchaVerified: true, target: <url> }
// we reload the client-proxy for that URL.
window.addEventListener("message", (event) => {
  const origin = event.origin || "";
  const data = event.data || {};

  // Debug messages forwarding (existing)
  if (data?.type === "debugLog") {
    logDebug(data.message, data.level);
    return;
  }

  // Only accept recaptcha messages from trusted origins
  if (data?.recaptchaVerified !== undefined) {
    // optional origin check: relax if you want to accept from anywhere
    if (TRUSTED_RECAPTCHA_ORIGINS.length && !TRUSTED_RECAPTCHA_ORIGINS.some(o => origin.startsWith(o))) {
      logDebug(`Rejected recaptcha message from untrusted origin: ${origin}`, "warn");
      return;
    }

    if (data.recaptchaVerified) {
      logDebug(`✅ reCAPTCHA verified (score=${data.score ?? "n/a"}) — reloading proxy for ${data.target || "current"} `);
      // If target provided, reopen client-proxy for that URL; otherwise reload iframe
      if (data.target) {
        // small delay so everything settles
        setTimeout(() => loadClientProxy(data.target), 200);
      } else {
        // fallback: just reload whatever is in the iframe
        try { iframe.contentWindow.location.reload(); } catch (e) { iframe.src = iframe.src; }
      }
    } else {
      logDebug("❌ reCAPTCHA verification failed — presenting error to user", "error");
      // Replace iframe with an error message or call a helper to show a page
      iframe.srcdoc = `<div style="font-family:sans-serif;padding:40px;text-align:center;">
        <h2>Verification failed</h2>
        <p>reCAPTCHA verification failed or low trust score. Try again.</p>
      </div>`;
      showSpinner(false);
    }
    return;
  }

  // any other messages: ignore or log
});

// -------------------- INIT --------------------
window.addEventListener("load", () => {
  const target = (new URLSearchParams(window.location.hash.replace(/^#/, ""))).get("url");
  // if this page is opened as top-level with a url in hash, we optionally start loading immediately
  if (target) {
    logDebug("Auto-loading URL from hash: " + target);
    // choose correct loader depending on site; reuse earlier logic
    if (clientProxySites.some(s => new URL(target).hostname.includes(s))) {
      loadClientProxy(target);
    } else {
      iframe.src = target;
    }
  }
});
