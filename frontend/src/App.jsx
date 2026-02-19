import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Layout from './components/Layout';
import DriveImages from './pages/DriveImages';
import ProjectsList from './pages/ProjectsList';
import SettingsTabs from './pages/SettingsTabs';
import UpdateNotification from './components/UpdateNotification';

function App() {
  const [settings, setSettings] = useState({
    logo_path: null,
    theme: 'dark',
    sidebar_collapsed: false
  });

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

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

  return (
    <Router>
      <Layout settings={settings} updateSettings={updateSettings}>
        <Routes>
          <Route path="/" element={<Navigate to="/images" replace />} />

          {/* Bilder (früher Drive) */}
          <Route path="/images" element={<DriveImages />} />

          {/* Projekte */}
          <Route path="/projects" element={<ProjectsList />} />

          {/* Einstellungen mit Tabs */}
          <Route path="/settings/general" element={<SettingsTabs settings={settings} updateSettings={updateSettings} onSettingsChange={loadSettings} />} />
          <Route path="/settings/images" element={<SettingsTabs settings={settings} updateSettings={updateSettings} onSettingsChange={loadSettings} />} />
          <Route path="/settings/projects" element={<SettingsTabs settings={settings} updateSettings={updateSettings} onSettingsChange={loadSettings} />} />

          {/* Redirect old routes */}
          <Route path="/drive/images" element={<Navigate to="/images" replace />} />
          <Route path="/projects/list" element={<Navigate to="/projects" replace />} />
          <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
        </Routes>

        {/* Update notification */}
        <UpdateNotification />
      </Layout>
    </Router>
  );
}

export default App;
