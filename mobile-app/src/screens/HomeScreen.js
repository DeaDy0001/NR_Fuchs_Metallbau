import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl, Image, Dimensions, ActivityIndicator } from 'react-native';
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
const PAGE_SIZE = 18;

export default function HomeScreen({ navigation }) {
  const { userName, activeConnection } = useApp();
  const [recentPhotos, setRecentPhotos] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(1);

  useFocusEffect(
    useCallback(() => {
      loadData();
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

            {/* Recent Photos */}
            {recentPhotos.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Letzte Fotos</Text>
                  <Text style={styles.photoCount}>{recentPhotos.length} Fotos</Text>
                </View>
                <View style={styles.photoGrid}>
                  {recentPhotos.map((photo) => (
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

                {/* Load More */}
                {hasMore && (
                  <TouchableOpacity
                    style={styles.loadMoreBtn}
                    onPress={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <>
                        <Ionicons name="chevron-down" size={18} color={colors.accent} />
                        <Text style={styles.loadMoreText}>Mehr laden</Text>
                      </>
                    )}
                  </TouchableOpacity>
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

  // Load more
  loadMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 16, paddingVertical: 12,
    backgroundColor: colors.cardBg, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  loadMoreText: { fontSize: 14, color: colors.accent, fontWeight: '600' },

  emptyState: { alignItems: 'center', justifyContent: 'center', padding: 48, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: colors.textPrimary },
  emptyText: { fontSize: 14, color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
});
