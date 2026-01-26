/**
 * SmartFinance - Restore Module
 * Handles:
 * 1. Conflict Detection (Timestamp comparison)
 * 2. Versioning (Selecting the latest file)
 * 3. Initial Setup (Empty state handling)
 */

// UI Helper to manage button state
function setRestoreLoading(isLoading) {
    const btn = document.getElementById('restoreDriveBtn');
    if (!btn) return;
    btn.disabled = isLoading;
    if (isLoading) {
        btn.innerHTML = '<i class="material-icons">sync</i> Restoring...';
    } else {
        btn.innerHTML = '<i class="material-icons">cloud_download</i> Restore from Drive';
    }
}

/**
 * Main Restore Flow
 * Triggered by the "Restore from Drive" button
 */
async function handleRestoreFlow() {
    // Ensure we have an access token (re-uses logic from sync.js)
    if (!accessToken) {
        // If sync.js has tokenClient initialized, request token
        if (typeof tokenClient !== 'undefined') {
            tokenClient.requestAccessToken({ prompt: 'consent' });
            // Note: User will need to click restore again after auth success
            return;
        } else {
            alert("Google API not initialized. Please refresh the page.");
            return;
        }
    }

    setRestoreLoading(true);

    try {
        // 1. Search for backup files in the appDataFolder
        // We order by modifiedTime descending to get the LATEST version first
        const query = encodeURIComponent("name='smartfinance_backup.json' and 'appDataFolder' in parents");
        const listUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder&orderBy=modifiedTime desc&fields=files(id, name, modifiedTime, size)`;

        const listResponse = await fetch(listUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        const listData = await listResponse.json();
        const files = listData.files;

        // CASE 3: Initial Setup / No Backups Found
        if (!files || files.length === 0) {
            alert("🔍 No backup found on Google Drive. Use 'Sync to Drive' first to create a backup.");
            setRestoreLoading(false);
            return;
        }

        // Get the metadata of the latest file
        const cloudFile = files[0];
        const cloudTime = new Date(cloudFile.modifiedTime);

        // 2. Fetch the actual JSON content of that file
        const contentUrl = `https://www.googleapis.com/drive/v3/files/${cloudFile.id}?alt=media`;
        const contentResponse = await fetch(contentUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        
        if (!contentResponse.ok) throw new Error("Failed to download file content");
        
        const driveData = await contentResponse.json();

        // 3. Compare with Local Data (CASE 1: Conflict Detection)
        // We check our IndexedDB (via listMonths) and our saved timestamp
        const localData = await listMonths(); // Assumes listMonths is in db.js or app.js
        const localLastSaved = localStorage.getItem('sf_last_saved');
        const localTime = localLastSaved ? new Date(parseInt(localLastSaved)) : new Date(0);

        // If local data exists, we must ask the user before overwriting
        if (localData && localData.length > 0) {
            const timeDiff = Math.round((cloudTime - localTime) / 60000); // Diff in minutes
            
            let timeMessage = "";
            if (timeDiff > 0) {
                timeMessage = `The Cloud backup is ${timeDiff} minutes NEWER than your local data.`;
            } else if (timeDiff < 0) {
                timeMessage = `Your Local data is ${Math.abs(timeDiff)} minutes NEWER than the Cloud backup.`;
            } else {
                timeMessage = `Cloud and Local data appear to be from the same time.`;
            }

            const confirmMsg = `Sync Conflict Check:\n\n` +
                               `☁️ Cloud: ${cloudTime.toLocaleString()}\n` +
                               `📱 Local: ${localTime.toLocaleString()}\n\n` +
                               `${timeMessage}\n\n` +
                               `Do you want to overwrite your local data with the Cloud version? This cannot be undone.`;

            if (confirm(confirmMsg)) {
                await executeRestore(driveData);
            }
        } else {
            // New Device / Fresh Install - Restore immediately after one confirmation
            if (confirm(`Found a backup from ${cloudTime.toLocaleString()}. Restore it to this device?`)) {
                await executeRestore(driveData);
            }
        }

    } catch (err) {
        console.error("Restore Process Error:", err);
        alert("❌ Restore failed. Error: " + err.message);
    } finally {
        setRestoreLoading(false);
    }
}

/**
 * Final step: Inject data into IndexedDB and refresh
 */
async function executeRestore(data) {
    try {
        // importFullBackup should be defined in your db.js
        await importFullBackup(data); 
        
        // Update local timestamp to match "now" so next sync/restore knows we are up to date
        localStorage.setItem('sf_last_saved', Date.now());
        
        alert("✅ Data Restored Successfully!");
        window.location.reload(); // Refresh to show new data
    } catch (err) {
        console.error("Database Injection Error:", err);
        alert("❌ Error writing data to local database.");
    }
}

// Attach event listener to the button
document.addEventListener('DOMContentLoaded', () => {
    const restoreBtn = document.getElementById('restoreDriveBtn');
    if (restoreBtn) {
        restoreBtn.addEventListener('click', handleRestoreFlow);
    }
});