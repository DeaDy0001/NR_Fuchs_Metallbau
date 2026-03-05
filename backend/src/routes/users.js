const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/database');
const sessionAuth = require('../middleware/sessionAuth');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// All routes require active session
router.use(sessionAuth);

// GET /api/users — List all users
router.get('/', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT u.id, u.email, u.name, u.picture, u.status, u.created_at, u.last_login,
             u.role_id, r.name as role_name
      FROM app_users u
      LEFT JOIN app_roles r ON u.role_id = r.id
      ORDER BY u.created_at DESC
    `).all();

    res.json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/users — Create a new user (admin only)
router.post('/', (req, res) => {
  if (!req.appUser.permissions.access_settings) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }

  const { email, password, name, role_id } = req.body;

  if (!email || !email.trim()) return res.status(400).json({ error: 'E-Mail ist erforderlich' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });

  const normalizedEmail = email.trim().toLowerCase();
  const displayName = (name && name.trim()) ? name.trim() : normalizedEmail.split('@')[0];

  try {
    const result = db.prepare(`
      INSERT INTO app_users (email, name, password_hash, role_id, status)
      VALUES (?, ?, ?, ?, 'active')
    `).run(normalizedEmail, displayName, hashPassword(password), role_id || null);

    const user = db.prepare('SELECT u.id, u.email, u.name, u.status, u.created_at, u.role_id, r.name as role_name FROM app_users u LEFT JOIN app_roles r ON u.role_id = r.id WHERE u.id = ?').get(result.lastInsertRowid);
    res.json({ user });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ein Benutzer mit dieser E-Mail-Adresse existiert bereits' });
    }
    console.error('Error creating user:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users/pending — Pending users waiting for approval
router.get('/pending', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, email, name, picture, status, created_at
      FROM app_users
      WHERE status = 'pending'
      ORDER BY created_at ASC
    `).all();

    res.json({ users });
  } catch (error) {
    console.error('Error fetching pending users:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/users/:id/approve — Approve a pending user
router.post('/:id/approve', (req, res) => {
  if (!req.appUser.permissions.approve_users) {
    return res.status(403).json({ error: 'Keine Berechtigung zum Freischalten von Benutzern' });
  }

  const { role_id } = req.body;
  const userId = parseInt(req.params.id);

  if (!role_id) {
    return res.status(400).json({ error: 'Rolle ist erforderlich' });
  }

  try {
    const user = db.prepare('SELECT * FROM app_users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

    db.prepare(`
      UPDATE app_users SET status = 'active', role_id = ? WHERE id = ?
    `).run(role_id, userId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error approving user:', error);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/users/:id — Update user status or role
router.patch('/:id', (req, res) => {
  if (!req.appUser.permissions.access_settings) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }

  const userId = parseInt(req.params.id);
  const { status, role_id } = req.body;

  // Prevent deactivating yourself
  if (status === 'inactive' && userId === req.appUser.id) {
    return res.status(400).json({ error: 'Du kannst deinen eigenen Account nicht deaktivieren' });
  }

  // Prevent changing own role
  if (role_id !== undefined && userId === req.appUser.id) {
    return res.status(400).json({ error: 'Du kannst deine eigene Rolle nicht ändern' });
  }

  try {
    const user = db.prepare('SELECT * FROM app_users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

    const updates = [];
    const params = [];

    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }
    if (role_id !== undefined) {
      updates.push('role_id = ?');
      params.push(role_id);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Keine Änderungen angegeben' });
    }

    params.push(userId);
    db.prepare(`UPDATE app_users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // If deactivating: delete all sessions
    if (status === 'inactive') {
      db.prepare('DELETE FROM app_sessions WHERE user_id = ?').run(userId);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
