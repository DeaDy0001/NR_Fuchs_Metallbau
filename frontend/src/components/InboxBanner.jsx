import { useState, useEffect, useCallback, useRef } from 'react';
import { Inbox, Check, GitMerge, Trash2, X, Search, Image, FolderOpen, Loader, ChevronDown, ChevronUp, Tag, ChevronLeft, ChevronRight } from 'lucide-react';
import './InboxBanner.css';

function InboxBanner() {
  const [inboxItems, setInboxItems] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [scanning, setScanning] = useState(false);

  const loadInbox = useCallback(async () => {
    try {
      setScanning(true);
      const response = await fetch('/api/mobile/inbox');
      if (response.ok) {
        const data = await response.json();
        setInboxItems(data);
      }
    } catch (error) {
      console.error('Error loading inbox:', error);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    loadInbox();
    const interval = setInterval(loadInbox, 60000);
    return () => clearInterval(interval);
  }, [loadInbox]);

  if (inboxItems.length === 0) return null;

  return (
    <>
      <div className="inbox-banner" onClick={() => setShowModal(true)}>
        <div className="inbox-banner-content">
          <Inbox size={18} />
          <span>
            Neue Projekte von der Handy-App ({inboxItems.length})
          </span>
          {scanning && <Loader size={14} className="spinning" />}
        </div>
      </div>

      {showModal && (
        <InboxModal
          projects={inboxItems}
          onClose={() => setShowModal(false)}
          onRefresh={loadInbox}
        />
      )}
    </>
  );
}

/* ========== Image Lightbox ========== */
function ImageLightbox({ images, startIndex, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const imgRef = useRef(null);

  const currentImage = images[currentIndex];

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setCurrentIndex(i => i - 1);
        setZoom(1);
      }
      if (e.key === 'ArrowRight' && currentIndex < images.length - 1) {
        setCurrentIndex(i => i + 1);
        setZoom(1);
      }
    };

    const handleWheel = (e) => {
      if (e.shiftKey) {
        e.preventDefault();
        setZoom(prev => {
          const delta = e.deltaY > 0 ? -0.15 : 0.15;
          return Math.min(Math.max(prev + delta, 0.5), 5);
        });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('wheel', handleWheel, { passive: false });
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('wheel', handleWheel);
      document.body.style.overflow = '';
    };
  }, [currentIndex, images.length, onClose]);

  const goPrev = (e) => {
    e.stopPropagation();
    if (currentIndex > 0) {
      setCurrentIndex(i => i - 1);
      setZoom(1);
    }
  };

  const goNext = (e) => {
    e.stopPropagation();
    if (currentIndex < images.length - 1) {
      setCurrentIndex(i => i + 1);
      setZoom(1);
    }
  };

  // Build full-res URL from thumbnail (remove size constraint)
  const getFullUrl = (img) => {
    if (img.thumbnailUrl) {
      return img.thumbnailUrl.replace(/=s\d+/, '=s1600');
    }
    return null;
  };

  const fullUrl = getFullUrl(currentImage);

  return (
    <div className="image-lightbox-overlay" onClick={onClose}>
      <div className="image-lightbox-container" onClick={e => e.stopPropagation()}>
        {fullUrl && (
          <img
            ref={imgRef}
            src={fullUrl}
            alt={currentImage.name}
            style={{ transform: `scale(${zoom})` }}
            draggable={false}
          />
        )}
      </div>

      <button className="image-lightbox-close" onClick={onClose}>
        <X size={20} />
      </button>

      {images.length > 1 && currentIndex > 0 && (
        <button className="image-lightbox-nav prev" onClick={goPrev}>
          <ChevronLeft size={24} />
        </button>
      )}

      {images.length > 1 && currentIndex < images.length - 1 && (
        <button className="image-lightbox-nav next" onClick={goNext}>
          <ChevronRight size={24} />
        </button>
      )}

      <div className="image-lightbox-zoom-hint">Shift + Mausrad zum Zoomen</div>
      <div className="image-lightbox-name">
        {currentImage.name} ({currentIndex + 1}/{images.length})
      </div>
    </div>
  );
}

