import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Image } from 'react-native';
import { getSetting } from './database';

// Map server image_format value → expo SaveFormat + mime + file extension
const FORMAT_MAP = {
  jpeg: { saveFormat: SaveFormat.JPEG, mimeType: 'image/jpeg', ext: 'jpg' },
  jpg:  { saveFormat: SaveFormat.JPEG, mimeType: 'image/jpeg', ext: 'jpg' },
  png:  { saveFormat: SaveFormat.PNG,  mimeType: 'image/png',  ext: 'png' },
  webp: { saveFormat: SaveFormat.WEBP, mimeType: 'image/webp', ext: 'webp' },
};

const changeExtension = (fileName, ext) => {
  const lastDot = fileName.lastIndexOf('.');
  const base = lastDot > -1 ? fileName.substring(0, lastDot) : fileName;
  return `${base}.${ext}`;
};

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
  // Read server-defined image format (set by software, synced on startup)
  const serverFormat = await getSetting('serverImageFormat', 'jpeg');
  const isOriginalFormat = serverFormat === 'original';
  const fmt = FORMAT_MAP[serverFormat] || FORMAT_MAP.jpeg;
  const saveFormat = isOriginalFormat ? SaveFormat.JPEG : fmt.saveFormat;
  const mimeType = isOriginalFormat ? 'image/jpeg' : fmt.mimeType;
  const processedFileName = isOriginalFormat ? fileName : changeExtension(fileName, fmt.ext);

  // Read compression settings
  const quality = parseInt(await getSetting('imageQuality', '80')) / 100;
  const maxResolution = parseInt(await getSetting('maxImageResolution', '1920'));
  const maxSizeKB = parseInt(await getSetting('maxImageSizeKB', '1024'));
  const keepOriginal = (await getSetting('keepOriginal', 'true')) === 'true';

  // Save original to phone gallery if requested (only for camera captures)
  // Camera photos are named "photo_..." - gallery picks already exist in the gallery
  if (keepOriginal && fileName && fileName.startsWith('photo_')) {
    try {
      // Use getPermissionsAsync (not request) since we're in background queue.
      // Permission is pre-requested in CameraScreen when the user opens the camera.
      let { status } = await MediaLibrary.getPermissionsAsync();
      if (status !== 'granted') {
        // Fallback: try requesting (works on some devices even in background)
        const result = await MediaLibrary.requestPermissionsAsync();
        status = result.status;
      }
      if (status === 'granted') {
        await MediaLibrary.saveToLibraryAsync(fileUri);
        console.log(`[Fuchs] Original saved to gallery: ${fileName}`);
      } else {
        console.warn('[Fuchs] MediaLibrary permission not granted, cannot save original to gallery');
      }
    } catch (e) {
      console.warn('[Fuchs] Could not save original to gallery:', e.message);
    }
  }

  // Skip processing only when no format conversion is needed AND all other settings are default
  const noFormatConversion = isOriginalFormat || serverFormat === 'jpeg' || serverFormat === 'jpg';
  const noResize = maxResolution === 0;
  const noQualityChange = quality >= 1;
  const noSizeLimit = maxSizeKB === 0;

  if (noFormatConversion && noResize && noQualityChange && noSizeLimit) {
    return { uri: fileUri, mimeType: 'image/jpeg', fileName: processedFileName };
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
    format: saveFormat,
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
        format: saveFormat,
      });
      fileInfo = await FileSystem.getInfoAsync(result.uri);
      attempts++;
    }

    if (fileInfo.size > maxSizeKB * 1024) {
      console.warn(`Image still exceeds ${maxSizeKB}KB after compression (${Math.round(fileInfo.size / 1024)}KB)`);
    }
  }

  return { uri: result.uri, mimeType, fileName: processedFileName };
};
