const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// Serve static files from the current directory (for frontend)
app.use(express.static(__dirname));

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── Smart Merge Helper ──
function smartMerge(local, remote) {
    if (!remote) return local;
    if (!local) return remote;

    // For non-array objects (supplier, permissions), just take the newest if available
    if (!Array.isArray(local) || !Array.isArray(remote)) {
        if (remote.updatedAt && local.updatedAt) {
            return remote.updatedAt > local.updatedAt ? remote : local;
        }
        return remote; // Default to remote if no timestamps
    }

    const map = new Map();
    // Add local items
    local.forEach(item => {
        if (item && item.id) map.set(item.id, item);
    });
    // Merge remote items
    remote.forEach(remoteItem => {
        if (!remoteItem || !remoteItem.id) return;
        const localItem = map.get(remoteItem.id);
        if (!localItem || (remoteItem.updatedAt || 0) >= (localItem.updatedAt || 0)) {
            map.set(remoteItem.id, remoteItem);
        }
    });

    return Array.from(map.values());
}

// ── API Routes ──

// Generic GET for a key
app.get('/api/data/:key', (req, res) => {
    const key = req.params.key;
    const filePath = path.join(DATA_DIR, `${key}.json`);

    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            res.json(JSON.parse(data));
        } else {
            // Return empty array or object based on key type
            if (key.includes('supplier') || key.includes('permission')) {
                res.json({});
            } else {
                res.json([]);
            }
        }
    } catch (err) {
        console.error(`Error reading ${key}:`, err);
        res.status(500).json({ error: 'Failed to read data' });
    }
});

// Generic POST to sync/merge data for a key
app.post('/api/data/:key', (req, res) => {
    const key = req.params.key;
    const filePath = path.join(DATA_DIR, `${key}.json`);
    const clientData = req.body;

    try {
        let serverData;
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            serverData = JSON.parse(data);
        } else {
            serverData = (key.includes('supplier') || key.includes('permission')) ? {} : [];
        }

        // Merge client data with server data
        const mergedData = smartMerge(serverData, clientData);

        // Save back to file
        fs.writeFileSync(filePath, JSON.stringify(mergedData, null, 2), 'utf8');
        
        // Return merged data to client
        res.json(mergedData);
    } catch (err) {
        console.error(`Error saving ${key}:`, err);
        res.status(500).json({ error: 'Failed to save data' });
    }
});

// Explicit Clear API for Delete All functionality
app.post('/api/clear/:key', (req, res) => {
    const key = req.params.key;
    const filePath = path.join(DATA_DIR, `${key}.json`);
    try {
        const emptyData = (key.includes('supplier') || key.includes('permission')) ? {} : [];
        fs.writeFileSync(filePath, JSON.stringify(emptyData, null, 2), 'utf8');
        res.json(emptyData);
    } catch (err) {
        console.error(`Error clearing ${key}:`, err);
        res.status(500).json({ error: 'Failed to clear data' });
    }
});

// Special Batch API for deep sync
app.get('/api/sync-all', (req, res) => {
    try {
        const files = fs.readdirSync(DATA_DIR);
        const batchData = {};
        
        files.forEach(file => {
            if (file.endsWith('.json')) {
                const key = file.replace('.json', '');
                const data = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
                batchData[key] = JSON.parse(data);
            }
        });
        
        res.json(batchData);
    } catch (err) {
        console.error('Error in sync-all:', err);
        res.status(500).json({ error: 'Failed to batch read' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Vastra Server running on http://localhost:${PORT}`);
});
