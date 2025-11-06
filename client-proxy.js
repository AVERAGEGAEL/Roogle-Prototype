<script>
// ------------------ GLOBALS ------------------
const innerFrame = document.getElementById("innerProxyFrame");

// Local overlay (this page)
const localOverlay = document.getElementById("loadingOverlay");
const localMsg = document.getElementById("loadingMessage");

// ------------------ HELPERS ------------------
function qparam(name) {
  const p = new URLSearchParams(location.hash.slice(1));
  return p.get(name);
}

function sendParent(msg) {
  try { parent.postMessage(msg, "*"); } catch {}
}

function showLocalOverlay(msg = "Loading…") {
  if (localOverlay) {
    localOverlay.style.display = "flex";
    localOverlay.style.opacity = "1";
    localOverlay.setAttribute("aria-hidden", "false");
  }
  if (localMsg) localMsg.textContent = msg;
  sendParent({ type: "clientProxy:showLoading" });
}

function hideLocalOverlay() {
  if (localOverlay) {
    localOverlay.style.opacity = "0";
    localOverlay.setAttribute("aria-hidden", "true");
    setTimeout(() => { localOverlay.style.display = "none"; }, 180);
  }
  sendParent({ type: "clientProxy:hideLoading" });
}

function log(msg, level="info") {
  sendParent({ type:"clientProxy:log", payload:{ ts:new Date().toLocaleTimeString(), level, message:msg }});
  console.log("[client-proxy]", msg);
}

// ------------------ BACKEND ROTATION (DIRECT IFRAME LOAD) ------------------
async function loadViaBackend(url) {
  showLocalOverlay("Loading via backend iframe: " + url);

  const backends = [
    "https://cloud1.uraverageopdoge.workers.dev",
    "https://cloud2.uraverageopdoge.workers.dev",
    "https://cloud1.rageinhaler.workers.dev",
    "https://cloud2.rageinhaler.workers.dev",
    "https://cloud3.rageinhaler.workers.dev",
    "https://cloud2.kevinthejordan.workers.dev",
    "https://cloud3.kevinthejordan.workers.dev"
  ];

  const shuffled = backends.sort(() => Math.random() - 0.5);

  for (const backend of shuffled) {
    const proxyURL = `${backend}/proxy?url=${encodeURIComponent(url)}`;
    log("Trying backend: " + backend);
    sendParent({ type:"clientProxy:attemptBackend", backend, target: url });

    const ok = await tryBackend(proxyURL, backend);
    if (ok) {
      sendParent({ type:"clientProxy:backendSuccess", backend });
      return;
    } else {
      sendParent({ type:"clientProxy:backendFail", backend, info:"timeout or onerror" });
    }
  }

  // All failed
  innerFrame.srcdoc = `<div style="font-family:system-ui,Segoe UI,Roboto,Arial;padding:32px;text-align:center">
    <h2>⚠️ All workers failed</h2>
    <p>Try again or switch to a different worker.</p>
  </div>`;
  log("All proxy backends failed", "error");
  hideLocalOverlay();
}

// Try one backend by setting iframe src and waiting for a signal
function tryBackend(src, backend) {
  return new Promise((resolve) => {
    let settled = false;

    // 1) success path: onload fires
    innerFrame.onload = () => {
      if (settled) return;
      settled = true;
      log("Backend successful: " + backend);
      hideLocalOverlay();
      resolve(true);
    };

    // 2) network failure
    innerFrame.onerror = () => {
      if (settled) return;
      settled = true;
      log("Backend failed (onerror): " + backend, "warn");
      resolve(false);
    };

    // 3) watchdog timeout (some CAPTCHA pages render but delay events)
    const timeout = setTimeout(() => {
      if (settled) return;
      // If we can see something (we can't, cross-origin), just optimistically hide overlay
      // because many CAPTCHA pages paint before onload. We’ll trust user visibility.
      log("Backend timed out waiting for onload: " + backend, "warn");
      hideLocalOverlay();
      settled = true;
      resolve(true);
    }, 8000); // 8s

    // ensure we clear if we resolve earlier
    const clearAll = () => clearTimeout(timeout);
    const finalResolve = (v) => { clearAll(); resolve(v); };

    // actually kick off the load
    innerFrame.src = src;
  });
}

// ------------------ RECAPTCHA LISTENER ------------------
window.addEventListener("message", (ev) => {
  const d = ev.data || {};
  if (typeof d.recaptchaVerified !== "undefined") {
    log("Recaptcha result received inside client-proxy");
    sendParent({ type:"recaptchaResult", payload:d });

    if (d.recaptchaVerified && d.target) {
      // After verification, reload target again via rotation (hybrid keeps same flow)
      loadViaBackend(d.target);
    }
  }
});

// ------------------ INIT ------------------
window.addEventListener("load", () => {
  const url = qparam("url");
  if (url) {
    log("Client-proxy boot with target: " + url);
    loadViaBackend(url);
  } else {
    hideLocalOverlay();
  }
});
</script>
