/* ================================================
   VASTRA – Local Server Sync Layer (Smart Merge)
   Replaces Firebase Sync
================================================ */

const SERVER_URL = 'https://flavored-ambiance-grandson.ngrok-free.dev';

const SYNC_KEYS = [
    'vastra_challans',
    'vastra_packs',
    'vastra_customers',
    'vastra_agents',
    'vastra_invoices',
    'vastra_salesReturns',
    'vastra_categoryTypes',
    'vastra_role_permissions',
    'vastra_supplier'
];

// ── State ────────────────────────────────────────
let serverReady = true;
let _suppressServerWrite = false; // prevent write loops
let _syncDebounceTimers = {};
let _lastLocalJSON = {}; // Cache to avoid redundant stringify/parse

// ── Status UI ────────────────────────────────────
function updateSyncStatus(status) {
    const el = document.getElementById('syncStatusIndicator');
    if (!el) return;
    
    switch(status) {
        case 'online':
            el.innerHTML = '<i class="fa fa-server" style="color:#4caf50"></i>';
            el.title = 'Connected to Server';
            break;
        case 'offline':
            el.innerHTML = '<i class="fa fa-server" style="color:#9e9e9e"></i>';
            el.title = 'Offline';
            break;
        case 'syncing':
            el.innerHTML = '<i class="fa fa-sync fa-spin" style="color:#0088cc"></i>';
            el.title = 'Syncing...';
            break;
    }
}

// ── Helpers ──────────────────────────────────────
function smartMerge(local, remote) {
    if (!remote) return local;
    if (!local) return remote;

    if (!Array.isArray(local) || !Array.isArray(remote)) {
        if (remote.updatedAt && local.updatedAt) {
            return remote.updatedAt > local.updatedAt ? remote : local;
        }
        return remote;
    }

    const map = new Map();
    local.forEach(item => {
        if (item && item.id) map.set(item.id, item);
    });
    remote.forEach(remoteItem => {
        if (!remoteItem || !remoteItem.id) return;
        const localItem = map.get(remoteItem.id);
        if (!localItem || (remoteItem.updatedAt || 0) >= (localItem.updatedAt || 0)) {
            map.set(remoteItem.id, remoteItem);
        }
    });

    return Array.from(map.values());
}

// ── Initialization ───────────────────────────────
function serverInit() {
    updateSyncStatus('online');
    
    // Initial sync: fetch everything first
    SYNC_KEYS.forEach(key => pullAndMerge(key));
    pullAndMergeDesigns();
    startDeepSyncPoller();
}

// ── Pull and Merge ───────────────────────────────
async function pullAndMerge(key) {
    if (!serverReady) return;
    updateSyncStatus('syncing');
    
    try {
        const response = await fetch(`${SERVER_URL}/api/data/${key}`, {
            headers: { 'ngrok-skip-browser-warning': '69420' }
        });
        if (!response.ok) throw new Error('Network response was not ok');
        const serverData = await response.json();

        const localData = JSON.parse(localStorage.getItem(key) || (key.includes('supplier') || key.includes('permission') ? '{}' : '[]'));
        const merged = smartMerge(localData, serverData);

        const mergedJSON = JSON.stringify(merged);
        const localJSON = JSON.stringify(localData);
        _lastLocalJSON[key] = mergedJSON;
        
        if (mergedJSON !== localJSON) {
            _suppressServerWrite = true;
            localStorage.setItem(key, mergedJSON);
            _suppressServerWrite = false;
            console.log(`⬇️ Merged ${key} from Server`);
            if (typeof refreshUIForKey === 'function') refreshUIForKey(key);
        }
    } catch (err) {
        console.error(`Error pulling ${key}:`, err);
        updateSyncStatus('offline');
    } finally {
        updateSyncStatus('online');
    }
}

async function pullAndMergeDesigns() {
    if (!serverReady || typeof VastraDB === 'undefined') return;
    updateSyncStatus('syncing');
    
    try {
        const response = await fetch(`${SERVER_URL}/api/data/vastra_designs`, {
            headers: { 'ngrok-skip-browser-warning': '69420' }
        });
        if (!response.ok) throw new Error('Network response was not ok');
        let serverData = await response.json();
        if (!Array.isArray(serverData) && typeof serverData === 'object') serverData = Object.values(serverData);

        const localDesigns = await VastraDB.getAll();
        const merged = smartMerge(localDesigns, serverData);
        merged.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }));
        const mergedJSON = JSON.stringify(merged);
        _lastLocalJSON['vastra_designs'] = mergedJSON;

        if (mergedJSON !== JSON.stringify(localDesigns)) {
            _suppressServerWrite = true;
            await VastraDB.saveAll(merged);
            _suppressServerWrite = false;
            console.log(`⬇️ Merged vastra_designs from Server`);
            if (typeof refreshUIForKey === 'function') refreshUIForKey('vastra_designs');

            window.syncDesignsToServerManual();
        }
    } catch (err) {
        console.error(`Error pulling vastra_designs:`, err);
    } finally {
        updateSyncStatus('online');
    }
}

