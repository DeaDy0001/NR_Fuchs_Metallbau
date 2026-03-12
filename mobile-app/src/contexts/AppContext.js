import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { getSetting, setSetting, getUploadQueueCount, getDeleteQueueCount, getActiveDriveConnection, updateDriveConnectionFolders } from '../services/database';
import { isAuthenticated, clearAuth, getAccessToken } from '../services/googleAuth';
import { checkFolderAccess, findOrCreateFolder, readJsonFileByName } from '../services/driveService';
import { startQueueProcessing, stopQueueProcessing, addUploadListener, forceProcessQueue } from '../services/uploadQueue';
import { startHeartbeat, stopHeartbeat } from '../services/heartbeat';
import { checkAppUpdate } from '../services/api';
import { registerBackgroundSync } from '../services/backgroundSync';
import Constants from 'expo-constants';

const isVersionNewer = (serverVersion, localVersion) => {
  const s = (serverVersion || '0.0.0').split('.').map(Number);
  const l = (localVersion || '0.0.0').split('.').map(Number);
  for (let i = 0; i < Math.max(s.length, l.length); i++) {
    if ((s[i] || 0) > (l[i] || 0)) return true;
    if ((s[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
};

const ensureDriveFolders = async (connection) => {
  if (!connection.meta_folder_id || !connection.inbox_folder_id) {
    const metaFolder = await findOrCreateFolder(connection.root_folder_id, 'NR_Fuchs_Meta');
    const inboxFolder = await findOrCreateFolder(metaFolder.id, 'inbox');
    // Also ensure Projekte folder exists
    await findOrCreateFolder(metaFolder.id, 'Projekte');
    await updateDriveConnectionFolders(connection.id, metaFolder.id, inboxFolder.id);
    connection.meta_folder_id = metaFolder.id;
    connection.inbox_folder_id = inboxFolder.id;
  } else {
    // Ensure Projekte folder exists even if meta/inbox already set
    try {
      await findOrCreateFolder(connection.meta_folder_id, 'Projekte');
    } catch {}
  }
  return connection;
};

const AppContext = createContext(null);

export const useApp = () => useContext(AppContext);

export const AppProvider = ({ children }) => {
  console.log('[Fuchs] AppProvider mounting');

  const [isSetup, setIsSetup] = useState(false);       // Has Google Client ID (from QR scan)
  const [isGoogleAuthed, setIsGoogleAuthed] = useState(false);  // Has valid Google token
  const [isConnected, setIsConnected] = useState(false);        // Has active Drive connection
  const [activeConnection, setActiveConnection] = useState(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [queueCount, setQueueCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // App update state
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null); // { version, apkFileId }

  // Load saved state on mount
  useEffect(() => {
    console.log('[Fuchs] AppProvider useEffect - calling loadState');
    loadState();
  }, []);

  // Start upload queue processing and heartbeat when connected to Drive
  // Also check for app updates and register background sync
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    let updateInterval = null;
    let appStateSub = null;

    const runUpdateCheck = () => {
      checkAppUpdate()
        .then((update) => {
          if (!update?.version || !update?.apkFileId) return;
          const installedVersion = Constants.expoConfig?.version || '0.0.0';
          if (isVersionNewer(update.version, installedVersion)) {
            setUpdateAvailable(true);
            setUpdateInfo(update);
          }
        })
        .catch(() => {}); // silently ignore network errors
    };

    if (isConnected && activeConnection) {
      startQueueProcessing();
      startHeartbeat();
      // Initial update check on connect
      runUpdateCheck();
      // Periodic re-check every 6 hours
      updateInterval = setInterval(runUpdateCheck, 6 * 60 * 60 * 1000);

      // Register background sync task so uploads run even when app is suspended
      registerBackgroundSync().catch(() => {});

      // When app comes back to foreground, immediately try to sync the queue
      appStateSub = AppState.addEventListener('change', (nextState) => {
        if (appStateRef.current !== 'active' && nextState === 'active') {
          forceProcessQueue().catch(() => {});
        }
        appStateRef.current = nextState;
      });
    } else {
      stopQueueProcessing();
      stopHeartbeat();
    }
    return () => {
      stopQueueProcessing();
      stopHeartbeat();
      if (updateInterval) clearInterval(updateInterval);
      if (appStateSub) appStateSub.remove();
    };
  }, [isConnected]);

  // Listen for upload queue changes
  useEffect(() => {
    const unsubscribe = addUploadListener(async () => {
      const count = await getUploadQueueCount();
      setQueueCount(count);
    });
    return unsubscribe;
  }, []);

  const loadState = async () => {
    try {
      console.log('[Fuchs] loadState - checking setup...');

      // Step 1: Check if app is set up (has Google Client ID from QR scan)
      const clientId = await getSetting('googleClientId');
      const setup = !!clientId;
      console.log('[Fuchs] loadState - has client ID:', setup);
      setIsSetup(setup);

      if (!setup) {
        // Not set up yet - show ConnectScreen (setup mode)
        const count = await getUploadQueueCount();
        setQueueCount(count);
        setIsLoading(false);
        return;
      }

      // Step 2: Check Google authentication
      // If first attempt fails (e.g. transient network on app cold-start) but a
      // refresh token is stored, wait 2 s and try once more before showing login.
      let authed = await isAuthenticated();
      if (!authed) {
        const storedRefreshToken = await getSetting('googleRefreshToken');
        if (storedRefreshToken) {
          await new Promise(r => setTimeout(r, 2000));
          authed = await isAuthenticated();
        }
      }
      console.log('[Fuchs] loadState - google authed:', authed);
      setIsGoogleAuthed(authed);

      if (authed) {
        // Load user info
        const name = await getSetting('userName', '');
        const email = await getSetting('googleUserEmail', '');
        setUserName(name);
        setUserEmail(email);

        // Step 3: Check for active Drive connection
        const connection = await getActiveDriveConnection();
        console.log('[Fuchs] loadState - active connection:', connection ? connection.name : 'none');

        if (connection) {
          // Verify the connection is still accessible
          try {
            const accessible = await checkFolderAccess(connection.root_folder_id);
            if (accessible) {
              await ensureDriveFolders(connection);

              // Sync server settings (image format etc.) from NR_Fuchs_Meta/src/settings/settings.json
              try {
                const srcFolder = await findOrCreateFolder(connection.meta_folder_id, 'src');
                const settingsFolder = await findOrCreateFolder(srcFolder.id, 'settings');
                const serverSettings = await readJsonFileByName(settingsFolder.id, 'settings.json');
                if (serverSettings?.image_format) {
                  await setSetting('serverImageFormat', serverSettings.image_format);
                  console.log('[Fuchs] Server image format synced:', serverSettings.image_format);
                }
              } catch (e) {
                console.log('[Fuchs] Could not sync server settings:', e.message);
              }

              setActiveConnection(connection);
              setIsConnected(true);
            } else {
              console.log('[Fuchs] loadState - connection not accessible');
            }
          } catch (e) {
            console.log('[Fuchs] loadState - connection check failed:', e.message);
          }
        }
      }

      const count = await getUploadQueueCount();
      setQueueCount(count);
    } catch (error) {
      console.error('[Fuchs] FEHLER in loadState:', error?.message, error?.stack);
    } finally {
      console.log('[Fuchs] loadState fertig - isLoading wird false');
      setIsLoading(false);
    }
  };

  /**
   * Called after QR code scan in setup mode
   * Stores the Google Client ID and creates a pending Drive connection
   */
  const onSetupComplete = async () => {
    setIsSetup(true);
  };

  /**
   * Register Google user with backend so it can share the Drive folder.
   * Must be called BEFORE verifying Drive folder access.
   */
  const registerWithBackend = async (userInfo, connection) => {
    const serverUrl = await getSetting('serverUrl');
    if (!serverUrl || !userInfo.email) return;

    try {
      await fetch(`${serverUrl}/api/mobile/register-google-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googleEmail: userInfo.email,
          googleName: userInfo.name || '',
          googleId: userInfo.id || userInfo.sub || null,
          rootFolderId: connection?.root_folder_id || null,
        }),
      });
    } catch (e) {
      // Non-fatal - folder might already be accessible or registration can retry later
      console.log('[Fuchs] Backend registration skipped:', e.message);
    }
  };

  /**
   * Called after successful Google login
   */
  const onGoogleLogin = async (userInfo) => {
    setIsGoogleAuthed(true);
    setUserName(userInfo.name || '');
    setUserEmail(userInfo.email || '');

    // Check if there's already an active connection (from QR scan setup)
    const connection = await getActiveDriveConnection();

    // IMPORTANT: Register with backend FIRST so it can grant Drive access
    // before we try to verify folder accessibility below
    await registerWithBackend(userInfo, connection);

    if (connection) {
      try {
        const accessible = await checkFolderAccess(connection.root_folder_id);
        if (accessible) {
          await ensureDriveFolders(connection);
          setActiveConnection(connection);
          setIsConnected(true);
        }
      } catch (e) {
        console.log('[Fuchs] Post-login connection verification failed:', e.message);
      }
    }
  };

  /**
   * Called after selecting/scanning a Drive connection (when already authenticated)
   */
  const onDriveConnect = (connection) => {
    setActiveConnection(connection);
    setIsConnected(true);
  };

  /**
   * Disconnect from Drive (but keep Google auth)
   */
  const disconnectDrive = async () => {
    setIsConnected(false);
    setActiveConnection(null);
  };

  /**
   * Full logout (Google auth + Drive connection)
   */
  const logout = async () => {
    await clearAuth();
    setIsGoogleAuthed(false);
    setIsConnected(false);
    setActiveConnection(null);
    setUserName('');
    setUserEmail('');
  };

  /**
   * Full reset (removes client ID too - back to QR scan)
   */
  const resetSetup = async () => {
    await clearAuth();
    await setSetting('googleClientId', '');
    setIsSetup(false);
    setIsGoogleAuthed(false);
    setIsConnected(false);
    setActiveConnection(null);
    setUserName('');
    setUserEmail('');
  };

  const updateUserName = async (name) => {
    await setSetting('userName', name);
    setUserName(name);
  };

  const refreshQueueCount = async () => {
    const uploadCount = await getUploadQueueCount();
    const deleteCount = await getDeleteQueueCount();
    setQueueCount(uploadCount + deleteCount);
  };

  const recheckUpdate = async () => {
    try {
      const update = await checkAppUpdate();
      if (!update?.version || !update?.apkFileId) {
        setUpdateAvailable(false);
        setUpdateInfo(null);
        return;
      }
      const installedVersion = Constants.expoConfig?.version || '0.0.0';
      if (isVersionNewer(update.version, installedVersion)) {
        setUpdateAvailable(true);
        setUpdateInfo(update);
      } else {
        setUpdateAvailable(false);
        setUpdateInfo(null);
      }
    } catch {}
  };

  return (
    <AppContext.Provider value={{
      // Auth state
      isSetup,
      isGoogleAuthed,
      isConnected,
      activeConnection,
      userName,
      userEmail,
      queueCount,
      isLoading,
      // App update
      updateAvailable,
      updateInfo,
      recheckUpdate,
      // Actions
      onSetupComplete,
      onGoogleLogin,
      onDriveConnect,
      disconnectDrive,
      logout,
      resetSetup,
      updateUserName,
      refreshQueueCount,
    }}>
      {children}
    </AppContext.Provider>
  );
};
