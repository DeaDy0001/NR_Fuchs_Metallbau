import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import Layout from './components/Layout';
import SettingsModal from './components/SettingsModal';
import DriveImages from './pages/DriveImages';
import ProjectsList from './pages/ProjectsList';
import InboxPage from './pages/InboxPage';
import MitarbeiterPage from './pages/MitarbeiterPage';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';

function AppInner() {
  const { loading, setupRequired, authenticated } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary, #0f1117)' }}>
        <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Lade...</div>
      </div>
    );
  }

  if (setupRequired || !authenticated) {
    return <LoginPage isSetup={setupRequired} />;
  }

  return <MainApp />;
}

function MainApp() {
  const [settings, setSettings] = useState({
    logo_path: null,
    theme: 'dark',
    sidebar_collapsed: false
  });

  const [updateInfo, setUpdateInfo] = useState(null);

  // Settings modal state
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState('general');
  const [settingsModalVersion, setSettingsModalVersion] = useState(null);

  // Memoized update check function to prevent multiple calls
  const checkForUpdates = useCallback(async () => {
    try {
      const response = await fetch('/api/system/version');
      if (response.ok) {
        const data = await response.json();
        if (data.updateAvailable) {
          setUpdateInfo(data);
        } else {
          setUpdateInfo(null);
        }
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
    }
  }, []);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  // Check for updates on mount and every hour
  useEffect(() => {
    checkForUpdates();
    const interval = setInterval(checkForUpdates, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkForUpdates]);

  // Update favicon and title when settings change
  useEffect(() => {
    // Update favicon
    if (settings.favicon_path) {
      const link = document.querySelector('#dynamic-favicon');
      if (link) {
        link.href = settings.favicon_path + '?v=' + Date.now();
      }
    }

    // Update title
    if (settings.company_name) {
      document.title = settings.company_name;
    }

    // Update CSS primary color
    if (settings.primary_color) {
      document.documentElement.style.setProperty('--accent-primary', settings.primary_color);
      document.documentElement.style.setProperty('--accent-hover', adjustColorBrightness(settings.primary_color, -10));
    }
  }, [settings.favicon_path, settings.company_name, settings.primary_color]);

  // Helper function to adjust color brightness
  const adjustColorBrightness = (color, percent) => {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
      (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
      (B < 255 ? B < 1 ? 0 : B : 255))
      .toString(16).slice(1);
  };

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const updateSettings = (newSettings) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const toggleSidebar = async () => {
    const newCollapsed = !settings.sidebar_collapsed;

    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sidebar_collapsed: newCollapsed })
      });

      if (response.ok) {
        updateSettings({ sidebar_collapsed: newCollapsed });
      }
    } catch (error) {
      console.error('Failed to update sidebar state:', error);
    }
  };

  const handleOpenSettings = () => {
    setSettingsModalTab('general');
    setSettingsModalVersion(null);
    setSettingsModalOpen(true);
  };

  const handleOpenUpdate = () => {
    setSettingsModalTab('update');
    setSettingsModalVersion(updateInfo ? `v${updateInfo.latestVersion}` : null);
    setSettingsModalOpen(true);
  };

  const handleCloseSettings = () => {
    setSettingsModalOpen(false);
    setSettingsModalVersion(null);
  };

  return (
    <Router>
      <Layout
        settings={settings}
        updateSettings={updateSettings}
        updateInfo={updateInfo}
        onToggleSidebar={toggleSidebar}
        onOpenSettings={handleOpenSettings}
        onOpenUpdate={handleOpenUpdate}
      >
        <Routes>
          <Route path="/" element={<Navigate to="/images" replace />} />

          {/* Inbox */}
          <Route path="/inbox" element={<InboxPage />} />

          {/* Bilder (früher Drive) */}
          <Route path="/images" element={<DriveImages />} />

          {/* Projekte */}
          <Route path="/projects" element={<ProjectsList />} />

          {/* Mitarbeiter */}
          <Route path="/mitarbeiter" element={<MitarbeiterPage />} />

          {/* Redirect old routes */}
          <Route path="/drive/images" element={<Navigate to="/images" replace />} />
          <Route path="/projects/list" element={<Navigate to="/projects" replace />} />
          <Route path="/settings/*" element={<Navigate to="/images" replace />} />
        </Routes>
      </Layout>

      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={handleCloseSettings}
        initialTab={settingsModalTab}
        initialVersion={settingsModalVersion}
        settings={settings}
        updateSettings={updateSettings}
        onSettingsChange={loadSettings}
        onCheckForUpdates={checkForUpdates}
      />
    </Router>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

export default App;
