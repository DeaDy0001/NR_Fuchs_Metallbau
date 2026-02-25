import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { registerDevice } from '../services/api';
import { getSetting } from '../services/database';

export default function ConnectScreen() {
  const { connect } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [userName, setUserName] = useState('');
  const [showNameInput, setShowNameInput] = useState(false);
  const [scannedData, setScannedData] = useState(null);

  useEffect(() => {
    loadUserName();
  }, []);

  // No need for navigation redirect here - App.js handles
  // the screen swap automatically when isConnected changes

  const loadUserName = async () => {
    const name = await getSetting('userName', '');
    if (name) setUserName(name);
  };

  const parseQrData = (data) => {
    // Format 1 (new): URL like http://192.168.x.x:3001/api/mobile/connect/{token}
    const urlMatch = data.match(/^(https?:\/\/[^/]+)\/api\/mobile\/connect\/([a-f0-9]+)$/);
    if (urlMatch) {
      return { serverUrl: urlMatch[1], token: urlMatch[2] };
    }

    // Format 2 (legacy): JSON { token, serverUrl }
    try {
      const parsed = JSON.parse(data);
      if (parsed.token && parsed.serverUrl) {
        return parsed;
      }
    } catch {}

    return null;
  };

  const handleBarCodeScanned = ({ data }) => {
    if (scanned) return;
    setScanned(true);

    const parsed = parseQrData(data);
    if (parsed) {
      setScannedData(parsed);
      setShowNameInput(true);
    } else {
      Alert.alert('Ungültiger QR-Code', 'Dieser QR-Code ist nicht gültig.');
      setScanned(false);
    }
  };

  const handleConnect = async () => {
    if (!userName.trim()) {
      Alert.alert('Name erforderlich', 'Bitte gib deinen Namen ein.');
      return;
    }

    setConnecting(true);
    try {
      const deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const result = await registerDevice(
        scannedData.serverUrl,
        scannedData.token,
        deviceId,
        `Android ${Platform.Version || ''}`.trim(),
        userName.trim()
      );

      // connect() sets isConnected=true which triggers App.js to show MainTabs
      await connect(scannedData.serverUrl, result.authToken, userName.trim());
    } catch (error) {
      Alert.alert('Verbindung fehlgeschlagen', error.message);
      setScanned(false);
      setShowNameInput(false);
    } finally {
      setConnecting(false);
    }
  };

  if (!permission) {
    return <View style={styles.container}><ActivityIndicator color={colors.accent} /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Ionicons name="camera-outline" size={64} color={colors.textTertiary} />
        <Text style={styles.title}>Kamera-Zugriff benötigt</Text>
        <Text style={styles.subtitle}>Um den QR-Code zu scannen, benötigt die App Zugriff auf die Kamera.</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Kamera erlauben</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (showNameInput) {
    return (
      <View style={styles.container}>
        <Ionicons name="checkmark-circle" size={64} color={colors.success} />
        <Text style={styles.title}>QR-Code erkannt!</Text>
        <Text style={styles.subtitle}>Server: {scannedData?.serverUrl}</Text>

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Dein Name</Text>
          <TextInput
            style={styles.input}
            placeholder="z.B. Max Mustermann"
            placeholderTextColor={colors.textTertiary}
            value={userName}
            onChangeText={setUserName}
            autoFocus
          />
          <Text style={styles.inputHint}>
            Wird bei deinen Fotos gespeichert, damit man weiß wer sie gemacht hat.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.button, connecting && styles.buttonDisabled]}
          onPress={handleConnect}
          disabled={connecting}
        >
          {connecting ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.buttonText}>Verbinden</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => { setScanned(false); setShowNameInput(false); }}
        >
          <Text style={styles.linkText}>Erneut scannen</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mit Server verbinden</Text>
      <Text style={styles.subtitle}>
        Scanne den QR-Code aus der Desktop-Software{'\n'}(Einstellungen → Handy App)
      </Text>

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

      {scanned && (
        <TouchableOpacity style={styles.linkButton} onPress={() => setScanned(false)}>
          <Text style={styles.linkText}>Erneut scannen</Text>
        </TouchableOpacity>
      )}
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
    marginBottom: 24,
    lineHeight: 22,
  },
  cameraContainer: {
    width: 280,
    height: 280,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.accent,
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
  inputContainer: {
    width: '100%',
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: colors.textPrimary,
  },
  inputHint: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 6,
  },
  button: {
    backgroundColor: colors.accent,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
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
