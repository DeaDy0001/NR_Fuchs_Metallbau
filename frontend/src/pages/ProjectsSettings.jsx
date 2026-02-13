import { useState, useEffect } from 'react';
import { FolderOpen, Save, RefreshCw } from 'lucide-react';
import './ProjectsSettings.css';

function ProjectsSettings() {
  const [settings, setSettings] = useState({ project_path: '' });
  const [newPath, setNewPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/projects/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setNewPath(data.project_path || '');
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const handleSavePath = async () => {
    if (!newPath) {
      alert('Bitte einen Pfad eingeben');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/projects/settings/path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath })
      });

      if (response.ok) {
        loadSettings();
        alert('Pfad erfolgreich gespeichert');
      } else {
        const error = await response.json();
        alert(`Fehler: ${error.error || 'Pfad konnte nicht gespeichert werden'}`);
      }
    } catch (error) {
      console.error('Error saving path:', error);
      alert('Fehler beim Speichern des Pfads');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    if (!settings.project_path) {
      alert('Bitte zuerst einen Pfad konfigurieren');
      return;
    }

    setSyncing(true);

    try {
      const response = await fetch('/api/projects/sync', {
        method: 'POST'
      });

      if (response.ok) {
        const data = await response.json();
        alert(`Synchronisierung erfolgreich!\n${data.added} neue Projekte hinzugefügt\n${data.total} Ordner insgesamt`);
      } else {
        const error = await response.json();
        alert(`Fehler: ${error.error || 'Synchronisierung fehlgeschlagen'}`);
      }
    } catch (error) {
      console.error('Error syncing projects:', error);
      alert('Fehler bei der Synchronisierung');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="projects-settings-page">
      <div className="page-header">
        <h1>Projekt Einstellungen</h1>
      </div>

      <div className="settings-section">
        <h2>Projekt Ordner</h2>
        <p className="section-description">
          Wählen Sie einen lokalen Ordner, der Ihre Projekte enthält. Jeder Unterordner wird als Projekt erkannt.
        </p>

        <div className="path-input-group">
          <div className="input-with-icon">
            <FolderOpen size={20} />
            <input
              type="text"
              placeholder="Z.B. C:\Projekte oder /home/user/projekte"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              className="input"
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSavePath}
            disabled={loading}
          >
            <Save size={18} />
            Speichern
          </button>
        </div>

        {settings.project_path && (
          <div className="current-path">
            <div className="current-path-label">Aktueller Pfad:</div>
            <div className="current-path-value">{settings.project_path}</div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <h2>Synchronisierung</h2>
        <p className="section-description">
          Synchronisieren Sie die Projekte aus dem konfigurierten Ordner mit der Datenbank.
          Neue Ordner werden automatisch als Projekte hinzugefügt.
        </p>

        <button
          className="btn btn-secondary"
          onClick={handleSync}
          disabled={syncing || !settings.project_path}
        >
          <RefreshCw size={18} className={syncing ? 'spinning' : ''} />
          {syncing ? 'Synchronisiere...' : 'Projekte synchronisieren'}
        </button>
      </div>

      <div className="settings-section">
        <h2>Info</h2>
        <p className="section-description">
          Projektinformationen wie Farben und Notizen werden in der Datenbank gespeichert,
          nicht im Projektordner selbst. So bleiben Ihre Projektordner unverändert.
        </p>
      </div>
    </div>
  );
}

export default ProjectsSettings;
