import * as FileSystem from 'expo-file-system/legacy';
import { getSetting } from './database';

const getBaseUrl = async () => {
  return await getSetting('serverUrl');
};

const getAuthToken = async () => {
  return await getSetting('authToken');
};

const apiRequest = async (endpoint, options = {}) => {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) throw new Error('Nicht mit Server verbunden');

  const authToken = await getAuthToken();
  const url = `${baseUrl}/api/mobile${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...(authToken && { 'X-Mobile-Token': authToken }),
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unbekannter Fehler' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
};

// ============================================================
// Auth & Connection
// ============================================================

export const registerDevice = async (serverUrl, token, deviceId, deviceName, userName) => {
  const response = await fetch(`${serverUrl}/api/mobile/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, deviceId, deviceName, userName }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Verbindung fehlgeschlagen' }));
    throw new Error(error.error);
  }

  return response.json();
};

// ============================================================
// Projects
// ============================================================

export const fetchProjects = () => apiRequest('/projects');

export const fetchProjectImages = (projectId) => apiRequest(`/projects/${projectId}/images`);

export const createProject = (name, color, tags) =>
  apiRequest('/projects', {
    method: 'POST',
    body: JSON.stringify({ name, color, tags }),
  });

// ============================================================
// Upload
// ============================================================

export const uploadImage = async (fileUri, fileName, mimeType, projectId = null, projectName = null) => {
  const baseUrl = await getBaseUrl();
  const authToken = await getAuthToken();
  if (!baseUrl || !authToken) throw new Error('Nicht mit Server verbunden');

  const formData = new FormData();
  formData.append('image', {
    uri: fileUri,
    name: fileName,
    type: mimeType || 'image/jpeg',
  });

  if (projectId) formData.append('project_id', String(projectId));
  if (projectName) formData.append('project_name', projectName);

  const response = await fetch(`${baseUrl}/api/mobile/upload`, {
    method: 'POST',
    headers: {
      'X-Mobile-Token': authToken,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload fehlgeschlagen' }));
    throw new Error(error.error);
  }

  return response.json();
};

// ============================================================
// Sync
// ============================================================

export const fetchSyncData = (since = null) => {
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  return apiRequest(`/sync${query}`);
};

// ============================================================
// Image Download (with compression options)
// ============================================================

export const getImageUrl = async (imageId, options = {}) => {
  const baseUrl = await getBaseUrl();
  const authToken = await getAuthToken();
  if (!baseUrl) return null;

  let url = `${baseUrl}/api/mobile/image/${imageId}`;
  const params = [];
  if (options.quality) params.push(`quality=${options.quality}`);
  if (options.maxWidth) params.push(`maxWidth=${options.maxWidth}`);
  if (options.maxHeight) params.push(`maxHeight=${options.maxHeight}`);
  if (params.length) url += `?${params.join('&')}`;

  return { url, headers: { 'X-Mobile-Token': authToken } };
};

export const downloadImage = async (imageId, localPath, options = {}) => {
  const { url, headers } = await getImageUrl(imageId, options);
  if (!url) throw new Error('Nicht mit Server verbunden');

  const result = await FileSystem.downloadAsync(url, localPath, { headers });
  return result;
};

// ============================================================
// Health check
// ============================================================

export const checkServerConnection = async () => {
  try {
    const baseUrl = await getBaseUrl();
    if (!baseUrl) return false;

    const response = await fetch(`${baseUrl}/api/health`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
};
