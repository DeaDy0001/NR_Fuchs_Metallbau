import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Animated, Linking, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { getQueueDisplayItems, cleanupOldQueueItems, getDeleteQueueDisplayItems, cleanupOldDeleteQueueItems, getMetaChangeQueueDisplayItems, cleanupOldMetaChangeQueueItems, getImageChangeQueueDisplayItems, cleanupOldImageChangeQueueItems } from '../services/database';
import { forceProcessQueue, addUploadListener, getCurrentUploadState } from '../services/uploadQueue';
import { addDeleteListener, processDeleteQueue } from '../services/deleteQueue';
import { useApp } from '../contexts/AppContext';
import { getNotificationPermissionStatus, requestNotificationPermission } from '../services/backgroundSync';

export default function UploadQueueScreen() {
  const { refreshQueueCount } = useApp();
  const [pending, setPending] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [deletePending, setDeletePending] = useState([]);
  const [deleteCompleted, setDeleteCompleted] = useState([]);
  const [metaPending, setMetaPending] = useState([]);
  const [metaCompleted, setMetaCompleted] = useState([]);
  const [imageChangePending, setImageChangePending] = useState([]);
  const [imageChangeCompleted, setImageChangeCompleted] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadState, setUploadState] = useState(getCurrentUploadState());
  const [currentPhase, setCurrentPhase] = useState(null); // 'compressing' or 'uploading'
  const [notifPermission, setNotifPermission] = useState(null); // null=checking, 'granted', 'denied', 'undetermined'

  // Animated progress for uploading items
  const progressAnims = useRef({});

  // Load queue on focus + check notification permission
  useFocusEffect(
    useCallback(() => {
      loadQueue();
      loadDeleteQueue();
      loadMetaQueue();
      loadImageChangeQueue();
      setUploadState(getCurrentUploadState());
      getNotificationPermissionStatus().then(setNotifPermission).catch(() => {});
    }, [])
  );

  // Listen for real-time upload events
  useEffect(() => {
    const unsubscribe = addUploadListener(async (event) => {
      setUploadState(getCurrentUploadState());

      if (event.type === 'compressing') {
        setCurrentPhase('compressing');
      } else if (event.type === 'uploading') {
        setCurrentPhase('uploading');
      } else if (event.type === 'uploaded' || event.type === 'done') {
        setCurrentPhase(null);
      }

      if (event.type === 'uploaded' || event.type === 'done' || event.type === 'error') {
        await loadQueue();
        await loadMetaQueue();
        await refreshQueueCount();
      }
      if (event.type === 'uploading') {
        // Animate the progress for the current item
        const itemId = event.item?.id;
        if (itemId && !progressAnims.current[itemId]) {
          progressAnims.current[itemId] = new Animated.Value(0);
        }
        if (itemId && progressAnims.current[itemId]) {
          Animated.loop(
            Animated.sequence([
              Animated.timing(progressAnims.current[itemId], {
                toValue: 1, duration: 1500, useNativeDriver: false,
              }),
              Animated.timing(progressAnims.current[itemId], {
                toValue: 0, duration: 0, useNativeDriver: false,
              }),
            ])
          ).start();
        }
      }
    });
    return unsubscribe;
  }, []);

  // Listen for delete queue events
  useEffect(() => {
    const unsubscribe = addDeleteListener(async (event) => {
      if (event.type === 'deleted' || event.type === 'done' || event.type === 'error') {
        await loadDeleteQueue();
      }
    });
    return unsubscribe;
  }, []);

  const loadDeleteQueue = async () => {
    try {
      const { pending: p, completed: c } = await getDeleteQueueDisplayItems();
      setDeletePending(p);
      setDeleteCompleted(c);
      await cleanupOldDeleteQueueItems();
    } catch (error) {
      console.error('Error loading delete queue:', error);
    }
  };

  const loadMetaQueue = async () => {
    try {
      const { pending: p, completed: c } = await getMetaChangeQueueDisplayItems();
      setMetaPending(p);
      setMetaCompleted(c);
      await cleanupOldMetaChangeQueueItems();
    } catch (error) {
      console.error('Error loading meta queue:', error);
    }
  };

  const loadImageChangeQueue = async () => {
    try {
      const { pending: p, completed: c } = await getImageChangeQueueDisplayItems();
      setImageChangePending(p);
      setImageChangeCompleted(c);
      await cleanupOldImageChangeQueueItems();
    } catch (error) {
      console.error('Error loading image change queue:', error);
    }
  };

  const loadQueue = async () => {
    try {
      const { pending: p, completed: c } = await getQueueDisplayItems();
      setPending(p);
      setCompleted(c);
      // Cleanup old completed items beyond 30
      await cleanupOldQueueItems();
    } catch (error) {
      console.error('Error loading queue:', error);
    }
  };

  const handleRequestNotifPermission = async () => {
    const granted = await requestNotificationPermission();
    setNotifPermission(granted ? 'granted' : 'denied');
  };

  const handleForceSync = async () => {
    setRefreshing(true);
    await forceProcessQueue();
    processDeleteQueue();
    await loadQueue();
    await loadDeleteQueue();
    await loadMetaQueue();
    await refreshQueueCount();
    setRefreshing(false);
  };

  const getStatusConfig = (status, itemId) => {
    const isCurrentlyUploading = uploadState.currentlyUploadingId === itemId;
    if (isCurrentlyUploading && currentPhase === 'compressing') {
      return { icon: 'image-outline', color: '#f59e0b', label: 'Wird komprimiert...' };
    }
    if (isCurrentlyUploading) {
      return { icon: 'cloud-upload', color: colors.accent, label: 'Wird hochgeladen...' };
    }
    switch (status) {
      case 'queued': return { icon: 'time-outline', color: colors.warning, label: 'Wartend' };
      case 'uploaded': return { icon: 'checkmark-circle', color: colors.success, label: 'Hochgeladen' };
      case 'failed': return { icon: 'alert-circle', color: colors.error, label: 'Fehlgeschlagen' };
      case 'permanently_failed': return { icon: 'close-circle', color: colors.error, label: 'Endgültig fehlgeschlagen' };
      default: return { icon: 'help-circle', color: colors.textTertiary, label: status };
    }
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
      return d.toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return ''; }
  };

  const renderQueueItem = ({ item }) => {
    const isCurrentlyUploading = uploadState.currentlyUploadingId === item.id;
    const config = getStatusConfig(item.status, item.id);

    return (
      <View style={[styles.queueItem, isCurrentlyUploading && styles.queueItemUploading]}>
        <View style={styles.itemIconContainer}>
          <Ionicons name={config.icon} size={24} color={config.color} />
        </View>
        <View style={styles.itemInfo}>
          <Text style={styles.itemName} numberOfLines={1}>{item.custom_title || item.file_name}</Text>
          <View style={styles.itemMeta}>
            <Text style={[styles.itemStatus, { color: config.color }]}>{config.label}</Text>
            {item.project_name && (
              <Text style={styles.itemProject} numberOfLines={1}>
                <Ionicons name="folder-outline" size={11} color={colors.textTertiary} /> {item.project_name}
              </Text>
            )}
          </View>
          {item.error && <Text style={styles.itemError} numberOfLines={2}>{item.error}</Text>}

          {/* Progress bar for uploading items */}
          {isCurrentlyUploading && (
            <View style={styles.progressBarContainer}>
              <Animated.View
                style={[
                  styles.progressBarFill,
                  {
                    width: progressAnims.current[item.id]
                      ? progressAnims.current[item.id].interpolate({
                          inputRange: [0, 1],
                          outputRange: ['10%', '100%'],
                        })
                      : '50%',
                  },
                ]}
              />
            </View>
          )}
        </View>
        {item.status === 'uploaded' && item.uploaded_at && (
          <Text style={styles.itemTime}>{formatTime(item.uploaded_at)}</Text>
        )}
      </View>
    );
  };

  const getDeleteStatusConfig = (status) => {
    switch (status) {
      case 'queued': return { icon: 'time-outline', color: colors.warning, label: 'Wartend' };
      case 'done': return { icon: 'checkmark-circle', color: colors.success, label: 'Gelöscht' };
      case 'failed': return { icon: 'alert-circle', color: colors.error, label: 'Fehlgeschlagen' };
      default: return { icon: 'help-circle', color: colors.textTertiary, label: status };
    }
  };

  const renderDeleteItem = ({ item }) => {
    const config = getDeleteStatusConfig(item.status);
    return (
      <View style={[styles.queueItem, styles.deleteItem]}>
        <View style={styles.itemIconContainer}>
          <Ionicons name="trash-outline" size={24} color={config.color} />
        </View>
        <View style={styles.itemInfo}>
          <Text style={styles.itemName} numberOfLines={1}>{item.custom_title || item.file_name}</Text>
          <View style={styles.itemMeta}>
            <Text style={[styles.itemStatus, { color: config.color }]}>{config.label}</Text>
            {item.project_name && (
              <Text style={styles.itemProject} numberOfLines={1}>
                <Ionicons name="folder-outline" size={11} color={colors.textTertiary} /> {item.project_name}
              </Text>
            )}
            {item.delete_from_software === 1 && (
              <Text style={styles.itemDeleteSoftware}>+ Software</Text>
            )}
          </View>
          {item.error && <Text style={styles.itemError} numberOfLines={2}>{item.error}</Text>}
        </View>
        {item.status === 'done' && item.processed_at && (
          <Text style={styles.itemTime}>{formatTime(item.processed_at)}</Text>
        )}
      </View>
    );
  };

  const renderMetaItem = ({ item }) => {
    const isCurrentlyUploading = uploadState.currentlyUploadingId === item.id;
    const config = getStatusConfig(item.status, item.id);
    return (
      <View style={[styles.queueItem, isCurrentlyUploading && styles.queueItemUploading]}>
        <View style={styles.itemIconContainer}>
          <Ionicons name={isCurrentlyUploading ? config.icon : 'create-outline'} size={24} color={config.color} />
        </View>
        <View style={styles.itemInfo}>
          <Text style={styles.itemName} numberOfLines={1}>{item.project_name || 'Projektdaten'}</Text>
          <View style={styles.itemMeta}>
            <Text style={[styles.itemStatus, { color: config.color }]}>{config.label}</Text>
            <Text style={styles.itemProject}>
              <Ionicons name="color-palette-outline" size={11} color={colors.textTertiary} /> Farbe · Notizen · Tags
            </Text>
          </View>
          {item.error && <Text style={styles.itemError} numberOfLines={2}>{item.error}</Text>}
          {isCurrentlyUploading && (
            <View style={styles.progressBarContainer}>
              <Animated.View
                style={[
                  styles.progressBarFill,
                  {
                    width: progressAnims.current[item.id]
                      ? progressAnims.current[item.id].interpolate({
                          inputRange: [0, 1],
                          outputRange: ['10%', '100%'],
                        })
                      : '50%',
                  },
                ]}
              />
            </View>
          )}
        </View>
        {item.status === 'uploaded' && item.uploaded_at && (
          <Text style={styles.itemTime}>{formatTime(item.uploaded_at)}</Text>
        )}
      </View>
    );
  };

  const renderImageChangeItem = ({ item }) => {
    const isCurrentlyUploading = uploadState.currentlyUploadingId === item.id;
    const config = getStatusConfig(item.status, item.id);
    return (
      <View style={[styles.queueItem, isCurrentlyUploading && styles.queueItemUploading]}>
        <View style={styles.itemIconContainer}>
          <Ionicons name={isCurrentlyUploading ? config.icon : 'pencil-outline'} size={24} color={config.color} />
        </View>
        <View style={styles.itemInfo}>
          <Text style={styles.itemName} numberOfLines={1}>{item.image_name}</Text>
          <View style={styles.itemMeta}>
            <Text style={[styles.itemStatus, { color: config.color }]}>{config.label}</Text>
            <Text style={styles.itemProject}>
              <Ionicons name="pencil-outline" size={11} color={colors.textTertiary} />{' '}
              {[item.custom_title && 'Titel', item.notes && 'Notizen'].filter(Boolean).join(' · ') || 'Bildänderung'}
            </Text>
          </View>
          {item.error && <Text style={styles.itemError} numberOfLines={2}>{item.error}</Text>}
        </View>
        {item.status === 'uploaded' && item.uploaded_at && (
          <Text style={styles.itemTime}>{formatTime(item.uploaded_at)}</Text>
        )}
      </View>
    );
  };

  const totalPending = pending.length;
  const totalCompleted = completed.length;
  const totalDeletePending = deletePending.length;
  const totalDeleteCompleted = deleteCompleted.length;
  const totalMetaPending = metaPending.length;
  const totalMetaCompleted = metaCompleted.length;
  const totalImageChangePending = imageChangePending.length;
  const totalImageChangeCompleted = imageChangeCompleted.length;

  // Build unified list with section headers
  const allItems = [];
  if (totalDeletePending > 0) {
    allItems.push({ _type: 'section', label: `Lösch-Queue (${totalDeletePending})`, icon: 'trash-outline', color: colors.error });
    deletePending.forEach(i => allItems.push({ ...i, _type: 'delete' }));
  }
  if (totalMetaPending > 0) {
    allItems.push({ _type: 'section', label: `Projektdaten (${totalMetaPending})`, icon: 'create-outline', color: '#8b5cf6' });
    metaPending.forEach(i => allItems.push({ ...i, _type: 'meta' }));
  }
  if (totalImageChangePending > 0) {
    allItems.push({ _type: 'section', label: `Bildänderungen (${totalImageChangePending})`, icon: 'pencil-outline', color: '#f59e0b' });
    imageChangePending.forEach(i => allItems.push({ ...i, _type: 'imagechange' }));
  }
  if (totalPending > 0) {
    allItems.push({ _type: 'section', label: `Upload-Queue (${totalPending})`, icon: 'cloud-upload-outline', color: colors.accent });
    pending.forEach(i => allItems.push({ ...i, _type: 'upload' }));
  }
  if (totalCompleted > 0 || totalDeleteCompleted > 0 || totalMetaCompleted > 0 || totalImageChangeCompleted > 0) {
    allItems.push({ _type: 'section', label: 'Erledigt', icon: 'checkmark-done-outline', color: colors.success });
    const allDone = [
      ...deleteCompleted.map(i => ({ ...i, _type: 'delete', _sortDate: i.processed_at || '' })),
      ...metaCompleted.map(i => ({ ...i, _type: 'meta', _sortDate: i.uploaded_at || '' })),
      ...imageChangeCompleted.map(i => ({ ...i, _type: 'imagechange', _sortDate: i.uploaded_at || '' })),
      ...completed.map(i => ({ ...i, _type: 'upload', _sortDate: i.uploaded_at || '' })),
    ].sort((a, b) => b._sortDate.localeCompare(a._sortDate));
    allDone.forEach(i => allItems.push(i));
  }

  const { isProcessing, uploadProgress } = uploadState;

  return (
    <View style={styles.container}>
      {/* Notification permission banner — shown until granted. Tappable: opens settings when denied. */}
      {notifPermission !== null && notifPermission !== 'granted' && (
        <TouchableOpacity
          style={styles.notifBanner}
          activeOpacity={0.75}
          onPress={notifPermission === 'denied' ? () => Linking.openSettings() : handleRequestNotifPermission}
        >
          <Ionicons name="notifications-outline" size={18} color="#f59e0b" />
          <Text style={styles.notifBannerText}>
            {notifPermission === 'denied'
              ? 'Benachrichtigungen deaktiviert – Tippen um Einstellungen zu öffnen.'
              : 'Benachrichtigungen erlauben, damit du informiert wirst wenn alle Fotos hochgeladen sind.'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#f59e0b" style={{ flexShrink: 0 }} />
        </TouchableOpacity>
      )}

      {/* Summary card */}
      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryNumber, { color: (totalPending + totalDeletePending + totalMetaPending + totalImageChangePending) > 0 ? colors.warning : colors.textTertiary }]}>
            {totalPending + totalDeletePending + totalMetaPending + totalImageChangePending}
          </Text>
          <Text style={styles.summaryLabel}>Ausstehend</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryNumber, { color: colors.success }]}>{totalCompleted + totalDeleteCompleted + totalMetaCompleted + totalImageChangeCompleted}</Text>
          <Text style={styles.summaryLabel}>Erledigt</Text>
        </View>
      </View>

      {/* Upload progress indicator */}
      {isProcessing && uploadProgress.total > 0 && (
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <Ionicons name="cloud-upload" size={18} color={colors.accent} />
            <Text style={styles.progressText}>
              Hochladen {uploadProgress.current} von {uploadProgress.total}
            </Text>
          </View>
          <View style={styles.progressBarLarge}>
            <View
              style={[
                styles.progressBarLargeFill,
                { width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%` },
              ]}
            />
          </View>
          <Text style={styles.progressPercent}>
            {Math.round((uploadProgress.current / uploadProgress.total) * 100)}%
          </Text>
        </View>
      )}

      {/* Offline / WiFi hint */}
      {uploadState.isProcessing === false && (totalPending + totalMetaPending) > 0 && (
        <View style={styles.hintCard}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textTertiary} />
          <Text style={styles.hintText}>
            Uploads werden automatisch verarbeitet, sobald eine Verbindung besteht.
          </Text>
        </View>
      )}

      {/* Android battery optimization hint */}
      {Platform.OS === 'android' && uploadState.isProcessing === false && (totalPending + totalMetaPending) > 0 && (
        <TouchableOpacity style={styles.batteryHint} onPress={() => Linking.openSettings()} activeOpacity={0.75}>
          <Ionicons name="battery-charging-outline" size={18} color="#f59e0b" />
          <Text style={styles.batteryHintText}>
            Uploads starten nur beim Öffnen der App? Akku-Optimierung für diese App deaktivieren.
          </Text>
          <Ionicons name="chevron-forward" size={15} color="#f59e0b" style={{ flexShrink: 0 }} />
        </TouchableOpacity>
      )}

      {/* Action button */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.syncBtn} onPress={handleForceSync} disabled={refreshing}>
          <Ionicons
            name="sync"
            size={18}
            color="white"
            style={refreshing ? { opacity: 0.5 } : null}
          />
          <Text style={styles.syncBtnText}>
            {refreshing ? 'Synchronisiere...' : 'Sofort synchronisieren'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Queue list */}
      <FlatList
        data={allItems}
        keyExtractor={(i, idx) => i._type === 'section' ? `section-${idx}` : `${i._type}-${i.id}`}
        renderItem={({ item }) => {
          if (item._type === 'section') {
            return (
              <View style={styles.sectionHeader}>
                <Ionicons name={item.icon} size={16} color={item.color} />
                <Text style={[styles.sectionHeaderText, { color: item.color }]}>{item.label}</Text>
              </View>
            );
          }
          if (item._type === 'delete') return renderDeleteItem({ item });
          if (item._type === 'meta') return renderMetaItem({ item });
          if (item._type === 'imagechange') return renderImageChangeItem({ item });
          return renderQueueItem({ item });
        }}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleForceSync} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-circle-outline" size={56} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>Alles erledigt</Text>
            <Text style={styles.emptyText}>Keine Aufgaben in der Warteschlange</Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  notifBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    margin: 12,
    marginBottom: 0,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
  },
  notifBannerText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  notifBannerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f59e0b',
  },
  notifBannerBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'white',
  },
  summary: {
    flexDirection: 'row',
    backgroundColor: colors.cardBg,
    margin: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  summaryNumber: {
    fontSize: 28,
    fontWeight: '700',
  },
  summaryLabel: {
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: 4,
  },

  // Progress card (overall progress)
  progressCard: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.25)',
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent,
  },
  progressBarLarge: {
    height: 6,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarLargeFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 3,
  },
  progressPercent: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: '600',
    textAlign: 'right',
    marginTop: 4,
  },

  // Hint card
  hintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hintText: {
    flex: 1,
    fontSize: 12,
    color: colors.textTertiary,
  },
  batteryHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.25)',
  },
  batteryHintText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },

  // Sync button
  actions: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  syncBtnText: {
    fontSize: 14,
    color: 'white',
    fontWeight: '600',
  },

  // Queue list
  list: {
    padding: 16,
    paddingTop: 8,
  },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.cardBg,
    borderRadius: 10,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  queueItemUploading: {
    borderColor: 'rgba(59, 130, 246, 0.4)',
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
  },
  itemIconContainer: {
    paddingTop: 2,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  itemMeta: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
    alignItems: 'center',
  },
  itemStatus: {
    fontSize: 12,
    fontWeight: '500',
  },
  itemProject: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  itemError: {
    fontSize: 11,
    color: colors.error,
    marginTop: 4,
  },
  itemTime: {
    fontSize: 11,
    color: colors.textTertiary,
    paddingTop: 2,
  },

  // Progress bar (per-item)
  progressBarContainer: {
    height: 3,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 2,
  },

  // Delete queue items
  deleteItem: {
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  itemDeleteSoftware: {
    fontSize: 10,
    color: colors.error,
    fontWeight: '600',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    overflow: 'hidden',
  },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Empty state
  empty: {
    alignItems: 'center',
    paddingTop: 64,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 14,
  },
});
