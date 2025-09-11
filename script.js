// -------------------- CONFIG --------------------
const iframe = document.getElementById("proxyIframe");
const iframeContainer = document.getElementById("iframe-container");
const loadingSpinner = document.getElementById("loadingSpinner");
const searchBox = document.getElementById("url");
const form = document.getElementById("proxyForm");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const lastUpdatedElement = document.getElementById("last-updated");

// Headless backend URL (Render)
const headlessBackend = 'https://roogle-v3-backend.onrender.com/?url=';

// Lightweight iframe fallback URL (optional if you have a Worker)
const iframeFallback = ''; // You can fill with your existing Cloudflare UV if needed

// Sites that require headless browser
const headlessSites = ["google.com","youtube.com","poki.com","retrogames.cc","coolmathgames.com"];

// -------------------- UTILS --------------------
function isValidURL(str) {
  try {
    const url = new URL(str.startsWith("http") ? str : "https://" + str);
    return url.hostname.includes(".") && !url.hostname.includes(" ");
  } catch {
    return false;
  }
}

function needsHeadless(url) {
  return headlessSites.some(site => new URL(url).hostname.includes(site));
}

function showSpinner(show = true) {
  loadingSpinner.style.display = show ? "block" : "none";
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

  let proxyUrl = needsHeadless(urlInput)
    ? headlessBackend + encodeURIComponent(urlInput)
    : (iframeFallback ? iframeFallback + encodeURIComponent(urlInput) : urlInput);

  iframe.src = proxyUrl;

  // Handle iframe load errors (automatic fallback)
  iframe.onload = () => showSpinner(false);
  iframe.onerror = () => {
    showSpinner(false);
    if (!needsHeadless(urlInput) && headlessBackend) {
      // fallback to headless if iframe fails
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
    document.documentElement.requestFullscreen().catch(err => {
      alert(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
});
