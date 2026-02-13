-- Fuchs Metallbau Database Schema

-- Settings Table
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    logo_path VARCHAR(500),
    theme VARCHAR(20) DEFAULT 'dark',
    sidebar_collapsed BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT INTO settings (logo_path, theme, sidebar_collapsed)
VALUES (NULL, 'dark', false)
ON CONFLICT (id) DO NOTHING;

-- Drive Paths Table (Google Drive or other cloud storage paths)
CREATE TABLE IF NOT EXISTS drive_paths (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    path TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'google_drive',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Drive Images Table
CREATE TABLE IF NOT EXISTS drive_images (
    id SERIAL PRIMARY KEY,
    drive_path_id INTEGER REFERENCES drive_paths(id) ON DELETE CASCADE,
    name VARCHAR(500) NOT NULL,
    original_name VARCHAR(500) NOT NULL,
    file_url TEXT NOT NULL,
    thumbnail_url TEXT,
    file_size BIGINT,
    mime_type VARCHAR(100),
    width INTEGER,
    height INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster image queries
CREATE INDEX IF NOT EXISTS idx_drive_images_name ON drive_images(name);
CREATE INDEX IF NOT EXISTS idx_drive_images_created_at ON drive_images(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drive_images_drive_path_id ON drive_images(drive_path_id);

-- Project Settings Table
CREATE TABLE IF NOT EXISTS project_settings (
    id SERIAL PRIMARY KEY,
    project_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default project settings
INSERT INTO project_settings (project_path)
VALUES (NULL)
ON CONFLICT (id) DO NOTHING;

-- Projects Table
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    folder_name VARCHAR(500) NOT NULL UNIQUE,
    color VARCHAR(20) DEFAULT '#3b82f6',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster project queries
CREATE INDEX IF NOT EXISTS idx_projects_folder_name ON projects(folder_name);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all tables
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_drive_paths_updated_at BEFORE UPDATE ON drive_paths
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_drive_images_updated_at BEFORE UPDATE ON drive_images
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_settings_updated_at BEFORE UPDATE ON project_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
