import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { getCachedProjects, getQueuedUploads } from '../services/database';
import { syncMetadata } from '../services/syncService';

export default function HomeScreen({ navigation }) {
  const { isConnected, userName, queueCount } = useApp();
  const [recentProjects, setRecentProjects] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    try {
      const projects = await getCachedProjects();
      setRecentProjects(projects.slice(0, 5));
    } catch (error) {
      console.error('Failed to load home data:', error);
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

  return (
    <View style={styles.container}>
      <FlatList
        data={[]}
        renderItem={null}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleSync} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <>
            {/* Connection Status */}
            <View style={[styles.statusBar, isConnected ? styles.statusConnected : styles.statusDisconnected]}>
              <Ionicons
                name={isConnected ? 'cloud-done' : 'cloud-offline'}
                size={16}
                color={isConnected ? colors.success : colors.error}
              />
              <Text style={[styles.statusText, { color: isConnected ? colors.success : colors.error }]}>
                {isConnected ? 'Verbunden' : 'Nicht verbunden'}
              </Text>
              {userName ? (
                <Text style={styles.statusUser}>{userName}</Text>
              ) : null}
            </View>

            {/* Upload Queue */}
            {queueCount > 0 && (
              <TouchableOpacity style={styles.queueBanner} onPress={() => navigation.navigate('UploadQueue')}>
                <View style={styles.queueInfo}>
                  <Ionicons name="cloud-upload" size={20} color={colors.warning} />
                  <Text style={styles.queueText}>
                    {queueCount} {queueCount === 1 ? 'Bild' : 'Bilder'} in der Warteschlange
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            )}

            {/* Quick Actions */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => navigation.navigate('Camera')}
              >
                <View style={[styles.actionIcon, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                  <Ionicons name="camera" size={28} color={colors.accent} />
                </View>
                <Text style={styles.actionLabel}>Foto aufnehmen</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => navigation.navigate('Camera', { pickFromGallery: true })}
              >
                <View style={[styles.actionIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                  <Ionicons name="images" size={28} color={colors.success} />
                </View>
                <Text style={styles.actionLabel}>Galerie</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => navigation.navigate('Projects')}
              >
                <View style={[styles.actionIcon, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                  <Ionicons name="folder" size={28} color={colors.warning} />
                </View>
                <Text style={styles.actionLabel}>Projekte</Text>
              </TouchableOpacity>
            </View>

            {/* Recent Projects */}
            {recentProjects.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Letzte Projekte</Text>
                  <TouchableOpacity onPress={() => navigation.navigate('Projects')}>
                    <Text style={styles.seeAllText}>Alle anzeigen</Text>
                  </TouchableOpacity>
                </View>
                {recentProjects.map(project => (
                  <TouchableOpacity
                    key={project.id}
                    style={styles.projectItem}
                    onPress={() => navigation.navigate('ProjectDetail', { projectId: project.id, projectName: project.folder_name })}
                  >
                    <View style={[styles.projectColor, { backgroundColor: project.color || colors.accent }]} />
                    <View style={styles.projectInfo}>
                      <Text style={styles.projectName}>{project.folder_name}</Text>
                      <Text style={styles.projectMeta}>{project.image_count || 0} Bilder</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {recentProjects.length === 0 && (
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    margin: 16,
    marginBottom: 8,
    borderRadius: 10,
    gap: 8,
  },
  statusConnected: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  statusDisconnected: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  statusUser: {
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: 'auto',
  },
  queueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  queueInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  queueText: {
    color: colors.warning,
    fontSize: 14,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  actionIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  section: {
    padding: 16,
    paddingTop: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  seeAllText: {
    fontSize: 14,
    color: colors.accent,
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBg,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  projectColor: {
    width: 4,
    height: 36,
    borderRadius: 2,
    marginRight: 12,
  },
  projectInfo: {
    flex: 1,
  },
  projectName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  projectMeta: {
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
