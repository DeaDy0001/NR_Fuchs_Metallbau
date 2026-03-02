import { useState } from 'react';
import './DeleteImageDialog.css';

function DeleteImageDialog({ image, onDelete, onClose }) {
  const [deleteFromProjects, setDeleteFromProjects] = useState(false);

  const handleDelete = (deleteFromDrive) => {
    onDelete(deleteFromDrive, deleteFromProjects);
    setDeleteFromProjects(false);
  };

  const handleClose = () => {
    setDeleteFromProjects(false);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="delete-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Bild löschen</h3>
        <p>Möchtest du das Bild <strong>"{image.name}"</strong> löschen?</p>

        {image.projects && image.projects.length > 0 && (
          <div className="delete-projects-checkbox">
            <label>
              <input
                type="checkbox"
                checked={deleteFromProjects}
                onChange={(e) => setDeleteFromProjects(e.target.checked)}
              />
              <span>
                Auch von {image.projects.length === 1 ? 'Projekt' : 'allen Projekten'} löschen?
                <span className="delete-projects-names">
                  {image.projects.map(p => p.folder_name).join(', ')}
                </span>
              </span>
            </label>
          </div>
        )}

        <div className="delete-options">
          <button
            className="delete-option-btn software-only"
            onClick={() => handleDelete(false)}
          >
            <div className="option-title">🗑️ Nur aus Software</div>
            <div className="option-description">
              {image.drive_file_id
                ? 'Bleibt auf Google Drive, wird aber nicht mehr heruntergeladen'
                : 'Bild wird aus der Software gelöscht'}
            </div>
          </button>
          {image.drive_file_id && (
            <button
              className="delete-option-btn full-delete"
              onClick={() => handleDelete(true)}
            >
              <div className="option-title">🔥 Auch von Google Drive</div>
              <div className="option-description">
                Wird permanent von Google Drive gelöscht
              </div>
            </button>
          )}
        </div>
        <button
          className="delete-cancel-btn"
          onClick={handleClose}
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

export default DeleteImageDialog;
