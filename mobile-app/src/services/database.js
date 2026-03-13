import * as SQLite from 'expo-sqlite';

let db = null;

export const getDb = async () => {
  if (!db) {
    console.log('[Fuchs] Database: opening...');
    try {
      db = await SQLite.openDatabaseAsync('fuchs_metallbau_app.db');
      console.log('[Fuchs] Database: opened, creating tables...');
      await initTables();
      console.log('[Fuchs] Database: ready');
    } catch (error) {
      console.error('[Fuchs] Database FEHLER:', error?.message, error?.stack);
      throw error;
    }
  }
  return db;
};

const initTables = async () => {
  // Validate cache tables: drop and recreate if schema is wrong (e.g. id column type changed)
  // These are cache-only tables, so no user data is lost
  const cacheTables = ['cached_projects', 'cached_images', 'cached_tags'];
  for (const table of cacheTables) {
    try {
      const idCol = await db.getFirstAsync(
        `SELECT type FROM pragma_table_info('${table}') WHERE name = 'id'`
      );
      // If table exists but id column type is wrong, drop it so it gets recreated correctly
      if (idCol && table === 'cached_projects' && idCol.type !== 'TEXT') {
        console.log(`[Fuchs] Recreating ${table} (schema mismatch: id was ${idCol.type}, need TEXT)`);
        await db.execAsync(`DROP TABLE IF EXISTS ${table}`);
      }
    } catch (e) {
      // Table doesn't exist yet, that's fine
    }
  }

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS upload_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_uri TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      project_id TEXT,
      project_name TEXT,
      project_folder_id TEXT,
      gps_data TEXT,
      status TEXT DEFAULT 'queued',
      retry_count INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      uploaded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cached_projects (
      id TEXT PRIMARY KEY,
      folder_name TEXT NOT NULL,
      folder_id TEXT,
      db_id INTEGER,
      color TEXT,
      notes TEXT,
      tags TEXT DEFAULT '[]',
      image_count INTEGER DEFAULT 0,
      is_own INTEGER DEFAULT 0,
      is_starred INTEGER DEFAULT 0,
      updated_at TEXT,
      synced_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cached_images (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT,
      mime_type TEXT,
      size INTEGER,
      modified_time TEXT,
      thumbnail_link TEXT,
      local_thumbnail_path TEXT,
      local_full_path TEXT,
      uploaded_by TEXT,
      synced_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cached_tags (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#3b82f6',
      synced_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recent_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_uri TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      project_id TEXT,
      project_name TEXT,
      gps_data TEXT,
      thumbnail_uri TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS drive_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      root_folder_id TEXT NOT NULL,
      meta_folder_id TEXT,
      inbox_folder_id TEXT,
      is_active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pending_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_name TEXT NOT NULL,
      folder_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS delete_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id INTEGER,
      file_name TEXT NOT NULL,
      file_uri TEXT,
      thumbnail_uri TEXT,
      project_name TEXT,
      project_id TEXT,
      delete_from_software INTEGER DEFAULT 0,
      status TEXT DEFAULT 'queued',
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS meta_change_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_folder_id TEXT NOT NULL,
      project_name TEXT,
      color TEXT,
      notes TEXT,
      tags TEXT DEFAULT '[]',
      is_starred INTEGER DEFAULT 0,
      status TEXT DEFAULT 'queued',
      retry_count INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      uploaded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS image_change_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_id TEXT NOT NULL,
      image_name TEXT NOT NULL,
      custom_title TEXT,
      notes TEXT,
      project_name TEXT,
      project_folder_id TEXT,
      status TEXT DEFAULT 'queued',
      retry_count INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      uploaded_at TEXT
    );
  `);

  // Migrate: add columns that may be missing from older DB versions
  const migrations = [
    { table: 'cached_projects', column: 'folder_id', sql: 'ALTER TABLE cached_projects ADD COLUMN folder_id TEXT' },
    { table: 'cached_projects', column: 'is_own', sql: 'ALTER TABLE cached_projects ADD COLUMN is_own INTEGER DEFAULT 0' },
    { table: 'cached_projects', column: 'is_starred', sql: 'ALTER TABLE cached_projects ADD COLUMN is_starred INTEGER DEFAULT 0' },
    { table: 'cached_projects', column: 'tags', sql: "ALTER TABLE cached_projects ADD COLUMN tags TEXT DEFAULT '[]'" },
    { table: 'cached_projects', column: 'notes', sql: 'ALTER TABLE cached_projects ADD COLUMN notes TEXT' },
    { table: 'cached_projects', column: 'color', sql: 'ALTER TABLE cached_projects ADD COLUMN color TEXT' },
    { table: 'cached_projects', column: 'image_count', sql: 'ALTER TABLE cached_projects ADD COLUMN image_count INTEGER DEFAULT 0' },
    { table: 'cached_projects', column: 'updated_at', sql: 'ALTER TABLE cached_projects ADD COLUMN updated_at TEXT' },
    { table: 'cached_projects', column: 'synced_at', sql: 'ALTER TABLE cached_projects ADD COLUMN synced_at TEXT' },
    { table: 'cached_projects', column: 'year', sql: 'ALTER TABLE cached_projects ADD COLUMN year INTEGER' },
    { table: 'cached_projects', column: 'db_id', sql: 'ALTER TABLE cached_projects ADD COLUMN db_id INTEGER' },
    // upload_queue migrations
    { table: 'upload_queue', column: 'project_folder_id', sql: 'ALTER TABLE upload_queue ADD COLUMN project_folder_id TEXT' },
    { table: 'upload_queue', column: 'gps_data', sql: 'ALTER TABLE upload_queue ADD COLUMN gps_data TEXT' },
    { table: 'upload_queue', column: 'custom_title', sql: 'ALTER TABLE upload_queue ADD COLUMN custom_title TEXT' },
    { table: 'upload_queue', column: 'notes', sql: 'ALTER TABLE upload_queue ADD COLUMN notes TEXT' },
    { table: 'upload_queue', column: 'photo_taken_at', sql: 'ALTER TABLE upload_queue ADD COLUMN photo_taken_at TEXT' },
    // recent_photos migrations
    { table: 'recent_photos', column: 'custom_title', sql: 'ALTER TABLE recent_photos ADD COLUMN custom_title TEXT' },
    { table: 'recent_photos', column: 'notes', sql: 'ALTER TABLE recent_photos ADD COLUMN notes TEXT' },
    { table: 'recent_photos', column: 'project_folder_id', sql: 'ALTER TABLE recent_photos ADD COLUMN project_folder_id TEXT' },
    { table: 'recent_photos', column: 'drive_file_id', sql: 'ALTER TABLE recent_photos ADD COLUMN drive_file_id TEXT' },
    { table: 'recent_photos', column: 'drive_file_name', sql: 'ALTER TABLE recent_photos ADD COLUMN drive_file_name TEXT' },
    // image_change_queue migrations
    { table: 'image_change_queue', column: 'project_name', sql: 'ALTER TABLE image_change_queue ADD COLUMN project_name TEXT' },
    { table: 'image_change_queue', column: 'project_folder_id', sql: 'ALTER TABLE image_change_queue ADD COLUMN project_folder_id TEXT' },
  ];

  for (const m of migrations) {
    try {
      const info = await db.getFirstAsync(
        `SELECT COUNT(*) as cnt FROM pragma_table_info('${m.table}') WHERE name = ?`,
        [m.column]
      );
      if (info?.cnt === 0) {
        await db.execAsync(m.sql);
        console.log(`[Fuchs] Migration: added ${m.column} to ${m.table}`);
      }
    } catch (e) {
      // Column likely already exists
    }
  }
};

// ============================================================
// Settings helpers
// ============================================================

export const getSetting = async (key, defaultValue = null) => {
  const db = await getDb();
  const result = await db.getFirstAsync('SELECT value FROM settings WHERE key = ?', [key]);
  return result ? result.value : defaultValue;
};

export const setSetting = async (key, value) => {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, String(value)]
  );
};

// ============================================================
// Upload queue helpers
// ============================================================

export const addToUploadQueue = async (fileUri, fileName, mimeType, projectId = null, projectName = null, projectFolderId = null, gpsData = null, skipRecentPhotos = false, customTitle = null, notes = null, photoTakenAt = null) => {
  const db = await getDb();

  // Also add to recent photos for the home screen (skip when re-assigning existing photos)
  if (!skipRecentPhotos) {
    try {
      await db.runAsync(
        'INSERT INTO recent_photos (file_uri, file_name, mime_type, project_id, project_name, project_folder_id, gps_data, thumbnail_uri, custom_title, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [fileUri, fileName, mimeType, projectId, projectName, projectFolderId, gpsData, fileUri, customTitle, notes]
      );
      // Keep only last 50 recent photos
      await db.runAsync(
        'DELETE FROM recent_photos WHERE id NOT IN (SELECT id FROM recent_photos ORDER BY created_at DESC LIMIT 50)'
      );
    } catch {}
  }

  return await db.runAsync(
    'INSERT INTO upload_queue (file_uri, file_name, mime_type, project_id, project_name, project_folder_id, gps_data, custom_title, notes, photo_taken_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [fileUri, fileName, mimeType, projectId, projectName, projectFolderId, gpsData, customTitle, notes, photoTakenAt]
  );
};

export const getQueuedUploads = async () => {
  const db = await getDb();
  return await db.getAllAsync(
    'SELECT * FROM upload_queue WHERE status IN (\'queued\', \'failed\') ORDER BY created_at ASC'
  );
};

export const updateUploadStatus = async (id, status, error = null) => {
  const db = await getDb();
  if (status === 'uploaded') {
    await db.runAsync(
      'UPDATE upload_queue SET status = ?, uploaded_at = datetime(\'now\') WHERE id = ?',
      [status, id]
    );
  } else {
    await db.runAsync(
      'UPDATE upload_queue SET status = ?, error = ?, retry_count = retry_count + 1 WHERE id = ?',
      [status, error, id]
    );
  }
};

export const getUploadQueueCount = async () => {
  const db = await getDb();
  const uploads = await db.getFirstAsync(
    "SELECT COUNT(*) as count FROM upload_queue WHERE status IN ('queued', 'failed')"
  );
  const imageChanges = await db.getFirstAsync(
    "SELECT COUNT(*) as count FROM image_change_queue WHERE status IN ('queued', 'failed')"
  );
  return (uploads?.count || 0) + (imageChanges?.count || 0);
};

/**
 * Get items for the queue display screen:
 * - ALL pending/failed/permanently_failed items
 * - Last 30 completed items
 */
export const getQueueDisplayItems = async () => {
  const db = await getDb();
  const pending = await db.getAllAsync(
    'SELECT * FROM upload_queue WHERE status IN (\'queued\', \'failed\', \'permanently_failed\') ORDER BY created_at ASC'
  );
  const completed = await db.getAllAsync(
    'SELECT * FROM upload_queue WHERE status = \'uploaded\' ORDER BY uploaded_at DESC LIMIT 30'
  );
  return { pending, completed };
};

/**
 * Cleanup old completed items - keep only last 30
 */
export const cleanupOldQueueItems = async () => {
  const db = await getDb();
  await db.runAsync(`
    DELETE FROM upload_queue
    WHERE status = 'uploaded'
    AND id NOT IN (
      SELECT id FROM upload_queue
      WHERE status = 'uploaded'
      ORDER BY uploaded_at DESC
      LIMIT 30
    )
  `);
};

// ============================================================
// Cache helpers
// ============================================================

export const cacheProjects = async (projects) => {
  const db = await getDb();
  await db.runAsync('DELETE FROM cached_projects');
  for (const p of projects) {
    await db.runAsync(
      'INSERT OR REPLACE INTO cached_projects (id, folder_name, folder_id, db_id, color, notes, tags, image_count, is_own, is_starred, year, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [String(p.id), String(p.folder_name || ''), String(p.folder_id || ''), p.db_id ? Number(p.db_id) : null, String(p.color || ''), String(p.notes || ''), String(p.tags || '[]'), Number(p.image_count) || 0, p.is_own ? 1 : 0, p.is_starred ? 1 : 0, p.year ? Number(p.year) : null, String(p.updated_at || '')]
    );
  }
};

/** Cache a single project (upsert) - used for progressive sync */
export const cacheProject = async (p) => {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO cached_projects (id, folder_name, folder_id, db_id, color, notes, tags, image_count, is_own, is_starred, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [String(p.id), String(p.folder_name || ''), String(p.folder_id || ''), p.db_id ? Number(p.db_id) : null, String(p.color || ''), String(p.notes || ''), String(p.tags || '[]'), Number(p.image_count) || 0, p.is_own ? 1 : 0, p.is_starred ? 1 : 0, String(p.updated_at || '')]
  );
};

/** Clear all cached projects - used before progressive sync */
export const clearCachedProjects = async () => {
  const db = await getDb();
  await db.runAsync('DELETE FROM cached_projects');
};

export const getCachedProjects = async () => {
  const db = await getDb();
  // Own projects first, then starred, then the rest - all sorted by updated_at
  return await db.getAllAsync(
    'SELECT * FROM cached_projects ORDER BY is_own DESC, is_starred DESC, updated_at DESC'
  );
};

export const getCachedProjectByFolderId = async (folderId) => {
  const db = await getDb();
  return await db.getFirstAsync('SELECT * FROM cached_projects WHERE folder_id = ? OR id = ?', [folderId, folderId]);
};

export const cacheTags = async (tags) => {
  const db = await getDb();
  await db.runAsync('DELETE FROM cached_tags');
  for (const t of tags) {
    await db.runAsync(
      'INSERT OR REPLACE INTO cached_tags (id, name, color) VALUES (?, ?, ?)',
      [t.id, t.name, t.color]
    );
  }
};

export const getCachedTags = async () => {
  const db = await getDb();
  return await db.getAllAsync('SELECT * FROM cached_tags ORDER BY name');
};

// ============================================================
// Drive connection helpers
// ============================================================

export const getDriveConnections = async () => {
  const db = await getDb();
  return await db.getAllAsync('SELECT * FROM drive_connections ORDER BY is_active DESC, created_at DESC');
};

export const getActiveDriveConnection = async () => {
  const db = await getDb();
  return await db.getFirstAsync('SELECT * FROM drive_connections WHERE is_active = 1');
};

export const addDriveConnection = async (name, rootFolderId, metaFolderId = null, inboxFolderId = null) => {
  const db = await getDb();
  // Deactivate all others
  await db.runAsync('UPDATE drive_connections SET is_active = 0');
  // Insert new as active
  await db.runAsync(
    'INSERT INTO drive_connections (name, root_folder_id, meta_folder_id, inbox_folder_id, is_active) VALUES (?, ?, ?, ?, 1)',
    [name, rootFolderId, metaFolderId, inboxFolderId]
  );
};

export const setActiveDriveConnection = async (id) => {
  const db = await getDb();
  await db.runAsync('UPDATE drive_connections SET is_active = 0');
  await db.runAsync('UPDATE drive_connections SET is_active = 1 WHERE id = ?', [id]);
};

export const updateDriveConnectionFolders = async (id, metaFolderId, inboxFolderId) => {
  const db = await getDb();
  await db.runAsync(
    'UPDATE drive_connections SET meta_folder_id = ?, inbox_folder_id = ? WHERE id = ?',
    [metaFolderId, inboxFolderId, id]
  );
};

export const removeDriveConnection = async (id) => {
  const db = await getDb();
  await db.runAsync('DELETE FROM drive_connections WHERE id = ?', [id]);
};

// ============================================================
// Recent photos helpers
// ============================================================

export const addRecentPhoto = async (fileUri, fileName, mimeType, projectId = null, projectName = null, gpsData = null) => {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO recent_photos (file_uri, file_name, mime_type, project_id, project_name, gps_data, thumbnail_uri) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [fileUri, fileName, mimeType, projectId, projectName, gpsData, fileUri]
  );
  // Keep only last 50
  await db.runAsync(
    'DELETE FROM recent_photos WHERE id NOT IN (SELECT id FROM recent_photos ORDER BY created_at DESC LIMIT 50)'
  );
};

export const getRecentPhotos = async (limit = 20, offset = 0) => {
  const db = await getDb();
  return await db.getAllAsync(
    'SELECT * FROM recent_photos ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
};

export const updateRecentPhotoProject = async (photoId, projectId, projectName) => {
  const db = await getDb();
  await db.runAsync(
    'UPDATE recent_photos SET project_id = ?, project_name = ? WHERE id = ?',
    [projectId, projectName, photoId]
  );
};

export const updateRecentPhotoDriveInfo = async (fileName, driveFileId, driveFileName) => {
  const db = await getDb();
  await db.runAsync(
    'UPDATE recent_photos SET drive_file_id = ?, drive_file_name = ? WHERE file_name = ?',
    [driveFileId || null, driveFileName || null, fileName]
  );
};

export const updateRecentPhotoProject = async (photoId, projectId, projectName, projectFolderId) => {
  const db = await getDb();
  await db.runAsync(
    'UPDATE recent_photos SET project_id = ?, project_name = ?, project_folder_id = ? WHERE id = ?',
    [projectId || null, projectName || null, projectFolderId || null, photoId]
  );
};

export const updateRecentPhotoMetadata = async (photoId, customTitle, notes) => {
  const db = await getDb();
  await db.runAsync(
    'UPDATE recent_photos SET custom_title = ?, notes = ? WHERE id = ?',
    [customTitle || null, notes || null, photoId]
  );
};

export const deleteRecentPhoto = async (photoId) => {
  const db = await getDb();
  await db.runAsync('DELETE FROM recent_photos WHERE id = ?', [photoId]);
};

export const deleteRecentPhotos = async (photoIds) => {
  if (!photoIds || photoIds.length === 0) return;
  const db = await getDb();
  const placeholders = photoIds.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM recent_photos WHERE id IN (${placeholders})`, photoIds);
};

/**
 * Check which photos are still queued (not yet uploaded) by file_name
 */
export const getQueuedFileNames = async (fileNames) => {
  if (!fileNames || fileNames.length === 0) return new Set();
  const db = await getDb();
  const placeholders = fileNames.map(() => '?').join(',');
  const rows = await db.getAllAsync(
    `SELECT file_name FROM upload_queue WHERE file_name IN (${placeholders}) AND status IN ('queued', 'failed')`,
    fileNames
  );
  return new Set(rows.map(r => r.file_name));
};

// ============================================================
// Pending Projects (created on mobile, waiting for desktop confirmation)
// ============================================================

export const addPendingProject = async (folderName, folderId) => {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO pending_projects (folder_name, folder_id) VALUES (?, ?)',
    [folderName, folderId]
  );
};

