const CLIENT_ID = '301393332682-jgrlf96jip1jup4u5gkj89u9ccfk39nn.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient;
let accessToken = null;

// Initialize the Google Identity Services client
function initSync() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: async (response) => {
      if (response.error !== undefined) {
        setSyncLoading(false);
        throw (response);
      }
      accessToken = response.access_token;
      await uploadToDrive();
    },
  });
}

// Helper to find if the backup file already exists to prevent duplicates
// Modified to return both ID and Size for the data loss check
async function findExistingFileMetadata() {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='smartfinance_backup.json'+and+'appDataFolder'+in+parents&spaces=appDataFolder&fields=files(id, size)`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    }
  );
  const data = await response.json();
  return (data.files && data.files.length > 0) ? data.files[0] : null;
}

async function uploadToDrive() {
  setSyncLoading(true);
  try {
    const content = await exportFullBackup();
    const fileContent = new Blob([content], { type: 'application/json' });
    const localSize = fileContent.size;
    
    const existingFile = await findExistingFileMetadata();
    let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    let method = 'POST';
    let fileId = null;

    // CASE 4: Silent Data Loss Check
    if (existingFile) {
      fileId = existingFile.id;
      const cloudSize = parseInt(existingFile.size || 0);

      // If local data is >50% smaller than cloud data, trigger a safety warning
      if (cloudSize > 0 && localSize < (cloudSize * 0.5)) {
        const warningMsg = `⚠️ Warning: Your local data is significantly smaller than your Drive backup (${Math.round(localSize/1024)}KB vs ${Math.round(cloudSize/1024)}KB).\n\nAre you sure you want to overwrite the cloud backup? This might lead to data loss.`;
        if (!confirm(warningMsg)) {
          setSyncLoading(false);
          return;
        }
      }

      url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
      method = 'PATCH';
    }

    const metadata = {
      name: 'smartfinance_backup.json',
      parents: fileId ? [] : ['appDataFolder'] // Parents only needed for new files
    };

    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('file', fileContent);

    const response = await fetch(url, {
      method: method,
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: formData
    });
    
    if (response.ok) {
      // Update local timestamp upon successful cloud sync
      localStorage.setItem('sf_last_saved', Date.now());
      alert("✅ Sync Complete! Your data is updated in Google Drive.");
    } else {
      const errData = await response.json();
      console.error("Sync Error Details:", errData);
      alert("❌ Sync failed. See console for details.");
    }
  } catch (err) {
    console.error("Upload error:", err);
    alert("❌ An error occurred during sync.");
  } finally {
    setSyncLoading(false);
  }
}

// Helper to manage UI state during sync
function setSyncLoading(isLoading) {
  const btn = document.getElementById('syncDriveBtn');
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    btn.innerHTML = '<i class="material-icons">sync</i> Syncing...';
  } else {
    btn.disabled = false;
    btn.innerHTML = '<i class="material-icons">cloud_upload</i> Sync to Drive';
  }
}

// Attach event listener
document.getElementById('syncDriveBtn').addEventListener('click', () => {
  setSyncLoading(true);
  if (!accessToken) {
    if (!tokenClient) initSync();
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    uploadToDrive();
  }
});