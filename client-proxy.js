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

function log(msg, level = "info") {
  sendParent({
    type: "clientProxy:log",
    payload: { ts: new Date().toLocaleTimeString(), level, message: msg }
  });
  console.log("[client-proxy]", msg);
}

function showOverlay() {
  if (!overlay) return;
  overlay.style.display = "flex";
  overlay.style.opacity = "1";
}

// ✅ **MAIN FIX — overlay must be REMOVED, not faded**
function hideOverlay() {
  if (!overlay) return;

  overlay.style.opacity = "0";

  // remove from layout so it cannot block clicks
  setTimeout(() => {
    overlay.style.display = "none";
  }, 150);

  sendParent({ type: "clientProxy:hideLoading" });
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
    sendParent({ type: "clientProxy:attemptBackend", backend, target: url });

    inner.src = proxyURL;

    const ok = await waitForLoad(backend);
    if (ok) return;
  }

  inner.srcdoc = `<h2 style="font-family:sans-serif;text-align:center;padding:20px;">All workers failed</h2>`;
  sendParent({ type: "clientProxy:allBackendsFailed" });
}

// ------------------ WAIT FOR IFRAME LOAD ------------------
function waitForLoad(backend) {
  return new Promise(resolve => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        log("Backend timeout: " + backend, "warn");
        sendParent({ type: "clientProxy:backendFail", backend, error: "timeout" });
        resolve(false); // ✅ correct
      }
    }, 8000);

    inner.onload = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        log("Backend successful: " + backend);
        sendParent({ type: "clientProxy:backendSuccess", backend });
        hideOverlay();      // ✅ overlay now removed correctly
        resolve(true);
      }
    };

    inner.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        log("Backend failed (onerror): " + backend, "warn");
        sendParent({ type: "clientProxy:backendFail", backend, error: "onerror" });
        resolve(false);
      }
    };
  });
}

// ------------------ RECAPTCHA HANDLER ------------------
window.addEventListener("message", (ev) => {
  const d = ev.data || {};
  if (typeof d.recaptchaVerified !== "undefined") {
    sendParent({ type: "recaptchaResult", payload: d });

    if (d.recaptchaVerified && d.target) {
      loadViaBackend(d.target);
    }
  }
});

// ------------------ INIT ------------------
window.addEventListener("load", () => {
  const url = getURL();
  if (url) loadViaBackend(url);
});
