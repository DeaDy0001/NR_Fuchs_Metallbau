import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl, Image, Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { getRecentPhotos } from '../services/database';
import { syncMetadata } from '../services/syncService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PHOTO_COLUMNS = 3;
const PHOTO_GAP = 3;
const PHOTO_SIZE = Math.floor((SCREEN_WIDTH - 32 - (PHOTO_COLUMNS - 1) * PHOTO_GAP) / PHOTO_COLUMNS);

export default function HomeScreen({ navigation }) {
  const { userName, queueCount, activeConnection } = useApp();
  const [recentPhotos, setRecentPhotos] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    try {
      const photos = await getRecentPhotos(18);
      setRecentPhotos(photos);
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
            <View style={[styles.statusBar, styles.statusConnected]}>
              <Ionicons name="cloud-done" size={16} color={colors.success} />
              <Text style={[styles.statusText, { color: colors.success }]}>
                {activeConnection?.name || 'Google Drive'}
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
                onPress={() => navigation.navigate('UploadQueue')}
              >
                <View style={[styles.actionIcon, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                  <Ionicons name="cloud-upload" size={28} color={colors.warning} />
                  {queueCount > 0 && (
                    <View style={styles.queueBadge}>
                      <Text style={styles.queueBadgeText}>{queueCount > 99 ? '99+' : queueCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.actionLabel}>Warteschlange</Text>
              </TouchableOpacity>
            </View>

            {/* Recent Photos */}
            {recentPhotos.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Letzte Fotos</Text>
                </View>
                <View style={styles.photoGrid}>
                  {recentPhotos.map((photo, index) => (
                    <TouchableOpacity
                      key={photo.id}
                      style={styles.photoCard}
                      onPress={() => navigation.navigate('ImageView', {
                        localUri: photo.thumbnail_uri || photo.file_uri,
                        imageName: photo.file_name,
                        projectName: photo.project_name,
                      })}
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
                    </TouchableOpacity>
                  ))}
                </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
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
  queueBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(245, 158, 11, 0.1)', borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)', borderRadius: 10,
    padding: 12, marginHorizontal: 16, marginBottom: 8,
  },
  queueInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  queueText: { color: colors.warning, fontSize: 14, fontWeight: '500' },
  actions: { flexDirection: 'row', padding: 16, gap: 12 },
  actionButton: { flex: 1, alignItems: 'center', gap: 8 },
  actionIcon: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  queueBadge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: colors.error, borderRadius: 10,
    minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  queueBadgeText: { color: 'white', fontSize: 10, fontWeight: '700' },
  section: { padding: 16, paddingTop: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },

  // Photo grid
  photoGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: PHOTO_GAP,
  },
  photoCard: {
    width: PHOTO_SIZE, height: PHOTO_SIZE,
    borderRadius: 8, overflow: 'hidden',
    backgroundColor: colors.cardBg,
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

  emptyState: { alignItems: 'center', justifyContent: 'center', padding: 48, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: colors.textPrimary },
  emptyText: { fontSize: 14, color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
});
