async function updateStatus() {
    try {
        const data = await chrome.storage.local.get('extensionStatus');
        const status = data.extensionStatus;
        
        const statusBox = document.getElementById('statusBox');
        const statusText = document.getElementById('statusText');
        const toggleBtn = document.getElementById('toggleBtn');
        
        if (!status) {
            statusText.textContent = '❌ اجرا نشده';
            statusText.className = 'status-text stopped';
            statusBox.className = 'status stopped';
            return;
        }
        
        if (status.isRunning) {
            statusText.textContent = '✅ در حال اجرا';
            statusText.className = 'status-text running';
            statusBox.className = 'status running';
            toggleBtn.textContent = '⏸️ متوقف کردن';
            toggleBtn.className = 'btn btn-toggle';
        } else {
            statusText.textContent = '⏸️ متوقف شده';
            statusText.className = 'status-text stopped';
            statusBox.className = 'status stopped';
            toggleBtn.textContent = '▶️ شروع مجدد';
            toggleBtn.className = 'btn btn-toggle stopped';
        }
        
    } catch (e) {
        console.log('Error:', e);
    }
}

document.getElementById('dashboardBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'openDashboard' });
    window.close();
});

document.getElementById('toggleBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'toggle' });
    updateStatus();
});

updateStatus();
setInterval(updateStatus, 2000);
