import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Layout from './components/Layout';
import DriveImages from './pages/DriveImages';
import DriveSettings from './pages/DriveSettings';
import ProjectsList from './pages/ProjectsList';
import ProjectsSettings from './pages/ProjectsSettings';
import Settings from './pages/Settings';

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
          <Route path="/" element={<Navigate to="/drive/images" replace />} />

          {/* Drive routes */}
          <Route path="/drive/images" element={<DriveImages />} />
          <Route path="/drive/settings" element={<DriveSettings />} />

          {/* Projects routes */}
          <Route path="/projects/list" element={<ProjectsList />} />
          <Route path="/projects/settings" element={<ProjectsSettings />} />

          {/* Settings route */}
          <Route path="/settings" element={<Settings settings={settings} updateSettings={updateSettings} onSettingsChange={loadSettings} />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
