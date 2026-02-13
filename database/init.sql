-- Fuchs Metallbau Database Schema (SQLite)

-- Settings Table
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    logo_path TEXT,
    theme TEXT DEFAULT 'dark',
    sidebar_collapsed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Insert default settings if not exists
INSERT OR IGNORE INTO settings (id, logo_path, theme, sidebar_collapsed)
VALUES (1, NULL, 'dark', 0);

-- Drive Paths Table (Google Drive or other cloud storage paths)
CREATE TABLE IF NOT EXISTS drive_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    type TEXT DEFAULT 'google_drive',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Drive Images Table
CREATE TABLE IF NOT EXISTS drive_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_path_id INTEGER REFERENCES drive_paths(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    thumbnail_url TEXT,
    file_size INTEGER,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Create indexes for faster image queries
CREATE INDEX IF NOT EXISTS idx_drive_images_name ON drive_images(name);
CREATE INDEX IF NOT EXISTS idx_drive_images_created_at ON drive_images(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drive_images_drive_path_id ON drive_images(drive_path_id);

-- Project Settings Table
CREATE TABLE IF NOT EXISTS project_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_path TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Insert default project settings if not exists
INSERT OR IGNORE INTO project_settings (id, project_path)
VALUES (1, NULL);

-- Projects Table
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#3b82f6',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Create indexes for faster project queries
CREATE INDEX IF NOT EXISTS idx_projects_folder_name ON projects(folder_name);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);

-- Triggers to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_settings_updated_at
AFTER UPDATE ON settings
BEGIN
    UPDATE settings SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_drive_paths_updated_at
AFTER UPDATE ON drive_paths
BEGIN
    UPDATE drive_paths SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_drive_images_updated_at
AFTER UPDATE ON drive_images
BEGIN
    UPDATE drive_images SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_project_settings_updated_at
AFTER UPDATE ON project_settings
BEGIN
    UPDATE project_settings SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_projects_updated_at
AFTER UPDATE ON projects
BEGIN
    UPDATE projects SET updated_at = datetime('now') WHERE id = NEW.id;
END;
