import { Platform } from 'react-native';
import { getSetting, setSetting } from './database';

let heartbeatInterval = null;

/**
 * Get or create a stable unique device ID
 */
const getDeviceId = async () => {
  let deviceId = await getSetting('heartbeat_device_id');
  if (!deviceId) {
    // Generate a UUID-like ID
    deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    await setSetting('heartbeat_device_id', deviceId);
  }
  return deviceId;
};

/**
 * Send a single heartbeat to the backend server
 */
const sendHeartbeat = async () => {
  try {
    const serverUrl = await getSetting('serverUrl');
    if (!serverUrl) return;

    const userName = await getSetting('userName', 'Unbekannt');
    const deviceId = await getDeviceId();
    const deviceName = `${Platform.OS === 'ios' ? 'iPhone' : 'Android'}`;

    await fetch(`${serverUrl}/api/mobile/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, deviceName, userName }),
    });
  } catch {
    // Silently fail - server not reachable (not on same network)
  }
};

/**
 * Start periodic heartbeat (every 60 seconds)
 */
export const startHeartbeat = () => {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  // Send immediately
  sendHeartbeat();
  // Then every 60 seconds
  heartbeatInterval = setInterval(sendHeartbeat, 60000);
};

/**
 * Stop periodic heartbeat
 */
export const stopHeartbeat = () => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
};
