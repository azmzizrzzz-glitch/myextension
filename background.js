// === تنظیمات ===
const CHECK_INTERVAL = 3000;
const HISTORY_MINUTES = 5;
const CHANGE_THRESHOLD = 50;
const AVERAGE_COUNT = 20;
const ZABBIX_MIN_MINUTES = 5;
const ZABBIX_MAX_MINUTES = 10;
let isRunning = true;

// === کلمات خطرناک ===
const ALERT_PATTERNS = [
    /\bDOWN\b/i, /\bDisconnect\b/i, /\bDisconnected\b/i,
    /\bError\b/i, /\bCritical\b/i, /\bFailed\b/i,
    /\bFailure\b/i, /\bUnreachable\b/i, /\bOffline\b/i, /\bTimeout\b/i
];
const SAFE_WORDS = ['download', 'dropdown', 'markdown', 'breakdown'];

// === ذخیره وضعیت ===
let extensionStatus = {
    isRunning: true,
    startTime: Date.now(),
    lastCheck: null,
    totalChecks: 0,
    tabs: {},
    alerts: [],
    mutedTabs: {}
};

// === بارگذاری وضعیت ===
async function loadStatus() {
    try {
        const data = await chrome.storage.local.get('extensionStatus');
        if (data.extensionStatus) {
            extensionStatus = { ...extensionStatus, ...data.extensionStatus };
            isRunning = extensionStatus.isRunning;
        }
    } catch (e) {}
}

// === ذخیره وضعیت ===
async function saveStatus() {
    await chrome.storage.local.set({ extensionStatus });
}

// === پخش صدا ===
async function setupOffscreen() {
    try {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });
        if (contexts.length === 0) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['AUDIO_PLAYBACK'],
                justification: 'پخش آلارم'
            });
        }
    } catch (e) {}
}

async function playAlarm() {
    try {
        await setupOffscreen();
        await chrome.runtime.sendMessage({ action: 'playSound' });
    } catch (e) {}
}

// === تشخیص نوع صفحه و خواندن (همه توابع داخل این تابع هستند) ===
function detectAndRead() {
    
    // ========== تابع خواندن Grafana ==========
    function readGrafana() {
        const result = { type: 'grafana', rows: [], pageAlerts: [], error: null };
        
        try {
            // جستجوی کل صفحه
            const safeWords = ['download', 'dropdown', 'markdown', 'breakdown'];
            const alertPatterns = [
                /\bDOWN\b/gi, /\bDisconnect\b/gi, /\bDisconnected\b/gi,
                /\bError\b/gi, /\bCritical\b/gi, /\bFailed\b/gi,
                /\bFailure\b/gi, /\bUnreachable\b/gi, /\bOffline\b/gi, /\bTimeout\b/gi
            ];
            
            let pageText = document.body.innerText || '';
            for (let word of safeWords) {
                pageText = pageText.replace(new RegExp(word, 'gi'), '___');
            }
            
            for (let pattern of alertPatterns) {
                const matches = pageText.match(pattern);
                if (matches) {
                    matches.forEach(m => {
                        if (!result.pageAlerts.includes(m.toUpperCase())) {
                            result.pageAlerts.push(m.toUpperCase());
                        }
                    });
                }
            }
            
            // خواندن جدول
            const rows = document.querySelectorAll('[role="row"]');
            for (let row of rows) {
                const cells = row.querySelectorAll('[role="cell"]');
                if (cells.length >= 2) {
                    const timeText = cells[0].innerText.trim();
                    const valueText = cells[1].innerText.trim();
                    const timeMatch = timeText.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
                    
                    if (timeMatch) {
                        const timestamp = new Date(timeMatch[1] + 'T' + timeMatch[2]).getTime();
                        const numValue = parseFloat(valueText);
                        result.rows.push({
                            timestamp, timeText,
                            value: isNaN(numValue) ? valueText : numValue,
                            isNumeric: !isNaN(numValue)
                        });
                    }
                }
            }
            result.rows.sort((a, b) => a.timestamp - b.timestamp);
        } catch (e) {
            result.error = e.message;
        }
        
        return result;
    }
    
    // ========== تابع خواندن Zabbix ==========
    function readZabbix() {
        const result = { type: 'zabbix', problems: [], error: null };
        
        try {
            const tables = document.querySelectorAll('table');
            const seen = new Set();
            
            tables.forEach((table) => {
                const rows = table.querySelectorAll('tbody tr');
                
                rows.forEach((row) => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length < 7) return;
                    
                    const rowText = row.innerText.toLowerCase();
                    if (rowText.includes('resolved')) return;
                    
                    const time = cells[0]?.innerText?.trim() || '';
                    const host = cells[4]?.innerText?.trim() || '';
                    const problem = cells[5]?.innerText?.trim() || '';
                    const duration = cells[6]?.innerText?.trim() || '';
                    
                    if (!duration || !problem) return;
                    
                    const key = `${host}-${problem}`;
                    if (seen.has(key)) return;
                    seen.add(key);
                    
                    // تبدیل به دقیقه
                    let minutes = 0;
                    const h = duration.match(/(\d+)h/);
                    const m = duration.match(/(\d+)m/);
                    const s = duration.match(/(\d+)s/);
                    if (h) minutes += parseInt(h[1]) * 60;
                    if (m) minutes += parseInt(m[1]);
                    if (s) minutes += parseInt(s[1]) / 60;
                    
                    result.problems.push({
                        time, host, problem, duration, minutes,
                        shouldAlert: minutes >= 5 && minutes <= 10
                    });
                });
            });
        } catch (e) {
            result.error = e.message;
        }
        
        return result;
    }
    
    // ========== منطق اصلی تشخیص ==========
    const url = window.location.href.toLowerCase();
    const html = document.body.innerHTML.toLowerCase();
    
    // اول بر اساس URL تشخیص بده
    if (url.includes('zabbix') || html.includes('zabbix')) {
        return readZabbix();
    } else if (url.includes('grafana') || html.includes('grafana')) {
        return readGrafana();
    }
    
    // اگر مشخص نبود، هر دو رو امتحان کن
    const zabbix = readZabbix();
    if (zabbix.problems.length > 0) return zabbix;
    
    return readGrafana();
}

