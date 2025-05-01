document.getElementById('proxyForm').addEventListener('submit', function(event) {
    event.preventDefault();
    
    let urlInput = document.getElementById('url').value.trim();
    const iframe = document.getElementById('proxyIframe');
    const iframeContainer = document.getElementById('iframe-container');

    if (!urlInput) {
        alert('Please enter a URL.');
        return;
    }

    // Auto-add https:// if missing
    if (!urlInput.startsWith('http://') && !urlInput.startsWith('https://')) {
        urlInput = 'https://' + urlInput;
    }

    const proxyUrl = `https://fallen-america.uraverageopdoge.workers.dev/?url=${encodeURIComponent(urlInput)}`;
    iframe.src = proxyUrl;
    iframeContainer.style.display = 'block';
});
