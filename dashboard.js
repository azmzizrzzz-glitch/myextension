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
            document.getElementById('statusText').className = 'card-value stopped';
            return;
        }
        
        // === وضعیت ===
        const toggleBtn = document.getElementById('toggleBtn');
        if (status.isRunning) {
            document.getElementById('statusText').textContent = '✅ فعال';
            document.getElementById('statusText').className = 'card-value running';
            toggleBtn.textContent = '⏸️ متوقف کردن';
            toggleBtn.className = 'btn btn-toggle';
        } else {
            document.getElementById('statusText').textContent = '⏸️ متوقف';
            document.getElementById('statusText').className = 'card-value stopped';
            toggleBtn.textContent = '▶️ شروع مجدد';
            toggleBtn.className = 'btn btn-toggle stopped';
        }
        
        document.getElementById('startTime').textContent = formatTime(status.startTime);
        document.getElementById('lastCheck').textContent = timeAgo(status.lastCheck);
        document.getElementById('totalChecks').textContent = status.totalChecks;
        
        // === تب‌ها ===
        const tabsList = document.getElementById('tabsList');
        const tabs = Object.entries(status.tabs || {});
        
        if (tabs.length === 0) {
            tabsList.innerHTML = '<div class="no-data">هنوز تبی بررسی نشده</div>';
        } else {
            tabsList.innerHTML = tabs.map(([tabId, tab]) => {
                const isMuted = status.mutedTabs && status.mutedTabs[tabId];
                const isAlert = tab.status === 'ALERT';
                
                return `
                <div class="tab-item ${isAlert ? 'alert' : ''} ${isMuted ? 'muted' : ''}">
                    <div class="tab-info">
                        <div class="tab-title">
                            ${isAlert ? '🔴' : '🟢'} ${tab.title}
                            ${isAlert && !isMuted ? '<span class="alert-badge">هشدار!</span>' : ''}
                            ${isMuted ? '<span style="color:#888;font-size:11px">(بی‌صدا)</span>' : ''}
                        </div>
                        <div class="tab-details">آخرین بررسی: ${timeAgo(tab.lastCheck)}</div>
                        <div class="tab-details">سطرها: ${tab.recentRows || 0} (۵ دقیقه اخیر)</div>
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
                        ${tab.pageAlertWords && tab.pageAlertWords.length > 0 ? `
                            <div class="tab-alert-info">
                                ⚠️ صفحه: ${tab.pageAlertWords.join(', ')}
                            </div>
                        ` : ''}
                        ${tab.alertWord ? `
                            <div class="tab-alert-info">
                                ⚠️ جدول: ${tab.alertWord}
                            </div>
                        ` : ''}
                        ${tab.zeroValue ? `
                            <div class="tab-alert-info">
                                ⚠️ مقدار صفر!
                            </div>
                        ` : ''}
                        ${tab.suddenChange ? `
                            <div class="tab-alert-info">
                                ⚠️ ${tab.suddenChange.direction} ${tab.suddenChange.change.toFixed(1)}%
                                (${tab.suddenChange.average.toFixed(1)} → ${tab.suddenChange.current})
                            </div>
                        ` : ''}
                    </div>
                    <div class="mute-toggle">
                        <button class="mute-btn ${isMuted ? 'muted' : 'active'}" 
                                data-tab-id="${tabId}"
                                title="${isMuted ? 'فعال کردن صدا' : 'بی‌صدا کردن'}">
                        </button>
                        <span class="mute-label ${isMuted ? 'muted' : 'active'}">
                            ${isMuted ? '🔇 بی‌صدا' : '🔊 فعال'}
                        </span>
                    </div>
                </div>
            `}).join('');
            
            // اضافه کردن event listener برای دکمه‌های mute
            document.querySelectorAll('.mute-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const tabId = e.target.dataset.tabId;
                    await chrome.runtime.sendMessage({ 
                        action: 'toggleMute', 
                        tabId: parseInt(tabId) 
                    });
                    updateDashboard();
                });
            });
        }
        
        // === آلارم‌ها ===
        const alertsList = document.getElementById('alertsList');
        const alerts = status.alerts || [];
        
        if (alerts.length === 0) {
            alertsList.innerHTML = '<div class="no-data success">✅ بدون آلارم</div>';
        } else {
            alertsList.innerHTML = alerts.slice(0, 20).map(alert => `
                <div class="alert-item">
                    <div class="alert-title">🚨 ${alert.tabTitle}</div>
                    <div class="alert-detail">${alert.detail}</div>
                    <div class="alert-time">${formatTime(alert.time)}</div>
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.log('Error:', error);
    }
}

// === دکمه Toggle ===
document.getElementById('toggleBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'toggle' });
    updateDashboard();
});

// === دکمه ریست ===
document.getElementById('resetBtn').addEventListener('click', async () => {
    if (confirm('آیا مطمئن هستید؟\nتمام تب‌ها و لاگ‌ها پاک می‌شوند و برنامه از اول شروع می‌کند.')) {
        await chrome.runtime.sendMessage({ action: 'reset' });
        updateDashboard();
    }
});

// === دکمه پاک کردن آلارم‌ها ===
document.getElementById('clearBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'clearAlerts' });
    updateDashboard();
});

// === شروع ===
updateDashboard();
setInterval(updateDashboard, 2000);
