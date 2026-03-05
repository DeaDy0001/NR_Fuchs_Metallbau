import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';
import '../MitarbeiterPage.css';

const TYPES = ['vacation', 'zeitausgleich', 'sonderurlaub', 'krankenstand'];
const TYPE_LABELS = { vacation: 'Urlaub', zeitausgleich: 'Zeitausgleich', sonderurlaub: 'Sonderurlaub', krankenstand: 'Krankenstand' };
const UNITS = [{ value: 'days', label: 'Tage' }, { value: 'halfdays', label: 'Halbtage' }, { value: 'hours', label: 'Stunden' }];
const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export default function MitarbeiterSettingsTab() {
  const [config, setConfig] = useState({});
  const [rules, setRules] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [newRule, setNewRule] = useState({ name: '', type: 'vacation', amount: '', month: 2, day: 1 });
  const [showNewRule, setShowNewRule] = useState(false);

  const load = useCallback(async () => {
    const [cfgRes, rulesRes, empRes] = await Promise.all([
      fetch('/api/employees/config'),
      fetch('/api/employees/rules'),
      fetch('/api/employees'),
    ]);
    if (cfgRes.ok) setConfig(await cfgRes.json());
    if (rulesRes.ok) setRules((await rulesRes.json()).rules);
    if (empRes.ok) setEmployees((await empRes.json()).employees.filter(e => !e.archived));
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveConfig = async () => {
    setSaving(true); setMsg(''); setError('');
    try {
      const res = await fetch('/api/employees/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setConfig(await res.json());
        setMsg('Einstellungen gespeichert.');
        setTimeout(() => setMsg(''), 2500);
      } else {
        const d = await res.json();
        setError(d.error || 'Fehler');
      }
    } catch { setError('Netzwerkfehler'); }
    setSaving(false);
  };

  const createRule = async () => {
    if (!newRule.name.trim() || !newRule.amount) return setError('Name und Betrag erforderlich.');
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/employees/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newRule, amount: parseFloat(newRule.amount) }),
      });
      if (res.ok) {
        setNewRule({ name: '', type: 'vacation', amount: '', month: 2, day: 1 });
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

  return (
    <div>
      {error && <div className="ma-error">{error}</div>}
      {msg && <div className="ma-success">{msg}</div>}

      {/* ── Einheiten ── */}
      <div className="ma-card" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: 14 }}>
          Einheiten pro Typ
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0 20px' }}>
          {TYPES.map(t => (
            <div key={t} className="ma-field">
              <label className="ma-label">{TYPE_LABELS[t]}</label>
              <select
                className="ma-select"
                value={config[`unit_${t}`] || 'days'}
                onChange={e => setConfig(p => ({ ...p, [`unit_${t}`]: e.target.value }))}
              >
                {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          ))}
        </div>
        <button className="ma-btn ma-btn-primary" onClick={saveConfig} disabled={saving} style={{ marginTop: 4 }}>
          <Check size={15} />
          {saving ? 'Speichern...' : 'Einheiten speichern'}
        </button>
      </div>

      {/* ── Jahresregeln ── */}
      <div className="ma-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
            Jährliche Zuteilung (Regeln)
          </div>
          <button className="ma-btn ma-btn-primary" onClick={() => { setShowNewRule(!showNewRule); setError(''); }}>
            <Plus size={15} />
            Neue Regel
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
                <label className="ma-label">Typ</label>
                <select className="ma-select" value={newRule.type} onChange={e => setNewRule(p => ({ ...p, type: e.target.value }))}>
                  {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
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
                <div>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{rule.name}</span>
                  <span style={{ marginLeft: 10, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {TYPE_LABELS[rule.type]} · {rule.amount} · Am {rule.day}. {MONTHS[rule.month - 1]}
                  </span>
                </div>
                <button className="ma-btn-icon danger" title="Löschen" onClick={() => deleteRule(rule.id)}>
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Per-employee overrides */}
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 6 }}>Individuelle Beträge (leer = Standard {rule.amount})</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {employees.map(emp => {
                  const override = rule.overrides?.find(o => o.employee_id === emp.id);
                  return (
                    <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
