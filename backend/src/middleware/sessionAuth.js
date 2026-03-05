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

  console.log(`[Auth] ${req.method} ${req.path} | cookie=${token ? token.slice(0, 8) + '...' : 'NONE'}`);

  if (!token) {
    console.log(`[Auth] 401 No token for ${req.path}`);
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const session = db.prepare(`
      SELECT u.id, u.email, u.name, u.picture, u.status, u.role_id,
             r.name as role_name, r.permissions as role_permissions, r.is_system as role_is_system
      FROM app_sessions s
      JOIN app_users u ON s.user_id = u.id
      LEFT JOIN app_roles r ON u.role_id = r.id
      WHERE s.session_token = ? AND s.expires_at > datetime('now')
    `).get(token);

    if (!session) {
      console.log(`[Auth] 401 Session not found / expired for token ${token.slice(0, 8)}...`);
      return res.status(401).json({ error: 'Session abgelaufen oder ungültig' });
    }

    if (session.status !== 'active') {
      console.log(`[Auth] 403 User ${session.email} is not active (status=${session.status})`);
      return res.status(403).json({ error: 'Account nicht aktiv', status: session.status });
    }

    console.log(`[Auth] OK user=${session.email} role=${session.role_name || 'none'}`);

    req.appUser = {
      id: session.id,
      email: session.email,
      name: session.name,
      picture: session.picture,
      status: session.status,
      role_id: session.role_id,
      role_name: session.role_name,
      is_admin: session.role_is_system === 1,
      permissions: session.role_permissions ? JSON.parse(session.role_permissions) : {}
    };

    next();
  } catch (error) {
    console.error('[Auth] Session auth error:', error);
    return res.status(500).json({ error: 'Interner Serverfehler' });
  }
};

module.exports = sessionAuth;
