import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Alert, AppState, Linking, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { storeTokens, storeUserInfo, fetchUserInfo } from '../services/googleAuth';
import { getSetting } from '../services/database';
import config from '../config';

/**
 * LoginScreen - Google Sign-In using the Device Authorization Grant (RFC 8628).
 *
 * This flow works in Expo Go AND standalone builds without redirect URIs:
 * 1. App requests a device code from Google
 * 2. User opens browser to verify (code is pre-filled)
 * 3. App polls backend for token exchange (backend has client_secret)
 * 4. On success, stores tokens and proceeds
 */
export default function LoginScreen() {
  const { onGoogleLogin, resetSetup } = useApp();
  const [clientId, setClientId] = useState(null);
  const [serverUrl, setServerUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [userCode, setUserCode] = useState(null);
  const [verificationUrl, setVerificationUrl] = useState(null);

  const deviceCodeRef = useRef(null);
  const pollTimerRef = useRef(null);
  const pollIntervalRef = useRef(5000);
  const expiresAtRef = useRef(0);
  const isMountedRef = useRef(true);
  const isPollingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    loadConfig();
    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // Poll immediately when app comes back to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && deviceCodeRef.current && !isPollingRef.current) {
        console.log('[Fuchs] App foregrounded, resuming poll...');
        pollForToken();
      }
    });
    return () => subscription?.remove();
  }, [serverUrl, clientId]);

  const loadConfig = async () => {
    const id = await getSetting('googleClientId');
    const url = await getSetting('serverUrl');
    console.log('[Fuchs] LoginScreen - clientId:', id ? id.substring(0, 20) + '...' : 'none');
    console.log('[Fuchs] LoginScreen - serverUrl:', url);
    setClientId(id);
    setServerUrl(url);
    setLoading(false);
  };

  // ---- Device Authorization Flow ----

  const startGoogleSignIn = async () => {
    if (!clientId) {
      Alert.alert('Fehler', 'Keine Google Client-ID konfiguriert. Bitte zuerst QR-Code scannen.');
      return;
    }

    setAuthLoading(true);
    setUserCode(null);

    try {
      // Step 1: Request device code from Google
      // Device flow does not support the full 'drive' scope, use 'drive.file' instead
      const deviceFlowScopes = config.google.scopes.map(s =>
        s === 'https://www.googleapis.com/auth/drive'
          ? 'https://www.googleapis.com/auth/drive.file'
          : s
      );
      console.log('[Fuchs] Starting device authorization flow with scopes:', deviceFlowScopes);
      const deviceRes = await fetch('https://oauth2.googleapis.com/device/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          scope: deviceFlowScopes.join(' '),
        }).toString(),
      });

      const deviceData = await deviceRes.json();
      console.log('[Fuchs] Device code response:', JSON.stringify(deviceData));

      if (!deviceRes.ok) {
        if (deviceData.error === 'unauthorized_client') {
          throw new Error(
            'Dieser OAuth-Client unterstützt den Device-Flow nicht.\n\n' +
            'Bitte erstelle in der Google Cloud Console einen neuen OAuth-Client vom Typ ' +
            '"Fernseher und Geräte mit eingeschränkter Eingabe" (TVs and Limited Input Devices) ' +
            'und trage die neue Client-ID im Admin-Bereich ein.'
          );
        }
        throw new Error(deviceData.error_description || deviceData.error || 'Device-Code Anfrage fehlgeschlagen');
      }

      const { device_code, user_code, verification_url, expires_in, interval } = deviceData;

      // Store for polling
      deviceCodeRef.current = device_code;
      pollIntervalRef.current = (interval || 5) * 1000;
      expiresAtRef.current = Date.now() + (expires_in * 1000);

      // Step 2: Show code to user
      setUserCode(user_code);
      setVerificationUrl(verification_url);

      // Step 3: Open browser with pre-filled code
      const verifyUrl = deviceData.verification_url_complete ||
        `${verification_url}?user_code=${user_code}`;
      console.log('[Fuchs] Opening verification URL:', verifyUrl);
      await Linking.openURL(verifyUrl);

      // Step 4: Start polling for token
      pollForToken();
    } catch (error) {
      console.error('[Fuchs] Device flow error:', error);
      if (isMountedRef.current) {
        setAuthLoading(false);
        setUserCode(null);
        Alert.alert('Anmeldung fehlgeschlagen', error.message);
      }
    }
  };

  const pollForToken = async () => {
    if (!deviceCodeRef.current || !isMountedRef.current) return;
    if (isPollingRef.current) return;
    isPollingRef.current = true;

    try {
      while (isMountedRef.current && deviceCodeRef.current && Date.now() < expiresAtRef.current) {
        // Wait for the poll interval
        await new Promise(resolve => {
          pollTimerRef.current = setTimeout(resolve, pollIntervalRef.current);
        });

        if (!isMountedRef.current || !deviceCodeRef.current) break;

        try {
          let tokenData;

          if (serverUrl) {
            // Exchange via backend (backend has client_secret)
            console.log('[Fuchs] Polling backend for device token...');
            const res = await fetch(`${serverUrl}/api/mobile/auth/device-token`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                device_code: deviceCodeRef.current,
                client_id: clientId,
              }),
            });
            tokenData = await res.json();
          } else {
            // Direct exchange (may not work without client_secret)
            console.log('[Fuchs] Polling Google directly for device token...');
            const res = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: clientId,
                device_code: deviceCodeRef.current,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
              }).toString(),
            });
            tokenData = await res.json();
          }

          console.log('[Fuchs] Poll response:', tokenData.error || 'success');

          if (tokenData.access_token) {
            // Success! User completed auth in browser
            deviceCodeRef.current = null;
            await storeTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in || 3600);

            // Get user info
            let userInfo;
            if (tokenData.user_name || tokenData.user_email) {
              userInfo = {
                name: tokenData.user_name || '',
                email: tokenData.user_email || '',
                picture: tokenData.user_photo || '',
              };
            } else {
              userInfo = await fetchUserInfo(tokenData.access_token);
            }
            await storeUserInfo(userInfo);

            if (isMountedRef.current) {
              setAuthLoading(false);
              setUserCode(null);
              onGoogleLogin(userInfo);
            }
            return;
          }

          if (tokenData.error === 'authorization_pending') {
            continue; // Still waiting for user
          }

          if (tokenData.error === 'slow_down') {
            pollIntervalRef.current += 5000; // Back off
            continue;
          }

          if (tokenData.error === 'expired_token') {
            throw new Error('Anmeldezeit abgelaufen. Bitte versuche es erneut.');
          }

          if (tokenData.error === 'access_denied') {
            throw new Error('Zugriff verweigert. Bitte erteile die erforderlichen Berechtigungen.');
          }

          // Other error
          throw new Error(tokenData.error_description || tokenData.error || 'Authentifizierung fehlgeschlagen');
        } catch (pollError) {
          // Network errors → just retry
          if (
            pollError.message?.includes('Network') ||
            pollError.message?.includes('fetch') ||
            pollError.message?.includes('Failed to connect') ||
            pollError.message?.includes('Unable to resolve')
          ) {
            console.log('[Fuchs] Network error during poll, retrying...');
            continue;
          }
          throw pollError;
        }
      }

      // Loop ended without success → expired
      if (isMountedRef.current && deviceCodeRef.current) {
        throw new Error('Anmeldezeit abgelaufen. Bitte versuche es erneut.');
      }
    } catch (error) {
      console.error('[Fuchs] Poll error:', error);
      if (isMountedRef.current) {
        deviceCodeRef.current = null;
        setAuthLoading(false);
        setUserCode(null);
        Alert.alert('Anmeldung fehlgeschlagen', error.message);
      }
    } finally {
      isPollingRef.current = false;
    }
  };

  const cancelAuth = () => {
    deviceCodeRef.current = null;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    isPollingRef.current = false;
    setAuthLoading(false);
    setUserCode(null);
  };

  // ---- Render ----

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.logoArea}>
        <View style={styles.iconCircle}>
          <Ionicons name="construct" size={48} color={colors.accent} />
        </View>
        <Text style={styles.title}>Fuchs Metallbau</Text>
        <Text style={styles.subtitle}>Projekt-Fotos & Dokumentation</Text>
      </View>

      <View style={styles.loginArea}>
        {userCode ? (
          <>
            <Text style={styles.loginTitle}>Im Browser anmelden</Text>
            <Text style={styles.loginDesc}>
              Ein Browser-Fenster wurde geöffnet. Melde dich dort mit deinem Google-Konto an.
            </Text>

            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>Bestätigungscode:</Text>
              <Text style={styles.codeText}>{userCode}</Text>
            </View>

            <View style={styles.waitingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.waitingText}>Warte auf Anmeldung...</Text>
            </View>

            <TouchableOpacity
              style={styles.reopenButton}
              onPress={() => {
                const url = verificationUrl;
                if (url) Linking.openURL(url);
              }}
            >
              <Ionicons name="open-outline" size={18} color={colors.accent} />
              <Text style={styles.reopenText}>Browser erneut öffnen</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={cancelAuth}>
              <Text style={styles.cancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.loginTitle}>Mit Google anmelden</Text>
            <Text style={styles.loginDesc}>
              Melde dich mit deinem Google-Konto an, um auf die freigegebenen Google Drive Ordner zuzugreifen.
            </Text>

            <TouchableOpacity
              style={[styles.googleButton, (!clientId || authLoading) && styles.buttonDisabled]}
              onPress={startGoogleSignIn}
              disabled={!clientId || authLoading}
            >
              {authLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Ionicons name="logo-google" size={22} color="white" />
                  <Text style={styles.googleButtonText}>Mit Google anmelden</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>

      <Text style={styles.footerText}>
        Dein Google-Konto wird nur verwendet, um auf freigegebene Ordner zuzugreifen.
      </Text>

      <TouchableOpacity style={styles.rescanButton} onPress={resetSetup}>
        <Ionicons name="qr-code-outline" size={16} color={colors.textTertiary} />
        <Text style={styles.rescanText}>QR-Code erneut scannen</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    padding: 24,
    justifyContent: 'center',
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 48,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 4,
  },
  loginArea: {
    backgroundColor: colors.cardBg,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
  },
  loginTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  loginDesc: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 20,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#4285F4',
    paddingVertical: 14,
    borderRadius: 10,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  googleButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  codeBox: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  codeLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  codeText: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.accent,
    letterSpacing: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 16,
  },
  waitingText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  reopenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    marginBottom: 8,
  },
  reopenText: {
    fontSize: 14,
    color: colors.accent,
    fontWeight: '500',
  },
  cancelButton: {
    padding: 12,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 14,
    color: colors.textTertiary,
  },
  footerText: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  rescanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 20,
    padding: 12,
  },
  rescanText: {
    fontSize: 13,
    color: colors.textTertiary,
  },
});
