import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Edit2, Save, X, CheckSquare, Square, ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
import ImageEditor from '../components/ImageEditor';
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

  // Image viewer state (for full-screen viewing of project images)
  const [selectedImage, setSelectedImage] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showEditor, setShowEditor] = useState(false);

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

  // Image viewer handlers
  const handleImageClick = useCallback((image) => {
    setSelectedImage(image);
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
  }, []);

  const closeImageViewer = useCallback(() => {
    setSelectedImage(null);
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
    setShowEditor(false);
  }, []);

  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
  const handleZoomReset = () => {
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e) => {
    if (zoomLevel > 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panPosition.x, y: e.clientY - panPosition.y });
    }
  };

  const handleMouseMove = (e) => {
    if (isPanning && zoomLevel > 1) {
      setPanPosition({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  };

  const handleMouseUp = () => setIsPanning(false);

  const navigateImage = useCallback((direction) => {
    if (!selectedImage || !projectFiles.images.length) return;

    const currentIndex = projectFiles.images.findIndex(img => img.id === selectedImage.id);
    let newIndex;

    if (direction === 'prev') {
      newIndex = currentIndex > 0 ? currentIndex - 1 : projectFiles.images.length - 1;
    } else {
      newIndex = currentIndex < projectFiles.images.length - 1 ? currentIndex + 1 : 0;
    }

    handleImageClick(projectFiles.images[newIndex]);
  }, [selectedImage, projectFiles.images, handleImageClick]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!selectedImage || showEditor) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateImage('prev');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateImage('next');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeImageViewer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImage, showEditor, navigateImage, closeImageViewer]);

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
                      <div
                        key={index}
                        className="project-image-card"
                        onClick={() => handleImageClick(image)}
                        style={{ cursor: 'pointer' }}
                      >
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

      {/* Image Viewer Modal */}
      {selectedImage && !showEditor && (
        <div className="modal-overlay" onClick={closeImageViewer}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div className="modal image-viewer-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeImageViewer}>
              <X size={24} />
            </button>

            {/* Navigation Arrows */}
            {projectFiles.images.length > 1 && (
              <>
                <button className="nav-arrow nav-arrow-left" onClick={(e) => { e.stopPropagation(); navigateImage('prev'); }}>
                  <ChevronLeft size={32} />
                </button>
                <button className="nav-arrow nav-arrow-right" onClick={(e) => { e.stopPropagation(); navigateImage('next'); }}>
                  <ChevronRight size={32} />
                </button>
              </>
            )}

            <div className="modal-content">
              {/* Image Container with Zoom & Pan */}
              <div className="modal-image-container">
                <div className="zoom-controls">
                  <button className="zoom-btn" onClick={handleZoomOut} disabled={zoomLevel <= 0.5}>
                    <ZoomOut size={18} />
                  </button>
                  <span className="zoom-level">{Math.round(zoomLevel * 100)}%</span>
                  <button className="zoom-btn" onClick={handleZoomIn} disabled={zoomLevel >= 3}>
                    <ZoomIn size={18} />
                  </button>
                  <button className="zoom-btn zoom-reset" onClick={handleZoomReset}>
                    <RotateCcw size={18} />
                  </button>
                </div>

                <div
                  className="modal-image-wrapper"
                  style={{
                    cursor: zoomLevel > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default',
                    overflow: 'hidden'
                  }}
                >
                  <img
                    src={selectedImage.local_path || selectedImage.url}
                    alt={selectedImage.name}
                    style={{
                      transform: `scale(${zoomLevel}) translate(${panPosition.x / zoomLevel}px, ${panPosition.y / zoomLevel}px)`,
                      transition: isPanning ? 'none' : 'transform 0.2s',
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain'
                    }}
                    draggable={false}
                  />
                </div>
              </div>

              {/* Image Details Sidebar */}
              <div className="modal-sidebar">
                <h3 className="modal-title">{selectedImage.name}</h3>

                {selectedImage.photo_taken_at && (
                  <div className="modal-section">
                    <label>📸 Aufgenommen am</label>
                    <div className="detail-text">
                      {new Date(selectedImage.photo_taken_at).toLocaleDateString('de-DE')}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="modal-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => setShowEditor(true)}
                  >
                    <Edit2 size={18} />
                    In Editor öffnen
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image Editor */}
      {showEditor && selectedImage && (
        <ImageEditor
          image={selectedImage}
          onClose={() => {
            setShowEditor(false);
            // Optionally reload project files to show newly created images
          }}
        />
      )}
    </div>
  );
}

export default ProjectsList;
