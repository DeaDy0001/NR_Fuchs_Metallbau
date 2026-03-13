import * as Network from 'expo-network';
import { getSetting, getQueuedUploads, updateUploadStatus, getQueuedMetaChanges, updateMetaChangeStatus, getQueuedImageChanges, updateImageChangeStatus } from './database';
import { uploadImage, flushImageRequests, saveProjectMetadata, reportImageChanges } from './api';
import { processImageForUpload } from './imageProcessor';
import { sendUploadCompleteNotification } from './backgroundSync';

/**
 * Report image metadata (GPS, title, notes) to the desktop server
 * Non-critical - silently fails if server not reachable
 */
const reportMetadataToServer = async (item, driveFileId) => {
  try {
    const serverUrl = await getSetting('serverUrl');
    if (!serverUrl) return;

    const gpsData = item.gps_data ? JSON.parse(item.gps_data) : null;
    if (!gpsData && !item.custom_title && !item.notes) return;

    const deviceId = await getSetting('heartbeat_device_id', '');

    await fetch(`${serverUrl}/api/mobile/image-metadata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': deviceId,
      },
      body: JSON.stringify({
        drive_file_id: driveFileId || null,
        file_name: item.file_name,
        gps_latitude: gpsData?.latitude || null,
        gps_longitude: gpsData?.longitude || null,
        gps_altitude: gpsData?.altitude || null,
        custom_title: item.custom_title || null,
        notes: item.notes || null,
      }),
    });
  } catch {
    // Silently fail - server not reachable (not on same network)
  }
};

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
      switchInterval(60000);
      return;
    }

    // Check WiFi-only preference
    const wifiOnly = await getSetting('wifiOnly', 'false');
    if (wifiOnly === 'true' && networkState.type !== Network.NetworkStateType.WIFI) {
      notifyListeners({ type: 'wifi_only', message: 'Upload wartet auf WLAN' });
      switchInterval(60000);
      return;
    }

    // Get queued uploads, meta changes and image changes
    const queue = await getQueuedUploads();
    const metaChanges = await getQueuedMetaChanges();
    const imageChanges = await getQueuedImageChanges();
    if (queue.length === 0 && metaChanges.length === 0 && imageChanges.length === 0) {
      notifyListeners({ type: 'idle' });
      return;
    }

    // We're online with items to process - use fast interval
    switchInterval(30000);

    uploadProgress = { current: 0, total: queue.length + metaChanges.length + imageChanges.length };
    notifyListeners({ type: 'processing', count: queue.length });

    let uploadedCount = 0;
    // Collect successful uploads to write image_requests.json at end of batch
    const uploadedItems = [];

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
        let uploadMimeType = item.mime_type;
        let uploadFileName = item.file_name;
        try {
          const processed = await processImageForUpload(item.file_uri, item.file_name);
          uploadUri = processed.uri;
          uploadMimeType = processed.mimeType;
          uploadFileName = processed.fileName || item.file_name;
        } catch (e) {
          console.warn('Image processing failed, uploading original:', e.message);
        }

        // Step 2: Upload to Google Drive inbox/images/ (new Postfach approach)
        notifyListeners({
          type: 'uploading',
          item,
          progress: { ...uploadProgress },
        });

        const uploadResult = await uploadImage(
          uploadUri,
          uploadFileName,
          uploadMimeType,
          item.project_folder_id || null,
          item.project_name || null,
          item.gps_data || null,
          item.custom_title || null,
          item.notes || null,
          item.photo_taken_at || null
        );

        // Step 3: Report metadata to desktop server (best-effort, legacy endpoint)
        if (item.gps_data || item.custom_title || item.notes) {
          reportMetadataToServer(item, uploadResult?.fileId || null);
        }

        await updateUploadStatus(item.id, 'uploaded');
        uploadedCount++;
        uploadedItems.push({ item, fileId: uploadResult?.fileId, uniqueFileName: uploadResult?.uniqueFileName || uploadFileName });
        notifyListeners({ type: 'uploaded', item, progress: { ...uploadProgress } });
      } catch (error) {
        await updateUploadStatus(item.id, 'failed', error.message);
        notifyListeners({ type: 'error', item, error: error.message });
      }
    }

    // Step 3b: Write image_requests.json grouping all uploaded images by project
    if (uploadedItems.length > 0) {
      try {
        await flushImageRequests(uploadedItems);
      } catch (e) {
        console.warn('[uploadQueue] flushImageRequests failed:', e.message);
      }
    }

    // Process meta change queue (project color / notes / tags)
    for (const item of metaChanges) {
      if (item.retry_count >= 3) {
        await updateMetaChangeStatus(item.id, 'permanently_failed', 'Maximale Versuche erreicht');
        continue;
      }
      uploadProgress.current++;
      const displayItem = { ...item, file_name: item.project_name || 'Projektdaten' };
      notifyListeners({ type: 'uploading', item: displayItem, progress: { ...uploadProgress } });
      try {
        const meta = {
          color: item.color,
          notes: item.notes,
          tags: JSON.parse(item.tags || '[]'),
          is_starred: item.is_starred === 1,
        };
        await saveProjectMetadata(item.project_folder_id, meta, item.project_name);
        await updateMetaChangeStatus(item.id, 'uploaded');
        uploadedCount++;
        notifyListeners({ type: 'uploaded', item: displayItem, progress: { ...uploadProgress } });
      } catch (e) {
        await updateMetaChangeStatus(item.id, 'failed', e.message);
        notifyListeners({ type: 'error', item: displayItem, error: e.message });
      }
    }

    // Process image change queue (title/notes edits for already-uploaded images)
    for (const item of imageChanges) {
      if (item.retry_count >= 3) {
        await updateImageChangeStatus(item.id, 'permanently_failed', 'Maximale Versuche erreicht');
        continue;
      }
      uploadProgress.current++;
      const displayItem = { ...item, file_name: item.image_name };
      notifyListeners({ type: 'uploading', item: displayItem, progress: { ...uploadProgress } });
      try {
        const changes = {};
        if (item.custom_title !== null) changes.custom_title = item.custom_title;
        if (item.notes !== null) changes.notes = item.notes;
        await reportImageChanges(item.image_id, item.image_name, changes);
        await updateImageChangeStatus(item.id, 'uploaded');
        uploadedCount++;
        notifyListeners({ type: 'uploaded', item: displayItem, progress: { ...uploadProgress } });
      } catch (e) {
        await updateImageChangeStatus(item.id, 'failed', e.message);
        notifyListeners({ type: 'error', item: displayItem, error: e.message });
      }
    }

    currentlyUploadingId = null;
    notifyListeners({ type: 'done' });

    // Send push notification after batch completes
    if (uploadedCount > 0) {
      sendUploadCompleteNotification(uploadedCount);
    }
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
