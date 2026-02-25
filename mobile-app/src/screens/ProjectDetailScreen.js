import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Dimensions, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { fetchProjectImages, getImageUrl } from '../services/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const NUM_COLUMNS = 3;
const IMAGE_SIZE = (SCREEN_WIDTH - 32 - (NUM_COLUMNS - 1) * 4) / NUM_COLUMNS;

export default function ProjectDetailScreen({ navigation, route }) {
  const { projectId, projectName, projectFolderId } = route.params;
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [imageAuth, setImageAuth] = useState(null);

  useFocusEffect(
    useCallback(() => {
      loadImages();
      loadImageAuth();
    }, [])
  );

  const loadImageAuth = async () => {
    // Get auth headers for Drive image access
    try {
      const source = await getImageUrl('dummy');
      if (source) {
        setImageAuth(source.headers);
      }
    } catch {}
  };

  const loadImages = async () => {
    try {
      // Use folder_id from the project to list images
      const folderId = projectFolderId;
      if (!folderId) {
        console.log('[Fuchs] No folder_id for project', projectName);
        setImages([]);
        setLoading(false);
        return;
      }
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
    setRefreshing(false);
  };

  const renderImage = ({ item }) => (
    <TouchableOpacity
      style={styles.imageCard}
      onPress={() => navigation.navigate('ImageView', {
        imageId: item.id,
        imageName: item.name,
        projectName,
      })}
    >
      {item.thumbnail_link ? (
        <Image
          source={{
            uri: item.thumbnail_link,
            headers: imageAuth || {},
          }}
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
          <View style={styles.header}>
            <Text style={styles.imageCount}>
              {images.length} {images.length === 1 ? 'Bild' : 'Bilder'}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="images-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyText}>Keine Bilder in diesem Projekt</Text>
          </View>
        }
      />

      {/* FAB - Take photo for this project */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('Camera', { projectId, projectName, projectFolderId })}
      >
        <Ionicons name="camera" size={28} color="white" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  loadingContainer: { flex: 1, backgroundColor: colors.bgPrimary, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  imageCount: { color: colors.textSecondary, fontSize: 14 },
  grid: { padding: 14 },
  imageCard: {
    width: IMAGE_SIZE, height: IMAGE_SIZE, margin: 2,
    borderRadius: 8, overflow: 'hidden', backgroundColor: colors.cardBg,
  },
  thumbnail: { width: '100%', height: '100%' },
  placeholderThumb: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgTertiary },
  empty: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyText: { color: colors.textTertiary, fontSize: 15 },
  fab: {
    position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
});
