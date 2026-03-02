import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Image, Dimensions, TouchableOpacity,
  ActivityIndicator, FlatList, Animated, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDialog } from '../components/CustomDialog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { downloadFullImage } from '../services/syncService';
import { getImageUrl } from '../services/api';
import { addToDeleteQueue } from '../services/database';
import { processDeleteQueue } from '../services/deleteQueue';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HEADER_HEIGHT = 60;
const FOOTER_HEIGHT = 64;
const IMAGE_HEIGHT = SCREEN_HEIGHT - HEADER_HEIGHT - FOOTER_HEIGHT;

// Calculate distance between two touch points
function getDistance(touches) {
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

// Get midpoint between two touch points
function getMidpoint(touches) {
  return {
    x: (touches[0].pageX + touches[1].pageX) / 2,
    y: (touches[0].pageY + touches[1].pageY) / 2,
  };
}

// Single zoomable image using PanResponder + Animated
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
  const pinchMidpoint = useRef({ x: 0, y: 0 });
  const pinchStartTranslate = useRef({ x: 0, y: 0 });
  const lastTapTime = useRef(0);
  const isPinching = useRef(false);
  const wasPinching = useRef(false);
  const panStartX = useRef(0);
  const panStartY = useRef(0);

  useEffect(() => {
    if (isActive && !imageUri && imageId) {
      loadImage();
    }
  }, [isActive]);

  // Reset zoom only when becoming inactive (swiping away)
  useEffect(() => {
    if (!isActive) {
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

  const clampTranslation = (tx, ty, scale) => {
    const maxTransX = (SCREEN_WIDTH * (scale - 1)) / 2;
    const maxTransY = (IMAGE_HEIGHT * (scale - 1)) / 2;
    return {
      x: Math.max(-maxTransX, Math.min(maxTransX, tx)),
      y: Math.max(-maxTransY, Math.min(maxTransY, ty)),
    };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Claim gesture if zoomed in (for panning) or if any movement detected (for pinching)
        if (currentScale.current > 1) return true;
        return Math.abs(gestureState.dx) > 2 || Math.abs(gestureState.dy) > 2;
      },

      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          isPinching.current = true;
          wasPinching.current = true;
          initialPinchDistance.current = getDistance(touches);
          pinchStartScale.current = currentScale.current;
          pinchMidpoint.current = getMidpoint(touches);
          pinchStartTranslate.current = {
            x: currentTranslateX.current,
            y: currentTranslateY.current,
          };
        } else {
          isPinching.current = false;
          panStartX.current = currentTranslateX.current;
          panStartY.current = currentTranslateY.current;
        }
      },

      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;

        if (touches.length === 2) {
          // Pinch zoom with focal point tracking
          if (!isPinching.current) {
            isPinching.current = true;
            wasPinching.current = true;
            initialPinchDistance.current = getDistance(touches);
            pinchStartScale.current = currentScale.current;
            pinchMidpoint.current = getMidpoint(touches);
            pinchStartTranslate.current = {
              x: currentTranslateX.current,
              y: currentTranslateY.current,
            };
            return;
          }

          const currentDistance = getDistance(touches);
          const pinchRatio = currentDistance / initialPinchDistance.current;
          const newScale = Math.max(1, Math.min(pinchStartScale.current * pinchRatio, 6));

          // Calculate focal point offset to zoom toward the pinch center
          const mid = getMidpoint(touches);
          const focalX = mid.x - SCREEN_WIDTH / 2;
          const focalY = mid.y - HEADER_HEIGHT - IMAGE_HEIGHT / 2;
          const scaleRatio = newScale / pinchStartScale.current;
          const newTx = pinchStartTranslate.current.x + focalX * (1 - scaleRatio);
          const newTy = pinchStartTranslate.current.y + focalY * (1 - scaleRatio);

          currentScale.current = newScale;
          currentTranslateX.current = newTx;
          currentTranslateY.current = newTy;
          scaleVal.setValue(newScale);
          translateXVal.setValue(newTx);
          translateYVal.setValue(newTy);
        } else if (currentScale.current > 1 && !isPinching.current) {
          // Pan when zoomed in with single finger
          const newX = panStartX.current + gestureState.dx;
          const newY = panStartY.current + gestureState.dy;

          currentTranslateX.current = newX;
          currentTranslateY.current = newY;
          translateXVal.setValue(newX);
          translateYVal.setValue(newY);
        }
      },

      onPanResponderRelease: (evt) => {
        const wasJustPinching = isPinching.current || wasPinching.current;
        isPinching.current = false;

        // If scale dropped below 1 during pinch-out, snap to 1
        if (currentScale.current <= 1) {
          resetZoom(true);
          wasPinching.current = false;
          return;
        }

        // After a pinch, clamp translation and clear pinch flag
        if (wasJustPinching) {
          const clamped = clampTranslation(
            currentTranslateX.current,
            currentTranslateY.current,
            currentScale.current
          );
          if (clamped.x !== currentTranslateX.current || clamped.y !== currentTranslateY.current) {
            currentTranslateX.current = clamped.x;
            currentTranslateY.current = clamped.y;
            Animated.parallel([
              Animated.timing(translateXVal, { toValue: clamped.x, duration: 150, useNativeDriver: true }),
              Animated.timing(translateYVal, { toValue: clamped.y, duration: 150, useNativeDriver: true }),
            ]).start();
          }
          // Reset wasPinching after a short delay to avoid double-tap false positive
          setTimeout(() => { wasPinching.current = false; }, 350);
          return;
        }

        // Double tap detection (only when NOT pinching)
        const now = Date.now();
        const touches = evt.nativeEvent.changedTouches;
        if (touches.length === 1) {
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
        const clamped = clampTranslation(
          currentTranslateX.current,
          currentTranslateY.current,
          currentScale.current
        );
        if (clamped.x !== currentTranslateX.current || clamped.y !== currentTranslateY.current) {
          currentTranslateX.current = clamped.x;
          currentTranslateY.current = clamped.y;
          Animated.parallel([
            Animated.timing(translateXVal, { toValue: clamped.x, duration: 150, useNativeDriver: true }),
            Animated.timing(translateYVal, { toValue: clamped.y, duration: 150, useNativeDriver: true }),
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
  const { alert } = useDialog();
  const { imageId, imageName, projectName, images, initialIndex, localUri, onDelete } = route.params;
  const [currentIndex, setCurrentIndex] = useState(initialIndex || 0);
  const [deletedIds, setDeletedIds] = useState(new Set());
  const insets = useSafeAreaInsets();
  const flatListRef = useRef(null);

  // Single image mode (no images array), filter out deleted
  const allImages = images || [{ id: imageId, name: imageName, localUri }];
  const imageList = allImages.filter(img => !deletedIds.has(img.id));
  const currentImage = imageList[currentIndex] || imageList[0];

  const handleDeleteCurrent = useCallback(() => {
    if (!currentImage) return;

    alert(
      'Foto löschen',
      `"${currentImage.name}" vom Handy löschen?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            // Queue for background deletion
            await addToDeleteQueue([{
              id: currentImage.id,
              file_name: currentImage.name,
              file_uri: currentImage.localUri,
            }]);
            processDeleteQueue();

            // Mark as deleted in UI immediately
            setDeletedIds(prev => new Set([...prev, currentImage.id]));

            // If all images are deleted, go back
            const remaining = imageList.length - 1;
            if (remaining <= 0) {
              navigation.goBack();
              return;
            }

            // Adjust index if needed
            if (currentIndex >= remaining) {
              setCurrentIndex(remaining - 1);
            }
          },
        },
      ]
    );
  }, [currentImage, currentIndex, imageList.length, navigation]);

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

  const navigatePrev = useCallback(() => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      flatListRef.current?.scrollToIndex({ index: newIndex, animated: true });
      setCurrentIndex(newIndex);
    }
  }, [currentIndex]);

  const navigateNext = useCallback(() => {
    if (currentIndex < imageList.length - 1) {
      const newIndex = currentIndex + 1;
      flatListRef.current?.scrollToIndex({ index: newIndex, animated: true });
      setCurrentIndex(newIndex);
    }
  }, [currentIndex, imageList.length]);

  return (
    <View style={styles.container}>
      {/* Header - Image name and counter */}
      <View style={styles.header}>
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
          ref={flatListRef}
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

      {/* Footer - Back button + delete + navigation */}
      <View style={[styles.footer, { paddingBottom: insets.bottom || 4 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={20} color="white" />
          <Text style={styles.backBtnText}>Zurück</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteCurrent}>
          <Ionicons name="trash-outline" size={20} color="#ef4444" />
        </TouchableOpacity>

        {imageList.length > 1 && (
          <View style={styles.navButtons}>
            <TouchableOpacity
              style={[styles.navBtn, currentIndex === 0 && styles.navBtnDisabled]}
              onPress={navigatePrev}
              disabled={currentIndex === 0}
            >
              <Ionicons name="chevron-back" size={22} color="white" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.navBtn, currentIndex === imageList.length - 1 && styles.navBtnDisabled]}
              onPress={navigateNext}
              disabled={currentIndex === imageList.length - 1}
            >
              <Ionicons name="chevron-forward" size={22} color="white" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 48, paddingHorizontal: 16, paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.8)', gap: 12, zIndex: 10,
    height: HEADER_HEIGHT + 38,
  },
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
  footer: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  backBtnText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  deleteBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  navButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  navBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  navBtnDisabled: {
    opacity: 0.3,
  },
});
