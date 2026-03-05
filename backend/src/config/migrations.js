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
  },
  {
    id: 12,
    name: 'add_github_token_column',
    up: () => {
      console.log('Running migration: add_github_token_column');

      const tableInfo = db.pragma('table_info(settings)');
      const existingColumns = tableInfo.map(col => col.name);

      // Add github_token column for storing GitHub Personal Access Token
      if (!existingColumns.includes('github_token')) {
        db.exec('ALTER TABLE settings ADD COLUMN github_token TEXT');
      }

      console.log('✓ Migration add_github_token_column completed');
    }
  },
  {
    id: 13,
    name: 'create_tags_tables',
    up: () => {
      console.log('Running migration: create_tags_tables');

      // Create tags table
      db.exec(`
        CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          color TEXT NOT NULL DEFAULT '#3b82f6',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      // Create image_tags junction table
      db.exec(`
        CREATE TABLE IF NOT EXISTS image_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          image_id INTEGER NOT NULL,
          tag_id INTEGER NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (image_id) REFERENCES drive_images (id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE,
          UNIQUE (image_id, tag_id)
        )
      `);

      // Create indexes for faster lookups
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_image_tags_image_id ON image_tags(image_id)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_image_tags_tag_id ON image_tags(tag_id)
      `);

      console.log('✓ Migration create_tags_tables completed');
    }
  },
  {
    id: 14,
    name: 'add_images_pagination_limit',
    up: () => {
      console.log('Running migration: add_images_pagination_limit');

      const tableInfo = db.pragma('table_info(settings)');
      const existingColumns = tableInfo.map(col => col.name);

      // Add pagination limit preference
      if (!existingColumns.includes('images_pagination_limit')) {
        db.exec("ALTER TABLE settings ADD COLUMN images_pagination_limit INTEGER DEFAULT 50");
      }

      console.log('✓ Migration add_images_pagination_limit completed');
    }
  },
  {
    id: 15,
    name: 'add_project_sync_settings',
    up: () => {
      console.log('Running migration: add_project_sync_settings');

      const tableInfo = db.pragma('table_info(project_settings)');
      const existingColumns = tableInfo.map(col => col.name);

      // Add auto sync settings for projects
      if (!existingColumns.includes('auto_sync_enabled')) {
        db.exec('ALTER TABLE project_settings ADD COLUMN auto_sync_enabled INTEGER DEFAULT 1');
      }
      if (!existingColumns.includes('sync_interval')) {
        db.exec('ALTER TABLE project_settings ADD COLUMN sync_interval INTEGER DEFAULT 30');
      }
      if (!existingColumns.includes('last_sync')) {
        db.exec('ALTER TABLE project_settings ADD COLUMN last_sync TEXT');
      }

      console.log('✓ Migration add_project_sync_settings completed');
    }
  },
  {
    id: 16,
    name: 'add_project_tags_column',
    up: () => {
      console.log('Running migration: add_project_tags_column');

      const tableInfo = db.pragma('table_info(projects)');
      const existingColumns = tableInfo.map(col => col.name);

      // Add tags column to store JSON array of project tags
      if (!existingColumns.includes('tags')) {
        db.exec('ALTER TABLE projects ADD COLUMN tags TEXT DEFAULT \'[]\'');
      }

      console.log('✓ Migration add_project_tags_column completed');
    }
  },
  {
    id: 17,
    name: 'create_mobile_tables',
    up: () => {
      console.log('Running migration: create_mobile_tables');

      // Mobile devices table - registered app instances
      db.exec(`
        CREATE TABLE IF NOT EXISTS mobile_devices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT UNIQUE NOT NULL,
          device_name TEXT,
          user_name TEXT NOT NULL,
          auth_token TEXT UNIQUE NOT NULL,
          last_seen TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      // Mobile uploads - images uploaded from app (inbox)
      db.exec(`
        CREATE TABLE IF NOT EXISTS mobile_uploads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT NOT NULL,
          user_name TEXT NOT NULL,
          file_name TEXT NOT NULL,
          original_name TEXT NOT NULL,
          local_path TEXT NOT NULL,
          thumbnail_path TEXT,
          file_size INTEGER,
          mime_type TEXT,
          project_id INTEGER,
          project_name TEXT,
          status TEXT DEFAULT 'pending',
          uploaded_at TEXT DEFAULT (datetime('now')),
          processed_at TEXT,
          FOREIGN KEY (device_id) REFERENCES mobile_devices(device_id) ON DELETE CASCADE
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_mobile_uploads_device ON mobile_uploads(device_id)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_mobile_uploads_status ON mobile_uploads(status)
      `);

      // Pending tokens for QR code connection flow
      db.exec(`
        CREATE TABLE IF NOT EXISTS mobile_pending_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token TEXT UNIQUE NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      console.log('✓ Migration create_mobile_tables completed');
    }
  },
  {
    id: 18,
    name: 'add_mobile_server_url_setting',
    up: () => {
      console.log('Running migration: add_mobile_server_url_setting');

      const tableInfo = db.pragma('table_info(settings)');
      const existingColumns = tableInfo.map(col => col.name);

      if (!existingColumns.includes('mobile_server_url')) {
        db.exec("ALTER TABLE settings ADD COLUMN mobile_server_url TEXT");
      }

      console.log('✓ Migration add_mobile_server_url_setting completed');
    }
  },
  {
    id: 19,
    name: 'add_pending_token_server_url',
    up: () => {
      console.log('Running migration: add_pending_token_server_url');

      const tableInfo = db.pragma('table_info(mobile_pending_tokens)');
      const existingColumns = tableInfo.map(col => col.name);

      if (!existingColumns.includes('server_url')) {
        db.exec("ALTER TABLE mobile_pending_tokens ADD COLUMN server_url TEXT");
      }

      console.log('✓ Migration add_pending_token_server_url completed');
    }
  },
  {
    id: 20,
    name: 'create_pending_mobile_projects',
    up: () => {
      console.log('Running migration: create_pending_mobile_projects');

      db.exec(`
        CREATE TABLE IF NOT EXISTS pending_mobile_projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          drive_folder_id TEXT NOT NULL UNIQUE,
          folder_name TEXT NOT NULL,
          image_count INTEGER DEFAULT 0,
          status TEXT DEFAULT 'pending',
          scanned_at TEXT DEFAULT (datetime('now')),
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      console.log('✓ Migration create_pending_mobile_projects completed');
    }
  },
  {
    id: 21,
    name: 'add_image_gps_and_notes_columns',
    up: () => {
      console.log('Running migration: add_image_gps_and_notes_columns');

      const tableInfo = db.pragma('table_info(drive_images)');
      const existingColumns = tableInfo.map(col => col.name);

      if (!existingColumns.includes('gps_latitude')) {
        db.exec("ALTER TABLE drive_images ADD COLUMN gps_latitude REAL");
      }
      if (!existingColumns.includes('gps_longitude')) {
        db.exec("ALTER TABLE drive_images ADD COLUMN gps_longitude REAL");
      }
      if (!existingColumns.includes('gps_altitude')) {
        db.exec("ALTER TABLE drive_images ADD COLUMN gps_altitude REAL");
      }
      if (!existingColumns.includes('image_notes')) {
        db.exec("ALTER TABLE drive_images ADD COLUMN image_notes TEXT");
      }

      console.log('✓ Migration add_image_gps_and_notes_columns completed');
    }
  },
  {
    id: 22,
    name: 'create_pending_image_metadata_table',
    up: () => {
      console.log('Running migration: create_pending_image_metadata_table');

      db.exec(`
        CREATE TABLE IF NOT EXISTS pending_image_metadata (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lookup_key TEXT NOT NULL UNIQUE,
          file_name TEXT,
          drive_file_id TEXT,
          gps_latitude REAL,
          gps_longitude REAL,
          gps_altitude REAL,
          custom_title TEXT,
          notes TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      console.log('✓ Migration create_pending_image_metadata_table completed');
    }
  },
  {
    id: 23,
    name: 'add_year_fields',
    up: () => {
      console.log('Running migration: add_year_fields');

      const projectsCols = db.pragma('table_info(projects)').map(col => col.name);
      if (!projectsCols.includes('year')) {
        db.exec('ALTER TABLE projects ADD COLUMN year INTEGER');
      }
      if (!projectsCols.includes('local_base_path')) {
        db.exec('ALTER TABLE projects ADD COLUMN local_base_path TEXT');
      }

      const settingsCols = db.pragma('table_info(project_settings)').map(col => col.name);
      if (!settingsCols.includes('year_detection_mode')) {
        db.exec("ALTER TABLE project_settings ADD COLUMN year_detection_mode TEXT DEFAULT 'flat'");
      }
      if (!settingsCols.includes('excluded_folders')) {
        db.exec("ALTER TABLE project_settings ADD COLUMN excluded_folders TEXT DEFAULT '[]'");
      }

      console.log('✓ Migration add_year_fields completed');
    }
  },
  {
    id: 25,
    name: 'create_inbox_activities_table',
    up: () => {
      console.log('Running migration: create_inbox_activities_table');

      db.exec(`
        CREATE TABLE IF NOT EXISTS inbox_activities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT DEFAULT (datetime('now')),
          type TEXT NOT NULL,
          device_name TEXT,
          title TEXT NOT NULL,
          description TEXT,
          source_id TEXT,
          is_new INTEGER DEFAULT 1
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_inbox_activities_created_at
        ON inbox_activities(created_at)
      `);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_activities_source_id
        ON inbox_activities(source_id) WHERE source_id IS NOT NULL
      `);

      console.log('✓ Migration create_inbox_activities_table completed');
    }
  },
  {
    id: 24,
    name: 'create_mobile_users_table',
    up: () => {
      console.log('Running migration: create_mobile_users_table');

      db.exec(`
        CREATE TABLE IF NOT EXISTS mobile_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          google_email TEXT NOT NULL UNIQUE,
          google_name TEXT,
          google_id TEXT,
          drive_path_id INTEGER,
          drive_permission_id TEXT,
          added_at TEXT DEFAULT (datetime('now'))
        )
      `);

      console.log('✓ Migration create_mobile_users_table completed');
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
