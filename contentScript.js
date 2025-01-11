chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'getHTML') {
        sendResponse({ html: document.documentElement.outerHTML });
    } else if (request.action === 'clickElement') {
        const element = document.querySelector(request.selector);
        if (element) {
            element.click();
            sendResponse({ success: true });
        } else {
            sendResponse({ success: false, error: 'Element not found.' });
        }
    }
});