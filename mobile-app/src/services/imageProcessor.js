import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Image } from 'react-native';
import { getSetting } from './database';

/**
 * Get image dimensions from a file URI
 */
const getImageDimensions = (uri) => new Promise((resolve, reject) => {
  Image.getSize(
    uri,
    (width, height) => resolve({ width, height }),
    (error) => reject(error)
  );
});

/**
 * Process an image before uploading:
 * - Optionally save original to phone gallery (keepOriginal setting)
 * - Resize according to maxImageResolution setting
 * - Compress according to imageQuality setting
 * - Ensure file size is within maxImageSizeKB setting
 *
 * @param {string} fileUri - URI of the original image
 * @param {string} fileName - file name (used to detect camera vs gallery source)
 * @returns {string} URI of the processed image (may be same as input if no processing needed)
 */
export const processImageForUpload = async (fileUri, fileName) => {
  // Read compression settings
  const quality = parseInt(await getSetting('imageQuality', '80')) / 100;
  const maxResolution = parseInt(await getSetting('maxImageResolution', '1920'));
  const maxSizeKB = parseInt(await getSetting('maxImageSizeKB', '1024'));
  const keepOriginal = (await getSetting('keepOriginal', 'true')) === 'true';

  // Save original to phone gallery if requested (only for camera captures)
  // Camera photos are named "photo_..." - gallery picks already exist in the gallery
  if (keepOriginal && fileName && fileName.startsWith('photo_')) {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status === 'granted') {
        await MediaLibrary.saveToLibraryAsync(fileUri);
        console.log(`📸 Original saved to gallery: ${fileName}`);
      }
    } catch (e) {
      console.warn('Could not save original to gallery:', e.message);
    }
  }

  // Check if any processing is needed
  const noResize = maxResolution === 0;
  const noQualityChange = quality >= 1;
  const noSizeLimit = maxSizeKB === 0;

  if (noResize && noQualityChange && noSizeLimit) {
    return fileUri; // No processing needed
  }

  // Determine resize actions
  const actions = [];
  if (maxResolution > 0) {
    try {
      const { width, height } = await getImageDimensions(fileUri);
      // Only resize if image exceeds maxResolution on its longest side
      if (width > maxResolution || height > maxResolution) {
        if (width >= height) {
          actions.push({ resize: { width: maxResolution } });
        } else {
          actions.push({ resize: { height: maxResolution } });
        }
      }
    } catch (e) {
      // If we can't determine dimensions, resize by width as fallback
      console.warn('Could not get image dimensions, resizing by width:', e.message);
      actions.push({ resize: { width: maxResolution } });
    }
  }

  // First compression pass
  let result = await manipulateAsync(fileUri, actions, {
    compress: quality,
    format: SaveFormat.JPEG,
  });

  // Check file size limit and iteratively reduce quality if needed
  if (maxSizeKB > 0) {
    let fileInfo = await FileSystem.getInfoAsync(result.uri);
    let currentQuality = quality;
    let attempts = 0;

    while (fileInfo.size > maxSizeKB * 1024 && currentQuality > 0.1 && attempts < 5) {
      currentQuality = Math.max(0.1, currentQuality - 0.15);
      result = await manipulateAsync(fileUri, actions, {
        compress: currentQuality,
        format: SaveFormat.JPEG,
      });
      fileInfo = await FileSystem.getInfoAsync(result.uri);
      attempts++;
    }

    if (fileInfo.size > maxSizeKB * 1024) {
      console.warn(`Image still exceeds ${maxSizeKB}KB after compression (${Math.round(fileInfo.size / 1024)}KB)`);
    }
  }

  return result.uri;
};
