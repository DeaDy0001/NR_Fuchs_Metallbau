import { useState, useEffect } from 'react';
import { FolderOpen, Save, RefreshCw, Cloud, X, Plus } from 'lucide-react';
import './ProjectsSettings.css';

const YEAR_MODES = [
  {
    key: 'flat',
    label: 'Einfacher Ordner (Standard)',
    description: 'Jeder Unterordner im gewählten Pfad ist ein Projekt. Kein automatisches Jahr. Bestimmte Unterordner können ausgeschlossen werden.',
  },
  {
    key: 'suffix',
    label: 'Ordner mit Jahreszahl am Ende',
    description: 'Der konfigurierte Pfad endet mit einer Jahreszahl (z.B. GVU_2025). Das System findet automatisch alle Geschwister-Ordner mit demselben Basisnamen und anderen Jahren (GVU_2024, GVU_2026, …). Jedes Projekt erhält das Jahr seines Ordners.',
  },
  {
    key: 'subfolder',
    label: 'Jahresordner als Unterordner',
    description: 'Im konfigurierten Ordner befinden sich Unterordner, die nur aus einer Jahreszahl bestehen (2023, 2024, 2026, …). Die darin enthaltenen Ordner sind die Projekte – jedes bekommt das Jahr seines Elternordners. Fehlende Jahre werden ignoriert.',
  },
];

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

  // Year detection
  const [yearMode, setYearMode] = useState('flat');
  const [excludedFolders, setExcludedFolders] = useState([]);
  const [newExclude, setNewExclude] = useState('');
  const [yearModeSaving, setYearModeSaving] = useState(false);

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
        setYearMode(data.year_detection_mode || 'flat');
        try {
          setExcludedFolders(JSON.parse(data.excluded_folders || '[]'));
        } catch {
          setExcludedFolders([]);
        }
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const handleSaveYearMode = async () => {
    setYearModeSaving(true);
    try {
      const response = await fetch('/api/projects/settings/year-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year_detection_mode: yearMode, excluded_folders: excludedFolders }),
      });
      if (!response.ok) {
        const err = await response.json();
        alert(`Fehler: ${err.error}`);
      }
    } catch (error) {
      alert('Fehler beim Speichern');
    } finally {
      setYearModeSaving(false);
    }
  };

  const handleAddExclude = () => {
    const val = newExclude.trim();
    if (val && !excludedFolders.includes(val)) {
      setExcludedFolders([...excludedFolders, val]);
      setNewExclude('');
    }
  };

  const handleRemoveExclude = (folder) => {
    setExcludedFolders(excludedFolders.filter(f => f !== folder));
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
          unter <code>NR_Fuchs_Meta/Projekte/</code> erstellt.
          Bilder aus dem lokalen Projektordner werden auf Drive hochgeladen bzw. verschoben.
        </p>

        <div className="sync-settings">
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={includePhotos}
                onChange={(e) => setIncludePhotos(e.target.checked)}
              />
              Fotos synchronisieren (Bilder in Projektordner auf Drive hochladen/verschieben)
            </label>
            <small className="help-text">
              Lokale Projektbilder werden auf Google Drive hochgeladen.
              Bereits auf Drive vorhandene Bilder werden in den Projektordner verschoben.
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
                  {driveSyncResult.uploadedImages > 0 && (
                    <li>{driveSyncResult.uploadedImages} Bilder hochgeladen</li>
                  )}
                  {driveSyncResult.movedImages > 0 && (
                    <li>{driveSyncResult.movedImages} Bilder verschoben</li>
                  )}
                  {driveSyncResult.skippedImages > 0 && (
                    <li>{driveSyncResult.skippedImages} Bilder bereits auf Drive</li>
                  )}
                </ul>
                {driveSyncResult.driveStatus && driveSyncResult.driveStatus.length > 0 && (
                  <div className="drive-status-table">
                    <strong>Drive-Status pro Projekt:</strong>
                    <table>
                      <thead>
                        <tr>
                          <th>Projekt</th>
                          <th>Auf Drive</th>
                          <th>Lokal</th>
                          <th>Drive</th>
                        </tr>
                      </thead>
                      <tbody>
                        {driveSyncResult.driveStatus.map((s, i) => (
                          <tr key={i} className={!s.onDrive || s.driveImages < s.localImages ? 'status-warning' : ''}>
                            <td>{s.name}</td>
                            <td>{s.onDrive ? '✓' : '✗'}</td>
                            <td>{s.localImages}</td>
                            <td>{s.driveImages}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
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
        <h2>Jahreserkennung</h2>
        <p className="section-description">
          Legen Sie fest, wie das System das Jahr für jedes Projekt ermittelt.
          Das erkannte Jahr wird in <code>project.json</code> auf Google Drive gespeichert
          und in der mobilen App als Badge angezeigt.
        </p>

        <div className="year-mode-options">
          {YEAR_MODES.map(mode => (
            <label key={mode.key} className={`year-mode-option ${yearMode === mode.key ? 'selected' : ''}`}>
              <input
                type="radio"
                name="yearMode"
                value={mode.key}
                checked={yearMode === mode.key}
                onChange={() => setYearMode(mode.key)}
              />
              <div className="year-mode-content">
                <span className="year-mode-label">{mode.label}</span>
                <span className="year-mode-desc">{mode.description}</span>
              </div>
            </label>
          ))}
        </div>

        {yearMode === 'flat' && (
          <div className="excluded-folders-section">
            <h3>Ausgeschlossene Ordner</h3>
            <p className="section-description">
              Diese Unterordner werden beim Synchronisieren ignoriert und nicht als Projekte erfasst.
            </p>
            <div className="exclude-input-row">
              <input
                type="text"
                className="input"
                placeholder="Ordnername eingeben…"
                value={newExclude}
                onChange={e => setNewExclude(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddExclude()}
              />
              <button className="btn btn-secondary" onClick={handleAddExclude}>
                <Plus size={16} />
                Hinzufügen
              </button>
            </div>
            {excludedFolders.length > 0 && (
              <div className="excluded-folder-list">
                {excludedFolders.map(f => (
                  <span key={f} className="excluded-folder-chip">
                    {f}
                    <button onClick={() => handleRemoveExclude(f)} title="Entfernen">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          className="btn btn-primary"
          onClick={handleSaveYearMode}
          disabled={yearModeSaving}
        >
          <Save size={18} />
          {yearModeSaving ? 'Speichern…' : 'Einstellungen speichern'}
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
