import React, { createContext, useContext, useState, useEffect } from 'react';
import { getSetting, setSetting, getUploadQueueCount, getActiveDriveConnection, updateDriveConnectionFolders } from '../services/database';
import { isAuthenticated, clearAuth, getAccessToken } from '../services/googleAuth';
import { checkFolderAccess, findOrCreateFolder } from '../services/driveService';
import { startQueueProcessing, stopQueueProcessing, addUploadListener } from '../services/uploadQueue';

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

  // Load saved state on mount
  useEffect(() => {
    console.log('[Fuchs] AppProvider useEffect - calling loadState');
    loadState();
  }, []);

  // Start upload queue processing when connected to Drive
  useEffect(() => {
    if (isConnected && activeConnection) {
      startQueueProcessing();
    } else {
      stopQueueProcessing();
    }
    return () => stopQueueProcessing();
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
      const authed = await isAuthenticated();
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
   * Called after successful Google login
   */
  const onGoogleLogin = async (userInfo) => {
    setIsGoogleAuthed(true);
    setUserName(userInfo.name || '');
    setUserEmail(userInfo.email || '');

    // Check if there's already an active connection (from QR scan setup)
    const connection = await getActiveDriveConnection();
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
    const count = await getUploadQueueCount();
    setQueueCount(count);
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
