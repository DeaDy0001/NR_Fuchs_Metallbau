import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image,
  Dimensions, RefreshControl, ActivityIndicator, Modal, TextInput, ScrollView,
} from 'react-native';
import { useDialog } from '../components/CustomDialog';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import CheckboxNotes from '../components/CheckboxNotes';
import { fetchProjectImages, getImageUrl } from '../services/api';
import { downloadProjectImages } from '../services/syncService';
import { getCachedProjectByFolderId, cacheProject, addToMetaChangeQueue } from '../services/database';
import { forceProcessQueue } from '../services/uploadQueue';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const NUM_COLUMNS = 3;
const IMAGE_SIZE = (SCREEN_WIDTH - 32 - (NUM_COLUMNS - 1) * 4) / NUM_COLUMNS;

const COLOR_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6b7280',
];

export default function ProjectDetailScreen({ navigation, route }) {
  const { alert } = useDialog();
  const { projectId, projectName, projectFolderId } = route.params;
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [imageAuth, setImageAuth] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');


  // Metadata state
  const [meta, setMeta] = useState({ color: null, notes: null, tags: [] });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editColor, setEditColor] = useState(null);
  const [editNotes, setEditNotes] = useState('');
  const [editTags, setEditTags] = useState([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadImages();
      loadImageAuth();
      loadMeta();
    }, [])
  );

  const loadMeta = async () => {
    try {
      const folderId = projectFolderId || projectId;
      if (!folderId) return;
      const cached = await getCachedProjectByFolderId(folderId);
      if (cached) {
        let tags = [];
        try { tags = JSON.parse(cached.tags || '[]'); } catch {}
        setMeta({ color: cached.color || null, notes: cached.notes || null, tags });
      }
    } catch {}
  };

  const loadImageAuth = async () => {
    try {
      const source = await getImageUrl('dummy');
      if (source) setImageAuth(source.headers);
    } catch {}
  };

  const loadImages = async () => {
    try {
      const folderId = projectFolderId;
      if (!folderId) { setImages([]); setLoading(false); return; }
      const data = await fetchProjectImages(folderId);
      setImages(data);
    } catch (error) {
      console.error('Failed to load project images:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadImages();
    await loadMeta();
    setRefreshing(false);
  };

  const openEditModal = () => {
    setEditColor(meta.color || COLOR_PALETTE[0]);
    setEditNotes(meta.notes || '');
    setEditTags([...(meta.tags || [])]);
    setNewTagInput('');
    setShowEditModal(true);
  };

  const addTag = () => {
    const tag = newTagInput.trim();
    if (!tag || editTags.includes(tag)) return;
    setEditTags(prev => [...prev, tag]);
    setNewTagInput('');
  };

  const removeTag = (tag) => setEditTags(prev => prev.filter(t => t !== tag));

  const handleSaveMeta = async () => {
    setSavingMeta(true);
    try {
      const folderId = projectFolderId;
      if (!folderId) throw new Error('Kein Ordner-ID');

      const newMeta = {
        color: editColor,
        notes: editNotes.trim() || null,
        tags: editTags,
        is_starred: false,
      };

      // 1. Update local cache immediately
      const cached = await getCachedProjectByFolderId(folderId);
      if (cached) {
        await cacheProject({
          ...cached,
          color: newMeta.color,
          notes: newMeta.notes,
          tags: JSON.stringify(newMeta.tags),
        });
      }

      // 2. Update UI and close modal immediately
      setMeta({ color: newMeta.color, notes: newMeta.notes, tags: newMeta.tags });
      setShowEditModal(false);

      // 3. Queue background upload to Drive
      await addToMetaChangeQueue(folderId, projectName, newMeta);
      forceProcessQueue();
    } catch (e) {
      alert('Fehler', 'Speichern fehlgeschlagen: ' + e.message);
    } finally {
      setSavingMeta(false);
    }
  };

  const handleSyncImages = async () => {
    if (images.length === 0) {
      alert('Keine Bilder', 'Dieses Projekt hat noch keine Bilder zum Herunterladen.');
      return;
    }
    alert(
      'Bilder herunterladen',
      `${images.length} ${images.length === 1 ? 'Bild' : 'Bilder'} aus "${projectName}" herunterladen?`,
      [{ text: 'Abbrechen', style: 'cancel' }, { text: 'Herunterladen', onPress: startSync }]
    );
  };

  const startSync = async () => {
    setSyncing(true);
    setSyncProgress('Starte Download...');
    try {
      const downloaded = await downloadProjectImages(projectId, images, (done, total) => {
        setSyncProgress(`${done} / ${total} Bilder`);
      });
      alert('Download abgeschlossen', `${downloaded} von ${images.length} Bildern heruntergeladen.`);
    } catch (error) {
      alert('Fehler', 'Download fehlgeschlagen: ' + error.message);
    } finally {
      setSyncing(false);
      setSyncProgress('');
    }
  };

  const renderImage = ({ item, index }) => (
    <TouchableOpacity
      style={styles.imageCard}
      onPress={() => navigation.navigate('ImageView', {
        imageId: item.id,
        imageName: item.name,
        projectName,
        images: images.map(img => ({ id: img.id, name: img.name })),
        initialIndex: index,
      })}
    >
      {item.thumbnail_link ? (
        <Image
          source={{ uri: item.thumbnail_link, headers: imageAuth || {} }}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.thumbnail, styles.placeholderThumb]}>
          <Ionicons name="image-outline" size={24} color={colors.textTertiary} />
        </View>
      )}
    </TouchableOpacity>
  );

  const projectColor = meta.color || colors.accent;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={images}
        keyExtractor={i => String(i.id)}
        renderItem={renderImage}
        numColumns={NUM_COLUMNS}
        contentContainerStyle={styles.grid}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <View>
            {/* Metadata card */}
            <View style={[styles.metaCard, { borderLeftColor: projectColor }]}>
              <View style={styles.metaCardHeader}>
                <View style={[styles.colorDot, { backgroundColor: projectColor }]} />
                <Text style={styles.metaCardTitle}>{projectName}</Text>
              </View>
              {meta.notes ? (
                <Text style={styles.notesText} numberOfLines={3}>{meta.notes}</Text>
              ) : null}
              {meta.tags && meta.tags.length > 0 && (
                <View style={styles.tagsRow}>
                  {meta.tags.map((tag, i) => (
                    <View key={i} style={styles.tagChip}>
                      <Text style={styles.tagChipText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Image count + download */}
            <View style={styles.header}>
              <Text style={styles.imageCount}>
                {images.length} {images.length === 1 ? 'Bild' : 'Bilder'}
              </Text>
              <TouchableOpacity
                style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
                onPress={handleSyncImages}
                disabled={syncing}
              >
                {syncing ? (
                  <>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={styles.syncButtonText}>{syncProgress}</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="download-outline" size={18} color={colors.accent} />
                    <Text style={styles.syncButtonText}>Bilder laden</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="images-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyText}>Keine Bilder in diesem Projekt</Text>
          </View>
        }
      />

      {/* FAB - Edit project (left of camera) */}
      <TouchableOpacity
        style={styles.fabNotes}
        onPress={openEditModal}
      >
        <Ionicons name="create-outline" size={26} color="white" />
      </TouchableOpacity>

      {/* FAB - Take photo */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CameraStack', { projectId, projectName, projectFolderId })}
      >
        <Ionicons name="camera" size={28} color="white" />
      </TouchableOpacity>

      {/* Edit Metadata Modal */}
      <Modal
        visible={showEditModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowEditModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowEditModal(false)}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Projekt bearbeiten</Text>
            <TouchableOpacity
              onPress={handleSaveMeta}
              disabled={savingMeta}
              style={[styles.saveBtn, savingMeta && styles.saveBtnDisabled]}
            >
              {savingMeta
                ? <ActivityIndicator size="small" color="white" />
                : <Text style={styles.saveBtnText}>Speichern</Text>
              }
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            {/* Color picker */}
            <Text style={styles.fieldLabel}>Farbe</Text>
            <View style={styles.colorPicker}>
              {COLOR_PALETTE.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[styles.colorSwatch, { backgroundColor: c }, editColor === c && styles.colorSwatchSelected]}
                  onPress={() => setEditColor(c)}
                >
                  {editColor === c && <Ionicons name="checkmark" size={16} color="white" />}
                </TouchableOpacity>
              ))}
            </View>

            {/* Notes */}
            <Text style={styles.fieldLabel}>Notizen</Text>
            <CheckboxNotes
              value={editNotes}
              onChange={setEditNotes}
              placeholder="Notizen zum Projekt..."
              minHeight={100}
            />

            {/* Tags */}
            <Text style={styles.fieldLabel}>Tags</Text>
            <View style={styles.tagInputRow}>
              <TextInput
                style={styles.tagInput}
                value={newTagInput}
                onChangeText={setNewTagInput}
                placeholder="Neuen Tag eingeben..."
                placeholderTextColor={colors.textTertiary}
                onSubmitEditing={addTag}
                returnKeyType="done"
              />
              <TouchableOpacity style={styles.addTagBtn} onPress={addTag}>
                <Ionicons name="add" size={20} color="white" />
              </TouchableOpacity>
            </View>
            <View style={styles.editTagsRow}>
              {editTags.map((tag, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.editTagChip}
                  onPress={() => removeTag(tag)}
                >
                  <Text style={styles.editTagChipText}>{tag}</Text>
                  <Ionicons name="close-circle" size={14} color={colors.textTertiary} style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              ))}
              {editTags.length === 0 && (
                <Text style={styles.emptyTagsHint}>Keine Tags</Text>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  loadingContainer: { flex: 1, backgroundColor: colors.bgPrimary, alignItems: 'center', justifyContent: 'center' },

  // Metadata card
  metaCard: {
    margin: 16, marginBottom: 4, padding: 14,
    backgroundColor: colors.cardBg, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 4,
  },
  metaCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  colorDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  metaCardTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  editMetaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    borderWidth: 1, borderColor: colors.accent,
  },
  editMetaBtnText: { fontSize: 12, color: colors.accent, fontWeight: '500' },
  notesText: { fontSize: 13, color: colors.textSecondary, lineHeight: 18, marginBottom: 8 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    backgroundColor: colors.bgTertiary,
  },
  tagChipText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },

  // Header row (image count + download)
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  imageCount: { color: colors.textSecondary, fontSize: 14 },
  syncButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: colors.accent,
  },
  syncButtonDisabled: { opacity: 0.6 },
  syncButtonText: { color: colors.accent, fontSize: 13, fontWeight: '500' },

  // Grid
  grid: { padding: 14, paddingTop: 4 },
  imageCard: {
    width: IMAGE_SIZE, height: IMAGE_SIZE, margin: 2,
    borderRadius: 8, overflow: 'hidden', backgroundColor: colors.cardBg,
  },
  thumbnail: { width: '100%', height: '100%' },
  placeholderThumb: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgTertiary },
  empty: { alignItems: 'center', paddingTop: 40, gap: 12 },
  emptyText: { color: colors.textTertiary, fontSize: 15 },

  // FABs
  fab: {
    position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  fabNotes: {
    position: 'absolute', bottom: 24, right: 92, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.bgSecondary, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  notesModalBody: { flex: 1, padding: 16 },
  notesModalHint: { fontSize: 13, color: colors.textSecondary, marginBottom: 12 },
  notesModalInput: {
    flex: 1, backgroundColor: colors.inputBg || colors.cardBg,
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    padding: 14, fontSize: 16, color: colors.textPrimary,
  },

  // Edit Modal
  modalContainer: { flex: 1, backgroundColor: colors.bgPrimary },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  saveBtn: {
    backgroundColor: colors.accent, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, minWidth: 80, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: 'white', fontWeight: '600', fontSize: 14 },
  modalBody: { flex: 1, padding: 16 },

  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 16 },

  // Color picker
  colorPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorSwatch: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  colorSwatchSelected: { borderColor: 'white', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, elevation: 4 },

  // Notes input
  notesInput: {
    backgroundColor: colors.inputBg || colors.cardBg,
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    padding: 12, fontSize: 15, color: colors.textPrimary,
    minHeight: 100,
  },

  // Tags
  tagInputRow: { flexDirection: 'row', gap: 8 },
  tagInput: {
    flex: 1, backgroundColor: colors.inputBg || colors.cardBg,
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    padding: 12, fontSize: 15, color: colors.textPrimary,
  },
  addTagBtn: {
    width: 46, backgroundColor: colors.accent, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  editTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  editTagChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: colors.bgTertiary, borderWidth: 1, borderColor: colors.border,
  },
  editTagChipText: { fontSize: 13, color: colors.textPrimary },
  emptyTagsHint: { fontSize: 13, color: colors.textTertiary, fontStyle: 'italic' },
});
