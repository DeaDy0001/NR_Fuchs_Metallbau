import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ActivityIndicator, FlatList, Dimensions, Modal, ScrollView, TextInput, Animated,
} from 'react-native';
import { useDialog } from '../components/CustomDialog';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { addToUploadQueue, getCachedProjects, addPendingProject } from '../services/database';
import { createProject } from '../services/api';
import { processUploadQueue } from '../services/uploadQueue';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function CameraScreen({ navigation, route }) {
  const { alert } = useDialog();
  const { refreshQueueCount } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [capturedImages, setCapturedImages] = useState([]);
  const [facing, setFacing] = useState('back');
  const [toast, setToast] = useState(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const [flash, setFlash] = useState('off');
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [locationPermission, setLocationPermission] = useState(null);
  const cameraRef = useRef(null);

  // Project assignment
  const [projectId, setProjectId] = useState(route.params?.projectId || null);
  const [projectName, setProjectName] = useState(route.params?.projectName || null);
  const [projectFolderId, setProjectFolderId] = useState(route.params?.projectFolderId || null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projects, setProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  // Preview gallery
  const [showPreviewGallery, setShowPreviewGallery] = useState(false);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);

  // Load projects for picker
  const loadProjects = async () => {
    try {
      const p = await getCachedProjects();
      setProjects(p);
    } catch {}
  };

  const openProjectPicker = () => {
    loadProjects();
    setNewProjectName('');
    setShowProjectPicker(true);
  };

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

          <TouchableOpacity
            style={[styles.projectPickerItem, !projectId && styles.projectPickerItemActive]}
            onPress={() => selectProject(null)}
          >
            <Ionicons name="close-circle-outline" size={20} color={colors.textTertiary} />
            <Text style={styles.projectPickerText}>Kein Projekt</Text>
          </TouchableOpacity>

          <ScrollView style={styles.projectPickerList}>
            {projects.map(p => (
              <TouchableOpacity
                key={p.id}
                style={[
                  styles.projectPickerItem,
                  projectId === p.id && styles.projectPickerItemActive,
                ]}
                onPress={() => selectProject(p)}
              >
                <View style={[styles.projectPickerColor, { backgroundColor: p.color || colors.accent }]} />
                <Text style={styles.projectPickerText}>{p.folder_name}</Text>
                <Text style={styles.projectPickerMeta}>{p.image_count || 0} Bilder</Text>
              </TouchableOpacity>
            ))}
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
  // Must be done in foreground context, not in background queue
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
      return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        altitude: location.coords.altitude,
        accuracy: location.coords.accuracy,
      };
    } catch {
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
      setCapturedImages(prev => [...prev, ...newImages]);
    } else if (route.params?.pickFromGallery && capturedImages.length === 0) {
      navigation.goBack();
    }
  };

  const takePicture = async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        exif: true,
      });

      const gpsData = await getCurrentLocation();

      const newImage = {
        uri: photo.uri,
        fileName: `photo_${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        width: photo.width,
        height: photo.height,
        exif: photo.exif,
        gps: gpsData,
      };

      setCapturedImages(prev => [...prev, newImage]);
    } catch (error) {
      alert('Fehler', 'Foto konnte nicht aufgenommen werden.');
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
      // Always add to queue - non-blocking
      for (const img of capturedImages) {
        await addToUploadQueue(
          img.uri, img.fileName, img.mimeType,
          projectId, projectName, projectFolderId,
          img.gps ? JSON.stringify(img.gps) : null
        );
      }

      await refreshQueueCount();

      // Clear images and go back to camera view
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

        {/* Action bar - single row with icons */}
        <View style={styles.previewActionBar}>
          {/* Discard */}
          <TouchableOpacity style={styles.previewActionBtn} onPress={removeAllImages}>
            <Ionicons name="trash-outline" size={24} color={colors.error} />
            <Text style={[styles.previewActionLabel, { color: colors.error }]}>Verwerfen</Text>
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

          {/* More photos */}
          <TouchableOpacity style={styles.previewActionBtn} onPress={() => setShowPreviewGallery(false)}>
            <Ionicons name="camera-outline" size={24} color={colors.textSecondary} />
            <Text style={styles.previewActionLabel}>Weitere</Text>
          </TouchableOpacity>

          {/* Upload / Queue */}
          <TouchableOpacity
            style={styles.previewActionBtnSend}
            onPress={handleUpload}
          >
            <Ionicons name="send" size={24} color="white" />
            <Text style={styles.previewActionLabelSend}>
              Senden{capturedImages.length > 1 ? ` (${capturedImages.length})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Project Picker Modal */}
        {renderProjectPicker()}
      </View>
    );
  }

  // ---- Captured images bar (shown in camera view when images exist) ----
  const renderCapturedBar = () => {
    if (capturedImages.length === 0) return null;
    return (
      <TouchableOpacity
        style={styles.capturedBar}
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
          <TouchableOpacity
            style={styles.capturedBarAction}
            onPress={() => {
              setSelectedPreviewIndex(capturedImages.length - 1);
              setShowPreviewGallery(true);
            }}
          >
            <Text style={styles.capturedBarActionText}>Ansehen</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.accent} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  if (!permission) {
    return <View style={styles.container}><ActivityIndicator color={colors.accent} /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Ionicons name="camera-outline" size={64} color={colors.textTertiary} />
        <Text style={styles.permissionText}>Kamera-Zugriff erforderlich</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Zugriff erlauben</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        flash={flash}
        shutterSound={false}
      />

      {/* Overlay on top of camera */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.topButton} onPress={() => navigation.goBack()}>
            <Ionicons name="close" size={28} color="white" />
          </TouchableOpacity>

          <View style={styles.topRight}>
            {/* GPS toggle */}
            <TouchableOpacity
              style={[styles.topButton, gpsEnabled && styles.topButtonActive]}
              onPress={() => {
                if (!gpsEnabled) {
                  enableGps();
                } else {
                  setGpsEnabled(false);
                }
              }}
            >
              <Ionicons
                name={gpsEnabled ? 'location' : 'location-outline'}
                size={22}
                color={gpsEnabled ? '#22c55e' : '#999'}
              />
            </TouchableOpacity>

            {/* Flash toggle */}
            <TouchableOpacity
              style={styles.topButton}
              onPress={() => setFlash(f => f === 'off' ? 'on' : f === 'on' ? 'auto' : 'off')}
            >
              <Ionicons
                name={flash === 'off' ? 'flash-off' : flash === 'auto' ? 'flash' : 'flash'}
                size={24}
                color={flash === 'off' ? '#999' : '#ffd700'}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Project indicator */}
        {projectName && (
          <TouchableOpacity style={styles.projectIndicator} onPress={openProjectPicker}>
            <Ionicons name="folder" size={14} color={colors.accent} />
            <Text style={styles.projectIndicatorText}>{projectName}</Text>
            <Ionicons name="chevron-down" size={14} color="white" />
          </TouchableOpacity>
        )}

        {/* Captured images bar */}
        {renderCapturedBar()}

        {/* Bottom controls */}
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.galleryButton} onPress={pickFromGallery}>
            <Ionicons name="images" size={28} color="white" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
            <View style={styles.captureInner} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.flipButton}
            onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}
          >
            <Ionicons name="camera-reverse" size={28} color="white" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Project Picker Modal */}
      {renderProjectPicker()}

      {/* Toast notification - dismissable by touch */}
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
  container: { flex: 1, backgroundColor: colors.bgPrimary, alignItems: 'center', justifyContent: 'center', gap: 16 },
  cameraContainer: { flex: 1, backgroundColor: 'black' },
  camera: { flex: 1 },

  // Top bar
  topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 48, paddingHorizontal: 20 },
  topRight: { flexDirection: 'row', gap: 10 },
  topButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  topButtonActive: { backgroundColor: 'rgba(34, 197, 94, 0.3)' },

  // Project indicator
  projectIndicator: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginTop: 12 },
  projectIndicatorText: { color: 'white', fontSize: 13, fontWeight: '500' },

  // Captured images bar
  capturedBar: {
    position: 'absolute', bottom: 100, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 12, padding: 10,
  },
  capturedBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  capturedBarThumb: { width: 40, height: 40, borderRadius: 6 },
  capturedBarText: { color: 'white', fontSize: 14, fontWeight: '500' },
  capturedBarRight: { flexDirection: 'row', alignItems: 'center' },
  capturedBarAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  capturedBarActionText: { color: colors.accent, fontSize: 14, fontWeight: '500' },

  // Bottom bar
  bottomBar: { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 40 },
  captureButton: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: 'white', padding: 4 },
  captureInner: { flex: 1, borderRadius: 34, backgroundColor: 'white' },
  galleryButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  flipButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },

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

  // Permission
  permissionText: { color: colors.textPrimary, fontSize: 16 },
  permissionButton: { backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  permissionButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },

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
