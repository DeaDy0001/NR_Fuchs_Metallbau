import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, RefreshControl, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { getCachedProjects, getCachedTags } from '../services/database';
import { syncMetadata } from '../services/syncService';
import { createProject } from '../services/api';
import { useApp } from '../contexts/AppContext';

export default function ProjectsScreen({ navigation }) {
  const { isConnected } = useApp();
  const [projects, setProjects] = useState([]);
  const [tags, setTags] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    const p = await getCachedProjects();
    const t = await getCachedTags();
    setProjects(p);
    setTags(t);
  };

  const handleRefresh = async () => {
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

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    try {
      await createProject(newProjectName.trim());
      Alert.alert(
        'Projekt erstellt',
        `"${newProjectName.trim()}" wurde erstellt und wartet auf Bestätigung in der Desktop-Software.`
      );
      setNewProjectName('');
      setShowNewProject(false);
    } catch (error) {
      Alert.alert('Fehler', error.message);
    }
  };

  const filteredProjects = projects.filter(p => {
    const matchesSearch = !search || p.folder_name.toLowerCase().includes(search.toLowerCase());
    const matchesTag = !selectedTag || (p.tags && JSON.parse(p.tags || '[]').includes(selectedTag));
    return matchesSearch && matchesTag;
  });

  const renderProject = ({ item }) => (
    <TouchableOpacity
      style={styles.projectCard}
      onPress={() => navigation.navigate('ProjectDetail', {
        projectId: item.id,
        projectName: item.folder_name,
      })}
    >
      <View style={[styles.colorBar, { backgroundColor: item.color || colors.accent }]} />
      <View style={styles.projectContent}>
        <Text style={styles.projectName}>{item.folder_name}</Text>
        <View style={styles.projectMeta}>
          <View style={styles.metaItem}>
            <Ionicons name="images-outline" size={14} color={colors.textTertiary} />
            <Text style={styles.metaText}>{item.image_count || 0}</Text>
          </View>
          {item.tags && JSON.parse(item.tags || '[]').length > 0 && (
            <View style={styles.metaItem}>
              <Ionicons name="pricetags-outline" size={14} color={colors.textTertiary} />
              <Text style={styles.metaText}>{JSON.parse(item.tags).length}</Text>
            </View>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Projekte suchen..."
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
        data={filteredProjects}
        keyExtractor={p => String(p.id)}
        renderItem={renderProject}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="folder-open-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyText}>
              {search ? 'Keine Projekte gefunden' : 'Keine Projekte vorhanden'}
            </Text>
          </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBg,
    borderRadius: 10,
    margin: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    padding: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },
  tagList: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  tagChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBg,
    marginRight: 8,
  },
  tagText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  list: {
    padding: 16,
    paddingTop: 8,
  },
  projectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBg,
    borderRadius: 12,
    marginBottom: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  colorBar: {
    width: 4,
    height: 40,
    borderRadius: 2,
    marginRight: 14,
  },
  projectContent: {
    flex: 1,
  },
  projectName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  projectMeta: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 64,
    gap: 12,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 15,
  },
  newProjectForm: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    marginTop: 0,
    gap: 8,
  },
  newProjectInput: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },
  createBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
});