export const getPendingProjects = async () => {
  const db = await getDb();
  return await db.getAllAsync('SELECT * FROM pending_projects ORDER BY created_at DESC');
};

export const removePendingProject = async (folderName) => {
  const db = await getDb();
  await db.runAsync('DELETE FROM pending_projects WHERE folder_name = ?', [folderName]);
};

// ============================================================
// Delete queue helpers
// ============================================================

export const addToDeleteQueue = async (photos, deleteFromSoftware = false) => {
  const db = await getDb();
  for (const photo of photos) {
    await db.runAsync(
      'INSERT INTO delete_queue (photo_id, file_name, file_uri, thumbnail_uri, project_name, project_id, delete_from_software) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [photo.id || null, photo.file_name, photo.file_uri || null, photo.thumbnail_uri || null, photo.project_name || null, photo.project_id || null, deleteFromSoftware ? 1 : 0]
    );
  }
};

export const getQueuedDeletes = async () => {
  const db = await getDb();
  return await db.getAllAsync(
    "SELECT * FROM delete_queue WHERE status = 'queued' ORDER BY created_at ASC"
  );
};

export const getDeleteQueueDisplayItems = async () => {
  const db = await getDb();
  const pending = await db.getAllAsync(
    "SELECT * FROM delete_queue WHERE status IN ('queued', 'failed') ORDER BY created_at ASC"
  );
  const completed = await db.getAllAsync(
    "SELECT * FROM delete_queue WHERE status = 'done' ORDER BY processed_at DESC LIMIT 30"
  );
  return { pending, completed };
};

