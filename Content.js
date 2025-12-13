document.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') {
        chrome.runtime.sendMessage({ action: 'stopRevolver' });
    }
});
