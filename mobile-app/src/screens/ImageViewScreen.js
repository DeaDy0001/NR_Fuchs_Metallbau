import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Image, Dimensions, TouchableOpacity,
  ActivityIndicator, FlatList, Animated, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { downloadFullImage } from '../services/syncService';
import { getImageUrl } from '../services/api';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const IMAGE_HEIGHT = SCREEN_HEIGHT - 110;

// Calculate distance between two touch points
function getDistance(touches) {
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

// Single zoomable image using PanResponder + Animated (works on Android & iOS)
function ZoomableImage({ imageId, localUri, isActive }) {
  const [imageUri, setImageUri] = useState(localUri || null);
  const [imageHeaders, setImageHeaders] = useState(null);
  const [loading, setLoading] = useState(!localUri);

  // Zoom & pan state
  const scaleVal = useRef(new Animated.Value(1)).current;
  const translateXVal = useRef(new Animated.Value(0)).current;
  const translateYVal = useRef(new Animated.Value(0)).current;

  const currentScale = useRef(1);
  const currentTranslateX = useRef(0);
  const currentTranslateY = useRef(0);
  const initialPinchDistance = useRef(0);
  const pinchStartScale = useRef(1);
  const lastTapTime = useRef(0);
  const isPinching = useRef(false);
  const panStartX = useRef(0);
  const panStartY = useRef(0);

  useEffect(() => {
    if (isActive && !imageUri && imageId) {
      loadImage();
    }
  }, [isActive]);

  // Reset zoom when becoming inactive
  useEffect(() => {
    if (isActive) {
      resetZoom(false);
    }
  }, [isActive]);

  const loadImage = async () => {
    if (!imageId) return;
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

  const resetZoom = (animate = true) => {
    currentScale.current = 1;
    currentTranslateX.current = 0;
    currentTranslateY.current = 0;
    if (animate) {
      Animated.parallel([
        Animated.timing(scaleVal, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(translateXVal, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(translateYVal, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      scaleVal.setValue(1);
      translateXVal.setValue(0);
      translateYVal.setValue(0);
    }
  };

  const zoomTo = (targetScale, focalX, focalY) => {
    currentScale.current = targetScale;
    const offsetX = -(focalX - SCREEN_WIDTH / 2) * (targetScale - 1) / targetScale;
    const offsetY = -(focalY - IMAGE_HEIGHT / 2) * (targetScale - 1) / targetScale;
    currentTranslateX.current = offsetX;
    currentTranslateY.current = offsetY;
    Animated.parallel([
      Animated.timing(scaleVal, { toValue: targetScale, duration: 200, useNativeDriver: true }),
      Animated.timing(translateXVal, { toValue: offsetX, duration: 200, useNativeDriver: true }),
      Animated.timing(translateYVal, { toValue: offsetY, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only claim the gesture if zoomed in (for panning) or if 2 fingers (for pinching)
        return currentScale.current > 1 || Math.abs(gestureState.dx) > 2 || Math.abs(gestureState.dy) > 2;
      },

      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          isPinching.current = true;
          initialPinchDistance.current = getDistance(touches);
          pinchStartScale.current = currentScale.current;
        } else {
          isPinching.current = false;
          panStartX.current = currentTranslateX.current;
          panStartY.current = currentTranslateY.current;
        }
      },

      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;

        if (touches.length === 2) {
          // Pinch zoom
          if (!isPinching.current) {
            isPinching.current = true;
            initialPinchDistance.current = getDistance(touches);
            pinchStartScale.current = currentScale.current;
            return;
          }

          const currentDistance = getDistance(touches);
          const pinchRatio = currentDistance / initialPinchDistance.current;
          const newScale = Math.max(1, Math.min(pinchStartScale.current * pinchRatio, 6));

          currentScale.current = newScale;
          scaleVal.setValue(newScale);
        } else if (currentScale.current > 1 && !isPinching.current) {
          // Pan when zoomed in
          const newX = panStartX.current + gestureState.dx;
          const newY = panStartY.current + gestureState.dy;

          currentTranslateX.current = newX;
          currentTranslateY.current = newY;
          translateXVal.setValue(newX);
          translateYVal.setValue(newY);
        }
      },

      onPanResponderRelease: (evt) => {
        isPinching.current = false;

        // Snap back to 1 if barely zoomed
        if (currentScale.current < 1.15) {
          resetZoom(true);
          return;
        }

        // Double tap detection
        const now = Date.now();
        const touches = evt.nativeEvent.changedTouches;
        if (touches.length === 1 && Math.abs(evt.nativeEvent.locationX) < SCREEN_WIDTH) {
          if (now - lastTapTime.current < 300) {
            // Double tap
            if (currentScale.current > 1.5) {
              resetZoom(true);
            } else {
              zoomTo(3, touches[0].pageX, touches[0].pageY);
            }
            lastTapTime.current = 0;
            return;
          }
          lastTapTime.current = now;
        }

        // Clamp translation so image doesn't fly off screen
        const maxTransX = (SCREEN_WIDTH * (currentScale.current - 1)) / 2;
        const maxTransY = (IMAGE_HEIGHT * (currentScale.current - 1)) / 2;
        let clampedX = Math.max(-maxTransX, Math.min(maxTransX, currentTranslateX.current));
        let clampedY = Math.max(-maxTransY, Math.min(maxTransY, currentTranslateY.current));

        if (clampedX !== currentTranslateX.current || clampedY !== currentTranslateY.current) {
          currentTranslateX.current = clampedX;
          currentTranslateY.current = clampedY;
          Animated.parallel([
            Animated.timing(translateXVal, { toValue: clampedX, duration: 150, useNativeDriver: true }),
            Animated.timing(translateYVal, { toValue: clampedY, duration: 150, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

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
    <View style={styles.imagePage} {...panResponder.panHandlers}>
      <Animated.Image
        source={
          imageHeaders
            ? { uri: imageUri, headers: imageHeaders }
            : { uri: imageUri }
        }
        style={[
          styles.image,
          {
            transform: [
              { translateX: translateXVal },
              { translateY: translateYVal },
              { scale: scaleVal },
            ],
          },
        ]}
        resizeMode="contain"
      />
    </View>
  );
}

export default function ImageViewScreen({ route, navigation }) {
  const { imageId, imageName, projectName, images, initialIndex, localUri } = route.params;
  const [currentIndex, setCurrentIndex] = useState(initialIndex || 0);

  // Single image mode (no images array)
  const imageList = images || [{ id: imageId, name: imageName, localUri }];
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
          localUri={imageList[0].localUri}
          isActive={true}
        />
      ) : (
        <FlatList
          data={imageList}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => String(item.id || item.localUri)}
          initialScrollIndex={initialIndex || 0}
          getItemLayout={getItemLayout}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          renderItem={({ item, index }) => (
            <ZoomableImage
              imageId={item.id}
              localUri={item.localUri}
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
    overflow: 'hidden',
  },
  image: { width: SCREEN_WIDTH, height: IMAGE_HEIGHT },
  loadingText: { color: colors.textTertiary, fontSize: 14 },
});
