import React, { createContext, useContext, useState, useEffect } from 'react';
import { getSetting, setSetting, getUploadQueueCount } from '../services/database';
import { checkServerConnection } from '../services/api';
import { startQueueProcessing, stopQueueProcessing, addUploadListener } from '../services/uploadQueue';

const AppContext = createContext(null);

export const useApp = () => useContext(AppContext);

export const AppProvider = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [serverUrl, setServerUrl] = useState(null);
  const [userName, setUserName] = useState('');
  const [queueCount, setQueueCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Load saved state
  useEffect(() => {
    loadState();
  }, []);

  // Start upload queue processing when connected
  useEffect(() => {
    if (isConnected) {
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
      const url = await getSetting('serverUrl');
      const token = await getSetting('authToken');
      const name = await getSetting('userName', '');

      setServerUrl(url);
      setUserName(name);

      if (url && token) {
        const connected = await checkServerConnection();
        setIsConnected(connected);
      }

      const count = await getUploadQueueCount();
      setQueueCount(count);
    } catch (error) {
      console.error('Failed to load app state:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const connect = async (url, authToken, name) => {
    await setSetting('serverUrl', url);
    await setSetting('authToken', authToken);
    await setSetting('userName', name);
    setServerUrl(url);
    setUserName(name);
    setIsConnected(true);
  };

  const disconnect = async () => {
    await setSetting('serverUrl', '');
    await setSetting('authToken', '');
    setServerUrl(null);
    setIsConnected(false);
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
      isConnected,
      serverUrl,
      userName,
      queueCount,
      isLoading,
      connect,
      disconnect,
      updateUserName,
      refreshQueueCount,
    }}>
      {children}
    </AppContext.Provider>
  );
};
