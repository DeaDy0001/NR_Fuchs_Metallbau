import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Image, Dimensions, TouchableOpacity,
  ActivityIndicator, FlatList, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { downloadFullImage } from '../services/syncService';
import { getImageUrl } from '../services/api';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const IMAGE_HEIGHT = SCREEN_HEIGHT - 110;

// Single zoomable image using ScrollView (no external libraries needed)
function ZoomableImage({ imageId, isActive }) {
  const [imageUri, setImageUri] = useState(null);
  const [imageHeaders, setImageHeaders] = useState(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (isActive && !imageUri) {
      loadImage();
    }
  }, [isActive]);

  const loadImage = async () => {
    try {
      const localPath = await downloadFullImage(imageId);
      setImageUri(localPath);
    } catch {
      try {
        const source = await getImageUrl(imageId);
        if (source) {
          setImageUri(source.uri);
          setImageHeaders(source.headers);
        }
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  // Double tap to toggle zoom
  const lastTap = useRef(0);
  const handleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      // Double tap - toggle zoom
      if (scrollRef.current) {
        scrollRef.current.scrollResponderZoomTo({
          x: 0, y: 0,
          width: SCREEN_WIDTH,
          height: IMAGE_HEIGHT,
          animated: true,
        });
      }
    }
    lastTap.current = now;
  };

  if (loading) {
    return (
      <View style={styles.imagePage}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Bild wird geladen...</Text>
      </View>
    );
  }

  if (!imageUri) {
    return (
      <View style={styles.imagePage}>
        <Ionicons name="image-outline" size={64} color={colors.textTertiary} />
        <Text style={styles.loadingText}>Bild konnte nicht geladen werden</Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.imagePageScroll}
      contentContainerStyle={styles.scrollContent}
      maximumZoomScale={6}
      minimumZoomScale={1}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      bouncesZoom={true}
      centerContent={true}
      onTouchEnd={handleTap}
    >
      <Image
        source={
          imageHeaders
            ? { uri: imageUri, headers: imageHeaders }
            : { uri: imageUri }
        }
        style={styles.image}
        resizeMode="contain"
      />
    </ScrollView>
  );
}

export default function ImageViewScreen({ route, navigation }) {
  const { imageId, imageName, projectName, localUri, images, initialIndex } = route.params;
  const [currentIndex, setCurrentIndex] = useState(initialIndex || 0);

  // Single image mode (no images array)
  const imageList = images || [{ id: imageId, name: imageName }];
  const currentImage = imageList[currentIndex] || imageList[0];

  const onViewableItemsChanged = useCallback(({ viewableItems }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      setCurrentIndex(viewableItems[0].index);
    }
  }, []);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  const getItemLayout = useCallback((_, index) => ({
    length: SCREEN_WIDTH,
    offset: SCREEN_WIDTH * index,
    index,
  }), []);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>{currentImage?.name || 'Bild'}</Text>
          <Text style={styles.headerSubtitle}>
            {projectName ? `${projectName} · ` : ''}{currentIndex + 1} / {imageList.length}
          </Text>
        </View>
      </View>

      {/* Image Swiper */}
      {imageList.length === 1 ? (
        <ZoomableImage
          imageId={imageList[0].id}
          isActive={true}
        />
      ) : (
        <FlatList
          data={imageList}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => String(item.id)}
          initialScrollIndex={initialIndex || 0}
          getItemLayout={getItemLayout}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          renderItem={({ item, index }) => (
            <ZoomableImage
              imageId={item.id}
              isActive={Math.abs(index - currentIndex) <= 1}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 48, paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.8)', gap: 12, zIndex: 10,
  },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerInfo: { flex: 1 },
  headerTitle: { color: 'white', fontSize: 16, fontWeight: '600' },
  headerSubtitle: { color: colors.textTertiary, fontSize: 13, marginTop: 2 },
  imagePage: {
    width: SCREEN_WIDTH, height: IMAGE_HEIGHT,
    justifyContent: 'center', alignItems: 'center', gap: 12,
  },
  imagePageScroll: { width: SCREEN_WIDTH, height: IMAGE_HEIGHT },
  scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  image: { width: SCREEN_WIDTH, height: IMAGE_HEIGHT },
  loadingText: { color: colors.textTertiary, fontSize: 14 },
});
