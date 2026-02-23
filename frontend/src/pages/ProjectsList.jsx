import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Plus, Edit2, Save, X, CheckSquare, Square, ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight, Trash2, Pencil, RefreshCw } from 'lucide-react';
import ImageEditor from '../components/ImageEditor';
import './ProjectsList.css';

// Helper function to format SQLite timestamps (which are in UTC)
const formatSQLiteDate = (dateString) => {
  if (!dateString) return null;

  // SQLite datetime('now') returns: YYYY-MM-DD HH:MM:SS (UTC)
  // We need to append 'Z' to tell JavaScript it's UTC
  const utcDate = dateString.endsWith('Z') ? dateString : `${dateString}Z`;

  return new Date(utcDate).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

function ProjectsList() {
  const [projects, setProjects] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
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
  const [editingName, setEditingName] = useState('');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showEditor, setShowEditor] = useState(false);
  const [initialZoomLevel, setInitialZoomLevel] = useState(1);
  const [initialPanPosition, setInitialPanPosition] = useState({ x: 0, y: 0 });
  const modalImageRef = useRef(null);

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

  const handleSync = async () => {
    setSyncing(true);

    try {
      const response = await fetch('/api/projects/sync', {
        method: 'POST'
      });

      if (response.ok) {
        const data = await response.json();
        loadProjects();

        if (data.removed && data.removed.length > 0) {
          alert(`Folgende Projekte wurden entfernt (Ordner nicht mehr vorhanden):\n\n${data.removed.map(name => `• ${name}`).join('\n')}`);
        }
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

  // Helper function to reload project files (used after image updates)
  const loadProjectFiles = async (projectId) => {
    if (!projectId) return;

    setLoadingFiles(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/files`);
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

  // Image viewer handlers
  const handleImageClick = useCallback((image) => {
    setSelectedImage(image);
    setEditingName(image.name);
    setZoomLevel(1); // Will be adjusted in useEffect
    setPanPosition({ x: 0, y: 0 });
  }, []);

  const closeImageViewer = useCallback(() => {
    setSelectedImage(null);
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
    setShowEditor(false);
  }, []);

  const handleZoomIn = () => {
    const newZoom = Math.min(zoomLevel + 0.25, 3); // Max 300%

    // Zoom towards center of viewport
    if (!modalImageRef.current?.parentElement) {
      setZoomLevel(newZoom);
      return;
    }

    const container = modalImageRef.current.parentElement;
    const containerRect = container.getBoundingClientRect();
    const centerX = containerRect.width / 2;
    const centerY = containerRect.height / 2;

    // Calculate the point in the image at the center
    const imageX = (centerX - panPosition.x) / zoomLevel;
    const imageY = (centerY - panPosition.y) / zoomLevel;

    // Keep that point at the center
    const newLeft = centerX - imageX * newZoom;
    const newTop = centerY - imageY * newZoom;

    setZoomLevel(newZoom);
    setPanPosition({ x: newLeft, y: newTop });
  };

  const handleZoomOut = () => {
    // Don't zoom out below the initial fit-to-container zoom level
    const newZoom = Math.max(zoomLevel - 0.25, initialZoomLevel);

    // Zoom towards center of viewport
    if (!modalImageRef.current?.parentElement) {
      setZoomLevel(newZoom);
      return;
    }

    const container = modalImageRef.current.parentElement;
    const containerRect = container.getBoundingClientRect();
    const centerX = containerRect.width / 2;
    const centerY = containerRect.height / 2;

    // Calculate the point in the image at the center
    const imageX = (centerX - panPosition.x) / zoomLevel;
    const imageY = (centerY - panPosition.y) / zoomLevel;

    // Keep that point at the center
    const newLeft = centerX - imageX * newZoom;
    const newTop = centerY - imageY * newZoom;

    setZoomLevel(newZoom);
    setPanPosition({ x: newLeft, y: newTop });
  };

  const handleZoomReset = () => {
    // Reset to the initial auto-fit zoom and position
    setZoomLevel(initialZoomLevel);
    setPanPosition(initialPanPosition);
  };

  const handleMouseDown = (e) => {
    // Allow panning with left or middle mouse button at any zoom level
    if (e.button === 0 || e.button === 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panPosition.x, y: e.clientY - panPosition.y });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e) => {
    if (isPanning) {
      setPanPosition({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  };

  const handleMouseUp = () => setIsPanning(false);

  // Shift + Wheel zoom (zoom from mouse position)
  const handleWheel = (e) => {
    if (e.shiftKey) {
      e.preventDefault();

      const delta = e.deltaY > 0 ? -0.05 : 0.05; // Finer zoom steps (5% instead of 10%)
      const newZoomLevel = Math.min(Math.max(zoomLevel + delta, initialZoomLevel), 3);

      // Get mouse position relative to the container
      const container = e.currentTarget;
      const containerRect = container.getBoundingClientRect();
      const mouseX = e.clientX - containerRect.left;
      const mouseY = e.clientY - containerRect.top;

      // Current image position (from state, not DOM)
      const currentLeft = panPosition.x;
      const currentTop = panPosition.y;

      // Calculate the point in the original (unzoomed) image that's under the mouse
      const imageX = (mouseX - currentLeft) / zoomLevel;
      const imageY = (mouseY - currentTop) / zoomLevel;

      // Calculate new position to keep that point under the mouse
      const newLeft = mouseX - imageX * newZoomLevel;
      const newTop = mouseY - imageY * newZoomLevel;

      setZoomLevel(newZoomLevel);
      setPanPosition({ x: newLeft, y: newTop });
    }
  };

  const navigateImage = useCallback((direction) => {
    if (!selectedImage || !projectFiles.images.length) return;

    // Find current image by id (if available), otherwise by name or url
    const currentIndex = projectFiles.images.findIndex(img => {
      if (selectedImage.id && img.id) {
        return img.id === selectedImage.id;
      }
      // Fallback to name or url comparison
      return img.name === selectedImage.name || img.url === selectedImage.url;
    });

    // If image not found, don't navigate
    if (currentIndex === -1) {
      console.warn('Current image not found in project files');
      return;
    }

    let newIndex;
    if (direction === 'prev') {
      newIndex = currentIndex > 0 ? currentIndex - 1 : projectFiles.images.length - 1;
    } else {
      newIndex = currentIndex < projectFiles.images.length - 1 ? currentIndex + 1 : 0;
    }

    handleImageClick(projectFiles.images[newIndex]);
  }, [selectedImage, projectFiles.images, handleImageClick]);

  // Rename image
  const handleRename = async () => {
    if (!editingName || editingName.trim() === '') {
      alert('Bitte gib einen gültigen Namen ein');
      return;
    }

    if (editingName === selectedImage.name) {
      return; // No change
    }

    try {
      const response = await fetch(`/api/drive/images/${selectedImage.id}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingName.trim() })
      });

      if (response.ok) {
        // Update local state
        setSelectedImage({ ...selectedImage, name: editingName.trim() });
        // Reload project files
        if (viewingProject) {
          loadProjectFiles(viewingProject.id);
        }
      } else {
        alert('Fehler beim Umbenennen des Bildes');
      }
    } catch (error) {
      console.error('Error renaming image:', error);
      alert('Fehler beim Umbenennen des Bildes');
    }
  };

  // Assign image to project
  const handleAssignToProject = async (projectId) => {
    if (!selectedImage.id) {
      alert('Bild muss zuerst in der Datenbank registriert sein');
      return;
    }

    try {
      const response = await fetch('/api/drive/images/assign-to-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageId: selectedImage.id,
          projectId: projectId
        })
      });

      if (response.ok) {
        const result = await response.json();
        // Update selectedImage to reflect the new assignment
        const updatedProjects = selectedImage.projects ? [...selectedImage.projects] : [];
        const project = projects.find(p => p.id === projectId);
        if (project && !updatedProjects.some(p => p.id === projectId)) {
          updatedProjects.push(project);
          setSelectedImage({ ...selectedImage, projects: updatedProjects });
        }
        // Reload project files
        if (viewingProject) {
          loadProjectFiles(viewingProject.id);
        }
        console.log(`✅ Bild zu "${result.projectName}" hinzugefügt`);
      } else {
        const error = await response.json();
        alert(`Fehler: ${error.error}`);
      }
    } catch (error) {
      console.error('Error assigning image:', error);
      alert('Fehler beim Zuordnen des Bildes');
    }
  };

  // Unassign image from project
  const handleUnassignFromProject = async (projectId, e) => {
    e?.stopPropagation();

    try {
      const response = await fetch('/api/drive/images/unassign-from-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageId: selectedImage.id,
          projectId: projectId
        })
      });

      if (response.ok) {
        const result = await response.json();
        // Update selectedImage to reflect the removal
        const updatedProjects = selectedImage.projects?.filter(p => p.id !== projectId) || [];
        setSelectedImage({ ...selectedImage, projects: updatedProjects });
        // Reload project files
        if (viewingProject) {
          loadProjectFiles(viewingProject.id);
        }
        console.log(`✅ Bild von "${result.projectName}" entfernt`);
      } else {
        const error = await response.json();
        alert(`Fehler: ${error.error}`);
      }
    } catch (error) {
      console.error('Error unassigning image:', error);
      alert('Fehler beim Entfernen des Bildes');
    }
  };

  // Delete image
  const handleDeleteImage = async () => {
    if (!selectedImage.id) {
      alert('Nur registrierte Bilder können gelöscht werden');
      return;
    }

    const confirmDelete = window.confirm(
      `Möchtest du das Bild "${selectedImage.name}" wirklich löschen?\n\nDies löscht das Bild nur aus der Datenbank, nicht vom Laufwerk.`
    );

    if (!confirmDelete) return;

    try {
      const response = await fetch(`/api/drive/images/${selectedImage.id}?deleteFromDrive=false`, {
        method: 'DELETE'
      });

      if (response.ok) {
        closeImageViewer();
        // Reload project files
        if (viewingProject) {
          loadProjectFiles(viewingProject.id);
        }
        alert('Bild erfolgreich gelöscht');
      } else {
        const error = await response.json();
        alert(`Fehler beim Löschen: ${error.message}`);
      }
    } catch (error) {
      console.error('Error deleting image:', error);
      alert('Fehler beim Löschen des Bildes');
    }
  };

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

  // Auto-fit image to screen when modal opens
  useEffect(() => {
    if (!selectedImage) return;

    // Use image dimensions from backend data if available
    const imageWidth = selectedImage.width;
    const imageHeight = selectedImage.height;

    if (!imageWidth || !imageHeight) {
      // Fallback: set to 100% if dimensions not available
      const fallbackZoom = 1;
      const fallbackPan = { x: 0, y: 0 };
      setZoomLevel(fallbackZoom);
      setPanPosition(fallbackPan);
      setInitialZoomLevel(fallbackZoom);
      setInitialPanPosition(fallbackPan);
      return;
    }

    // Use requestAnimationFrame to wait for container to be ready
    const calculateZoom = () => {
      const container = modalImageRef.current?.parentElement;
      if (!container) {
        // Retry on next frame if container not ready
        requestAnimationFrame(calculateZoom);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;

      // Safeguard: ensure container has valid dimensions
      if (containerWidth === 0 || containerHeight === 0) {
        requestAnimationFrame(calculateZoom);
        return;
      }

      // Calculate zoom level to fit the image in the container
      const scaleX = containerWidth / imageWidth;
      const scaleY = containerHeight / imageHeight;
      const scale = Math.min(scaleX, scaleY, 1); // Don't zoom in beyond 100%

      // Center the image
      const scaledWidth = imageWidth * scale;
      const scaledHeight = imageHeight * scale;
      const centerX = (containerWidth - scaledWidth) / 2;
      const centerY = (containerHeight - scaledHeight) / 2;

      const fitZoom = scale;
      const fitPan = { x: centerX, y: centerY };

      setZoomLevel(fitZoom);
      setPanPosition(fitPan);
      // Save as initial values for reset button
      setInitialZoomLevel(fitZoom);
      setInitialPanPosition(fitPan);
    };

    // Start calculation on next frame
    const rafId = requestAnimationFrame(calculateZoom);

    return () => cancelAnimationFrame(rafId);
  }, [selectedImage]);

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
            className="btn btn-secondary"
            onClick={handleSync}
            disabled={syncing}
            title="Projekte synchronisieren"
          >
            <RefreshCw size={18} className={syncing ? 'spinning' : ''} />
            {syncing ? 'Synce...' : 'Sync'}
          </button>
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
        <div className="modal-overlay" onClick={closeImageViewer}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeImageViewer}>
              <X size={24} />
            </button>

            <div className="modal-content">
              {/* Scrollable Image Container (Left) */}
              <div className="modal-image-container">
                <div className="zoom-controls">
                  <button className="zoom-btn" onClick={handleZoomOut} title="Zoom Out" disabled={zoomLevel <= initialZoomLevel}>
                    -
                  </button>
                  <span className="zoom-level">{Math.round(zoomLevel * 100)}%</span>
                  <button className="zoom-btn" onClick={handleZoomIn} title="Zoom In" disabled={zoomLevel >= 3}>
                    +
                  </button>
                  <button className="zoom-btn zoom-reset" onClick={handleZoomReset} title="Zoom zurücksetzen">
                    Reset
                  </button>

                  <button
                    className="zoom-btn editor-btn"
                    onClick={() => setShowEditor(true)}
                    title="Editor öffnen"
                  >
                    <Pencil size={18} />
                    Editor
                  </button>

                  <div className="zoom-controls-right">
                    <button
                      className="zoom-btn nav-btn"
                      onClick={() => navigateImage('prev')}
                      title="Vorheriges Bild (←)"
                      disabled={!selectedImage.id || projectFiles.images.findIndex(img => img.id === selectedImage.id) === 0}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      className="zoom-btn nav-btn"
                      onClick={() => navigateImage('next')}
                      title="Nächstes Bild (→)"
                      disabled={!selectedImage.id || projectFiles.images.findIndex(img => img.id === selectedImage.id) === projectFiles.images.length - 1}
                    >
                      <ChevronRight size={18} />
                    </button>
                    {selectedImage.id && (
                      <button
                        className="zoom-btn delete-btn"
                        onClick={handleDeleteImage}
                        title="Bild löschen (Delete)"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
                <div
                  className="modal-image-scroll"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onWheel={handleWheel}
                  style={{
                    cursor: isPanning ? 'grabbing' : 'grab'
                  }}
                >
                  <img
                    ref={modalImageRef}
                    src={selectedImage.local_path || selectedImage.url}
                    alt={selectedImage.name}
                    style={{
                      transform: `scale(${zoomLevel}) translate(${panPosition.x / zoomLevel}px, ${panPosition.y / zoomLevel}px)`,
                      transformOrigin: 'top left',
                      transition: isPanning ? 'none' : 'transform 0.2s ease',
                      userSelect: 'none',
                      pointerEvents: 'none'
                    }}
                    draggable={false}
                  />
                </div>
              </div>

              {/* Fixed Sidebar (Right) */}
              <div className="modal-sidebar">
                <div className="modal-section">
                  <label>Name</label>
                  <div className="rename-input-group">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="input"
                      disabled={!selectedImage.id}
                    />
                    <button
                      className="btn btn-primary btn-sm btn-icon"
                      onClick={handleRename}
                      title="Umbenennen"
                      disabled={!selectedImage.id}
                    >
                      <Edit2 size={16} />
                    </button>
                  </div>
                </div>

                {selectedImage.original_name && (
                  <div className="modal-section">
                    <label>Originalname</label>
                    <div className="detail-text">{selectedImage.original_name}</div>
                  </div>
                )}

                {selectedImage.subfolder && (
                  <div className="modal-section">
                    <label>Unterordner</label>
                    <div className="subfolder-badge">{selectedImage.subfolder}</div>
                  </div>
                )}

                {selectedImage.projects && selectedImage.projects.length > 0 && (
                  <div className="modal-section">
                    <label>🏷️ Zugeordnete Projekte</label>
                    <div className="project-badges-modal">
                      {selectedImage.projects.map(project => (
                        <div
                          key={project.id}
                          className="project-badge"
                          style={{ backgroundColor: project.color }}
                          title={project.folder_name}
                        >
                          {project.folder_name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedImage.file_size && (
                  <div className="modal-section">
                    <label>Dateigröße</label>
                    <div className="detail-text">
                      {(selectedImage.file_size / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                )}

                {selectedImage.width && selectedImage.height && (
                  <div className="modal-section">
                    <label>Auflösung</label>
                    <div className="detail-text">
                      {selectedImage.width} x {selectedImage.height} px
                    </div>
                  </div>
                )}

                {selectedImage.photo_taken_at && (
                  <div className="modal-section">
                    <label>📸 Foto aufgenommen</label>
                    <div className="detail-text">
                      {formatSQLiteDate(selectedImage.photo_taken_at)}
                    </div>
                  </div>
                )}

                {selectedImage.created_at && (
                  <div className="modal-section">
                    <label>📅 Hochgeladen am</label>
                    <div className="detail-text">
                      {formatSQLiteDate(selectedImage.created_at)}
                    </div>
                  </div>
                )}

                {/* Projekt-Zuordnung */}
                {selectedImage.id && (
                  <div className="modal-section projects-section">
                    <label>📁 Projekte</label>
                    {selectedProjects.length === 0 ? (
                      <div className="empty-hint">Keine Projekte markiert. Markiere Projekte in der Liste.</div>
                    ) : (
                      <div className="project-list">
                        {projects
                          .filter(p => selectedProjects.includes(p.id))
                          .map(project => {
                            const isAssigned = selectedImage.projects?.some(p => p.id === project.id);
                            return (
                              <button
                                key={project.id}
                                className={`project-item ${isAssigned ? 'project-assigned' : ''}`}
                                onClick={() => !isAssigned && handleAssignToProject(project.id)}
                                style={{ borderLeftColor: project.color }}
                                title={isAssigned ? `✓ Bereits zugeordnet zu "${project.folder_name}"` : `Bild zu "${project.folder_name}" hinzufügen`}
                              >
                                <span className="project-item-name">
                                  {isAssigned && <span className="checkmark">✓ </span>}
                                  {project.folder_name}
                                </span>
                                {isAssigned && (
                                  <button
                                    className="project-unassign-btn"
                                    onClick={(e) => handleUnassignFromProject(project.id, e)}
                                    title={`Von "${project.folder_name}" entfernen`}
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                )}
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
            // Reload project files to show newly created images
            if (viewingProject) {
              loadProjectFiles(viewingProject.id);
            }
          }}
        />
      )}
    </div>
  );
}

export default ProjectsList;