export const updateDeleteQueueStatus = async (id, status, error = null) => {
  const db = await getDb();
  if (status === 'done') {
    await db.runAsync(
      "UPDATE delete_queue SET status = ?, processed_at = datetime('now') WHERE id = ?",
      [status, id]
    );
  } else {
    await db.runAsync(
      'UPDATE delete_queue SET status = ?, error = ? WHERE id = ?',
      [status, error, id]
    );
  }
};

export const getDeleteQueueCount = async () => {
  const db = await getDb();
  const result = await db.getFirstAsync(
    "SELECT COUNT(*) as count FROM delete_queue WHERE status IN ('queued', 'failed')"
  );
  return result?.count || 0;
};

export const cleanupOldDeleteQueueItems = async () => {
  const db = await getDb();
  await db.runAsync(`
    DELETE FROM delete_queue
    WHERE status = 'done'
    AND id NOT IN (
      SELECT id FROM delete_queue
      WHERE status = 'done'
      ORDER BY processed_at DESC
      LIMIT 30
    )
  `);
};

export const clearConfirmedPendingProjects = async () => {
  const db = await getDb();
  // Remove pending projects that now exist in cached_projects (= confirmed by desktop)
  await db.runAsync(`
    DELETE FROM pending_projects
    WHERE LOWER(folder_name) IN (SELECT LOWER(folder_name) FROM cached_projects)
  `);
};

