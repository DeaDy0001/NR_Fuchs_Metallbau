import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, ActivityIndicator, Linking } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { useDialog } from '../components/CustomDialog';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { getSetting, setSetting, getCachedProjects } from '../services/database';
import { getCacheSize, clearCache, cleanupCache, downloadProjectImages } from '../services/syncService';
import { fetchProjectImages, downloadAppUpdateApk } from '../services/api';
import Slider from '../components/Slider';
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';

export default function SettingsScreen({ navigation }) {
  const { alert } = useDialog();
  const { userName, userEmail, updateUserName, disconnectDrive, logout, resetSetup, activeConnection, updateAvailable, updateInfo, recheckUpdate } = useApp();

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(userName);
  const [wifiOnly, setWifiOnly] = useState(true);
  const [cacheSize, setCacheSize] = useState(0);

  // Compression settings
  const [imageQuality, setImageQuality] = useState(80);
  const [maxResolution, setMaxResolution] = useState(1920);
  const [maxImageSizeKB, setMaxImageSizeKB] = useState(1024);
  const [keepOriginal, setKeepOriginal] = useState(true);
  const [cacheMaxAgeDays, setCacheMaxAgeDays] = useState(30);
  const [lazyLoadImages, setLazyLoadImages] = useState(true);
  const [autoDeleteOld, setAutoDeleteOld] = useState(false);
  const [autoDeleteDays, setAutoDeleteDays] = useState(60);

  // GPS settings
  const [gpsDefault, setGpsDefault] = useState(true);

  // Bulk download
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');
  const [downloadMaxDays, setDownloadMaxDays] = useState(60);

  // App update download state (checking comes from AppContext)
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState(0);

  const installedVersion = Constants.expoConfig?.version || '0.0.0';

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setWifiOnly((await getSetting('wifiOnly', 'true')) === 'true');
    setImageQuality(parseInt(await getSetting('imageQuality', '80')));
    setMaxResolution(parseInt(await getSetting('maxImageResolution', '1920')));
    setMaxImageSizeKB(parseInt(await getSetting('maxImageSizeKB', '1024')));
    setKeepOriginal((await getSetting('keepOriginal', 'true')) === 'true');
    setCacheMaxAgeDays(parseInt(await getSetting('cacheMaxAgeDays', '30')));
    setLazyLoadImages((await getSetting('lazyLoadImages', 'true')) === 'true');
    setAutoDeleteOld((await getSetting('autoDeleteOld', 'false')) === 'true');
    setAutoDeleteDays(parseInt(await getSetting('autoDeleteDays', '60')));
    setGpsDefault((await getSetting('gpsDefault', 'true')) === 'true');
    setDownloadMaxDays(parseInt(await getSetting('downloadMaxDays', '60')));

    const size = await getCacheSize();
    setCacheSize(size);
  };

  const saveSetting = async (key, value) => {
    await setSetting(key, String(value));
  };

  const handleCheckForUpdate = async () => {
    setUpdateChecking(true);
    try {
      await recheckUpdate();
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleDownloadAndInstall = async () => {
    if (!updateInfo?.apkFileId) return;
    setUpdateDownloading(true);
    setUpdateDownloadProgress(0);
    try {
      const uri = await downloadAppUpdateApk(updateInfo.apkFileId, (pct) => {
        setUpdateDownloadProgress(pct);
      });
      const contentUri = await FileSystem.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: 'application/vnd.android.package-archive',
      });
    } catch (e) {
      alert('Update-Fehler', 'Download fehlgeschlagen: ' + (e.message || 'Unbekannter Fehler'));
    } finally {
      setUpdateDownloading(false);
      setUpdateDownloadProgress(0);
    }
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
    alert(
      'Cache leeren?',
      'Alle heruntergeladenen Bilder werden gelöscht. Sie werden bei Bedarf neu von Google Drive heruntergeladen.',
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

  const handleBulkDownload = () => {
    alert(
      'Bilder herunterladen',
      `Alle Projektbilder der letzten ${downloadMaxDays} Tage werden heruntergeladen.\n\nDies kann je nach Menge einige Zeit dauern.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Herunterladen', onPress: startBulkDownload },
      ]
    );
  };

  const startBulkDownload = async () => {
    setDownloading(true);
    setDownloadProgress('Projekte laden...');

    try {
      const projects = await getCachedProjects();
      let totalDownloaded = 0;
      let totalImages = 0;

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - downloadMaxDays);

      for (let i = 0; i < projects.length; i++) {
        const project = projects[i];
        if (!project.folder_id) continue;

        setDownloadProgress(`Projekt ${i + 1}/${projects.length}: ${project.folder_name}`);

        try {
          const images = await fetchProjectImages(project.folder_id);

          // Filter by date
          const filteredImages = downloadMaxDays > 0
            ? images.filter(img => new Date(img.modified_time) >= cutoffDate)
            : images;

          totalImages += filteredImages.length;

          if (filteredImages.length > 0) {
            const downloaded = await downloadProjectImages(
              project.id,
              filteredImages,
              (done, total) => {
                setDownloadProgress(
                  `${project.folder_name}: ${done}/${total} Bilder\n(Projekt ${i + 1}/${projects.length})`
                );
              }
            );
            totalDownloaded += downloaded;
          }
        } catch (error) {
          console.error(`Failed to download images for project ${project.folder_name}:`, error);
        }
      }

      const size = await getCacheSize();
      setCacheSize(size);

      alert(
        'Download abgeschlossen',
        `${totalDownloaded} von ${totalImages} Bildern heruntergeladen.`
      );
    } catch (error) {
      alert('Fehler', 'Download fehlgeschlagen: ' + error.message);
    } finally {
      setDownloading(false);
      setDownloadProgress('');
    }
  };

  const handleDisconnectDrive = () => {
    alert(
      'Drive-Verbindung trennen?',
      'Du kannst danach einen anderen Drive-Ordner auswählen oder per QR-Code hinzufügen.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Trennen', style: 'destructive', onPress: () => disconnectDrive() },
      ]
    );
  };

  const handleLogout = () => {
    alert(
      'Abmelden?',
      'Du wirst von deinem Google-Konto abgemeldet und musst dich erneut anmelden.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Abmelden', style: 'destructive', onPress: () => logout() },
      ]
    );
  };

  const handleResetSetup = () => {
    alert(
      'Einrichtung zurücksetzen?',
      'Alle Verbindungsdaten und die Google-Anmeldung werden gelöscht. Du musst den QR-Code erneut scannen.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Zurücksetzen', style: 'destructive', onPress: () => resetSetup() },
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

  const downloadDayOptions = [
    { label: '7 Tage', value: 7 },
    { label: '14 Tage', value: 14 },
    { label: '30 Tage', value: 30 },
    { label: '60 Tage', value: 60 },
    { label: '90 Tage', value: 90 },
    { label: '180 Tage', value: 180 },
    { label: 'Alle', value: 0 },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* App Update */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>App-Update</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Installierte Version</Text>
            <Text style={styles.settingDesc}>v{installedVersion}</Text>
          </View>
          <TouchableOpacity onPress={handleCheckForUpdate} disabled={updateChecking}>
            <Ionicons
              name="refresh-outline"
              size={20}
              color={updateChecking ? colors.textTertiary : colors.accent}
            />
          </TouchableOpacity>
        </View>

        {updateChecking && (
          <View style={styles.updateRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.updateText}>Prüfe auf Updates…</Text>
          </View>
        )}

        {!updateChecking && updateAvailable && updateInfo && (
          <View style={styles.updateAvailableBox}>
            <View style={styles.updateAvailableHeader}>
              <Ionicons name="arrow-up-circle" size={20} color={colors.success} />
              <Text style={styles.updateAvailableTitle}>
                Update verfügbar: v{updateInfo.version}
              </Text>
            </View>

            {updateDownloading ? (
              <View style={styles.updateProgressBox}>
                <View style={[styles.updateProgressBar, { width: `${updateDownloadProgress}%` }]} />
                <Text style={styles.updateProgressText}>{updateDownloadProgress}% heruntergeladen…</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.updateButton} onPress={handleDownloadAndInstall}>
                <Ionicons name="download-outline" size={18} color="white" />
                <Text style={styles.updateButtonText}>Herunterladen & Installieren</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {!updateChecking && !updateAvailable && (
          <Text style={styles.updateUpToDate}>App ist aktuell</Text>
        )}
      </View>

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

        {userEmail ? (
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Google-Konto</Text>
            </View>
            <Text style={styles.settingValueSmall}>{userEmail}</Text>
          </View>
        ) : null}
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

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>GPS standardmäßig aktiv</Text>
            <Text style={styles.settingDesc}>Standortdaten bei jedem Foto speichern</Text>
          </View>
          <Switch
            value={gpsDefault}
            onValueChange={async (v) => { setGpsDefault(v); await saveSetting('gpsDefault', v); }}
            trackColor={{ false: colors.bgTertiary, true: colors.accent }}
            thumbColor="white"
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Original behalten</Text>
            <Text style={styles.settingDesc}>
              {keepOriginal
                ? 'Originalfoto wird in der Galerie gespeichert, komprimierte Version wird hochgeladen'
                : 'Nur die komprimierte Version bleibt in der App'}
            </Text>
          </View>
          <Switch
            value={keepOriginal}
            onValueChange={async (v) => { setKeepOriginal(v); await saveSetting('keepOriginal', v); }}
            trackColor={{ false: colors.bgTertiary, true: colors.accent }}
            thumbColor="white"
          />
        </View>
      </View>

      {/* Upload Compression */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Bildkomprimierung</Text>

        {/* Quality */}
        <View style={styles.settingBlock}>
          <Text style={styles.settingLabel}>Bildqualität: {imageQuality}%</Text>
          <Text style={styles.settingDesc}>Qualität der hochgeladenen Bilder (niedrigere Werte = kleinere Dateien)</Text>
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
          <Text style={styles.settingDesc}>Bilder werden vor dem Hochladen auf diese Größe skaliert</Text>
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
          <Text style={styles.settingDesc}>Bilder werden zusätzlich komprimiert, bis sie diese Größe nicht überschreiten</Text>
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

      {/* Bilder herunterladen */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Bilder herunterladen</Text>

        <View style={styles.settingBlock}>
          <Text style={styles.settingLabel}>Zeitraum für Bilder-Download</Text>
          <Text style={styles.settingDesc}>Nur Bilder herunterladen, die nicht älter sind als:</Text>
          <View style={styles.optionGrid}>
            {downloadDayOptions.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionChip, downloadMaxDays === opt.value && styles.optionChipActive]}
                onPress={async () => { setDownloadMaxDays(opt.value); await saveSetting('downloadMaxDays', opt.value); }}
              >
                <Text style={[styles.optionChipText, downloadMaxDays === opt.value && styles.optionChipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.downloadButton, downloading && styles.buttonDisabled]}
          onPress={handleBulkDownload}
          disabled={downloading}
        >
          {downloading ? (
            <View style={styles.downloadingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.downloadingText}>{downloadProgress}</Text>
            </View>
          ) : (
            <>
              <Ionicons name="download-outline" size={20} color={colors.accent} />
              <Text style={styles.downloadButtonText}>Alle Projektbilder herunterladen</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Bilder-Anzeige */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Bilder-Anzeige</Text>

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
      </View>

      {/* Storage */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Speicher</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Alte Bilder automatisch löschen</Text>
            <Text style={styles.settingDesc}>Nur vom Gerät, nicht von Google Drive</Text>
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

      {/* Drive Connection */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Google Drive</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Verbundener Ordner</Text>
            <Text style={styles.settingDesc}>{activeConnection?.name || 'Kein Ordner'}</Text>
          </View>
          <View style={[styles.statusDot, styles.statusOnline]} />
        </View>

        <TouchableOpacity style={styles.secondaryButton} onPress={handleDisconnectDrive}>
          <Ionicons name="swap-horizontal-outline" size={18} color={colors.accent} />
          <Text style={styles.secondaryButtonText}>Drive-Ordner wechseln</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.dangerButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.dangerButtonText}>Von Google abmelden</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.dangerButton, { marginTop: 8 }]} onPress={handleResetSetup}>
          <Ionicons name="refresh-outline" size={18} color={colors.error} />
          <Text style={styles.dangerButtonText}>Einrichtung zurücksetzen</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: 16 },
  section: {
    backgroundColor: colors.cardBg, borderRadius: 12, padding: 16,
    marginBottom: 16, borderWidth: 1, borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: 13, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.5, color: colors.textTertiary, marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 8, marginBottom: 8,
  },
  settingInfo: { flex: 1, marginRight: 16 },
  settingLabel: { fontSize: 15, fontWeight: '500', color: colors.textPrimary },
  settingDesc: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  settingValue: { fontSize: 15, color: colors.accent },
  settingValueSmall: { fontSize: 13, color: colors.textSecondary },
  settingBlock: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: {
    backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 15, color: colors.textPrimary, minWidth: 150,
  },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  optionChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgTertiary,
  },
  optionChipActive: { borderColor: colors.accent, backgroundColor: 'rgba(59, 130, 246, 0.15)' },
  optionChipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  optionChipTextActive: { color: colors.accent },
  cacheInfo: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border,
  },
  cacheSize: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginTop: 4 },
  clearCacheBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: colors.error,
  },
  clearCacheText: { fontSize: 13, color: colors.error, fontWeight: '500' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusOnline: { backgroundColor: colors.success },
  secondaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 12, borderRadius: 10, borderWidth: 1,
    borderColor: colors.accent, marginTop: 8, marginBottom: 8,
  },
  secondaryButtonText: { color: colors.accent, fontSize: 15, fontWeight: '500' },
  dangerButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 12, borderRadius: 10, borderWidth: 1,
    borderColor: colors.error, marginTop: 4,
  },
  dangerButtonText: { color: colors.error, fontSize: 15, fontWeight: '500' },

  // Update section
  updateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  updateText: { fontSize: 13, color: colors.textSecondary },
  updateUpToDate: { fontSize: 13, color: colors.textTertiary, paddingVertical: 4 },
  updateAvailableBox: {
    marginTop: 8, padding: 12, borderRadius: 10,
    backgroundColor: 'rgba(34,197,94,0.08)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.25)',
    gap: 8,
  },
  updateAvailableHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  updateAvailableTitle: { fontSize: 14, fontWeight: '600', color: colors.success, flex: 1 },
  updateChangelog: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  updateButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 10, borderRadius: 8,
    backgroundColor: colors.success, marginTop: 4,
  },
  updateButtonText: { color: 'white', fontSize: 14, fontWeight: '600' },
  updateProgressBox: {
    marginTop: 4, height: 28, backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 6, overflow: 'hidden', justifyContent: 'center',
  },
  updateProgressBar: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    backgroundColor: colors.success, borderRadius: 6,
  },
  updateProgressText: {
    fontSize: 12, color: 'white', textAlign: 'center', fontWeight: '500',
  },

  // Download section
  downloadButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 14, borderRadius: 10, borderWidth: 1,
    borderColor: colors.accent, marginTop: 12,
  },
  downloadButtonText: { color: colors.accent, fontSize: 15, fontWeight: '500' },
  buttonDisabled: { opacity: 0.6 },
  downloadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  downloadingText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
});
