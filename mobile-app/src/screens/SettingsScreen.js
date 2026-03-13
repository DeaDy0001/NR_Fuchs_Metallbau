import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, ActivityIndicator, Linking, AppState, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { useDialog } from '../components/CustomDialog';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { getSetting, setSetting } from '../services/database';
import { getCacheSize, clearCache, syncAllThumbnails, cleanupFullImages } from '../services/syncService';
import { downloadAppUpdateApk, downloadDevApk } from '../services/api';
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
  const [lazyLoadImages, setLazyLoadImages] = useState(true);
  const [autoDeleteOld, setAutoDeleteOld] = useState(false);
  const [autoDeleteUnit, setAutoDeleteUnit] = useState('monate');   // 'tage' | 'monate' | 'jahre'
  const [autoDeleteValue, setAutoDeleteValue] = useState(10);
  const [autoDeleteDateType, setAutoDeleteDateType] = useState('upload'); // 'upload' | 'erstellung'

  // Bulk download / thumbnail sync
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');

  // Server-defined image format (read-only, synced from Drive on startup)
  const [serverImageFormat, setServerImageFormat] = useState('');

  // App update download state (checking comes from AppContext)
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState(0);

  // Dev/admin install state
  const [devInstalling, setDevInstalling] = useState(false);
  const [devInstallProgress, setDevInstallProgress] = useState(0);

  // Admin password modal
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');

  const installedVersion = Constants.expoConfig?.version || '0.0.0';

  // Refs for pause/resume of APK download when screen turns off
  const downloadResumableRef = useRef(null);
  const isDownloadPausedRef = useRef(false);

  useEffect(() => {
    loadSettings();
  }, []);

  // Cleanup download on unmount (e.g. user navigates away)
  useEffect(() => {
    return () => {
      downloadResumableRef.current = null;
      isDownloadPausedRef.current = false;
    };
  }, []);

  /**
   * Wraps downloadAppUpdateApk with AppState-aware pause/resume:
   * - Screen turns off (background/inactive) → download is paused
   * - App comes back to foreground (active) → download resumes automatically
   */
  const doDownloadWithResume = (apkFileId, onProgress) => {
    return new Promise((resolve, reject) => {
      let sub = null;
      isDownloadPausedRef.current = false;

      const done = (uri) => {
        sub?.remove();
        downloadResumableRef.current = null;
        resolve(uri);
      };

      const fail = (e) => {
        sub?.remove();
        downloadResumableRef.current = null;
        reject(e);
      };

      const tryResume = async () => {
        const dl = downloadResumableRef.current;
        if (!dl) return;
        isDownloadPausedRef.current = false;
        try {
          const result = await dl.resumeAsync();
          if (result?.uri) done(result.uri);
          // else: paused again immediately — next AppState event will retry
        } catch (e) {
          fail(e);
        }
      };

      sub = AppState.addEventListener('change', (nextState) => {
        const dl = downloadResumableRef.current;
        if (!dl) return;
        if ((nextState === 'background' || nextState === 'inactive') && !isDownloadPausedRef.current) {
          isDownloadPausedRef.current = true;
          dl.pauseAsync().catch(() => {});
        } else if (nextState === 'active' && isDownloadPausedRef.current) {
          tryResume();
        }
      });

      downloadAppUpdateApk(apkFileId, onProgress, (dl) => {
        downloadResumableRef.current = dl;
      }).then(done).catch((e) => {
        if (isDownloadPausedRef.current) return; // download was paused, will resume via AppState
        fail(e);
      });
    });
  };

  const loadSettings = async () => {
    setWifiOnly((await getSetting('wifiOnly', 'true')) === 'true');
    setImageQuality(parseInt(await getSetting('imageQuality', '80')));
    setMaxResolution(parseInt(await getSetting('maxImageResolution', '1920')));
    setMaxImageSizeKB(parseInt(await getSetting('maxImageSizeKB', '1024')));
    setKeepOriginal((await getSetting('keepOriginal', 'true')) === 'true');
    setLazyLoadImages((await getSetting('lazyLoadImages', 'true')) === 'true');
    setAutoDeleteOld((await getSetting('autoDeleteOld', 'false')) === 'true');
    setAutoDeleteUnit(await getSetting('autoDeleteUnit', 'monate'));
    setAutoDeleteValue(parseInt(await getSetting('autoDeleteValue', '10')));
    setAutoDeleteDateType(await getSetting('autoDeleteDateType', 'upload'));
    setServerImageFormat((await getSetting('serverImageFormat', 'jpeg')).toUpperCase());

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

  /**
   * Launch the APK installer and delete the local APK file once the app
   * returns to the foreground (i.e. after the user finishes/cancels the install).
   */
  const launchAndCleanup = async (localUri) => {
    const contentUri = await FileSystem.getContentUriAsync(localUri);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        sub.remove();
        FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
      }
    });
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/vnd.android.package-archive',
    });
  };

  const handleDownloadAndInstall = async () => {
    if (!updateInfo?.apkFileId) return;
    setUpdateDownloading(true);
    setUpdateDownloadProgress(0);
    try {
      const uri = await doDownloadWithResume(updateInfo.apkFileId, (pct) => {
        setUpdateDownloadProgress(pct);
      });
      await launchAndCleanup(uri);
    } catch (e) {
      alert('Update-Fehler', 'Download fehlgeschlagen: ' + (e.message || 'Unbekannter Fehler'));
    } finally {
      setUpdateDownloading(false);
      setUpdateDownloadProgress(0);
    }
  };

  const handleAdminIconPress = () => {
    setPasswordInput('');
    setShowPasswordModal(true);
  };

  const handleDevInstall = async () => {
    if (passwordInput !== 'netrock!"§$%&') {
      alert('Fehler', 'Falsches Passwort.');
      return;
    }
    setShowPasswordModal(false);
    setPasswordInput('');
    setDevInstalling(true);
    setDevInstallProgress(0);
    try {
      const uri = await downloadDevApk(
        (pct) => setDevInstallProgress(pct),
        (dl)  => { downloadResumableRef.current = dl; }
      );
      await launchAndCleanup(uri);
    } catch (e) {
      alert('Dev-Install Fehler', e.message || 'Unbekannter Fehler');
    } finally {
      setDevInstalling(false);
      setDevInstallProgress(0);
      downloadResumableRef.current = null;
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
    // Reset banner dismissal so it can reappear when re-enabled
    if (value) await saveSetting('wifiBannerDismissed', 'false');
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
      'Thumbnails synchronisieren',
      'Alle Vorschaubilder aller Projekte werden heruntergeladen.\n\nDies kann je nach Menge einige Zeit dauern.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Herunterladen', onPress: startBulkDownload },
      ]
    );
  };

  const startBulkDownload = async () => {
    setDownloading(true);
    setDownloadProgress('Starte...');

    try {
      const { downloaded, deleted } = await syncAllThumbnails((projectIndex, total, projectName) => {
        setDownloadProgress(`Projekt ${projectIndex + 1}/${total}:\n${projectName}`);
      });

      const size = await getCacheSize();
      setCacheSize(size);

      const parts = [];
      if (downloaded > 0) parts.push(`${downloaded} neue Thumbnails heruntergeladen`);
      if (deleted > 0) parts.push(`${deleted} gelöschte Bilder entfernt`);
      alert('Fertig', parts.length > 0 ? parts.join(', ') + '.' : 'Alles bereits aktuell.');
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

  return (
    <>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* App Update */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>App-Update</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Installierte Version</Text>
            <Text style={styles.settingDesc}>v{installedVersion}</Text>
          </View>
          {/* Admin icon – password-protected dev installer */}
          <TouchableOpacity onPress={handleAdminIconPress} disabled={devInstalling}>
            <Ionicons
              name="construct-outline"
              size={20}
              color={devInstalling ? colors.textTertiary : colors.textTertiary}
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
            {updateInfo.changelog ? (
              <Text style={styles.updateChangelog}>{updateInfo.changelog}</Text>
            ) : null}

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

        {/* Dev install progress */}
        {devInstalling && (
          <View style={styles.updateProgressBox}>
            <View style={[styles.updateProgressBar, { width: `${devInstallProgress}%` }]} />
            <Text style={styles.updateProgressText}>{devInstallProgress}% heruntergeladen (Dev)…</Text>
          </View>
        )}

        {/* Nach Updates suchen button (formerly "App erneut installieren") */}
        <View style={styles.reinstallBox}>
          <TouchableOpacity
            style={styles.reinstallButton}
            onPress={handleCheckForUpdate}
            disabled={updateChecking || devInstalling}
          >
            <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.reinstallButtonText}>Nach Updates suchen</Text>
          </TouchableOpacity>
        </View>
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
            <Text style={styles.settingLabel}>Bildformat</Text>
            <Text style={styles.settingDesc}>Wird vom Server festgelegt</Text>
          </View>
          <Text style={styles.settingValue}>{serverImageFormat || 'JPEG'}</Text>
        </View>

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
            <Text style={styles.settingLabel}>Original behalten</Text>
            <Text style={styles.settingDesc}>
              {keepOriginal
                ? 'Originalfoto wird beim Hochladen einmalig in der Galerie gespeichert'
                : 'Kein Foto wird in der Galerie gespeichert'}
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

      {/* Thumbnails herunterladen */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Vorschaubilder</Text>

        <Text style={styles.settingDesc}>
          Alle Vorschaubilder aller Projekte werden lokal gespeichert, damit sie auch ohne Internet verfügbar sind.
          Dabei werden auch Datum-Informationen der Bilder gespeichert (für die automatische Bereinigung).
        </Text>

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
              <Text style={styles.downloadButtonText}>Alle Vorschaubilder synchronisieren</Text>
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

        {/* Auto-delete toggle */}
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Alte Bilder automatisch löschen</Text>
            <Text style={styles.settingDesc}>Vollbilder ab einem bestimmten Alter vom Gerät entfernen (Nur Vollbilder – Vorschaubilder bleiben erhalten)</Text>
          </View>
          <Switch
            value={autoDeleteOld}
            onValueChange={async (v) => {
              setAutoDeleteOld(v);
              await saveSetting('autoDeleteOld', v);
              if (!v) return;
              try { await cleanupFullImages(); } catch {}
              const size = await getCacheSize();
              setCacheSize(size);
            }}
            trackColor={{ false: colors.bgTertiary, true: colors.accent }}
            thumbColor="white"
          />
        </View>

        {/* Cache-Lebensdauer – nur sichtbar wenn Toggle aktiv */}
        {autoDeleteOld && (
          <View style={[styles.settingBlock, styles.autoDeleteBox]}>
            <Text style={styles.settingLabel}>Cache-Lebensdauer</Text>

            {/* Unit selector */}
            <Text style={[styles.settingDesc, { marginTop: 8 }]}>Einheit</Text>
            <View style={styles.optionGrid}>
              {[{ label: 'Tage', value: 'tage' }, { label: 'Monate', value: 'monate' }, { label: 'Jahre', value: 'jahre' }].map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optionChip, autoDeleteUnit === opt.value && styles.optionChipActive]}
                  onPress={async () => {
                    const defaults = { tage: 30, monate: 10, jahre: 2 };
                    const newVal = defaults[opt.value];
                    setAutoDeleteUnit(opt.value);
                    setAutoDeleteValue(newVal);
                    await saveSetting('autoDeleteUnit', opt.value);
                    await saveSetting('autoDeleteValue', newVal);
                    try { await cleanupFullImages(); } catch {}
                    const size = await getCacheSize();
                    setCacheSize(size);
                  }}
                >
                  <Text style={[styles.optionChipText, autoDeleteUnit === opt.value && styles.optionChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Value slider */}
            <Text style={[styles.settingDesc, { marginTop: 12 }]}>
              Vollbilder löschen, die älter sind als: <Text style={{ color: colors.accent, fontWeight: '700' }}>{autoDeleteValue} {autoDeleteUnit === 'tage' ? 'Tage' : autoDeleteUnit === 'monate' ? 'Monate' : 'Jahre'}</Text>
            </Text>
            <Slider
              value={autoDeleteValue}
              min={1}
              max={autoDeleteUnit === 'tage' ? 365 : autoDeleteUnit === 'monate' ? 36 : 10}
              step={1}
              onValueChange={async (v) => {
                setAutoDeleteValue(v);
                await saveSetting('autoDeleteValue', v);
                try { await cleanupFullImages(); } catch {}
                const size = await getCacheSize();
                setCacheSize(size);
              }}
              leftLabel="1"
              rightLabel={autoDeleteUnit === 'tage' ? '365' : autoDeleteUnit === 'monate' ? '36' : '10'}
            />

            {/* Date type selector */}
            <Text style={[styles.settingDesc, { marginTop: 12 }]}>Datum verwenden</Text>
            <View style={styles.optionGrid}>
              {[
                { label: 'Upload-Datum', value: 'upload', desc: 'Wann das Bild hochgeladen wurde' },
                { label: 'Erstellungsdatum', value: 'erstellung', desc: 'EXIF-Datum der Aufnahme' },
              ].map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optionChip, autoDeleteDateType === opt.value && styles.optionChipActive]}
                  onPress={async () => {
                    setAutoDeleteDateType(opt.value);
                    await saveSetting('autoDeleteDateType', opt.value);
                    try { await cleanupFullImages(); } catch {}
                    const size = await getCacheSize();
                    setCacheSize(size);
                  }}
                >
                  <Text style={[styles.optionChipText, autoDeleteDateType === opt.value && styles.optionChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.settingDesc, { marginTop: 6 }]}>
              {autoDeleteDateType === 'erstellung'
                ? 'Bilder ohne Erstellungsdatum werden nicht gelöscht.'
                : 'Bilder ohne Upload-Datum werden nicht gelöscht.'}
            </Text>
          </View>
        )}

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

    {/* Admin / Dev-Install password modal */}
    <Modal
      visible={showPasswordModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowPasswordModal(false)}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={() => setShowPasswordModal(false)}
        />
        <View style={styles.passwordDialog}>
          <View style={styles.passwordDialogAccent} />
          <View style={styles.passwordDialogContent}>
            <View style={styles.passwordDialogHeader}>
              <Ionicons name="construct-outline" size={20} color={colors.textSecondary} />
              <Text style={styles.passwordDialogTitle}>Dev-Install</Text>
            </View>
            <Text style={styles.passwordDialogDesc}>
              Bitte Passwort eingeben um die aktuelle Dev-Version zu installieren.
            </Text>
            <TextInput
              style={styles.passwordInput}
              value={passwordInput}
              onChangeText={setPasswordInput}
              placeholder="Passwort"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoFocus
              onSubmitEditing={handleDevInstall}
            />
          </View>
          <View style={styles.passwordDialogButtons}>
            <TouchableOpacity
              style={[styles.passwordDialogBtn, styles.passwordDialogBtnCancel]}
              onPress={() => { setShowPasswordModal(false); setPasswordInput(''); }}
            >
              <Text style={styles.passwordDialogBtnTextCancel}>Abbrechen</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.passwordDialogBtn, styles.passwordDialogBtnPrimary]}
              onPress={handleDevInstall}
            >
              <Text style={styles.passwordDialogBtnTextPrimary}>Installieren</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    </>
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
  autoDeleteBox: {
    backgroundColor: 'rgba(59,130,246,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.2)',
    paddingHorizontal: 12,
    marginTop: 4,
  },
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

  reinstallBox: { marginTop: 10 },
  reinstallButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 10, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  reinstallButtonText: { fontSize: 13, color: colors.textSecondary },

  // Password modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center',
  },
  passwordDialog: {
    width: 320, backgroundColor: colors.bgSecondary,
    borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
    elevation: 24,
  },
  passwordDialogAccent: { height: 3, backgroundColor: colors.textTertiary },
  passwordDialogContent: { padding: 20, paddingBottom: 12 },
  passwordDialogHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  passwordDialogTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  passwordDialogDesc: { fontSize: 13, color: colors.textSecondary, marginBottom: 14, lineHeight: 18 },
  passwordInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: colors.textPrimary,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  passwordDialogButtons: {
    flexDirection: 'row', gap: 8, padding: 12, paddingTop: 0,
  },
  passwordDialogBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
  },
  passwordDialogBtnCancel: { backgroundColor: colors.bgTertiary },
  passwordDialogBtnPrimary: { backgroundColor: colors.accent },
  passwordDialogBtnTextCancel: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  passwordDialogBtnTextPrimary: { fontSize: 14, fontWeight: '600', color: '#ffffff' },

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
