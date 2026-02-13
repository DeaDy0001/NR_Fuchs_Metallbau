import { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Save, X, CheckSquare, Square } from 'lucide-react';
import './ProjectsList.css';

function ProjectsList() {
  const [projects, setProjects] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [editForm, setEditForm] = useState({ color: '', notes: '' });
  const [selectedProjects, setSelectedProjects] = useState([]); // Markierte Projekte
  const [showMarked, setShowMarked] = useState(true); // Filter: Markierte anzeigen
  const [showUnmarked, setShowUnmarked] = useState(true); // Filter: Nicht markierte anzeigen

  useEffect(() => {
    loadProjects();
  }, [searchQuery]);

  const loadProjects = async () => {
    setLoading(true);

    try {
      const params = new URLSearchParams({
        limit: 100,
        offset: 0,
        search: searchQuery
      });

      const response = await fetch(`/api/projects?${params}`);
      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (project) => {
    setEditingProject(project);
    setEditForm({
      color: project.color || '#3b82f6',
      notes: project.notes || ''
    });
  };

  const handleSave = async () => {
    if (!editingProject) return;

    try {
      const response = await fetch(`/api/projects/${editingProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });

      if (response.ok) {
        loadProjects();
        setEditingProject(null);
        setEditForm({ color: '', notes: '' });
      } else {
        alert('Fehler beim Speichern');
      }
    } catch (error) {
      console.error('Error saving project:', error);
      alert('Fehler beim Speichern');
    }
  };

  const handleCancel = () => {
    setEditingProject(null);
    setEditForm({ color: '', notes: '' });
  };

  const toggleProjectSelection = (projectId) => {
    setSelectedProjects(prev =>
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    );
  };

  // Gefilterte Projekte basierend auf Markierung
  const filteredProjects = projects.filter(project => {
    const isSelected = selectedProjects.includes(project.id);
    if (!showMarked && isSelected) return false;
    if (!showUnmarked && !isSelected) return false;
    return true;
  });

  const colorPresets = [
    '#3b82f6', // blue
    '#ef4444', // red
    '#10b981', // green
    '#f59e0b', // amber
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#f97316', // orange
  ];

  return (
    <div className="projects-list-page">
      <div className="page-header">
        <h1>Projekte</h1>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Projekte durchsuchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="filter-buttons">
          <button
            className={`filter-btn ${showMarked ? 'active' : ''}`}
            onClick={() => setShowMarked(!showMarked)}
            title="Markierte Projekte anzeigen/ausblenden"
          >
            Markiert
          </button>
          <button
            className={`filter-btn ${showUnmarked ? 'active' : ''}`}
            onClick={() => setShowUnmarked(!showUnmarked)}
            title="Nicht markierte Projekte anzeigen/ausblenden"
          >
            Nicht markiert
          </button>
        </div>
      </div>

      {loading && projects.length === 0 ? (
        <div className="loading-state">Lade Projekte...</div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <p>Keine Projekte gefunden</p>
          <p className="empty-hint">
            Konfigurieren Sie einen Projektordner in den Einstellungen und synchronisieren Sie
          </p>
        </div>
      ) : (
        <div className="projects-grid">
          {filteredProjects.map(project => {
            const isSelected = selectedProjects.includes(project.id);
            return (
              <div
                key={project.id}
                className={`project-card ${isSelected ? 'selected' : ''}`}
              >
                <div
                  className="project-color-bar"
                  style={{ backgroundColor: project.color }}
                />

                <div className="project-content">
                  <div className="project-header">
                    <h3 className="project-name">{project.folder_name}</h3>
                    <div className="project-actions">
                      <button
                        className="icon-btn select-btn"
                        onClick={() => toggleProjectSelection(project.id)}
                        title={isSelected ? "Markierung entfernen" : "Projekt markieren"}
                      >
                        {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => handleEdit(project)}
                        title="Bearbeiten"
                      >
                        <Edit2 size={18} />
                      </button>
                    </div>
                  </div>

                {project.notes && (
                  <div className="project-notes">
                    {project.notes}
                  </div>
                )}

                <div className="project-meta">
                  Erstellt: {new Date(project.created_at).toLocaleDateString('de-DE')}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {editingProject && (
        <div className="modal-overlay" onClick={handleCancel}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Projekt bearbeiten</h2>
              <button className="modal-close" onClick={handleCancel}>
                <X size={24} />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Ordnername</label>
                <div className="readonly-field">{editingProject.folder_name}</div>
              </div>

              <div className="form-group">
                <label>Farbe</label>
                <div className="color-picker">
                  {colorPresets.map(color => (
                    <button
                      key={color}
                      className={`color-option ${editForm.color === color ? 'active' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setEditForm({ ...editForm, color })}
                      title={color}
                    />
                  ))}
                </div>
                <input
                  type="color"
                  value={editForm.color}
                  onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                  className="color-input"
                />
              </div>

              <div className="form-group">
                <label>Notizen</label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  className="textarea"
                  rows="6"
                  placeholder="Fügen Sie Notizen zum Projekt hinzu..."
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={handleCancel}>
                Abbrechen
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                <Save size={18} />
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectsList;
