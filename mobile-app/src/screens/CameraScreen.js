import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView,
  FlatList, Modal, TextInput, Animated, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useDialog } from '../components/CustomDialog';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import {
  addToUploadQueue, getCachedProjects, getPendingProjects, addPendingProject, getSetting,
  getWorkspaceImages, addWorkspaceImage, updateWorkspaceImage, removeWorkspaceImage,
  getWorkspaceSession, saveWorkspaceSession, clearWorkspace,
} from '../services/database';
import { createProject } from '../services/api';
import { processUploadQueue } from '../services/uploadQueue';

// ─── Screen States ────────────────────────────────────────────────────────────
// SHOOTER  : default – GPS toggle, camera button, gallery button
// CONFIRM  : full-screen photo preview with X / ✓
// WORKSPACE: list of all captured photos with inline editing + project notes
// ─────────────────────────────────────────────────────────────────────────────

export default function CameraScreen({ navigation, route }) {
  const { alert } = useDialog();
  const { refreshQueueCount } = useApp();

  // ── Screen state machine ──────────────────────────────────────────────────
  const [screenState, setScreenState] = useState('SHOOTER'); // 'SHOOTER' | 'CONFIRM' | 'WORKSPACE'

  // ── GPS ───────────────────────────────────────────────────────────────────
  const [gpsEnabled, setGpsEnabled] = useState(false);

  // ── CONFIRM state ─────────────────────────────────────────────────────────
  const [pendingPhoto, setPendingPhoto] = useState(null); // { uri, file_name, mime_type, gps_data, captured_at }

  // ── WORKSPACE state ───────────────────────────────────────────────────────
  const [workspaceImages, setWorkspaceImages] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [projectName, setProjectName] = useState(null);
  const [projectFolderId, setProjectFolderId] = useState(null);
  const [projectNotes, setProjectNotes] = useState('');
  const sessionSaveTimer = useRef(null);

  // ── Project picker ────────────────────────────────────────────────────────
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [pickerProjects, setPickerProjects] = useState([]);
  const [pickerPending, setPickerPending] = useState([]);
  const [pickerSearch, setPickerSearch] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  // ── Image editing modal ───────────────────────────────────────────────────
  const [editingImage, setEditingImage] = useState(null);  // workspace image row
  const [editField, setEditField] = useState(null);        // 'title' | 'notes'
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef(null);

  // ── Toast ─────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  // ── Uploading indicator ───────────────────────────────────────────────────
  const [uploading, setUploading] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle: load workspace from SQLite when tab gains focus
  // ─────────────────────────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      loadWorkspace();
      // If another screen passes a preset project (e.g. ProjectDetailScreen)
      if (route.params?.presetProject) {
        const p = route.params.presetProject;
        setProjectId(p.id);
        setProjectName(p.name);
        setProjectFolderId(p.folderId);
        navigation.setParams({ presetProject: null });
      }
    }, [route.params?.presetProject])
  );

  useEffect(() => {
    MediaLibrary.requestPermissionsAsync().catch(() => {});
    checkLocationPermission();
  }, []);

  const loadWorkspace = async () => {
    const [imgs, session] = await Promise.all([getWorkspaceImages(), getWorkspaceSession()]);
    setWorkspaceImages(imgs);
    if (session) {
      setProjectId(session.project_id || null);
      setProjectName(session.project_name || null);
      setProjectFolderId(session.project_folder_id || null);
      setProjectNotes(session.project_notes || '');
    }
    if (imgs.length > 0 && screenState === 'SHOOTER') {
      setScreenState('WORKSPACE');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // GPS
  // ─────────────────────────────────────────────────────────────────────────
  const checkLocationPermission = async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') setGpsEnabled(true);
    } catch {}
  };

  const toggleGps = async () => {
    if (gpsEnabled) { setGpsEnabled(false); return; }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') setGpsEnabled(true);
      else alert('GPS nicht verfügbar', 'Standortzugriff wurde nicht erlaubt.');
    } catch { alert('Fehler', 'GPS konnte nicht aktiviert werden.'); }
  };

  const getCurrentLocation = async () => {
    if (!gpsEnabled) return null;
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, timeout: 5000 });
      const { latitude, longitude, altitude, accuracy } = loc.coords;
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
      return JSON.stringify({ latitude, longitude, altitude, accuracy });
    } catch { return null; }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Camera
  // ─────────────────────────────────────────────────────────────────────────
  const openNativeCamera = async () => {
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: true });

    if (!result.canceled && result.assets?.length > 0) {
      const asset = result.assets[0];
      const gps_data = await getCurrentLocation();
      let capturedAt = null;
      if (asset.exif) {
        const ds = asset.exif.DateTimeOriginal || asset.exif.DateTime || asset.exif.DateTimeDigitized;
        if (ds) {
          try { capturedAt = new Date(ds.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T')).toISOString(); } catch {}
        }
      }
      setPendingPhoto({
        uri: asset.uri,
        file_name: `photo_${Date.now()}.jpg`,
        mime_type: 'image/jpeg',
        gps_data,
        captured_at: capturedAt || new Date().toISOString(),
      });
      setScreenState('CONFIRM');
    } else {
      // User cancelled native camera
      const imgs = await getWorkspaceImages();
      setWorkspaceImages(imgs);
      setScreenState(imgs.length > 0 ? 'WORKSPACE' : 'SHOOTER');
    }
  };

  const handleConfirm = async (keep) => {
    if (keep && pendingPhoto) {
      const id = await addWorkspaceImage(pendingPhoto);
      // Save to gallery if keepOriginal enabled (native camera shots need explicit save on some devices)
      try {
        const keepOrig = (await getSetting('keepOriginal', 'true')) === 'true';
        if (keepOrig) {
          const { status } = await MediaLibrary.getPermissionsAsync();
          if (status === 'granted') await MediaLibrary.saveToLibraryAsync(pendingPhoto.uri).catch(() => {});
        }
      } catch {}
      setPendingPhoto(null);
      // Immediately open camera again
      setScreenState('SHOOTER'); // intermediate so launchCameraAsync has a clean state
      await openNativeCamera();
    } else {
      // Discard
      setPendingPhoto(null);
      const imgs = await getWorkspaceImages();
      setWorkspaceImages(imgs);
      setScreenState(imgs.length > 0 ? 'WORKSPACE' : 'SHOOTER');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Gallery picker
  // ─────────────────────────────────────────────────────────────────────────
  const pickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: true });
    if (!result.canceled && result.assets?.length > 0) {
      const gps_data = await getCurrentLocation();
      for (const asset of result.assets) {
        await addWorkspaceImage({
          uri: asset.uri,
          file_name: asset.fileName || `gallery_${Date.now()}.jpg`,
          mime_type: asset.mimeType || 'image/jpeg',
          gps_data,
          captured_at: new Date().toISOString(),
        });
      }
      const imgs = await getWorkspaceImages();
      setWorkspaceImages(imgs);
      setScreenState('WORKSPACE');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Project picker
  // ─────────────────────────────────────────────────────────────────────────
  const openProjectPicker = async () => {
    const [cached, pending] = await Promise.all([getCachedProjects(), getPendingProjects()]);
    setPickerProjects(cached);
    setPickerPending(pending);
    setPickerSearch('');
    setNewProjectName('');
    setShowProjectPicker(true);
  };

  const selectProject = async (project) => {
    const id = project?.id ?? null;
    const name = project?.folder_name ?? null;
    const folderId = project?.folder_id ?? null;
    setProjectId(id);
    setProjectName(name);
    setProjectFolderId(folderId);
    setShowProjectPicker(false);
    await persistSession({ project_id: id, project_name: name, project_folder_id: folderId });
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    setCreatingProject(true);
    try {
      const result = await createProject(name);
      await addPendingProject(name, result.folder_id);
      await selectProject({ id: result.id, folder_name: result.folder_name, folder_id: result.folder_id });
      setNewProjectName('');
    } catch (e) {
      alert('Fehler', 'Projekt konnte nicht erstellt werden: ' + e.message);
    } finally { setCreatingProject(false); }
  };

  const allPickerProjects = [
    ...pickerProjects,
    ...pickerPending
      .filter(pp => !pickerProjects.some(p => p.folder_id === pp.folder_id))
      .map(pp => ({ id: pp.folder_id || `pending_${pp.id}`, folder_name: pp.folder_name, folder_id: pp.folder_id, color: '#6b7280', image_count: 0, isPending: true })),
  ].filter(p => !pickerSearch || p.folder_name.toLowerCase().includes(pickerSearch.toLowerCase()));

  // ─────────────────────────────────────────────────────────────────────────
  // Session persistence (debounced for notes typing)
  // ─────────────────────────────────────────────────────────────────────────
  const persistSession = async (overrides = {}) => {
    await saveWorkspaceSession({
      project_id: projectId,
      project_name: projectName,
      project_folder_id: projectFolderId,
      project_notes: projectNotes,
      ...overrides,
    });
  };

  const handleProjectNotesChange = (text) => {
    setProjectNotes(text);
    if (sessionSaveTimer.current) clearTimeout(sessionSaveTimer.current);
    sessionSaveTimer.current = setTimeout(() => persistSession({ project_notes: text }), 800);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Image editing
  // ─────────────────────────────────────────────────────────────────────────
  const openEditModal = (img, field) => {
    setEditingImage(img);
    setEditField(field);
    setEditValue(field === 'title' ? (img.custom_title || img.file_name.replace(/\.[^.]+$/, '')) : (img.notes || ''));
  };

  const saveEditModal = async () => {
    if (!editingImage) return;
    const updates = editField === 'title'
      ? { custom_title: editValue.trim() || null, notes: editingImage.notes }
      : { custom_title: editingImage.custom_title, notes: editValue.trim() || null };
    await updateWorkspaceImage(editingImage.id, updates);
    setWorkspaceImages(prev => prev.map(img => img.id === editingImage.id ? { ...img, ...updates } : img));
    setEditingImage(null);
    setEditField(null);
    setEditValue('');
  };

  const handleRemoveImage = async (img) => {
    alert(
      'Foto löschen?',
      img.custom_title || img.file_name,
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Löschen', style: 'destructive', onPress: async () => {
          await removeWorkspaceImage(img.id);
          const remaining = workspaceImages.filter(i => i.id !== img.id);
          setWorkspaceImages(remaining);
          if (remaining.length === 0) setScreenState('SHOOTER');
        }},
      ]
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Upload / clear workspace
  // ─────────────────────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (workspaceImages.length === 0) return;
    setUploading(true);
    try {
      for (const img of workspaceImages) {
        await addToUploadQueue(
          img.uri, img.file_name, img.mime_type,
          projectId, projectName, projectFolderId,
          img.gps_data,
          false,
          img.custom_title || null,
          img.notes || null,
          img.captured_at || new Date().toISOString()
        );
      }
      // Save project notes as meta change if project is selected
      if (projectId && projectFolderId && projectNotes.trim()) {
        // (meta_change_queue handled by existing sync logic)
      }
      await clearWorkspace();
      setWorkspaceImages([]);
      setProjectId(null); setProjectName(null); setProjectFolderId(null); setProjectNotes('');
      setScreenState('SHOOTER');
      await refreshQueueCount();
      processUploadQueue();
      showToast(`${workspaceImages.length} ${workspaceImages.length === 1 ? 'Bild wird' : 'Bilder werden'} hochgeladen`);
    } catch (e) {
      showToast('Fehler: ' + e.message);
    } finally { setUploading(false); }
  };

  const handleDiscardAll = () => {
    alert(
      'Alle Fotos verwerfen?',
      `${workspaceImages.length} ${workspaceImages.length === 1 ? 'Foto' : 'Fotos'} und alle Notizen werden gelöscht.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Alles löschen', style: 'destructive', onPress: async () => {
          await clearWorkspace();
          setWorkspaceImages([]);
          setProjectId(null); setProjectName(null); setProjectFolderId(null); setProjectNotes('');
          setScreenState('SHOOTER');
        }},
      ]
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Toast
  // ─────────────────────────────────────────────────────────────────────────
  const showToast = (msg) => {
    setToast(msg);
    Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setToast(null));
    }, 3000);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ── RENDER: Project picker modal (shared across states) ───────────────────
  // ─────────────────────────────────────────────────────────────────────────
  const renderProjectPicker = () => (
    <Modal visible={showProjectPicker} animationType="slide" transparent onRequestClose={() => setShowProjectPicker(false)}>
      <View style={s.modalOverlay}>
        <View style={s.modalSheet}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Projekt wählen</Text>
            <TouchableOpacity onPress={() => setShowProjectPicker(false)}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          {/* New project */}
          <View style={s.newProjectRow}>
            <TextInput
              style={s.newProjectInput}
              placeholder="Neues Projekt erstellen..."
              placeholderTextColor={colors.textTertiary}
              value={newProjectName}
              onChangeText={setNewProjectName}
              onSubmitEditing={handleCreateProject}
              returnKeyType="done"
            />
            {newProjectName.trim() ? (
              <TouchableOpacity style={s.newProjectBtn} onPress={handleCreateProject} disabled={creatingProject}>
                {creatingProject ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="add" size={22} color="white" />}
              </TouchableOpacity>
            ) : null}
          </View>
          {/* Search */}
          <View style={s.searchRow}>
            <Ionicons name="search" size={16} color={colors.textTertiary} />
            <TextInput style={s.searchInput} placeholder="Suchen..." placeholderTextColor={colors.textTertiary} value={pickerSearch} onChangeText={setPickerSearch} />
            {pickerSearch ? <TouchableOpacity onPress={() => setPickerSearch('')}><Ionicons name="close-circle" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
          </View>
          {/* No project option */}
          <TouchableOpacity style={[s.pickerItem, !projectId && s.pickerItemActive]} onPress={() => selectProject(null)}>
            <Ionicons name="close-circle-outline" size={20} color={colors.textTertiary} />
            <Text style={s.pickerItemText}>Kein Projekt</Text>
          </TouchableOpacity>
          <ScrollView style={{ maxHeight: 380 }}>
            {allPickerProjects.map(p => (
              <TouchableOpacity key={p.id} style={[s.pickerItem, projectId === p.id && s.pickerItemActive]} onPress={() => selectProject(p)}>
                <View style={[s.pickerDot, { backgroundColor: p.color || colors.accent }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.pickerItemText}>{p.folder_name}</Text>
                  {p.isPending && <Text style={s.pendingLabel}>Unbestätigt</Text>}
                </View>
                <Text style={s.pickerMeta}>{p.image_count || 0} Bilder</Text>
              </TouchableOpacity>
            ))}
            {allPickerProjects.length === 0 && <Text style={s.emptyHint}>Keine Projekte gefunden</Text>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ── RENDER: Edit modal (title / notes)  ───────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────
  const renderEditModal = () => {
    if (!editingImage || !editField) return null;
    const isNotes = editField === 'notes';
    if (isNotes) {
      return (
        <Modal animationType="slide" onShow={() => setTimeout(() => editInputRef.current?.focus(), 300)}>
          <View style={s.notesFullScreen}>
            <View style={s.notesHeader}>
              <TouchableOpacity onPress={() => { setEditingImage(null); setEditField(null); }}>
                <Ionicons name="close" size={26} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={s.notesTitle}>Notizen</Text>
              <TouchableOpacity onPress={saveEditModal}>
                <Ionicons name="checkmark-circle" size={28} color={colors.accent} />
              </TouchableOpacity>
            </View>
            <TextInput
              ref={editInputRef}
              style={s.notesInput}
              value={editValue}
              onChangeText={setEditValue}
              placeholder="Notizen eingeben..."
              placeholderTextColor={colors.textTertiary}
              autoFocus multiline textAlignVertical="top"
            />
          </View>
        </Modal>
      );
    }
    return (
      <Modal transparent animationType="slide" onShow={() => setTimeout(() => editInputRef.current?.focus(), 300)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={s.titleModalOverlay} activeOpacity={1} onPress={saveEditModal}>
            <View style={s.titleModalSheet} onStartShouldSetResponder={() => true}>
              <View style={s.titleModalHeader}>
                <Text style={s.titleModalTitle}>Foto-Titel</Text>
                <TouchableOpacity onPress={saveEditModal}><Ionicons name="checkmark-circle" size={28} color={colors.accent} /></TouchableOpacity>
              </View>
              <TextInput
                ref={editInputRef}
                style={s.titleInput}
                value={editValue}
                onChangeText={setEditValue}
                placeholder="Titel eingeben..."
                placeholderTextColor={colors.textTertiary}
                autoFocus selectTextOnFocus returnKeyType="done" onSubmitEditing={saveEditModal}
              />
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ── STATE: CONFIRM ────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────
  if (screenState === 'CONFIRM' && pendingPhoto) {
    return (
      <View style={s.confirmContainer}>
        <Image source={{ uri: pendingPhoto.uri }} style={s.confirmImage} resizeMode="contain" />
        <View style={s.confirmBar}>
          <TouchableOpacity style={s.confirmBtnDiscard} onPress={() => handleConfirm(false)}>
            <Ionicons name="close" size={32} color="white" />
            <Text style={s.confirmBtnLabel}>Verwerfen</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.confirmBtnKeep} onPress={() => handleConfirm(true)}>
            <Ionicons name="checkmark" size={32} color="white" />
            <Text style={s.confirmBtnLabel}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ── STATE: WORKSPACE ──────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────
  if (screenState === 'WORKSPACE') {
    return (
      <View style={s.container}>
        {/* Header */}
        <View style={s.wsHeader}>
          <Text style={s.wsHeaderTitle}>{workspaceImages.length} {workspaceImages.length === 1 ? 'Foto' : 'Fotos'}</Text>
          <TouchableOpacity style={s.discardBtn} onPress={handleDiscardAll}>
            <Ionicons name="trash-outline" size={18} color={colors.error} />
            <Text style={s.discardBtnText}>Löschen</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.wsScroll} contentContainerStyle={s.wsScrollContent} keyboardShouldPersistTaps="handled">
          {/* Project picker */}
          <TouchableOpacity style={s.projectChip} onPress={openProjectPicker}>
            <Ionicons name={projectName ? 'folder' : 'folder-outline'} size={18} color={projectName ? colors.accent : colors.textTertiary} />
            <Text style={[s.projectChipText, projectName && s.projectChipActive]} numberOfLines={1}>
              {projectName || 'Kein Projekt gewählt'}
            </Text>
            <Ionicons name="chevron-down" size={14} color={colors.textTertiary} />
          </TouchableOpacity>

          {/* Project notes */}
          <View style={s.projectNotesBox}>
            <View style={s.projectNotesLabelRow}>
              <Ionicons name="document-text-outline" size={16} color={colors.textTertiary} />
              <Text style={s.projectNotesLabel}>Projektnotizen</Text>
            </View>
            <TextInput
              style={s.projectNotesInput}
              value={projectNotes}
              onChangeText={handleProjectNotesChange}
              placeholder="Notizen für dieses Projekt..."
              placeholderTextColor={colors.textTertiary}
              multiline
              textAlignVertical="top"
            />
          </View>

          {/* Photo list */}
          <Text style={s.sectionLabel}>Fotos</Text>
          {workspaceImages.map((img) => (
            <View key={img.id} style={s.photoRow}>
              <Image source={{ uri: img.uri }} style={s.photoThumb} />
              <View style={s.photoMeta}>
                {/* Title */}
                <TouchableOpacity style={s.photoField} onPress={() => openEditModal(img, 'title')}>
                  <Text style={s.photoTitle} numberOfLines={1}>
                    {img.custom_title || img.file_name.replace(/\.[^.]+$/, '')}
                  </Text>
                  <Ionicons name="pencil-outline" size={14} color={colors.textTertiary} />
                </TouchableOpacity>
                {/* Notes */}
                <TouchableOpacity style={s.photoField} onPress={() => openEditModal(img, 'notes')}>
                  <Text style={[s.photoNotes, !img.notes && s.photoNotesPlaceholder]} numberOfLines={2}>
                    {img.notes || 'Notiz hinzufügen...'}
                  </Text>
                  <Ionicons name="document-text-outline" size={14} color={colors.textTertiary} />
                </TouchableOpacity>
                {/* GPS badge */}
                {img.gps_data && (
                  <View style={s.gpsBadge}>
                    <Ionicons name="location" size={12} color="#22c55e" />
                    <Text style={s.gpsBadgeText}>GPS</Text>
                  </View>
                )}
              </View>
              {/* Remove */}
              <TouchableOpacity style={s.photoRemoveBtn} onPress={() => handleRemoveImage(img)}>
                <Ionicons name="close-circle" size={22} color={colors.error} />
              </TouchableOpacity>
            </View>
          ))}

          {/* Add more photos */}
          <View style={s.addMoreRow}>
            <TouchableOpacity style={s.addMoreBtn} onPress={openNativeCamera}>
              <Ionicons name="camera-outline" size={20} color={colors.textSecondary} />
              <Text style={s.addMoreText}>Foto aufnehmen</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.addMoreBtn} onPress={pickFromGallery}>
              <Ionicons name="images-outline" size={20} color={colors.textSecondary} />
              <Text style={s.addMoreText}>Galerie</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Upload button */}
        <TouchableOpacity style={s.uploadBtn} onPress={handleUpload} disabled={uploading}>
          {uploading
            ? <ActivityIndicator color="white" />
            : <>
                <Ionicons name="cloud-upload-outline" size={22} color="white" />
                <Text style={s.uploadBtnText}>
                  {workspaceImages.length === 1 ? '1 Foto absenden' : `${workspaceImages.length} Fotos absenden`}
                </Text>
              </>
          }
        </TouchableOpacity>

        {renderProjectPicker()}
        {renderEditModal()}

        {toast && (
          <Animated.View style={[s.toast, { opacity: toastOpacity }]}>
            <Ionicons name="checkmark-circle-outline" size={18} color={colors.accent} />
            <Text style={s.toastText}>{toast}</Text>
          </Animated.View>
        )}
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ── STATE: SHOOTER (default) ──────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.shooterHeader}>
        <Text style={s.shooterTitle}>Foto</Text>
        <TouchableOpacity style={[s.gpsChip, gpsEnabled && s.gpsChipOn]} onPress={toggleGps}>
          <Ionicons name={gpsEnabled ? 'location' : 'location-outline'} size={18} color={gpsEnabled ? '#22c55e' : colors.textTertiary} />
          <Text style={[s.gpsChipText, gpsEnabled && s.gpsChipTextOn]}>GPS</Text>
        </TouchableOpacity>
      </View>

      {/* Body */}
      <View style={s.shooterBody}>
        <TouchableOpacity style={s.cameraBtn} onPress={openNativeCamera} activeOpacity={0.8}>
          <Ionicons name="camera" size={60} color="white" />
        </TouchableOpacity>
        <Text style={s.cameraHint}>Tippen zum Fotografieren</Text>

        <TouchableOpacity style={s.galleryBtn} onPress={pickFromGallery}>
          <Ionicons name="images-outline" size={20} color={colors.textSecondary} />
          <Text style={s.galleryBtnText}>Galerie öffnen</Text>
        </TouchableOpacity>

        {/* Chip if workspace already has images (after returning from somewhere) */}
        {workspaceImages.length > 0 && (
          <TouchableOpacity style={s.draftChip} onPress={() => setScreenState('WORKSPACE')}>
            <Ionicons name="layers-outline" size={16} color={colors.accent} />
            <Text style={s.draftChipText}>
              {workspaceImages.length} {workspaceImages.length === 1 ? 'Foto im Entwurf' : 'Fotos im Entwurf'} – Bearbeiten
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.accent} />
          </TouchableOpacity>
        )}
      </View>

      {renderProjectPicker()}

      {toast && (
        <Animated.View style={[s.toast, { opacity: toastOpacity }]}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.accent} />
          <Text style={s.toastText}>{toast}</Text>
        </Animated.View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },

  // ── SHOOTER ──────────────────────────────────────────────────────────────
  shooterHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 28 : 60,
    paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  shooterTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  gpsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16,
    backgroundColor: colors.bgSecondary, borderWidth: 1, borderColor: colors.border,
  },
  gpsChipOn: { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.4)' },
  gpsChipText: { fontSize: 13, fontWeight: '600', color: colors.textTertiary },
  gpsChipTextOn: { color: '#22c55e' },

  shooterBody: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28, paddingBottom: 60,
  },
  cameraBtn: {
    width: 130, height: 130, borderRadius: 65, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
    elevation: 8, shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 14,
  },
  cameraHint: { color: colors.textTertiary, fontSize: 13, marginTop: -12 },
  galleryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 24, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSecondary,
  },
  galleryBtnText: { color: colors.textSecondary, fontSize: 15, fontWeight: '500' },
  draftChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20,
    backgroundColor: 'rgba(59,130,246,0.1)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)',
  },
  draftChipText: { color: colors.accent, fontSize: 13, fontWeight: '600' },

  // ── CONFIRM ───────────────────────────────────────────────────────────────
  confirmContainer: { flex: 1, backgroundColor: 'black' },
  confirmImage: { flex: 1 },
  confirmBar: {
    flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.9)',
    paddingBottom: 40, paddingTop: 12,
  },
  confirmBtnDiscard: {
    flex: 1, alignItems: 'center', gap: 4, paddingVertical: 14,
    borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.15)',
  },
  confirmBtnKeep: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 14 },
  confirmBtnLabel: { color: 'white', fontSize: 13, fontWeight: '500' },

  // ── WORKSPACE ─────────────────────────────────────────────────────────────
  wsHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 28 : 60,
    paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.bgPrimary,
  },
  wsHeaderTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  discardBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' },
  discardBtnText: { color: colors.error, fontSize: 13, fontWeight: '600' },

  wsScroll: { flex: 1 },
  wsScrollContent: { padding: 16, gap: 12, paddingBottom: 20 },

  projectChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderRadius: 14, backgroundColor: colors.bgSecondary,
    borderWidth: 1, borderColor: colors.border,
  },
  projectChipText: { flex: 1, color: colors.textTertiary, fontSize: 15 },
  projectChipActive: { color: colors.textPrimary, fontWeight: '600' },

  projectNotesBox: {
    backgroundColor: colors.bgSecondary, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border, padding: 12, gap: 8,
  },
  projectNotesLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  projectNotesLabel: { color: colors.textTertiary, fontSize: 13, fontWeight: '500' },
  projectNotesInput: { color: colors.textPrimary, fontSize: 14, minHeight: 72, textAlignVertical: 'top' },

  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },

  photoRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: colors.bgSecondary, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border, padding: 12,
  },
  photoThumb: { width: 72, height: 72, borderRadius: 10 },
  photoMeta: { flex: 1, gap: 6 },
  photoField: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.cardBg, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  photoTitle: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  photoNotes: { flex: 1, color: colors.textSecondary, fontSize: 13 },
  photoNotesPlaceholder: { color: colors.textTertiary, fontStyle: 'italic' },
  gpsBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, backgroundColor: 'rgba(34,197,94,0.12)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)' },
  gpsBadgeText: { color: '#22c55e', fontSize: 11, fontWeight: '600' },
  photoRemoveBtn: { padding: 2 },

  addMoreRow: { flexDirection: 'row', gap: 10 },
  addMoreBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.bgSecondary, borderWidth: 1, borderColor: colors.border },
  addMoreText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },

  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    margin: 16, paddingVertical: 16, borderRadius: 14, backgroundColor: colors.accent,
    elevation: 4, shadowColor: colors.accent, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 8,
  },
  uploadBtnText: { color: 'white', fontSize: 17, fontWeight: '700' },

  // ── Modals ────────────────────────────────────────────────────────────────
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.bgPrimary, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  newProjectRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  newProjectInput: { flex: 1, backgroundColor: colors.inputBg || colors.bgSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: colors.textPrimary },
  newProjectBtn: { width: 42, height: 42, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bgSecondary, borderRadius: 10, paddingHorizontal: 12, marginBottom: 10 },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 14, paddingVertical: 10 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 10, marginBottom: 6, backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border },
  pickerItemActive: { borderColor: colors.accent, backgroundColor: 'rgba(59,130,246,0.1)' },
  pickerDot: { width: 4, height: 28, borderRadius: 2 },
  pickerItemText: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.textPrimary },
  pickerMeta: { fontSize: 12, color: colors.textTertiary },
  pendingLabel: { fontSize: 11, color: '#f59e0b', fontWeight: '600', marginTop: 2 },
  emptyHint: { color: colors.textTertiary, fontSize: 14, textAlign: 'center', paddingVertical: 20 },

  notesFullScreen: { flex: 1, backgroundColor: colors.bgPrimary, paddingTop: Platform.OS === 'android' ? 40 : 60 },
  notesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  notesTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  notesInput: { flex: 1, padding: 20, fontSize: 16, color: colors.textPrimary, textAlignVertical: 'top' },

  titleModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  titleModalSheet: { backgroundColor: colors.bgPrimary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  titleModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  titleModalTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  titleInput: { backgroundColor: colors.inputBg || colors.bgSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: colors.textPrimary },

  // ── Toast ─────────────────────────────────────────────────────────────────
  toast: {
    position: 'absolute', bottom: 100, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)',
  },
  toastText: { color: 'white', fontSize: 14, fontWeight: '500' },
});
