import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Dimensions, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { fetchProjectImages, getImageUrl } from '../services/api';
import { getSetting } from '../services/database';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const NUM_COLUMNS = 3;
const IMAGE_SIZE = (SCREEN_WIDTH - 32 - (NUM_COLUMNS - 1) * 4) / NUM_COLUMNS;

export default function ProjectDetailScreen({ navigation, route }) {
  const { projectId, projectName } = route.params;
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [authToken, setAuthToken] = useState('');

  useFocusEffect(
    useCallback(() => {
      loadImages();
      loadServerInfo();
    }, [])
  );

  const loadServerInfo = async () => {
    const url = await getSetting('serverUrl', '');
    const token = await getSetting('authToken', '');
    setServerUrl(url);
    setAuthToken(token);
  };

  const loadImages = async () => {
    try {
      const data = await fetchProjectImages(projectId);
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

  const getThumbnailUrl = (image) => {
    if (!serverUrl || !image.thumbnail_url) return null;
    return `${serverUrl}${image.thumbnail_url}`;
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
      {getThumbnailUrl(item) ? (
        <Image
          source={{
            uri: getThumbnailUrl(item),
            headers: { 'X-Mobile-Token': authToken },
          }}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.thumbnail, styles.placeholderThumb]}>
          <Ionicons name="image-outline" size={24} color={colors.textTertiary} />
        </View>
      )}
      {item.uploaded_by && (
        <View style={styles.uploadedByBadge}>
          <Text style={styles.uploadedByText}>{item.uploaded_by}</Text>
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
        onPress={() => navigation.navigate('Camera', { projectId, projectName })}
      >
        <Ionicons name="camera" size={28} color="white" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  imageCount: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  grid: {
    padding: 14,
  },
  imageCard: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    margin: 2,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.cardBg,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  placeholderThumb: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
  },
  uploadedByBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  uploadedByText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '500',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 15,
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
