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
    type:"clientProxy:log",
    payload:{ ts:new Date().toLocaleTimeString(), level, message:msg }
  });
  console.log("[client-proxy]", msg);
}

function showOverlay() {
  overlay.style.display = "flex";
  overlay.style.opacity = "1";
  // notify parent UI to show its overlay too
  sendParent({ type: "clientProxy:showLoading" });
}

function hideOverlay() {
  overlay.style.opacity = "0";
  setTimeout(() => overlay.style.display = "none", 250);
  sendParent({ type:"clientProxy:hideLoading" });
}

// ------------------ BACKEND ROTATION ------------------
async function loadViaBackend(url) {
  target = url;
  showOverlay();
  log("Loading via backend iframe: " + url);

  const backends = [
    "https://cloud1.uraverageopdoge.workers.dev",
    "https://cloud2.rageinhaler.workers.dev",
    "https://cloud3.rageinhaler.workers.dev",
    "https://cloud1.rageinhaler.workers.dev",
    "https://cloud2.uraverageopdoge.workers.dev",
    "https://cloud3.kevinthejordan.workers.dev"
  ];

  const list = backends.sort(() => Math.random() - 0.5);

  for (const backend of list) {
    const proxyURL = `${backend}/proxy?url=${encodeURIComponent(url)}`;
    log("Trying backend: " + backend);
    sendParent({ type:"clientProxy:attemptBackend", backend, target:url });

    inner.src = proxyURL;

    const ok = await waitForLoad(backend);
    if (ok) return;
  }

  inner.srcdoc = `<div style="font-family:sans-serif;padding:24px;text-align:center;">
    <h3>⚠️ All backend workers failed.</h3>
    <p>Try again or switch workers.</p>
  </div>`;
  sendParent({ type:"clientProxy:allBackendsFailed" });
  hideOverlay();
}

// ------------------ WAIT FOR IFRAME LOAD ------------------
function waitForLoad(backend) {
  return new Promise(resolve => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        log("Backend timeout: " + backend, "warn");
        sendParent({ type:"clientProxy:backendFail", backend, error:"timeout" });
        resolve(false);   // timeout => failure
      }
    }, 8000);

    inner.onload = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        log("Backend successful: " + backend);
        sendParent({ type:"clientProxy:backendSuccess", backend });
        hideOverlay();
        resolve(true);
      }
    };

    inner.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        log("Backend failed (onerror): " + backend, "warn");
        sendParent({ type:"clientProxy:backendFail", backend, error:"onerror" });
        resolve(false);
      }
    };
  });
}

// ------------------ MESSAGE PASSING ------------------
// Forward messages from inner iframe to parent index (preserve previous structure)
// We do not handle reCAPTCHA here anymore; that logic removed.
window.addEventListener("message", (ev) => {
  const d = ev.data || {};
  // Forward any structured logs or events up to the parent (index)
  // Example: { type:'navigate', url: '...' } or debug messages
  if (d && (d.type || d.recaptchaVerified !== undefined)) {
    // forward unchanged (parent will decide what to do)
    sendParent(d);
  }
});

// ------------------ INIT ------------------
window.addEventListener("load", () => {
  const url = getURL();
  if (url) loadViaBackend(url);
});
