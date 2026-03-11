import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Check, Pencil } from 'lucide-react';
import '../MitarbeiterPage.css';

const UNITS = [{ value: 'days', label: 'Tage' }, { value: 'halfdays', label: 'Halbtage' }, { value: 'hours', label: 'Stunden' }];
const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const COLOR_PALETTE = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#ef4444',
  '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#64748b',
];

const EMPTY_TYPE_FORM = { name: '', unit: 'days', halfday_threshold: 4.5, has_quota: true, color: '#6366f1' };

export default function MitarbeiterSettingsTab() {
  const [timeTypes, setTimeTypes] = useState([]);
  const [rules, setRules] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Time type form state
  const [showTypeForm, setShowTypeForm] = useState(null); // null | 'new' | id
  const [typeForm, setTypeForm] = useState({ ...EMPTY_TYPE_FORM });

  // Rule form state
  const [newRule, setNewRule] = useState({ name: '', type: '', amount: '', month: 2, day: 1 });
  const [showNewRule, setShowNewRule] = useState(false);

  const load = useCallback(async () => {
    const [ttRes, rulesRes, empRes] = await Promise.all([
      fetch('/api/employees/time-types'),
      fetch('/api/employees/rules'),
      fetch('/api/employees'),
    ]);
    if (ttRes.ok) {
      const types = (await ttRes.json()).types;
      setTimeTypes(types);
      // Set default rule type to first quota type if not set
      setNewRule(prev => !prev.type && types.find(t => t.has_quota) ? { ...prev, type: types.find(t => t.has_quota).key } : prev);
    }
    if (rulesRes.ok) setRules((await rulesRes.json()).rules);
    if (empRes.ok) setEmployees((await empRes.json()).employees.filter(e => !e.archived));
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Time type CRUD ───────────────────────────────────────────────────────────
  function openCreate() {
    setTypeForm({ ...EMPTY_TYPE_FORM });
    setShowTypeForm('new');
    setError('');
  }

  function openEdit(t) {
    setTypeForm({ name: t.name, unit: t.unit, halfday_threshold: t.halfday_threshold || 4.5, has_quota: !!t.has_quota, color: t.color || '#6366f1' });
    setShowTypeForm(t.id);
    setError('');
  }

  async function saveTypeForm() {
    if (!typeForm.name.trim()) return setError('Bezeichnung erforderlich.');
    setSaving(true); setError('');
    try {
      const isNew = showTypeForm === 'new';
      const url = isNew ? '/api/employees/time-types' : `/api/employees/time-types/${showTypeForm}`;
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...typeForm, halfday_threshold: parseFloat(typeForm.halfday_threshold) || 4.5 }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Fehler');
      setShowTypeForm(null);
      await load();
    } catch { setError('Netzwerkfehler'); }
    setSaving(false);
  }

  async function deleteType(id) {
    if (!confirm('Zeitart wirklich löschen?')) return;
    setError('');
    try {
      const res = await fetch(`/api/employees/time-types/${id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Fehler');
      await load();
    } catch { setError('Netzwerkfehler'); }
  }

  // ── Rules CRUD ───────────────────────────────────────────────────────────────
  const createRule = async () => {
    if (!newRule.name.trim() || !newRule.amount || !newRule.type) return setError('Name, Typ und Betrag erforderlich.');
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/employees/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newRule, amount: parseFloat(newRule.amount) }),
      });
      if (res.ok) {
        const firstQuota = timeTypes.find(t => t.has_quota);
        setNewRule({ name: '', type: firstQuota?.key || '', amount: '', month: 2, day: 1 });
        setShowNewRule(false);
        await load();
      } else {
        const d = await res.json();
        setError(d.error || 'Fehler');
      }
    } catch { setError('Netzwerkfehler'); }
    setSaving(false);
  };

  const deleteRule = async (id) => {
    if (!confirm('Regel wirklich löschen?')) return;
    try {
      await fetch(`/api/employees/rules/${id}`, { method: 'DELETE' });
      await load();
    } catch { /* ignore */ }
  };

  const setOverride = async (ruleId, empId, amount) => {
    if (amount === '' || amount === null) {
      await fetch(`/api/employees/rules/${ruleId}/overrides/${empId}`, { method: 'DELETE' });
    } else {
      await fetch(`/api/employees/rules/${ruleId}/overrides/${empId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseFloat(amount) }),
      });
    }
    await load();
  };

  const quotaTypes = timeTypes.filter(t => t.has_quota);
  const getTypeName = (key) => timeTypes.find(t => t.key === key)?.name || key;
  const getTypeColor = (key) => timeTypes.find(t => t.key === key)?.color || '#888';

  return (
    <div>
      {error && <div className="ma-error">{error}</div>}
      {msg && <div className="ma-success">{msg}</div>}

      {/* ── Zeitarten ── */}
      <div className="ma-card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Zeitarten</div>
          <button className="ma-btn ma-btn-primary" onClick={openCreate}>
            <Plus size={15} /> Neue Zeitart
          </button>
        </div>

        {/* Create/edit form */}
        {showTypeForm !== null && (
          <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: 14, marginBottom: 14, border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
              <div className="ma-field">
                <label className="ma-label">Bezeichnung *</label>
                <input className="ma-input" value={typeForm.name} onChange={e => setTypeForm(p => ({ ...p, name: e.target.value }))} placeholder="z.B. Urlaub" />
              </div>
              <div className="ma-field">
                <label className="ma-label">Einheit</label>
                <select className="ma-select" value={typeForm.unit} onChange={e => setTypeForm(p => ({ ...p, unit: e.target.value }))}>
                  {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
              {typeForm.unit === 'halfdays' && (
                <div className="ma-field">
                  <label className="ma-label">Halbtagsgrenze (Std)</label>
                  <input className="ma-input" type="number" step="0.5" min="0.5" value={typeForm.halfday_threshold}
                    onChange={e => setTypeForm(p => ({ ...p, halfday_threshold: e.target.value }))}
                    placeholder="4.5" />
                </div>
              )}
              <div className="ma-field" style={{ gridColumn: typeForm.unit === 'halfdays' ? undefined : '1 / -1' }}>
                <label className="ma-label">Hat Kontingent</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={typeForm.has_quota}
                    onChange={e => setTypeForm(p => ({ ...p, has_quota: e.target.checked }))} />
                  <span style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
                    {typeForm.has_quota
                      ? 'Ja – Mitarbeiter haben ein Zeitkontingent (z.B. 25 Urlaubstage/Jahr)'
                      : 'Nein – kein Kontingent, nur Tage zählen (z.B. Krankenstand)'}
                  </span>
                </label>
              </div>
              <div className="ma-field" style={{ gridColumn: '1 / -1' }}>
                <label className="ma-label">Farbe</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {COLOR_PALETTE.map(c => (
                    <button key={c} type="button" onClick={() => setTypeForm(p => ({ ...p, color: c }))}
                      style={{ width: 22, height: 22, borderRadius: 5, background: c, padding: 0, cursor: 'pointer',
                        border: typeForm.color === c ? '3px solid var(--text-primary)' : '2px solid transparent',
                        outline: typeForm.color === c ? '2px solid var(--bg-primary)' : 'none', outlineOffset: -4 }} />
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="ma-btn ma-btn-primary" onClick={saveTypeForm} disabled={saving}>
                {showTypeForm === 'new' ? 'Erstellen' : 'Speichern'}
              </button>
              <button className="ma-btn ma-btn-ghost" onClick={() => setShowTypeForm(null)}>Abbrechen</button>
            </div>
          </div>
        )}

        {timeTypes.length === 0 ? (
          <div className="ma-empty" style={{ padding: '20px 0' }}>Noch keine Zeitarten definiert.</div>
        ) : (
          timeTypes.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, marginBottom: 8, border: '1px solid var(--border-color)' }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
              <span style={{ fontWeight: 600, flex: 1, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{t.name}</span>
              <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {UNITS.find(u => u.value === t.unit)?.label || t.unit}
                {t.unit === 'halfdays' ? ` (ab ${t.halfday_threshold}h)` : ''}
              </span>
              <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap',
                background: t.has_quota ? 'rgba(99,102,241,0.1)' : 'rgba(100,116,139,0.1)',
                color: t.has_quota ? '#6366f1' : '#64748b' }}>
                {t.has_quota ? 'Kontingent' : 'Kein Kontingent'}
              </span>
              <button className="ma-btn-icon" title="Bearbeiten" onClick={() => openEdit(t)}><Pencil size={14} /></button>
              <button className="ma-btn-icon danger" title="Löschen" onClick={() => deleteType(t.id)}><Trash2 size={14} /></button>
            </div>
          ))
        )}
      </div>

      {/* ── Jahresregeln ── */}
      <div className="ma-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
            Jährliche Zuteilung (Regeln)
          </div>
          <button className="ma-btn ma-btn-primary" onClick={() => { setShowNewRule(!showNewRule); setError(''); }}>
            <Plus size={15} /> Neue Regel
          </button>
        </div>

        {showNewRule && (
          <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: 14, marginBottom: 14, border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 14px' }}>
              <div className="ma-field" style={{ gridColumn: '1 / -1' }}>
                <label className="ma-label">Regelname</label>
                <input className="ma-input" value={newRule.name} onChange={e => setNewRule(p => ({ ...p, name: e.target.value }))} placeholder="z.B. Standard Urlaubszuteilung" />
              </div>
              <div className="ma-field">
                <label className="ma-label">Zeitart</label>
                <select className="ma-select" value={newRule.type} onChange={e => setNewRule(p => ({ ...p, type: e.target.value }))}>
                  {quotaTypes.length === 0 && <option value="">— keine Zeitarten mit Kontingent —</option>}
                  {quotaTypes.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
                </select>
              </div>
              <div className="ma-field">
                <label className="ma-label">Standard-Betrag</label>
                <input className="ma-input" type="number" min="0" step="0.5" value={newRule.amount} onChange={e => setNewRule(p => ({ ...p, amount: e.target.value }))} placeholder="0" />
              </div>
              <div className="ma-field">
                <label className="ma-label">Monat</label>
                <select className="ma-select" value={newRule.month} onChange={e => setNewRule(p => ({ ...p, month: parseInt(e.target.value) }))}>
                  {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div className="ma-field">
                <label className="ma-label">Tag</label>
                <input className="ma-input" type="number" min="1" max="31" value={newRule.day} onChange={e => setNewRule(p => ({ ...p, day: parseInt(e.target.value) }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="ma-btn ma-btn-primary" onClick={createRule} disabled={saving}>Erstellen</button>
              <button className="ma-btn ma-btn-ghost" onClick={() => setShowNewRule(false)}>Abbrechen</button>
            </div>
          </div>
        )}

        {rules.length === 0 ? (
          <div className="ma-empty" style={{ padding: '20px 0' }}>Keine Regeln definiert.</div>
        ) : (
          rules.map(rule => (
            <div key={rule.id} style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: 14, marginBottom: 10, border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: getTypeColor(rule.type), flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{rule.name}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {getTypeName(rule.type)} · {rule.amount} · Am {rule.day}. {MONTHS[rule.month - 1]}
                  </span>
                </div>
                <button className="ma-btn-icon danger" title="Löschen" onClick={() => deleteRule(rule.id)}>
                  <Trash2 size={14} />
                </button>
              </div>

              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 6 }}>Individuelle Beträge (leer = Standard {rule.amount})</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {employees.map(emp => {
                  const override = rule.overrides?.find(o => o.employee_id === emp.id);
                  return (
                    <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: emp.color || '#6366f1', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-primary)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {emp.first_name} {emp.last_name}
                      </span>
                      <input
                        className="ma-input"
                        type="number"
                        step="0.5"
                        min="0"
                        style={{ width: 60, padding: '4px 8px', fontSize: '0.78rem' }}
                        defaultValue={override?.amount ?? ''}
                        placeholder={String(rule.amount)}
                        onBlur={e => setOverride(rule.id, emp.id, e.target.value)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
