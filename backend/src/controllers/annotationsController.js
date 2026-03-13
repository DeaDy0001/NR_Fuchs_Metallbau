const db = require('../config/database');
const fs = require('fs-extra');
const path = require('path');

// Get annotations for an image
const getAnnotations = (req, res) => {
  try {
    const { imageId } = req.params;

    const stmt = db.prepare('SELECT annotations FROM image_annotations WHERE image_id = ? ORDER BY updated_at DESC LIMIT 1');
    const result = stmt.get(imageId);

    if (!result) {
      return res.json({ annotations: null });
    }

    let parsed = null;
    try { parsed = JSON.parse(result.annotations); } catch {}
    res.json({ annotations: parsed });
  } catch (error) {
    console.error('Error getting annotations:', error);
    res.status(500).json({ error: 'Failed to get annotations' });
  }
};

// Save annotations for an image
const saveAnnotations = (req, res) => {
  try {
    const { imageId } = req.params;
    const { annotations } = req.body;

    if (!annotations) {
      return res.status(400).json({ error: 'No annotations provided' });
    }

    // Check if annotations already exist
    const existing = db.prepare('SELECT id FROM image_annotations WHERE image_id = ?').get(imageId);

    if (existing) {
      // Update existing
      const stmt = db.prepare("UPDATE image_annotations SET annotations = ?, updated_at = datetime('now') WHERE image_id = ?");
      stmt.run(JSON.stringify(annotations), imageId);
    } else {
      // Insert new
      const stmt = db.prepare('INSERT INTO image_annotations (image_id, annotations) VALUES (?, ?)');
      stmt.run(imageId, JSON.stringify(annotations));
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving annotations:', error);
    res.status(500).json({ error: 'Failed to save annotations' });
  }
};

// Export image with annotations (overwrite original)
const exportImageOverwrite = async (req, res) => {
  try {
    const { imageId } = req.params;
    const { dataURL, annotations } = req.body;

    if (!dataURL) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    // Get original image info
    const image = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(imageId);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Convert base64 to buffer
    const base64Data = dataURL.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Get original file path (with path traversal protection)
    const projectRoot = path.resolve(__dirname, '../../../');
    const originalPath = path.resolve(path.join(projectRoot, image.local_path));
    if (!originalPath.startsWith(projectRoot)) {
      return res.status(400).json({ error: 'Invalid image path' });
    }

    // Backup original (optional)
    const backupPath = originalPath.replace(/(\.\w+)$/, '_backup$1');
    await fs.copy(originalPath, backupPath);

    // Write new image
    await fs.writeFile(originalPath, buffer);

    // Save annotations
    const existing = db.prepare('SELECT id FROM image_annotations WHERE image_id = ?').get(imageId);
    if (existing) {
      const stmt = db.prepare("UPDATE image_annotations SET annotations = ?, updated_at = datetime('now') WHERE image_id = ?");
      stmt.run(annotations, imageId);
    } else {
      const stmt = db.prepare('INSERT INTO image_annotations (image_id, annotations) VALUES (?, ?)');
      stmt.run(imageId, annotations);
    }

    // ✅ Update thumbnail to show the annotated image
    db.prepare('UPDATE drive_images SET thumbnail_url = ? WHERE id = ?').run(
      image.local_path,  // Use updated image as thumbnail (shows annotations!)
      imageId
    );

    res.json({
      success: true,
      message: 'Image updated successfully'
    });
  } catch (error) {
    console.error('Error exporting image (overwrite):', error);
    res.status(500).json({ error: 'Failed to export image' });
  }
};

// Export image with annotations as new image
const exportImageNew = async (req, res) => {
  try {
    const { imageId } = req.params;
    const { dataURL, annotations } = req.body;

    if (!dataURL) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    // Get original image info
    const image = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(imageId);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Convert base64 to buffer
    const base64Data = dataURL.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Determine original file path
    let originalPath;
    let isProjectImage = false;

    if (image.local_path && image.local_path.startsWith('/api/projects/')) {
      // Project image - construct real file path
      isProjectImage = true;

      // Extract project ID and filename from URL: /api/projects/{id}/file/image/{filename}
      const urlMatch = image.local_path.match(/^\/api\/projects\/(\d+)\/file\/image\/(.+)$/);
      if (!urlMatch) {
        throw new Error('Invalid project image path format');
      }

      const projectId = urlMatch[1];
      const fileName = decodeURIComponent(urlMatch[2]);

      // Get project info
      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      if (!project) {
        throw new Error('Project not found');
      }

      // Get project base path
      const projectSettings = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
      if (!projectSettings || !projectSettings.project_path) {
        throw new Error('Project base path not configured');
      }

      // Construct real file path
      originalPath = path.join(projectSettings.project_path, project.folder_name, 'Bilder', fileName);
    } else {
      // Regular Drive image (with path traversal protection)
      const projectRoot = path.resolve(__dirname, '../../../');
      originalPath = path.resolve(path.join(projectRoot, image.local_path));
      if (!originalPath.startsWith(projectRoot)) {
        return res.status(400).json({ error: 'Invalid image path' });
      }
    }

    // Generate new filename with _e1, _e2, etc. suffix
    const ext = path.extname(originalPath);
    const dirName = path.dirname(originalPath);

    // Get base name without _eN suffix (if present)
    let baseName = path.basename(originalPath, ext);
    baseName = baseName.replace(/_e\d+$/, ''); // Remove existing _e1, _e2, etc.

    // Find next available _eN suffix
    let editNumber = 1;
    let newFileName;
    let newPath;
    do {
      newFileName = `${baseName}_e${editNumber}${ext}`;
      newPath = path.join(dirName, newFileName);
      editNumber++;
    } while (await fs.pathExists(newPath));

    // Write new image
    await fs.writeFile(newPath, buffer);

    // Generate new local_path
    let newLocalPath;
    if (isProjectImage) {
      // For project images, keep the API URL format
      newLocalPath = image.local_path.replace(
        /\/([^\/]+)$/,  // Replace last segment (filename)
        `/${encodeURIComponent(newFileName)}`
      );
    } else {
      // For regular images, use relative path
      newLocalPath = image.local_path.replace(
        path.basename(image.local_path),
        newFileName
      );
    }

    // Insert new image into database
    const insertStmt = db.prepare(`
      INSERT INTO drive_images (
        name, original_name, file_url, drive_file_id, thumbnail_url, local_path, mime_type,
        photo_taken_at, is_compressed, subfolder, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    // Use the generated filename (with _e1, _e2, etc.)
    const result = insertStmt.run(
      newFileName,
      newFileName, // original_name = same as name for edited images
      newLocalPath, // ✅ file_url = full web path
      null, // No drive_file_id for local images
      newLocalPath, // ✅ thumbnail_url = same as file (shows annotations!)
      newLocalPath,
      image.mime_type,
      image.photo_taken_at,
      0, // Not compressed
      image.subfolder
    );

    const newImageId = result.lastInsertRowid;

    // Save annotations for new image
    const annotationStmt = db.prepare('INSERT INTO image_annotations (image_id, annotations) VALUES (?, ?)');
    annotationStmt.run(newImageId, annotations);

    // ✅ Copy project assignments from original image to new image
    const projectAssignments = db.prepare('SELECT project_id FROM image_project_assignments WHERE image_id = ?').all(imageId);
    if (projectAssignments.length > 0) {
      const copyProjectStmt = db.prepare('INSERT INTO image_project_assignments (image_id, project_id) VALUES (?, ?)');
      for (const assignment of projectAssignments) {
        copyProjectStmt.run(newImageId, assignment.project_id);

        // 🔧 If this is a Drive image (not project image), copy file to project folder
        if (!isProjectImage) {
          // Get project info
          const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(assignment.project_id);
          if (!project) continue;

          // Get project base path
          const projectSettings = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
          if (!projectSettings?.project_path) continue;

          // Construct destination path
          const projectFolderPath = path.join(projectSettings.project_path, project.folder_name, 'Bilder');
          const destPath = path.join(projectFolderPath, newFileName);

          try {
            // Create Bilder folder if it doesn't exist
            await fs.ensureDir(projectFolderPath);

            // Copy file to project folder
            await fs.copy(newPath, destPath, { overwrite: false });
            console.log(`📂 Copied new image to project folder: ${destPath}`);
          } catch (copyError) {
            console.error(`⚠️  Failed to copy to project ${project.folder_name}:`, copyError);
          }
        }
      }
    }

    // Get the newly created image
    const newImage = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(newImageId);

    res.json({
      success: true,
      message: 'New image created successfully',
      image: newImage
    });
  } catch (error) {
    console.error('Error exporting image (new):', error);
    res.status(500).json({ error: 'Failed to export image' });
  }
};

module.exports = {
  getAnnotations,
  saveAnnotations,
  exportImageOverwrite,
  exportImageNew
};
