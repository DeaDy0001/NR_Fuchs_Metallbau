import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  AppState, Linking, Platform, ScrollView, Modal, SafeAreaView,
} from 'react-native';
import { useDialog } from '../components/CustomDialog';
import { WebView } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { storeTokens, storeUserInfo, fetchUserInfo, storeGrantedScope } from '../services/googleAuth';
import { getSetting } from '../services/database';
import config from '../config';

/**
 * LoginScreen - Google Sign-In with automatic fallback:
 *
 * 1. Try Device Authorization Flow (RFC 8628) - works if client is "TVs and Limited Input" type
 * 2. If that fails, fall back to In-App WebView OAuth - opens Google sign-in in a WebView,
 *    intercepts the localhost redirect, and exchanges the code via the server API
 */
export default function LoginScreen() {
  const { alert } = useDialog();
  const { onGoogleLogin, resetSetup } = useApp();
  const [clientId, setClientId] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [serverUrl, setServerUrl] = useState(null);
  const [webClientId, setWebClientId] = useState(null);
  const [webClientSecret, setWebClientSecret] = useState(null);
  const [webRedirectUri, setWebRedirectUri] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  // Device Flow state
  const [userCode, setUserCode] = useState(null);
  const [verificationUrl, setVerificationUrl] = useState(null);
  const [verificationUrlComplete, setVerificationUrlComplete] = useState(null);
  const [copied, setCopied] = useState(false);
  const [browserOpened, setBrowserOpened] = useState(false);

  // Debug state - shows polling status on screen
  const [debugLog, setDebugLog] = useState([]);
  const addDebug = (msg) => {
    const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setDebugLog(prev => [`${time} ${msg}`, ...prev].slice(0, 8));
  };

  // WebView OAuth state
  const [webViewAuth, setWebViewAuth] = useState(null); // { authUrl, redirectUri, sessionId }

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
  // On Android, setTimeout gets suspended in background - force restart polling
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && deviceCodeRef.current && Date.now() < expiresAtRef.current) {
        addDebug('App im Vordergrund - starte Polling neu');
        // Kill any stuck timer from background
        if (pollTimerRef.current) {
          clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        // Reset polling flag so pollForToken can start fresh
        isPollingRef.current = false;
        pollForToken();
      }
    });
    return () => subscription?.remove();
  }, [clientId, clientSecret]);

  const loadConfig = async () => {
    const id = await getSetting('googleClientId');
    const secret = await getSetting('googleClientSecret');
    const url = await getSetting('serverUrl');
    const wId = await getSetting('webClientId');
    const wSecret = await getSetting('webClientSecret');
    const wRedirect = await getSetting('webRedirectUri');
    console.log('[Fuchs] LoginScreen - clientId:', id ? id.substring(0, 20) + '...' : 'none');
    console.log('[Fuchs] LoginScreen - webClientId:', wId ? wId.substring(0, 20) + '...' : 'none');
    setClientId(id);
    setClientSecret(secret);
    setServerUrl(url);
    setWebClientId(wId);
    setWebClientSecret(wSecret);
    setWebRedirectUri(wRedirect);
    setLoading(false);
  };

  // ---- Shared: handle successful token retrieval ----

  const handleTokenSuccess = async (tokenData) => {
    await storeTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in || 3600);
    if (tokenData.scope) await storeGrantedScope(tokenData.scope);

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
      setWebViewAuth(null);
      onGoogleLogin(userInfo);
    }
  };

  // ---- Device Authorization Flow (fallback when server not reachable) ----

  const requestDeviceCode = async (scopes) => {
    const deviceId = `fuchs_mobile_${clientId.substring(0, 12)}`;
    const res = await fetch('https://oauth2.googleapis.com/device/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        scope: scopes.join(' '),
        device_id: deviceId,
        device_name: 'Fuchs Metallbau App',
      }).toString(),
    });
    const data = await res.json();
    return { ok: res.ok, data };
  };

  /** Fetch with timeout (default 8s) */
  const fetchWithTimeout = (url, options = {}, timeoutMs = 8000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  };

  /** Build a Google OAuth URL directly (no server needed) */
  const buildDirectAuthUrl = (wClientId, wRedirect) => {
    const scopes = [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ];
    const params = new URLSearchParams({
      client_id: wClientId,
      redirect_uri: wRedirect,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  };

  const startGoogleSignIn = async () => {
    if (!clientId && !webClientId) {
      alert('Fehler', 'Keine Google Client-ID konfiguriert. Bitte zuerst QR-Code scannen.');
      return;
    }

    setAuthLoading(true);
    setUserCode(null);
    setWebViewAuth(null);

    // Priority 1: Direct WebView OAuth (no server needed, full drive scope)
    // Uses Web Application client credentials from QR code
    if (webClientId && webClientSecret && webRedirectUri) {
      addDebug('Starte WebView OAuth (direkt, drive-Scope)');
      const authUrl = buildDirectAuthUrl(webClientId, webRedirectUri);
      setWebViewAuth({ authUrl, redirectUri: webRedirectUri, sessionId: null, direct: true });
      setAuthLoading(false);
      return;
    }

    // Priority 2: WebView OAuth via Desktop-Server
    if (serverUrl) {
      try {
        addDebug('Versuche Server-WebView OAuth...');
        const res = await fetchWithTimeout(`${serverUrl}/api/mobile/auth/init-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          const { sessionId, authUrl, redirectUri } = await res.json();
          addDebug('WebView OAuth via Server gestartet');
          setWebViewAuth({ authUrl, redirectUri, sessionId, direct: false });
          setAuthLoading(false);
          return;
        }
      } catch (e) {
        addDebug(`Server nicht erreichbar: ${e.message?.substring(0, 30)}`);
      }
    }

    addDebug('Fallback: Device Flow (eingeschränkter Scope)');

    // Priority 3: Device Flow (works without anything, but limited scope)
    try {
      const scopes = config.google.scopes;
      let result = await requestDeviceCode(scopes);

      if (!result.ok) {
        addDebug('drive-Scope abgelehnt, versuche drive.file...');
        result = await requestDeviceCode([
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/userinfo.email',
        ]);
      }

      if (!result.ok) {
        throw new Error('Google-Anmeldung konnte nicht gestartet werden.');
      }

      const { device_code, user_code, verification_url, expires_in, interval } = result.data;

      deviceCodeRef.current = device_code;
      pollIntervalRef.current = (interval || 5) * 1000;
      expiresAtRef.current = Date.now() + (expires_in * 1000);

      const verifyUrl = result.data.verification_url_complete ||
        `${verification_url}?user_code=${user_code}`;

      addDebug('Device Flow: Code erhalten');
      setUserCode(user_code);
      setVerificationUrl(verification_url);
      setVerificationUrlComplete(verifyUrl);
      setBrowserOpened(false);
      setAuthLoading(false);
    } catch (error) {
      console.error('[Fuchs] Sign-in error:', error);
      if (isMountedRef.current) {
        setAuthLoading(false);
        setUserCode(null);
        alert('Anmeldung fehlgeschlagen', error.message);
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
          // Always poll Google directly (not through local backend) - more reliable
          addDebug('Polling Google...');
          const tokenParams = {
            client_id: clientId,
            device_code: deviceCodeRef.current,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          };
          if (clientSecret) tokenParams.client_secret = clientSecret;
          const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(tokenParams).toString(),
          });
          const tokenData = await res.json();

          const pollResult = tokenData.error || 'TOKEN ERHALTEN!';
          console.log('[Fuchs] Poll response:', pollResult);
          addDebug(`Antwort: ${pollResult}`);

          if (tokenData.access_token) {
            addDebug('Token erhalten! Lade User-Info...');
            deviceCodeRef.current = null;

            // Bring app to foreground (user is likely still in browser)
            if (Platform.OS === 'android') {
              try { await Linking.openURL('com.fuchsmetallbau.app://auth-success'); } catch {}
            }

            // Fetch user info directly from Google
            let userName = '', userEmail = '', userPhoto = '';
            try {
              const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${tokenData.access_token}` },
              });
              const userInfo = await userRes.json();
              userName = userInfo.name || '';
              userEmail = userInfo.email || '';
              userPhoto = userInfo.picture || '';
            } catch (e) {
              console.log('[Fuchs] User info fetch failed (non-critical):', e.message);
            }

            await handleTokenSuccess({
              ...tokenData,
              user_name: userName,
              user_email: userEmail,
              user_photo: userPhoto,
            });
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
            addDebug(`Netzwerkfehler: ${pollError.message?.substring(0, 30)}`);
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
      addDebug(`FEHLER: ${error.message?.substring(0, 40)}`);
      if (isMountedRef.current) {
        deviceCodeRef.current = null;
        setAuthLoading(false);
        setUserCode(null);
        alert('Anmeldung fehlgeschlagen', error.message);
      }
    } finally {
      isPollingRef.current = false;
    }
  };

  /**
   * Intercept navigation in the WebView.
   * When Google redirects to the localhost callback URL, we:
   * 1. Extract the authorization code from the URL
   * 2. POST it to the server for token exchange
   * 3. Close the WebView and complete login
   */
  const handleWebViewNavigation = (request) => {
    const { url } = request;

    // Check if this is the OAuth callback redirect (localhost URL)
    if (webViewAuth && url.startsWith(webViewAuth.redirectUri)) {
      console.log('[Fuchs] Intercepted OAuth callback URL');

      // Extract query parameters
      const urlObj = new URL(url);
      const code = urlObj.searchParams.get('code');
      const error = urlObj.searchParams.get('error');

      if (error) {
        console.log('[Fuchs] OAuth error:', error);
        setWebViewAuth(null);
        alert('Anmeldung abgebrochen', 'Die Google-Anmeldung wurde abgebrochen.');
        return false; // Prevent navigation
      }

      if (code) {
        console.log('[Fuchs] Got auth code, exchanging for tokens...');
        exchangeCodeForTokens(code, webViewAuth.redirectUri);
      }

      return false; // Prevent navigation to localhost (which would fail)
    }

    return true; // Allow all other navigation (Google sign-in pages)
  };

  const exchangeCodeForTokens = async (code, redirectUri) => {
    const isDirect = webViewAuth?.direct;
    try {
      setWebViewAuth(null); // Close WebView
      setAuthLoading(true);

      let tokenData;

      if (isDirect && webClientId && webClientSecret) {
        // Direct exchange with Google (no server needed)
        console.log('[Fuchs] Exchanging code directly with Google...');
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: webClientId,
            client_secret: webClientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }).toString(),
        });
        tokenData = await res.json();
        if (!res.ok) {
          throw new Error(tokenData.error_description || tokenData.error || 'Token-Austausch fehlgeschlagen');
        }
        // Fetch user info
        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const userInfo = await userRes.json();
        tokenData.user_name = userInfo.name || '';
        tokenData.user_email = userInfo.email || '';
        tokenData.user_photo = userInfo.picture || '';
      } else {
        // Exchange via server
        const res = await fetch(`${serverUrl}/api/mobile/auth/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirect_uri: redirectUri }),
        });
        tokenData = await res.json();
        if (!res.ok) {
          throw new Error(tokenData.error || 'Token-Austausch fehlgeschlagen');
        }
      }

      console.log('[Fuchs] WebView OAuth successful!');
      await handleTokenSuccess(tokenData);
    } catch (error) {
      console.error('[Fuchs] Token exchange error:', error);
      if (isMountedRef.current) {
        setAuthLoading(false);
        alert('Anmeldung fehlgeschlagen', error.message);
      }
    }
  };

  const cancelAuth = () => {
    deviceCodeRef.current = null;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    isPollingRef.current = false;
    setAuthLoading(false);
    setUserCode(null);
    setBrowserOpened(false);
    setWebViewAuth(null);
  };

  const openBrowserWithCode = async () => {
    await Clipboard.setStringAsync(userCode);
    setCopied(true);
    setBrowserOpened(true);
    setTimeout(() => setCopied(false), 3000);

    const url = verificationUrlComplete || verificationUrl;
    if (url) await Linking.openURL(url);

    // Start polling after browser is opened
    pollForToken();
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
    <>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.logoArea}>
          <View style={styles.iconCircle}>
            <Ionicons name="construct" size={48} color={colors.accent} />
          </View>
          <Text style={styles.title}>Fuchs Metallbau</Text>
          <Text style={styles.subtitle}>Projekt-Fotos & Dokumentation</Text>
        </View>

        <View style={styles.loginArea}>
          {userCode ? (
            // Device Flow mode
            <>
              <Text style={styles.loginTitle}>
                {browserOpened ? 'Im Browser anmelden' : 'Bestätigungscode'}
              </Text>
              <Text style={styles.loginDesc}>
                {browserOpened
                  ? 'Gib den Code im Browser ein und melde dich mit deinem Google-Konto an.'
                  : 'Diesen Code brauchst du gleich im Browser. Tippe auf den Button um fortzufahren.'}
              </Text>

              <View style={styles.codeBox}>
                <Text style={styles.codeLabel}>Dein Code:</Text>
                <Text selectable style={styles.codeText}>{userCode}</Text>
                {copied && (
                  <View style={styles.copyRow}>
                    <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                    <Text style={[styles.copyHint, { color: '#22c55e' }]}>In Zwischenablage kopiert!</Text>
                  </View>
                )}
              </View>

              {!browserOpened ? (
                <TouchableOpacity style={styles.googleButton} onPress={openBrowserWithCode}>
                  <Ionicons name="copy-outline" size={20} color="white" />
                  <Text style={styles.googleButtonText}>Code kopieren & Browser öffnen</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <View style={styles.waitingRow}>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={styles.waitingText}>Warte auf Anmeldung...</Text>
                  </View>

                  {debugLog.length > 0 && (
                    <View style={styles.debugBox}>
                      {debugLog.map((line, i) => (
                        <Text key={i} style={styles.debugText}>{line}</Text>
                      ))}
                    </View>
                  )}

                  <TouchableOpacity
                    style={styles.reopenButton}
                    onPress={async () => {
                      await Clipboard.setStringAsync(userCode);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                      const url = verificationUrlComplete || verificationUrl;
                      if (url) Linking.openURL(url);
                    }}
                  >
                    <Ionicons name="open-outline" size={18} color={colors.accent} />
                    <Text style={styles.reopenText}>Code kopieren & Browser erneut öffnen</Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity style={styles.cancelButton} onPress={cancelAuth}>
                <Text style={styles.cancelText}>Abbrechen</Text>
              </TouchableOpacity>
            </>
          ) : authLoading ? (
            // Loading state
            <>
              <Text style={styles.loginTitle}>Anmeldung läuft...</Text>
              <View style={styles.waitingRow}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.waitingText}>Bitte warten...</Text>
              </View>
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
                style={[styles.googleButton, !clientId && styles.buttonDisabled]}
                onPress={startGoogleSignIn}
                disabled={!clientId}
              >
                <Ionicons name="logo-google" size={22} color="white" />
                <Text style={styles.googleButtonText}>Mit Google anmelden</Text>
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

      {/* WebView Modal for Google OAuth */}
      <Modal
        visible={!!webViewAuth}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={cancelAuth}
      >
        <SafeAreaView style={styles.webViewContainer}>
          <View style={styles.webViewHeader}>
            <TouchableOpacity onPress={cancelAuth} style={styles.webViewCloseBtn}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.webViewTitle}>Google Anmeldung</Text>
            <View style={{ width: 40 }} />
          </View>
          {webViewAuth && (
            <WebView
              source={{ uri: webViewAuth.authUrl }}
              onShouldStartLoadWithRequest={handleWebViewNavigation}
              onNavigationStateChange={(navState) => {
                // Fallback: also check in onNavigationStateChange
                if (navState.url && webViewAuth && navState.url.startsWith(webViewAuth.redirectUri)) {
                  handleWebViewNavigation({ url: navState.url });
                }
              }}
              userAgent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
              javaScriptEnabled
              domStorageEnabled
              thirdPartyCookiesEnabled
              sharedCookiesEnabled
              startInLoadingState
              renderLoading={() => (
                <View style={styles.webViewLoading}>
                  <ActivityIndicator size="large" color={colors.accent} />
                  <Text style={styles.webViewLoadingText}>Google wird geladen...</Text>
                </View>
              )}
              style={styles.webView}
            />
          )}
        </SafeAreaView>
      </Modal>
    </>
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
  debugBox: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
    marginBottom: 4,
    width: '100%',
  },
  debugText: {
    fontSize: 11,
    color: '#94a3b8',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
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
  // WebView Modal styles
  webViewContainer: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  webViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.cardBg,
  },
  webViewCloseBtn: {
    padding: 8,
  },
  webViewTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  webView: {
    flex: 1,
  },
  webViewLoading: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgPrimary,
  },
  webViewLoadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textSecondary,
  },
});
