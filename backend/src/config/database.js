const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');

// Ensure database directory exists
const dbDir = path.join(__dirname, '../../../database');
fs.ensureDirSync(dbDir);

const dbPath = path.join(dbDir, 'fuchs_metallbau.db');

// Create database connection
const db = new Database(dbPath, {
  verbose: process.env.NODE_ENV === 'development' ? console.log : null
});

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

console.log(`📦 SQLite database connected: ${dbPath}`);

module.exports = db;
