import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, Dimensions, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { downloadFullImage } from '../services/syncService';
import { getSetting } from '../services/database';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function ImageViewScreen({ route, navigation }) {
  const { imageId, imageName, projectName } = route.params;
  const [imageUri, setImageUri] = useState(null);
  const [loading, setLoading] = useState(true);
  const [serverUrl, setServerUrl] = useState('');
  const [authToken, setAuthToken] = useState('');

  useEffect(() => {
    loadImage();
  }, []);

  const loadImage = async () => {
    try {
      const url = await getSetting('serverUrl', '');
      const token = await getSetting('authToken', '');
      setServerUrl(url);
      setAuthToken(token);

      // Try to download full resolution
      const localPath = await downloadFullImage(imageId);
      setImageUri(localPath);
    } catch (error) {
      console.error('Failed to load full image:', error);
      // Fallback: use server URL directly
      const url = await getSetting('serverUrl', '');
      const token = await getSetting('authToken', '');
      if (url) {
        setImageUri(`${url}/api/mobile/image/${imageId}`);
        setAuthToken(token);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>{imageName}</Text>
          {projectName && <Text style={styles.headerSubtitle}>{projectName}</Text>}
        </View>
      </View>

      {/* Image */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Bild wird geladen...</Text>
        </View>
      ) : imageUri ? (
        <Image
          source={
            imageUri.startsWith('http')
              ? { uri: imageUri, headers: { 'X-Mobile-Token': authToken } }
              : { uri: imageUri }
          }
          style={styles.image}
          resizeMode="contain"
        />
      ) : (
        <View style={styles.loadingContainer}>
          <Ionicons name="image-outline" size={64} color={colors.textTertiary} />
          <Text style={styles.loadingText}>Bild konnte nicht geladen werden</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.8)',
    gap: 12,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  headerSubtitle: {
    color: colors.textTertiary,
    fontSize: 13,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: colors.textTertiary,
    fontSize: 14,
  },
  image: {
    flex: 1,
    width: SCREEN_WIDTH,
  },
});
