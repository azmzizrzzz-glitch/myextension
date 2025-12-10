// === تنظیمات ===
const CHECK_INTERVAL_MINUTES = 0.05; // 3 ثانیه
const HISTORY_MINUTES = 5;
const CHANGE_THRESHOLD = 50;
let isRunning = true;

// === کلمات خطرناک ===
const ALERT_PATTERNS = [
    /\bDOWN\b/i,
    /\bDisconnect\b/i,
    /\bDisconnected\b/i,
    /\bError\b/i,
    /\bCritical\b/i,
    /\bFailed\b/i,
    /\bFailure\b/i,
    /\bUnreachable\b/i,
    /\bOffline\b/i,
    /\bTimeout\b/i
];

// === کلمات امن ===
const SAFE_WORDS = ['download', 'dropdown', 'markdown', 'breakdown'];

// === ذخیره وضعیت ===
let extensionStatus = {
    isRunning: true,
    startTime: Date.now(),
    lastCheck: null,
    totalChecks: 0,
    tabs: {},
    alerts: [],
    mutedTabs: {}  // ◄── جدید: تب‌های mute شده
};

// === بارگذاری وضعیت از storage ===
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

// === ایجاد offscreen document برای پخش صدا ===
async function setupOffscreen() {
    try {
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });
        
        if (existingContexts.length === 0) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['AUDIO_PLAYBACK'],
                justification: 'پخش آلارم صوتی'
            });
        }
    } catch (e) {
        console.log('Offscreen setup error:', e);
    }
}

// === پخش صدا ===
async function playAlarm() {
    try {
        await setupOffscreen();
        await chrome.runtime.sendMessage({ action: 'playSound' });
    } catch (e) {
        console.log('Alarm error:', e);
    }
}

