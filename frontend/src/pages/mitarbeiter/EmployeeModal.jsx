import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import '../MitarbeiterPage.css';


const WORK_DAYS = [
  { key: 'mon', label: 'Mo' }, { key: 'tue', label: 'Di' }, { key: 'wed', label: 'Mi' },
  { key: 'thu', label: 'Do' }, { key: 'fri', label: 'Fr' }, { key: 'sat', label: 'Sa' }, { key: 'sun', label: 'So' },
];
const DEFAULT_SCHEDULE = { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 };
function parseWorkSchedule(ws) {
  if (!ws) return { ...DEFAULT_SCHEDULE };
  if (typeof ws === 'object') return ws;
  try { return JSON.parse(ws); } catch { return { ...DEFAULT_SCHEDULE }; }
}

const COLOR_SWATCHES = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#ef4444',
  '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#0ea5e9',
  '#64748b', '#78716c', '#6b7280',
];

export default function EmployeeModal({ employee, onClose, onSaved }) {
  const isEdit = !!employee;
  const [form, setForm] = useState({
    first_name: employee?.first_name || '',
    last_name: employee?.last_name || '',
    email: employee?.email || '',
    phone: employee?.phone || '',
    address: employee?.address || '',
    birth_date: employee?.birth_date || '',
    notes: employee?.notes || '',
    color: employee?.color || '#6366f1',
  });
  const [workSchedule, setWorkSchedule] = useState(parseWorkSchedule(employee?.work_schedule));
  const [balances, setBalances] = useState({});
  const [timeTypes, setTimeTypes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/employees/time-types')
      .then(r => r.ok ? r.json() : { types: [] })
      .then(d => setTimeTypes(d.types || []))
      .catch(() => {});
  }, []);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setError('');
    if (!form.first_name.trim() || !form.last_name.trim()) {
      return setError('Vor- und Nachname sind Pflichtfelder.');
    }
    setSaving(true);
    try {
      const body = { ...form, work_schedule: workSchedule };
      if (!isEdit) {
        body.initial_balances = {};
        for (const t of timeTypes.filter(t => t.has_quota)) {
          body.initial_balances[t.key] = parseFloat(balances[t.key]) || 0;
        }
      }

      const url = isEdit ? `/api/employees/${employee.id}` : '/api/employees';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || 'Fehler');
      onSaved(data);
      onClose();
    } catch { setError('Netzwerkfehler'); }
    setSaving(false);
  };

  return (
    <div className="ma-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ma-modal">
        <div className="ma-modal-header">
          <span className="ma-modal-title">{isEdit ? 'Mitarbeiter bearbeiten' : 'Neuen Mitarbeiter anlegen'}</span>
          <button className="ma-btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="ma-modal-body">
          {error && <div className="ma-error">{error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <div className="ma-field">
              <label className="ma-label">Vorname *</label>
              <input className="ma-input" value={form.first_name} onChange={e => set('first_name', e.target.value)} placeholder="Vorname" />
            </div>
            <div className="ma-field">
              <label className="ma-label">Nachname *</label>
              <input className="ma-input" value={form.last_name} onChange={e => set('last_name', e.target.value)} placeholder="Nachname" />
            </div>
            <div className="ma-field">
              <label className="ma-label">E-Mail</label>
              <input className="ma-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@beispiel.at" />
            </div>
            <div className="ma-field">
              <label className="ma-label">Telefon</label>
              <input className="ma-input" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+43 ..." />
            </div>
            <div className="ma-field" style={{ gridColumn: '1 / -1' }}>
              <label className="ma-label">Adresse</label>
              <input className="ma-input" value={form.address} onChange={e => set('address', e.target.value)} placeholder="Straße, PLZ Ort" />
            </div>
            <div className="ma-field">
              <label className="ma-label">Geburtsdatum</label>
              <input className="ma-input" type="date" value={form.birth_date} onChange={e => set('birth_date', e.target.value)} />
            </div>
            <div className="ma-field" style={{ gridColumn: '1 / -1' }}>
              <label className="ma-label">Notizen</label>
              <textarea className="ma-input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Interne Notizen..." style={{ resize: 'vertical' }} />
            </div>
            <div className="ma-field" style={{ gridColumn: '1 / -1' }}>
              <label className="ma-label">Kalenderfarbe</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {COLOR_SWATCHES.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => set('color', c)}
                    style={{
                      width: 24, height: 24, borderRadius: 6,
                      background: c, border: form.color === c ? '3px solid var(--text-primary)' : '2px solid transparent',
                      cursor: 'pointer', padding: 0, flexShrink: 0,
                      outline: form.color === c ? '2px solid var(--bg-primary)' : 'none',
                      outlineOffset: -4,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Work schedule */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, marginTop: 4 }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>Arbeitszeiten (Stunden/Tag)</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Gesamt: <strong style={{ color: 'var(--text-primary)' }}>
                {Object.values(workSchedule).reduce((s, h) => s + (parseFloat(h) || 0), 0)} Std/Woche
              </strong>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 16 }}>
            {WORK_DAYS.map(({ key, label }) => (
              <div key={key} style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: '0.72rem', fontWeight: 600, marginBottom: 4,
                  color: key === 'sat' || key === 'sun' ? '#ef4444' : 'var(--text-secondary)',
                }}>{label}</div>
                <input
                  className="ma-input"
                  type="number"
                  min="0"
                  max="24"
                  step="0.5"
                  value={workSchedule[key]}
                  onChange={e => setWorkSchedule(p => ({ ...p, [key]: parseFloat(e.target.value) || 0 }))}
                  style={{ textAlign: 'center', padding: '6px 4px' }}
                />
              </div>
            ))}
          </div>

          {/* Initial balances only on create, only for quota types */}
          {!isEdit && timeTypes.filter(t => t.has_quota).length > 0 && (
            <>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: 10, marginTop: 4 }}>
                Anfangsstände (aktuelles Jahr)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
                {timeTypes.filter(t => t.has_quota).map(t => {
                  const unitDisplay = t.unit === 'hours' ? 'Std' : t.unit === 'halfdays' ? 'Halbtage' : 'Tage';
                  return (
                    <div key={t.key} className="ma-field">
                      <label className="ma-label">
                        {t.name} <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>({unitDisplay})</span>
                      </label>
                      <input
                        className="ma-input"
                        type="number"
                        min="0"
                        step="0.5"
                        value={balances[t.key] || ''}
                        onChange={e => setBalances(p => ({ ...p, [t.key]: e.target.value }))}
                        placeholder="0"
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="ma-modal-footer">
          <button className="ma-btn ma-btn-ghost" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button className="ma-btn ma-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Speichern...' : (isEdit ? 'Speichern' : 'Anlegen')}
          </button>
        </div>
      </div>
    </div>
  );
}
