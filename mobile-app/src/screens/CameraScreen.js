import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Image, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { addToUploadQueue } from '../services/database';
import { uploadImage } from '../services/api';
import { processUploadQueue } from '../services/uploadQueue';

export default function CameraScreen({ navigation, route }) {
  const { isConnected, refreshQueueCount } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [capturedImage, setCapturedImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [facing, setFacing] = useState('back');
  const [flash, setFlash] = useState('off');
  const cameraRef = useRef(null);

  const projectId = route.params?.projectId || null;
  const projectName = route.params?.projectName || null;

  // If opened with pickFromGallery, open gallery immediately
  useEffect(() => {
    if (route.params?.pickFromGallery) {
      pickFromGallery();
    }
  }, []);

  const pickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: true,
    });

    if (!result.canceled && result.assets?.length > 0) {
      // Handle first image (multi-upload queues the rest)
      setCapturedImage(result.assets[0]);

      // Queue additional images if multiple selected
      if (result.assets.length > 1) {
        for (let i = 1; i < result.assets.length; i++) {
          const asset = result.assets[i];
          const fileName = asset.fileName || `gallery_${Date.now()}_${i}.jpg`;
          await addToUploadQueue(asset.uri, fileName, asset.mimeType || 'image/jpeg', projectId, projectName);
        }
        await refreshQueueCount();
        processUploadQueue();
      }
    } else if (route.params?.pickFromGallery) {
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
      setCapturedImage(photo);
    } catch (error) {
      Alert.alert('Fehler', 'Foto konnte nicht aufgenommen werden.');
    }
  };

  const handleUpload = async () => {
    if (!capturedImage) return;

    const fileName = capturedImage.fileName || `photo_${Date.now()}.jpg`;
    const mimeType = capturedImage.mimeType || 'image/jpeg';

    if (!isConnected) {
      // Queue for later
      await addToUploadQueue(capturedImage.uri, fileName, mimeType, projectId, projectName);
      await refreshQueueCount();
      Alert.alert('In Warteschlange', 'Das Bild wird hochgeladen, sobald eine Verbindung besteht.');
      setCapturedImage(null);
      return;
    }

    setUploading(true);
    try {
      await uploadImage(capturedImage.uri, fileName, mimeType, projectId, projectName);
      Alert.alert('Hochgeladen', 'Bild wurde erfolgreich hochgeladen.');
      setCapturedImage(null);
    } catch (error) {
      // Failed? Queue it
      await addToUploadQueue(capturedImage.uri, fileName, mimeType, projectId, projectName);
      await refreshQueueCount();
      Alert.alert('In Warteschlange', 'Upload fehlgeschlagen. Bild wurde in die Warteschlange gelegt.');
      setCapturedImage(null);
    } finally {
      setUploading(false);
    }
  };

  const handleDiscard = () => {
    setCapturedImage(null);
  };

  // Preview screen after capture
  if (capturedImage) {
    return (
      <View style={styles.previewContainer}>
        <Image source={{ uri: capturedImage.uri }} style={styles.preview} resizeMode="contain" />

        <View style={styles.previewInfo}>
          {projectName && (
            <View style={styles.projectBadge}>
              <Ionicons name="folder" size={14} color={colors.accent} />
              <Text style={styles.projectBadgeText}>{projectName}</Text>
            </View>
          )}
          {!projectName && (
            <Text style={styles.noProjectText}>Kein Projekt zugeordnet</Text>
          )}
        </View>

        <View style={styles.previewActions}>
          <TouchableOpacity style={styles.discardButton} onPress={handleDiscard}>
            <Ionicons name="close" size={24} color={colors.error} />
            <Text style={[styles.previewButtonText, { color: colors.error }]}>Verwerfen</Text>
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
                <Ionicons name="cloud-upload" size={24} color="white" />
                <Text style={styles.uploadButtonText}>
                  {isConnected ? 'Hochladen' : 'In Warteschlange'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

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
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.topButton} onPress={() => navigation.goBack()}>
            <Ionicons name="close" size={28} color="white" />
          </TouchableOpacity>

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

        {/* Project indicator */}
        {projectName && (
          <View style={styles.projectIndicator}>
            <Ionicons name="folder" size={14} color={colors.accent} />
            <Text style={styles.projectIndicatorText}>{projectName}</Text>
          </View>
        )}

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
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  camera: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 48,
    paddingHorizontal: 20,
  },
  topButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 12,
  },
  projectIndicatorText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '500',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 40,
  },
  captureButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: 'white',
    padding: 4,
  },
  captureInner: {
    flex: 1,
    borderRadius: 34,
    backgroundColor: 'white',
  },
  galleryButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Preview
  previewContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  preview: {
    flex: 1,
  },
  previewInfo: {
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  projectBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  projectBadgeText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '500',
  },
  noProjectText: {
    color: colors.textTertiary,
    fontSize: 13,
  },
  previewActions: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
    backgroundColor: 'rgba(0,0,0,0.9)',
  },
  discardButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
  },
  uploadButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  previewButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  uploadButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  permissionText: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  permissionButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  permissionButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
});
