import React, { createContext, useContext, useState, useEffect } from 'react';
import { getSetting, setSetting, getUploadQueueCount, getActiveDriveConnection } from '../services/database';
import { isAuthenticated, clearAuth, getAccessToken } from '../services/googleAuth';
import { checkFolderAccess } from '../services/driveService';
import { startQueueProcessing, stopQueueProcessing, addUploadListener } from '../services/uploadQueue';

const AppContext = createContext(null);

export const useApp = () => useContext(AppContext);

export const AppProvider = ({ children }) => {
  console.log('[Fuchs] AppProvider mounting');

  const [isGoogleAuthed, setIsGoogleAuthed] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
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
      console.log('[Fuchs] loadState - checking auth...');

      // Check Google authentication
      const authed = await isAuthenticated();
      console.log('[Fuchs] loadState - google authed:', authed);
      setIsGoogleAuthed(authed);

      if (authed) {
        // Load user info
        const name = await getSetting('userName', '');
        const email = await getSetting('googleUserEmail', '');
        setUserName(name);
        setUserEmail(email);

        // Check for active Drive connection
        const connection = await getActiveDriveConnection();
        console.log('[Fuchs] loadState - active connection:', connection ? connection.name : 'none');

        if (connection) {
          // Verify the connection is still accessible
          const accessible = await checkFolderAccess(connection.root_folder_id);
          if (accessible) {
            setActiveConnection(connection);
            setIsConnected(true);
          } else {
            console.log('[Fuchs] loadState - connection not accessible');
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
   * Called after successful Google login
   */
  const onGoogleLogin = async (userInfo) => {
    setIsGoogleAuthed(true);
    setUserName(userInfo.name || '');
    setUserEmail(userInfo.email || '');

    // Check if there's already an active connection
    const connection = await getActiveDriveConnection();
    if (connection) {
      const accessible = await checkFolderAccess(connection.root_folder_id);
      if (accessible) {
        setActiveConnection(connection);
        setIsConnected(true);
      }
    }
  };

  /**
   * Called after selecting/scanning a Drive connection
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
      isGoogleAuthed,
      isConnected,
      activeConnection,
      userName,
      userEmail,
      queueCount,
      isLoading,
      // Actions
      onGoogleLogin,
      onDriveConnect,
      disconnectDrive,
      logout,
      updateUserName,
      refreshQueueCount,
    }}>
      {children}
    </AppContext.Provider>
  );
};
