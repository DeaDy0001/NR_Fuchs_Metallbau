import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useAuthRequest, makeRedirectUri, ResponseType } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { storeTokens, fetchUserInfo, storeUserInfo, getGoogleClientId } from '../services/googleAuth';
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
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    loadClientId();
  }, []);

  const loadClientId = async () => {
    const id = await getGoogleClientId();
    console.log('[Fuchs] LoginScreen - loaded client ID:', id ? id.substring(0, 20) + '...' : 'none');
    setClientId(id);
    setLoading(false);
  };

  // Use generic useAuthRequest instead of Google-specific provider
  // to avoid platform-specific client ID requirements
  const redirectUri = makeRedirectUri({
    scheme: 'com.fuchsmetallbau.app',
  });

  console.log('[Fuchs] LoginScreen - redirect URI:', redirectUri);

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: clientId || 'loading',
      redirectUri,
      scopes: config.google.scopes,
      responseType: ResponseType.Token,
      usePKCE: false,
      extraParams: {
        prompt: 'select_account',
      },
    },
    discovery
  );

  useEffect(() => {
    handleAuthResponse();
  }, [response]);

  const handleAuthResponse = async () => {
    if (response?.type === 'success') {
      setAuthLoading(true);
      try {
        const { access_token, expires_in } = response.params;
        if (access_token) {
          // Store tokens (no refresh token with implicit grant)
          await storeTokens(access_token, null, parseInt(expires_in) || 3600);

          // Fetch and store user info
          const userInfo = await fetchUserInfo(access_token);
          await storeUserInfo(userInfo);

          // Notify app context
          onGoogleLogin(userInfo);
        }
      } catch (error) {
        console.error('[Fuchs] Google Auth Error:', error);
        Alert.alert('Anmeldung fehlgeschlagen', error.message);
      } finally {
        setAuthLoading(false);
      }
    } else if (response?.type === 'error') {
      console.error('[Fuchs] Auth error:', response.error);
      Alert.alert(
        'Anmeldung fehlgeschlagen',
        response.error?.message || 'Ein Fehler ist aufgetreten. Bitte versuche es erneut.'
      );
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
