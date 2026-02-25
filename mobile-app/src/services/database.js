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
      project_id INTEGER,
      project_name TEXT,
      status TEXT DEFAULT 'queued',
      retry_count INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      uploaded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cached_projects (
      id INTEGER PRIMARY KEY,
      folder_name TEXT NOT NULL,
      color TEXT,
      notes TEXT,
      tags TEXT DEFAULT '[]',
      image_count INTEGER DEFAULT 0,
      updated_at TEXT,
      synced_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cached_images (
      id INTEGER PRIMARY KEY,
      project_id INTEGER,
      name TEXT,
      original_name TEXT,
      thumbnail_url TEXT,
      local_thumbnail_path TEXT,
      local_full_path TEXT,
      file_size INTEGER,
      width INTEGER,
      height INTEGER,
      photo_taken_at TEXT,
      uploaded_by TEXT,
      synced_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cached_tags (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#3b82f6',
      synced_at TEXT DEFAULT (datetime('now'))
    );
  `);
};

// Settings helpers
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

// Upload queue helpers
export const addToUploadQueue = async (fileUri, fileName, mimeType, projectId = null, projectName = null) => {
  const db = await getDb();
  return await db.runAsync(
    'INSERT INTO upload_queue (file_uri, file_name, mime_type, project_id, project_name) VALUES (?, ?, ?, ?, ?)',
    [fileUri, fileName, mimeType, projectId, projectName]
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

// Cache helpers
export const cacheProjects = async (projects) => {
  const db = await getDb();
  await db.runAsync('DELETE FROM cached_projects');
  for (const p of projects) {
    await db.runAsync(
      'INSERT OR REPLACE INTO cached_projects (id, folder_name, color, notes, tags, image_count, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [p.id, p.folder_name, p.color, p.notes, p.tags || '[]', p.image_count || 0, p.updated_at]
    );
  }
};

export const getCachedProjects = async () => {
  const db = await getDb();
  return await db.getAllAsync('SELECT * FROM cached_projects ORDER BY updated_at DESC');
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
