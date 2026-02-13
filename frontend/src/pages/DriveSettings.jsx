import { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Edit2, RefreshCw, ChevronDown, ChevronUp, Image, AlertCircle, Clock, CheckCircle, XCircle } from 'lucide-react';
import AuthStatus from '../components/AuthStatus';
import './DriveSettings.css';

// PathForm component - defined outside to prevent re-creation on each render
const PathForm = ({ formData, setFormData, showAdv, setShowAdv, onSubmit, onCancel, isEdit = false }) => (
  <div className="path-form">
    <div className="form-row">
      <div className="form-group">
        <label className="form-label">Name</label>
        <input
          type="text"
          placeholder="z.B. Projekt Bilder"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="input"
        />
      </div>
      <div className="form-group">
        <label className="form-label">Google Drive Link</label>
        <input
          type="text"
          placeholder="https://drive.google.com/drive/folders/..."
          value={formData.path}
          onChange={(e) => setFormData({ ...formData, path: e.target.value })}
          className="input"
        />
      </div>
    </div>

    {/* Rest of the form will be copied below */}
  </div>
);

function DriveSettings() {
  const [paths, setPaths] = useState([]);
  const [newPath, setNewPath] = useState({
    name: '',
    path: '',
    compression_enabled: false,
    compression_quality: 85,
    compression_format: 'webp',
    max_width: '',
    max_height: '',
    delete_after_sync: false,
    auto_sync_enabled: true,
    sync_interval: 60
  });
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editingPath, setEditingPath] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editShowAdvanced, setEditShowAdvanced] = useState(false);
  const [syncingPaths, setSyncingPaths] = useState({});
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    loadPaths();
  }, []);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

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
      showNotification('Bitte Name und Pfad eingeben', 'error');
      return;
    }

    setLoading(true);

    try {
      const pathData = {
        ...newPath,
        max_width: newPath.max_width ? parseInt(newPath.max_width) : null,
        max_height: newPath.max_height ? parseInt(newPath.max_height) : null
      };

      const response = await fetch('/api/drive/settings/path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pathData)
      });

      if (response.ok) {
        setNewPath({
          name: '',
          path: '',
          compression_enabled: false,
          compression_quality: 85,
          compression_format: 'webp',
          max_width: '',
          max_height: '',
          delete_after_sync: false,
          auto_sync_enabled: true,
          sync_interval: 60
        });
        setShowAddForm(false);
        setShowAdvanced(false);
        loadPaths();
        showNotification('Pfad erfolgreich hinzugefügt');
      } else {
        showNotification('Fehler beim Hinzufügen des Pfads', 'error');
      }
    } catch (error) {
      console.error('Error adding path:', error);
      showNotification('Fehler beim Hinzufügen des Pfads', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleEditPath = async () => {
    if (!editForm.name || !editForm.path) {
      showNotification('Bitte Name und Pfad eingeben', 'error');
      return;
    }

    setLoading(true);

    try {
      const pathData = {
        ...editForm,
        max_width: editForm.max_width ? parseInt(editForm.max_width) : null,
        max_height: editForm.max_height ? parseInt(editForm.max_height) : null
      };

      const response = await fetch(`/api/drive/settings/path/${editingPath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pathData)
      });

      if (response.ok) {
        setEditingPath(null);
        setEditForm(null);
        setEditShowAdvanced(false);
        loadPaths();
        showNotification('Pfad erfolgreich aktualisiert');
      } else {
        showNotification('Fehler beim Aktualisieren des Pfads', 'error');
      }
    } catch (error) {
      console.error('Error updating path:', error);
      showNotification('Fehler beim Aktualisieren des Pfads', 'error');
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
        showNotification('Pfad erfolgreich gelöscht');
      } else {
        showNotification('Fehler beim Löschen des Pfads', 'error');
      }
    } catch (error) {
      console.error('Error deleting path:', error);
      showNotification('Fehler beim Löschen des Pfads', 'error');
    }
  };

  const handleSyncNow = async (id) => {
    setSyncingPaths(prev => ({ ...prev, [id]: true }));

    try {
      const response = await fetch(`/api/drive/settings/path/${id}/sync`, {
        method: 'POST'
      });

      if (response.ok) {
        loadPaths();
        showNotification('Synchronisation erfolgreich gestartet');
      } else {
        showNotification('Fehler beim Starten der Synchronisation', 'error');
      }
    } catch (error) {
      console.error('Error syncing path:', error);
      showNotification('Fehler beim Starten der Synchronisation', 'error');
    } finally {
      setSyncingPaths(prev => ({ ...prev, [id]: false }));
    }
  };

  const startEdit = (path) => {
    setEditingPath(path.id);
    setEditForm({
      name: path.name,
      path: path.path,
      compression_enabled: path.compression_enabled || false,
      compression_quality: path.compression_quality || 85,
      compression_format: path.compression_format || 'webp',
      max_width: path.max_width || '',
      max_height: path.max_height || '',
      delete_after_sync: path.delete_after_sync || false,
      auto_sync_enabled: path.auto_sync_enabled !== undefined ? path.auto_sync_enabled : true,
      sync_interval: path.sync_interval || 60
    });
    setEditShowAdvanced(false);
  };

  const cancelEdit = () => {
    setEditingPath(null);
    setEditForm(null);
    setEditShowAdvanced(false);
  };

  const formatLastSync = (lastSync) => {
    if (!lastSync) return 'Noch nie synchronisiert';

    const now = new Date();
    const syncDate = new Date(lastSync);
    const diffMs = now - syncDate;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Gerade eben';
    if (diffMins < 60) return `Vor ${diffMins} Minute${diffMins !== 1 ? 'n' : ''}`;
    if (diffHours < 24) return `Vor ${diffHours} Stunde${diffHours !== 1 ? 'n' : ''}`;
    return `Vor ${diffDays} Tag${diffDays !== 1 ? 'en' : ''}`;
  };

  const PathForm = ({ formData, setFormData, showAdv, setShowAdv, onSubmit, onCancel, isEdit = false }) => (
    <div className="path-form">
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Name</label>
          <input
            type="text"
            placeholder="z.B. Projekt Bilder"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="input"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Google Drive Link</label>
          <input
            type="text"
            placeholder="https://drive.google.com/drive/folders/..."
            value={formData.path}
            onChange={(e) => setFormData({ ...formData, path: e.target.value })}
            className="input"
          />
        </div>
      </div>

      <div className="form-row form-row-grid">
        <div className="form-group checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={formData.compression_enabled}
              onChange={(e) => setFormData({ ...formData, compression_enabled: e.target.checked })}
              className="checkbox"
            />
            <span>Komprimierung aktivieren</span>
          </label>
        </div>

        {formData.compression_enabled && (
          <>
            <div className="form-group">
              <label className="form-label">Format</label>
              <select
                value={formData.compression_format}
                onChange={(e) => setFormData({ ...formData, compression_format: e.target.value })}
                className="input select"
              >
                <option value="webp">WebP</option>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Qualität: {formData.compression_quality}%</label>
              <input
                type="range"
                min="0"
                max="100"
                value={formData.compression_quality}
                onChange={(e) => setFormData({ ...formData, compression_quality: parseInt(e.target.value) })}
                className="slider"
              />
            </div>
          </>
        )}

        <div className="form-group checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={formData.auto_sync_enabled}
              onChange={(e) => setFormData({ ...formData, auto_sync_enabled: e.target.checked })}
              className="checkbox"
            />
            <span>Automatische Synchronisation</span>
          </label>
        </div>

        {formData.auto_sync_enabled && (
          <div className="form-group">
            <label className="form-label">Synchronisationsintervall (Minuten)</label>
            <input
              type="number"
              min="1"
              value={formData.sync_interval}
              onChange={(e) => setFormData({ ...formData, sync_interval: parseInt(e.target.value) || 60 })}
              className="input"
            />
          </div>
        )}
      </div>

      <button
        className="advanced-toggle"
        onClick={() => setShowAdv(!showAdv)}
        type="button"
      >
        {showAdv ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        Erweiterte Einstellungen
      </button>

      {showAdv && (
        <div className="advanced-settings">
          <div className="form-row form-row-grid">
            <div className="form-group">
              <label className="form-label">Max. Breite (optional)</label>
              <input
                type="number"
                placeholder="z.B. 1920"
                value={formData.max_width}
                onChange={(e) => setFormData({ ...formData, max_width: e.target.value })}
                className="input"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Max. Höhe (optional)</label>
              <input
                type="number"
                placeholder="z.B. 1080"
                value={formData.max_height}
                onChange={(e) => setFormData({ ...formData, max_height: e.target.value })}
                className="input"
              />
            </div>
          </div>

          <div className="form-group checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={formData.delete_after_sync}
                onChange={(e) => setFormData({ ...formData, delete_after_sync: e.target.checked })}
                className="checkbox"
              />
              <span>Nach Sync löschen</span>
            </label>
            {formData.delete_after_sync && (
              <div className="warning-text">
                <AlertCircle size={14} />
                Drive-Ordner muss zum Bearbeiten freigegeben sein
              </div>
            )}
          </div>
        </div>
      )}

      <div className="form-actions">
        <button
          className="btn btn-primary"
          onClick={onSubmit}
          disabled={loading}
        >
          <Save size={18} />
          {isEdit ? 'Speichern' : 'Hinzufügen'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={loading}
        >
          Abbrechen
        </button>
      </div>
    </div>
  );

  return (
    <div className="drive-settings-page">
      {notification && (
        <div className={`notification notification-${notification.type}`}>
          {notification.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
          {notification.message}
        </div>
      )}

      <div className="page-header">
        <h1>Drive Einstellungen</h1>
      </div>

      <AuthStatus />

      <div className="settings-section">
        <h2>Google Drive Pfade</h2>
        <p className="section-description">
          Fügen Sie Google Drive Ordner-Links hinzu und konfigurieren Sie Synchronisations- und Komprimierungseinstellungen.
        </p>

        {!showAddForm ? (
          <button
            className="btn btn-primary"
            onClick={() => setShowAddForm(true)}
          >
            <Plus size={18} />
            Neuen Pfad hinzufügen
          </button>
        ) : (
          <PathForm
            formData={newPath}
            setFormData={setNewPath}
            showAdv={showAdvanced}
            setShowAdv={setShowAdvanced}
            onSubmit={handleAddPath}
            onCancel={() => {
              setShowAddForm(false);
              setShowAdvanced(false);
            }}
          />
        )}

        <div className="paths-list">
          {paths.length === 0 ? (
            <div className="empty-state">
              <p>Keine Pfade konfiguriert</p>
            </div>
          ) : (
            paths.map(path => (
              <div key={path.id} className="path-item">
                {editingPath === path.id ? (
                  <PathForm
                    formData={editForm}
                    setFormData={setEditForm}
                    showAdv={editShowAdvanced}
                    setShowAdv={setEditShowAdvanced}
                    onSubmit={handleEditPath}
                    onCancel={cancelEdit}
                    isEdit={true}
                  />
                ) : (
                  <>
                    <div className="path-info">
                      <div className="path-header">
                        <div className="path-name">{path.name}</div>
                        <div className="path-badges">
                          {path.compression_enabled && (
                            <span className="badge badge-info" title="Komprimierung aktiviert">
                              <Image size={14} />
                              {path.compression_format?.toUpperCase()} {path.compression_quality}%
                            </span>
                          )}
                          {path.auto_sync_enabled ? (
                            <span className="badge badge-success" title="Auto-Sync aktiviert">
                              <Clock size={14} />
                              Auto-Sync: {path.sync_interval}min
                            </span>
                          ) : (
                            <span className="badge badge-inactive" title="Auto-Sync deaktiviert">
                              Auto-Sync: Aus
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="path-url">{path.path}</div>
                      <div className="path-meta">
                        <span>Hinzugefügt am {new Date(path.created_at).toLocaleDateString('de-DE')}</span>
                        <span className="sync-status">
                          <Clock size={14} />
                          {formatLastSync(path.last_sync)}
                        </span>
                      </div>
                    </div>
                    <div className="path-actions">
                      <button
                        className="btn btn-icon"
                        onClick={() => handleSyncNow(path.id)}
                        disabled={syncingPaths[path.id]}
                        title="Jetzt synchronisieren"
                      >
                        <RefreshCw size={18} className={syncingPaths[path.id] ? 'spinning' : ''} />
                      </button>
                      <button
                        className="btn btn-icon"
                        onClick={() => startEdit(path)}
                        title="Bearbeiten"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        className="btn btn-icon btn-danger-icon"
                        onClick={() => handleDeletePath(path.id)}
                        title="Löschen"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="settings-section">
        <h2>Info</h2>
        <p className="section-description">
          Die Google Drive Integration verwendet OAuth 2.0 für sicheren Zugriff auf deine Drive-Ordner.
          Nach der einmaligen Anmeldung bleiben deine Zugangsdaten dauerhaft gespeichert.
          Du musst dich nur neu anmelden, wenn deine Session nach längerer Zeit abläuft (~30 Tage).
        </p>
      </div>
    </div>
  );
}

export default DriveSettings;
