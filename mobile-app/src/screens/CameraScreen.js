import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ActivityIndicator, FlatList, Dimensions, Modal, ScrollView, TextInput, Animated,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useDialog } from '../components/CustomDialog';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { addToUploadQueue, getCachedProjects, getPendingProjects, addPendingProject, getSetting } from '../services/database';
import { createProject } from '../services/api';
import { processUploadQueue } from '../services/uploadQueue';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function CameraScreen({ navigation, route }) {
  const { alert } = useDialog();
  const { refreshQueueCount } = useApp();
  const [capturedImages, setCapturedImages] = useState([]);
  const [toast, setToast] = useState(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [locationPermission, setLocationPermission] = useState(null);
  const metadataInputRef = useRef(null);

  // Project assignment
  const [projectId, setProjectId] = useState(route.params?.projectId || null);
  const [projectName, setProjectName] = useState(route.params?.projectName || null);
  const [projectFolderId, setProjectFolderId] = useState(route.params?.projectFolderId || null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projects, setProjects] = useState([]);
  const [pendingProjects, setPendingProjects] = useState([]);
  const [projectSearchText, setProjectSearchText] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  // Preview gallery
  const [showPreviewGallery, setShowPreviewGallery] = useState(false);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);

  // Per-image metadata editing
  const [editingField, setEditingField] = useState(null); // 'title' | 'notes' | null
  const [editFieldValue, setEditFieldValue] = useState('');

  // Load projects for picker
  const loadProjects = async () => {
    try {
      const [cached, pending] = await Promise.all([getCachedProjects(), getPendingProjects()]);
      setProjects(cached);
      setPendingProjects(pending);
    } catch {}
  };

  const openProjectPicker = () => {
    loadProjects();
    setNewProjectName('');
    setProjectSearchText('');
    setShowProjectPicker(true);
  };

  // Combine cached and pending projects, filter by search
  const allProjects = [
    ...projects,
    ...pendingProjects
      .filter(pp => !projects.some(p => p.folder_id === pp.folder_id))
      .map(pp => ({
        id: pp.folder_id || `pending_${pp.id}`,
        folder_name: pp.folder_name,
        folder_id: pp.folder_id,
        color: '#6b7280',
        image_count: 0,
        isPending: true,
      })),
  ];

  const filteredPickerProjects = allProjects.filter(p => {
    if (!projectSearchText) return true;
    return p.folder_name.toLowerCase().includes(projectSearchText.toLowerCase());
  });

  const selectProject = (project) => {
    if (project) {
      setProjectId(project.id);
      setProjectName(project.folder_name);
      setProjectFolderId(project.folder_id);
    } else {
      setProjectId(null);
      setProjectName(null);
      setProjectFolderId(null);
    }
    setShowProjectPicker(false);
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;

    setCreatingProject(true);
    try {
      const result = await createProject(name);
      // Also add as pending project so it shows as "Unbestätigt" in Projekte tab
      await addPendingProject(name, result.folder_id);
      selectProject({
        id: result.id,
        folder_name: result.folder_name,
        folder_id: result.folder_id,
      });
      setNewProjectName('');
    } catch (error) {
      alert('Fehler', 'Projekt konnte nicht erstellt werden: ' + error.message);
    } finally {
      setCreatingProject(false);
    }
  };

  // ---- Project Picker Modal ----
  const renderProjectPicker = () => (
    <Modal
      visible={showProjectPicker}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowProjectPicker(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Projekt zuordnen</Text>
            <TouchableOpacity onPress={() => setShowProjectPicker(false)}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Create new project */}
          <View style={styles.newProjectRow}>
            <TextInput
              style={styles.newProjectInput}
              placeholder="Neues Projekt erstellen..."
              placeholderTextColor={colors.textTertiary}
              value={newProjectName}
              onChangeText={setNewProjectName}
              onSubmitEditing={handleCreateProject}
              returnKeyType="done"
            />
            {newProjectName.trim() ? (
              <TouchableOpacity
                style={styles.newProjectBtn}
                onPress={handleCreateProject}
                disabled={creatingProject}
              >
                {creatingProject ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Ionicons name="add" size={22} color="white" />
                )}
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Search */}
          <View style={styles.pickerSearchContainer}>
            <Ionicons name="search" size={16} color={colors.textTertiary} />
            <TextInput
              style={styles.pickerSearchInput}
              placeholder="Projekt suchen..."
              placeholderTextColor={colors.textTertiary}
              value={projectSearchText}
              onChangeText={setProjectSearchText}
            />
            {projectSearchText ? (
              <TouchableOpacity onPress={() => setProjectSearchText('')}>
                <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity
            style={[styles.projectPickerItem, !projectId && styles.projectPickerItemActive]}
            onPress={() => selectProject(null)}
          >
            <Ionicons name="close-circle-outline" size={20} color={colors.textTertiary} />
            <Text style={styles.projectPickerText}>Kein Projekt</Text>
          </TouchableOpacity>

          <ScrollView style={styles.projectPickerList}>
            {filteredPickerProjects.map(p => (
              <TouchableOpacity
                key={p.id}
                style={[
                  styles.projectPickerItem,
                  projectId === p.id && styles.projectPickerItemActive,
                ]}
                onPress={() => selectProject(p)}
              >
                <View style={[styles.projectPickerColor, { backgroundColor: p.color || colors.accent }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.projectPickerText}>{p.folder_name}</Text>
                  {p.isPending && (
                    <Text style={styles.pendingBadgeText}>Unbestätigt</Text>
                  )}
                </View>
                <Text style={styles.projectPickerMeta}>{p.image_count || 0} Bilder</Text>
              </TouchableOpacity>
            ))}
            {filteredPickerProjects.length === 0 && (
              <Text style={styles.noProjectsHint}>Keine Projekte gefunden</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // If opened with pickFromGallery, open gallery immediately
  useEffect(() => {
    if (route.params?.pickFromGallery) {
      pickFromGallery();
    }
  }, []);

  // Pre-request MediaLibrary permission for "Original behalten" feature
  useEffect(() => {
    MediaLibrary.requestPermissionsAsync().catch(() => {});
  }, []);

  // Check GPS permission on mount
  useEffect(() => {
    checkLocationPermission();
  }, []);

  const checkLocationPermission = async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      setLocationPermission(status);
      if (status === 'granted') {
        setGpsEnabled(true);
      }
    } catch {}
  };

  const enableGps = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationPermission(status);
      if (status === 'granted') {
        setGpsEnabled(true);
      } else {
        alert('GPS nicht verfügbar', 'Standortzugriff wurde nicht erlaubt.');
      }
    } catch (error) {
      alert('Fehler', 'GPS konnte nicht aktiviert werden.');
    }
  };

  const getCurrentLocation = async () => {
    if (!gpsEnabled) return null;
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeout: 5000,
      });
      const { latitude, longitude, altitude, accuracy } = location.coords;
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        console.warn('[Fuchs] Invalid GPS coordinates:', latitude, longitude);
        return null;
      }
      return { latitude, longitude, altitude, accuracy };
    } catch (e) {
      console.log('[Fuchs] GPS error:', e.message);
      return null;
    }
  };

  const pickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: true,
    });

    if (!result.canceled && result.assets?.length > 0) {
      // Get GPS for gallery images too (current position)
      const gpsData = await getCurrentLocation();
      const newImages = result.assets.map(asset => ({
        uri: asset.uri,
        fileName: asset.fileName || `gallery_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
        width: asset.width,
        height: asset.height,
        gps: gpsData,
      }));
      const nextIndex = capturedImages.length;
      setCapturedImages(prev => [...prev, ...newImages]);
      setSelectedPreviewIndex(nextIndex);
      setShowPreviewGallery(true);
    } else if (route.params?.pickFromGallery && capturedImages.length === 0) {
      navigation.goBack();
    }
  };

  // Open native camera - uses the phone's built-in camera app so all native
  // features (focus, zoom, flash, etc.) work out of the box.
  const openNativeCamera = async () => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      exif: true,
    });

    if (!result.canceled && result.assets?.length > 0) {
      const gpsData = await getCurrentLocation();
      const asset = result.assets[0];

      // Extract capture date from EXIF (will be lost during compression)
      let capturedAt = null;
      if (asset.exif) {
        const dateStr = asset.exif.DateTimeOriginal || asset.exif.DateTime || asset.exif.DateTimeDigitized;
        if (dateStr) {
          try {
            // EXIF format: "2024:03:15 14:30:00" → ISO
            const iso = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
            capturedAt = new Date(iso).toISOString();
          } catch {}
        }
      }
      if (!capturedAt) capturedAt = new Date().toISOString();

      const newImage = {
        uri: asset.uri,
        fileName: `photo_${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        width: asset.width,
        height: asset.height,
        exif: asset.exif,
        gps: gpsData,
        capturedAt,
        // The native camera already saves to camera roll - skip our keepOriginal logic
        isFromNativeCamera: true,
      };

      const nextIndex = capturedImages.length;
      setCapturedImages(prev => [...prev, newImage]);
      setSelectedPreviewIndex(nextIndex);
      setShowPreviewGallery(true);
    }
  };

  const removeImage = (index) => {
    setCapturedImages(prev => prev.filter((_, i) => i !== index));
    if (selectedPreviewIndex >= capturedImages.length - 1 && selectedPreviewIndex > 0) {
      setSelectedPreviewIndex(selectedPreviewIndex - 1);
    }
  };

  const removeAllImages = () => {
    alert(
      'Alle Bilder verwerfen?',
      `${capturedImages.length} ${capturedImages.length === 1 ? 'Bild' : 'Bilder'} werden gelöscht.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Alle verwerfen', style: 'destructive', onPress: () => {
          setCapturedImages([]);
          setShowPreviewGallery(false);
        }},
      ]
    );
  };

  // Open an editing field for the current image
  const openEditField = (field) => {
    const currentImage = capturedImages[selectedPreviewIndex];
    if (!currentImage) return;
    if (field === 'title') {
      setEditFieldValue(currentImage.customTitle || currentImage.fileName.replace(/\.[^.]+$/, ''));
    } else {
      setEditFieldValue(currentImage.notes || '');
    }
    setEditingField(field);
  };

  // Save the editing field and close
  const saveEditField = () => {
    if (editingField && capturedImages[selectedPreviewIndex]) {
      setCapturedImages(prev => {
        const updated = [...prev];
        if (editingField === 'title') {
          updated[selectedPreviewIndex] = { ...updated[selectedPreviewIndex], customTitle: editFieldValue.trim() || null };
        } else {
          updated[selectedPreviewIndex] = { ...updated[selectedPreviewIndex], notes: editFieldValue.trim() || null };
        }
        return updated;
      });
    }
    setEditingField(null);
    setEditFieldValue('');
  };

  // Helper to get basename without extension (for display)
  const path = {
    basename: (name, ext) => ext ? name.replace(new RegExp(ext.replace('.', '\\.') + '$'), '') : name,
    extname: (name) => { const m = name.match(/\.[^.]+$/); return m ? m[0] : ''; },
  };

  const showToast = (message) => {
    setToast(message);
    Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setToast(null);
      });
    }, 3000);
  };

  const dismissToast = () => {
    Animated.timing(toastOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setToast(null);
    });
  };

  const handleUpload = async () => {
    if (capturedImages.length === 0) return;

    const count = capturedImages.length;

    try {
      // Save original to gallery - only for gallery picks (not native camera shots,
      // which are already saved by the camera app itself).
      const keepOriginal = (await getSetting('keepOriginal', 'true')) === 'true';
      if (keepOriginal) {
        let { status } = await MediaLibrary.getPermissionsAsync();
        if (status !== 'granted') {
          const result = await MediaLibrary.requestPermissionsAsync();
          status = result.status;
        }
        if (status === 'granted') {
          for (const img of capturedImages) {
            if (img.fileName && img.fileName.startsWith('photo_') && !img.isFromNativeCamera) {
              try { await MediaLibrary.saveToLibraryAsync(img.uri); } catch {}
            }
          }
        }
      }

      // Always add to queue - non-blocking
      for (const img of capturedImages) {
        await addToUploadQueue(
          img.uri, img.fileName, img.mimeType,
          projectId, projectName, projectFolderId,
          img.gps ? JSON.stringify(img.gps) : null,
          false,
          img.customTitle || null,
          img.notes || null,
          img.capturedAt || new Date().toISOString()
        );
      }

      await refreshQueueCount();

      // Clear images and go back to shooter screen
      setCapturedImages([]);
      setShowPreviewGallery(false);

      // Show brief toast notification
      const msg = projectName
        ? `${count} ${count === 1 ? 'Bild wird' : 'Bilder werden'} zu "${projectName}" hochgeladen`
        : `${count} ${count === 1 ? 'Bild wird' : 'Bilder werden'} hochgeladen`;
      showToast(msg);

      // Trigger queue processing in background
      processUploadQueue();
    } catch (error) {
      console.error('Error queuing images:', error);
      showToast('Fehler beim Einreihen: ' + error.message);
    }
  };

  // ---- Preview Gallery (after capturing images) ----
  if (showPreviewGallery && capturedImages.length > 0) {
    const currentImage = capturedImages[selectedPreviewIndex] || capturedImages[0];
    return (
      <View style={styles.previewContainer}>
        {/* Full image display */}
        <Image source={{ uri: currentImage.uri }} style={styles.preview} resizeMode="contain" />

        {/* Image counter */}
        <View style={styles.imageCounter}>
          <Text style={styles.imageCounterText}>
            {selectedPreviewIndex + 1} / {capturedImages.length}
          </Text>
        </View>

        {/* Thumbnail strip */}
        {capturedImages.length > 1 && (
          <View style={styles.thumbStrip}>
            <FlatList
              horizontal
              data={capturedImages}
              keyExtractor={(_, i) => String(i)}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbStripContent}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  style={[styles.thumbItem, index === selectedPreviewIndex && styles.thumbItemActive]}
                  onPress={() => setSelectedPreviewIndex(index)}
                >
                  <Image source={{ uri: item.uri }} style={styles.thumbImage} />
                  <TouchableOpacity
                    style={styles.thumbRemove}
                    onPress={() => removeImage(index)}
                  >
                    <Ionicons name="close-circle" size={18} color={colors.error} />
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        {/* Metadata buttons for current image */}
        <View style={styles.metadataBar}>
          <TouchableOpacity
            style={[styles.metadataBtn, currentImage.customTitle && styles.metadataBtnActive]}
            onPress={() => openEditField('title')}
          >
            <Ionicons name="pencil-outline" size={18} color={currentImage.customTitle ? colors.accent : colors.textSecondary} />
            <Text
              style={[styles.metadataBtnText, currentImage.customTitle && { color: colors.accent }]}
              numberOfLines={1}
            >
              {currentImage.customTitle || 'Titel'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.metadataBtn, currentImage.notes && styles.metadataBtnActive]}
            onPress={() => openEditField('notes')}
          >
            <Ionicons name="document-text-outline" size={18} color={currentImage.notes ? colors.accent : colors.textSecondary} />
            <Text
              style={[styles.metadataBtnText, currentImage.notes && { color: colors.accent }]}
              numberOfLines={1}
            >
              {currentImage.notes || 'Notizen'}
            </Text>
          </TouchableOpacity>

          {currentImage.gps && (
            <View style={styles.metadataGpsBadge}>
              <Ionicons name="location" size={14} color={colors.success || '#22c55e'} />
              <Text style={styles.metadataGpsText}>GPS</Text>
            </View>
          )}
        </View>

        {/* Metadata editing modal – Notizen: Vollbild, Titel: Bottom-Sheet */}
        {editingField === 'notes' && (
          <Modal
            animationType="slide"
            onShow={() => { setTimeout(() => metadataInputRef.current?.focus(), 300); }}
          >
            <View style={styles.notesFullScreen}>
              <View style={styles.notesFullScreenHeader}>
                <Text style={styles.notesFullScreenTitle}>Notizen</Text>
                <TouchableOpacity onPress={saveEditField} style={styles.notesFullScreenSave}>
                  <Ionicons name="checkmark-circle" size={28} color={colors.accent} />
                </TouchableOpacity>
              </View>
              <TextInput
                ref={metadataInputRef}
                style={styles.notesFullScreenInput}
                value={editFieldValue}
                onChangeText={setEditFieldValue}
                placeholder="Notizen eingeben..."
                placeholderTextColor={colors.textTertiary}
                autoFocus
                multiline
                textAlignVertical="top"
              />
            </View>
          </Modal>
        )}

        {editingField === 'title' && (
          <Modal
            transparent
            animationType="slide"
            onShow={() => { setTimeout(() => metadataInputRef.current?.focus(), 300); }}
          >
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
              <TouchableOpacity style={styles.metadataModalOverlay} activeOpacity={1} onPress={saveEditField}>
                <View style={styles.metadataModalContent} onStartShouldSetResponder={() => true}>
                  <View style={styles.metadataModalHeader}>
                    <Text style={styles.metadataModalTitle}>Bild-Titel</Text>
                    <TouchableOpacity onPress={saveEditField}>
                      <Ionicons name="checkmark-circle" size={28} color={colors.accent} />
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    ref={metadataInputRef}
                    style={styles.metadataModalInput}
                    value={editFieldValue}
                    onChangeText={setEditFieldValue}
                    placeholder="Bildname eingeben..."
                    placeholderTextColor={colors.textTertiary}
                    autoFocus
                    selectTextOnFocus
                    returnKeyType="done"
                    onSubmitEditing={saveEditField}
                  />
                </View>
              </TouchableOpacity>
            </KeyboardAvoidingView>
          </Modal>
        )}

        {/* Action bar - single row with icons */}
        <View style={styles.previewActionBar}>
          {/* Discard */}
          <TouchableOpacity style={styles.previewActionBtn} onPress={removeAllImages}>
            <Ionicons name="trash-outline" size={24} color={colors.error} />
            <Text style={styles.previewActionLabel}>Verwerfen</Text>
          </TouchableOpacity>

          {/* Add more (opens native camera again) */}
          <TouchableOpacity style={styles.previewActionBtn} onPress={() => {
            setShowPreviewGallery(false);
            // openNativeCamera will re-open camera and add to existing list
            setTimeout(openNativeCamera, 100);
          }}>
            <Ionicons name="camera-outline" size={24} color={colors.textSecondary} />
            <Text style={styles.previewActionLabel}>Weiteres Foto</Text>
          </TouchableOpacity>

          {/* Project */}
          <TouchableOpacity style={styles.previewActionBtn} onPress={openProjectPicker}>
            <Ionicons
              name={projectName ? 'folder' : 'folder-outline'}
              size={24}
              color={projectName ? colors.accent : colors.textSecondary}
            />
            <Text style={[styles.previewActionLabel, projectName && { color: colors.accent }]} numberOfLines={1}>
              {projectName || 'Projekt'}
            </Text>
          </TouchableOpacity>

          {/* Upload */}
          <TouchableOpacity style={styles.previewActionBtnSend} onPress={handleUpload}>
            <Ionicons name="cloud-upload-outline" size={24} color="white" />
            <Text style={styles.previewActionLabelSend}>
              {capturedImages.length === 1 ? '1 Bild' : `${capturedImages.length} Bilder`}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Project Picker Modal */}
        {renderProjectPicker()}
      </View>
    );
  }

  // ---- Shooter home screen ----
  return (
    <View style={styles.shooterContainer}>
      {/* Header */}
      <View style={styles.shooterHeader}>
        <TouchableOpacity style={styles.shooterHeaderLeft} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          <Text style={styles.shooterHeaderBack}>Zurück</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.gpsBtn, gpsEnabled && styles.gpsBtnActive]}
          onPress={() => gpsEnabled ? setGpsEnabled(false) : enableGps()}
        >
          <Ionicons
            name={gpsEnabled ? 'location' : 'location-outline'}
            size={20}
            color={gpsEnabled ? '#22c55e' : colors.textTertiary}
          />
          <Text style={[styles.gpsBtnText, gpsEnabled && styles.gpsBtnTextActive]}>GPS</Text>
        </TouchableOpacity>
      </View>

      {/* Body */}
      <View style={styles.shooterBody}>
        {/* Project selector */}
        <TouchableOpacity style={styles.shooterProjectBtn} onPress={openProjectPicker}>
          <Ionicons
            name="folder-outline"
            size={18}
            color={projectName ? colors.accent : colors.textTertiary}
          />
          <Text style={projectName ? styles.shooterProjectName : styles.shooterProjectText}>
            {projectName || 'Kein Projekt gewählt'}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.textTertiary} />
        </TouchableOpacity>

        {/* Camera button */}
        <TouchableOpacity style={styles.shooterCameraBtn} onPress={openNativeCamera} activeOpacity={0.8}>
          <Ionicons name="camera" size={56} color="white" />
        </TouchableOpacity>
        <Text style={styles.shooterCameraHint}>Tippen zum Fotografieren</Text>

        {/* Gallery button */}
        <TouchableOpacity style={styles.shooterGalleryBtn} onPress={pickFromGallery}>
          <Ionicons name="images-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.shooterGalleryText}>Galerie öffnen</Text>
        </TouchableOpacity>
      </View>

      {/* Captured images bar (visible after taking photos, before uploading) */}
      {capturedImages.length > 0 && (
        <TouchableOpacity
          style={styles.capturedBarStatic}
          onPress={() => {
            setSelectedPreviewIndex(capturedImages.length - 1);
            setShowPreviewGallery(true);
          }}
        >
          <View style={styles.capturedBarLeft}>
            <Image
              source={{ uri: capturedImages[capturedImages.length - 1].uri }}
              style={styles.capturedBarThumb}
            />
            <Text style={styles.capturedBarText}>
              {capturedImages.length} {capturedImages.length === 1 ? 'Foto' : 'Fotos'}
            </Text>
          </View>
          <View style={styles.capturedBarRight}>
            <Text style={styles.capturedBarActionText}>Ansehen</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.accent} />
          </View>
        </TouchableOpacity>
      )}

      {/* Project Picker Modal */}
      {renderProjectPicker()}

      {/* Toast notification */}
      {toast && (
        <TouchableOpacity
          style={styles.toastTouchArea}
          activeOpacity={1}
          onPress={dismissToast}
        >
          <Animated.View style={[styles.toastContainer, { opacity: toastOpacity }]}>
            <Ionicons name="cloud-upload-outline" size={20} color={colors.accent} />
            <Text style={styles.toastText}>{toast}</Text>
          </Animated.View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // ---- Shooter home screen ----
  shooterContainer: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  shooterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 24 : 56,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  shooterHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  shooterHeaderBack: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '500',
  },
  gpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gpsBtnActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderColor: 'rgba(34, 197, 94, 0.4)',
  },
  gpsBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  gpsBtnTextActive: {
    color: '#22c55e',
  },
  shooterBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  shooterProjectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: '90%',
  },
  shooterProjectText: {
    color: colors.textTertiary,
    fontSize: 14,
    flex: 1,
  },
  shooterProjectName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  shooterCameraBtn: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  shooterCameraHint: {
    color: colors.textTertiary,
    fontSize: 13,
    marginTop: -12,
  },
  shooterGalleryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSecondary,
  },
  shooterGalleryText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '500',
  },

  // Captured images bar (static, not in camera overlay)
  capturedBarStatic: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.cardBg,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  capturedBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  capturedBarThumb: { width: 44, height: 44, borderRadius: 8 },
  capturedBarText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  capturedBarRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  capturedBarAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  capturedBarActionText: { color: colors.accent, fontSize: 14, fontWeight: '500' },

  // Preview container
  previewContainer: { flex: 1, backgroundColor: 'black' },
  preview: { flex: 1 },

  // Image counter overlay
  imageCounter: {
    position: 'absolute', top: 50, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20,
  },
  imageCounterText: { color: 'white', fontSize: 14, fontWeight: '600' },

  // Thumbnail strip
  thumbStrip: { backgroundColor: 'rgba(0,0,0,0.85)', paddingVertical: 8 },
  thumbStripContent: { paddingHorizontal: 12, gap: 8 },
  thumbItem: { width: 56, height: 56, borderRadius: 8, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  thumbItemActive: { borderColor: colors.accent },
  thumbImage: { width: '100%', height: '100%' },
  thumbRemove: { position: 'absolute', top: -4, right: -4 },

  // Action bar - single row of icon buttons
  previewActionBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingHorizontal: 12, paddingTop: 12, paddingBottom: 32,
    backgroundColor: 'rgba(0,0,0,0.9)',
  },
  previewActionBtn: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 12, gap: 4,
  },
  previewActionLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  previewActionBtnSend: {
    alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12, backgroundColor: colors.accent,
  },
  previewActionLabelSend: { fontSize: 11, color: 'white', fontWeight: '600' },

  // Metadata bar (title + notes buttons)
  metadataBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: colors.bgSecondary, borderTopWidth: 1, borderTopColor: colors.border,
  },
  metadataBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: colors.cardBg, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  metadataBtnActive: {
    borderColor: colors.accent, backgroundColor: 'rgba(59,130,246,0.08)',
  },
  metadataBtnText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500', flex: 1 },
  metadataGpsBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: 'rgba(34,197,94,0.1)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)',
  },
  metadataGpsText: { fontSize: 12, color: '#22c55e', fontWeight: '600' },

  // Notizen Vollbild-Editor
  notesFullScreen: {
    flex: 1, backgroundColor: colors.bgPrimary, paddingTop: Platform.OS === 'android' ? 40 : 60,
  },
  notesFullScreenHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  notesFullScreenTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  notesFullScreenSave: { padding: 4 },
  notesFullScreenInput: {
    flex: 1, padding: 20, fontSize: 16, color: colors.textPrimary,
    textAlignVertical: 'top', backgroundColor: colors.bgPrimary,
  },

  // Metadata editing modal (Titel)
  metadataModalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end',
  },
  metadataModalContent: {
    backgroundColor: colors.bgPrimary, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40,
  },
  metadataModalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
  },
  metadataModalTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  metadataModalInput: {
    backgroundColor: colors.inputBg || colors.bgSecondary,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 16, color: colors.textPrimary,
  },

  // Project picker modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.bgPrimary, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  newProjectRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  newProjectInput: {
    flex: 1, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: colors.textPrimary,
  },
  newProjectBtn: {
    width: 42, height: 42, borderRadius: 10,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  pickerSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgTertiary || colors.cardBg,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 8,
  },
  pickerSearchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingVertical: 10,
  },
  pendingBadgeText: {
    fontSize: 11,
    color: '#f59e0b',
    fontWeight: '600',
    marginTop: 2,
  },
  noProjectsHint: {
    color: colors.textTertiary,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
  },
  projectPickerList: { maxHeight: 400 },
  projectPickerItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 10, marginBottom: 6,
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
  },
  projectPickerItemActive: { borderColor: colors.accent, backgroundColor: 'rgba(59,130,246,0.1)' },
  projectPickerColor: { width: 4, height: 28, borderRadius: 2 },
  projectPickerText: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.textPrimary },
  projectPickerMeta: { fontSize: 12, color: colors.textTertiary },

  // Toast notification
  toastTouchArea: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    paddingTop: 54,
    paddingHorizontal: 20,
    zIndex: 999,
  },
  toastContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.3)',
  },
  toastText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
});
