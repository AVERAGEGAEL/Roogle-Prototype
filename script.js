// Validate URL format
function isValidURL(str) {
  try {
    const url = new URL(str.startsWith('http') ? str : 'https://' + str);
    return url.hostname.includes('.') && !url.hostname.includes(' ');
  } catch (e) {
    return false;
  }
}

// Decide if UV backend is needed
function isUVRequired(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  return ['google.com', 'youtube.com', 'poki.com', 'retrogames.cc', 'coolmathgames.com'].some(site =>
    hostname.includes(site)
  );
}

// Proxy URLs
const uvBackendBase = 'https://roogle-v3-backend.onrender.com/?url=';
const baseIframe = 'https://fallen-amazon.uraverageopdoge.workers.dev/?url=';

document.addEventListener('DOMContentLoaded', () => {
  const lastUpdatedElement = document.getElementById('last-updated');
  const now = new Date();
  lastUpdatedElement.textContent = `${now.toLocaleDateString()} at ${now.toLocaleTimeString()}`;

  const form = document.getElementById('proxyForm');
  const iframe = document.getElementById('proxyIframe');
  const iframeContainer = document.getElementById('iframe-container');
  const loadingSpinner = document.getElementById('loadingSpinner');
  const fullscreenBtn = document.getElementById('fullscreen-btn');

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    let urlInput = document.getElementById('url').value.trim();
    if (!urlInput) {
      alert('Please enter a URL.');
      return;
    }

    if (!isValidURL(urlInput)) {
      alert('Invalid URL. Please enter a valid website like example.com or https://example.com.');
      return;
    }

    if (!urlInput.startsWith('http://') && !urlInput.startsWith('https://')) {
      urlInput = 'https://' + urlInput;
    }

    const proxyUrl = isUVRequired(urlInput)
  ? uvBackendBase + '?url=' + encodeURIComponent(urlInput) // <-- add ?url=
  : baseIframe + encodeURIComponent(urlInput);

    iframe.src = proxyUrl;
    iframeContainer.style.display = 'block';
    loadingSpinner.style.display = 'block';

    iframe.onload = () => {
      loadingSpinner.style.display = 'none';
    };

    iframe.onerror = () => {
      loadingSpinner.style.display = 'none';
      iframeContainer.innerHTML = `
        <div style="padding:20px; color:#d93025;">
          <h2>⚠️ Site blocked from embedding</h2>
          <p>This website doesn’t allow being opened inside Roogle V3.<br>
          It will work through the UV backend if supported.</p>
        </div>`;
    };
  });

  // Fullscreen toggle
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        alert(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  });
});
