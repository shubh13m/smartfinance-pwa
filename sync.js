const CLIENT_ID = '301393332682-jgrlf96jip1jup4u5gkj89u9ccfk39nn.apps.googleusercontent.com'; // <--- Paste your ID here
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient;
let accessToken = null;

// Initialize the Google Identity Services client
function initSync() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: async (response) => {
      if (response.error !== undefined) throw (response);
      accessToken = response.access_token;
      await uploadToDrive();
    },
  });
}

async function uploadToDrive() {
  const content = await exportFullBackup();
  const fileContent = new Blob([content], { type: 'application/json' });
  
  // Metadata for the hidden AppData folder
  const metadata = {
    name: 'smartfinance_backup.json',
    parents: ['appDataFolder']
  };

  const formData = new FormData();
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  formData.append('file', fileContent);

  try {
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: formData
    });
    
    if (response.ok) {
      alert("✅ Sync Complete! Your data is safe in Google Drive.");
    } else {
      alert("❌ Sync failed. Check console for details.");
    }
  } catch (err) {
    console.error("Upload error:", err);
  }
}

// Attach event listener to your button
document.getElementById('syncDriveBtn').addEventListener('click', () => {
  if (!accessToken) {
    initSync();
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    uploadToDrive();
  }
});
