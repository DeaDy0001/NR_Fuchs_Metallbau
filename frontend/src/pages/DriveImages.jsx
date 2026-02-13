import { useState, useEffect } from 'react';
import { Grid, List, RefreshCw, Search, Maximize2, Edit2, X } from 'lucide-react';
import './DriveImages.css';

function DriveImages() {
  const [images, setImages] = useState([]);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 100,
    offset: 0
  });

  useEffect(() => {
    loadImages();
  }, [searchQuery]);

  const loadImages = async () => {
    setLoading(true);

    try {
      const params = new URLSearchParams({
        limit: pagination.limit,
        offset: pagination.offset,
        search: searchQuery
      });

      const response = await fetch(`/api/drive/images?${params}`);
      if (response.ok) {
        const data = await response.json();
        setImages(data.images);
        setPagination(prev => ({ ...prev, total: data.total }));
      }
    } catch (error) {
      console.error('Error loading images:', error);
    } finally {
      setLoading(false);
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
  };

  const handleRename = async () => {
    if (!editingName || editingName === selectedImage.name) {
      return;
    }

    try {
      const response = await fetch(`/api/drive/images/${selectedImage.id}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingName })
      });

      if (response.ok) {
        loadImages();
        setSelectedImage(null);
      } else {
        alert('Fehler beim Umbenennen');
      }
    } catch (error) {
      console.error('Error renaming image:', error);
      alert('Fehler beim Umbenennen');
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
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={loading}
          >
            <RefreshCw size={18} className={loading ? 'spinning' : ''} />
            Aktualisieren
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
                  </div>
                  <div className="image-info">
                    <div className="image-name" title={image.name}>{image.name}</div>
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
                    <div className="image-name">{image.name}</div>
                    <div className="image-meta">
                      {image.file_size && `${(image.file_size / 1024 / 1024).toFixed(2)} MB`}
                      {image.width && image.height && ` • ${image.width}x${image.height}`}
                    </div>
                  </div>
                  <div className="list-actions">
                    <button className="icon-btn" title="Bearbeiten">
                      <Edit2 size={18} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedImage && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>
              <X size={24} />
            </button>

            <div className="modal-content">
              <div className="modal-image">
                <img src={selectedImage.file_url || selectedImage.thumbnail_url} alt={selectedImage.name} />
              </div>

              <div className="modal-details">
                <div className="modal-section">
                  <label>Name</label>
                  <div className="rename-input-group">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="input"
                    />
                    <button className="btn btn-primary" onClick={handleRename}>
                      Umbenennen
                    </button>
                  </div>
                </div>

                <div className="modal-section">
                  <label>Originalname</label>
                  <div className="detail-text">{selectedImage.original_name}</div>
                </div>

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
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DriveImages;
