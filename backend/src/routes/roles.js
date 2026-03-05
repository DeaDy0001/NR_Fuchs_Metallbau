const express = require('express');
const router = express.Router();
const db = require('../config/database');
const sessionAuth = require('../middleware/sessionAuth');

router.use(sessionAuth);

// GET /api/roles — List all roles
router.get('/', (req, res) => {
  try {
    const roles = db.prepare('SELECT * FROM app_roles ORDER BY is_system DESC, name ASC').all();
    res.json({
      roles: roles.map(r => ({
        ...r,
        permissions: typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions
      }))
    });
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/roles — Create new role
router.post('/', (req, res) => {
  if (!req.appUser.permissions.access_settings) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }

  const { name, permissions } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name ist erforderlich' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO app_roles (name, permissions, is_system)
      VALUES (?, ?, 0)
    `).run(name.trim(), JSON.stringify(permissions || {}));

    const role = db.prepare('SELECT * FROM app_roles WHERE id = ?').get(result.lastInsertRowid);
    res.json({
      ...role,
      permissions: JSON.parse(role.permissions)
    });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Eine Rolle mit diesem Namen existiert bereits' });
    }
    console.error('Error creating role:', error);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/roles/:id — Update role
router.patch('/:id', (req, res) => {
  if (!req.appUser.permissions.access_settings) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }

  const roleId = parseInt(req.params.id);
  const { name, permissions } = req.body;

  try {
    const role = db.prepare('SELECT * FROM app_roles WHERE id = ?').get(roleId);
    if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });

    const updates = [];
    const params = [];

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'Name darf nicht leer sein' });
      updates.push('name = ?');
      params.push(name.trim());
    }
    if (permissions !== undefined) {
      updates.push('permissions = ?');
      params.push(JSON.stringify(permissions));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Keine Änderungen angegeben' });
    }

    params.push(roleId);
    db.prepare(`UPDATE app_roles SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    res.json({ success: true });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Eine Rolle mit diesem Namen existiert bereits' });
    }
    console.error('Error updating role:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/roles/:id — Delete role (not system roles)
router.delete('/:id', (req, res) => {
  if (!req.appUser.permissions.access_settings) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }

  const roleId = parseInt(req.params.id);

  try {
    const role = db.prepare('SELECT * FROM app_roles WHERE id = ?').get(roleId);
    if (!role) return res.status(404).json({ error: 'Rolle nicht gefunden' });
    if (role.is_system) return res.status(400).json({ error: 'System-Rollen können nicht gelöscht werden' });

    // Unassign users from this role before deleting
    db.prepare('UPDATE app_users SET role_id = NULL WHERE role_id = ?').run(roleId);
    db.prepare('DELETE FROM app_roles WHERE id = ?').run(roleId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