// ============================================================
// Meta change queue helpers (project color / notes / tags)
// ============================================================

export const addToMetaChangeQueue = async (projectFolderId, projectName, meta) => {
  const db = await getDb();
  return await db.runAsync(
    'INSERT INTO meta_change_queue (project_folder_id, project_name, color, notes, tags, is_starred) VALUES (?, ?, ?, ?, ?, ?)',
    [
      projectFolderId,
      projectName || null,
      meta.color || null,
      meta.notes || null,
      JSON.stringify(meta.tags || []),
      meta.is_starred ? 1 : 0,
    ]
  );
};

export const getQueuedMetaChanges = async () => {
  const db = await getDb();
  return await db.getAllAsync(
    "SELECT * FROM meta_change_queue WHERE status IN ('queued', 'failed') ORDER BY created_at ASC"
  );
};

export const updateMetaChangeStatus = async (id, status, error = null) => {
  const db = await getDb();
  if (status === 'uploaded') {
    await db.runAsync(
      "UPDATE meta_change_queue SET status = ?, uploaded_at = datetime('now') WHERE id = ?",
      [status, id]
    );
  } else {
    await db.runAsync(
      'UPDATE meta_change_queue SET status = ?, error = ?, retry_count = retry_count + 1 WHERE id = ?',
      [status, error, id]
    );
  }
};

