import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { storeTokens, storeUserInfo } from '../services/googleAuth';
import { getSetting } from '../services/database';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const { onGoogleLogin } = useApp();
  const [serverUrl, setServerUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    loadServerUrl();
  }, []);

  const loadServerUrl = async () => {
    const url = await getSetting('serverUrl');
    console.log('[Fuchs] LoginScreen - serverUrl:', url);
    setServerUrl(url);
    setLoading(false);
  };

  const handleSignIn = async () => {
    if (!serverUrl) {
      Alert.alert('Fehler', 'Server-URL nicht konfiguriert. Bitte scanne den QR-Code erneut.');
      return;
    }

    setAuthLoading(true);
    try {
      // Create callback URL (works in both Expo Go and standalone builds)
      const appRedirect = Linking.createURL('auth');
      console.log('[Fuchs] LoginScreen - appRedirect:', appRedirect);

      // Open browser to backend's OAuth proxy
      const authUrl = `${serverUrl}/api/mobile/auth/google?app_redirect=${encodeURIComponent(appRedirect)}`;
      console.log('[Fuchs] LoginScreen - opening auth URL:', authUrl);

      const result = await WebBrowser.openAuthSessionAsync(authUrl, appRedirect);
      console.log('[Fuchs] LoginScreen - auth result type:', result.type);

      if (result.type === 'success' && result.url) {
        await handleAuthResult(result.url);
      } else if (result.type === 'cancel') {
        console.log('[Fuchs] LoginScreen - user cancelled');
      }
    } catch (error) {
      console.error('[Fuchs] LoginScreen - auth error:', error);
      Alert.alert('Anmeldung fehlgeschlagen', error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAuthResult = async (url) => {
    try {
      const parsed = Linking.parse(url);
      const params = parsed.queryParams || {};

      console.log('[Fuchs] LoginScreen - auth callback keys:', Object.keys(params));

      if (params.error) {
        throw new Error(decodeURIComponent(params.error));
      }

      const accessToken = params.access_token;
      if (!accessToken) {
        throw new Error('Kein Access Token erhalten');
      }

      // Store tokens (including refresh_token for server-side refresh)
      await storeTokens(
        accessToken,
        params.refresh_token || null,
        parseInt(params.expires_in) || 3600
      );

      // Build and store user info
      const userInfo = {
        name: params.user_name || '',
        email: params.user_email || '',
        picture: params.user_photo || '',
      };
      await storeUserInfo(userInfo);

      // Notify app context
      onGoogleLogin(userInfo);
    } catch (error) {
      console.error('[Fuchs] LoginScreen - handleAuthResult error:', error);
      Alert.alert('Anmeldung fehlgeschlagen', error.message);
    }
  };

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
        <Text style={styles.loginTitle}>Mit Google anmelden</Text>
        <Text style={styles.loginDesc}>
          Melde dich mit deinem Google-Konto an, um auf die freigegebenen Google Drive Ordner zuzugreifen.
        </Text>

        <TouchableOpacity
          style={[styles.googleButton, authLoading && styles.buttonDisabled]}
          onPress={handleSignIn}
          disabled={authLoading}
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
      </View>

      {!serverUrl && (
        <Text style={[styles.footerText, { color: '#f59e0b' }]}>
          Server-URL fehlt. Bitte gehe zuruck und scanne den QR-Code erneut.
        </Text>
      )}

      <Text style={styles.footerText}>
        Dein Google-Konto wird nur verwendet, um auf freigegebene Ordner zuzugreifen.
      </Text>
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
  footerText: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'center',
  },
});
