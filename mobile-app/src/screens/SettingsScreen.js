import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { getSetting, setSetting } from '../services/database';
import { getCacheSize, clearCache, cleanupCache } from '../services/syncService';
import Slider from '../components/Slider';

export default function SettingsScreen({ navigation }) {
  const { userName, updateUserName, disconnect, serverUrl, isConnected } = useApp();

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(userName);
  const [wifiOnly, setWifiOnly] = useState(true);
  const [cacheSize, setCacheSize] = useState(0);

  // Compression settings
  const [imageQuality, setImageQuality] = useState(80);
  const [maxResolution, setMaxResolution] = useState(1920);
  const [maxImageSizeKB, setMaxImageSizeKB] = useState(1024);
  const [cacheMaxAgeDays, setCacheMaxAgeDays] = useState(30);
  const [lazyLoadImages, setLazyLoadImages] = useState(true);
  const [autoDeleteOld, setAutoDeleteOld] = useState(false);
  const [autoDeleteDays, setAutoDeleteDays] = useState(60);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setWifiOnly((await getSetting('wifiOnly', 'true')) === 'true');
    setImageQuality(parseInt(await getSetting('imageQuality', '80')));
    setMaxResolution(parseInt(await getSetting('maxImageResolution', '1920')));
    setMaxImageSizeKB(parseInt(await getSetting('maxImageSizeKB', '1024')));
    setCacheMaxAgeDays(parseInt(await getSetting('cacheMaxAgeDays', '30')));
    setLazyLoadImages((await getSetting('lazyLoadImages', 'true')) === 'true');
    setAutoDeleteOld((await getSetting('autoDeleteOld', 'false')) === 'true');
    setAutoDeleteDays(parseInt(await getSetting('autoDeleteDays', '60')));

    const size = await getCacheSize();
    setCacheSize(size);
  };

  const saveSetting = async (key, value) => {
    await setSetting(key, String(value));
  };

  const handleSaveName = async () => {
    if (nameInput.trim()) {
      await updateUserName(nameInput.trim());
      setEditingName(false);
    }
  };

  const handleToggleWifi = async (value) => {
    setWifiOnly(value);
    await saveSetting('wifiOnly', value);
  };

  const handleClearCache = () => {
    Alert.alert(
      'Cache leeren?',
      'Alle heruntergeladenen Bilder werden gelöscht. Sie werden bei Bedarf neu heruntergeladen.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Leeren', style: 'destructive', onPress: async () => {
            await clearCache();
            const size = await getCacheSize();
            setCacheSize(size);
          }
        },
      ]
    );
  };

  const handleDisconnect = () => {
    Alert.alert(
      'Verbindung trennen?',
      'Du musst den QR-Code erneut scannen, um dich wieder zu verbinden.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Trennen', style: 'destructive', onPress: async () => {
            await disconnect();
            navigation.replace('Connect');
          }
        },
      ]
    );
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const resolutionOptions = [
    { label: '640px', value: 640 },
    { label: '800px', value: 800 },
    { label: '1280px', value: 1280 },
    { label: '1920px', value: 1920 },
    { label: '2560px', value: 2560 },
    { label: 'Original', value: 0 },
  ];

  const maxSizeOptions = [
    { label: '250 KB', value: 250 },
    { label: '500 KB', value: 500 },
    { label: '1 MB', value: 1024 },
    { label: '2 MB', value: 2048 },
    { label: '5 MB', value: 5120 },
    { label: 'Kein Limit', value: 0 },
  ];

  const ageDayOptions = [
    { label: '7 Tage', value: 7 },
    { label: '14 Tage', value: 14 },
    { label: '30 Tage', value: 30 },
    { label: '60 Tage', value: 60 },
    { label: '90 Tage', value: 90 },
    { label: 'Nie', value: 0 },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* User */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Benutzer</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Name</Text>
            <Text style={styles.settingDesc}>Wird bei deinen Fotos gespeichert</Text>
          </View>
          {editingName ? (
            <View style={styles.editRow}>
              <TextInput
                style={styles.nameInput}
                value={nameInput}
                onChangeText={setNameInput}
                autoFocus
              />
              <TouchableOpacity onPress={handleSaveName}>
                <Ionicons name="checkmark" size={24} color={colors.success} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => { setNameInput(userName); setEditingName(true); }}>
              <Text style={styles.settingValue}>{userName || 'Nicht gesetzt'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Upload */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Upload</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Nur über WLAN</Text>
            <Text style={styles.settingDesc}>Deaktiviere um auch mobile Daten zu nutzen</Text>
          </View>
          <Switch
            value={wifiOnly}
            onValueChange={handleToggleWifi}
            trackColor={{ false: colors.bgTertiary, true: colors.accent }}
            thumbColor="white"
          />
        </View>
      </View>

      {/* Image Sync & Compression */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Bilder-Download</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Lazy Loading</Text>
            <Text style={styles.settingDesc}>Bilder erst laden, wenn ein Projekt geöffnet wird</Text>
          </View>
          <Switch
            value={lazyLoadImages}
            onValueChange={async (v) => { setLazyLoadImages(v); await saveSetting('lazyLoadImages', v); }}
            trackColor={{ false: colors.bgTertiary, true: colors.accent }}
            thumbColor="white"
          />
        </View>

        {/* Quality */}
        <View style={styles.settingBlock}>
          <Text style={styles.settingLabel}>Bildqualität: {imageQuality}%</Text>
          <Text style={styles.settingDesc}>Niedrigere Qualität = weniger Speicherverbrauch</Text>
          <Slider
            value={imageQuality}
            min={10}
            max={100}
            step={5}
            onValueChange={async (v) => { setImageQuality(v); await saveSetting('imageQuality', v); }}
            leftLabel="Klein"
            rightLabel="Hoch"
          />
        </View>

        {/* Max Resolution */}
        <View style={styles.settingBlock}>
          <Text style={styles.settingLabel}>Maximale Auflösung</Text>
          <Text style={styles.settingDesc}>Heruntergeladene Bilder werden auf diese Größe skaliert</Text>
          <View style={styles.optionGrid}>
            {resolutionOptions.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionChip, maxResolution === opt.value && styles.optionChipActive]}
                onPress={async () => { setMaxResolution(opt.value); await saveSetting('maxImageResolution', opt.value); }}
              >
                <Text style={[styles.optionChipText, maxResolution === opt.value && styles.optionChipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Max File Size */}
        <View style={styles.settingBlock}>
          <Text style={styles.settingLabel}>Maximale Dateigröße pro Bild</Text>
          <Text style={styles.settingDesc}>Bilder werden komprimiert, bis sie diese Größe nicht überschreiten</Text>
          <View style={styles.optionGrid}>
            {maxSizeOptions.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionChip, maxImageSizeKB === opt.value && styles.optionChipActive]}
                onPress={async () => { setMaxImageSizeKB(opt.value); await saveSetting('maxImageSizeKB', opt.value); }}
              >
                <Text style={[styles.optionChipText, maxImageSizeKB === opt.value && styles.optionChipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {/* Storage */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Speicher</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Alte Bilder automatisch löschen</Text>
            <Text style={styles.settingDesc}>Nur vom Gerät, nicht vom Server</Text>
          </View>
          <Switch
            value={autoDeleteOld}
            onValueChange={async (v) => { setAutoDeleteOld(v); await saveSetting('autoDeleteOld', v); }}
            trackColor={{ false: colors.bgTertiary, true: colors.accent }}
            thumbColor="white"
          />
        </View>

        {autoDeleteOld && (
          <View style={styles.settingBlock}>
            <Text style={styles.settingLabel}>Bilder löschen, die älter sind als:</Text>
            <View style={styles.optionGrid}>
              {ageDayOptions.filter(o => o.value > 0).map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optionChip, autoDeleteDays === opt.value && styles.optionChipActive]}
                  onPress={async () => { setAutoDeleteDays(opt.value); await saveSetting('autoDeleteDays', opt.value); }}
                >
                  <Text style={[styles.optionChipText, autoDeleteDays === opt.value && styles.optionChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Cache Max Age */}
        <View style={styles.settingBlock}>
          <Text style={styles.settingLabel}>Cache-Lebensdauer</Text>
          <Text style={styles.settingDesc}>Wie lange heruntergeladene Bilder gespeichert bleiben</Text>
          <View style={styles.optionGrid}>
            {ageDayOptions.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionChip, cacheMaxAgeDays === opt.value && styles.optionChipActive]}
                onPress={async () => { setCacheMaxAgeDays(opt.value); await saveSetting('cacheMaxAgeDays', opt.value); }}
              >
                <Text style={[styles.optionChipText, cacheMaxAgeDays === opt.value && styles.optionChipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Cache info */}
        <View style={styles.cacheInfo}>
          <View>
            <Text style={styles.settingLabel}>Belegter Speicher</Text>
            <Text style={styles.cacheSize}>{formatBytes(cacheSize)}</Text>
          </View>
          <TouchableOpacity style={styles.clearCacheBtn} onPress={handleClearCache}>
            <Ionicons name="trash-outline" size={16} color={colors.error} />
            <Text style={styles.clearCacheText}>Cache leeren</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Connection */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Verbindung</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Server</Text>
            <Text style={styles.settingDesc}>{serverUrl || 'Nicht verbunden'}</Text>
          </View>
          <View style={[styles.statusDot, isConnected ? styles.statusOnline : styles.statusOffline]} />
        </View>

        <TouchableOpacity style={styles.dangerButton} onPress={handleDisconnect}>
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.dangerButtonText}>Verbindung trennen</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  content: {
    padding: 16,
  },
  section: {
    backgroundColor: colors.cardBg,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.textTertiary,
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 8,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  settingDesc: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
  settingValue: {
    fontSize: 15,
    color: colors.accent,
  },
  settingBlock: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: colors.textPrimary,
    minWidth: 150,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  optionChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgTertiary,
  },
  optionChipActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
  },
  optionChipText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  optionChipTextActive: {
    color: colors.accent,
  },
  cacheInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cacheSize: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 4,
  },
  clearCacheBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
  },
  clearCacheText: {
    fontSize: 13,
    color: colors.error,
    fontWeight: '500',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusOnline: {
    backgroundColor: colors.success,
  },
  statusOffline: {
    backgroundColor: colors.error,
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.error,
    marginTop: 8,
  },
  dangerButtonText: {
    color: colors.error,
    fontSize: 15,
    fontWeight: '500',
  },
});
