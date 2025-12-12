const formatTime = (t) => t ? new Date(t).toLocaleTimeString('fa-IR') : '-';
const timeAgo = (t) => {
    if (!t) return '-';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return `${s} ثانیه پیش`;
    if (s < 3600) return `${Math.floor(s / 60)} دقیقه پیش`;
    return `${Math.floor(s / 3600)} ساعت پیش`;
};

// === Tab Revolver UI ===
async function updateRevolverUI() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getRevolverStatus' });
        const box = document.getElementById('revolverBox');
        const status = document.getElementById('revolverStatus');
        const btn = document.getElementById('revolverBtn');
        const info = document.getElementById('revolverInfo');
        const input = document.getElementById('revolverInterval');
        
        if (response.enabled) {
            box.classList.add('active');
            status.textContent = '✅ فعال';
            status.className = 'revolver-status on';
            btn.textContent = '⏹️ توقف';
            btn.className = 'btn-revolver stop';
            info.innerHTML = '<span class="rotating">🔄</span> در حال چرخش بین تب‌ها... سیستم بیدار است';
            info.className = 'revolver-info active';
        } else {
            box.classList.remove('active');
            status.textContent = 'غیرفعال';
            status.className = 'revolver-status off';
            btn.textContent = '▶️ شروع';
            btn.className = 'btn-revolver start';
            info.innerHTML = '💡 بین تب‌های مانیتورینگ چرخش می‌کند و سیستم را بیدار نگه می‌دارد';
            info.className = 'revolver-info';
        }
        
        input.value = response.interval;
    } catch (e) {
        console.log('Revolver UI error:', e);
    }
}

