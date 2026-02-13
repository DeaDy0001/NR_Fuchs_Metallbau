import { useState, useEffect } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import './DriveSettings.css';

function DriveSettings() {
  const [paths, setPaths] = useState([]);
  const [newPath, setNewPath] = useState({ name: '', path: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadPaths();
  }, []);

  const loadPaths = async () => {
    try {
      const response = await fetch('/api/drive/settings');
      if (response.ok) {
        const data = await response.json();
        setPaths(data);
      }
    } catch (error) {
      console.error('Error loading paths:', error);
    }
  };

  const handleAddPath = async () => {
    if (!newPath.name || !newPath.path) {
      alert('Bitte Name und Pfad eingeben');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/drive/settings/path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPath)
      });

      if (response.ok) {
        setNewPath({ name: '', path: '' });
        loadPaths();
      } else {
        alert('Fehler beim Hinzufügen des Pfads');
      }
    } catch (error) {
      console.error('Error adding path:', error);
      alert('Fehler beim Hinzufügen des Pfads');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePath = async (id) => {
    if (!confirm('Möchten Sie diesen Pfad wirklich löschen?')) return;

    try {
      const response = await fetch(`/api/drive/settings/path/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        loadPaths();
      } else {
        alert('Fehler beim Löschen des Pfads');
      }
    } catch (error) {
      console.error('Error deleting path:', error);
      alert('Fehler beim Löschen des Pfads');
    }
  };

  return (
    <div className="drive-settings-page">
      <div className="page-header">
        <h1>Drive Einstellungen</h1>
      </div>

      <div className="settings-section">
        <h2>Google Drive Pfade</h2>
        <p className="section-description">
          Fügen Sie Google Drive Ordner-Links hinzu. Verwenden Sie öffentliche Freigabelinks.
        </p>

        <div className="add-path-form">
          <input
            type="text"
            placeholder="Name (z.B. Projekt Bilder)"
            value={newPath.name}
            onChange={(e) => setNewPath({ ...newPath, name: e.target.value })}
            className="input"
          />
          <input
            type="text"
            placeholder="Google Drive Link"
            value={newPath.path}
            onChange={(e) => setNewPath({ ...newPath, path: e.target.value })}
            className="input"
          />
          <button
            className="btn btn-primary"
            onClick={handleAddPath}
            disabled={loading}
          >
            <Plus size={18} />
            Hinzufügen
          </button>
        </div>

        <div className="paths-list">
          {paths.length === 0 ? (
            <div className="empty-state">
              <p>Keine Pfade konfiguriert</p>
            </div>
          ) : (
            paths.map(path => (
              <div key={path.id} className="path-item">
                <div className="path-info">
                  <div className="path-name">{path.name}</div>
                  <div className="path-url">{path.path}</div>
                  <div className="path-meta">
                    Hinzugefügt am {new Date(path.created_at).toLocaleDateString('de-DE')}
                  </div>
                </div>
                <button
                  className="btn btn-danger-outline"
                  onClick={() => handleDeletePath(path.id)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="settings-section">
        <h2>Info</h2>
        <p className="section-description">
          Die Google Drive Integration verwendet öffentliche Links. Stellen Sie sicher, dass die Ordner
          freigegeben sind. Eine vollständige OAuth-Integration kann später hinzugefügt werden.
        </p>
      </div>
    </div>
  );
}

export default DriveSettings;
