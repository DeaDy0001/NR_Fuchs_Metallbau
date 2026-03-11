import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';

export const BACKGROUND_SYNC_TASK = 'fuchs-background-upload-sync';

// ── Notification handler ─────────────────────────────────────────────────────
// Must run at module load time so notifications show while app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// ── Background task definition ───────────────────────────────────────────────
// Must be defined at module load time (before any rendering)
if (!TaskManager.isTaskDefined(BACKGROUND_SYNC_TASK)) {
  TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
    try {
      // Dynamic require avoids circular import with uploadQueue.js
      const { processUploadQueue } = require('./uploadQueue');
      await processUploadQueue();
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

// ── Permissions ──────────────────────────────────────────────────────────────

export const getNotificationPermissionStatus = async () => {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status; // 'granted' | 'denied' | 'undetermined'
  } catch {
    return 'denied';
  }
};

export const requestNotificationPermission = async () => {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
};

// ── Notification helpers ─────────────────────────────────────────────────────

export const sendUploadCompleteNotification = async (uploadedCount) => {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const body = uploadedCount === 1
      ? '1 Foto erfolgreich hochgeladen'
      : `${uploadedCount} Fotos erfolgreich hochgeladen`;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Fuchs Metallbau',
        body,
        data: { screen: 'Queue' },
      },
      trigger: null, // show immediately
    });
  } catch {}
};

// ── Background sync registration ─────────────────────────────────────────────

export const registerBackgroundSync = async () => {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      return false;
    }

    await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: 60,       // request 60s (Android enforces its own minimum ~15min)
      stopOnTerminate: false,    // keep running after app is swiped away
      startOnBoot: true,         // restart after device reboot
    });
    return true;
  } catch (e) {
    // Task may already be registered — not an error
    if (!e.message?.includes('already')) {
      console.warn('[BackgroundSync] Registration failed:', e.message);
    }
    return false;
  }
};

export const unregisterBackgroundSync = async () => {
  try {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
  } catch {}
};
