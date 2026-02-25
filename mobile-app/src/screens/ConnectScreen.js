import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, FlatList } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { setSetting, getDriveConnections, addDriveConnection, setActiveDriveConnection, removeDriveConnection, updateDriveConnectionFolders } from '../services/database';
import { verifyConnection, findOrCreateFolder } from '../services/driveService';

export default function ConnectScreen() {
  const { isGoogleAuthed, onSetupComplete, onDriveConnect } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [connections, setConnections] = useState([]);
  const [showScanner, setShowScanner] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(true);

  // In setup mode (no Google auth yet), go straight to scanner
  const isSetupMode = !isGoogleAuthed;

  useEffect(() => {
    if (isSetupMode) {
      setShowScanner(true);
      setLoading(false);
    } else {
      loadConnections();
    }
  }, []);

  const loadConnections = async () => {
    try {
      const conns = await getDriveConnections();
      setConnections(conns);
    } catch (e) {
      console.error('[Fuchs] Failed to load connections:', e);
    } finally {
      setLoading(false);
    }
  };

  const parseQrData = (data) => {
    // Format 1: JSON (from desktop software)
    // {"type":"fuchs_drive","googleClientId":"...","rootFolderId":"...","name":"..."}
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'fuchs_drive' && parsed.rootFolderId) {
        return {
          name: parsed.name || 'Drive-Verbindung',
          rootFolderId: parsed.rootFolderId,
          googleClientId: parsed.googleClientId || null,
        };
      }
    } catch {}

    // Format 2: URL with folder ID as parameter
    // fuchs://drive?name=Firma&root=FOLDER_ID
    try {
      if (data.startsWith('fuchs://')) {
        const url = new URL(data);
        const rootId = url.searchParams.get('root');
        const name = url.searchParams.get('name') || 'Drive-Verbindung';
        const clientId = url.searchParams.get('clientId') || null;
        if (rootId) return { name, rootFolderId: rootId, googleClientId: clientId };
      }
    } catch {}

    // Format 3: Plain Google Drive folder URL
    // https://drive.google.com/drive/folders/FOLDER_ID
    try {
      const match = data.match(/drive\.google\.com\/drive\/folders\/([a-zA-Z0-9_-]+)/);
      if (match) {
        return { name: 'Google Drive', rootFolderId: match[1], googleClientId: null };
      }
    } catch {}

    return null;
  };

  const handleBarCodeScanned = async ({ data }) => {
    if (scanned) return;
    setScanned(true);

    const parsed = parseQrData(data);
    if (!parsed) {
      Alert.alert('Ungültiger QR-Code', 'Dieser QR-Code enthält keine gültige Drive-Verbindung.');
      setScanned(false);
      return;
    }

    setConnecting(true);

    if (isSetupMode) {
      // SETUP MODE: Store client ID + connection, don't verify yet (no auth)
      try {
        if (parsed.googleClientId) {
          await setSetting('googleClientId', parsed.googleClientId);
        } else {
          Alert.alert(
            'QR-Code unvollständig',
            'Der QR-Code enthält keine Google Client ID. Bitte erstelle einen neuen QR-Code in der Desktop-Software.'
          );
          setScanned(false);
          setConnecting(false);
          return;
        }

        // Save the Drive connection (without meta/inbox folders - will be created after Google Sign-In)
        await addDriveConnection(parsed.name, parsed.rootFolderId);

        Alert.alert(
          'Einrichtung erfolgreich!',
          `Drive-Ordner "${parsed.name}" wurde gespeichert.\n\nMelde dich jetzt mit deinem Google-Konto an.`
        );

        // Transition to LoginScreen
        onSetupComplete();
      } catch (error) {
        Alert.alert('Fehler', error.message);
        setScanned(false);
      } finally {
        setConnecting(false);
      }
    } else {
      // CONNECT MODE: Already authenticated, verify and activate
      try {
        const folderName = await verifyConnection(parsed.rootFolderId);
        if (!folderName) {
          Alert.alert(
            'Zugriff verweigert',
            'Der Drive-Ordner ist nicht für dein Google-Konto freigegeben.\n\nBitte den Administrator, den Ordner mit deinem Google-Konto zu teilen.'
          );
          setScanned(false);
          setConnecting(false);
          return;
        }

        const connectionName = parsed.name !== 'Google Drive' ? parsed.name : folderName;

        // Find or create NR_Fuchs_Meta folder
        const metaFolder = await findOrCreateFolder(parsed.rootFolderId, 'NR_Fuchs_Meta');
        const inboxFolder = await findOrCreateFolder(metaFolder.id, 'inbox');

        // Save connection
        await addDriveConnection(connectionName, parsed.rootFolderId, metaFolder.id, inboxFolder.id);

        // Update client ID if provided
        if (parsed.googleClientId) {
          await setSetting('googleClientId', parsed.googleClientId);
        }

        Alert.alert('Verbunden!', `"${connectionName}" wurde verbunden.`);
        setShowScanner(false);

        // Activate this connection
        const conns = await getDriveConnections();
        const active = conns.find(c => c.is_active === 1);
        if (active) {
          onDriveConnect(active);
        }
      } catch (error) {
        Alert.alert('Fehler', error.message);
        setScanned(false);
      } finally {
        setConnecting(false);
      }
    }
  };

  const handleSelectConnection = async (connection) => {
    setConnecting(true);
    try {
      const accessible = await verifyConnection(connection.root_folder_id);
      if (!accessible) {
        Alert.alert('Nicht erreichbar', 'Der Drive-Ordner ist nicht mehr zugänglich.');
        setConnecting(false);
        return;
      }

      if (!connection.meta_folder_id || !connection.inbox_folder_id) {
        const metaFolder = await findOrCreateFolder(connection.root_folder_id, 'NR_Fuchs_Meta');
        const inboxFolder = await findOrCreateFolder(metaFolder.id, 'inbox');
        await updateDriveConnectionFolders(connection.id, metaFolder.id, inboxFolder.id);
        connection.meta_folder_id = metaFolder.id;
        connection.inbox_folder_id = inboxFolder.id;
      }

      await setActiveDriveConnection(connection.id);
      onDriveConnect(connection);
    } catch (error) {
      Alert.alert('Fehler', error.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDeleteConnection = (connection) => {
    Alert.alert(
      'Verbindung entfernen?',
      `"${connection.name}" wird entfernt. Du kannst sie jederzeit erneut per QR-Code hinzufügen.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: async () => {
            await removeDriveConnection(connection.id);
            await loadConnections();
          },
        },
      ]
    );
  };

  // QR Scanner view
  if (showScanner) {
    if (!permission) {
      return <View style={styles.container}><ActivityIndicator color={colors.accent} /></View>;
    }

    if (!permission.granted) {
      return (
        <View style={styles.container}>
          <Ionicons name="camera-outline" size={64} color={colors.textTertiary} />
          <Text style={styles.title}>Kamera-Zugriff benötigt</Text>
          <Text style={styles.subtitle}>Um den QR-Code zu scannen, benötigt die App Zugriff auf die Kamera.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
            <Text style={styles.primaryButtonText}>Kamera erlauben</Text>
          </TouchableOpacity>
          {!isSetupMode && (
            <TouchableOpacity style={styles.linkButton} onPress={() => setShowScanner(false)}>
              <Text style={styles.linkText}>Zurück</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    return (
      <View style={styles.container}>
        {connecting ? (
          <>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.subtitle}>
              {isSetupMode ? 'Einrichtung läuft...' : 'Verbindung wird hergestellt...'}
            </Text>
          </>
        ) : (
          <>
            {isSetupMode ? (
              <>
                <View style={styles.iconCircle}>
                  <Ionicons name="construct" size={36} color={colors.accent} />
                </View>
                <Text style={styles.title}>Fuchs Metallbau</Text>
                <Text style={styles.subtitle}>
                  Scanne den QR-Code aus der Desktop-Software{'\n'}(Einstellungen → Handy App)
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.title}>Drive-Ordner verbinden</Text>
                <Text style={styles.subtitle}>
                  Scanne den QR-Code aus der Desktop-Software{'\n'}(Einstellungen → Handy App)
                </Text>
              </>
            )}

            <View style={styles.cameraContainer}>
              <CameraView
                style={styles.camera}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
              />
              <View style={styles.overlay}>
                <View style={styles.scanArea} />
              </View>
            </View>

            {!isSetupMode && (
              <TouchableOpacity style={styles.linkButton} onPress={() => { setShowScanner(false); setScanned(false); }}>
                <Text style={styles.linkText}>Zurück zur Auswahl</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    );
  }

  // Main connection selection view (only when authenticated)
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.iconCircle}>
          <Ionicons name="cloud" size={36} color={colors.accent} />
        </View>
        <Text style={styles.title}>Google Drive verbinden</Text>
        <Text style={styles.subtitle}>
          Wähle einen bestehenden Drive-Ordner oder scanne einen neuen QR-Code.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} />
      ) : connections.length > 0 ? (
        <FlatList
          data={connections}
          keyExtractor={c => String(c.id)}
          style={styles.connectionList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.connectionCard, item.is_active === 1 && styles.connectionCardActive]}
              onPress={() => handleSelectConnection(item)}
              onLongPress={() => handleDeleteConnection(item)}
              disabled={connecting}
            >
              <View style={styles.connectionIcon}>
                <Ionicons
                  name={item.is_active === 1 ? 'folder' : 'folder-outline'}
                  size={24}
                  color={item.is_active === 1 ? colors.accent : colors.textTertiary}
                />
              </View>
              <View style={styles.connectionInfo}>
                <Text style={styles.connectionName}>{item.name}</Text>
                <Text style={styles.connectionMeta}>
                  Erstellt am {new Date(item.created_at).toLocaleDateString('de-DE')}
                </Text>
              </View>
              {connecting ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
              )}
            </TouchableOpacity>
          )}
          ListFooterComponent={
            <Text style={styles.hintText}>
              Lange drücken um eine Verbindung zu entfernen
            </Text>
          }
        />
      ) : (
        <View style={styles.emptyState}>
          <Ionicons name="qr-code-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.emptyText}>
            Noch keine Verbindung vorhanden.{'\n'}Scanne einen QR-Code, um zu starten.
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => { setShowScanner(true); setScanned(false); }}
      >
        <Ionicons name="qr-code" size={20} color="white" />
        <Text style={styles.primaryButtonText}>QR-Code scannen</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
    lineHeight: 22,
  },
  connectionList: {
    width: '100%',
    maxHeight: 300,
    marginBottom: 16,
  },
  connectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBg,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  connectionCardActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
  },
  connectionIcon: {
    marginRight: 14,
  },
  connectionInfo: {
    flex: 1,
  },
  connectionName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  connectionMeta: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
  hintText: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  emptyState: {
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  cameraContainer: {
    width: 280,
    height: 280,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.accent,
    marginBottom: 16,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanArea: {
    width: 200,
    height: 200,
    borderWidth: 2,
    borderColor: 'rgba(59, 130, 246, 0.5)',
    borderRadius: 8,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 10,
    width: '100%',
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    marginTop: 16,
    padding: 8,
  },
  linkText: {
    color: colors.accent,
    fontSize: 14,
  },
});
