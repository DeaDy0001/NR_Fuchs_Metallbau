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
  },
  {
    id: 4,
    name: 'create_ignored_files_table',
    up: () => {
      console.log('Running migration: create_ignored_files_table');

      // Create table for ignored files (soft-deleted from software only)
      db.exec(`
        CREATE TABLE IF NOT EXISTS ignored_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          drive_file_id TEXT NOT NULL UNIQUE,
          original_name TEXT,
          ignored_at TEXT DEFAULT (datetime('now')),
          reason TEXT DEFAULT 'user_deleted'
        )
      `);

      console.log('✓ Migration create_ignored_files_table completed');
    }
  },
  {
    id: 5,
    name: 'add_subfolder_column',
    up: () => {
      console.log('Running migration: add_subfolder_column');

      const tableInfo = db.pragma('table_info(drive_images)');
      const existingColumns = tableInfo.map(col => col.name);

      // Add subfolder column to store first-level subfolder name
      if (!existingColumns.includes('subfolder')) {
        db.exec('ALTER TABLE drive_images ADD COLUMN subfolder TEXT');
      }

      console.log('✓ Migration add_subfolder_column completed');
    }
  },
  {
    id: 6,
    name: 'create_image_project_assignments_table',
    up: () => {
      console.log('Running migration: create_image_project_assignments_table');

      // Create table for image-project assignments
      db.exec(`
        CREATE TABLE IF NOT EXISTS image_project_assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          image_id INTEGER NOT NULL,
          project_id INTEGER NOT NULL,
          assigned_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (image_id) REFERENCES drive_images (id) ON DELETE CASCADE,
          FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
          UNIQUE (image_id, project_id)
        )
      `);

      // Create index for faster lookups
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_image_project_image_id
        ON image_project_assignments(image_id)
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_image_project_project_id
        ON image_project_assignments(project_id)
      `);

      console.log('✓ Migration create_image_project_assignments_table completed');
    }
  },
  {
    id: 7,
    name: 'add_favicon_path_column',
    up: () => {
      console.log('Running migration: add_favicon_path_column');

      const tableInfo = db.pragma('table_info(settings)');
      const existingColumns = tableInfo.map(col => col.name);

      // Add favicon_path column to settings table
      if (!existingColumns.includes('favicon_path')) {
        db.exec('ALTER TABLE settings ADD COLUMN favicon_path TEXT');
      }

      console.log('✓ Migration add_favicon_path_column completed');
    }
  },
  {
    id: 8,
    name: 'add_company_branding_columns',
    up: () => {
      console.log('Running migration: add_company_branding_columns');

      const tableInfo = db.pragma('table_info(settings)');
      const existingColumns = tableInfo.map(col => col.name);

      // Add company_name column
      if (!existingColumns.includes('company_name')) {
        db.exec('ALTER TABLE settings ADD COLUMN company_name TEXT DEFAULT \'Fuchs Metallbau\'');
      }

      // Add primary_color column
      if (!existingColumns.includes('primary_color')) {
        db.exec('ALTER TABLE settings ADD COLUMN primary_color TEXT DEFAULT \'#3b82f6\'');
      }

      console.log('✓ Migration add_company_branding_columns completed');
    }
  },
  {
    id: 9,
    name: 'create_image_annotations_table',
    up: () => {
      console.log('Running migration: create_image_annotations_table');

      // Create table for image annotations (drawings, measurements, etc.)
      db.exec(`
        CREATE TABLE IF NOT EXISTS image_annotations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          image_id INTEGER NOT NULL,
          annotations TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (image_id) REFERENCES drive_images (id) ON DELETE CASCADE
        )
      `);

      // Create index for faster lookups
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_image_annotations_image_id
        ON image_annotations(image_id)
      `);

      console.log('✓ Migration create_image_annotations_table completed');
    }
  },
  {
    id: 10,
    name: 'create_color_presets_table',
    up: () => {
      console.log('Running migration: create_color_presets_table');

      // Create table for saved color presets in image editor
      db.exec(`
        CREATE TABLE IF NOT EXISTS color_presets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          color TEXT NOT NULL,
          position INTEGER NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      console.log('✓ Migration create_color_presets_table completed');
    }
  },
  {
    id: 11,
    name: 'add_images_filter_sort_preferences',
    up: () => {
      console.log('Running migration: add_images_filter_sort_preferences');

      const tableInfo = db.pragma('table_info(settings)');
      const existingColumns = tableInfo.map(col => col.name);

      // Add filter/sort preferences for Bilder page
      if (!existingColumns.includes('images_sort_by')) {
        db.exec("ALTER TABLE settings ADD COLUMN images_sort_by TEXT DEFAULT 'created_at'");
      }
      if (!existingColumns.includes('images_sort_order')) {
        db.exec("ALTER TABLE settings ADD COLUMN images_sort_order TEXT DEFAULT 'desc'");
      }
      if (!existingColumns.includes('images_view_mode')) {
        db.exec("ALTER TABLE settings ADD COLUMN images_view_mode TEXT DEFAULT 'grid'");
      }
      if (!existingColumns.includes('images_show_only_unassigned')) {
        db.exec("ALTER TABLE settings ADD COLUMN images_show_only_unassigned INTEGER DEFAULT 1");
      }
      if (!existingColumns.includes('images_show_all')) {
        db.exec("ALTER TABLE settings ADD COLUMN images_show_all INTEGER DEFAULT 0");
      }
      if (!existingColumns.includes('images_show_only_with_projects')) {
        db.exec("ALTER TABLE settings ADD COLUMN images_show_only_with_projects INTEGER DEFAULT 0");
      }

      console.log('✓ Migration add_images_filter_sort_preferences completed');
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
