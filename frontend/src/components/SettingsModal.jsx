import { useState, useEffect } from 'react';
import { X, Settings as SettingsIcon, Image, FolderKanban, Download } from 'lucide-react';
import SettingsGeneral from '../pages/Settings';
import DriveSettings from '../pages/DriveSettings';
import ProjectsSettings from '../pages/ProjectsSettings';
import UpdateSettings from '../pages/UpdateSettings';
import './SettingsModal.css';

const tabs = [
  { id: 'general', label: 'Allgemein', icon: SettingsIcon },
  { id: 'images', label: 'Bilder', icon: Image },
  { id: 'projects', label: 'Projekte', icon: FolderKanban },
  { id: 'update', label: 'Update', icon: Download },
];

function SettingsModal({ isOpen, onClose, initialTab, initialVersion, settings, updateSettings, onSettingsChange, onCheckForUpdates }) {
  const [activeTab, setActiveTab] = useState(initialTab || 'general');

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
              {tabs.map(tab => {
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
            {activeTab === 'update' && (
              <UpdateSettings
                onCheckForUpdates={onCheckForUpdates}
                initialVersion={initialVersion}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
