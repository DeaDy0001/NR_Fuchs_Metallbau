import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useApp } from '../contexts/AppContext';
import { storeTokens, fetchUserInfo, storeUserInfo } from '../services/googleAuth';
import config from '../config';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const { onGoogleLogin } = useApp();

  const [request, response, promptAsync] = Google.useAuthRequest({
    expoClientId: config.google.expoClientId || undefined,
    androidClientId: config.google.androidClientId || undefined,
    webClientId: config.google.webClientId || undefined,
    scopes: config.google.scopes,
    responseType: 'code',
  });

  useEffect(() => {
    handleAuthResponse();
  }, [response]);

  const handleAuthResponse = async () => {
    if (response?.type === 'success') {
      try {
        const { authentication } = response;
        if (authentication?.accessToken) {
          // Store tokens
          await storeTokens(
            authentication.accessToken,
            authentication.refreshToken,
            authentication.expiresIn
          );

          // Fetch and store user info
          const userInfo = await fetchUserInfo(authentication.accessToken);
          await storeUserInfo(userInfo);

          // Notify app context
          onGoogleLogin(userInfo);
        }
      } catch (error) {
        console.error('[Fuchs] Google Auth Error:', error);
      }
    }
  };

  const hasClientIds = config.google.expoClientId || config.google.androidClientId || config.google.webClientId;

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
        <Text style={styles.loginTitle}>Anmelden</Text>
        <Text style={styles.loginDesc}>
          Melde dich mit deinem Google-Konto an, um auf die freigegebenen Google Drive Ordner zuzugreifen.
        </Text>

        {!hasClientIds ? (
          <View style={styles.configWarning}>
            <Ionicons name="warning" size={24} color={colors.warning} />
            <Text style={styles.configWarningText}>
              Google OAuth ist noch nicht konfiguriert.{'\n\n'}
              Bitte setze die Client-IDs in{'\n'}
              src/config.js
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.googleButton, !request && styles.buttonDisabled]}
            onPress={() => promptAsync()}
            disabled={!request}
          >
            {!request ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Ionicons name="logo-google" size={22} color="white" />
                <Text style={styles.googleButtonText}>Mit Google anmelden</Text>
              </>
            )}
          </TouchableOpacity>
        )}
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
  configWarning: {
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  configWarningText: {
    color: colors.warning,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  footerText: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'center',
  },
});
