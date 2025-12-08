function formatTime(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('fa-IR');
}

function timeAgo(timestamp) {
    if (!timestamp) return '-';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return `${seconds} ثانیه پیش`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} دقیقه پیش`;
    return `${Math.floor(seconds / 3600)} ساعت پیش`;
}

async function updateDashboard() {
    try {
        const data = await chrome.storage.local.get('extensionStatus');
        const status = data.extensionStatus;
        
        if (!status) {
            document.getElementById('statusText').textContent = '❌ اجرا نشده';
            document.getElementById('statusText').className = 'value stopped';
            return;
        }
        
        const toggleBtn = document.getElementById('toggleBtn');
        if (status.isRunning) {
            document.getElementById('statusText').textContent = '✅ در حال اجرا';
            document.getElementById('statusText').className = 'value running';
            toggleBtn.textContent = '⏸️ متوقف کردن';
            toggleBtn.className = 'btn btn-toggle';
        } else {
            document.getElementById('statusText').textContent = '⏸️ متوقف شده';
            document.getElementById('statusText').className = 'value paused';
            toggleBtn.textContent = '▶️ شروع مجدد';
            toggleBtn.className = 'btn btn-toggle stopped';
        }
        
        document.getElementById('startTime').textContent = formatTime(status.startTime);
        document.getElementById('lastCheck').textContent = timeAgo(status.lastCheck);
        document.getElementById('totalChecks').textContent = status.totalChecks;
        
        const tabsList = document.getElementById('tabsList');
        const tabs = Object.values(status.tabs || {});
        
        if (tabs.length === 0) {
            tabsList.innerHTML = '<div class="no-alerts">هنوز تبی بررسی نشده</div>';
        } else {
            tabsList.innerHTML = tabs.map(tab => `
                <div class="tab-item ${tab.status === 'ALERT' ? 'alert' : ''}">
                    <div class="tab-title">
                        ${tab.status === 'ALERT' ? '🔴' : '🟢'} ${tab.title}
                    </div>
                    <div class="tab-details">
                        آخرین بررسی: ${timeAgo(tab.lastCheck)}
                    </div>
                    <div class="tab-details">
                        سطرها: ${tab.recentRows || 0} (۵ دقیقه اخیر)
                    </div>
                    ${tab.lastValue !== null ? `
                        <div class="tab-numbers">
                            آخرین مقدار: <strong>${tab.lastValue}</strong>
                            ${tab.lastTime ? `(${tab.lastTime})` : ''}
                        </div>
                    ` : ''}
                    ${tab.average !== null ? `
                        <div class="tab-numbers">
                            میانگین: <strong>${tab.average.toFixed(2)}</strong>
                            (${tab.averageCount} مقدار)
                        </div>
                    ` : ''}
                    ${tab.alertWord ? `
                        <div class="tab-alert-info">
                            ⚠️ کلمه: ${tab.alertWord}
                        </div>
                    ` : ''}
                    ${tab.suddenChange ? `
                        <div class="tab-alert-info">
                            ⚠️ تغییر: ${tab.suddenChange.change.toFixed(1)}%
                            (${tab.suddenChange.average.toFixed(1)} → ${tab.suddenChange.current})
                        </div>
                    ` : ''}
                </div>
            `).join('');
        }
        
        const alertsList = document.getElementById('alertsList');
        const alerts = status.alerts || [];
        
        if (alerts.length === 0) {
            alertsList.innerHTML = '<div class="no-alerts">✅ بدون آلارم</div>';
        } else {
            alertsList.innerHTML = alerts.slice(0, 10).map(alert => `
                <div class="alert-item">
                    <div><strong>${alert.tabTitle}</strong></div>
                    <div>${alert.detail}</div>
                    <div class="alert-time">${formatTime(alert.time)}</div>
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.log('Error:', error);
    }
}

document.getElementById('toggleBtn').addEventListener('click', async () => {
    try {
        await chrome.runtime.sendMessage({ action: 'toggle' });
        updateDashboard();
    } catch (e) {}
});

document.getElementById('refreshBtn').addEventListener('click', updateDashboard);

document.getElementById('clearBtn').addEventListener('click', async () => {
    try {
        await chrome.runtime.sendMessage({ action: 'clearAlerts' });
        updateDashboard();
    } catch (e) {}
});

updateDashboard();
setInterval(updateDashboard, 2000);