import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Image,
  ActivityIndicator, FlatList, Dimensions, Modal, ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { addToUploadQueue, getCachedProjects } from '../services/database';
import { uploadImage } from '../services/api';
import { processUploadQueue } from '../services/uploadQueue';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function CameraScreen({ navigation, route }) {
  const { isConnected, refreshQueueCount } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [capturedImages, setCapturedImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [facing, setFacing] = useState('back');
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
        Alert.alert('GPS nicht verfügbar', 'Standortzugriff wurde nicht erlaubt.');
      }
    } catch (error) {
      Alert.alert('Fehler', 'GPS konnte nicht aktiviert werden.');
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
      Alert.alert('Fehler', 'Foto konnte nicht aufgenommen werden.');
    }
  };

  const removeImage = (index) => {
    setCapturedImages(prev => prev.filter((_, i) => i !== index));
    if (selectedPreviewIndex >= capturedImages.length - 1 && selectedPreviewIndex > 0) {
      setSelectedPreviewIndex(selectedPreviewIndex - 1);
    }
  };

  const removeAllImages = () => {
    Alert.alert(
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

  const handleUpload = async () => {
    if (capturedImages.length === 0) return;

    setUploading(true);
    let successCount = 0;
    let queueCount = 0;

    try {
      for (const img of capturedImages) {
        if (!isConnected) {
          await addToUploadQueue(
            img.uri, img.fileName, img.mimeType,
            projectId, projectName, projectFolderId,
            img.gps ? JSON.stringify(img.gps) : null
          );
          queueCount++;
        } else {
          try {
            await uploadImage(
              img.uri, img.fileName, img.mimeType,
              projectId, projectName,
              img.gps
            );
            successCount++;
          } catch {
            await addToUploadQueue(
              img.uri, img.fileName, img.mimeType,
              projectId, projectName, projectFolderId,
              img.gps ? JSON.stringify(img.gps) : null
            );
            queueCount++;
          }
        }
      }

      await refreshQueueCount();
      if (queueCount > 0) processUploadQueue();

      const total = capturedImages.length;
      if (successCount === total) {
        Alert.alert('Hochgeladen', `${total} ${total === 1 ? 'Bild wurde' : 'Bilder wurden'} erfolgreich hochgeladen.`);
      } else if (queueCount === total) {
        Alert.alert('In Warteschlange', `${total} ${total === 1 ? 'Bild wurde' : 'Bilder wurden'} in die Warteschlange gelegt.`);
      } else {
        Alert.alert('Teilweise hochgeladen', `${successCount} hochgeladen, ${queueCount} in der Warteschlange.`);
      }

      setCapturedImages([]);
      setShowPreviewGallery(false);
    } catch (error) {
      Alert.alert('Fehler', 'Upload fehlgeschlagen: ' + error.message);
    } finally {
      setUploading(false);
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

        {/* Info bar */}
        <View style={styles.previewInfo}>
          {projectName ? (
            <TouchableOpacity style={styles.projectBadge} onPress={openProjectPicker}>
              <Ionicons name="folder" size={14} color={colors.accent} />
              <Text style={styles.projectBadgeText}>{projectName}</Text>
              <Ionicons name="pencil" size={12} color={colors.textTertiary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.assignProjectButton} onPress={openProjectPicker}>
              <Ionicons name="folder-outline" size={16} color={colors.accent} />
              <Text style={styles.assignProjectText}>Projekt zuordnen</Text>
            </TouchableOpacity>
          )}
          {currentImage.gps && (
            <View style={styles.gpsBadge}>
              <Ionicons name="location" size={12} color={colors.success} />
              <Text style={styles.gpsText}>GPS</Text>
            </View>
          )}
        </View>

        {/* Action buttons - positioned higher */}
        <View style={styles.previewActions}>
          <TouchableOpacity style={styles.discardButton} onPress={removeAllImages}>
            <Ionicons name="trash" size={22} color={colors.error} />
            <Text style={[styles.previewButtonText, { color: colors.error }]}>
              {capturedImages.length > 1 ? 'Alle verwerfen' : 'Verwerfen'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.uploadButton, uploading && styles.buttonDisabled]}
            onPress={handleUpload}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Ionicons name="cloud-upload" size={22} color="white" />
                <Text style={styles.uploadButtonText}>
                  {isConnected ? 'Hochladen' : 'In Warteschlange'}
                  {capturedImages.length > 1 ? ` (${capturedImages.length})` : ''}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Back to camera button */}
        <TouchableOpacity
          style={styles.backToCameraButton}
          onPress={() => setShowPreviewGallery(false)}
        >
          <Ionicons name="camera" size={20} color={colors.accent} />
          <Text style={styles.backToCameraText}>Weitere Fotos</Text>
        </TouchableOpacity>

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

  // Preview info bar
  previewInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, backgroundColor: 'rgba(0,0,0,0.8)' },
  projectBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  projectBadgeText: { color: colors.accent, fontSize: 14, fontWeight: '500' },
  assignProjectButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.accent },
  assignProjectText: { color: colors.accent, fontSize: 13, fontWeight: '500' },
  gpsBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(34,197,94,0.15)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  gpsText: { color: colors.success, fontSize: 11, fontWeight: '600' },

  // Action buttons - raised higher with padding
  previewActions: { flexDirection: 'row', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 12, backgroundColor: 'rgba(0,0,0,0.9)' },
  discardButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.error },
  uploadButton: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 12, backgroundColor: colors.accent },
  buttonDisabled: { opacity: 0.6 },
  previewButtonText: { fontSize: 14, fontWeight: '600' },
  uploadButtonText: { color: 'white', fontSize: 14, fontWeight: '600' },

  // Back to camera button
  backToCameraButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, backgroundColor: 'rgba(0,0,0,0.9)',
  },
  backToCameraText: { color: colors.accent, fontSize: 14, fontWeight: '500' },

  // Permission
  permissionText: { color: colors.textPrimary, fontSize: 16 },
  permissionButton: { backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  permissionButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },

  // Project picker modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.bgPrimary, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
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
});
