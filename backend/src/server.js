require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/drive', require('./routes/drive'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/annotations', require('./routes/annotations'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../frontend/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Initialize upload directories
const initDirectories = async () => {
  const dirs = [
    path.join(__dirname, '../../uploads'),
    path.join(__dirname, '../../uploads/thumbnails'),
    path.join(__dirname, '../../uploads/logos'),
    path.join(__dirname, '../../uploads/drive')
  ];

  for (const dir of dirs) {
    await fs.ensureDir(dir);
  }
};

// Start server
const startServer = async () => {
  try {
    await initDirectories();

    // Run database migrations
    const { runMigrations } = require('./config/migrations');
    runMigrations();

    // Initialize OAuth authentication
    const { initializeAuth } = require('./services/authService');
    await initializeAuth();

    // Initialize auto-sync for Google Drive
    const { initializeAutoSync } = require('./services/driveSyncService');
    initializeAutoSync();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔═══════════════════════════════════════════╗
║   Fuchs Metallbau Server                  ║
╠═══════════════════════════════════════════╣
║   Status: Running                         ║
║   Port: ${PORT}                           ║
║   URL: http://localhost:${PORT}           ║
║   Drive Auto-Sync: Active                 ║
╚═══════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});