// ── Transactional Sync ──────────────────────────
function syncToServer(key) {
    if (!serverReady || _suppressServerWrite) return;

    clearTimeout(_syncDebounceTimers[key]);
    _syncDebounceTimers[key] = setTimeout(async () => {
        const localDataRaw = localStorage.getItem(key);
        if (!localDataRaw || localDataRaw === _lastLocalJSON[key]) return;

        const localData = JSON.parse(localDataRaw);
        updateSyncStatus('syncing');

        try {
            const response = await fetch(`${SERVER_URL}/api/data/${key}`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': '69420'
                },
                body: JSON.stringify(localData)
            });
            if (!response.ok) throw new Error('Network response was not ok');
            
            const finalData = await response.json();
            const finalJSON = JSON.stringify(finalData);
            _lastLocalJSON[key] = finalJSON;
            
            if (finalJSON !== localDataRaw) {
                _suppressServerWrite = true;
                localStorage.setItem(key, finalJSON);
                _suppressServerWrite = false;
                console.log(`✅ ${key} synced & merged with server updates`);
                if (typeof refreshUIForKey === 'function') refreshUIForKey(key);
            } else {
                console.log(`✅ ${key} synced to server`);
            }
        } catch (err) {
            console.error(`Sync transaction failed for ${key}:`, err);
        } finally {
            updateSyncStatus('online');
        }
    }, 100);
}

window.syncDesignsToServerManual = async function () {
    if (!serverReady || _suppressServerWrite || typeof VastraDB === 'undefined') return;

    clearTimeout(_syncDebounceTimers['vastra_designs']);
    _syncDebounceTimers['vastra_designs'] = setTimeout(async () => {
        try {
            const localDesigns = await VastraDB.getAll();
            const localDataStr = JSON.stringify(localDesigns);
            
            if (localDataStr === _lastLocalJSON['vastra_designs']) return;

            updateSyncStatus('syncing');
            
            const response = await fetch(`${SERVER_URL}/api/data/vastra_designs`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': '69420'
                },
                body: JSON.stringify(localDesigns)
            });
            
            if (!response.ok) throw new Error('Network error');
            const finalData = await response.json();
            
            let serverData = finalData;
            if (!Array.isArray(serverData) && typeof serverData === 'object') serverData = Object.values(serverData);
            
            const finalJSON = JSON.stringify(serverData);
            _lastLocalJSON['vastra_designs'] = finalJSON;

            if (finalJSON !== localDataStr) {
                _suppressServerWrite = true;
                await VastraDB.saveAll(serverData);
                _suppressServerWrite = false;
                console.log('✅ designs synced & merged with server updates');
                if (typeof refreshUIForKey === 'function') refreshUIForKey('vastra_designs');
            } else {
                console.log('✅ designs synced to server');
            }
        } catch (e) {
            console.error("Manual sync designs error:", e);
        } finally {
            updateSyncStatus('online');
        }
    }, 150);
}

// ── Background Deep Sync (Every 15s) ──────────
function startDeepSyncPoller() {
    setInterval(async () => {
        if (!serverReady || _suppressServerWrite) return;
        
        // console.log('🔄 Deep Sync: Batch verification...');
        updateSyncStatus('syncing');

        try {
            const response = await fetch(`${SERVER_URL}/api/sync-all`, {
                headers: { 'ngrok-skip-browser-warning': '69420' }
            });
            if (!response.ok) throw new Error('Network error');
            const cloudBatch = await response.json();

            if (!cloudBatch) return;

            SYNC_KEYS.forEach(key => {
                const cloudData = cloudBatch[key];
                if (cloudData) {
                    const cloudJSON = JSON.stringify(cloudData);
                    if (cloudJSON !== _lastLocalJSON[key]) {
                        const localData = JSON.parse(localStorage.getItem(key) || (key.includes('supplier') ? '{}' : '[]'));
                        const merged = smartMerge(localData, cloudData);
                        const mergedJSON = JSON.stringify(merged);
                        
                        if (mergedJSON !== JSON.stringify(localData)) {
                            _suppressServerWrite = true;
                            localStorage.setItem(key, mergedJSON);
                            _suppressServerWrite = false;
                            _lastLocalJSON[key] = mergedJSON;
                            console.log(`⬇️ Batch update applied for ${key}`);
                            if (typeof refreshUIForKey === 'function') refreshUIForKey(key);
                        } else {
                            _lastLocalJSON[key] = mergedJSON;
                        }
                    }
                }
            });

            const cloudDesigns = cloudBatch['vastra_designs'];
            if (cloudDesigns && typeof VastraDB !== 'undefined') {
                let serverData = cloudDesigns;
                if (!Array.isArray(serverData) && typeof serverData === 'object') serverData = Object.values(serverData);
                const serverDataStr = JSON.stringify(serverData);
                
                if (serverDataStr !== _lastLocalJSON['vastra_designs']) {
                    const localDesigns = await VastraDB.getAll();
                    const merged = smartMerge(localDesigns, serverData);
                    merged.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }));
                    const mergedStr = JSON.stringify(merged);
                    
                    if (mergedStr !== JSON.stringify(localDesigns)) {
                        _suppressServerWrite = true;
                        _lastLocalJSON['vastra_designs'] = mergedStr;
                        await VastraDB.saveAll(merged);
                        _suppressServerWrite = false;
                        console.log(`⬇️ Batch update applied for vastra_designs`);
                        if (typeof refreshUIForKey === 'function') refreshUIForKey('vastra_designs');
                    } else {
                        _lastLocalJSON['vastra_designs'] = mergedStr;
                    }
                }
            }
        } catch (e) {
            console.error("Deep sync poller error:", e);
        } finally {
            updateSyncStatus('online');
        }
    }, 15000);
}

