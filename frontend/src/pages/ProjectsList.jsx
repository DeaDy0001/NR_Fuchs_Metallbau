import { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Save, X, CheckSquare, Square } from 'lucide-react';
import './ProjectsList.css';

function ProjectsList() {
  const [projects, setProjects] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [editForm, setEditForm] = useState({ color: '', notes: '' });
  const [selectedProjects, setSelectedProjects] = useState([]); // Markierte Projekte
  const [showMarked, setShowMarked] = useState(true); // Filter: Markierte anzeigen
  const [showUnmarked, setShowUnmarked] = useState(true); // Filter: Nicht markierte anzeigen
  const [viewingProject, setViewingProject] = useState(null); // Projekt-Modal (auch für Bearbeitung)
  const [projectFiles, setProjectFiles] = useState({ images: [], pdfs: [], hasImages: false, hasPdfs: false });
  const [activeTab, setActiveTab] = useState('images'); // Active tab in project modal
  const [loadingFiles, setLoadingFiles] = useState(false);

  useEffect(() => {
    loadProjects();
    // Load selected projects from localStorage
    const saved = localStorage.getItem('selectedProjects');
    if (saved) {
      try {
        setSelectedProjects(JSON.parse(saved));
      } catch (e) {
        console.error('Error loading selected projects:', e);
      }
    }
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

  const handleSaveProject = async () => {
    if (!viewingProject) return;

    try {
      const response = await fetch(`/api/projects/${viewingProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });

      if (response.ok) {
        loadProjects();
        // Update viewingProject with new values
        setViewingProject({ ...viewingProject, ...editForm });
      } else {
        alert('Fehler beim Speichern');
      }
    } catch (error) {
      console.error('Error saving project:', error);
      alert('Fehler beim Speichern');
    }
  };

  const toggleProjectSelection = (projectId) => {
    setSelectedProjects(prev => {
      const updated = prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId];

      // Save to localStorage
      localStorage.setItem('selectedProjects', JSON.stringify(updated));
      return updated;
    });
  };

  const handleViewProject = async (project) => {
    setViewingProject(project);
    setLoadingFiles(true);
    setActiveTab('images');

    // Initialize edit form with current project values
    setEditForm({
      color: project.color || '#3b82f6',
      notes: project.notes || ''
    });

    try {
      const response = await fetch(`/api/projects/${project.id}/files`);
      if (response.ok) {
        const data = await response.json();
        setProjectFiles(data);
      }
    } catch (error) {
      console.error('Error loading project files:', error);
    } finally {
      setLoadingFiles(false);
    }
  };

  const closeProjectModal = () => {
    setViewingProject(null);
    setProjectFiles({ images: [], pdfs: [], hasImages: false, hasPdfs: false });
    setActiveTab('images');
    setEditForm({ color: '', notes: '' });
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

                <div className="project-content" onClick={() => handleViewProject(project)}>
                  <div className="project-header">
                    <h3 className="project-name">{project.folder_name}</h3>
                    <div className="project-actions">
                      <button
                        className="icon-btn select-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleProjectSelection(project.id);
                        }}
                        title={isSelected ? "Markierung entfernen" : "Projekt markieren"}
                      >
                        {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                      </button>
                      <button
                        className="icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewProject(project);
                        }}
                        title="Anzeigen & Bearbeiten"
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
                  <div>Erstellt: {new Date(project.folder_created_at || project.created_at).toLocaleDateString('de-DE')}</div>
                  <div>Bilder: {project.image_count || 0}</div>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {viewingProject && (
        <div className="modal-overlay" onClick={closeProjectModal}>
          <div className="modal project-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{viewingProject.folder_name}</h2>
              <button className="modal-close" onClick={closeProjectModal}>
                <X size={24} />
              </button>
            </div>

            {/* Edit-Felder */}
            <div className="project-edit-section">
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
                  rows="3"
                  placeholder="Fügen Sie Notizen zum Projekt hinzu..."
                />
              </div>

              <button className="btn btn-primary btn-save" onClick={handleSaveProject}>
                <Save size={18} />
                Speichern
              </button>
            </div>

            <div className="modal-tabs">
              <button
                className={`tab-btn ${activeTab === 'images' ? 'active' : ''}`}
                onClick={() => setActiveTab('images')}
              >
                Bilder
              </button>
              {projectFiles.hasPdfs && (
                <button
                  className={`tab-btn ${activeTab === 'pdfs' ? 'active' : ''}`}
                  onClick={() => setActiveTab('pdfs')}
                >
                  PDFs
                </button>
              )}
            </div>

            <div className="modal-body project-modal-body">
              {loadingFiles ? (
                <div className="loading-state">Lade Dateien...</div>
              ) : activeTab === 'images' ? (
                projectFiles.images.length === 0 ? (
                  <div className="empty-state">Keine Bilder gefunden</div>
                ) : (
                  <div className="project-images-grid">
                    {projectFiles.images.map((image, index) => (
                      <div key={index} className="project-image-card">
                        <img src={image.url} alt={image.name} />
                        <div className="project-image-name">{image.name}</div>
                      </div>
                    ))}
                  </div>
                )
              ) : activeTab === 'pdfs' ? (
                projectFiles.pdfs.length === 0 ? (
                  <div className="empty-state">Keine PDFs gefunden</div>
                ) : (
                  <div className="project-files-list">
                    {projectFiles.pdfs.map((pdf, index) => (
                      <a
                        key={index}
                        href={pdf.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="project-file-item"
                      >
                        {pdf.name}
                      </a>
                    ))}
                  </div>
                )
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectsList;
