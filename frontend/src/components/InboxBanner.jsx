import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Inbox, Check, GitMerge, Trash2, X, Search, Image, FolderOpen, Loader, ChevronDown, ChevronUp, Tag, ChevronLeft, ChevronRight, User, CheckSquare, Square } from 'lucide-react';
import './InboxBanner.css';

function InboxBanner() {
  const [inboxItems, setInboxItems] = useState([]);
  const [deleteRequests, setDeleteRequests] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [scanning, setScanning] = useState(false);

  const loadInbox = useCallback(async () => {
    try {
      setScanning(true);
      const response = await fetch('/api/mobile/inbox');
      if (response.ok) {
        const data = await response.json();
        // Handle new { projects, deleteRequests } format
        if (data.projects) {
          setInboxItems(data.projects);
          setDeleteRequests(data.deleteRequests || []);
        } else if (Array.isArray(data)) {
          // Backwards compat with old format
          setInboxItems(data);
          setDeleteRequests([]);
        }
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

  const totalCount = inboxItems.length + (deleteRequests.length > 0 ? 1 : 0);
  if (totalCount === 0) return null;

  return (
    <>
      <div className="inbox-banner" onClick={() => setShowModal(true)}>
        <div className="inbox-banner-content">
          <Inbox size={18} />
          <span>
            Neue Uploads von der Handy-App ({inboxItems.length})
            {deleteRequests.length > 0 && ` · ${deleteRequests.length} Löschanfragen`}
          </span>
          {scanning && <Loader size={14} className="spinning" />}
        </div>
      </div>

      {showModal && (
        <InboxModal
          projects={inboxItems}
          deleteRequests={deleteRequests}
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
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOriginRef = useRef({ x: 0, y: 0 });

  const currentImage = images[currentIndex];

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setCurrentIndex(i => i - 1);
        resetView();
      }
      if (e.key === 'ArrowRight' && currentIndex < images.length - 1) {
        setCurrentIndex(i => i + 1);
        resetView();
      }
    };

    const handleWheel = (e) => {
      if (e.shiftKey) {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left - rect.width / 2;
        const mouseY = e.clientY - rect.top - rect.height / 2;

        const oldZoom = zoomRef.current;
        const delta = e.deltaY > 0 ? -0.15 : 0.15;
        const newZoom = Math.min(Math.max(oldZoom + delta, 0.5), 5);

        if (newZoom <= 1) {
          setZoom(newZoom);
          setPan({ x: 0, y: 0 });
        } else {
          const scale = newZoom / oldZoom;
          const cur = panRef.current;
          setPan({
            x: mouseX - scale * (mouseX - cur.x),
            y: mouseY - scale * (mouseY - cur.y)
          });
          setZoom(newZoom);
        }
      }
    };

    const handleMouseDown = (e) => {
      if (e.button === 1 && zoomRef.current > 1) {
        e.preventDefault();
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX, y: e.clientY };
        panOriginRef.current = { ...panRef.current };
      }
    };

    const handleMouseMove = (e) => {
      if (!isPanningRef.current) return;
      setPan({
        x: panOriginRef.current.x + (e.clientX - panStartRef.current.x),
        y: panOriginRef.current.y + (e.clientY - panStartRef.current.y)
      });
    };

    const handleMouseUp = (e) => {
      if (e.button === 1) isPanningRef.current = false;
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('wheel', handleWheel, { passive: false });
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('wheel', handleWheel);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.overflow = '';
    };
  }, [currentIndex, images.length, onClose]);

  const goPrev = (e) => {
    e.stopPropagation();
    if (currentIndex > 0) {
      setCurrentIndex(i => i - 1);
      resetView();
    }
  };

  const goNext = (e) => {
    e.stopPropagation();
    if (currentIndex < images.length - 1) {
      setCurrentIndex(i => i + 1);
      resetView();
    }
  };

  const proxyUrl = currentImage.id ? `/api/mobile/inbox/image-proxy/${currentImage.id}` : null;

  return (
    <div className="image-lightbox-overlay" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div
        ref={containerRef}
        className="image-lightbox-container"
        onClick={e => e.stopPropagation()}
        onMouseDown={e => { if (e.button === 1) e.preventDefault(); }}
      >
        {proxyUrl && (
          <img
            ref={imgRef}
            src={proxyUrl}
            alt={currentImage.name}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              cursor: zoom > 1 ? (isPanningRef.current ? 'grabbing' : 'grab') : 'default'
            }}
            draggable={false}
          />
        )}
      </div>

      <button className="image-lightbox-close" onClick={(e) => { e.stopPropagation(); onClose(); }}>
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

      <div className="image-lightbox-zoom-hint">Shift + Mausrad zum Zoomen · Mittlere Maustaste zum Verschieben</div>
      <div className="image-lightbox-name">
        {currentImage.name} ({currentIndex + 1}/{images.length})
      </div>
    </div>
  );
}

