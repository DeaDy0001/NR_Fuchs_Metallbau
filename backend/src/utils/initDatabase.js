const db = require('../config/database');
const fs = require('fs');
const path = require('path');

const initDatabase = () => {
  try {
    console.log('Initializing database...');

    const sqlPath = path.join(__dirname, '../../../database/init.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Execute SQL statements
    db.exec(sql);

    console.log('✓ Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

// Run if called directly
if (require.main === module) {
  try {
    initDatabase();
    console.log('Database setup complete');
    process.exit(0);
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exit(1);
  }
}

module.exports = initDatabase;
