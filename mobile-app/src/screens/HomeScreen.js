import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl,
  Image, Dimensions, ActivityIndicator, Modal, TextInput, ScrollView,
  Linking,
} from 'react-native';
import { useDialog } from '../components/CustomDialog';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Network from 'expo-network';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { getRecentPhotos, getCachedProjects, getPendingProjects, addToUploadQueue, updateRecentPhotoProject, getQueuedFileNames, addToDeleteQueue, getSetting, setSetting } from '../services/database';
import { createProject } from '../services/api';
import { syncMetadata } from '../services/syncService';
import { processDeleteQueue } from '../services/deleteQueue';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PHOTO_COLUMNS = 3;
const PHOTO_GAP = 3;
const PHOTO_SIZE = Math.floor((SCREEN_WIDTH - 32 - (PHOTO_COLUMNS - 1) * PHOTO_GAP) / PHOTO_COLUMNS);
const PAGE_SIZE = 18;

export default function HomeScreen({ navigation }) {
  const { alert } = useDialog();
  const { userName, activeConnection, refreshQueueCount } = useApp();
  const [recentPhotos, setRecentPhotos] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(1);

  // Selection state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  // WiFi-only banner
  const [showWifiBanner, setShowWifiBanner] = useState(false);

  // Project picker state
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projects, setProjects] = useState([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [assigning, setAssigning] = useState(false);

  const checkWifiBanner = async () => {
    const dismissed = await getSetting('wifiBannerDismissed', 'false');
    if (dismissed === 'true') { setShowWifiBanner(false); return; }
    const wifiOnly = await getSetting('wifiOnly', 'true');
    if (wifiOnly !== 'true') { setShowWifiBanner(false); return; }
    try {
      const netState = await Network.getNetworkStateAsync();
      const isWifi = netState.type === Network.NetworkStateType.WIFI;
      setShowWifiBanner(netState.isConnected && !isWifi);
    } catch {
      setShowWifiBanner(false);
    }
  };

  const dismissWifiBanner = async () => {
    await setSetting('wifiBannerDismissed', 'true');
    setShowWifiBanner(false);
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
      checkWifiBanner();
    }, [])
  );

  const loadData = async () => {
    try {
      pageRef.current = 1;
      const photos = await getRecentPhotos(PAGE_SIZE);
      setRecentPhotos(photos);
      setHasMore(photos.length >= PAGE_SIZE);
    } catch (error) {
      console.error('Failed to load home data:', error);
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = pageRef.current + 1;
      const offset = pageRef.current * PAGE_SIZE;
      const photos = await getRecentPhotos(PAGE_SIZE, offset);
      if (photos.length > 0) {
        setRecentPhotos(prev => [...prev, ...photos]);
        pageRef.current = nextPage;
      }
      setHasMore(photos.length >= PAGE_SIZE);
    } catch (error) {
      console.error('Failed to load more photos:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSync = async () => {
    setRefreshing(true);
    try {
      await syncMetadata();
      await loadData();
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleScroll = useCallback((event) => {
    if (!hasMore || loadingMore) return;
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 200) {
      loadMore();
    }
  }, [hasMore, loadingMore]);

  // Selection handlers
  const handleLongPress = (photoId) => {
    setSelectionMode(true);
    setSelectedIds(new Set([photoId]));
  };

  const handlePhotoPress = (photo) => {
    if (selectionMode) {
      // Toggle selection
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(photo.id)) {
          next.delete(photo.id);
        } else {
          next.add(photo.id);
        }
        // Exit selection mode if nothing selected
        if (next.size === 0) {
          setSelectionMode(false);
        }
        return next;
      });
    } else {
      // Normal navigation with full images array for swipe
      const photoIndex = recentPhotos.findIndex(p => p.id === photo.id);
      const imagesList = recentPhotos.map(p => ({
        id: p.id,
        name: p.file_name,
        localUri: p.thumbnail_uri || p.file_uri,
        customTitle: p.custom_title || null,
        notes: p.notes || null,
        gpsData: p.gps_data || null,
        createdAt: p.created_at || null,
        isLocal: true,
        projectId: p.project_id || null,
        projectName: p.project_name || null,
        projectFolderId: p.project_folder_id || null,
        driveFileId: p.drive_file_id || null,
        driveFileName: p.drive_file_name || null,
      }));
      navigation.navigate('ImageView', {
        images: imagesList,
        initialIndex: photoIndex >= 0 ? photoIndex : 0,
        imageName: photo.file_name,
        projectName: photo.project_name,
      });
    }
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const selectAll = () => {
    setSelectedIds(new Set(recentPhotos.map(p => p.id)));
  };

  // Queue photos for deletion (non-blocking) and immediately update UI
  const queueDeleteAndContinue = async (selectedPhotos, deleteFromSoftware = false) => {
    await addToDeleteQueue(selectedPhotos, deleteFromSoftware);
    // Immediately remove from UI
    setRecentPhotos(prev => prev.filter(p => !selectedIds.has(p.id)));
    setSelectionMode(false);
    setSelectedIds(new Set());
    // Process queue in background
    processDeleteQueue();
  };

  // Delete selected photos
  const handleDeleteSelected = async () => {
    const count = selectedIds.size;
    if (count === 0) return;

    const selectedPhotos = recentPhotos.filter(p => selectedIds.has(p.id));

    // Check which photos are still in the upload queue (not yet uploaded)
    const fileNames = selectedPhotos.map(p => p.file_name);
    const queuedNames = await getQueuedFileNames(fileNames);

    // Photos that have been uploaded → ask user if they also want software deletion
    const uploadedPhotos = selectedPhotos.filter(p => !queuedNames.has(p.file_name));

    if (uploadedPhotos.length === 0) {
      // All photos are still in queue → simple delete
      alert(
        'Fotos löschen',
        `${count} ${count === 1 ? 'Foto' : 'Fotos'} vom Handy löschen? (noch nicht hochgeladen)`,
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Löschen',
            style: 'destructive',
            onPress: () => queueDeleteAndContinue(selectedPhotos, false),
          },
        ]
      );
    } else {
      // Some/all photos have been uploaded → offer choice
      const uploadedCount = uploadedPhotos.length;
      alert(
        'Fotos löschen',
        `${uploadedCount} ${uploadedCount === 1 ? 'Foto wurde' : 'Fotos wurden'} bereits hochgeladen. Auch aus der Desktop-Software löschen?`,
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Nur vom Handy',
            onPress: () => queueDeleteAndContinue(selectedPhotos, false),
          },
          {
            text: 'Auch aus Software',
            style: 'destructive',
            onPress: () => queueDeleteAndContinue(selectedPhotos, true),
          },
        ]
      );
    }
  };

  // Project assignment
  const openProjectPicker = async () => {
    try {
      const [cached, pending] = await Promise.all([getCachedProjects(), getPendingProjects()]);
      // Merge pending projects that aren't already in cached
      const pendingMapped = pending
        .filter(pp => !cached.some(c => c.folder_id === pp.folder_id))
        .map(pp => ({
          id: pp.folder_id || `pending_${pp.id}`,
          folder_name: pp.folder_name,
          folder_id: pp.folder_id,
          color: '#6b7280',
          image_count: 0,
          isPending: true,
        }));
      setProjects([...cached, ...pendingMapped]);
      setProjectSearch('');
      setShowProjectPicker(true);
    } catch (error) {
      console.error('Failed to load projects:', error);
      alert('Fehler', 'Projekte konnten nicht geladen werden.');
    }
  };

  const handleAssignToProject = async (project) => {
    if (selectedIds.size === 0) return;
    setAssigning(true);

    try {
      const selectedPhotos = recentPhotos.filter(p => selectedIds.has(p.id));
      let queuedCount = 0;

      for (const photo of selectedPhotos) {
        // Add to upload queue with project assignment (skip recent_photos insert to avoid duplicates)
        await addToUploadQueue(
          photo.file_uri,
          photo.file_name,
          photo.mime_type || 'image/jpeg',
          project.folder_id || project.id,
          project.folder_name,
          project.folder_id || project.id,
          photo.gps_data,
          true // skipRecentPhotos - photo already exists in recent_photos
        );

        // Update the existing recent photos entry to show project badge
        await updateRecentPhotoProject(photo.id, project.folder_id || project.id, project.folder_name);
        queuedCount++;
      }

      // Refresh data
      await loadData();
      if (refreshQueueCount) refreshQueueCount();

      // Exit selection mode
      setShowProjectPicker(false);
      setSelectionMode(false);
      setSelectedIds(new Set());

      alert(
        'Zugewiesen',
        `${queuedCount} ${queuedCount === 1 ? 'Foto' : 'Fotos'} werden zu "${project.folder_name}" hochgeladen.`
      );
    } catch (error) {
      console.error('Failed to assign photos:', error);
      alert('Fehler', 'Fotos konnten nicht zugewiesen werden: ' + error.message);
    } finally {
      setAssigning(false);
    }
  };

  const handleCreateNewProject = async () => {
    if (!projectSearch.trim()) {
      alert('Fehler', 'Bitte gib einen Projektnamen ein.');
      return;
    }

    setAssigning(true);
    try {
      const result = await createProject(projectSearch.trim());
      if (result.success) {
        const newProject = {
          id: result.id,
          folder_name: result.folder_name,
          folder_id: result.folder_id,
          color: '#3b82f6',
        };

        await handleAssignToProject(newProject);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      alert('Fehler', 'Projekt konnte nicht erstellt werden: ' + error.message);
      setAssigning(false);
    }
  };

  const filteredProjects = projects.filter(p => {
    if (!projectSearch) return true;
    return p.folder_name.toLowerCase().includes(projectSearch.toLowerCase());
  });

  return (
    <View style={styles.container}>
      {/* Selection toolbar */}
      {selectionMode && (
        <View style={styles.selectionBar}>
          <TouchableOpacity onPress={cancelSelection} style={styles.selectionBtn}>
            <Ionicons name="close" size={20} color="white" />
          </TouchableOpacity>
          <Text style={styles.selectionCount}>
            {selectedIds.size} {selectedIds.size === 1 ? 'Foto' : 'Fotos'} ausgewählt
          </Text>
          <TouchableOpacity onPress={selectAll} style={styles.selectionBtn}>
            <Text style={styles.selectAllText}>Alle</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDeleteSelected}
            style={[styles.deleteBtnBar, selectedIds.size === 0 && styles.assignBtnDisabled]}
            disabled={selectedIds.size === 0}
          >
            <Ionicons name="trash-outline" size={18} color="white" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={openProjectPicker}
            style={[styles.assignBtn, selectedIds.size === 0 && styles.assignBtnDisabled]}
            disabled={selectedIds.size === 0}
          >
            <Ionicons name="folder-outline" size={18} color="white" />
            <Text style={styles.assignBtnText}>Zuweisen</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={[]}
        renderItem={null}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleSync} tintColor={colors.accent} />
        }
        onScroll={handleScroll}
        scrollEventThrottle={400}
        ListHeaderComponent={
          <>
            {/* Connection Status */}
            <View style={[styles.statusBar, styles.statusConnected]}>
              <Ionicons name="cloud-done" size={16} color={colors.success} />
              <Text style={[styles.statusText, { color: colors.success }]}>
                {activeConnection?.name || 'Google Drive'}
              </Text>
              {userName ? (
                <Text style={styles.statusUser}>{userName}</Text>
              ) : null}
            </View>

            {/* WiFi-only warning banner */}
            {showWifiBanner && (
              <View style={styles.wifiBanner}>
                <Ionicons name="wifi-outline" size={20} color="#f59e0b" />
                <Text style={styles.wifiBannerText}>
                  Nur-WLAN-Modus aktiv, aber kein WLAN verbunden – Uploads pausiert.{' '}
                  <Text style={styles.wifiBannerLink} onPress={() => Linking.openSettings()}>
                    Einstellungen öffnen
                  </Text>
                </Text>
                <TouchableOpacity style={styles.wifiBannerClose} onPress={dismissWifiBanner} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}

            {/* Recent Photos */}
            {recentPhotos.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Meine Fotos</Text>
                  <Text style={styles.photoCount}>{recentPhotos.length} Fotos</Text>
                </View>
                <View style={styles.photoGrid}>
                  {recentPhotos.map((photo) => {
                    const isSelected = selectedIds.has(photo.id);
                    return (
                      <TouchableOpacity
                        key={photo.id}
                        style={[styles.photoCard, isSelected && styles.photoCardSelected]}
                        onPress={() => handlePhotoPress(photo)}
                        onLongPress={() => handleLongPress(photo.id)}
                        delayLongPress={400}
                      >
                        <Image
                          source={{ uri: photo.thumbnail_uri || photo.file_uri }}
                          style={styles.photoImage}
                          resizeMode="cover"
                        />
                        {photo.project_name && (
                          <View style={styles.photoProjectBadge}>
                            <Text style={styles.photoProjectText} numberOfLines={1}>
                              {photo.project_name}
                            </Text>
                          </View>
                        )}
                        {photo.gps_data && (
                          <View style={styles.photoGpsBadge}>
                            <Ionicons name="location" size={10} color={colors.success} />
                          </View>
                        )}
                        {/* Selection overlay */}
                        {selectionMode && (
                          <View style={[styles.selectionOverlay, isSelected && styles.selectionOverlayActive]}>
                            <View style={[styles.checkCircle, isSelected && styles.checkCircleActive]}>
                              {isSelected && <Ionicons name="checkmark" size={16} color="white" />}
                            </View>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Loading indicator for infinite scroll */}
                {loadingMore && (
                  <View style={styles.loadingMore}>
                    <ActivityIndicator size="small" color={colors.accent} />
                  </View>
                )}
              </View>
            )}

            {recentPhotos.length === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="images-outline" size={48} color={colors.textTertiary} />
                <Text style={styles.emptyTitle}>Willkommen!</Text>
                <Text style={styles.emptyText}>
                  Ziehe zum Aktualisieren nach unten oder nimm dein erstes Foto auf.
                </Text>
              </View>
            )}
          </>
        }
      />

      {/* Project Picker Modal */}
      <Modal
        visible={showProjectPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowProjectPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Projekt zuweisen</Text>
              <TouchableOpacity onPress={() => setShowProjectPicker(false)}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              {selectedIds.size} {selectedIds.size === 1 ? 'Foto' : 'Fotos'} werden in den Projektordner hochgeladen
            </Text>

            {/* Search */}
            <View style={styles.modalSearchContainer}>
              <Ionicons name="search" size={16} color={colors.textTertiary} />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Projekt suchen..."
                placeholderTextColor={colors.textTertiary}
                value={projectSearch}
                onChangeText={setProjectSearch}
              />
            </View>

            {/* Create new project button */}
            <TouchableOpacity
              style={styles.createProjectBtn}
              onPress={handleCreateNewProject}
              disabled={assigning || !projectSearch.trim()}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
              <Text style={styles.createProjectText}>
                {projectSearch.trim() ? `"${projectSearch.trim()}" erstellen` : 'Projektname eingeben...'}
              </Text>
            </TouchableOpacity>

            {/* Project list */}
            <ScrollView style={styles.projectList}>
              {filteredProjects.map(project => (
                <TouchableOpacity
                  key={project.id}
                  style={styles.projectItem}
                  onPress={() => handleAssignToProject(project)}
                  disabled={assigning}
                >
                  <View style={[styles.projectColorBar, { backgroundColor: project.color || colors.accent }]} />
                  <View style={styles.projectInfo}>
                    <Text style={styles.projectName} numberOfLines={1}>{project.folder_name}</Text>
                    {project.isPending ? (
                      <Text style={styles.pendingBadge}>Unbestätigt</Text>
                    ) : (
                      <Text style={styles.projectImageCount}>{project.image_count || 0} Bilder</Text>
                    )}
                  </View>
                  {project.is_starred ? (
                    <Ionicons name="star" size={14} color={colors.warning} />
                  ) : null}
                </TouchableOpacity>
              ))}
              {filteredProjects.length === 0 && !projectSearch.trim() && (
                <Text style={styles.noProjectsText}>Keine Projekte gefunden</Text>
              )}
            </ScrollView>

            {assigning && (
              <View style={styles.assigningOverlay}>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={styles.assigningText}>Wird zugewiesen...</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },

  // Selection bar
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  selectionBtn: {
    padding: 4,
  },
  selectionCount: {
    flex: 1,
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  selectAllText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
  },
  deleteBtnBar: {
    backgroundColor: 'rgba(239, 68, 68, 0.3)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  assignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  assignBtnDisabled: { opacity: 0.5 },
  assignBtnText: { color: 'white', fontSize: 13, fontWeight: '600' },

  // Status bar
  statusBar: {
    flexDirection: 'row', alignItems: 'center', padding: 12,
    margin: 16, marginBottom: 8, borderRadius: 10, gap: 8,
  },
  statusConnected: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  statusText: { fontSize: 14, fontWeight: '600' },
  statusUser: { fontSize: 13, color: colors.textSecondary, marginLeft: 'auto' },
  section: { padding: 16, paddingTop: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  photoCount: { fontSize: 13, color: colors.textTertiary },

  // Photo grid
  photoGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: PHOTO_GAP,
  },
  photoCard: {
    width: PHOTO_SIZE, height: PHOTO_SIZE,
    borderRadius: 8, overflow: 'hidden',
    backgroundColor: colors.cardBg,
  },
  photoCardSelected: {
    borderWidth: 3,
    borderColor: colors.accent,
    borderRadius: 10,
  },
  photoImage: { width: '100%', height: '100%' },
  photoProjectBadge: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 3,
  },
  photoProjectText: { color: 'white', fontSize: 10, fontWeight: '500' },
  photoGpsBadge: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8, padding: 3,
  },

  // Selection overlay
  selectionOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
  },
  selectionOverlayActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.25)',
  },
  checkCircle: {
    position: 'absolute', top: 6, left: 6,
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: 'white',
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  checkCircleActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },

  // Loading more
  loadingMore: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16,
  },

  emptyState: { alignItems: 'center', justifyContent: 'center', padding: 48, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: colors.textPrimary },
  emptyText: { fontSize: 14, color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },

  // Project picker modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 13,
    color: colors.textTertiary,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  modalSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgTertiary,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  modalSearchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingVertical: 10,
  },
  projectList: {
    paddingHorizontal: 16,
  },
  createProjectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderColor,
    marginBottom: 4,
  },
  createProjectText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent,
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    backgroundColor: colors.bgTertiary,
    marginBottom: 8,
    gap: 12,
    overflow: 'hidden',
  },
  projectColorBar: {
    width: 4, alignSelf: 'stretch', borderRadius: 2, marginLeft: -14, marginVertical: -14, marginRight: 4,
  },
  projectInfo: { flex: 1 },
  projectName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  projectImageCount: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
  pendingBadge: {
    fontSize: 11,
    color: '#f59e0b',
    fontWeight: '600',
    marginTop: 2,
  },
  noProjectsText: {
    color: colors.textTertiary,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
  },
  assigningOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  assigningText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },

  // WiFi-only warning banner
  wifiBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
  },
  wifiBannerText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  wifiBannerLink: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  wifiBannerClose: { padding: 2 },
});
