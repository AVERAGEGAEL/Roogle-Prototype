// Check if URL is valid (e.g., properly formatted domain)
function isValidURL(str) {
    try {
        const url = new URL(str.startsWith('http') ? str : 'https://' + str);
        return url.hostname.includes('.') && !url.hostname.includes(' ');
    } catch (e) {
        return false;
    }
}

// Handle form submission and proxying
document.getElementById('proxyForm').addEventListener('submit', function(event) {
    event.preventDefault();

    let urlInput = document.getElementById('url').value.trim();
    const iframe = document.getElementById('proxyIframe');
    const iframeContainer = document.getElementById('iframe-container');
    const loadingSpinner = document.getElementById('loadingSpinner');

    // Check if URL is empty
    if (!urlInput) {
        alert('Please enter a URL.');
        return;
    }

    // Check if the URL is valid
    if (!isValidURL(urlInput)) {
        alert('Invalid URL. Please enter a valid website like example.com or https://example.com.');
        return;
    }

    // Auto-add https:// if missing
    if (!urlInput.startsWith('http://') && !urlInput.startsWith('https://')) {
        urlInput = 'https://' + urlInput;
    }

    // Construct the proxy URL
    const proxyUrl = `https://fallen-amazon.uraverageopdoge.workers.dev/?url=${encodeURIComponent(urlInput)}`;
    iframe.src = proxyUrl;

    // Show the loading spinner
    loadingSpinner.style.display = 'block';

    // Hide the spinner once the iframe has loaded
    iframe.onload = () => {
        loadingSpinner.style.display = 'none';
    };

    // Show the iframe container
    iframeContainer.style.display = 'block';
});
