import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useAuthRequest, makeRedirectUri, ResponseType } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { storeTokens, storeUserInfo, fetchUserInfo } from '../services/googleAuth';
import { getSetting } from '../services/database';
import config from '../config';

WebBrowser.maybeCompleteAuthSession();

// Google OAuth endpoints
const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

export default function LoginScreen() {
  const { onGoogleLogin } = useApp();
  const [clientId, setClientId] = useState(null);
  const [serverUrl, setServerUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    const id = await getSetting('googleClientId');
    const url = await getSetting('serverUrl');
    console.log('[Fuchs] LoginScreen - clientId:', id ? id.substring(0, 20) + '...' : 'none');
    console.log('[Fuchs] LoginScreen - serverUrl:', url);
    setClientId(id);
    setServerUrl(url);
    setLoading(false);
  };

  // Redirect URI using custom scheme (works with Desktop app type client IDs)
  const redirectUri = makeRedirectUri({
    scheme: 'com.fuchsmetallbau.app',
    path: 'redirect',
  });

  console.log('[Fuchs] LoginScreen - redirectUri:', redirectUri);

  // Authorization code flow with PKCE
  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: clientId || 'loading',
      redirectUri,
      scopes: config.google.scopes,
      responseType: ResponseType.Code,
      usePKCE: true,
      extraParams: {
        prompt: 'select_account',
      },
    },
    discovery
  );

  // Handle OAuth response
  useEffect(() => {
    if (response?.type === 'success') {
      handleAuthCode(response.params.code, request?.codeVerifier);
    } else if (response?.type === 'error') {
      console.error('[Fuchs] Auth error response:', response.error);
      Alert.alert(
        'Anmeldung fehlgeschlagen',
        response.error?.message || 'Ein Fehler ist aufgetreten. Bitte versuche es erneut.'
      );
    }
  }, [response]);

  const handleAuthCode = async (code, codeVerifier) => {
    setAuthLoading(true);
    try {
      if (serverUrl) {
        // Exchange code via backend (backend has the client_secret)
        console.log('[Fuchs] LoginScreen - exchanging code via backend');
        const res = await fetch(`${serverUrl}/api/mobile/auth/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
            client_id: clientId,
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Token-Austausch fehlgeschlagen');

        // Store tokens
        await storeTokens(data.access_token, data.refresh_token, data.expires_in || 3600);

        // Store user info from backend response
        const userInfo = {
          name: data.user_name || '',
          email: data.user_email || '',
          picture: data.user_photo || '',
        };
        await storeUserInfo(userInfo);
        onGoogleLogin(userInfo);
      } else {
        // No server URL - try direct exchange (only works without client_secret requirement)
        console.log('[Fuchs] LoginScreen - attempting direct code exchange');
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
            code_verifier: codeVerifier || '',
          }).toString(),
        });

        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenData.error_description || 'Token-Austausch fehlgeschlagen');

        await storeTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in || 3600);

        // Fetch user info
        const userInfo = await fetchUserInfo(tokenData.access_token);
        await storeUserInfo(userInfo);
        onGoogleLogin(userInfo);
      }
    } catch (error) {
      console.error('[Fuchs] LoginScreen - handleAuthCode error:', error);
      Alert.alert('Anmeldung fehlgeschlagen', error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const canSignIn = !!clientId && !!request && !authLoading;

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
          style={[styles.googleButton, !canSignIn && styles.buttonDisabled]}
          onPress={() => promptAsync()}
          disabled={!canSignIn}
        >
          {authLoading || !request ? (
            <ActivityIndicator color="white" />
          ) : (
            <>
              <Ionicons name="logo-google" size={22} color="white" />
              <Text style={styles.googleButtonText}>Mit Google anmelden</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

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
