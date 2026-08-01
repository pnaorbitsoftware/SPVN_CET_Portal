// public/pwa.js — PWA registration, install prompt, offline answer queue

// ── Service Worker Registration ──────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('[PWA] Service worker registered:', reg.scope);

      // Check for SW updates
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });
    } catch (err) {
      console.warn('[PWA] SW registration failed:', err.message);
    }
  });
}

// ── Login-page Install Prompt (Android WebAPK / Add to Home Screen) ──────────
let deferredInstallPrompt = null;

function installButton() {
  return document.getElementById('pwa-install-trigger');
}

function installStatus() {
  return document.getElementById('pwa-install-status');
}

function isInstalledApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function setInstallStatus(message, installed = false) {
  const status = installStatus();
  if (status) {
    status.textContent = message;
    status.className = `mt-2 text-center text-[11px] leading-relaxed ${installed ? 'text-emerald-700' : 'text-indigo-700'}`;
  }
  const button = installButton();
  if (button && installed) {
    button.disabled = true;
    button.classList.add('opacity-70', 'cursor-default');
    button.lastChild.textContent = ' App Installed';
  }
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installButton()) setInstallStatus('Ready to install. Tap the button to continue.');
});

async function requestAppInstall() {
  if (isInstalledApp()) {
    setInstallStatus('SPVN App is already installed on this device.', true);
    return;
  }

  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log('[PWA] Install outcome:', outcome);
    deferredInstallPrompt = null;
    setInstallStatus(
      outcome === 'accepted'
        ? 'Installation started. The SPVN App will appear on your home screen.'
        : 'Installation was cancelled. You can try again from the browser menu.'
    );
    return;
  }

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  setInstallStatus(
    isIOS
      ? 'On iPhone/iPad: tap Share, then choose Add to Home Screen.'
      : 'On Android Chrome: open the ⋮ menu and tap Install app or Add to Home screen.'
  );
}

document.addEventListener('DOMContentLoaded', () => {
  const button = installButton();
  if (!button) return;
  button.addEventListener('click', requestAppInstall);
  if (isInstalledApp()) setInstallStatus('SPVN App is already installed on this device.', true);
});

window.addEventListener('appinstalled', () => {
  console.log('[PWA] App installed!');
  setInstallStatus('SPVN App installed successfully.', true);
});

// ── Update Banner ─────────────────────────────────────────────────────────────
function showUpdateBanner() {
  const banner = document.createElement('div');
  banner.className = 'fixed top-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 bg-green-700 text-white rounded-xl shadow-xl p-4 z-50 flex items-center gap-3';
  banner.innerHTML = `
    <span class="text-xl">🔄</span>
    <div class="flex-1">
      <p class="font-semibold text-sm">Update Available</p>
      <p class="text-xs text-green-200 mt-0.5">A new version is ready.</p>
    </div>
    <button onclick="window.location.reload()" class="bg-white text-green-700 font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
      Refresh
    </button>
  `;
  document.body.appendChild(banner);
}

// ── Online / Offline Status Banner ───────────────────────────────────────────
let offlineBanner = null;

function showOfflineBanner() {
  if (offlineBanner) return;
  offlineBanner = document.createElement('div');
  offlineBanner.id = 'offline-status-bar';
  offlineBanner.className = 'fixed top-0 left-0 right-0 bg-red-600 text-white text-xs font-semibold py-2 text-center z-[999] flex items-center justify-center gap-2';
  offlineBanner.innerHTML = `
    <span class="w-2 h-2 bg-white rounded-full inline-block animate-pulse"></span>
    You're offline — answers are saved locally and will sync when connection is restored
  `;
  document.body.insertBefore(offlineBanner, document.body.firstChild);
}

function hideOfflineBanner() {
  if (offlineBanner) {
    offlineBanner.className = offlineBanner.className.replace('bg-red-600', 'bg-green-600');
    offlineBanner.innerHTML = `<span>✅ Back online — syncing your data...</span>`;
    setTimeout(() => { offlineBanner?.remove(); offlineBanner = null; }, 3000);
  }
}

window.addEventListener('online',  hideOfflineBanner);
window.addEventListener('offline', showOfflineBanner);

// Show immediately if already offline
if (!navigator.onLine) showOfflineBanner();

// ── Offline Answer Queue (IndexedDB) ─────────────────────────────────────────
const CET_DB_NAME    = 'cet-offline-db';
const CET_DB_VERSION = 1;

async function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CET_DB_NAME, CET_DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

// Queue an answer save when offline
window.queueOfflineAnswer = async (url, body) => {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').add({ url, body, timestamp: Date.now() });
    console.log('[PWA] Answer queued for sync');
    // Register background sync
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register('answer-sync-queue');
    }
  } catch (e) {
    console.warn('[PWA] Queue failed:', e.message);
  }
};
