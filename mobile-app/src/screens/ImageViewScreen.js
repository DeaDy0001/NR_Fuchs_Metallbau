import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Image, Dimensions, TouchableOpacity,
  ActivityIndicator, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  GestureDetector, Gesture, GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, runOnJS,
} from 'react-native-reanimated';
import { colors } from '../theme/colors';
import { downloadFullImage } from '../services/syncService';
import { getImageUrl } from '../services/api';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Single zoomable image component
function ZoomableImage({ imageId, imageName, isActive }) {
  const [imageUri, setImageUri] = useState(null);
  const [imageHeaders, setImageHeaders] = useState(null);
  const [loading, setLoading] = useState(true);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

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

  const resetZoom = () => {
    scale.value = withTiming(1);
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedScale.value = 1;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  // Pinch gesture for zoom
  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(savedScale.value * e.scale, 8));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value < 1.1) {
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  // Pan gesture for moving when zoomed
  const panGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(2)
    .onUpdate((e) => {
      if (scale.value > 1) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  // Double tap to zoom in/out
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.value > 1.5) {
        // Zoom out
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        // Zoom in to 3x at tap position
        const targetScale = 3;
        scale.value = withTiming(targetScale);
        savedScale.value = targetScale;
        // Center on tap point
        const focalX = e.x - SCREEN_WIDTH / 2;
        const focalY = e.y - SCREEN_HEIGHT / 2;
        translateX.value = withTiming(-focalX * (targetScale - 1) / targetScale);
        translateY.value = withTiming(-focalY * (targetScale - 1) / targetScale);
        savedTranslateX.value = -focalX * (targetScale - 1) / targetScale;
        savedTranslateY.value = -focalY * (targetScale - 1) / targetScale;
      }
    });

  const composedGesture = Gesture.Simultaneous(
    pinchGesture,
    panGesture,
    doubleTapGesture,
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // Reset zoom when swiping to this image
  useEffect(() => {
    if (isActive) {
      resetZoom();
    }
  }, [isActive]);

  if (loading) {
    return (
      <View style={styles.imagePage}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Bild wird geladen...</Text>
        </View>
      </View>
    );
  }

  if (!imageUri) {
    return (
      <View style={styles.imagePage}>
        <View style={styles.loadingContainer}>
          <Ionicons name="image-outline" size={64} color={colors.textTertiary} />
          <Text style={styles.loadingText}>Bild konnte nicht geladen werden</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.imagePage}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[styles.imageContainer, animatedStyle]}>
          <Image
            source={
              imageHeaders
                ? { uri: imageUri, headers: imageHeaders }
                : { uri: imageUri }
            }
            style={styles.image}
            resizeMode="contain"
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export default function ImageViewScreen({ route, navigation }) {
  const { imageId, imageName, projectName, localUri, images, initialIndex } = route.params;
  const [currentIndex, setCurrentIndex] = useState(initialIndex || 0);
  const flatListRef = useRef(null);

  // Single image mode (no images array)
  const imageList = images || [{ id: imageId, name: imageName }];

  const currentImage = imageList[currentIndex] || imageList[0];

  const onViewableItemsChanged = useCallback(({ viewableItems }) => {
    if (viewableItems.length > 0) {
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
    <GestureHandlerRootView style={styles.container}>
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
          imageName={imageList[0].name}
          isActive={true}
        />
      ) : (
        <FlatList
          ref={flatListRef}
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
              imageName={item.name}
              isActive={index === currentIndex}
            />
          )}
        />
      )}
    </GestureHandlerRootView>
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
  imagePage: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT - 100, justifyContent: 'center', alignItems: 'center' },
  imageContainer: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT - 100, justifyContent: 'center', alignItems: 'center' },
  image: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT - 100 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: colors.textTertiary, fontSize: 14 },
});