/* ========== Delete Preview Lightbox ========== */
function DeletePreviewLightbox({ images, startIndex, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const currentImage = images[currentIndex];

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentIndex > 0) setCurrentIndex(i => i - 1);
      if (e.key === 'ArrowRight' && currentIndex < images.length - 1) setCurrentIndex(i => i + 1);
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [currentIndex, images.length, onClose]);

  return (
    <div className="image-lightbox-overlay" onClick={onClose}>
      <div className="image-lightbox-container" onClick={e => e.stopPropagation()}>
        {currentImage?.previewUrl && (
          <img src={currentImage.previewUrl} alt={currentImage.name} draggable={false} />
        )}
      </div>
      <button className="image-lightbox-close" onClick={onClose}><X size={20} /></button>
      {images.length > 1 && currentIndex > 0 && (
        <button className="image-lightbox-nav prev" onClick={(e) => { e.stopPropagation(); setCurrentIndex(i => i - 1); }}>
          <ChevronLeft size={24} />
        </button>
      )}
      {images.length > 1 && currentIndex < images.length - 1 && (
        <button className="image-lightbox-nav next" onClick={(e) => { e.stopPropagation(); setCurrentIndex(i => i + 1); }}>
          <ChevronRight size={24} />
        </button>
      )}
      <div className="image-lightbox-name">
        {currentImage?.name} ({currentIndex + 1}/{images.length})
      </div>
    </div>
  );
}

