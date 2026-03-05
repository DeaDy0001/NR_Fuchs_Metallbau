const db = require('../config/database');

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

/**
 * Validates session cookie and attaches req.appUser.
 * Returns 401 if no valid session, 403 if account not active.
 */
const sessionAuth = (req, res, next) => {
  const cookies = parseCookies(req);
  const token = cookies['fm_session'];

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
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
      return res.status(401).json({ error: 'Session abgelaufen oder ungültig' });
    }

    if (session.status !== 'active') {
      return res.status(403).json({ error: 'Account nicht aktiv', status: session.status });
    }

    req.appUser = {
      id: session.id,
      email: session.email,
      name: session.name,
      picture: session.picture,
      status: session.status,
      role_id: session.role_id,
      role_name: session.role_name,
      permissions: session.role_permissions ? JSON.parse(session.role_permissions) : {}
    };

    next();
  } catch (error) {
    console.error('Session auth error:', error);
    return res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

module.exports = sessionAuth;
