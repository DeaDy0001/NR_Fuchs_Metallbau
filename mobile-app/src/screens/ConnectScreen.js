import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList, Modal, SafeAreaView } from 'react-native';
import { useDialog } from '../components/CustomDialog';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { setSetting, getSetting, getDriveConnections, addDriveConnection, setActiveDriveConnection, removeDriveConnection, updateDriveConnectionFolders } from '../services/database';
import { verifyConnection, findOrCreateFolder } from '../services/driveService';
import { hasFullDriveScope, storeTokens, storeUserInfo, storeGrantedScope } from '../services/googleAuth';

export default function ConnectScreen() {
  const { alert } = useDialog();
  const { isGoogleAuthed, onSetupComplete, onDriveConnect, logout, userEmail } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [connections, setConnections] = useState([]);
  const [showScanner, setShowScanner] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scopeUpgrade, setScopeUpgrade] = useState(null); // { authUrl, redirectUri, sessionId }
  const [scopeUpgradeLoading, setScopeUpgradeLoading] = useState(false);
  const pendingConnectionRef = useRef(null);

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

  const isValidDriveId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{10,}$/.test(id);

  const parseQrData = (data) => {
    const extractFields = (obj) => {
      if (!isValidDriveId(obj.rootFolderId)) return null;
      return {
        name: obj.name || 'Drive-Verbindung',
        rootFolderId: obj.rootFolderId,
        googleClientId: obj.googleClientId || null,
        googleClientSecret: obj.googleClientSecret || null,
        serverUrl: obj.serverUrl || null,
        webClientId: obj.webClientId || null,
        webClientSecret: obj.webClientSecret || null,
        webRedirectUri: obj.webRedirectUri || null,
      };
    };

    // Format 1: Setup URL (dual-purpose QR code - works in browser AND in app)
    try {
      const setupMatch = data.match(/\/api\/mobile\/connect\/setup\?d=([A-Za-z0-9_-]+)/);
      if (setupMatch) {
        const decoded = JSON.parse(atob(setupMatch[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (decoded.type === 'fuchs_drive' && decoded.rootFolderId) {
          return extractFields(decoded);
        }
      }
    } catch {}

    // Format 2: JSON (legacy)
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'fuchs_drive' && parsed.rootFolderId) {
        return extractFields(parsed);
      }
    } catch {}

    // Format 3: URL with folder ID as parameter
    try {
      if (data.startsWith('fuchs://')) {
        const url = new URL(data);
        const rootId = url.searchParams.get('root');
        const name = url.searchParams.get('name') || 'Drive-Verbindung';
        const clientId = url.searchParams.get('clientId') || null;
        const serverUrl = url.searchParams.get('serverUrl') || null;
        if (rootId) return { name, rootFolderId: rootId, googleClientId: clientId, serverUrl, webClientId: null, webClientSecret: null, webRedirectUri: null };
      }
    } catch {}

    // Format 4: Plain Google Drive folder URL
    try {
      const match = data.match(/drive\.google\.com\/drive\/folders\/([a-zA-Z0-9_-]+)/);
      if (match) {
        return { name: 'Google Drive', rootFolderId: match[1], googleClientId: null, serverUrl: null, webClientId: null, webClientSecret: null, webRedirectUri: null };
      }
    } catch {}

    return null;
  };

  const handleBarCodeScanned = async ({ data }) => {
    if (scanned) return;
    setScanned(true);

    const parsed = parseQrData(data);
    if (!parsed) {
      alert('Ungültiger QR-Code', 'Dieser QR-Code enthält keine gültige Drive-Verbindung.');
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
          alert(
            'QR-Code unvollständig',
            'Der QR-Code enthält keine Google Client ID. Bitte erstelle einen neuen QR-Code in der Desktop-Software.'
          );
          setScanned(false);
          setConnecting(false);
          return;
        }

        // Store server URL for OAuth proxy
        if (parsed.serverUrl) {
          await setSetting('serverUrl', parsed.serverUrl);
        }

        // Store client secret for Device Flow token exchange
        if (parsed.googleClientSecret) {
          await setSetting('googleClientSecret', parsed.googleClientSecret);
        }

        // Store Web Application credentials for direct WebView OAuth (no server needed)
        if (parsed.webClientId) await setSetting('webClientId', parsed.webClientId);
        if (parsed.webClientSecret) await setSetting('webClientSecret', parsed.webClientSecret);
        if (parsed.webRedirectUri) await setSetting('webRedirectUri', parsed.webRedirectUri);

        // Save the Drive connection (without meta/inbox folders - will be created after Google Sign-In)
        await addDriveConnection(parsed.name, parsed.rootFolderId);

        await alert(
          'Einrichtung erfolgreich!',
          `Drive-Ordner "${parsed.name}" wurde gespeichert.\n\nMelde dich jetzt mit deinem Google-Konto an.`
        );

        // Transition to LoginScreen (after user dismisses dialog)
        onSetupComplete();
      } catch (error) {
        alert('Fehler', error.message);
        setScanned(false);
      } finally {
        setConnecting(false);
      }
    } else {
      // CONNECT MODE: Already authenticated, verify and activate
      try {
        const folderName = await verifyConnection(parsed.rootFolderId);
        if (!folderName) {
          alert(
            'Zugriff verweigert',
            `Der Drive-Ordner ist nicht für dein Google-Konto freigegeben.${userEmail ? `\n\nAngemeldet als: ${userEmail}` : ''}\n\nMögliche Lösungen:\n• Mit anderem Konto anmelden (unten "Konto wechseln")\n• Administrator bitten, den Ordner mit deinem Google-Konto zu teilen`,
            [
              { text: 'OK', style: 'cancel' },
              {
                text: 'Konto wechseln',
                onPress: () => logout(),
              },
            ]
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

        // Update server URL if provided
        if (parsed.serverUrl) {
          await setSetting('serverUrl', parsed.serverUrl);
        }

        // Update client secret if provided
        if (parsed.googleClientSecret) {
          await setSetting('googleClientSecret', parsed.googleClientSecret);
        }

        // Update Web Application credentials for direct WebView OAuth
        if (parsed.webClientId) await setSetting('webClientId', parsed.webClientId);
        if (parsed.webClientSecret) await setSetting('webClientSecret', parsed.webClientSecret);
        if (parsed.webRedirectUri) await setSetting('webRedirectUri', parsed.webRedirectUri);

        alert('Verbunden!', `"${connectionName}" wurde verbunden.`);
        setShowScanner(false);

        // Activate this connection
        const conns = await getDriveConnections();
        const active = conns.find(c => c.is_active === 1);
        if (active) {
          onDriveConnect(active);
        }
      } catch (error) {
        alert('Fehler', error.message);
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
        // Check if the problem is a limited scope (drive.file instead of drive)
        const fullScope = await hasFullDriveScope();
        if (!fullScope) {
          // Token has limited scope - try to upgrade via server
          pendingConnectionRef.current = connection;
          setConnecting(false);
          return startScopeUpgrade();
        }
        // Full scope but still can't access - real permission issue
        alert('Nicht erreichbar', 'Der Drive-Ordner ist nicht mehr zugänglich.\n\nMögliche Ursachen:\n- Der Ordner wurde gelöscht\n- Die Freigabe wurde entfernt');
        setConnecting(false);
        return;
      }

      await activateConnection(connection);
    } catch (error) {
      alert('Fehler', error.message);
    } finally {
      setConnecting(false);
    }
  };

  const activateConnection = async (connection) => {
    if (!connection.meta_folder_id || !connection.inbox_folder_id) {
      const metaFolder = await findOrCreateFolder(connection.root_folder_id, 'NR_Fuchs_Meta');
      const inboxFolder = await findOrCreateFolder(metaFolder.id, 'inbox');
      await updateDriveConnectionFolders(connection.id, metaFolder.id, inboxFolder.id);
      connection.meta_folder_id = metaFolder.id;
      connection.inbox_folder_id = inboxFolder.id;
    }
    await setActiveDriveConnection(connection.id);
    onDriveConnect(connection);
  };

  // ---- Scope Upgrade: WebView OAuth to get full drive scope ----

  const startScopeUpgrade = async () => {
    // Priority 1: Direct WebView OAuth (no server needed)
    const wClientId = await getSetting('webClientId');
    const wClientSecret = await getSetting('webClientSecret');
    const wRedirectUri = await getSetting('webRedirectUri');

    if (wClientId && wClientSecret && wRedirectUri) {
      const scopes = [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ];
      const params = new URLSearchParams({
        client_id: wClientId,
        redirect_uri: wRedirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        access_type: 'offline',
        prompt: 'consent',
      });
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      setScopeUpgrade({ authUrl, redirectUri: wRedirectUri, sessionId: null, serverUrl: null, direct: true, webClientId: wClientId, webClientSecret: wClientSecret });
      return;
    }

    // Priority 2: Via server
    const serverUrl = await getSetting('serverUrl');
    if (!serverUrl) {
      alert(
        'Eingeschränkter Zugriff',
        'Dein Login hat nur eingeschränkte Berechtigungen.\n\n' +
        'Bitte scanne den QR-Code der Desktop-Software erneut, um die Verbindung zu aktualisieren.'
      );
      return;
    }

    setScopeUpgradeLoading(true);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${serverUrl}/api/mobile/auth/init-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) throw new Error(`Server-Fehler ${res.status}`);

      const { sessionId, authUrl, redirectUri } = await res.json();
      setScopeUpgrade({ authUrl, redirectUri, sessionId, serverUrl, direct: false });
      setScopeUpgradeLoading(false);
    } catch (e) {
      setScopeUpgradeLoading(false);
      const reason = e.name === 'AbortError' ? 'Timeout' : e.message;
      alert(
        'Eingeschränkter Zugriff',
        `Desktop-Server nicht erreichbar (${reason}).\n\nBitte scanne den QR-Code erneut.`
      );
    }
  };

  const handleScopeUpgradeNavigation = (request) => {
    const { url } = request;
    if (scopeUpgrade && url.startsWith(scopeUpgrade.redirectUri)) {
      const urlObj = new URL(url);
      const code = urlObj.searchParams.get('code');
      const error = urlObj.searchParams.get('error');

      if (error) {
        setScopeUpgrade(null);
        alert('Anmeldung abgebrochen', 'Die Google-Anmeldung wurde abgebrochen.');
        return false;
      }

      if (code) {
        exchangeUpgradeCode(code);
      }
      return false;
    }
    return true;
  };

  const exchangeUpgradeCode = async (code) => {
    const { redirectUri, serverUrl, direct, webClientId: wId, webClientSecret: wSecret } = scopeUpgrade;
    setScopeUpgrade(null);
    setConnecting(true);
    try {
      let data;

      if (direct && wId && wSecret) {
        // Direct exchange with Google
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: wId,
            client_secret: wSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }).toString(),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error_description || data.error || 'Token-Austausch fehlgeschlagen');
        // Fetch user info
        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${data.access_token}` },
        });
        const userInfo = await userRes.json();
        data.user_name = userInfo.name || '';
        data.user_email = userInfo.email || '';
        data.user_photo = userInfo.picture || '';
      } else {
        // Exchange via server
        const res = await fetch(`${serverUrl}/api/mobile/auth/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirect_uri: redirectUri }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Token-Austausch fehlgeschlagen');
      }

      // Store new tokens with full drive scope
      await storeTokens(data.access_token, data.refresh_token, data.expires_in || 3600);
      if (data.scope) await storeGrantedScope(data.scope);
      if (data.user_name || data.user_email) {
        await storeUserInfo({ name: data.user_name || '', email: data.user_email || '', picture: data.user_photo || '' });
      }

      // Retry the pending connection with new tokens
      if (pendingConnectionRef.current) {
        const connection = pendingConnectionRef.current;
        pendingConnectionRef.current = null;
        const accessible = await verifyConnection(connection.root_folder_id);
        if (accessible) {
          await activateConnection(connection);
          return;
        }
        alert('Nicht erreichbar', 'Der Ordner ist auch mit vollem Zugriff nicht erreichbar. Möglicherweise wurde die Freigabe entfernt.');
      }
    } catch (error) {
      alert('Fehler', error.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDeleteConnection = (connection) => {
    alert(
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

  // Scope upgrade WebView modal
  if (scopeUpgrade) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <TouchableOpacity onPress={() => setScopeUpgrade(null)} style={{ padding: 8 }}>
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={{ flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '600', marginLeft: 8 }}>
            Google Drive Vollzugriff
          </Text>
        </View>
        <WebView
          source={{ uri: scopeUpgrade.authUrl }}
          onShouldStartLoadWithRequest={handleScopeUpgradeNavigation}
          onNavigationStateChange={(navState) => handleScopeUpgradeNavigation({ url: navState.url })}
          style={{ flex: 1 }}
          javaScriptEnabled
          domStorageEnabled
        />
      </SafeAreaView>
    );
  }

  if (scopeUpgradeLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.subtitle}>Verbinde mit Desktop-Server...</Text>
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

      {userEmail ? (
        <View style={styles.accountInfo}>
          <Ionicons name="person-circle-outline" size={16} color={colors.textTertiary} />
          <Text style={styles.accountEmail} numberOfLines={1}>{userEmail}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={styles.switchAccountButton}
        onPress={() => {
          alert(
            'Konto wechseln?',
            'Du wirst abgemeldet und kannst dich mit einem anderen Google-Konto anmelden.',
            [
              { text: 'Abbrechen', style: 'cancel' },
              { text: 'Abmelden', style: 'destructive', onPress: () => logout() },
            ]
          );
        }}
      >
        <Ionicons name="swap-horizontal" size={16} color={colors.textTertiary} />
        <Text style={styles.switchAccountText}>Konto wechseln</Text>
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
  accountInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
  },
  accountEmail: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  switchAccountButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    padding: 8,
  },
  switchAccountText: {
    fontSize: 13,
    color: colors.textTertiary,
  },
});
