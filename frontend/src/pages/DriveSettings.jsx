import { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Edit2, RefreshCw, Image, AlertCircle, Clock, CheckCircle, XCircle, Wand2, ChevronDown, ChevronRight } from 'lucide-react';
import AuthStatus from '../components/AuthStatus';
import './DriveSettings.css';

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
  const [editingPath, setEditingPath] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [syncingPaths, setSyncingPaths] = useState({});
  const [notification, setNotification] = useState(null);

  // Bulk conversion state
  const [bulkScope, setBulkScope] = useState('all');
  const [bulkFormat, setBulkFormat] = useState('webp');
  const [bulkQuality, setBulkQuality] = useState(85);
  const [bulkMaxWidth, setBulkMaxWidth] = useState('');
  const [bulkMaxHeight, setBulkMaxHeight] = useState('');
  const [bulkConverting, setBulkConverting] = useState(false);
  const [bulkConvertOpen, setBulkConvertOpen] = useState(false);

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
  };

  const cancelEdit = () => {
    setEditingPath(null);
    setEditForm(null);
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

  // Helper: Get the combined format value for the format selector
  const getFormatValue = (formData) => {
    if (!formData.compression_enabled) return 'original';
    return formData.compression_format || 'webp';
  };

  // Helper: Handle format change from the unified selector
  const handleFormatChange = (formData, setFormData, value) => {
    if (value === 'original') {
      setFormData({ ...formData, compression_enabled: false });
    } else {
      setFormData({
        ...formData,
        compression_enabled: true,
        compression_format: value
      });
    }
  };

  const formatOptions = [
    { value: 'original', label: 'Original', desc: 'Keine Umwandlung' },
    { value: 'webp', label: 'WebP', desc: 'Beste Komprimierung' },
    { value: 'jpeg', label: 'JPEG', desc: 'Universell kompatibel' },
    { value: 'png', label: 'PNG', desc: 'Verlustfrei' }
  ];

  const bulkFormatOptions = [
    { value: 'webp', label: 'WebP', desc: 'Beste Komprimierung' },
    { value: 'jpeg', label: 'JPEG', desc: 'Universell kompatibel' },
    { value: 'png', label: 'PNG', desc: 'Verlustfrei' }
  ];

  const scopeOptions = [
    { value: 'all', label: 'Alle Bilder', desc: 'Drive + Projekte' },
    { value: 'drive', label: 'Nur Drive', desc: 'Heruntergeladene Bilder' },
    { value: 'projects', label: 'Nur Projekte', desc: 'Projekt-Ordner' }
  ];

  const handleBulkConvert = async () => {
    const scopeLabels = { all: 'ALLE Bilder', drive: 'alle Drive-Bilder', projects: 'alle Projekt-Bilder' };
    if (!window.confirm(
      `Achtung: ${scopeLabels[bulkScope]} werden unwiderruflich in ${bulkFormat.toUpperCase()} konvertiert. ` +
      `Die Originaldateien werden dabei ersetzt.\n\nFortfahren?`
    )) {
      return;
    }

    setBulkConverting(true);
    try {
      const response = await fetch('/api/drive/convert-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: bulkScope,
          format: bulkFormat,
          quality: bulkQuality,
          maxWidth: bulkMaxWidth ? parseInt(bulkMaxWidth) : null,
          maxHeight: bulkMaxHeight ? parseInt(bulkMaxHeight) : null
        })
      });

      if (response.ok) {
        showNotification('Konvertierung wurde gestartet. Dies kann je nach Anzahl der Bilder einige Minuten dauern.');
      } else {
        showNotification('Fehler beim Starten der Konvertierung', 'error');
      }
    } catch (error) {
      console.error('Error starting bulk conversion:', error);
      showNotification('Fehler beim Starten der Konvertierung', 'error');
    } finally {
      setBulkConverting(false);
    }
  };

  const PathForm = ({ formData, setFormData, onSubmit, onCancel, isEdit = false }) => (
    <div className="path-form">
      {/* Section 1: Grundeinstellungen */}
      <div className="form-section">
        <div className="form-section-title">Grundeinstellungen</div>
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

      {/* Section 2: Bildformat */}
      <div className="form-section">
        <div className="form-section-title">Bildformat</div>
        <p className="form-section-desc">Neue Bilder werden beim Sync in dieses Format umgewandelt. Bestehende Bilder bleiben unverändert.</p>

        <div className="format-selector">
          {formatOptions.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`format-option ${getFormatValue(formData) === opt.value ? 'active' : ''}`}
              onClick={() => handleFormatChange(formData, setFormData, opt.value)}
            >
              <span className="format-option-label">{opt.label}</span>
              <span className="format-option-desc">{opt.desc}</span>
            </button>
          ))}
        </div>

        {formData.compression_enabled && (
          <div className="compression-settings">
            <div className="form-group">
              <label className="form-label">
                Qualität: <strong>{formData.compression_quality}%</strong>
              </label>
              <div className="slider-container">
                <span className="slider-label">Klein</span>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={formData.compression_quality}
                  onChange={(e) => setFormData({ ...formData, compression_quality: parseInt(e.target.value) })}
                  className="slider"
                />
                <span className="slider-label">Original</span>
              </div>
            </div>

            <div className="form-row-inline">
              <div className="form-group">
                <label className="form-label">Max. Breite (px)</label>
                <input
                  type="number"
                  placeholder="z.B. 1920"
                  value={formData.max_width}
                  onChange={(e) => setFormData({ ...formData, max_width: e.target.value })}
                  className="input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Max. Höhe (px)</label>
                <input
                  type="number"
                  placeholder="z.B. 1080"
                  value={formData.max_height}
                  onChange={(e) => setFormData({ ...formData, max_height: e.target.value })}
                  className="input"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Section 3: Synchronisation */}
      <div className="form-section">
        <div className="form-section-title">Synchronisation</div>

        <div className="toggle-row">
          <div className="toggle-info">
            <span className="toggle-label">Automatische Synchronisation</span>
            <span className="toggle-desc">Bilder werden regelmäßig automatisch heruntergeladen</span>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={formData.auto_sync_enabled}
              onChange={(e) => setFormData({ ...formData, auto_sync_enabled: e.target.checked })}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        {formData.auto_sync_enabled && (
          <div className="form-group" style={{ marginTop: '0.75rem' }}>
            <label className="form-label">Intervall (Minuten)</label>
            <input
              type="number"
              min="1"
              value={formData.sync_interval}
              onChange={(e) => setFormData({ ...formData, sync_interval: parseInt(e.target.value) || 60 })}
              className="input"
              style={{ maxWidth: '200px' }}
            />
          </div>
        )}

        <div className="toggle-row" style={{ marginTop: '0.75rem' }}>
          <div className="toggle-info">
            <span className="toggle-label">Nach Sync von Drive löschen</span>
            <span className="toggle-desc">Bilder werden nach dem Download von Google Drive entfernt</span>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={formData.delete_after_sync}
              onChange={(e) => setFormData({ ...formData, delete_after_sync: e.target.checked })}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        {formData.delete_after_sync && (
          <div className="warning-text">
            <AlertCircle size={14} />
            Drive-Ordner muss zum Bearbeiten freigegeben sein
          </div>
        )}
      </div>

      {/* Actions */}
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

      <AuthStatus />

      <div className="settings-section">
        <div className="section-header-row">
          <div>
            <h2>Google Drive Pfade</h2>
            <p className="section-description">
              Verwalte Google Drive Ordner und konfiguriere Synchronisations- und Bildverarbeitungseinstellungen.
            </p>
          </div>
          {!showAddForm && (
            <button
              className="btn btn-primary"
              onClick={() => setShowAddForm(true)}
            >
              <Plus size={18} />
              Neuer Pfad
            </button>
          )}
        </div>

        {showAddForm && (
          <PathForm
            key="add-form"
            formData={newPath}
            setFormData={setNewPath}
            onSubmit={handleAddPath}
            onCancel={() => setShowAddForm(false)}
          />
        )}

        <div className="paths-list">
          {paths.length === 0 && !showAddForm ? (
            <div className="empty-state">
              <Image size={48} strokeWidth={1} />
              <p>Keine Pfade konfiguriert</p>
              <span>Füge einen Google Drive Ordner hinzu, um Bilder zu synchronisieren.</span>
            </div>
          ) : (
            paths.map(p => (
              <div key={p.id} className="path-item">
                {editingPath === p.id ? (
                  <PathForm
                    key={`edit-${editingPath}`}
                    formData={editForm}
                    setFormData={setEditForm}
                    onSubmit={handleEditPath}
                    onCancel={cancelEdit}
                    isEdit={true}
                  />
                ) : (
                  <>
                    <div className="path-info">
                      <div className="path-header">
                        <div className="path-name">{p.name}</div>
                        <div className="path-badges">
                          <span className={`badge ${p.compression_enabled ? 'badge-info' : 'badge-inactive'}`}>
                            <Image size={12} />
                            {p.compression_enabled
                              ? `${p.compression_format?.toUpperCase()} ${p.compression_quality}%`
                              : 'Original'
                            }
                          </span>
                          <span className={`badge ${p.auto_sync_enabled ? 'badge-success' : 'badge-inactive'}`}>
                            <Clock size={12} />
                            {p.auto_sync_enabled ? `${p.sync_interval} min` : 'Manuell'}
                          </span>
                        </div>
                      </div>
                      <div className="path-url">{p.path}</div>
                      <div className="path-meta">
                        <span className="sync-status">
                          <Clock size={14} />
                          {formatLastSync(p.last_sync)}
                        </span>
                      </div>
                    </div>
                    <div className="path-actions">
                      <button
                        className="btn btn-icon"
                        onClick={() => handleSyncNow(p.id)}
                        disabled={syncingPaths[p.id]}
                        title="Jetzt synchronisieren"
                      >
                        <RefreshCw size={18} className={syncingPaths[p.id] ? 'spinning' : ''} />
                      </button>
                      <button
                        className="btn btn-icon"
                        onClick={() => startEdit(p)}
                        title="Bearbeiten"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        className="btn btn-icon btn-danger-icon"
                        onClick={() => handleDeletePath(p.id)}
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
        <p className="section-description" style={{ marginBottom: 0 }}>
          Die Google Drive Integration verwendet OAuth 2.0 für sicheren Zugriff auf deine Drive-Ordner.
          Nach der einmaligen Anmeldung bleiben deine Zugangsdaten dauerhaft gespeichert.
          Du musst dich nur neu anmelden, wenn deine Session nach längerer Zeit abläuft (~30 Tage).
        </p>
      </div>

      {/* Bulk Conversion - Collapsible */}
      <div className="settings-section">
        <button
          className="collapse-header"
          onClick={() => setBulkConvertOpen(prev => !prev)}
        >
          <h2>
            <Wand2 size={20} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />
            Bilder konvertieren
          </h2>
          {bulkConvertOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </button>

        {bulkConvertOpen && (
          <>
            <p className="section-description" style={{ marginTop: '0.75rem' }}>
              Konvertiere alle bestehenden Bilder auf einmal in ein anderes Format. Die Originaldateien werden dabei ersetzt. Dies ist eine einmalige Aktion.
            </p>

            <div className="bulk-convert-form">
              {/* Scope */}
              <div className="bulk-section">
                <div className="form-section-title">Welche Bilder?</div>
                <div className="scope-selector">
                  {scopeOptions.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`scope-option ${bulkScope === opt.value ? 'active' : ''}`}
                      onClick={() => setBulkScope(opt.value)}
                    >
                      <span className="scope-option-label">{opt.label}</span>
                      <span className="scope-option-desc">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Format */}
              <div className="bulk-section">
                <div className="form-section-title">Zielformat</div>
                <div className="format-selector">
                  {bulkFormatOptions.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`format-option ${bulkFormat === opt.value ? 'active' : ''}`}
                      onClick={() => setBulkFormat(opt.value)}
                    >
                      <span className="format-option-label">{opt.label}</span>
                      <span className="format-option-desc">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Quality & Size */}
              <div className="bulk-section">
                <div className="form-section-title">Komprimierung</div>
                <div className="form-group">
                  <label className="form-label">
                    Qualität: <strong>{bulkQuality}%</strong>
                  </label>
                  <div className="slider-container">
                    <span className="slider-label">Klein</span>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={bulkQuality}
                      onChange={(e) => setBulkQuality(parseInt(e.target.value))}
                      className="slider"
                    />
                    <span className="slider-label">Original</span>
                  </div>
                </div>

                <div className="form-row-inline" style={{ marginTop: '0.75rem' }}>
                  <div className="form-group">
                    <label className="form-label">Max. Breite (px)</label>
                    <input
                      type="number"
                      placeholder="z.B. 1920 (leer = keine)"
                      value={bulkMaxWidth}
                      onChange={(e) => setBulkMaxWidth(e.target.value)}
                      className="input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max. Höhe (px)</label>
                    <input
                      type="number"
                      placeholder="z.B. 1080 (leer = keine)"
                      value={bulkMaxHeight}
                      onChange={(e) => setBulkMaxHeight(e.target.value)}
                      className="input"
                    />
                  </div>
                </div>
              </div>

              <div className="bulk-convert-actions">
                <div className="warning-text">
                  <AlertCircle size={14} />
                  Originaldateien werden unwiderruflich ersetzt. Bilder, die bereits im Zielformat vorliegen, werden übersprungen.
                </div>
                <button
                  className="btn btn-primary"
                  onClick={handleBulkConvert}
                  disabled={bulkConverting}
                >
                  {bulkConverting ? (
                    <>
                      <RefreshCw size={16} className="spinning" />
                      Wird gestartet...
                    </>
                  ) : (
                    <>
                      <Wand2 size={16} />
                      Jetzt konvertieren
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default DriveSettings;
