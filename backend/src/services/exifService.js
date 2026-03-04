const { exiftool } = require('exiftool-vendored');

/**
 * Read GPS coordinates and metadata from an image file
 * @param {string} filePath - Absolute path to the image file
 * @returns {Object} { latitude, longitude, altitude, photoTakenAt, description, userComment }
 */
async function readExifData(filePath) {
  const result = {
    latitude: null,
    longitude: null,
    altitude: null,
    photoTakenAt: null,
    description: null,
    userComment: null
  };

  try {
    const tags = await exiftool.read(filePath);

    // GPS
    if (tags.GPSLatitude != null && tags.GPSLongitude != null) {
      result.latitude = tags.GPSLatitude;
      result.longitude = tags.GPSLongitude;
    }
    if (tags.GPSAltitude != null) {
      result.altitude = typeof tags.GPSAltitude === 'object'
        ? tags.GPSAltitude.rawValue || null
        : tags.GPSAltitude;
    }

    // Date
    const dateValue = tags.DateTimeOriginal || tags.DateTime || tags.CreateDate;
    if (dateValue) {
      try {
        // exiftool-vendored returns ExifDateTime objects
        if (typeof dateValue.toISOString === 'function') {
          result.photoTakenAt = dateValue.toISOString();
        } else if (typeof dateValue === 'string') {
          result.photoTakenAt = new Date(dateValue).toISOString();
        } else if (dateValue.rawValue) {
          result.photoTakenAt = new Date(dateValue.rawValue).toISOString();
        }
      } catch (e) {
        // Skip invalid dates
      }
    }

    // Description / Notes
    if (tags.ImageDescription) {
      result.description = String(tags.ImageDescription);
    }
    if (tags.UserComment) {
      result.userComment = String(tags.UserComment);
    }

  } catch (err) {
    console.warn(`Could not read EXIF from ${filePath}:`, err.message);
  }

  return result;
}

/**
 * Write GPS coordinates and metadata into an image file
 * @param {string} filePath - Absolute path to the image file
 * @param {Object} data - { latitude, longitude, altitude, description, userComment }
 */
async function writeExifData(filePath, data) {
  try {
    const tags = {};

    // GPS
    if (data.latitude != null && data.longitude != null) {
      tags.GPSLatitude = data.latitude;
      tags.GPSLatitudeRef = data.latitude >= 0 ? 'N' : 'S';
      tags.GPSLongitude = data.longitude;
      tags.GPSLongitudeRef = data.longitude >= 0 ? 'E' : 'W';
    }
    if (data.altitude != null) {
      tags.GPSAltitude = Math.abs(data.altitude);
      tags.GPSAltitudeRef = data.altitude >= 0 ? 0 : 1;
    }

    // Description (title/notes)
    if (data.description != null) {
      tags.ImageDescription = data.description;
    }
    if (data.userComment != null) {
      tags.UserComment = data.userComment;
    }

    if (Object.keys(tags).length > 0) {
      await exiftool.write(filePath, tags, { writeArgs: ['-overwrite_original'] });
    }
  } catch (err) {
    console.error(`Could not write EXIF to ${filePath}:`, err.message);
  }
}

/**
 * Shutdown exiftool process (call on app exit)
 */
async function shutdown() {
  try {
    await exiftool.end();
  } catch (e) {
    // ignore
  }
}

module.exports = { readExifData, writeExifData, shutdown };
