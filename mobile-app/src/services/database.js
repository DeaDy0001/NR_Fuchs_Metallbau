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

export const addToUploadQueue = async (fileUri, fileName, mimeType, projectId = null, projectName = null, projectFolderId = null, gpsData = null) => {
  const db = await getDb();

  // Also add to recent photos for the home screen
  try {
    await db.runAsync(
      'INSERT INTO recent_photos (file_uri, file_name, mime_type, project_id, project_name, gps_data, thumbnail_uri) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [fileUri, fileName, mimeType, projectId, projectName, gpsData, fileUri]
    );
    // Keep only last 50 recent photos
    await db.runAsync(
      'DELETE FROM recent_photos WHERE id NOT IN (SELECT id FROM recent_photos ORDER BY created_at DESC LIMIT 50)'
    );
  } catch {}

  return await db.runAsync(
    'INSERT INTO upload_queue (file_uri, file_name, mime_type, project_id, project_name, project_folder_id) VALUES (?, ?, ?, ?, ?, ?)',
    [fileUri, fileName, mimeType, projectId, projectName, projectFolderId]
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
  const result = await db.getFirstAsync(
    'SELECT COUNT(*) as count FROM upload_queue WHERE status IN (\'queued\', \'failed\')'
  );
  return result?.count || 0;
};

// ============================================================
// Cache helpers
// ============================================================

export const cacheProjects = async (projects) => {
  const db = await getDb();
  await db.runAsync('DELETE FROM cached_projects');
  for (const p of projects) {
    await db.runAsync(
      'INSERT OR REPLACE INTO cached_projects (id, folder_name, folder_id, color, notes, tags, image_count, is_own, is_starred, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [String(p.id), String(p.folder_name || ''), String(p.folder_id || ''), String(p.color || ''), String(p.notes || ''), String(p.tags || '[]'), Number(p.image_count) || 0, p.is_own ? 1 : 0, p.is_starred ? 1 : 0, String(p.updated_at || '')]
    );
  }
};

/** Cache a single project (upsert) - used for progressive sync */
export const cacheProject = async (p) => {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO cached_projects (id, folder_name, folder_id, color, notes, tags, image_count, is_own, is_starred, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [String(p.id), String(p.folder_name || ''), String(p.folder_id || ''), String(p.color || ''), String(p.notes || ''), String(p.tags || '[]'), Number(p.image_count) || 0, p.is_own ? 1 : 0, p.is_starred ? 1 : 0, String(p.updated_at || '')]
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

export const getRecentPhotos = async (limit = 20) => {
  const db = await getDb();
  return await db.getAllAsync(
    'SELECT * FROM recent_photos ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
};