export const getMetaChangeQueueDisplayItems = async () => {
  const db = await getDb();
  const pending = await db.getAllAsync(
    "SELECT * FROM meta_change_queue WHERE status IN ('queued', 'failed') ORDER BY created_at ASC"
  );
  const completed = await db.getAllAsync(
    "SELECT * FROM meta_change_queue WHERE status = 'uploaded' ORDER BY uploaded_at DESC LIMIT 30"
  );
  return { pending, completed };
};

export const cleanupOldMetaChangeQueueItems = async () => {
  const db = await getDb();
  await db.runAsync(`
    DELETE FROM meta_change_queue
    WHERE status = 'uploaded'
    AND id NOT IN (
      SELECT id FROM meta_change_queue
      WHERE status = 'uploaded'
      ORDER BY uploaded_at DESC
      LIMIT 30
    )
  `);
};

// ============================================================
// Image change queue (title/notes edits for already-uploaded images)
// ============================================================

export const addToImageChangeQueue = async (imageId, imageName, customTitle, notes, projectName = null, projectFolderId = null) => {
  const db = await getDb();
  // Merge into any existing pending entry for this image (one request per image)
  await db.runAsync(
    "DELETE FROM image_change_queue WHERE image_id = ? AND status IN ('queued', 'failed')",
    [imageId]
  );
  await db.runAsync(
    'INSERT INTO image_change_queue (image_id, image_name, custom_title, notes, project_name, project_folder_id) VALUES (?, ?, ?, ?, ?, ?)',
    [imageId, imageName, customTitle ?? null, notes ?? null, projectName ?? null, projectFolderId ?? null]
  );
};

