// Helper: Validate URL format
function isValidURL(str) {
  try {
    const url = new URL(str.startsWith('http') ? str : 'https://' + str);
    return url.hostname.includes('.') && !url.hostname.includes(' ');
  } catch (e) {
    return false;
  }
}

// Which sites need Ultraviolet proxy?
function isUVRequired(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  return ['google.com', 'poki.com', 'retrogames.cc', 'coolmathgames.com'].some(site =>
    hostname.includes(site)
  );
}

// Base URLs for proxies
const baseUV = 'https://ultra-gael.uraverageopdoge.workers.dev/?url=';
const baseIframe = 'https://fallen-amazon.uraverageopdoge.workers.dev/?url=';

document.addEventListener('DOMContentLoaded', () => {
  const lastUpdatedElement = document.getElementById('last-updated');
  const now = new Date();
  lastUpdatedElement.textContent = `${now.toLocaleDateString()} at ${now.toLocaleTimeString()}`;

  const form = document.getElementById('proxyForm');
  const iframe = document.getElementById('proxyIframe');
  const iframeContainer = document.getElementById('iframe-container');
  const loadingSpinner = document.getElementById('loadingSpinner');

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

    // Auto-add https:// if missing
    if (!urlInput.startsWith('http://') && !urlInput.startsWith('https://')) {
      urlInput = 'https://' + urlInput;
    }

    const encodedUrl = encodeURIComponent(urlInput);
    let proxyUrl;

    if (isUVRequired(urlInput)) {
      proxyUrl = baseUV + encodedUrl; // Use UV backend
    } else {
      proxyUrl = baseIframe + encodedUrl; // Use iframe proxy
    }

    iframe.src = proxyUrl;
    iframeContainer.style.display = 'block';

    loadingSpinner.style.display = 'block';
    iframe.onload = () => {
      loadingSpinner.style.display = 'none';
    };
  });
});
