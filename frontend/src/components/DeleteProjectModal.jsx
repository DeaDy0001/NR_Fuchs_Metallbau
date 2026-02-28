import { useState } from 'react';
import { Trash2, AlertTriangle, X, Shield, FolderX, Flame } from 'lucide-react';
import './DeleteProjectModal.css';

/**
 * DeleteProjectModal - Three-mode project deletion
 *
 * Props:
 * - project: { id, folder_name, image_count }
 * - onClose: () => void
 * - onDeleted: () => void (called after successful deletion)
 */
function DeleteProjectModal({ project, onClose, onDeleted }) {
  const [selectedMode, setSelectedMode] = useState(null);
  const [confirmStep, setConfirmStep] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const handleSelectMode = (mode) => {
    setSelectedMode(mode);
    setConfirmStep(true);
    setConfirmName('');
    setError(null);
  };

  const handleBack = () => {
    setConfirmStep(false);
    setSelectedMode(null);
    setError(null);
  };

  const handleDelete = async () => {
    if (selectedMode === 'complete' && confirmName !== project.folder_name) {
      setError('Der Projektname stimmt nicht überein.');
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${project.id}?mode=${selectedMode}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Löschen fehlgeschlagen');
      }

      if (data.errors && data.errors.length > 0) {
        console.warn('Lösch-Warnungen:', data.errors);
      }

      onDeleted();
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  };

  // --- Mode selection view ---
  if (!confirmStep) {
    return (
      <div className="delete-modal-overlay" onClick={onClose}>
        <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
          <div className="delete-modal-header">
            <h2>
              <Trash2 size={20} />
              Projekt löschen
            </h2>
            <button className="modal-close" onClick={onClose}>
              <X size={24} />
            </button>
          </div>

          <div className="delete-modal-project-name">
            <strong>{project.folder_name}</strong>
            <span>{project.image_count || 0} Bilder</span>
          </div>

          <div className="delete-modes">
            {/* Mode 1: Soft delete */}
            <button className="delete-mode-card mode-soft" onClick={() => handleSelectMode('soft')}>
              <div className="mode-icon mode-icon-soft">
                <FolderX size={24} />
              </div>
              <div className="mode-info">
                <h3>Aus Software entfernen</h3>
                <p>
                  Projekt wird aus der Software gelöscht. Der lokale Bilder-Ordner und der
                  Google Drive Projektordner werden entfernt. Der restliche Projektordner
                  (ohne Bilder) bleibt lokal erhalten.
                </p>
              </div>
            </button>

            {/* Mode 2: Delete with images */}
            <button className="delete-mode-card mode-images" onClick={() => handleSelectMode('with_images')}>
              <div className="mode-icon mode-icon-images">
                <Trash2 size={24} />
              </div>
              <div className="mode-info">
                <h3>Projekt & Bilder löschen</h3>
                <p>
                  Projekt und alle zugehörigen Bilder werden gelöscht - sowohl lokal als auch
                  auf Google Drive. Der restliche Projektordner bleibt lokal erhalten.
                </p>
                <span className="mode-warning-hint">
                  <AlertTriangle size={14} /> Bilder können nicht wiederhergestellt werden
                </span>
              </div>
            </button>

            {/* Mode 3: Complete delete */}
            <button className="delete-mode-card mode-complete" onClick={() => handleSelectMode('complete')}>
              <div className="mode-icon mode-icon-complete">
                <Flame size={24} />
              </div>
              <div className="mode-info">
                <h3>KOMPLETT löschen</h3>
                <p>
                  Der <strong>gesamte Projektordner</strong> wird gelöscht - lokal und auf Google Drive.
                  Alles was im Ordner liegt wird unwiderruflich entfernt.
                </p>
                <span className="mode-warning-critical">
                  <AlertTriangle size={14} /> Nicht rückgängig zu machen!
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Confirmation view ---
  return (
    <div className="delete-modal-overlay" onClick={onClose}>
      <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
        <div className="delete-modal-header">
          <h2>
            <AlertTriangle size={20} />
            Bestätigung
          </h2>
          <button className="modal-close" onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <div className="delete-confirm-content">
          {selectedMode === 'soft' && (
            <>
              <div className="confirm-banner confirm-soft">
                <FolderX size={32} />
                <div>
                  <h3>Aus Software entfernen</h3>
                  <p>
                    <strong>"{project.folder_name}"</strong> wird aus der Software entfernt.
                    Der lokale Bilder-Ordner und der Drive-Ordner werden gelöscht.
                  </p>
                </div>
              </div>
              <div className="confirm-details">
                <div className="confirm-detail-item will-delete">Bilder-Ordner lokal löschen</div>
                <div className="confirm-detail-item will-delete">Google Drive Projektordner löschen</div>
                <div className="confirm-detail-item will-delete">Projekt aus Datenbank entfernen</div>
                <div className="confirm-detail-item will-keep">Restlicher Projektordner bleibt erhalten</div>
              </div>
            </>
          )}

          {selectedMode === 'with_images' && (
            <>
              <div className="confirm-banner confirm-warning">
                <AlertTriangle size={32} />
                <div>
                  <h3>Projekt & Bilder löschen</h3>
                  <p>
                    <strong>"{project.folder_name}"</strong> und alle {project.image_count || 0} Bilder
                    werden unwiderruflich gelöscht - lokal und auf Google Drive.
                  </p>
                </div>
              </div>
              <div className="confirm-details">
                <div className="confirm-detail-item will-delete">Alle Bilddateien lokal löschen</div>
                <div className="confirm-detail-item will-delete">Alle Bilder von Google Drive löschen</div>
                <div className="confirm-detail-item will-delete">Bilder-Ordner lokal löschen</div>
                <div className="confirm-detail-item will-delete">Google Drive Projektordner löschen</div>
                <div className="confirm-detail-item will-delete">Projekt aus Datenbank entfernen</div>
                <div className="confirm-detail-item will-keep">Restlicher Projektordner bleibt erhalten</div>
              </div>
            </>
          )}

          {selectedMode === 'complete' && (
            <>
              <div className="confirm-banner confirm-danger">
                <Flame size={32} />
                <div>
                  <h3>KOMPLETT LÖSCHEN</h3>
                  <p>
                    <strong>ACHTUNG:</strong> Der gesamte Ordner <strong>"{project.folder_name}"</strong> wird
                    komplett gelöscht - jede einzelne Datei darin, egal ob Bild, PDF, Dokument oder sonstiges.
                    Dies betrifft sowohl den lokalen Ordner als auch Google Drive.
                  </p>
                </div>
              </div>
              <div className="confirm-details">
                <div className="confirm-detail-item will-delete">GESAMTER lokaler Projektordner wird gelöscht</div>
                <div className="confirm-detail-item will-delete">GESAMTER Google Drive Projektordner wird gelöscht</div>
                <div className="confirm-detail-item will-delete">Alle Dateien darin werden unwiderruflich entfernt</div>
                <div className="confirm-detail-item will-delete">Projekt aus Datenbank entfernen</div>
              </div>

              <div className="confirm-name-input">
                <label>
                  Gib den Projektnamen ein um zu bestätigen:
                  <strong> {project.folder_name}</strong>
                </label>
                <input
                  type="text"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={project.folder_name}
                  className="input"
                  autoFocus
                />
              </div>
            </>
          )}

          {error && (
            <div className="delete-error">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}

          <div className="delete-confirm-actions">
            <button className="btn btn-secondary" onClick={handleBack} disabled={deleting}>
              Zurück
            </button>
            <button
              className={`btn delete-confirm-btn ${selectedMode === 'complete' ? 'btn-danger-complete' : selectedMode === 'with_images' ? 'btn-danger-warning' : 'btn-danger-soft'}`}
              onClick={handleDelete}
              disabled={deleting || (selectedMode === 'complete' && confirmName !== project.folder_name)}
            >
              {deleting ? (
                <>Wird gelöscht...</>
              ) : selectedMode === 'complete' ? (
                <>
                  <Flame size={16} />
                  Komplett löschen
                </>
              ) : selectedMode === 'with_images' ? (
                <>
                  <Trash2 size={16} />
                  Projekt & Bilder löschen
                </>
              ) : (
                <>
                  <FolderX size={16} />
                  Aus Software entfernen
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DeleteProjectModal;
