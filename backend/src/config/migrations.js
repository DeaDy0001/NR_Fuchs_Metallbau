const db = require('./database');

/**
 * Database Migrations
 * Handles schema updates for existing databases
 */

const migrations = [
  {
    id: 1,
    name: 'add_drive_sync_columns',
    up: () => {
      console.log('Running migration: add_drive_sync_columns');

      // Check if columns already exist
      const tableInfo = db.pragma('table_info(drive_paths)');
      const existingColumns = tableInfo.map(col => col.name);

      // Add compression settings if not exists
      if (!existingColumns.includes('compression_enabled')) {
        db.exec('ALTER TABLE drive_paths ADD COLUMN compression_enabled INTEGER DEFAULT 0');
      }
      if (!existingColumns.includes('compression_quality')) {
        db.exec('ALTER TABLE drive_paths ADD COLUMN compression_quality INTEGER DEFAULT 85');
      }
      if (!existingColumns.includes('compression_format')) {
        db.exec('ALTER TABLE drive_paths ADD COLUMN compression_format TEXT DEFAULT \'webp\'');
      }
      if (!existingColumns.includes('max_width')) {
        db.exec('ALTER TABLE drive_paths ADD COLUMN max_width INTEGER');
      }
      if (!existingColumns.includes('max_height')) {
        db.exec('ALTER TABLE drive_paths ADD COLUMN max_height INTEGER');
      }

      // Add sync settings if not exists
      if (!existingColumns.includes('delete_after_sync')) {
        db.exec('ALTER TABLE drive_paths ADD COLUMN delete_after_sync INTEGER DEFAULT 0');
      }
      if (!existingColumns.includes('auto_sync_enabled')) {
        db.exec('ALTER TABLE drive_paths ADD COLUMN auto_sync_enabled INTEGER DEFAULT 1');
      }
      if (!existingColumns.includes('sync_interval')) {
        db.exec('ALTER TABLE drive_paths ADD COLUMN sync_interval INTEGER DEFAULT 5');
      }
      if (!existingColumns.includes('last_sync')) {
        db.exec('ALTER TABLE drive_paths ADD COLUMN last_sync TEXT');
      }

      console.log('✓ Migration add_drive_sync_columns completed');
    }
  },
  {
    id: 2,
    name: 'add_drive_images_columns',
    up: () => {
      console.log('Running migration: add_drive_images_columns');

      const tableInfo = db.pragma('table_info(drive_images)');
      const existingColumns = tableInfo.map(col => col.name);

      if (!existingColumns.includes('local_path')) {
        db.exec('ALTER TABLE drive_images ADD COLUMN local_path TEXT');
      }
      if (!existingColumns.includes('is_compressed')) {
        db.exec('ALTER TABLE drive_images ADD COLUMN is_compressed INTEGER DEFAULT 0');
      }
      if (!existingColumns.includes('drive_file_id')) {
        db.exec('ALTER TABLE drive_images ADD COLUMN drive_file_id TEXT');
      }

      console.log('✓ Migration add_drive_images_columns completed');
    }
  },
  {
    id: 3,
    name: 'add_photo_taken_at_column',
    up: () => {
      console.log('Running migration: add_photo_taken_at_column');

      const tableInfo = db.pragma('table_info(drive_images)');
      const existingColumns = tableInfo.map(col => col.name);

      if (!existingColumns.includes('photo_taken_at')) {
        db.exec('ALTER TABLE drive_images ADD COLUMN photo_taken_at TEXT');
      }

      console.log('✓ Migration add_photo_taken_at_column completed');
    }
  }
];

// Create migrations table
const initMigrationsTable = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      executed_at TEXT DEFAULT (datetime('now'))
    )
  `);
};

// Run all pending migrations
const runMigrations = () => {
  try {
    console.log('🔄 Checking for database migrations...');

    initMigrationsTable();

    // Get executed migrations
    const executed = db.prepare('SELECT id FROM migrations').all();
    const executedIds = new Set(executed.map(m => m.id));

    // Run pending migrations
    let ranMigrations = 0;
    for (const migration of migrations) {
      if (!executedIds.has(migration.id)) {
        migration.up();
        db.prepare('INSERT INTO migrations (id, name) VALUES (?, ?)').run(
          migration.id,
          migration.name
        );
        ranMigrations++;
      }
    }

    if (ranMigrations > 0) {
      console.log(`✓ Ran ${ranMigrations} migration(s)`);
    } else {
      console.log('✓ Database is up to date');
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
};

module.exports = { runMigrations };
