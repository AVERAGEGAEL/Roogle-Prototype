// -------------------- CONFIG --------------------
const iframe = document.getElementById("proxyIframe");
const iframeContainer = document.getElementById("iframe-container");
const loadingSpinner = document.getElementById("loadingSpinner");
const searchBox = document.getElementById("url");
const form = document.getElementById("proxyForm");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const lastUpdatedElement = document.getElementById("last-updated");
const debugLogs = document.getElementById("debugLogs");

// Headless backend URL
const headlessBackend = 'https://roogle-v3-backend.onrender.com/?url=';
// Lightweight iframe fallback URL
const iframeFallback = '';
// Sites that require special handling
const clientProxySites = ["google.com", "youtube.com"];
const headlessSites = ["poki.com","retrogames.cc","coolmathgames.com"];

// -------------------- UTILS --------------------
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

function needsHeadless(url) {
  return headlessSites.some(site => new URL(url).hostname.includes(site));
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

// -------------------- MAIN --------------------
document.addEventListener("DOMContentLoaded", () => {
  lastUpdatedElement.textContent = `${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`;
});

// Handle form submission
form.addEventListener("submit", async (e) => {
  e.preventDefault();
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

  let proxyUrl = needsHeadless(urlInput)
    ? headlessBackend + encodeURIComponent(urlInput)
    : (iframeFallback ? iframeFallback + encodeURIComponent(urlInput) : urlInput);

  iframe.src = proxyUrl;

  iframe.onload = () => showSpinner(false);
  iframe.onerror = () => {
    showSpinner(false);
    if (!needsHeadless(urlInput) && headlessBackend) {
      iframe.src = headlessBackend + encodeURIComponent(urlInput);
      showSpinner(true);
    } else {
      alert("Unable to load the site fully. Try opening in a normal browser.");
    }
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

// -------------------- MESSAGE HANDLER --------------------
// Forward debug logs from client-proxy iframe
window.addEventListener("message", (event) => {
  if (event.data?.type === "debugLog") {
    logDebug(event.data.message, event.data.level);
  }
});