// === محاسبه میانگین ===
function calculateAverage(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// === پردازش نتایج ===
async function processResults(data, tab) {
    const now = Date.now();
    const tabId = tab.id;
    const isMuted = extensionStatus.mutedTabs[tabId] === true;
    
    extensionStatus.tabs[tabId] = {
        title: tab.title,
        url: tab.url,
        type: data.type,
        lastCheck: now,
        status: 'OK',
        isMuted,
        details: {},
        // اطلاعات اضافی برای نمایش
        lastValue: null,
        lastTime: null,
        average: null,
        averageCount: 0,
        recentRows: 0,
        suddenChange: null,
        zeroValue: false,
        pageAlertWords: [],
        alertWord: null
    };
    
    let shouldAlarm = false;
    let alertReasons = [];
    
    // === پردازش Zabbix ===
    if (data.type === 'zabbix') {
        const alertProblems = data.problems.filter(p => p.shouldAlert);
        extensionStatus.tabs[tabId].details = {
            totalProblems: data.problems.length,
            alertProblems: alertProblems.length,
            problems: data.problems
        };
        
        if (alertProblems.length > 0 && !isMuted) {
            extensionStatus.tabs[tabId].status = 'ALERT';
            shouldAlarm = true;
            alertReasons.push(`Zabbix: ${alertProblems.length} مشکل (۵-۱۰ دقیقه)`);
        }
    }
    
    // === پردازش Grafana ===
    if (data.type === 'grafana') {
        const fiveMinutesAgo = now - (HISTORY_MINUTES * 60 * 1000);
        const recentRows = data.rows.filter(r => r.timestamp >= fiveMinutesAgo);
        
        extensionStatus.tabs[tabId].recentRows = recentRows.length;
        extensionStatus.tabs[tabId].details = {
            totalRows: data.rows.length,
            recentRows: recentRows.length,
            pageAlerts: data.pageAlerts
        };
        
        // کلمات خطرناک در صفحه
        if (data.pageAlerts.length > 0) {
            extensionStatus.tabs[tabId].pageAlertWords = data.pageAlerts;
            if (!isMuted) {
                extensionStatus.tabs[tabId].status = 'ALERT';
                shouldAlarm = true;
                alertReasons.push(`صفحه: ${data.pageAlerts.join(', ')}`);
            }
        }
        
        if (recentRows.length > 0) {
            const latest = recentRows[recentRows.length - 1];
            extensionStatus.tabs[tabId].lastValue = latest.value;
            extensionStatus.tabs[tabId].lastTime = latest.timeText;
            extensionStatus.tabs[tabId].details.lastValue = latest.value;
            extensionStatus.tabs[tabId].details.lastTime = latest.timeText;
            
            // مقدار صفر
            if (latest.isNumeric && latest.value === 0) {
                extensionStatus.tabs[tabId].zeroValue = true;
                if (!isMuted) {
                    extensionStatus.tabs[tabId].status = 'ALERT';
                    shouldAlarm = true;
                    alertReasons.push('مقدار = ۰');
                }
            }
            
            // محاسبه میانگین ۲۰ مقدار آخر
            if (latest.isNumeric && recentRows.length >= 3) {
                const numericRows = recentRows.filter(r => r.isNumeric);
                const last20 = numericRows.slice(-AVERAGE_COUNT);
                const prevNums = last20.slice(0, -1).map(r => r.value);
                
                if (prevNums.length >= 2) {
                    const avg = calculateAverage(prevNums);
                    extensionStatus.tabs[tabId].average = avg;
                    extensionStatus.tabs[tabId].averageCount = prevNums.length;
                    extensionStatus.tabs[tabId].details.average = avg;
                    extensionStatus.tabs[tabId].details.averageCount = prevNums.length;
                    
                    // کاهش ۵۰٪ نسبت به میانگین
                    if (avg > 0) {
                        const changePercent = ((avg - latest.value) / avg) * 100;
                        
                        if (changePercent >= CHANGE_THRESHOLD) {
                            extensionStatus.tabs[tabId].suddenChange = {
                                average: avg,
                                current: latest.value,
                                change: changePercent,
                                direction: 'کاهش'
                            };
                            
                            if (!isMuted) {
                                extensionStatus.tabs[tabId].status = 'ALERT';
                                shouldAlarm = true;
                                alertReasons.push(`کاهش ${changePercent.toFixed(1)}% (میانگین: ${avg.toFixed(2)} ← فعلی: ${latest.value})`);
                            }
                        }
                    }
                }
            }
        }
    }
    
    // ثبت آلارم
    if (shouldAlarm) {
        extensionStatus.alerts.unshift({
            time: now,
            tabId,
            tabTitle: tab.title,
            type: data.type,
            detail: alertReasons.join(' + ')
        });
        if (extensionStatus.alerts.length > 50) {
            extensionStatus.alerts = extensionStatus.alerts.slice(0, 50);
        }
        await playAlarm();
    }
}

// === بررسی یک تب ===
async function checkTab(tab) {
    if (!tab.url) return;
    if (tab.url.startsWith('chrome://')) return;
    if (tab.url.startsWith('chrome-extension://')) return;
    
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: detectAndRead
        });
        
        if (results && results[0] && results[0].result) {
            await processResults(results[0].result, tab);
        }
    } catch (e) {}
}

