import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { getDb } from '../services/database';
import { processUploadQueue } from '../services/uploadQueue';
import { useApp } from '../contexts/AppContext';

export default function UploadQueueScreen() {
  const { refreshQueueCount } = useApp();
  const [queue, setQueue] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadQueue();
    }, [])
  );

  const loadQueue = async () => {
    const db = await getDb();
    const items = await db.getAllAsync(
      'SELECT * FROM upload_queue ORDER BY created_at DESC'
    );
    setQueue(items);
  };

  const handleRetry = async () => {
    setRefreshing(true);
    await processUploadQueue();
    await loadQueue();
    await refreshQueueCount();
    setRefreshing(false);
  };

  const handleClearCompleted = async () => {
    const db = await getDb();
    await db.runAsync('DELETE FROM upload_queue WHERE status = \'uploaded\'');
    await loadQueue();
    await refreshQueueCount();
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'queued': return { name: 'time-outline', color: colors.warning };
      case 'uploaded': return { name: 'checkmark-circle', color: colors.success };
      case 'failed': return { name: 'alert-circle', color: colors.error };
      case 'permanently_failed': return { name: 'close-circle', color: colors.error };
      default: return { name: 'help-circle', color: colors.textTertiary };
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'queued': return 'Wartend';
      case 'uploaded': return 'Hochgeladen';
      case 'failed': return 'Fehlgeschlagen';
      case 'permanently_failed': return 'Endgültig fehlgeschlagen';
      default: return status;
    }
  };

  const renderItem = ({ item }) => {
    const icon = getStatusIcon(item.status);
    return (
      <View style={styles.queueItem}>
        <Ionicons name={icon.name} size={24} color={icon.color} />
        <View style={styles.itemInfo}>
          <Text style={styles.itemName} numberOfLines={1}>{item.file_name}</Text>
          <View style={styles.itemMeta}>
            <Text style={[styles.itemStatus, { color: icon.color }]}>{getStatusLabel(item.status)}</Text>
            {item.project_name && (
              <Text style={styles.itemProject}>{item.project_name}</Text>
            )}
          </View>
          {item.error && <Text style={styles.itemError}>{item.error}</Text>}
        </View>
      </View>
    );
  };

  const pendingCount = queue.filter(q => q.status === 'queued' || q.status === 'failed').length;
  const completedCount = queue.filter(q => q.status === 'uploaded').length;

  return (
    <View style={styles.container}>
      {/* Summary */}
      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{pendingCount}</Text>
          <Text style={styles.summaryLabel}>Ausstehend</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryNumber, { color: colors.success }]}>{completedCount}</Text>
          <Text style={styles.summaryLabel}>Hochgeladen</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {pendingCount > 0 && (
          <TouchableOpacity style={styles.actionBtn} onPress={handleRetry}>
            <Ionicons name="refresh" size={18} color={colors.accent} />
            <Text style={styles.actionText}>Jetzt hochladen</Text>
          </TouchableOpacity>
        )}
        {completedCount > 0 && (
          <TouchableOpacity style={styles.actionBtn} onPress={handleClearCompleted}>
            <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.actionText, { color: colors.textSecondary }]}>Erledigte löschen</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Queue List */}
      <FlatList
        data={queue}
        keyExtractor={i => String(i.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRetry} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-circle-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyText}>Keine Uploads in der Warteschlange</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  summary: {
    flexDirection: 'row',
    backgroundColor: colors.cardBg,
    margin: 16,
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
    color: colors.warning,
  },
  summaryLabel: {
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: {
    fontSize: 14,
    color: colors.accent,
    fontWeight: '500',
  },
  list: {
    padding: 16,
  },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.cardBg,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
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
  empty: {
    alignItems: 'center',
    paddingTop: 64,
    gap: 12,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 15,
  },
});
