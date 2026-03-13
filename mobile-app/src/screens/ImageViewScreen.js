import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Image, Dimensions, TouchableOpacity,
  ActivityIndicator, FlatList, Animated, PanResponder, Modal, TextInput, Linking,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDialog } from '../components/CustomDialog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import CheckboxNotes from '../components/CheckboxNotes';
import { downloadFullImage } from '../services/syncService';
import { getImageUrl } from '../services/api';
import { addToDeleteQueue, updateRecentPhotoMetadata, addToImageChangeQueue } from '../services/database';
import { processDeleteQueue } from '../services/deleteQueue';
import { processUploadQueue } from '../services/uploadQueue';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HEADER_HEIGHT = 60;
const INFO_BAR_HEIGHT = 80;
const FOOTER_HEIGHT = 64;
const IMAGE_HEIGHT = SCREEN_HEIGHT - HEADER_HEIGHT - INFO_BAR_HEIGHT - FOOTER_HEIGHT;

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

// Format date for display
function formatDate(dateString) {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return null; }
}

// Single zoomable image using PanResponder + Animated
function ZoomableImage({ imageId, localUri, isActive, imageHeight }) {
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

  const imgHeight = imageHeight || IMAGE_HEIGHT;

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
    const offsetY = -(focalY - imgHeight / 2) * (targetScale - 1) / targetScale;
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
    const maxTransY = (imgHeight * (scale - 1)) / 2;
    return {
      x: Math.max(-maxTransX, Math.min(maxTransX, tx)),
      y: Math.max(-maxTransY, Math.min(maxTransY, ty)),
    };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
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

          const mid = getMidpoint(touches);
          const focalX = mid.x - SCREEN_WIDTH / 2;
          const focalY = mid.y - HEADER_HEIGHT - imgHeight / 2;
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

        if (currentScale.current <= 1) {
          resetZoom(true);
          wasPinching.current = false;
          return;
        }

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
          setTimeout(() => { wasPinching.current = false; }, 350);
          return;
        }

        const now = Date.now();
        const touches = evt.nativeEvent.changedTouches;
        if (touches.length === 1) {
          if (now - lastTapTime.current < 300) {
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
      <View style={[styles.imagePage, { height: imgHeight }]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Bild wird geladen...</Text>
      </View>
    );
  }

  if (!imageUri) {
    return (
      <View style={[styles.imagePage, { height: imgHeight }]}>
        <Ionicons name="image-outline" size={64} color={colors.textTertiary} />
        <Text style={styles.loadingText}>Bild konnte nicht geladen werden</Text>
      </View>
    );
  }

  return (
    <View style={[styles.imagePage, { height: imgHeight }]} {...panResponder.panHandlers}>
      <Animated.Image
        source={
          imageHeaders
            ? { uri: imageUri, headers: imageHeaders }
            : { uri: imageUri }
        }
        style={[
          styles.image,
          { height: imgHeight },
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
  const { imageId, imageName, projectName, images, initialIndex, localUri } = route.params;
  const [currentIndex, setCurrentIndex] = useState(initialIndex || 0);
  const [deletedIds, setDeletedIds] = useState(new Set());
  const [imageMetadata, setImageMetadata] = useState({}); // { [id]: { customTitle, notes } }
  const insets = useSafeAreaInsets();
  const flatListRef = useRef(null);
  const editInputRef = useRef(null);
  const notesInputRef = useRef(null);

  // Editing state
  const [editingField, setEditingField] = useState(null); // 'title' | 'notes' | null
  const [editFieldValue, setEditFieldValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [committedMeta, setCommittedMeta] = useState({}); // { [id]: {customTitle, notes} } — last saved values

  // Single image mode (no images array), filter out deleted
  const allImages = images || [{ id: imageId, name: imageName, localUri }];
  const imageList = allImages.filter(img => !deletedIds.has(img.id));
  const currentImage = imageList[currentIndex] || imageList[0];

  // Get metadata for current image (local edits override initial data)
  const getCurrentMeta = () => {
    if (!currentImage) return {};
    const overrides = imageMetadata[currentImage.id] || {};
    return {
      customTitle: overrides.customTitle !== undefined ? overrides.customTitle : (currentImage.customTitle || null),
      notes: overrides.notes !== undefined ? overrides.notes : (currentImage.notes || null),
      gpsData: currentImage.gpsData || null,
      createdAt: currentImage.createdAt || null,
      isLocal: currentImage.isLocal || false,
    };
  };

  const meta = getCurrentMeta();

  // Parse GPS data (stored as JSON string)
  const gps = (() => {
    if (!meta.gpsData) return null;
    try {
      return typeof meta.gpsData === 'string' ? JSON.parse(meta.gpsData) : meta.gpsData;
    } catch { return null; }
  })();

  // Display name: customTitle > basename without extension
  const getDisplayName = () => {
    if (meta.customTitle) return meta.customTitle;
    if (!currentImage?.name) return 'Bild';
    const name = currentImage.name;
    const dotIndex = name.lastIndexOf('.');
    return dotIndex > 0 ? name.substring(0, dotIndex) : name;
  };

  const openEditField = (field) => {
    if (field === 'title') {
      setEditFieldValue(meta.customTitle || getDisplayName());
    } else {
      setEditFieldValue(meta.notes || '');
    }
    setEditingField(field);
  };

  // Close the edit modal and update local state only – no API call yet
  const saveEditField = () => {
    if (!editingField || !currentImage) {
      setEditingField(null);
      return;
    }
    const newMeta = { ...(imageMetadata[currentImage.id] || {}) };
    if (editingField === 'title') {
      newMeta.customTitle = editFieldValue.trim() || null;
    } else {
      newMeta.notes = editFieldValue.trim() || null;
    }
    setImageMetadata(prev => ({ ...prev, [currentImage.id]: newMeta }));
    setEditingField(null);
    setEditFieldValue('');
  };

  // Whether the current image has unsaved changes
  // Compares live edits against last-committed state (or original image values if never saved)
  const hasPendingChanges = (() => {
    if (!currentImage) return false;
    const overrides = imageMetadata[currentImage.id] || {};
    const baseline = committedMeta[currentImage.id] ?? {
      customTitle: currentImage.customTitle ?? null,
      notes: currentImage.notes ?? null,
    };
    const curTitle = overrides.customTitle !== undefined ? overrides.customTitle : baseline.customTitle;
    const curNotes = overrides.notes !== undefined ? overrides.notes : baseline.notes;
    return curTitle !== baseline.customTitle || curNotes !== baseline.notes;
  })();

  // Persist all pending changes for the current image in one request, in background
  const handleSaveChanges = async () => {
    if (!currentImage || !hasPendingChanges || saving) return;
    setSaving(true);
    try {
      const overrides = imageMetadata[currentImage.id] || {};
      const baseline = committedMeta[currentImage.id] ?? {
        customTitle: currentImage.customTitle ?? null,
        notes: currentImage.notes ?? null,
      };
      const title = overrides.customTitle !== undefined ? overrides.customTitle : baseline.customTitle;
      const notes = overrides.notes !== undefined ? overrides.notes : baseline.notes;

      if (currentImage.isLocal) {
        await updateRecentPhotoMetadata(currentImage.id, title, notes);
      } else {
        await addToImageChangeQueue(currentImage.id, currentImage.name, title, notes);
        processUploadQueue(); // fire and forget – respects WiFi-only + queues when offline
      }

      // Record committed state so hasPendingChanges → false
      setCommittedMeta(prev => ({ ...prev, [currentImage.id]: { customTitle: title, notes } }));
    } catch (e) {
      console.warn('Failed to save changes:', e);
    } finally {
      setSaving(false);
    }
  };

  const openGoogleMaps = () => {
    if (!gps) return;
    const url = `https://www.google.com/maps?q=${gps.latitude},${gps.longitude}`;
    Linking.openURL(url);
  };

  const handleDeleteCurrent = useCallback(() => {
    if (!currentImage) return;

    alert(
      'Foto löschen',
      `"${getDisplayName()}" löschen?\n\nDas Bild wird vom Handy gelöscht und eine Löschanfrage an die Desktop-Software gesendet.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            await addToDeleteQueue([{
              id: currentImage.id,
              file_name: currentImage.name,
              file_uri: currentImage.localUri,
            }], true);
            processDeleteQueue();

            setDeletedIds(prev => new Set([...prev, currentImage.id]));

            const remaining = imageList.length - 1;
            if (remaining <= 0) {
              navigation.goBack();
              return;
            }

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
          <Text style={styles.headerTitle} numberOfLines={1}>{getDisplayName()}</Text>
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
          imageHeight={IMAGE_HEIGHT}
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
              imageHeight={IMAGE_HEIGHT}
            />
          )}
        />
      )}

      {/* Info bar - metadata display */}
      <View style={styles.infoBar}>
        {/* Date */}
        {meta.createdAt && (
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.textTertiary} />
            <Text style={styles.infoDate}>{formatDate(meta.createdAt)}</Text>
          </View>
        )}

        {/* Notes preview (if exists) */}
        {meta.notes && (
          <View style={styles.infoRow}>
            <Ionicons name="document-text-outline" size={14} color={colors.textTertiary} />
            <Text style={styles.infoNotes} numberOfLines={1}>{meta.notes}</Text>
          </View>
        )}

        {/* Editable buttons row + Speichern */}
        <View style={styles.editRow}>
          <TouchableOpacity
            style={[styles.editBtn, meta.customTitle && styles.editBtnActive]}
            onPress={() => openEditField('title')}
          >
            <Ionicons name="pencil-outline" size={14} color={meta.customTitle ? colors.accent : colors.textTertiary} />
            <Text style={[styles.editBtnText, meta.customTitle && { color: colors.accent }]} numberOfLines={1}>
              Titel
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.editBtn, meta.notes && styles.editBtnActive]}
            onPress={() => openEditField('notes')}
          >
            <Ionicons name="create-outline" size={14} color={meta.notes ? colors.accent : colors.textTertiary} />
            <Text style={[styles.editBtnText, meta.notes && { color: colors.accent }]} numberOfLines={1}>
              Notizen
            </Text>
          </TouchableOpacity>

          {hasPendingChanges && (
            <TouchableOpacity
              style={[styles.editBtn, styles.saveBtn]}
              onPress={handleSaveChanges}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size="small" color="white" />
                : <Ionicons name="checkmark-circle" size={16} color="white" />
              }
              <Text style={styles.saveBtnText}>Speichern</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Notes editing - fullscreen modal so keyboard never overlaps */}
      {editingField === 'notes' && (
        <Modal
          animationType="slide"
          onShow={() => {
            setTimeout(() => notesInputRef.current?.focus(), 300);
          }}
        >
          <View style={styles.notesFullScreen}>
            <View style={styles.notesFullScreenHeader}>
              <Text style={styles.notesFullScreenTitle}>Notizen</Text>
              <TouchableOpacity onPress={saveEditField}>
                <Ionicons name="checkmark-circle" size={28} color={colors.accent} />
              </TouchableOpacity>
            </View>
            <CheckboxNotes
              value={editFieldValue}
              onChange={setEditFieldValue}
              placeholder="Notizen eingeben..."
              autoFocus
              inputRef={notesInputRef}
              minHeight={300}
            />
          </View>
        </Modal>
      )}

      {/* Title editing - bottom-sheet with proper keyboard avoidance */}
      {editingField === 'title' && (
        <Modal
          transparent
          animationType="slide"
          onShow={() => {
            setTimeout(() => editInputRef.current?.focus(), 300);
          }}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <TouchableOpacity style={styles.editModalOverlay} activeOpacity={1} onPress={saveEditField}>
              <View style={styles.editModalContent} onStartShouldSetResponder={() => true}>
                <View style={styles.editModalHeader}>
                  <Text style={styles.editModalTitle}>Bild-Titel</Text>
                  <TouchableOpacity onPress={saveEditField}>
                    <Ionicons name="checkmark-circle" size={28} color={colors.accent} />
                  </TouchableOpacity>
                </View>
                <TextInput
                  ref={editInputRef}
                  style={styles.editModalInput}
                  value={editFieldValue}
                  onChangeText={setEditFieldValue}
                  placeholder="Bildname eingeben..."
                  placeholderTextColor={colors.textTertiary}
                  autoFocus
                  selectTextOnFocus
                  returnKeyType="done"
                  onSubmitEditing={saveEditField}
                />
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* Footer - Back button + GPS + delete + navigation */}
      <View style={[styles.footer, { paddingBottom: insets.bottom || 4 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={20} color="white" />
          <Text style={styles.backBtnText}>Zurück</Text>
        </TouchableOpacity>

        {/* GPS button */}
        <TouchableOpacity
          style={[styles.gpsBtn, gps ? styles.gpsBtnActive : styles.gpsBtnInactive]}
          onPress={gps ? openGoogleMaps : undefined}
          disabled={!gps}
        >
          <Ionicons
            name="location"
            size={20}
            color={gps ? '#22c55e' : '#666'}
          />
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
    width: SCREEN_WIDTH,
    justifyContent: 'center', alignItems: 'center', gap: 12,
    overflow: 'hidden',
  },
  image: { width: SCREEN_WIDTH },
  loadingText: { color: colors.textTertiary, fontSize: 14 },

  // Info bar
  infoBar: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    gap: 6,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoDate: {
    color: colors.textTertiary,
    fontSize: 12,
  },
  infoNotes: {
    color: colors.textSecondary,
    fontSize: 12,
    flex: 1,
  },
  editRow: {
    flexDirection: 'row',
    gap: 8,
  },
  editBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  editBtnActive: {
    borderColor: 'rgba(59,130,246,0.3)',
    backgroundColor: 'rgba(59,130,246,0.08)',
  },
  editBtnText: {
    fontSize: 12,
    color: colors.textTertiary,
    fontWeight: '500',
  },
  saveBtn: {
    flex: 0,
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    paddingHorizontal: 14,
  },
  saveBtnText: {
    fontSize: 12,
    color: 'white',
    fontWeight: '600',
  },

  // Notes fullscreen
  notesFullScreen: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    padding: 20,
    paddingTop: 60,
  },
  notesFullScreenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  notesFullScreenTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  notesFullScreenInput: {
    flex: 1,
    backgroundColor: colors.inputBg || colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },

  // Edit modal
  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  editModalContent: {
    backgroundColor: colors.bgPrimary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  editModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  editModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  editModalInput: {
    backgroundColor: colors.inputBg || colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.textPrimary,
  },

  // Footer
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
  gpsBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  gpsBtnActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  gpsBtnInactive: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.1)',
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
