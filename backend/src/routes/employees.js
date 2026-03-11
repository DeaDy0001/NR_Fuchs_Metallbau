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
    const DEFAULT_WS = { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 };
    const rows = db.prepare(
      `SELECT * FROM employees WHERE archived = ? ORDER BY last_name ASC, first_name ASC`
    ).all(showArchived ? 1 : 0);
    const employees = rows.map(e => ({
      ...e,
      age: calcAge(e.birth_date),
      work_schedule: e.work_schedule
        ? (typeof e.work_schedule === 'string' ? JSON.parse(e.work_schedule) : e.work_schedule)
        : DEFAULT_WS,
    }));
    res.json({ employees });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/employees
router.post('/', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });

  const { first_name, last_name, email, phone, address, birth_date, notes, color, work_schedule, initial_balances } = req.body;
  if (!first_name?.trim() || !last_name?.trim()) {
    return res.status(400).json({ error: 'Vor- und Nachname sind erforderlich' });
  }

  try {
    const wsStr = work_schedule
      ? (typeof work_schedule === 'object' ? JSON.stringify(work_schedule) : work_schedule)
      : '{"mon":8,"tue":8,"wed":8,"thu":8,"fri":8,"sat":0,"sun":0}';
    const result = db.prepare(`
      INSERT INTO employees (first_name, last_name, email, phone, address, birth_date, notes, color, work_schedule)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      first_name.trim(), last_name.trim(),
      email || null, phone || null, address || null, birth_date || null, notes || null,
      color || '#6366f1', wsStr
    );
    const empId = result.lastInsertRowid;
    const year = new Date().getFullYear();

    // Set initial balances for quota types
    if (initial_balances && typeof initial_balances === 'object') {
      for (const [type, val] of Object.entries(initial_balances)) {
        const allocated = parseFloat(val) || 0;
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

  const fields = ['first_name', 'last_name', 'email', 'phone', 'address', 'birth_date', 'notes', 'color'];
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

  if (req.body.work_schedule !== undefined) {
    const wsVal = req.body.work_schedule
      ? (typeof req.body.work_schedule === 'object' ? JSON.stringify(req.body.work_schedule) : req.body.work_schedule)
      : null;
    updates.push('work_schedule = ?');
    vals.push(wsVal);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Keine Änderungen' });

  updates.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE employees SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

  writeLog(id, 'update', { employee: `${emp.first_name} ${emp.last_name}`, changes: changed }, req.appUser);

  const updated = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  const DEFAULT_WS = { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 };
  res.json({
    ...updated,
    age: calcAge(updated.birth_date),
    work_schedule: updated.work_schedule
      ? (typeof updated.work_schedule === 'string' ? JSON.parse(updated.work_schedule) : updated.work_schedule)
      : DEFAULT_WS,
  });
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
    const balanceRows = db.prepare(
      'SELECT * FROM employee_balances WHERE employee_id = ? AND year = ?'
    ).all(id, year);

    // Use dynamic time types if table exists, fall back to legacy
    let timeTypes = [];
    try {
      timeTypes = db.prepare('SELECT * FROM employee_time_types ORDER BY sort_order ASC, name ASC').all();
    } catch {
      timeTypes = [
        { key: 'vacation', name: 'Urlaub', unit: 'days', has_quota: 1, color: '#6366f1' },
        { key: 'zeitausgleich', name: 'Zeitausgleich', unit: 'days', has_quota: 1, color: '#22c55e' },
        { key: 'sonderurlaub', name: 'Sonderurlaub', unit: 'days', has_quota: 1, color: '#f59e0b' },
        { key: 'krankenstand', name: 'Krankenstand', unit: 'days', has_quota: 0, color: '#ef4444' },
      ];
    }

    const result = {};
    for (const t of timeTypes) {
      const row = balanceRows.find(r => r.type === t.key) || { allocated: 0, used: 0 };
      const entry = {
        allocated: row.allocated || 0,
        used: row.used || 0,
        remaining: (row.allocated || 0) - (row.used || 0),
        type_info: t,
      };
      if (!t.has_quota) {
        const stats = db.prepare(
          "SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM employee_time_entries WHERE employee_id = ? AND type = ? AND is_storno = 0 AND strftime('%Y', start_date) = ?"
        ).get(id, t.key, String(year));
        entry.count = stats.cnt;
        entry.total_amount = stats.total;
      }
      result[t.key] = entry;
    }
    res.json({ year, balances: result, types: timeTypes });
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
  // Validate type against dynamic time types
  try {
    const typeRow = db.prepare('SELECT id FROM employee_time_types WHERE key = ?').get(type);
    if (!typeRow) return res.status(400).json({ error: 'Ungültiger Typ' });
  } catch {
    if (!['vacation', 'zeitausgleich', 'sonderurlaub', 'krankenstand'].includes(type)) {
      return res.status(400).json({ error: 'Ungültiger Typ' });
    }
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

      // Look up unit from dynamic time types, fall back to legacy config
      let unit = 'days';
      try {
        const typeRow = db.prepare('SELECT unit FROM employee_time_types WHERE key = ?').get(type);
        unit = typeRow?.unit || cfg[`unit_${type}`] || 'days';
      } catch {
        unit = cfg[`unit_${type}`] || 'days';
      }

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

// ─── time types ──────────────────────────────────────────────────────────────

// GET /api/employees/time-types
router.get('/time-types', (req, res) => {
  try {
    const types = db.prepare('SELECT * FROM employee_time_types ORDER BY sort_order ASC, name ASC').all();
    res.json({ types });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/employees/time-types
router.post('/time-types', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });
  const { name, unit, halfday_threshold, has_quota, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Bezeichnung erforderlich' });
  if (!['days', 'halfdays', 'hours'].includes(unit)) return res.status(400).json({ error: 'Ungültige Einheit' });
  try {
    // Generate unique key from name
    const baseKey = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    let key = baseKey || 'type';
    let counter = 1;
    while (db.prepare('SELECT id FROM employee_time_types WHERE key = ?').get(key)) {
      key = `${baseKey}_${counter++}`;
    }
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM employee_time_types').get().m || 0;
    const result = db.prepare(
      'INSERT INTO employee_time_types (key, name, unit, halfday_threshold, has_quota, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(key, name.trim(), unit || 'days', parseFloat(halfday_threshold) || 4.5, has_quota ? 1 : 0, color || '#6366f1', maxOrder + 1);
    res.json(db.prepare('SELECT * FROM employee_time_types WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/employees/time-types/:id
router.put('/time-types/:id', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });
  const id = parseInt(req.params.id);
  const tt = db.prepare('SELECT * FROM employee_time_types WHERE id = ?').get(id);
  if (!tt) return res.status(404).json({ error: 'Zeitart nicht gefunden' });
  const { name, unit, halfday_threshold, has_quota, color } = req.body;
  const updates = ["updated_at = datetime('now')"];
  const vals = [];
  if (name !== undefined) { updates.push('name = ?'); vals.push(name.trim()); }
  if (unit !== undefined) {
    if (!['days', 'halfdays', 'hours'].includes(unit)) return res.status(400).json({ error: 'Ungültige Einheit' });
    updates.push('unit = ?'); vals.push(unit);
  }
  if (halfday_threshold !== undefined) { updates.push('halfday_threshold = ?'); vals.push(parseFloat(halfday_threshold) || 4.5); }
  if (has_quota !== undefined) { updates.push('has_quota = ?'); vals.push(has_quota ? 1 : 0); }
  if (color !== undefined) { updates.push('color = ?'); vals.push(color); }
  vals.push(id);
  db.prepare(`UPDATE employee_time_types SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
  res.json(db.prepare('SELECT * FROM employee_time_types WHERE id = ?').get(id));
});

// DELETE /api/employees/time-types/:id
router.delete('/time-types/:id', (req, res) => {
  if (!req.appUser.is_admin) return res.status(403).json({ error: 'Nur Administratoren' });
  const id = parseInt(req.params.id);
  const tt = db.prepare('SELECT * FROM employee_time_types WHERE id = ?').get(id);
  if (!tt) return res.status(404).json({ error: 'Zeitart nicht gefunden' });
  const inUse = db.prepare('SELECT COUNT(*) as n FROM employee_time_entries WHERE type = ? AND is_storno = 0').get(tt.key).n;
  if (inUse > 0) return res.status(400).json({ error: `Zeitart wird in ${inUse} Einträgen verwendet und kann nicht gelöscht werden.` });
  db.prepare('DELETE FROM employee_time_types WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;
