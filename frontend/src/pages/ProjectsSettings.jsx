import { useState, useEffect } from 'react';
import { FolderOpen, Save, RefreshCw, Cloud, ImageIcon } from 'lucide-react';
import './ProjectsSettings.css';

function ProjectsSettings() {
  const [settings, setSettings] = useState({
    project_path: '',
    sync_interval: 30,
    auto_sync_enabled: 1
  });
  const [newPath, setNewPath] = useState('');
  const [syncInterval, setSyncInterval] = useState(30);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [driveSyncing, setDriveSyncing] = useState(false);
  const [includePhotos, setIncludePhotos] = useState(true);
  const [driveSyncResult, setDriveSyncResult] = useState(null);

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
        setSyncInterval(data.sync_interval || 30);
        setAutoSyncEnabled(data.auto_sync_enabled === 1);
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
        body: JSON.stringify({
          path: newPath,
          sync_interval: syncInterval,
          auto_sync_enabled: autoSyncEnabled
        })
      });

      if (response.ok) {
        loadSettings();
        alert('Einstellungen erfolgreich gespeichert');
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

  const handleDriveSync = async () => {
    setDriveSyncing(true);
    setDriveSyncResult(null);

    try {
      const response = await fetch('/api/projects/sync-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includePhotos })
      });

      if (response.ok) {
        const data = await response.json();
        setDriveSyncResult(data);
      } else {
        const error = await response.json();
        setDriveSyncResult({ success: false, error: error.error || 'Synchronisierung fehlgeschlagen' });
      }
    } catch (error) {
      console.error('Error syncing to Drive:', error);
      setDriveSyncResult({ success: false, error: 'Verbindungsfehler: ' + error.message });
    } finally {
      setDriveSyncing(false);
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
        let message = `Synchronisierung erfolgreich!\n\n${data.added} neue Projekte hinzugefügt\n${data.total} Ordner insgesamt`;

        // Show removed projects if any
        if (data.removed && data.removed.length > 0) {
          message += `\n\nEntfernte Projekte (${data.removed.length}):\n${data.removed.join('\n')}`;
        }

        // Show image counts if available
        if (data.imageCounts && data.imageCounts.length > 0) {
          const top5 = data.imageCounts.slice(0, 5);
          message += `\n\nBilder pro Projekt (Top 5):\n${top5.map(p => `${p.folder}: ${p.count} Bilder`).join('\n')}`;
          if (data.imageCounts.length > 5) {
            message += `\n... und ${data.imageCounts.length - 5} weitere`;
          }
        }

        alert(message);
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
          Neue Ordner werden automatisch als Projekte hinzugefügt und alphabetisch sortiert.
        </p>

        <div className="sync-settings">
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={autoSyncEnabled}
                onChange={(e) => setAutoSyncEnabled(e.target.checked)}
              />
              Automatische Synchronisierung aktivieren
            </label>
          </div>

          {autoSyncEnabled && (
            <div className="form-group">
              <label htmlFor="sync-interval">Sync-Intervall (Minuten)</label>
              <input
                id="sync-interval"
                type="number"
                min="1"
                max="1440"
                value={syncInterval}
                onChange={(e) => setSyncInterval(parseInt(e.target.value) || 30)}
                className="input-number"
              />
              <small className="help-text">
                Projekte werden automatisch alle {syncInterval} Minuten synchronisiert
              </small>
            </div>
          )}
        </div>

        <button
          className="btn btn-secondary"
          onClick={handleSync}
          disabled={syncing || !settings.project_path}
        >
          <RefreshCw size={18} className={syncing ? 'spinning' : ''} />
          {syncing ? 'Synchronisiere...' : 'Jetzt synchronisieren'}
        </button>

        {settings.last_sync && (
          <div className="last-sync-info">
            Letzte Synchronisierung: {new Date(settings.last_sync + 'Z').toLocaleString('de-DE')}
          </div>
        )}
      </div>

      <div className="settings-section">
        <h2>
          <Cloud size={20} style={{ marginRight: 8, verticalAlign: 'middle' }} />
          Google Drive Sync
        </h2>
        <p className="section-description">
          Synchronisieren Sie alle Projekte mit Google Drive. Für jedes Projekt wird ein Ordner
          unter <code>NR_Fuchs_Meta/Projekte/</code> erstellt. Bilder werden verschoben (nicht kopiert).
        </p>

        <div className="sync-settings">
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={includePhotos}
                onChange={(e) => setIncludePhotos(e.target.checked)}
              />
              Fotos mit verschieben (zugeordnete Bilder in Projektordner verschieben)
            </label>
            <small className="help-text">
              Bilder werden auf Google Drive vom Hauptordner in den jeweiligen Projektordner verschoben.
            </small>
          </div>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleDriveSync}
          disabled={driveSyncing}
        >
          <Cloud size={18} className={driveSyncing ? 'spinning' : ''} />
          {driveSyncing ? 'Synchronisiere mit Drive...' : 'Mit Google Drive synchronisieren'}
        </button>

        {driveSyncResult && (
          <div className={`drive-sync-result ${driveSyncResult.success ? 'success' : 'error'}`}>
            {driveSyncResult.success ? (
              <>
                <strong>Synchronisierung erfolgreich!</strong>
                <ul>
                  <li>{driveSyncResult.totalProjects} Projekte verarbeitet</li>
                  <li>{driveSyncResult.createdFolders} neue Ordner auf Drive erstellt</li>
                  {driveSyncResult.movedImages > 0 && (
                    <li>{driveSyncResult.movedImages} Bilder verschoben</li>
                  )}
                  {driveSyncResult.skippedImages > 0 && (
                    <li>{driveSyncResult.skippedImages} Bilder bereits im Zielordner</li>
                  )}
                </ul>
                {driveSyncResult.errors && driveSyncResult.errors.length > 0 && (
                  <div className="drive-sync-errors">
                    <strong>Fehler ({driveSyncResult.errors.length}):</strong>
                    <ul>
                      {driveSyncResult.errors.slice(0, 5).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                      {driveSyncResult.errors.length > 5 && (
                        <li>... und {driveSyncResult.errors.length - 5} weitere</li>
                      )}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <span>{driveSyncResult.error}</span>
            )}
          </div>
        )}
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