/* ========== Inbox Modal ========== */
function InboxModal({ projects, onClose, onRefresh }) {
  const [expandedProject, setExpandedProject] = useState(null);
  const [images, setImages] = useState({});
  const [loadingImages, setLoadingImages] = useState({});
  const [mergeTarget, setMergeTarget] = useState(null);
  const [existingProjects, setExistingProjects] = useState([]);
  const [mergeSearch, setMergeSearch] = useState('');
  const [processing, setProcessing] = useState({});
  const [notification, setNotification] = useState(null);
  const [lightbox, setLightbox] = useState(null);

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

  const loadImages = async (folderId) => {
    if (images[folderId]) return;
    setLoadingImages(prev => ({ ...prev, [folderId]: true }));
    try {
      const response = await fetch(`/api/mobile/inbox/${folderId}/images`);
      if (response.ok) {
        const data = await response.json();
        setImages(prev => ({ ...prev, [folderId]: data }));
      }
    } catch {} finally {
      setLoadingImages(prev => ({ ...prev, [folderId]: false }));
    }
  };

  const toggleExpand = (project) => {
    const folderId = project.drive_folder_id;
    if (expandedProject === folderId) {
      setExpandedProject(null);
    } else {
      setExpandedProject(folderId);
      if (folderId) loadImages(folderId);
    }
  };

  const handleConfirm = async (item) => {
    setProcessing(prev => ({ ...prev, [item.id]: 'confirming' }));
    try {
      const response = await fetch('/api/mobile/inbox/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: item.drive_folder_id,
          inboxFolderId: item.inbox_folder_id,
          projectName: item.project_name || item.original_name,
        })
      });
      if (response.ok) {
        showNotification(`"${item.project_name}" in Projekte verschoben`);
        await onRefresh();
      } else {
        const data = await response.json();
        showNotification(data.error || 'Fehler', 'error');
      }
    } catch (e) {
      showNotification('Fehler: ' + e.message, 'error');
    } finally {
      setProcessing(prev => ({ ...prev, [item.id]: null }));
    }
  };

  const handleMerge = async (inboxItem, targetProject) => {
    setProcessing(prev => ({ ...prev, [inboxItem.id]: 'merging' }));
    try {
      const response = await fetch('/api/mobile/inbox/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceFolderId: inboxItem.drive_folder_id,
          targetFolderId: targetProject.folder_id || targetProject.id,
          inboxFolderId: inboxItem.inbox_folder_id,
          projectName: inboxItem.project_name,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        showNotification(`${data.movedCount} Bilder mit "${targetProject.folder_name}" zusammengeführt`);
        setMergeTarget(null);
        await onRefresh();
      } else {
        const data = await response.json();
        showNotification(data.error || 'Fehler', 'error');
      }
    } catch (e) {
      showNotification('Fehler: ' + e.message, 'error');
    } finally {
      setProcessing(prev => ({ ...prev, [inboxItem.id]: null }));
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`"${item.project_name}" wirklich ablehnen und aus der Inbox löschen?`)) return;
    setProcessing(prev => ({ ...prev, [item.id]: 'deleting' }));
    try {
      const response = await fetch(`/api/mobile/inbox/${item.drive_folder_id}`, { method: 'DELETE' });
      if (response.ok) {
        showNotification(`"${item.project_name}" abgelehnt`);
        await onRefresh();
      } else {
        const data = await response.json();
        showNotification(data.error || 'Fehler beim Löschen', 'error');
      }
    } catch (e) {
      showNotification('Fehler: ' + e.message, 'error');
    } finally {
      setProcessing(prev => ({ ...prev, [item.id]: null }));
    }
  };

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const openLightbox = (folderId, index) => {
    const folderImages = images[folderId];
    if (folderImages && folderImages.length > 0) {
      setLightbox({ images: folderImages, startIndex: index });
    }
  };

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
          <h2>Inbox - Neue Projekte von der App</h2>
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
              <Inbox size={48} strokeWidth={1} />
              <p>Keine neuen Projekte in der Inbox</p>
            </div>
          ) : (
            projects.map(project => (
              <div key={project.id} className="pending-project-card">
                {/* Header */}
                <div className="pending-project-header" onClick={() => toggleExpand(project)}>
                  <div className="pending-project-info">
                    <FolderOpen size={20} />
                    <div>
                      <div className="pending-project-name">{project.project_name}</div>
                      <div className="pending-project-meta">
                        <Image size={12} />
                        {project.image_count || 0} {(project.image_count || 0) === 1 ? 'Bild' : 'Bilder'}
                      </div>
                    </div>
                  </div>
                  <div className="pending-project-actions">
                    {processing[project.id] ? (
                      <Loader size={18} className="spinning" />
                    ) : (
                      <>
                        {project.drive_folder_id && (
                          <button
                            className="btn-pending btn-accept"
                            onClick={(e) => { e.stopPropagation(); handleConfirm(project); }}
                            title="Als neues Projekt hinzufügen"
                          >
                            <Check size={16} />
                            Hinzufügen
                          </button>
                        )}
                        <button
                          className="btn-pending btn-merge"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMergeTarget(mergeTarget?.id === project.id ? null : project);
                            setMergeSearch('');
                          }}
                          title="Mit bestehendem Projekt zusammenführen"
                        >
                          <GitMerge size={16} />
                          Zusammenführen
                        </button>
                        <button
                          className="btn-pending btn-delete"
                          onClick={(e) => { e.stopPropagation(); handleDelete(project); }}
                          title="Ablehnen"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                    {expandedProject === project.drive_folder_id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </div>

                {/* Merge picker */}
                {mergeTarget?.id === project.id && (
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
                          onClick={() => handleMerge(project, ep)}
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
                {expandedProject === project.drive_folder_id && (
                  <div className="pending-images-section">
                    {loadingImages[project.drive_folder_id] ? (
                      <div className="pending-images-loading">
                        <Loader size={20} className="spinning" />
                        <span>Bilder werden geladen...</span>
                      </div>
                    ) : images[project.drive_folder_id]?.length > 0 ? (
                      <div className="pending-images-grid">
                        {images[project.drive_folder_id].map((img, idx) => (
                          <div
                            key={img.id}
                            className="pending-image-card"
                            title={img.name}
                            onClick={() => openLightbox(project.drive_folder_id, idx)}
                          >
                            {img.thumbnailUrl ? (
                              <img src={img.thumbnailUrl} alt={img.name} />
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

      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          startIndex={lightbox.startIndex}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

export default InboxBanner;
