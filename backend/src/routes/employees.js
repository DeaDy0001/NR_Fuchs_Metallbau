const express = require('express');
const router = express.Router();
const db = require('../config/database');
const sessionAuth = require('../middleware/sessionAuth');

router.use(sessionAuth);

// ─── helpers ────────────────────────────────────────────────────────────────

function writeLog(employeeId, action, details, user) {
  db.prepare(`
    INSERT INTO employee_logs (employee_id, action, details, performed_by_user_id, performed_by_name)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    employeeId || null,
    action,
    JSON.stringify(details),
    user?.id || null,
    user?.name || user?.email || 'Unbekannt'
  );
}

function getConfig() {
  const rows = db.prepare('SELECT key, value FROM employee_settings').all();
  const cfg = {};
  for (const r of rows) cfg[r.key] = r.value;
  return cfg;
}

function calcAge(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  const dob = new Date(birthDate);
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

// ─── employees CRUD ─────────────────────────────────────────────────────────

// GET /api/employees
router.get('/', (req, res) => {
  try {
    const showArchived = req.query.archived === 'true';
    const employees = db.prepare(
      `SELECT * FROM employees WHERE archived = ? ORDER BY last_name ASC, first_name ASC`
    ).all(showArchived ? 1 : 0);
    res.json({ employees: employees.map(e => ({ ...e, age: calcAge(e.birth_date) })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/employees
router.post('/', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });

  const { first_name, last_name, email, phone, address, birth_date, notes, initial_balances } = req.body;
  if (!first_name?.trim() || !last_name?.trim()) {
    return res.status(400).json({ error: 'Vor- und Nachname sind erforderlich' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO employees (first_name, last_name, email, phone, address, birth_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      first_name.trim(), last_name.trim(),
      email || null, phone || null, address || null, birth_date || null, notes || null
    );
    const empId = result.lastInsertRowid;
    const year = new Date().getFullYear();

    // Set initial balances if provided
    if (initial_balances && typeof initial_balances === 'object') {
      const types = ['vacation', 'zeitausgleich', 'sonderurlaub', 'krankenstand'];
      for (const type of types) {
        const allocated = parseFloat(initial_balances[type]) || 0;
        db.prepare(`
          INSERT OR REPLACE INTO employee_balances (employee_id, year, type, allocated, used)
          VALUES (?, ?, ?, ?, 0)
        `).run(empId, year, type, allocated);
      }
    }

    writeLog(empId, 'create', {
      employee: `${first_name.trim()} ${last_name.trim()}`,
      initial_balances: initial_balances || {}
    }, req.appUser);

    const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(empId);
    res.json({ ...emp, age: calcAge(emp.birth_date) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/employees/:id
router.patch('/:id', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });

  const id = parseInt(req.params.id);
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  if (!emp) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });

  const fields = ['first_name', 'last_name', 'email', 'phone', 'address', 'birth_date', 'notes'];
  const updates = [];
  const vals = [];
  const changed = {};

  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      vals.push(req.body[f] || null);
      if (emp[f] !== req.body[f]) changed[f] = { from: emp[f], to: req.body[f] };
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Keine Änderungen' });

  updates.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE employees SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

  writeLog(id, 'update', { employee: `${emp.first_name} ${emp.last_name}`, changes: changed }, req.appUser);

  const updated = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  res.json({ ...updated, age: calcAge(updated.birth_date) });
});

// POST /api/employees/:id/archive
router.post('/:id/archive', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });

  const id = parseInt(req.params.id);
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  if (!emp) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });

  const newArchived = emp.archived ? 0 : 1;
  db.prepare("UPDATE employees SET archived = ?, updated_at = datetime('now') WHERE id = ?").run(newArchived, id);

  writeLog(id, newArchived ? 'archive' : 'unarchive', {
    employee: `${emp.first_name} ${emp.last_name}`
  }, req.appUser);

  res.json({ success: true, archived: !!newArchived });
});

// ─── balances ───────────────────────────────────────────────────────────────

// GET /api/employees/:id/balances
router.get('/:id/balances', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const rows = db.prepare(
      'SELECT * FROM employee_balances WHERE employee_id = ? AND year = ?'
    ).all(id, year);

    const types = ['vacation', 'zeitausgleich', 'sonderurlaub', 'krankenstand'];
    const result = {};
    for (const t of types) {
      const row = rows.find(r => r.type === t) || { allocated: 0, used: 0 };
      result[t] = { allocated: row.allocated, used: row.used, remaining: row.allocated - row.used };
    }
    res.json({ year, balances: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employees/:id/balances/all — all years
router.get('/:id/balances/all', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const rows = db.prepare(
      'SELECT * FROM employee_balances WHERE employee_id = ? ORDER BY year DESC'
    ).all(id);
    res.json({ balances: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/employees/:id/storno — correction of balance
router.post('/:id/storno', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });

  const id = parseInt(req.params.id);
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  if (!emp) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });

  const { type, field, amount, reason, year } = req.body;
  if (!type || !field || amount === undefined || !reason?.trim()) {
    return res.status(400).json({ error: 'Typ, Feld, Betrag und Begründung erforderlich' });
  }
  if (!['vacation', 'zeitausgleich', 'sonderurlaub', 'krankenstand'].includes(type)) {
    return res.status(400).json({ error: 'Ungültiger Typ' });
  }
  if (!['allocated', 'used'].includes(field)) {
    return res.status(400).json({ error: 'Feld muss "allocated" oder "used" sein' });
  }

  const targetYear = parseInt(year) || new Date().getFullYear();
  const existing = db.prepare(
    'SELECT * FROM employee_balances WHERE employee_id = ? AND year = ? AND type = ?'
  ).get(id, targetYear, type);

  if (!existing) {
    db.prepare(
      'INSERT INTO employee_balances (employee_id, year, type, allocated, used) VALUES (?, ?, ?, 0, 0)'
    ).run(id, targetYear, type);
  }

  const oldVal = existing ? existing[field] : 0;
  db.prepare(`UPDATE employee_balances SET ${field} = ?, updated_at = datetime('now') WHERE employee_id = ? AND year = ? AND type = ?`)
    .run(parseFloat(amount), id, targetYear, type);

  writeLog(id, 'storno', {
    employee: `${emp.first_name} ${emp.last_name}`,
    type, field, year: targetYear,
    old_value: oldVal, new_value: parseFloat(amount),
    reason: reason.trim()
  }, req.appUser);

  res.json({ success: true });
});

// ─── time entries ────────────────────────────────────────────────────────────

// GET /api/employees/entries (all entries, for calendar)
router.get('/entries', (req, res) => {
  try {
    const { start, end, employee_id } = req.query;
    let sql = `
      SELECT e.*, emp.first_name, emp.last_name
      FROM employee_time_entries e
      JOIN employees emp ON emp.id = e.employee_id
      WHERE e.is_storno = 0
    `;
    const params = [];
    if (start) { sql += ' AND e.end_date >= ?'; params.push(start); }
    if (end)   { sql += ' AND e.start_date <= ?'; params.push(end); }
    if (employee_id) { sql += ' AND e.employee_id = ?'; params.push(parseInt(employee_id)); }
    sql += ' ORDER BY e.start_date ASC';

    const entries = db.prepare(sql).all(...params);
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employees/:id/entries
router.get('/:id/entries', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;
    const total = db.prepare('SELECT COUNT(*) as n FROM employee_time_entries WHERE employee_id = ?').get(id).n;
    const entries = db.prepare(
      'SELECT * FROM employee_time_entries WHERE employee_id = ? ORDER BY start_date DESC LIMIT ? OFFSET ?'
    ).all(id, limit, offset);
    res.json({ entries, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/employees/entries (batch create)
router.post('/entries', (req, res) => {
  const { entries } = req.body; // array of entry objects
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries muss ein Array sein' });
  }

  try {
    const cfg = getConfig();
    const inserted = [];

    for (const entry of entries) {
      const { employee_id, type, start_date, end_date, amount, notes } = entry;
      if (!employee_id || !type || !start_date || !end_date || amount === undefined) {
        return res.status(400).json({ error: 'employee_id, type, start_date, end_date, amount erforderlich' });
      }

      const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(parseInt(employee_id));
      if (!emp) return res.status(404).json({ error: `Mitarbeiter ${employee_id} nicht gefunden` });

      const unit = cfg[`unit_${type}`] || 'days';

      const result = db.prepare(`
        INSERT INTO employee_time_entries (employee_id, type, start_date, end_date, amount, unit, notes, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        parseInt(employee_id), type, start_date, end_date,
        parseFloat(amount), unit, notes || null, req.appUser.id
      );

      // Update used balance for the year
      const year = new Date(start_date).getFullYear();
      db.prepare(`
        INSERT INTO employee_balances (employee_id, year, type, allocated, used)
        VALUES (?, ?, ?, 0, ?)
        ON CONFLICT(employee_id, year, type) DO UPDATE SET used = used + ?, updated_at = datetime('now')
      `).run(parseInt(employee_id), year, type, parseFloat(amount), parseFloat(amount));

      writeLog(parseInt(employee_id), 'time_entry', {
        employee: `${emp.first_name} ${emp.last_name}`,
        type, start_date, end_date, amount: parseFloat(amount), unit, notes: notes || null
      }, req.appUser);

      inserted.push(result.lastInsertRowid);
    }

    res.json({ success: true, ids: inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/employees/entries/:id — delete/storno single entry
router.delete('/entries/:id', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });

  const entryId = parseInt(req.params.id);
  const entry = db.prepare('SELECT * FROM employee_time_entries WHERE id = ?').get(entryId);
  if (!entry) return res.status(404).json({ error: 'Eintrag nicht gefunden' });

  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(entry.employee_id);
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'Begründung erforderlich' });

  // Mark as storno
  db.prepare('UPDATE employee_time_entries SET is_storno = 1, storno_reason = ? WHERE id = ?')
    .run(reason.trim(), entryId);

  // Reverse balance
  const year = new Date(entry.start_date).getFullYear();
  db.prepare(`
    UPDATE employee_balances SET used = MAX(0, used - ?), updated_at = datetime('now')
    WHERE employee_id = ? AND year = ? AND type = ?
  `).run(entry.amount, entry.employee_id, year, entry.type);

  writeLog(entry.employee_id, 'entry_storno', {
    employee: emp ? `${emp.first_name} ${emp.last_name}` : '?',
    entry_id: entryId, type: entry.type,
    start_date: entry.start_date, end_date: entry.end_date,
    amount: entry.amount, reason: reason.trim()
  }, req.appUser);

  res.json({ success: true });
});

