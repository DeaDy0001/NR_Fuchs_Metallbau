import { useState, useEffect, useRef, useCallback } from 'react';
import { Grid, List, RefreshCw, Search, Maximize2, Edit2, X, Play, Pause, Trash2, ChevronLeft, ChevronRight, Filter, Calendar, Pencil, Tag, Plus, Check, Edit3, ChevronsRight, ChevronsLeft } from 'lucide-react';
import ImageEditor from '../components/ImageEditor';
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
  const [deleteFromProjects, setDeleteFromProjects] = useState(false); // Delete from all projects checkbox
  const [showEditor, setShowEditor] = useState(false); // Image editor
  const [notification, setNotification] = useState(null); // Custom notification popup
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 }); // Pan position for zoomed image
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOriginRef = useRef({ x: 0, y: 0 });
  const imageContainerRef = useRef(null);
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 50,
    offset: 0,
    currentPage: 1
  });
  const [projects, setProjects] = useState([]); // Alle Projekte
  const [selectedProjects, setSelectedProjects] = useState([]); // Markierte Projekte aus localStorage

  // Filter states
  const [selectedProjectsFilter, setSelectedProjectsFilter] = useState([]); // Projekte für Filter
  const [photoDateFrom, setPhotoDateFrom] = useState(''); // Fotoaufnahme Start-Datum
  const [photoDateTo, setPhotoDateTo] = useState(''); // Fotoaufnahme End-Datum
  const [uploadDateFrom, setUploadDateFrom] = useState(''); // Hochlade Start-Datum
  const [uploadDateTo, setUploadDateTo] = useState(''); // Hochlade End-Datum
  const [showOnlyUnassigned, setShowOnlyUnassigned] = useState(false); // Nur Bilder ohne Projekt
  const [showAllImages, setShowAllImages] = useState(false); // Alle Bilder (mit und ohne Projekte)
  const [showOnlyWithProjects, setShowOnlyWithProjects] = useState(false); // Nur Bilder mit Projekten
  const [selectedSubfolders, setSelectedSubfolders] = useState([]); // Ausgewählte Ordner-Badges
  const [availableSubfolders, setAvailableSubfolders] = useState([]); // Alle verfügbaren Subfolders
  const [showProjectModal, setShowProjectModal] = useState(false); // Projekt-Auswahl Modal
  const [projectSearchQuery, setProjectSearchQuery] = useState(''); // Suchfeld im Projekt-Modal
  const [drivePaths, setDrivePaths] = useState([]); // Alle verfügbaren Google Drive Pfade
  const [selectedDrivePaths, setSelectedDrivePaths] = useState([]); // Ausgewählte Drive-Pfade für Filter
  const [sortBy, setSortBy] = useState('created_at'); // Sortierfeld: name, photo_taken_at, created_at
  const [sortOrder, setSortOrder] = useState('desc'); // Sortierrichtung: asc, desc
  const prevImagesCountRef = useRef(0); // Für Auto-Refresh Benachrichtigungen
  const [settingsLoaded, setSettingsLoaded] = useState(false); // Track if settings have been loaded from backend
  const modalImageRef = useRef(null); // Ref für das Modal-Bild

  // Tag system states
  const [tags, setTags] = useState([]); // Alle Tags
  const [selectedTagId, setSelectedTagId] = useState(null); // Aktiver Tag für Quick-Tag-Modus
  const [showTagPopup, setShowTagPopup] = useState(false); // Tag erstellen/bearbeiten Popup
  const [editingTag, setEditingTag] = useState(null); // Tag der bearbeitet wird (null = neuer Tag)
  const [tagName, setTagName] = useState(''); // Name im Popup
  const [tagColor, setTagColor] = useState('#3b82f6'); // Farbe im Popup
  const [tagNameError, setTagNameError] = useState(''); // Fehler bei doppeltem Namen
  const [tagSidebarCollapsed, setTagSidebarCollapsed] = useState(false); // Sidebar eingeklappt
  const [tagSearchQuery, setTagSearchQuery] = useState(''); // Tag-Suchfeld in Sidebar
  const [showTagFilterModal, setShowTagFilterModal] = useState(false); // Tag-Filter Modal
  const [selectedTagFilters, setSelectedTagFilters] = useState([]); // Ausgewählte Tags für Filter
  const [tagFilterSearchQuery, setTagFilterSearchQuery] = useState(''); // Tag-Suchfeld im Filter-Modal
  const [sidebarActiveTab, setSidebarActiveTab] = useState('tags'); // 'tags' oder 'projects'
  const [showOnlyStarredProjects, setShowOnlyStarredProjects] = useState(true); // Nur markierte Projekte im Sidebar anzeigen (Standard)
  const [showAllProjectsInSidebar, setShowAllProjectsInSidebar] = useState(false); // Alle Projekte in Modal-Sidebar
  const [sidebarProjectSearch, setSidebarProjectSearch] = useState(''); // Suche in Modal-Sidebar Projekte
  const [selectedProjectId, setSelectedProjectId] = useState(null); // Aktives Projekt für Quick-Assign

  // Keep refs in sync for event handlers
  useEffect(() => { zoomRef.current = zoomLevel; }, [zoomLevel]);
  useEffect(() => { panRef.current = panPosition; }, [panPosition]);

  const TAG_PRESET_COLORS = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#10b981', '#14b8a6',
    '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
    '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
    '#f43f5e', '#78716c', '#64748b', '#ffffff'
  ];

  // Save filter/sort preferences to backend
  const savePreferences = useCallback(async (preferences) => {
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences)
      });
    } catch (error) {
      console.error('Error saving preferences:', error);
    }
  }, []);

  // Load images function (defined before useEffects to avoid TDZ error)
  const loadImages = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams({
        limit: pagination.limit,
        offset: pagination.offset,
        search: searchQuery
      });

      // Add filters
      if (selectedProjectsFilter.length > 0) {
        params.append('projectIds', selectedProjectsFilter.join(','));
      }
      if (selectedTagFilters.length > 0) {
        params.append('tagIds', selectedTagFilters.join(','));
      }
      if (photoDateFrom) {
        params.append('photoDateFrom', photoDateFrom);
      }
      if (photoDateTo) {
        params.append('photoDateTo', photoDateTo);
      }
      if (uploadDateFrom) {
        params.append('uploadDateFrom', uploadDateFrom);
      }
      if (uploadDateTo) {
        params.append('uploadDateTo', uploadDateTo);
      }
      if (selectedSubfolders.length > 0) {
        params.append('subfolders', selectedSubfolders.join(','));
      }
      if (selectedDrivePaths.length > 0) {
        params.append('drivePathIds', selectedDrivePaths.join(','));
      }

      // Sorting
      params.append('sortBy', sortBy);
      params.append('sortOrder', sortOrder);

      // Image project filter (mutually exclusive)
      if (showAllImages) {
        params.append('showAllImages', 'true');
      } else if (showOnlyWithProjects) {
        params.append('onlyWithProjects', 'true');
      } else if (showOnlyUnassigned) {
        params.append('onlyUnassigned', 'true');
      }

      const response = await fetch(`/api/drive/images?${params}`);
      if (response.ok) {
        const data = await response.json();

        // Prüfe ob neue Bilder vorhanden sind
        if (silent && data.images.length > prevImagesCountRef.current) {
          const newCount = data.images.length - prevImagesCountRef.current;
          setNewImagesCount(newCount);

          // Toast-Benachrichtigung
          showNewImagesNotification(newCount);
        }

        prevImagesCountRef.current = data.images.length;
        setImages(data.images);
        setPagination(prev => ({ ...prev, total: data.total }));
        setAvailableSubfolders(data.subfolders || []); // Alle verfügbaren Subfolders setzen
      }
    } catch (error) {
      console.error('Error loading images:', error);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [
    pagination.limit,
    pagination.offset,
    searchQuery,
    selectedProjectsFilter,
    selectedTagFilters,
    photoDateFrom,
    photoDateTo,
    uploadDateFrom,
    uploadDateTo,
    selectedSubfolders,
    selectedDrivePaths,
    sortBy,
    sortOrder,
    showAllImages,
    showOnlyWithProjects,
    showOnlyUnassigned
  ]);

  const loadProjects = async () => {
    try {
      const response = await fetch('/api/projects?limit=1000');
      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  };

  const loadDrivePaths = async () => {
    try {
      const response = await fetch('/api/drive/settings');
      if (response.ok) {
        const data = await response.json();
        setDrivePaths(data);
      }
    } catch (error) {
      console.error('Error loading drive paths:', error);
    }
  };

  // Tag functions
  const loadTags = async () => {
    try {
      const response = await fetch('/api/tags');
      if (response.ok) {
        const data = await response.json();
        setTags(data.tags);
      }
    } catch (error) {
      console.error('Error loading tags:', error);
    }
  };

  const handleCreateOrUpdateTag = async () => {
    if (!tagName.trim()) {
      setTagNameError('Name darf nicht leer sein');
      return;
    }

    // Check for duplicate name locally
    const duplicate = tags.find(t =>
      t.name.toLowerCase() === tagName.trim().toLowerCase() &&
      (!editingTag || t.id !== editingTag.id)
    );
    if (duplicate) {
      setTagNameError('Ein Tag mit diesem Namen existiert bereits');
      return;
    }

    try {
      if (editingTag) {
        // Update existing tag
        const response = await fetch(`/api/tags/${editingTag.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: tagName.trim(), color: tagColor })
        });
        if (response.ok) {
          loadTags();
          loadImages(true); // Refresh images to show updated tag colors/names
        } else {
          const error = await response.json();
          setTagNameError(error.error || 'Fehler beim Aktualisieren');
          return;
        }
      } else {
        // Create new tag
        const response = await fetch('/api/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: tagName.trim(), color: tagColor })
        });
        if (response.ok) {
          loadTags();
        } else {
          const error = await response.json();
          setTagNameError(error.error || 'Fehler beim Erstellen');
          return;
        }
      }
      closeTagPopup();
    } catch (error) {
      console.error('Error saving tag:', error);
      setTagNameError('Fehler beim Speichern');
    }
  };

  const handleDeleteTag = async (tagId) => {
    if (!confirm('Tag wirklich löschen? Dies entfernt den Tag von allen Bildern.')) return;
    try {
      const response = await fetch(`/api/tags/${tagId}`, { method: 'DELETE' });
      if (response.ok) {
        if (selectedTagId === tagId) setSelectedTagId(null);
        loadTags();
        loadImages(true);
      }
    } catch (error) {
      console.error('Error deleting tag:', error);
    }
  };

  const handleTagImageClick = async (imageId) => {
    if (!selectedTagId) return;

    // Check if image already has this tag - if yes, remove it (toggle behavior)
    const image = images.find(img => img.id === imageId);
    const alreadyHasTag = image?.tags?.some(t => t.id === selectedTagId);

    if (alreadyHasTag) {
      // Remove tag
      handleRemoveTagFromImage(imageId, selectedTagId);
      return;
    }

    // Assign tag
    try {
      const response = await fetch('/api/tags/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId, tagId: selectedTagId })
      });
      if (response.ok) {
        // Update local image state immediately
        setImages(prev => prev.map(img => {
          if (img.id === imageId) {
            const tag = tags.find(t => t.id === selectedTagId);
            if (tag) {
              return { ...img, tags: [...(img.tags || []), { id: tag.id, name: tag.name, color: tag.color }] };
            }
          }
          return img;
        }));
        loadTags(); // Refresh counts
      }
    } catch (error) {
      console.error('Error assigning tag:', error);
    }
  };

  const handleRemoveTagFromImage = async (imageId, tagId, e) => {
    if (e) e.stopPropagation();
    try {
      const response = await fetch('/api/tags/unassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId, tagId })
      });
      if (response.ok) {
        // Update local state
        setImages(prev => prev.map(img => {
          if (img.id === imageId) {
            return { ...img, tags: (img.tags || []).filter(t => t.id !== tagId) };
          }
          return img;
        }));
        // Also update selectedImage if open
        if (selectedImage && selectedImage.id === imageId) {
          setSelectedImage(prev => ({
            ...prev,
            tags: (prev.tags || []).filter(t => t.id !== tagId)
          }));
        }
        loadTags(); // Refresh counts
      }
    } catch (error) {
      console.error('Error removing tag:', error);
    }
  };

  const openTagPopup = (tag = null) => {
    setEditingTag(tag);
    setTagName(tag ? tag.name : '');
    setTagColor(tag ? tag.color : '#3b82f6');
    setTagNameError('');
    setShowTagPopup(true);
  };

  const closeTagPopup = () => {
    setShowTagPopup(false);
    setEditingTag(null);
    setTagName('');
    setTagColor('#3b82f6');
    setTagNameError('');
  };

  // Load settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/settings');
        if (response.ok) {
          const settings = await response.json();

          // Apply filter/sort settings if they exist
          if (settings.images_sort_by) setSortBy(settings.images_sort_by);
          if (settings.images_sort_order) setSortOrder(settings.images_sort_order);
          if (settings.images_view_mode) setViewMode(settings.images_view_mode);
          if (settings.images_show_only_unassigned !== undefined) {
            setShowOnlyUnassigned(settings.images_show_only_unassigned);
          }
          if (settings.images_show_all !== undefined) {
            setShowAllImages(settings.images_show_all);
          }
          if (settings.images_show_only_with_projects !== undefined) {
            setShowOnlyWithProjects(settings.images_show_only_with_projects);
          }
          if (settings.images_pagination_limit) {
            setPagination(prev => ({ ...prev, limit: settings.images_pagination_limit }));
          }

          setSettingsLoaded(true);
        }
      } catch (error) {
        console.error('Error loading settings:', error);
        setSettingsLoaded(true); // Continue even if settings fail to load
      }
    };

    loadSettings();
  }, []);

  // Initial load (only once)
  useEffect(() => {
    loadProjects();
    loadDrivePaths();
    loadTags();
    loadImages(); // Initial load
    // Load selected projects from localStorage
    const saved = localStorage.getItem('selectedProjects');
    if (saved) {
      try {
        setSelectedProjects(JSON.parse(saved));
      } catch (e) {
        console.error('Error loading selected projects:', e);
      }
    }
  }, []); // Empty dependency array - only run once

  // Save preferences to backend whenever they change (but only after initial load)
  useEffect(() => {
    if (!settingsLoaded) return; // Don't save until initial settings are loaded

    savePreferences({
      images_sort_by: sortBy,
      images_sort_order: sortOrder,
      images_view_mode: viewMode,
      images_show_only_unassigned: showOnlyUnassigned,
      images_show_all: showAllImages,
      images_show_only_with_projects: showOnlyWithProjects,
      images_pagination_limit: pagination.limit
    });
  }, [sortBy, sortOrder, viewMode, showOnlyUnassigned, showAllImages, showOnlyWithProjects, pagination.limit, settingsLoaded, savePreferences]);

  // Wenn Sidebar zugeklappt wird, Auswahl abbrechen
  useEffect(() => {
    if (tagSidebarCollapsed) {
      setSelectedTagId(null);
      setSelectedProjectId(null);
    }
  }, [tagSidebarCollapsed]);

  // Reload images when loadImages changes (i.e., when filters change)
  useEffect(() => {
    loadImages();
  }, [loadImages]);

  // Auto-refresh Bilder-Liste alle 10 Sekunden
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadImages(true); // Silent refresh (kein Loading-Spinner)
    }, 10000); // 10 Sekunden

    return () => clearInterval(interval);
  }, [autoRefresh, loadImages]); // loadImages has all filter dependencies via useCallback

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
  }, [autoRefresh, loadImages]);

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

  // Pagination helpers
  const totalPages = Math.ceil(pagination.total / pagination.limit);

  const handlePageChange = (page) => {
    const offset = (page - 1) * pagination.limit;
    setPagination(prev => ({ ...prev, currentPage: page, offset }));
  };

  const handleLimitChange = (newLimit) => {
    setPagination(prev => ({ ...prev, limit: newLimit, currentPage: 1, offset: 0 }));
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
    // If a tag is selected in quick-tag mode, assign the tag instead of opening modal
    if (selectedTagId) {
      handleTagImageClick(image.id);
      return;
    }
    // If a project is selected in quick-assign mode, assign the project
    if (selectedProjectId) {
      handleQuickAssignProject(image.id);
      return;
    }
    setSelectedImage(image);
    setEditingName(image.name);
  };

  const handleQuickAssignProject = async (imageId) => {
    if (!selectedProjectId) return;

    // Check if image already has this project - if yes, remove it (toggle behavior)
    const image = images.find(img => img.id === imageId);
    const alreadyHasProject = image?.projects?.some(p => p.id === selectedProjectId);

    if (alreadyHasProject) {
      // Remove project
      try {
        const response = await fetch('/api/drive/images/unassign-from-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId, projectId: selectedProjectId })
        });
        if (response.ok) {
          // Update local state
          setImages(prev => prev.map(img => {
            if (img.id === imageId) {
              return { ...img, projects: (img.projects || []).filter(p => p.id !== selectedProjectId) };
            }
            return img;
          }));
          loadProjects(); // Refresh counts
        }
      } catch (error) {
        console.error('Error unassigning project:', error);
      }
      return;
    }

    // Assign project
    try {
      const response = await fetch('/api/drive/images/assign-to-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId, projectId: selectedProjectId })
      });
      if (response.ok) {
        // Update local image state immediately
        setImages(prev => prev.map(img => {
          if (img.id === imageId) {
            const project = projects.find(p => p.id === selectedProjectId);
            if (project) {
              return { ...img, projects: [...(img.projects || []), { id: project.id, folder_name: project.folder_name, color: project.color }] };
            }
          }
          return img;
        }));
        loadProjects(); // Refresh to update any counts if needed
      }
    } catch (error) {
      console.error('Error assigning project:', error);
    }
  };

  const resetImageView = () => {
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
  };

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

  // Open delete confirmation dialog
  const handleDelete = () => {
    setShowDeleteDialog(true);
  };

  // Assign image to project (optimistic UI update)
  const handleAssignToProject = async (projectId) => {
    // Optimistic: update UI immediately
    const project = projects.find(p => p.id === projectId);
    const prevProjects = selectedImage.projects ? [...selectedImage.projects] : [];
    if (project && !prevProjects.some(p => p.id === projectId)) {
      setSelectedImage({ ...selectedImage, projects: [...prevProjects, project] });
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
        // Reload images in background to sync list
        loadImages(true);
      } else {
        // Revert on error
        setSelectedImage(prev => ({ ...prev, projects: prevProjects }));
        const error = await response.json();
        alert(`Fehler: ${error.error || 'Unbekannter Fehler'}`);
      }
    } catch (error) {
      // Revert on error
      setSelectedImage(prev => ({ ...prev, projects: prevProjects }));
      console.error('Error assigning image to project:', error);
      alert(`Fehler beim Zuweisen: ${error.message}`);
    }
  };

  // Unassign image from project (optimistic UI update)
  const handleUnassignFromProject = async (projectId, e) => {
    e.stopPropagation(); // Prevent triggering the assign handler
    // Optimistic: update UI immediately
    const prevProjects = selectedImage.projects ? [...selectedImage.projects] : [];
    setSelectedImage(prev => ({ ...prev, projects: prev.projects?.filter(p => p.id !== projectId) || [] }));

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
        // Reload images in background to sync list
        loadImages(true);
      } else {
        // Revert on error
        setSelectedImage(prev => ({ ...prev, projects: prevProjects }));
        const error = await response.json();
        alert(`Fehler: ${error.error || 'Unbekannter Fehler'}`);
      }
    } catch (error) {
      // Revert on error
      setSelectedImage(prev => ({ ...prev, projects: prevProjects }));
      console.error('Error unassigning image from project:', error);
      alert(`Fehler beim Entfernen: ${error.message}`);
    }
  };

  // Show a custom notification popup
  const showNotification = (message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  // Perform actual delete operation
  const performDelete = async (deleteFromDrive) => {
    const imageToDelete = selectedImage;
    // Clear both states together to prevent modal flash
    setShowDeleteDialog(false);
    setSelectedImage(null);
    setDeleteFromProjects(false);

    if (!imageToDelete) return;

    try {
      const url = `/api/drive/images/${imageToDelete.id}?deleteFromDrive=${deleteFromDrive}&deleteFromProjects=${deleteFromProjects}`;
      const response = await fetch(url, {
        method: 'DELETE'
      });

      if (response.ok) {
        const result = await response.json();
        loadImages();

        // Show info notification if the file was not found on Drive
        if (result.driveFileNotFound) {
          showNotification('Das Bild war nicht mehr auf Google Drive vorhanden. Es wurde aus der Software gelöscht.', 'warning');
        }
      } else {
        const error = await response.json();
        showNotification(`Fehler beim Löschen: ${error.error || 'Unbekannter Fehler'}`, 'error');
      }
    } catch (error) {
      console.error('Error deleting image:', error);
      showNotification(`Fehler beim Löschen: ${error.message}`, 'error');
    }
  };

  const handlePreviousImage = () => {
    const currentIndex = images.findIndex(img => img.id === selectedImage.id);
    if (currentIndex > 0) {
      const prevImage = images[currentIndex - 1];
      setSelectedImage(prevImage);
      setEditingName(prevImage.name);
      resetImageView();
    }
  };

  const handleNextImage = () => {
    const currentIndex = images.findIndex(img => img.id === selectedImage.id);
    if (currentIndex < images.length - 1) {
      const nextImage = images[currentIndex + 1];
      setSelectedImage(nextImage);
      setEditingName(nextImage.name);
      resetImageView();
    }
  };

  // Reset zoom/pan when image changes
  useEffect(() => {
    if (!selectedImage) return;
    resetImageView();
  }, [selectedImage]);

  // Lightbox-style zoom & pan for modal image
  useEffect(() => {
    if (!selectedImage) return;

    const handleWheel = (e) => {
      if (!e.shiftKey) return;
      const container = imageContainerRef.current;
      if (!container || !container.contains(e.target)) return;
      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;

      const oldZoom = zoomRef.current;
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      const newZoom = Math.min(Math.max(oldZoom + delta, 0.5), 5);

      if (newZoom <= 1) {
        setZoomLevel(newZoom);
        setPanPosition({ x: 0, y: 0 });
      } else {
        const scale = newZoom / oldZoom;
        const cur = panRef.current;
        setPanPosition({
          x: mouseX - scale * (mouseX - cur.x),
          y: mouseY - scale * (mouseY - cur.y)
        });
        setZoomLevel(newZoom);
      }
    };

    const handleMouseDown = (e) => {
      if (e.button === 1 && zoomRef.current > 1) {
        const container = imageContainerRef.current;
        if (!container || !container.contains(e.target)) return;
        e.preventDefault();
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX, y: e.clientY };
        panOriginRef.current = { ...panRef.current };
      }
    };

    const handleMouseMove = (e) => {
      if (!isPanningRef.current) return;
      setPanPosition({
        x: panOriginRef.current.x + (e.clientX - panStartRef.current.x),
        y: panOriginRef.current.y + (e.clientY - panStartRef.current.y)
      });
    };

    const handleMouseUp = (e) => {
      if (e.button === 1) isPanningRef.current = false;
    };

    document.addEventListener('wheel', handleWheel, { passive: false });
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('wheel', handleWheel);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [selectedImage]);

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

      <div className="drive-images-layout">
      {/* Main Content (Left) */}
      <div className={`drive-images-main ${selectedTagId || selectedProjectId ? 'quick-tag-active' : ''}`}>

      <div className="toolbar">
        <div className="search-filters-container">
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

          <div className="filters-row">
            {/* Projekt-Filter */}
            <div className="filter-group">
              <Filter size={16} />
              <button
                className="filter-button"
                onClick={() => setShowProjectModal(true)}
              >
                {selectedProjectsFilter.length === 0
                  ? 'Projekte auswählen'
                  : `${selectedProjectsFilter.length} Projekt(e)`}
              </button>
            </div>

            {/* Bild-Typ Filter */}
            <div className="filter-group">
              <label className="filter-checkbox-label">
                <input
                  type="checkbox"
                  checked={showAllImages}
                  onChange={(e) => {
                    setShowAllImages(e.target.checked);
                    if (e.target.checked) {
                      setShowOnlyUnassigned(false);
                      setShowOnlyWithProjects(false);
                    }
                  }}
                  className="filter-checkbox"
                />
                Alle Bilder
              </label>
            </div>

            <div className="filter-group">
              <label className="filter-checkbox-label">
                <input
                  type="checkbox"
                  checked={showOnlyWithProjects}
                  onChange={(e) => {
                    setShowOnlyWithProjects(e.target.checked);
                    if (e.target.checked) {
                      setShowAllImages(false);
                      setShowOnlyUnassigned(false);
                    }
                  }}
                  className="filter-checkbox"
                />
                Nur mit Projekten
              </label>
            </div>

            <div className="filter-group">
              <label className="filter-checkbox-label">
                <input
                  type="checkbox"
                  checked={showOnlyUnassigned}
                  onChange={(e) => {
                    setShowOnlyUnassigned(e.target.checked);
                    if (e.target.checked) {
                      setShowAllImages(false);
                      setShowOnlyWithProjects(false);
                    }
                  }}
                  className="filter-checkbox"
                />
                Nur ohne Projekt
              </label>
            </div>

            {/* Fotoaufnahme-Datums-Filter */}
            <div className="filter-group">
              <Calendar size={16} />
              <span className="filter-label">Fotoaufnahme:</span>
              <input
                type="date"
                value={photoDateFrom}
                onChange={(e) => setPhotoDateFrom(e.target.value)}
                className="filter-date"
                placeholder="Von"
              />
              <span className="date-separator">bis</span>
              <input
                type="date"
                value={photoDateTo}
                onChange={(e) => setPhotoDateTo(e.target.value)}
                className="filter-date"
                placeholder="Bis"
              />
            </div>

            {/* Hochlade-Datums-Filter */}
            <div className="filter-group">
              <Calendar size={16} />
              <span className="filter-label">Hochgeladen:</span>
              <input
                type="date"
                value={uploadDateFrom}
                onChange={(e) => setUploadDateFrom(e.target.value)}
                className="filter-date"
                placeholder="Von"
              />
              <span className="date-separator">bis</span>
              <input
                type="date"
                value={uploadDateTo}
                onChange={(e) => setUploadDateTo(e.target.value)}
                className="filter-date"
                placeholder="Bis"
              />
            </div>
          </div>

          {/* Tag-Filter Zeile */}
          <div className="filters-row">
            {/* Tag-Filter Button */}
            <div className="filter-group">
              <Tag size={16} />
              <button
                className="filter-button"
                onClick={() => setShowTagFilterModal(true)}
              >
                {selectedTagFilters.length === 0
                  ? 'Tags filtern'
                  : `${selectedTagFilters.length} Tag(s)`}
              </button>
            </div>

            {/* Selected Tag Filter Badges */}
            {selectedTagFilters.length > 0 && (
              <div className="selected-tag-filters">
                {tags
                  .filter(tag => selectedTagFilters.includes(tag.id))
                  .map(tag => (
                    <span
                      key={tag.id}
                      className="tag-filter-badge"
                      style={{ backgroundColor: tag.color }}
                    >
                      {tag.name}
                      <button
                        className="tag-filter-remove"
                        onClick={() => setSelectedTagFilters(prev => prev.filter(id => id !== tag.id))}
                        title="Filter entfernen"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                <button
                  className="clear-all-tag-filters"
                  onClick={() => setSelectedTagFilters([])}
                  title="Alle Tag-Filter entfernen"
                >
                  Alle entfernen
                </button>
              </div>
            )}
          </div>

          {/* Sortierung */}
          <div className="filters-row">
            <div className="filter-group">
              <span className="filter-label">Sortieren:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="sort-select"
              >
                <option value="created_at">Upload-Datum</option>
                <option value="photo_taken_at">Foto-Aufnahme</option>
                <option value="name">Name</option>
              </select>
              <button
                className="sort-order-btn"
                onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                title={sortOrder === 'asc' ? 'Aufsteigend' : 'Absteigend'}
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>

          {/* Google Drive Pfad Filter */}
          {drivePaths.length > 1 && (
            <div className="subfolder-filter-row">
              <span className="filter-label">Google Drive:</span>
              {drivePaths.map(drivePath => (
                <button
                  key={drivePath.id}
                  className={`subfolder-badge-filter ${selectedDrivePaths.includes(drivePath.id) ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedDrivePaths(prev =>
                      prev.includes(drivePath.id)
                        ? prev.filter(id => id !== drivePath.id)
                        : [...prev, drivePath.id]
                    );
                  }}
                >
                  {drivePath.display_name || drivePath.drive_path}
                </button>
              ))}
            </div>
          )}

          {/* Ordner-Badge Filter */}
          {availableSubfolders.length > 0 && (
            <div className="subfolder-filter-row">
              <span className="filter-label">Ordner:</span>
              {availableSubfolders.map(subfolder => (
                <button
                  key={subfolder}
                  className={`subfolder-badge-filter ${selectedSubfolders.includes(subfolder) ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedSubfolders(prev =>
                      prev.includes(subfolder)
                        ? prev.filter(s => s !== subfolder)
                        : [...prev, subfolder]
                    );
                  }}
                >
                  {subfolder}
                </button>
              ))}
            </div>
          )}
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
                    {image.tags && image.tags.length > 0 && (
                      <div className="tag-badges">
                        {image.tags.map(tag => (
                          <span
                            key={tag.id}
                            className="tag-badge-small"
                            style={{ backgroundColor: tag.color }}
                            title={tag.name}
                          >
                            {tag.name}
                            <button
                              className="tag-badge-remove"
                              onClick={(e) => handleRemoveTagFromImage(image.id, tag.id, e)}
                              title="Tag entfernen"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {image.tags && image.tags.length > 0 && image.projects && image.projects.length > 0 && (
                      <div className="badges-divider"></div>
                    )}
                    {image.projects && image.projects.length > 0 && (
                      <div className="project-badges">
                        {image.projects.map(project => (
                          <div
                            key={project.id}
                            className="project-badge-small"
                            style={{ backgroundColor: project.color }}
                            title={project.folder_name}
                          >
                            {project.folder_name}
                          </div>
                        ))}
                      </div>
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
                      {image.tags && image.tags.length > 0 && (
                        <div className="tag-badges" style={{ marginTop: '0.25rem' }}>
                          {image.tags.map(tag => (
                            <span
                              key={tag.id}
                              className="tag-badge-small"
                              style={{ backgroundColor: tag.color }}
                              title={tag.name}
                            >
                              {tag.name}
                              <button
                                className="tag-badge-remove"
                                onClick={(e) => handleRemoveTagFromImage(image.id, tag.id, e)}
                                title="Tag entfernen"
                              >
                                &times;
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      {image.tags && image.tags.length > 0 && image.projects && image.projects.length > 0 && (
                        <div className="badges-divider"></div>
                      )}
                      {image.projects && image.projects.length > 0 && (
                        <div className="project-badges" style={{ marginTop: '0.25rem' }}>
                          {image.projects.map(project => (
                            <div
                              key={project.id}
                              className="project-badge-small"
                              style={{ backgroundColor: project.color }}
                              title={project.folder_name}
                            >
                              {project.folder_name}
                            </div>
                          ))}
                        </div>
                      )}
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

      {/* Pagination */}
      {!loading && images.length > 0 && (
        <div className="pagination-container">
          <div className="pagination-info">
            Zeige {((pagination.currentPage - 1) * pagination.limit) + 1} bis {Math.min(pagination.currentPage * pagination.limit, pagination.total)} von {pagination.total} Bildern
          </div>

          <div className="pagination-controls">
            <button
              className="pagination-btn"
              onClick={() => handlePageChange(pagination.currentPage - 1)}
              disabled={pagination.currentPage === 1}
            >
              ←
            </button>

            {/* Page numbers */}
            {(() => {
              const pages = [];
              const maxPagesToShow = 7;
              let startPage = Math.max(1, pagination.currentPage - Math.floor(maxPagesToShow / 2));
              let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

              if (endPage - startPage < maxPagesToShow - 1) {
                startPage = Math.max(1, endPage - maxPagesToShow + 1);
              }

              if (startPage > 1) {
                pages.push(
                  <button key={1} className="pagination-btn" onClick={() => handlePageChange(1)}>1</button>
                );
                if (startPage > 2) {
                  pages.push(<span key="start-ellipsis" className="pagination-ellipsis">...</span>);
                }
              }

              for (let i = startPage; i <= endPage; i++) {
                pages.push(
                  <button
                    key={i}
                    className={`pagination-btn ${i === pagination.currentPage ? 'active' : ''}`}
                    onClick={() => handlePageChange(i)}
                  >
                    {i}
                  </button>
                );
              }

              if (endPage < totalPages) {
                if (endPage < totalPages - 1) {
                  pages.push(<span key="end-ellipsis" className="pagination-ellipsis">...</span>);
                }
                pages.push(
                  <button key={totalPages} className="pagination-btn" onClick={() => handlePageChange(totalPages)}>{totalPages}</button>
                );
              }

              return pages;
            })()}

            <button
              className="pagination-btn"
              onClick={() => handlePageChange(pagination.currentPage + 1)}
              disabled={pagination.currentPage === totalPages}
            >
              →
            </button>
          </div>

          <div className="pagination-limit">
            <span className="limit-label">Bilder pro Seite:</span>
            <select
              value={pagination.limit}
              onChange={(e) => handleLimitChange(parseInt(e.target.value))}
              className="limit-select"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={150}>150</option>
              <option value={200}>200</option>
              <option value={250}>250</option>
              <option value={300}>300</option>
            </select>
          </div>
        </div>
      )}

      </div>{/* End drive-images-main */}

      {/* Sidebar (Right) - Tags & Projekte */}
      <div className={`tag-sidebar ${tagSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="tag-sidebar-header">
          {!tagSidebarCollapsed && (
            <>
              {/* Tabs */}
              <div className="sidebar-tabs">
                <button
                  className={`sidebar-tab ${sidebarActiveTab === 'tags' ? 'active' : ''}`}
                  onClick={() => setSidebarActiveTab('tags')}
                >
                  <Tag size={16} />
                  Tags
                </button>
                <button
                  className={`sidebar-tab ${sidebarActiveTab === 'projects' ? 'active' : ''}`}
                  onClick={() => setSidebarActiveTab('projects')}
                >
                  <Filter size={16} />
                  Projekte
                </button>
              </div>
            </>
          )}
          <button
            className="tag-collapse-btn"
            onClick={() => setTagSidebarCollapsed(!tagSidebarCollapsed)}
            title={tagSidebarCollapsed ? 'Sidebar ausklappen' : 'Sidebar einklappen'}
          >
            {tagSidebarCollapsed ? <ChevronsLeft size={18} /> : <ChevronsRight size={18} />}
          </button>
        </div>

        {!tagSidebarCollapsed && sidebarActiveTab === 'tags' && (
          <>
            {/* Tag Search Field */}
            <div className="tag-search-box">
              <Search size={16} />
              <input
                type="text"
                placeholder="Tags suchen..."
                value={tagSearchQuery}
                onChange={(e) => setTagSearchQuery(e.target.value)}
                className="tag-search-input"
              />
              {tagSearchQuery && (
                <button
                  className="tag-search-clear"
                  onClick={() => setTagSearchQuery('')}
                  title="Suche löschen"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Add Tag Button */}
            <div className="tag-add-container">
              <button
                className="tag-add-btn-full"
                onClick={() => openTagPopup()}
                title="Neuen Tag erstellen"
              >
                <Plus size={16} />
                Neuen Tag erstellen
              </button>
            </div>

            <div className="tag-list">
              {tags.length === 0 ? (
                <div className="tag-empty">Noch keine Tags erstellt</div>
              ) : (
                tags
                  .filter(tag => tag.name.toLowerCase().includes(tagSearchQuery.toLowerCase()))
                  .map(tag => (
                    <div key={tag.id} className={`tag-list-item ${selectedTagId === tag.id ? 'tag-selected' : ''}`}>
                      <label
                        className="tag-checkbox-label"
                        onClick={(e) => {
                          e.preventDefault();
                          setSelectedTagId(prev => prev === tag.id ? null : tag.id);
                          setSelectedProjectId(null); // Deselect project when selecting tag
                        }}
                      >
                        <div className={`tag-checkbox ${selectedTagId === tag.id ? 'checked' : ''}`}>
                          {selectedTagId === tag.id && <Check size={12} />}
                        </div>
                        <span className="tag-color-dot" style={{ backgroundColor: tag.color }}></span>
                        <span className="tag-item-name">{tag.name}</span>
                        <span className="tag-item-count">({tag.image_count || 0})</span>
                      </label>
                      <div className="tag-item-actions">
                        <button
                          className="tag-edit-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            openTagPopup(tag);
                          }}
                          title="Tag bearbeiten"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          className="tag-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteTag(tag.id);
                          }}
                          title="Tag löschen"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </>
        )}

        {!tagSidebarCollapsed && sidebarActiveTab === 'projects' && (
          <>
            {/* Project Search Field */}
            <div className="tag-search-box">
              <Search size={16} />
              <input
                type="text"
                placeholder="Projekte suchen..."
                value={tagSearchQuery}
                onChange={(e) => setTagSearchQuery(e.target.value)}
                className="tag-search-input"
              />
              {tagSearchQuery && (
                <button
                  className="tag-search-clear"
                  onClick={() => setTagSearchQuery('')}
                  title="Suche löschen"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Project View Switcher */}
            <div className="project-view-switcher">
              <button
                className={`switcher-btn ${!showOnlyStarredProjects ? 'active' : ''}`}
                onClick={() => setShowOnlyStarredProjects(false)}
              >
                Alle Projekte
              </button>
              <button
                className={`switcher-btn ${showOnlyStarredProjects ? 'active' : ''}`}
                onClick={() => setShowOnlyStarredProjects(true)}
              >
                Markierte
              </button>
            </div>

            <div className="tag-list">
              {projects.length === 0 ? (
                <div className="tag-empty">Keine Projekte verfügbar</div>
              ) : (
                projects
                  .filter(project => {
                    // Filter by search query
                    const matchesSearch = project.folder_name.toLowerCase().includes(tagSearchQuery.toLowerCase());
                    // Filter by starred status if needed
                    const matchesStarred = !showOnlyStarredProjects || selectedProjects.includes(project.id);
                    return matchesSearch && matchesStarred;
                  })
                  .sort((a, b) => {
                    // Markierte Projekte zuerst anzeigen
                    const aIsStarred = selectedProjects.includes(a.id);
                    const bIsStarred = selectedProjects.includes(b.id);
                    if (aIsStarred && !bIsStarred) return -1;
                    if (!aIsStarred && bIsStarred) return 1;
                    // Sonst alphabetisch sortieren
                    return a.folder_name.localeCompare(b.folder_name);
                  })
                  .map(project => (
                    <div key={project.id} className={`tag-list-item ${selectedProjectId === project.id ? 'tag-selected' : ''}`}>
                      <label
                        className="tag-checkbox-label"
                        onClick={(e) => {
                          e.preventDefault();
                          setSelectedProjectId(prev => prev === project.id ? null : project.id);
                          setSelectedTagId(null); // Deselect tag when selecting project
                        }}
                      >
                        <div className={`tag-checkbox ${selectedProjectId === project.id ? 'checked' : ''}`}>
                          {selectedProjectId === project.id && <Check size={12} />}
                        </div>
                        <span className="tag-color-dot" style={{ backgroundColor: project.color }}></span>
                        <span className="tag-item-name">{project.folder_name}</span>
                      </label>
                    </div>
                  ))
              )}
            </div>
          </>
        )}
      </div>
      </div>{/* End drive-images-layout */}

      {/* Tag Create/Edit Popup */}
      {showTagPopup && (
        <div className="modal-overlay" onClick={closeTagPopup}>
          <div className="tag-popup" onClick={(e) => e.stopPropagation()}>
            <div className="tag-popup-header">
              <h3>{editingTag ? 'Tag bearbeiten' : 'Neuen Tag erstellen'}</h3>
              <button className="modal-close-sm" onClick={closeTagPopup}>
                <X size={20} />
              </button>
            </div>
            <div className="tag-popup-content">
              <div className="tag-popup-field">
                <label>Name</label>
                <input
                  type="text"
                  value={tagName}
                  onChange={(e) => {
                    setTagName(e.target.value);
                    setTagNameError('');
                  }}
                  placeholder="Tag-Name eingeben..."
                  className={`input ${tagNameError ? 'input-error' : ''}`}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateOrUpdateTag();
                  }}
                />
                {tagNameError && <div className="tag-error">{tagNameError}</div>}
              </div>

              <div className="tag-popup-field">
                <label>Farbe</label>
                <div className="tag-color-presets">
                  {TAG_PRESET_COLORS.map(color => (
                    <button
                      key={color}
                      className={`tag-color-preset ${tagColor === color ? 'active' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setTagColor(color)}
                      title={color}
                    />
                  ))}
                </div>
                <div className="tag-custom-color">
                  <label>Eigene Farbe:</label>
                  <input
                    type="color"
                    value={tagColor}
                    onChange={(e) => setTagColor(e.target.value)}
                    className="tag-color-input"
                  />
                  <span className="tag-color-hex">{tagColor}</span>
                </div>
              </div>

              <div className="tag-popup-preview">
                <label>Vorschau:</label>
                <div className="tag-preview-badge" style={{ backgroundColor: tagColor }}>
                  {tagName || 'Tag Name'}
                </div>
              </div>
            </div>
            <div className="tag-popup-actions">
              <button className="btn btn-secondary" onClick={closeTagPopup}>
                Abbrechen
              </button>
              <button className="btn btn-primary" onClick={handleCreateOrUpdateTag}>
                {editingTag ? 'Speichern' : 'Erstellen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && selectedImage && (
        <div className="modal-overlay" onClick={() => {setShowDeleteDialog(false); setDeleteFromProjects(false);}}>
          <div className="delete-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Bild löschen</h3>
            <p>Möchtest du das Bild <strong>"{selectedImage.name}"</strong> löschen?</p>

            {/* Checkbox: Delete from projects */}
            {selectedImage.projects && selectedImage.projects.length > 0 && (
              <div style={{ margin: '15px 0', padding: '10px', backgroundColor: '#2a2a2a', borderRadius: '4px' }}>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    checked={deleteFromProjects}
                    onChange={(e) => setDeleteFromProjects(e.target.checked)}
                    style={{ marginRight: '10px', width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <span>
                    Auch von {selectedImage.projects.length === 1 ? 'Projekt' : 'allen Projekten'} löschen?
                    <span style={{ display: 'block', fontSize: '12px', color: '#888', marginTop: '4px' }}>
                      {selectedImage.projects.map(p => p.folder_name).join(', ')}
                    </span>
                  </span>
                </label>
              </div>
            )}

            <div className="delete-options">
              <button
                className="delete-option-btn software-only"
                onClick={() => performDelete(false)}
              >
                <div className="option-title">🗑️ Nur aus Software</div>
                <div className="option-description">
                  {selectedImage.drive_file_id
                    ? 'Bleibt auf Google Drive, wird aber nicht mehr heruntergeladen'
                    : 'Bild wird aus der Software gelöscht'}
                </div>
              </button>
              {selectedImage.drive_file_id && (
                <button
                  className="delete-option-btn full-delete"
                  onClick={() => performDelete(true)}
                >
                  <div className="option-title">🔥 Auch von Google Drive</div>
                  <div className="option-description">
                    Wird permanent von Google Drive gelöscht
                  </div>
                </button>
              )}
            </div>
            <button
              className="delete-cancel-btn"
              onClick={() => {setShowDeleteDialog(false); setDeleteFromProjects(false);}}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {selectedImage && !showDeleteDialog && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-wrapper" onClick={(e) => e.stopPropagation()}>
            <button className="modal-external-close" onClick={closeModal} title="Schließen">
              <X size={20} />
            </button>
            <div className="modal">
            <div className="modal-content">
              {/* Lightbox Image Area (Left) */}
              <div
                ref={imageContainerRef}
                className="modal-image-container"
                onMouseDown={e => { if (e.button === 1) e.preventDefault(); }}
              >
                {/* Zoom controls toolbar */}
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
                    {images.findIndex(img => img.id === selectedImage.id) > 0 && (
                      <button className="zoom-btn nav-btn" onClick={handlePreviousImage} title="Vorheriges Bild (←)">
                        <ChevronLeft size={18} />
                      </button>
                    )}
                    {images.findIndex(img => img.id === selectedImage.id) < images.length - 1 && (
                      <button className="zoom-btn nav-btn" onClick={handleNextImage} title="Nächstes Bild (→)">
                        <ChevronRight size={18} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="modal-image-scroll">
                  <img
                    ref={modalImageRef}
                    src={selectedImage.local_path || selectedImage.thumbnail_url}
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

              {/* Fixed Sidebar (Right) */}
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
                  <button
                    className="sidebar-action-btn delete-btn"
                    onClick={handleDelete}
                    title="Bild löschen (Delete)"
                  >
                    <Trash2 size={16} />
                    Löschen
                  </button>
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

                  {selectedImage.tags && selectedImage.tags.length > 0 && (
                    <div className="modal-section">
                      <label>Tags</label>
                      <div className="tag-badges-modal">
                        {selectedImage.tags.map(tag => (
                          <span
                            key={tag.id}
                            className="tag-badge-modal"
                            style={{ backgroundColor: tag.color }}
                          >
                            {tag.name}
                            <button
                              className="tag-badge-remove-modal"
                              onClick={() => handleRemoveTagFromImage(selectedImage.id, tag.id)}
                              title="Tag entfernen"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
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
                          // Tag-Suche
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
                                  <X size={16} />
                                </button>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Projekt-Auswahl Modal */}
      {showProjectModal && (
        <div className="modal-overlay" onClick={() => {
          setShowProjectModal(false);
          setProjectSearchQuery('');
        }}>
          <div className="project-modal" onClick={(e) => e.stopPropagation()}>
            <div className="project-modal-header">
              <h3>Projekte auswählen</h3>
              <button className="modal-close" onClick={() => {
                setShowProjectModal(false);
                setProjectSearchQuery('');
              }}>
                <X size={20} />
              </button>
            </div>
            <div className="project-modal-content">
              <div className="project-modal-hint">
                Halte <kbd>Strg</kbd> gedrückt, um mehrere Projekte auszuwählen
              </div>

              {/* Projekt-Suchfeld */}
              <div className="project-modal-search">
                <Search size={18} />
                <input
                  type="text"
                  placeholder="Projekt suchen..."
                  value={projectSearchQuery}
                  onChange={(e) => setProjectSearchQuery(e.target.value)}
                  className="project-modal-search-input"
                />
                {projectSearchQuery && (
                  <button
                    className="project-modal-search-clear"
                    onClick={() => setProjectSearchQuery('')}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              <div className="project-modal-list">
                {projects
                  .filter(project =>
                    project.folder_name.toLowerCase().includes(projectSearchQuery.toLowerCase())
                  )
                  .map(project => (
                  <div
                    key={project.id}
                    className={`project-modal-item ${selectedProjectsFilter.includes(project.id) ? 'selected' : ''}`}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        // Multiselect with Ctrl
                        setSelectedProjectsFilter(prev =>
                          prev.includes(project.id)
                            ? prev.filter(id => id !== project.id)
                            : [...prev, project.id]
                        );
                      } else {
                        // Single select
                        setSelectedProjectsFilter([project.id]);
                      }
                    }}
                    style={{ borderLeftColor: project.color }}
                  >
                    <span>{project.folder_name}</span>
                    {selectedProjectsFilter.includes(project.id) && (
                      <span className="project-modal-checkmark">✓</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="project-modal-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setSelectedProjectsFilter([])}
                >
                  Alle abwählen
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setShowProjectModal(false);
                    setProjectSearchQuery('');
                  }}
                >
                  Fertig
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tag-Filter Modal */}
      {showTagFilterModal && (
        <div className="modal-overlay" onClick={() => { setShowTagFilterModal(false); setTagFilterSearchQuery(''); }}>
          <div className="project-modal" onClick={(e) => e.stopPropagation()}>
            <div className="project-modal-header">
              <h3>Tags filtern</h3>
              <button className="modal-close" onClick={() => { setShowTagFilterModal(false); setTagFilterSearchQuery(''); }}>
                <X size={20} />
              </button>
            </div>
            <div className="project-modal-content">
              <div className="project-modal-hint">
                Wähle einen oder mehrere Tags aus
              </div>

              {/* Tag-Suchfeld */}
              <div className="project-modal-search">
                <Search size={18} />
                <input
                  type="text"
                  placeholder="Tag suchen..."
                  value={tagFilterSearchQuery}
                  onChange={(e) => setTagFilterSearchQuery(e.target.value)}
                  className="project-modal-search-input"
                />
                {tagFilterSearchQuery && (
                  <button
                    className="project-modal-search-clear"
                    onClick={() => setTagFilterSearchQuery('')}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              <div className="project-modal-list">
                {tags.length === 0 ? (
                  <div className="tag-empty">Keine Tags verfügbar</div>
                ) : (
                  tags
                    .filter(tag => tag.name.toLowerCase().includes(tagFilterSearchQuery.toLowerCase()))
                    .map(tag => (
                    <div
                      key={tag.id}
                      className={`project-modal-item ${selectedTagFilters.includes(tag.id) ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedTagFilters(prev =>
                          prev.includes(tag.id)
                            ? prev.filter(id => id !== tag.id)
                            : [...prev, tag.id]
                        );
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="tag-color-dot" style={{ backgroundColor: tag.color }}></span>
                        <span>{tag.name}</span>
                        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
                          ({tag.image_count || 0})
                        </span>
                      </div>
                      {selectedTagFilters.includes(tag.id) && (
                        <span className="project-modal-checkmark">✓</span>
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="project-modal-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setSelectedTagFilters([])}
                >
                  Alle abwählen
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowTagFilterModal(false)}
                >
                  Fertig
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image Editor */}
      {showEditor && selectedImage && (
        <ImageEditor
          image={selectedImage}
          onClose={() => setShowEditor(false)}
        />
      )}

      {/* Custom Notification Popup */}
      {notification && (
        <div className={`drive-notification drive-notification-${notification.type}`}>
          <div className="drive-notification-content">
            <span>{notification.message}</span>
            <button className="drive-notification-close" onClick={() => setNotification(null)}>
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DriveImages;
