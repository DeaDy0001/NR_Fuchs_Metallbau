const express = require('express');
const router = express.Router();
const db = require('../config/database');

/**
 * POST /api/github/token
 * Save GitHub Personal Access Token
 */
router.post('/token', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token ist erforderlich' });
    }

    // Basic validation
    if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
      return res.status(400).json({
        error: 'Ungültiges Token-Format. Token sollte mit "ghp_" oder "github_pat_" beginnen'
      });
    }

    // Store token in database (encrypted would be better in production)
    const settingKey = 'github_token';

    // Check if setting exists
    const existingSetting = db.prepare('SELECT * FROM settings WHERE key = ?').get(settingKey);

    if (existingSetting) {
      // Update existing token
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(token, settingKey);
    } else {
      // Insert new token
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(settingKey, token);
    }

    // Also save to .env file for persistence
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '../../../.env');

    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    // Update or add GITHUB_TOKEN
    const envLines = envContent.split('\n');
    const tokenLineIndex = envLines.findIndex(line => line.startsWith('GITHUB_TOKEN='));

    if (tokenLineIndex !== -1) {
      envLines[tokenLineIndex] = `GITHUB_TOKEN=${token}`;
    } else {
      envLines.push(`GITHUB_TOKEN=${token}`);
    }

    fs.writeFileSync(envPath, envLines.join('\n'));

    res.json({
      success: true,
      message: 'GitHub Token erfolgreich gespeichert'
    });
  } catch (error) {
    console.error('Error saving GitHub token:', error);
    res.status(500).json({ error: 'Fehler beim Speichern des Tokens' });
  }
});

/**
 * GET /api/github/token/status
 * Check if GitHub token is configured
 */
router.get('/token/status', async (req, res) => {
  try {
    const settingKey = 'github_token';
    const setting = db.prepare('SELECT * FROM settings WHERE key = ?').get(settingKey);

    res.json({
      configured: !!setting && !!setting.value
    });
  } catch (error) {
    console.error('Error checking GitHub token status:', error);
    res.status(500).json({ error: 'Fehler beim Prüfen des Token-Status' });
  }
});

/**
 * DELETE /api/github/token
 * Remove GitHub token
 */
router.delete('/token', async (req, res) => {
  try {
    const settingKey = 'github_token';
    db.prepare('DELETE FROM settings WHERE key = ?').run(settingKey);

    // Also remove from .env file
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '../../../.env');

    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf8');
      const envLines = envContent.split('\n').filter(line => !line.startsWith('GITHUB_TOKEN='));
      fs.writeFileSync(envPath, envLines.join('\n'));
    }

    res.json({
      success: true,
      message: 'GitHub Token wurde entfernt'
    });
  } catch (error) {
    console.error('Error removing GitHub token:', error);
    res.status(500).json({ error: 'Fehler beim Entfernen des Tokens' });
  }
});

module.exports = router;