// ── UI Refresh ───────────────────────────────────
function refreshUIForKey(key) {
    try {
        switch (key) {
            case 'vastra_designs':
                if (typeof VastraDB !== 'undefined') {
                    VastraDB.getAll().then(res => {
                        designs = res.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }));
                        if (typeof renderDesignsTable === 'function') renderDesignsTable();
                        if (typeof updateStats === 'function') updateStats();
                    });
                }
                break;
            case 'vastra_challans':
                challans = JSON.parse(localStorage.getItem('vastra_challans') || '[]');
                if (typeof renderChallanList === 'function') renderChallanList();
                if (typeof updateStats === 'function') updateStats();
                if (typeof currentDetailChallan !== 'undefined' && currentDetailChallan && typeof renderChallanDetail === 'function') {
                    const fresh = challans.find(c => c.id === currentDetailChallan.id);
                    if (fresh) renderChallanDetail(fresh);
                }
                if (typeof renderLiveStock === 'function') renderLiveStock();
                if (typeof renderLowStockAlert === 'function') renderLowStockAlert();
                break;
            case 'vastra_packs':
                if (typeof renderPackList === 'function') renderPackList();
                if (typeof renderLiveStock === 'function') renderLiveStock();
                if (typeof renderLowStockAlert === 'function') renderLowStockAlert();
                break;
            case 'vastra_customers':
                customers = JSON.parse(localStorage.getItem('vastra_customers') || '[]');
                if (typeof updateStats === 'function') updateStats();
                if (typeof renderCustomerSelectList === 'function') renderCustomerSelectList();
                break;
            case 'vastra_agents':
                agents = JSON.parse(localStorage.getItem('vastra_agents') || '[]');
                if (typeof renderAgentList === 'function') renderAgentList();
                break;
            case 'vastra_salesReturns':
                salesReturns = JSON.parse(localStorage.getItem('vastra_salesReturns') || '[]');
                if (typeof renderSRList === 'function') renderSRList();
                if (typeof renderLiveStock === 'function') renderLiveStock();
                if (typeof renderLowStockAlert === 'function') renderLowStockAlert();
                break;
            case 'vastra_invoices':
                if (typeof invoices !== 'undefined') invoices = JSON.parse(localStorage.getItem('vastra_invoices') || '[]');
                break;
            case 'vastra_categoryTypes':
                categoryTypes = JSON.parse(localStorage.getItem('vastra_categoryTypes') || '[]');
                if (typeof renderCategoryTypeList === 'function') renderCategoryTypeList();
                break;
            case 'vastra_role_permissions':
                if (typeof applyPermissions === 'function') applyPermissions();
                if (typeof renderPermissionsTable === 'function') renderPermissionsTable();
                break;
            case 'vastra_supplier':
                break;
        }
    } catch (e) {
        console.warn('UI refresh error for ' + key + ':', e);
    }
}

// ── Override localStorage.setItem ────────────────
const _originalSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function (key, value) {
    _originalSetItem(key, value);

    if (SYNC_KEYS.includes(key) && !_suppressServerWrite) {
        syncToServer(key);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    serverInit();

    if (typeof VastraDB !== 'undefined') {
        if (typeof VastraDB.saveAll === 'function') {
            const _origSaveAll = VastraDB.saveAll.bind(VastraDB);
            VastraDB.saveAll = async function (data) {
                const result = await _origSaveAll(data);
                if (!_suppressServerWrite) window.syncDesignsToServerManual();
                return result;
            };
        }
        if (typeof VastraDB.saveItem === 'function') {
            const _origSaveItem = VastraDB.saveItem.bind(VastraDB);
            VastraDB.saveItem = async function (item) {
                const result = await _origSaveItem(item);
                if (!_suppressServerWrite) window.syncDesignsToServerManual();
                return result;
            };
        }
    }
});