// ─── logs ────────────────────────────────────────────────────────────────────

// GET /api/employees/logs (global, paginated)
router.get('/logs', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const empFilter = req.query.employee_id ? parseInt(req.query.employee_id) : null;

    let sql = 'SELECT l.*, e.first_name, e.last_name FROM employee_logs l LEFT JOIN employees e ON e.id = l.employee_id';
    const params = [];
    if (empFilter) { sql += ' WHERE l.employee_id = ?'; params.push(empFilter); }
    sql += ' ORDER BY l.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    let countSql = 'SELECT COUNT(*) as n FROM employee_logs';
    const countParams = [];
    if (empFilter) { countSql += ' WHERE employee_id = ?'; countParams.push(empFilter); }

    const total = db.prepare(countSql).get(...countParams).n;
    const logs = db.prepare(sql).all(...params).map(l => ({
      ...l,
      details: typeof l.details === 'string' ? JSON.parse(l.details) : l.details
    }));
    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employees/:id/logs (per employee, paginated)
router.get('/:id/logs', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;
    const total = db.prepare('SELECT COUNT(*) as n FROM employee_logs WHERE employee_id = ?').get(id).n;
    const logs = db.prepare(
      'SELECT * FROM employee_logs WHERE employee_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(id, limit, offset).map(l => ({
      ...l,
      details: typeof l.details === 'string' ? JSON.parse(l.details) : l.details
    }));
    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── module config ───────────────────────────────────────────────────────────

