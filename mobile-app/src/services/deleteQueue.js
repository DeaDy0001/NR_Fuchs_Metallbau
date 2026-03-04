import * as FileSystem from 'expo-file-system';
import { getQueuedDeletes, updateDeleteQueueStatus, deleteRecentPhoto, deleteRecentPhotos } from './database';
import { requestDeleteFromSoftware } from './api';

let isProcessing = false;
let listeners = [];

export const addDeleteListener = (callback) => {
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

export const getDeleteProcessingState = () => ({
  isProcessing,
});

/**
 * Process the delete queue in the background.
 * Handles local file deletion and optional software delete requests.
 */
export const processDeleteQueue = async () => {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const items = await getQueuedDeletes();
    if (items.length === 0) {
      isProcessing = false;
      return;
    }

    notifyListeners({ type: 'start', total: items.length });

    // Group items by whether they need software deletion
    const softwareDeleteItems = items.filter(i => i.delete_from_software === 1);
    const localOnlyItems = items.filter(i => i.delete_from_software === 0);

    // Process local-only deletions first (fast)
    for (const item of localOnlyItems) {
      try {
        await deleteLocalFiles(item);
        if (item.photo_id) {
          await deleteRecentPhoto(item.photo_id);
        }
        await updateDeleteQueueStatus(item.id, 'done');
        notifyListeners({ type: 'deleted', item });
      } catch (error) {
        console.error('[Fuchs] Delete failed for', item.file_name, error);
        await updateDeleteQueueStatus(item.id, 'failed', error.message);
        notifyListeners({ type: 'error', item, error: error.message });
      }
    }

    // Process software delete requests (batch by sending all at once)
    if (softwareDeleteItems.length > 0) {
      try {
        // Send delete request to desktop software via Drive
        const photos = softwareDeleteItems.map(item => ({
          file_name: item.file_name,
          project_name: item.project_name,
          project_id: item.project_id,
        }));
        await requestDeleteFromSoftware(photos);

        // Now delete local files for each
        for (const item of softwareDeleteItems) {
          try {
            await deleteLocalFiles(item);
            if (item.photo_id) {
              await deleteRecentPhoto(item.photo_id);
            }
            await updateDeleteQueueStatus(item.id, 'done');
            notifyListeners({ type: 'deleted', item });
          } catch (error) {
            // Local deletion failed but software request was sent
            await updateDeleteQueueStatus(item.id, 'done');
            notifyListeners({ type: 'deleted', item });
          }
        }
      } catch (error) {
        console.error('[Fuchs] Software delete request failed:', error);
        // Mark all software delete items as failed
        for (const item of softwareDeleteItems) {
          await updateDeleteQueueStatus(item.id, 'failed', error.message);
          notifyListeners({ type: 'error', item, error: error.message });
        }
      }
    }

    notifyListeners({ type: 'done' });
  } catch (error) {
    console.error('[Fuchs] Delete queue processing error:', error);
  } finally {
    isProcessing = false;
  }
};

async function deleteLocalFiles(item) {
  if (item.file_uri) {
    try {
      await FileSystem.deleteAsync(item.file_uri, { idempotent: true });
    } catch {}
  }
  if (item.thumbnail_uri && item.thumbnail_uri !== item.file_uri) {
    try {
      await FileSystem.deleteAsync(item.thumbnail_uri, { idempotent: true });
    } catch {}
  }
}