/* ========== Inbox Modal ========== */
function InboxModal({ projects, deleteRequests = [], onClose, onRefresh }) {
  const [expandedProject, setExpandedProject] = useState(null);
  const [images, setImages] = useState({});
  const [loadingImages, setLoadingImages] = useState({});
  const [mergeTarget, setMergeTarget] = useState(null);
  const [existingProjects, setExistingProjects] = useState([]);
  const [mergeSearch, setMergeSearch] = useState('');
  const [processing, setProcessing] = useState({});
  const [notification, setNotification] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  // Track selected images per folder (for user inbox selective merge)
  const [selectedImages, setSelectedImages] = useState({});
  // Track images marked for deletion per folder (red entries)
  const [markedForDeletion, setMarkedForDeletion] = useState({});
  const hasChangesRef = useRef(false);
  // Local copy of deleteRequests for optimistic (instant) removal
  const [localDeleteRequests, setLocalDeleteRequests] = useState(deleteRequests);
  // Track which delete request group is expanded
  const [expandedDeleteGroup, setExpandedDeleteGroup] = useState(null);
  // Track lightbox for delete request images
  const [deletePreviewLightbox, setDeletePreviewLightbox] = useState(null);

  useEffect(() => setLocalDeleteRequests(deleteRequests), [deleteRequests]);

  // Group delete requests by project name
  const groupedDeleteRequests = useMemo(() => {
    const groups = {};
    localDeleteRequests.forEach(req => {
      const key = req.project_name || '__no_project__';
      if (!groups[key]) groups[key] = { name: req.project_name, items: [] };
      groups[key].items.push(req);
    });
    return Object.values(groups);
  }, [localDeleteRequests]);

  const handleClose = useCallback(() => {
    if (hasChangesRef.current) {
      // Trigger Drive sync in background so merged/confirmed images appear in Bilder
      fetch('/api/drive/images/refresh', { method: 'POST' }).catch(() => {});
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    loadExistingProjects();
  }, []);

  // Auto-expand and load images for user inbox items
  useEffect(() => {
    projects.filter(p => p.is_user_inbox && p.drive_folder_id).forEach(p => {
      loadImages(p.drive_folder_id);
    });
  }, [projects]);

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
        // Initialize all images as selected for user inbox items
        setSelectedImages(prev => ({
          ...prev,
          [folderId]: new Set(data.map(img => img.id)),
        }));
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

  const toggleImageSelection = (folderId, imageId) => {
    setSelectedImages(prev => {
      const current = new Set(prev[folderId] || []);
      if (current.has(imageId)) {
        current.delete(imageId);
      } else {
        current.add(imageId);
      }
      return { ...prev, [folderId]: current };
    });
    // Remove from deletion marks if selecting
    setMarkedForDeletion(prev => {
      const current = prev[folderId];
      if (current && current.has(imageId)) {
        const next = new Set(current);
        next.delete(imageId);
        return { ...prev, [folderId]: next };
      }
      return prev;
    });
  };

  const selectAllImages = (folderId) => {
    const folderImages = images[folderId] || [];
    setSelectedImages(prev => ({
      ...prev,
      [folderId]: new Set(folderImages.map(img => img.id)),
    }));
    // Clear all deletion marks when selecting all
    setMarkedForDeletion(prev => ({ ...prev, [folderId]: new Set() }));
  };

  const deselectAllImages = (folderId) => {
    setSelectedImages(prev => ({
      ...prev,
      [folderId]: new Set(),
    }));
  };

  const getSelectedCount = (folderId) => {
    return selectedImages[folderId]?.size || 0;
  };

  const toggleDeleteMark = (folderId, imageId) => {
    setMarkedForDeletion(prev => {
      const current = new Set(prev[folderId] || []);
      if (current.has(imageId)) {
        current.delete(imageId);
      } else {
        current.add(imageId);
      }
      return { ...prev, [folderId]: current };
    });
    // Remove from selection if marking for deletion
    setSelectedImages(prev => {
      const current = prev[folderId];
      if (current && current.has(imageId)) {
        const next = new Set(current);
        next.delete(imageId);
        return { ...prev, [folderId]: next };
      }
      return prev;
    });
  };

  const getDeleteMarkedCount = (folderId) => {
    return markedForDeletion[folderId]?.size || 0;
  };

  const handleDeleteMarked = async (folderId, project) => {
    const marked = markedForDeletion[folderId];
    if (!marked || marked.size === 0) return;
    if (!window.confirm(`${marked.size} Bild(er) endgültig von Google Drive und lokal löschen?`)) return;
    setProcessing(prev => ({ ...prev, [project.id]: 'deleting' }));
    try {
      const response = await fetch('/api/mobile/inbox/delete-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: [...marked] }),
      });
      if (response.ok) {
        hasChangesRef.current = true;
        const data = await response.json();
        showNotification(`${data.deletedCount} Bilder gelöscht`);
        setMarkedForDeletion(prev => { const next = { ...prev }; delete next[folderId]; return next; });
        setImages(prev => { const next = { ...prev }; delete next[folderId]; return next; });
        setSelectedImages(prev => { const next = { ...prev }; delete next[folderId]; return next; });
        await onRefresh();
      } else {
        const data = await response.json();
        showNotification(data.error || 'Fehler beim Löschen', 'error');
      }
    } catch (e) {
      showNotification('Fehler: ' + e.message, 'error');
    } finally {
      setProcessing(prev => ({ ...prev, [project.id]: null }));
    }
  };

  /** Confirm for named projects: move folder to Projekte/ on Drive */
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
        hasChangesRef.current = true;
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

  /** Add user inbox images to library (no project, goes to root Drive + local download) */
  const handleAddToLibrary = async (item) => {
    const folderId = item.drive_folder_id;
    const selected = selectedImages[folderId];
    const fileIds = selected && selected.size > 0 ? [...selected] : undefined;

    setProcessing(prev => ({ ...prev, [item.id]: 'confirming' }));
    try {
      const response = await fetch('/api/mobile/inbox/add-to-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceFolderId: folderId,
          fileIds,
        })
      });
      if (response.ok) {
        hasChangesRef.current = true;
        const data = await response.json();
        showNotification(`${data.addedCount} Bilder zur Bibliothek hinzugefügt`);
        // Clear image cache
        setImages(prev => { const next = { ...prev }; delete next[folderId]; return next; });
        setSelectedImages(prev => { const next = { ...prev }; delete next[folderId]; return next; });
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

  /** Merge all files from inbox folder to target project (for named project folders) */
  const handleMerge = async (inboxItem, targetProject) => {
    setProcessing(prev => ({ ...prev, [inboxItem.id]: 'merging' }));
    try {
      const response = await fetch('/api/mobile/inbox/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceFolderId: inboxItem.drive_folder_id,
          targetProjectId: targetProject.id,
          inboxFolderId: inboxItem.inbox_folder_id,
          projectName: inboxItem.project_name,
        }),
      });
      if (response.ok) {
        hasChangesRef.current = true;
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

  /** Selective merge: move only selected images from user inbox to target project */
  const handleSelectiveMerge = async (inboxItem, targetProject) => {
    const selected = selectedImages[inboxItem.drive_folder_id];
    if (!selected || selected.size === 0) {
      showNotification('Bitte mindestens ein Bild auswählen', 'error');
      return;
    }

    setProcessing(prev => ({ ...prev, [inboxItem.id]: 'merging' }));
    try {
      const response = await fetch('/api/mobile/inbox/merge-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceFolderId: inboxItem.drive_folder_id,
          targetProjectId: targetProject.id,
          fileIds: [...selected],
        }),
      });
      if (response.ok) {
        hasChangesRef.current = true;
        const data = await response.json();
        showNotification(`${data.movedCount} Bilder mit "${targetProject.folder_name}" zusammengeführt`);
        setMergeTarget(null);
        // Clear image cache so it reloads remaining images
        setImages(prev => {
          const next = { ...prev };
          delete next[inboxItem.drive_folder_id];
          return next;
        });
        setSelectedImages(prev => {
          const next = { ...prev };
          delete next[inboxItem.drive_folder_id];
          return next;
        });
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
    const label = item.is_user_inbox ? 'Bilder' : `"${item.project_name}"`;
    if (!window.confirm(`${label} wirklich ablehnen und aus der Inbox löschen?`)) return;
    setProcessing(prev => ({ ...prev, [item.id]: 'deleting' }));
    try {
      const response = await fetch(`/api/mobile/inbox/${item.drive_folder_id}`, { method: 'DELETE' });
      if (response.ok) {
        showNotification(`${label} abgelehnt`);
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

  /** Process delete requests (fire-and-forget: instant UI update, background API) */
  const handleProcessDeleteRequests = (requestIds) => {
    // Optimistic: remove from UI immediately
    setLocalDeleteRequests(prev => prev.filter(r => !requestIds.includes(r.id)));
    showNotification(`${requestIds.length} ${requestIds.length === 1 ? 'Bild wird' : 'Bilder werden'} gelöscht...`);

    // Fire API in background
    fetch('/api/mobile/inbox/process-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestIds }),
    })
    .then(async res => {
      const data = await res.json();
      if (res.ok) {
        hasChangesRef.current = true;
        showNotification(data.message || 'Gelöscht');
      } else {
        showNotification(data.error || 'Fehler beim Löschen', 'error');
      }
      onRefresh();
    })
    .catch(e => {
      showNotification('Fehler: ' + e.message, 'error');
      onRefresh();
    });
  };

  /** Dismiss delete requests (fire-and-forget: instant UI update) */
  const handleDismissDeleteRequests = (requestIds) => {
    // Optimistic: remove from UI immediately
    setLocalDeleteRequests(prev => prev.filter(r => !requestIds.includes(r.id)));
    showNotification('Löschanfragen verworfen');

    // Fire API in background
    fetch('/api/mobile/inbox/dismiss-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestIds }),
    })
    .then(async res => {
      if (!res.ok) {
        const data = await res.json();
        showNotification(data.error || 'Fehler', 'error');
      }
      onRefresh();
    })
    .catch(e => {
      showNotification('Fehler: ' + e.message, 'error');
      onRefresh();
    });
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

  const renderProjectCard = (project) => {
    const isUserInbox = project.is_user_inbox;
    const folderId = project.drive_folder_id;
    const folderImages = images[folderId] || [];
    const selected = selectedImages[folderId] || new Set();
    const deleteMarked = markedForDeletion[folderId] || new Set();
    const selectedCount = selected.size;
    const deleteCount = deleteMarked.size;
    const totalCount = folderImages.length;
    const isExpanded = expandedProject === folderId || isUserInbox;

    return (
      <div
        key={project.id}
        className={`pending-project-card ${isUserInbox ? 'user-inbox-card' : ''}`}
      >
        {/* Header */}
        <div
          className={`pending-project-header ${isUserInbox ? 'user-inbox-header' : ''}`}
          onClick={() => !isUserInbox && toggleExpand(project)}
        >
          <div className="pending-project-info">
            {isUserInbox ? <User size={20} /> : <FolderOpen size={20} />}
            <div>
              <div className="pending-project-name">{project.project_name}</div>
              <div className="pending-project-meta">
                <Image size={12} />
                {project.image_count || 0} {(project.image_count || 0) === 1 ? 'Bild' : 'Bilder'}
                {isUserInbox && selectedCount < totalCount && totalCount > 0 && (
                  <span className="pending-selection-count">
                    · {selectedCount} ausgewählt
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="pending-project-actions">
            {processing[project.id] ? (
              <Loader size={18} className="spinning" />
            ) : (
              <>
                {!isUserInbox && project.drive_folder_id && (
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
                  title={isUserInbox ? 'Ausgewählte Bilder einem Projekt zuordnen' : 'Mit bestehendem Projekt zusammenführen'}
                >
                  <GitMerge size={16} />
                  Zusammenführen{isUserInbox && selectedCount > 0 ? ` (${selectedCount})` : ''}
                </button>
                {isUserInbox && project.drive_folder_id && (
                  <button
                    className="btn-pending btn-accept"
                    onClick={(e) => { e.stopPropagation(); handleAddToLibrary(project); }}
                    title="Bilder zur Bibliothek hinzufügen (ohne Projekt)"
                  >
                    <Check size={16} />
                    Hinzufügen
                  </button>
                )}
                <button
                  className="btn-pending btn-delete"
                  onClick={(e) => { e.stopPropagation(); handleDelete(project); }}
                  title="Ablehnen"
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
            {!isUserInbox && (
              isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />
            )}
          </div>
        </div>

        {/* Merge picker */}
        {mergeTarget?.id === project.id && (
          <div className="pending-merge-section">
            {isUserInbox && selectedCount === 0 && (
              <div className="pending-merge-hint">
                Bitte mindestens ein Bild unten auswählen
              </div>
            )}
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
                  onClick={() => isUserInbox
                    ? handleSelectiveMerge(project, ep)
                    : handleMerge(project, ep)
                  }
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

        {/* Image preview - always shown for user inbox, expandable for projects */}
        {isExpanded && (
          <div className={`pending-images-section ${isUserInbox ? 'user-inbox-images' : ''}`}>
            {loadingImages[folderId] ? (
              <div className="pending-images-loading">
                <Loader size={20} className="spinning" />
                <span>Bilder werden geladen...</span>
              </div>
            ) : folderImages.length > 0 ? (
              <>
                {(isUserInbox || deleteCount > 0) && (
                  <div className="pending-images-toolbar">
                    {isUserInbox && (
                      <button
                        className="btn-select-all"
                        onClick={() => selectedCount === totalCount ? deselectAllImages(folderId) : selectAllImages(folderId)}
                      >
                        {selectedCount === totalCount ? <CheckSquare size={14} /> : <Square size={14} />}
                        {selectedCount === totalCount ? 'Alle abwählen' : 'Alle auswählen'}
                      </button>
                    )}
                    <span className="pending-images-count">
                      {isUserInbox && <>{selectedCount} / {totalCount} ausgewählt</>}
                      {deleteCount > 0 && isUserInbox && ' · '}
                      {deleteCount > 0 && <span className="delete-count-label">{deleteCount} zum Löschen</span>}
                    </span>
                    {deleteCount > 0 && (
                      <button
                        className="btn-delete-marked"
                        onClick={() => handleDeleteMarked(folderId, project)}
                      >
                        <Trash2 size={14} />
                        Löschen bestätigen
                      </button>
                    )}
                  </div>
                )}
                <div className="pending-images-grid">
                  {folderImages.map((img, idx) => {
                    const isSelected = selected.has(img.id);
                    const isMarkedDelete = deleteMarked.has(img.id);
                    const cardClass = isMarkedDelete
                      ? `pending-image-card marked-delete${isUserInbox ? ' selectable' : ''}`
                      : `pending-image-card ${isUserInbox ? (isSelected ? 'selectable selected' : 'selectable') : ''}`;
                    return (
                      <div
                        key={img.id}
                        className={cardClass}
                        title={img.name}
                        onClick={isMarkedDelete
                          ? () => toggleDeleteMark(folderId, img.id)
                          : isUserInbox
                            ? () => toggleImageSelection(folderId, img.id)
                            : () => openLightbox(folderId, idx)
                        }
                      >
                        {img.id ? (
                          <img src={`/api/mobile/inbox/image-proxy/${img.id}`} alt={img.name} />
                        ) : (
                          <div className="pending-image-placeholder">
                            <Image size={24} />
                          </div>
                        )}
                        {isUserInbox && !isMarkedDelete && (
                          <div className={`pending-image-checkbox ${isSelected ? 'checked' : ''}`}>
                            {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                          </div>
                        )}
                        {isMarkedDelete && (
                          <div className="pending-image-delete-badge">
                            <Trash2 size={16} />
                          </div>
                        )}
                        <div className={`pending-image-name${isMarkedDelete ? ' delete-name' : ''}`}>{img.name}</div>
                        <button
                          className={`pending-image-delete-toggle ${isMarkedDelete ? 'active' : ''}`}
                          onClick={(e) => { e.stopPropagation(); toggleDeleteMark(folderId, img.id); }}
                          title={isMarkedDelete ? 'Löschen aufheben' : 'Zum Löschen markieren'}
                        >
                          <Trash2 size={12} />
                        </button>
                        {isUserInbox && !isMarkedDelete && (
                          <button
                            className="pending-image-zoom"
                            onClick={(e) => { e.stopPropagation(); openLightbox(folderId, idx); }}
                            title="Vergrößern"
                          >
                            <Search size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="pending-images-empty">Keine Bilder</div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="pending-modal-overlay" onClick={handleClose}>
      <div className="pending-modal" onClick={e => e.stopPropagation()}>
        <div className="pending-modal-header">
          <h2>Inbox - Neue Uploads von der App</h2>
          <button className="pending-modal-close" onClick={handleClose}>
            <X size={20} />
          </button>
        </div>

        {notification && (
          <div className={`pending-notification ${notification.type}`}>
            {notification.message}
          </div>
        )}

        <div className="pending-modal-body">
          {/* Delete Requests Section - grouped by project, collapsible */}
          {localDeleteRequests.length > 0 && (
            <div className="delete-requests-section">
              <div className="delete-requests-header">
                <Trash2 size={16} />
                <span>Löschanfragen vom Handy ({localDeleteRequests.length})</span>
                <div className="delete-requests-actions">
                  <button
                    className="btn-pending btn-accept btn-small"
                    onClick={() => handleProcessDeleteRequests(localDeleteRequests.map(r => r.id))}
                    title="Alle löschen"
                  >
                    <Trash2 size={14} />
                    Alle löschen
                  </button>
                  <button
                    className="btn-pending btn-dismiss btn-small"
                    onClick={() => handleDismissDeleteRequests(localDeleteRequests.map(r => r.id))}
                    title="Anfragen verwerfen (Bilder behalten)"
                  >
                    <X size={14} />
                    Verwerfen
                  </button>
                </div>
              </div>

              {groupedDeleteRequests.map(group => {
                const isExpanded = expandedDeleteGroup === (group.name || '__no_project__');
                const groupKey = group.name || '__no_project__';
                return (
                  <div key={groupKey} className="delete-group">
                    <div
                      className="delete-group-header"
                      onClick={() => setExpandedDeleteGroup(isExpanded ? null : groupKey)}
                    >
                      <FolderOpen size={16} />
                      <span className="delete-group-name">{group.name || 'Kein Projekt'}</span>
                      <span className="delete-group-count">{group.items.length} {group.items.length === 1 ? 'Bild' : 'Bilder'}</span>
                      <div className="delete-group-actions">
                        <button
                          className="btn-pending btn-delete btn-icon"
                          onClick={(e) => { e.stopPropagation(); handleProcessDeleteRequests(group.items.map(r => r.id)); }}
                          title="Alle in dieser Gruppe löschen"
                        >
                          <Trash2 size={14} />
                        </button>
                        <button
                          className="btn-pending btn-dismiss btn-icon"
                          onClick={(e) => { e.stopPropagation(); handleDismissDeleteRequests(group.items.map(r => r.id)); }}
                          title="Gruppe verwerfen"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>

                    {isExpanded && (
                      <div className="delete-group-images">
                        <div className="pending-images-grid">
                          {group.items.map((req, idx) => {
                            const previewUrl = group.name
                              ? `/api/mobile/inbox/delete-preview/${encodeURIComponent(group.name)}/${encodeURIComponent(req.file_name)}`
                              : null;
                            return (
                              <div key={req.id} className="pending-image-card marked-delete delete-preview-card">
                                {previewUrl ? (
                                  <img
                                    src={previewUrl}
                                    alt={req.file_name}
                                    onClick={() => setDeletePreviewLightbox({
                                      images: group.items.map(r => ({
                                        id: null,
                                        name: r.file_name,
                                        previewUrl: `/api/mobile/inbox/delete-preview/${encodeURIComponent(group.name)}/${encodeURIComponent(r.file_name)}`,
                                      })),
                                      startIndex: idx,
                                    })}
                                  />
                                ) : (
                                  <div className="pending-image-placeholder">
                                    <Image size={24} />
                                  </div>
                                )}
                                <div className="pending-image-name delete-name">{req.file_name}</div>
                                <div className="delete-preview-meta">
                                  <span>{req.requested_by}</span>
                                  <span>
                                    {new Date(req.requested_at).toLocaleDateString('de-DE', {
                                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                                    })}
                                  </span>
                                </div>
                                <div className="delete-preview-actions">
                                  <button
                                    className="btn-pending btn-delete btn-icon"
                                    onClick={(e) => { e.stopPropagation(); handleProcessDeleteRequests([req.id]); }}
                                    title="Löschen"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                  <button
                                    className="btn-pending btn-dismiss btn-icon"
                                    onClick={(e) => { e.stopPropagation(); handleDismissDeleteRequests([req.id]); }}
                                    title="Verwerfen"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Upload Projects */}
          {projects.length === 0 && deleteRequests.length === 0 ? (
            <div className="pending-empty">
              <Inbox size={48} strokeWidth={1} />
              <p>Keine neuen Uploads in der Inbox</p>
            </div>
          ) : (
            projects.map(project => renderProjectCard(project))
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

      {deletePreviewLightbox && (
        <DeletePreviewLightbox
          images={deletePreviewLightbox.images}
          startIndex={deletePreviewLightbox.startIndex}
          onClose={() => setDeletePreviewLightbox(null)}
        />
      )}
    </div>
  );
}

export default InboxBanner;
