import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Check, GitMerge, Trash2, X, Search, Image, FolderOpen, Loader, ChevronDown, ChevronUp, Tag } from 'lucide-react';
import './PendingProjects.css';

function PendingProjectsBanner({ onCountChange }) {
  const [pendingProjects, setPendingProjects] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [scanning, setScanning] = useState(false);

  const loadPending = useCallback(async () => {
    try {
      const response = await fetch('/api/projects/pending');
      if (response.ok) {
        const data = await response.json();
        setPendingProjects(data);
        if (onCountChange) onCountChange(data.length);
      }
    } catch (error) {
      console.error('Error loading pending projects:', error);
    }
  }, [onCountChange]);

  // Scan on mount and every 60s
  useEffect(() => {
    scanAndLoad();
    const interval = setInterval(scanAndLoad, 60000);
    return () => clearInterval(interval);
  }, []);

  const scanAndLoad = async () => {
    try {
      setScanning(true);
      await fetch('/api/projects/pending/scan', { method: 'POST' });
    } catch {} finally {
      setScanning(false);
    }
    await loadPending();
  };

  if (pendingProjects.length === 0) return null;

  return (
    <>
      <div className="pending-banner" onClick={() => setShowModal(true)}>
        <div className="pending-banner-content">
          <AlertTriangle size={18} />
          <span>
            Neue Projekte verfügbar ({pendingProjects.length})
          </span>
          {scanning && <Loader size={14} className="spinning" />}
        </div>
      </div>

      {showModal && (
        <PendingProjectsModal
          projects={pendingProjects}
          onClose={() => setShowModal(false)}
          onRefresh={loadPending}
        />
      )}
    </>
  );
}

