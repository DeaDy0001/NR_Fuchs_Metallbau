import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  RefreshControl, Alert, Modal,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { getCachedProjects, getCachedTags, addPendingProject, getPendingProjects, clearConfirmedPendingProjects, cacheProject } from '../services/database';
import { syncMetadata } from '../services/syncService';
import { createProject } from '../services/api';
import { useApp } from '../contexts/AppContext';

const SORT_OPTIONS = [
  { key: 'name_asc', label: 'Name A-Z', icon: 'text-outline' },
  { key: 'name_desc', label: 'Name Z-A', icon: 'text-outline' },
  { key: 'date_desc', label: 'Neueste zuerst', icon: 'time-outline' },
  { key: 'date_asc', label: 'Älteste zuerst', icon: 'time-outline' },
  { key: 'images_desc', label: 'Meiste Bilder', icon: 'images-outline' },
  { key: 'images_asc', label: 'Wenigste Bilder', icon: 'images-outline' },
];

export default function ProjectsScreen({ navigation }) {
  const { isConnected } = useApp();
  const [projects, setProjects] = useState([]);
  const [pendingProjectsList, setPendingProjectsList] = useState([]);
  const [tags, setTags] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncCount, setSyncCount] = useState(0);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [sortBy, setSortBy] = useState('name_asc');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [filterStarred, setFilterStarred] = useState(false);
  const [filterHasImages, setFilterHasImages] = useState(false);
  const initialSyncDone = useRef(false);

  useFocusEffect(
    useCallback(() => {
      loadData();
      // Auto-sync project list on first visit
      if (!initialSyncDone.current) {
        initialSyncDone.current = true;
        handleRefresh();
      }
    }, [])
  );

  const loadData = async () => {
    const p = await getCachedProjects();
    const t = await getCachedTags();
    setProjects(p);
    setTags(t);
    // Load pending projects and remove ones that have been confirmed
    await clearConfirmedPendingProjects();
    const pending = await getPendingProjects();
    setPendingProjectsList(pending);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setSyncing(true);
    setSyncCount(0);
    try {
      await syncMetadata(async (project) => {
        // Progressive: update UI as each project is found
        setSyncCount(c => c + 1);
        setProjects(prev => {
          const existing = prev.findIndex(p => p.id === project.id);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = project;
            return updated;
          }
          return [...prev, project];
        });
      });
      // Final reload to ensure consistency
      await loadData();
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setRefreshing(false);
      setSyncing(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    const name = newProjectName.trim();
    try {
      const result = await createProject(name);
      setNewProjectName('');
      setShowNewProject(false);
      // Cache project locally so it appears immediately in the list
      await cacheProject({
        id: result.id,
        folder_name: result.folder_name,
        folder_id: result.folder_id,
        color: '#3b82f6',
        notes: '',
        tags: '[]',
        image_count: 0,
        is_own: true,
        is_starred: false,
        updated_at: new Date().toISOString(),
      });
      // Reload data to show the new project
      await loadData();
      Alert.alert(
        'Projekt erstellt',
        `"${name}" wurde unter Projekte/ auf Google Drive erstellt.`
      );
    } catch (error) {
      Alert.alert('Fehler', error.message);
    }
  };

  // Search: match project name AND tags
  const filteredProjects = projects.filter(p => {
    // Text search: match name or tags
    if (search) {
      const q = search.toLowerCase();
      const nameMatch = p.folder_name.toLowerCase().includes(q);
      let tagMatch = false;
      try {
        const projectTags = JSON.parse(p.tags || '[]');
        tagMatch = projectTags.some(t => {
          const tagName = typeof t === 'string' ? t : t.name || '';
          return tagName.toLowerCase().includes(q);
        });
      } catch {}
      if (!nameMatch && !tagMatch) return false;
    }

    // Tag chip filter
    if (selectedTag) {
      try {
        const projectTags = JSON.parse(p.tags || '[]');
        const hasTag = projectTags.some(t => {
          const tagName = typeof t === 'string' ? t : t.name || '';
          return tagName === selectedTag;
        });
        if (!hasTag) return false;
      } catch { return false; }
    }

    // Starred filter
    if (filterStarred && !p.is_starred) return false;

    // Has images filter
    if (filterHasImages && (!p.image_count || p.image_count === 0)) return false;

    return true;
  });

  // Sort projects
  const sortedProjects = [...filteredProjects].sort((a, b) => {
    switch (sortBy) {
      case 'name_asc': return (a.folder_name || '').localeCompare(b.folder_name || '');
      case 'name_desc': return (b.folder_name || '').localeCompare(a.folder_name || '');
      case 'date_desc': return (b.updated_at || '').localeCompare(a.updated_at || '');
      case 'date_asc': return (a.updated_at || '').localeCompare(b.updated_at || '');
      case 'images_desc': return (b.image_count || 0) - (a.image_count || 0);
      case 'images_asc': return (a.image_count || 0) - (b.image_count || 0);
      default: return 0;
    }
  });

  // Filter pending projects by search
  const filteredPending = pendingProjectsList.filter(p => {
    if (!search) return true;
    return p.folder_name.toLowerCase().includes(search.toLowerCase());
  });

  const renderPendingProject = ({ item }) => (
    <TouchableOpacity
      style={styles.pendingCard}
      onPress={() => navigation.navigate('CameraStack', {
        projectId: item.folder_id,
        projectName: item.folder_name,
        projectFolderId: item.folder_id,
      })}
    >
      <View style={[styles.colorBar, { backgroundColor: colors.accent }]} />
      <View style={styles.projectContent}>
        <View style={styles.projectNameRow}>
          <Text style={styles.projectName} numberOfLines={1}>{item.folder_name}</Text>
          <View style={styles.pendingBadge}>
            <Ionicons name="time-outline" size={11} color={colors.accent} />
            <Text style={styles.pendingBadgeText}>Unbestätigt</Text>
          </View>
        </View>
        <View style={styles.pendingActions}>
          <Text style={styles.pendingHint}>Wartet auf Bestätigung</Text>
          <View style={styles.pendingUploadHint}>
            <Ionicons name="camera-outline" size={12} color={colors.accent} />
            <Text style={styles.pendingUploadText}>Fotos aufnehmen</Text>
          </View>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
    </TouchableOpacity>
  );

  const renderProject = ({ item }) => {
    let projectTags = [];
    try { projectTags = JSON.parse(item.tags || '[]'); } catch {}

    return (
      <TouchableOpacity
        style={styles.projectCard}
        onPress={() => navigation.navigate('ProjectDetail', {
          projectId: item.id,
          projectName: item.folder_name,
          projectFolderId: item.folder_id,
        })}
      >
        <View style={[styles.colorBar, { backgroundColor: item.color || colors.accent }]} />
        <View style={styles.projectContent}>
          <View style={styles.projectNameRow}>
            <Text style={styles.projectName} numberOfLines={1}>{item.folder_name}</Text>
            {item.is_starred ? (
              <Ionicons name="star" size={14} color={colors.warning} />
            ) : null}
          </View>
          <View style={styles.projectMeta}>
            <View style={styles.metaItem}>
              <Ionicons name="images-outline" size={14} color={colors.textTertiary} />
              <Text style={styles.metaText}>{item.image_count || 0}</Text>
            </View>
            {projectTags.length > 0 && (
              <View style={styles.tagRow}>
                {projectTags.slice(0, 3).map((t, i) => {
                  const tagName = typeof t === 'string' ? t : t.name || '';
                  return (
                    <View key={i} style={styles.miniTag}>
                      <Text style={styles.miniTagText} numberOfLines={1}>{tagName}</Text>
                    </View>
                  );
                })}
                {projectTags.length > 3 && (
                  <Text style={styles.metaText}>+{projectTags.length - 3}</Text>
                )}
              </View>
            )}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
      </TouchableOpacity>
    );
  };

  const activeFilters = (filterStarred ? 1 : 0) + (filterHasImages ? 1 : 0);
  const currentSort = SORT_OPTIONS.find(s => s.key === sortBy);

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Projekte oder Tags suchen..."
          placeholderTextColor={colors.textTertiary}
          value={search}
          onChangeText={setSearch}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Sort & Filter Bar */}
      <View style={styles.sortFilterBar}>
        <TouchableOpacity
          style={styles.sortButton}
          onPress={() => setShowSortMenu(true)}
        >
          <Ionicons name={currentSort?.icon || 'swap-vertical'} size={16} color={colors.accent} />
          <Text style={styles.sortButtonText}>{currentSort?.label || 'Sortieren'}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.accent} />
        </TouchableOpacity>

        <View style={styles.filterButtons}>
          <TouchableOpacity
            style={[styles.filterChip, filterStarred && styles.filterChipActive]}
            onPress={() => setFilterStarred(!filterStarred)}
          >
            <Ionicons
              name={filterStarred ? 'star' : 'star-outline'}
              size={14}
              color={filterStarred ? colors.warning : colors.textTertiary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, filterHasImages && styles.filterChipActive]}
            onPress={() => setFilterHasImages(!filterHasImages)}
          >
            <Ionicons
              name={filterHasImages ? 'images' : 'images-outline'}
              size={14}
              color={filterHasImages ? colors.accent : colors.textTertiary}
            />
          </TouchableOpacity>
          {/* Sync Button */}
          <TouchableOpacity
            style={[styles.filterChip, syncing && styles.filterChipActive]}
            onPress={handleRefresh}
            disabled={syncing}
          >
            <Ionicons
              name="sync-outline"
              size={14}
              color={syncing ? colors.accent : colors.textTertiary}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tags Filter */}
      {tags.length > 0 && (
        <FlatList
          horizontal
          data={tags}
          keyExtractor={t => String(t.id)}
          contentContainerStyle={styles.tagList}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.tagChip,
                selectedTag === item.name && { backgroundColor: item.color, borderColor: item.color }
              ]}
              onPress={() => setSelectedTag(selectedTag === item.name ? null : item.name)}
            >
              <Text style={[
                styles.tagText,
                selectedTag === item.name && { color: 'white' }
              ]}>
                {item.name}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Sync progress */}
      {syncing && (
        <View style={styles.syncBar}>
          <Text style={styles.syncText}>Synchronisiere... {syncCount} Projekte gefunden</Text>
        </View>
      )}

      {/* New Project */}
      {showNewProject && (
        <View style={styles.newProjectForm}>
          <TextInput
            style={styles.newProjectInput}
            placeholder="Projektname"
            placeholderTextColor={colors.textTertiary}
            value={newProjectName}
            onChangeText={setNewProjectName}
            autoFocus
            onSubmitEditing={handleCreateProject}
          />
          <TouchableOpacity style={styles.createBtn} onPress={handleCreateProject}>
            <Ionicons name="checkmark" size={20} color="white" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowNewProject(false)}>
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Project List */}
      <FlatList
        data={sortedProjects}
        keyExtractor={p => String(p.id)}
        renderItem={renderProject}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing && !syncing} onRefresh={handleRefresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <>
            {/* Pending Projects Section */}
            {filteredPending.length > 0 && (
              <View style={styles.pendingSection}>
                <Text style={styles.pendingSectionTitle}>Warte auf Bestätigung</Text>
                {filteredPending.map(item => (
                  <View key={`pending-${item.id}`}>
                    {renderPendingProject({ item })}
                  </View>
                ))}
              </View>
            )}
            {sortedProjects.length > 0 ? (
              <Text style={styles.resultCount}>{sortedProjects.length} Projekte</Text>
            ) : null}
          </>
        }
        ListEmptyComponent={
          !syncing && filteredPending.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="folder-open-outline" size={48} color={colors.textTertiary} />
              <Text style={styles.emptyText}>
                {search || selectedTag || filterStarred || filterHasImages
                  ? 'Keine Projekte gefunden'
                  : 'Keine Projekte vorhanden'}
              </Text>
            </View>
          ) : null
        }
      />

      {/* FAB - New Project */}
      {isConnected && !showNewProject && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => setShowNewProject(true)}
        >
          <Ionicons name="add" size={28} color="white" />
        </TouchableOpacity>
      )}

      {/* Sort Modal */}
      <Modal
        visible={showSortMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSortMenu(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowSortMenu(false)}
        >
          <View style={styles.sortModal}>
            <Text style={styles.sortModalTitle}>Sortieren nach</Text>
            {SORT_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.sortOption, sortBy === opt.key && styles.sortOptionActive]}
                onPress={() => { setSortBy(opt.key); setShowSortMenu(false); }}
              >
                <Ionicons name={opt.icon} size={18} color={sortBy === opt.key ? colors.accent : colors.textSecondary} />
                <Text style={[styles.sortOptionText, sortBy === opt.key && styles.sortOptionTextActive]}>
                  {opt.label}
                </Text>
                {sortBy === opt.key && <Ionicons name="checkmark" size={18} color={colors.accent} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardBg,
    borderRadius: 10, margin: 16, marginBottom: 8, paddingHorizontal: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, padding: 12, fontSize: 15, color: colors.textPrimary },

  // Sort & Filter
  sortFilterBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, marginBottom: 4,
  },
  sortButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8,
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
  },
  sortButtonText: { fontSize: 12, color: colors.accent, fontWeight: '500' },
  filterButtons: { flexDirection: 'row', gap: 8 },
  filterChip: {
    width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
  },
  filterChipActive: { borderColor: colors.accent, backgroundColor: colors.bgTertiary },

  // Tags
  tagList: { paddingHorizontal: 16, paddingBottom: 4, paddingTop: 4, gap: 8 },
  tagChip: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardBg, marginRight: 8,
  },
  tagText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },

  // Sync progress
  syncBar: {
    paddingHorizontal: 16, paddingVertical: 8,
  },
  syncText: { fontSize: 12, color: colors.accent, fontWeight: '500' },

  // List
  list: { padding: 16, paddingTop: 4 },
  resultCount: { fontSize: 12, color: colors.textTertiary, marginBottom: 8 },

  // Pending section
  pendingSection: {
    marginBottom: 16,
  },
  pendingSectionTitle: {
    fontSize: 13, fontWeight: '600', color: colors.accent,
    marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  pendingCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardBg,
    borderRadius: 12, marginBottom: 10, padding: 16, borderWidth: 1,
    borderColor: colors.accent + '40',
  },
  pendingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
    backgroundColor: colors.accent + '20',
  },
  pendingBadgeText: { fontSize: 11, color: colors.accent, fontWeight: '600' },
  pendingActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  pendingHint: { fontSize: 12, color: colors.textTertiary },
  pendingUploadHint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pendingUploadText: { fontSize: 12, color: colors.accent, fontWeight: '500' },

  // Project card
  projectCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardBg,
    borderRadius: 12, marginBottom: 10, padding: 16, borderWidth: 1, borderColor: colors.border,
  },
  colorBar: { width: 4, height: 40, borderRadius: 2, marginRight: 14 },
  projectContent: { flex: 1 },
  projectNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  projectName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  projectMeta: { flexDirection: 'row', gap: 12, marginTop: 4, alignItems: 'center' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: colors.textTertiary },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniTag: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
    backgroundColor: colors.bgTertiary,
  },
  miniTagText: { fontSize: 11, color: colors.textSecondary, maxWidth: 60 },

  // Empty state
  empty: { alignItems: 'center', paddingTop: 64, gap: 12 },
  emptyText: { color: colors.textTertiary, fontSize: 15 },

  // New project
  newProjectForm: { flexDirection: 'row', alignItems: 'center', margin: 16, marginTop: 0, gap: 8 },
  newProjectInput: {
    flex: 1, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, padding: 12, fontSize: 15, color: colors.textPrimary,
  },
  createBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.bgTertiary, alignItems: 'center', justifyContent: 'center' },

  // FAB
  fab: {
    position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },

  // Sort Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center',
  },
  sortModal: {
    backgroundColor: colors.cardBg, borderRadius: 16, padding: 20, width: '80%',
    borderWidth: 1, borderColor: colors.border,
  },
  sortModalTitle: {
    fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: 16,
  },
  sortOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sortOptionActive: {},
  sortOptionText: { flex: 1, fontSize: 15, color: colors.textSecondary },
  sortOptionTextActive: { color: colors.accent, fontWeight: '600' },
});
