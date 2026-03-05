const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/database');

const SESSION_DURATION_DAYS = 30;

// ─── Password helpers ──────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const hashVerify = crypto.scryptSync(password, salt, 64).toString('hex');
    return hash === hashVerify;
  } catch {
    return false;
  }
}

// ─── Cookie helpers ────────────────────────────────────────────────────────────
function setSessionCookie(res, token) {
  const maxAge = SESSION_DURATION_DAYS * 24 * 60 * 60;
  res.setHeader('Set-Cookie', `fm_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'fm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (header) {
    header.split(';').forEach(cookie => {
      const parts = cookie.trim().split('=');
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      try { cookies[key] = decodeURIComponent(value); } catch { cookies[key] = value; }
    });
  }
  return cookies;
}

function createSession(userId, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  db.prepare('INSERT INTO app_sessions (user_id, session_token, expires_at) VALUES (?, ?, ?)').run(userId, token, expiresAt);
  setSessionCookie(res, token);
}

// ─── GET /api/auth/user/me ─────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  // Setup mode: no users at all
  const userCount = db.prepare('SELECT COUNT(*) as count FROM app_users').get();
  if (userCount.count === 0) {
    return res.json({ setupRequired: true });
  }

  const cookies = parseCookies(req);
  const token = cookies['fm_session'];
  if (!token) return res.json({ authenticated: false });

  try {
    const session = db.prepare(`
      SELECT u.id, u.email, u.name, u.picture, u.status, u.role_id,
             r.name as role_name, r.permissions as role_permissions
      FROM app_sessions s
      JOIN app_users u ON s.user_id = u.id
      LEFT JOIN app_roles r ON u.role_id = r.id
      WHERE s.session_token = ? AND s.expires_at > datetime('now')
    `).get(token);

    if (!session) {
      clearSessionCookie(res);
      return res.json({ authenticated: false });
    }

    res.json({
      authenticated: true,
      user: {
        id: session.id,
        email: session.email,
        name: session.name,
        picture: session.picture,
        status: session.status,
        role_id: session.role_id,
        role_name: session.role_name,
        permissions: session.role_permissions ? JSON.parse(session.role_permissions) : {}
      }
    });
  } catch (error) {
    console.error('Error checking session:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// ─── POST /api/auth/user/login ─────────────────────────────────────────────────
// Also handles first-time setup (creates admin when no users exist)
router.post('/login', (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !email.trim()) return res.status(400).json({ error: 'E-Mail ist erforderlich' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM app_users').get();
    const isSetup = userCount.count === 0;

    if (isSetup) {
      // First user: create admin
      const adminRole = db.prepare("SELECT id FROM app_roles WHERE is_system = 1 LIMIT 1").get();
      const displayName = (name && name.trim()) ? name.trim() : normalizedEmail.split('@')[0];
      const result = db.prepare(`
        INSERT INTO app_users (email, name, password_hash, role_id, status)
        VALUES (?, ?, ?, ?, 'active')
      `).run(normalizedEmail, displayName, hashPassword(password), adminRole?.id || null);

      createSession(result.lastInsertRowid, res);
      return res.json({ success: true });
    }

    // Normal login
    const user = db.prepare('SELECT * FROM app_users WHERE email = ?').get(normalizedEmail);

    if (!user) return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
    if (!user.password_hash) return res.status(401).json({ error: 'Konto hat kein Passwort. Bitte einen Administrator kontaktieren.' });
    if (!verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
    if (user.status === 'inactive') return res.status(403).json({ error: 'Dieses Konto wurde deaktiviert. Wende dich an einen Administrator.' });

    // Update last_login
    db.prepare("UPDATE app_users SET last_login = datetime('now') WHERE id = ?").run(user.id);

    createSession(user.id, res);
    res.json({ success: true });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// ─── POST /api/auth/user/logout ────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies['fm_session'];
  if (token) {
    try { db.prepare('DELETE FROM app_sessions WHERE session_token = ?').run(token); } catch { /* ignore */ }
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

module.exports = router;