function PendingProjectsModal({ projects, onClose, onRefresh }) {
  const [expandedProject, setExpandedProject] = useState(null);
  const [images, setImages] = useState({});
  const [loadingImages, setLoadingImages] = useState({});
  const [mergeTarget, setMergeTarget] = useState(null); // { pendingId, ... }
  const [existingProjects, setExistingProjects] = useState([]);
  const [mergeSearch, setMergeSearch] = useState('');
  const [processing, setProcessing] = useState({});
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    loadExistingProjects();
  }, []);

  const loadExistingProjects = async () => {
    try {
      const response = await fetch('/api/projects?limit=1000');
      if (response.ok) {
        const data = await response.json();
        setExistingProjects(data.projects || []);
      }
    } catch {}
  };

  const loadImages = async (projectId, driveFolderId) => {
    if (images[projectId]) return; // Already loaded
    setLoadingImages(prev => ({ ...prev, [projectId]: true }));
    try {
      const response = await fetch(`/api/projects/pending/${projectId}/images`);
      if (response.ok) {
        const data = await response.json();
        setImages(prev => ({ ...prev, [projectId]: data }));
      }
    } catch {} finally {
      setLoadingImages(prev => ({ ...prev, [projectId]: false }));
    }
  };

  const toggleExpand = (project) => {
    if (expandedProject === project.id) {
      setExpandedProject(null);
    } else {
      setExpandedProject(project.id);
      loadImages(project.id);
    }
  };

  const handleAccept = async (projectId) => {
    setProcessing(prev => ({ ...prev, [projectId]: 'accepting' }));
    try {
      const response = await fetch(`/api/projects/pending/${projectId}/accept`, { method: 'POST' });
      if (response.ok) {
        const data = await response.json();
        showNotification(`Projekt hinzugefügt (${data.downloaded} Bilder heruntergeladen)`);
        await onRefresh();
      } else {
        const error = await response.json();
        showNotification(error.error || 'Fehler', 'error');
      }
    } catch (e) {
      showNotification('Fehler: ' + e.message, 'error');
    } finally {
      setProcessing(prev => ({ ...prev, [projectId]: null }));
    }
  };

  const handleMerge = async (pendingId, targetProjectId) => {
    setProcessing(prev => ({ ...prev, [pendingId]: 'merging' }));
    try {
      const response = await fetch(`/api/projects/pending/${pendingId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetProjectId }),
      });
      if (response.ok) {
        const data = await response.json();
        showNotification(`Zusammengeführt mit "${data.targetProject}" (${data.downloaded} Bilder)`);
        setMergeTarget(null);
        await onRefresh();
      } else {
        const error = await response.json();
        showNotification(error.error || 'Fehler', 'error');
      }
    } catch (e) {
      showNotification('Fehler: ' + e.message, 'error');
    } finally {
      setProcessing(prev => ({ ...prev, [pendingId]: null }));
    }
  };

  const handleDelete = async (projectId) => {
    if (!window.confirm('Dieses Projekt wirklich ablehnen?')) return;
    setProcessing(prev => ({ ...prev, [projectId]: 'deleting' }));
    try {
      const response = await fetch(`/api/projects/pending/${projectId}`, { method: 'DELETE' });
      if (response.ok) {
        showNotification('Projekt abgelehnt');
        await onRefresh();
      }
    } catch (e) {
      showNotification('Fehler: ' + e.message, 'error');
    } finally {
      setProcessing(prev => ({ ...prev, [projectId]: null }));
    }
  };

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // Filter existing projects for merge search
  const filteredProjects = existingProjects.filter(p => {
    if (!mergeSearch) return true;
    const search = mergeSearch.toLowerCase();
    const nameMatch = p.folder_name.toLowerCase().includes(search);
    const tagMatch = Array.isArray(p.tags) && p.tags.some(t =>
      typeof t === 'string' && t.toLowerCase().includes(search)
    );
    return nameMatch || tagMatch;
  });

  return (
    <div className="pending-modal-overlay" onClick={onClose}>
      <div className="pending-modal" onClick={e => e.stopPropagation()}>
        <div className="pending-modal-header">
          <h2>Neue Projekte von der App</h2>
          <button className="pending-modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {notification && (
          <div className={`pending-notification ${notification.type}`}>
            {notification.message}
          </div>
        )}

        <div className="pending-modal-body">
          {projects.length === 0 ? (
            <div className="pending-empty">
              <FolderOpen size={48} strokeWidth={1} />
              <p>Keine neuen Projekte verfügbar</p>
            </div>
          ) : (
            projects.map(project => (
              <div key={project.id} className="pending-project-card">
                {/* Header */}
                <div className="pending-project-header" onClick={() => toggleExpand(project)}>
                  <div className="pending-project-info">
                    <FolderOpen size={20} />
                    <div>
                      <div className="pending-project-name">{project.folder_name}</div>
                      <div className="pending-project-meta">
                        <Image size={12} />
                        {project.image_count} {project.image_count === 1 ? 'Bild' : 'Bilder'}
                      </div>
                    </div>
                  </div>
                  <div className="pending-project-actions">
                    {processing[project.id] ? (
                      <Loader size={18} className="spinning" />
                    ) : (
                      <>
                        <button
                          className="btn-pending btn-accept"
                          onClick={(e) => { e.stopPropagation(); handleAccept(project.id); }}
                          title="Als neues Projekt hinzufügen"
                        >
                          <Check size={16} />
                          Hinzufügen
                        </button>
                        <button
                          className="btn-pending btn-merge"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMergeTarget(mergeTarget?.pendingId === project.id ? null : { pendingId: project.id });
                            setMergeSearch('');
                          }}
                          title="Mit bestehendem Projekt zusammenführen"
                        >
                          <GitMerge size={16} />
                          Zusammenführen
                        </button>
                        <button
                          className="btn-pending btn-delete"
                          onClick={(e) => { e.stopPropagation(); handleDelete(project.id); }}
                          title="Ablehnen"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                    {expandedProject === project.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </div>

                {/* Merge picker */}
                {mergeTarget?.pendingId === project.id && (
                  <div className="pending-merge-section">
                    <div className="pending-merge-search">
                      <Search size={16} />
                      <input
                        type="text"
                        placeholder="Projekt suchen (Name oder Tag)..."
                        value={mergeSearch}
                        onChange={e => setMergeSearch(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="pending-merge-list">
                      {filteredProjects.map(ep => (
                        <div
                          key={ep.id}
                          className="pending-merge-item"
                          onClick={() => handleMerge(project.id, ep.id)}
                        >
                          <div
                            className="pending-merge-color"
                            style={{ backgroundColor: ep.color || '#3b82f6' }}
                          />
                          <div className="pending-merge-item-info">
                            <span className="pending-merge-item-name">{ep.folder_name}</span>
                            {Array.isArray(ep.tags) && ep.tags.length > 0 && (
                              <div className="pending-merge-tags">
                                {ep.tags.map((tag, i) => (
                                  <span key={i} className="pending-merge-tag">
                                    <Tag size={10} />
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <span className="pending-merge-count">{ep.image_count || 0} Bilder</span>
                        </div>
                      ))}
                      {filteredProjects.length === 0 && (
                        <div className="pending-merge-empty">Keine Projekte gefunden</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Image preview */}
                {expandedProject === project.id && (
                  <div className="pending-images-section">
                    {loadingImages[project.id] ? (
                      <div className="pending-images-loading">
                        <Loader size={20} className="spinning" />
                        <span>Bilder werden geladen...</span>
                      </div>
                    ) : images[project.id]?.length > 0 ? (
                      <div className="pending-images-grid">
                        {images[project.id].map(img => (
                          <div key={img.id} className="pending-image-card" title={img.name}>
                            {img.thumbnailLink ? (
                              <img src={img.thumbnailLink} alt={img.name} />
                            ) : (
                              <div className="pending-image-placeholder">
                                <Image size={24} />
                              </div>
                            )}
                            <div className="pending-image-name">{img.name}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="pending-images-empty">Keine Bilder in diesem Projekt</div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default PendingProjectsBanner;
