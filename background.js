// === تنظیمات ===
const CHECK_INTERVAL = 3000; // ◄── تغییر: هر ۳ ثانیه (قبلاً ۵)
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
    alerts: []
};

// === پخش صدا ===
async function playAlarm() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].url && !tabs[0].url.startsWith('chrome://')) {
            await chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: () => {
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
                }
            });
        }
    } catch (e) {}
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
    
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: readGrafanaTable
        });
        
        if (!results || !results[0] || !results[0].result) return;
        
        const data = results[0].result;
        const now = Date.now();
        const fiveMinutesAgo = now - (HISTORY_MINUTES * 60 * 1000);
        
        const recentRows = data.rows.filter(row => row.timestamp >= fiveMinutesAgo);
        
        // Initialize tab status
        extensionStatus.tabs[tab.id] = {
            title: tab.title,
            url: tab.url,
            lastCheck: now,
            status: 'OK',
            totalRows: data.rows.length,
            recentRows: recentRows.length,
            lastValue: null,
            lastTime: null,
            average: null,           // ◄── جدید
            averageCount: 0,         // ◄── جدید
            alertWord: null,
            suddenChange: null
        };
        
        if (recentRows.length === 0) return;
        
        const latestRow = recentRows[recentRows.length - 1];
        extensionStatus.tabs[tab.id].lastValue = latestRow.value;
        extensionStatus.tabs[tab.id].lastTime = latestRow.timeText;
        
        let shouldAlarm = false;
        let alertReasons = [];
        
        // Check 1: Alert words
        if (!latestRow.isNumeric) {
            const foundWord = checkAlertPatterns(String(latestRow.value));
            if (foundWord) {
                extensionStatus.tabs[tab.id].status = 'ALERT';
                extensionStatus.tabs[tab.id].alertWord = foundWord;
                shouldAlarm = true;
                alertReasons.push(`کلمه "${foundWord}"`);
            }
        }
        
        // Check 2: Value is zero
        if (latestRow.isNumeric && latestRow.value === 0) {
            extensionStatus.tabs[tab.id].status = 'ALERT';
            shouldAlarm = true;
            alertReasons.push('مقدار = ۰');
        }
        
        // Check 3: Sudden change
        if (latestRow.isNumeric && recentRows.length >= 3) {
            const previousNumeric = recentRows
                .slice(0, -1)
                .filter(r => r.isNumeric)
                .map(r => r.value);
            
            if (previousNumeric.length >= 2) {
                const average = calculateAverage(previousNumeric);
                
                // ◄── جدید: ذخیره میانگین
                extensionStatus.tabs[tab.id].average = average;
                extensionStatus.tabs[tab.id].averageCount = previousNumeric.length;
                
                if (average > 0) {
                    const changePercent = Math.abs((latestRow.value - average) / average) * 100;
                    
                    if (changePercent >= CHANGE_THRESHOLD) {
                        extensionStatus.tabs[tab.id].status = 'ALERT';
                        extensionStatus.tabs[tab.id].suddenChange = {
                            average: average,
                            current: latestRow.value,
                            change: changePercent
                        };
                        shouldAlarm = true;
                        alertReasons.push(`تغییر ${changePercent.toFixed(1)}%`);
                    }
                }
            }
        }
        
        if (shouldAlarm) {
            extensionStatus.alerts.unshift({
                time: now,
                tabTitle: tab.title,
                detail: alertReasons.join(' + ')
            });
            
            if (extensionStatus.alerts.length > 50) {
                extensionStatus.alerts = extensionStatus.alerts.slice(0, 50);
            }
            
            await playAlarm();
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
        await chrome.storage.local.set({ extensionStatus });
    } catch (e) {}
}

// === دریافت پیام ===
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggle') {
        isRunning = !isRunning;
        extensionStatus.isRunning = isRunning;
        chrome.storage.local.set({ extensionStatus });
        sendResponse({ isRunning });
    } else if (message.action === 'clearAlerts') {
        extensionStatus.alerts = [];
        chrome.storage.local.set({ extensionStatus });
        sendResponse({ success: true });
    }
    return true;
});

// === شروع ===
console.log('🚀 Monitoring Alert شروع شد!');
setInterval(checkAllTabs, CHECK_INTERVAL);
checkAllTabs();