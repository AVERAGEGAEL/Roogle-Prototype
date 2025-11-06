// ------------------ GLOBALS ------------------
const innerFrame = document.getElementById("innerProxyFrame");
const overlay = parent.document.getElementById("loadingSpinner"); // parent controls spinner
let targetURL = null;

// ------------------ HELPERS ------------------
function getURL() {
  const p = new URLSearchParams(location.hash.slice(1));
  return p.get("url");
}

function sendParent(msg) {
  try { parent.postMessage(msg, "*"); } catch {}
}

function showOverlay() {
  parent.postMessage({ type: "clientProxy:showLoading" }, "*");
}

function hideOverlay() {
  parent.postMessage({ type: "clientProxy:hideLoading" }, "*");
}

function log(msg, level="info") {
  sendParent({ type:"clientProxy:log", payload:{ ts:new Date().toLocaleTimeString(), level, message:msg }});
  console.log("[client-proxy]", msg);
}

// ------------------ DIRECT BACKEND LOADER ------------------
async function loadViaBackend(url) {
  targetURL = url;
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

  const shuffled = backends.sort(() => Math.random() - 0.5);

  for (const backend of shuffled) {
    const proxyURL = `${backend}/proxy?url=${encodeURIComponent(url)}`;
    log("Trying backend: " + backend);

    sendParent({ type:"clientProxy:attemptBackend", backend, target: url });

    // ✅ DIRECT LOAD — NOT FETCH
    innerFrame.src = proxyURL;

    // Wait for load
    let ok = await waitForLoad(backend);
    if (ok) return;
  }

  // If all failed:
  innerFrame.srcdoc = `<h2>All workers failed</h2>`;
  sendParent({ type:"clientProxy:allBackendsFailed" });
}

// ------------------ WAIT FOR LOAD ------------------
function waitForLoad(backend) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      log("Backend timed out: " + backend, "warn");
      resolve(false);
    }, 5000);

    innerFrame.onload = () => {
      clearTimeout(timeout);
      log("Backend successful: " + backend);
      sendParent({ type:"clientProxy:backendSuccess", backend });
      hideOverlay();
      resolve(true);
    };

    innerFrame.onerror = () => {
      clearTimeout(timeout);
      log("Backend failed (onerror): " + backend, "warn");
      sendParent({ type:"clientProxy:backendFail", backend, error:"onerror" });
      resolve(false);
    };
  });
}

// ------------------ RECAPTCHA LISTENER ------------------
window.addEventListener("message", (ev) => {
  const d = ev.data || {};
  if (typeof d.recaptchaVerified !== "undefined") {
    log("Recaptcha result received inside client-proxy");
    sendParent({ type:"recaptchaResult", payload:d });

    if (d.recaptchaVerified && d.target) {
      loadViaBackend(d.target);
    }
  }
});

// ------------------ INIT ------------------
window.addEventListener("load", () => {
  const url = getURL();
  if (url) {
    loadViaBackend(url);
  }
});