async function update() {
    const data = await chrome.storage.local.get('extensionStatus');
    const s = data.extensionStatus;
    
    if (!s) {
        document.getElementById('statusText').textContent = '❌ غیرفعال';
        return;
    }
    
    const toggleBtn = document.getElementById('toggleBtn');
    if (s.isRunning) {
        document.getElementById('statusText').textContent = '✅ فعال';
        document.getElementById('statusText').className = 'card-value running';
        toggleBtn.textContent = '⏸️ متوقف';
        toggleBtn.className = 'btn btn-toggle';
    } else {
        document.getElementById('statusText').textContent = '⏸️ متوقف';
        document.getElementById('statusText').className = 'card-value stopped';
        toggleBtn.textContent = '▶️ شروع';
        toggleBtn.className = 'btn btn-toggle stopped';
    }
    
    document.getElementById('startTime').textContent = formatTime(s.startTime);
    document.getElementById('lastCheck').textContent = timeAgo(s.lastCheck);
    document.getElementById('totalChecks').textContent = s.totalChecks;
    
    // آپدیت Revolver UI
    updateRevolverUI();
    
    // تب‌ها
    const tabs = Object.entries(s.tabs || {});
    const tabsList = document.getElementById('tabsList');
    
    if (tabs.length === 0) {
        tabsList.innerHTML = '<div class="no-data">هنوز تبی نیست</div>';
    } else {
        tabsList.innerHTML = tabs.map(([id, t]) => {
            const muted = s.mutedTabs && s.mutedTabs[id];
            const alert = t.status === 'ALERT';
            const typeClass = t.type === 'zabbix' ? 'type-zabbix' : 'type-grafana';
            const typeName = t.type === 'zabbix' ? 'Zabbix' : 'Grafana';
            
            let details = '';
            
            // === نمایش Zabbix ===
            if (t.type === 'zabbix' && t.details) {
                details = `<div class="tab-details">Problems: ${t.details.totalProblems || 0} (هشدار: ${t.details.alertProblems || 0})</div>`;
                if (t.details.problems) {
                    t.details.problems.forEach(p => {
                        if (p.shouldAlert) {
                            details += `<div class="tab-alert">🚨 ${p.host}: ${p.problem} (${p.duration})</div>`;
                        }
                    });
                }
            }
            
            // === نمایش Grafana ===
            if (t.type === 'grafana') {
                details = `<div class="tab-details">سطرها: ${t.recentRows || 0} (۵ دقیقه اخیر)</div>`;
                
                if (t.lastValue !== null && t.lastValue !== undefined) {
                    details += `<div class="tab-numbers">آخرین مقدار: <strong>${t.lastValue}</strong> ${t.lastTime ? `(${t.lastTime})` : ''}</div>`;
                }
                
                if (t.average !== null && t.average !== undefined) {
                    details += `<div class="tab-average">📊 میانگین: <strong>${t.average.toFixed(2)}</strong> (${t.averageCount} مقدار)</div>`;
                }
                
                if (t.pageAlertWords && t.pageAlertWords.length > 0) {
                    details += `<div class="tab-alert-info">⚠️ صفحه: ${t.pageAlertWords.join(', ')}</div>`;
                }
                
                if (t.zeroValue) {
                    details += `<div class="tab-alert-info">⚠️ مقدار صفر!</div>`;
                }
                
                if (t.suddenChange) {
                    details += `<div class="tab-alert-info">⚠️ ${t.suddenChange.direction} ${t.suddenChange.change.toFixed(1)}% (میانگین: ${t.suddenChange.average.toFixed(1)} → فعلی: ${t.suddenChange.current})</div>`;
                }
            }
            
            return `
                <div class="tab-item ${alert ? 'alert' : ''} ${muted ? 'muted' : ''}">
                    <div class="tab-info">
                        <div class="tab-title">
                            <span class="type-badge ${typeClass}">${typeName}</span>
                            ${alert ? '🔴' : '🟢'} ${t.title}
                            ${alert && !muted ? '<span class="alert-badge">هشدار!</span>' : ''}
                            ${muted ? '<span style="color:#888;font-size:11px">(بی‌صدا)</span>' : ''}
                        </div>
                        <div class="tab-details">آخرین بررسی: ${timeAgo(t.lastCheck)}</div>
                        ${details}
                    </div>
                    <div class="mute-toggle">
                        <button class="mute-btn ${muted ? 'muted' : 'active'}" data-id="${id}"></button>
                        <span class="mute-label ${muted ? 'muted' : 'active'}">${muted ? '🔇 بی‌صدا' : '🔊 فعال'}</span>
                    </div>
                </div>
            `;
        }).join('');
        
        document.querySelectorAll('.mute-btn').forEach(btn => {
            btn.onclick = async () => {
                await chrome.runtime.sendMessage({ action: 'toggleMute', tabId: parseInt(btn.dataset.id) });
                update();
            };
        });
    }
    
    // آلارم‌ها
    const alerts = s.alerts || [];
    const alertsList = document.getElementById('alertsList');
    
    if (alerts.length === 0) {
        alertsList.innerHTML = '<div class="no-data ok">✅ بدون آلارم</div>';
    } else {
        alertsList.innerHTML = alerts.slice(0, 20).map(a => `
            <div class="alert-item">
                <div class="alert-title">🚨 ${a.tabTitle}</div>
                <div class="alert-detail">${a.detail}</div>
                <div class="alert-time">${formatTime(a.time)}</div>
            </div>
        `).join('');
    }
}

// === Event Listeners ===

document.getElementById('toggleBtn').onclick = async () => {
    await chrome.runtime.sendMessage({ action: 'toggle' });
    update();
};

document.getElementById('resetBtn').onclick = async () => {
    if (confirm('ریست شود؟ Tab Revolver هم متوقف می‌شود.')) {
        await chrome.runtime.sendMessage({ action: 'reset' });
        update();
    }
};

document.getElementById('clearBtn').onclick = async () => {
    await chrome.runtime.sendMessage({ action: 'clearAlerts' });
    update();
};

// === Revolver Controls ===

document.getElementById('revolverBtn').onclick = async () => {
    await chrome.runtime.sendMessage({ action: 'toggleRevolver' });
    updateRevolverUI();
};

document.getElementById('revolverInterval').onchange = async (e) => {
    const interval = parseInt(e.target.value) || 3000;
    await chrome.runtime.sendMessage({ action: 'setRevolverInterval', interval });
    updateRevolverUI();
};

// === Start ===
update();
setInterval(update, 2000);