// GET /api/employees/config
router.get('/config', (req, res) => {
  try {
    res.json(getConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/employees/config
router.put('/config', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });
  try {
    const allowed = ['unit_vacation', 'unit_zeitausgleich', 'unit_sonderurlaub', 'unit_krankenstand'];
    const validUnits = ['days', 'halfdays', 'hours'];
    const upd = db.prepare("INSERT OR REPLACE INTO employee_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))");

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (!validUnits.includes(req.body[key])) return res.status(400).json({ error: `Ungültige Einheit für ${key}` });
        upd.run(key, req.body[key]);
      }
    }
    res.json(getConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── yearly rules ────────────────────────────────────────────────────────────

// GET /api/employees/rules
router.get('/rules', (req, res) => {
  try {
    const rules = db.prepare('SELECT * FROM employee_yearly_rules ORDER BY name ASC').all();
    const overrides = db.prepare('SELECT * FROM employee_rule_overrides').all();
    res.json({
      rules: rules.map(r => ({
        ...r,
        overrides: overrides.filter(o => o.rule_id === r.id)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/employees/rules
router.post('/rules', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });
  const { name, type, amount, month, day } = req.body;
  if (!name?.trim() || !type || amount === undefined) {
    return res.status(400).json({ error: 'Name, Typ und Betrag erforderlich' });
  }
  try {
    const result = db.prepare(
      'INSERT INTO employee_yearly_rules (name, type, amount, month, day) VALUES (?, ?, ?, ?, ?)'
    ).run(name.trim(), type, parseFloat(amount), parseInt(month) || 2, parseInt(day) || 1);
    res.json(db.prepare('SELECT * FROM employee_yearly_rules WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/employees/rules/:id
router.patch('/rules/:id', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });
  const id = parseInt(req.params.id);
  const rule = db.prepare('SELECT * FROM employee_yearly_rules WHERE id = ?').get(id);
  if (!rule) return res.status(404).json({ error: 'Regel nicht gefunden' });

  const fields = ['name', 'type', 'amount', 'month', 'day'];
  const updates = [];
  const vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      vals.push(f === 'amount' ? parseFloat(req.body[f]) : (f === 'month' || f === 'day' ? parseInt(req.body[f]) : req.body[f]));
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Keine Änderungen' });
  vals.push(id);
  db.prepare(`UPDATE employee_yearly_rules SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
  res.json(db.prepare('SELECT * FROM employee_yearly_rules WHERE id = ?').get(id));
});

// DELETE /api/employees/rules/:id
router.delete('/rules/:id', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM employee_yearly_rules WHERE id = ?').run(id);
  res.json({ success: true });
});

// PUT /api/employees/rules/:id/overrides/:empId
router.put('/rules/:id/overrides/:empId', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });
  const ruleId = parseInt(req.params.id);
  const empId = parseInt(req.params.empId);
  const { amount } = req.body;
  if (amount === undefined) return res.status(400).json({ error: 'Betrag erforderlich' });
  try {
    db.prepare(`
      INSERT OR REPLACE INTO employee_rule_overrides (rule_id, employee_id, amount) VALUES (?, ?, ?)
    `).run(ruleId, empId, parseFloat(amount));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/employees/rules/:id/overrides/:empId
router.delete('/rules/:id/overrides/:empId', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });
  db.prepare('DELETE FROM employee_rule_overrides WHERE rule_id = ? AND employee_id = ?')
    .run(parseInt(req.params.id), parseInt(req.params.empId));
  res.json({ success: true });
});

module.exports = router;
