import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Plus, Edit2, Save, X, CheckSquare, Square, ChevronLeft, ChevronRight, Trash2, Pencil, RefreshCw } from 'lucide-react';
import ImageEditor from '../components/ImageEditor';
import DeleteProjectModal from '../components/DeleteProjectModal';
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
  const [searchQuery, setSearchQuery] = useState(''); // Kombiniertes Suchfeld für Projekte + Tags
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', color: '', notes: '', tags: [] });
  const [tagInput, setTagInput] = useState('');
  const [selectedProjects, setSelectedProjects] = useState([]); // Markierte Projekte
  const [showMarked, setShowMarked] = useState(true); // Filter: Markierte anzeigen
  const [showUnmarked, setShowUnmarked] = useState(true); // Filter: Nicht markierte anzeigen
  const [viewingProject, setViewingProject] = useState(null); // Projekt-Modal (auch für Bearbeitung)
  const [projectFiles, setProjectFiles] = useState({ images: [], pdfs: [], hasImages: false, hasPdfs: false });
  const [activeTab, setActiveTab] = useState('images'); // Active tab in project modal
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Delete project state
  const [deletingProject, setDeletingProject] = useState(null); // Project to delete (opens DeleteProjectModal)

  // New project creation state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState('#3b82f6');
  const [creating, setCreating] = useState(false);

  // Image viewer state (for full-screen viewing of project images)
  const [selectedImage, setSelectedImage] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [showEditor, setShowEditor] = useState(false);
  const modalImageRef = useRef(null);
  const [showAllProjectsInSidebar, setShowAllProjectsInSidebar] = useState(false);
  const [sidebarProjectSearch, setSidebarProjectSearch] = useState('');

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
        search: searchQuery // Sucht in Projektnamen, Notizen UND Tags
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

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    setCreating(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_name: newProjectName.trim(),
          color: newProjectColor
        })
      });

      if (response.ok) {
        setShowCreateModal(false);
        setNewProjectName('');
        setNewProjectColor('#3b82f6');
        loadProjects();
      } else {
        const error = await response.json();
        alert(error.error || 'Fehler beim Erstellen des Projekts');
      }
    } catch (error) {
      console.error('Error creating project:', error);
      alert('Fehler beim Erstellen des Projekts');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveProject = async (updates) => {
    if (!viewingProject) return;

    try {
      const response = await fetch(`/api/projects/${viewingProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (response.ok) {
        const updatedProject = await response.json();
        loadProjects();
        // Update viewingProject with new values
        setViewingProject(updatedProject);
        setEditForm({
          name: updatedProject.folder_name,
          color: updatedProject.color,
          notes: updatedProject.notes,
          tags: updatedProject.tags
        });
      } else {
        console.error('Fehler beim Speichern');
      }
    } catch (error) {
      console.error('Error saving project:', error);
    }
  };

  const handleAddTag = async (tag) => {
    if (!tag.trim() || !viewingProject) return;

    const trimmedTag = tag.trim();
    if (editForm.tags.includes(trimmedTag)) return;

    const newTags = [...editForm.tags, trimmedTag];
    setEditForm({ ...editForm, tags: newTags });
    await handleSaveProject({ ...editForm, tags: newTags });
    setTagInput('');
  };

  const handleRemoveTag = async (index) => {
    if (!viewingProject) return;

    const newTags = editForm.tags.filter((_, i) => i !== index);
    setEditForm({ ...editForm, tags: newTags });
    await handleSaveProject({ ...editForm, tags: newTags });
  };

  const handleRenameProject = async () => {
    if (!viewingProject || !editForm.name.trim()) return;

    const newName = editForm.name.trim();
    if (newName === viewingProject.folder_name) return; // Kein Unterschied

    if (!confirm(`Projekt "${viewingProject.folder_name}" zu "${newName}" umbenennen?\n\nDies benennt auch den Ordner um!`)) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/${viewingProject.id}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: newName })
      });

      if (response.ok) {
        const updatedProject = await response.json();
        loadProjects();
        setViewingProject(updatedProject);
        setEditForm({
          name: updatedProject.folder_name,
          color: updatedProject.color,
          notes: updatedProject.notes,
          tags: updatedProject.tags
        });
        alert('✅ Projekt erfolgreich umbenannt!');
      } else {
        const error = await response.json();
        alert(`Fehler beim Umbenennen: ${error.error || 'Unbekannter Fehler'}`);
        // Reset to original name on error
        setEditForm({ ...editForm, name: viewingProject.folder_name });
      }
    } catch (error) {
      console.error('Error renaming project:', error);
      alert(`Fehler beim Umbenennen: ${error.message}`);
      setEditForm({ ...editForm, name: viewingProject.folder_name });
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
      name: project.folder_name || '',
      color: project.color || '#3b82f6',
      notes: project.notes || '',
      tags: project.tags || []
    });
    setTagInput('');

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
    setEditForm({ name: '', color: '', notes: '', tags: [] });
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
  }, []);

  const closeImageViewer = useCallback(() => {
    setSelectedImage(null);
    setShowEditor(false);
  }, []);

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + 0.25, 5));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => {
      const newZoom = Math.max(prev - 0.25, 0.5);
      if (newZoom <= 1) {
        setPanPosition({ x: 0, y: 0 });
      }
      return newZoom;
    });
  };

  const handleZoomReset = () => {
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
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
    // Reset zoom and pan when opening a new image
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
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
            placeholder="Projekte & Tags durchsuchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="filter-buttons">
          <button
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
            title="Neues Projekt erstellen"
          >
            <Plus size={18} />
            Neues Projekt
          </button>
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
                      <button
                        className="icon-btn icon-btn-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingProject(project);
                        }}
                        title="Projekt löschen"
                      >
                        <Trash2 size={18} />
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

                  {project.tags && project.tags.length > 0 && (
                    <div className="project-tags">
                      {project.tags.map((tag, index) => (
                        <span
                          key={index}
                          className="project-tag-badge"
                          style={{ backgroundColor: project.color }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
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
              <div className="modal-header-actions">
                <button
                  className="btn btn-sm btn-danger-outline"
                  onClick={() => setDeletingProject(viewingProject)}
                  title="Projekt löschen"
                >
                  <Trash2 size={16} />
                  Löschen
                </button>
                <button className="modal-close" onClick={closeProjectModal}>
                  <X size={24} />
                </button>
              </div>
            </div>

            {/* Edit-Felder */}
            <div className="project-edit-section">
              <div className="project-form-grid">
                {/* Left column: Project Name and Color */}
                <div className="form-column">
                  <div className="form-group">
                    <label>Projektname</label>
                    <div className="rename-input-group">
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleRenameProject();
                          }
                        }}
                        className="input"
                        placeholder="Projektname..."
                      />
                      <button
                        className="btn btn-primary btn-sm btn-icon"
                        onClick={handleRenameProject}
                        title="Umbenennen (benennt auch den Ordner um!)"
                      >
                        <Edit2 size={16} />
                      </button>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>
                      ⚠️ Hiermit wird auch der Ordner umbenannt
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Farbe</label>
                    <div className="color-picker">
                      {colorPresets.map(color => (
                        <button
                          key={color}
                          className={`color-option ${editForm.color === color ? 'active' : ''}`}
                          style={{ backgroundColor: color }}
                          onClick={() => {
                            setEditForm({ ...editForm, color });
                            handleSaveProject({ ...editForm, color });
                          }}
                          title={color}
                        />
                      ))}
                    </div>
                    <input
                      type="color"
                      value={editForm.color}
                      onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                      onBlur={(e) => handleSaveProject({ ...editForm, color: e.target.value })}
                      className="color-input"
                    />
                  </div>
                </div>

                {/* Right column: Notes and Tags */}
                <div className="form-column">
                  <div className="form-group">
                    <label>Notizen</label>
                    <textarea
                      value={editForm.notes}
                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                      onBlur={(e) => handleSaveProject({ ...editForm, notes: e.target.value })}
                      className="textarea"
                      rows="5"
                      placeholder="Fügen Sie Notizen zum Projekt hinzu..."
                    />
                  </div>
                  <div className="form-group">
                    <label>Tags</label>
                    <div className="tags-container">
                      <div className="tags-list">
                        {editForm.tags.map((tag, index) => (
                          <span
                            key={index}
                            className="tag-badge"
                            style={{ backgroundColor: editForm.color }}
                          >
                            {tag}
                            <X
                              size={14}
                              className="tag-remove"
                              onClick={() => handleRemoveTag(index)}
                            />
                          </span>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddTag(tagInput);
                          }
                        }}
                        className="input tag-input"
                        placeholder="Tag eingeben und Enter drücken..."
                      />
                    </div>
                  </div>
                </div>
              </div>
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
          <div className="modal-wrapper" onClick={(e) => e.stopPropagation()}>
            <button className="modal-external-close" onClick={closeImageViewer} title="Schließen">
              <X size={20} />
            </button>
            <div className="modal">
            <div className="modal-content">
              {/* Lightbox Image Area (Left) */}
              <div className="modal-image-container">
                <div className="zoom-controls">
                  <button className="zoom-btn" onClick={handleZoomOut} title="Zoom Out" disabled={zoomLevel <= 0.5}>
                    -
                  </button>
                  <span className="zoom-level">{Math.round(zoomLevel * 100)}%</span>
                  <button className="zoom-btn" onClick={handleZoomIn} title="Zoom In" disabled={zoomLevel >= 5}>
                    +
                  </button>
                  <button className="zoom-btn zoom-reset" onClick={handleZoomReset} title="Zoom zurücksetzen">
                    Reset
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
                  </div>
                </div>
                <div className="modal-image-scroll">
                  <img
                    ref={modalImageRef}
                    src={selectedImage.local_path || selectedImage.url}
                    alt={selectedImage.name}
                    style={{
                      transform: `translate(${panPosition.x}px, ${panPosition.y}px) scale(${zoomLevel})`,
                      transition: 'transform 0.15s ease',
                      cursor: zoomLevel > 1 ? 'grab' : 'default'
                    }}
                    draggable={false}
                  />
                </div>
              </div>

              {/* Fixed Sidebar (Right) - Compact design */}
              <div className="modal-sidebar">
                {/* Action buttons */}
                <div className="modal-sidebar-actions">
                  <button
                    className="sidebar-action-btn editor-btn"
                    onClick={() => setShowEditor(true)}
                    title="Editor öffnen"
                  >
                    <Pencil size={16} />
                    Editor
                  </button>
                  {selectedImage.id && (
                    <button
                      className="sidebar-action-btn delete-btn"
                      onClick={handleDeleteImage}
                      title="Bild löschen"
                    >
                      <Trash2 size={16} />
                      Löschen
                    </button>
                  )}
                </div>

                {/* Upper section: Image info */}
                <div className="modal-sidebar-upper">
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
                      <label>Zugeordnete Projekte</label>
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

                  <div className="modal-section modal-meta-grid">
                    {selectedImage.file_size && (
                      <div className="meta-item">
                        <span className="meta-label">Größe</span>
                        <span className="meta-value">{(selectedImage.file_size / 1024 / 1024).toFixed(2)} MB</span>
                      </div>
                    )}
                    {selectedImage.width && selectedImage.height && (
                      <div className="meta-item">
                        <span className="meta-label">Auflösung</span>
                        <span className="meta-value">{selectedImage.width} × {selectedImage.height}</span>
                      </div>
                    )}
                    {selectedImage.photo_taken_at && (
                      <div className="meta-item">
                        <span className="meta-label">Aufgenommen</span>
                        <span className="meta-value">{formatSQLiteDate(selectedImage.photo_taken_at)}</span>
                      </div>
                    )}
                    {selectedImage.created_at && (
                      <div className="meta-item">
                        <span className="meta-label">Hochgeladen</span>
                        <span className="meta-value">{formatSQLiteDate(selectedImage.created_at)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Lower section: Project assignment */}
                <div className={`modal-sidebar-lower ${showAllProjectsInSidebar ? 'expanded' : ''}`}>
                  {selectedImage.id && (
                    <div className="modal-section projects-section">
                    <div className="projects-header">
                      <label>Projekte</label>
                      <button
                        className="all-projects-toggle"
                        onClick={() => { setShowAllProjectsInSidebar(!showAllProjectsInSidebar); setSidebarProjectSearch(''); }}
                      >
                        {showAllProjectsInSidebar ? 'Markierte' : 'Alle Projekte'}
                      </button>
                    </div>
                    {showAllProjectsInSidebar && (
                      <input
                        type="text"
                        className="project-search-input"
                        placeholder="Projekt oder Tag suchen..."
                        value={sidebarProjectSearch}
                        onChange={(e) => setSidebarProjectSearch(e.target.value)}
                      />
                    )}
                    {(() => {
                      const searchLower = sidebarProjectSearch.toLowerCase();
                      const projectsToShow = showAllProjectsInSidebar
                        ? projects.filter(p => {
                            if (!sidebarProjectSearch) return true;
                            if (p.folder_name.toLowerCase().includes(searchLower)) return true;
                            try {
                              const tags = JSON.parse(p.tags || '[]');
                              return tags.some(t => {
                                const tagName = typeof t === 'string' ? t : t.name || '';
                                return tagName.toLowerCase().includes(searchLower);
                              });
                            } catch { return false; }
                          })
                        : projects.filter(p => selectedProjects.includes(p.id));

                      if (projectsToShow.length === 0) {
                        return <div className="empty-hint">{showAllProjectsInSidebar ? 'Keine Projekte gefunden.' : 'Keine Projekte markiert.'}</div>;
                      }

                      return (
                        <div className="project-list">
                          {projectsToShow.map(project => {
                            const isAssigned = selectedImage.projects?.some(p => p.id === project.id);
                            return (
                              <button
                                key={project.id}
                                className={`project-item ${isAssigned ? 'project-assigned' : ''}`}
                                onClick={() => !isAssigned && handleAssignToProject(project.id)}
                                style={{ borderLeftColor: project.color }}
                                title={isAssigned ? `✓ Bereits zugeordnet` : `Zu "${project.folder_name}" hinzufügen`}
                              >
                                <span className="project-item-name">
                                  {isAssigned && <span className="checkmark">✓ </span>}
                                  {project.folder_name}
                                </span>
                                {isAssigned && (
                                  <button
                                    className="project-unassign-btn"
                                    onClick={(e) => handleUnassignFromProject(project.id, e)}
                                    title={`Entfernen`}
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                    </div>
                  )}
                </div>
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
            // Reload project files to show newly created images
            if (viewingProject) {
              loadProjectFiles(viewingProject.id);
            }
          }}
        />
      )}

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="create-project-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Neues Projekt erstellen</h2>
              <button className="icon-btn" onClick={() => setShowCreateModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Projektname (Ordnername)</label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                  placeholder="z.B. Müller Balkongeländer"
                  className="text-input"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Farbe</label>
                <div className="color-presets">
                  {colorPresets.map(color => (
                    <button
                      key={color}
                      className={`color-dot ${newProjectColor === color ? 'active' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewProjectColor(color)}
                    />
                  ))}
                  <input
                    type="color"
                    value={newProjectColor}
                    onChange={(e) => setNewProjectColor(e.target.value)}
                    className="color-input"
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowCreateModal(false)}
              >
                Abbrechen
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateProject}
                disabled={!newProjectName.trim() || creating}
              >
                {creating ? 'Erstelle...' : 'Projekt erstellen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingProject && (
        <DeleteProjectModal
          project={deletingProject}
          onClose={() => setDeletingProject(null)}
          onDeleted={() => {
            setDeletingProject(null);
            // If we were viewing this project, close the modal
            if (viewingProject && viewingProject.id === deletingProject.id) {
              closeProjectModal();
            }
            loadProjects();
          }}
        />
      )}
    </div>
  );
}

export default ProjectsList;