export const getQueuedImageChanges = async () => {
  const db = await getDb();
  return db.getAllAsync(
    "SELECT * FROM image_change_queue WHERE status IN ('queued', 'failed') ORDER BY created_at ASC"
  );
};

export const updateImageChangeStatus = async (id, status, error = null) => {
  const db = await getDb();
  if (status === 'uploaded') {
    await db.runAsync(
      "UPDATE image_change_queue SET status = ?, uploaded_at = datetime('now') WHERE id = ?",
      [status, id]
    );
  } else {
    await db.runAsync(
      'UPDATE image_change_queue SET status = ?, error = ?, retry_count = retry_count + 1 WHERE id = ?',
      [status, error, id]
    );
  }
};

export const getImageChangeQueueDisplayItems = async () => {
  const db = await getDb();
  const pending = await db.getAllAsync(
    "SELECT * FROM image_change_queue WHERE status IN ('queued', 'failed') ORDER BY created_at ASC"
  );
  const completed = await db.getAllAsync(
    "SELECT * FROM image_change_queue WHERE status = 'uploaded' ORDER BY uploaded_at DESC LIMIT 30"
  );
  return { pending, completed };
};

export const cleanupOldImageChangeQueueItems = async () => {
  const db = await getDb();
  await db.runAsync(`
    DELETE FROM image_change_queue
    WHERE status = 'uploaded'
    AND id NOT IN (
      SELECT id FROM image_change_queue
      WHERE status = 'uploaded'
      ORDER BY uploaded_at DESC
      LIMIT 30
    )
  `);
};
