import { useLocation, useNavigate } from 'react-router-dom';
import Settings from './Settings';
import DriveSettings from './DriveSettings';
import ProjectsSettings from './ProjectsSettings';
import './SettingsTabs.css';

function SettingsTabs({ settings, updateSettings, onSettingsChange }) {
  const location = useLocation();
  const navigate = useNavigate();

  // Determine active tab from URL
  const getActiveTab = () => {
    if (location.pathname.includes('/settings/general')) return 'general';
    if (location.pathname.includes('/settings/images')) return 'images';
    if (location.pathname.includes('/settings/projects')) return 'projects';
    return 'general';
  };

  const activeTab = getActiveTab();

  const handleTabChange = (tab) => {
    navigate(`/settings/${tab}`);
  };

  return (
    <div className="settings-tabs-page">
      <div className="page-header">
        <h1>Einstellungen</h1>
      </div>

      <div className="settings-tabs-container">
        <div className="tabs-header">
          <button
            className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => handleTabChange('general')}
          >
            Allgemein
          </button>
          <button
            className={`tab-btn ${activeTab === 'images' ? 'active' : ''}`}
            onClick={() => handleTabChange('images')}
          >
            Bilder
          </button>
          <button
            className={`tab-btn ${activeTab === 'projects' ? 'active' : ''}`}
            onClick={() => handleTabChange('projects')}
          >
            Projekte
          </button>
        </div>

        <div className="tabs-content">
          {activeTab === 'general' && (
            <Settings
              settings={settings}
              updateSettings={updateSettings}
              onSettingsChange={onSettingsChange}
            />
          )}
          {activeTab === 'images' && <DriveSettings />}
          {activeTab === 'projects' && <ProjectsSettings />}
        </div>
      </div>
    </div>
  );
}

export default SettingsTabs;