// === خواندن جدول Grafana ===
function readGrafanaTable() {
    const result = {
        rows: [],
        error: null
    };
    
    try {
        const rowElements = document.querySelectorAll('[role="row"]');
        
        for (let row of rowElements) {
            const cells = row.querySelectorAll('[role="cell"]');
            
            if (cells.length >= 2) {
                const timeText = cells[0].innerText.trim();
                const valueText = cells[1].innerText.trim();
                
                const timeMatch = timeText.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
                
                if (timeMatch) {
                    const timestamp = new Date(timeMatch[1] + 'T' + timeMatch[2]).getTime();
                    const numValue = parseFloat(valueText);
                    
                    result.rows.push({
                        timestamp: timestamp,
                        timeText: timeText,
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

// === جستجوی کل صفحه برای کلمات خطرناک ===
function scanFullPage() {
    const result = {
        foundWords: [],
        error: null
    };
    
    try {
        const safeWords = ['download', 'dropdown', 'markdown', 'breakdown'];
        const alertPatterns = [
            /\bDOWN\b/gi,
            /\bDisconnect\b/gi,
            /\bDisconnected\b/gi,
            /\bError\b/gi,
            /\bCritical\b/gi,
            /\bFailed\b/gi,
            /\bFailure\b/gi,
            /\bUnreachable\b/gi,
            /\bOffline\b/gi,
            /\bTimeout\b/gi
        ];
        
        let pageText = document.body.innerText || '';
        
        for (let word of safeWords) {
            pageText = pageText.replace(new RegExp(word, 'gi'), '___SAFE___');
        }
        
        for (let pattern of alertPatterns) {
            const matches = pageText.match(pattern);
            if (matches) {
                for (let match of matches) {
                    if (!result.foundWords.includes(match.toUpperCase())) {
                        result.foundWords.push(match.toUpperCase());
                    }
                }
            }
        }
        
    } catch (e) {
        result.error = e.message;
    }
    
    return result;
}

// === حذف کلمات امن ===
function removeSafeWords(text) {
    let cleanText = text.toLowerCase();
    for (let word of SAFE_WORDS) {
        cleanText = cleanText.replace(new RegExp(word, 'gi'), '___');
    }
    return cleanText;
}

// === بررسی کلمات خطرناک ===
function checkAlertPatterns(text) {
    const cleanText = removeSafeWords(text);
    for (let pattern of ALERT_PATTERNS) {
        if (pattern.test(cleanText)) {
            const match = cleanText.match(pattern);
            return match ? match[0].toUpperCase() : 'ALERT';
        }
    }
    return null;
}

// === محاسبه میانگین ===
function calculateAverage(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// === بررسی یک تب ===
async function checkTab(tab) {
    if (!tab.url) return;
    if (tab.url.startsWith('chrome://')) return;
    if (tab.url.startsWith('chrome-extension://')) return;
    
    // بررسی mute
    const isMuted = extensionStatus.mutedTabs[tab.id] === true;
    
    try {
        const tableResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: readGrafanaTable
        });
        
        const pageResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: scanFullPage
        });
        
        const now = Date.now();
        
        extensionStatus.tabs[tab.id] = {
            title: tab.title,
            url: tab.url,
            lastCheck: now,
            status: 'OK',
            totalRows: 0,
            recentRows: 0,
            lastValue: null,
            lastTime: null,
            average: null,
            averageCount: 0,
            alertWord: null,
            pageAlertWords: [],
            suddenChange: null,
            zeroValue: false,
            isMuted: isMuted  // ◄── جدید
        };
        
        let shouldAlarm = false;
        let alertReasons = [];
        
        // === Check 1: کلمات خطرناک در کل صفحه ===
        if (pageResults && pageResults[0] && pageResults[0].result) {
            const pageData = pageResults[0].result;
            if (pageData.foundWords && pageData.foundWords.length > 0) {
                extensionStatus.tabs[tab.id].status = 'ALERT';
                extensionStatus.tabs[tab.id].pageAlertWords = pageData.foundWords;
                if (!isMuted) {
                    shouldAlarm = true;
                    alertReasons.push(`صفحه: ${pageData.foundWords.join(', ')}`);
                }
            }
        }
        
        if (!tableResults || !tableResults[0] || !tableResults[0].result) {
            if (shouldAlarm && !isMuted) {
                extensionStatus.alerts.unshift({
                    time: now,
                    tabTitle: tab.title,
                    tabId: tab.id,
                    detail: alertReasons.join(' + ')
                });
                if (extensionStatus.alerts.length > 50) {
                    extensionStatus.alerts = extensionStatus.alerts.slice(0, 50);
                }
                await playAlarm();
            }
            return;
        }
        
        const data = tableResults[0].result;
        const fiveMinutesAgo = now - (HISTORY_MINUTES * 60 * 1000);
        const recentRows = data.rows.filter(row => row.timestamp >= fiveMinutesAgo);
        
        extensionStatus.tabs[tab.id].totalRows = data.rows.length;
        extensionStatus.tabs[tab.id].recentRows = recentRows.length;
        
        if (recentRows.length === 0) {
            if (shouldAlarm && !isMuted) {
                extensionStatus.alerts.unshift({
                    time: now,
                    tabTitle: tab.title,
                    tabId: tab.id,
                    detail: alertReasons.join(' + ')
                });
                if (extensionStatus.alerts.length > 50) {
                    extensionStatus.alerts = extensionStatus.alerts.slice(0, 50);
                }
                await playAlarm();
            }
            return;
        }
        
        const latestRow = recentRows[recentRows.length - 1];
        extensionStatus.tabs[tab.id].lastValue = latestRow.value;
        extensionStatus.tabs[tab.id].lastTime = latestRow.timeText;
        
        // === Check 2: کلمات خطرناک در جدول ===
        if (!latestRow.isNumeric) {
            const foundWord = checkAlertPatterns(String(latestRow.value));
            if (foundWord) {
                extensionStatus.tabs[tab.id].status = 'ALERT';
                extensionStatus.tabs[tab.id].alertWord = foundWord;
                if (!isMuted) {
                    shouldAlarm = true;
                    alertReasons.push(`جدول: "${foundWord}"`);
                }
            }
        }
        
        // === Check 3: مقدار صفر ===
        if (latestRow.isNumeric && latestRow.value === 0) {
            extensionStatus.tabs[tab.id].status = 'ALERT';
            extensionStatus.tabs[tab.id].zeroValue = true;
            if (!isMuted) {
                shouldAlarm = true;
                alertReasons.push('مقدار = ۰');
            }
        }
        
        // === Check 4: کاهش بیش از ۵۰٪ ===
        if (latestRow.isNumeric && recentRows.length >= 3) {
            const previousNumeric = recentRows
                .slice(0, -1)
                .filter(r => r.isNumeric)
                .map(r => r.value);
            
            if (previousNumeric.length >= 2) {
                const average = calculateAverage(previousNumeric);
                
                extensionStatus.tabs[tab.id].average = average;
                extensionStatus.tabs[tab.id].averageCount = previousNumeric.length;
                
                if (average > 0) {
                    const changePercent = ((average - latestRow.value) / average) * 100;
                    
                    if (changePercent >= CHANGE_THRESHOLD) {
                        extensionStatus.tabs[tab.id].status = 'ALERT';
                        extensionStatus.tabs[tab.id].suddenChange = {
                            average: average,
                            current: latestRow.value,
                            change: changePercent,
                            direction: 'کاهش'
                        };
                        if (!isMuted) {
                            shouldAlarm = true;
                            alertReasons.push(`کاهش ${changePercent.toFixed(1)}%`);
                        }
                    }
                }
            }
        }
        
        // === ثبت آلارم ===
        if (shouldAlarm && !isMuted) {
            extensionStatus.alerts.unshift({
                time: now,
                tabTitle: tab.title,
                tabId: tab.id,
                detail: alertReasons.join(' + ')
            });
            
            if (extensionStatus.alerts.length > 50) {
                extensionStatus.alerts = extensionStatus.alerts.slice(0, 50);
            }
            
            await playAlarm();
        }
        
    } catch (e) {
        console.log('Check tab error:', e);
    }
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
    } catch (e) {
        console.log('Check all tabs error:', e);
    }
}

// === ریست کامل ===
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
    checkAllTabs();
}

// === دریافت پیام ===
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggle') {
        isRunning = !isRunning;
        extensionStatus.isRunning = isRunning;
        saveStatus();
        sendResponse({ isRunning });
    } else if (message.action === 'clearAlerts') {
        extensionStatus.alerts = [];
        saveStatus();
        sendResponse({ success: true });
    } else if (message.action === 'reset') {
        resetAll();
        sendResponse({ success: true });
    } else if (message.action === 'toggleMute') {
        const tabId = message.tabId;
        extensionStatus.mutedTabs[tabId] = !extensionStatus.mutedTabs[tabId];
        if (extensionStatus.tabs[tabId]) {
            extensionStatus.tabs[tabId].isMuted = extensionStatus.mutedTabs[tabId];
        }
        saveStatus();
        sendResponse({ isMuted: extensionStatus.mutedTabs[tabId] });
    } else if (message.action === 'getStatus') {
        sendResponse({ extensionStatus });
    } else if (message.action === 'openDashboard') {
        chrome.tabs.create({ url: 'dashboard.html' });
        sendResponse({ success: true });
    }
    return true;
});

// === استفاده از chrome.alarms ===
chrome.alarms.create('checkTabs', { 
    delayInMinutes: CHECK_INTERVAL_MINUTES,
    periodInMinutes: CHECK_INTERVAL_MINUTES
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkTabs') {
        checkAllTabs();
    }
});

// === Keep-alive ===
const keepAlive = () => {
    chrome.runtime.getPlatformInfo(() => {});
};
setInterval(keepAlive, 20000);

// === شروع ===
console.log('🚀 Monitoring Alert v2.0 شروع شد!');
loadStatus().then(() => {
    setupOffscreen();
    checkAllTabs();
});
