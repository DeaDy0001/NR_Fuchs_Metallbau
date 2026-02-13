import { useState, useEffect } from 'react';
import { Grid, List, RefreshCw, Search, Maximize2, Edit2, X, Play, Pause, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import './DriveImages.css';

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

function DriveImages() {
  const [images, setImages] = useState([]);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true); // Auto-refresh aktiviert
  const [newImagesCount, setNewImagesCount] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1); // Zoom level (1 = 100%)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false); // Delete confirmation dialog
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 }); // Pan position for zoomed image
  const [isDragging, setIsDragging] = useState(false); // Is user dragging the image
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 }); // Drag start position
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 100,
    offset: 0
  });

  // Initial load
  useEffect(() => {
    loadImages();
  }, [searchQuery]);

  // Auto-refresh Bilder-Liste alle 10 Sekunden
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadImages(true); // Silent refresh (kein Loading-Spinner)
    }, 10000); // 10 Sekunden

    return () => clearInterval(interval);
  }, [autoRefresh, searchQuery]);

  // Auto-sync mit Google Drive alle 5 Minuten
  useEffect(() => {
    if (!autoRefresh) return;

    const syncInterval = setInterval(async () => {
      try {
        console.log('🔄 Auto-Sync mit Google Drive...');
        await fetch('/api/drive/images/refresh', { method: 'POST' });
        loadImages(true);
      } catch (error) {
        console.error('Auto-sync error:', error);
      }
    }, 5 * 60 * 1000); // 5 Minuten

    return () => clearInterval(syncInterval);
  }, [autoRefresh]);

  const loadImages = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams({
        limit: pagination.limit,
        offset: pagination.offset,
        search: searchQuery
      });

      const response = await fetch(`/api/drive/images?${params}`);
      if (response.ok) {
        const data = await response.json();

        // Prüfe ob neue Bilder vorhanden sind
        if (silent && data.images.length > images.length) {
          const newCount = data.images.length - images.length;
          setNewImagesCount(newCount);

          // Toast-Benachrichtigung
          showNewImagesNotification(newCount);
        }

        setImages(data.images);
        setPagination(prev => ({ ...prev, total: data.total }));
      }
    } catch (error) {
      console.error('Error loading images:', error);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const showNewImagesNotification = (count) => {
    console.log(`🔔 ${count} neue Bilder gefunden!`);

    // Optional: Browser-Benachrichtigung (wenn erlaubt)
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Neue Bilder!', {
        body: `${count} neue ${count === 1 ? 'Bild' : 'Bilder'} verfügbar`,
        icon: '/favicon.ico'
      });
    }
  };

  const handleRefresh = async () => {
    setLoading(true);

    try {
      const response = await fetch('/api/drive/images/refresh', {
        method: 'POST'
      });

      if (response.ok) {
        loadImages();
      } else {
        alert('Fehler beim Aktualisieren der Bilder');
      }
    } catch (error) {
      console.error('Error refreshing images:', error);
      alert('Fehler beim Aktualisieren der Bilder');
    } finally {
      setLoading(false);
    }
  };

  const handleImageClick = (image) => {
    setSelectedImage(image);
    setEditingName(image.name);
    setZoomLevel(1); // Reset zoom when opening new image
  };

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + 0.25, 3)); // Max 300%
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev - 0.25, 0.5)); // Min 50%
  };

  const handleZoomReset = () => {
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
  };

  // Pan/Drag handlers for zoomed image
  const handleMouseDown = (e) => {
    if (zoomLevel > 1) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - panPosition.x,
        y: e.clientY - panPosition.y
      });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging && zoomLevel > 1) {
      setPanPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Shift + Wheel zoom
  const handleWheel = (e) => {
    if (e.shiftKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoomLevel(prev => Math.min(Math.max(prev + delta, 0.5), 3));
    }
  };

  // Open delete confirmation dialog
  const handleDelete = () => {
    setShowDeleteDialog(true);
  };

  // Perform actual delete operation
  const performDelete = async (deleteFromDrive) => {
    setShowDeleteDialog(false);

    try {
      const url = `/api/drive/images/${selectedImage.id}?deleteFromDrive=${deleteFromDrive}`;
      const response = await fetch(url, {
        method: 'DELETE'
      });

      if (response.ok) {
        const result = await response.json();
        // Close modal and reload images
        setSelectedImage(null);
        loadImages();

        if (deleteFromDrive) {
          alert('✅ Bild erfolgreich aus Software UND Google Drive gelöscht!');
        } else {
          alert('✅ Bild aus Software gelöscht (wird nicht erneut heruntergeladen)');
        }
      } else {
        const error = await response.json();
        alert(`Fehler beim Löschen: ${error.error || 'Unbekannter Fehler'}`);
      }
    } catch (error) {
      console.error('Error deleting image:', error);
      alert(`Fehler beim Löschen: ${error.message}`);
    }
  };

  const handlePreviousImage = () => {
    const currentIndex = images.findIndex(img => img.id === selectedImage.id);
    if (currentIndex > 0) {
      const prevImage = images[currentIndex - 1];
      setSelectedImage(prevImage);
      setEditingName(prevImage.name);
      setZoomLevel(1);
      setPanPosition({ x: 0, y: 0 });
    }
  };

  const handleNextImage = () => {
    const currentIndex = images.findIndex(img => img.id === selectedImage.id);
    if (currentIndex < images.length - 1) {
      const nextImage = images[currentIndex + 1];
      setSelectedImage(nextImage);
      setEditingName(nextImage.name);
      setZoomLevel(1);
      setPanPosition({ x: 0, y: 0 });
    }
  };

  // Keyboard shortcuts for modal
  useEffect(() => {
    if (!selectedImage) return;

    const handleKeyPress = (e) => {
      if (e.key === 'Escape') {
        closeModal();
      } else if (e.key === 'ArrowLeft') {
        handlePreviousImage();
      } else if (e.key === 'ArrowRight') {
        handleNextImage();
      } else if (e.key === 'Delete') {
        handleDelete();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [selectedImage, images]);

  const handleRename = async () => {
    if (!editingName || editingName.trim() === '') {
      alert('Bitte gib einen gültigen Namen ein');
      return;
    }

    if (editingName === selectedImage.name) {
      // No change
      return;
    }

    try {
      const response = await fetch(`/api/drive/images/${selectedImage.id}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingName.trim() })
      });

      if (response.ok) {
        const updatedImage = await response.json();
        // Update the selected image with new data
        setSelectedImage(updatedImage);
        // Reload images list
        loadImages();
        alert('✅ Erfolgreich umbenannt!');
      } else {
        const error = await response.json();
        alert(`Fehler beim Umbenennen: ${error.error || 'Unbekannter Fehler'}`);
      }
    } catch (error) {
      console.error('Error renaming image:', error);
      alert(`Fehler beim Umbenennen: ${error.message}`);
    }
  };

  const closeModal = () => {
    setSelectedImage(null);
    setEditingName('');
  };

  return (
    <div className="drive-images-page">
      <div className="page-header">
        <h1>Drive Bilder</h1>
        <div className="header-actions">
          <button
            className={`btn ${autoRefresh ? 'btn-success' : 'btn-secondary'}`}
            onClick={() => setAutoRefresh(!autoRefresh)}
            title={autoRefresh ? 'Auto-Refresh deaktivieren' : 'Auto-Refresh aktivieren'}
          >
            {autoRefresh ? <Pause size={18} /> : <Play size={18} />}
            {autoRefresh ? 'Auto-Refresh AN' : 'Auto-Refresh AUS'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={loading}
          >
            <RefreshCw size={18} className={loading ? 'spinning' : ''} />
            Manuell Aktualisieren
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Bilder durchsuchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="view-toggle">
          <button
            className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
            title="Kachelansicht"
          >
            <Grid size={18} />
          </button>
          <button
            className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            title="Listenansicht"
          >
            <List size={18} />
          </button>
        </div>
      </div>

      {loading && images.length === 0 ? (
        <div className="loading-state">Lade Bilder...</div>
      ) : images.length === 0 ? (
        <div className="empty-state">
          <p>Keine Bilder gefunden</p>
          <p className="empty-hint">
            Fügen Sie Google Drive Pfade in den Einstellungen hinzu und klicken Sie auf Aktualisieren
          </p>
        </div>
      ) : (
        <div className={`images-container ${viewMode}`}>
          {images.map(image => (
            <div
              key={image.id}
              className="image-card"
              onClick={() => handleImageClick(image)}
            >
              {viewMode === 'grid' ? (
                <>
                  <div className="image-thumbnail">
                    {image.thumbnail_url ? (
                      <img src={image.thumbnail_url} alt={image.name} />
                    ) : (
                      <div className="image-placeholder">
                        <Maximize2 size={32} />
                      </div>
                    )}
                    <button
                      className="image-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedImage(image);
                        setShowDeleteDialog(true);
                      }}
                      title="Bild löschen"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="image-info">
                    <div className="image-name" title={image.name}>{image.name}</div>
                    {image.subfolder && (
                      <div className="subfolder-badge-small">{image.subfolder}</div>
                    )}
                  </div>
                </>
              ) : (
                <div className="list-item">
                  <div className="list-thumbnail">
                    {image.thumbnail_url ? (
                      <img src={image.thumbnail_url} alt={image.name} />
                    ) : (
                      <div className="image-placeholder-small">
                        <Maximize2 size={20} />
                      </div>
                    )}
                  </div>
                  <div className="list-info">
                    <div className="image-name">
                      {image.name}
                      {image.subfolder && (
                        <span className="subfolder-badge-small" style={{ marginLeft: '0.5rem' }}>
                          {image.subfolder}
                        </span>
                      )}
                    </div>
                    <div className="image-meta">
                      {image.file_size && `${(image.file_size / 1024 / 1024).toFixed(2)} MB`}
                      {image.width && image.height && ` • ${image.width}x${image.height}`}
                    </div>
                  </div>
                  <div className="list-actions">
                    <button
                      className="icon-btn delete-icon-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedImage(image);
                        setShowDeleteDialog(true);
                      }}
                      title="Bild löschen"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && selectedImage && (
        <div className="modal-overlay" onClick={() => setShowDeleteDialog(false)}>
          <div className="delete-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Bild löschen</h3>
            <p>Möchtest du das Bild <strong>"{selectedImage.name}"</strong> löschen?</p>
            <div className="delete-options">
              <button
                className="delete-option-btn software-only"
                onClick={() => performDelete(false)}
              >
                <div className="option-title">🗑️ Nur aus Software</div>
                <div className="option-description">
                  Bleibt auf Google Drive, wird aber nicht mehr heruntergeladen
                </div>
              </button>
              <button
                className="delete-option-btn full-delete"
                onClick={() => performDelete(true)}
              >
                <div className="option-title">🔥 Auch von Google Drive</div>
                <div className="option-description">
                  Wird permanent von Google Drive gelöscht
                </div>
              </button>
            </div>
            <button
              className="delete-cancel-btn"
              onClick={() => setShowDeleteDialog(false)}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {selectedImage && !showDeleteDialog && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>
              <X size={24} />
            </button>

            <div className="modal-content">
              {/* Scrollable Image Container (Left) */}
              <div className="modal-image-container">
                <div className="zoom-controls">
                  <button className="zoom-btn" onClick={handleZoomOut} title="Zoom Out" disabled={zoomLevel <= 0.5}>
                    -
                  </button>
                  <span className="zoom-level">{Math.round(zoomLevel * 100)}%</span>
                  <button className="zoom-btn" onClick={handleZoomIn} title="Zoom In" disabled={zoomLevel >= 3}>
                    +
                  </button>
                  <button className="zoom-btn zoom-reset" onClick={handleZoomReset} title="Zoom auf 100% zurücksetzen">
                    Reset
                  </button>

                  <div className="zoom-controls-right">
                    <button
                      className="zoom-btn nav-btn"
                      onClick={handlePreviousImage}
                      title="Vorheriges Bild (←)"
                      disabled={images.findIndex(img => img.id === selectedImage.id) === 0}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      className="zoom-btn nav-btn"
                      onClick={handleNextImage}
                      title="Nächstes Bild (→)"
                      disabled={images.findIndex(img => img.id === selectedImage.id) === images.length - 1}
                    >
                      <ChevronRight size={18} />
                    </button>
                    <button
                      className="zoom-btn delete-btn"
                      onClick={handleDelete}
                      title="Bild löschen (Delete)"
                    >
                      <Trash2 size={18} />
                    </button>
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
                    cursor: zoomLevel > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
                  }}
                >
                  <img
                    src={selectedImage.local_path || selectedImage.thumbnail_url}
                    alt={selectedImage.name}
                    style={{
                      transform: `scale(${zoomLevel}) translate(${panPosition.x / zoomLevel}px, ${panPosition.y / zoomLevel}px)`,
                      transformOrigin: 'top left',
                      transition: isDragging ? 'none' : 'transform 0.2s ease',
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
                    />
                    <button
                      className="btn btn-primary btn-sm btn-icon"
                      onClick={handleRename}
                      title="Umbenennen"
                    >
                      <Edit2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="modal-section">
                  <label>Originalname</label>
                  <div className="detail-text">{selectedImage.original_name}</div>
                </div>

                {selectedImage.subfolder && (
                  <div className="modal-section">
                    <label>Unterordner</label>
                    <div className="subfolder-badge">{selectedImage.subfolder}</div>
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
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DriveImages;
