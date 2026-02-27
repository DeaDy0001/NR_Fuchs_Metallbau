import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Alert, AppState, Linking, Platform, ScrollView,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { storeTokens, storeUserInfo, fetchUserInfo } from '../services/googleAuth';
import { getSetting } from '../services/database';
import config from '../config';

/**
 * LoginScreen - Google Sign-In with automatic fallback:
 *
 * 1. Try Device Authorization Flow (RFC 8628) - works if client is "TVs and Limited Input" type
 * 2. If that fails, fall back to PC-Login Bridge - user signs in on the PC browser
 *    (uses existing localhost redirect URI, no extra setup needed)
 */
export default function LoginScreen() {
  const { onGoogleLogin, resetSetup } = useApp();
  const [clientId, setClientId] = useState(null);
  const [serverUrl, setServerUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  // Device Flow state
  const [userCode, setUserCode] = useState(null);
  const [verificationUrl, setVerificationUrl] = useState(null);
  const [copied, setCopied] = useState(false);

  // PC-Login Bridge state
  const [pcLoginMode, setPcLoginMode] = useState(false);
  const [pcLoginUrl, setPcLoginUrl] = useState(null);
  const [pcSessionId, setPcSessionId] = useState(null);

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
      if (nextState === 'active' && !isPollingRef.current) {
        if (deviceCodeRef.current) {
          console.log('[Fuchs] App foregrounded, resuming device flow poll...');
          pollForToken();
        } else if (pcSessionId) {
          console.log('[Fuchs] App foregrounded, resuming PC-login poll...');
          pollPcLogin();
        }
      }
    });
    return () => subscription?.remove();
  }, [serverUrl, clientId, pcSessionId]);

  const loadConfig = async () => {
    const id = await getSetting('googleClientId');
    const url = await getSetting('serverUrl');
    console.log('[Fuchs] LoginScreen - clientId:', id ? id.substring(0, 20) + '...' : 'none');
    console.log('[Fuchs] LoginScreen - serverUrl:', url);
    setClientId(id);
    setServerUrl(url);
    setLoading(false);
  };

  // ---- Shared: handle successful token retrieval ----

  const handleTokenSuccess = async (tokenData) => {
    await storeTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in || 3600);

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
      setPcLoginMode(false);
      setPcLoginUrl(null);
      setPcSessionId(null);
      onGoogleLogin(userInfo);
    }
  };

  // ---- Device Authorization Flow ----

  const startGoogleSignIn = async () => {
    if (!clientId) {
      Alert.alert('Fehler', 'Keine Google Client-ID konfiguriert. Bitte zuerst QR-Code scannen.');
      return;
    }

    setAuthLoading(true);
    setUserCode(null);
    setPcLoginMode(false);

    try {
      const deviceFlowScopes = config.google.scopes;
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
        // Device Flow not supported or scope invalid - fall back to PC-Login Bridge
        if (deviceData.error === 'unauthorized_client' || deviceData.error === 'invalid_client' || deviceData.error === 'invalid_scope') {
          console.log('[Fuchs] Device flow not supported (' + deviceData.error + '), falling back to PC-Login Bridge');
          return startPcLogin();
        }
        throw new Error(deviceData.error_description || deviceData.error || 'Device-Code Anfrage fehlgeschlagen');
      }

      const { device_code, user_code, verification_url, expires_in, interval } = deviceData;

      deviceCodeRef.current = device_code;
      pollIntervalRef.current = (interval || 5) * 1000;
      expiresAtRef.current = Date.now() + (expires_in * 1000);

      setUserCode(user_code);
      setVerificationUrl(verification_url);

      const verifyUrl = deviceData.verification_url_complete ||
        `${verification_url}?user_code=${user_code}`;
      console.log('[Fuchs] Opening verification URL:', verifyUrl);
      await Linking.openURL(verifyUrl);

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
        await new Promise(resolve => {
          pollTimerRef.current = setTimeout(resolve, pollIntervalRef.current);
        });

        if (!isMountedRef.current || !deviceCodeRef.current) break;

        try {
          let tokenData;

          if (serverUrl) {
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
            deviceCodeRef.current = null;
            await handleTokenSuccess(tokenData);
            return;
          }

          if (tokenData.error === 'authorization_pending') continue;
          if (tokenData.error === 'slow_down') {
            pollIntervalRef.current += 5000;
            continue;
          }
          if (tokenData.error === 'expired_token') {
            throw new Error('Anmeldezeit abgelaufen. Bitte versuche es erneut.');
          }
          if (tokenData.error === 'access_denied') {
            throw new Error('Zugriff verweigert. Bitte erteile die erforderlichen Berechtigungen.');
          }
          throw new Error(tokenData.error_description || tokenData.error || 'Authentifizierung fehlgeschlagen');
        } catch (pollError) {
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

  // ---- PC-Login Bridge (fallback when Device Flow not supported) ----

  const startPcLogin = async () => {
    if (!serverUrl) {
      setAuthLoading(false);
      Alert.alert(
        'Server nicht erreichbar',
        'Die PC-Anmeldung benötigt eine Verbindung zum Desktop-Server.\n\nBitte stelle sicher, dass die Desktop-Software läuft und scanne den QR-Code erneut.'
      );
      return;
    }

    try {
      console.log('[Fuchs] Starting PC-Login Bridge...');
      const res = await fetch(`${serverUrl}/api/mobile/auth/init-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server-Fehler: ${res.status}`);
      }

      const { sessionId, loginUrl } = await res.json();
      console.log('[Fuchs] PC-Login session created:', sessionId.substring(0, 8) + '...');

      setPcLoginMode(true);
      setPcLoginUrl(loginUrl);
      setPcSessionId(sessionId);
      setAuthLoading(false);

      // Auto-open the login URL directly on the phone
      // Since phone and server are on the same network, the login can happen on-device
      console.log('[Fuchs] Auto-opening login URL on device:', loginUrl);
      await Linking.openURL(loginUrl);

      // Start polling for result
      pollPcLoginLoop(sessionId);
    } catch (error) {
      console.error('[Fuchs] PC-Login init error:', error);
      if (isMountedRef.current) {
        setAuthLoading(false);
        Alert.alert('Anmeldung fehlgeschlagen', error.message);
      }
    }
  };

  const pollPcLoginLoop = async (sessionId) => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;

    try {
      const maxTime = Date.now() + 10 * 60 * 1000; // 10 minutes

      while (isMountedRef.current && sessionId && Date.now() < maxTime) {
        await new Promise(resolve => {
          pollTimerRef.current = setTimeout(resolve, 3000);
        });

        if (!isMountedRef.current) break;

        try {
          const res = await fetch(`${serverUrl}/api/mobile/auth/poll-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          });

          const data = await res.json();

          if (data.status === 'complete' && data.access_token) {
            console.log('[Fuchs] PC-Login successful!');
            await handleTokenSuccess(data);
            return;
          }

          if (data.error === 'session_expired') {
            throw new Error('Login-Session abgelaufen. Bitte versuche es erneut.');
          }

          if (data.error === 'login_failed') {
            throw new Error(data.message || 'Anmeldung am PC fehlgeschlagen.');
          }

          // Still pending, continue polling
        } catch (pollError) {
          if (
            pollError.message?.includes('Network') ||
            pollError.message?.includes('fetch') ||
            pollError.message?.includes('Failed to connect')
          ) {
            console.log('[Fuchs] Network error during PC-login poll, retrying...');
            continue;
          }
          throw pollError;
        }
      }

      if (isMountedRef.current) {
        throw new Error('Anmeldezeit abgelaufen. Bitte versuche es erneut.');
      }
    } catch (error) {
      console.error('[Fuchs] PC-Login poll error:', error);
      if (isMountedRef.current) {
        setPcLoginMode(false);
        setPcLoginUrl(null);
        setPcSessionId(null);
        Alert.alert('Anmeldung fehlgeschlagen', error.message);
      }
    } finally {
      isPollingRef.current = false;
    }
  };

  const pollPcLogin = () => {
    if (pcSessionId && !isPollingRef.current) {
      pollPcLoginLoop(pcSessionId);
    }
  };

  const cancelAuth = () => {
    deviceCodeRef.current = null;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    isPollingRef.current = false;
    setAuthLoading(false);
    setUserCode(null);
    setPcLoginMode(false);
    setPcLoginUrl(null);
    setPcSessionId(null);
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
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.logoArea}>
        <View style={styles.iconCircle}>
          <Ionicons name="construct" size={48} color={colors.accent} />
        </View>
        <Text style={styles.title}>Fuchs Metallbau</Text>
        <Text style={styles.subtitle}>Projekt-Fotos & Dokumentation</Text>
      </View>

      <View style={styles.loginArea}>
        {pcLoginMode && pcLoginUrl ? (
          // PC-Login Bridge mode - browser was auto-opened on the phone
          <>
            <Text style={styles.loginTitle}>Im Browser anmelden</Text>
            <Text style={styles.loginDesc}>
              Ein Browser-Fenster wurde geöffnet. Melde dich dort mit deinem Google-Konto an.
            </Text>

            <View style={styles.waitingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.waitingText}>Warte auf Anmeldung...</Text>
            </View>

            <View style={styles.stepsBox}>
              <Text style={styles.stepText}>1. Melde dich im Browser mit Google an</Text>
              <Text style={styles.stepText}>2. Erteile die Berechtigungen</Text>
              <Text style={styles.stepText}>3. Die App verbindet sich automatisch</Text>
            </View>

            <TouchableOpacity
              style={styles.reopenButton}
              onPress={() => Linking.openURL(pcLoginUrl)}
            >
              <Ionicons name="open-outline" size={18} color={colors.accent} />
              <Text style={styles.reopenText}>Browser erneut öffnen</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={cancelAuth}>
              <Text style={styles.cancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </>
        ) : userCode ? (
          // Device Flow mode
          <>
            <Text style={styles.loginTitle}>Im Browser anmelden</Text>
            <Text style={styles.loginDesc}>
              Ein Browser-Fenster wurde geöffnet. Melde dich dort mit deinem Google-Konto an.
            </Text>

            <TouchableOpacity
              style={styles.codeBox}
              activeOpacity={0.7}
              onPress={async () => {
                await Clipboard.setStringAsync(userCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              <Text style={styles.codeLabel}>Bestätigungscode:</Text>
              <Text selectable style={styles.codeText}>{userCode}</Text>
              <View style={styles.copyRow}>
                <Ionicons
                  name={copied ? 'checkmark-circle' : 'copy-outline'}
                  size={16}
                  color={copied ? '#22c55e' : colors.textTertiary}
                />
                <Text style={[styles.copyHint, copied && { color: '#22c55e' }]}>
                  {copied ? 'Kopiert!' : 'Tippen zum Kopieren'}
                </Text>
              </View>
            </TouchableOpacity>

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
          // Initial state - sign in button
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
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
  pcLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'center',
    lineHeight: 20,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  copyHint: {
    fontSize: 12,
    color: colors.textTertiary,
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
  stepsBox: {
    backgroundColor: 'rgba(59, 130, 246, 0.06)',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    gap: 6,
  },
  stepText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
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
