import * as Network from 'expo-network';
import { getSetting, getQueuedUploads, updateUploadStatus } from './database';
import { uploadImage } from './api';
import { processImageForUpload } from './imageProcessor';

let isProcessing = false;
let listeners = [];
let currentlyUploadingId = null;
let uploadProgress = { current: 0, total: 0 };

export const addUploadListener = (callback) => {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter(l => l !== callback);
  };
};

const notifyListeners = (event) => {
  listeners.forEach(l => {
    try { l(event); } catch {}
  });
};

/**
 * Get the current upload state (for UI display)
 */
export const getCurrentUploadState = () => ({
  isProcessing,
  currentlyUploadingId,
  uploadProgress: { ...uploadProgress },
});

/**
 * Process the upload queue
 * Checks network conditions and uploads queued images to Google Drive
 */
export const processUploadQueue = async () => {
  if (isProcessing) return;
  isProcessing = true;
  currentlyUploadingId = null;

  try {
    // Check network
    const networkState = await Network.getNetworkStateAsync();
    if (!networkState.isConnected || !networkState.isInternetReachable) {
      notifyListeners({ type: 'offline' });
      // Switch to slow interval (5 min) when offline
      switchInterval(300000);
      return;
    }

    // Check WiFi-only preference
    const wifiOnly = await getSetting('wifiOnly', 'false');
    if (wifiOnly === 'true' && networkState.type !== Network.NetworkStateType.WIFI) {
      notifyListeners({ type: 'wifi_only', message: 'Upload wartet auf WLAN' });
      switchInterval(300000);
      return;
    }

    // Get queued uploads
    const queue = await getQueuedUploads();
    if (queue.length === 0) {
      notifyListeners({ type: 'idle' });
      return;
    }

    // We're online with items to process - use fast interval
    switchInterval(30000);

    uploadProgress = { current: 0, total: queue.length };
    notifyListeners({ type: 'processing', count: queue.length });

    for (const item of queue) {
      try {
        // Max 3 retries
        if (item.retry_count >= 3) {
          await updateUploadStatus(item.id, 'permanently_failed', 'Maximale Versuche erreicht');
          continue;
        }

        currentlyUploadingId = item.id;
        uploadProgress.current++;

        // Step 1: Compress/resize image according to settings
        notifyListeners({
          type: 'compressing',
          item,
          progress: { ...uploadProgress },
        });

        let uploadUri = item.file_uri;
        try {
          uploadUri = await processImageForUpload(item.file_uri, item.file_name);
        } catch (e) {
          console.warn('Image processing failed, uploading original:', e.message);
        }

        // Step 2: Upload to Google Drive
        notifyListeners({
          type: 'uploading',
          item,
          progress: { ...uploadProgress },
        });

        await uploadImage(
          uploadUri,
          item.file_name,
          item.mime_type,
          item.project_folder_id || item.project_id,
          item.project_name
        );

        await updateUploadStatus(item.id, 'uploaded');
        notifyListeners({ type: 'uploaded', item, progress: { ...uploadProgress } });
      } catch (error) {
        await updateUploadStatus(item.id, 'failed', error.message);
        notifyListeners({ type: 'error', item, error: error.message });
      }
    }

    currentlyUploadingId = null;
    notifyListeners({ type: 'done' });
  } catch (error) {
    console.error('Upload queue processing error:', error);
  } finally {
    isProcessing = false;
    currentlyUploadingId = null;
  }
};

/**
 * Interval management - 30s when online with items, 5min when offline
 */
let intervalId = null;
let currentIntervalMs = 30000;

const switchInterval = (newIntervalMs) => {
  if (currentIntervalMs === newIntervalMs && intervalId) return;
  if (intervalId) clearInterval(intervalId);
  currentIntervalMs = newIntervalMs;
  intervalId = setInterval(processUploadQueue, newIntervalMs);
};

export const startQueueProcessing = (intervalMs = 30000) => {
  if (intervalId) clearInterval(intervalId);
  currentIntervalMs = intervalMs;
  intervalId = setInterval(processUploadQueue, intervalMs);
  // Run immediately
  processUploadQueue();
};

export const stopQueueProcessing = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
};

/**
 * Force immediate processing (for "Sofort synchronisieren" button)
 */
export const forceProcessQueue = async () => {
  // Reset to fast interval
  switchInterval(30000);
  // Process now if not already processing
  if (!isProcessing) {
    await processUploadQueue();
  }
};
