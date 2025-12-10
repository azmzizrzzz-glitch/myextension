// === پخش صدا ===
function playSound() {
    const audio = document.getElementById('alarmSound');
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(e => {
            // اگر فایل mp3 نبود، صدای beep بسازیم
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'square';
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            
            oscillator.start();
            setTimeout(() => oscillator.stop(), 500);
        });
    }
}

// === دریافت پیام ===
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'playSound') {
        playSound();
        sendResponse({ success: true });
    }
    return true;
});
