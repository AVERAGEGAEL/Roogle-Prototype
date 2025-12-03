// ------------------ GLOBALS ------------------
const inner = document.getElementById("innerProxyFrame");
const overlay = document.getElementById("loadingOverlay");
let target = null;

// ------------------ HELPERS ------------------
function getURL() {
  const p = new URLSearchParams(location.hash.slice(1));
  return p.get("url");
}

function sendParent(msg) { 
  try { parent.postMessage(msg, "*"); } catch {} 
}

function log(msg, level="info") {
  sendParent({
    type: "clientProxy:log",
    payload: { ts: new Date().toLocaleTimeString(), level, message: msg }
  });
  console.log("[client-proxy]", msg);
}

function showOverlay() {
  if (overlay) overlay.classList.remove("hidden");
  sendParent({ type: "clientProxy:showLoading" });
}

function hideOverlay() {
  if (overlay) overlay.classList.add("hidden");
  sendParent({ type: "clientProxy:hideLoading" });
}

// ------------------ BACKEND ROTATION (The Engine) ------------------
async function loadViaBackend(url) {
  target = url;
  showOverlay();
  log("Starting proxy engine for: " + url);

  // UPDATED: The real list provided by you
  const backends = [
    "https://cloud1.uraverageopdoge.workers.dev",
    "https://cloud2.rageinhaler.workers.dev",
    "https://cloud3.kevinthejordan.workers.dev",
    "https://cloud1.rageinhaler.workers.dev",
    "https://cloud2.uraverageopdoge.workers.dev",
    "https://cloud3.kevinthejordan.workers.dev",
    "https://cloud2.kevinthejordan.workers.dev/"
  ];

  for (const backend of backends) {
    // Construct the proxy URL. 
    // Format: backend_url + "?url=" + encoded_target
    const proxyUrl = `${backend}?url=${encodeURIComponent(target)}`;
    
    sendParent({ type: "clientProxy:backendTest", backend, target });

    const success = await tryLoad(proxyUrl, backend);
    if (success) {
      log("Successfully loaded via: " + backend);
      sendParent({ type: "clientProxy:backendSuccess", backend });
      return; 
    } else {
      sendParent({ type: "clientProxy:backendFail", backend });
    }
  }

  // If we reach here, all backends failed
  log("All backends failed.", "error");
  sendParent({ type: "clientProxy:backendError", info: "All proxies failed." });
  alert("Could not connect to any proxy server. Please try again later.");
  hideOverlay();
}

function tryLoad(fullUrl, backendLabel) {
  return new Promise((resolve) => {
    let settled = false;
    
    // Set a timeout for each backend (6 seconds)
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        log("Timeout on " + backendLabel, "warn");
        resolve(false); 
      }
    }, 6000);

    // Set the source
    inner.src = fullUrl;

    // Listen for success
    inner.onload = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        hideOverlay();
        resolve(true);
      }
    };

    // Listen for immediate errors
    inner.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(false);
      }
    };
  });
}

// ------------------ INIT ------------------
window.addEventListener("load", () => {
  const url = getURL();
  if (url) {
    loadViaBackend(url);
  } else {
    log("No URL specified in hash");
    hideOverlay();
  }
});

// ------------------ MESSAGE LISTENER ------------------
window.addEventListener("message", (ev) => {
  const d = ev.data || {};
  
  if (d.type === "navigate" && d.url) {
    // Reset and try loading the new URL via rotation
    loadViaBackend(d.url);
  }
});
