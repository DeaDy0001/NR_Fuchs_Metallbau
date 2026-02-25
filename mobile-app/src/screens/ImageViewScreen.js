import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, Dimensions, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { downloadFullImage } from '../services/syncService';
import { getImageUrl } from '../services/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function ImageViewScreen({ route, navigation }) {
  const { imageId, imageName, projectName } = route.params;
  const [imageUri, setImageUri] = useState(null);
  const [imageHeaders, setImageHeaders] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadImage();
  }, []);

  const loadImage = async () => {
    try {
      // Try to download and cache full resolution
      const localPath = await downloadFullImage(imageId);
      setImageUri(localPath);
    } catch (error) {
      console.error('Failed to download full image, using direct Drive URL:', error);
      // Fallback: use Drive API directly
      try {
        const source = await getImageUrl(imageId);
        if (source) {
          setImageUri(source.uri);
          setImageHeaders(source.headers);
        }
      } catch (e) {
        console.error('Failed to get image URL:', e);
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
            imageHeaders
              ? { uri: imageUri, headers: imageHeaders }
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
  container: { flex: 1, backgroundColor: 'black' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 48, paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.8)', gap: 12,
  },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerInfo: { flex: 1 },
  headerTitle: { color: 'white', fontSize: 16, fontWeight: '600' },
  headerSubtitle: { color: colors.textTertiary, fontSize: 13, marginTop: 2 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: colors.textTertiary, fontSize: 14 },
  image: { flex: 1, width: SCREEN_WIDTH },
});
