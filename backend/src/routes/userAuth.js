const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { google } = require('googleapis');
const db = require('../config/database');

const SESSION_DURATION_DAYS = 30;

function createUserOAuth2Client(req) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const redirectUri = `${protocol}://${host}/api/auth/user/google/callback`;

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function setSessionCookie(res, token) {
  const maxAge = SESSION_DURATION_DAYS * 24 * 60 * 60; // seconds
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

// GET /api/auth/user/me — Check current session (public)
router.get('/me', (req, res) => {
  // Check if any users exist (setup mode)
  const userCount = db.prepare('SELECT COUNT(*) as count FROM app_users').get();
  if (userCount.count === 0) {
    // Check if credentials are configured
    const hasCredentials = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    return res.json({ setupRequired: true, credentialsConfigured: hasCredentials });
  }

  const cookies = parseCookies(req);
  const token = cookies['fm_session'];

  if (!token) {
    return res.json({ authenticated: false });
  }

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

// GET /api/auth/user/google — Start Google login
router.get('/google', (req, res) => {
  const client = createUserOAuth2Client(req);
  if (!client) {
    return res.status(500).json({ error: 'Google OAuth nicht konfiguriert. Bitte GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET in der .env Datei setzen.' });
  }

  const authUrl = client.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'profile', 'email'],
    prompt: 'select_account'
  });

  res.redirect(authUrl);
});

// GET /api/auth/user/google/callback — OAuth callback
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;

  const errorPage = (msg) => res.send(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>Login fehlgeschlagen</title>
    <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0f1117;color:#fff}
    .box{background:#1a1d2e;padding:40px;border-radius:12px;text-align:center;max-width:400px;border:1px solid #2a2d3e}
    h2{color:#ef4444;margin-bottom:16px}p{color:#94a3b8}</style></head>
    <body><div class="box"><h2>Login fehlgeschlagen</h2><p>${msg}</p></div></body></html>
  `);

  if (error) return errorPage('Anmeldung abgebrochen.');
  if (!code) return errorPage('Kein Autorisierungscode erhalten.');

  try {
    const client = createUserOAuth2Client(req);
    if (!client) return errorPage('OAuth nicht konfiguriert.');

    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data: profile } = await oauth2.userinfo.get();

    const { id: googleId, email, name, picture } = profile;

    // Check if any users exist
    const userCount = db.prepare('SELECT COUNT(*) as count FROM app_users').get();
    const isFirstUser = userCount.count === 0;

    let user = db.prepare('SELECT * FROM app_users WHERE google_id = ?').get(googleId);

    if (!user) {
      // New user
      let roleId = null;
      let status = 'pending';

      if (isFirstUser) {
        // First user: get Admin role and set as active
        const adminRole = db.prepare("SELECT id FROM app_roles WHERE is_system = 1 LIMIT 1").get();
        roleId = adminRole ? adminRole.id : null;
        status = 'active';
      }

      const result = db.prepare(`
        INSERT INTO app_users (google_id, email, name, picture, role_id, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(googleId, email, name || email, picture, roleId, status);

      user = db.prepare('SELECT * FROM app_users WHERE id = ?').get(result.lastInsertRowid);
    } else {
      // Update profile info
      db.prepare(`
        UPDATE app_users SET name = ?, picture = ?, last_login = datetime('now') WHERE id = ?
      `).run(name || email, picture, user.id);
      user = db.prepare('SELECT * FROM app_users WHERE id = ?').get(user.id);
    }

    // Create session (only for active users)
    if (user.status === 'active') {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000)
        .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

      db.prepare(`
        INSERT INTO app_sessions (user_id, session_token, expires_at)
        VALUES (?, ?, ?)
      `).run(user.id, sessionToken, expiresAt);

      setSessionCookie(res, sessionToken);
    }

    // Redirect to frontend
    res.redirect('/');
  } catch (err) {
    console.error('User OAuth callback error:', err);
    return res.send(`
      <!DOCTYPE html><html><head><meta charset="utf-8"><title>Login fehlgeschlagen</title>
      <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0f1117;color:#fff}
      .box{background:#1a1d2e;padding:40px;border-radius:12px;text-align:center;max-width:400px;border:1px solid #2a2d3e}
      h2{color:#ef4444;margin-bottom:16px}p{color:#94a3b8}</style></head>
      <body><div class="box"><h2>Login fehlgeschlagen</h2><p>${err.message}</p></div></body></html>
    `);
  }
});

// POST /api/auth/user/logout
router.post('/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies['fm_session'];

  if (token) {
    try {
      db.prepare('DELETE FROM app_sessions WHERE session_token = ?').run(token);
    } catch { /* ignore */ }
  }

  clearSessionCookie(res);
  res.json({ success: true });
});

module.exports = router;
