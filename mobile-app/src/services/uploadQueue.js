import * as Network from 'expo-network';
import { getSetting, getQueuedUploads, updateUploadStatus } from './database';
import { uploadImage } from './api';

let isProcessing = false;
let listeners = [];

export const addUploadListener = (callback) => {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter(l => l !== callback);
  };
};

const notifyListeners = (event) => {
  listeners.forEach(l => l(event));
};

/**
 * Process the upload queue
 * Checks network conditions and uploads queued images to Google Drive
 */
export const processUploadQueue = async () => {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // Check network
    const networkState = await Network.getNetworkStateAsync();
    if (!networkState.isConnected || !networkState.isInternetReachable) {
      notifyListeners({ type: 'offline' });
      return;
    }

    // Check WiFi-only preference
    const wifiOnly = await getSetting('wifiOnly', 'false');
    if (wifiOnly === 'true' && networkState.type !== Network.NetworkStateType.WIFI) {
      notifyListeners({ type: 'wifi_only', message: 'Upload wartet auf WLAN' });
      return;
    }

    // Get queued uploads
    const queue = await getQueuedUploads();
    if (queue.length === 0) return;

    notifyListeners({ type: 'processing', count: queue.length });

    for (const item of queue) {
      try {
        // Max 3 retries
        if (item.retry_count >= 3) {
          await updateUploadStatus(item.id, 'permanently_failed', 'Maximale Versuche erreicht');
          continue;
        }

        // Upload to Google Drive inbox via api.js
        await uploadImage(
          item.file_uri,
          item.file_name,
          item.mime_type,
          item.project_id,
          item.project_name
        );

        await updateUploadStatus(item.id, 'uploaded');
        notifyListeners({ type: 'uploaded', item });
      } catch (error) {
        await updateUploadStatus(item.id, 'failed', error.message);
        notifyListeners({ type: 'error', item, error: error.message });
      }
    }

    notifyListeners({ type: 'done' });
  } catch (error) {
    console.error('Upload queue processing error:', error);
  } finally {
    isProcessing = false;
  }
};

/**
 * Start periodic queue processing
 */
let intervalId = null;

export const startQueueProcessing = (intervalMs = 30000) => {
  if (intervalId) clearInterval(intervalId);
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