// === بررسی همه تب‌ها ===
async function checkAllTabs() {
    if (!isRunning) return;
    
    extensionStatus.lastCheck = Date.now();
    extensionStatus.totalChecks++;
    extensionStatus.isRunning = isRunning;
    
    try {
        const tabs = await chrome.tabs.query({});
        for (let tab of tabs) {
            await checkTab(tab);
        }
        await saveStatus();
    } catch (e) {}
}

// === ریست ===
function resetAll() {
    extensionStatus = {
        isRunning: true,
        startTime: Date.now(),
        lastCheck: null,
        totalChecks: 0,
        tabs: {},
        alerts: [],
        mutedTabs: {}
    };
    isRunning = true;
    saveStatus();
}

// === پیام‌ها ===
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'toggle') {
        isRunning = !isRunning;
        extensionStatus.isRunning = isRunning;
        saveStatus();
        sendResponse({ isRunning });
    } else if (msg.action === 'reset') {
        resetAll();
        sendResponse({ success: true });
    } else if (msg.action === 'clearAlerts') {
        extensionStatus.alerts = [];
        saveStatus();
        sendResponse({ success: true });
    } else if (msg.action === 'toggleMute') {
        extensionStatus.mutedTabs[msg.tabId] = !extensionStatus.mutedTabs[msg.tabId];
        saveStatus();
        sendResponse({ isMuted: extensionStatus.mutedTabs[msg.tabId] });
    } else if (msg.action === 'openDashboard') {
        chrome.tabs.create({ url: 'dashboard.html' });
        sendResponse({ success: true });
    }
    return true;
});

// === Alarm ===
chrome.alarms.create('check', { periodInMinutes: 0.05 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'check') checkAllTabs();
});

// === Keep-alive ===
setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);

// === شروع ===
console.log('🚀 Monitoring Alert v2.0');
loadStatus().then(() => {
    setupOffscreen();
    checkAllTabs();
});
