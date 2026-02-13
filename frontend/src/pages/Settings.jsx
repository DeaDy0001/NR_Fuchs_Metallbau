import { useState, useRef } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import './Settings.css';

function Settings({ settings, updateSettings, onSettingsChange }) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('logo', file);

    setUploading(true);

    try {
      const response = await fetch('/api/settings/logo', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        updateSettings({ logo_path: data.logo_path });
        onSettingsChange();
      } else {
        alert('Fehler beim Hochladen des Logos');
      }
    } catch (error) {
      console.error('Error uploading logo:', error);
      alert('Fehler beim Hochladen des Logos');
    } finally {
      setUploading(false);
    }
  };

  const handleLogoDelete = async () => {
    if (!confirm('Möchten Sie das Logo wirklich löschen?')) return;

    try {
      const response = await fetch('/api/settings/logo', {
        method: 'DELETE'
      });

      if (response.ok) {
        updateSettings({ logo_path: null });
        onSettingsChange();
      } else {
        alert('Fehler beim Löschen des Logos');
      }
    } catch (error) {
      console.error('Error deleting logo:', error);
      alert('Fehler beim Löschen des Logos');
    }
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>Einstellungen</h1>
      </div>

      <div className="settings-section">
        <h2>Logo</h2>
        <p className="section-description">
          Laden Sie ein Logo hoch, das in der Kopfzeile angezeigt wird.
        </p>

        <div className="logo-settings">
          {settings.logo_path && (
            <div className="logo-preview">
              <img src={settings.logo_path} alt="Logo" />
            </div>
          )}

          <div className="logo-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              style={{ display: 'none' }}
            />

            <button
              className="btn btn-primary"
              onClick={() => fileInputRef.current.click()}
              disabled={uploading}
            >
              <Upload size={18} />
              {uploading ? 'Lädt hoch...' : settings.logo_path ? 'Logo ändern' : 'Logo hochladen'}
            </button>

            {settings.logo_path && (
              <button
                className="btn btn-danger"
                onClick={handleLogoDelete}
              >
                <Trash2 size={18} />
                Logo löschen
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h2>Theme</h2>
        <p className="section-description">
          Aktuell wird nur der Dark Mode unterstützt.
        </p>
        <div className="theme-info">
          <div className="theme-badge">
            Dark Mode aktiv
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
