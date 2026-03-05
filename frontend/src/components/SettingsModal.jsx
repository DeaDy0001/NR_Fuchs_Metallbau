import { useState, useEffect } from 'react';
import { X, Settings as SettingsIcon, Image, FolderKanban, Download, Smartphone, Code, Users, Layers } from 'lucide-react';
import SettingsGeneral from '../pages/Settings';
import DriveSettings from '../pages/DriveSettings';
import ProjectsSettings from '../pages/ProjectsSettings';
import UpdateSettings from '../pages/UpdateSettings';
import MobileAppSettings from '../pages/MobileAppSettings';
import DevSettings from '../pages/DevSettings';
import UserManagement from '../pages/UserManagement';
import ModuleSettings from '../pages/ModuleSettings';
import { useAuth } from '../contexts/AuthContext';
import './SettingsModal.css';

const tabs = [
  { id: 'general', label: 'Allgemein', icon: SettingsIcon },
  { id: 'images', label: 'Bilder', icon: Image },
  { id: 'projects', label: 'Projekte', icon: FolderKanban },
  { id: 'mobile', label: 'Handy App', icon: Smartphone },
  { id: 'users', label: 'Benutzer', icon: Users },
  { id: 'modules', label: 'Module', icon: Layers },
  { id: 'update', label: 'Update', icon: Download },
];

const devTab = { id: 'dev', label: 'Dev', icon: Code };

function SettingsModal({ isOpen, onClose, initialTab, initialVersion, settings, updateSettings, onSettingsChange, onCheckForUpdates }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab || 'general');

  const visibleTabs = tabs.filter(tab => {
    if (tab.id === 'users' || tab.id === 'modules') return user?.is_admin;
    return true;
  });

  // Update active tab when initialTab changes (e.g. opening from update badge)
  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Reset to general tab when closing
  useEffect(() => {
    if (!isOpen) {
      // Small delay so the reset isn't visible during close animation
      const timer = setTimeout(() => setActiveTab('general'), 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="settings-modal-overlay" onClick={handleOverlayClick}>
      <div className="settings-modal">
        <button className="settings-modal-close" onClick={onClose}>
          <X size={20} />
        </button>

        <div className="settings-modal-layout">
          {/* Left sidebar with tabs */}
          <div className="settings-modal-sidebar">
            <h2 className="settings-modal-title">Einstellungen</h2>
            <nav className="settings-modal-nav">
              {visibleTabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    className={`settings-modal-tab ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <Icon size={18} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="settings-modal-nav-spacer" />
            <nav className="settings-modal-nav settings-modal-nav-bottom">
              <button
                className={`settings-modal-tab settings-modal-tab-dev ${activeTab === 'dev' ? 'active' : ''}`}
                onClick={() => setActiveTab('dev')}
              >
                <Code size={18} />
                <span>Dev</span>
              </button>
            </nav>
          </div>

          {/* Right content area */}
          <div className="settings-modal-content">
            {activeTab === 'general' && (
              <SettingsGeneral
                settings={settings}
                updateSettings={updateSettings}
                onSettingsChange={onSettingsChange}
              />
            )}
            {activeTab === 'images' && <DriveSettings />}
            {activeTab === 'projects' && <ProjectsSettings />}
            {activeTab === 'mobile' && <MobileAppSettings />}
            {activeTab === 'update' && (
              <UpdateSettings
                onCheckForUpdates={onCheckForUpdates}
                initialVersion={initialVersion}
              />
            )}
            {activeTab === 'dev' && <DevSettings />}
            {activeTab === 'users' && <UserManagement />}
            {activeTab === 'modules' && <ModuleSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
