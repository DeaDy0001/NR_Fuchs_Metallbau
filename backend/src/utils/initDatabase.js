const pool = require('../config/database');
const fs = require('fs');
const path = require('path');

const initDatabase = async () => {
  try {
    console.log('Initializing database...');

    const sqlPath = path.join(__dirname, '../../../database/init.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await pool.query(sql);

    console.log('✓ Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

// Run if called directly
if (require.main === module) {
  initDatabase()
    .then(() => {
      console.log('Database setup complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Database setup failed:', error);
      process.exit(1);
    });
}

module.exports = initDatabase;
