import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Layout from './components/Layout';
import DriveImages from './pages/DriveImages';
import ProjectsList from './pages/ProjectsList';
import SettingsTabs from './pages/SettingsTabs';

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
      </Layout>
    </Router>
  );
}

export default App;
